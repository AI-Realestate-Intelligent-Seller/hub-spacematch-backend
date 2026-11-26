import { approvedResearch } from "../property-intelligence/review.js";
// Read-only CMA facts for other modules (weekly seller email, the AI marketing plan). Published,
// agent-approved data only: drafts, overrides in progress and collection logs never leave here.
import * as repo from "./cma-builder.repository.js";
import { DISCLAIMER, finalValue, recommendedRange } from "./cma-builder.view.js";

/** Latest published CMA for a listing, summarised for the weekly seller email (null if none). */
export async function publishedSummary(listingId: string) {
  const pub = await repo.latestPublished(listingId);
  if (!pub?.publishedAt) return null;
  const cmp = pub.analysis?.comparedToPublished;
  return {
    version: pub.version,
    publishedAt: pub.publishedAt,
    estimatedValue: finalValue(pub),
    range: recommendedRange(pub),
    recommendedListPrice: pub.content.recommendedListPrice ?? null,
    pricingRecommendation: pub.content.pricingRecommendation ?? null,
    soldCount: pub.analysis?.sold.count ?? 0,
    previousValue: cmp?.previousValue ?? null,
    changePct: cmp?.changePct ?? null,
    newSales: cmp?.newSales ?? null,
  };
}

/**
 * Verified facts the AI marketing plan may use. The plan module (still on the old backend) should
 * send exactly this object and the rules with its prompt, and nothing else about pricing.
 */
export async function approvedFacts(listingId: string) {
  const pub = await repo.latestPublished(listingId);
  if (!pub?.analysis) return { available: false as const, rules: AI_RULES };
  const a = pub.analysis;
  return {
    available: true as const,
    source: `Agent-published CMA version ${pub.version}, ${pub.publishedAt?.toISOString().slice(0, 10)}`,
    estimatedValue: finalValue(pub),
    range: recommendedRange(pub),
    askingPrice: pub.askingPriceCents == null ? null : Math.round(pub.askingPriceCents / 100),
    propertyFacts: approvedResearch(pub.content, pub.subject)?.facts ?? [],
    soldComparables: a.sold.count,
    medianSoldPrice: a.sold.medianPrice,
    medianPricePerSqft: a.sold.medianPpsf,
    avgDaysOnMarket: a.sold.avgDom,
    activeCompetition: a.active.count,
    pendingCompetition: a.pending.count,
    soldToListRatio: a.soldToListRatio,
    pricingRecommendation: pub.content.pricingRecommendation ?? null,
    disclaimer: DISCLAIMER,
    rules: AI_RULES,
  };
}

export const AI_RULES = [
  "Use only the numbers given here. Do not invent property specifications, comparable properties, sales, school assignments, statistics or valuations. District boundaries describe geography only.",
  "If a number is missing, say it is not available.",
  "Describe pricing as the agent's comparative market analysis, never as an appraisal.",
  "Fair housing: never target or describe buyers by race, color, religion, sex, disability, familial status, national origin or other protected class; describe the property and location features instead.",
];
