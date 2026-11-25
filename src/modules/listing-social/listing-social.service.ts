// Social video views for a listing's Instagram Reel, YouTube, TikTok and Facebook videos, read through
// the SpaceMatch Reels service (see its HUB_INTEGRATION.md). "Fetch" saves the links on the listing,
// syncs them to the Reels service, reads the views and fills this week's numbers (marked automatic).
import { config } from "../../config/index.js";
import { ReelsApiError, type ReelsAnalytics, reels } from "../../integrations/reels/reels.client.js";
import type { AuthUser } from "../../types/auth.js";
import { HttpError, serviceUnavailable } from "../../utils/http-error.js";
import { logger } from "../../utils/logger.js";
import { enqueue } from "../jobs/job.service.js";
import { getSetting, setSetting } from "../settings/setting.service.js";
import { applySocialViews, manageableListing, setSocialLinks } from "../listings/listing.service.js";
import * as repo from "./listing-social.repository.js";
import type { FetchInput, Platform } from "./listing-social.validation.js";

/** Listing link key for each platform (Instagram is the "Instagram Reel" link in Details). */
const LINK_KEY = { instagram: "reel", youtube: "youtube", tiktok: "tiktok", facebook: "facebook" } as const;
const ORDER: Platform[] = ["instagram", "youtube", "tiktok", "facebook"];

async function view(listingId: string, links: Record<string, string | undefined>) {
  const [social, stats] = await Promise.all([repo.findSocial(listingId), repo.listStats(listingId)]);
  return {
    connected: config.reels.isConfigured,
    links: Object.fromEntries(ORDER.map(p => [p, links[LINK_KEY[p]] ?? null])) as Record<Platform, string | null>,
    stats: ORDER.map(p => {
      const s = stats.find(r => r.platform === p);
      return s
        ? { platform: p, url: s.url, views: s.views, okAt: s.okAt, checkedAt: s.checkedAt, error: s.errorMessage, status: s.errorCode === "invalid_link" ? "invalid" : s.errorCode ? "stale" : s.okAt ? "ok" : "pending" }
        : { platform: p, url: null, views: null, okAt: null, checkedAt: null, error: null, status: "none" };
    }),
    lastSyncedAt: social?.lastSyncedAt ?? null,
    lastRefreshStatus: social?.lastRefreshStatus ?? null,
  };
}

export async function getSocial(actor: AuthUser, listingId: string) {
  const { listing } = await manageableListing(actor, listingId);
  return view(listingId, listing.links);
}

/** Turns a Reels "links[i]" error into a field error on the right link box. */
function linkError(e: ReelsApiError, sent: Platform[]): HttpError {
  const i = Number(e.field?.match(/links\[(\d+)\]/)?.[1]);
  const platform = Number.isInteger(i) ? sent[i] : undefined;
  return new HttpError(400, "validation_failed", e.message, platform ? [{ path: platform, message: e.message }] : undefined);
}

export async function saveAnalytics(listingId: string, a: ReelsAnalytics) {
  // One row per platform: the first link of each (the Hub keeps one link per platform).
  const rows = ORDER.flatMap(p => {
    const r = a.reels.find(x => x.platform === p);
    return r
      ? [{ linkId: r.link_id, platform: p, url: r.url, embedUrl: r.embed_url, views: r.views, likes: r.likes, comments: r.comments, shares: r.shares, okAt: r.ok_at ? new Date(r.ok_at) : null, checkedAt: r.checked_at ? new Date(r.checked_at) : null, errorCode: r.error?.code ?? null, errorMessage: r.error?.message ?? null }]
      : [];
  });
  await repo.replaceStats(listingId, rows);
  const views = (p: Platform) => rows.find(r => r.platform === p)?.views ?? null;
  await applySocialViews(listingId, { reel: views("instagram"), youtube: views("youtube"), tiktok: views("tiktok"), facebook: views("facebook") });
  await repo.upsertSocial(listingId, { reelsPropertyId: a.property_id, lastSyncedAt: new Date(), lastRefreshStatus: a.last_refresh?.status ?? null });
}

/** Saves the links on the listing (each box saves on its own; also the first step of Fetch). */
async function saveChosen(listingId: string, current: Record<string, string | undefined>, input: FetchInput) {
  const chosen = Object.fromEntries(ORDER.map(p => [p, input[p] === undefined ? (current[LINK_KEY[p]] ?? null) : input[p]])) as Record<Platform, string | null>;
  const updated = await setSocialLinks(listingId, { reel: chosen.instagram, youtube: chosen.youtube, tiktok: chosen.tiktok, facebook: chosen.facebook });
  return { chosen, updated };
}

/** Saves the video links without reading views (links stay until the agent changes them). */
export async function saveLinks(actor: AuthUser, listingId: string, input: FetchInput) {
  const { listing } = await manageableListing(actor, listingId);
  const { updated } = await saveChosen(listingId, listing.links, input);
  return view(listingId, updated.links);
}

