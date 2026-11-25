// Social video views per listing, read through the SpaceMatch Reels service.
// listing_social: the listing's property in the Reels service. listing_reel_stats: one row per link.
import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { listings } from "../listings/listing.model.js";

export const listingSocial = pgTable("listing_social", {
  listingId: text()
    .primaryKey()
    .references(() => listings.id, { onDelete: "cascade" }),
  reelsPropertyId: text(), // prop_… in the Reels service
  lastSyncedAt: timestamp({ withTimezone: true }),
  lastRefreshStatus: text(), // done | partial | failed | running
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}).enableRLS();

export const listingReelStats = pgTable(
  "listing_reel_stats",
  {
    id: text().primaryKey(),
    listingId: text()
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    linkId: text().notNull(),
    platform: text().notNull(), // instagram | youtube | tiktok | facebook
    url: text().notNull(),
    embedUrl: text(),
    views: integer(), // null = the platform doesn't show it (never 0)
    likes: integer(),
    comments: integer(),
    shares: integer(),
    okAt: timestamp({ withTimezone: true }),
    checkedAt: timestamp({ withTimezone: true }),
    errorCode: text(),
    errorMessage: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  t => [index("listing_reel_stats_listing_idx").on(t.listingId)],
).enableRLS();

export type ListingSocialRow = typeof listingSocial.$inferSelect;
export type ListingReelStatRow = typeof listingReelStats.$inferSelect;
