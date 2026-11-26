// YouTube Short views for listings, read from the brokerage channel (@spacematchinc) with the YouTube
// Data API (was convex/youtube.ts). Plain code, no AI.
//  - A listing with no YouTube link: the newest upload whose title names the street ("2147 W Thomas")
//    is linked to it, and its views fill this week's numbers (marked automatic).
//  - A link the agent typed is never replaced; its views come from the Reels service ("Fetch").
//  - A link this file added keeps getting fresh views here.
import { config } from "../../config/index.js";
import { recentUploads, streetRegex, videoId, videoStats } from "../../integrations/youtube/youtube.client.js";
import { logger } from "../../utils/logger.js";
import type { ListingRow } from "./listing.model.js";
import * as repo from "./listing.repository.js";
import { applySocialViews } from "./listing.service.js";

const LIVE = ["Preparing", "Coming soon", "Active", "Under contract"];

type Match = { id: string; by: "auto-link" | "title" };

function matchVideo(l: ListingRow, uploads: { id: string; title: string }[]): Match | null {
  const link = l.links.youtube;
  if (link) {
    // Ours (added by an earlier match): keep reading it. The agent's own link: leave it to Reels.
    const id = videoId(link);
    return id && l.ytAuto?.url === link ? { id, by: "auto-link" } : null;
  }
  const re = streetRegex(l.address);
  const hit = re && uploads.find(u => re.test(u.title)); // newest first
  return hit ? { id: hit.id, by: "title" } : null;
}

/** One listing (job "youtube.refresh") or every live listing (daily). Quietly skips without a key. */
export async function refreshYoutube(listingId?: string) {
  const tally = { listings: 0, matched: 0, unmatched: 0, skipped: false };
  if (!config.youtube.isConfigured) {
    logger.info("YouTube refresh skipped: YOUTUBE_API_KEY is not set");
    return { ...tally, skipped: true };
  }
  const rows = listingId ? [await repo.findListingById(listingId)].filter((l): l is ListingRow => !!l && LIVE.includes(l.status)) : await repo.listByStatus(LIVE);
  tally.listings = rows.length;
  if (!rows.length) return tally;

  const uploads = await recentUploads();
  const hits = rows.map(l => ({ l, hit: matchVideo(l, uploads) }));
  const ids = [...new Set(hits.flatMap(h => (h.hit ? [h.hit.id] : [])))];
  const stats = ids.length ? await videoStats(ids) : new Map();
  const checkedAt = new Date().toISOString();

  for (const { l, hit } of hits) {
    const v = hit && stats.get(hit.id);
    if (!hit || !v) {
      tally.unmatched++;
      continue;
    }
    const url = l.links.youtube ?? `https://www.youtube.com/shorts/${hit.id}`;
    await repo.updateListing(l.id, {
      ytAuto: { videoId: hit.id, url, title: v.title, views: v.views, matchedBy: hit.by === "title" ? "title" : (l.ytAuto?.matchedBy ?? "title"), checkedAt },
      ...(l.links.youtube ? {} : { links: { ...l.links, youtube: url } }),
    });
    await applySocialViews(l.id, { youtube: v.views });
    tally.matched++;
  }
  logger.info("YouTube refresh", tally);
  return tally;
}
