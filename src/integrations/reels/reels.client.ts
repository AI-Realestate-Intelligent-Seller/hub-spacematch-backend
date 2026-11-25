// Client for the SpaceMatch Reels service (social video counters). Follows its HUB_INTEGRATION.md:
// Bearer key, 300 s timeout on calls that read links, retries only network errors / 5xx / short 429s,
// Idempotency-Key on create and refresh. The key never leaves the server.
import { randomUUID } from "node:crypto";
import { config } from "../../config/index.js";
import { serviceUnavailable } from "../../utils/http-error.js";
import { logger } from "../../utils/logger.js";

export class ReelsApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public field: string | null,
    public requestId: string | null,
    public retryAfter: number | null,
  ) {
    super(message);
    this.name = "ReelsApiError";
  }
}

export type ReelsLink = { id: string; platform: string; url: string; canonical_url: string; embed_url: string | null; status: string };
export type ReelsRefresh = { id: string; property_id: string; status: string; links?: { link_id: string; status: string; error: { code: string; message: string } | null }[] };
export type ReelsReel = {
  link_id: string;
  platform: "instagram" | "facebook" | "tiktok" | "youtube";
  url: string;
  canonical_url: string;
  embed_url: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  checked_at: string | null;
  ok_at: string | null;
  error: { code: string; message: string } | null;
};
export type ReelsAnalytics = { property_id: string; last_refresh: ReelsRefresh | null; reels: ReelsReel[] };

const LONG = 300_000; // calls that read links inside the request
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function call<T>(method: string, path: string, body?: unknown, idemKey?: string, timeoutMs = 15_000): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${config.reels.url}${path}`, {
        method,
        headers: {
          // The key is optional: sent only when REELS_API_KEY is set (some deployments don't require one).
          ...(config.reels.key ? { Authorization: `Bearer ${config.reels.key}` } : {}),
          "Content-Type": "application/json",
          ...(idemKey ? { "Idempotency-Key": idemKey } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      if (attempt < 3) {
        await sleep(1000 * 4 ** (attempt - 1));
        continue;
      }
      logger.error("reels: request failed", { method, path, error: String(e) });
      throw serviceUnavailable("The social stats service didn't answer. Try again in a minute.");
    }
    if (res.status === 204) return undefined as T;
    const json = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string; field?: string } };
    if (res.ok) return json as T;
    const retryable = res.status === 429 || res.status >= 500;
    const retryAfter = Number(res.headers.get("Retry-After")) || null;
    if (retryable && attempt < 3) {
      const wait = retryAfter ?? 4 ** (attempt - 1);
      if (wait <= 30) {
        await sleep(wait * 1000);
        continue;
      }
    }
    const err = json.error ?? {};
    const requestId = res.headers.get("X-Request-Id");
    if (res.status >= 500 || res.status === 401 || res.status === 403) logger.error("reels: error", { method, path, status: res.status, code: err.code, requestId });
    throw new ReelsApiError(res.status, err.code ?? "internal", err.message ?? res.statusText, err.field ?? null, requestId, retryAfter);
  }
}

export const reels = {
  createProperty: (address: string, links: string[]) =>
    call<{ id: string; links: ReelsLink[]; refresh: ReelsRefresh | null }>("POST", "/properties", { address, links }, randomUUID(), LONG),
  replaceLinks: (id: string, links: string[]) =>
    call<{ property_id: string; links: ReelsLink[]; refresh: ReelsRefresh | null }>("PUT", `/properties/${id}/links`, { links }, undefined, LONG),
  updateAddress: (id: string, address: string) => call<unknown>("PATCH", `/properties/${id}`, { address }),
  refresh: (id: string, requestedBy: string) => call<{ refresh: ReelsRefresh }>("POST", `/properties/${id}/refresh`, { requested_by: requestedBy }, randomUUID(), LONG),
  getRefresh: (refreshId: string) => call<ReelsRefresh>("GET", `/refreshes/${refreshId}`, undefined, undefined, LONG),
  analytics: (id: string) => call<ReelsAnalytics>("GET", `/properties/${id}/analytics`),
  /** Analytics for properties read after `since` (daily sync), a page at a time. */
  analyticsSince: (since: string, cursor?: string) =>
    call<{ items: ReelsAnalytics[]; next_cursor: string | null }>("GET", `/analytics?updated_since=${encodeURIComponent(since)}&limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`),
  archive: (id: string) => call<unknown>("POST", `/properties/${id}/archive`),
  unarchive: (id: string) => call<unknown>("POST", `/properties/${id}/unarchive`),
  remove: (id: string, hard = false) => call<void>("DELETE", `/properties/${id}${hard ? "?hard=true" : ""}`),
};
