// "Market myself" (was convex/schema.ts agentMarketing, reviewRequests, marketStats):
// per-agent settings, Google review requests (clients open /r/:token) and monthly area numbers.
import { index, integer, pgTable, real, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/** One row per agent: their own Google review link and the areas they market. */
export const agentMarketing = pgTable("agent_marketing", {
  email: text().primaryKey(), // lower-case
  reviewUrl: text(),
  areas: text().array().notNull().default([]),
  ...timestamps,
}).enableRLS();

export const reviewRequests = pgTable(
  "review_requests",
  {
    id: text().primaryKey(),
    token: text().notNull(), // the client's link /r/:token
    agentEmail: text().notNull(),
    agentName: text().notNull(),
    clientName: text().notNull(),
    channel: text().notNull(), // text | email | copy
    target: text().notNull(), // agent | team (which Google page the button opens)
    opens: integer().notNull().default(0),
    firstOpenedAt: timestamp({ withTimezone: true }),
    clickedAt: timestamp({ withTimezone: true }),
    note: text(), // optional private note from the client
    noteAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  t => [uniqueIndex("review_requests_token_idx").on(t.token), index("review_requests_agent_idx").on(t.agentEmail, t.createdAt)],
).enableRLS();

/** Monthly numbers per area: from the MLS pull ("mred") or typed by an agent ("agent"). */
export const marketStats = pgTable(
  "market_stats",
  {
    id: text().primaryKey(),
    area: text().notNull(),
    month: text().notNull(), // YYYY-MM
    sales: integer(),
    median: integer(), // dollars
    yoyPct: real(),
    domMedian: integer(),
    soldToList: real(),
    active: integer(),
    monthsSupply: real(),
    source: text().notNull(), // mred | agent
    enteredBy: text(), // agent email when source = agent
    pulledAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  t => [index("market_stats_area_month_idx").on(t.area, t.month)],
).enableRLS();

export type AgentMarketingRow = typeof agentMarketing.$inferSelect;
export type ReviewRequestRow = typeof reviewRequests.$inferSelect;
export type MarketStatRow = typeof marketStats.$inferSelect;
