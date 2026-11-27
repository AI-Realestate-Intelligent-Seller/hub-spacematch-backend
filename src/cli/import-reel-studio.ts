// Import an extracted Convex snapshot. Dry run is the default.
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { getDb, getOrm } from "../db/client.js";
import { putObject } from "../integrations/storage/storage.client.js";
import { enqueue } from "../modules/jobs/job.service.js";
import { type Clip, type Output, type Payment, reelAssets, reelOrders } from "../modules/reel-studio/reel.model.js";
import { REEL_RENDER } from "../modules/reel-studio/reel.service.js";

const directory = process.argv[2];
const apply = process.argv[3] === "--apply";
if (!directory || (process.argv[3] && !apply)) throw new Error("Usage: node dist/cli/import-reel-studio.js <extracted-snapshot> [--apply]");
const id = z.string().regex(/^[\w-]+$/);
const time = z.number().int().nonnegative();
const assetSchema = z.object({
  _id: id, agentEmail: z.email(), name: z.string(), size: z.number().int().nonnegative(), mimeType: z.string(), parts: z.array(id),
  driveFileId: id.optional(), createdAt: time,
});
const orderSchema = z.object({
  _id: id, agentEmail: z.email(), agentName: z.string(), tier: z.enum(["quick", "signature"]),
  price: z.number().nonnegative(), free: z.boolean().optional(),
  options: z.object({ lengthSec: z.number().min(15).max(60), formats: z.array(z.enum(["instagram", "tiktok", "shorts", "fb_reel", "fb_feed", "youtube"])).min(1),
    sample: z.object({ storageId: id.optional(), link: z.url().optional() }).passthrough().optional() }).passthrough(),
  clips: z.array(z.object({ id: z.string(), name: z.string(), role: z.string().optional() })),
  notes: z.string().optional(),
  payments: z.array(z.object({ kind: z.enum(["order", "revision"]), amount: z.number().nonnegative(), code: z.string().min(1),
    status: z.enum(["awaiting", "sent", "confirmed", "rejected"]), sentAt: time.optional(), confirmedAt: time.optional(),
    confirmedBy: z.string().optional(), note: z.string().optional(), method: z.string().optional() })),
  revisions: z.array(z.object({ note: z.string(), at: time, paid: z.boolean(), kind: z.literal("captions").optional(), edits: z.array(z.object({ i: z.number(), text: z.string() })).optional() })),
  outputs: z.array(z.object({ format: z.string().regex(/^[\w-]+$/), storageId: id, version: z.number().int().nonnegative(), size: z.number().int().nonnegative() })),
  captionLines: z.array(z.object({ i: z.number(), start: z.number(), end: z.number(), text: z.string() })).optional(),
  version: z.number().int().nonnegative(), costCredits: z.number().int().nonnegative().default(0), viktorNote: z.string().optional(),
  status: z.enum(["awaiting_payment", "payment_sent", "queued", "editing", "needs_info", "delivered", "revision_payment", "done", "cancelled"]),
  statusNote: z.string().optional(), question: z.string().optional(), answer: z.string().optional(),
  queuedAt: time.optional(), createdAt: time, updatedAt: time,
});

async function documents<T>(table: string, schema: z.ZodType<T>, optional = false) {
  const contents = await readFile(join(directory!, table, "documents.jsonl"), "utf8").catch(error => {
    if (optional && error.code === "ENOENT") return "";
    throw error;
  });
  return contents.split(/\r?\n/).filter(Boolean).map(line => schema.parse(JSON.parse(line)));
}

