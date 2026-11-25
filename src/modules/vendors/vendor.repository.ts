// All database queries for vendors and their reviews. Only vendor.service.ts calls this file.
import { and, eq } from "drizzle-orm";
import { getOrm } from "../../db/client.js";
import { newId } from "../../utils/id.js";
import { type NewVendorRow, type VendorReviewRow, type VendorRow, vendorReviews, vendors } from "./vendor.model.js";

export async function listVendors(): Promise<VendorRow[]> {
  return getOrm().select().from(vendors);
}

export async function listReviews(): Promise<VendorReviewRow[]> {
  return getOrm().select().from(vendorReviews);
}

export async function findVendor(id: string): Promise<VendorRow | undefined> {
  const [row] = await getOrm().select().from(vendors).where(eq(vendors.id, id)).limit(1);
  return row;
}

export async function insertVendor(values: Omit<NewVendorRow, "id">): Promise<VendorRow> {
  const [row] = await getOrm()
    .insert(vendors)
    .values({ id: newId(), ...values })
    .returning();
  return row!;
}

export async function updateVendor(id: string, patch: Partial<Omit<NewVendorRow, "id" | "createdAt">>): Promise<VendorRow | undefined> {
  const [row] = await getOrm()
    .update(vendors)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(vendors.id, id))
    .returning();
  return row;
}

/** Reviews go with it (ON DELETE CASCADE). */
export async function deleteVendor(id: string): Promise<void> {
  await getOrm().delete(vendors).where(eq(vendors.id, id));
}

export async function findReview(vendorId: string, userEmail: string): Promise<VendorReviewRow | undefined> {
  const [row] = await getOrm()
    .select()
    .from(vendorReviews)
    .where(and(eq(vendorReviews.vendorId, vendorId), eq(vendorReviews.userEmail, userEmail)))
    .limit(1);
  return row;
}

export async function upsertReview(v: { vendorId: string; userEmail: string; userName: string; rating: number; note: string | null }): Promise<void> {
  await getOrm()
    .insert(vendorReviews)
    .values({ id: newId(), ...v })
    .onConflictDoUpdate({
      target: [vendorReviews.vendorId, vendorReviews.userEmail],
      set: { rating: v.rating, note: v.note, userName: v.userName, updatedAt: new Date() },
    });
}
