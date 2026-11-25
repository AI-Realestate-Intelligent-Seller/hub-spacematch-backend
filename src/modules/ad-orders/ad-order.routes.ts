import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.js";
import * as c from "./ad-order.controller.js";

// /api/v1/ad-orders (signed in)
export const adOrderRoutes = Router();
adOrderRoutes.use(requireAuth);
adOrderRoutes.get("/config", c.config); //                      GET   /ad-orders/config (prices, isAdmin, pending count)
adOrderRoutes.get("/mine", c.mine); //                          GET   /ad-orders/mine
adOrderRoutes.get("/queue", c.queue); //                        GET   /ad-orders/queue (admins)
adOrderRoutes.put("/pricing", c.savePricing); //                PUT   /ad-orders/pricing (admins)
adOrderRoutes.get("/listing/:listingId", c.forListing); //      GET   /ad-orders/listing/:listingId
adOrderRoutes.post("/", c.place); //                            POST  /ad-orders
adOrderRoutes.post("/:id/cancel", c.cancel); //                 POST  /ad-orders/:id/cancel
adOrderRoutes.post("/:id/decision", c.decide); //               POST  /ad-orders/:id/decision (admins)
adOrderRoutes.patch("/:id/status", c.setStatus); //             PATCH /ad-orders/:id/status (admins)
adOrderRoutes.patch("/:id/payment", c.setPayment); //           PATCH /ad-orders/:id/payment (admins)
