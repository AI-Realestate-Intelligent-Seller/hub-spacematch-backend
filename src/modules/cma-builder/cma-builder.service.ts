// CMA Builder rules: request → background collection → agent review → publish to the seller page.
// Access: the listing's agent, or admins/ops (same rule as the listings module). Published versions
// are frozen; any change after publishing starts a new draft version.
import { config } from "../../config/index.js";
import { getOrm } from "../../db/client.js";
import { logger } from "../../utils/logger.js";
import { reportObjectExists, signedDownloadUrl } from "../../integrations/storage/storage.client.js";
import type { AuthUser } from "../../types/auth.js";
import { badRequest, conflict, notFound, serviceUnavailable } from "../../utils/http-error.js";
import { randomString } from "../../utils/id.js";
import { factsForStreet } from "../cma/cma.service.js";
import { enqueue, enqueueUnique, latestExportJob } from "../jobs/job.service.js";
import { listingIdForToken, listingInfoById, manageableListing, marketingActivity } from "../listings/listing.service.js";
import { addressKey } from "../property-intelligence/research.js";
import { PUBLIC_RECORDS, subjectForAnalysis } from "../property-intelligence/review.js";
import type { CmaComparableRow, CmaReportRow } from "./cma-builder.model.js";
import * as repo from "./cma-builder.repository.js";
import { type Adjustment, type Analysis, OPEN_STATUSES, type PropertyType, type ReportStatus, type SearchParams, type SubjectProperty } from "./cma-builder.types.js";
import type { AddCompInput, PatchCompInput, PatchReportInput, RequestInput } from "./cma-builder.validation.js";
import { compView, finalValue, type ListingInfo, listingStatus, recommendedRange, reportSummary, sellerReport, sellerState, toEngineComp } from "./cma-builder.view.js";
import { csvToRaw } from "./engine/csv.js";
import { type NormalizedComparable, normalizeBatch, normalizeOne, type RawComparable } from "./engine/normalize.js";
import { analyze, autoSelect } from "./engine/valuation.js";
import { providerById, providerList } from "./providers/index.js";
import { renderReportHtml } from "./report-html.js";
import { reportExportKey, type ReportFormat } from "./report-export.js";
import { wakeWorker } from "./worker-wake.js";

export const JOB_COLLECT = "cmaBuilder.collect"; // API-safe providers (run by the API cron or the worker)
export const JOB_COLLECT_BROWSER = "cmaBuilder.collectBrowser"; // Chromium: worker only
export const JOB_RENDER_PDF = "cmaBuilder.renderPdf"; // PDF and PowerPoint: worker only

const EDITABLE: ReportStatus[] = ["ready_for_review", "draft"];
const isStaff = (u: AuthUser) => u.role === "admin" || u.role === "ops";
const nowIso = () => new Date().toISOString();

/** Postgres unique violation (Drizzle wraps the driver error in `cause`). */
const isUniqueViolation = (e: unknown) => {
  const x = e as { code?: string; cause?: { code?: string } };
  return x?.code === "23505" || x?.cause?.code === "23505";
};

// ---------- Access ----------

async function listingFor(actor: AuthUser, listingId: string): Promise<ListingInfo> {
  const { listing: l, address } = await manageableListing(actor, listingId);
  return { id: l.id, address, priceCents: l.priceCents, status: l.status, agentName: l.agentName, agentEmail: l.agentEmail, photoUrl: l.photoUrl };
}

async function reportFor(actor: AuthUser, reportId: string): Promise<{ report: CmaReportRow; listing: ListingInfo }> {
  const report = await repo.findReport(reportId);
  if (!report) throw notFound("CMA not found.");
  const listing = await listingFor(actor, report.listingId).catch(() => {
    throw notFound("CMA not found.");
  });
  return { report, listing };
}

function requireEditable(r: CmaReportRow) {
  if (r.status === "published" || r.status === "superseded") throw conflict("This version is published and can't be changed. Start a new version (Refresh) to make changes.");
  if (!EDITABLE.includes(r.status as ReportStatus)) throw conflict("This CMA is still collecting data. Wait until it's ready for review.");
}

export async function audit(r: Pick<CmaReportRow, "id" | "listingId">, actor: AuthUser | null, message: string, meta?: Record<string, unknown>) {
  await repo.insertLog({ reportId: r.id, listingId: r.listingId, kind: "audit", level: "info", message, actorEmail: actor?.email ?? "system", meta });
}

// ---------- Recalculation ----------

/** Re-runs the engine on the report's current comparables and saves the result. */
export async function recalc(report: CmaReportRow, comps?: CmaComparableRow[]): Promise<CmaReportRow> {
  const rows = comps ?? (await repo.listComps(report.id));
  const analysis: Analysis = analyze(subjectForAnalysis(report.subject, report.content), rows.map(toEngineComp), report.params, report.analysis?.settings);
  analysis.comparedToPublished = await compareToPublished(report, rows, analysis);
  return (await repo.updateReport(report.id, { analysis }))!;
}

