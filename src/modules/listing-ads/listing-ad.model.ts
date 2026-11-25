// Ad campaigns per listing (was convex/schema.ts listingAds): one row per channel. Meta/Google/Lofty
// numbers are typed in by the agent until the ads accounts are connected; "website" = Google Analytics.
import { doublePrecision, index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { listings } from "../listings/listing.model.js";

export const listingAds = pgTable(
  "listing_ads",
  {
    id: text().primaryKey(),
    listingId: text()
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    channel: text().notNull(), // meta | google | lofty | website
    status: text().notNull().default("not_started"), // not_started | scheduled | running | paused | ended
    startDate: text(), // YYYY-MM-DD
    endDate: text(),
    reach: doublePrecision(), // people reached / impressions / website visitors
    views: doublePrecision(), // website page views
    clicks: doublePrecision(),
    leads: doublePrecision(),
    spend: doublePrecision(), // agent-only, never sent to sellers
    budget: doublePrecision(), // agent-only
    campaignRef: text(),
    adLink: text(),
    note: text(),
    pages: text(), // website: JSON [{host,path,views}]
    campaigns: text(), // meta/google auto: JSON [{id,name,status}]
    source: text().notNull().default("manual"), // manual | ga | meta | google_ads
    error: text(),
    requestedAt: timestamp({ withTimezone: true }),
    updatedByEmail: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  t => [uniqueIndex("listing_ads_listing_channel_idx").on(t.listingId, t.channel), index("listing_ads_listing_idx").on(t.listingId)],
).enableRLS();

export type ListingAdRow = typeof listingAds.$inferSelect;
