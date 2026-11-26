import assert from "node:assert/strict";
import { test } from "node:test";
import { analyze, autoSelect } from "../../src/modules/cma-builder/engine/valuation.js";
import { marketCandidate, research, resolveParcel } from "../../src/modules/property-intelligence/research.js";
import { approvedResearch, subjectForAnalysis } from "../../src/modules/property-intelligence/review.js";

test("parcel matching preserves leading zeros and requires an exact unit when multiple PINs share an address", () => {
  const records = [
    { pin: "01234567890001", prop_address_full: "101 TEST TRL UNIT 1" },
    { pin: "01234567890002", prop_address_full: "101 TEST TRL UNIT 2" },
  ];
  assert.deepEqual(resolveParcel(records, "101 Test Trail", "101 TEST TRL"), { pin: null, ambiguous: true });
  assert.equal(resolveParcel(records, "101 Test Trl # 2", "101 TEST TRL").pin, "01234567890002");
  assert.equal(resolveParcel(records, "101 Test Trl # 3", "101 TEST TRL").pin, null);
  assert.equal(resolveParcel(records, "101 Test Trl # 1", "101 TEST TRL", true).pin, null);
});

test("market screening requires county quality flags and excludes multiple parcels and non-warranty deeds", () => {
  const transaction = { deed_type: "Warranty", is_multisale: false, num_parcels_sale: "1", sale_filter_same_sale_within_365: false, sale_filter_less_than_10k: false, sale_filter_deed_type: false };
  assert.equal(marketCandidate(transaction), true);
  assert.equal(marketCandidate({ ...transaction, num_parcels_sale: "2" }), false);
  assert.equal(marketCandidate({ ...transaction, deed_type: "Quitclaim" }), false);
  assert.equal(marketCandidate({ ...transaction, sale_filter_same_sale_within_365: true }), false);
});

test("an unselected public candidate receives a score without affecting valuation inputs or automatic selection", () => {
  const subject = { address: "101 Test Trail", propertyType: "condo" as const, sqft: 1200 };
  const params = { radiusMi: 1 as const, soldWithinDays: 180 as const };
  const now = new Date("2026-11-26");
  const base = { status: "sold" as const, address: "102 Test Trail", soldPrice: 300000, soldDate: "2026-11-20", distanceMi: 0.2, propertyType: "condo" as const, sqft: 1200, adjustments: [] };
  const reviewed = [1, 2, 3].map(id => ({ ...base, id: String(id), selected: true }));
  const publicRecord = { ...base, id: "county", soldPrice: 500000, selected: false, requiresSelection: true };
  const before = analyze(subject, reviewed, params, {}, now);
  const combined = analyze(subject, [...reviewed, publicRecord], params, {}, now);
  assert.deepEqual(combined.sold, before.sold);
  assert.deepEqual(combined.scores[0], before.scores[0]);
  assert.equal(combined.estimatedValue, before.estimatedValue);
  assert.equal(combined.scores.at(-1)?.pricePerSqft, 417);
  assert.equal(autoSelect(combined, [publicRecord], 6, 0).size, 0);
  assert.equal(analyze(subject, [...reviewed, { ...publicRecord, selected: true }], params, {}, now).sold.count, 4);
});

test("invalid, unsupported, rate-limited, partial and cancelled research return safely", async t => {
  const county = (id: string) => ({ matchedAddress: "101 TEST TRL, TEST, IL, 60090", geographies: { Counties: [{ GEOID: id, NAME: "County" }] } });
  let match: object | null = null;
  let responseStatus = 200;
  t.mock.method(globalThis, "fetch", async (url: URL) => {
    if (url.hostname.startsWith("geocoding")) return Response.json({ result: { addressMatches: match ? [match] : [] } }, { status: responseStatus });
    return new Response("rate limited", { status: 429 });
  });
  const run = (signal = AbortSignal.timeout(1000)) => research("101 Test Trl, Test, IL 60090", signal, async () => {});
  assert.equal((await run()).status, "clarification");
  match = county("17043");
  assert.equal((await run()).status, "partial");
  match = county("17031");
  const partial = await run();
  assert.equal(partial.status, "partial");
  assert.equal(partial.issues[0]?.message, "HTTP 429");
  assert.equal(partial.facts.pin, undefined);
  assert.equal(approvedResearch({ research: partial }), null);
  assert.equal(approvedResearch({ research: partial, researchApprovals: ["county"] })?.facts[0]?.approval, "approved");
  responseStatus = 429;
  assert.equal((await run()).status, "unavailable");
  await assert.rejects(run(AbortSignal.abort()));
});

test("county facts can fill analysis gaps while agent facts remain authoritative", () => {
  const collectedAt = "2026-11-26T00:00:00Z";
  const meta = { provider: "Cook County", dataset: "condo", url: "https://example.com", collectedAt, effectiveDate: "2026", verification: "source_record" as const, approval: "pending" as const };
  const research = { addressKey: "101 TEST TRAIL", collectedAt, status: "complete" as const, issues: [], sales: [], assessments: [], candidates: [],
    facts: { beds: { ...meta, label: "Bedrooms", value: 3 }, yearBuilt: { ...meta, label: "Year built", value: 1980 }, area: { ...meta, label: "Exterior building area", value: 1000 } } };
  const subject = { address: "101 Test Trail", propertyType: "condo" as const, beds: 2 };
  const enriched = subjectForAnalysis(subject, { research });
  assert.equal(enriched.beds, 2);
  assert.equal(enriched.yearBuilt, 1980);
  assert.equal(enriched.sqft, undefined);
  assert.equal(approvedResearch({ research, researchApprovals: ["beds"] }, subject), null);
});

test("a provider timeout leaves the CMA with an unavailable research result", async t => {
  t.mock.method(globalThis, "fetch", async () => { throw new DOMException("Request timed out", "TimeoutError"); });
  const result = await research("101 Test Trail", AbortSignal.timeout(1000), async () => {});
  assert.equal(result.status, "unavailable");
  assert.equal(result.issues[0]?.message, "Request timed out");
});
