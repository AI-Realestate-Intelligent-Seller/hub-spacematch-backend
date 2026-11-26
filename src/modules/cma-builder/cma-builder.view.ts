import { approvedResearch, PUBLIC_RECORDS } from "../property-intelligence/review.js";
// What the API returns. Agents get everything about their report; sellers get only the published
// version, with no logs, errors, internal notes or unpublished numbers.
import type { CmaComparableRow, CmaReportRow } from "./cma-builder.model.js";
import type { Analysis, Comparable, CompScore, ListingCmaStatus, PropertyType } from "./cma-builder.types.js";
import { ACTIVE_STATUSES } from "./cma-builder.types.js";

export type ListingInfo = { id: string; address: string; priceCents: number | null; status: string; agentName: string; agentEmail: string; photoUrl: string | null };

export const toEngineComp = (c: CmaComparableRow): Comparable => ({
  id: c.id,
  status: c.status as Comparable["status"],
  address: c.address,
  lat: c.lat,
  lng: c.lng,
  propertyType: c.propertyType as PropertyType | null,
  originalListPrice: c.originalListPrice,
  listPrice: c.listPrice,
  soldPrice: c.soldPrice,
  soldDate: c.soldDate,
  listDate: c.listDate,
  daysOnMarket: c.daysOnMarket,
  beds: c.beds,
  baths: c.baths,
  sqft: c.sqft,
  lotSqft: c.lotSqft,
  yearBuilt: c.yearBuilt,
  condition: c.condition as Comparable["condition"],
  garageSpaces: c.garageSpaces,
  distanceMi: c.distanceMi,
  selected: c.selected,
  adjustments: c.adjustments,
  isFixture: c.isFixture,
  requiresSelection: c.source === PUBLIC_RECORDS,
});

const emptyScore = (id: string): CompScore => ({ id, similarity: 0, coverage: 0, pricePerSqft: null, outlier: false, adjustedValue: null, adjustmentTotal: 0, suggestions: [] });

export function compView(c: CmaComparableRow, analysis: Analysis | null) {
  const s = analysis?.scores.find(x => x.id === c.id) ?? emptyScore(c.id);
  return {
    id: c.id,
    source: c.source,
    sourceRecordId: c.sourceRecordId,
    sourceUrl: c.sourceUrl,
    isFixture: c.isFixture,
    manual: c.manual,
    status: c.status,
    address: c.address,
    city: c.city,
    state: c.state,
    zip: c.zip,
    lat: c.lat,
    lng: c.lng,
    propertyType: c.propertyType,
    originalListPrice: c.originalListPrice,
    listPrice: c.listPrice,
    soldPrice: c.soldPrice,
    soldDate: c.soldDate,
    listDate: c.listDate,
    daysOnMarket: c.daysOnMarket,
    beds: c.beds,
    baths: c.baths,
    sqft: c.sqft,
    lotSqft: c.lotSqft,
    yearBuilt: c.yearBuilt,
    condition: c.condition,
    garageSpaces: c.garageSpaces,
    features: c.features,
    distanceMi: c.distanceMi,
    selected: c.selected,
    adjustments: c.adjustments,
    notes: c.notes,
    collectedAt: c.collectedAt,
    similarity: s.similarity,
    coverage: s.coverage,
    pricePerSqft: s.pricePerSqft,
    outlier: s.outlier,
    adjustedValue: s.adjustedValue,
    adjustmentTotal: s.adjustmentTotal,
    suggestions: s.suggestions,
  };
}
export type CompView = ReturnType<typeof compView>;

/** The value the agent stands behind: their override, else the engine estimate. */
export const finalValue = (r: CmaReportRow) => r.override?.value ?? r.analysis?.estimatedValue ?? null;

/** Recommended range: the agent's own numbers, else the engine's range. */
export function recommendedRange(r: CmaReportRow): { low: number; high: number; fromAgent: boolean } | null {
  const c = r.content;
  if (c.recommendedLow && c.recommendedHigh) return { low: c.recommendedLow, high: c.recommendedHigh, fromAgent: true };
  const v = r.analysis?.valueRange;
  return v ? { low: v.low, high: v.high, fromAgent: false } : null;
}

