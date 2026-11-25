// Loads and validates every environment variable once, at startup.
// This is the ONLY file in the codebase that reads process.env.
import "dotenv/config";
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

  // SpaceMatch Reels service (social video views: Instagram, YouTube, TikTok, Facebook). See its HUB_INTEGRATION.md.
  REELS_API_URL: z.url().default("https://spacematch-backend.vercel.app/v1"),
  REELS_API_KEY: optionalString,

  // Accounts: comma-separated email domains allowed to sign up. Nobody else can create an account.
  AUTH_ALLOWED_DOMAINS: z.string().default("linchpin.net"),
  // Seed only: who becomes admin / ops when they first sign up (comma-separated emails).
  SEED_ADMIN_EMAILS: z.string().default(""),
  SEED_OPS_EMAILS: z.string().default(""),
  SEED_DEV_EMAILS: z.string().default(""),
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
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
