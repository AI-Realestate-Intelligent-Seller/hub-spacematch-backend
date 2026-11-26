// Scheduled tasks (Vercel Cron calls GET /api/v1/cron/<task>; see vercel.json for the times).
import { recoverStale, runWeeklyRefresh } from "../modules/cma-builder/cma-builder.jobs.js";
import { runDueJobs } from "../modules/jobs/job.service.js";
import { dailySync } from "../modules/listing-social/listing-social.service.js";
import { runMondayReminders, runSellerWeekly, runTuesdayNudge } from "../modules/listings/listing.service.js";
import { syncUnlinkedListings } from "../modules/listings/listing.lofty.js";
import { refreshYoutube } from "../modules/listings/listing.youtube.js";
import { jobHandlers } from "./handlers.js";

export const TASKS: Record<string, () => Promise<unknown>> = {
  /** Every 10 minutes: queued follow-up work. */
  "run-jobs": () => runDueJobs(jobHandlers),
  /** Daily ~10am Chicago (after the Reels service's 7am read): copy social video views, then match
   *  and read YouTube Shorts from the brokerage channel (a YouTube failure doesn't undo the Reels sync). */
  "social-daily": async () => {
    const reels = await dailySync();
    const youtube = await refreshYoutube().catch(e => ({ error: String(e) }));
    return { reels, youtube };
  },
  /** Monday ~9am Chicago: agents' "this week's numbers" reminder. */
  "monday-reminders": () => runMondayReminders(),
  /** Tuesday ~10am Chicago: ops get listings still missing numbers. */
  "tuesday-nudge": () => runTuesdayNudge(),
  /** Monday ~5pm Chicago: weekly report to sellers who switched it on. */
  "seller-weekly": () => runSellerWeekly(),
  /** Sunday ~9pm Chicago: new draft CMA versions for live listings (agents review; never auto-published). */
  "cma-weekly-refresh": () => runWeeklyRefresh(),
  /** Manual only (not in vercel.json): look up every listing's seller in Lofty (read-only), e.g. after adding the key. */
  "lofty-sync-unlinked": () => syncUnlinkedListings(),
  /** Hourly: CMA collections stuck by a crashed worker go back to the queue (or fail after 3 tries). */
  "cma-recover": () => recoverStale(),
};
