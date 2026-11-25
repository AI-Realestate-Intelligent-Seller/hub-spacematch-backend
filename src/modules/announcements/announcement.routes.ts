import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.js";
import * as c from "./announcement.controller.js";

// /api/v1/announcements (signed in)
export const announcementRoutes = Router();
announcementRoutes.use(requireAuth);
announcementRoutes.get("/", c.list); //                        GET    /announcements
announcementRoutes.post("/", c.create); //                     POST   /announcements (admins/ops)
announcementRoutes.post("/push-subscriptions", c.subscribe); //  POST   /announcements/push-subscriptions
announcementRoutes.delete("/push-subscriptions", c.unsubscribe); // DELETE /announcements/push-subscriptions
announcementRoutes.patch("/:id/pin", c.pin); //                PATCH  /announcements/:id/pin (admins/ops)
announcementRoutes.delete("/:id", c.remove); //                DELETE /announcements/:id
