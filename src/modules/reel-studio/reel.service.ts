import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { config } from "../../config/index.js";
import { getOrm } from "../../db/client.js";
import { objectSize, signedDownloadUrl, signedUploadUrl } from "../../integrations/storage/storage.client.js";
import type { AuthUser } from "../../types/auth.js";
import { badRequest, conflict, forbidden, notFound, serviceUnavailable } from "../../utils/http-error.js";
import { newId, randomString } from "../../utils/id.js";
import { enqueue } from "../jobs/job.service.js";
import { users } from "../users/user.model.js";
import { driveClips } from "./reel-drive.js";
import { type Clip, type Payment, type ReelOrder, reelAssets, reelOrders } from "./reel.model.js";

export const REEL_RENDER = "reelStudio.render";
export const REEL_NOTIFY = "reelStudio.notify";
const CHUNK = 16 * 1024 ** 2;
const MAX_CLIP_BYTES = 5 * 1024 ** 3;
const FREE = 5;
const tiers = {
  quick: { price: 1200, maxClips: 3, seconds: 30, revisions: 1, name: "Quick" },
  signature: { price: 2500, maxClips: 10, seconds: 60, revisions: 2, name: "Signature" },
};
const formats = ["instagram", "tiktok", "shorts", "fb_reel", "fb_feed", "youtube"];
export const staff = (actor: AuthUser) => actor.role === "admin" || actor.role === "ops";
const canTest = (actor: AuthUser) => config.reelStudio.testPayments &&
  (staff(actor) || actor.role === "agent");
const testOrder = sql`exists (select 1 from jsonb_array_elements(${reelOrders.payments}) p where p->>'test' = 'true')`;
const canConfirm = (actor: AuthUser) => staff(actor) && config.reelStudio.confirmers.includes(actor.email.toLowerCase());
const assetKey = (id: string, part: number) => `reels/assets/${id}/${part}`;
const freeRevisions = (row: ReelOrder) => Math.max(0, (tiers[row.tier as keyof typeof tiers]?.revisions ?? 0) - row.revisions.filter(r => !r.paid && r.kind !== "captions").length);
const openPayment = (row: ReelOrder) => row.payments.find(p => p.status !== "confirmed");
const paid = (row: ReelOrder) => row.payments.filter(p => p.status === "confirmed" && !p.test).reduce((sum, p) => sum + p.amount, 0) / 100;

async function account(actor: AuthUser, as?: string) {
  const owner = (as ?? actor.email).toLowerCase();
  if (owner !== actor.email.toLowerCase() && !staff(actor)) throw forbidden("Staff access required.");
  const [user] = await getOrm().select().from(users).where(eq(users.email, owner));
  if (!user || user.status !== "active") throw notFound("Agent not found.");
  return { owner, name: user.name, phone: user.phone, photoKey: user.photoKey, driveFolderId: user.driveFolderId };
}

async function remaining(owner: string, db: Pick<ReturnType<typeof getOrm>, "select"> = getOrm()) {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(reelOrders)
    .where(and(eq(reelOrders.owner, owner), eq(reelOrders.free, 1), sql`${reelOrders.status} <> 'cancelled'`));
  return Math.max(0, FREE - (row?.n ?? 0));
}

export const asQuery = z.object({ as: z.email().optional() });
export async function freeInfo(actor: AuthUser, as?: string) {
  return { left: await remaining((await account(actor, as)).owner), total: FREE };
}

export async function configuration(actor: AuthUser) {
  const isStaff = staff(actor);
  const agents = isStaff ? await getOrm().select({ name: users.name, email: users.email }).from(users).where(and(eq(users.status, "active"), inArray(users.role, ["agent", "ops", "admin"]))) : [];
  const [count] = canConfirm(actor) || canTest(actor)
    ? await getOrm().select({ n: sql<number>`count(*)::int` }).from(reelOrders).where(and(
      eq(reelOrders.status, "payment_sent"),
      isStaff ? undefined : eq(reelOrders.owner, actor.email.toLowerCase()),
      sql`exists (select 1 from jsonb_array_elements(${reelOrders.payments}) p where p->>'status' = 'sent'
        and case when p->>'test' = 'true' then ${canTest(actor)}::boolean else ${canConfirm(actor)}::boolean end)`,
    ))
    : [];
  return { isStaff, isAdmin: isStaff, canConfirm: canConfirm(actor), canTestPayments: canTest(actor), toConfirm: count?.n ?? 0, zelleTo: config.reelStudio.recipient ?? "", myCell: (await account(actor)).phone, agents };
}

