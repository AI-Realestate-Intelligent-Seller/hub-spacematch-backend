// Agents' own email templates (was convex/schema.ts emailTemplates). Personal by default;
// "Suggest for team" sends one to admins/ops, who approve it into everyone's library.
import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "../users/user.model.js";

export const emailTemplates = pgTable(
  "email_templates",
  {
    id: text().primaryKey(),
    ownerUserId: text().references(() => users.id, { onDelete: "set null" }),
    ownerEmail: text().notNull(),
    ownerName: text().notNull(),
    title: text().notNull(),
    segment: text().notNull(), // a library segment id, or "other"
    subject: text().notNull(),
    body: text().notNull(),
    status: text().notNull().default("mine"), // mine | suggested | team | declined
    reviewNote: text(),
    reviewedBy: text(),
    basedOn: text(), // library email id it started from
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  t => [index("email_templates_owner_idx").on(t.ownerEmail, t.updatedAt), index("email_templates_status_idx").on(t.status, t.updatedAt)],
).enableRLS();

export type EmailTemplateRow = typeof emailTemplates.$inferSelect;
export type NewEmailTemplateRow = typeof emailTemplates.$inferInsert;
