// Seller Launch Portal business rules (was convex/listings.ts + convex/suggestions.ts).
// Agents manage their own listings; admins and ops see and manage every listing.
// Sellers read a private /s/:token page with no login (see the portal functions at the bottom).
import { formatFreeAddress } from "../../shared/address.js";
import { addressKey, LAUNCH_STEPS, weekOf } from "../../shared/launch-steps.js";
import type { AuthUser } from "../../types/auth.js";
import { badRequest, forbidden, notFound } from "../../utils/http-error.js";
import { randomString } from "../../utils/id.js";
import { enqueue, enqueueMany } from "../jobs/job.service.js";
import * as users from "../users/user.service.js";
import { publicAds, runningCounts } from "../listing-ads/listing-ad.service.js";
import { onListingDeleted, onListingStatus } from "../listing-social/listing-social.service.js";
import { type DigestRow, mailFeedbackToReview, mailMondayReminders, mailPlanApproved, mailSellerWeekly, mailTuesdayNudge } from "./listing.mail.js";
import type { LaunchStepState, ListingEventRow, ListingLinks, ListingMetricRow, ListingRow, ListingSuggestionRow } from "./listing.model.js";
import * as repo from "./listing.repository.js";
import { computeRules, daysOn, type RuleInput } from "./listing.rules.js";
import type {
  AddEventInput,
  CreateListingInput,
  ParsedShowingInput,
  SaveMetricsInput,
  UpdateListingInput,
  UpdateSuggestionInput,
} from "./listing.validation.js";

// ---------- Helpers ----------

const isStaff = (u: AuthUser) => u.role === "admin" || u.role === "ops";
const me = (u: AuthUser) => ({ email: u.email, staff: isStaff(u) });
const newToken = () => randomString(24);

/** "$549,000" from cents (display only; the number is stored in cents). */
export const formatCents = (cents: number | null | undefined) =>
  cents == null ? undefined : `$${Math.round(cents / 100).toLocaleString("en-US")}`;

/** Loads a listing the user may manage: their own, or any listing for admins/ops. */
async function mine(actor: AuthUser, id: string): Promise<ListingRow> {
  const l = await repo.findListingById(id);
  if (!l || !(isStaff(actor) || l.agentEmail === actor.email.toLowerCase())) throw notFound("Listing not found.");
  return l;
}

/** Everything an agent sees about a listing. */
function toListing(l: ListingRow) {
  return {
    id: l.id,
    address: l.address,
    mlsNumber: l.mlsNumber,
    priceCents: l.priceCents,
    price: formatCents(l.priceCents) ?? null,
    status: l.status,
    photoUrl: l.photoUrl,
    agentUserId: l.agentUserId,
    agentEmail: l.agentEmail,
    agentName: l.agentName,
    sellerName: l.sellerName,
    sellerEmail: l.sellerEmail,
    sellerPhone: l.sellerPhone,
    token: l.token,
    steps: l.steps,
    links: l.links,
    liveDate: l.liveDate,
    zillowPage: l.zillowPage,
    loftyLeadId: l.loftyLeadId,
    loftyError: l.loftyError,
    loftyAt: l.loftyAt,
    reelAuto: l.reelAuto,
    ytAuto: l.ytAuto,
    weeklyEmail: l.weeklyEmail,
    sellerLastSeenAt: l.sellerLastSeenAt,
    createdAt: l.createdAt,
    updatedAt: l.updatedAt,
  };
}

const metricNumbers = (m: ListingMetricRow) => ({
  zillowViews: m.zillowViews,
  zillowSaves: m.zillowSaves,
  mlsSaved: m.mlsSaved,
  mlsMaybe: m.mlsMaybe,
  mlsNotInterested: m.mlsNotInterested,
  adViews: m.adViews,
  adClicks: m.adClicks,
  reelViews: m.reelViews,
  tiktokViews: m.tiktokViews,
  fbViews: m.fbViews,
  youtubeViews: m.youtubeViews,
});

const showingCount = (ev: Pick<ListingEventRow, "kind">[]) =>
  ev.filter(e => e.kind === "showing").length - ev.filter(e => e.kind === "cancelled").length;

/** Open-house sign-ins for this address. They come from the forms module (Wave 4), which isn't
 *  on the new backend yet, so this is empty until then. */
async function openHouseSignins(_l: ListingRow): Promise<{ id: string; name: string; at: Date; status: string }[]> {
  return [];
}