export const uploadBody = z.object({ name: z.string().trim().min(1).max(180), size: z.number().int().min(1).max(MAX_CLIP_BYTES), mimeType: z.string().regex(/^video\/[\w.+-]+$/), as: z.email().optional() });
export async function beginUpload(actor: AuthUser, input: z.infer<typeof uploadBody>) {
  const { owner } = await account(actor, input.as);
  const id = newId();
  const parts = Math.ceil(input.size / CHUNK);
  const urls = await Promise.all(Array.from({ length: parts }, (_, part) => signedUploadUrl(assetKey(id, part), "application/octet-stream", 3600)));
  await getOrm().insert(reelAssets).values({ id, owner, name: input.name, size: input.size, mimeType: input.mimeType, parts });
  return { id, urls, chunkSize: CHUNK };
}

export async function finishUpload(actor: AuthUser, id: string, as?: string) {
  const { owner } = await account(actor, as);
  const [asset] = await getOrm().select().from(reelAssets).where(and(eq(reelAssets.id, id), eq(reelAssets.owner, owner)));
  if (!asset) throw notFound("Upload not found.");
  if (!asset.ready) {
    for (let start = 0; start < asset.parts; start += 24) {
      const parts = Array.from({ length: Math.min(24, asset.parts - start) }, (_, i) => start + i);
      const sizes = await Promise.all(parts.map(part => objectSize(assetKey(id, part))));
      if (sizes.some((size, i) => size !== Math.min(CHUNK, asset.size - parts[i]! * CHUNK))) {
        throw conflict("Some clip parts are missing. Upload them again.");
      }
    }
    await getOrm().update(reelAssets).set({ ready: 1 }).where(eq(reelAssets.id, id));
  }
  return { id: `hub:${id}`, name: asset.name, link: "hub", size: asset.size, mimeType: asset.mimeType };
}

export async function assetList(actor: AuthUser, as?: string) {
  const { owner } = await account(actor, as);
  const assets = await getOrm().select().from(reelAssets).where(and(eq(reelAssets.owner, owner), eq(reelAssets.ready, 1))).orderBy(desc(reelAssets.createdAt)).limit(100);
  return assets.map(a => ({ id: `hub:${a.id}`, name: a.name, mimeType: a.mimeType, size: a.size, link: "hub" }));
}
export async function driveList(actor: AuthUser, as?: string) {
  const { owner, driveFolderId } = await account(actor, as);
  return { email: owner, checkedAt: Date.now(), files: await driveClips(owner, driveFolderId) };
}

