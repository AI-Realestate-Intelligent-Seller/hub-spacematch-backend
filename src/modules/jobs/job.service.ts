// Enqueue background work. Other modules call these; they never touch the jobs table.
import * as repo from "./job.repository.js";

export async function enqueue(kind: string, payload: Record<string, unknown> = {}, runAt = new Date()): Promise<void> {
  await repo.insertJobs([{ kind, payload, runAt }]);
}

/** Several jobs in one insert. */
export async function enqueueMany(items: { kind: string; payload?: Record<string, unknown> }[]): Promise<void> {
  const runAt = new Date();
  await repo.insertJobs(items.map(i => ({ kind: i.kind, payload: i.payload ?? {}, runAt })));
}

export type JobHandler = (payload: Record<string, unknown>) => Promise<void>;

/**
 * Runs due jobs that have a handler (others wait until their connector exists). Stops after
 * `budgetMs` so one run stays inside the function's time limit. Returns what happened.
 */
export async function runDueJobs(handlers: Record<string, JobHandler>, budgetMs = 50_000, maxAttempts = 5) {
  const started = Date.now();
  let done = 0;
  let failed = 0;
  while (Date.now() - started < budgetMs) {
    const batch = await repo.claimDue(Object.keys(handlers), 10);
    if (!batch.length) break;
    for (const job of batch) {
      try {
        await handlers[job.kind]!(job.payload);
        await repo.markDone(job.id);
        done++;
      } catch (e) {
        await repo.markFailed(job.id, job.attempts, e instanceof Error ? e.message : String(e), maxAttempts);
        failed++;
      }
    }
  }
  return { done, failed, waiting: await repo.queuedCounts() };
}
