// All database queries for help requests. Only help.service.ts calls this file.
import { desc, eq } from "drizzle-orm";
import { getOrm } from "../../db/client.js";
import { newId } from "../../utils/id.js";
import { type HelpRequestRow, helpRequests, type NewHelpRequestRow } from "./help.model.js";

export async function insertRequest(values: Omit<NewHelpRequestRow, "id">): Promise<HelpRequestRow> {
  const [row] = await getOrm()
    .insert(helpRequests)
    .values({ id: newId(), ...values })
    .returning();
  return row!;
}

export async function findRequest(id: string): Promise<HelpRequestRow | undefined> {
  const [row] = await getOrm().select().from(helpRequests).where(eq(helpRequests.id, id)).limit(1);
  return row;
}

export async function listFrom(email: string, limit = 50): Promise<HelpRequestRow[]> {
  return getOrm().select().from(helpRequests).where(eq(helpRequests.fromEmail, email)).orderBy(desc(helpRequests.createdAt)).limit(limit);
}

export async function listTo(email: string, limit = 300): Promise<HelpRequestRow[]> {
  return getOrm().select().from(helpRequests).where(eq(helpRequests.toEmail, email)).orderBy(desc(helpRequests.createdAt)).limit(limit);
}

export async function listAll(limit = 500): Promise<HelpRequestRow[]> {
  return getOrm().select().from(helpRequests).orderBy(desc(helpRequests.createdAt)).limit(limit);
}

export async function updateRequest(id: string, patch: Partial<Omit<NewHelpRequestRow, "id" | "createdAt">>): Promise<HelpRequestRow | undefined> {
  const [row] = await getOrm()
    .update(helpRequests)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(helpRequests.id, id))
    .returning();
  return row;
}
