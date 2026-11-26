import { createHmac, timingSafeEqual } from "node:crypto";
import { and, count, desc, eq, isNull, or } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { config } from "../../config/index.js";
import { getOrm } from "../../db/client.js";
import { requireAuth } from "../../middlewares/auth.js";
import type { AuthUser } from "../../types/auth.js";
import { badRequest, forbidden, notFound, serviceUnavailable } from "../../utils/http-error.js";
import { enqueue } from "../jobs/job.service.js";
import { listingInfoById, manageableListing } from "../listings/listing.service.js";
import { findActiveUser, listAssignableAgents } from "../users/user.service.js";
import { formById } from "./form-catalog.js";
import { formSubmissions as submissions, type FormSubmission } from "./form.model.js";

const id = z.string().min(1).max(120);
const token = z.string().min(1).max(1000);
const key = z.object({ formId: id, listingId: id.optional(), agentId: id.optional() });
const shareInput = key.omit({ formId: true });
const submission = z.object({
  submissionId: z.uuid(),
  link: token.optional(),
  agent: id.optional(),
  answers: z.record(z.string().max(80), z.string().max(4000)),
  website: z.string().max(500).optional(),
});
const update = z.object({ status: z.enum(["new", "contacted", "done"]), notes: z.string().trim().max(2000).optional() });
const isStaff = (actor: AuthUser) => actor.role === "admin" || actor.role === "ops";
const slug = (name: string) => name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

function sign(data: string) {
  if (!config.auth.secret) throw serviceUnavailable("Form sharing is unavailable.");
  return createHmac("sha256", config.auth.secret).update("hub-form-link:v1:").update(data).digest("base64url");
}

