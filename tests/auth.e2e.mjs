// End-to-end auth test. Usage (from backend/): start the API with MAIL_MODE=off, logging to a file, then
//   node tests/auth.e2e.mjs http://localhost:4000 /path/to/server.log
// Uses throwaway zz-e2e-* accounts and deletes everything it creates. Never run against production.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/package.json");
require("dotenv").config({ quiet: true });
const pg = require("postgres"); const postgres = pg.default ?? pg;

const API = process.argv[2];
const LOG = process.argv[3];
const ORIGIN = "http://localhost:5173";
const ts = Date.now();
const AGENT = `zz-e2e-agent-${ts}@spacematchinc.com`;
const ADMIN = `zz-e2e-admin-${ts}@example.com`;
const OUTSIDER = `zz-e2e-outsider-${ts}@example.com`;
const PW = "Test-password-123";
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, ssl: "require" });

let failures = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`); if (!ok) failures++; };

async function call(method, path, body, cookie) {
  const res = await fetch(API + path, {
    method,
    headers: { "content-type": "application/json", origin: ORIGIN, ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  const setCookie = res.headers.getSetCookie?.() ?? [];
  return { status: res.status, json, cookie: setCookie.map(c => c.split(";")[0]).join("; ") };
}

function latestCode(email, tag) {
  const lines = readFileSync(LOG, "utf8").trim().split("\n").reverse();
  for (const l of lines) {
    try { const j = JSON.parse(l); if (j.to === email && j.tag === tag && j.text) return j.text.match(/\b(\d{6})\b/)?.[1]; } catch {}
  }
  return undefined;
}
const wait = ms => new Promise(r => setTimeout(r, ms));

try {
  // 1. Agent signs up with an allowed-domain email
  let r = await call("POST", "/api/v1/auth/sign-up/email", { name: "E2E Agent", email: AGENT, password: PW });
  check("agent sign-up (allowed domain)", r.status === 200, `status ${r.status}`);
  await wait(300);
  const code1 = latestCode(AGENT, "auth-code:email-verification");
  check("verification code written to log (MAIL_MODE=off)", /^\d{6}$/.test(code1 ?? ""));

  // 2. Sign-in before verifying is refused
  r = await call("POST", "/api/v1/auth/sign-in/email", { email: AGENT, password: PW });
  check("sign-in refused before email is verified", r.status === 403, `status ${r.status} ${r.json?.code ?? ""}`);

  // 3. Verify with the code, then sign in
  r = await call("POST", "/api/v1/auth/email-otp/verify-email", { email: AGENT, otp: code1 });
  check("verify email with code", r.status === 200, `status ${r.status}`);
  r = await call("POST", "/api/v1/auth/sign-in/email", { email: AGENT, password: PW });
  const agentCookie = r.cookie;
  check("agent sign-in sets session cookie", r.status === 200 && agentCookie.includes("smhub.session_token"), `status ${r.status}`);

  r = await call("GET", "/api/v1/users/me", null, agentCookie);
  check("GET /users/me as agent", r.status === 200 && r.json.role === "agent" && r.json.email === AGENT, `role ${r.json?.role}`);
  r = await call("PATCH", "/api/v1/users/me", { phone: "(312) 555-0100", title: "Broker" }, agentCookie);
  check("PATCH /users/me updates profile", r.status === 200 && r.json.phone === "(312) 555-0100", `status ${r.status}`);
  r = await call("GET", "/api/v1/users", null, agentCookie);
  check("agent gets 403 on admin list", r.status === 403, `status ${r.status}`);
  r = await call("GET", "/api/v1/users/me");
  check("no cookie → 401", r.status === 401, `status ${r.status}`);

  // 4. Outsider without invitation is refused
  r = await call("POST", "/api/v1/auth/sign-up/email", { name: "Outsider", email: OUTSIDER, password: PW });
  check("outside-domain sign-up refused", r.status === 400 && r.json?.code === "SIGNUP_NOT_ALLOWED", `status ${r.status} "${r.json?.message ?? ""}"`);

  // 5. Invited admin (outside domain) signs up and gets the admin role
  await sql`insert into user_invitations (email, role, invited_by, note) values (${ADMIN}, 'admin', 'e2e', 'e2e test')`;
  r = await call("POST", "/api/v1/auth/sign-up/email", { name: "E2E Admin", email: ADMIN, password: PW });
  check("invited admin sign-up", r.status === 200, `status ${r.status}`);
  await wait(300);
  r = await call("POST", "/api/v1/auth/email-otp/verify-email", { email: ADMIN, otp: latestCode(ADMIN, "auth-code:email-verification") });
  check("admin verifies email", r.status === 200, `status ${r.status}`);
  r = await call("POST", "/api/v1/auth/sign-in/email", { email: ADMIN, password: PW });
  const adminCookie = r.cookie;
  r = await call("GET", "/api/v1/users/me", null, adminCookie);
  check("invited user gets invitation role (admin)", r.json?.role === "admin", `role ${r.json?.role}`);
  const [inv] = await sql`select accepted_at from user_invitations where email = ${ADMIN}`;
  check("invitation marked accepted", Boolean(inv?.accepted_at));

  // 6. Admin lists users and removes the agent
  r = await call("GET", "/api/v1/users?status=active", null, adminCookie);
  const agentRow = r.json?.items?.find(u => u.email === AGENT);
  check("admin lists users", r.status === 200 && Boolean(agentRow), `count ${r.json?.items?.length}`);
  r = await call("PATCH", `/api/v1/users/${agentRow.id}`, { status: "removed" }, adminCookie);
  check("admin removes agent", r.status === 200 && r.json.status === "removed" && r.json.removedAt, `status ${r.status}`);
  r = await call("GET", "/api/v1/users/me", null, agentCookie);
  check("removed agent's session no longer works", r.status === 401, `status ${r.status}`);
  r = await call("POST", "/api/v1/auth/sign-in/email", { email: AGENT, password: PW });
  check("removed agent can't sign in again", r.status === 403, `status ${r.status} "${r.json?.message ?? ""}"`);
  r = await call("PATCH", `/api/v1/users/${(await call("GET", "/api/v1/users/me", null, adminCookie)).json.id}`, { role: "agent" }, adminCookie);
  check("admin can't demote themself", r.status === 400, `status ${r.status}`);

  // 7. Password reset by code
  r = await call("POST", "/api/v1/auth/email-otp/request-password-reset", { email: ADMIN });
  check("request password reset", r.status === 200, `status ${r.status}`);
  await wait(300);
  const resetCode = latestCode(ADMIN, "auth-code:forget-password");
  r = await call("POST", "/api/v1/auth/email-otp/reset-password", { email: ADMIN, otp: resetCode, password: PW + "-new" });
  check("reset password with code", r.status === 200, `status ${r.status}`);
  r = await call("POST", "/api/v1/auth/sign-in/email", { email: ADMIN, password: PW + "-new" });
  check("sign in with new password", r.status === 200, `status ${r.status}`);
  r = await call("POST", "/api/v1/auth/sign-in/email", { email: ADMIN, password: PW });
  check("old password rejected", r.status === 401, `status ${r.status}`);

  // 8. Stored data looks right
  const [acct] = await sql`select a.provider_id, a.password from accounts a join users u on u.id = a.user_id where u.email = ${ADMIN}`;
  check("password stored as scrypt salt:hash (Convex-compatible format)", /^[0-9a-f]{32}:[0-9a-f]{128}$/.test(acct?.password ?? ""), acct?.provider_id);
  const otpRows = await sql`select value from verifications where identifier like ${"%" + ADMIN + "%"}`;
  check("email codes not stored in plain text", otpRows.every(v => !/^\d{6}(:\d+)?$/.test(v.value)), `${otpRows.length} rows`);
} catch (e) {
  failures++; console.log("ERROR", e);
} finally {
  // Cleanup: remove everything this test created.
  const del = await sql`delete from users where email in (${AGENT}, ${ADMIN}, ${OUTSIDER}) returning email`;
  await sql`delete from user_invitations where email in (${ADMIN}, ${OUTSIDER}, ${AGENT})`;
  await sql`delete from verifications where identifier like ${"%zz-e2e-%" + ts + "%"}`;
  console.log(`cleanup: removed ${del.length} test users (sessions/accounts cascade)`);
  await sql.end();
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
  process.exit(failures ? 1 : 0);
}
