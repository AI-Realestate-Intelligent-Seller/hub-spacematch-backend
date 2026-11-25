// Ad Kit orders (was convex/schema.ts adOrders): an agent orders a listing ad package, admins approve,
// a ledger tracks what each agent owes. Kept when a listing is deleted (it's a money record).
import { boolean, index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import type { AdKit } from "../../shared/ad-kit.js";
import { listings } from "../listings/listing.model.js";

export const adOrders = pgTable(
  "ad_orders",
  {
    id: text().primaryKey(),
    listingId: text().references(() => listings.id, { onDelete: "set null" }),
    address: text().notNull(),
    agentEmail: text().notNull(),
    agentName: text().notNull(),
    tier: text().notNull(), // essential | signature | luxury
    openHouse: boolean().notNull().default(false),
    payment: text().notNull(), // ahead | closing
    spend: integer().notNull(), // dollars
    fee: integer().notNull(), // SpaceMatch fee (incl. open-house fee)
    surcharge: integer().notNull(), // pay-at-closing surcharge
    total: integer().notNull(),
    status: text().notNull().default("requested"), // requested | approved | live | done | declined | cancelled
    paymentStatus: text().notNull().default("unpaid"), // unpaid | paid | deducted | rolled
    paymentNote: text(),
    authorizedAt: timestamp({ withTimezone: true }).notNull(),
    orderedByEmail: text().notNull(),
    note: text(),
    adminNote: text(),
    decidedByEmail: text(),
    decidedAt: timestamp({ withTimezone: true }),
    liveAt: timestamp({ withTimezone: true }),
    settledAt: timestamp({ withTimezone: true }),
    kit: jsonb().$type<AdKit>(),
    metaCampaignId: text(),
    draftError: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  t => [index("ad_orders_listing_idx").on(t.listingId), index("ad_orders_agent_idx").on(t.agentEmail), index("ad_orders_status_idx").on(t.status)],
).enableRLS();

export type AdOrderRow = typeof adOrders.$inferSelect;
export type NewAdOrderRow = typeof adOrders.$inferInsert;