/** Background work Convex scheduled with ctx.scheduler (handlers arrive with each integration). */
const followUps = {
  created: (l: ListingRow, byEmail: string) => [
    { kind: "zillow.rollupListing", payload: { listingId: l.id } },
    { kind: "reels.refresh", payload: { listingId: l.id } },
    { kind: "paidAds.refresh", payload: { listingId: l.id } },
    { kind: "youtube.refresh", payload: { listingId: l.id } },
    ...(l.sellerEmail || l.sellerPhone ? [{ kind: "lofty.syncListingSeller", payload: { listingId: l.id } }] : []),
    { kind: "listingPlans.autoQueue", payload: { listingId: l.id, email: byEmail } },
  ],
};

// ---------- Agent side: listings ----------

export async function listListings(actor: AuthUser, scope: "mine" | "all") {
  const rows = isStaff(actor) && scope !== "mine" ? await repo.listListings() : await repo.listListings({ agentEmail: actor.email.toLowerCase() });
  const ids = rows.map(r => r.id);
  const [events, week, running] = await Promise.all([repo.eventSummaries(ids), repo.metricsForWeek(ids, weekOf(Date.now())), runningCounts(ids)]);
  const items = rows.map(l => {
    const ev = events.filter(e => e.listingId === l.id);
    const wk = week.find(m => m.listingId === l.id);
    return {
      id: l.id,
      address: formatFreeAddress(l.address),
      status: l.status,
      agentName: l.agentName,
      sellerName: l.sellerName,
      photoUrl: l.photoUrl,
      price: formatCents(l.priceCents) ?? null,
      stepsDone: l.steps.filter(s => s.done).length,
      stepsTotal: l.steps.length,
      pending: ev.filter(e => e.status === "pending").length,
      showings: showingCount(ev),
      numbersThisWeek: !!wk && wk.enteredByEmail !== "auto",
      adsRunning: running.get(l.id) ?? 0,
      sellerLastSeenAt: l.sellerLastSeenAt,
      updatedAt: l.updatedAt,
    };
  });
  return { items, me: me(actor) };
}

export async function getListing(actor: AuthUser, id: string) {
  const l = await mine(actor, id);
  const [events, metrics, oh] = await Promise.all([repo.listEvents(id), repo.listMetrics(id), openHouseSignins(l)]);
  return {
    listing: toListing(l),
    events,
    metrics,
    openHouse: oh,
    thisWeek: weekOf(Date.now()),
    me: me(actor),
  };
}

/** Who a new listing can be assigned to (the "Listing agent" dropdown, admins/ops only). */
export async function listAgents() {
  return users.listAssignableAgents();
}

export async function createListing(actor: AuthUser, input: CreateListingInput) {
  let agent = { id: actor.id as string | null, email: actor.email.toLowerCase(), name: actor.name || actor.email };
  if (input.agentUserId && input.agentUserId !== actor.id) {
    if (!isStaff(actor)) throw forbidden("Only admins or ops can create a listing for another agent.");
    const u = await users.findActiveUser(input.agentUserId);
    if (!u) throw badRequest("Pick the listing agent.");
    agent = { id: u.id, email: u.email.toLowerCase(), name: u.name };
  }
  const l = await repo.insertListing({
    address: formatFreeAddress(input.address),
    addressKey: addressKey(input.address),
    mlsNumber: input.mlsNumber ?? null,
    priceCents: input.priceCents ?? null,
    status: "Preparing",
    agentUserId: agent.id,
    agentEmail: agent.email,
    agentName: agent.name,
    sellerName: input.sellerName,
    sellerEmail: input.sellerEmail ?? null,
    sellerPhone: input.sellerPhone ?? null,
    token: newToken(),
    steps: LAUNCH_STEPS.map(s => ({ key: s.key, done: false })),
    links: {},
    weeklyEmail: false,
  });
  await enqueueMany(followUps.created(l, actor.email));
  return toListing(l);
}

