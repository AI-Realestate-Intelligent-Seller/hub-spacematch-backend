// The one place where feature modules are mounted.
// Adding a module = one import + one line below.
// (Better Auth's /api/v1/auth/* handler is mounted in app.ts, before the JSON body parser.)
import { Router } from "express";
import { adOrderRoutes } from "./ad-orders/ad-order.routes.js";
import { announcementRoutes } from "./announcements/announcement.routes.js";
import { cmaRoutes, cmaWorkerRoutes } from "./cma/cma.routes.js";
import { cronRoutes } from "./cron/cron.routes.js";
import { commissionBuildingRoutes } from "./commission-buildings/commission-building.routes.js";
import { emailTemplateRoutes } from "./email-templates/email-template.routes.js";
import { feedbackRoutes } from "./feedback/feedback.routes.js";
import { healthRoutes } from "./health/health.routes.js";
import { helpRoutes } from "./help/help.routes.js";
import { listingAdRoutes } from "./listing-ads/listing-ad.routes.js";
import { listingSocialRoutes } from "./listing-social/listing-social.routes.js";
import { listingRoutes, portalRoutes } from "./listings/listing.routes.js";
import { marketMeRoutes, publicReviewRoutes } from "./market-me/market-me.routes.js";
import { openHouseRoutes } from "./open-houses/open-house.routes.js";
import { pastClientRoutes } from "./past-clients/past-client.routes.js";
import { publicRosterRoutes, userRoutes } from "./users/user.routes.js";
import { publicVendorRoutes, vendorRoutes } from "./vendors/vendor.routes.js";

export function moduleRoutes(): Router {
  const router = Router();

  router.use("/health", healthRoutes);
  router.use("/cron", cronRoutes);
  router.use("/users", userRoutes);
  router.use("/listings", listingAdRoutes);
  router.use("/listings", listingSocialRoutes);
  router.use("/listings", listingRoutes);
  router.use("/portal", portalRoutes);
  router.use("/vendors", vendorRoutes);
  router.use("/public", publicVendorRoutes);
  router.use("/help-requests", helpRoutes);
  router.use("/email-templates", emailTemplateRoutes);
  router.use("/commission-buildings", commissionBuildingRoutes);
  router.use("/feedback", feedbackRoutes);
  router.use("/past-clients", pastClientRoutes);
  router.use("/open-houses", openHouseRoutes);
  router.use("/market-me", marketMeRoutes);
  router.use("/public/reviews", publicReviewRoutes);
  router.use("/public/roster", publicRosterRoutes);
  router.use("/announcements", announcementRoutes);
  router.use("/ad-orders", adOrderRoutes);
  router.use("/cma", cmaRoutes);
  router.use("/cma-worker", cmaWorkerRoutes);

  return router;
}
