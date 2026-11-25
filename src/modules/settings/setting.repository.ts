// All database queries for app settings. Only setting.service.ts calls this file.
import { eq } from "drizzle-orm";
import { getOrm } from "../../db/client.js";
import { type AppSettingRow, appSettings } from "./setting.model.js";

export async function findSetting(key: string): Promise<AppSettingRow | undefined> {
  const [row] = await getOrm().select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
  return row;
}

export async function upsertSetting(key: string, value: unknown, updatedBy: string): Promise<void> {
  await getOrm()
    .insert(appSettings)
    .values({ key, value, updatedBy })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedBy, updatedAt: new Date() } });
}
