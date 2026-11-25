// Hub feedback board (was convex/schema.ts feedback): agents post fixes / improvements / add-ons,
// everyone can "Me too", admins decide in the Review tab.
import { boolean, index, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "../users/user.model.js";

export const feedback = pgTable(
  "feedback",
  {
    id: text().primaryKey(),
    fromUserId: text().references(() => users.id, { onDelete: "set null" }),
    fromEmail: text().notNull(),
    fromName: text().notNull(),
    kind: text().notNull(), // fix | improve | addon
    area: text().notNull(),
    title: text().notNull(),
    details: text().notNull().default(""),
    blocking: boolean(),
    shotKey: text(), // storage key of the screenshot
    category: text().notNull(), // key of FEEDBACK_CATEGORIES
    categorySource: text().notNull().default("auto"), // auto | admin
    status: text().notNull().default("new"), // see FEEDBACK_STATUS
    priority: text(),
    estimate: text(),
    reviewNote: text(),
    mergedInto: text(),
    reviewedAt: timestamp({ withTimezone: true }),
    decisionNote: text(),
    decidedBy: text(),
    decidedAt: timestamp({ withTimezone: true }),
    shippedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  t => [index("feedback_status_idx").on(t.status), index("feedback_from_idx").on(t.fromEmail)],
).enableRLS();

/** "Me too" votes: one per person per idea. */
export const feedbackVotes = pgTable(
  "feedback_votes",
  {
    feedbackId: text()
      .notNull()
      .references(() => feedback.id, { onDelete: "cascade" }),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  t => [primaryKey({ columns: [t.feedbackId, t.userId] })],
).enableRLS();

export type FeedbackRow = typeof feedback.$inferSelect;
export type NewFeedbackRow = typeof feedback.$inferInsert;
