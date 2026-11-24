// Operator tool: create an account from the terminal, already email-verified.
//   npm run user:create -- --email you@example.com --name "Your Name"
// The password is typed (hidden) in the terminal, never passed as an argument or logged.
// Goes through the same sign-up rules as the API (allowed domain or invitation → role).
import { createInterface } from "node:readline";
import { closeDb } from "../db/client.js";
import { getAuth } from "../modules/auth/auth.js";
import { findUserByEmail, setEmailVerified } from "../modules/users/user.repository.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1) return process.argv[i + 1];
  const eq = process.argv.find(a => a.startsWith(`--${name}=`));
  return eq?.slice(name.length + 3);
}

function askHidden(question: string): Promise<string> {
  return new Promise(resolve => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    // Hide typed characters (prints nothing while muted).
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => {
      if (!muted) process.stdout.write(s);
    };
    rl.question(question, answer => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
    muted = true;
  });
}

async function main() {
  const email = arg("email")?.trim().toLowerCase();
  const name = arg("name")?.trim();
  if (!email || !name) {
    console.error('Usage: npm run user:create -- --email you@example.com --name "Your Name"');
    process.exitCode = 1;
    return;
  }
  if (!process.stdin.isTTY) {
    console.error("Run this in an interactive terminal (the password is typed, not passed as an argument).");
    process.exitCode = 1;
    return;
  }

  const existing = await findUserByEmail(email);
  if (existing) {
    console.error(
      `An account for ${email} already exists (role: ${existing.role}). ` +
        "To set a new password use the reset flow: POST /api/v1/auth/email-otp/request-password-reset.",
    );
    process.exitCode = 1;
    return;
  }

  const password = await askHidden("Password (min 8 characters): ");
  const confirm = await askHidden("Repeat password: ");
  if (password !== confirm) {
    console.error("Passwords don't match. Nothing was created.");
    process.exitCode = 1;
    return;
  }
  if (password.length < 8) {
    console.error("Password must be at least 8 characters. Nothing was created.");
    process.exitCode = 1;
    return;
  }

  try {
    // Same path as POST /api/v1/auth/sign-up/email: the sign-up gate decides if allowed and the role.
    await getAuth().api.signUpEmail({ body: { email, name, password } });
  } catch (e) {
    const message = (e as { body?: { message?: string } }).body?.message ?? (e instanceof Error ? e.message : String(e));
    console.error(`Sign-up refused: ${message}`);
    process.exitCode = 1;
    return;
  }

  // The operator running this is trusted, so the email counts as confirmed.
  const user = await setEmailVerified(email);
  if (!user) {
    console.error("The account was not created (no user row found). Check the server log above.");
    process.exitCode = 1;
    return;
  }
  console.log(`Created ${user.email}  ·  role: ${user.role}  ·  email verified: ${user.emailVerified}`);
  console.log("Sign in with: POST /api/v1/auth/sign-in/email  { email, password }");
}

main()
  .catch(e => {
    console.error("Failed:", e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  })
  .finally(() => closeDb());
