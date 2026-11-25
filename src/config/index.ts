// Typed, grouped configuration. Modules import `config`, never process.env.
import { env } from "./env.js";

/** "a@x.com, b@y.com" or '"a@x.com", "b@y.com"' or '["a@x.com"]' → ["a@x.com", "b@y.com"]. */
function splitList(value: string): string[] {
  return value
    .replace(/^\s*\[|\]\s*$/g, "")
    .split(",")
    .map(v => v.trim().replace(/^["']+|["']+$/g, "").trim().toLowerCase())
    .filter(Boolean);
}

export const config = {
  env: env.NODE_ENV,
  isProduction: env.NODE_ENV === "production",
  isTest: env.NODE_ENV === "test",
  port: env.PORT,
  apiUrl: env.API_URL,
  appUrl: env.APP_URL.replace(/\/+$/, ""),
  logLevel: env.LOG_LEVEL,

  cmaWorker: {
    key: env.CMA_WORKER_KEY,
  },

  cron: {
    secret: env.CRON_SECRET,
  },

  reels: {
    url: env.REELS_API_URL.replace(/\/+$/, ""),
    key: env.REELS_API_KEY,
    /** Always on: the key is optional (sent only when set). */
    isConfigured: true,
  },

  cors: {
    origins: env.CORS_ORIGINS.split(",")
      .map(o => o.trim())
      .filter(Boolean),
  },

  database: {
    url: env.DATABASE_URL,
    directUrl: env.DIRECT_DATABASE_URL,
    get isConfigured() {
      return Boolean(env.DATABASE_URL);
    },
  },

  storage: {
    endpoint: env.STORAGE_S3_ENDPOINT,
    region: env.STORAGE_S3_REGION,
    accessKeyId: env.STORAGE_S3_ACCESS_KEY_ID,
    secretAccessKey: env.STORAGE_S3_SECRET_ACCESS_KEY,
    bucket: env.STORAGE_BUCKET,
    get isConfigured() {
      return Boolean(
        env.STORAGE_S3_ENDPOINT && env.STORAGE_S3_ACCESS_KEY_ID && env.STORAGE_S3_SECRET_ACCESS_KEY,
      );
    },
  },

  auth: {
    secret: env.AUTH_SECRET,
    basePath: "/api/v1/auth",
    // Sessions slide: each visit extends them, and 60 days without a visit signs the agent out
    // (today's Hub: 60 days idle, 90 days total).
    sessionIdleDays: 60,
    // Anyone with an email at these domains may sign up; everyone else needs an invitation.
    allowedEmailDomains: splitList(env.AUTH_ALLOWED_DOMAINS),
    seedAdminEmails: splitList(env.SEED_ADMIN_EMAILS),
    seedOpsEmails: splitList(env.SEED_OPS_EMAILS),
    // Developers get the admin role (same as DEV_ADMIN_EMAILS in today's Hub).
    seedDevEmails: splitList(env.SEED_DEV_EMAILS),
    // Email codes: 6 digits, valid 10 minutes, 5 tries.
    otpLength: 6,
    otpExpiresInSeconds: 600,
    otpAllowedAttempts: 5,
  },

  mail: {
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE ?? env.SMTP_SSL ?? env.SMTP_PORT === 465,
    user: env.SMTP_USER,
    pass: env.SMTP_PASS ?? env.SMTP_PASSWORD,
    from: env.MAIL_FROM ?? env.SMTP_FROM ?? (env.SMTP_USER ? `SpaceMatch Hub <${env.SMTP_USER}>` : undefined),
    replyTo: env.MAIL_REPLY_TO,
    mode: env.MAIL_MODE,
    get isConfigured() {
      return Boolean(env.SMTP_USER && (env.SMTP_PASS ?? env.SMTP_PASSWORD));
    },
  },
} as const;

export type AppConfig = typeof config;
