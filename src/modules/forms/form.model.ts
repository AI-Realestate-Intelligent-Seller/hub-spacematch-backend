import { boolean, index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { listings } from "../listings/listing.model.js";

export const formSubmissions = pgTable("form_submissions", {
  id: text().primaryKey(),
  formId: text().notNull(),
  listingId: text().references(() => listings.id, { onDelete: "set null" }),
  agentEmail: text(),
  agentName: text(),
  audience: text().$type<"client" | "team" | "agent">().notNull(),
  contactName: text().notNull(),
  contactEmail: text(),
  contactPhone: text(),
  propertyAddress: text(),
  answers: jsonb().$type<Record<string, string>>().notNull(),
  isLead: boolean().notNull().default(false),
  status: text().$type<"new" | "contacted" | "done">().notNull().default("new"),
  notes: text(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, t => [
  index("form_submissions_listing_form_idx").on(t.listingId, t.formId, t.createdAt),
  index("form_submissions_agent_created_idx").on(t.agentEmail, t.createdAt),
]).enableRLS();

export type FormSubmission = typeof formSubmissions.$inferSelect;
