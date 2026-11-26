// Background work for the CMA Builder. Collection never runs inside an HTTP request: the API
// enqueues a job and returns at once; the worker (or the API cron, for providers that don't need a
// browser) runs it. Every status change is conditional, so a cancel always wins over a running job.
import { config } from "../../config/index.js";
import { putObject, reportObjectExists } from "../../integrations/storage/storage.client.js";
import { logger } from "../../utils/logger.js";
import { listingInfoById } from "../listings/listing.service.js";
import type { CmaReportRow } from "./cma-builder.model.js";
import { mailCollectionFailed, mailMarketChanged, mailReadyForReview } from "./cma-builder.mail.js";
import * as repo from "./cma-builder.repository.js";
import { enqueueUnique } from "../jobs/job.service.js";
import { audit, JOB_COLLECT, JOB_COLLECT_BROWSER, recalc, refresh, snapshot } from "./cma-builder.service.js";
import type { ReportStatus } from "./cma-builder.types.js";
import { toEngineComp } from "./cma-builder.view.js";
import { applyFilters, normalizeBatch } from "./engine/normalize.js";
import { analyze, autoSelect } from "./engine/valuation.js";
import { providerById } from "./providers/index.js";
import { CancelledError, ProviderError } from "./providers/provider.types.js";
import { addressKey, research } from "../property-intelligence/research.js";
import { PUBLIC_RECORDS, subjectForAnalysis } from "../property-intelligence/review.js";
import { renderReportFiles, reportExportKey } from "./report-export.js";

const STALE_MINUTES = 20;
const MAX_COLLECT_ATTEMPTS = 3;
const nowIso = () => new Date().toISOString();

/** Moves a report to the next stage only if it is still in an expected one (cancel wins). */
async function advance(r: CmaReportRow, from: ReportStatus[], to: ReportStatus, note: string, extra: Parameters<typeof repo.updateReport>[1] = {}) {
  const fresh = (await repo.findReport(r.id)) ?? r;
  const updated = await repo.updateReport(r.id, { status: to, progressNote: note, stages: [...fresh.stages, { stage: to, at: nowIso(), note }], ...extra }, from);
  if (!updated) throw new CancelledError();
  return updated;
}

