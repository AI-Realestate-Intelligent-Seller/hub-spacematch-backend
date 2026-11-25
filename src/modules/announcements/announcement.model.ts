// Team announcements board (was convex/schema.ts announcements + pushSubs). Admins/ops post;
// everyone reads; new posts are pushed to phones that turned notifications on.
import { boolean, index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const announcements = pgTable(
  "announcements",
  {
    id: text().primaryKey(),
    title: text(),
    body: text().notNull(),
    link: text(),
    pinned: boolean().notNull().default(false),
    authorEmail: text().notNull(),
    authorName: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  t => [index("announcements_created_idx").on(t.createdAt)],
).enableRLS();

/** Phones/browsers that turned notifications on (Web Push). */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: text().primaryKey(),
    userEmail: text().notNull(),
    endpoint: text().notNull(),
    p256dh: text().notNull(),
    auth: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  t => [uniqueIndex("push_subscriptions_endpoint_idx").on(t.endpoint)],
).enableRLS();

export type AnnouncementRow = typeof announcements.$inferSelect;