async function compareToPublished(report: CmaReportRow, comps: CmaComparableRow[], analysis: Analysis): Promise<Analysis["comparedToPublished"]> {
  const pub = (await repo.listReports(report.listingId)).find(r => r.id !== report.id && (r.status === "published" || r.status === "superseded") && r.version < report.version);
  if (!pub) return null;
  const prevKeys = new Set((await repo.listComps(pub.id)).filter(c => c.status === "sold").map(c => c.dedupeKey));
  const previousValue = finalValue(pub);
  const next = report.override?.value ?? analysis.estimatedValue;
  return {
    reportId: pub.id,
    version: pub.version,
    previousValue,
    changePct: previousValue && next ? Math.round(((next - previousValue) / previousValue) * 1000) / 10 : null,
    newSales: comps.filter(c => c.status === "sold" && (c.source !== PUBLIC_RECORDS || c.selected) && !prevKeys.has(c.dedupeKey)).length,
  };
}

// ---------- Providers, defaults and status ----------

export async function listRequests(actor: AuthUser) {
  const rows = await repo.listRequestSummaries(actor.role === "admin" ? undefined : actor.email.toLowerCase());
  return rows.map(row => ({ ...row, providerLabel: providerById(row.provider)?.label ?? row.provider }));
}

export const providers = () => ({ items: providerList() });

const TYPE_FROM_FORM: Record<string, PropertyType> = { "Single-family": "single_family", Townhome: "townhome", Condo: "condo", "2–4 unit": "multi_2_4", Other: "other" };

/** "851 N Eagle St, Naperville, IL 60563" → parts. */
function splitAddress(address: string) {
  const [street = address, city, stateZip] = address.split(",").map(s => s.trim());
  const m = stateZip?.match(/^([A-Za-z]{2})\s*(\d{5})?/);
  return { street, city: city ?? null, state: m?.[1]?.toUpperCase() ?? null, zip: m?.[2] ?? null };
}

/** What the request dialog starts with: the listing's facts (plus any earlier CMA request for the
 *  same street), suggested search settings and the data sources that can run. */
export async function defaults(actor: AuthUser, listingId: string) {
  const l = await listingFor(actor, listingId);
  const parts = splitAddress(l.address);
  const [facts, reports] = await Promise.all([factsForStreet(actor, parts.street), repo.listReports(listingId)]);
  const last = reports.find(r => addressKey(r.subject.address) === addressKey(l.address));
  const n = (v?: string | null) => (v ? Number(v.replace(/[^\d.]/g, "")) || null : null);
  const subject: SubjectProperty = last
    ? { ...last.subject, askingPrice: l.priceCents == null ? last.subject.askingPrice : Math.round(l.priceCents / 100) }
    : {
        address: l.address,
        street: parts.street,
        city: parts.city ?? facts?.city ?? null,
        state: parts.state ?? facts?.state ?? null,
        zip: parts.zip ?? facts?.zip ?? null,
        propertyType: (facts && TYPE_FROM_FORM[facts.propertyType]) || "single_family",
        beds: n(facts?.beds),
        baths: facts ? (n(facts.bathsFull) ?? 0) + (n(facts.bathsHalf) ?? 0) * 0.5 || null : null,
        sqft: n(facts?.sqft),
        yearBuilt: n(facts?.yearBuilt),
        condition: (facts?.condition as SubjectProperty["condition"]) ?? null,
        askingPrice: l.priceCents == null ? null : Math.round(l.priceCents / 100),
        features: facts?.upgrades ?? [],
      };
  const sq = subject.sqft;
  const items = providerList();
  const firstAvailable = items.find(p => p.available && p.id !== "manual")?.id ?? "manual";
  const previousProvider = reports.find(r => addressKey(r.subject.address) === addressKey(l.address) && items.some(p => p.available && p.id === r.provider))?.provider;
  const params: SearchParams = last
    ? { ...last.params, provider: previousProvider ?? firstAvailable }
    : {
        radiusMi: 1,
        soldWithinDays: 180,
        sqftMin: sq ? Math.round((sq * 0.75) / 50) * 50 : null,
        sqftMax: sq ? Math.round((sq * 1.25) / 50) * 50 : null,
        bedsMin: subject.beds ? Math.max(0, subject.beds - 1) : null,
        bedsMax: subject.beds ? subject.beds + 1 : null,
        bathsMin: null,
        propertyTypes: [subject.propertyType],
        statuses: ["sold", "active", "pending"],
        instructions: null,
        provider: firstAvailable,
      };
  return {
    listing: { id: l.id, address: l.address, price: l.priceCents == null ? null : Math.round(l.priceCents / 100), status: l.status, photoUrl: l.photoUrl },
    subject,
    params,
    prefilledFrom: last ? `CMA version ${last.version}` : facts ? "An earlier CMA request for this address" : null,
    missing: (["beds", "baths", "sqft", "yearBuilt", "condition"] as const).filter(k => subject[k] == null),
    providers: items,
  };
}

/** Status of the CMA for a listing (the listing page button polls this). */
export async function status(actor: AuthUser, listingId: string) {
  await listingFor(actor, listingId);
  const reports = await repo.listReports(listingId);
  const open = reports.find(r => OPEN_STATUSES.includes(r.status as ReportStatus));
  const published = reports.find(r => r.status === "published");
  const latest = reports[0];
  return {
    listingId,
    status: listingStatus(reports),
    current: open ? reportSummary(open) : latest ? reportSummary(latest) : null,
    published: published ? reportSummary(published) : null,
  };
}

