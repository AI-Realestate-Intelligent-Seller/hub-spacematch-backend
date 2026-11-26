// Listing → the seller's existing Lofty contact, READ-ONLY (policy 2026-11-26: the Hub never writes to
// Michael's CRM). Viktor used to create/tag leads and add notes (convex/lofty.ts syncListingSeller); now
// we only look the seller up by email, then phone, and remember the Lofty lead id on the listing.
// Nothing is created, tagged or noted in Lofty. The outcome (lead id or a readable reason) is stored on
// the listing and shown in its "Lofty" row.
import { config } from "../../config/index.js";
import { findLead, LoftyError } from "../../integrations/lofty/lofty.client.js";
import { logger } from "../../utils/logger.js";
import type { ListingRow } from "./listing.model.js";
import * as repo from "./listing.repository.js";

type Outcome = { status: "gone" | "no-contact" | "off" | "test" | "linked" | "own-contact" | "found" | "not-found" | "error"; leadId?: number | string; error?: string };

const record = (id: string, v: { leadId?: string | null; error: string | null }) =>
  repo.updateListing(id, { ...(v.leadId !== undefined ? { loftyLeadId: v.leadId } : {}), loftyError: v.error, loftyAt: new Date() });

/** The seller email is a placeholder: the agent's own address or a SpaceMatch one. */
const isOwnContact = (l: ListingRow) => {
  const e = (l.sellerEmail ?? "").trim().toLowerCase();
  return !!e && (e === l.agentEmail.trim().toLowerCase() || e.endsWith("@spacematchinc.com"));
};

/** Job "lofty.syncListingSeller" (kind kept for jobs already queued) and the "Look up" button. */
export async function syncListingSeller(listingId: string, force = false): Promise<Outcome> {
  const l = await repo.findListingById(listingId);
  if (!l) return { status: "gone" };
  if (!l.sellerEmail && !l.sellerPhone) return { status: "no-contact" };
  if (!config.lofty.isConfigured) {
    await record(l.id, { error: "Lofty isn't connected to this Hub yet." });
    return { status: "off" };
  }
  if (l.sellerEmail?.toLowerCase().endsWith("@example.com") && !l.sellerPhone) {
    await record(l.id, { error: "Test listing (example.com email), not looked up in Lofty." });
    return { status: "test" };
  }
  if (l.loftyLeadId && !force) return { status: "linked", leadId: l.loftyLeadId };
  if (isOwnContact(l) && !l.sellerPhone) {
    await record(l.id, { error: "The seller email is the agent's own address. Add the seller's real email or phone to find them in Lofty." });
    return { status: "own-contact" };
  }

  try {
    const email = isOwnContact(l) || l.sellerEmail?.toLowerCase().endsWith("@example.com") ? null : l.sellerEmail;
    const found = await findLead(email, l.sellerPhone);
    if (found?.id) {
      await record(l.id, { leadId: String(found.id), error: null });
      return { status: "found", leadId: found.id };
    }
    await record(l.id, { leadId: null, error: "No Lofty contact has this seller's email or phone." });
    return { status: "not-found" };
  } catch (e) {
    const err = e instanceof LoftyError ? e : null;
    // Network trouble / Lofty 5xx: let the job runner retry.
    if (!err || (err.status ?? 0) >= 500) throw e;
    const friendly = err.isAuth ? "Lofty refused the API key (regenerate it in Lofty → Settings → API)." : err.message.slice(0, 300);
    logger.warn("lofty: seller lookup failed", { listingId, status: err.status, error: err.message.slice(0, 300) });
    await record(l.id, { error: friendly });
    return { status: "error", error: friendly };
  }
}

/** Manual: look up every listing with a seller email or phone that has no Lofty match yet. */
export async function syncUnlinkedListings() {
  const rows = (await repo.listByStatus(["Preparing", "Coming soon", "Active", "Under contract", "Closed", "Withdrawn"])).filter(l => !l.loftyLeadId && (l.sellerEmail || l.sellerPhone));
  const out: Record<string, number> = {};
  for (const l of rows) {
    const r = await syncListingSeller(l.id).catch(e => ({ status: "error", error: String(e) }) as Outcome);
    out[r.status] = (out[r.status] ?? 0) + 1;
  }
  return { listings: rows.length, ...out };
}