export async function updateListing(actor: AuthUser, id: string, a: UpdateListingInput) {
  const l = await mine(actor, id);
  const p: Parameters<typeof repo.updateListing>[1] = {};

  if (a.address !== undefined) {
    p.address = formatFreeAddress(a.address);
    p.addressKey = addressKey(a.address);
  }
  if (a.mlsNumber !== undefined) p.mlsNumber = a.mlsNumber;
  if (a.priceCents !== undefined) {
    if (a.priceCents !== null && l.priceCents !== null && a.priceCents !== l.priceCents) {
      await repo.insertEvent({ listingId: id, kind: "price", status: "published", title: `Price updated to ${formatCents(a.priceCents)}`, source: "agent" });
    }
    p.priceCents = a.priceCents;
  }
  if (a.status !== undefined) p.status = a.status;
  if (a.photoUrl !== undefined) p.photoUrl = a.photoUrl;
  if (a.sellerName !== undefined) p.sellerName = a.sellerName;
  if (a.sellerEmail !== undefined) p.sellerEmail = a.sellerEmail;
  if (a.sellerPhone !== undefined) p.sellerPhone = a.sellerPhone;
  if (a.liveDate !== undefined) p.liveDate = a.liveDate;
  if (a.weeklyEmail !== undefined) {
    const sellerEmail = p.sellerEmail !== undefined ? p.sellerEmail : l.sellerEmail;
    if (a.weeklyEmail && !sellerEmail) throw badRequest("Add the seller's email first.");
    p.weeklyEmail = a.weeklyEmail;
  }
  // Clearing the seller email also turns the weekly email off.
  if (p.sellerEmail === null && (p.weeklyEmail ?? l.weeklyEmail)) p.weeklyEmail = false;
  if (a.links) {
    const links: ListingLinks = { ...l.links };
    for (const [k, v] of Object.entries(a.links) as [keyof ListingLinks, string | null | undefined][]) {
      if (v === undefined) continue;
      if (v === null) delete links[k];
      else links[k] = v;
    }
    p.links = links;
  }

  // Seller email/phone changed → a different person: drop the old Lofty link and look up again.
  const contactChanged =
    (p.sellerEmail !== undefined && p.sellerEmail !== l.sellerEmail) || (p.sellerPhone !== undefined && p.sellerPhone !== l.sellerPhone);
  if (contactChanged && l.loftyLeadId) {
    p.loftyLeadId = null;
    p.loftyError = null;
  }
  const linkCleared = (k: "reel" | "youtube") => p.links && !p.links[k] && l.links[k];
  if (linkCleared("reel") && l.reelAuto) p.reelAuto = null;
  if (linkCleared("youtube") && l.ytAuto) p.ytAuto = null;

  const updated = (await repo.updateListing(id, p))!;
  // Closed/Withdrawn archives the listing's social videos in the Reels service; back on market restores them.
  if (p.status !== undefined && p.status !== l.status) await onListingStatus(id, l.status, p.status);

  // Same follow-ups Convex scheduled after an edit.
  const jobs: { kind: string; payload: Record<string, unknown> }[] = [];
  const addressMoved = p.addressKey !== undefined && p.addressKey !== l.addressKey;
  const changed = (k: keyof ListingLinks) => p.links !== undefined && p.links[k] !== l.links[k];
  if (changed("website") || (p.mlsNumber !== undefined && p.mlsNumber !== l.mlsNumber) || addressMoved) jobs.push({ kind: "listingAds.refreshWeb", payload: { listingId: id } });
  if (addressMoved || (p.liveDate !== undefined && p.liveDate !== l.liveDate)) jobs.push({ kind: "zillow.rollupListing", payload: { listingId: id } });
  if (changed("reel") || addressMoved) jobs.push({ kind: "reels.refresh", payload: { listingId: id } });
  if (changed("youtube") || addressMoved) jobs.push({ kind: "youtube.refresh", payload: { listingId: id } });
  if (addressMoved || (p.status !== undefined && p.status !== l.status)) jobs.push({ kind: "paidAds.refresh", payload: { listingId: id } });
  if (contactChanged && (updated.sellerEmail || updated.sellerPhone)) jobs.push({ kind: "lofty.syncListingSeller", payload: { listingId: id } });
  await enqueueMany(jobs);

  return toListing(updated);
}

/** "Link to Lofty" / "Try again" on the listing page. */
export async function linkLofty(actor: AuthUser, id: string) {
  const l = await mine(actor, id);
  if (!l.sellerEmail && !l.sellerPhone) throw badRequest("Add the seller's email or phone first.");
  const updated = (await repo.updateListing(id, { loftyError: null, loftyAt: null }))!;
  await enqueue("lofty.syncListingSeller", { listingId: id, force: !!l.loftyLeadId });
  return toListing(updated);
}

export async function rotateLink(actor: AuthUser, id: string) {
  await mine(actor, id);
  return toListing((await repo.updateListing(id, { token: newToken() }))!);
}

export async function removeListing(actor: AuthUser, id: string) {
  await mine(actor, id);
  await onListingDeleted(id); // frees its videos in the Reels service
  await repo.deleteListing(id);
  return { ok: true };
}

