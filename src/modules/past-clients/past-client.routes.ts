import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.js";
import * as c from "./past-client.controller.js";

// /api/v1/past-clients (signed in; each agent sees only their own)
export const pastClientRoutes = Router();
pastClientRoutes.use(requireAuth);
pastClientRoutes.get("/", c.list); //                GET    /past-clients
pastClientRoutes.post("/", c.create); //             POST   /past-clients
pastClientRoutes.put("/:id", c.update); //           PUT    /past-clients/:id
pastClientRoutes.delete("/:id", c.remove); //        DELETE /past-clients/:id
pastClientRoutes.put("/:id/touches", c.touch); //    PUT    /past-clients/:id/touches  { key, done }