export const placeBody = z.object({
  requestId: z.uuid(),
  testPayment: z.boolean().optional(),
  tier: z.enum(["quick", "signature"]),
  options: z.object({
    purpose: z.string().max(40),
    title: z.string().max(120).optional(),
    address: z.string().max(160).optional(),
    style: z.string().max(40),
    palette: z.string().max(40),
    renderStyle: z.object({
      font: z.enum(["sans", "serif", "condensed", "rounded", "mono", "script"]),
      weight: z.number().int().min(400).max(900),
      upper: z.boolean(),
      caption: z.enum(["pop", "karaoke", "line", "box", "underline", "outline", "typewriter", "stack"]),
      motion: z.enum(["calm", "punchy", "glide", "snap"]),
      bg: z.string().regex(/^#[0-9a-f]{6}$/i),
      accent: z.string().regex(/^#[0-9a-f]{6}$/i),
      text: z.string().regex(/^#[0-9a-f]{6}$/i),
    }),
    logo: z.boolean(),
    headshot: z.boolean(),
    nameBar: z.boolean(),
    endCard: z.boolean(),
    captions: z.boolean(),
    captionSpot: z.enum(["high", "mid", "low"]).optional(),
    pace: z.enum(["calm", "normal", "fast"]),
    music: z.enum(["none", "none_trending"]),
    trendSound: z.string().max(120).optional(),
    cta: z.string().max(20),
    ctaText: z.string().max(80).optional(),
    broll: z.array(z.string().max(20)).max(7),
    autoOrder: z.boolean().optional(),
    formats: z.array(z.enum(formats as [string, ...string[]])).min(1).max(6),
    lengthSec: z.number().finite().min(15).max(60),
    sample: z.object({ storageId: z.string().max(128), fileName: z.string().max(180).optional(), size: z.number().optional(), match: z.array(z.enum(["edit", "story"])).max(2) }).optional(),
  }),
  clips: z.array(z.object({ id: z.string().regex(/^(hub|drive):[\w-]+$/).max(160), role: z.string().max(30).optional() })).min(1).max(10),
  notes: z.string().max(1500).optional(), as: z.email().optional(),
});

function makePayment(kind: Payment["kind"], amount: number, test = false): Payment {
  if (!test && (!config.reelStudio.recipient || !config.reelStudio.confirmers.length)) throw serviceUnavailable("Zelle payment details are not configured.");
  return { kind, amount, code: `${test ? "TEST-RS" : "RS"}-${randomString(12)}`, status: "awaiting", ...(test ? { test } : {}) };
}

export async function place(actor: AuthUser, input: z.infer<typeof placeBody>) {
  if (input.testPayment && !canTest(actor)) throw forbidden("Test payment access required.");
  const { owner, name, phone, photoKey, driveFolderId } = await account(actor, input.as);
  const tier = tiers[input.tier];
  if (input.clips.length > tier.maxClips) throw badRequest(`This package allows up to ${tier.maxClips} clips.`);
  if (!config.storage.isConfigured) throw serviceUnavailable("Reel file storage is not configured.");
  if (!input.testPayment && !config.reelStudio.editingConfigured) {
    throw serviceUnavailable("AI reel editing is not configured. When test payments are enabled, use Profile → Add test request to test the queue and rendering.");
  }
  const sample = input.options.sample;
  if (sample && !sample.storageId) throw badRequest("Upload a reference video to use it with this order.");
  const hubIds = input.clips.filter(c => c.id.startsWith("hub:")).map(c => c.id.slice(4));
  if (sample?.storageId) hubIds.push(sample.storageId.replace(/^hub:/, ""));
  const assets = hubIds.length ? await getOrm().select().from(reelAssets).where(and(eq(reelAssets.owner, owner), eq(reelAssets.ready, 1), inArray(reelAssets.id, hubIds))) : [];
  const driveIds = input.clips.filter(c => c.id.startsWith("drive:")).map(c => c.id.slice(6));
  const drive = driveIds.length ? await driveClips(owner, driveFolderId, [...new Set(driveIds)]) : [];
  const clips: Clip[] = input.clips.map(c => {
    const asset = assets.find(a => `hub:${a.id}` === c.id);
    if (asset) return { ...c, name: asset.name, keys: Array.from({ length: asset.parts }, (_, part) => assetKey(asset.id, part)) };
    const file = drive.find(f => f.id === c.id);
    if (!file) throw badRequest("A selected clip is no longer available.");
    if (file.size > MAX_CLIP_BYTES) throw badRequest("Use clips smaller than 5 GB.");
    return { ...c, name: file.name, driveId: file.id.slice(6) };
  });
  const reference = sample?.storageId ? assets.find(a => a.id === sample.storageId?.replace(/^hub:/, "")) : undefined;
  if (sample?.storageId && !reference) throw badRequest("The reference upload is unavailable.");
  return getOrm().transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${owner}))`);
    const id = input.requestId;
    const [existing] = await tx.select({ owner: reelOrders.owner }).from(reelOrders).where(eq(reelOrders.id, id));
    if (existing?.owner === owner) return id;
    if (existing) throw conflict("The order identifier is already in use.");
    const free = !input.testPayment && (await remaining(owner, tx)) > 0;
    const now = new Date();
    const options = { ...input.options, agentPhone: phone, photoKey, lengthSec: Math.min(input.options.lengthSec, tier.seconds), formats: [...new Set(input.options.formats)],
      sampleKeys: reference ? Array.from({ length: reference.parts }, (_, part) => assetKey(reference.id, part)) : undefined };
    await tx.insert(reelOrders).values({
      id, owner, agentName: name, tier: input.tier, price: free ? 0 : tier.price, free: +free, status: free ? "queued" : "awaiting_payment",
      queuedAt: free ? now : null, generation: free ? 1 : 0, clips, options, notes: input.notes, outputs: [], revisions: [], captionLines: [],
      payments: free ? [] : [makePayment("order", tier.price, input.testPayment)],
    });
    if (free) await enqueue(REEL_RENDER, { id, generation: 1 }, now, tx);
    return id;
  });
}

function paymentView(p: Payment) { return { ...p, amount: p.amount / 100 }; }
function publicOptions(options: ReelOrder["options"]) {
  const { agentPhone: _phone, photoKey: _photo, sampleKeys: _keys, ...publicData } = options;
  return publicData;
}
async function view(row: ReelOrder, includeCosts = false) {
  const payment = openPayment(row);
  return {
    _id: row.id, agentName: row.agentName, tierName: tiers[row.tier as keyof typeof tiers]?.name ?? row.tier,
    status: row.status, statusLabel: row.status.replaceAll("_", " "), statusNote: row.statusNote ?? undefined,
    createdAt: +row.createdAt, queuedAt: row.queuedAt ? +row.queuedAt : undefined, pickedUpAt: row.pickedUpAt ? +row.pickedUpAt : undefined,
    stage: row.stage ?? undefined, stageAt: +row.updatedAt, free: !!row.free, testOrder: row.payments.some(p => p.test), price: row.price / 100, paid: paid(row),
    notes: row.notes ?? undefined, question: row.question ?? undefined, options: publicOptions(row.options), clips: row.clips.map(({ id, name, role }) => ({ id, name, role })),
    openPayment: payment ? paymentView(payment) : null, payments: row.payments.map(paymentView),
    revisions: row.revisions.map((r, i) => ({ ...r, n: i + 1, at: r.at ?? +row.createdAt })), freeRevisionsLeft: freeRevisions(row), captionLines: row.captionLines, version: row.version, canEditCaptions: !!row.timeline,
    outputs: await Promise.all(row.outputs.filter(o => o.version === row.version).map(async o => ({ format: o.format, version: o.version, size: o.size, url: await signedDownloadUrl(o.key) }))),
    queueAhead: null, sampleUrl: null, costUsd: includeCosts ? row.legacyCostCredits * 0.0025 : 0, costCredits: includeCosts ? row.legacyCostCredits : 0, deliveryNote: row.deliveryNote ?? undefined,
  };
}

export async function mine(actor: AuthUser, as?: string) {
  const { owner } = await account(actor, as);
  const rows = await getOrm().select().from(reelOrders).where(eq(reelOrders.owner, owner)).orderBy(desc(reelOrders.createdAt)).limit(50);
  return Promise.all(rows.map(row => view(row)));
}

export async function queue(actor: AuthUser) {
  const isStaff = staff(actor);
  if (!isStaff && !canTest(actor)) throw forbidden("Payment review access required.");
  const rows = await getOrm().select().from(reelOrders)
    .where(isStaff ? undefined : and(eq(reelOrders.owner, actor.email.toLowerCase()), testOrder))
    .orderBy(desc(reelOrders.createdAt)).limit(300);
  const revenue = rows.reduce((sum, row) => sum + paid(row), 0);
  const owedToConfirm = rows.flatMap(row => row.payments).filter(p => p.status === "sent" && !p.test).reduce((sum, p) => sum + p.amount / 100, 0);
  const cost = rows.reduce((sum, row) => sum + row.legacyCostCredits * 0.0025, 0);
  return { orders: await Promise.all(rows.map(row => view(row, isStaff))), isStaff, canConfirm: canConfirm(actor), canTestPayments: canTest(actor), totals: { revenue, owedToConfirm, cost } };
}

export const actionBody = z.discriminatedUnion("action", [
  z.object({ action: z.literal("sent") }),
  z.object({ action: z.literal("confirm"), code: z.string(), received: z.boolean() }),
  z.object({ action: z.literal("revision"), note: z.string().trim().min(3).max(1500) }),
  z.object({ action: z.literal("captions"), edits: z.array(z.object({ i: z.number().int().nonnegative(), text: z.string().trim().min(1).max(200) })).min(1).max(200) }),
  z.object({ action: z.literal("answer"), text: z.string().trim().min(1).max(1500) }),
  z.object({ action: z.literal("cancel") }),
  z.object({ action: z.literal("done") }),
  z.object({ action: z.literal("retry") }),
]);

export async function transition(actor: AuthUser, id: string, input: z.infer<typeof actionBody>) {
  return getOrm().transaction(async tx => {
    const [order] = await tx.select().from(reelOrders).where(eq(reelOrders.id, id)).for("update");
    if (!order || (!staff(actor) && order.owner !== actor.email.toLowerCase())) throw notFound("Reel order not found.");
    const now = new Date();
    const patch: Partial<ReelOrder> = { updatedAt: now };
    const payment = openPayment(order);
    const awaiting = order.status === "awaiting_payment" || order.status === "revision_payment";
    const rendered = order.status === "delivered" || order.status === "done";
    const updatePayment = (p: Payment) => { patch.payments = order.payments.map(x => x.code === p.code ? p : x); };
    const queueRender = async () => {
      const generation = order.generation + 1;
      Object.assign(patch, { generation, status: "queued", stage: null, statusNote: null, queuedAt: now, question: null });
      await enqueue(REEL_RENDER, { id, generation }, now, tx);
    };

    switch (input.action) {
      case "sent":
        if (order.status === "payment_sent") return { ok: true };
        if (!awaiting || !payment) throw conflict("This order has no outstanding payment.");
        patch.status = "payment_sent";
        updatePayment({ ...payment, status: "sent", sentAt: +now });
        await enqueue(REEL_NOTIFY, { id, code: payment.code, event: "payment_sent", ...(payment.test ? { testRecipient: actor.email } : {}) }, now, tx);
        break;
      case "confirm":
        const target = order.payments.find(p => p.code === input.code);
        if (!(target?.test ? canTest(actor) : canConfirm(actor))) throw forbidden("Payment confirmation access required.");
        if (input.received && order.payments.some(p => p.code === input.code && p.status === "confirmed")) return { ok: true };
        if (!payment || payment.code !== input.code || order.status !== "payment_sent") throw conflict("This payment is no longer awaiting review.");
        if (input.received) {
          updatePayment({ ...payment, status: "confirmed", confirmedAt: +now, confirmedBy: actor.email });
          await queueRender();
        } else {
          updatePayment({ ...payment, status: "awaiting", sentAt: undefined, note: payment.test ? "Test payment rejected. Mark it sent again to retry." : "Payment not found. Check your bank transfer and try again." });
          patch.status = payment.kind === "order" ? "awaiting_payment" : "revision_payment";
          await enqueue(REEL_NOTIFY, { id, code: payment.code, event: "payment_missing" }, now, tx);
        }
        break;
      case "revision":
        if (!rendered) throw conflict("Wait for the current reel to finish.");
        patch.revisions = [...order.revisions, { note: input.note, at: +now, paid: freeRevisions(order) === 0 }];
        if (freeRevisions(order)) await queueRender();
        else {
          patch.payments = [...order.payments, makePayment("revision", 400, order.payments.some(p => p.test))];
          patch.status = "revision_payment";
        }
        break;
      case "captions":
        if (!rendered || !order.timeline) throw conflict("Caption editing is unavailable for this version.");
        if (input.edits.some(edit => !order.captionLines.some(line => line.i === edit.i))) throw badRequest("Unknown caption line.");
        patch.revisions = [...order.revisions, { note: "Caption corrections", at: +now, paid: false, kind: "captions", edits: input.edits }];
        await queueRender();
        break;
      case "answer":
        if (order.status !== "needs_info") throw conflict("There is no open question.");
        patch.answer = input.text;
        await queueRender();
        break;
      case "retry":
        if ((!staff(actor) && !(canTest(actor) && order.payments.some(p => p.test))) || order.status !== "failed") throw conflict("This order cannot be retried.");
        await queueRender();
        break;
      case "done":
        if (!rendered) throw conflict("This reel has not been delivered.");
        patch.status = "done";
        break;
      case "cancel":
        if (rendered || order.status === "cancelled" || (!staff(actor) && order.status !== "awaiting_payment")) throw conflict("This order cannot be cancelled here.");
        patch.status = "cancelled";
        break;
    }
    await tx.update(reelOrders).set(patch).where(eq(reelOrders.id, id));
    return { ok: true, needsPayment: patch.status === "revision_payment" };
  });
}
