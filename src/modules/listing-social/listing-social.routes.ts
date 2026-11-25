import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.js";
import * as c from "./listing-social.controller.js";

// /api/v1/listings/:id/social (signed in; the listing's agent or admins/ops)
export const listingSocialRoutes = Router();
listingSocialRoutes.use(requireAuth);
listingSocialRoutes.get("/:id/social", c.get); //              GET  /listings/:id/social
listingSocialRoutes.put("/:id/social/links", c.saveLinks); //   PUT  /listings/:id/social/links (save links only)
listingSocialRoutes.post("/:id/social/fetch", c.fetchNow); //  POST /listings/:id/social/fetch (can take minutes)
