// Vendor directory (was convex/schema.ts: vendors, vendorReviews). Agents add and rate vendors;
// admins mark Preferred, hide, and choose which appear on the public website list.
import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "../users/user.model.js";

const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const vendors = pgTable(
  "vendors",
  {
    id: text().primaryKey(),
    name: text().notNull(), // contact name
    company: text(),
    category: text().notNull(),
    subcategory: text(),
    description: text(),
    phone: text(),
    email: text(),
    website: text(),
    address: text(),
    areas: text(),
    languages: text(),
    perk: text(), // team discount; never shown publicly
    preferred: boolean().notNull().default(false),
    hidden: boolean().notNull().default(false),
    private: boolean().notNull().default(false), // only the person who added it (and admins) can see it
    onWebsite: boolean().notNull().default(true), // public "Trusted Local Pros" list (unless private/hidden)
    addedByUserId: text().references(() => users.id, { onDelete: "set null" }),
    addedByEmail: text().notNull(),
    addedByName: text().notNull(),
    source: text().notNull().default("agent"), // agent | seed
    ...timestamps,
  },
  t => [index("vendors_category_idx").on(t.category), index("vendors_added_by_idx").on(t.addedByEmail)],
).enableRLS();

/** One rating (1-5) + optional note per person per vendor. */
export const vendorReviews = pgTable(
  "vendor_reviews",
  {
    id: text().primaryKey(),
    vendorId: text()
      .notNull()
      .references(() => vendors.id, { onDelete: "cascade" }),
    userEmail: text().notNull(),
    userName: text().notNull(),
    rating: integer().notNull(),
    note: text(),
    ...timestamps,
  },
  t => [uniqueIndex("vendor_reviews_vendor_user_idx").on(t.vendorId, t.userEmail)],
).enableRLS();

export type VendorRow = typeof vendors.$inferSelect;
export type NewVendorRow = typeof vendors.$inferInsert;
export type VendorReviewRow = typeof vendorReviews.$inferSelect;
