// Better Auth's own tables (sessions, password accounts, email codes, rate limits).
// Column names follow Better Auth's schema; `casing: "snake_case"` maps them to snake_case.
import { bigint, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "../users/user.model.js";

const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const sessions = pgTable(
  "sessions",
  {
    id: text().primaryKey(),
    token: text().notNull().unique(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    ipAddress: text(),
    userAgent: text(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  t => [index("sessions_user_id_idx").on(t.userId)],
).enableRLS();

/** One row per sign-in method. For email + password, providerId = "credential" and
 *  `password` holds the scrypt hash (same format as the live Hub's Convex Auth). */
export const accounts = pgTable(
  "accounts",
  {
    id: text().primaryKey(),
    accountId: text().notNull(),
    providerId: text().notNull(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: timestamp({ withTimezone: true }),
    refreshTokenExpiresAt: timestamp({ withTimezone: true }),
    scope: text(),
    password: text(),
    ...timestamps,
  },
  t => [index("accounts_user_id_idx").on(t.userId)],
).enableRLS();

/** Email codes (stored hashed) and other short-lived tokens. */
export const verifications = pgTable(
  "verifications",
  {
    id: text().primaryKey(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    ...timestamps,
  },
  t => [index("verifications_identifier_idx").on(t.identifier)],
).enableRLS();

/** Rate-limit counters shared by every server instance (needed on Vercel). */
export const rateLimits = pgTable("rate_limits", {
  id: text().primaryKey(),
  key: text().notNull().unique(),
  count: integer().notNull(),
  lastRequest: bigint({ mode: "number" }).notNull(),
}).enableRLS();