function claim(formId: string, link: string) {
  const [data, signature, extra] = link.split(".");
  if (!data || !signature || extra !== undefined) throw notFound("This form link is invalid.");
  const expected = Buffer.from(sign(data));
  const actual = Buffer.from(signature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw notFound("This form link is invalid.");
  const parsed = key.safeParse(JSON.parse(Buffer.from(data, "base64url").toString("utf8")));
  if (!parsed.success || parsed.data.formId !== formId) throw notFound("This form link is invalid.");
  return parsed.data;
}

async function destination(formId: string, link?: string, agentSlug?: string) {
  const data = link ? claim(formId, link) : undefined;
  const listing = data?.listingId ? await listingInfoById(data.listingId) : undefined;
  if (data?.listingId && !listing) throw notFound("This listing is no longer available.");
  const agent = listing
    ? { name: listing.agentName, email: listing.agentEmail }
    : data?.agentId
      ? await findActiveUser(data.agentId)
      : !data && agentSlug ? (await listAssignableAgents()).find(a => slug(a.name) === agentSlug.toLowerCase()) : undefined;
  if (data?.agentId && !agent) throw notFound("This form link is no longer available.");
  return { listing, agent };
}

function rowView(row: FormSubmission) {
  const { id, createdAt, ...fields } = row;
  return { ...fields, _id: id, _creationTime: createdAt.getTime(), formTitle: formById(row.formId)?.title ?? row.formId };
}

function visible(actor: AuthUser, mine = false) {
  const owned = eq(submissions.agentEmail, actor.email.toLowerCase());
  if (mine || !isStaff(actor)) return owned;
  return actor.role === "admin" ? undefined : or(owned, isNull(submissions.agentEmail), or(eq(submissions.audience, "team"), eq(submissions.audience, "agent")));
}

export const formRoutes = Router();

formRoutes.get("/:formId/context", async (req, res) => {
  const formId = id.parse(req.params.formId);
  if (!formById(formId)) throw notFound("This form no longer exists.");
  const { listing, agent } = await destination(formId, token.parse(req.query.link));
  res.setHeader("Cache-Control", "no-store");
  res.json({ address: listing?.address ?? null, agentName: agent?.name ?? null });
});

formRoutes.post("/:formId/submissions", async (req, res) => {
  const formId = id.parse(req.params.formId);
  const def = formById(formId);
  if (!def) throw notFound("This form no longer exists.");
  const input = submission.parse(req.body);
  if (input.website?.trim()) { res.json({ ok: true }); return; }
  const { listing, agent } = await destination(formId, input.link, def.audience === "client" ? input.agent : undefined);
  const answers: Record<string, string> = {};
  for (const field of def.fields) {
    const value = (field.id === "propertyAddress" && listing ? listing.address : input.answers[field.id] ?? "").trim();
    if (!value && field.required) throw badRequest(`Please fill in “${field.label}”.`);
    if (!value) continue;
    if (field.type === "email" && !z.email().safeParse(value).success) throw badRequest(`Enter a valid email for “${field.label}”.`);
    if (field.options && (field.type === "checks" ? value.split(", ") : [value]).some(option => !field.options?.includes(option))) {
      throw badRequest(`Choose a valid option for “${field.label}”.`);
    }
    answers[field.id] = value;
  }
  if (def.audience === "client" && !answers.email && !answers.phone) throw badRequest("Please add an email or a phone number.");
  const handoff = def.id === "lead-handoff" && answers.toAgent
    ? (await listAssignableAgents()).find(a => a.name === answers.toAgent)
    : undefined;
  const recipient = handoff ?? agent;
  await getOrm().transaction(async db => {
    const [saved] = await db.insert(submissions).values({
      id: input.submissionId,
      formId,
      listingId: listing?.id,
      agentEmail: recipient?.email.toLowerCase(),
      agentName: recipient?.name ?? answers.agentName,
      audience: def.audience,
      contactName: answers.fullName ?? answers.leadName ?? answers.agentName ?? "Form respondent",
      contactEmail: answers.email ?? answers.leadEmail,
      contactPhone: answers.phone ?? answers.leadPhone,
      propertyAddress: listing?.address ?? answers.propertyAddress,
      answers,
      isLead: def.lead ?? false,
    }).onConflictDoNothing().returning({ id: submissions.id });
    if (saved) await enqueue("forms.received", { submissionId: saved.id }, new Date(), db);
  });
  res.json({ ok: true });
});

formRoutes.use(requireAuth);
formRoutes.get("/agents", async (_req, res) => {
  res.json({ items: (await listAssignableAgents()).map(({ id, name }) => ({ id, name })) });
});
formRoutes.post("/:formId/share", async (req, res) => {
  const actor = req.user!;
  const formId = id.parse(req.params.formId);
  const def = formById(formId);
  if (!def) throw notFound("This form no longer exists.");
  const { listingId, agentId } = shareInput.parse(req.body);
  if (formId === "open-house-signin" && !listingId) throw badRequest("Choose the listing for this open house.");
  if (listingId) await manageableListing(actor, listingId);
  if (agentId) {
    const recipient = await findActiveUser(agentId);
    if (!recipient || recipient.role === "guest") throw badRequest("Choose an active agent.");
  }
  const data = Buffer.from(JSON.stringify({ formId, listingId, agentId: listingId || def.audience !== "client" ? undefined : agentId })).toString("base64url");
  res.json({ link: `${data}.${sign(data)}` });
});
formRoutes.get("/inbox", async (req, res) => {
  const actor = req.user!;
  const rows = await getOrm().select().from(submissions).where(visible(actor, req.query.scope === "mine")).orderBy(desc(submissions.createdAt)).limit(300);
  res.setHeader("Cache-Control", "no-store");
  res.json({ rows: rows.map(rowView), me: { isAdmin: actor.role === "admin", isOps: actor.role === "ops" } });
});
formRoutes.get("/counts", async (req, res) => {
  const actor = req.user!;
  const filter = and(visible(actor), eq(submissions.status, "new"));
  const [totals, leads] = await Promise.all([
    getOrm().select({ total: count() }).from(submissions).where(filter),
    getOrm().select().from(submissions).where(and(filter, eq(submissions.isLead, true))).orderBy(desc(submissions.createdAt)).limit(5),
  ]);
  res.setHeader("Cache-Control", "no-store");
  res.json({ newCount: totals[0]?.total ?? 0, newLeads: leads.map(rowView) });
});
formRoutes.patch("/inbox/:id", async (req, res) => {
  const [row] = await getOrm().update(submissions).set(update.parse(req.body)).where(and(visible(req.user!), eq(submissions.id, id.parse(req.params.id)))).returning();
  if (!row) throw notFound();
  res.json(rowView(row));
});
formRoutes.put("/inbox/:id/agent", async (req, res) => {
  const actor = req.user!;
  if (!isStaff(actor)) throw forbidden();
  const { agentId } = z.object({ agentId: id }).parse(req.body);
  const agent = await findActiveUser(agentId);
  if (!agent || agent.role === "guest") throw badRequest("Choose an active agent.");
  const [row] = await getOrm().update(submissions).set({ agentEmail: agent.email.toLowerCase(), agentName: agent.name })
    .where(and(visible(actor), eq(submissions.id, id.parse(req.params.id)))).returning();
  if (!row) throw notFound();
  await enqueue("forms.received", { submissionId: row.id });
  res.json(rowView(row));
});
