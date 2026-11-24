import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { config } from "../config/index.js";
import { HttpError } from "../utils/http-error.js";
import { logger } from "../utils/logger.js";

// One error shape for the whole API:
// { "error": { "code": "bad_request", "message": "…", "details": …, "requestId": "…" } }
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: "validation_failed",
        message: "Some fields are missing or invalid.",
        details: err.issues.map(i => ({ path: i.path.join("."), message: i.message })),
        requestId: req.id,
      },
    });
    return;
  }

  if (err instanceof HttpError) {
    if (err.status >= 500) logger.error(err.message, { requestId: req.id, code: err.code });
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details, requestId: req.id },
    });
    return;
  }

  // Malformed JSON body from express.json()
  if (err instanceof SyntaxError && "body" in err) {
    res.status(400).json({
      error: { code: "invalid_json", message: "The request body is not valid JSON.", requestId: req.id },
    });
    return;
  }

  const e = err instanceof Error ? err : new Error(String(err));
  logger.error("unhandled error", { requestId: req.id, error: e.message, stack: e.stack });
  res.status(500).json({
    error: {
      code: "internal_error",
      message: "Something went wrong on our side. Please try again.",
      // Stack traces only outside production.
      details: config.isProduction ? undefined : e.message,
      requestId: req.id,
    },
  });
}
