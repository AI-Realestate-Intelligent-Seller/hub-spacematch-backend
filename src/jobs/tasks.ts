// Scheduled tasks (Vercel Cron calls GET /api/v1/cron/<task>; see vercel.json for the times).
import { runDueJobs } from "../modules/jobs/job.service.js";
import { dailySync } from "../modules/listing-social/listing-social.service.js";
import { runMondayReminders, runSellerWeekly, runTuesdayNudge } from "../modules/listings/listing.service.js";
import { jobHandlers } from "./handlers.js";

export const TASKS: Record<string, () => Promise<unknown>> = {
  /** Every 10 minutes: queued follow-up work. */
  "run-jobs": () => runDueJobs(jobHandlers),
  /** Daily ~10am Chicago (after the Reels service's 7am read): copy social video views. */
  "social-daily": () => dailySync(),
  /** Monday ~9am Chicago: agents' "this week's numbers" reminder. */
  "monday-reminders": () => runMondayReminders(),
  /** Tuesday ~10am Chicago: ops get listings still missing numbers. */
  "tuesday-nudge": () => runTuesdayNudge(),
  /** Monday ~5pm Chicago: weekly report to sellers who switched it on. */
  "seller-weekly": () => runSellerWeekly(),
};
