// Database access for the whole API.
//   getDb()  → raw postgres.js client (health checks, rare hand-written SQL)
//   getOrm() → Drizzle query builder: what repositories use
// Uses Supabase's pooler in transaction mode (port 6543), which does not support
// prepared statements, hence `prepare: false`.
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { config } from "../config/index.js";
import { serviceUnavailable } from "../utils/http-error.js";
import { logger } from "../utils/logger.js";
import * as schema from "./schema.js";

let client: postgres.Sql | undefined;
let orm: PostgresJsDatabase<typeof schema> | undefined;

export function getDb(): postgres.Sql {
  if (!config.database.url) {
    throw serviceUnavailable("The database is not configured (DATABASE_URL is empty).");
  }
  client ??= postgres(config.database.url, {
    prepare: false,
    // No pipelining: with more queries in flight than connections, postgres.js queues extra
    // queries on busy connections, and through the Supabase transaction pooler those never
    // answer (5 parallel queries on a pool of 3 hung forever). One query per connection at a time.
    max_pipeline: 1,
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

/** Cheap round trip used by the health check. Returns latency in ms. Gives up after 5 s and
 *  replaces the connections (a hung ping means they are dead). */
export async function pingDb(): Promise<number> {
  const started = Date.now();
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      getDb()`select 1`,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Database did not answer within 5 s")), 5000);
      }),
    ]);
  } catch (e) {
    if (Date.now() - started >= 5000) resetDb("health ping timed out");
    throw e;
  } finally {
    clearTimeout(timer);
  }
  return Date.now() - started;
}

/**
 * Drops every database connection and starts fresh on the next query. Used when queries hang:
 * a connection that died silently (network change, laptop sleep, pooler restart) is never
 * noticed by postgres.js, so queries wait on it forever and every request piles up behind them.
 * Queries still waiting on the old connections fail, so their requests answer with an error.
 */
export function resetDb(reason: string, expectedOrm?: PostgresJsDatabase<typeof schema>): void {
  if (!client || (expectedOrm && orm !== expectedOrm)) return;
  const old = client;
  client = undefined;
  orm = undefined;
  logger.warn("db: resetting connections", { reason });
  void old.end({ timeout: 0 }).catch(() => {});
}

export async function closeDb(): Promise<void> {
  if (client) {
    await client.end({ timeout: 5 });
    client = undefined;
    orm = undefined;
  }
}