async function main() {
  const [assets, orders, files] = await Promise.all([
    documents("reelUploads", assetSchema, true), documents("reelOrders", orderSchema), readdir(join(directory!, "_storage")),
  ]);
  const byId = new Map(assets.map(a => [a._id, a]));
  const uploads = new Map<string, { path: string; type: string }>();
  async function file(storageId: string, key: string, type: string) {
    const filename = files.find(name => name === storageId || name.startsWith(`${storageId}.`));
    if (!filename) throw new Error(`Missing snapshot storage file ${storageId}.`);
    const path = join(directory!, "_storage", filename);
    const size = (await stat(path)).size;
    uploads.set(key, { path, type });
    return size;
  }
  const assetRows: (typeof reelAssets.$inferInsert)[] = [];
  for (const asset of assets) {
    if (!asset.parts.length) continue; // Already mirrored to the assigned Drive folder.
    let size = 0;
    for (const [i, part] of asset.parts.entries()) {
      size += await file(part, `reels/assets/${asset._id}/${i}`, "application/octet-stream");
    }
    if (size !== asset.size) throw new Error(`Upload size mismatch for ${asset._id}.`);
    assetRows.push({ id: asset._id, owner: asset.agentEmail.toLowerCase(), name: asset.name, mimeType: asset.mimeType, size, parts: asset.parts.length, ready: 1, createdAt: new Date(asset.createdAt) });
  }
  const records: (typeof reelOrders.$inferInsert)[] = [];
  for (const source of orders) {
    const status = source.status === "editing" ? "queued" : source.status;
    const mayEdit = status !== "cancelled" && status !== "done" && status !== "delivered";
    const clips: Clip[] = source.clips.map(clip => {
      if (!clip.id.startsWith("hub:")) return { ...clip, driveId: id.parse(clip.id) };
      const asset = byId.get(clip.id.slice(4));
      if (asset && asset.agentEmail.toLowerCase() !== source.agentEmail.toLowerCase()) throw new Error(`Mismatched clip owner on order ${source._id}.`);
      if (asset?.parts.length) return { ...clip, keys: asset.parts.map((_, i) => `reels/assets/${asset._id}/${i}`) };
      if (asset?.driveFileId) return { ...clip, driveId: asset.driveFileId };
      if (mayEdit) throw new Error(`Missing clip ${clip.id} for open order ${source._id}.`);
      return clip;
    });
    const outputs: Output[] = [];
    for (const output of source.outputs) {
      const key = `reels/legacy/${source._id}/${output.storageId}.mp4`;
      const size = await file(output.storageId, key, "video/mp4");
      if (size !== output.size) throw new Error(`Output size mismatch for ${source._id}.`);
      outputs.push({ key, size, format: output.format, version: output.version });
    }
    const options: Record<string, unknown> = { ...source.options };
    if (source.options.sample?.storageId) {
      const key = `reels/legacy/${source._id}/reference.video`;
      await file(source.options.sample.storageId, key, "application/octet-stream");
      options.sampleKeys = [key];
    }
    if (mayEdit && source.options.sample?.link) throw new Error(`Open order ${source._id} uses a reference link. Resolve it before cutover.`);
    const payments: Payment[] = source.payments.map(p => ({ ...p, amount: Math.round(p.amount * 100), status: p.status === "rejected" ? "awaiting" : p.status }));
    records.push({
      id: source._id, owner: source.agentEmail.toLowerCase(), agentName: source.agentName, tier: source.tier,
      price: Math.round(source.price * 100), free: +!!source.free, status, options, clips, notes: source.notes,
      payments, revisions: source.revisions, captionLines: source.captionLines ?? [], outputs, legacyCostCredits: source.costCredits,
      deliveryNote: source.viktorNote, statusNote: source.statusNote, question: source.question, answer: source.answer,
      version: Math.max(0, ...outputs.map(o => o.version)), generation: status === "queued" ? 1 : 0,
      queuedAt: source.queuedAt ? new Date(source.queuedAt) : null,
      createdAt: new Date(source.createdAt), updatedAt: new Date(source.updatedAt),
    });
  }
  console.log(`${apply ? "Importing" : "Validated snapshot:"} ${records.length} orders, ${assetRows.length} uploads and ${uploads.size} stored files.`);
  if (!apply) return;

  for (const [key, file] of uploads) await putObject(key, await readFile(file.path), file.type);
  try {
    await getOrm().transaction(async tx => {
      for (const row of assetRows) await tx.insert(reelAssets).values(row).onConflictDoNothing();
      for (const row of records) {
        const [inserted] = await tx.insert(reelOrders).values(row).onConflictDoNothing().returning({ id: reelOrders.id });
        if (inserted && row.status === "queued") await enqueue(REEL_RENDER, { id: row.id, generation: row.generation }, new Date(), tx);
      }
    });
  } finally {
    await getDb().end();
  }
  console.log("Import complete.");
}
await main();
