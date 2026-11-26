import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.js";
import * as c from "./cma-builder.controller.js";

// ---------- /api/v1/listings/:id/cma (signed in; the listing's agent or admins/ops) ----------
export const cmaListingRoutes = Router();
cmaListingRoutes.use("/:id/cma", requireAuth);
cmaListingRoutes.get("/:id/cma/providers", c.providers); //    GET  /listings/:id/cma/providers
cmaListingRoutes.get("/:id/cma/defaults", c.defaults); //      GET  /listings/:id/cma/defaults   (request dialog prefill)
cmaListingRoutes.post("/:id/cma/request", c.request); //       POST /listings/:id/cma/request    → 202 { id, status }
cmaListingRoutes.get("/:id/cma/status", c.status); //          GET  /listings/:id/cma/status
cmaListingRoutes.get("/:id/cma/history", c.history); //        GET  /listings/:id/cma/history?limit&offset
cmaListingRoutes.get("/:id/cma/context", c.context); //        GET  /listings/:id/cma/context    (marketing numbers, not valuation)
cmaListingRoutes.get("/:id/cma/facts", c.facts); //            GET  /listings/:id/cma/facts      (published facts for the AI plan)
cmaListingRoutes.get("/:id/cma", c.current); //                GET  /listings/:id/cma

// ---------- /api/v1/cma-reports/:id (one report version; "/cma/:id" is the older request queue) ----------
export const cmaReportRoutes = Router();
cmaReportRoutes.use(requireAuth);
cmaReportRoutes.get("/", c.listRequests);
cmaReportRoutes.get("/:id", c.get);
cmaReportRoutes.patch("/:id", c.update);
cmaReportRoutes.get("/:id/comparables", c.comparables);
cmaReportRoutes.post("/:id/comparables", c.addComparable);
cmaReportRoutes.put("/:id/comparables/selection", c.selection);
cmaReportRoutes.patch("/:id/comparables/:comparableId", c.updateComparable);
cmaReportRoutes.delete("/:id/comparables/:comparableId", c.removeComparable);
cmaReportRoutes.post("/:id/import", c.importCsv);
cmaReportRoutes.post("/:id/calculate", c.calculate);
cmaReportRoutes.post("/:id/publish", c.publish);
cmaReportRoutes.post("/:id/revise", c.revise);
cmaReportRoutes.post("/:id/refresh", c.refresh);
cmaReportRoutes.post("/:id/retry", c.retry);
cmaReportRoutes.post("/:id/cancel", c.cancel);
cmaReportRoutes.get("/:id/preview", c.preview); //   HTML report (sandboxed)
cmaReportRoutes.get("/:id/pdf", c.pdf); //           { status: ready|rendering, url }

// ---------- /api/v1/portal/:token/cma (seller link, public: published data only) ----------
export const cmaSellerRoutes = Router();
cmaSellerRoutes.get("/:token/cma", c.sellerCma);
cmaSellerRoutes.get("/:token/cma/report", c.sellerReport);
cmaSellerRoutes.get("/:token/cma/pdf", c.sellerPdf);
