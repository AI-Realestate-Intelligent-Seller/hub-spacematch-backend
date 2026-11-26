// Enqueue background work. Other modules call these; they never touch the jobs table.
import * as repo from "./job.repository.js";

export async function enqueue(kind: string, payload: Record<string, unknown> = {}, runAt = new Date(), db?: repo.JobInsertDb): Promise<void> {
  await repo.insertJobs([{ kind, payload, runAt }], db);
}

/** Enqueues unless a job of the same kind with the same payload[key] is already waiting or running. */
export async function enqueueUnique(kind: string, payload: Record<string, unknown>, key: string, runAt = new Date()): Promise<boolean> {
  if (await repo.hasOpenJob(kind, key, String(payload[key]))) return false;
  await repo.insertJobs([{ kind, payload, runAt }]);
  return true;
}

/** Takes one due job of these kinds (marked running), for long-running workers with their own loop. */
export async function claimOne(kinds: string[]) {
  return (await repo.claimDue(kinds, 1))[0];
}

export async function finishJob(id: string) {
  await repo.markDone(id);
}

export async function failJob(id: string, attempts: number, error: string, maxAttempts = 3) {
  await repo.markFailed(id, attempts, error, maxAttempts);
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

export { latestExportJob } from "./job.repository.js";
