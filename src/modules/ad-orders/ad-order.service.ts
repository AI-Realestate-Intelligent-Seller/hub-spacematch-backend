// Ad Kit orders (was convex/adOrders.ts). An agent orders a package for a listing and authorizes the
// charge (pay ahead, or from commission at closing + surcharge). Admins approve (the ad kit is built
// then), mark it live (ticks "Ads live" on the seller page) and settle payments. Ledger per agent.
import { type AdPricing, buildKit, DEFAULT_PRICING, priceOf } from "../../shared/ad-kit.js";
import type { AuthUser } from "../../types/auth.js";
import { badRequest, conflict, forbidden, notFound } from "../../utils/http-error.js";
import { enqueue } from "../jobs/job.service.js";
import { markRunningFromOrder } from "../listing-ads/listing-ad.service.js";
import { manageableListing, tickLaunchStep } from "../listings/listing.service.js";
import { getSetting, setSetting } from "../settings/setting.service.js";
import { findActiveUserByEmail, listEmailsByRoles } from "../users/user.service.js";
import { mailDecision, mailNewOrder, TIER_NAME } from "./ad-order.mail.js";
import type { AdOrderRow } from "./ad-order.model.js";
import * as repo from "./ad-order.repository.js";

const PRICING_KEY = "adkit:pricing";
const BILLABLE = ["approved", "live", "done"];
const isAdmin = (u: AuthUser) => u.role === "admin";
const emailOf = (u: AuthUser) => u.email.toLowerCase();

export async function getPricing(): Promise<AdPricing> {
  const saved = await getSetting<Partial<AdPricing> | null>(PRICING_KEY, null);
  return saved ? { ...DEFAULT_PRICING, ...saved } : DEFAULT_PRICING;
}

const view = ({ kit, ...o }: AdOrderRow) => ({ ...o, tierName: TIER_NAME[o.tier] ?? o.tier, hasKit: !!kit });

type LedgerRow = { agentEmail: string; agentName: string; owed: number; owedAhead: number; owedClosing: number; paid: number; feesEarned: number; feesPending: number; orders: number };

function ledgerOf(rows: AdOrderRow[]) {
  const by = new Map<string, LedgerRow>();
  for (const o of rows) {
    if (!BILLABLE.includes(o.status)) continue;
    const r = by.get(o.agentEmail) ?? { agentEmail: o.agentEmail, agentName: o.agentName, owed: 0, owedAhead: 0, owedClosing: 0, paid: 0, feesEarned: 0, feesPending: 0, orders: 0 };
    r.orders++;
    const smFee = o.fee + o.surcharge;
    if (o.paymentStatus === "paid" || o.paymentStatus === "deducted") {
      r.paid += o.total;
      r.feesEarned += smFee;
    } else {
      r.owed += o.total;
      r.feesPending += smFee;
      if (o.payment === "ahead") r.owedAhead += o.total;
      else r.owedClosing += o.total;
    }
    by.set(o.agentEmail, r);
  }
  const list = [...by.values()].sort((a, b) => b.owed - a.owed);
  const totals = list.reduce(
    (t, r) => ({ owed: t.owed + r.owed, paid: t.paid + r.paid, feesEarned: t.feesEarned + r.feesEarned, feesPending: t.feesPending + r.feesPending }),
    { owed: 0, paid: 0, feesEarned: 0, feesPending: 0 },
  );
  return { list, totals };
}

// ---------- Agent side ----------

export async function config(actor: AuthUser) {
  return { pricing: await getPricing(), isAdmin: isAdmin(actor), pending: isAdmin(actor) ? await repo.countRequested() : 0 };
}

export async function forListing(actor: AuthUser, listingId: string) {
  await manageableListing(actor, listingId);
  const rows = await repo.listForListing(listingId);
  return { orders: rows.map(o => ({ ...view(o), kit: o.kit ?? null })), isAdmin: isAdmin(actor) };
}

export async function place(actor: AuthUser, a: { listingId: string; tier: string; openHouse: boolean; payment: "ahead" | "closing"; note?: string | null }) {
  const { listing: l, address } = await manageableListing(actor, a.listingId);
  const open = await repo.listForListing(a.listingId);
  if (open.some(o => o.status === "requested")) throw conflict("There's already an ad order waiting for approval on this listing.");
  const p = priceOf(await getPricing(), a.tier, a.openHouse, a.payment);
  const o = await repo.insertOrder({
    listingId: l.id,
    address,
    agentEmail: l.agentEmail,
    agentName: l.agentName,
    tier: p.tier.key,
    openHouse: a.openHouse,
    payment: a.payment,
    spend: p.spend,
    fee: p.fee,
    surcharge: p.surcharge,
    total: p.total,
    status: "requested",
    paymentStatus: "unpaid",
    authorizedAt: new Date(),
    orderedByEmail: emailOf(actor),
    note: a.note ?? null,
  });
  await mailNewOrder(o, await listEmailsByRoles(["admin", "ops"]));
  return view(o);
}

