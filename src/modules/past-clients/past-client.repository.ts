// All database queries for past clients. Only past-client.service.ts calls this file.
import { asc, eq } from "drizzle-orm";
import { getOrm } from "../../db/client.js";
import { newId } from "../../utils/id.js";
import { type NewPastClientRow, type PastClientRow, pastClients } from "./past-client.model.js";

export async function listForAgent(email: string): Promise<PastClientRow[]> {
  return getOrm().select().from(pastClients).where(eq(pastClients.agentEmail, email)).orderBy(asc(pastClients.name)).limit(1000);
}

export async function findClient(id: string): Promise<PastClientRow | undefined> {
  const [row] = await getOrm().select().from(pastClients).where(eq(pastClients.id, id)).limit(1);
  return row;
}

export async function insertClient(values: Omit<NewPastClientRow, "id">): Promise<PastClientRow> {
  const [row] = await getOrm()
    .insert(pastClients)
    .values({ id: newId(), ...values })
    .returning();
  return row!;
}

export async function updateClient(id: string, patch: Partial<Omit<NewPastClientRow, "id" | "createdAt">>): Promise<PastClientRow | undefined> {
  const [row] = await getOrm()
    .update(pastClients)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(pastClients.id, id))
    .returning();
  return row;
}

export async function deleteClient(id: string): Promise<void> {
  await getOrm().delete(pastClients).where(eq(pastClients.id, id));
}
