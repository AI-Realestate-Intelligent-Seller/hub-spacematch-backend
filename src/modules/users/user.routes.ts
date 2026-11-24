import { Router } from "express";
import { requireAuth, requireRole } from "../../middlewares/auth.js";
import * as c from "./user.controller.js";

export const userRoutes = Router();

// Every route here needs a signed-in user.
userRoutes.use(requireAuth);

// Own profile
userRoutes.get("/me", c.getMe); //            GET   /api/v1/users/me
userRoutes.patch("/me", c.updateMe); //       PATCH /api/v1/users/me

// Admin: team roster and invitations
userRoutes.get("/invitations", requireRole("admin"), c.listInvitations); //            GET    /api/v1/users/invitations
userRoutes.post("/invitations", requireRole("admin"), c.inviteUser); //                POST   /api/v1/users/invitations
userRoutes.delete("/invitations/:email", requireRole("admin"), c.revokeInvitation); // DELETE /api/v1/users/invitations/:email
userRoutes.get("/", requireRole("admin", "ops"), c.listUsers); //                        GET    /api/v1/users?role=&status=
userRoutes.patch("/:id", requireRole("admin"), c.adminUpdateUser); //                  PATCH  /api/v1/users/:id
