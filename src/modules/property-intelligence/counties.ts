// Suburban county adapters (Cook is in research.ts). Both counties publish open parcel data on ArcGIS
// Online: plain HTTPS + JSON, no key, safe to run on Vercel.
//
// - DuPage (FIPS 17043): Supervisor of Assessments yearly "Assessment Parcels + Real Estate File" layers:
//   PIN, site address, class, fair cash value (land/building/total), tax bill, school districts, acreage.
//   DuPage does not publish recorded sales as open data, so there are no county sale comparables.
// - Lake (FIPS 17097): the county's open parcel polygons: PIN, site address and location only. Assessed
//   values and sales sit on the county assessor's own site, which has no open API.
// Owner/taxpayer names are in both datasets; they are never requested.
import { addressKey, addressParts, json, num, quote, type Research, type ResearchContext, type ResearchCounty, resolveByAddress, str } from "./research-shared.js";

type Feature = { attributes: Record<string, unknown>; centroid?: { x: number; y: number } };

/** One ArcGIS feature-layer query (`layerUrl` ends in /FeatureServer/<id>). */
async function arcgis(layerUrl: string, params: Record<string, string>, signal: AbortSignal): Promise<Feature[]> {
  const value = await json(`${layerUrl}/query`, { f: "json", returnGeometry: "false", ...params }, signal) as { features?: unknown; error?: { code?: number; message?: string } };
  if (value?.error) throw new Error(`ArcGIS error ${value.error.code ?? ""} ${value.error.message ?? ""}`.trim());
  if (!Array.isArray(value?.features) || value.features.some(f => !f || typeof f !== "object" || typeof (f as Feature).attributes !== "object")) throw new Error("Unexpected response schema");
  return value.features as Feature[];
}

/** Street-address candidates for the subject: same ZIP, address starting with the Census street. */
const streetWhere = (addressField: string, zipField: string, standardized: string, zip: string) =>
  `${zipField}=${quote(zip)} AND ${addressField} LIKE ${quote(addressKey(standardized).replace(/[%_]/g, "") + "%")}`;
const MAX_CANDIDATES = 500;
/** Illinois 10-digit PIN → "07-12-403-045". */
const formatPin = (pin: string) => pin.replace(/^(\d{2})(\d{2})(\d{3})(\d{3})$/, "$1-$2-$3-$4");
/** Money facts are shown as text ("$337,053"); only beds, baths and year built feed the valuation. */
const usd = (v: unknown) => { const n = num(v); return n === null ? null : `$${Math.round(n).toLocaleString("en-US")}`; };
const pin10 = (v: unknown) => /^\d{10}$/.test(str(v)) ? str(v) : "";

function centroid(f: Feature, lat?: unknown, lng?: unknown) {
  const y = num(lat) ?? (Number.isFinite(f.centroid?.y) ? f.centroid!.y : null);
  const x = num(lng) ?? (Number.isFinite(f.centroid?.x) ? f.centroid!.x : null);
  return { lat: y, lng: x };
}

// ---------------------------------------------------------------- DuPage ----

const DUPAGE_ROOT = "https://services.arcgis.com/neJvtQ4PXvnQ86MJ/ArcGIS/rest/services";
/** Finalized end-of-year rolls, newest first, with each service's layer id. Add a line when DuPage publishes a new year. */
const DUPAGE_YEARS: readonly (readonly [year: number, layer: number])[] = [[2025, 0], [2024, 1], [2023, 2], [2022, 3], [2021, 4], [2020, 5]];
const dupageLayer = (year: number, layer: number) => `${DUPAGE_ROOT}/AssessmentParcels${year}_RealEstateFile${year}/FeatureServer/${layer}`;
const [DUPAGE_YEAR, DUPAGE_LAYER] = DUPAGE_YEARS[0]!;
const DUPAGE_CURRENT = dupageLayer(DUPAGE_YEAR, DUPAGE_LAYER);
export const DUPAGE: ResearchCounty = { name: "DuPage County", provider: "DuPage County Supervisor of Assessments", assessmentsUrl: DUPAGE_CURRENT, valueLabel: "Fair cash value" };
const dupageSource = (year: number, layer: number) => ({ provider: DUPAGE.provider, dataset: `Assessment parcels ${year}`, url: dupageLayer(year, layer) });
const DUPAGE_FIELDS = "PIN,PROPADDRL1,PROPADDRL2,PROPCITY,PROPZIP,PROPCLASS,FCVLAND,FCVIMP,FCVTOTAL,TAXAMOUNT,ACREAGE,MUNICIPALITY,GRADESCHOOLDISTRICT,HIGHSCHOOLDISTRICT,UNITSCHOOLDISTRICT,MULTIPIN_COUNT";

