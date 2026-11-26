import { and, count, desc, eq } from "drizzle-orm";
import { getOrm } from "../../db/client.js";
import { formSubmissions } from "./form.model.js";

function signins(listingId: string) {
  return and(eq(formSubmissions.listingId, listingId), eq(formSubmissions.formId, "open-house-signin"));
}

export function listSignins(listingId: string) {
  return getOrm().select({
    id: formSubmissions.id,
    name: formSubmissions.contactName,
    at: formSubmissions.createdAt,
    status: formSubmissions.status,
  }).from(formSubmissions).where(signins(listingId)).orderBy(desc(formSubmissions.createdAt));
}

export async function countSignins(listingId: string) {
  const [row] = await getOrm().select({ total: count() }).from(formSubmissions).where(signins(listingId));
  return row?.total ?? 0;
}
