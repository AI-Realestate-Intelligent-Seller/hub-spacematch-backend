// Unit tests: CMA valuation engine, normalization/dedupe and CSV import. No database or network.
//   npm run test:cma
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Comparable, SubjectProperty } from "../../src/modules/cma-builder/cma-builder.types.js";
import { csvToRaw, parseCsv } from "../../src/modules/cma-builder/engine/csv.js";
import { applyFilters, dedupeKey, normalizeBatch, normalizeOne, parseBaths, parseDate, parseMoney, parseStatus } from "../../src/modules/cma-builder/engine/normalize.js";
import { analyze, autoSelect, haversineMi, median, outlierIds, percentile, similarity, weightedPercentile } from "../../src/modules/cma-builder/engine/valuation.js";

const NOW = new Date("2026-11-26T12:00:00Z");
const subject: SubjectProperty = { address: "851 N Eagle St, Naperville, IL 60563", zip: "60563", propertyType: "single_family", beds: 3, baths: 2, sqft: 2000, yearBuilt: 1990, lotSqft: 8000, condition: "Average / well maintained", askingPrice: 520_000 };
const params = { radiusMi: 1 as const, soldWithinDays: 180 as const };

let n = 0;
const comp = (o: Partial<Comparable>): Comparable => ({
  id: `c${++n}`,
  status: "sold",
  address: `${100 + n} Test St`,
  propertyType: "single_family",
  soldPrice: 500_000,
  soldDate: "2026-10-01",
  listPrice: 505_000,
  daysOnMarket: 20,
  beds: 3,
  baths: 2,
  sqft: 2000,
  yearBuilt: 1990,
  lotSqft: 8000,
  distanceMi: 0.4,
  selected: true,
  adjustments: [],
  ...o,
});

describe("numeric helpers", () => {
  it("median / percentile / weighted percentile", () => {
    assert.equal(median([3, 1, 2]), 2);
    assert.equal(median([1, 2, 3, 4]), 2.5);
    assert.equal(median([]), null);
    assert.equal(percentile([10, 20, 30, 40, 50], 0.25), 20);
    assert.equal(weightedPercentile([100, 200, 300], [1, 1, 1], 0.5), 200);
    // Heavier weight pulls the 25th percentile toward that value.
    assert.ok(weightedPercentile([100, 200, 300], [10, 1, 1], 0.5)! < 200);
  });
  it("haversine distance", () => {
    const d = haversineMi({ lat: 41.8781, lng: -87.6298 }, { lat: 41.8881, lng: -87.6298 });
    assert.ok(d > 0.68 && d < 0.7, `got ${d}`);
  });
});

describe("similarity", () => {
  it("identical comp scores 100 with full coverage", () => {
    const s = similarity(subject, comp({ distanceMi: 0, soldDate: "2026-11-26", condition: "Average / well maintained" }), params, NOW);
    assert.equal(s.score, 100);
    assert.equal(s.coverage, 1);
  });
  it("a far, older, bigger comp scores lower", () => {
    const near = similarity(subject, comp({}), params, NOW).score;
    const far = similarity(subject, comp({ distanceMi: 1.4, soldDate: "2026-06-01", sqft: 2800, beds: 5 }), params, NOW).score;
    assert.ok(far < near - 20, `near ${near} far ${far}`);
  });
  it("missing facts reduce coverage, not the score scale", () => {
    const s = similarity(subject, comp({ sqft: null, beds: null, baths: null, yearBuilt: null, lotSqft: null }), params, NOW);
    assert.ok(s.coverage < 0.5);
    assert.ok(s.score > 0 && s.score <= 100);
  });
});