/** Collects, normalizes and analyzes one report. Never throws for provider problems: it records them. */
export async function runCollect(payload: Record<string, unknown>): Promise<void> {
  const reportId = String(payload.reportId ?? "");
  let report = await repo.findReport(reportId);
  if (!report) return;
  const stale = ["collecting", "normalizing", "analyzing"].includes(report.status) && Date.now() - report.updatedAt.getTime() > STALE_MINUTES * 60_000;
  if (report.status !== "queued" && !stale) return; // cancelled, already done, or another run has it
  const provider = providerById(report.provider);
  const log = (level: "info" | "warn" | "error", message: string, meta?: Record<string, unknown>) =>
    repo.insertLog({ reportId, listingId: report!.listingId, kind: "collection", level, stage: report!.status, provider: report!.provider, message: message.slice(0, 1000), meta });
  const listing = await listingInfoById(report.listingId);
  if (!provider || !listing) {
    await repo.updateReport(reportId, { status: "failed", errorMessage: "The data source or listing no longer exists." }, ["queued", "collecting", "normalizing", "analyzing"]);
    return;
  }

  // Cancellation: poll the status; an agent's cancel aborts the provider (and closes the browser).
  const controller = new AbortController();
  const poll = setInterval(() => {
    void repo.findReport(reportId).then(r => {
      if (!r || r.status === "cancelled") controller.abort();
    }).catch(e => logger.warn("Unable to check CMA cancellation", { reportId, error: String(e) }));
  }, 3000);
  poll.unref();
  const started = Date.now();
  try {
    report = await advance(report, ["queued", "collecting", "normalizing", "analyzing"], "collecting", `Collecting from ${provider.label}`, { collectAttempts: report.collectAttempts + 1, errorMessage: null });
    let publicCandidates: Awaited<ReturnType<typeof research>>["candidates"] = [];
    try {
      const key = addressKey(listing.address);
      const maxAge = config.cmaBuilder.researchCacheHours * 3600_000;
      const prior = payload.refreshResearch === true ? undefined : (await repo.listReports(report.listingId)).map(r => r.content.research).find(r =>
        r?.status === "complete" && r.addressKey === key && Date.now() - Date.parse(r.collectedAt) < maxAge,
      );
      const intelligence = prior ?? await research(listing.address, controller.signal, async note => {
        await repo.updateReport(reportId, { progressNote: note }, ["collecting"]);
      });
      controller.signal.throwIfAborted();
      const currentListing = await listingInfoById(report.listingId);
      if (currentListing && addressKey(currentListing.address) === intelligence.addressKey && addressKey(report.subject.address) === intelligence.addressKey) {
        const subject = { ...report.subject };
        const lat = intelligence.facts.latitude?.value;
        const lng = intelligence.facts.longitude?.value;
        if (typeof lat === "number" && typeof lng === "number") {
          subject.lat ??= lat;
          subject.lng ??= lng;
        }
        const content = { ...report.content, research: intelligence, researchApprovals: prior && report.content.research?.collectedAt === prior.collectedAt ? report.content.researchApprovals : [] };
        const updated = await repo.updateReport(reportId, { content, subject }, ["collecting"]);
        if (!updated) throw new CancelledError();
        report = updated;
        publicCandidates = intelligence.candidates;
      } else {
        await log("warn", "Property research was skipped because the listing and CMA addresses differ.");
      }
    } catch (error) {
      if (controller.signal.aborted || error instanceof CancelledError) throw new CancelledError();
      await log("warn", "Property research did not finish. Continuing the CMA.", { error: String(error) });
    }
    await repo.updateReport(reportId, { progressNote: `Preparing CMA · ${provider.label}` }, ["collecting"]);
    await log("info", `Collection started (${provider.label}, attempt ${report.collectAttempts})`);
    const raw = await provider.collect({
      subject: subjectForAnalysis(report.subject, report.content),
      params: report.params,
      signal: controller.signal,
      log,
      progress: async note => {
        await repo.updateReport(reportId, { progressNote: note.slice(0, 200) }, ["collecting"]);
      },
    });
    await log("info", `Received ${raw.length} records in ${Math.round((Date.now() - started) / 1000)} s`);

    report = await advance(report, ["collecting"], "normalizing", "Cleaning and de-duplicating records");
    const { comps, rejected, duplicates } = normalizeBatch(raw, report.subject);
    const { kept, filteredOut } = applyFilters(comps, report.params);
    if (rejected.length) await log("warn", `${rejected.length} record(s) rejected`, { sample: rejected.slice(0, 10) });
    await log("info", `${kept.length} comparables kept (${duplicates} duplicates merged, ${filteredOut} outside the search filters)`);
    const previousPublic = new Map((await repo.listComps(reportId)).filter(c => c.source === PUBLIC_RECORDS).map(c => [c.dedupeKey, c]));
    await repo.deleteCollectedComps(reportId);
    const collectedAt = new Date();
    await repo.insertComps(kept.map(c => ({ reportId, source: provider.id, manual: false, isFixture: provider.isFixture, ...c, imageUrl: provider.redistributable ? c.imageUrl : null, selected: false, adjustments: [], collectedAt })));

    const publicComps = normalizeBatch(publicCandidates, report.subject).comps
      .filter(c => c.distanceMi !== null && c.distanceMi <= report!.params.radiusMi)
      .filter(c => c.sqft == null || report!.subject.sqft == null || Math.abs(c.sqft - report!.subject.sqft) <= report!.subject.sqft * 0.35)
      .sort((a, b) => (a.distanceMi ?? Infinity) - (b.distanceMi ?? Infinity) || (b.soldDate ?? "").localeCompare(a.soldDate ?? ""))
      .slice(0, 30);
    await repo.insertComps(publicComps.map(c => ({
      reportId, ...c, source: PUBLIC_RECORDS, manual: false, isFixture: false, selected: previousPublic.get(c.dedupeKey)?.selected ?? false,
      adjustments: previousPublic.get(c.dedupeKey)?.adjustments ?? [], collectedAt,
    })));

    report = await advance(report, ["normalizing"], "analyzing", "Scoring comparables and calculating");
    const all = await repo.listComps(reportId);
    const keepManual = all.filter(c => (c.manual || c.source === PUBLIC_RECORDS) && c.selected).map(c => c.id);
    const prelim = analyze(subjectForAnalysis(report.subject, report.content), all.map(toEngineComp), report.params, report.analysis?.settings);
    await repo.setSelection(reportId, [...new Set([...autoSelect(prelim, all.map(toEngineComp)), ...keepManual])]);
    report = await recalc(report);
    report = await advance(report, ["analyzing"], "ready_for_review", report.analysis?.status === "ok" ? "Ready for your review" : "Ready for review: not enough sold comparables for a value yet", { dataCollectedAt: collectedAt });
    await snapshot(report, await repo.listComps(reportId));
    await log("info", "Collection finished");
    await notifyDone(report, listing);
  } catch (e) {
    if (e instanceof CancelledError || controller.signal.aborted) {
      await log("info", "Collection cancelled");
      return;
    }
    const err = e instanceof Error ? e : new Error(String(e));
    const agentMessage = err instanceof ProviderError ? err.agentMessage : "Something went wrong while collecting comparables.";
    await log("error", err.message, { name: err.name, blocked: err instanceof ProviderError ? err.blocked : undefined });
    logger.warn("cma collect failed", { reportId, provider: provider.id, error: err.message });
    const current = await repo.findReport(reportId);
    // Unexpected (non-provider) errors get a few job-level retries; provider errors already retried inside.
    const retryJob = !(err instanceof ProviderError) && (current?.collectAttempts ?? 0) < MAX_COLLECT_ATTEMPTS;
    if (retryJob) {
      await repo.updateReport(reportId, { status: "queued", progressNote: "Retrying after an error" }, ["collecting", "normalizing", "analyzing"]);
      throw err; // the job runner waits and runs it again
    }
    const failed = await repo.updateReport(reportId, { status: "failed", errorMessage: agentMessage, progressNote: "Collection stopped", stages: [...(current?.stages ?? []), { stage: "failed", at: nowIso(), note: agentMessage }] }, ["queued", "collecting", "normalizing", "analyzing"]);
    if (failed) await mailCollectionFailed({ to: failed.requestedByEmail, listingId: failed.listingId, address: listing.address, message: agentMessage }).catch(() => {});
  } finally {
    clearInterval(poll);
  }
}

