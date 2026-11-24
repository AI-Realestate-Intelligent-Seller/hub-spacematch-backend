// Better Auth: email + password, email codes (verify account, sign in by code, reset password),
// database sessions in an http-only cookie. Mounted at /api/v1/auth/* (see auth.routes.ts).
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { emailOTP } from "better-auth/plugins";
import { config } from "../../config/index.js";
import { getOrm } from "../../db/client.js";
import { sendMail } from "../../integrations/email/mailer.js";
import { authCodeEmail } from "../../integrations/email/templates/auth-code.js";
import { logger } from "../../utils/logger.js";
import * as userService from "../users/user.service.js";
import { users } from "../users/user.model.js";
import { accounts, rateLimits, sessions, verifications } from "./auth.model.js";

const DAY = 60 * 60 * 24;

function createAuth() {
  if (!config.auth.secret) {
    throw new Error("AUTH_SECRET is empty. Generate one with: openssl rand -base64 32");
  }

  return betterAuth({
    appName: "SpaceMatch Hub",
    baseURL: config.apiUrl,
    basePath: config.auth.basePath,
    secret: config.auth.secret,
    // Frontend origins allowed to call auth endpoints with cookies.
    trustedOrigins: [...config.cors.origins],

    database: drizzleAdapter(getOrm(), {
      provider: "pg",
      // Better Auth's models are user/session/account/verification/rateLimit; our tables are plural.
      schema: { user: users, session: sessions, account: accounts, verification: verifications, rateLimit: rateLimits },
    }),

    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true, // must confirm the emailed code before the first sign-in
      minPasswordLength: 8,
      maxPasswordLength: 128,
      autoSignIn: false,
      revokeSessionsOnPasswordReset: true,
    },

    user: {
      // Hub columns on the users table. input:false = can't be set by the sign-up request.
      additionalFields: {
        role: { type: "string", required: false, defaultValue: "agent", input: false },
        status: { type: "string", required: false, defaultValue: "active", input: false },
        phone: { type: "string", required: false },
        title: { type: "string", required: false, input: false },
        licenseNo: { type: "string", required: false, input: false },
      },
    },

    session: {
      // Sliding session: every visit (at most once a day) pushes expiry out again.
      expiresIn: config.auth.sessionIdleDays * DAY,
      updateAge: DAY,
    },

    rateLimit: {
      // Stored in the database so every Vercel instance shares the counters. On in production only.
      storage: "database",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 10 },
        "/sign-up/email": { window: 60, max: 5 },
        "/email-otp/send-verification-otp": { window: 60, max: 3 },
        "/email-otp/request-password-reset": { window: 60, max: 3 },
      },
    },

    advanced: {
      cookiePrefix: "smhub",
      // Behind Vercel's proxy the client IP is in x-forwarded-for (used by rate limits).
      ipAddress: { ipAddressHeaders: ["x-forwarded-for", "x-real-ip"] },
    },

    databaseHooks: {
      user: {
        create: {
          // Sign-up gate: allowed domain or invitation; sets role from the invitation.
          before: async user => {
            const email = user.email.trim().toLowerCase();
            const decision = await userService.decideSignup(email);
            // 400, not 403: Better Auth turns a 403 here into a generic "check your email" success
            // (anti-enumeration), which would leave the person waiting for a code that never comes.
            if (!decision.allowed) {
              throw new APIError("BAD_REQUEST", { message: decision.reason, code: "SIGNUP_NOT_ALLOWED" });
            }
            return { data: { ...user, email, role: decision.role, status: "active" } };
          },
          after: async user => {
            await userService.onUserCreated(user.email);
          },
        },
      },
      session: {
        create: {
          // Removed users can't start a session (sign-in by password or code).
          before: async session => {
            const reason = await userService.checkCanSignIn(session.userId);
            if (reason) throw new APIError("FORBIDDEN", { message: reason });
          },
          after: async session => {
            await userService.recordLogin(session.userId);
          },
        },
      },
    },

    plugins: [
      emailOTP({
        otpLength: config.auth.otpLength,
        expiresIn: config.auth.otpExpiresInSeconds,
        allowedAttempts: config.auth.otpAllowedAttempts,
        storeOTP: "hashed",
        // Use 6-digit codes (like today's Hub) instead of verification links.
        overrideDefaultEmailVerification: true,
        sendVerificationOnSignUp: true,
        // "Sign in with a code" must never create an account (sign-up goes through the gate above).
        disableSignUp: true,
        sendVerificationOTP: async ({ email, otp, type }) => {
          // Awaited (not fire-and-forget) so serverless functions don't stop before the email leaves.
          const result = await sendMail(
            authCodeEmail(email, otp, type, Math.round(config.auth.otpExpiresInSeconds / 60)),
          );
          if (result.status === "failed") logger.warn("auth: code email failed", { type, to: email });
        },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
let instance: Auth | undefined;

/** Created on first use so the server can still boot (and report health) without auth config. */
export function getAuth(): Auth {
  instance ??= createAuth();
  return instance;
}
