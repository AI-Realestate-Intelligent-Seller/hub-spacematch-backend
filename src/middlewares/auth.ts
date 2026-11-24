// requireAuth: loads the signed-in user from the session cookie into req.user (or replies 401).
// requireRole: allows only the given roles (or replies 403). Use after requireAuth.
import type { NextFunction, Request, Response } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { getAuth } from "../modules/auth/auth.js";
import { ROLES, type Role } from "../types/auth.js";
import { forbidden, unauthorized } from "../utils/http-error.js";

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const session = await getAuth().api.getSession({ headers: fromNodeHeaders(req.headers) });
  if (!session) throw unauthorized();

  const user = session.user;
  if (user.status === "removed") throw unauthorized("This account has been removed. Contact a SpaceMatch admin.");
  const role = ROLES.includes(user.role as Role) ? (user.role as Role) : "guest";

  req.user = { id: user.id, email: user.email, name: user.name, role };
  next();
}

export function requireRole(...allowed: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw unauthorized();
    if (!allowed.includes(req.user.role)) throw forbidden();
    next();
  };
}
