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