describe("analysis", () => {
  it("weighted value, range and stats from sold comps only", () => {
    const comps = [comp({ soldPrice: 480_000 }), comp({ soldPrice: 500_000 }), comp({ soldPrice: 520_000 }), comp({ soldPrice: 510_000 }), comp({ status: "active", soldPrice: null, soldDate: null, listPrice: 900_000 })];
    const a = analyze(subject, comps, params, {}, NOW);
    assert.equal(a.status, "ok");
    assert.equal(a.sold.count, 4);
    assert.equal(a.active.count, 1);
    // All four are equally similar → plain average 502,500 → rounded to the nearest $1,000.
    assert.equal(a.estimatedValue, 503_000);
    assert.ok(a.valueRange!.low >= 480_000 && a.valueRange!.high <= 520_000 && a.valueRange!.low < a.valueRange!.high);
    assert.match(a.valueRange!.method, /25th–75th/);
    assert.equal(a.sold.medianPpsf, 253); // 505,000 / 2000 = 252.5 → 253
    assert.equal(a.subjectPositioning.position, "above_range");
  });

  it("insufficient data below 3 selected sold comps: no value at all", () => {
    const a = analyze(subject, [comp({}), comp({}), comp({ status: "active", soldPrice: null, listPrice: 400_000 })], params, {}, NOW);
    assert.equal(a.status, "insufficient_data");
    assert.equal(a.estimatedValue, null);
    assert.equal(a.valueRange, null);
    assert.match(a.insufficientReason!, /at least 3/);
    assert.equal(a.quality.grade, "insufficient");
  });

  it("deselected comps don't count; the message says to select more", () => {
    const a = analyze(subject, [comp({}), comp({}), comp({ selected: false }), comp({ selected: false })], params, {}, NOW);
    assert.equal(a.status, "insufficient_data");
    assert.match(a.insufficientReason!, /Select at least 3/);
  });

  it("agent adjustments change the adjusted value and the estimate", () => {
    const base = [comp({}), comp({}), comp({})];
    const before = analyze(subject, base, params, {}, NOW).estimatedValue!;
    const adj = base.map(c => ({ ...c, adjustments: [{ id: "a", category: "condition" as const, amount: 20_000, reason: "Subject renovated", byEmail: "x", at: "" }] }));
    const after = analyze(subject, adj, params, {}, NOW);
    assert.equal(after.estimatedValue, before + 20_000);
    assert.equal(after.scores[0]!.adjustedValue, 520_000);
    assert.equal(after.scores[0]!.adjustmentTotal, 20_000);
  });

  it("suggests (never applies) size adjustments from the median $/sq ft", () => {
    const a = analyze(subject, [comp({ sqft: 1800, soldPrice: 450_000 }), comp({ sqft: 2000 }), comp({ sqft: 2200, soldPrice: 550_000 })], params, {}, NOW);
    const small = a.scores[0]!;
    assert.equal(small.adjustmentTotal, 0);
    assert.equal(small.suggestions.length, 1);
    // 200 sq ft × $250 (median) × 50% = 25,000
    assert.equal(small.suggestions[0]!.amount, 25_000);
    assert.match(small.suggestions[0]!.reason, /200 sq ft larger/);
    assert.equal(a.scores[1]!.suggestions.length, 0); // same size → nothing
  });

  it("flags $/sq ft outliers and auto-select skips them", () => {
    const comps = [comp({}), comp({ soldPrice: 505_000 }), comp({ soldPrice: 495_000 }), comp({ soldPrice: 510_000 }), comp({ soldPrice: 1_500_000 })];
    assert.deepEqual([...outlierIds(comps)], [comps[4]!.id]);
    const a = analyze(subject, comps.map(c => ({ ...c, selected: false })), params, {}, NOW);
    const picked = autoSelect(a, comps);
    assert.ok(!picked.has(comps[4]!.id));
    assert.equal(picked.size, 4);
  });

  it("sold-to-list ratio ignores impossible values", () => {
    const a = analyze(subject, [comp({ listPrice: 500_000 }), comp({ listPrice: 525_000, soldPrice: 500_000 }), comp({ listPrice: 50_000 })], params, {}, NOW);
    assert.equal(a.soldToListCount, 2);
    assert.ok(a.soldToListRatio! > 0.95 && a.soldToListRatio! <= 1);
  });

  it("warns when fixtures are included", () => {
    const a = analyze(subject, [comp({ isFixture: true }), comp({}), comp({})], params, {}, NOW);
    assert.ok(a.warnings.some(w => /fixture/i.test(w)));
  });
});