export async function toggleStep(actor: AuthUser, id: string, key: string, done: boolean, note?: string | null) {
  const l = await mine(actor, id);
  const now = new Date();
  const steps: LaunchStepState[] = LAUNCH_STEPS.map(def => {
    const s = l.steps.find(x => x.key === def.key) ?? { key: def.key, done: false };
    if (def.key !== key) return s;
    const next: LaunchStepState = { key, done };
    if (done) next.doneAt = now.toISOString();
    const n = note !== undefined ? note : s.note;
    if (n) next.note = n;
    return next;
  });
  const p: Parameters<typeof repo.updateListing>[1] = { steps };
  if (key === "comingSoon" && done && l.status === "Preparing") p.status = "Coming soon";
  if (key === "mls" && done) {
    if (!l.liveDate) p.liveDate = new Date(now.getTime() - 5 * 36e5).toISOString().slice(0, 10); // Chicago date
    if (l.status === "Preparing" || l.status === "Coming soon") p.status = "Active";
  }
  const updated = (await repo.updateListing(id, p))!;
  if (p.status && p.status !== l.status) await onListingStatus(id, l.status, p.status);
  return toListing(updated);
}

export async function saveMetrics(actor: AuthUser, id: string, wk: string, input: SaveMetricsInput) {
  const l = await mine(actor, id);
  if (wk > weekOf(Date.now())) throw badRequest("You can't enter numbers for a future week.");
  const { tiktokLink, facebookLink, ...n } = input;
  if (tiktokLink !== undefined || facebookLink !== undefined) {
    const links: ListingLinks = { ...l.links };
    for (const [k, v] of [["tiktok", tiktokLink], ["facebook", facebookLink]] as const) {
      if (v === undefined) continue;
      if (v === null) delete links[k];
      else links[k] = v;
    }
    await repo.updateListing(id, { links });
  }
  const cur = await repo.findMetric(id, wk);
  // Numbers filled automatically (Zillow emails, Instagram, YouTube) are kept as they are.
  const auto = cur?.auto ?? [];
  const values = Object.fromEntries(Object.entries(n).map(([k, v]) => [k, v ?? null])) as Record<string, number | null>;
  if (auto.includes("zillow")) {
    values.zillowViews = cur?.zillowViews ?? null;
    values.zillowSaves = cur?.zillowSaves ?? null;
  }
  if (auto.includes("reel")) values.reelViews = cur?.reelViews ?? null;
  if (auto.includes("youtube")) values.youtubeViews = cur?.youtubeViews ?? null;
  if (auto.includes("tiktok")) values.tiktokViews = cur?.tiktokViews ?? null;
  if (auto.includes("facebook")) values.fbViews = cur?.fbViews ?? null;
  await repo.upsertMetric(id, wk, { ...values, auto, zillowDays: auto.length ? (cur?.zillowDays ?? null) : null, enteredByEmail: actor.email.toLowerCase() });
  await repo.touchListing(id);
  return { metrics: await repo.listMetrics(id) };
}

// ---------- Activity ----------

export async function addEvent(actor: AuthUser, id: string, a: AddEventInput) {
  await mine(actor, id);
  const e = await repo.insertEvent({ listingId: id, kind: a.kind, status: "published", title: a.title, body: a.body ?? null, when: a.when ?? null, source: "agent" });
  await repo.touchListing(id);
  return e;
}

async function insertShowingEvent(listingId: string, p: ParsedShowingInput, externalId: string | null) {
  const source = externalId ? "showingtime" : "agent";
  if (p.kind === "feedback") {
    const parts = [p.interest && `Interest: ${p.interest}`, p.priceOpinion && `Price: ${p.priceOpinion}`, p.rating && `Rating: ${p.rating}/5`].filter(Boolean);
    return repo.insertEvent({
      listingId,
      kind: "feedback",
      status: "pending",
      title: "Showing feedback",
      body: p.comments ?? null,
      interest: p.interest ?? null,
      priceOpinion: p.priceOpinion ?? null,
      rating: p.rating ?? null,
      when: p.when ?? null,
      agentOnly: [p.buyerAgent && `Buyer's agent: ${p.buyerAgent}`, parts.join(" · ")].filter(Boolean).join("\n") || null,
      source,
      externalId,
    });
  }
  return repo.insertEvent({
    listingId,
    kind: p.kind,
    status: "published",
    title: p.kind === "showing" ? "Showing scheduled" : "Showing cancelled",
    when: p.when ?? null,
    source,
    externalId,
  });
}

