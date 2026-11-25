import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.js";
import * as c from "./vendor.controller.js";

// /api/v1/vendors (signed in)
export const vendorRoutes = Router();
vendorRoutes.use(requireAuth);
vendorRoutes.get("/", c.list); //                     GET    /vendors
vendorRoutes.post("/", c.create); //                  POST   /vendors
vendorRoutes.put("/:id", c.update); //                PUT    /vendors/:id   (full form)
vendorRoutes.delete("/:id", c.remove); //             DELETE /vendors/:id
vendorRoutes.patch("/:id/moderation", c.moderate); // PATCH  /vendors/:id/moderation (admins)
vendorRoutes.put("/:id/rating", c.rate); //           PUT    /vendors/:id/rating

// /api/v1/public/pros (no login): the spacematchinc.com "Trusted Local Pros" list
export const publicVendorRoutes = Router();
publicVendorRoutes.get("/pros", c.publicPros);
