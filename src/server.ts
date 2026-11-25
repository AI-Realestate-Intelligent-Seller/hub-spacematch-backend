// Local / long-running entry point. On Vercel, app.ts is used directly.
import { app } from "./app.js";
import { config } from "./config/index.js";
import { closeDb } from "./db/client.js";
import { TASKS } from "./jobs/tasks.js";
import { logger } from "./utils/logger.js";

const server = app.listen(config.port, () => {
  logger.info("API listening", { port: config.port, environment: config.env });
});

// Locally there is no Vercel Cron: run queued jobs every 10 minutes in-process.
// The weekly emails and the daily social sync run only from Vercel Cron (or by hand: GET /api/v1/cron/<task>).
const localJobs = config.isProduction
  ? undefined
  : setInterval(() => {
      TASKS["run-jobs"]!().catch(e => logger.warn("local job run failed", { error: String(e) }));
    }, 10 * 60_000);
localJobs?.unref();

function shutdown(signal: string) {
  logger.info("shutting down", { signal });
  if (localJobs) clearInterval(localJobs);
  server.close(() => {
    closeDb().finally(() => process.exit(0));
  });
  // Force exit if open connections don't close in time.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
