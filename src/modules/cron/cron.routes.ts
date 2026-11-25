// GET /api/v1/cron/:task — called by Vercel Cron (Authorization: Bearer <CRON_SECRET>).
// Locally (not production) it also works without the secret, so tasks can be run by hand:
//   curl http://localhost:4000/api/v1/cron/run-jobs
import { type Request, type Response, Router } from "express";
import { config } from "../../config/index.js";
import { TASKS } from "../../jobs/tasks.js";
import { HttpError, notFound, unauthorized } from "../../utils/http-error.js";
import { logger } from "../../utils/logger.js";

export const cronRoutes = Router();

cronRoutes.get("/:task", async (req: Request, res: Response) => {
  const secret = config.cron.secret;
  const sent = req.header("authorization")?.replace(/^Bearer\s+/i, "");
  if (secret ? sent !== secret : config.isProduction) {
    throw secret ? unauthorized("Wrong cron secret.") : new HttpError(503, "not_configured", "CRON_SECRET is not set.");
  }
  const name = String(req.params.task);
  const task = TASKS[name];
  if (!task) throw notFound(`Unknown task "${name}". Tasks: ${Object.keys(TASKS).join(", ")}.`);
  const started = Date.now();
  const result = await task();
  logger.info("cron task done", { task: name, ms: Date.now() - started });
  res.json({ task: name, ms: Date.now() - started, result });
});
