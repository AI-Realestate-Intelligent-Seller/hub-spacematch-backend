// Help request rules (was convex/help.ts). Agents ask a support person; that person (or an
// admin/ops) moves it along; the asker can close it. Admins and ops see the whole board.
import { SUPPORT_TEAM, supportPerson } from "../../shared/support-team.js";
import type { AuthUser } from "../../types/auth.js";
import { badRequest, forbidden, notFound } from "../../utils/http-error.js";
import { mailNewRequest, mailStatusChange } from "./help.mail.js";
import * as repo from "./help.repository.js";
import type { CreateHelpInput } from "./help.validation.js";

const isStaff = (u: AuthUser) => u.role === "admin" || u.role === "ops";
const emailOf = (u: AuthUser) => u.email.toLowerCase();

export async function createRequest(actor: AuthUser, input: CreateHelpInput) {
  const to = supportPerson(input.toEmail);
  if (!to) throw badRequest("Pick someone from the support team.");
  const r = await repo.insertRequest({
    fromUserId: actor.id,
    fromEmail: emailOf(actor),
    fromName: actor.name || actor.email,
    toName: to.name,
    toEmail: to.email,
    topic: input.topic,
    details: input.details,
    urgency: input.urgency,
    status: "new",
  });
  await mailNewRequest(r);
  return r;
}

/** Requests I sent + requests sent to me (admins/ops see everything, newest 500). */
export async function listRequests(actor: AuthUser) {
  const me = emailOf(actor);
  const amSupport = !!supportPerson(me);
  const [mine, toMe] = await Promise.all([
    repo.listFrom(me),
    isStaff(actor) ? repo.listAll() : amSupport ? repo.listTo(me) : Promise.resolve([]),
  ]);
  return {
    mine,
    toMe,
    canHandle: isStaff(actor) || amSupport,
    isAdmin: isStaff(actor),
    myEmail: me,
    support: SUPPORT_TEAM,
  };
}

export async function setStatus(actor: AuthUser, id: string, status: string, reply?: string | null) {
  const r = await repo.findRequest(id);
  if (!r) throw notFound("Help request not found.");
  const me = emailOf(actor);
  const canHandle = isStaff(actor) || r.toEmail === me;
  const isAsker = r.fromEmail === me;
  if (!canHandle && !isAsker) throw notFound("Help request not found.");
  if (!canHandle && status !== "done" && status !== "in_progress") throw forbidden("Only the person asked can update this.");
  const now = new Date();
  const by = actor.name || actor.email;
  const updated = (await repo.updateRequest(id, {
    status,
    reply: reply || r.reply,
    statusAt: now,
    statusBy: by,
    doneAt: status === "done" ? now : null,
    doneBy: status === "done" ? by : null,
  }))!;
  // Tell the agent when someone else moves their request along.
  if (!isAsker && status !== "new") await mailStatusChange(updated, reply ?? "");
  return updated;
}

export async function reassign(actor: AuthUser, id: string, toEmail: string) {
  if (!isStaff(actor)) throw forbidden("Only admins or ops can reassign.");
  const r = await repo.findRequest(id);
  if (!r) throw notFound("Help request not found.");
  const to = supportPerson(toEmail);
  if (!to) throw badRequest("Pick someone from the support team.");
  if (to.email === r.toEmail) return r;
  const updated = (await repo.updateRequest(id, { toEmail: to.email, toName: to.name, reassignedBy: actor.name || actor.email, statusAt: new Date() }))!;
  if (to.email !== emailOf(actor)) await mailNewRequest(updated);
  return updated;
}
