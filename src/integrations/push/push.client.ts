// Web Push sender (VAPID). Keys come from VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY; generate them once with
// `npx web-push generate-vapid-keys`. Without keys nothing is sent (callers log and move on).
import webpush from "web-push";
import { config } from "../../config/index.js";
import { logger } from "../../utils/logger.js";

export type PushTarget = { endpoint: string; p256dh: string; auth: string };
export type PushMessage = { title: string; body: string; url: string };

let ready = false;
function init() {
  if (ready) return true;
  if (!config.push.isConfigured) return false;
  webpush.setVapidDetails(config.push.subject, config.push.publicKey!, config.push.privateKey!);
  ready = true;
  return true;
}

/**
 * Sends one notification to each device. Returns how many were delivered and the endpoints the push
 * service says no longer exist (404/410), which the caller should delete. Other failures are logged.
 */
export async function sendPush(targets: PushTarget[], msg: PushMessage, ttlSeconds: number): Promise<{ sent: number; gone: string[]; configured: boolean }> {
  if (!init()) return { sent: 0, gone: [], configured: false };
  const payload = JSON.stringify({ title: msg.title.slice(0, 90), body: msg.body.slice(0, 180), url: msg.url });
  let sent = 0;
  const gone: string[] = [];
  await Promise.all(
    targets.map(async t => {
      try {
        await webpush.sendNotification({ endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } }, payload, { TTL: ttlSeconds, timeout: 10_000 });
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) gone.push(t.endpoint);
        else logger.warn("Push delivery failed", { status: code, host: safeHost(t.endpoint), error: (e as Error).message });
      }
    }),
  );
  return { sent, gone, configured: true };
}

const safeHost = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return "invalid";
  }
};
