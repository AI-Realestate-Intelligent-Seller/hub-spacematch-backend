import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.js";
import * as c from "./commission-building.controller.js";

// /api/v1/commission-buildings (signed in)
export const commissionBuildingRoutes = Router();
commissionBuildingRoutes.use(requireAuth);
commissionBuildingRoutes.get("/", c.list); //                       GET    /commission-buildings
commissionBuildingRoutes.post("/", c.create); //                    POST   /commission-buildings
commissionBuildingRoutes.put("/:id", c.update); //                  PUT    /commission-buildings/:id
commissionBuildingRoutes.delete("/:id", c.remove); //               DELETE /commission-buildings/:id
commissionBuildingRoutes.put("/:id/verification", c.verify); //     PUT    /commission-buildings/:id/verification (admins/ops)
commissionBuildingRoutes.post("/:id/report", c.report); //          POST   /commission-buildings/:id/report
commissionBuildingRoutes.patch("/:id/moderation", c.moderate); //   PATCH  /commission-buildings/:id/moderation (admins/ops)
