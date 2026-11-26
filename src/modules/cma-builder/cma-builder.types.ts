import type { Research } from "../property-intelligence/research.js";
// Shared types for the listing-based CMA Builder (engine, providers, service, API).
// Pure types only: no imports from the database or Express.

/** Stored report lifecycle. "not_requested" and "refreshing" are derived per listing (see listingCmaStatus). */
export const REPORT_STATUSES = [
  "queued",
  "collecting",
  "normalizing",
  "analyzing",
  "ready_for_review",
  "draft",
  "published",
  "superseded",
  "failed",
  "cancelled",
] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

/** Reports still being collected (one per listing at a time). */
export const ACTIVE_STATUSES: ReportStatus[] = ["queued", "collecting", "normalizing", "analyzing"];
/** Reports that are not finished yet: at most one per listing (duplicate-request guard). */
export const OPEN_STATUSES: ReportStatus[] = [...ACTIVE_STATUSES, "ready_for_review", "draft"];

export type ListingCmaStatus =
  | "not_requested"
  | "queued"
  | "collecting"
  | "normalizing"
  | "analyzing"
  | "ready_for_review"
  | "draft"
  | "published"
  | "refreshing"
  | "failed"
  | "cancelled";

export const COMP_STATUSES = ["sold", "pending", "active", "off_market"] as const;
export type CompStatus = (typeof COMP_STATUSES)[number];

export const PROPERTY_TYPES = ["single_family", "townhome", "condo", "multi_2_4", "land", "other"] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

/** 1 = needs work … 5 = fully renovated (the same five choices as the CMA request form). */
export const CONDITIONS = ["Needs work", "Original / dated", "Average / well maintained", "Partially updated", "Fully renovated"] as const;
export type Condition = (typeof CONDITIONS)[number];

export const ADJUSTMENT_CATEGORIES = ["size", "bedrooms", "bathrooms", "condition", "renovation", "garage", "lot", "location", "features", "other"] as const;
export type AdjustmentCategory = (typeof ADJUSTMENT_CATEGORIES)[number];

export type Adjustment = {
  id: string;
  category: AdjustmentCategory;
  /** Dollars added to (positive) or taken from (negative) the comparable's sold price. */
  amount: number;
  reason: string;
  byEmail: string;
  at: string; // ISO
  /** Set when the agent applied an engine suggestion (the formula stays in the reason). */
  suggested?: boolean;
};

export type SubjectProperty = {
  address: string;
  street?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  lat?: number | null;
  lng?: number | null;
  propertyType: PropertyType;
  beds?: number | null;
  baths?: number | null;
  sqft?: number | null;
  lotSqft?: number | null;
  yearBuilt?: number | null;
  condition?: Condition | null;
  garageSpaces?: number | null;
  askingPrice?: number | null; // dollars
  mlsNumber?: string | null;
  features?: string[];
};

export type SearchParams = {
  radiusMi: 0.5 | 1 | 3 | 5;
  soldWithinDays: 90 | 180 | 365;
  sqftMin?: number | null;
  sqftMax?: number | null;
  bedsMin?: number | null;
  bedsMax?: number | null;
  bathsMin?: number | null;
  propertyTypes: PropertyType[];
  statuses: ("sold" | "active" | "pending")[];
  instructions?: string | null;
  provider: string;
};

export type ValuationSettings = {
  /** Share of the median $/sq ft used for suggested size adjustments (marginal value of a square foot). */
  sizeAdjustmentFactor: number;
  /** Below this many selected sold comparables the engine gives no value. */
  minSoldComps: number;
};

export const DEFAULT_VALUATION: ValuationSettings = { sizeAdjustmentFactor: 0.5, minSoldComps: 3 };

/** One comparable as the engine sees it (database rows are mapped to this). */
export type Comparable = {
  id: string;
  status: CompStatus;
  address: string;
  lat?: number | null;
  lng?: number | null;
  propertyType?: PropertyType | null;
  originalListPrice?: number | null;
  listPrice?: number | null;
  soldPrice?: number | null;
  soldDate?: string | null; // YYYY-MM-DD
  listDate?: string | null;
  daysOnMarket?: number | null;
  beds?: number | null;
  baths?: number | null;
  sqft?: number | null;
  lotSqft?: number | null;
  yearBuilt?: number | null;
  condition?: Condition | null;
  garageSpaces?: number | null;
  distanceMi?: number | null;
  selected: boolean;
  adjustments: Adjustment[];
  isFixture?: boolean;
  requiresSelection?: boolean;
};

export type CompScore = {
  id: string;
  similarity: number; // 0–100
  /** Share of the similarity weights that had data on both sides (0–1). */
  coverage: number;
  pricePerSqft: number | null;
  outlier: boolean;
  adjustedValue: number | null; // sold price + adjustments (sold comps only)
  adjustmentTotal: number;
  suggestions: { category: AdjustmentCategory; amount: number; reason: string }[];
};

export type Stats = {
  count: number;
  avgPrice: number | null;
  medianPrice: number | null;
  avgPpsf: number | null;
  medianPpsf: number | null;
  avgDom: number | null;
  medianDom: number | null;
  minPrice: number | null;
  maxPrice: number | null;
};

export type DataQuality = {
  grade: "high" | "medium" | "low" | "insufficient";
  score: number; // 0–100
  notes: string[];
};

export type Analysis = {
  computedAt: string;
  status: "ok" | "insufficient_data";
  insufficientReason?: string;
  settings: ValuationSettings;
  scores: CompScore[];
  sold: Stats; // selected sold comps (the valuation basis)
  soldAll: Stats; // every collected sold comp (market context)
  active: Stats;
  pending: Stats;
  soldToListRatio: number | null; // median, where list price at sale is known
  soldToListCount: number;
  estimatedValue: number | null;
  /** Middle half of the adjusted comparable values (weighted 25th–75th percentile); min–max under 4 comps. */
  valueRange: { low: number; high: number; method: string } | null;
  ppsfIndication: number | null; // median selected sold $/sq ft × subject sq ft
  method: string[];
  subjectPositioning: {
    askingPrice: number | null;
    askingPpsf: number | null;
    vsEstimatePct: number | null; // (asking − estimate) / estimate
    position: "below_range" | "within_range" | "above_range" | null;
  };
  quality: DataQuality;
  warnings: string[];
  /** Filled by the service: how this version differs from the listing's current published version. */
  comparedToPublished?: { reportId: string; version: number; previousValue: number | null; changePct: number | null; newSales: number } | null;
};

export type ReportContent = {
  research?: Research;
  researchApprovals?: string[];
  executiveSummary?: string | null;
  propertyObservations?: string | null;
  pricingRecommendation?: string | null;
  marketingRecommendations?: string | null;
  comparableNotes?: string | null;
  /** Agent's recommended list price range (dollars). Defaults to the engine range when empty. */
  recommendedLow?: number | null;
  recommendedHigh?: number | null;
  recommendedListPrice?: number | null;
  sections?: { overview: boolean; comparables: boolean; market: boolean; adjustments: boolean; recommendations: boolean };
  showCompAddressesToSeller?: boolean;
};

export type ValueOverride = { value: number; reason: string; byEmail: string; byName: string; at: string };

export type StageEntry = { stage: string; at: string; note?: string };
