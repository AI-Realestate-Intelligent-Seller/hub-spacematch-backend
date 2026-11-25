// Seller Launch Portal tables (were convex/schema.ts: listings, listingEvents, listingMetrics,
// listingSuggestions, showingInbox). Agents manage listings in the Hub; sellers open /s/:token.
import { bigint, boolean, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "../users/user.model.js";

const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export type LaunchStepState = { key: string; done: boolean; doneAt?: string; note?: string };
export type ListingLinks = {
  zillow?: string;
  website?: string;
  reel?: string;
  tour?: string;
  youtube?: string;
  tiktok?: string;
  facebook?: string;
};
/** Totals read off the listing's public Zillow page (filled by the Zillow integration later). */
export type ZillowPage = { url: string; views: number; saves: number; checkedAt: string; price?: number; homeStatus?: string };
export type ReelAuto = { mediaId: string; permalink: string; views: number; matchedBy: string; checkedAt: string };
export type YoutubeAuto = { videoId: string; url: string; title: string; views: number; matchedBy: string; checkedAt: string };

export const listings = pgTable(
  "listings",
  {
    id: text().primaryKey(),
    address: text().notNull(),
    addressKey: text().notNull(), // normalised street, for matching ShowingTime emails / open-house sign-ins
    mlsNumber: text(),
    priceCents: bigint({ mode: "number" }), // list price in cents
    status: text().notNull().default("Preparing"),
    photoUrl: text(),
    agentUserId: text().references(() => users.id, { onDelete: "set null" }),
    agentEmail: text().notNull(), // lower-case; the agent identity across the app
    agentName: text().notNull(),
    sellerName: text().notNull(),
    sellerEmail: text(),
    sellerPhone: text(),
    token: text().notNull(), // seller portal link /s/:token
    steps: jsonb().$type<LaunchStepState[]>().notNull(),
    links: jsonb().$type<ListingLinks>().notNull().default({}),
    liveDate: date({ mode: "string" }), // YYYY-MM-DD, for days on market
    zillowPage: jsonb().$type<ZillowPage>(),
    loftyLeadId: text(),
    loftyError: text(),
    loftyAt: timestamp({ withTimezone: true }),
    reelAuto: jsonb().$type<ReelAuto>(),
    ytAuto: jsonb().$type<YoutubeAuto>(),
    weeklyEmail: boolean().notNull().default(false),
    sellerLastSeenAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  t => [
    uniqueIndex("listings_token_idx").on(t.token),
    index("listings_agent_email_idx").on(t.agentEmail),
    index("listings_mls_idx").on(t.mlsNumber),
    index("listings_address_key_idx").on(t.addressKey),
  ],
).enableRLS();

/** Activity feed: showings, feedback (agent approves first), offers, updates, price changes. */
export const listingEvents = pgTable(
  "listing_events",
  {
    id: text().primaryKey(),
    listingId: text()
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    kind: text().notNull(), // showing | cancelled | feedback | offer | update | price | approval
    status: text().notNull(), // pending | published | hidden
    title: text().notNull(),
    body: text(),
    interest: text(),
    priceOpinion: text(),
    rating: text(),
    when: text(),
    agentOnly: text(), // e.g. buyer's agent; never sent to sellers
    source: text().notNull(), // agent | showingtime | seller
    externalId: text(),
    ...timestamps,
  },
  t => [
    index("listing_events_listing_idx").on(t.listingId, t.createdAt),
    index("listing_events_external_idx").on(t.externalId),
    index("listing_events_status_idx").on(t.status),
  ],
).enableRLS();

/** Weekly numbers the agent enters (Zillow + MLS have no feed). One row per listing per week. */
export const listingMetrics = pgTable(
  "listing_metrics",
  {
    id: text().primaryKey(),
    listingId: text()
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    weekOf: date({ mode: "string" }).notNull(), // Monday, YYYY-MM-DD
    zillowViews: integer(),
    zillowSaves: integer(),
    mlsSaved: integer(),
    mlsMaybe: integer(),
    mlsNotInterested: integer(),
    adViews: integer(),
    adClicks: integer(),
    reelViews: integer(),
    tiktokViews: integer(),
    fbViews: integer(),
    youtubeViews: integer(),
    auto: text().array().notNull().default([]), // fields filled by code: "zillow" | "reel" | "youtube"
    zillowDays: integer(),
    enteredByEmail: text().notNull(), // "auto" when only code has written the row
    ...timestamps,
  },
  t => [uniqueIndex("listing_metrics_listing_week_idx").on(t.listingId, t.weekOf)],
).enableRLS();

/** "What we'd do next": rule-based suggestions. Agent publishes; seller sees and approves. */
export const listingSuggestions = pgTable(
  "listing_suggestions",
  {
    id: text().primaryKey(),
    listingId: text()
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    ruleKey: text().notNull(), // rule id, or "custom"
    title: text().notNull(),
    why: text().notNull(),
    action: text().notNull(),
    status: text().notNull(), // draft | published | dismissed
    approvedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  t => [index("listing_suggestions_listing_idx").on(t.listingId, t.createdAt)],
).enableRLS();

/** ShowingTime emails that matched no listing (shown to admins/ops to file by hand). */
export const showingInbox = pgTable(
  "showing_inbox",
  {
    id: text().primaryKey(),
    externalId: text().notNull(),
    subject: text().notNull(),
    address: text().notNull(),
    mls: text(),
    parsed: jsonb().notNull(), // ParsedShowing
    ...timestamps,
  },
  t => [uniqueIndex("showing_inbox_external_idx").on(t.externalId)],
).enableRLS();

export type ListingRow = typeof listings.$inferSelect;
export type NewListingRow = typeof listings.$inferInsert;
export type ListingEventRow = typeof listingEvents.$inferSelect;
export type ListingMetricRow = typeof listingMetrics.$inferSelect;
export type ListingSuggestionRow = typeof listingSuggestions.$inferSelect;
export type ShowingInboxRow = typeof showingInbox.$inferSelect;
