// Shared by the county adapters (research.ts: Cook; counties.ts: DuPage, Lake): types, parsing,
// address matching and the HTTP helper.
import type { RawComparable } from "../cma-builder/engine/normalize.js";

export type Row = Record<string, unknown>;
export const str = (v: unknown) => typeof v === "string" ? v.trim() : "";
export const num = (v: unknown) => (typeof v === "number" || str(v)) && Number.isFinite(Number(v)) ? Number(v) : null;
export const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
export const abort = (signal: AbortSignal) => signal.throwIfAborted();

export type Fact = { label: string; value: string | number; unit?: string; provider: string; dataset: string; url: string; collectedAt: string; effectiveDate: string | null; verification: "source_record"; approval: "pending" };
/** Who the county records come from, for labels and source links (absent on older Cook-only research). */
export type ResearchCounty = { name: string; provider: string; salesUrl?: string; assessmentsUrl?: string; valueLabel?: string };
export type Research = {
  addressKey: string; collectedAt: string; status: "complete" | "partial" | "clarification" | "unavailable";
  issues: { source: string; message: string }[];
  facts: Record<string, Fact>;
  sales: { date: string; price: number; deed: string; marketCandidate: boolean }[];
  assessments: { year: number; value: number; stage: string }[];
  candidates: RawComparable[];
  county?: ResearchCounty;
};
/** Where one fact came from. */
export type SourceRef = { provider: string; dataset: string; url: string };

export type ResearchContext = {
  result: Research;
  original: string;
  standardized: string;
  matchedAddress: string;
  signal: AbortSignal;
  progress: (note: string) => Promise<void>;
  issue: (source: string, message: string) => void;
  attempt: <T>(source: string, task: () => Promise<T>) => Promise<T | undefined>;
  /** Records a county fact with its source (skips empty values). */
  record: (key: string, label: string, value: unknown, source: SourceRef, year?: unknown, unit?: string) => void;
};

export const addressKey = (value: string) => value.trim().replace(/\s+/g, " ").toUpperCase();
const streetSuffix: Record<string, string> = { TRAIL: "TRL", STREET: "ST", AVENUE: "AVE", ROAD: "RD", LANE: "LN", DRIVE: "DR", COURT: "CT", PLACE: "PL", BOULEVARD: "BLVD", TERRACE: "TER", CIRCLE: "CIR" };
export const streetKey = (value: string) => addressKey(value).replace(/[.,]/g, "").replace(/\s*#\s*/g, " UNIT ").replace(/\b(?:APT|UNIT|STE|SUITE)\s+/g, "").replace(/\b[A-Z]+\b/g, word => streetSuffix[word] ?? word);
export const house = (value: string) => /^\d+[A-Z-]*/.exec(value)?.[0];

/** "1532 Mohawk Trl, Wheeling, IL, 60090" (Census matched address) → its parts. */
export function addressParts(matchedAddress: string) {
  const [street = "", city = "", state = "", zip = ""] = matchedAddress.split(",").map(str);
  return { street, city, state, zip };
}

export async function json(url: string, params: Record<string, string>, signal: AbortSignal): Promise<unknown> {
  const endpoint = new URL(url);
  endpoint.search = new URLSearchParams(params).toString();
  for (let attempt = 0; ; attempt++) {
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(8500)]);
    const response = await fetch(endpoint, { signal: requestSignal });
    abort(signal);
    if (response.ok) return response.json();
    if (attempt || ![502, 503, 504].includes(response.status)) throw new Error(`HTTP ${response.status}`);
    const delay = Number(response.headers.get("retry-after"));
    if (Number.isFinite(delay) && delay > 1) throw new Error(`HTTP ${response.status}`);
    await response.body?.cancel();
    await new Promise(resolve => setTimeout(resolve, 500));
    abort(signal);
  }
}

/**
 * The one parcel at this street address (and unit). `records` are the county's candidates for the street;
 * a building address without a unit only matches when exactly one parcel carries it. `truncated`: the
 * candidate list was cut off, so a unique match can't be trusted.
 */
export function resolveByAddress(records: { pin: string; address: string }[], street: string, standardized: string, truncated = false) {
  const original = streetKey(street);
  const base = streetKey(standardized);
  if (original !== base && !original.startsWith(base + " ")) return { pin: null, ambiguous: true };
  const wanted = original;
  const matches = records.filter(r => {
    const key = streetKey(r.address);
    return key === wanted || (wanted === base && key.startsWith(base + " "));
  });
  const pins = new Set(matches.map(r => r.pin).filter(Boolean));
  return { pin: !truncated && pins.size === 1 && matches.some(r => streetKey(r.address) === wanted) ? [...pins][0]! : null, ambiguous: truncated || pins.size > 0 };
}
