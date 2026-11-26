// CMA Builder tables: listing-based comparative market analyses. Each report row is one version;
// a published version is never edited again (a change makes a new draft version), so the seller
// page and the PDF always show exactly what the agent approved.
// (The older address-based request queue lives in ../cma/cma.model.ts and is unchanged.)
import { sql } from "drizzle-orm";
import { bigint, boolean, date, doublePrecision, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { listings } from "../listings/listing.model.js";
import { users } from "../users/user.model.js";
import type { Adjustment, Analysis, ReportContent, SearchParams, StageEntry, SubjectProperty, ValueOverride } from "./cma-builder.types.js";

const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const cmaReports = pgTable(
  "cma_reports",
  {
    id: text().primaryKey(),
    listingId: text()
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    version: integer().notNull(),
    status: text().notNull().default("queued"), // see REPORT_STATUSES
    trigger: text().notNull().default("request"), // request | refresh | revision
    basedOnReportId: text(),
    provider: text().notNull(),
    params: jsonb().$type<SearchParams>().notNull(),
    subject: jsonb().$type<SubjectProperty>().notNull(),
    analysis: jsonb().$type<Analysis>(),
    override: jsonb().$type<ValueOverride>(),
    content: jsonb().$type<ReportContent>().notNull().default({}),
    stages: jsonb().$type<StageEntry[]>().notNull().default([]),
    progressNote: text(), // agent-facing, e.g. "Collecting comparables (12 found)"
    errorMessage: text(), // agent-facing summary; details live in cma_logs (never shown to sellers)
    collectAttempts: integer().notNull().default(0),
    askingPriceCents: bigint({ mode: "number" }), // the listing price when this version was made
    requestedByUserId: text().references(() => users.id, { onDelete: "set null" }),
    requestedByEmail: text().notNull(),
    requestedByName: text().notNull(),
    reviewedByEmail: text(),
    reviewedByName: text(),
    dataCollectedAt: timestamp({ withTimezone: true }),
    publishedAt: timestamp({ withTimezone: true }),
    publishedByEmail: text(),
    publishedByName: text(),
    pdfKey: text(),
    pdfRenderedAt: timestamp({ withTimezone: true }),
    cancelledAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  t => [
    uniqueIndex("cma_reports_listing_version_idx").on(t.listingId, t.version),
    index("cma_reports_listing_idx").on(t.listingId, t.createdAt),
    index("cma_reports_status_idx").on(t.status),
    // Duplicate guard: one unfinished report per listing at a time.
    uniqueIndex("cma_reports_one_open_idx")
      .on(t.listingId)
      .where(sql`status in ('queued','collecting','normalizing','analyzing','ready_for_review','draft')`),
  ],
).enableRLS();

export const cmaComparables = pgTable(
  "cma_comparables",
  {
    id: text().primaryKey(),
    reportId: text()
      .notNull()
      .references(() => cmaReports.id, { onDelete: "cascade" }),
    source: text().notNull(), // provider id, "manual" or "csv"
    sourceRecordId: text(),
    sourceUrl: text(),
    isFixture: boolean().notNull().default(false),
    manual: boolean().notNull().default(false),
    dedupeKey: text().notNull(),
    status: text().notNull(), // sold | pending | active | off_market
    address: text().notNull(),
    city: text(),
    state: text(),
    zip: text(),
    lat: doublePrecision(),
    lng: doublePrecision(),
    propertyType: text(),
    originalListPrice: doublePrecision(),
    listPrice: doublePrecision(),
    soldPrice: doublePrecision(),
    soldDate: date({ mode: "string" }),
    listDate: date({ mode: "string" }),
    daysOnMarket: integer(),
    beds: doublePrecision(),
    baths: doublePrecision(),
    sqft: integer(),
    lotSqft: integer(),
    yearBuilt: integer(),
    condition: text(),
    garageSpaces: integer(),
    features: jsonb().$type<string[]>().notNull().default([]),
    distanceMi: doublePrecision(),
    imageUrl: text(), // only stored when the source allows redistribution
    selected: boolean().notNull().default(false),
    adjustments: jsonb().$type<Adjustment[]>().notNull().default([]),
    notes: text(),
    collectedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  t => [index("cma_comparables_report_idx").on(t.reportId), uniqueIndex("cma_comparables_report_key_idx").on(t.reportId, t.dedupeKey)],
).enableRLS();

/** Collection steps and errors (kind "collection") and who did what (kind "audit"). Never sent to sellers. */
export const cmaLogs = pgTable(
  "cma_logs",
  {
    id: text().primaryKey(),
    reportId: text().references(() => cmaReports.id, { onDelete: "cascade" }),
    listingId: text().notNull(),
    kind: text().notNull(), // collection | audit
    level: text().notNull().default("info"), // info | warn | error
    stage: text(),
    provider: text(),
    message: text().notNull(),
    actorEmail: text(),
    meta: jsonb().$type<Record<string, unknown>>(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  t => [index("cma_logs_report_idx").on(t.reportId, t.createdAt), index("cma_logs_listing_idx").on(t.listingId, t.createdAt)],
).enableRLS();

/** Market numbers each time a report is analysed: what changed since last time (weekly refresh). */
export const cmaMarketSnapshots = pgTable(
  "cma_market_snapshots",
  {
    id: text().primaryKey(),
    listingId: text()
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    reportId: text().references(() => cmaReports.id, { onDelete: "set null" }),
    estimatedValue: doublePrecision(),
    soldCount: integer().notNull(),
    activeCount: integer().notNull(),
    pendingCount: integer().notNull(),
    medianSoldPrice: doublePrecision(),
    medianPpsf: doublePrecision(),
    avgDom: doublePrecision(),
    soldKeys: jsonb().$type<string[]>().notNull().default([]), // dedupe keys of sold comps (spot new sales)
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  t => [index("cma_market_snapshots_listing_idx").on(t.listingId, t.createdAt)],
).enableRLS();

export type CmaReportRow = typeof cmaReports.$inferSelect;
export type NewCmaReportRow = typeof cmaReports.$inferInsert;
export type CmaComparableRow = typeof cmaComparables.$inferSelect;
export type NewCmaComparableRow = typeof cmaComparables.$inferInsert;
export type CmaLogRow = typeof cmaLogs.$inferSelect;
export type CmaMarketSnapshotRow = typeof cmaMarketSnapshots.$inferSelect;
