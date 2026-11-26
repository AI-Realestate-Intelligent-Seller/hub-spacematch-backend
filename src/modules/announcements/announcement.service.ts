// Announcements rules (was convex/announcements.ts). Admins and ops post and pin; the author or an
// admin can delete. Other modules post through postAnnouncement() (e.g. automatic team news later).
import { config } from "../../config/index.js";
import { type PushMessage, sendPush } from "../../integrations/push/push.client.js";
import type { AuthUser } from "../../types/auth.js";
import { logger } from "../../utils/logger.js";
import { forbidden, notFound } from "../../utils/http-error.js";
import { enqueue } from "../jobs/job.service.js";
import * as repo from "./announcement.repository.js";
import type { PostInput } from "./announcement.validation.js";

const canPost = (u: AuthUser) => u.role === "admin" || u.role === "ops";

export async function listAnnouncements(actor: AuthUser) {
  const rows = await repo.listRecent();
  rows.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt.getTime() - a.createdAt.getTime());
  // vapidKey: the Web Push public key (null until VAPID keys are set; the page then says
  // notifications aren't set up yet).
  return { canPost: canPost(actor), vapidKey: config.push.publicKey ?? null, rows };
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

// ---------- Web Push (jobs "push.announce" and "push.toEmail") ----------

async function deliver(targets: Awaited<ReturnType<typeof repo.listSubscriptions>>, msg: PushMessage, ttl: number) {
  if (!targets.length) return { sent: 0, total: 0 };
  const r = await sendPush(targets, msg, ttl);
  if (!r.configured) {
    logger.info("Push skipped: VAPID keys are not set");
    return { sent: 0, total: targets.length };
  }
  await repo.deleteSubscriptions(r.gone);
  return { sent: r.sent, total: targets.length };
}

/** A new announcement to every device that turned notifications on. */
export async function pushAnnouncement(announcementId: string) {
  const row = await repo.findAnnouncement(announcementId);
  if (!row) return { sent: 0, total: 0 };
  return deliver(await repo.listSubscriptions(), { title: row.title || `SpaceMatch · ${row.authorName}`, body: row.body, url: "/announcements" }, 86_400);
}

/** One person's devices (open-house host found, a client's note or review click, …). */
export async function pushToEmail(email: string, msg: PushMessage) {
  return deliver(await repo.listSubscriptions(email.toLowerCase()), msg, 3600);
}
