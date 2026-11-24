# SpaceMatch Hub API: Foundation

The ground rules for the new backend. Read this before adding a module.

- **What:** a new backend for the SpaceMatch Agent Hub, built from scratch with the same features as the live Hub (Convex + Viktor).
- **Status:** foundation step 1 is done (project, structure, config, middleware, health check). Step 2 (database, storage, users, auth) waits for the Supabase keys.
- **Live Hub:** stays untouched and keeps serving agents until this project ships. We cut over once, at the end, with a one-time data import.

Related docs (in the old Hub repo, `hub_agent/docs/`): `MIGRATION_PLAN.md` (overall plan, stack, costs), `MIGRATION_WAVES.md` (every service and build order), `rebuild-blueprint.html` (what was wrong and the target architecture).

---

## 1. Decisions

| Topic | Decision |
|---|---|
| Architecture | **Modular monolith, feature-based.** One app, one database. Each feature is a folder with its own layers (routes → controller → service → repository → model) |
| Runtime | Node.js (≥ 20.19 locally; Node 22 on Vercel), TypeScript, ES modules |
| Framework | Express 5 (async errors reach the error handler without wrappers) |
| Validation | Zod 4, for request bodies and environment variables |
| Database | PostgreSQL on Supabase (Free plan for now). ORM: Drizzle (added in step 2) |
| File storage | Supabase Storage, private bucket, server-side access only. Behind an adapter, so Cloudflare R2 can replace it later |
| Auth | Better Auth on our own Postgres tables. Email + password, email codes (OTP), password reset |
| Email | Hostinger SMTP via Nodemailer |
| Hosting | Vercel Pro (API as a Vercel Function). Vercel Cron for schedules |
| Package manager | npm (one lockfile: `package-lock.json`) |

---

## 2. Folder structure

```
backend/
├── foundation.md            this file
├── package.json             scripts: dev, build, start, typecheck
├── tsconfig.json            strict TypeScript, NodeNext modules
├── .env.example             every environment variable, documented (copy to .env)
├── src/
│   ├── server.ts            local entry point: starts the HTTP server, graceful shutdown
│   ├── app.ts               builds the Express app (middleware order, mounts /api/v1)
│   ├── config/
│   │   ├── env.ts           loads + validates process.env with zod (the ONLY reader of process.env)
│   │   └── index.ts         typed `config` object grouped by area (database, storage, auth, mail …)
│   ├── modules/             one folder per feature
│   │   ├── index.ts         mounts every module's routes (one line per module)
│   │   └── health/          example module: GET /api/v1/health
│   │       ├── health.routes.ts
│   │       ├── health.controller.ts
│   │       └── health.service.ts
│   ├── middlewares/         request-id, request-logger, not-found, error-handler (auth + roles in step 2)
│   ├── integrations/        one adapter per outside service (lofty/, google/, lob/, stripe/ …)
│   ├── jobs/                cron + background job runner (each module adds its own *.jobs.ts)
│   ├── db/                  connection, migrations, seed, import-from-Convex script (step 2)
│   ├── shared/              catalogs used by backend and frontend (formDefs, deskDefs, officeDefs …)
│   ├── utils/               small pure helpers: logger, http-error, dates, money, formatting
│   └── types/               shared types (AuthUser, roles) and Express request typing
└── tests/                   API and unit tests (Vitest + Supertest, added with the first real module)
```

### A full module (the template every feature follows)

```
modules/vendors/
├── vendor.routes.ts        URL + method → controller; declares the auth level (public / signed-in / role)
├── vendor.controller.ts    HTTP only: parse input with the validation schema, call the service, send the result
├── vendor.service.ts       business rules; no req/res, no SQL
├── vendor.repository.ts    every database query for this feature (the only file that talks to the DB)
├── vendor.model.ts         Drizzle table definitions + inferred TypeScript types
├── vendor.validation.ts    zod schemas for params, query and body
└── vendor.jobs.ts          scheduled/background jobs for this feature (only if needed)
```

### Request flow

