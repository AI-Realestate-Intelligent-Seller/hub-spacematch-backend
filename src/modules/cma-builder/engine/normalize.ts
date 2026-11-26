// Turns provider records (scraped pages, API rows, CSV lines, manual entry) into one clean shape.
// Everything coming in is untrusted text: it is parsed into numbers/dates, cut to length and
// never interpreted as instructions. Records missing what a comparable needs are rejected with a reason.
import { formatStreet } from "../../../shared/address.js";
import type { CompStatus, Condition, PropertyType, SubjectProperty } from "../cma-builder.types.js";
import { COMP_STATUSES, CONDITIONS } from "../cma-builder.types.js";
import { haversineMi } from "./valuation.js";

/** What providers return. Any field may be missing or messy. */
export type RawComparable = {
  sourceRecordId?: unknown;
  sourceUrl?: unknown;
  status?: unknown;
  address?: unknown;
  city?: unknown;
  state?: unknown;
  zip?: unknown;
  lat?: unknown;
  lng?: unknown;
  propertyType?: unknown;
  originalListPrice?: unknown;
  listPrice?: unknown;
  soldPrice?: unknown;
  soldDate?: unknown;
  listDate?: unknown;
  daysOnMarket?: unknown;
  beds?: unknown;
  baths?: unknown;
  sqft?: unknown;
  lotSqft?: unknown;
  yearBuilt?: unknown;
  condition?: unknown;
  garageSpaces?: unknown;
  features?: unknown;
  distanceMi?: unknown;
  imageUrl?: unknown;
  notes?: unknown;
};

export type NormalizedComparable = {
  sourceRecordId: string | null;
  sourceUrl: string | null;
  dedupeKey: string;
  status: CompStatus;
  address: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  lat: number | null;
  lng: number | null;
  propertyType: PropertyType | null;
  originalListPrice: number | null;
  listPrice: number | null;
  soldPrice: number | null;
  soldDate: string | null;
  listDate: string | null;
  daysOnMarket: number | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  lotSqft: number | null;
  yearBuilt: number | null;
  condition: Condition | null;
  garageSpaces: number | null;
  features: string[];
  distanceMi: number | null;
  imageUrl: string | null;
  notes: string | null;
};

export type Rejected = { record: string; reason: string };

// ---------- Field parsers ----------

/** Untrusted text: strip control characters and markup brackets, collapse spaces, cut to length. */
export function cleanText(v: unknown, max = 200): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
  return s || null;
}

/** "$1,250,000" / "1.25M" / "450K" / 450000 → number. */
export function parseMoney(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? Math.round(v) : null;
  const s = cleanText(v, 40)?.toLowerCase().replace(/[$,\s]/g, "");
  if (!s) return null;
  const m = s.match(/^(\d+(?:\.\d+)?)(k|m)?$/);
  if (!m) return null;
  const n = Number(m[1]) * (m[2] === "m" ? 1e6 : m[2] === "k" ? 1e3 : 1);
  return n > 0 && n < 1e10 ? Math.round(n) : null;
}

export function parseNumber(v: unknown, { min = 0, max = 1e9, int = false } = {}): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[,\s]/g, ""));
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return int ? Math.round(n) : n;
}

/** Baths: 2.5, "2.1" (MLS style full.half → 2.5), "2 full 1 half", "2+1". */
export function parseBaths(v: unknown): number | null {
  if (typeof v === "number") return parseNumber(v, { max: 30 });
  const s = cleanText(v, 30)?.toLowerCase();
  if (!s) return null;
  const plus = s.match(/^(\d+)\s*\+\s*(\d+)$/) ?? s.match(/(\d+)\s*full.*?(\d+)\s*half/);
  if (plus) return Number(plus[1]) + Number(plus[2]) * 0.5;
  return parseNumber(s, { max: 30 });
}