// ---------- Request / lifecycle ----------

export async function request(actor: AuthUser, listingId: string, input: RequestInput) {
  const l = await listingFor(actor, listingId);
  const provider = providerById(input.provider);
  if (!provider) throw badRequest("Unknown data source.");
  const avail = provider.availability();
  if (!avail.available) throw badRequest(avail.reason ?? `${provider.label} isn't available.`);
  const open = await repo.findOpenReport(listingId);
  if (open) throw conflict(`A CMA for this listing is already ${open.status.replace(/_/g, " ")} (version ${open.version}). Open it instead of starting another.`);

  const { subject: subjectIn, ...rest } = input;
  const parts = splitAddress(subjectIn.address);
  const subject: SubjectProperty = { ...subjectIn, street: parts.street, city: subjectIn.city ?? parts.city, state: subjectIn.state ?? parts.state, zip: subjectIn.zip ?? parts.zip, features: subjectIn.features ?? [] };
  const params: SearchParams = { ...rest, propertyTypes: rest.propertyTypes.length ? rest.propertyTypes : [subject.propertyType] };
  const report = await createVersion({
    listing: l,
    actor,
    status: "queued",
    provider: provider.id,
    params,
    subject,
    trigger: "request",
    progressNote: "Waiting to resolve the listing address",
  });
  await enqueueCollect(report.id, provider.needsBrowser);
  await audit(report, actor, `Requested CMA version ${report.version} (${provider.label})`);
  return { id: report.id, version: report.version, status: report.status };
}

async function createVersion(a: {
  listing: ListingInfo;
  actor: AuthUser | null;
  status: ReportStatus;
  provider: string;
  params: SearchParams;
  subject: SubjectProperty;
  trigger: "request" | "refresh" | "revision";
  basedOn?: CmaReportRow;
  progressNote?: string;
  copyPublished?: boolean;
}): Promise<CmaReportRow> {
  try {
    const values: Parameters<typeof repo.insertReport>[0] = {
      listingId: a.listing.id,
      version: await repo.nextVersion(a.listing.id),
      status: a.status,
      trigger: a.trigger,
      basedOnReportId: a.basedOn?.id ?? null,
      provider: a.provider,
      params: a.params,
      subject: { ...a.subject, askingPrice: a.listing.priceCents == null ? (a.subject.askingPrice ?? null) : Math.round(a.listing.priceCents / 100) },
      content: a.copyPublished ? a.basedOn?.content : { ...a.basedOn?.content, research: undefined, researchApprovals: undefined },
      override: a.copyPublished ? a.basedOn?.override : undefined,
      dataCollectedAt: a.copyPublished ? a.basedOn?.dataCollectedAt : undefined,
      analysis: null,
      stages: [{ stage: a.status, at: nowIso() }],
      progressNote: a.progressNote ?? null,
      askingPriceCents: a.listing.priceCents,
      requestedByUserId: a.actor?.id ?? null,
      requestedByEmail: a.actor?.email ?? a.basedOn?.requestedByEmail ?? a.listing.agentEmail,
      requestedByName: a.actor?.name ?? a.basedOn?.requestedByName ?? a.listing.agentName,
    };
    return a.copyPublished && a.basedOn ? await repo.copyReport(values, a.basedOn.id) : await repo.insertReport(values);
  } catch (e) {
    // The one-open-report index (or the version index) caught a double click or a second tab.
    if (isUniqueViolation(e)) throw conflict("A CMA for this listing was just started. Refresh to see it.");
    throw e;
  }
}

async function enqueueCollect(reportId: string, needsBrowser: boolean, refreshResearch = false) {
  await enqueue(needsBrowser ? JOB_COLLECT_BROWSER : JOB_COLLECT, { reportId, refreshResearch });
  await wakeWorker("collect");
}

// The status transition admits one caller. An older job may still be sending its
// completion notification, but the new run needs its own queue entry.
async function requeueCollect(reportId: string, needsBrowser: boolean, from: ReportStatus[], patch: Parameters<typeof repo.updateReport>[1], refreshResearch = false) {
  const updated = await getOrm().transaction(async tx => {
    const row = await repo.updateReport(reportId, { ...patch, status: "queued", collectAttempts: 0 }, from, tx);
    if (row) await enqueue(needsBrowser ? JOB_COLLECT_BROWSER : JOB_COLLECT, { reportId, refreshResearch }, new Date(), tx);
    return row;
  });
  if (updated) await wakeWorker("collect");
  return updated;
}