async function notifyDone(r: CmaReportRow, listing: { address: string }) {
  const cmp = r.analysis?.comparedToPublished;
  if (r.trigger === "refresh") {
    // Weekly refresh: only bother the agent when the value moved past the threshold.
    if (cmp?.changePct != null && Math.abs(cmp.changePct) >= config.cmaBuilder.refreshThresholdPct && cmp.previousValue && r.analysis?.estimatedValue) {
      await mailMarketChanged({ to: r.requestedByEmail, listingId: r.listingId, address: listing.address, previous: cmp.previousValue, next: r.analysis.estimatedValue, changePct: cmp.changePct, newSales: cmp.newSales });
    }
    return;
  }
  await mailReadyForReview({
    to: r.requestedByEmail,
    listingId: r.listingId,
    address: listing.address,
    version: r.version,
    soldCount: r.analysis?.sold.count ?? 0,
    estimate: r.analysis?.estimatedValue ?? null,
    insufficient: r.analysis?.status !== "ok",
  }).catch(e => logger.warn("cma ready mail failed", { error: String(e) }));
}

/** Generates the matching PDF and PowerPoint in the worker. */
export async function runRenderPdf(payload: Record<string, unknown>): Promise<void> {
  const report = await repo.findReport(String(payload.reportId ?? ""));
  if (!report || !["ready_for_review", "draft", "published", "superseded"].includes(report.status)) return;
  const published = report.status === "published" || report.status === "superseded";
  const key = reportExportKey(report);
  if (payload.exportKey && payload.exportKey !== key) return;
  if (report.pdfKey === `${key}.pdf`) return;
  if (!published && (await reportObjectExists(`${key}.pdf`))) return;
  const listing = await listingInfoById(report.listingId);
  if (!listing) return;
  const files = await renderReportFiles(report, await repo.listComps(report.id), listing);
  await putObject(`${key}.pptx`, files.pptx, "application/vnd.openxmlformats-officedocument.presentationml.presentation");
  await putObject(`${key}.pdf`, files.pdf, "application/pdf");
  if (published) {
    await repo.updateReport(report.id, { pdfKey: `${key}.pdf`, pdfRenderedAt: new Date() }, ["published", "superseded"]);
    await audit(report, null, `PDF and PowerPoint rendered for version ${report.version}`);
  }
}

/** Weekly: a new draft version for every published CMA on a live listing. Never publishes. */
export async function runWeeklyRefresh() {
  const reports = await repo.publishedOnLiveListings();
  let started = 0;
  let skipped = 0;
  for (const r of reports) {
    const provider = providerById(r.provider);
    if (!provider || provider.kind === "manual" || !provider.availability().available) {
      skipped++;
      continue;
    }
    try {
      await refresh(null, r.id, { trigger: "refresh" });
      started++;
    } catch (e) {
      skipped++;
      logger.warn("cma weekly refresh skipped", { reportId: r.id, error: String(e) });
    }
  }
  return { candidates: reports.length, started, skipped };
}

/** Reports stuck mid-collection (a worker that died) go back to the queue once, then fail. */
export async function recoverStale() {
  const stuck = await repo.staleActive(STALE_MINUTES);
  for (const r of stuck) {
    if (r.collectAttempts >= MAX_COLLECT_ATTEMPTS) {
      await repo.updateReport(r.id, { status: "failed", errorMessage: "Collection didn't finish. Retry, or add comparables by hand." }, ["collecting", "normalizing", "analyzing"]);
    } else if (await repo.updateReport(r.id, { status: "queued", progressNote: "Restarting after an interruption" }, ["collecting", "normalizing", "analyzing"])) {
      await enqueueUnique(providerById(r.provider)?.needsBrowser ? JOB_COLLECT_BROWSER : JOB_COLLECT, { reportId: r.id }, "reportId");
    }
  }
  return { recovered: stuck.length };
}
