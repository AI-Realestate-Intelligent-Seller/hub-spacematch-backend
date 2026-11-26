// CMA calculation engine. Pure and deterministic: the same comparables give the same answer, and
// every number it returns can be explained from the inputs (no AI, no hidden factors).
//
// Method (also returned in Analysis.method so the report can print it):
//  1. Sold comparables are the valuation basis. Active and pending ones are market context only.
//  2. Each comparable gets a similarity score (0–100) from distance, sale recency, size, beds,
//     baths, property type, age, lot size and condition. Missing data on either side drops that
//     factor and the remaining weights are rescaled (coverage says how much was compared).
//  3. Adjusted value = sold price + the agent's adjustments. The engine only *suggests* size
//     adjustments: (subject sq ft − comp sq ft) × median sold $/sq ft × size factor (default 50%,
//     the marginal value of a square foot). The agent decides whether to apply them.
//  4. Estimated value = similarity-weighted average of the selected sold comps' adjusted values.
//  5. Value range = weighted 25th–75th percentile of those adjusted values (the middle half);
//     with fewer than 4 comps, the lowest and highest adjusted values. It describes the spread
//     of the comparables, not a statistical confidence interval.
//  6. Fewer than `minSoldComps` selected sold comps → no value ("insufficient data").
//  7. Outliers: sold $/sq ft outside the Tukey fences (Q1 − 1.5·IQR, Q3 + 1.5·IQR), 4+ comps.
import type { Analysis, Comparable, CompScore, DataQuality, PropertyType, SearchParams, Stats, SubjectProperty, ValuationSettings } from "../cma-builder.types.js";
import { CONDITIONS, DEFAULT_VALUATION } from "../cma-builder.types.js";

// ---------- Small numeric helpers ----------

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
export const round = (v: number, step = 1) => Math.round(v / step) * step;

export function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Plain percentile with linear interpolation (p in 0–1). */
export function percentile(xs: number[], p: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
}

/** Weighted percentile: the value where the cumulative weight (centred on each point) reaches p. */
export function weightedPercentile(values: number[], weights: number[], p: number): number | null {
  if (!values.length) return null;
  const pairs = values.map((v, i) => ({ v, w: Math.max(weights[i] ?? 0, 1e-9) })).sort((a, b) => a.v - b.v);
  const total = pairs.reduce((a, b) => a + b.w, 0);
  let cum = 0;
  const centres = pairs.map(x => {
    const c = (cum + x.w / 2) / total;
    cum += x.w;
    return c;
  });
  if (p <= centres[0]!) return pairs[0]!.v;
  if (p >= centres[centres.length - 1]!) return pairs[pairs.length - 1]!.v;
  for (let i = 1; i < pairs.length; i++) {
    if (p <= centres[i]!) {
      const t = (p - centres[i - 1]!) / (centres[i]! - centres[i - 1]!);
      return pairs[i - 1]!.v + (pairs[i]!.v - pairs[i - 1]!.v) * t;
    }
  }
  return pairs[pairs.length - 1]!.v;
}

