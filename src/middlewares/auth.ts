// requireAuth: loads the signed-in user from the session cookie into req.user (or replies 401).
// requireRole: allows only the given roles (or replies 403). Use after requireAuth.
import type { NextFunction, Request, Response } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { authConnectionError, getAuth } from "../modules/auth/auth.js";
import { ROLES, type Role } from "../types/auth.js";
import { forbidden, serviceUnavailable, unauthorized } from "../utils/http-error.js";

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const headers = fromNodeHeaders(req.headers);
  const auth = getAuth();
  const session = await auth.api.getSession({ headers }).catch(async error => {
    // A failed query or another request may have replaced the pool during this lookup.
    const current = getAuth();
    if (current === auth) {
      if (authConnectionError(error)) throw serviceUnavailable("Session lookup is temporarily unavailable. Please try again.");
      throw error;
    }
    try {
      return await current.api.getSession({ headers });
    } catch (retryError) {
      if (authConnectionError(retryError) || getAuth() !== current) throw serviceUnavailable("Session lookup is temporarily unavailable. Please try again.");
      throw retryError;
    }
  });
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
