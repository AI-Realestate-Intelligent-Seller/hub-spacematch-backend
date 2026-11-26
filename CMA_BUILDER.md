# CMA Builder

Listing-based comparative market analyses. An agent requests a CMA from a listing. A background job
collects comparables, and the engine values the home. The agent reviews, adjusts and publishes, and
the seller then sees the published version at `/s/:token`. Code: `src/modules/cma-builder/`,
frontend `src/pages/CmaBuilderPage.tsx` and `src/components/cma/`.

The older address-based request queue (`/cma`, `/cma-worker`, the `/new` form in the frontend) is
unchanged. It still handles commercial, lease and investor requests, and the listing page links to it.

## Flow

```
Listing page "Request CMA" ─► POST /listings/:id/cma/request (202, returns at once)
   └─ cma_reports row (queued) + jobs row (cmaBuilder.collect | cmaBuilder.collectBrowser)
Worker (npm run worker) / API cron ─► provider.collect ─► normalize + dedupe + filter
   ─► cma_comparables ─► engine (auto-select, score, value) ─► ready_for_review ─► email to agent
Agent edits (draft) ─► publish (frozen) ─► seller page + PDF job (cmaBuilder.renderPdf) + weekly email
Weekly cron (cma-weekly-refresh) ─► new draft version ─► email only if value moved ≥ CMA_REFRESH_THRESHOLD_PCT
```

Statuses: `queued → collecting → normalizing → analyzing → ready_for_review → draft → published`
(an earlier published version becomes `superseded`), plus `failed` and `cancelled`. Listing-level
statuses derived from these are `not_requested` and `refreshing` (a newer version is collecting while
one is published). A database index allows only one unfinished report per listing, which is the
duplicate-request guard.

## Tables (migration `0007_cma_builder.sql`, additive only)

| Table | Purpose |
|---|---|
| `cma_reports` | One row per version: search params, subject facts, analysis, override, report text, stage timestamps, who requested, reviewed and published, PDF key |
| `cma_comparables` | Collected, manual and CSV comparables per version, with source, fixture flag, selection and adjustments (jsonb, each with who, when and why) |
| `cma_logs` | Collection steps and errors (`collection`) and audit trail (`audit`). Never shown to sellers |
| `cma_market_snapshots` | Market numbers per analysed version (trend, "new sales since last time") |

Background jobs use the existing `jobs` table, with a de-duplicated enqueue (`enqueueUnique`).

## API

| Endpoint | |
|---|---|
| `GET /listings/:id/cma/defaults` | Request dialog prefill (listing plus the latest legacy CMA request for the same street), sources |
| `POST /listings/:id/cma/request` | Create and enqueue. 409 if a CMA is already open |
| `GET /listings/:id/cma/status` · `/cma` · `/history` · `/context` · `/facts` | Button status · builder payload · versions + trend · marketing numbers · published facts for the AI plan |
| `GET/PATCH /cma-reports/:id` | Report (subject, content, override, size-suggestion rate) |
| `GET/POST /cma-reports/:id/comparables`, `PUT …/selection`, `PATCH/DELETE …/:comparableId` | Comparables. Only manual and CSV records can be edited or deleted |
| `POST /cma-reports/:id/import` · `calculate` · `publish` · `refresh` · `retry` · `cancel` | Publish, retry and cancel are idempotent; publish needs `{ confirm: true }` |
| `GET /cma-reports/:id/preview` · `/pdf` | Sandboxed HTML (CSP `default-src 'none'`) · signed PDF or PowerPoint link for reviewed drafts and published versions |
| `GET /portal/:token/cma` · `/report` · `/pdf` | Seller: published data only |

`/cma/:id` already belongs to the legacy queue, so report endpoints live under `/cma-reports/:id`.
Access works like the listings module: the listing's agent, or admins and ops. There is a single
team, so listing ownership is what isolates one agent's data from another's.