/** Agent pastes a ShowingTime email (fallback when the forward rule isn't set up). */
export async function addParsedShowing(actor: AuthUser, id: string, parsed: ParsedShowingInput) {
  await mine(actor, id);
  const e = await insertShowingEvent(id, parsed, null);
  await repo.touchListing(id);
  return e;
}

export async function setEventStatus(actor: AuthUser, eventId: string, status: "published" | "hidden" | "pending", body?: string | null) {
  const e = await repo.findEventById(eventId);
  if (!e) throw notFound("Activity item not found.");
  await mine(actor, e.listingId);
  const updated = await repo.updateEvent(eventId, { status, ...(body !== undefined ? { body } : {}) });
  await repo.touchListing(e.listingId);
  return updated;
}

export async function removeEvent(actor: AuthUser, eventId: string) {
  const e = await repo.findEventById(eventId);
  if (!e) return { ok: true };
  await mine(actor, e.listingId);
  await repo.deleteEvent(eventId);
  await repo.touchListing(e.listingId);
  return { ok: true };
}

// ---------- ShowingTime inbox (admins/ops) ----------

export async function listInbox() {
  return repo.listInbox(50);
}

export async function assignInbox(actor: AuthUser, inboxId: string, listingId: string) {
  const row = await repo.findInboxById(inboxId);
  if (!row) return { ok: true };
  await mine(actor, listingId);
  const ev = await insertShowingEvent(listingId, row.parsed as ParsedShowingInput, row.externalId);
  await repo.deleteInbox(inboxId);
  await repo.touchListing(listingId);
  // Filed feedback waits for the agent's review: tell them.
  if (ev.kind === "feedback") await notifyFeedbackToReview(listingId);
  return { ok: true };
}

// ---------- "Use one of your listings" picker (CMA, Reel Studio, Seller lists) ----------

/** Split a listing address into form fields ("2147 W Thomas St #2, Chicago, IL 60622"). */
function splitListingAddress(address: string) {
  const s = (address ?? "").trim();
  const zip = s.match(/\b(\d{5})(?:-\d{4})?\s*$/)?.[1] ?? "";
  let rest = zip ? s.replace(/[,\s]*\d{5}(?:-\d{4})?\s*$/, "") : s;
  const st = rest.match(/[,\s]+([A-Za-z]{2})\.?\s*$/);
  const known = !!st?.[1] && /^(il|in|wi|mi|ia|mo)$/i.test(st[1]);
  const state = known ? st![1]!.toUpperCase() : "IL";
  if (known) rest = rest.slice(0, st!.index);
  const parts = rest
    .split(",")
    .map(x => x.trim())
    .filter(Boolean);
  let street = parts.shift() ?? "";
  let unit = "";
  const um = street.match(/\s*(?:#|\bunit\b|\bapt\.?\b|\bsuite\b)\s*([\w-]+)\s*$/i);
  if (um?.[1]) {
    unit = um[1].toUpperCase();
    street = street.slice(0, um.index).trim();
  }
  return { street, unit, city: parts.join(" "), state, zip };
}

export async function pickList(actor: AuthUser) {
  const rows = isStaff(actor) ? await repo.listListings() : await repo.listListings({ agentEmail: actor.email.toLowerCase() });
  const rank: Record<string, number> = { Active: 0, "Coming soon": 1, Preparing: 2, "Under contract": 3, Closed: 4, Withdrawn: 5 };
  return rows
    .map(l => {
      const address = formatFreeAddress(l.address);
      return {
        id: l.id,
        address,
        ...splitListingAddress(address),
        mlsNumber: l.mlsNumber ?? "",
        price: formatCents(l.priceCents) ?? "",
        status: l.status,
        agentName: l.agentName,
        agentEmail: l.agentEmail,
        sellerName: l.sellerName,
        sellerEmail: l.sellerEmail ?? "",
        sellerPhone: l.sellerPhone ?? "",
        photoUrl: l.photoUrl ?? "",
        zillow: l.links.zillow ?? "",
        website: l.links.website ?? "",
      };
    })
    .sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9));
}

// ---------- Suggestions ("What we'd do next") ----------

