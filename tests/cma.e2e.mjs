// End-to-end test for the CMA Builder: listing → request → background collection (worker, headless
// Chromium, DEVELOPMENT FIXTURE portal) → review → comparables → adjustments → CSV → publish → seller
// page → PDF → refresh/cancel → history → isolation.
//
// From backend/, start a test API and worker with mail off and fixtures on (NOT the live dev API):
//   MAIL_MODE=off CMA_DEV_FIXTURES=true PORT=4100 npx tsx src/server.ts
//   MAIL_MODE=off CMA_DEV_FIXTURES=true CMA_BROWSER_EXECUTABLE=… npx tsx src/worker.ts
//   node tests/cma.e2e.mjs http://localhost:4100
// Creates throwaway zz-e2e-cma-* accounts and a listing, and deletes everything it creates.
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/package.json");
require("dotenv").config({ quiet: true });
const pg = require("postgres"); const postgres = pg.default ?? pg;

const API = process.argv[2] ?? "http://localhost:4100";
const ORIGIN = "http://localhost:5173";
const DOMAIN = (process.env.AUTH_ALLOWED_DOMAINS ?? "linchpin.net").split(",")[0].trim();
const ts = Date.now();
const AGENT = `zz-e2e-cma-agent-${ts}@${DOMAIN}`;
const OTHER = `zz-e2e-cma-other-${ts}@${DOMAIN}`;
const OPS = `zz-e2e-cma-ops-${ts}@${DOMAIN}`;
const PW = "Test-password-123";
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, ssl: "require" });

