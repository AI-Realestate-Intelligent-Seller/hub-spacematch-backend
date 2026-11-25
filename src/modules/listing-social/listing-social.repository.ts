// All database queries for listing social stats. Only listing-social.service.ts calls this file.
import { eq } from "drizzle-orm";
import { getOrm } from "../../db/client.js";
import { newId } from "../../utils/id.js";
import { type ListingReelStatRow, type ListingSocialRow, listingReelStats, listingSocial } from "./listing-social.model.js";

export async function findSocial(listingId: string): Promise<ListingSocialRow | undefined> {
  const [row] = await getOrm().select().from(listingSocial).where(eq(listingSocial.listingId, listingId)).limit(1);
  return row;
}

export async function upsertSocial(listingId: string, patch: Partial<Omit<typeof listingSocial.$inferInsert, "listingId" | "createdAt">>): Promise<void> {
  await getOrm()
    .insert(listingSocial)
    .values({ listingId, ...patch })
    .onConflictDoUpdate({ target: listingSocial.listingId, set: { ...patch, updatedAt: new Date() } });
}

export async function listStats(listingId: string): Promise<ListingReelStatRow[]> {
  return getOrm().select().from(listingReelStats).where(eq(listingReelStats.listingId, listingId));
}

/** Replaces all stats rows for a listing (one per current link). */
export async function replaceStats(listingId: string, rows: Omit<typeof listingReelStats.$inferInsert, "id" | "listingId" | "createdAt">[]): Promise<void> {
  await getOrm().transaction(async tx => {
    await tx.delete(listingReelStats).where(eq(listingReelStats.listingId, listingId));
    if (rows.length) await tx.insert(listingReelStats).values(rows.map(r => ({ id: newId(), listingId, ...r })));
  });
}

export async function findByProperty(reelsPropertyId: string): Promise<ListingSocialRow | undefined> {
  const [row] = await getOrm().select().from(listingSocial).where(eq(listingSocial.reelsPropertyId, reelsPropertyId)).limit(1);
  return row;
}