## Valuation method (`engine/valuation.ts`, pure and unit-tested)

1. Sold comparables are the basis of value. Active and pending listings are shown as competition only.
2. Similarity (0–100) is built from distance, recency, size, beds, baths, type, age, lot and condition. A factor
   missing on either side is dropped, the remaining weights are rescaled, and `coverage` records the share used.
3. Adjusted value = sold price + the agent's adjustments. The engine only *suggests* size adjustments:
   Δsq ft × median sold $/sq ft × rate (50% by default, editable per report).
4. Estimate = similarity-weighted mean of the selected sold comps' adjusted values, rounded to $1,000.
5. Range = weighted 25th–75th percentile of those values (min–max under 4 comps). This describes the
   spread of the comparables. It is **not** a confidence interval.
6. Fewer than 3 selected sold comps gives `insufficient_data`: no value is produced and publishing is blocked,
   unless the agent records an override with a reason.
7. Outliers are sold $/sq ft values outside the Tukey fences (4+ comps). They're flagged and left out of auto-selection.
8. Data quality is scored from sample size, distance, recency, completeness and spread.

Marketing numbers (showings, feedback, views) are shown next to the value but never enter it.

## Data sources (`providers/`)

| Source | State |
|---|---|
| Manual entry + CSV import | Works; tested |
| `browser:fixture-portal` | **Development fixture**: a local fake portal rendered in Chromium (no network) that exercises the real browser pipeline. Only when `CMA_DEV_FIXTURES=true` and not in production; every record is flagged and badged |
| `browser:mred` (connectMLS) | Paused. The adapter is retained in source for future work and is excluded from CMA collection. |
| `rentcast` | API provider (recorded sales + active listings); needs `RENTCAST_API_KEY`. Not tested live |
| `lofty` | Listed as unavailable: Lofty's API has no comparable-sales data and the Lofty connector isn't on this backend yet |

Browser safety rules: isolated context per job; requests to non-allow-listed hosts are blocked (SSRF);
downloads, pop-ups and dialogs are refused; timeout per job; cancel closes the context; bounded
retries with exponential backoff; per-provider rate limit; CAPTCHAs, device checks and login refusals
stop the job (no bypassing); scraped text is cleaned and treated as data only. Adding a source means
one adapter file plus one line in `providers/index.ts`.

## Running it

```bash
npm run dev            # API (as before)
npm run worker         # CMA worker: browser collection and report exports
npm run test:cma       # unit tests (engine, normalization, CSV, retries, real headless Chromium)
```

Chromium: `npx playwright-core install chromium` (one-time download) or point
`CMA_BROWSER_EXECUTABLE` at an existing Chromium/headless-shell binary.

### PDF and PowerPoint export (Node only, runs on Vercel)

`report-export.ts` builds one PDF: the filled seller template pages (`report-template.ts`, a Node port of
`cma-export/reference.py`) followed by the full analysis (`report-html.ts` printed by Chromium). The
PowerPoint has one picture per PDF page, rasterized by pdf.js inside the same Chromium.

- **Where it runs:** with `CMA_EXPORT_MODE=inline` (default) the API renders in the download request
  (about 2–3 s warm, ~10 s on a cold Vercel function) and uploads both files to storage. A failed render
  is retried by the `cmaBuilder.renderPdf` job. `CMA_EXPORT_MODE=worker` leaves it to the worker instead.
- **Chromium:** on Vercel / AWS Lambda, `@sparticuz/chromium` (version pinned to playwright-core's
  Chromium, 143). Elsewhere `CMA_BROWSER_EXECUTABLE` or Playwright's own download.
- **Template assets** (`cma-export/template/`): `blank.pdf` (the 43-page `sources/new.pdf` with every field's
  text, the photos and the "N / 43" footers removed), `fields.json` (each field's box, font, size, colour,
  alignment) and the fonts. pdf-lib can't read or redact PDF text, so these are made once with Python.
  **Rebuild them only when `sources/new.pdf` or the field map in `reference.py` changes:**

  ```bash
  python3 -m venv .venv && .venv/bin/pip install -r cma-export/requirements.txt   # once
  .venv/bin/python cma-export/build_template.py                                    # then commit cma-export/template/
  ```