let failures = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`); if (!ok) failures++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function call(method, path, body, cookie, raw = false) {
  const res = await fetch(API + path, { method, headers: { "content-type": "application/json", origin: ORIGIN, ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json: raw ? text : json, headers: res.headers, cookie: (res.headers.getSetCookie?.() ?? []).map(c => c.split(";")[0]).join("; ") };
}
async function account(email, name, role) {
  await call("POST", "/api/v1/auth/sign-up/email", { name, email, password: PW });
  await sql`update users set email_verified = true, role = ${role} where email = ${email}`;
  const r = await call("POST", "/api/v1/auth/sign-in/email", { email, password: PW });
  if (r.status !== 200) throw new Error(`sign-in failed for ${email}: ${r.status}`);
  return r.cookie;
}
async function waitFor(fn, what, ms = 120_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(1500); }
  throw new Error(`timed out waiting for ${what}`);
}

let listingId;
try {
  const agent = await account(AGENT, "Zz Cma Agent", "agent");
  const other = await account(OTHER, "Zz Cma Other", "agent");
  const ops = await account(OPS, "Zz Cma Ops", "ops");

  let r = await call("POST", "/api/v1/listings", { address: "851 N Eagle St, Naperville, IL 60563", sellerName: "Zz Seller", priceCents: 52_000_000, sellerEmail: `zz-seller-${ts}@example.com` }, agent);
  check("test listing created", r.status === 201, `status ${r.status}`);
  listingId = r.json.id;
  const token = r.json.token;

  // ---------- Access and defaults ----------
  r = await call("GET", `/api/v1/listings/${listingId}/cma/status`);
  check("signed out: refused", r.status === 401);
  r = await call("GET", `/api/v1/listings/${listingId}/cma/status`, null, other);
  check("another agent can't see this listing's CMA (isolation)", r.status === 404, `status ${r.status}`);
  r = await call("GET", `/api/v1/listings/${listingId}/cma/status`, null, ops);
  check("ops can see it", r.status === 200 && r.json.status === "not_requested", JSON.stringify(r.json).slice(0, 120));
  r = await call("GET", `/api/v1/listings/${listingId}/cma/defaults`, null, agent);
  check("defaults prefill address, ZIP and asking price", r.status === 200 && r.json.subject.zip === "60563" && r.json.subject.askingPrice === 520000 && r.json.params.radiusMi === 1, JSON.stringify(r.json.subject));
  const fixture = r.json.providers.find(p => p.id === "browser:fixture-portal");
  check("fixture source offered (test server has CMA_DEV_FIXTURES=true)", fixture?.available === true);
  check("MRED is excluded from source selection", r.json.providers.every(p => p.id !== "browser:mred"));

  // ---------- Request ----------
  const req = { subject: { ...r.json.subject, beds: 3, baths: 2, sqft: 2000, yearBuilt: 1990, condition: "Average / well maintained", lat: 41.77, lng: -88.15 }, radiusMi: 5, soldWithinDays: 180, propertyTypes: ["single_family"], statuses: ["sold", "active", "pending"], provider: "browser:fixture-portal" };
  r = await call("POST", `/api/v1/listings/${listingId}/cma/request`, { ...req, radiusMi: 2 }, agent);
  check("invalid radius refused", r.status === 400, `status ${r.status}`);
  r = await call("POST", `/api/v1/listings/${listingId}/cma/request`, { ...req, provider: "browser:mred" }, agent);
  check("paused source refused", r.status === 400 && /Unknown data source/.test(r.json.error?.message), r.json.error?.message);
  const [first, dup] = await Promise.all([call("POST", `/api/v1/listings/${listingId}/cma/request`, req, agent), call("POST", `/api/v1/listings/${listingId}/cma/request`, req, agent)]);
  const okReq = [first, dup].find(x => x.status === 202);
  check("request returns at once (202) with an id", !!okReq?.json.id && okReq.json.status === "queued");
  check("a simultaneous duplicate request is refused (409)", [first, dup].some(x => x.status === 409), `${first.status}/${dup.status}`);
  const reportId = okReq.json.id;
  r = await call("POST", `/api/v1/listings/${listingId}/cma/request`, req, agent);
  check("a later duplicate is refused too", r.status === 409);
  const [jobs] = await sql`select count(*)::int as n from jobs where kind = 'cmaBuilder.collectBrowser' and payload->>'reportId' = ${reportId}`;
  check("one collection job queued", jobs.n === 1, `${jobs.n}`);

  r = await call("GET", `/api/v1/portal/${token}/cma`);
  check("seller sees 'requested/processing', no report", r.status === 200 && ["requested", "processing"].includes(r.json.state) && r.json.report === null, r.json.state);

  // ---------- Collection (worker) ----------
  const ready = await waitFor(async () => { const s = await call("GET", `/api/v1/listings/${listingId}/cma/status`, null, agent); return s.json.status === "ready_for_review" ? s.json : s.json.status === "failed" ? s.json : null; }, "collection");
  check("worker collected and analysed: ready for review", ready.status === "ready_for_review", ready.current?.errorMessage ?? "");
  check("stages recorded with timestamps", ["queued", "collecting", "normalizing", "analyzing", "ready_for_review"].every(st => ready.current.stages.some(s => s.stage === st && s.at)));

  r = await call("GET", `/api/v1/cma-reports/${reportId}`, null, agent);
  const rep = r.json;
  check("comparables stored with source and fixture flag", rep.comparables.length === 12 && rep.comparables.every(c => c.isFixture && c.source === "browser:fixture-portal"), `${rep.comparables.length}`);
  check("duplicate and broken fixture rows handled", rep.activity.some(a => /1 record\(s\) rejected/.test(a.message)) && rep.activity.some(a => /1 duplicates merged/.test(a.message)));
  check("analysis ok with a value and a range", rep.analysis.status === "ok" && rep.estimatedValue > 0 && rep.range.low <= rep.estimatedValue && rep.range.high >= rep.estimatedValue, `${rep.estimatedValue}`);
  check("outlier flagged and not auto-selected", rep.comparables.some(c => c.outlier && !c.selected));
  check("injected page text did not change the value", rep.estimatedValue < 2_000_000);
  check("fixture warning in the analysis", rep.analysis.warnings.some(w => /fixture/i.test(w)));

  r = await call("GET", `/api/v1/portal/${token}/cma`);
  check("seller: 'under review', still nothing published", r.json.state === "under_review" && r.json.report === null);
  check("seller response has no internal data", !JSON.stringify(r.json).match(/activity|errorMessage|collection|fixture-portal/));

  // ---------- Builder edits ----------
  r = await call("POST", `/api/v1/cma-reports/${reportId}/comparables`, { status: "sold", address: "77 Manual Test Ln", soldPrice: 515000, soldDate: "2026-10-15", sqft: 2050, beds: 3, baths: 2, distanceMi: 0.3 }, agent);
  check("manual comparable added and selected", r.status === 201 && r.json.manual && r.json.selected, `status ${r.status}`);
  const manualId = r.json.id;
  r = await call("POST", `/api/v1/cma-reports/${reportId}/comparables`, { status: "sold", address: "77 Manual Test Ln", soldPrice: 515000, soldDate: "2026-10-15" }, agent);
  check("same property twice refused", r.status === 409);
  r = await call("POST", `/api/v1/cma-reports/${reportId}/comparables`, { status: "sold", address: "78 Manual Test Ln" }, agent);
  check("sold comp without price/date refused", r.status === 400);

  const before = (await call("GET", `/api/v1/cma-reports/${reportId}`, null, agent)).json.estimatedValue;
  r = await call("PATCH", `/api/v1/cma-reports/${reportId}/comparables/${manualId}`, { adjustments: [{ category: "condition", amount: 15000, reason: "Subject has a newer kitchen" }] }, agent);
  check("adjustment recorded with who/when", r.status === 200 && r.json.adjustments[0].byEmail === AGENT && r.json.adjustedValue === 530000, JSON.stringify(r.json.adjustments));
  const afterAdj = (await call("GET", `/api/v1/cma-reports/${reportId}`, null, agent)).json;
  const mc = afterAdj.comparables.find(c => c.id === manualId);
  check("report GET shows the adjusted value and total", mc.adjustedValue === 530000 && mc.adjustmentTotal === 15000, `${mc.adjustedValue} / ${mc.adjustmentTotal}`);
  check("valuation recalculated after the adjustment", afterAdj.estimatedValue !== before, `${before} → ${afterAdj.estimatedValue}`);
  check("editing moved the report to draft", afterAdj.status === "draft" && afterAdj.reviewedByName === "Zz Cma Agent");

  const collected = afterAdj.comparables.find(c => !c.manual);
  r = await call("PATCH", `/api/v1/cma-reports/${reportId}/comparables/${collected.id}`, { fields: { soldPrice: 400000 } }, agent);
  check("collected records can't be edited", r.status === 409);
  r = await call("DELETE", `/api/v1/cma-reports/${reportId}/comparables/${collected.id}`, null, agent);
  check("collected records can't be deleted", r.status === 409);

  const csv = "Address,Status,Close Price,Close Date,Beds,Baths,Sq Ft,Distance\n90 Csv Test Ct,Closed,\"$505,000\",2026-09-20,3,2,1980,0.6\nbad row,Closed,,,,,,\n91 Csv Test Ct,Active,,,3,2,2000,0.7\n";
  r = await call("POST", `/api/v1/cma-reports/${reportId}/import`, { csv }, agent);
  check("CSV import: 1 imported, 2 rejected with reasons", r.status === 200 && r.json.imported === 1 && r.json.rejectedCount === 2, JSON.stringify(r.json).slice(0, 200));
  r = await call("POST", `/api/v1/cma-reports/${reportId}/import`, { csv: "foo,bar\n1,2" }, agent);
  check("CSV without required columns refused", r.status === 400);

  const cur = (await call("GET", `/api/v1/cma-reports/${reportId}`, null, agent)).json;
  const soldIds = cur.comparables.filter(c => c.status === "sold").map(c => c.id);
  r = await call("PUT", `/api/v1/cma-reports/${reportId}/comparables/selection`, { selectedIds: soldIds.slice(0, 2) }, agent);
  check("deselecting to 2 sales → insufficient data, no value", r.json.analysis.status === "insufficient_data" && r.json.estimatedValue === null && !r.json.canPublish);
  r = await call("POST", `/api/v1/cma-reports/${reportId}/publish`, { confirm: true }, agent);
  check("publishing with insufficient data refused", r.status === 409, r.json.error?.message);
  r = await call("PUT", `/api/v1/cma-reports/${reportId}/comparables/selection`, { selectedIds: cur.comparables.filter(c => c.selected).map(c => c.id) }, agent);
  check("selection restored", r.json.analysis.status === "ok");

  r = await call("PATCH", `/api/v1/cma-reports/${reportId}`, { override: { value: 999, reason: "short" } }, agent);
  check("bad override refused", r.status === 400);
  r = await call("PATCH", `/api/v1/cma-reports/${reportId}`, { content: { executiveSummary: "Strong demand <b>nearby</b>.", pricingRecommendation: "List at $525,000.", recommendedListPrice: 525000, recommendedLow: 510000, recommendedHigh: 535000 } }, agent);
  check("report text and recommended range saved", r.status === 200 && r.json.range.fromAgent && r.json.range.low === 510000);

  r = await call("GET", `/api/v1/cma-reports/${reportId}/preview`, null, agent, true);
  check("preview HTML escapes agent text and is sandboxed", r.status === 200 && r.json.includes("&lt;b&gt;nearby") && /default-src 'none'/.test(r.headers.get("content-security-policy") ?? ""));
  r = await call("GET", `/api/v1/cma-reports/${reportId}/pdf`, null, agent);
  check("agent can request a draft PDF", r.status === 200 && r.json.status === "rendering");
  const draftPdf = await waitFor(async () => {
    const p = await call("GET", `/api/v1/cma-reports/${reportId}/pdf`, null, agent);
    return p.json.status === "ready" ? p.json : null;
  }, "draft PDF");
  check("draft PDF is available for preview", (await (await fetch(draftPdf.url)).text()).startsWith("%PDF"));
  r = await call("GET", `/api/v1/cma-reports/${reportId}/pdf?format=pptx`, null, other);
  check("another agent cannot download a draft export", r.status === 404);
  r = await call("GET", `/api/v1/cma-reports/${reportId}/preview?audience=seller`, null, agent, true);
  check("seller preview uses printable chapters and hides agent-only match scores", r.status === 200 && r.json.includes("break-before: page") && !r.json.includes(">Match</th>"));

  // ---------- Publish ----------
  r = await call("POST", `/api/v1/cma-reports/${reportId}/publish`, {}, agent);
  check("publish needs confirmation", r.status === 400);
  r = await call("POST", `/api/v1/cma-reports/${reportId}/publish`, { confirm: true }, other);
  check("another agent can't publish", r.status === 404);
  r = await call("POST", `/api/v1/cma-reports/${reportId}/publish`, { confirm: true }, agent);
  check("published", r.status === 200 && r.json.status === "published" && !r.json.alreadyPublished, `status ${r.status} ${r.json.error?.message ?? ""}`);
  r = await call("POST", `/api/v1/cma-reports/${reportId}/publish`, { confirm: true }, agent);
  check("publishing again is idempotent", r.status === 200 && r.json.alreadyPublished === true);
  r = await call("PATCH", `/api/v1/cma-reports/${reportId}`, { content: { executiveSummary: "changed" } }, agent);
  check("published version is frozen", r.status === 409);

  r = await call("GET", `/api/v1/portal/${token}/cma`);
  const seller = r.json;
  check("seller sees the published report", seller.state === "published" && seller.report.estimatedValue > 0 && seller.report.range.low === 510000 && seller.report.recommendedListPrice === 525000);
  check("seller report has no logs, override, adjustments or internal fields", !JSON.stringify(seller).match(/activity|override|"adjustments":\[|adjustedValue|byEmail|similarity|errorMessage|requestedByEmail|statusNote|stages/));
  check("seller sees value history", seller.history.length === 1);
  r = await call("GET", `/api/v1/portal/${token}/cma/report`, null, null, true);
  check("seller full report HTML", r.status === 200 && r.json.includes("Comparative market analysis".toUpperCase()) && !r.json.includes("Agent override"));
  r = await call("GET", `/api/v1/portal/short-token/cma`);
  check("bad seller token refused", r.status === 400 || r.status === 404);

  // ---------- PDF and PowerPoint (worker) ----------
  const pdf = await waitFor(async () => { const p = await call("GET", `/api/v1/cma-reports/${reportId}/pdf`, null, agent); return p.json.status === "ready" ? p.json : null; }, "PDF");
  const bytes = Buffer.from(await (await fetch(pdf.url)).arrayBuffer());
  check("PDF rendered and stored for the published version", bytes.subarray(0, 4).toString() === "%PDF" && bytes.length > 5000, `${bytes.length} bytes`);
  r = await call("GET", `/api/v1/portal/${token}/cma/pdf`);
  check("seller can download the same PDF", r.json.status === "ready" && new URL(r.json.url).pathname === new URL(pdf.url).pathname);
  r = await call("GET", `/api/v1/portal/${token}/cma/pdf?format=pptx&download=1`);
  const slides = Buffer.from(await (await fetch(r.json.url)).arrayBuffer());
  check("seller can download the matching PowerPoint", r.status === 200 && slides.subarray(0, 2).toString() === "PK" && slides.includes(Buffer.from("ppt/slides/slide1.xml")));

  r = await call("GET", `/api/v1/listings/${listingId}/cma/facts`, null, agent);
  check("AI plan facts: published numbers + fair-housing rules", r.json.available && r.json.estimatedValue === seller.report.estimatedValue && r.json.rules.some(x => /Fair housing/.test(x)));

  // ---------- Refresh → new draft version; cancel; seller keeps the published one ----------
  r = await call("POST", `/api/v1/cma-reports/${reportId}/refresh`, null, agent);
  check("refresh starts version 2 (queued)", r.status === 202 && r.json.version === 2, `status ${r.status}`);
  const v2 = r.json.id;
  r = await call("GET", `/api/v1/listings/${listingId}/cma/status`, null, agent);
  check("listing status shows refreshing while v1 stays published", ["refreshing"].includes(r.json.status) && r.json.published.id === reportId, r.json.status);
  r = await call("GET", `/api/v1/portal/${token}/cma`);
  check("seller still sees the published report during the refresh", r.json.state === "refreshing" && r.json.report.id === reportId);
  r = await call("POST", `/api/v1/cma-reports/${v2}/cancel`, null, agent);
  check("cancel version 2", r.status === 200 && r.json.status === "cancelled");
  r = await call("POST", `/api/v1/cma-reports/${v2}/cancel`, null, agent);
  check("cancel is idempotent", r.status === 200);
  r = await call("POST", `/api/v1/cma-reports/${v2}/retry`, null, agent);
  check("only failed versions can be retried", r.status === 409);
  await sleep(4000);
  r = await call("GET", `/api/v1/cma-reports/${v2}`, null, agent);
  check("cancelled version stays cancelled (worker respects it)", r.json.status === "cancelled", r.json.status);

  // A failed collection → retry.
  r = await call("POST", `/api/v1/cma-reports/${reportId}/refresh`, null, agent);
  const v3 = r.json.id;
  await sql`update cma_reports set status = 'failed', error_message = 'test failure' where id = ${v3}`;
  await sql`delete from jobs where payload->>'reportId' = ${v3}`;
  r = await call("POST", `/api/v1/cma-reports/${v3}/retry`, null, agent);
  check("failed version can be retried", r.status === 202 && r.json.status === "queued");
  r = await call("POST", `/api/v1/cma-reports/${v3}/retry`, null, agent);
  check("retry is idempotent while queued", r.status === 202);
  const v3done = await waitFor(async () => { const x = await call("GET", `/api/v1/cma-reports/${v3}`, null, agent); return ["ready_for_review", "failed"].includes(x.json.status) ? x.json : null; }, "retry collection");
  check("retried collection finished", v3done.status === "ready_for_review");
  check("change vs the published version computed", v3done.analysis.comparedToPublished?.reportId === reportId);
  r = await call("POST", `/api/v1/cma-reports/${v3}/publish`, { confirm: true }, agent);
  check("version 3 published", r.json.status === "published");
  r = await call("GET", `/api/v1/cma-reports/${reportId}`, null, agent);
  check("version 1 superseded (kept)", r.json.status === "superseded");

  r = await call("GET", `/api/v1/listings/${listingId}/cma/history`, null, agent);
  check("history lists all versions newest first, with a value trend", r.json.total === 3 && r.json.items[0].version === 3 && r.json.trend.length >= 2, JSON.stringify(r.json.items.map(i => `${i.version}:${i.status}`)));
  r = await call("GET", `/api/v1/portal/${token}/cma`);
  check("seller history shows both published versions", r.json.history.length === 2 && r.json.report.version === 3);
  r = await call("GET", `/api/v1/listings/${listingId}/cma/context`, null, agent);
  check("marketing context separate from valuation", r.status === 200 && /does not change/.test(r.json.note));

  r = await call("POST", `/api/v1/cma-reports/${v3}/revise`, {}, other);
  check("another agent can't revise a published CMA", r.status === 404);
  r = await call("POST", `/api/v1/cma-reports/${v3}/revise`, {}, agent);
  const revision = r.json;
  check("edit published CMA creates an immediately editable version", r.status === 200 && revision.version === 4 && revision.status === "draft");
  r = await call("GET", `/api/v1/cma-reports/${revision.id}`, null, agent);
  const selection = comps => comps.map(c => [c.address, c.selected]).sort();
  check("revision copies all comparable rows and their selections", JSON.stringify(selection(r.json.comparables)) === JSON.stringify(selection(v3done.comparables)));
  r = await call("POST", `/api/v1/cma-reports/${revision.id}/comparables`, { status: "sold", address: "10 Revision Test Ln", soldPrice: 515000, soldDate: "2026-10-15" }, agent);
  check("agent can add a comparable to the revision", r.status === 201);
  r = await call("GET", `/api/v1/portal/${token}/cma`);
  check("seller keeps the published version while the revision is edited", r.json.report.id === v3);

  await sql`update cma_reports set provider = 'browser:mred', params = jsonb_set(params, '{provider}', '"browser:mred"'::jsonb) where id = ${revision.id}`;
  r = await call("GET", `/api/v1/listings/${listingId}/cma/defaults`, null, agent);
  check("old MRED draft defaults to an available source", r.status === 200 && r.json.providers.some(p => p.id === r.json.params.provider && p.available));
  // Simulate a previous collection still doing its follow-up after the report became editable.
  const previousJob = `cma-e2e-previous-${ts}`;
  await sql`insert into jobs (id, kind, payload, status) values (
    ${previousJob}, 'cmaBuilder.collect', ${sql.json({ reportId: revision.id })}, 'running'
  )`;
  r = await call("POST", `/api/v1/cma-reports/${revision.id}/refresh`, { provider: "manual" }, agent);
  check("old MRED draft can continue with manual entry", r.status === 202 && r.json.id === revision.id);
  const [newJob] = await sql`select id from jobs where kind = 'cmaBuilder.collect'
    and payload->>'reportId' = ${revision.id} and id <> ${previousJob}`;
  check("re-collect queues a fresh job while the previous job is still running", !!newJob);
  if (newJob) await waitFor(async () => {
    const report = await call("GET", `/api/v1/cma-reports/${revision.id}`, null, agent);
    return report.json.status === "ready_for_review";
  }, "re-collection to finish");
  r = await call("GET", `/api/v1/cma-reports/${revision.id}`, null, agent);
  check("draft records its replacement source", r.status === 200 && r.json.provider === "manual");
  check("switching source preserves manually entered comparables", r.json.comparables.some(c => c.address === "10 Revision Test Ln"));

} catch (e) {
  failures++;
  console.error("ERROR", e);
} finally {
  const emails = [AGENT, OTHER, OPS];
  const ids = [...new Set([...(listingId ? [listingId] : []), ...(await sql`select id from listings where agent_email in ${sql(emails)}`).map(r => r.id)])];
  if (ids.length) {
    const rows = await sql`select id, pdf_key from cma_reports where listing_id in ${sql(ids)}`;
    const reports = rows.map(r => r.id);
    const keys = new Set(rows.map(r => r.pdf_key).filter(Boolean));
    if (reports.length) {
      const exports = await sql`delete from jobs where payload->>'reportId' in ${sql(reports)} returning payload->>'exportKey' as key`;
      for (const item of exports) {
        if (item.key) {
          keys.add(`${item.key}.pdf`);
          keys.add(`${item.key}.pptx`);
        }
      }
    }
    if (keys.size && process.env.STORAGE_S3_ENDPOINT) {
      const { S3Client, DeleteObjectCommand } = require("@aws-sdk/client-s3");
      const s3 = new S3Client({ endpoint: process.env.STORAGE_S3_ENDPOINT, region: process.env.STORAGE_S3_REGION || "us-east-1", forcePathStyle: true, credentials: { accessKeyId: process.env.STORAGE_S3_ACCESS_KEY_ID, secretAccessKey: process.env.STORAGE_S3_SECRET_ACCESS_KEY } });
      for (const Key of keys) await s3.send(new DeleteObjectCommand({ Bucket: process.env.STORAGE_BUCKET || "hub-files", Key })).catch(() => {});
    }
    await sql`delete from cma_logs where listing_id in ${sql(ids)}`;
    await sql`delete from jobs where payload->>'listingId' in ${sql(ids)}`;
    await sql`delete from listings where id in ${sql(ids)}`; // cascades to cma_reports, comparables, snapshots
  }
  await sql`delete from jobs where payload->>'email' in ${sql(emails)}`;
  await sql`delete from users where email in ${sql(emails)}`;
  await sql.end();
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
  process.exit(failures ? 1 : 0);
}