export async function get(actor: AuthUser, reportId: string) {
  const { report: stored, listing } = await reportFor(actor, reportId);
  const [comps, logs, reports] = await Promise.all([repo.listComps(stored.id), repo.listLogs(stored.id, 60), repo.listReports(stored.listingId)]);
  const report = consistent(stored, comps);
  const provider = providerById(report.provider);
  return {
    ...reportSummary(report),
    listing,
    listingStatus: listingStatus(reports),
    params: report.params,
    subject: report.subject,
    analysis: report.analysis,
    override: report.override,
    content: { ...report.content, research: undefined, researchApprovals: undefined },
    propertyResearch: report.content.research ? { ...report.content.research, candidates: undefined, approvals: report.content.researchApprovals ?? [] } : null,
    editable: EDITABLE.includes(report.status as ReportStatus),
    providerLabel: provider?.label ?? report.provider,
    providerNeedsBrowser: provider?.needsBrowser ?? false,
    comparables: comps.map(c => compView(c, report.analysis)),
    // Collection steps and errors for the agent (never shown to sellers).
    activity: logs.map(l => ({ id: l.id, kind: l.kind, level: l.level, stage: l.stage, message: l.message, actorEmail: l.actorEmail, createdAt: l.createdAt })),
    canPublish: EDITABLE.includes(report.status as ReportStatus) && (report.analysis?.status === "ok" || !!report.override),
  };
}

export async function update(actor: AuthUser, reportId: string, input: PatchReportInput) {
  const { report } = await reportFor(actor, reportId);
  requireEditable(report);
  const patch: Parameters<typeof repo.updateReport>[1] = { status: "draft", reviewedByEmail: actor.email, reviewedByName: actor.name };
  if (report.status !== "draft") patch.stages = [...report.stages, { stage: "draft", at: nowIso() }];
  let needsRecalc = false;
  if (input.subject) {
    patch.subject = { ...report.subject, ...input.subject } as SubjectProperty;
    needsRecalc = true;
  }
  if (input.content) patch.content = { ...report.content, ...input.content };
  if (input.researchApprovals !== undefined) {
    const research = report.content.research;
    if (!research || addressKey((patch.subject ?? report.subject).address) !== research.addressKey) throw conflict("The CMA address must match the researched listing address.");
    const approvals = [...new Set(input.researchApprovals)];
    if (approvals.some(key => !Object.hasOwn(research.facts, key) && key !== "sales" && key !== "assessments")) throw badRequest("Unknown property research item.");
    patch.content = { ...(patch.content ?? report.content), researchApprovals: approvals };

  }
  if (patch.subject && addressKey(patch.subject.address) !== addressKey(report.subject.address) && report.content.research) {
    throw conflict("Start a CMA for the corrected listing address to keep parcel records separate.");
  }
  if (input.override !== undefined) {
    patch.override = input.override ? { ...input.override, byEmail: actor.email, byName: actor.name, at: nowIso() } : null;
    await audit(report, actor, input.override ? `Overrode the value to $${input.override.value.toLocaleString("en-US")}: ${input.override.reason}` : "Removed the value override");
    needsRecalc = true;
  }
  if (input.settings && report.analysis) {
    patch.analysis = { ...report.analysis, settings: { ...report.analysis.settings, ...input.settings } };
    needsRecalc = true;
  }
  const updated = await repo.updateReport(reportId, patch, EDITABLE);
  if (!updated) throw conflict("This CMA changed while you were editing. Reload and try again.");
  if (needsRecalc) await recalc(updated);
  return get(actor, reportId);
}

/**
 * A read that lands between a comparable change and the recalculation that follows it would pair
 * new comparables with the old analysis. When any comparable is newer than the analysis, the view
 * is recomputed in memory (same engine, nothing saved), so a response is always self-consistent.
 */
function consistent(report: CmaReportRow, comps: CmaComparableRow[]): CmaReportRow {
  const a = report.analysis;
  if (!a || !EDITABLE.includes(report.status as ReportStatus)) return report;
  const computed = new Date(a.computedAt).getTime();
  const stale = comps.some(c => c.updatedAt.getTime() > computed) || a.scores.length !== comps.length;
  if (!stale) return report;
  const fresh = analyze(subjectForAnalysis(report.subject, report.content), comps.map(toEngineComp), report.params, a.settings);
  return { ...report, analysis: { ...fresh, comparedToPublished: a.comparedToPublished } };
}

/** Moves a report out of "ready for review" once the agent starts working on it. */
async function touchDraft(report: CmaReportRow, actor: AuthUser) {
  if (report.status === "ready_for_review") {
    await repo.updateReport(report.id, { status: "draft", reviewedByEmail: actor.email, reviewedByName: actor.name, stages: [...report.stages, { stage: "draft", at: nowIso() }] }, EDITABLE);
  }
}

// ---------- Comparables ----------

export async function comparables(actor: AuthUser, reportId: string) {
  const { report } = await reportFor(actor, reportId);
  return { items: (await repo.listComps(report.id)).map(c => compView(c, report.analysis)) };
}

function manualRow(reportId: string, n: NormalizedComparable, source: "manual" | "csv") {
  return { reportId, source, manual: true, isFixture: false, ...n, selected: false, adjustments: [] as Adjustment[], collectedAt: new Date() };
}

export async function addComparable(actor: AuthUser, reportId: string, input: AddCompInput) {
  const { report } = await reportFor(actor, reportId);
  requireEditable(report);
  const r = normalizeOne(input as RawComparable, report.subject);
  if ("error" in r) throw badRequest(`This comparable can't be used: ${r.error}.`);
  const [row] = await repo.insertComps([{ ...manualRow(report.id, r.ok, "manual"), selected: true }]);
  if (!row) throw conflict("That property is already on this CMA.");
  await touchDraft(report, actor);
  await audit(report, actor, `Added comparable ${row.address} by hand`);
  const updated = await recalc((await repo.findReport(report.id))!);
  return compView(row, updated.analysis);
}

