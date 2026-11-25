// All database queries for listing ad campaigns. Only listing-ad.service.ts calls this file.
import { and, eq, inArray } from "drizzle-orm";
import { getOrm } from "../../db/client.js";
import { newId } from "../../utils/id.js";
import { type ListingAdRow, listingAds } from "./listing-ad.model.js";

export async function listForListing(listingId: string): Promise<ListingAdRow[]> {
  return getOrm().select().from(listingAds).where(eq(listingAds.listingId, listingId));
}

export async function listForListings(listingIds: string[]): Promise<Pick<ListingAdRow, "listingId" | "channel" | "status">[]> {
  if (!listingIds.length) return [];
  return getOrm()
    .select({ listingId: listingAds.listingId, channel: listingAds.channel, status: listingAds.status })
    .from(listingAds)
    .where(inArray(listingAds.listingId, listingIds));
}

export async function findAd(listingId: string, channel: string): Promise<ListingAdRow | undefined> {
  const [row] = await getOrm()
    .select()
    .from(listingAds)
    .where(and(eq(listingAds.listingId, listingId), eq(listingAds.channel, channel)))
    .limit(1);
  return row;
}

type Values = Omit<typeof listingAds.$inferInsert, "id" | "listingId" | "channel" | "createdAt">;

export async function upsertAd(listingId: string, channel: string, values: Values): Promise<ListingAdRow> {
  const [row] = await getOrm()
    .insert(listingAds)
    .values({ id: newId(), listingId, channel, ...values })
    .onConflictDoUpdate({ target: [listingAds.listingId, listingAds.channel], set: { ...values, updatedAt: new Date() } })
    .returning();
  return row!;
}
