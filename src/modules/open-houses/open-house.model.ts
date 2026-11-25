// Team open house calendar (was convex/schema.ts openHouses): a slot on a team listing (or any
// address); anyone can host an open slot.
import { date, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { listings } from "../listings/listing.model.js";

export const openHouses = pgTable(
  "open_houses",
  {
    id: text().primaryKey(),
    listingId: text().references(() => listings.id, { onDelete: "set null" }),
    address: text().notNull(),
    date: date({ mode: "string" }).notNull(), // YYYY-MM-DD (Chicago)
    start: text().notNull(), // HH:MM
    end: text().notNull(),
    listingAgent: text().notNull(),
    hostEmail: text(),
    hostName: text(),
    notes: text(),
    createdByEmail: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  t => [index("open_houses_date_idx").on(t.date)],
).enableRLS();

export type OpenHouseRow = typeof openHouses.$inferSelect;
export type NewOpenHouseRow = typeof openHouses.$inferInsert;