export async function updateComparable(actor: AuthUser, reportId: string, compId: string, input: PatchCompInput) {
  const { report } = await reportFor(actor, reportId);
  requireEditable(report);
  const comp = await repo.findComp(report.id, compId);
  if (!comp) throw notFound("Comparable not found.");
  const patch: Parameters<typeof repo.updateComp>[1] = {};
  if (input.selected !== undefined) patch.selected = input.selected;
  if (input.notes !== undefined) patch.notes = input.notes;
  if (input.adjustments) {
    const prev = new Map(comp.adjustments.map(a => [a.id, a]));
    patch.adjustments = input.adjustments.map(a => {
      const old = a.id ? prev.get(a.id) : undefined;
      const same = old && old.amount === a.amount && old.reason === a.reason && old.category === a.category;
      return same ? old : { id: a.id && prev.has(a.id) ? a.id : randomString(10), category: a.category, amount: Math.round(a.amount), reason: a.reason, suggested: a.suggested, byEmail: actor.email, at: nowIso() };
    });
    await audit(report, actor, `Adjustments on ${comp.address}: ${patch.adjustments.map(a => `${a.category} ${a.amount >= 0 ? "+" : ""}${a.amount}`).join(", ") || "none"}`);
  }
  if (input.fields) {
    if (!comp.manual) throw conflict("Collected records can't be edited. Add a note or an adjustment instead, or deselect it.");
    const merged = { ...comp, ...input.fields } as unknown as RawComparable;
    const r = normalizeOne(merged, report.subject);
    if ("error" in r) throw badRequest(`This comparable can't be used: ${r.error}.`);
    Object.assign(patch, r.ok);
  }
  const row = await repo.updateComp(comp.id, patch);
  await touchDraft(report, actor);
  const updated = await recalc((await repo.findReport(report.id))!);
  return compView(row!, updated.analysis);
}

export async function removeComparable(actor: AuthUser, reportId: string, compId: string) {
  const { report } = await reportFor(actor, reportId);
  requireEditable(report);
  const comp = await repo.findComp(report.id, compId);
  if (!comp) throw notFound("Comparable not found.");
  if (!comp.manual) throw conflict("Collected comparables can't be deleted; deselect it to leave it out.");
  await repo.deleteComp(comp.id);
  await touchDraft(report, actor);
  await audit(report, actor, `Deleted comparable ${comp.address}`);
  await recalc((await repo.findReport(report.id))!);
  return { ok: true };
}

export async function setSelection(actor: AuthUser, reportId: string, selectedIds: string[]) {
  const { report } = await reportFor(actor, reportId);
  requireEditable(report);
  const known = new Set((await repo.listComps(report.id)).map(c => c.id));
  await repo.setSelection(report.id, selectedIds.filter(id => known.has(id)));
  await touchDraft(report, actor);
  await recalc((await repo.findReport(report.id))!);
  return get(actor, reportId);
}

export async function importCsv(actor: AuthUser, reportId: string, csv: string) {
  const { report } = await reportFor(actor, reportId);
  requireEditable(report);
  const { mapping, rows, truncated } = csvToRaw(csv);
  if (mapping.missingRequired.length) throw badRequest(`The CSV needs ${mapping.missingRequired.join(", ")}.`, { mapping: mapping.columns });
  const { comps, rejected, duplicates } = normalizeBatch(rows, report.subject);
  const inserted = await repo.insertComps(comps.map(c => manualRow(report.id, c, "csv")));
  const all = await repo.listComps(report.id);
  if (!all.some(c => c.selected && c.status === "sold")) {
    const prelim = analyze(subjectForAnalysis(report.subject, report.content), all.map(toEngineComp), report.params, report.analysis?.settings);
    await repo.setSelection(report.id, [...autoSelect(prelim, all.map(toEngineComp))]);
  }
  await touchDraft(report, actor);
  await audit(report, actor, `Imported ${inserted.length} comparable(s) from CSV (${rejected.length} rejected, ${duplicates + comps.length - inserted.length} duplicates)`);
  await recalc((await repo.findReport(report.id))!);
  return {
    imported: inserted.length,
    duplicates: duplicates + (comps.length - inserted.length),
    rejected: rejected.slice(0, 50),
    rejectedCount: rejected.length,
    truncated,
    mapping: mapping.columns,
  };
}

export async function calculate(actor: AuthUser, reportId: string) {
  const { report } = await reportFor(actor, reportId);
  if (!EDITABLE.includes(report.status as ReportStatus)) throw conflict("Only a report under review can be recalculated.");
  await recalc(report);
  return get(actor, reportId);
}

// ---------- Publish / refresh / retry / cancel ----------

