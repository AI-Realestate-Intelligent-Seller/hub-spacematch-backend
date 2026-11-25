// Help requests (was convex/schema.ts helpRequests): an agent asks a support person for help;
// it's emailed to them and tracked on the board (new → in progress / waiting → done).
import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "../users/user.model.js";

export const helpRequests = pgTable(
  "help_requests",
  {
    id: text().primaryKey(),
    fromUserId: text().references(() => users.id, { onDelete: "set null" }),
    fromEmail: text().notNull(),
    fromName: text().notNull(),
    toName: text().notNull(),
    toEmail: text().notNull(),
    topic: text().notNull(),
    details: text().notNull().default(""),
    urgency: text().notNull(), // now | today | week
    status: text().notNull().default("new"), // new | in_progress | waiting | done
    reply: text(),
    statusAt: timestamp({ withTimezone: true }),
    statusBy: text(),
    reassignedBy: text(),
    doneAt: timestamp({ withTimezone: true }),
    doneBy: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  t => [index("help_requests_from_idx").on(t.fromEmail, t.createdAt), index("help_requests_to_idx").on(t.toEmail, t.createdAt)],
).enableRLS();

export type HelpRequestRow = typeof helpRequests.$inferSelect;
export type NewHelpRequestRow = typeof helpRequests.$inferInsert;