export async function cancel(actor: AuthUser, id: string) {
  const o = await repo.findOrder(id);
  if (!o || !(isAdmin(actor) || o.agentEmail === emailOf(actor) || o.orderedByEmail === emailOf(actor))) throw notFound("Order not found.");
  if (o.status !== "requested") throw badRequest("Only orders still waiting for approval can be cancelled. Ask an admin.");
  return view(await repo.updateOrder(id, { status: "cancelled" }));
}

export async function mine(actor: AuthUser) {
  const rows = await repo.listForAgent(emailOf(actor));
  return { orders: rows.map(view), ledger: ledgerOf(rows).list[0] ?? null };
}

// ---------- Admin side ----------

function requireAdmin(actor: AuthUser) {
  if (!isAdmin(actor)) throw forbidden("Only admins can do that.");
}

export async function queue(actor: AuthUser) {
  requireAdmin(actor);
  const rows = await repo.listAll();
  return { orders: rows.map(view), ledger: ledgerOf(rows) };
}

export async function decide(actor: AuthUser, id: string, action: "approve" | "decline", tier?: string, note?: string | null) {
  requireAdmin(actor);
  const o = await repo.findOrder(id);
  if (!o) throw notFound("Order not found.");
  if (o.status !== "requested") throw conflict("This order was already decided.");
  const now = new Date();
  const recipients = [...new Set([o.agentEmail, o.orderedByEmail])];
  if (action === "decline") {
    const updated = await repo.updateOrder(id, { status: "declined", adminNote: note ?? null, decidedByEmail: emailOf(actor), decidedAt: now });
    await mailDecision(updated, recipients);
    return view(updated);
  }
  if (!o.listingId) throw badRequest("The listing for this order was deleted.");
  const { listing: l, address, price } = await manageableListing(actor, o.listingId);
  const pricing = await getPricing();
  const p = priceOf(pricing, tier ?? o.tier, o.openHouse, o.payment as "ahead" | "closing");
  const agent = await findActiveUserByEmail(l.agentEmail);
  const kit = buildKit(
    { address, price, agentName: l.agentName, agentPhone: agent?.phone ?? undefined, website: l.links.website, tour: l.links.tour, reel: l.links.reel },
    p.tier,
    o.openHouse,
    pricing.openHouse.spend,
  );
  const updated = await repo.updateOrder(id, {
    tier: p.tier.key,
    spend: p.spend,
    fee: p.fee,
    surcharge: p.surcharge,
    total: p.total,
    status: "approved",
    adminNote: note ?? null,
    decidedByEmail: emailOf(actor),
    decidedAt: now,
    kit,
  });
  // Paused Meta campaign draft: needs the Meta Ads connection (later); the job waits until then.
  await enqueue("adOrders.createMetaDraft", { orderId: id });
  // Ops deduct pay-at-closing orders on the commission sheet.
  const opsToo = o.payment === "closing" ? await listEmailsByRoles(["ops"]) : [];
  await mailDecision(updated, [...new Set([...recipients, ...opsToo])]);
  return view(updated);
}

export async function setStatus(actor: AuthUser, id: string, status: "live" | "done" | "approved") {
  requireAdmin(actor);
  const o = await repo.findOrder(id);
  if (!o || !BILLABLE.includes(o.status)) throw badRequest("Approve the order first.");
  const now = new Date();
  const updated = await repo.updateOrder(id, { status, liveAt: status === "live" ? (o.liveAt ?? now) : o.liveAt });
  // Seller page: tick the "Ads live" launch step and show the campaign as running.
  if (status === "live" && o.listingId) {
    await tickLaunchStep(o.listingId, "ads");
    await markRunningFromOrder(o.listingId);
  }
  return view(updated);
}

export async function setPayment(actor: AuthUser, id: string, paymentStatus: "unpaid" | "paid" | "deducted" | "rolled", note?: string | null) {
  requireAdmin(actor);
  const o = await repo.findOrder(id);
  if (!o) throw notFound("Order not found.");
  const settled = paymentStatus === "paid" || paymentStatus === "deducted";
  const stamp = `${new Date().toISOString().slice(0, 10)} ${emailOf(actor).split("@")[0]}`;
  return view(
    await repo.updateOrder(id, {
      paymentStatus,
      paymentNote: [o.paymentNote, `${stamp}: ${paymentStatus}${note ? ` — ${note}` : ""}`].filter(Boolean).join("\n"),
      settledAt: settled ? new Date() : null,
    }),
  );
}

export async function savePricing(actor: AuthUser, a: { tiers: { key: string; spend: number; fee: number }[]; ohSpend: number; ohFee: number; closingSurcharge: number }) {
  requireAdmin(actor);
  const cur = await getPricing();
  const tiers = cur.tiers.map(t => {
    const n = a.tiers.find(x => x.key === t.key);
    if (!n) return t;
    // Keep the channel split proportional to the new spend.
    const k = t.spend ? n.spend / t.spend : 1;
    const meta = Math.round(t.split.meta * k);
    const google = Math.round(t.split.google * k);
    return { ...t, spend: n.spend, fee: n.fee, split: { meta, google, youtube: Math.max(0, n.spend - meta - google) } };
  });
  await setSetting(PRICING_KEY, { tiers, openHouse: { spend: a.ohSpend, fee: a.ohFee }, closingSurcharge: a.closingSurcharge }, emailOf(actor));
  return getPricing();
}
