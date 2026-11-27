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
  match = county("17019"); // Champaign: no adapter
  const unsupported = await run();
  assert.equal(unsupported.status, "partial");
  assert.match(unsupported.issues[0]?.message ?? "", /Cook, DuPage and Lake/);
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

// ---------------------------------------------------------- suburban counties ----

const geocoded = (geoid: string, matched: string) => ({ result: { addressMatches: [{ matchedAddress: matched, coordinates: { x: -88.1, y: 41.8 }, geographies: { Counties: [{ GEOID: geoid, NAME: "County" }] } }] } });
const features = (...rows: { attributes: Record<string, unknown>; centroid?: { x: number; y: number } }[]) => Response.json({ features: rows });

test("DuPage: the parcel is matched by address, with fair cash value history and no owner fields requested", async t => {
  const queries: URL[] = [];
  t.mock.method(globalThis, "fetch", async (url: URL) => {
    if (url.hostname.startsWith("geocoding")) return Response.json(geocoded("17043", "1035 N EAGLE ST, NAPERVILLE, IL, 60563"));
    queries.push(url);
    const year = Number(/AssessmentParcels(\d{4})/.exec(url.pathname)?.[1]);
    if (url.searchParams.get("where")?.startsWith("PIN=")) return features({ attributes: { PIN: "0712403045", FCVTOTAL: 300000 + (year - 2020) * 1000 } });
    return features(
      { attributes: { PIN: "0712403045", PROPADDRL1: "1035 N EAGLE ST", PROPADDRL2: "NAPERVILLE IL 60563", PROPCLASS: "R", FCVTOTAL: 369646, FCVLAND: 133415, FCVIMP: 236231, TAXAMOUNT: 20620.04, ACREAGE: 0.6, MUNICIPALITY: "Naperville", UNITSCHOOLDISTRICT: "District 203", MULTIPIN_COUNT: 1 }, centroid: { x: -88.1513, y: 41.788 } },
      { attributes: { PIN: "0712403046", PROPADDRL1: "1035 N EAGLE STATION RD" } }, // same LIKE prefix, different street
    );
  });
  const r = await research("1035 N Eagle St, Naperville, IL 60563", AbortSignal.timeout(2000), async () => {});
  assert.equal(r.county?.name, "DuPage County");
  assert.equal(r.facts.pin?.value, "07-12-403-045");
  assert.equal(r.facts.fairCashValue?.value, "$369,646");
  assert.equal(r.facts.taxBill?.value, "$20,620");
  assert.equal(r.facts.lot?.value, 26136);
  assert.equal(r.facts.school_unified?.value, "District 203");
  assert.equal(r.facts.latitude?.value, 41.788);
  assert.deepEqual(r.assessments.map(a => a.year), [2025, 2024, 2023, 2022, 2021, 2020]);
  assert.equal(r.assessments[0]?.value, 369646);
  assert.equal(r.assessments[1]?.value, 304000);
  assert.equal(r.status, "partial"); // no county sales in DuPage open data
  assert.match(r.issues.map(i => i.message).join(" "), /doesn't publish recorded sales/);
  const first = queries[0]!;
  assert.match(first.searchParams.get("where") ?? "", /^PROPZIP='60563' AND PROPADDRL1 LIKE '1035 N EAGLE ST%'$/);
  for (const q of queries) assert.doesNotMatch(q.searchParams.get("outFields") ?? "", /BILLNAME|BILLADDR|taxpayer/i);
});

test("DuPage: a building address shared by several PINs asks for the unit", async t => {
  t.mock.method(globalThis, "fetch", async (url: URL) => {
    if (url.hostname.startsWith("geocoding")) return Response.json(geocoded("17043", "500 S MAIN ST, WHEATON, IL, 60187"));
    return features({ attributes: { PIN: "0516100001", PROPADDRL1: "500 S MAIN ST UNIT 1" } }, { attributes: { PIN: "0516100002", PROPADDRL1: "500 S MAIN ST UNIT 2" } });
  });
  const r = await research("500 S Main St, Wheaton, IL 60187", AbortSignal.timeout(2000), async () => {});
  assert.equal(r.status, "clarification");
  assert.equal(r.facts.pin, undefined);
});

test("Lake: PIN, address and location from the open parcel layer; taxpayer fields are never requested", async t => {
  const queries: URL[] = [];
  t.mock.method(globalThis, "fetch", async (url: URL) => {
    if (url.hostname.startsWith("geocoding")) return Response.json(geocoded("17097", "18 N COUNTY ST, WAUKEGAN, IL, 60085"));
    queries.push(url);
    return features({ attributes: { PIN: "0821410004", situs_addr_line_1_First: "18 N COUNTY ST", situs_addr_city_First: "WAUKEGAN", situs_addr_state_legdat_First: "IL", situs_addr_zip_legdat_First: "60085", INSIDE_X: -87.8332, INSIDE_Y: 42.3603 } });
  });
  const r = await research("18 N County St, Waukegan, IL 60085", AbortSignal.timeout(2000), async () => {});
  assert.equal(r.county?.name, "Lake County");
  assert.equal(r.facts.pin?.value, "08-21-410-004");
  assert.equal(r.facts.parcelAddress?.value, "18 N COUNTY ST, WAUKEGAN, IL 60085");
  assert.equal(r.facts.longitude?.value, -87.8332);
  assert.equal(r.status, "partial");
  assert.doesNotMatch(queries[0]!.searchParams.get("outFields") ?? "", /taxpayer/i);
});

test("an ArcGIS error body is reported as a provider issue, not a crash", async t => {
  t.mock.method(globalThis, "fetch", async (url: URL) => {
    if (url.hostname.startsWith("geocoding")) return Response.json(geocoded("17097", "18 N COUNTY ST, WAUKEGAN, IL, 60085"));
    return Response.json({ error: { code: 400, message: "Invalid query" } });
  });
  const r = await research("18 N County St, Waukegan, IL 60085", AbortSignal.timeout(2000), async () => {});
  assert.equal(r.status, "partial");
  assert.match(r.issues[0]?.message ?? "", /ArcGIS error 400 Invalid query/);
});

test("Will, Kane and McHenry explain why they aren't researched automatically", async t => {
  let geoid = "17197";
  t.mock.method(globalThis, "fetch", async () => Response.json(geocoded(geoid, "150 W JEFFERSON ST, JOLIET, IL, 60432")));
  for (const [id, words] of [["17197", /Will County/], ["17089", /Kane County.*Sidwell/], ["17111", /McHenry County/]] as const) {
    geoid = id;
    const r = await research("150 W Jefferson St, Joliet, IL 60432", AbortSignal.timeout(2000), async () => {});
    assert.equal(r.status, "partial");
    assert.match(r.issues[0]?.message ?? "", words);
  }
});

test("approved research keeps its county for labels; older research falls back to Cook", () => {
  const base = { addressKey: "X", collectedAt: "2026-11-27T00:00:00Z", status: "partial" as const, issues: [], sales: [], candidates: [], assessments: [{ year: 2025, value: 1, stage: "Fair cash value" }], facts: {} };
  assert.equal(approvedResearch({ research: { ...base, county: { name: "DuPage County", provider: "DuPage County Supervisor of Assessments" } }, researchApprovals: ["assessments"] })?.county.name, "DuPage County");
  assert.equal(approvedResearch({ research: base, researchApprovals: ["assessments"] })?.county.name, "Cook County");
});
