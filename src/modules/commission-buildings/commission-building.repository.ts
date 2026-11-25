// All database queries for commission buildings. Only commission-building.service.ts calls this file.
import { eq } from "drizzle-orm";
import { getOrm } from "../../db/client.js";
import { newId } from "../../utils/id.js";
import { type CommissionBuildingRow, commissionBuildings, type NewCommissionBuildingRow } from "./commission-building.model.js";

export async function listBuildings(): Promise<CommissionBuildingRow[]> {
  return getOrm().select().from(commissionBuildings);
}

export async function findBuilding(id: string): Promise<CommissionBuildingRow | undefined> {
  const [row] = await getOrm().select().from(commissionBuildings).where(eq(commissionBuildings.id, id)).limit(1);
  return row;
}

export async function findByKey(addressKey: string): Promise<CommissionBuildingRow | undefined> {
  const [row] = await getOrm().select().from(commissionBuildings).where(eq(commissionBuildings.addressKey, addressKey)).limit(1);
  return row;
}

export async function insertBuilding(values: Omit<NewCommissionBuildingRow, "id">): Promise<CommissionBuildingRow> {
  const [row] = await getOrm()
    .insert(commissionBuildings)
    .values({ id: newId(), ...values })
    .returning();
  return row!;
}

export async function updateBuilding(id: string, patch: Partial<Omit<NewCommissionBuildingRow, "id" | "createdAt">>): Promise<CommissionBuildingRow | undefined> {
  const [row] = await getOrm()
    .update(commissionBuildings)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(commissionBuildings.id, id))
    .returning();
  return row;
}

export async function deleteBuilding(id: string): Promise<void> {
  await getOrm().delete(commissionBuildings).where(eq(commissionBuildings.id, id));
}
