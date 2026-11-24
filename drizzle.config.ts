// Drizzle Kit configuration: our equivalent of Alembic's alembic.ini + env.py.
//   npm run db:generate  → compare models with the last migration, write a new SQL file
//   npm run db:migrate   → apply pending SQL files to the database
//   npm run db:studio    → browse tables in the browser
import "dotenv/config";
import { defineConfig } from "drizzle-kit";

// Migrations need a session connection (prepared statements + advisory locks),
// so they use the DIRECT url, never the transaction pooler on port 6543.
const url = process.env.DIRECT_DATABASE_URL;
if (!url) {
  throw new Error(
    "DIRECT_DATABASE_URL is empty. Migrations need the direct connection (port 5432); " +
      "on IPv4-only networks use the Supabase session pooler (pooler host, port 5432).",
  );
}

export default defineConfig({
  dialect: "postgresql",
  // Every module keeps its tables in <feature>.model.ts.
  schema: "./src/modules/**/*.model.ts",
  // Generated SQL migrations are committed to git and reviewed in pull requests.
  out: "./src/db/migrations",
  dbCredentials: { url, ssl: "require" },
  // TypeScript camelCase fields become snake_case columns automatically.
  casing: "snake_case",
  // Only manage our own schema; leave Supabase's auth/storage/realtime schemas alone.
  schemaFilter: ["public"],
  migrations: {
    // Where Drizzle records applied migrations (like Alembic's alembic_version table).
    table: "__drizzle_migrations",
    schema: "drizzle",
  },
  strict: true, // ask for confirmation before destructive changes
  verbose: true, // print the SQL it runs
});