export async function fetchStats(actor: AuthUser, listingId: string, input: FetchInput) {
  const { listing, address } = await manageableListing(actor, listingId);
  // Links are saved first, so they're kept even if reading the views fails.
  const { chosen, updated } = await saveChosen(listingId, listing.links, input);
  const sent = ORDER.filter(p => chosen[p]);
  const urls = sent.map(p => chosen[p]!);
  const social = await repo.findSocial(listingId);
  let notice: string | null = null;

  try {
    if (!urls.length) {
      // No links left: drop the property in the Reels service and clear the numbers.
      if (social?.reelsPropertyId) await reels.remove(social.reelsPropertyId).catch(e => logger.warn("reels: remove failed", { error: String(e) }));
      await repo.replaceStats(listingId, []);
      await repo.upsertSocial(listingId, { reelsPropertyId: null, lastRefreshStatus: null });
      return { ...(await view(listingId, updated.links)), notice: "Links cleared." };
    }

    let propertyId = social?.reelsPropertyId ?? null;
    let refreshId: string | null = null;
    let refreshStatus: string | null = null;
    if (!propertyId) {
      const created = await reels.createProperty(address, urls);
      propertyId = created.id;
      await repo.upsertSocial(listingId, { reelsPropertyId: propertyId });
      refreshId = created.refresh?.id ?? null;
      refreshStatus = created.refresh?.status ?? null;
    } else {
      try {
        const replaced = await reels.replaceLinks(propertyId, urls);
        const added = replaced.links.length && replaced.refresh ? replaced.refresh : null;
        // Links that were already there aren't read by a link change; read everything now.
        try {
          const r = await reels.refresh(propertyId, actor.email);
          refreshId = r.refresh.id;
          refreshStatus = r.refresh.status;
        } catch (e) {
          if (e instanceof ReelsApiError && e.status === 429) {
            notice = `Views were read less than 10 minutes ago. Showing the latest numbers${e.retryAfter ? `; try again in about ${Math.ceil(e.retryAfter / 60)} min` : ""}.`;
            refreshId = added?.id ?? null;
            refreshStatus = added?.status ?? null;
          } else throw e;
        }
      } catch (e) {
        // The property was deleted on the Reels side: start again with a new one.
        if (e instanceof ReelsApiError && e.status === 404) {
          const created = await reels.createProperty(address, urls);
          propertyId = created.id;
          await repo.upsertSocial(listingId, { reelsPropertyId: propertyId });
          refreshId = created.refresh?.id ?? null;
          refreshStatus = created.refresh?.status ?? null;
        } else throw e;
      }
    }
    // A refresh that ran out of time is finished by polling it (each poll reads more links).
    for (let i = 0; refreshId && refreshStatus === "running" && i < 3; i++) refreshStatus = (await reels.getRefresh(refreshId)).status;
    if (refreshStatus === "running") notice = "Some links are still being read. Tap Fetch again in a minute for the rest.";

    await saveAnalytics(listingId, await reels.analytics(propertyId));
    return { ...(await view(listingId, updated.links)), notice };
  } catch (e) {
    if (e instanceof ReelsApiError) {
      if ((e.status === 409 || e.status === 422) && e.field) throw linkError(e, sent);
      if (e.status === 409 || e.status === 422) throw new HttpError(400, "bad_request", e.message);
      if (e.status === 401 || e.status === 403) {
        throw serviceUnavailable(`Links saved, but the social stats service refused the request: ${e.message}${config.reels.key ? "" : " (no REELS_API_KEY is set)"}`);
      }
      throw serviceUnavailable(`The social stats service had a problem: ${e.message}`);
    }
    throw e;
  }
}

// ---------- Listing lifecycle (kept in step with the Reels service) ----------

const OFF_MARKET = ["Closed", "Withdrawn"];

/** Sold/withdrawn: archive the property (stops its daily reads, keeps history). Back on market: unarchive. */
export async function onListingStatus(listingId: string, from: string, to: string) {
  const social = await repo.findSocial(listingId);
  const propertyId = social?.reelsPropertyId;
  if (!propertyId) return;
  const action = OFF_MARKET.includes(to) && !OFF_MARKET.includes(from) ? "archive" : !OFF_MARKET.includes(to) && OFF_MARKET.includes(from) ? "unarchive" : null;
  if (!action) return;
  try {
    await reels[action](propertyId);
  } catch (e) {
    // Try again from the job runner (the Reels service may be waking up or down).
    logger.warn(`reels: ${action} failed, queued`, { propertyId, error: String(e) });
    await enqueue(`reels.${action}`, { propertyId });
  }
}

/** Listing deleted: remove its property so its videos can be linked to another listing. */
export async function onListingDeleted(listingId: string) {
  const propertyId = (await repo.findSocial(listingId))?.reelsPropertyId;
  if (!propertyId) return;
  try {
    await reels.remove(propertyId, true);
  } catch (e) {
    if (e instanceof ReelsApiError && e.status === 404) return;
    logger.warn("reels: remove failed, queued", { propertyId, error: String(e) });
    await enqueue("reels.remove", { propertyId });
  }
}

/** Job handler: retry an archive / unarchive / remove that failed. 404 = already gone, done. */
export async function retryReelsAction(action: "archive" | "unarchive" | "remove", propertyId: string) {
  try {
    if (action === "remove") await reels.remove(propertyId, true);
    else await reels[action](propertyId);
  } catch (e) {
    if (e instanceof ReelsApiError && (e.status === 404 || (e.status === 409 && action !== "remove"))) return;
    throw e;
  }
}

/** Daily: the Reels service re-reads every property each morning; copy what changed since the last sync. */
export async function dailySync() {
  const started = new Date();
  const since = await getSetting<string>("reels:lastDailySyncAt", new Date(Date.now() - 48 * 36e5).toISOString());
  let cursor: string | undefined;
  let synced = 0;
  do {
    const page = await reels.analyticsSince(since, cursor);
    for (const a of page.items) {
      const social = await repo.findByProperty(a.property_id);
      if (!social) continue; // a property the Hub doesn't know (e.g. made in the Reels dashboard)
      await saveAnalytics(social.listingId, a);
      synced++;
    }
    cursor = page.next_cursor ?? undefined;
  } while (cursor);
  await setSetting("reels:lastDailySyncAt", started.toISOString(), "cron");
  return { synced };
}