export async function collectDuPage({ result: r, original, standardized, matchedAddress, signal, progress, issue, attempt, record }: ResearchContext): Promise<Research> {
  r.county = DUPAGE;
  const { zip } = addressParts(matchedAddress);
  await progress("Identifying parcel");
  const found = await attempt("DuPage County parcels", () => arcgis(DUPAGE_CURRENT, {
    where: streetWhere("PROPADDRL1", "PROPZIP", standardized, zip), outFields: DUPAGE_FIELDS,
    returnCentroid: "true", outSR: "4326", resultRecordCount: String(MAX_CANDIDATES),
  }, signal));
  if (!found) { r.status = "partial"; return r; }
  const resolved = resolveByAddress(found.map(f => ({ pin: pin10(f.attributes.PIN), address: str(f.attributes.PROPADDRL1) })), original, standardized, found.length >= MAX_CANDIDATES);
  if (!resolved.pin) {
    r.status = "clarification";
    issue("DuPage County parcels", resolved.ambiguous ? "Multiple or incomplete parcel matches. Verify the exact unit before starting a new request." : "No exact parcel match. Verify the listing address and unit.");
    return r;
  }
  const pin = resolved.pin;
  const parcel = found.find(f => pin10(f.attributes.PIN) === pin)!;
  const a = parcel.attributes;
  const src = dupageSource(DUPAGE_YEAR, DUPAGE_LAYER);
  record("pin", "Property PIN", formatPin(pin), src, DUPAGE_YEAR);
  record("parcelAddress", "Verified county parcel address", [str(a.PROPADDRL1), str(a.PROPADDRL2)].filter(Boolean).join(", "), src, DUPAGE_YEAR);
  record("municipality", "Municipality", str(a.MUNICIPALITY), src, DUPAGE_YEAR);
  record("class", "County property class", str(a.PROPCLASS), src, DUPAGE_YEAR);
  record("fairCashValue", "Fair cash value (land + building)", usd(a.FCVTOTAL), src, DUPAGE_YEAR);
  record("fairCashLand", "Fair cash value: land", usd(a.FCVLAND), src, DUPAGE_YEAR);
  record("fairCashBuilding", "Fair cash value: building", usd(a.FCVIMP), src, DUPAGE_YEAR);
  record("taxBill", "Property tax bill", usd(a.TAXAMOUNT), src, DUPAGE_YEAR);
  const acres = num(a.ACREAGE);
  record("lot", "Land area (GIS)", acres === null || acres <= 0 ? null : Math.round(acres * 43_560), src, DUPAGE_YEAR, "sq ft");
  const { lat, lng } = centroid(parcel);
  record("latitude", "County parcel centroid latitude", lat, src, DUPAGE_YEAR);
  record("longitude", "County parcel centroid longitude", lng, src, DUPAGE_YEAR);
  record("school_elementary", "Elementary school district", str(a.GRADESCHOOLDISTRICT), src, DUPAGE_YEAR);
  record("school_secondary", "Secondary school district", str(a.HIGHSCHOOLDISTRICT), src, DUPAGE_YEAR);
  record("school_unified", "Unified school district", str(a.UNITSCHOOLDISTRICT), src, DUPAGE_YEAR);
  if ((num(a.MULTIPIN_COUNT) ?? 1) > 1) issue("DuPage County parcels", "This parcel is assessed together with other PINs; the values cover all of them.");

  await progress("Retrieving assessment history");
  const years = await Promise.all(DUPAGE_YEARS.map(async ([year, layer]) => {
    if (year === DUPAGE_YEAR) return { year, value: num(a.FCVTOTAL) };
    const rows = await attempt(`DuPage County assessments ${year}`, () => arcgis(dupageLayer(year, layer), { where: `PIN=${quote(pin)}`, outFields: "PIN,FCVTOTAL" }, signal));
    return { year, value: rows?.length === 1 ? num(rows[0]!.attributes.FCVTOTAL) : null };
  }));
  r.assessments = years.flatMap(y => (y.value === null ? [] : [{ year: y.year, value: y.value, stage: "Fair cash value" }]));
  issue("DuPage County sales", "DuPage County doesn't publish recorded sales as open data, so no county sales or sale comparables are added. Add comparables by hand, by CSV, or with RentCast.");
  r.status = "partial";
  return r;
}

