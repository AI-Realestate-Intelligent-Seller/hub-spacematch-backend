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

  cmaBuilder: {
    authorizedBrowserSources: splitList(env.CMA_BROWSER_AUTHORIZED_SOURCES),
    mred: { username: env.CMA_MRED_USERNAME, password: env.CMA_MRED_PASSWORD },
    browserConcurrency: env.CMA_BROWSER_CONCURRENCY,
    browserTimeoutMs: env.CMA_BROWSER_TIMEOUT_MS,
    browserExecutable: env.CMA_BROWSER_EXECUTABLE,
    exportInline: env.CMA_EXPORT_MODE === "inline",
    // Fixtures are never offered in production, whatever the variable says.
    devFixtures: env.CMA_DEV_FIXTURES && env.NODE_ENV !== "production",
    rentcast: { key: env.RENTCAST_API_KEY, url: env.RENTCAST_API_URL.replace(/\/+$/, "") },
    refreshThresholdPct: env.CMA_REFRESH_THRESHOLD_PCT,
    workerPollMs: env.CMA_WORKER_POLL_MS,
    researchCacheHours: env.CMA_PROPERTY_RESEARCH_CACHE_HOURS,
    worker: { url: env.CMA_WORKER_URL?.replace(/\/+$/, ""), secret: env.CMA_WORKER_SECRET, port: env.CMA_WORKER_PORT },
  },

  reelStudio: {
    testPayments: env.REEL_TEST_PAYMENTS === undefined ? env.NODE_ENV !== "production" : env.REEL_TEST_PAYMENTS === "true",
    recipient: env.REEL_ZELLE_RECIPIENT,
    confirmers: splitList(env.REEL_PAYMENT_CONFIRMERS),
    alertEmail: env.REEL_PAYMENT_ALERT_EMAIL,
    driveAccount: env.REEL_DRIVE_SERVICE_ACCOUNT,
    driveKey: env.REEL_DRIVE_PRIVATE_KEY,
    driveFolders: env.REEL_DRIVE_FOLDERS,
    scribeKey: env.REEL_SCRIBE_KEY,
    plannerKey: env.REEL_PLANNER_KEY,
    plannerModel: env.REEL_PLANNER_MODEL,
    editingConfigured: !!(env.REEL_SCRIBE_KEY && env.REEL_PLANNER_KEY && env.REEL_PLANNER_MODEL),
  },

  reels: {
    url: env.REELS_API_URL.replace(/\/+$/, ""),
    key: env.REELS_API_KEY,
    /** Always on: the key is optional (sent only when set). */
    isConfigured: true,
  },

  push: {
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
    subject: env.VAPID_SUBJECT,
    get isConfigured() {
      return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
    },
  },

  lofty: {
    key: env.LOFTY_API_KEY,
    url: env.LOFTY_API_URL.replace(/\/+$/, ""),
    get isConfigured() {
      return Boolean(env.LOFTY_API_KEY);
    },
  },

  youtube: {
    key: env.YOUTUBE_API_KEY,
    uploadsPlaylist: env.YOUTUBE_UPLOADS_PLAYLIST,
    get isConfigured() {
      return Boolean(env.YOUTUBE_API_KEY);
    },
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

  googleMail: {
    clientId: env.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
    redirectUri: env.GOOGLE_OAUTH_REDIRECT_URI,
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
