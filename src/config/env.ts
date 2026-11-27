// Loads and validates every environment variable once, at startup.
// This is the ONLY file in the codebase that reads process.env.
import "dotenv/config";
import { readFileSync } from "node:fs";
import { parse as parseDotenv } from "dotenv";
import { z } from "zod";

const optionalString = z
  .string()
  .trim()
  .transform(v => (v === "" ? undefined : v))
  .optional();

const optionalUrl = z
  .string()
  .trim()
  .transform(v => (v === "" ? undefined : v))
  .pipe(z.url().optional())
  .optional();

const EnvSchema = z.object({
  // App
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGINS: z.string().default("http://localhost:5173"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  API_URL: z.url().default("http://localhost:4000"),
  // Public URL of the Hub web app (links in emails, e.g. "Open help requests").
  APP_URL: z.url().default("http://localhost:5173"),

  // Database (filled in during the database step)
  DATABASE_URL: optionalUrl,
  DIRECT_DATABASE_URL: optionalUrl,

  // Storage (Supabase Storage through its S3-compatible API; works the same with Cloudflare R2)
  STORAGE_S3_ENDPOINT: optionalUrl,
  STORAGE_S3_REGION: z.string().default("us-east-1"),
  STORAGE_S3_ACCESS_KEY_ID: optionalString,
  STORAGE_S3_SECRET_ACCESS_KEY: optionalString,
  STORAGE_BUCKET: z.string().default("hub-files"),

  // Auth
  AUTH_SECRET: optionalString.refine(v => v === undefined || v.length >= 32, {
    message: "AUTH_SECRET must be at least 32 characters",
  }),

  REEL_TEST_PAYMENTS: z.enum(["true", "false"]).optional(),
  REEL_ZELLE_RECIPIENT: optionalString,
  REEL_PAYMENT_CONFIRMERS: z.string().default(""),
  REEL_PAYMENT_ALERT_EMAIL: optionalString,
  REEL_DRIVE_SERVICE_ACCOUNT: optionalString,
  REEL_DRIVE_PRIVATE_KEY: optionalString,
  REEL_DRIVE_FOLDERS: z.string().default("{}"),
  REEL_SCRIBE_KEY: optionalString,
  REEL_PLANNER_KEY: optionalString,
  REEL_PLANNER_MODEL: optionalString,

  GOOGLE_OAUTH_CLIENT_ID: optionalString,
  GOOGLE_OAUTH_CLIENT_SECRET: optionalString,
  GOOGLE_OAUTH_REDIRECT_URI: optionalString.pipe(z.url().optional()),

  // Email (any SMTP provider; Hostinger defaults)
  // Accepts "smtp.gmail.com" and also tolerates "http://smtp.gmail.com/" (scheme and slashes are stripped).
  SMTP_HOST: z
    .string()
    .default("smtp.hostinger.com")
    .transform(v => v.trim().replace(/^[a-z]+:\/\//i, "").replace(/\/+$/, "")),
  SMTP_PORT: z.coerce.number().int().positive().default(465),
  // "true" = TLS from the start (port 465). "false" = STARTTLS (port 587). Empty = decide from the port.
  SMTP_SECURE: z
    .enum(["true", "false", ""])
    .optional()
    .transform(v => (v === "true" ? true : v === "false" ? false : undefined)),
  SMTP_USER: optionalString,
  SMTP_PASS: optionalString,
  MAIL_FROM: optionalString,
  // Accepted alternative names (same meaning): SMTP_PASSWORD = SMTP_PASS, SMTP_FROM = MAIL_FROM, SMTP_SSL = SMTP_SECURE.
  SMTP_PASSWORD: optionalString,
  SMTP_FROM: optionalString,
  SMTP_SSL: z
    .enum(["true", "false", ""])
    .optional()
    .transform(v => (v === "true" ? true : v === "false" ? false : undefined)),
  MAIL_REPLY_TO: optionalString,
  // off = write emails to the log instead of sending. live = send through SMTP.
  MAIL_MODE: z.enum(["off", "live"]).default("off"),

  // Vercel Cron sends "Authorization: Bearer <CRON_SECRET>" to /api/v1/cron/*. Required in production.
  CRON_SECRET: optionalString,

  // CMA builder (Viktor's queue worker, later our own): sent as the "x-worker-key" header to /api/v1/cma-worker/*.
  CMA_WORKER_KEY: optionalString,

  // CMA Builder (listing-based CMAs; see src/modules/cma-builder and docs in backend/CMA_BUILDER.md).
  // Browser sources the broker has confirmed it may automate (comma-separated adapter ids, e.g. "mred").
  // Empty = no live browser source runs, whatever credentials are set.
  CMA_BROWSER_AUTHORIZED_SOURCES: z.string().default(""),
  CMA_MRED_USERNAME: optionalString,
  CMA_MRED_PASSWORD: optionalString,
  CMA_BROWSER_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(1),
  CMA_BROWSER_TIMEOUT_MS: z.coerce.number().int().min(10_000).max(900_000).default(180_000),
  // Optional: a Chromium binary to use instead of Playwright's download.
  CMA_BROWSER_EXECUTABLE: optionalString,
  // "true" = offer the clearly labelled local fixture source (never in production).
  // PDF/PowerPoint exports: "inline" renders in the API request (Vercel, serverless Chromium);
  // "worker" leaves them to the separate worker process (npm run worker).
  CMA_EXPORT_MODE: z.enum(["inline", "worker"]).default("inline"),
  CMA_DEV_FIXTURES: z.enum(["true", "false", ""]).optional().transform(v => v === "true"),
  RENTCAST_API_KEY: optionalString,
  RENTCAST_API_URL: z.url().default("https://api.rentcast.io/v1"),
  // Weekly refresh: tell the agent when the estimate moves at least this many percent.
  CMA_REFRESH_THRESHOLD_PCT: z.coerce.number().min(0.5).max(50).default(3),
  CMA_WORKER_POLL_MS: z.coerce.number().int().min(1000).max(60_000).default(5000),
  CMA_PROPERTY_RESEARCH_CACHE_HOURS: z.coerce.number().int().min(0).max(720).default(168),
  // The CMA worker as its own service (e.g. on Render). API side: its public URL, so new jobs wake it at once.
  // Both sides: the shared secret for its /wake endpoint. Worker side: the port its /health + /wake server
  // listens on (unset = no HTTP server, e.g. `npm run worker` next to a local API on PORT).
  CMA_WORKER_URL: optionalUrl,
  CMA_WORKER_SECRET: optionalString,
  CMA_WORKER_PORT: z.preprocess(v => (typeof v === "string" && v.trim() === "" ? undefined : v), z.coerce.number().int().min(1).max(65535).optional()),

  // SpaceMatch Reels service (social video views: Instagram, YouTube, TikTok, Facebook). See its HUB_INTEGRATION.md.
  REELS_API_URL: z.url().default("https://spacematch-backend.vercel.app/v1"),
  REELS_API_KEY: optionalString,

  // Web Push (browser/phone notifications). Generate once: npx web-push generate-vapid-keys
  VAPID_PUBLIC_KEY: optionalString,
  VAPID_PRIVATE_KEY: optionalString,
  VAPID_SUBJECT: z.string().default("mailto:team@spacematchinc.com"),

  // Lofty CRM, read-only (finds a listing's seller among Michael's Lofty leads; never writes).
  LOFTY_API_KEY: optionalString,
  LOFTY_API_URL: z.url().default("https://api.lofty.com"),

  // YouTube Data API v3 (finds a listing's Short on the brokerage channel and reads its views).
  YOUTUBE_API_KEY: optionalString,
  YOUTUBE_UPLOADS_PLAYLIST: z.string().default("UUg4SCyhsx-9tsHUBrHNuxsA"),

  // Accounts: comma-separated email domains allowed to sign up. Nobody else can create an account.
  AUTH_ALLOWED_DOMAINS: z.string().default("linchpin.net"),
  // Seed only: who becomes admin / ops when they first sign up (comma-separated emails).
  SEED_ADMIN_EMAILS: z.string().default(""),
  SEED_OPS_EMAILS: z.string().default(""),
  SEED_DEV_EMAILS: z.string().default(""),
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const values = { ...process.env };
  if (!values.REEL_SCRIBE_KEY?.trim()) {
    values.REEL_SCRIBE_KEY = values.ELEVENLABS_API_KEY?.trim();
    if (!values.REEL_SCRIBE_KEY && values.NODE_ENV !== "production") {
      // ElevenLabs onboarding writes this key to the workspace root, while the API loads backend/.env.
      try {
        const workspaceEnv = readFileSync(new URL("../../../.env", import.meta.url), "utf8");
        values.REEL_SCRIBE_KEY = parseDotenv(workspaceEnv).ELEVENLABS_API_KEY;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }
  const parsed = EnvSchema.safeParse(values);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map(i => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    // Fail fast: a misconfigured server should not start at all.
    console.error(`Invalid environment configuration:\n${problems}`);
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();
