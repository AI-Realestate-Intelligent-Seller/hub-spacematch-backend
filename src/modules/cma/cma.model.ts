// CMA requests: sale (residential / commercial, optional investor add-on) and lease analyses
// (was convex/schema.ts cmaRequests). Agents submit; the CMA builder picks them up and attaches
// the PDF + workbook. Flexible parts (commercial, investor, lease, upgrades) are jsonb.
import { boolean, doublePrecision, index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "../users/user.model.js";

export type CmaAttachment = { storageId: string; name: string; size: number; contentType?: string };
export type CmaUpgrade = { item: string; year?: string; notes?: string };
export type CmaRevision = {
  at: number;
  byEmail: string;
  type: "details" | "list_price";
  changed: string[];
  diff?: { field: string; from: string; to: string }[];
  listPrice?: number;
  note?: string;
};

export const cmaRequests = pgTable(
  "cma_requests",
  {
    id: text().primaryKey(),
    reportType: text().notNull().default("sale"), // sale | lease
    kind: text().notNull().default("residential"), // residential | commercial
    lease: jsonb().$type<Record<string, string>>(),
    investor: jsonb().$type<Record<string, string>>(),
    commercial: jsonb().$type<Record<string, string>>(),
    attachments: jsonb().$type<CmaAttachment[]>().notNull().default([]),
    agentName: text().notNull(),
    agentEmail: text().notNull(),
    agentPhone: text(),
    clientName: text().notNull(),
    clientEmail: text(),
    clientPhone: text(),
    street: text().notNull(),
    unit: text(),
    city: text().notNull(),
    state: text().notNull(),
    zip: text().notNull(),
    propertyType: text().notNull(),
    beds: text(),
    bathsFull: text(),
    bathsHalf: text(),
    sqft: text(),
    yearBuilt: text(),
    basement: text(),
    garage: text(),
    hoaDues: text(),
    condition: text().notNull(),
    upgrades: jsonb().$type<CmaUpgrade[]>().notNull().default([]),
    otherUpgrades: text(),
    knownIssues: text(),
    sellerPriceExpectation: text(),
    timeline: text(),
    purpose: text().notNull(),
    neededBy: text(),
    branding: text().notNull(),
    schools: text(),
    compNotes: text(),
    notes: text(),
    // ---- status (set by the builder) ----
    userId: text().references(() => users.id, { onDelete: "set null" }),
    submittedByEmail: text().notNull(),
    status: text().notNull().default("submitted"), // submitted | building | needs_info | approval | ready | revision | failed
    statusNote: text(),
    valueLow: doublePrecision(),
    valueHigh: doublePrecision(),
    listPrice: doublePrecision(),
    recommendedListPrice: doublePrecision(),
    agentListPrice: doublePrecision(),
    agentListPriceNote: text(),
    revisionPending: boolean().notNull().default(false),
    revisions: jsonb().$type<CmaRevision[]>().notNull().default([]),
    pdfKey: text(),
    workbookKey: text(),
    pickedUpAt: timestamp({ withTimezone: true }),
    completedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  t => [index("cma_requests_user_idx").on(t.userId, t.createdAt), index("cma_requests_status_idx").on(t.status), index("cma_requests_created_idx").on(t.createdAt)],
).enableRLS();

export type CmaRequestRow = typeof cmaRequests.$inferSelect;
export type NewCmaRequestRow = typeof cmaRequests.$inferInsert;
