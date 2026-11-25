// Background work queue (replaces Convex's ctx.scheduler.runAfter). Modules enqueue a job;
// the runner in src/jobs/ (Vercel Cron) picks it up. Until a job kind has a handler, its rows
// simply wait here, so nothing that should happen is lost.
import { index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const jobs = pgTable(
  "jobs",
  {
    id: text().primaryKey(),
    kind: text().notNull(), // e.g. "lofty.syncListingSeller", "zillow.rollupListing"
    payload: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    status: text().notNull().default("queued"), // queued | running | done | failed
    runAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    attempts: integer().notNull().default(0),
    lastError: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  t => [index("jobs_status_run_at_idx").on(t.status, t.runAt), index("jobs_kind_idx").on(t.kind)],
).enableRLS();

export type JobRow = typeof jobs.$inferSelect;