- Pins: `pdfjs-dist` 4.x (5.x needs a newer Chromium than 143). GowunDodum is embedded whole because
  pdf-lib's subsetter drops its glyphs.
- Checked against the Python exporter on dev CMAs: same pages, at most 0.02% of pixels different.

The export endpoints default to PDF. Pass `?format=pptx` for PowerPoint or
`&download=1` to request an attachment. The seller endpoints serve the published version.

End-to-end (throwaway accounts, cleaned up afterwards). Run against a **separate** API with mail off:

```bash
MAIL_MODE=off CMA_DEV_FIXTURES=true PORT=4100 CORS_ORIGINS=http://localhost:5173,http://localhost:5174 npx tsx src/server.ts
MAIL_MODE=off CMA_DEV_FIXTURES=true npx tsx src/worker.ts
node tests/cma.e2e.mjs http://localhost:4100
# UI (from frontend/): API_PROXY_TARGET=http://localhost:4100 npx vite --port 5174
#                      node scripts/cma.ui-test.mjs http://localhost:5174 /tmp/cma-shots
```

## Deployment

- The API stays on Vercel. New crons in `vercel.json`: `cma-weekly-refresh` (Mon 03:00 UTC, before the
  Monday seller email) and `cma-recover` (hourly; re-queues collections a crashed worker left behind).
- PDF and PowerPoint exports run on Vercel (see above); no worker is needed for them.
- The worker is only needed for **browser-based comparable sources** (none are enabled today). It needs
  an always-on process: `Dockerfile.worker` on any container host (about 1 GB RAM with concurrency 1),
  or `npm run build && npm run worker:start` on a VM. Jobs live in Postgres, so restarts lose nothing.
- Without a worker, RentCast and manual CMAs work (the API cron runs `cmaBuilder.collect` every
  10 minutes); browser collection waits in the queue.
- Environment variables: see the CMA Builder block in `.env.example`.

## Automatic property research

The listing detail **Request CMA** button posts to `/api/v1/listings/:id/cma/request`.
The existing one-open-report constraint and job queue cover the research and comparable
collection together, including requests using Manual entry / CSV import. The legacy full
request form still uses its separate address-based queue.

The worker checks the listing address and the versioned research cache, then geocodes with
Census and selects a county adapter by FIPS. Cook County requires a unique PIN and a matching
current situs address before attaching records. Ambiguous matches leave the CMA available
for review and show an address clarification message. Public requests use short timeouts
and one retry for eligible upstream service errors. HTTP 429 responses surface as partial
or unavailable results without immediate retries. Active requests can be cancelled through
the existing CMA controls.

Research, provenance and approval keys live in `cma_reports.content`. County sale candidates
use existing `cma_comparables` rows with source `public-records`. No migration is required.
`CMA_PROPERTY_RESEARCH_CACHE_HOURS` defaults to 168, and 0 disables reuse. Re-collect or
Refresh research on an editable draft bypasses the cache. An address change causes a cache
miss, and an older published version remains available while a new report is prepared.

County data can fill missing beds, baths and year built for analysis. Explicit CMA values
take precedence. Exterior building area and condo unit area are kept as source-specific
facts. Development-wide measurements are never used as subject unit measurements. County
candidates are screened by deed and county sale flags, then joined to addresses, coordinates
and available property characteristics for the sale year. Search uses the same assessment
neighborhood and class over a two-year discovery window, with radius and size screening
when available. A condo development may share a parcel centroid. The analysis and market
statistics include county candidates only after agent selection.

