import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.js";
import * as c from "./email-template.controller.js";

// /api/v1/email-templates (signed in)
export const emailTemplateRoutes = Router();
emailTemplateRoutes.use(requireAuth);
emailTemplateRoutes.get("/", c.overview); //               GET    /email-templates  (mine, team, review, rate)
emailTemplateRoutes.post("/", c.create); //                POST   /email-templates
emailTemplateRoutes.put("/rate", c.setRate); //            PUT    /email-templates/rate (admins/ops)
emailTemplateRoutes.put("/:id", c.update); //              PUT    /email-templates/:id
emailTemplateRoutes.delete("/:id", c.remove); //           DELETE /email-templates/:id
emailTemplateRoutes.post("/:id/suggest", c.suggest); //    POST   /email-templates/:id/suggest
emailTemplateRoutes.post("/:id/review", c.review); //      POST   /email-templates/:id/review (admins/ops)
