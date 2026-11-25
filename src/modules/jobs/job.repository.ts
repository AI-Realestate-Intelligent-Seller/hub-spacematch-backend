// All database queries for the jobs table. Only job.service.ts calls this file.
import { getOrm } from "../../db/client.js";
import { newId } from "../../utils/id.js";
import { jobs } from "./job.model.js";

export async function insertJobs(items: { kind: string; payload: Record<string, unknown>; runAt: Date }[]): Promise<void> {
  if (!items.length) return;
  await getOrm()
    .insert(jobs)
    .values(items.map(i => ({ id: newId(), ...i })));
}
