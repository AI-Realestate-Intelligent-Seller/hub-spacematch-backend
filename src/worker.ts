// Long-running worker for jobs that need a real browser (Chromium via Playwright) and can't run on
// Vercel's serverless functions: CMA browser collection and CMA PDF rendering. It also runs the
// API-safe CMA collection kind, so locally `npm run worker` is all a CMA needs.
//
//   npm run worker            (development: tsx)
//   npm run build && npm run worker:start   (production: any always-on VM / container; see Dockerfile.worker)
//
// Jobs live in the shared `jobs` table, so they survive restarts: a job left "running" by a worker
// that died is picked up again after 15 minutes. Each slot takes one job at a time.
//
// As its own service (Render; see render.yaml): with CMA_WORKER_PORT set it also serves
//   GET  /health  200 while the worker runs and the database answers (the host restarts it otherwise)
//   POST /wake    header x-worker-secret: CMA_WORKER_SECRET. The API calls it after queueing a CMA job,
//                 so idle slots check the queue now instead of at their next poll.
import { createServer, type Server } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import { config } from "./config/index.js";
import { closeDb, getOrm } from "./db/client.js";
import { recoverStale, runCollect, runRenderPdf } from "./modules/cma-builder/cma-builder.jobs.js";
import { JOB_COLLECT, JOB_COLLECT_BROWSER, JOB_RENDER_PDF } from "./modules/cma-builder/cma-builder.service.js";
import { closeBrowser } from "./modules/cma-builder/providers/browser/browser-pool.js";
import { sleep } from "./modules/cma-builder/providers/provider.types.js";
import { claimOne, failJob, finishJob, type JobHandler } from "./modules/jobs/job.service.js";
import { logger } from "./utils/logger.js";

const HANDLERS: Record<string, JobHandler> = {
  [JOB_COLLECT]: runCollect,
  [JOB_COLLECT_BROWSER]: runCollect,
  [JOB_RENDER_PDF]: runRenderPdf,
};
const KINDS = Object.keys(HANDLERS);
const MAX_ATTEMPTS = 3;

const stop = new AbortController();
let running = 0;
let lastJobAt: string | null = null;

// Idle slots sleep on this; /wake aborts it so they claim at once, then a fresh one is made.
let wakeUp = new AbortController();
function wakeSlots() {
  wakeUp.abort();
  wakeUp = new AbortController();
}

async function slot(n: number) {
  while (!stop.signal.aborted) {
    let job;
    try {
      job = await claimOne(KINDS);
    } catch (e) {
      logger.warn("worker: claim failed", { slot: n, error: String(e) });
    }
    if (!job) {
      await sleep(config.cmaBuilder.workerPollMs, AbortSignal.any([stop.signal, wakeUp.signal])).catch(() => {});
      continue;
    }
    running++;
    const started = Date.now();
    try {
      await HANDLERS[job.kind]!(job.payload);
      await finishJob(job.id);
      lastJobAt = new Date().toISOString();
      logger.info("worker: job done", { kind: job.kind, id: job.id, ms: Date.now() - started });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await failJob(job.id, job.attempts, msg, MAX_ATTEMPTS).catch(() => {});
      logger.warn("worker: job failed", { kind: job.kind, id: job.id, attempt: job.attempts, error: msg });
    } finally {
      running--;
    }
  }
}

const sameSecret = (sent: string, expected: string) => {
  const a = Buffer.from(sent);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

function startHttp(port: number): Server {
  const server = createServer((req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(body));
    };
    const path = (req.url ?? "/").split("?")[0];
    if (req.method === "GET" && (path === "/health" || path === "/")) {
      getOrm()
        .execute(sql`select 1`)
        .then(() => send(200, { ok: true, running, slots: config.cmaBuilder.browserConcurrency, lastJobAt }))
        .catch(e => send(503, { ok: false, error: "database unavailable", detail: String(e).slice(0, 200) }));
      return;
    }
    if (req.method === "POST" && path === "/wake") {
      const secret = config.cmaBuilder.worker.secret;
      const sent = req.headers["x-worker-secret"];
      if (!secret) return send(503, { ok: false, error: "CMA_WORKER_SECRET is not set on the worker" });
      if (typeof sent !== "string" || !sameSecret(sent, secret)) return send(401, { ok: false, error: "unauthorized" });
      req.resume(); // the body (a reason) isn't needed
      wakeSlots();
      return send(202, { ok: true });
    }
    send(404, { ok: false, error: "not found" });
  });
  server.listen(port, "0.0.0.0", () => logger.info("worker http listening", { port }));
  return server;
}

let http: Server | undefined;

async function main() {
  logger.info("worker started", { kinds: KINDS, slots: config.cmaBuilder.browserConcurrency, environment: config.env });
  if (config.cmaBuilder.worker.port) http = startHttp(config.cmaBuilder.worker.port);
  const recover = setInterval(() => void recoverStale().catch(e => logger.warn("worker: recover failed", { error: String(e) })), 10 * 60_000);
  recover.unref();
  await Promise.all(Array.from({ length: config.cmaBuilder.browserConcurrency }, (_, i) => slot(i)));
  clearInterval(recover);
}

async function shutdown(signal: string) {
  logger.info("worker stopping", { signal, running });
  stop.abort();
  http?.close();
  // Let running jobs finish for up to 30 s; anything left is retried later from the jobs table.
  const deadline = Date.now() + 30_000;
  while (running > 0 && Date.now() < deadline) await new Promise(r => setTimeout(r, 250));
  await closeBrowser();
  await closeDb().catch(() => {});
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

main().catch(e => {
  logger.error("worker crashed", { error: String(e) });
  process.exit(1);
});
