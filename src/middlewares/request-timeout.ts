// Answers any request that takes too long with a clear error, instead of leaving the browser
// waiting forever. A request this slow almost always means dead database connections, so they
// are replaced too and the next request works again (no server restart needed).
import type { NextFunction, Request, Response } from "express";
import { resetDb } from "../db/client.js";
import { logger } from "../utils/logger.js";

export const REQUEST_TIMEOUT_MS = 20_000;
/** Routes that read social links through the Reels service can take minutes (its guide: 300 s). */
const LONG_ROUTES = [/\/social\/fetch$/, /\/cron\//];
const LONG_TIMEOUT_MS = 300_000;

export function requestTimeout(req: Request, res: Response, next: NextFunction) {
  const ms = LONG_ROUTES.some(r => r.test(req.path)) ? LONG_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
  const timer = setTimeout(() => {
    if (res.headersSent) return;
    logger.error("request timed out", { requestId: req.id, method: req.method, path: req.path, ms });
    resetDb(`request timed out: ${req.method} ${req.path}`);
    res.status(503).json({
      error: {
        code: "timeout",
        message: "The server took too long to answer. Please try again.",
        requestId: req.id,
      },
    });
  }, ms);
  const done = () => clearTimeout(timer);
  res.on("finish", done);
  res.on("close", done);
  next();
}
