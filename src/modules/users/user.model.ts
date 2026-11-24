// Users of the Hub and invitations for people outside the allowed email domain.
// The users table is also Better Auth's "user" table (extra columns are declared in auth.ts).
import { boolean, index, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** Replaces ADMIN_EMAILS / OPS_EMAILS / GUESTS lists in the old convex/agentsData.ts. */
export const userRole = pgEnum("user_role", ["admin", "ops", "agent", "guest"]);
/** removed = can't sign in; hidden from pickers and lead routing (was REMOVED_EMAILS). */
export const userStatus = pgEnum("user_status", ["active", "removed"]);

const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const users = pgTable(
  "users",
  {
    id: text().primaryKey(),
    // Better Auth core fields
    name: text().notNull(),
    email: text().notNull().unique(), // stored lower-case; the agent identity across the app
    emailVerified: boolean().notNull().default(false),
    image: text(),
    // Hub fields (from the old roster table)
    role: userRole().notNull().default("agent"),
    status: userStatus().notNull().default("active"),
    phone: text(),
    title: text(),
    licenseNo: text(),
    bio: text(),
    photoKey: text(), // storage key of the headshot
    driveFolderId: text(), // agent's Google Drive video folder
    addedBy: text(), // email of the admin who added them
    removedAt: timestamp({ withTimezone: true }),
    lastLoginAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  t => [index("users_role_idx").on(t.role), index("users_status_idx").on(t.status)],
).enableRLS();

/** People allowed to sign up although their email domain isn't allowed (guests), or who get a
 *  role other than "agent" when they sign up (admins, ops). */
export const userInvitations = pgTable("user_invitations", {
  email: text().primaryKey(), // lower-case
  role: userRole().notNull().default("guest"),
  invitedBy: text().notNull(), // email of the inviter, or "seed"
  note: text(),
  acceptedAt: timestamp({ withTimezone: true }),
  revokedAt: timestamp({ withTimezone: true }),
  ...timestamps,
}).enableRLS();

export type UserRow = typeof users.$inferSelect;
export type InvitationRow = typeof userInvitations.$inferSelect;