async function ruleInput(l: ListingRow): Promise<RuleInput> {
  const [ev, m, oh] = await Promise.all([repo.listEvents(l.id), repo.listMetrics(l.id), openHouseSignins(l)]);
  const views = Math.max(m.reduce((a, r) => a + (r.zillowViews ?? 0), 0), l.zillowPage?.views ?? 0);
  const saves = Math.max(m.reduce((a, r) => a + (r.zillowSaves ?? 0), 0), l.zillowPage?.saves ?? 0);
  return {
    views,
    saves,
    showings: showingCount(ev),
    offers: ev.filter(e => e.kind === "offer").length,
    dom: daysOn(l.liveDate),
    openHouseDone: !!l.steps.find(s => s.key === "openHouse")?.done,
    openHouseVisitors: oh.length,
    // Only published feedback, and only the words: never buyer-agent names.
    feedback: ev.filter(e => e.kind === "feedback" && e.status === "published").map(e => ({ text: `${e.title} ${e.body ?? ""}`, priceOpinion: e.priceOpinion })),
  };
}

export async function listSuggestions(actor: AuthUser, id: string) {
  const l = await mine(actor, id);
  const [all, input] = await Promise.all([repo.listSuggestions(id), ruleInput(l)]);
  const live = new Set(computeRules(input).map(r => r.ruleKey));
  return all.filter(r => r.status !== "dismissed").map(r => ({ ...r, stillTrue: r.ruleKey === "custom" || live.has(r.ruleKey) }));
}

/** Adds a draft for each rule that fires and has never been suggested for this listing. */
export async function refreshSuggestions(actor: AuthUser, id: string) {
  const l = await mine(actor, id);
  const have = new Set((await repo.listSuggestions(id)).map(r => r.ruleKey));
  const fresh = computeRules(await ruleInput(l)).filter(r => !have.has(r.ruleKey));
  const added = await repo.insertSuggestions(fresh.map(r => ({ listingId: id, ...r, status: "draft" })));
  return { added: added.length };
}

export async function addSuggestion(actor: AuthUser, id: string, a: { title: string; why: string; action: string }) {
  await mine(actor, id);
  const [row] = await repo.insertSuggestions([{ listingId: id, ruleKey: "custom", ...a, status: "draft" }]);
  return row!;
}

export async function updateSuggestion(actor: AuthUser, suggestionId: string, a: UpdateSuggestionInput): Promise<ListingSuggestionRow | { ok: true }> {
  const s = await repo.findSuggestionById(suggestionId);
  if (!s) throw notFound("Suggestion not found.");
  await mine(actor, s.listingId);
  // Dismissed rule suggestions stay as a tombstone so the rule doesn't add them again.
  if (a.status === "dismissed" && s.ruleKey === "custom") {
    await repo.deleteSuggestion(suggestionId);
    await repo.touchListing(s.listingId);
    return { ok: true };
  }
  const patch: Parameters<typeof repo.updateSuggestion>[1] = {};
  if (a.title !== undefined) patch.title = a.title;
  if (a.why !== undefined) patch.why = a.why;
  if (a.action !== undefined) patch.action = a.action;
  if (a.status !== undefined) {
    patch.status = a.status;
    if (a.status !== "published") patch.approvedAt = null;
  }
  const row = await repo.updateSuggestion(suggestionId, patch);
  await repo.touchListing(s.listingId);
  return row!;
}

// ---------- Seller side (public, token-gated, no login) ----------

async function byToken(token: string): Promise<ListingRow | undefined> {
  return token.length < 20 ? undefined : repo.findListingByToken(token);
}

export async function portal(token: string) {
  const l = await byToken(token);
  if (!l) return null;
  const [events, metrics, oh, suggestions, agent, ads] = await Promise.all([
    repo.listEvents(l.id),
    repo.listMetrics(l.id),
    openHouseSignins(l),
    repo.listSuggestions(l.id),
    users.findActiveUserByEmail(l.agentEmail),
    publicAds(l.id),
  ]);
  const pub = events.filter(e => e.status === "published");
  const lastActivity = new Date(
    Math.max(l.updatedAt.getTime(), ...events.map(e => e.createdAt.getTime()), ...metrics.map(m => m.updatedAt.getTime())),
  );
  return {
    address: formatFreeAddress(l.address),
    price: formatCents(l.priceCents) ?? null,
    status: l.status,
    photoUrl: l.photoUrl,
    liveDate: l.liveDate,
    links: l.links,
    sellerFirstName: l.sellerName.split(/\s+/)[0] ?? l.sellerName,
    agent: { name: l.agentName, phone: agent?.phone ?? null, email: agent?.email ?? l.agentEmail },
    steps: l.steps.map(s => ({ key: s.key, done: s.done, doneAt: s.doneAt ?? null, note: s.note ?? null })),
    metrics: metrics.map(m => ({ weekOf: m.weekOf, ...metricNumbers(m), auto: m.auto, updatedAt: m.updatedAt })),
    counts: {
      showings: showingCount(events),
      feedback: pub.filter(e => e.kind === "feedback").length,
      openHouse: oh.length,
    },
    events: pub
      .filter(e => e.kind !== "cancelled")
      .slice(0, 60)
      .map(e => ({ id: e.id, kind: e.kind, title: e.title, body: e.body, interest: e.interest, priceOpinion: e.priceOpinion, rating: e.rating, when: e.when, createdAt: e.createdAt })),
    ads,
    social: { reelCheckedAt: l.reelAuto?.checkedAt ?? null, youtubeCheckedAt: l.ytAuto?.checkedAt ?? null },
    suggestions: suggestions
      .filter(r => r.status === "published")
      .map(r => ({ id: r.id, title: r.title, why: r.why, action: r.action, approvedAt: r.approvedAt })),
    zillowTotals: l.zillowPage ? { views: l.zillowPage.views, saves: l.zillowPage.saves } : null,
    updatedAt: lastActivity,
  };
}

