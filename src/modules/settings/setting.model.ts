// Team-wide settings as key → JSON value (was the hubSettings table in Convex).
import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const appSettings = pgTable("app_settings", {
  key: text().primaryKey(), // e.g. "emails:rate"
  value: jsonb().notNull(),
  updatedBy: text(), // email
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}).enableRLS();

export type AppSettingRow = typeof appSettings.$inferSelect;
