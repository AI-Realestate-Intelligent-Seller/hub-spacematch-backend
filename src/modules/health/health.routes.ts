import { Router } from "express";
import { healthController } from "./health.controller.js";

export const healthRoutes = Router();

// GET /api/v1/health: public, no auth.
healthRoutes.get("/", healthController);
