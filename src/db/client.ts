// Database access for the whole API.
//   getDb()  → raw postgres.js client (health checks, rare hand-written SQL)
//   getOrm() → Drizzle query builder: what repositories use
// Uses Supabase's pooler in transaction mode (port 6543), which does not support
// prepared statements, hence `prepare: false`.
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { config } from "../config/index.js";
import { serviceUnavailable } from "../utils/http-error.js";
import * as schema from "./schema.js";

let client: postgres.Sql | undefined;
let orm: PostgresJsDatabase<typeof schema> | undefined;

export function getDb(): postgres.Sql {
  if (!config.database.url) {
    throw serviceUnavailable("The database is not configured (DATABASE_URL is empty).");
  }
  client ??= postgres(config.database.url, {
    prepare: false,
    ssl: "require",
    // Small pool: on Vercel each function instance holds its own connections,
    // and the Supabase pooler multiplexes them.
    max: config.isProduction ? 5 : 3,
    idle_timeout: 20,
    connect_timeout: 15,
  });
  return client;
}

/** Drizzle query builder. Repositories import this; services never do. */
export function getOrm(): PostgresJsDatabase<typeof schema> {
  orm ??= drizzle(getDb(), { schema, casing: "snake_case" });
  return orm;
}

/** Cheap round trip used by the health check. Returns latency in ms. */
export async function pingDb(): Promise<number> {
  const started = Date.now();
  await getDb()`select 1`;
  return Date.now() - started;
}

export async function closeDb(): Promise<void> {
  if (client) {
    await client.end({ timeout: 5 });
    client = undefined;
    orm = undefined;
  }
}
