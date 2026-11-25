import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.js";
import * as c from "./open-house.controller.js";

// /api/v1/open-houses (signed in)
export const openHouseRoutes = Router();
openHouseRoutes.use(requireAuth);
openHouseRoutes.get("/", c.list); //             GET    /open-houses (today on)
openHouseRoutes.post("/", c.create); //          POST   /open-houses
openHouseRoutes.put("/:id/host", c.claim); //    PUT    /open-houses/:id/host  { claim }
openHouseRoutes.delete("/:id", c.remove); //     DELETE /open-houses/:id
