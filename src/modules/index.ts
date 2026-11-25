// The one place where feature modules are mounted.
// Adding a module = one import + one line below.
// (Better Auth's /api/v1/auth/* handler is mounted in app.ts, before the JSON body parser.)
import { Router } from "express";
import { emailTemplateRoutes } from "./email-templates/email-template.routes.js";
import { healthRoutes } from "./health/health.routes.js";
import { helpRoutes } from "./help/help.routes.js";
import { listingRoutes, portalRoutes } from "./listings/listing.routes.js";
import { userRoutes } from "./users/user.routes.js";
import { publicVendorRoutes, vendorRoutes } from "./vendors/vendor.routes.js";

export function moduleRoutes(): Router {
  const router = Router();

  router.use("/health", healthRoutes);
  router.use("/users", userRoutes);
  router.use("/listings", listingRoutes);
  router.use("/portal", portalRoutes);
  router.use("/vendors", vendorRoutes);
  router.use("/public", publicVendorRoutes);
  router.use("/help-requests", helpRoutes);
  router.use("/email-templates", emailTemplateRoutes);

  return router;
}
