// All database queries for open houses. Only open-house.service.ts calls this file.
import { asc, eq, gte } from "drizzle-orm";
import { getOrm } from "../../db/client.js";
import { newId } from "../../utils/id.js";
import { type NewOpenHouseRow, type OpenHouseRow, openHouses } from "./open-house.model.js";

export async function listFrom(date: string): Promise<OpenHouseRow[]> {
  return getOrm().select().from(openHouses).where(gte(openHouses.date, date)).orderBy(asc(openHouses.date), asc(openHouses.start)).limit(300);
}

export async function findOpenHouse(id: string): Promise<OpenHouseRow | undefined> {
  const [row] = await getOrm().select().from(openHouses).where(eq(openHouses.id, id)).limit(1);
  return row;
}

export async function insertOpenHouse(values: Omit<NewOpenHouseRow, "id">): Promise<OpenHouseRow> {
  const [row] = await getOrm()
    .insert(openHouses)
    .values({ id: newId(), ...values })
    .returning();
  return row!;
}

export async function updateOpenHouse(id: string, patch: Partial<Omit<NewOpenHouseRow, "id" | "createdAt">>): Promise<OpenHouseRow | undefined> {
  const [row] = await getOrm()
    .update(openHouses)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(openHouses.id, id))
    .returning();
  return row;
}

export async function deleteOpenHouse(id: string): Promise<void> {
  await getOrm().delete(openHouses).where(eq(openHouses.id, id));
}
