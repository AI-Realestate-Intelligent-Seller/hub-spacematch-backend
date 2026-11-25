import express, { Router } from "express";
import { requireAuth } from "../../middlewares/auth.js";
import { HttpError } from "../../utils/http-error.js";
import * as c from "./feedback.controller.js";

// /api/v1/feedback (signed in)
export const feedbackRoutes = Router();
feedbackRoutes.use(requireAuth);
feedbackRoutes.get("/", c.list); //                  GET    /feedback
feedbackRoutes.post("/", c.create); //               POST   /feedback
feedbackRoutes.post(
  "/screenshots", //                                 POST   /feedback/screenshots (raw image body, 4 MB max)
  express.raw({ type: "image/*", limit: "4mb" }),
  c.uploadShot,
);
feedbackRoutes.post("/:id/vote", c.vote); //         POST   /feedback/:id/vote (toggles "Me too")
feedbackRoutes.post("/:id/decision", c.decide); //   POST   /feedback/:id/decision (admins)
feedbackRoutes.delete("/:id", c.remove); //          DELETE /feedback/:id

// A too-large screenshot gets a clear message instead of a generic error.
feedbackRoutes.use((err: unknown, _req: express.Request, _res: express.Response, next: express.NextFunction) => {
  if ((err as { type?: string })?.type === "entity.too.large") return next(new HttpError(413, "too_large", "The screenshot is too big (4 MB max)."));
  next(err);
});
