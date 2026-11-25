// Each agent's own past clients + which touches they've sent (was convex/schema.ts pastClients).
import { date, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "../users/user.model.js";

export const pastClients = pgTable(
  "past_clients",
  {
    id: text().primaryKey(),
    agentUserId: text().references(() => users.id, { onDelete: "cascade" }),
    agentEmail: text().notNull(),
    name: text().notNull(),
    phone: text(),
    email: text(),
    address: text(),
    closedOn: date({ mode: "string" }).notNull(),
    side: text().notNull(), // seller | buyer | renter | landlord
    done: text().array().notNull().default([]), // touch keys done, e.g. "anniv-2027"
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  t => [index("past_clients_agent_idx").on(t.agentEmail)],
).enableRLS();

export type PastClientRow = typeof pastClients.$inferSelect;
export type NewPastClientRow = typeof pastClients.$inferInsert;
