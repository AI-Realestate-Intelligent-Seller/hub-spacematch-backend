// Announcements rules (was convex/announcements.ts). Admins and ops post and pin; the author or an
// admin can delete. Other modules post through postAnnouncement() (e.g. automatic team news later).
import type { AuthUser } from "../../types/auth.js";
import { forbidden, notFound } from "../../utils/http-error.js";
import { enqueue } from "../jobs/job.service.js";
import * as repo from "./announcement.repository.js";
import type { PostInput } from "./announcement.validation.js";

const canPost = (u: AuthUser) => u.role === "admin" || u.role === "ops";

export async function listAnnouncements(actor: AuthUser) {
  const rows = await repo.listRecent();
  rows.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt.getTime() - a.createdAt.getTime());
  // vapidKey: the Web Push public key. Push sending isn't on the new backend yet, so it is null and
  // the page says notifications aren't set up yet.
  return { canPost: canPost(actor), vapidKey: null as string | null, rows };
}

/** Posts an announcement. Also used by other modules (pass the author they post as). */
export async function postAnnouncement(author: { email: string; name: string }, a: PostInput) {
  const row = await repo.insertAnnouncement({
    title: a.title ?? null,
    body: a.body,
    link: a.link ?? null,
    pinned: a.pinned,
    authorEmail: author.email.toLowerCase(),
    authorName: author.name,
  });
  // Phone notifications move later; the job waits until then.
  if (a.notify) await enqueue("push.announce", { announcementId: row.id });
  return row;
}

export async function post(actor: AuthUser, a: PostInput) {
  if (!canPost(actor)) throw forbidden("Only team leaders and ops can post announcements.");
  return postAnnouncement({ email: actor.email, name: actor.name || actor.email }, a);
}

export async function setPinned(actor: AuthUser, id: string, pinned: boolean) {
  if (!canPost(actor)) throw forbidden("Only team leaders and ops can pin announcements.");
  const row = await repo.setPinned(id, pinned);
  if (!row) throw notFound("Announcement not found.");
  return row;
}

export async function remove(actor: AuthUser, id: string) {
  const row = await repo.findAnnouncement(id);
  if (!row) return { ok: true };
  if (actor.role !== "admin" && row.authorEmail !== actor.email.toLowerCase()) throw forbidden("Only the author or an admin can delete this.");
  await repo.deleteAnnouncement(id);
  return { ok: true };
}

export async function subscribe(actor: AuthUser, s: { endpoint: string; p256dh: string; auth: string }) {
  await repo.upsertSubscription({ ...s, userEmail: actor.email.toLowerCase() });
  return { ok: true };
}

export async function unsubscribe(endpoint: string) {
  await repo.deleteSubscription(endpoint);
  return { ok: true };
}
