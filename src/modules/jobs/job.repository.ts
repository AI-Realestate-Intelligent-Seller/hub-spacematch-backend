// All database queries for the jobs table. Only job.service.ts calls this file.
import { eq } from "drizzle-orm";
import { getDb, getOrm } from "../../db/client.js";
import { newId } from "../../utils/id.js";
import { type JobRow, jobs } from "./job.model.js";

export type JobInsertDb = Pick<ReturnType<typeof getOrm>, "insert">;
export async function insertJobs(items: { kind: string; payload: Record<string, unknown>; runAt: Date }[], db: JobInsertDb = getOrm()): Promise<void> {
  if (!items.length) return;
  await db
    .insert(jobs)
    .values(items.map(i => ({ id: newId(), ...i })));
}

/**
 * Takes up to `limit` due jobs of these kinds and marks them running, in one statement.
 * FOR UPDATE SKIP LOCKED: two runs at the same time never take the same job.
 * Jobs stuck "running" for over 15 minutes (a run that died) are taken again.
 */
export async function claimDue(kinds: string[], limit: number): Promise<JobRow[]> {
  if (!kinds.length) return [];
  const rows = await getDb()<JobRow[]>`
    UPDATE jobs SET status = 'running', attempts = attempts + 1, updated_at = now()
    WHERE id IN (
      SELECT id FROM jobs
      WHERE kind IN ${getDb()(kinds)}
        AND run_at <= now()
        AND (status = 'queued' OR (status = 'running' AND updated_at < now() - interval '15 minutes'))
      ORDER BY run_at
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, kind, payload, status, run_at AS "runAt", attempts, last_error AS "lastError", created_at AS "createdAt", updated_at AS "updatedAt"`;
  return rows;
}

export async function markDone(id: string): Promise<void> {
  await getOrm().update(jobs).set({ status: "done", lastError: null }).where(eq(jobs.id, id));
}

/** Failed: try again later (waits 5, 20, 45, 80 min), or give up after `maxAttempts`. */
export async function markFailed(id: string, attempts: number, error: string, maxAttempts: number): Promise<void> {
  const final = attempts >= maxAttempts;
  await getOrm()
    .update(jobs)
    .set({ status: final ? "failed" : "queued", lastError: error.slice(0, 1000), runAt: new Date(Date.now() + 5 * 60_000 * attempts * attempts) })
    .where(eq(jobs.id, id));
}

/** Jobs still waiting, by kind (shown by the cron endpoint so pending connector work is visible). */
export async function queuedCounts(): Promise<{ kind: string; n: number }[]> {
  return getDb()<{ kind: string; n: number }[]>`SELECT kind, count(*)::int AS n FROM jobs WHERE status = 'queued' GROUP BY kind ORDER BY kind`;
}

/** Whether a job of this kind for this payload key/value is still waiting or running (duplicate guard). */
export async function hasOpenJob(kind: string, key: string, value: string): Promise<boolean> {
  const rows = await getDb()<{ n: number }[]>`
    SELECT count(*)::int AS n FROM jobs
    WHERE kind = ${kind} AND status IN ('queued', 'running') AND payload->>${key} = ${value}`;
  return (rows[0]?.n ?? 0) > 0;
}


export async function latestExportJob(kind: string, exportKey: string) {
  const [row] = await getDb()<Pick<JobRow, "status" | "lastError" | "runAt" | "updatedAt">[]>`
    SELECT status, last_error AS "lastError", run_at AS "runAt", updated_at AS "updatedAt"
    FROM jobs WHERE kind = ${kind} AND payload->>'exportKey' = ${exportKey}
    ORDER BY created_at DESC LIMIT 1`;
  return row;
}