```
HTTP request
  → app-level middleware   request-id → logger → helmet → cors → json body
  → /api/v1/<module>       module router (+ requireAuth / requireRole when needed)
  → controller             schema.parse(req.body)  → service.doThing(input, req.user)
  → service                rules, calls repository and other modules' services
  → repository             SQL via Drizzle → Postgres
  ← controller             res.json(result)
  ← error-handler          any thrown HttpError / ZodError / unknown error → one JSON error shape
```

---

## 3. Layer rules

1. **Controllers are thin.** They parse input, call one service function and return its result. No business logic, no database calls.
2. **Services hold the rules.** Caps, prices, status changes, permissions beyond "signed in". They never import Express types or write SQL.
3. **Repositories are the only database access.** One repository per module, and only that module's service calls it.
4. **Models only describe data.** Drizzle tables + types; no queries.
5. **Modules talk through services.** `cma.service` may call `users.service.getByEmail()`, never `users.repository` and never the users table directly.
6. **Every outside API goes through `integrations/`.** One adapter per service, with a fake for tests. Live side effects (texts, CRM pushes, real postage, card charges) have an on/off switch in the adapter, and are off outside production.
7. **`config/` is the only place that reads `process.env`.** Variables are validated at startup, so a bad deploy fails immediately with a clear list of what's wrong.
8. **`utils/` stays small and pure.** Anything with business meaning belongs in a module's service.
9. **Services throw `HttpError`s** (`badRequest`, `forbidden`, `notFound` … in `utils/http-error.ts`). Controllers never build error responses by hand.

---

## 4. Conventions

### Naming
| Thing | Convention | Example |
|---|---|---|
| Module folder | plural, kebab-case | `modules/seller-lists/` |
| Module files | singular feature + role suffix | `seller-list.service.ts` |
| Functions, variables | camelCase | `createOrder`, `agentEmail` |
| Types | PascalCase | `SellerListOrder` |
| Database tables and columns | snake_case, plural tables | `seller_list_orders.agent_email` |
| Env variables | UPPER_SNAKE_CASE | `DATABASE_URL` |
| Imports | relative, with `.js` extension (NodeNext ES modules) | `import { config } from "../config/index.js"` |

### API
- **Base path:** `/api/v1`. A breaking change later gets `/api/v2` without disturbing v1 clients.
- **REST style:** `GET /api/v1/vendors`, `POST /api/v1/vendors`, `PATCH /api/v1/vendors/:id`, `DELETE /api/v1/vendors/:id`. Actions that aren't plain create/update use a verb sub-path: `POST /api/v1/cma-requests/:id/approve`.
- **JSON in, JSON out.** Dates as ISO-8601 strings in UTC. Money as integer cents.
- **Errors** always look like this (see `middlewares/error-handler.ts`):
  ```json
  { "error": { "code": "validation_failed", "message": "Some fields are missing or invalid.", "details": [ … ], "requestId": "…" } }
  ```
  `code` is stable and machine-readable, and `message` is written for the agent reading it. Every response carries an `x-request-id` header that matches the logs.
- **Lists** are paged: `?limit=50&cursor=…` → `{ "items": [ … ], "nextCursor": "…" | null }`.

### Database (applies from step 2)
- **Tables live with their module** (`<feature>.model.ts`). Drizzle collects them for migrations.
- **Primary keys:** `id text` (random, URL-safe). Rows imported from Convex keep their Convex `_id`, so seller-portal tokens, QR codes and links keep working.
- **Every table has** `created_at` and `updated_at` (`timestamptz`, default `now()`).
- **Agent identity is the lower-cased email** (`agent_email`), as in today's Hub, plus a `user_id` foreign key where a row belongs to a user.
- **Nested Convex objects become `jsonb` columns** typed with zod. Normalise them only when a feature needs it.
- **Migrations are SQL files in the repo** (`drizzle-kit generate`) and are never edited in the Supabase dashboard.
- **Connections:** the API uses the pooled connection (`DATABASE_URL`, port 6543, prepared statements off). Migrations and backups use the direct connection (`DIRECT_DATABASE_URL`, port 5432).
  - The direct host `db.<project>.supabase.co` is **IPv6-only**. It works from a developer machine with IPv6.
  - From IPv4-only places (GitHub Actions, Vercel), use Supabase's **session pooler** for migrations instead: the pooler host and user from `DATABASE_URL`, but port **5432**. It supports prepared statements and the locks migrations need.
