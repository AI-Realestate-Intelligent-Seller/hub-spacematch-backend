// Tells the CMA worker service (e.g. on Render) that a job is waiting, so it starts within a second instead
// of at its next poll. Best effort: the worker also polls the jobs table every CMA_WORKER_POLL_MS, so a
// failed or skipped wake only delays the job. Off unless CMA_WORKER_URL and CMA_WORKER_SECRET are set.
import { config } from "../../config/index.js";
import { logger } from "../../utils/logger.js";

export async function wakeWorker(reason: string): Promise<void> {
  const { url, secret } = config.cmaBuilder.worker;
  if (!url || !secret) return;
  try {
    const res = await fetch(`${url}/wake`, {
      method: "POST",
      headers: { "x-worker-secret": secret, "content-type": "application/json" },
      body: JSON.stringify({ reason }),
      // Short: a sleeping or busy worker must never hold up the agent's request.
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) logger.warn("cma worker: wake refused", { status: res.status, reason });
  } catch (e) {
    logger.warn("cma worker: wake failed (it will poll)", { reason, error: String(e) });
  }
}