/** The seller opened their page (recorded at most every 10 minutes). */
export async function markSeen(token: string) {
  const l = await byToken(token);
  if (l && (!l.sellerLastSeenAt || Date.now() - l.sellerLastSeenAt.getTime() > 10 * 60e3)) {
    await repo.updateListing(l.id, { sellerLastSeenAt: new Date(), updatedAt: l.updatedAt });
  }
  return { ok: true };
}

export async function approvePlan(token: string) {
  const l = await byToken(token);
  if (!l) throw notFound("This link has expired. Ask your agent for a new one.");
  const open = (await repo.listSuggestions(l.id)).filter(r => r.status === "published" && !r.approvedAt);
  if (!open.length) return { ok: true };
  const now = new Date();
  await repo.approveSuggestions(
    open.map(r => r.id),
    now,
  );
  await repo.insertEvent({
    listingId: l.id,
    kind: "approval",
    status: "published",
    source: "seller",
    title: `${l.sellerName.split(/\s+/)[0]} approved the plan`,
    body: open.map(r => `• ${r.title}`).join("\n"),
  });
  await repo.touchListing(l.id);
  await mailPlanApproved({ id: l.id, address: formatFreeAddress(l.address), agentEmail: l.agentEmail }, open.map(r => r.title));
  return { ok: true };
}

// ---------- For other modules ----------

/** Listings open houses can be held on (Coming soon / Active), newest first. */
export async function openHouseListings() {
  return (await repo.listListings())
    .filter(l => l.status === "Coming soon" || l.status === "Active")
    .map(l => ({ id: l.id, address: formatFreeAddress(l.address), agentName: l.agentName }));
}

/** One listing's address and agent (any agent may host an open house on a team listing). */
export async function listingForOpenHouse(id: string) {
  const l = await repo.findListingById(id);
  return l ? { id: l.id, address: formatFreeAddress(l.address), agentName: l.agentName } : undefined;
}

/** A listing the user may manage (their own, or any for admins/ops); 404 otherwise. For other modules. */
export async function manageableListing(actor: AuthUser, id: string) {
  const l = await mine(actor, id);
  return { listing: l, staff: isStaff(actor), address: formatFreeAddress(l.address), price: formatCents(l.priceCents) };
}

/** Ticks a launch step (e.g. "ads" when an ad order goes live). No-op if already done. */
export async function tickLaunchStep(listingId: string, key: string) {
  const l = await repo.findListingById(listingId);
  if (!l || l.steps.find(s => s.key === key)?.done) return;
  const now = new Date().toISOString();
  await repo.updateListing(listingId, { steps: l.steps.map(s => (s.key === key ? { ...s, done: true, doneAt: now } : s)) });
}

/** Saves the social video links (Instagram = the "Instagram Reel" link in Details). null clears one. */
export async function setSocialLinks(listingId: string, links: { reel: string | null; youtube: string | null; tiktok: string | null; facebook: string | null }) {
  const l = await repo.findListingById(listingId);
  if (!l) throw notFound("Listing not found.");
  const next: ListingLinks = { ...l.links };
  for (const [k, v] of Object.entries(links) as [keyof ListingLinks, string | null][]) {
    if (v) next[k] = v;
    else delete next[k];
  }
  return (await repo.updateListing(listingId, { links: next }))!;
}

const SOCIAL_FIELDS = { reel: "reelViews", youtube: "youtubeViews", tiktok: "tiktokViews", facebook: "fbViews" } as const;