- **Row-level security is on, with no policies,** on every table. Supabase's public REST API then exposes nothing; only our server (owner role) reads and writes.

### Logging and privacy
- One JSON line per request (`requestId`, method, path, status, ms). **Request and response bodies are never logged**, because they hold client data.
- Errors are logged with the request id. Stack traces are returned only outside production.

---

## 5. Configuration

All variables are documented in `.env.example`. Copy it to `.env` (never committed).

| Group | Variables | Needed from |
|---|---|---|
| App | `NODE_ENV`, `PORT`, `CORS_ORIGINS`, `LOG_LEVEL`, `API_URL` | step 1 (all have defaults) |
| Database | `DATABASE_URL` (pooled, 6543), `DIRECT_DATABASE_URL` (direct, 5432) | step 2 |
| Storage | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET` | step 2 |
| Auth | `AUTH_SECRET` (32+ characters) | step 2 |
| Email | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, `MAIL_MODE` (`off` logs instead of sending) | step 2 |

The service-role key and database URLs are **server-only secrets**. They never go to the frontend or into the repo.

---

## 6. Foundation step 2 (after the Supabase keys arrive)

### 6.1 Database and migrations (Drizzle: our Alembic)

Alembic is Python-only. This backend is TypeScript, so it uses **Drizzle ORM + Drizzle Kit**, which work the same way.

| Alembic | Drizzle (this project) |
|---|---|
| `models.py` | `src/modules/<feature>/<feature>.model.ts` |
| `alembic.ini` + `env.py` | `drizzle.config.ts` |
| `alembic revision --autogenerate -m "x"` | `npm run db:generate -- --name x` |
| `alembic upgrade head` | `npm run db:migrate` |
| `alembic_version` table | `drizzle.__drizzle_migrations` table |
| `alembic downgrade` | no automatic down; write a new migration that reverses the change |
| seed script | `npm run db:seed` (`src/db/seed.ts`) |

**Setup (done):**
- **Packages:** `drizzle-orm`, `drizzle-kit`, `postgres` (driver).
- **`drizzle.config.ts`:**
  - Reads every `src/modules/**/*.model.ts` and writes SQL to `src/db/migrations/`.
  - Connects with `DIRECT_DATABASE_URL`. Migrations need a session connection, and the 6543 pooler doesn't provide one.
  - Converts camelCase to snake_case, and manages only the `public` schema (Supabase's own schemas are left alone).
  - `strict` asks before destructive changes.
- **`src/db/client.ts`:** `getDb()` (raw SQL, health check) and `getOrm()` (Drizzle query builder for repositories), through the pooled `DATABASE_URL`.
- **`src/db/schema.ts`:** re-exports every module's tables so `getOrm()` is fully typed.
- **`src/db/seed.ts`:** a seed runner where every step can be re-run safely. Empty until tables exist.
- **Verified:** a probe model generated `CREATE TABLE "probe_items" ("id" text PRIMARY KEY, "agent_email" text …, "created_at" timestamp with time zone DEFAULT now() …)`, then was removed. No tables have been created in the database yet.

**Workflow for every schema change:**
1. Edit or add `<feature>.model.ts`, and export it from `src/db/schema.ts`.
2. `npm run db:generate -- --name short_description` writes `src/db/migrations/NNNN_short_description.sql`.
3. **Read the SQL.** Hand-edit only to add what Drizzle can't express (e.g. `ALTER TABLE … ENABLE ROW LEVEL SECURITY;`).
4. `npm run db:migrate` applies it to your database (dev first).
5. Commit the model, the SQL and `migrations/meta/*` together. Production migrations run from CI (the IPv4 session pooler URL), never by hand from the dashboard.
6. **Never edit a migration that has already run anywhere.** Fix forward with a new one.

**Rules:**
- Row-level security is on, with no policies, for every new table (add it to the migration SQL).
- No schema edits in the Supabase dashboard; the migrations folder is the only source of truth.
- `npm run db:check` checks the migration history for conflicts (e.g. two branches that both generated migration 0003).

### 6.2 Storage bucket (connected: Supabase Storage via S3 keys)
1. **One private bucket** (`hub-files`). Files are reached only through short-lived signed URLs our API creates.
2. Folder layout inside the bucket: `<module>/<record-id>/<file-name>` (e.g. `cma/abc123/offering-memo.pdf`).
3. `src/integrations/storage/` talks to the bucket through the **S3 API** with Supabase Storage S3 access keys (`STORAGE_S3_*`). Next: `upload`, `getSignedUrl`, `remove`. Moving to Cloudflare R2 later means changing the endpoint and keys, not code.
4. **Known limits to design around:**
   - Supabase Free allows **50 MB per file** and 1 GB in total.
   - Vercel accepts request bodies only up to **4.5 MB**, so large uploads must go **straight from the browser to storage** with a signed upload URL, never through the API.
   - CMA attachments (up to 100 MB) and Reel videos (up to 300 MB) are above the 50 MB limit. Those modules will need Cloudflare R2 (or Supabase Pro) when we build them.

### 6.3 Users table
Replaces the roster table, the seed list in `convex/agentsData.ts` and its hard-coded admin, ops and guest email lists.

| Column | Type | Notes |
|---|---|---|
| `id` | text, PK | |
| `email` | text, unique | stored lower-case; it's the agent identity across the app |
| `email_verified` | boolean | set after the email code is confirmed |
| `name` | text | |
| `phone` | text, nullable | |
| `role` | enum `admin` · `ops` · `agent` · `guest` | replaces `ADMIN_EMAILS`, `OPS_EMAILS`, `GUESTS` lists |
| `status` | enum `active` · `removed` | removed = can't sign in, hidden from pickers and lead routing |
| `title`, `license_no`, `bio` | text, nullable | agent profile fields from today's roster |
| `photo_key` | text, nullable | storage key of the headshot |
| `drive_folder_id` | text, nullable | the agent's Google Drive video folder |
| `added_by` | text, nullable | who added them on the Team screen |
| `removed_at`, `last_login_at` | timestamptz, nullable | |
| `created_at`, `updated_at` | timestamptz | |

Role meaning, carried over from today's Hub:
- **admin:** Michael, team@, Brandon, Sergio, plus the developer accounts. Everything, including the Team roster, settings and approvals.
- **ops:** smm@, tc@. Operations screens and New Leads.
- **agent:** the roster. Their own tools and data.
- **guest:** an approved outside email. Sees what an agent sees, with an empty inbox, and never appears in lead routing or agent pickers.

### 6.4 Authentication (Better Auth): built

**Files**
- `src/modules/auth/auth.ts`: Better Auth config (rules below).
- `src/modules/auth/auth.routes.ts`: handler mounted at `/api/v1/auth/*`, **before** `express.json()`.
- `src/modules/auth/auth.model.ts`: `sessions`, `accounts`, `verifications`, `rate_limits`.
- `src/modules/users/*`: users table, invitations, service rules and admin endpoints.
- `src/middlewares/auth.ts`: `requireAuth` (session cookie → `req.user`, or 401) and `requireRole(...)` (or 403).
- `src/integrations/email/`: SMTP mailer and the code-email template.

**Rules**
- **Sign-up:**
  - An open invitation → allowed with the invitation's role.
  - Otherwise an email at `AUTH_ALLOWED_DOMAINS` (default `spacematchinc.com`) → allowed as `agent`.
  - Anyone else → `400 SIGNUP_NOT_ALLOWED`, with a readable message.
  - Emails are stored lower-case.
- **Email verification:** a 6-digit code (10 min, 5 tries, stored hashed). Sign-in is refused (`403 EMAIL_NOT_VERIFIED`) until the code is confirmed.
- **Sign-in:** password, or a code (`/sign-in/email-otp`). Signing in by code never creates an account.
- **Removed users:** an admin setting `status: removed` deletes all their sessions at once, and new sign-ins get 403.
- **Password reset:** by emailed code. It signs out the user's other devices.
- **Sessions:** an http-only cookie `smhub.session_token`. Sessions slide: each visit extends them, and 60 days without a visit signs the user out.
- **Rate limits:** stored in the database so all Vercel instances share them; on in production. Sign-in 10/min, sign-up 5/min, code emails 3/min.
- **Passwords from the live Hub:** **verified compatible**. Better Auth verifies hashes created by Convex Auth's scrypt (Lucia) and the reverse, so imported agents keep their passwords.

**Endpoints**

| Method + path | Who | Body / query |
|---|---|---|
| `POST /api/v1/auth/sign-up/email` | public | `{ name, email, password }` → a code is emailed |
| `POST /api/v1/auth/email-otp/verify-email` | public | `{ email, otp }` |
| `POST /api/v1/auth/email-otp/send-verification-otp` | public | `{ email, type: "email-verification" \| "sign-in" \| "forget-password" }` (resend) |
| `POST /api/v1/auth/sign-in/email` | public | `{ email, password }` → session cookie |
| `POST /api/v1/auth/sign-in/email-otp` | public | `{ email, otp }` |
| `POST /api/v1/auth/email-otp/request-password-reset` | public | `{ email }` |
| `POST /api/v1/auth/email-otp/reset-password` | public | `{ email, otp, password }` |
| `GET /api/v1/auth/get-session` · `POST /api/v1/auth/sign-out` | signed in | |
| `GET /api/v1/users/me` · `PATCH /api/v1/users/me` | signed in | `{ name?, phone?, title?, licenseNo?, bio? }` |
| `GET /api/v1/users?role=&status=` | admin, ops | |
| `PATCH /api/v1/users/:id` | admin | `{ role?, status?, name?, phone?, title?, licenseNo?, bio?, driveFolderId? }`; can't demote or remove yourself |
| `GET /api/v1/users/invitations` · `POST` `{ email, role, note? }` · `DELETE /:email` | admin | |

The frontend must send cookies: `credentials: "include"` (already set in `src/lib/api.ts`). Auth `POST`s must come from an origin listed in `CORS_ORIGINS`.

### 6.5 Email (SMTP): ready, waiting for keys
- `sendMail()` in `src/integrations/email/mailer.ts` is the only way the app sends email.
- `MAIL_MODE=off` (default): nothing is sent. Each email is written to the log, and outside production the log includes the body, so codes can be read during development.
- **To go live:** set `SMTP_USER`, `SMTP_PASS` and `MAIL_FROM` in `.env`, then `MAIL_MODE=live`. The server reloads by itself. Any SMTP provider works:
  - Hostinger: `smtp.hostinger.com`, port 465, or 587 with `SMTP_SECURE=false`.
  - Google Workspace: `smtp.gmail.com` + an app password.
  - Resend / Postmark: their SMTP host.
- `MAIL_MODE=live` with missing keys logs an error and sends nothing. `GET /api/v1/health` shows `mail.mode` and whether keys are set.
- **Before going live:** add SPF, DKIM and DMARC DNS records for the sending domain, or codes will land in spam.

### 6.6 First admin
Admins and ops aren't hard-coded any more.
1. Put their emails in `SEED_ADMIN_EMAILS` / `SEED_OPS_EMAILS` in `.env`.
2. Run `npm run db:seed`. This creates invitations with those roles.
3. Each person then signs up normally and gets their role automatically.

After that, admins invite or promote others through `/api/v1/users`.

### 6.7 Tests
`tests/auth.e2e.mjs`: 25 end-to-end checks against a running API:
- sign-up, the domain gate, verification codes, sign-in, profile;
- the role checks, invitations, removing a user;
- password reset, and the stored hash format.

It uses throwaway `zz-e2e-*` accounts and deletes them afterwards. Run it:
- start the API with `MAIL_MODE=off`, logging to a file;
- then `node tests/auth.e2e.mjs http://localhost:4000 <logfile>`.

Never run it against production.

## 7. Adding a new module (checklist)

1. Create `src/modules/<feature>/` with the files from §2 that it needs.
2. Define tables in `<feature>.model.ts`, then `npm run db:generate` and review the SQL migration.
3. Write the repository (queries), then the service (rules), then the validation schemas, then the controller and routes.
4. Mount it in `src/modules/index.ts` with the right auth level.
5. Outside APIs: add or extend an adapter in `src/integrations/`, with its live switch off by default.
6. Scheduled work: add `<feature>.jobs.ts` and register it with the job runner.
7. Tests: service rules + one API test per endpoint.
8. Keep user-facing messages and status phrases **word for word** from the live Hub where the old frontend shows them.

Build order after the foundation (from `MIGRATION_WAVES.md`):
1. Easy, self-contained: vendors, commission rentals, email templates, help, training files, B-roll, feedback.
2. Medium: Market myself, Growth Score, My videos.
3. Listings cluster.
4. Leads + CMA cluster.
5. Mail, seller lists, payments, Reel Studio.
6. Admin stats, announcements, push.

---

## 8. Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Starts the API with auto-reload (`tsx watch`) on `PORT` (default 4000) |
| `npm run typecheck` | Type-checks without writing files |
| `npm run build` | Compiles TypeScript to `dist/` |
| `npm start` | Runs the compiled API |
| `npm run db:generate -- --name x` | Writes a new SQL migration from model changes (offline) |
| `npm run db:migrate` | Applies pending migrations (uses `DIRECT_DATABASE_URL`) |
| `npm run db:check` | Checks migration history for conflicts |
| `npm run db:studio` | Opens Drizzle Studio to browse tables |
| `npm run db:seed` | Runs the idempotent seed script |

Quick check: `curl localhost:4000/api/v1/health`

### Running frontend and backend together (development)

| What | Command | URL |
|---|---|---|
| Backend only | `cd hub_agent/backend && npm run dev` | http://localhost:4000/api/v1/health |
| Frontend only | `cd hub_agent/frontend && npm run dev` | http://localhost:5173 |
| Connection test (both running) | open http://localhost:5173/api/v1/health, or run `await checkApiHealth()` in the browser console | same JSON as the backend |

- **How they connect:** the Vite dev server forwards `/api/v1/*` to the backend (`server.proxy` in `hub_agent/frontend/vite.config.ts`, target `API_PROXY_TARGET`, default `http://localhost:4000`). The frontend calls same-origin `/api/v1/...` through `frontend/src/lib/api.ts`. No CORS is involved in development.
- **In production,** set `VITE_API_URL` on the frontend to the API's origin. The backend allows that origin through `CORS_ORIGINS`, with credentials on.
- **Reloading:** `npm run dev` restarts the backend when code **or `.env`** changes.

---

## 9. Status

| Step | Item | Status |
|---|---|---|
| 1 | Project, TypeScript, Express 5, scripts | ✅ done |
| 1 | Folder structure + module template | ✅ done |
| 1 | Config loader with validation (`config/`) | ✅ done |
| 1 | Middleware: request id, logging, security headers, CORS, JSON body, 404, error format | ✅ done |
| 1 | Health module (`GET /api/v1/health`) | ✅ done, verified locally |
| 2 | Database connection (`src/db/client.ts`, pooled, health check pings it) | ✅ done, verified against Supabase (Postgres 17.12, us-east-1) |
| 2 | Drizzle ORM + Drizzle Kit migrations + seed runner | ✅ set up and verified (no tables created) |
| 2 | Migration `0000_users_and_auth` (users, invitations, sessions, accounts, verifications, rate_limits; RLS on all) | ✅ applied to Supabase |
| 2 | Storage: S3 client (`src/integrations/storage/`), bucket `hub_space_match_bucket`, health check | ✅ connected, verified |
| 2 | Frontend ↔ backend link (Vite proxy `/api/v1`, `src/lib/api.ts`) | ✅ verified |
| 2 | Users table + roles + invitations + admin endpoints | ✅ done |
| 2 | Authentication (Better Auth, email codes, sessions, removed-user block) | ✅ done, 25/25 e2e checks pass |
| 2 | Email sending (SMTP mailer, code template) | ✅ built; ⏳ waiting for SMTP keys (`MAIL_MODE=off` until then) |
| 2 | Tests | ✅ auth e2e script; ⏳ Vitest unit tests with the first feature module |
| 3 | Vercel deployment (preview + production), Sentry | after step 2 |
