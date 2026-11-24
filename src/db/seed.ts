// Seed script: `npm run db:seed` (all groups) or `npm run db:seed -- --only=dev` (comma-separated groups).
// Like Alembic, migrations only change structure; starting data comes from this script.
//
// Rules for every seed step:
//   - Idempotent: safe to run any number of times (upsert by a natural key, never blind insert).
//   - No secrets or client data in this file. People come from .env lists (or, later, the Convex import).
//   - Each step logs what it changed.
import { config } from "../config/index.js";
import { upsertInvitation } from "../modules/users/user.repository.js";
import { logger } from "../utils/logger.js";
import { closeDb } from "./client.js";

type SeedStep = { group: string; name: string; run: () => Promise<number> };

/** Invitations carry the role a person gets when they sign up. No accounts or passwords are created:
 *  each person signs up themselves and chooses their own password. */
function invitationStep(group: string, emails: string[], role: "admin" | "ops", source: string): SeedStep {
  return {
    group,
    name: `${group} invitations (${role})`,
    run: async () => {
      for (const email of emails) {
        await upsertInvitation({ email, role, invitedBy: "seed", note: source });
      }
      return emails.length;
    },
  };
}

const steps: SeedStep[] = [
  invitationStep("dev", config.auth.seedDevEmails, "admin", "SEED_DEV_EMAILS"),
  invitationStep("admin", config.auth.seedAdminEmails, "admin", "SEED_ADMIN_EMAILS"),
  invitationStep("ops", config.auth.seedOpsEmails, "ops", "SEED_OPS_EMAILS"),
];

function selectedGroups(): Set<string> | null {
  const arg = process.argv.find(a => a.startsWith("--only="));
  if (!arg) return null;
  return new Set(arg.slice("--only=".length).split(",").map(s => s.trim()).filter(Boolean));
}

async function main() {
  const only = selectedGroups();
  const known = new Set(steps.map(s => s.group));
  for (const g of only ?? []) if (!known.has(g)) throw new Error(`Unknown seed group "${g}". Known: ${[...known].join(", ")}`);

  for (const step of steps) {
    if (only && !only.has(step.group)) {
      logger.info("seed step skipped", { step: step.name });
      continue;
    }
    const rows = await step.run();
    logger.info("seed step done", { step: step.name, rows });
  }
}

main()
  .catch(e => {
    logger.error("seed failed", { error: e instanceof Error ? e.message : String(e) });
    process.exitCode = 1;
  })
  .finally(() => closeDb());