export async function publish(actor: AuthUser, reportId: string) {
  const { report, listing } = await reportFor(actor, reportId);
  if (report.status === "published") return { ...reportSummary(report), alreadyPublished: true }; // idempotent
  requireEditable(report);
  if (report.content.research && report.content.research.addressKey !== addressKey(listing.address)) throw conflict("The listing address changed. Start a new CMA before publishing.");
  const fresh = await recalc(report);
  if (fresh.analysis?.status !== "ok" && !fresh.override) throw conflict(fresh.analysis?.insufficientReason ?? "There isn't enough comparable data for a value. Add comparables or record an override with a reason.");
  const comps = await repo.listComps(report.id);
  if (comps.some(c => c.source === "browser:mred") && !providerById("browser:mred")?.redistributable) throw conflict("MRED listing data is available for agent review. Seller publication requires permission to redistribute those records.");
  if (config.isProduction && comps.some(c => c.selected && c.isFixture)) throw conflict("Development fixtures can't be published.");
  const now = new Date();
  const published = await repo.updateReport(
    report.id,
    { status: "published", publishedAt: now, publishedByEmail: actor.email, publishedByName: actor.name, reviewedByEmail: actor.email, reviewedByName: actor.name, stages: [...fresh.stages, { stage: "published", at: now.toISOString() }], pdfKey: null },
    EDITABLE,
  );
  if (!published) {
    const again = await repo.findReport(report.id);
    if (again?.status === "published") return { ...reportSummary(again), alreadyPublished: true };
    throw conflict("This CMA changed while publishing. Reload and try again.");
  }
  await repo.supersedePublished(report.listingId, report.id);
  await snapshot(published, comps);
  await queueReportExport(published);
  await audit(published, actor, `Published version ${published.version} to the seller (${finalValue(published) ? `$${finalValue(published)!.toLocaleString("en-US")}` : "no value"})`, { listing: listing.address });
  return { ...reportSummary(published), alreadyPublished: false };
}

export async function snapshot(r: CmaReportRow, comps: CmaComparableRow[]) {
  const a = r.analysis;
  if (!a) return;
  await repo.insertSnapshot({
    listingId: r.listingId,
    reportId: r.id,
    estimatedValue: finalValue(r),
    soldCount: a.soldAll.count,
    activeCount: a.active.count,
    pendingCount: a.pending.count,
    medianSoldPrice: a.soldAll.medianPrice,
    medianPpsf: a.soldAll.medianPpsf,
    avgDom: a.soldAll.avgDom,
    soldKeys: comps.filter(c => c.status === "sold").map(c => c.dedupeKey),
  });
}

export async function revise(actor: AuthUser, reportId: string) {
  const { report, listing } = await reportFor(actor, reportId);
  if (report.status !== "published" && report.status !== "superseded") throw conflict("Start revisions from a published CMA.");
  const open = await repo.findOpenReport(report.listingId);
  if (open) {
    if (EDITABLE.includes(open.status as ReportStatus)) return { id: open.id, version: open.version, status: open.status };
    throw conflict("A CMA for this listing is already collecting. Open it when it is ready for review.");
  }
  if (addressKey(report.subject.address) !== addressKey(listing.address)) throw conflict("The listing address changed. Request a CMA for the new address.");
  const draft = await createVersion({
    listing, actor, status: "draft", provider: report.provider, params: report.params, subject: report.subject,
    trigger: "revision", basedOn: report, copyPublished: true, progressNote: "Draft copied from the published CMA",
  });
  await recalc({ ...draft, analysis: report.analysis });
  await audit(draft, actor, `Started an editable copy of published version ${report.version}`);
  return { id: draft.id, version: draft.version, status: draft.status };
}

/**
 * Refresh: from a published/superseded version → a new draft version with fresh data (content,
 * subject, search and the agent's own comparables carry over); from a draft → re-collect into it.
 */
export async function refresh(actor: AuthUser | null, reportId: string, opts: { listing?: ListingInfo; trigger?: "refresh" | "revision"; provider?: string } = {}) {
  const loaded = actor ? await reportFor(actor, reportId) : await (async () => {
    const report = await repo.findReport(reportId);
    const listing = report && (opts.listing ?? (await listingInfoById(report.listingId)));
    if (!report || !listing) throw notFound("CMA not found.");
    return { report, listing };
  })();
  const { report, listing } = loaded;
  const provider = providerById(opts.provider ?? report.provider);
  if (!provider) throw badRequest("This CMA's data source no longer exists. Start a new request.");
  if (opts.provider && !provider.availability().available) throw conflict(provider.availability().reason ?? "The data source is unavailable.");
  if (["queued", "collecting", "normalizing", "analyzing"].includes(report.status)) throw conflict("This CMA is already collecting.");

  if (EDITABLE.includes(report.status as ReportStatus)) {
    if (!provider.availability().available) throw conflict(provider.availability().reason ?? "The data source isn't available.");
    const updated = await requeueCollect(report.id, provider.needsBrowser, EDITABLE, {
      provider: provider.id,
      params: { ...report.params, provider: provider.id },
      errorMessage: null,
      progressNote: "Waiting for the collector",
      stages: [...report.stages, { stage: "queued", at: nowIso(), note: "re-collect" }],
    }, provider.id === "manual" && !opts.provider);
    if (!updated) throw conflict("This CMA changed. Reload and try again.");
    if (actor) await audit(report, actor, `Re-collecting comparables with ${provider.label}`);
    return { id: report.id, version: report.version, status: "queued" as const };
  }

  if (report.status !== "published" && report.status !== "superseded" && report.status !== "failed" && report.status !== "cancelled") throw conflict("This CMA can't be refreshed right now.");
  const open = await repo.findOpenReport(report.listingId);
  if (open) throw conflict(`Version ${open.version} is already open. Continue that one.`);
  const collect = provider.availability().available;
  const sameAddress = addressKey(report.subject.address) === addressKey(listing.address);
  const next = await createVersion({
    listing,
    actor,
    status: collect ? "queued" : "ready_for_review",
    provider: provider.id,
    params: { ...report.params, provider: provider.id },
    subject: sameAddress ? report.subject : { address: listing.address, propertyType: "other", ...splitAddress(listing.address) },
    trigger: opts.trigger ?? (actor ? "revision" : "refresh"),
    basedOn: sameAddress ? report : undefined,
    progressNote: collect ? "Waiting for the collector" : "Copied from the last version",
  });
  // Carry over the agent's own comparables (and their adjustments and selection).
  const mine = sameAddress ? (await repo.listComps(report.id)).filter(c => c.manual) : [];
  await repo.insertComps(mine.map(({ id: _id, reportId: _r, createdAt: _c, updatedAt: _u, ...c }) => ({ ...c, reportId: next.id })));
  if (collect) await enqueueCollect(next.id, provider.needsBrowser, !!actor && provider.id === "manual" && !opts.provider);
  else await recalc(next);
  await audit(next, actor, `Started version ${next.version} from version ${report.version}${actor ? "" : " (weekly refresh)"}`);
  return { id: next.id, version: next.version, status: next.status };
}

