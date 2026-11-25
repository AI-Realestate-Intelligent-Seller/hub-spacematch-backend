// All database queries for ad orders. Only ad-order.service.ts calls this file.
import { desc, eq } from "drizzle-orm";
import { getOrm } from "../../db/client.js";
import { newId } from "../../utils/id.js";
import { type AdOrderRow, adOrders, type NewAdOrderRow } from "./ad-order.model.js";

export async function listForListing(listingId: string): Promise<AdOrderRow[]> {
  return getOrm().select().from(adOrders).where(eq(adOrders.listingId, listingId)).orderBy(desc(adOrders.createdAt));
}

export async function listForAgent(email: string, limit = 200): Promise<AdOrderRow[]> {
  return getOrm().select().from(adOrders).where(eq(adOrders.agentEmail, email)).orderBy(desc(adOrders.createdAt)).limit(limit);
}

export async function listAll(limit = 500): Promise<AdOrderRow[]> {
  return getOrm().select().from(adOrders).orderBy(desc(adOrders.createdAt)).limit(limit);
}

export async function countRequested(): Promise<number> {
  return (await getOrm().select({ id: adOrders.id }).from(adOrders).where(eq(adOrders.status, "requested"))).length;
}

export async function findOrder(id: string): Promise<AdOrderRow | undefined> {
  const [row] = await getOrm().select().from(adOrders).where(eq(adOrders.id, id)).limit(1);
  return row;
}

export async function insertOrder(values: Omit<NewAdOrderRow, "id">): Promise<AdOrderRow> {
  const [row] = await getOrm()
    .insert(adOrders)
    .values({ id: newId(), ...values })
    .returning();
  return row!;
}

export async function updateOrder(id: string, patch: Partial<Omit<NewAdOrderRow, "id" | "createdAt">>): Promise<AdOrderRow> {
  const [row] = await getOrm()
    .update(adOrders)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(adOrders.id, id))
    .returning();
  return row!;
}
