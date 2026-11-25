// Read and write team-wide settings. Other modules call these (no HTTP routes of its own yet).
import * as repo from "./setting.repository.js";

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await repo.findSetting(key);
  return row ? (row.value as T) : fallback;
}

export async function setSetting(key: string, value: unknown, updatedBy: string): Promise<void> {
  await repo.upsertSetting(key, value, updatedBy);
}
