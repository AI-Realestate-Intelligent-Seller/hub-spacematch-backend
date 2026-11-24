// The one place where feature modules are mounted.
// Adding a module = one import + one line below.
// (Better Auth's /api/v1/auth/* handler is mounted in app.ts, before the JSON body parser.)
import { Router } from "express";
import { healthRoutes } from "./health/health.routes.js";
import { userRoutes } from "./users/user.routes.js";

export function moduleRoutes(): Router {
  const router = Router();

  router.use("/health", healthRoutes);
  router.use("/users", userRoutes);

  return router;
}