// ------------------------------------------------------------------ Lake ----

const LAKE_PARCELS = "https://services3.arcgis.com/HESxeTbDliKKvec2/arcgis/rest/services/OpenData_ParcelPolygons/FeatureServer/0";
export const LAKE: ResearchCounty = { name: "Lake County", provider: "Lake County (IL) GIS" };
const lakeSource = { provider: LAKE.provider, dataset: "Open data parcel polygons", url: LAKE_PARCELS };
const lakeAddress = (a: Record<string, unknown>) => [str(a.situs_addr_line_1_First), str(a.situs_addr_line_2_First)].filter(Boolean).join(" ");

export async function collectLake({ result: r, original, standardized, matchedAddress, signal, progress, issue, attempt, record }: ResearchContext): Promise<Research> {
  r.county = LAKE;
  const { zip } = addressParts(matchedAddress);
  await progress("Identifying parcel");
  const found = await attempt("Lake County parcels", () => arcgis(LAKE_PARCELS, {
    where: streetWhere("situs_addr_line_1_First", "situs_addr_zip_legdat_First", standardized, zip),
    outFields: "PIN,situs_addr_line_1_First,situs_addr_line_2_First,situs_addr_city_First,situs_addr_state_legdat_First,situs_addr_zip_legdat_First,INSIDE_X,INSIDE_Y",
    returnCentroid: "true", outSR: "4326", resultRecordCount: String(MAX_CANDIDATES),
  }, signal));
  if (!found) { r.status = "partial"; return r; }
  const resolved = resolveByAddress(found.map(f => ({ pin: pin10(f.attributes.PIN), address: lakeAddress(f.attributes) })), original, standardized, found.length >= MAX_CANDIDATES);
  if (!resolved.pin) {
    r.status = "clarification";
    issue("Lake County parcels", resolved.ambiguous ? "Multiple or incomplete parcel matches. Verify the exact unit before starting a new request." : "No exact parcel match. Verify the listing address and unit.");
    return r;
  }
  const parcel = found.find(f => pin10(f.attributes.PIN) === resolved.pin)!;
  const a = parcel.attributes;
  record("pin", "Property PIN", formatPin(resolved.pin), lakeSource);
  record("parcelAddress", "Verified county parcel address", [lakeAddress(a), str(a.situs_addr_city_First), [str(a.situs_addr_state_legdat_First), str(a.situs_addr_zip_legdat_First)].filter(Boolean).join(" ")].filter(Boolean).join(", "), lakeSource);
  const { lat, lng } = centroid(parcel, a.INSIDE_Y, a.INSIDE_X);
  record("latitude", "County parcel location latitude", lat, lakeSource);
  record("longitude", "County parcel location longitude", lng, lakeSource);
  issue("Lake County records", "Lake County's open parcel data has the PIN and location only. Assessed values and sales are on the Lake County assessor's site and aren't added automatically.");
  r.status = "partial";
  return r;
}

// --------------------------------------------- counties without open data ----

/** Why these Chicago-area counties get no automatic parcel research (shown on the Property research tab). */
export const COUNTY_NOTES: Readonly<Record<string, string>> = {
  "17197": "Will County allows reuse of its parcel data only for purposes its GIS Department approves in writing, so it isn't researched automatically.",
  "17089": "Kane County doesn't publish parcel data as open data (it is sold through the Sidwell Company), so it isn't researched automatically.",
  "17111": "McHenry County doesn't publish a public parcel data service, so it isn't researched automatically.",
};
