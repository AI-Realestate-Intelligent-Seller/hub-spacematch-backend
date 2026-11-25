// "Your ad campaigns" per listing (was convex/listingAds.ts). Agents type Meta/Google/Lofty numbers;
// sellers see results only, never spend or budget. Google Analytics (website card) and the Meta /
// Google Ads feeds are later integrations; until then the website card says it isn't connected.
import { addressKey } from "../../shared/launch-steps.js";
import type { AuthUser } from "../../types/auth.js";
import { enqueue } from "../jobs/job.service.js";
import { manageableListing } from "../listings/listing.service.js";
import type { ListingAdRow } from "./listing-ad.model.js";
import * as repo from "./listing-ad.repository.js";
import type { SaveAdInput } from "./listing-ad.validation.js";

const CHANNEL_ORDER = ["meta", "google", "lofty", "website"];
const OUR_HOSTS = /(^|\.)(spacematchinc\.com|teamspacematch\.com)$/i;

/** Which Google Analytics page paths belong to this listing (website link, MLS #, street slug). */
export function matchInfo(l: { address: string; mlsNumber: string | null; links: { website?: string } }) {
  const patterns: string[] = [];
  const by: string[] = [];
  let offSite: string | undefined;
  const site = l.links.website;
  if (site) {
    try {
      const u = new URL(site);
      const path = u.pathname.replace(/\/+$/, "");
      if (OUR_HOSTS.test(u.hostname) && path) {
        patterns.push(`^${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/?$`);
        by.push("website link");
      } else if (!OUR_HOSTS.test(u.hostname)) offSite = u.hostname;
    } catch {
      /* ignore a bad link */
    }
  }
  const mls = (l.mlsNumber ?? "").replace(/\D/g, "");
  if (mls.length >= 6) {
    patterns.push(mls);
    by.push("MLS #");
  }
  const m = addressKey(l.address).match(/^(\d+[a-z]?) (?:([nsew]) )?([a-z0-9']+)$/);
  if (m?.[1] && m[3]) {
    const dirs: Record<string, string> = { n: "north", s: "south", e: "east", w: "west" };
    const dir = m[2] ? `(${m[2]}|${dirs[m[2]]})-` : "([nsew]-|north-|south-|east-|west-)?";
    patterns.push(`(^|[/-])${m[1]}-${dir}${m[3].replace(/'/g, "")}([-/]|$)`);
    by.push("address");
  }
  return { patterns, by, offSite };
}

const agentRow = (r: ListingAdRow) => ({ ...r, pages: r.pages ? (JSON.parse(r.pages) as { host: string; path: string; views: number }[]) : [] });

export async function forListing(actor: AuthUser, listingId: string) {
  const { listing: l, staff } = await manageableListing(actor, listingId);
  const rows = await repo.listForListing(listingId);
  return {
    rows: rows.map(agentRow),
    webMatch: matchInfo(l),
    webConnected: false, // Google Analytics comes with the integrations step
    // Street without the suffix, as agents should put it in campaign names ("2147 W Thomas").
    street: (l.address.split(",")[0] ?? "").replace(/\s+(st|street|ave|avenue|rd|road|blvd|dr|drive|ct|court|pl|place|ln|lane|pkwy|ter|way)\.?$/i, "").trim(),
    webRefreshing: false,
    staff,
  };
}

export async function saveAd(actor: AuthUser, listingId: string, channel: "meta" | "google" | "lofty", a: SaveAdInput) {
  await manageableListing(actor, listingId);
  const cur = await repo.findAd(listingId, channel);
  const email = actor.email.toLowerCase();
  if (cur && (cur.source === "meta" || cur.source === "google_ads")) {
    // Numbers come from the ads account; the agent only edits their own fields.
    return agentRow(
      await repo.upsertAd(listingId, channel, {
        ...cur,
        campaignRef: a.campaignRef ?? null,
        adLink: a.adLink ?? null,
        note: a.note ?? null,
        budget: a.budget ?? null,
        updatedByEmail: email,
      }),
    );
  }
  const row = await repo.upsertAd(listingId, channel, {
    status: a.status,
    startDate: a.startDate ?? null,
    endDate: a.endDate ?? null,
    reach: a.reach ?? null,
    clicks: a.clicks ?? null,
    leads: a.leads ?? null,
    spend: a.spend ?? null,
    budget: a.budget ?? null,
    campaignRef: a.campaignRef ?? null,
    adLink: a.adLink ?? null,
    note: a.note ?? null,
    source: "manual",
    error: null,
    updatedByEmail: email,
  });
  // A typed campaign name may match a Meta/Google campaign once those feeds are connected.
  if (channel !== "lofty" && row.campaignRef) await enqueue("paidAds.refresh", { listingId });
  return agentRow(row);
}

/** Seller page: results only. Spend, budget, campaign names and errors stay agent-only. */
export async function publicAds(listingId: string) {
  const rows = await repo.listForListing(listingId);
  return rows
    .filter(r => (r.channel === "website" ? (r.views ?? 0) > 0 : r.status !== "not_started"))
    .filter(r => !(r.source !== "manual" && r.channel !== "website" && r.status === "paused" && !(r.reach || r.clicks)))
    .sort((a, b) => CHANNEL_ORDER.indexOf(a.channel) - CHANNEL_ORDER.indexOf(b.channel))
    .map(r => ({
      channel: r.channel,
      status: r.channel === "website" ? "running" : r.status,
      startDate: r.startDate,
      endDate: r.endDate,
      reach: r.reach,
      views: r.views,
      clicks: r.clicks,
      leads: r.leads,
      adLink: r.adLink,
      note: r.note,
      auto: r.source !== "manual",
      source: r.source,
      updatedAt: r.updatedAt,
    }));
}

/** Running campaigns per listing (the Listings page badge). */
export async function runningCounts(listingIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const r of await repo.listForListings(listingIds)) {
    if (r.channel !== "website" && r.status === "running") out.set(r.listingId, (out.get(r.listingId) ?? 0) + 1);
  }
  return out;
}

/** Ad order went live: show the Meta card as running on the seller page. */
export async function markRunningFromOrder(listingId: string) {
  const cur = await repo.findAd(listingId, "meta");
  if (cur && cur.status !== "not_started") return;
  await repo.upsertAd(listingId, "meta", { status: "running", startDate: new Date().toISOString().slice(0, 10), source: "manual", updatedByEmail: "ad-order" });
}
