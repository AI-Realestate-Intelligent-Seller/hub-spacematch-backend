import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.js";
import * as c from "./market-me.controller.js";

// /api/v1/market-me (signed in; everything is the agent's own)
export const marketMeRoutes = Router();
marketMeRoutes.use(requireAuth);
marketMeRoutes.get("/settings", c.getSettings); //     GET   /market-me/settings
marketMeRoutes.patch("/settings", c.saveSettings); //  PATCH /market-me/settings  { reviewUrl?, areas? }
marketMeRoutes.get("/reviews", c.myReviews); //        GET   /market-me/reviews
marketMeRoutes.post("/reviews", c.createReview); //    POST  /market-me/reviews   { clientName, channel }
marketMeRoutes.get("/market-kit", c.marketKit); //     GET   /market-me/market-kit
marketMeRoutes.put("/market-stats", c.enterStats); //  PUT   /market-me/market-stats

// /api/v1/public/reviews/:token (no login): the page a client opens from a review request
export const publicReviewRoutes = Router();
publicReviewRoutes.get("/:token", c.reviewView);
publicReviewRoutes.post("/:token/open", c.reviewOpen);
publicReviewRoutes.post("/:token/click", c.reviewClick);
publicReviewRoutes.post("/:token/note", c.reviewNote);
