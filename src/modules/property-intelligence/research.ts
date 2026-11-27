import type { RawComparable } from "../cma-builder/engine/normalize.js";
import { collectDuPage, collectLake, COUNTY_NOTES } from "./counties.js";
import { abort, addressKey, house, json, num, quote, type Research, type ResearchContext, resolveByAddress, type Row, streetKey, str } from "./research-shared.js";

export { addressKey } from "./research-shared.js";
export type { Fact, Research, ResearchCounty } from "./research-shared.js";

const census = "https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress";
const county = "https://datacatalog.cookcountyil.gov/resource/";
const datasets = { address: "3723-97qp", building: "x54s-btds", assessment: "uzyt-m557", sales: "wvhk-k5uv", parcel: "nj4t-kc8j", condo: "3r7i-mrz4", commercial: "csik-bsws" } as const;
type Dataset = keyof typeof datasets;
export const sourceUrl = (dataset: Dataset) => county + datasets[dataset] + ".json";
const pinOf = (v: unknown) => /^\d{14}$/.test(str(v)) ? str(v) : "";
const COOK = { name: "Cook County", provider: "Cook County Assessor", salesUrl: sourceUrl("sales"), assessmentsUrl: sourceUrl("assessment") };
const cookSource = (dataset: Dataset) => ({ provider: COOK.provider, dataset, url: sourceUrl(dataset) });

async function rows(dataset: Dataset, params: Record<string, string>, signal: AbortSignal): Promise<Row[]> {
  const value = await json(sourceUrl(dataset), params, signal);
  if (!Array.isArray(value) || value.some(row => !row || typeof row !== "object")) throw new Error("Unexpected response schema");
  return value;
}

export function resolveParcel(records: Row[], street: string, standardized: string, truncated = false) {
  return resolveByAddress(records.map(r => ({ pin: pinOf(r.pin), address: str(r.prop_address_full) })), street, standardized, truncated);
}

export function marketCandidate(r: Row) {
  return r.deed_type === "Warranty" && r.is_multisale === false && num(r.num_parcels_sale) === 1 &&
    r.sale_filter_same_sale_within_365 === false && r.sale_filter_less_than_10k === false &&
    r.sale_filter_deed_type === false && (!r.sale_type || r.sale_type === "LAND AND BUILDING");
}

function spec(dataset: "condo" | "building", row: Row) {
  const condo = dataset === "condo";
  const full = num(row.char_fbath);
  return {
    beds: num(condo ? row.char_bedrooms : row.char_beds),
    baths: full === null ? null : full + (num(row.char_hbath) ?? 0) / 2,
    sqft: num(condo ? row.char_unit_sf : row.char_bldg_sf),
    yearBuilt: num(row.char_yrblt),
  };
}
const secondary = (r: Row) => r.is_parking_space === true || r.is_common_area === true;
const listingCoords = (r: Row) => ({ lat: num(r.lat), lng: num(r.lon) });
const pinFilter = (pins: string[]) => `pin in (${pins.map(quote).join(",")})`;