export async function retry(actor: AuthUser, reportId: string) {
  const { report } = await reportFor(actor, reportId);
  if (report.status === "queued") return { id: report.id, version: report.version, status: report.status }; // idempotent
  if (report.status !== "failed") throw conflict("Only a failed CMA can be retried.");
  const provider = providerById(report.provider);
  if (!provider?.availability().available) throw conflict(provider?.availability().reason ?? "The data source isn't available. Start a new request with another source.");
  const open = await repo.findOpenReport(report.listingId);
  if (open) throw conflict(`Version ${open.version} is already open. Continue that one.`);
  const updated = await requeueCollect(report.id, provider.needsBrowser, ["failed"], {
    errorMessage: null,
    progressNote: "Waiting for the collector",
    stages: [...report.stages, { stage: "queued", at: nowIso(), note: "retry" }],
  })
    .catch(e => {
      if (isUniqueViolation(e)) throw conflict("Another CMA for this listing is open.");
      throw e;
    });
  if (!updated) throw conflict("This CMA changed. Reload and try again.");
  await audit(report, actor, "Retried collection");
  return { id: report.id, version: report.version, status: "queued" as const };
}

export async function cancel(actor: AuthUser, reportId: string) {
  const { report } = await reportFor(actor, reportId);
  if (report.status === "cancelled") return { id: report.id, status: report.status }; // idempotent
  const cancellable: ReportStatus[] = ["queued", "collecting", "normalizing", "analyzing", "ready_for_review", "draft"];
  if (!cancellable.includes(report.status as ReportStatus)) throw conflict("Published or finished versions can't be cancelled.");
  const updated = await repo.updateReport(report.id, { status: "cancelled", cancelledAt: new Date(), progressNote: "Cancelled", stages: [...report.stages, { stage: "cancelled", at: nowIso() }] }, cancellable);
  if (!updated) throw conflict("This CMA changed. Reload and try again.");
  await audit(report, actor, `Cancelled version ${report.version}`);
  return { id: report.id, status: "cancelled" as const };
}

// ---------- History, preview, PDF, context ----------

export async function history(actor: AuthUser, listingId: string, limit: number, offset: number) {
  await listingFor(actor, listingId);
  const reports = await repo.listReports(listingId);
  const snaps = await repo.listSnapshots(listingId);
  return {
    total: reports.length,
    items: reports.slice(offset, offset + limit).map(r => ({ ...reportSummary(r), changePct: r.analysis?.comparedToPublished?.changePct ?? null, newSales: r.analysis?.comparedToPublished?.newSales ?? null })),
    trend: snaps
      .filter(s => s.estimatedValue != null)
      .reverse()
      .map(s => ({ at: s.createdAt, estimatedValue: s.estimatedValue, medianSoldPrice: s.medianSoldPrice, medianPpsf: s.medianPpsf, soldCount: s.soldCount, activeCount: s.activeCount })),
  };
}

/** The version the builder opens: the unfinished one, else the published one, else the latest. */
export async function current(actor: AuthUser, listingId: string) {
  const s = await status(actor, listingId);
  const open = s.current && OPEN_STATUSES.includes(s.current.status as ReportStatus) ? s.current : null;
  const id = open?.id ?? s.published?.id ?? s.current?.id;
  return { ...s, report: id ? await get(actor, id) : null };
}

export async function previewHtml(actor: AuthUser, reportId: string, audience: "agent" | "seller" = "agent"): Promise<string> {
  const { report, listing } = await reportFor(actor, reportId);
  return renderReportHtml({ report, comps: await repo.listComps(report.id), listing, audience, preview: report.status !== "published" && report.status !== "superseded" });
}