/** Great-circle distance in miles. */
export function haversineMi(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 3958.8;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const daysBetween = (isoDate: string, now: Date) => (now.getTime() - new Date(`${isoDate}T12:00:00Z`).getTime()) / 864e5;
const conditionRank = (c?: string | null) => (c ? CONDITIONS.indexOf(c as (typeof CONDITIONS)[number]) + 1 || null : null);

/** Price used for $/sq ft: sold price for sales, the current list price otherwise. */
export const compPrice = (c: Comparable) => (c.status === "sold" ? c.soldPrice : (c.listPrice ?? c.originalListPrice)) ?? null;
export const pricePerSqft = (c: Comparable) => {
  const p = compPrice(c);
  return isNum(p) && p > 0 && isNum(c.sqft) && c.sqft > 0 ? p / c.sqft : null;
};

// ---------- Similarity ----------

export const SIMILARITY_WEIGHTS = {
  distance: 0.18,
  recency: 0.14,
  size: 0.22,
  beds: 0.1,
  baths: 0.1,
  type: 0.1,
  age: 0.06,
  lot: 0.05,
  condition: 0.05,
} as const;

type Factor = keyof typeof SIMILARITY_WEIGHTS;

const TYPE_FAMILY: Record<PropertyType, string> = { single_family: "detached", townhome: "attached", condo: "attached", multi_2_4: "multi", land: "land", other: "other" };

export function similarity(subject: SubjectProperty, c: Comparable, params: Pick<SearchParams, "radiusMi" | "soldWithinDays">, now = new Date()): { score: number; coverage: number } {
  const parts: [Factor, number | null][] = [
    ["distance", isNum(c.distanceMi) ? clamp01(1 - c.distanceMi / Math.max(params.radiusMi * 1.5, 0.5)) : null],
    ["recency", c.status === "sold" && c.soldDate ? clamp01(1 - daysBetween(c.soldDate, now) / Math.max(params.soldWithinDays * 1.5, 90)) : c.status !== "sold" ? 1 : null],
    ["size", isNum(subject.sqft) && subject.sqft > 0 && isNum(c.sqft) ? clamp01(1 - Math.abs(c.sqft - subject.sqft) / subject.sqft / 0.5) : null],
    ["beds", isNum(subject.beds) && isNum(c.beds) ? clamp01(1 - Math.abs(c.beds - subject.beds) / 3) : null],
    ["baths", isNum(subject.baths) && isNum(c.baths) ? clamp01(1 - Math.abs(c.baths - subject.baths) / 3) : null],
    ["type", c.propertyType ? (c.propertyType === subject.propertyType ? 1 : TYPE_FAMILY[c.propertyType] === TYPE_FAMILY[subject.propertyType] ? 0.6 : 0.15) : null],
    ["age", isNum(subject.yearBuilt) && isNum(c.yearBuilt) ? clamp01(1 - Math.abs(c.yearBuilt - subject.yearBuilt) / 50) : null],
    ["lot", isNum(subject.lotSqft) && subject.lotSqft > 0 && isNum(c.lotSqft) ? clamp01(1 - Math.abs(c.lotSqft - subject.lotSqft) / subject.lotSqft) : null],
    ["condition", conditionRank(subject.condition) && conditionRank(c.condition) ? clamp01(1 - Math.abs(conditionRank(c.condition)! - conditionRank(subject.condition)!) / 4) : null],
  ];
  let w = 0;
  let s = 0;
  for (const [f, v] of parts) {
    if (v === null) continue;
    w += SIMILARITY_WEIGHTS[f];
    s += SIMILARITY_WEIGHTS[f] * v;
  }
  const total = Object.values(SIMILARITY_WEIGHTS).reduce((a, b) => a + b, 0);
  return { score: w ? Math.round((s / w) * 100) : 0, coverage: Math.round((w / total) * 100) / 100 };
}

// ---------- Stats ----------

export function stats(comps: Comparable[]): Stats {
  const prices = comps.map(compPrice).filter(isNum).filter(p => p > 0);
  const ppsf = comps.map(pricePerSqft).filter(isNum);
  const dom = comps.map(c => c.daysOnMarket).filter(isNum).filter(d => d >= 0);
  const r = (v: number | null, step = 1) => (v === null ? null : round(v, step));
  return {
    count: comps.length,
    avgPrice: r(mean(prices), 100),
    medianPrice: r(median(prices), 100),
    avgPpsf: r(mean(ppsf)),
    medianPpsf: r(median(ppsf)),
    avgDom: r(mean(dom)),
    medianDom: r(median(dom)),
    minPrice: prices.length ? Math.min(...prices) : null,
    maxPrice: prices.length ? Math.max(...prices) : null,
  };
}

/** Tukey fences on sold $/sq ft (needs 4+ values). Returns the ids outside them. */
export function outlierIds(comps: Comparable[]): Set<string> {
  const rows = comps.map(c => ({ id: c.id, v: pricePerSqft(c) })).filter((x): x is { id: string; v: number } => x.v !== null);
  if (rows.length < 4) return new Set();
  const q1 = percentile(rows.map(r => r.v), 0.25)!;
  const q3 = percentile(rows.map(r => r.v), 0.75)!;
  const iqr = q3 - q1;
  return new Set(rows.filter(r => r.v < q1 - 1.5 * iqr || r.v > q3 + 1.5 * iqr).map(r => r.id));
}

// ---------- Analysis ----------

export function analyze(
  subject: SubjectProperty,
  comps: Comparable[],
  params: Pick<SearchParams, "radiusMi" | "soldWithinDays">,
  settingsIn: Partial<ValuationSettings> = {},
  now = new Date(),
): Analysis {
  const settings: ValuationSettings = { ...DEFAULT_VALUATION, ...settingsIn };
  const sold = comps.filter(c => (!c.requiresSelection || c.selected) && c.status === "sold" && isNum(c.soldPrice) && c.soldPrice > 0);
  const outliers = outlierIds(sold);
  const marketPpsf = median(sold.filter(c => !outliers.has(c.id)).map(pricePerSqft).filter(isNum));

  const scores: CompScore[] = comps.map(c => {
    const sim = similarity(subject, c, params, now);
    const adjustmentTotal = c.adjustments.reduce((a, x) => a + x.amount, 0);
    const suggestions: CompScore["suggestions"] = [];
    const hasSizeAdj = c.adjustments.some(a => a.category === "size");
    if (c.status === "sold" && !hasSizeAdj && isNum(subject.sqft) && isNum(c.sqft) && marketPpsf && Math.abs(subject.sqft - c.sqft) >= 50) {
      const diff = subject.sqft - c.sqft;
      const amount = round(diff * marketPpsf * settings.sizeAdjustmentFactor, 100);
      if (amount !== 0) {
        suggestions.push({
          category: "size",
          amount,
          reason: `Size: subject is ${Math.abs(diff).toLocaleString("en-US")} sq ft ${diff > 0 ? "larger" : "smaller"} × $${Math.round(marketPpsf)}/sq ft (median sold) × ${Math.round(settings.sizeAdjustmentFactor * 100)}% marginal value`,
        });
      }
    }
    return {
      id: c.id,
      similarity: sim.score,
      coverage: sim.coverage,
      pricePerSqft: pricePerSqft(c) === null ? null : round(pricePerSqft(c)!),
      outlier: outliers.has(c.id),
      adjustedValue: c.status === "sold" && isNum(c.soldPrice) ? c.soldPrice + adjustmentTotal : null,
      adjustmentTotal,
      suggestions,
    };
  });
  const scoreOf = new Map(scores.map(s => [s.id, s]));

  const selectedSold = sold.filter(c => c.selected);
  const active = comps.filter(c => c.status === "active");
  const pending = comps.filter(c => c.status === "pending");

  // Sold-to-list: sold price ÷ the list price at sale (0.5–1.5 only; anything else is a data error).
  const ratios = sold
    .map(c => {
      const lp = c.listPrice ?? c.originalListPrice;
      return isNum(lp) && lp > 0 ? c.soldPrice! / lp : null;
    })
    .filter((r): r is number => r !== null && r >= 0.5 && r <= 1.5);

  const warnings: string[] = [];
  if (comps.some(c => c.isFixture)) warnings.push("Development fixture data is included. These are not real properties.");
  const selectedOutliers = selectedSold.filter(c => outliers.has(c.id));
  if (selectedOutliers.length) warnings.push(`${selectedOutliers.length} selected comparable${selectedOutliers.length > 1 ? "s are" : " is"} a $/sq ft outlier.`);
  if (!isNum(subject.sqft)) warnings.push("The subject's square footage is missing, so there are no size suggestions or $/sq ft check.");
  const lowCoverage = selectedSold.filter(c => (scoreOf.get(c.id)?.coverage ?? 0) < 0.5);
  if (lowCoverage.length) warnings.push(`${lowCoverage.length} selected comparable${lowCoverage.length > 1 ? "s have" : " has"} less than half the facts needed for a full comparison.`);

  const method = [
    "Sold comparables are the basis of value; active and pending listings show competition only.",
    "Adjusted value = sold price + agent-reviewed adjustments.",
    "Estimated value = similarity-weighted average of the selected sold comparables' adjusted values.",
    "Range = weighted 25th–75th percentile of adjusted values (lowest–highest under 4 comparables). It shows the spread of the comparables, not a statistical confidence interval.",
    `Suggested size adjustments use ${Math.round(settings.sizeAdjustmentFactor * 100)}% of the median sold $/sq ft.`,
  ];

  const base = {
    computedAt: now.toISOString(),
    settings,
    scores,
    sold: stats(selectedSold),
    soldAll: stats(sold),
    active: stats(active),
    pending: stats(pending),
    soldToListRatio: ratios.length ? Math.round(median(ratios)! * 1000) / 1000 : null,
    soldToListCount: ratios.length,
    method,
    warnings,
  };

  const askingPrice = isNum(subject.askingPrice) ? subject.askingPrice : null;
  const askingPpsf = askingPrice && isNum(subject.sqft) && subject.sqft > 0 ? round(askingPrice / subject.sqft) : null;

  if (selectedSold.length < settings.minSoldComps) {
    return {
      ...base,
      status: "insufficient_data",
      insufficientReason:
        sold.length < settings.minSoldComps
          ? `Only ${sold.length} sold comparable${sold.length === 1 ? "" : "s"} found; at least ${settings.minSoldComps} are needed for a value.`
          : `Select at least ${settings.minSoldComps} sold comparables (${selectedSold.length} selected).`,
      estimatedValue: null,
      valueRange: null,
      ppsfIndication: null,
      subjectPositioning: { askingPrice, askingPpsf, vsEstimatePct: null, position: null },
      quality: quality(selectedSold, scoreOf, null, now),
    };
  }

  const values = selectedSold.map(c => scoreOf.get(c.id)!.adjustedValue!);
  const weights = selectedSold.map(c => Math.max(scoreOf.get(c.id)!.similarity, 5));
  const wSum = weights.reduce((a, b) => a + b, 0);
  const estimate = round(values.reduce((a, v, i) => a + v * weights[i]!, 0) / wSum, 1000);
  const range =
    values.length >= 4
      ? { low: round(weightedPercentile(values, weights, 0.25)!, 1000), high: round(weightedPercentile(values, weights, 0.75)!, 1000), method: "Weighted 25th–75th percentile of adjusted comparable values" }
      : { low: round(Math.min(...values), 1000), high: round(Math.max(...values), 1000), method: "Lowest to highest adjusted comparable value (fewer than 4 comparables)" };
  const selPpsf = selectedSold.map(pricePerSqft).filter(isNum);
  const ppsfIndication = isNum(subject.sqft) && selPpsf.length >= settings.minSoldComps ? round(median(selPpsf)! * subject.sqft, 1000) : null;
  const vsEstimatePct = askingPrice ? Math.round(((askingPrice - estimate) / estimate) * 1000) / 10 : null;
  const position = askingPrice ? (askingPrice < range.low ? "below_range" : askingPrice > range.high ? "above_range" : "within_range") : null;

  return {
    ...base,
    status: "ok",
    estimatedValue: estimate,
    valueRange: range,
    ppsfIndication,
    subjectPositioning: { askingPrice, askingPpsf, vsEstimatePct, position },
    quality: quality(selectedSold, scoreOf, values, now),
  };
}

/** Data quality: count, distance, recency, completeness and spread of the selected sold comps. */
export function quality(selectedSold: Comparable[], scoreOf: Map<string, CompScore>, values: number[] | null, now = new Date()): DataQuality {
  const n = selectedSold.length;
  if (n < DEFAULT_VALUATION.minSoldComps && !values) return { grade: "insufficient", score: 0, notes: [`${n} selected sold comparable${n === 1 ? "" : "s"}; at least ${DEFAULT_VALUATION.minSoldComps} needed.`] };
  const notes: string[] = [];
  let score = 100;
  if (n < 5) {
    score -= 20;
    notes.push(`Small sample: ${n} sold comparables (5+ is better).`);
  }
  const dist = median(selectedSold.map(c => c.distanceMi).filter(isNum));
  if (dist === null) {
    score -= 10;
    notes.push("Distances are unknown for the selected comparables.");
  } else if (dist > 1.5) {
    score -= 15;
    notes.push(`Comparables are far away (median ${dist.toFixed(1)} mi).`);
  }
  const ages = selectedSold.map(c => (c.soldDate ? daysBetween(c.soldDate, now) : null)).filter(isNum);
  const age = median(ages);
  if (age !== null && age > 180) {
    score -= 15;
    notes.push(`Sales are older than 6 months (median ${Math.round(age)} days).`);
  }
  const complete = selectedSold.filter(c => isNum(c.sqft) && isNum(c.beds) && isNum(c.baths)).length / Math.max(n, 1);
  if (complete < 0.8) {
    score -= 15;
    notes.push(`${Math.round((1 - complete) * 100)}% of comparables are missing size, beds or baths.`);
  }
  if (values && values.length >= 2) {
    const m = mean(values)!;
    const sd = Math.sqrt(values.reduce((a, v) => a + (v - m) ** 2, 0) / (values.length - 1));
    const cv = sd / m;
    if (cv > 0.2) {
      score -= 20;
      notes.push(`Adjusted values vary widely (±${Math.round(cv * 100)}%).`);
    } else if (cv > 0.1) {
      score -= 10;
      notes.push(`Adjusted values vary moderately (±${Math.round(cv * 100)}%).`);
    }
  }
  const avgSim = mean(selectedSold.map(c => scoreOf.get(c.id)?.similarity ?? 0)) ?? 0;
  if (avgSim < 60) {
    score -= 10;
    notes.push(`Average similarity is ${Math.round(avgSim)}/100.`);
  }
  score = Math.max(0, score);
  if (!notes.length) notes.push("Recent, nearby, similar sales with complete facts.");
  return { grade: score >= 75 ? "high" : score >= 50 ? "medium" : "low", score, notes };
}

/** Picks the comparables to start from: the most similar non-outlier sales (up to `maxSold`),
 *  plus every active and pending listing as competition. */
export function autoSelect(analysis: Pick<Analysis, "scores">, comps: Comparable[], maxSold = 6, minSimilarity = 40): Set<string> {
  const score = new Map(analysis.scores.map(s => [s.id, s]));
  const sold = comps
    .filter(c => !c.requiresSelection && c.status === "sold" && isNum(c.soldPrice) && !score.get(c.id)?.outlier && (score.get(c.id)?.similarity ?? 0) >= minSimilarity)
    .sort((a, b) => (score.get(b.id)?.similarity ?? 0) - (score.get(a.id)?.similarity ?? 0))
    .slice(0, maxSold);
  return new Set([...sold.map(c => c.id), ...comps.filter(c => c.status === "active" || c.status === "pending").map(c => c.id)]);
}