describe("normalization", () => {
  it("parses messy fields", () => {
    assert.equal(parseMoney("$1,250,000"), 1_250_000);
    assert.equal(parseMoney("450K"), 450_000);
    assert.equal(parseMoney("1.2m"), 1_200_000);
    assert.equal(parseMoney("call"), null);
    assert.equal(parseBaths("2+1"), 2.5);
    assert.equal(parseBaths("2 full 1 half"), 2.5);
    assert.equal(parseDate("10/3/2026"), "2026-10-03");
    assert.equal(parseDate("2026-13-01"), null);
    assert.equal(parseStatus("CLSD"), "sold");
    assert.equal(parseStatus("Under Contract"), "pending");
    assert.equal(parseStatus("Withdrawn"), "off_market");
    assert.equal(parseStatus("???"), null);
  });
  it("rejects records missing what a comparable needs", () => {
    assert.deepEqual(normalizeOne({ address: "No number road", status: "sold", soldPrice: 1, soldDate: "2026-01-01" }), { error: "missing street address" });
    assert.match((normalizeOne({ address: "1 A St", status: "sold" }) as { error: string }).error, /sold price/);
    assert.match((normalizeOne({ address: "1 A St", status: "sold", soldPrice: "500000" }) as { error: string }).error, /sale date/);
    assert.match((normalizeOne({ address: "1 A St", status: "active" }) as { error: string }).error, /without a price/);
  });
  it("treats scraped text as data: strips markup and cuts length", () => {
    const r = normalizeOne({ address: "12 Main St <script>alert(1)</script>", status: "active", listPrice: 300000, notes: "x".repeat(5000) });
    assert.ok("ok" in r);
    if ("ok" in r) {
      assert.ok(!r.ok.address.includes("<"));
      assert.equal(r.ok.notes!.length, 1000);
    }
  });
  it("rejects unsafe source links", () => {
    const r = normalizeOne({ address: "12 Main St", status: "active", listPrice: 300000, sourceUrl: "javascript:alert(1)" });
    assert.ok("ok" in r && r.ok.sourceUrl === null);
  });
  it("dedupes by street+unit+zip, keeping the sale over a listing", () => {
    const { comps, duplicates, rejected } = normalizeBatch([
      { address: "12 North Main Street", zip: "60563", status: "active", listPrice: 300000 },
      { address: "12 N Main St", zip: "60563", status: "sold", soldPrice: 310000, soldDate: "2026-10-01" },
      { address: "12 N Main St #2", zip: "60563", status: "sold", soldPrice: 200000, soldDate: "2026-10-01" },
      { address: "bad", status: "sold" },
    ]);
    assert.equal(duplicates, 1);
    assert.equal(comps.length, 2);
    assert.equal(comps.find(c => !c.address.includes("#"))!.status, "sold");
    assert.equal(rejected.length, 1);
    assert.equal(dedupeKey("12 North Main Street", "60563"), dedupeKey("12 N Main St", "60563"));
  });
  it("drops the subject's own listing and computes distance from coordinates", () => {
    const s = { ...subject, street: "851 N Eagle St", lat: 41.8781, lng: -87.6298 };
    const { comps, rejected } = normalizeBatch([{ address: "851 N Eagle St", zip: "60563", status: "active", listPrice: 520000 }, { address: "9 Elm St", status: "active", listPrice: 1, lat: 41.8881, lng: -87.6298 }], s);
    assert.equal(rejected[0]?.reason, "this is the subject property's own listing");
    assert.ok(comps[0]!.distanceMi! > 0.68 && comps[0]!.distanceMi! < 0.7);
  });
  it("applies search filters", () => {
    const { comps } = normalizeBatch([
      { address: "1 A St", status: "sold", soldPrice: 1e5, soldDate: "2026-11-01", distanceMi: 0.5, sqft: 2000 },
      { address: "2 A St", status: "sold", soldPrice: 1e5, soldDate: "2025-01-01", distanceMi: 0.5, sqft: 2000 },
      { address: "3 A St", status: "sold", soldPrice: 1e5, soldDate: "2026-11-01", distanceMi: 4, sqft: 2000 },
      { address: "4 A St", status: "sold", soldPrice: 1e5, soldDate: "2026-11-01", distanceMi: 0.5, sqft: 900 },
      { address: "5 A St", status: "pending", listPrice: 1e5, distanceMi: 0.5 },
    ]);
    const { kept, filteredOut } = applyFilters(comps, { radiusMi: 1, soldWithinDays: 180, sqftMin: 1500, propertyTypes: [], statuses: ["sold"] }, NOW);
    assert.deepEqual(kept.map(c => c.address), ["1 A St"]);
    assert.equal(filteredOut, 4);
  });
});

describe("CSV import", () => {
  it("parses quotes, escaped quotes, CRLF and a BOM", () => {
    assert.deepEqual(parseCsv('﻿a,b\r\n"x, y","he said ""hi"""\r\n'), [["a", "b"], ["x, y", 'he said "hi"']]);
  });
  it("maps MLS-style headers and reports missing required columns", () => {
    const { mapping, rows } = csvToRaw("MLS #,Address,Status,Close Price,Close Date,Beds,Baths,ASF\n123,12 Main St,CLSD,\"$450,000\",10/01/2026,3,2.5,1800\n");
    assert.deepEqual(mapping.missingRequired, []);
    assert.equal(rows[0]!.soldPrice, "$450,000");
    assert.equal(rows[0]!.sqft, "1800");
    const n1 = normalizeOne(rows[0]!);
    assert.ok("ok" in n1 && n1.ok.soldPrice === 450000 && n1.ok.soldDate === "2026-10-01" && n1.ok.status === "sold");
    assert.deepEqual(csvToRaw("foo,bar\n1,2").mapping.missingRequired, ["address", "status", "a price column (sold price or list price)"]);
  });
});