export async function pdf(actor: AuthUser, reportId: string, format: ReportFormat = "pdf", download = false) {
  const { report } = await reportFor(actor, reportId);
  return exportLink(report, format, download);
}

async function queueReportExport(report: CmaReportRow) {
  const queued = await enqueueUnique(JOB_RENDER_PDF, { reportId: report.id, exportKey: reportExportKey(report) }, "exportKey");
  if (queued) await wakeWorker("renderPdf");
  return queued;
}

async function exportLink(report: CmaReportRow, format: ReportFormat, download: boolean) {
  const published = report.status === "published" || report.status === "superseded";
  if (!published && !EDITABLE.includes(report.status as ReportStatus)) throw conflict("This CMA is not ready to export.");
  const key = reportExportKey(report);
  const pdfKey = `${key}.pdf`;
  const fileKey = `${key}.${format}`;
  if (published ? report.pdfKey === pdfKey : await reportObjectExists(pdfKey)) {
    return { status: "ready" as const, url: await signedDownloadUrl(fileKey, 600, download ? `CMA-v${report.version}.${format}` : undefined), version: report.version };
  }
  const job = await latestExportJob(JOB_RENDER_PDF, key);
  const now = Date.now();
  if (job?.status === "queued" && job.lastError && job.runAt.getTime() > now) {
    throw serviceUnavailable("Report generation failed. The worker will retry automatically.");
  }
  if (job?.status === "failed" && now - job.updatedAt.getTime() < 60_000) {
    throw serviceUnavailable("Report generation failed. Try downloading again in a minute.");
  }
  if (config.cmaBuilder.exportInline) {
    // Render now, in this request (~2–10 s with a cold browser). The queued job is the safety net:
    // if this fails, the job runner retries, and it skips work an earlier render already did.
    await queueReportExport(report);
    try {
      const { runRenderPdf } = await import("./cma-builder.jobs.js");
      await runRenderPdf({ reportId: report.id, exportKey: key });
    } catch (e) {
      logger.error("CMA export failed", { reportId: report.id, error: String(e) });
      throw serviceUnavailable("Report generation failed. It will be retried automatically; try again in a minute.");
    }
    return { status: "ready" as const, url: await signedDownloadUrl(fileKey, 600, download ? `CMA-v${report.version}.${format}` : undefined), version: report.version };
  }
  if (job?.status === "queued" || job?.status === "running") {
    if (now - job.updatedAt.getTime() >= 3 * 60_000) {
      throw serviceUnavailable("The report worker is taking too long. Try again shortly.");
    }
  } else {
    await queueReportExport(report);
  }
  return { status: "rendering" as const, url: null, version: report.version };
}

/** Marketing numbers next to the CMA (showings, feedback, views). Never used in the valuation. */
export async function context(actor: AuthUser, listingId: string) {
  await listingFor(actor, listingId);
  return {
    activity: await marketingActivity(listingId),
    connectors: [
      { id: "ga4", label: "Google Analytics 4", connected: false, note: "Not connected on the new backend yet." },
      { id: "google_ads", label: "Google Ads", connected: false, note: "Not connected on the new backend yet." },
      { id: "meta_ads", label: "Meta Ads", connected: false, note: "Not connected on the new backend yet." },
      { id: "lofty", label: "Lofty leads", connected: false, note: "The Lofty connection isn't on the new backend yet." },
      { id: "open_house", label: "Open house sign-ins", connected: true, note: "Counts submitted through the listing’s open-house sign-in form." },
    ],
    note: "Marketing engagement is shown for context only. It does not change the calculated market value.",
  };
}

// ---------- Seller side (token link, public) ----------

export async function sellerCma(token: string) {
  const listingId = await listingIdForToken(token);
  if (!listingId) throw notFound("This link has expired. Ask your agent for a new one.");
  const reports = await repo.listReports(listingId);
  const state = sellerState(reports);
  const pub = reports.find(r => r.status === "published");
  const history = reports
    .filter(r => (r.status === "published" || r.status === "superseded") && r.publishedAt && finalValue(r))
    .sort((a, b) => a.publishedAt!.getTime() - b.publishedAt!.getTime())
    .map(r => ({ version: r.version, publishedAt: r.publishedAt, estimatedValue: finalValue(r), range: recommendedRange(r), askingPrice: r.askingPriceCents == null ? null : Math.round(r.askingPriceCents / 100) }));
  if (!pub) return { state, report: null, history };
  const provider = providerById(pub.provider);
  return { state, report: sellerReport(pub, await repo.listComps(pub.id), provider?.redistributable ?? false), history };
}

async function publishedForToken(token: string) {
  const listingId = await listingIdForToken(token);
  const pub = listingId ? await repo.latestPublished(listingId) : undefined;
  if (!listingId || !pub) throw notFound("There is no published market analysis yet.");
  const listing = (await listingInfoById(listingId))!;
  return { pub, listing };
}

export async function sellerReportHtml(token: string): Promise<string> {
  const { pub, listing } = await publishedForToken(token);
  return renderReportHtml({ report: pub, comps: await repo.listComps(pub.id), listing, audience: "seller" });
}

export async function sellerPdf(token: string, format: ReportFormat = "pdf", download = false) {
  const { pub } = await publishedForToken(token);
  return exportLink(pub, format, download);
}
