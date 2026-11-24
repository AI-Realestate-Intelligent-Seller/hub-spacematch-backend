// Local / long-running entry point. On Vercel, app.ts is used directly.
import { app } from "./app.js";
import { config } from "./config/index.js";
import { closeDb } from "./db/client.js";
import { logger } from "./utils/logger.js";

const server = app.listen(config.port, () => {
  logger.info("API listening", { port: config.port, environment: config.env });
});

function shutdown(signal: string) {
  logger.info("shutting down", { signal });
  server.close(() => {
    closeDb().finally(() => process.exit(0));
  });
  // Force exit if open connections don't close in time.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
