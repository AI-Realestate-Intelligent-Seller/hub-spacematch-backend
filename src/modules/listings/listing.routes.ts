import { Router } from "express";
import { requireAuth, requireRole } from "../../middlewares/auth.js";
import * as c from "./listing.controller.js";

// ---------- Agent side: /api/v1/listings (signed in) ----------
export const listingRoutes = Router();
listingRoutes.use(requireAuth);

// Fixed paths first, so they aren't read as a listing id.
listingRoutes.get("/", c.list); //                                         GET    /listings?scope=mine|all
listingRoutes.post("/", c.create); //                                      POST   /listings
listingRoutes.get("/pick", c.pick); //                                     GET    /listings/pick
listingRoutes.get("/agents", requireRole("admin", "ops"), c.agents); //    GET    /listings/agents
listingRoutes.get("/showing-inbox", requireRole("admin", "ops"), c.inbox); //                     GET  /listings/showing-inbox
listingRoutes.post("/showing-inbox/:inboxId/assign", requireRole("admin", "ops"), c.assignInbox); // POST /listings/showing-inbox/:inboxId/assign
listingRoutes.patch("/events/:eventId", c.setEventStatus); //              PATCH  /listings/events/:eventId
listingRoutes.delete("/events/:eventId", c.removeEvent); //                DELETE /listings/events/:eventId
listingRoutes.patch("/suggestions/:suggestionId", c.updateSuggestion); //  PATCH  /listings/suggestions/:suggestionId

listingRoutes.get("/:id", c.get); //                                       GET    /listings/:id
listingRoutes.patch("/:id", c.update); //                                  PATCH  /listings/:id
listingRoutes.delete("/:id", c.remove); //                                 DELETE /listings/:id
listingRoutes.post("/:id/rotate-link", c.rotateLink); //                   POST   /listings/:id/rotate-link
listingRoutes.post("/:id/link-lofty", c.linkLofty); //                     POST   /listings/:id/link-lofty
listingRoutes.patch("/:id/steps/:key", c.toggleStep); //                   PATCH  /listings/:id/steps/:key
listingRoutes.put("/:id/metrics/:weekOf", c.saveMetrics); //               PUT    /listings/:id/metrics/:weekOf
listingRoutes.post("/:id/events", c.addEvent); //                          POST   /listings/:id/events
listingRoutes.post("/:id/events/showingtime", c.addParsedShowing); //      POST   /listings/:id/events/showingtime
listingRoutes.get("/:id/suggestions", c.suggestions); //                   GET    /listings/:id/suggestions
listingRoutes.post("/:id/suggestions", c.addSuggestion); //                POST   /listings/:id/suggestions
listingRoutes.post("/:id/suggestions/refresh", c.refreshSuggestions); //   POST   /listings/:id/suggestions/refresh

// ---------- Seller side: /api/v1/portal (public, the token is the key) ----------
export const portalRoutes = Router();
portalRoutes.get("/:token", c.portal); //                   GET  /portal/:token
portalRoutes.post("/:token/seen", c.portalSeen); //         POST /portal/:token/seen
portalRoutes.post("/:token/approve-plan", c.portalApprove); // POST /portal/:token/approve-plan
