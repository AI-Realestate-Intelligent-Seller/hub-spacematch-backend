// What each queued job kind does. Kinds not listed here (Lofty, Zillow, Meta Ads, Google Analytics,
// YouTube/Instagram auto-matching, listing plans, push) wait in the jobs table until their connector
// is built; nothing is lost.
import type { JobHandler } from "../modules/jobs/job.service.js";
import { retryReelsAction } from "../modules/listing-social/listing-social.service.js";
import { notifyFeedbackToReview, sendPlanApprovedMail } from "../modules/listings/listing.service.js";

const str = (v: unknown) => (typeof v === "string" ? v : "");

export const jobHandlers: Record<string, JobHandler> = {
  // Reels service calls that failed when the listing changed (retried here).
  "reels.archive": p => retryReelsAction("archive", str(p.propertyId)),
  "reels.unarchive": p => retryReelsAction("unarchive", str(p.propertyId)),
  "reels.remove": p => retryReelsAction("remove", str(p.propertyId)),
  // Emails queued by earlier code (now sent straight away; kept for jobs already in the table).
  "listingMail.planApproved": p => sendPlanApprovedMail(str(p.listingId), Array.isArray(p.titles) ? p.titles.map(String) : []),
  "listingMail.feedbackToReview": p => notifyFeedbackToReview(str(p.listingId)),
};
