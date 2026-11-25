// Market myself rules (was convex/marketMe.ts: settings, Google review requests, market update kit).
import { TEAM_REVIEW_URL } from "../../shared/market-defs.js";
import type { AuthUser } from "../../types/auth.js";
import { randomString } from "../../utils/id.js";
import { enqueueMany } from "../jobs/job.service.js";
import { getSetting } from "../settings/setting.service.js";
import { findActiveUserByEmail, listStaffEmails } from "../users/user.service.js";
import * as repo from "./market-me.repository.js";
import type { SettingsInput, StatsInput } from "./market-me.validation.js";

const isStaff = (u: AuthUser) => u.role === "admin" || u.role === "ops";
const emailOf = (u: AuthUser) => u.email.toLowerCase();
/** Link-friendly agent name, e.g. "Jane Doe" → "jane-doe" (business card /c/:slug, agent photos). */
export const agentSlug = (name: string) => name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
/** Review link tokens: short and easy to type (no look-alike characters). */
const newToken = () => randomString(8).toLowerCase().replace(/[^a-z0-9]/g, "x");

// ---------- Settings ----------

export async function getSettings(actor: AuthUser) {
  const [row, user] = await Promise.all([repo.findSettings(emailOf(actor)), findActiveUserByEmail(actor.email)]);
  const name = user?.name || actor.name || actor.email;
  return {
    email: emailOf(actor),
    name,
    phone: user?.phone ?? "",
    slug: agentSlug(name),
    isAgent: true,
    isStaff: isStaff(actor),
    reviewUrl: row?.reviewUrl ?? "",
    areas: row?.areas ?? [],
    teamReviewUrl: TEAM_REVIEW_URL,
  };
}

export async function saveSettings(actor: AuthUser, a: SettingsInput) {
  await repo.upsertSettings(emailOf(actor), {
    ...(a.reviewUrl !== undefined ? { reviewUrl: a.reviewUrl } : {}),
    ...(a.areas !== undefined ? { areas: a.areas } : {}),
  });
  return getSettings(actor);
}

// ---------- Google review requests ----------

export async function createReview(actor: AuthUser, clientName: string, channel: string) {
  const settings = await repo.findSettings(emailOf(actor));
  let token = newToken();
  while (await repo.findReviewByToken(token)) token = newToken();
  await repo.insertReview({
    token,
    agentEmail: emailOf(actor),
    agentName: actor.name || actor.email,
    clientName,
    channel,
    target: settings?.reviewUrl ? "agent" : "team",
  });
  return { token };
}

type Mentions = { at: number; total: number; byAgent: Record<string, number> } | null;

export async function myReviews(actor: AuthUser) {
  const [rows, mentions] = await Promise.all([repo.listReviewsForAgent(emailOf(actor)), getSetting<Mentions>("reviewMentions", null)]);
  const myName = actor.name || actor.email;
  let team: { agentName: string; sent: number; opened: number; clicked: number; mentions: number }[] = [];
  if (isStaff(actor)) {
    const by = new Map<string, (typeof team)[number]>();
    for (const r of await repo.listAllReviews()) {
      const t = by.get(r.agentName) ?? { agentName: r.agentName, sent: 0, opened: 0, clicked: 0, mentions: mentions?.byAgent[r.agentName] ?? 0 };
      t.sent += 1;
      if (r.firstOpenedAt) t.opened += 1;
      if (r.clickedAt) t.clicked += 1;
      by.set(r.agentName, t);
    }
    team = [...by.values()].sort((x, y) => y.sent - x.sent);
  }
  return {
    rows: rows.map(r => ({
      id: r.id,
      token: r.token,
      clientName: r.clientName,
      channel: r.channel,
      target: r.target,
      createdAt: r.createdAt,
      opened: !!r.firstOpenedAt,
      clicked: !!r.clickedAt,
      note: r.note,
    })),
    sent: rows.length,
    opened: rows.filter(r => r.firstOpenedAt).length,
    clicked: rows.filter(r => r.clickedAt).length,
    mentions: mentions ? { count: mentions.byAgent[myName] ?? 0, total: mentions.total, at: mentions.at } : null,
    team,
  };
}

// ---------- Public review page /r/:token (no login) ----------

export async function reviewView(token: string) {
  const r = await repo.findReviewByToken(token);
  if (!r) return null;
  const [settings, agent] = await Promise.all([repo.findSettings(r.agentEmail), findActiveUserByEmail(r.agentEmail)]);
  return {
    clientFirst: r.clientName.split(/\s+/)[0] ?? r.clientName,
    agentName: r.agentName,
    agentSlug: agentSlug(r.agentName),
    agentPhone: agent?.phone ?? "",
    reviewUrl: settings?.reviewUrl || TEAM_REVIEW_URL,
    team: !settings?.reviewUrl,
    noteSent: !!r.note,
  };
}

/** The client opened the page / tapped the Google button / sent a private note. */
export async function reviewPing(token: string, event: "open" | "click" | "note", note?: string) {
  const r = await repo.findReviewByToken(token);
  if (!r) return { ok: false };
  const now = new Date();
  if (event === "open") {
    await repo.updateReview(r.id, { opens: r.opens + 1, ...(r.firstOpenedAt ? {} : { firstOpenedAt: now }) });
  } else if (event === "click") {
    if (!r.clickedAt) {
      await repo.updateReview(r.id, { clickedAt: now });
      // Phone notifications move later; the job waits until then.
      await enqueueMany([{ kind: "push.toEmail", payload: { email: r.agentEmail, title: `${r.clientName} is leaving you a Google review`, body: "They just tapped the Google review button on your link.", url: "/reviews" } }]);
    }
  } else if (note) {
    if (r.note) return { ok: true }; // one note per link
    await repo.updateReview(r.id, { note, noteAt: now });
    const to = [...new Set([r.agentEmail, ...(await listStaffEmails())])];
    await enqueueMany(
      to.map(email => ({ kind: "push.toEmail", payload: { email, title: `Private note from ${r.clientName} (${r.agentName}'s client)`, body: note.slice(0, 160), url: "/reviews" } })),
    );
  }
  return { ok: true };
}

// ---------- Market update kit ----------

export async function marketKit(actor: AuthUser) {
  const settings = await repo.findSettings(emailOf(actor));
  const me = emailOf(actor);
  const areas = await Promise.all(
    (settings?.areas ?? []).map(async area => {
      const rows = await repo.recentStats(area);
      return {
        area,
        mred: rows.find(r => r.source === "mred") ?? null,
        mine: rows.find(r => r.source === "agent" && r.enteredBy === me) ?? null,
      };
    }),
  );
  return { areas };
}

/** An agent types a month's numbers for an area (when the monthly pull is missing). */
export async function enterStats(actor: AuthUser, a: StatsInput) {
  const me = emailOf(actor);
  const values = { median: a.median, sales: a.sales, domMedian: a.domMedian, active: a.active, pulledAt: new Date() };
  const old = await repo.findAgentStat(a.area, a.month, me);
  if (old) await repo.updateStat(old.id, values);
  else await repo.insertStat({ area: a.area, month: a.month, source: "agent", enteredBy: me, ...values });
  return marketKit(actor);
}