async function discover(pin: string, parcel: Row, condo: Row | undefined, signal: AbortSignal): Promise<RawComparable[]> {
  const classification = str(parcel.class);
  const neighborhood = str(parcel.nbhd_code);
  if (!classification || !neighborhood) return [];
  const cutoff = new Date(Date.now() - 730 * 86400_000).toISOString().slice(0, 10);
  const sales = (await rows("sales", {
    $where: `nbhd=${quote(neighborhood)} AND class=${quote(classification)} AND sale_date >= '${cutoff}T00:00:00' AND pin != ${quote(pin)} AND is_multisale=false AND sale_filter_same_sale_within_365=false AND sale_filter_less_than_10k=false AND sale_filter_deed_type=false AND deed_type='Warranty'`,
    $select: "pin,year,sale_date,sale_price,doc_no,deed_type,sale_type,is_multisale,num_parcels_sale,sale_filter_same_sale_within_365,sale_filter_less_than_10k,sale_filter_deed_type",
    $order: "sale_date DESC, doc_no", $limit: "120",
  }, signal)).filter(r => marketCandidate(r) && pinOf(r.pin) && num(r.year));
  if (!sales.length) return [];
  const where = pinFilter([...new Set(sales.map(r => pinOf(r.pin)))]) + " AND year in (" + [...new Set(sales.map(r => num(r.year)))].join(",") + ")";
  const dataset = classification === "299" ? "condo" : "building";
  const [addresses, locations, characteristics] = await Promise.all([
    rows("address", { $where: where, $select: "pin,year,prop_address_full,prop_address_city_name,prop_address_state,prop_address_zipcode_1", $limit: "1500" }, signal),
    rows("parcel", { $where: where, $select: "pin,year,lat,lon", $limit: "1500" }, signal),
    rows(dataset, { $where: where, $limit: "1500" }, signal),
  ]);
  const result: RawComparable[] = [];
  const docs = new Set<string>();
  for (const sale of sales) {
    const same = (r: Row) => r.pin === sale.pin && num(r.year) === num(sale.year);
    const a = addresses.find(same);
    const location = locations.find(same);
    const details = characteristics.filter(same);
    const info = details.length === 1 ? details[0] : undefined;
    const id = str(sale.doc_no);
    if (!a || !location || !id || docs.has(id) || (info && secondary(info))) continue;
    docs.add(id);
    const features = condo && info && info.tieback_key_pin === condo.tieback_key_pin ? ["Same county condominium development"] : [];
    result.push({
      address: str(a.prop_address_full), city: str(a.prop_address_city_name), state: str(a.prop_address_state),
      zip: str(a.prop_address_zipcode_1), ...listingCoords(location), status: "sold",
      soldDate: str(sale.sale_date).slice(0, 10), soldPrice: num(sale.sale_price), sourceRecordId: id,
      sourceUrl: sourceUrl("sales"), ...(dataset === "condo" ? { propertyType: "condo" } : {}),
      ...(info ? spec(dataset, info) : {}), features,
    });
  }
  return result;
}

/** County FIPS → adapter. Counties without open parcel data are listed in COUNTY_NOTES instead. */
const countyProviders: Readonly<Record<string, (context: ResearchContext) => Promise<Research>>> = {
  "17031": collectCookCounty,
  "17043": collectDuPage,
  "17097": collectLake,
};

/** `lookup` is what the geocoder is sent when it says more than `address` (e.g. the listing stores only the
 *  street, but the CMA subject knows the ZIP); the result stays keyed by `address`. */
