import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.js";
import * as c from "./help.controller.js";

// /api/v1/help-requests (signed in)
export const helpRoutes = Router();
helpRoutes.use(requireAuth);
helpRoutes.get("/", c.list); //                   GET   /help-requests
helpRoutes.post("/", c.create); //                POST  /help-requests
helpRoutes.patch("/:id/status", c.setStatus); //  PATCH /help-requests/:id/status
helpRoutes.patch("/:id/assignee", c.reassign); // PATCH /help-requests/:id/assignee (admins/ops)
