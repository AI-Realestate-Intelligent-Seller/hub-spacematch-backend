// YouTube Data API v3 with an API key (public data only: the channel's uploads and view counts).
// Quota: playlistItems.list and videos.list cost 1 unit each (10,000 free units a day).
import { config } from "../../config/index.js";

const BASE = "https://www.googleapis.com/youtube/v3";

export class YoutubeError extends Error {}

async function get<T>(path: string, params: Record<string, string>): Promise<T> {
  if (!config.youtube.key) throw new YoutubeError("YOUTUBE_API_KEY is not set");
  const url = new URL(`${BASE}/${path}`);
  url.search = new URLSearchParams({ ...params, key: config.youtube.key }).toString();
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  const body = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  // Never include the URL in errors: it carries the key.
  if (!res.ok) throw new YoutubeError(`YouTube ${path} failed (HTTP ${res.status}): ${body.error?.message ?? "no details"}`);
  return body;
}

export type Upload = { id: string; title: string; publishedAt: string };

/** The newest uploads of the brokerage channel (newest first, up to 50). */
export async function recentUploads(playlistId = config.youtube.uploadsPlaylist): Promise<Upload[]> {
  type R = { items?: { snippet?: { title?: string; resourceId?: { videoId?: string } }; contentDetails?: { videoId?: string; videoPublishedAt?: string } }[] };
  const r = await get<R>("playlistItems", { playlistId, part: "snippet,contentDetails", maxResults: "50" });
  return (r.items ?? [])
    .map(i => ({ id: i.contentDetails?.videoId ?? i.snippet?.resourceId?.videoId ?? "", title: i.snippet?.title ?? "", publishedAt: i.contentDetails?.videoPublishedAt ?? "" }))
    .filter(i => i.id)
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

/** Title and lifetime view count for up to 50 videos. Missing / private videos are left out. */
export async function videoStats(ids: string[]): Promise<Map<string, { title: string; views: number }>> {
  const out = new Map<string, { title: string; views: number }>();
  for (let i = 0; i < ids.length; i += 50) {
    type R = { items?: { id: string; snippet?: { title?: string }; statistics?: { viewCount?: string } }[] };
    const r = await get<R>("videos", { id: ids.slice(i, i + 50).join(","), part: "snippet,statistics" });
    for (const v of r.items ?? []) {
      const views = Number(v.statistics?.viewCount);
      if (Number.isFinite(views)) out.set(v.id, { title: v.snippet?.title ?? "", views });
    }
  }
  return out;
}

/** Video id from any YouTube URL form (shorts, watch, embed, live, youtu.be). */
export const videoId = (url?: string | null) => url?.match(/(?:youtube\.com\/(?:shorts\/|watch\?(?:.*&)?v=|embed\/|live\/)|youtu\.be\/)([\w-]{11})/i)?.[1];

/** "2147 W Thomas St" → matches "2147 W Thomas", "2147 West Thomas", "2147 Thomas" in a title. */
export function streetRegex(address: string): RegExp | null {
  const m = address.toLowerCase().match(/^\s*(\d+[a-z]?)\s+(?:(n|s|e|w|north|south|east|west)\.?\s+)?([a-z0-9']+)/);
  if (!m || m[3]!.length < 3) return null;
  const dir = "(?:(?:n|s|e|w|north|south|east|west)\\.?\\s+)?";
  return new RegExp(`\\b${m[1]}\\s+${dir}${m[3]!.replace(/'/g, "'?")}\\b`, "i");
}
