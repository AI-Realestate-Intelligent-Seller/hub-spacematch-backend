import type { NextFunction, Request, Response } from "express";
import { notFound } from "../utils/http-error.js";

// Any request that no route matched.
export function notFoundHandler(req: Request, _res: Response, next: NextFunction) {
  next(notFound(`No route for ${req.method} ${req.path}`));
}
