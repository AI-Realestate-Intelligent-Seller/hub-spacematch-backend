// All database queries for CMA requests. Only cma.service.ts calls this file.
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { getOrm } from "../../db/client.js";
import { newId } from "../../utils/id.js";
import { type CmaRequestRow, cmaRequests, type NewCmaRequestRow } from "./cma.model.js";

export async function listAll(limit = 200): Promise<CmaRequestRow[]> {
  return getOrm().select().from(cmaRequests).orderBy(desc(cmaRequests.createdAt)).limit(limit);
}

export async function listForUser(userId: string, email: string, limit = 200): Promise<CmaRequestRow[]> {
  // Their own submissions (by account), plus ones filed for them by email before accounts existed.
  const byUser = await getOrm().select().from(cmaRequests).where(eq(cmaRequests.userId, userId)).orderBy(desc(cmaRequests.createdAt)).limit(limit);
  const byEmail = await getOrm().select().from(cmaRequests).where(eq(cmaRequests.submittedByEmail, email)).orderBy(desc(cmaRequests.createdAt)).limit(limit);
  const seen = new Set(byUser.map(r => r.id));
  return [...byUser, ...byEmail.filter(r => !seen.has(r.id))].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit);
}

export async function listSince(since: Date): Promise<Pick<CmaRequestRow, "agentName" | "status" | "statusNote">[]> {
  return getOrm()
    .select({ agentName: cmaRequests.agentName, status: cmaRequests.status, statusNote: cmaRequests.statusNote })
    .from(cmaRequests)
    .where(gte(cmaRequests.createdAt, since));
}

export async function listByStatus(statuses: string[], limit = 500): Promise<CmaRequestRow[]> {
  return getOrm().select().from(cmaRequests).where(inArray(cmaRequests.status, statuses)).orderBy(cmaRequests.createdAt).limit(limit);
}

export async function findRequest(id: string): Promise<CmaRequestRow | undefined> {
  const [row] = await getOrm().select().from(cmaRequests).where(eq(cmaRequests.id, id)).limit(1);
  return row;
}

export async function insertRequest(values: Omit<NewCmaRequestRow, "id">): Promise<CmaRequestRow> {
  const [row] = await getOrm()
    .insert(cmaRequests)
    .values({ id: newId(), ...values })
    .returning();
  return row!;
}

export async function updateRequest(id: string, patch: Partial<Omit<NewCmaRequestRow, "id" | "createdAt">>): Promise<CmaRequestRow> {
  const [row] = await getOrm()
    .update(cmaRequests)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(cmaRequests.id, id)))
    .returning();
  return row!;
}
