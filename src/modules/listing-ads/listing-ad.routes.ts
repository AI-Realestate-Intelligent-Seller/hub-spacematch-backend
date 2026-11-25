import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.js";
import * as c from "./listing-ad.controller.js";

// /api/v1/listings/:id/ads (signed in; the listing's agent or admins/ops)
export const listingAdRoutes = Router();
listingAdRoutes.use(requireAuth);
listingAdRoutes.get("/:id/ads", c.list); //            GET /listings/:id/ads
listingAdRoutes.put("/:id/ads/:channel", c.save); //   PUT /listings/:id/ads/meta|google|lofty
