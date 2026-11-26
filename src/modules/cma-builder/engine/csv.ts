// CSV import for comparables (MLS exports, spreadsheets the agent keeps). No dependency: a small
// RFC 4180 parser plus header matching that understands common MLS export column names.
import type { RawComparable } from "./normalize.js";

export const MAX_CSV_BYTES = 2 * 1024 * 1024;
export const MAX_CSV_ROWS = 2000;

/** Parses CSV text into rows of cells (quoted fields, "" escapes, CRLF/LF, BOM). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === "") quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some(c => c.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some(c => c.trim() !== "")) rows.push(row);
  return rows;
}

/** Column aliases → RawComparable field (lower-case, letters and digits only). */
const ALIASES: Record<keyof RawComparable, string[]> = {
  sourceRecordId: ["mls", "mlsnumber", "mlsno", "mlsid", "listingid", "listingnumber", "id"],
  sourceUrl: ["url", "link", "sourceurl", "listingurl"],
  status: ["status", "listingstatus", "st", "mlsstatus"],
  address: ["address", "streetaddress", "street", "fulladdress", "propertyaddress"],
  city: ["city", "town"],
  state: ["state", "stateorprovince"],
  zip: ["zip", "zipcode", "postalcode", "zp"],
  lat: ["lat", "latitude"],
  lng: ["lng", "lon", "long", "longitude"],
  propertyType: ["propertytype", "type", "proptype", "class", "style"],
  originalListPrice: ["originallistprice", "olp", "originalprice"],
  listPrice: ["listprice", "lp", "price", "askingprice", "currentprice"],
  soldPrice: ["soldprice", "sp", "closeprice", "closedprice", "saleprice", "salesprice"],
  soldDate: ["solddate", "closedate", "closeddate", "closingdate", "saledate"],
  listDate: ["listdate", "listingdate", "listeddate", "onmarketdate"],
  daysOnMarket: ["dom", "daysonmarket", "mt", "cdom", "marketingtime"],
  beds: ["beds", "bedrooms", "br", "bedroomstotal"],
  baths: ["baths", "bathrooms", "ba", "bathstotal", "bathroomstotal"],
  sqft: ["sqft", "squarefeet", "squarefootage", "asf", "livingarea", "gla", "size"],
  lotSqft: ["lotsqft", "lotsize", "lotsizesqft", "lsz", "lotsquarefeet"],
  yearBuilt: ["yearbuilt", "built", "blt", "year"],
  condition: ["condition"],
  garageSpaces: ["garage", "garagespaces", "parking"],
  features: ["features", "amenities"],
  distanceMi: ["distance", "distancemi", "miles"],
  imageUrl: [],
  notes: ["notes", "remarks", "comments"],
};

const keyOf = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

export type CsvMapping = { columns: { header: string; field: keyof RawComparable | null }[]; missingRequired: string[] };

export function mapHeaders(headers: string[]): CsvMapping {
  const used = new Set<string>();
  const columns = headers.map(h => {
    const k = keyOf(h);
    const field = (Object.keys(ALIASES) as (keyof RawComparable)[]).find(f => !used.has(f) && (ALIASES[f].includes(k) || keyOf(f) === k)) ?? null;
    if (field) used.add(field);
    return { header: h, field };
  });
  const missingRequired = ["address", "status"].filter(f => !used.has(f));
  if (!used.has("soldPrice") && !used.has("listPrice")) missingRequired.push("a price column (sold price or list price)");
  return { columns, missingRequired };
}

/** CSV text → raw comparables (each row as RawComparable), with the header mapping used. */
export function csvToRaw(text: string): { mapping: CsvMapping; rows: RawComparable[]; truncated: boolean } {
  const all = parseCsv(text);
  const [header, ...body] = all;
  if (!header) return { mapping: { columns: [], missingRequired: ["a header row"] }, rows: [], truncated: false };
  const mapping = mapHeaders(header);
  const rows = body.slice(0, MAX_CSV_ROWS).map(cells => {
    const r: RawComparable = {};
    mapping.columns.forEach((c, i) => {
      if (c.field && cells[i] !== undefined && cells[i]!.trim() !== "") (r as Record<string, unknown>)[c.field] = cells[i]!.trim();
    });
    return r;
  });
  return { mapping, rows, truncated: body.length > MAX_CSV_ROWS };
}