export async function research(address: string, signal: AbortSignal, progress: (note: string) => Promise<void>, lookup = address): Promise<Research> {
  const r: Research = { addressKey: addressKey(address), collectedAt: new Date().toISOString(), status: "complete", issues: [], facts: {}, sales: [], assessments: [], candidates: [] };
  const issue = (source: string, message: string) => r.issues.push({ source, message });
  const attempt = async <T>(source: string, task: () => Promise<T>): Promise<T | undefined> => {
    try { abort(signal); return await task(); }
    catch (error) {
      abort(signal);
      issue(source, error instanceof Error ? error.message : "Request failed");
    }
  };
  const record: ResearchContext["record"] = (key, label, value, source, year, unit) => {
    if (typeof value !== "number" && !str(value)) return;
    r.facts[key] = { label, value: value as string | number, unit, dataset: source.dataset, provider: source.provider, url: source.url, collectedAt: r.collectedAt, effectiveDate: num(year) === null ? null : String(num(year)), verification: "source_record", approval: "pending" };
  };
  const fact = (key: string, label: string, value: unknown, _dataset: "census", year?: unknown, unit?: string) =>
    record(key, label, value, { provider: "U.S. Census Bureau", dataset: "Address geographies", url: census }, year, unit);
  await progress("Resolving address");
  const reply = await attempt("Census Geocoder", async () => await json(census, { address: lookup, benchmark: "Public_AR_Current", vintage: "Current_Current", format: "json" }, signal) as {
    result?: { addressMatches?: { matchedAddress: string; coordinates: { x: number; y: number }; geographies: Record<string, { GEOID: string; NAME: string }[]> }[] };
  });
  const matches = Array.isArray(reply?.result?.addressMatches) ? reply.result.addressMatches : [];
  const match = matches?.length === 1 ? matches[0] : undefined;
  const [street = "", second = ""] = address.split(",").map(v => v.trim());
  const original = /^(?:APT|UNIT|STE|SUITE|#)\b|^#/i.test(second) ? `${street} ${second}` : street;
  const standardized = str(match?.matchedAddress).split(",")[0] ?? "";
  const area = match?.geographies?.Counties?.[0];
  if (!match || !area || !house(streetKey(original)) || house(streetKey(original)) !== house(streetKey(standardized))) {
    r.status = reply ? "clarification" : "unavailable";
    if (reply) issue("Census Geocoder", "Enter a complete street address, city, state, ZIP and unit where applicable.");
    return r;
  }
  fact("address", "Census address", match.matchedAddress, "census");
  fact("county", "County", area.NAME, "census");
  fact("censusLat", "Census street-range latitude", num(match.coordinates?.y), "census");
  fact("censusLng", "Census street-range longitude", num(match.coordinates?.x), "census");
  fact("fips", "County FIPS", area.GEOID, "census");
  fact("tract", "Census tract", match.geographies["Census Tracts"]?.[0]?.GEOID, "census");
  fact("block", "Census block", match.geographies["2020 Census Blocks"]?.[0]?.GEOID, "census");
  const provider = countyProviders[area.GEOID];
  if (!provider) {
    r.status = "partial";
    issue("County records", COUNTY_NOTES[area.GEOID] ?? "Automatic parcel research is available for Cook, DuPage and Lake counties.");
    return r;
  }
  return provider({ result: r, original, standardized, matchedAddress: match.matchedAddress, signal, progress, issue, attempt, record });
}

async function collectCookCounty({ result: r, original, standardized, matchedAddress, signal, progress, issue, attempt, record }: ResearchContext): Promise<Research> {
  r.county = COOK;
  const fact = (key: string, label: string, value: unknown, dataset: Dataset, year?: unknown, unit?: string) => record(key, label, value, cookSource(dataset), year, unit);
  await progress("Identifying parcel");
  const [, city, state, zip] = matchedAddress.split(",").map(str);
  const records = await attempt("Cook County parcel addresses", () => rows("address", {
    $where: `prop_address_city_name=${quote(city ?? "")} AND prop_address_state=${quote(state ?? "")} AND prop_address_zipcode_1=${quote(zip ?? "")} AND starts_with(prop_address_full,${quote(addressKey(standardized))})`,
    $select: "pin,prop_address_full", $group: "pin,prop_address_full", $limit: "1000",
  }, signal));
  if (!records) { r.status = "partial"; return r; }
  const resolved = resolveParcel(records, original, standardized, records.length === 1000);
  if (!resolved.pin) {
    r.status = "clarification";
    issue("Cook County parcel addresses", resolved.ambiguous ? "Multiple or incomplete parcel matches. Verify the exact unit before starting a new request." : "No exact parcel match. Verify the listing address and unit.");
    return r;
  }

  const pin = resolved.pin;
  const currentAddresses = await attempt("Cook County current parcel address", () => rows("address", {
    pin, $select: "pin,year,prop_address_full,prop_address_city_name,prop_address_state,prop_address_zipcode_1",
    $order: "year DESC", $limit: "4",
  }, signal));
  if (!currentAddresses) { r.status = "partial"; return r; }
  const currentYear = currentAddresses[0]?.year;
  const latestAddresses = currentAddresses.filter(row => row.year === currentYear);
  const current = latestAddresses.length === 1 ? latestAddresses[0] : undefined;
  if (!current || current.prop_address_city_name !== city || current.prop_address_state !== state || current.prop_address_zipcode_1 !== zip ||
      resolveParcel([current], original, standardized).pin !== pin) {
    r.status = "clarification";
    issue("Cook County parcel addresses", "The current parcel address disagrees with the lookup. Verify the exact listing address and unit.");
    return r;
  }
  fact("pin", "Property PIN", pin, "address", currentYear);
  fact("parcelAddress", "Verified county parcel address", [current.prop_address_full, city, [state, zip].join(" ")].join(", "), "address", currentYear);
  await progress("Retrieving property records and sales history");
  const byPin = (dataset: Dataset, order = "year DESC", limit = "100") => attempt(`Cook County ${dataset}`, () => rows(dataset, {
    ...(dataset === "commercial" ? { keypin: pin.replace(/^(..)(..)(...)(...)(....)$/, "$1-$2-$3-$4-$5") } : { pin }),
    $order: order, $limit: limit,
    ...(dataset === "sales" ? { $select: "sale_date,sale_price,doc_no,deed_type,sale_type,is_multisale,num_parcels_sale,sale_filter_same_sale_within_365,sale_filter_less_than_10k,sale_filter_deed_type" } : {}),
  }, signal));
  const [parcels, sales, assessments] = await Promise.all([byPin("parcel", "year DESC", "1"), byPin("sales", "sale_date DESC, doc_no"), byPin("assessment")]);
  const parcel = parcels?.[0];
  const classification = str(parcel?.class);
  const dataset = classification === "299" ? "condo" : "building";
  const [buildings, commercial] = await Promise.all([byPin(dataset), /^5/.test(classification) ? byPin("commercial") : undefined]);
  const latest = buildings?.[0];
  const single = latest && !buildings?.slice(1).some(row => num(row.year) === num(latest.year));
  if (single && !secondary(latest)) {
    const info = spec(dataset, latest);
    fact("type", "Property type", dataset === "condo" ? "Condominium" : latest.char_use, dataset, latest.year);
    fact("beds", "Bedrooms", info.beds, dataset, latest.year);
    fact("baths", "Bathrooms", info.baths, dataset, latest.year);
    fact("yearBuilt", "Year built", info.yearBuilt, dataset, latest.year);
    fact("area", dataset === "condo" ? "Condo unit area" : "Assessor exterior building area", info.sqft, dataset, latest.year, "sq ft");
    if (dataset === "building") {
      fact("lot", "Land area", num(latest.char_land_sf), dataset, latest.year, "sq ft");
      fact("basement", "Basement", [str(latest.char_bsmt), str(latest.char_bsmt_fin)].filter(Boolean).join(" · "), dataset, latest.year);
      fact("garage", "Garage", latest.char_gar1_size, dataset, latest.year);
    } else {
      fact("development", "Condominium development key", latest.tieback_key_pin, dataset, latest.year);
      fact("developmentParcels", "Development parcel count", num(latest.char_building_pins), dataset, latest.year);
    }
  } else if (latest && !single) issue("Cook County characteristics", "Multiple improvements in the latest record year require agent review.");
  else if (latest && secondary(latest)) issue("Cook County characteristics", "The parcel is identified as a parking space or common area.");
  const commercialRecord = commercial?.[0];
  if (commercialRecord) {
    fact("commercialUse", "Commercial use", commercialRecord.property_type_use, "commercial", commercialRecord.year);
    fact("commercialArea", "Commercial building area", num(commercialRecord.bldgsf), "commercial", commercialRecord.year, "sq ft");
  }
  r.sales = (sales ?? []).flatMap(s => {
    const price = num(s.sale_price);
    const date = str(s.sale_date).slice(0, 10);
    return price === null || !/^\d{4}-\d{2}-\d{2}$/.test(date) ? [] : [{ date, price, deed: str(s.deed_type), marketCandidate: marketCandidate(s) }];
  });
  r.assessments = (assessments ?? []).flatMap(a => {
    const year = num(a.year);
    const board = num(a.board_tot), certified = num(a.certified_tot), mailed = num(a.mailed_tot);
    const value = board ?? certified ?? mailed;
    return year === null || value === null ? [] : [{ year, value, stage: board !== null ? "Board of Review" : certified !== null ? "Certified" : "Mailed" }];
  });
  await progress("Analyzing location");
  if (parcel) {
    fact("class", "County property class", classification, "parcel", parcel.year);
    fact("latitude", "County parcel centroid latitude", num(parcel.lat), "parcel", parcel.year);
    fact("longitude", "County parcel centroid longitude", num(parcel.lon), "parcel", parcel.year);
    for (const level of ["elementary", "secondary", "unified"]) fact(`school_${level}`, `${level.charAt(0).toUpperCase() + level.slice(1)} school district boundary`, parcel[`school_${level}_district_name`], "parcel", parcel.school_data_year);
    if (typeof parcel.env_flood_fema_sfha === "boolean") fact("flood", "County mapped FEMA special flood hazard area", parcel.env_flood_fema_sfha ? "Yes" : "No", "parcel", parcel.env_flood_fema_data_year);
    if (!latest || !secondary(latest)) {
      await progress("Discovering comparable properties");
      r.candidates = (await attempt("Cook County comparable sales", () => discover(pin, parcel, dataset === "condo" ? latest : undefined, signal))) ?? [];
    }
  }
  r.status = r.issues.length || !parcel ? "partial" : "complete";
  return r;
}
