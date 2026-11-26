// Mounts Better Auth's handler. It must be registered BEFORE express.json(),
// because Better Auth reads the raw request body itself.
//
// Endpoints (all under /api/v1/auth):
//   POST /sign-up/email                     { name, email, password }  → sends a 6-digit code
//   POST /email-otp/verify-email            { email, otp }             → confirms the account
//   POST /email-otp/send-verification-otp   { email, type }            → (re)send a code: email-verification | sign-in | forget-password
//   POST /sign-in/email                     { email, password }        → sets the session cookie
//   POST /sign-in/email-otp                 { email, otp }             → sign in with a code instead of a password
//   POST /email-otp/request-password-reset  { email }                  → sends a reset code
//   POST /email-otp/reset-password          { email, otp, password }   → sets a new password, signs out other devices
//   GET  /get-session                                                   → current session + user (or null)
//   POST /sign-out
import { toNodeHandler } from "better-auth/node";
import type { RequestHandler } from "express";
import { getAuth } from "./auth.js";

let cached: { auth: ReturnType<typeof getAuth>; handler: ReturnType<typeof toNodeHandler> } | undefined;

export const authHandler: RequestHandler = (req, res) => {
  const auth = getAuth();
  if (cached?.auth !== auth) cached = { auth, handler: toNodeHandler(auth) };
  return cached.handler(req, res);
};