/** Writes fetched views into this week's numbers (lifetime totals), marked automatic. */
export async function applySocialViews(listingId: string, views: Partial<Record<keyof typeof SOCIAL_FIELDS, number | null>>) {
  const wk = weekOf(Date.now());
  const cur = await repo.findMetric(listingId, wk);
  const values: Record<string, number | null> = {};
  for (const k of [...(Object.keys(SOCIAL_FIELDS) as (keyof typeof SOCIAL_FIELDS)[]), "zillowViews", "zillowSaves", "mlsSaved", "mlsMaybe", "mlsNotInterested", "adViews", "adClicks"]) {
    const field = (k in SOCIAL_FIELDS ? SOCIAL_FIELDS[k as keyof typeof SOCIAL_FIELDS] : k) as keyof ListingMetricRow;
    values[field] = (cur?.[field] as number | null | undefined) ?? null;
  }
  const auto = new Set(cur?.auto ?? []);
  for (const [k, v] of Object.entries(views) as [keyof typeof SOCIAL_FIELDS, number | null][]) {
    if (v == null) continue;
    values[SOCIAL_FIELDS[k]] = v;
    auto.add(k);
  }
  await repo.upsertMetric(listingId, wk, { ...values, auto: [...auto], zillowDays: cur?.zillowDays ?? null, enteredByEmail: cur?.enteredByEmail ?? "auto" });
  await repo.touchListing(listingId);
}

// ---------- Emails (scheduled + alerts) ----------

/** Agent alert: feedback waiting for review on this listing (used when feedback arrives without them). */
export async function notifyFeedbackToReview(listingId: string) {
  const l = await repo.findListingById(listingId);
  if (!l) return;
  const pending = (await repo.listEvents(listingId)).filter(e => e.status === "pending").length;
  if (pending) await mailFeedbackToReview({ id: l.id, address: formatFreeAddress(l.address), agentEmail: l.agentEmail }, pending);
}

/** Planned-mail job (queued by older code): send the "seller approved the plan" email. */
export async function sendPlanApprovedMail(listingId: string, titles: string[]) {
  const l = await repo.findListingById(listingId);
  if (l) await mailPlanApproved({ id: l.id, address: formatFreeAddress(l.address), agentEmail: l.agentEmail }, titles);
}

/** Live listings with this week's status, the last numbers and 7-day activity (weekly emails). */
async function digest(): Promise<DigestRow[]> {
  const wk = weekOf(Date.now());
  const prev = weekOf(Date.now() - 7 * 864e5);
  const weekAgo = Date.now() - 7 * 864e5;
  const rows = await repo.listLive();
  return Promise.all(
    rows.map(async l => {
      const [m, ev] = await Promise.all([repo.listMetrics(l.id), repo.listEvents(l.id)]);
      const last = m.find(x => x.weekOf === prev) ?? [...m].sort((a, b) => b.weekOf.localeCompare(a.weekOf))[0] ?? null;
      return {
        id: l.id,
        address: formatFreeAddress(l.address),
        agentEmail: l.agentEmail,
        agentName: l.agentName,
        sellerName: l.sellerName,
        sellerEmail: l.sellerEmail,
        weeklyEmail: l.weeklyEmail,
        token: l.token,
        hasThisWeek: m.some(x => x.weekOf === wk && x.enteredByEmail !== "auto"),
        showings7: ev.filter(e => e.kind === "showing" && e.createdAt.getTime() > weekAgo).length,
        feedback7: ev.filter(e => e.kind === "feedback" && e.status === "published" && e.createdAt.getTime() > weekAgo).length,
        stepsDone: l.steps.filter(s => s.done).length,
        stepsTotal: l.steps.length,
        last: last ? { zillowViews: last.zillowViews, zillowSaves: last.zillowSaves, mlsSaved: last.mlsSaved, mlsMaybe: last.mlsMaybe, mlsNotInterested: last.mlsNotInterested, adViews: last.adViews } : null,
      };
    }),
  );
}

/** Monday ~9am Chicago: agents with live listings missing this week's numbers. */
export async function runMondayReminders() {
  return mailMondayReminders(await digest());
}

/** Tuesday ~10am Chicago: ops get the listings still missing numbers. */
export async function runTuesdayNudge() {
  return mailTuesdayNudge(await digest(), await users.listEmailsByRoles(["ops"]));
}

/** Monday ~5pm Chicago: weekly report to sellers who switched it on. */
export async function runSellerWeekly() {
  return mailSellerWeekly(await digest());
}
