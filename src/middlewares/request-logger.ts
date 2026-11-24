import type { NextFunction, Request, Response } from "express";
import { logger } from "../utils/logger.js";

// One log line per request with method, path, status and duration. Never logs bodies (client data).
export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const started = process.hrtime.bigint();
  res.on("finish", () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    logger.info("request", {
      requestId: req.id,
      method: req.method,
      // originalUrl keeps the full path (req.path is relative inside sub-routers); query string dropped.
      path: req.originalUrl.split("?")[0],
      status: res.statusCode,
      ms: Math.round(ms),
    });
  });
  next();
}