The Property research tab shows source facts, conflicts, missing fields, progress and
provider issues. Sales and assessments are shown as separate tables and charts. Agents can
choose facts and histories for publication and resolve eligible discrepancies by applying
a county value. The seller portal and report HTML/PDF use the approved snapshot from the
published CMA version. The REST listing's Neighborhood & marketing plan card can copy a
prompt containing published CMA and property facts. The automated legacy Convex plan
generator remains a separate workflow.

### Live verification

On November 26, 2026, the Census address and coordinates endpoints responded for
1532 Mohawk Trl, Wheeling, IL 60090. Census reported Cook County (17031) and interpolated
coordinates 42.130968407752, −87.954512370626. Cook County verified PIN
`03093080961450`, class 299, three bedrooms, year built 1980 and a shared parcel centroid
of 42.1300643331, −87.9577372742. The latest condo record did not contain unit square
footage or bathrooms. Residential improvement and commercial valuations returned no
subject rows. Sales returned two warranty deeds, $177,000 on December 1, 2001 and
$157,000 on June 1, 2000. Assessed values were $27,365 in 2025 and 2026 and
$19,435 in 2023 and 2024. Cook County mapped elementary District 21, secondary
District 214 and no intersection with the mapped FEMA special flood hazard area at
the county parcel record. The isolated CMA showed 20 screened public comparable
candidates after deduplication.

Direct FEMA layer 28 queries reset the connection. The tested OpenStreetMap Overpass
endpoint timed out and then returned HTTP 406. Live FEMA zone codes, Overpass amenities
and transportation, verified property tax bills, and DuPage and Lake County adapters
remain outside the current integration.

### Manual smoke test

1. Start the API, CMA worker and frontend against an isolated development database.
   Configure object storage for PDF download (rendered by the API; no worker needed).
2. Create an isolated listing for 1532 Mohawk Trl, Wheeling, IL 60090 and open its
   listing detail. Click **Request CMA** and submit the dialog. Manual entry / CSV
   import runs the automatic public research as well.
3. Open the CMA Builder and its **Property research** tab. Confirm the PIN, sale history
   and assessment values. Resolve any subject conflicts and choose the research items
   to include in the report.
4. In **Comparables**, review and explicitly select appropriate **Public Records**
   sales and/or existing comparable sources. Use the existing **Publish** flow after
   reviewing the valuation.
5. Open the test listing's seller link. Check the published valuation and approved
   property research, and open the report or download the PDF. Start a refresh and
   verify the prior published version remains visible.

### Implementation and test inventory

- Provider and review logic: `src/modules/property-intelligence/{research,review}.ts`.
- Existing CMA integration: `cma-builder.{service,jobs,types,validation,view,public}.ts`,
  `engine/valuation.ts` and `report-html.ts` under `src/modules/cma-builder`.
- Cache configuration: `src/config/{env,index}.ts` and `.env.example`.
- Frontend: CMA Builder, Property Research, Comparables, Request CMA dialog, Seller Market
  section, Listing Detail, Neighborhood & Marketing Plan and the CMA API client.
- Added `tests/cma/property-intelligence.test.ts` for parcel ambiguity, sale screening,
  selection gating, source precedence, invalid or unsupported addresses, timeout,
  rate limit, cancellation and partial results.
- All 40 CMA tests passed. The existing CMA API regression suite passed with temporary
  PostgreSQL, Chromium and a loopback storage test double. The live Wheeling workflow
  and browser smoke test passed, including the Request CMA click, agent review,
  seller access, approved research, marketing prompt and 390 px layout checks.
- Backend and frontend builds and type checks passed. Drizzle schema check and an
  isolated migration run passed. Lint passed for the edited frontend files. The
  full frontend lint command reported 43 errors in other files.


### Existing MRED drafts

MRED is excluded from provider selection and new collection jobs. For a draft using the
retired source, open CMA Builder and select **Continue with manual entry / CSV** or
**Re-collect with RentCast** when RentCast is configured. Public property research remains
available. Previously saved reports and activity remain in history.
