// Feedback board rules (was convex/feedback.ts). Everyone sees the team's ideas (so they "Me too"
// instead of re-posting); admins decide. The weekly AI triage Viktor did is manual for now.
import { deleteObject, putObject, signedDownloadUrl } from "../../integrations/storage/storage.client.js";
import { autoCategory } from "../../shared/feedback-defs.js";
import type { AuthUser } from "../../types/auth.js";
import { badRequest, forbidden, notFound } from "../../utils/http-error.js";
import { logger } from "../../utils/logger.js";
import { listStaffEmails } from "../users/user.service.js";
import { mailAgent, mailBlocking } from "./feedback.mail.js";
import * as repo from "./feedback.repository.js";
import { type CreateFeedbackInput, MAX_SHOT_BYTES, SHOT_TYPES } from "./feedback.validation.js";

const NOTIFY_ON = ["approved", "shipped", "later", "declined"];
const isAdmin = (u: AuthUser) => u.role === "admin";
const shotPrefix = (u: AuthUser) => `feedback/${u.id}/`;
const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };

/** Saves a screenshot and returns its key; the key is then sent with the idea. */
export async function uploadShot(actor: AuthUser, body: Buffer, contentType: string) {
  if (!(SHOT_TYPES as readonly string[]).includes(contentType)) throw badRequest("Screenshots must be PNG, JPG, WebP or GIF images.");
  if (!body.length) throw badRequest("The screenshot is empty.");
  if (body.length > MAX_SHOT_BYTES) throw badRequest("The screenshot is too big (4 MB max).");
  const key = `${shotPrefix(actor)}${repo.newShotId()}.${EXT[contentType]}`;
  await putObject(key, body, contentType);
  return { key };
}

export async function listFeedback(actor: AuthUser) {
  const [rows, votes] = await Promise.all([repo.listFeedback(), repo.listVotes()]);
  const items = await Promise.all(
    rows.map(async r => {
      const v = votes.filter(x => x.feedbackId === r.id);
      return {
        ...r,
        votes: v.length,
        voted: v.some(x => x.userId === actor.id),
        mine: r.fromUserId === actor.id,
        shotUrl: r.shotKey ? await signedDownloadUrl(r.shotKey).catch(() => null) : null,
      };
    }),
  );
  return { items, isAdmin: isAdmin(actor), myId: actor.id };
}

export async function createFeedback(actor: AuthUser, a: CreateFeedbackInput) {
  // A screenshot key must be one this person uploaded.
  if (a.shotKey && !a.shotKey.startsWith(shotPrefix(actor))) throw badRequest("That screenshot couldn't be attached. Add it again.");
  const r = await repo.insertFeedback({
    fromUserId: actor.id,
    fromEmail: actor.email.toLowerCase(),
    fromName: actor.name || actor.email,
    kind: a.kind,
    area: a.area,
    title: a.title,
    details: a.details,
    blocking: a.kind === "fix" ? !!a.blocking : null,
    shotKey: a.shotKey ?? null,
    category: autoCategory(a.kind, a.area, `${a.title} ${a.details}`),
    categorySource: "auto",
    status: "new",
  });
  await repo.addVote(r.id, actor.id); // the author counts as the first "Me too"
  if (a.kind === "fix" && a.blocking) await mailBlocking(r, await listStaffEmails());
  return r;
}

export async function toggleVote(actor: AuthUser, id: string) {
  const r = await repo.findFeedback(id);
  if (!r) throw notFound("Idea not found.");
  const has = await repo.hasVote(id, actor.id);
  if (has) await repo.removeVote(id, actor.id);
  else await repo.addVote(id, actor.id);
  return { voted: !has };
}

export async function decide(actor: AuthUser, id: string, status: string, note?: string | null, category?: string) {
  if (!isAdmin(actor)) throw forbidden("Only admins can approve.");
  const r = await repo.findFeedback(id);
  if (!r) throw notFound("Idea not found.");
  const now = new Date();
  const updated = (await repo.updateFeedback(id, {
    status,
    decisionNote: note || r.decisionNote,
    decidedBy: actor.name || actor.email,
    decidedAt: now,
    shippedAt: status === "shipped" ? now : r.shippedAt,
    ...(category ? { category, categorySource: "admin" } : {}),
  }))!;
  if (NOTIFY_ON.includes(status) && status !== r.status) await mailAgent(updated);
  return updated;
}

export async function removeFeedback(actor: AuthUser, id: string) {
  const r = await repo.findFeedback(id);
  if (!r) return { ok: true };
  if (!isAdmin(actor) && !(r.fromUserId === actor.id && r.status === "new")) throw forbidden("You can only delete your own new ideas.");
  await repo.deleteFeedback(id);
  if (r.shotKey) await deleteObject(r.shotKey).catch(e => logger.warn("feedback: screenshot not deleted", { key: r.shotKey, error: String(e) }));
  return { ok: true };
}