/** Any common date format → YYYY-MM-DD (or null). */
export function parseDate(v: unknown): string | null {
  const s = cleanText(v, 40);
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return valid(+m[1]!, +m[2]!, +m[3]!);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) return valid(m[3]!.length === 2 ? 2000 + +m[3]! : +m[3]!, +m[1]!, +m[2]!);
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  return valid(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}
function valid(y: number, mo: number, d: number): string | null {
  if (y < 1900 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function parseStatus(v: unknown): CompStatus | null {
  const s = cleanText(v, 40)?.toLowerCase().replace(/[\s_-]+/g, "");
  if (!s) return null;
  if (COMP_STATUSES.includes(s as CompStatus)) return s as CompStatus;
  if (["closed", "clsd", "sold", "recentlysold", "cls"].includes(s)) return "sold";
  if (["pending", "pend", "undercontract", "contingent", "ctg", "pnd", "activeundercontract"].includes(s)) return "pending";
  if (["active", "act", "forsale", "new", "comingsoon", "backonmarket", "pricechange"].includes(s)) return "active";
  if (["expired", "withdrawn", "cancelled", "canceled", "offmarket", "temporarilyoffmarket", "inactive"].includes(s)) return "off_market";
  return null;
}

export function parsePropertyType(v: unknown): PropertyType | null {
  const s = cleanText(v, 60)?.toLowerCase();
  if (!s) return null;
  if (/condo|apartment|co-?op/.test(s)) return "condo";
  if (/town|row|attached|duplex.*attached/.test(s)) return "townhome";
  if (/2.?4|two.?to.?four|multi|duplex|triplex|fourplex|2 unit|3 unit|4 unit/.test(s)) return "multi_2_4";
  if (/land|lot|vacant/.test(s)) return "land";
  if (/single|detached|sfr|house|residential/.test(s)) return "single_family";
  return "other";
}

export function parseCondition(v: unknown): Condition | null {
  const s = cleanText(v, 60);
  if (!s) return null;
  const exact = CONDITIONS.find(c => c.toLowerCase() === s.toLowerCase());
  if (exact) return exact;
  const l = s.toLowerCase();
  if (/fixer|needs|tlc|poor|rehab/.test(l)) return "Needs work";
  if (/original|dated/.test(l)) return "Original / dated";
  if (/renovated|remodel|new construction|gut/.test(l)) return "Fully renovated";
  if (/updated|partial/.test(l)) return "Partially updated";
  if (/average|good|maintained/.test(l)) return "Average / well maintained";
  return null;
}

/** http(s) only, no credentials in the URL, max length. */
export function safeUrl(v: unknown): string | null {
  const s = cleanText(v, 500);
  if (!s) return null;
  try {
    const u = new URL(s);
    if ((u.protocol !== "https:" && u.protocol !== "http:") || u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Street-level key used to spot the same property from two sources: "851 n eagle st|#2|60563". */
export function dedupeKey(address: string, zip?: string | null, unit?: string | null): string {
  const { street, unit: embedded } = formatStreet(address);
  const u = (unit ?? embedded ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return `${street.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim()}|${u}|${(zip ?? "").slice(0, 5)}`;
}

// ---------- Record normalization ----------

export function normalizeOne(raw: RawComparable, subject?: SubjectProperty | null): { ok: NormalizedComparable } | { error: string } {
  const address = cleanText(raw.address, 200);
  if (!address || !/\d/.test(address)) return { error: "missing street address" };
  const status = parseStatus(raw.status);
  if (!status) return { error: `unknown status "${cleanText(raw.status, 30) ?? ""}"` };
  const soldPrice = parseMoney(raw.soldPrice);
  const listPrice = parseMoney(raw.listPrice);
  const originalListPrice = parseMoney(raw.originalListPrice);
  const soldDate = parseDate(raw.soldDate);
  if (status === "sold" && !soldPrice) return { error: "sold without a sold price" };
  if (status === "sold" && !soldDate) return { error: "sold without a sale date" };
  if (status !== "sold" && !listPrice && !originalListPrice) return { error: `${status} listing without a price` };

  const zipRaw = cleanText(raw.zip, 10);
  const zip = zipRaw && /^\d{5}/.test(zipRaw) ? zipRaw.slice(0, 5) : null;
  const lat = parseNumber(raw.lat, { min: -90, max: 90 });
  const lng = parseNumber(raw.lng, { min: -180, max: 180 });
  let distanceMi = parseNumber(raw.distanceMi, { max: 500 });
  if (subject && typeof subject.lat === "number" && typeof subject.lng === "number" && lat !== null && lng !== null) {
    distanceMi = Math.round(haversineMi({ lat: subject.lat, lng: subject.lng }, { lat, lng }) * 100) / 100;
  }
  const featuresRaw = Array.isArray(raw.features) ? raw.features : typeof raw.features === "string" ? raw.features.split(/[;,|]/) : [];
  const features = featuresRaw.map(f => cleanText(f, 60)).filter((f): f is string => !!f).slice(0, 20);

  return {
    ok: {
      sourceRecordId: cleanText(raw.sourceRecordId, 100),
      sourceUrl: safeUrl(raw.sourceUrl),
      dedupeKey: dedupeKey(address, zip),
      status,
      address,
      city: cleanText(raw.city, 80),
      state: cleanText(raw.state, 2)?.toUpperCase() ?? null,
      zip,
      lat,
      lng,
      propertyType: parsePropertyType(raw.propertyType),
      originalListPrice,
      listPrice,
      soldPrice: status === "sold" ? soldPrice : null,
      soldDate: status === "sold" ? soldDate : null,
      listDate: parseDate(raw.listDate),
      daysOnMarket: parseNumber(raw.daysOnMarket, { max: 5000, int: true }),
      beds: parseNumber(raw.beds, { max: 50 }),
      baths: parseBaths(raw.baths),
      sqft: parseNumber(raw.sqft, { min: 100, max: 100_000, int: true }),
      lotSqft: parseNumber(raw.lotSqft, { min: 100, max: 50_000_000, int: true }),
      yearBuilt: parseNumber(raw.yearBuilt, { min: 1700, max: new Date().getFullYear() + 2, int: true }),
      condition: parseCondition(raw.condition),
      garageSpaces: parseNumber(raw.garageSpaces, { max: 20, int: true }),
      features,
      distanceMi,
      imageUrl: safeUrl(raw.imageUrl),
      notes: cleanText(raw.notes, 1000),
    },
  };
}

/** How complete a record is (used to keep the better duplicate). */
const completeness = (c: NormalizedComparable) =>
  [c.soldPrice, c.listPrice, c.sqft, c.beds, c.baths, c.yearBuilt, c.lotSqft, c.lat, c.daysOnMarket, c.soldDate].filter(v => v !== null).length;
const STATUS_RANK: Record<CompStatus, number> = { sold: 3, pending: 2, active: 1, off_market: 0 };

/**
 * Normalizes a batch and removes duplicates (same street, unit and ZIP). When two records are the
 * same property, the sale wins over a listing, then the more recent sale, then the more complete record.
 */
export function normalizeBatch(raws: RawComparable[], subject?: SubjectProperty | null): { comps: NormalizedComparable[]; rejected: Rejected[]; duplicates: number } {
  const rejected: Rejected[] = [];
  const byKey = new Map<string, NormalizedComparable>();
  let duplicates = 0;
  const subjectKey = subject ? dedupeKey(subject.street ?? subject.address, subject.zip) : null;
  for (const raw of raws) {
    const r = normalizeOne(raw, subject);
    if ("error" in r) {
      rejected.push({ record: cleanText(raw.address, 80) ?? "(no address)", reason: r.error });
      continue;
    }
    const c = r.ok;
    if (subjectKey && c.dedupeKey === subjectKey && c.status !== "sold") {
      rejected.push({ record: c.address, reason: "this is the subject property's own listing" });
      continue;
    }
    const prev = byKey.get(c.dedupeKey);
    if (!prev) {
      byKey.set(c.dedupeKey, c);
      continue;
    }
    duplicates++;
    const better =
      STATUS_RANK[c.status] !== STATUS_RANK[prev.status]
        ? STATUS_RANK[c.status] > STATUS_RANK[prev.status]
        : (c.soldDate ?? "") !== (prev.soldDate ?? "")
          ? (c.soldDate ?? "") > (prev.soldDate ?? "")
          : completeness(c) > completeness(prev);
    if (better) byKey.set(c.dedupeKey, c);
  }
  return { comps: [...byKey.values()], rejected, duplicates };
}

/** Applies the agent's search filters to normalized records (providers may not support them all). */
export function applyFilters(
  comps: NormalizedComparable[],
  p: { radiusMi: number; soldWithinDays: number; sqftMin?: number | null; sqftMax?: number | null; bedsMin?: number | null; bedsMax?: number | null; bathsMin?: number | null; propertyTypes: PropertyType[]; statuses: string[] },
  now = new Date(),
): { kept: NormalizedComparable[]; filteredOut: number } {
  const cutoff = new Date(now.getTime() - p.soldWithinDays * 864e5).toISOString().slice(0, 10);
  const kept = comps.filter(c => {
    if (c.status === "off_market") return false;
    if (!p.statuses.includes(c.status)) return false;
    if (c.status === "sold" && c.soldDate && c.soldDate < cutoff) return false;
    if (c.distanceMi !== null && c.distanceMi > p.radiusMi) return false;
    if (p.propertyTypes.length && c.propertyType && !p.propertyTypes.includes(c.propertyType)) return false;
    if (p.sqftMin && c.sqft !== null && c.sqft < p.sqftMin) return false;
    if (p.sqftMax && c.sqft !== null && c.sqft > p.sqftMax) return false;
    if (p.bedsMin && c.beds !== null && c.beds < p.bedsMin) return false;
    if (p.bedsMax && c.beds !== null && c.beds > p.bedsMax) return false;
    if (p.bathsMin && c.baths !== null && c.baths < p.bathsMin) return false;
    return true;
  });
  return { kept, filteredOut: comps.length - kept.length };
}
