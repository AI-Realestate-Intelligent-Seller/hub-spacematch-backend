// All database queries for announcements and push subscriptions. Only announcement.service.ts calls this file.
import { desc, eq, inArray } from "drizzle-orm";
import { getOrm } from "../../db/client.js";
import { newId } from "../../utils/id.js";
import { type AnnouncementRow, announcements, pushSubscriptions } from "./announcement.model.js";

export async function listRecent(limit = 60): Promise<AnnouncementRow[]> {
  return getOrm().select().from(announcements).orderBy(desc(announcements.createdAt)).limit(limit);
}

export async function findAnnouncement(id: string): Promise<AnnouncementRow | undefined> {
  const [row] = await getOrm().select().from(announcements).where(eq(announcements.id, id)).limit(1);
  return row;
}

export async function insertAnnouncement(values: Omit<typeof announcements.$inferInsert, "id">): Promise<AnnouncementRow> {
  const [row] = await getOrm()
    .insert(announcements)
    .values({ id: newId(), ...values })
    .returning();
  return row!;
}

export async function setPinned(id: string, pinned: boolean): Promise<AnnouncementRow | undefined> {
  const [row] = await getOrm().update(announcements).set({ pinned, updatedAt: new Date() }).where(eq(announcements.id, id)).returning();
  return row;
}

export async function deleteAnnouncement(id: string): Promise<void> {
  await getOrm().delete(announcements).where(eq(announcements.id, id));
}

export async function upsertSubscription(v: { userEmail: string; endpoint: string; p256dh: string; auth: string }): Promise<void> {
  await getOrm()
    .insert(pushSubscriptions)
    .values({ id: newId(), ...v })
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { userEmail: v.userEmail, p256dh: v.p256dh, auth: v.auth, updatedAt: new Date() } });
}

export async function deleteSubscription(endpoint: string): Promise<void> {
  await getOrm().delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
}

/** Devices that turned notifications on: everyone's, or one person's (by email, lower-case). */
export async function listSubscriptions(userEmail?: string) {
  const q = getOrm().select({ endpoint: pushSubscriptions.endpoint, p256dh: pushSubscriptions.p256dh, auth: pushSubscriptions.auth }).from(pushSubscriptions);
  return userEmail ? q.where(eq(pushSubscriptions.userEmail, userEmail)) : q;
}

export async function deleteSubscriptions(endpoints: string[]): Promise<void> {
  if (endpoints.length) await getOrm().delete(pushSubscriptions).where(inArray(pushSubscriptions.endpoint, endpoints));
}
