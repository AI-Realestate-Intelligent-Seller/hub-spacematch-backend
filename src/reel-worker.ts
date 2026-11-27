import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { config } from "./config/index.js";
import { getDb, getOrm } from "./db/client.js";
import { sendMail } from "./integrations/email/mailer.js";
import { pushToEmail } from "./modules/announcements/announcement.service.js";
import { claimOne, enqueue, failJob, finishJob } from "./modules/jobs/job.service.js";
import { reelOrders } from "./modules/reel-studio/reel.model.js";
import { ReelNeedsInfo, render, testRenderIo } from "./modules/reel-studio/reel-render.js";
import { REEL_NOTIFY, REEL_RENDER } from "./modules/reel-studio/reel.service.js";
import { logger } from "./utils/logger.js";

const stop = new AbortController();
process.once("SIGTERM", () => stop.abort());
process.once("SIGINT", () => stop.abort());

async function notify(payload: Record<string, unknown>) {
  const { id, event, code, testRecipient } = z.object({ id: z.string(), event: z.string(), code: z.string().optional(), testRecipient: z.email().optional() }).parse(payload);
  const [order] = await getOrm().select().from(reelOrders).where(eq(reelOrders.id, id));
  if (!order) return;
  const payment = order.payments.find(p => p.code === code);
  if (event === "payment_sent" && (order.status !== "payment_sent" || payment?.status !== "sent")) return;
  const to = event === "payment_sent" ? (payment?.test ? testRecipient : config.reelStudio.alertEmail ?? config.reelStudio.confirmers[0]) : order.owner;
  if (!to) throw new Error("Reel payment alert recipient is missing.");
  const subjects: Record<string, string> = {
    payment_sent: `${payment?.test ? "Test reel payment" : "Reel Zelle payment"} to review · ${payment?.code ?? ""}`,
    payment_missing: "Your reel payment needs attention",
    delivered: "Your reel is ready",
    needs_info: "Your reel needs more information",
  };
  const subject = subjects[event];
  if (!subject) return;
  const tab = event === "payment_sent" ? "orders" : "mine";
  const url = `${config.appUrl}/reels?tab=${tab}`;
  const result = await sendMail({ to, subject, text: `${subject}\n\nOpen Reel Studio: ${url}`, html: `<p>Open Reel Studio to review this update.</p><p><a href="${url}">Open Reel Studio</a></p>`, tag: `reel:${event}` });
  if (result.status === "failed") throw new Error(result.error);
  await pushToEmail(to, { title: subject, body: "Open Reel Studio to review this update.", url: `/reels?tab=${tab}` });
}

async function renderJob(payload: Record<string, unknown>, attempts: number) {
  const { id, generation } = z.object({ id: z.string(), generation: z.number().int() }).parse(payload);
  const db = getOrm();
  const identity = and(eq(reelOrders.id, id), eq(reelOrders.generation, generation));
  const pickedUpAt = new Date();
  const [order] = await db.update(reelOrders).set({ status: "editing", stage: "clips", pickedUpAt, updatedAt: pickedUpAt, statusNote: null })
    .where(and(identity, inArray(reelOrders.status, ["queued", "editing"]))).returning();
  if (!order) return;
  const current = and(identity, eq(reelOrders.status, "editing"), eq(reelOrders.pickedUpAt, pickedUpAt));
  const stage = async (name: string) => {
    const [row] = await db.update(reelOrders).set({ stage: name, updatedAt: new Date() }).where(current).returning({ id: reelOrders.id });
    if (!row) throw new Error("Reel job no longer owns this order.");
  };
  try {
    const testOrder = order.payments.some(payment => payment.test);
    const useTestRenderer = testOrder && config.reelStudio.testPayments && !config.reelStudio.editingConfigured;
    if (testOrder && !config.reelStudio.testPayments) throw new Error("Test reel payments are disabled on the worker.");
    if (!useTestRenderer && !config.reelStudio.editingConfigured) throw new Error("AI reel editing is not configured on the worker.");
    const output = await render(order, AbortSignal.any([stop.signal, AbortSignal.timeout(12 * 60_000)]), stage, randomUUID(), useTestRenderer ? testRenderIo : undefined);
    await db.transaction(async tx => {
      const [row] = await tx.update(reelOrders).set({
        ...output, outputs: [...order.outputs, ...output.outputs],
        deliveryNote: useTestRenderer ? "Test render. Clips were joined in order. AI editing and captions require provider credentials." : null,
        status: "delivered", stage: null, statusNote: null, updatedAt: new Date(),
      }).where(current).returning({ id: reelOrders.id });
      if (row) await enqueue(REEL_NOTIFY, { id, event: "delivered" }, new Date(), tx);
    });
  } catch (error) {
    const needsInfo = error instanceof ReelNeedsInfo;
    const final = !stop.signal.aborted && attempts >= 3;
    await db.transaction(async tx => {
      const [row] = await tx.update(reelOrders).set({
        status: needsInfo ? "needs_info" : final ? "failed" : "queued", stage: null,
        question: needsInfo ? error.message : null,
        statusNote: needsInfo ? "Please review the editor’s question." : final ? "Editing could not finish. Staff can retry this order." : "Waiting to retry editing.",
        updatedAt: new Date(),
      }).where(current).returning({ id: reelOrders.id });
      if (row && needsInfo) await enqueue(REEL_NOTIFY, { id, event: "needs_info" }, new Date(), tx);
    });
    if (!needsInfo) throw error;
  }
}

async function work(kind: string) {
  while (!stop.signal.aborted) {
    try {
      const job = await claimOne([kind]);
      if (!job) {
        await sleep(2000, undefined, { signal: stop.signal }).catch(() => {});
        continue;
      }
      try {
        if (job.kind === REEL_NOTIFY) await notify(job.payload);
        else await renderJob(job.payload, job.attempts);
        await finishJob(job.id);
      } catch (error) {
        logger.warn("Reel job failed", { jobId: job.id, error: String(error) });
        if (!stop.signal.aborted) await failJob(job.id, job.attempts, String(error));
      }
    } catch (error) {
      logger.error("Reel queue unavailable", { error: String(error) });
      await sleep(5000, undefined, { signal: stop.signal }).catch(() => {});
    }
  }
}
await Promise.all([work(REEL_NOTIFY), work(REEL_RENDER)]);
await getDb().end();