export function reportSummary(r: CmaReportRow) {
  return {
    id: r.id,
    version: r.version,
    status: r.status,
    trigger: r.trigger,
    provider: r.provider,
    estimatedValue: finalValue(r),
    engineValue: r.analysis?.estimatedValue ?? null,
    overridden: !!r.override,
    range: recommendedRange(r),
    askingPrice: r.askingPriceCents == null ? null : Math.round(r.askingPriceCents / 100),
    soldCount: r.analysis?.sold.count ?? 0,
    analysisStatus: r.analysis?.status ?? null,
    progressNote: r.progressNote,
    errorMessage: r.errorMessage,
    stages: r.stages,
    requestedByName: r.requestedByName,
    reviewedByName: r.reviewedByName,
    publishedByName: r.publishedByName,
    dataCollectedAt: r.dataCollectedAt,
    publishedAt: r.publishedAt,
    hasPdf: !!r.pdfKey,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/** Status of the CMA for a listing (drives the listing page button). */
export function listingStatus(reports: CmaReportRow[]): ListingCmaStatus {
  const open = reports.find(r => ["queued", "collecting", "normalizing", "analyzing", "ready_for_review", "draft"].includes(r.status));
  const published = reports.find(r => r.status === "published");
  if (open && ACTIVE_STATUSES.includes(open.status as never)) return published ? "refreshing" : (open.status as ListingCmaStatus);
  if (open) return open.status as ListingCmaStatus;
  const latest = reports[0];
  if (latest?.status === "failed" && !published) return "failed";
  if (latest?.status === "cancelled" && !published) return "cancelled";
  if (published) return "published";
  return reports.length ? ((latest?.status as ListingCmaStatus) ?? "not_requested") : "not_requested";
}

// ---------- Seller view ----------

export type SellerState = "none" | "requested" | "processing" | "under_review" | "published" | "refreshing";

export function sellerState(reports: CmaReportRow[]): SellerState {
  const published = reports.some(r => r.status === "published");
  const open = reports.find(r => ["queued", "collecting", "normalizing", "analyzing", "ready_for_review", "draft"].includes(r.status));
  if (published) return open && ACTIVE_STATUSES.includes(open.status as never) ? "refreshing" : "published";
  if (!open) return "none"; // failed / cancelled without a published report: nothing to say yet
  if (open.status === "queued") return "requested";
  if (ACTIVE_STATUSES.includes(open.status as never)) return "processing";
  return "under_review";
}

/** Published report for the seller: approved numbers, agent text and (if allowed) the selected comps. */
export function sellerReport(r: CmaReportRow, comps: CmaComparableRow[], redistributable: boolean) {
  const a = r.analysis;
  const showAddresses = r.content.showCompAddressesToSeller !== false;
  const sections = r.content.sections ?? { overview: true, comparables: true, market: true, adjustments: true, recommendations: true };
  const selected = comps.filter(c => c.selected && c.status !== "off_market");
  return {
    id: r.id,
    version: r.version,
    publishedAt: r.publishedAt,
    agentName: r.publishedByName ?? r.requestedByName,
    askingPrice: r.askingPriceCents == null ? null : Math.round(r.askingPriceCents / 100),
    estimatedValue: finalValue(r),
    range: recommendedRange(r),
    recommendedListPrice: r.content.recommendedListPrice ?? null,
    executiveSummary: r.content.executiveSummary ?? null,
    propertyObservations: r.content.propertyObservations ?? null,
    pricingRecommendation: sections.recommendations ? (r.content.pricingRecommendation ?? null) : null,
    marketingRecommendations: sections.recommendations ? (r.content.marketingRecommendations ?? null) : null,
    sections,
    propertyResearch: approvedResearch(r.content, r.subject),
    stats: a
      ? {
          soldCount: a.sold.count,
          avgSoldPrice: a.sold.avgPrice,
          medianSoldPrice: a.sold.medianPrice,
          avgPpsf: a.sold.avgPpsf,
          medianPpsf: a.sold.medianPpsf,
          avgDom: a.sold.avgDom,
          activeCount: a.active.count,
          pendingCount: a.pending.count,
          activeMedianPrice: a.active.medianPrice,
          soldToListRatio: a.soldToListRatio,
          subjectAskingPpsf: a.subjectPositioning.askingPpsf,
        }
      : null,
    comparables: sections.comparables
      ? selected.map(c => ({
          id: c.id,
          address: showAddresses && (redistributable || c.source === PUBLIC_RECORDS) ? c.address : null,
          source: c.source === PUBLIC_RECORDS ? "Public Records" : null,
          status: c.status,
          price: c.status === "sold" ? c.soldPrice : c.listPrice,
          soldDate: c.soldDate,
          beds: c.beds,
          baths: c.baths,
          sqft: c.sqft,
          pricePerSqft: a?.scores.find(s => s.id === c.id)?.pricePerSqft ?? null,
          distanceMi: c.distanceMi,
          daysOnMarket: c.daysOnMarket,
          isFixture: c.isFixture,
        }))
      : [],
    containsFixtures: comps.some(c => c.selected && c.isFixture),
    hasPdf: !!r.pdfKey,
    disclaimer: DISCLAIMER,
  };
}

export const DISCLAIMER =
  "This comparative market analysis was prepared and reviewed by a licensed real estate agent from recent comparable sales and listings. It is an opinion of a likely market price range, not an appraisal, and must not be used in place of one for lending or legal purposes. Values depend on condition, timing and buyer demand, and may change.";
