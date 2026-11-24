import { config } from "../../config/index.js";
import { pingDb } from "../../db/client.js";
import { pingStorage } from "../../integrations/storage/storage.client.js";
import { logger } from "../../utils/logger.js";

export type CheckState = "ok" | "not_configured" | "error";
type CheckResult = { state: CheckState; ms?: number; error?: string };

async function runCheck(
  name: string,
  isConfigured: boolean,
  ping: () => Promise<number>,
): Promise<CheckResult> {
  if (!isConfigured) return { state: "not_configured" };
  try {
    return { state: "ok", ms: await ping() };
  } catch (e) {
    const error = e instanceof Error ? e.name || e.message : String(e);
    logger.error(`health: ${name} check failed`, { error: e instanceof Error ? e.message : String(e) });
    // Only the error class is returned (no hosts or keys); details stay in the server log.
    return { state: "error", error };
  }
}

// Reports whether the API is up and which foundation pieces are working.
export async function getHealth() {
  const [database, storage] = await Promise.all([
    runCheck("database", config.database.isConfigured, pingDb),
    runCheck("storage", config.storage.isConfigured, pingStorage),
  ]);
  const degraded = database.state === "error" || storage.state === "error";
  return {
    status: degraded ? ("degraded" as const) : ("ok" as const),
    environment: config.env,
    uptimeSeconds: Math.round(process.uptime()),
    time: new Date().toISOString(),
    checks: {
      database,
      storage: { ...storage, bucket: config.storage.bucket },
      auth: { state: (config.auth.secret ? "ok" : "not_configured") as CheckState },
      // mode "off" = emails go to the log; "live" = sent through SMTP (needs SMTP_USER/SMTP_PASS).
      mail: {
        state: (config.mail.isConfigured ? "ok" : "not_configured") as CheckState,
        mode: config.mail.mode,
      },
    },
  };
}
