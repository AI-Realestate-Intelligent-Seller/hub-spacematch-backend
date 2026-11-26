// RentCast property API (api.rentcast.io). Not browser automation: a documented API with a free
// developer tier. Used for recorded sales (county "last sale" records) near the subject and active
// sale listings. Needs RENTCAST_API_KEY. NOT TESTED live here (no key in this environment).
//   GET /properties?address=…                     → subject coordinates
//   GET /properties?latitude&longitude&radius&…   → nearby records with lastSalePrice / lastSaleDate
//   GET /listings/sale?latitude&longitude&radius&status=Active → active listings
import { config } from "../../../config/index.js";
import type { RawComparable } from "../engine/normalize.js";
import { type ComparableProvider, ProviderError, rateLimit, throwIfAborted, withRetry } from "./provider.types.js";

const TYPE: Record<string, string> = { single_family: "Single Family", townhome: "Townhouse", condo: "Condo", multi_2_4: "Multi-Family", land: "Land" };

async function get(path: string, query: Record<string, string | number | undefined>, signal: AbortSignal): Promise<unknown> {
  const { key, url } = config.cmaBuilder.rentcast;
  if (!key) throw new ProviderError("RENTCAST_API_KEY not set", { blocked: true, agentMessage: "RentCast isn't set up." });
  const qs = new URLSearchParams(Object.entries(query).flatMap(([k, v]) => (v === undefined ? [] : [[k, String(v)]]))).toString();
  await rateLimit("rentcast", 600, signal);
  const res = await fetch(`${url}${path}?${qs}`, { headers: { "X-Api-Key": key, Accept: "application/json" }, signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]) });
  if (res.status === 401 || res.status === 403) throw new ProviderError(`RentCast ${res.status}`, { blocked: true, agentMessage: "RentCast refused the API key." });
  if (res.status === 429) throw new ProviderError("RentCast rate limit", { retryable: true, agentMessage: "RentCast's request limit was reached." });
  if (res.status >= 500) throw new ProviderError(`RentCast ${res.status}`, { retryable: true, agentMessage: "RentCast had a server error." });
  if (res.status === 404) return [];
  if (!res.ok) throw new ProviderError(`RentCast ${res.status}`, { agentMessage: "RentCast couldn't run this search." });
  return res.json();
}

const arr = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);

export const rentcastProvider: ComparableProvider = {
  id: "rentcast",
  label: "RentCast (public records + listings)",
  kind: "api",
  needsBrowser: false,
  isFixture: false,
  redistributable: true,
  availability: () => (config.cmaBuilder.rentcast.key ? { available: true } : { available: false, reason: "RentCast isn't set up.", needs: ["RENTCAST_API_KEY"] }),
  async collect({ subject, params, signal, progress, log }) {
    const call = (path: string, q: Record<string, string | number | undefined>) =>
      withRetry(() => get(path, q, signal), { attempts: 3, baseMs: 2000, signal, onRetry: (a, e) => log("warn", `RentCast attempt ${a} failed`, { error: e.message }) });
    let lat = subject.lat ?? undefined;
    let lng = subject.lng ?? undefined;
    if (lat === undefined || lng === undefined) {
      await progress("Locating the subject property");
      const found = arr(await call("/properties", { address: subject.address, limit: 1 }))[0];
      lat = typeof found?.latitude === "number" ? found.latitude : undefined;
      lng = typeof found?.longitude === "number" ? found.longitude : undefined;
      if (lat === undefined || lng === undefined) throw new ProviderError("subject not found", { agentMessage: "RentCast couldn't find the subject address." });
    }
    throwIfAborted(signal);
    const out: RawComparable[] = [];
    const propertyType = params.propertyTypes.length === 1 ? TYPE[params.propertyTypes[0]!] : undefined;
    if (params.statuses.includes("sold")) {
      await progress("Searching recorded sales");
      const cutoff = new Date(Date.now() - params.soldWithinDays * 864e5).toISOString().slice(0, 10);
      for (const p of arr(await call("/properties", { latitude: lat, longitude: lng, radius: params.radiusMi, propertyType, limit: 500 }))) {
        const saleDate = typeof p.lastSaleDate === "string" ? p.lastSaleDate.slice(0, 10) : null;
        if (!saleDate || saleDate < cutoff || typeof p.lastSalePrice !== "number") continue;
        out.push({
          sourceRecordId: p.id, status: "sold", address: p.addressLine1 ?? p.formattedAddress, city: p.city, state: p.state, zip: p.zipCode,
          lat: p.latitude, lng: p.longitude, propertyType: p.propertyType, soldPrice: p.lastSalePrice, soldDate: saleDate,
          beds: p.bedrooms, baths: p.bathrooms, sqft: p.squareFootage, lotSqft: p.lotSize, yearBuilt: p.yearBuilt,
        });
      }
    }
    if (params.statuses.includes("active") || params.statuses.includes("pending")) {
      await progress("Searching active listings");
      for (const l of arr(await call("/listings/sale", { latitude: lat, longitude: lng, radius: params.radiusMi, propertyType, status: "Active", limit: 500 }))) {
        out.push({
          sourceRecordId: l.id, status: "active", address: l.addressLine1 ?? l.formattedAddress, city: l.city, state: l.state, zip: l.zipCode,
          lat: l.latitude, lng: l.longitude, propertyType: l.propertyType, listPrice: l.price, listDate: l.listedDate, daysOnMarket: l.daysOnMarket,
          beds: l.bedrooms, baths: l.bathrooms, sqft: l.squareFootage, lotSqft: l.lotSize, yearBuilt: l.yearBuilt,
        });
      }
    }
    await log("info", `RentCast returned ${out.length} usable records`);
    return out;
  },
};
