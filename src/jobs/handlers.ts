// What each queued job kind does. Kinds not listed here (Zillow, Meta/Google Ads, Google Analytics,
// listing plans) wait in the jobs table until their connector is built;
// nothing is lost.
import { runCollect, runRenderPdf } from "../modules/cma-builder/cma-builder.jobs.js";
import { JOB_COLLECT, JOB_RENDER_PDF } from "../modules/cma-builder/cma-builder.service.js";
import { pushAnnouncement, pushToEmail } from "../modules/announcements/announcement.service.js";
import { notifyFormReceived } from "../modules/forms/form.mail.js";
import type { JobHandler } from "../modules/jobs/job.service.js";
import { retryReelsAction, syncListingJob } from "../modules/listing-social/listing-social.service.js";
import { notifyFeedbackToReview, sendPlanApprovedMail } from "../modules/listings/listing.service.js";
import { syncListingSeller } from "../modules/listings/listing.lofty.js";
import { refreshYoutube } from "../modules/listings/listing.youtube.js";

const str = (v: unknown) => (typeof v === "string" ? v : "");

export const jobHandlers: Record<string, JobHandler> = {
  "forms.received": p => notifyFormReceived(str(p.submissionId)),
  // Reels service calls that failed when the listing changed (retried here).
  "reels.archive": p => retryReelsAction("archive", str(p.propertyId)),
  "reels.unarchive": p => retryReelsAction("unarchive", str(p.propertyId)),
  "reels.remove": p => retryReelsAction("remove", str(p.propertyId)),
  // A listing's video links changed (or it was created): sync them to the Reels service and copy views.
  "reels.refresh": p => syncListingJob(str(p.listingId)),
  // Emails queued by earlier code (now sent straight away; kept for jobs already in the table).
  "listingMail.planApproved": p => sendPlanApprovedMail(str(p.listingId), Array.isArray(p.titles) ? p.titles.map(String) : []),
  "listingMail.feedbackToReview": p => notifyFeedbackToReview(str(p.listingId)),
  // CMA Builder collection with providers that don't need a browser (RentCast). Browser collection
  // ("cmaBuilder.collectBrowser") runs only in the worker.
  [JOB_COLLECT]: runCollect,
  // CMA PDF/PowerPoint: normally rendered in the request; this retries one that failed there.
  [JOB_RENDER_PDF]: runRenderPdf,

  // Web Push to phones/browsers that turned notifications on (skipped while VAPID keys are unset).
  "push.announce": async p => void (await pushAnnouncement(str(p.announcementId))),
  "push.toEmail": async p => void (await pushToEmail(str(p.email), { title: str(p.title), body: str(p.body), url: str(p.url) || "/" })),

  // Find the listing's seller among the Lofty leads (read-only; never writes to Lofty).
  "lofty.syncListingSeller": async p => void (await syncListingSeller(str(p.listingId), p.force === true)),

  // The listing's YouTube Short: auto-match by street name and read views (skipped without a key).
  "youtube.refresh": async p => void (await refreshYoutube(str(p.listingId) || undefined)),
};
