// Email templates rules (was convex/emailTemplates.ts). Everyone writes their own; admins/ops
// review suggestions into the team library and set "today's rate" used by the email builders.
import type { AuthUser } from "../../types/auth.js";
import { forbidden, notFound } from "../../utils/http-error.js";
import { getSetting, setSetting } from "../settings/setting.service.js";
import { listStaffEmails } from "../users/user.service.js";
import { mailOwner, mailReviewers } from "./email-template.mail.js";
import * as repo from "./email-template.repository.js";
import type { SaveTemplateInput } from "./email-template.validation.js";

const RATE_KEY = "emails:rate";
const DEFAULT_RATE = { ratePct: 7.24, source: "Freddie Mac 30-year average", asOf: "2026-10-29" };
type Rate = typeof DEFAULT_RATE;

const canReview = (u: AuthUser) => u.role === "admin" || u.role === "ops";
const emailOf = (u: AuthUser) => u.email.toLowerCase();

export async function overview(actor: AuthUser) {
  const [mine, team, review, rate] = await Promise.all([
    repo.listByOwner(emailOf(actor)),
    repo.listByStatus("team"),
    canReview(actor) ? repo.listByStatus("suggested", 100) : Promise.resolve([]),
    getSetting<Rate>(RATE_KEY, DEFAULT_RATE),
  ]);
  return { mine, team, review, canReview: canReview(actor), rate };
}

async function editable(actor: AuthUser, id: string) {
  const row = await repo.findTemplate(id);
  if (!row) throw notFound("Template not found.");
  if (row.ownerEmail !== emailOf(actor) && !canReview(actor)) throw notFound("Template not found.");
  return row;
}

export async function createTemplate(actor: AuthUser, a: SaveTemplateInput) {
  return repo.insertTemplate({
    title: a.title || a.subject.slice(0, 120) || "Untitled",
    segment: a.segment,
    subject: a.subject,
    body: a.body,
    basedOn: a.basedOn ?? null,
    ownerUserId: actor.id,
    ownerEmail: emailOf(actor),
    ownerName: actor.name || actor.email,
    status: "mine",
  });
}

export async function updateTemplate(actor: AuthUser, id: string, a: SaveTemplateInput) {
  const row = await editable(actor, id);
  // Editing a team template you own sends it back for review; reviewers edit in place.
  const status = row.status === "team" && !canReview(actor) ? "suggested" : row.status === "declined" ? "mine" : row.status;
  const updated = (await repo.updateTemplate(id, { title: a.title || a.subject.slice(0, 120) || "Untitled", segment: a.segment, subject: a.subject, body: a.body, status }))!;
  if (status === "suggested" && row.status !== "suggested") await mailReviewers(updated, await listStaffEmails());
  return updated;
}

export async function removeTemplate(actor: AuthUser, id: string) {
  await editable(actor, id);
  await repo.deleteTemplate(id);
  return { ok: true };
}

export async function suggest(actor: AuthUser, id: string) {
  const row = await repo.findTemplate(id);
  if (!row || row.ownerEmail !== emailOf(actor)) throw notFound("Template not found.");
  if (canReview(actor)) {
    return repo.updateTemplate(id, { status: "team", reviewedBy: emailOf(actor) });
  }
  const updated = (await repo.updateTemplate(id, { status: "suggested", reviewNote: null }))!;
  await mailReviewers(updated, await listStaffEmails());
  return updated;
}

export async function review(actor: AuthUser, id: string, approve: boolean, note?: string | null) {
  if (!canReview(actor)) throw forbidden("Only admins or the office can approve team templates.");
  const row = await repo.findTemplate(id);
  if (!row) throw notFound("Template not found.");
  const updated = (await repo.updateTemplate(id, { status: approve ? "team" : "declined", reviewNote: note ?? null, reviewedBy: emailOf(actor) }))!;
  await mailOwner(updated);
  return updated;
}

export async function setRate(actor: AuthUser, ratePct: number) {
  if (!canReview(actor)) throw forbidden("Only admins or the office can change the team rate.");
  const value: Rate = { ratePct, source: `Set by ${actor.name || actor.email}`, asOf: new Date().toISOString().slice(0, 10) };
  await setSetting(RATE_KEY, value, emailOf(actor));
  return value;
}
