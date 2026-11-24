import type { Request, Response } from "express";
import { getHealth } from "./health.service.js";

// Controllers only translate HTTP <-> service calls.
export async function healthController(_req: Request, res: Response) {
  const health = await getHealth();
  res.status(health.status === "ok" ? 200 : 503).json(health);
}
