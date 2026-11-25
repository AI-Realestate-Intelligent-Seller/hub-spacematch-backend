// 100% commission rentals (was convex/schema.ts commissionBuildings): Chicago rental buildings that
// pay the tenant's agent a full month's rent or more ("pays"), and ones that don't ("no_pay").
// Agents add buildings; admins/ops stamp them Verified (or Confirmed on the "doesn't pay" list).
import { boolean, date, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "../users/user.model.js";

export const commissionBuildings = pgTable(
  "commission_buildings",
  {
    id: text().primaryKey(),
    name: text().notNull(),
    address: text().notNull(),
    addressKey: text().notNull(), // normalised street, to stop duplicates
    neighborhood: text(),
    manager: text(),
    commissionPct: integer().notNull(), // percent of ONE month's rent (100 = a full month)
    status: text().notNull().default("pays"), // pays | no_pay
    noPayReason: text(), // none | under | unpaid (no_pay list only)
    bonus: text(),
    keyRule: text(),
    terms: text(),
    phone: text(),
    email: text(),
    brokerUrl: text(),
    website: text(),
    sourceNote: text(),
    sourceUrl: text(),
    offerEnds: date({ mode: "string" }),
    verified: boolean().notNull().default(false),
    verifiedAt: timestamp({ withTimezone: true }),
    verifiedByName: text(),
    verifiedByEmail: text(),
    verifiedHow: text(),
    flagNote: text(),
    flaggedByName: text(),
    flaggedAt: timestamp({ withTimezone: true }),
    hidden: boolean().notNull().default(false),
    addedByUserId: text().references(() => users.id, { onDelete: "set null" }),
    addedByEmail: text().notNull(),
    addedByName: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  t => [index("commission_buildings_key_idx").on(t.addressKey)],
).enableRLS();

export type CommissionBuildingRow = typeof commissionBuildings.$inferSelect;
export type NewCommissionBuildingRow = typeof commissionBuildings.$inferInsert;
