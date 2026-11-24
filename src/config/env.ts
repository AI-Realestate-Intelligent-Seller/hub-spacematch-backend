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
  MAIL_REPLY_TO: optionalString,
  // off = write emails to the log instead of sending. live = send through SMTP.
  MAIL_MODE: z.enum(["off", "live"]).default("off"),

  // Accounts: comma-separated email domains anyone may sign up with (others need an invitation).
  AUTH_ALLOWED_DOMAINS: z.string().default("spacematchinc.com"),
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
