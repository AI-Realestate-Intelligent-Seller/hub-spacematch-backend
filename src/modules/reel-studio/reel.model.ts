import { bigint, index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export type Clip = { id: string; name: string; role?: string; keys?: string[]; driveId?: string };
export type Payment = { code: string; amount: number; kind: "order" | "revision"; status: "awaiting" | "sent" | "confirmed"; sentAt?: number; confirmedAt?: number; confirmedBy?: string; note?: string; test?: boolean };
export type Caption = { i: number; start: number; end: number; text: string };
export type Revision = { note: string; at?: number; paid: boolean; kind?: "captions"; edits?: { i: number; text: string }[] };
export type Output = { format: string; key: string; version: number; size?: number };
export type EditSegment = { clip: number; start: number; end: number };

export const reelAssets = pgTable("reel_assets", {
  id: text().primaryKey(),
  owner: text().notNull(),
  name: text().notNull(),
  mimeType: text().notNull(),
  size: bigint({ mode: "number" }).notNull(),
  parts: integer().notNull(),
  ready: integer().notNull().default(0),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, t => [index("reel_assets_owner_idx").on(t.owner)]).enableRLS();

export const reelOrders = pgTable("reel_orders", {
  id: text().primaryKey(),
  owner: text().notNull(),
  agentName: text().notNull(),
  tier: text().notNull(),
  price: integer().notNull(),
  free: integer().notNull(),
  status: text().notNull(),
  options: jsonb().$type<Record<string, unknown>>().notNull(),
  clips: jsonb().$type<Clip[]>().notNull(),
  notes: text(),
  payments: jsonb().$type<Payment[]>().notNull(),
  revisions: jsonb().$type<Revision[]>().notNull(),
  outputs: jsonb().$type<Output[]>().notNull(),
  captionLines: jsonb().$type<Caption[]>().notNull(),
  legacyCostCredits: integer().notNull().default(0),
  deliveryNote: text(),
  timeline: jsonb().$type<EditSegment[]>(),
  version: integer().notNull().default(0),
  generation: integer().notNull().default(0),
  stage: text(),
  statusNote: text(),
  question: text(),
  answer: text(),
  queuedAt: timestamp({ withTimezone: true }),
  pickedUpAt: timestamp({ withTimezone: true }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, t => [index("reel_orders_owner_idx").on(t.owner), index("reel_orders_status_idx").on(t.status)]).enableRLS();
export type ReelOrder = typeof reelOrders.$inferSelect;
