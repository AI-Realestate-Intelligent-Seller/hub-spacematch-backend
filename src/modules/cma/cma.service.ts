// CMA request rules (was convex/cma.ts + cmaWorker.ts). Agents submit (2 per agent / 40 per team
// each month; over the limit goes to an admin), edit afterwards (a finished CMA goes back for a
// rebuild) and can set their own list price. The CMA builder works through /cma-worker/*.
import { objectSize, signedDownloadUrl, signedUploadUrl } from "../../integrations/storage/storage.client.js";
import { normalizeAddressFields } from "../../shared/address.js";
import type { AuthUser } from "../../types/auth.js";
import { badRequest, conflict, forbidden, notFound } from "../../utils/http-error.js";
import { newId } from "../../utils/id.js";
import { listEmailsByRoles } from "../users/user.service.js";
import { mailApprovalNeeded } from "./cma.mail.js";
import type { CmaAttachment, CmaRequestRow } from "./cma.model.js";
import * as repo from "./cma.repository.js";
import type { RequestInput } from "./cma.validation.js";

export const AGENT_CAP = 2;
export const TEAM_CAP = 40;
const isAdmin = (u: AuthUser) => u.role === "admin";
const emailOf = (u: AuthUser) => u.email.toLowerCase();
const uploadPrefix = (u: AuthUser) => `cma-uploads/${u.id}/`;

/** First instant of this month in Chicago (approx. UTC-5, as before). */
export function monthStart(now = Date.now()) {
  const d = new Date(now - 5 * 3600_000);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) + 5 * 3600_000);
}

/** New builds this month (approvals waiting and declined ones don't count). */
async function cmaQuota(agentName?: string) {
  const rows = await repo.listSince(monthStart());
  const counted = rows.filter(r => r.status !== "approval" && !(r.status === "failed" && r.statusNote?.startsWith("Declined")));
  return {
    agentUsed: agentName ? counted.filter(r => r.agentName === agentName).length : 0,
    agentCap: AGENT_CAP,
    teamUsed: counted.length,
    teamCap: TEAM_CAP,
    pendingApproval: rows.filter(r => r.status === "approval").length,
  };
}

/** The request with temporary download links for its files. */
async function withUrls(r: CmaRequestRow) {
  const link = (key: string | null) => (key ? signedDownloadUrl(key).catch(() => null) : Promise.resolve(null));
  const [attachments, pdfUrl, workbookUrl] = await Promise.all([
    Promise.all(r.attachments.map(async a => ({ ...a, url: await link(a.storageId) }))),
    link(r.pdfKey),
    link(r.workbookKey),
  ]);
  return { ...r, attachments, pdfUrl, workbookUrl };
}

async function editable(actor: AuthUser, id: string) {
  const r = await repo.findRequest(id);
  if (!r || !(isAdmin(actor) || r.userId === actor.id || r.submittedByEmail === emailOf(actor))) throw notFound("Request not found.");
  return r;
}

/** Uploaded files must be ones this person uploaded (or already on the request), and actually stored. */
async function checkAttachments(actor: AuthUser, files: CmaAttachment[], existing: CmaAttachment[] = []) {
  const known = new Set(existing.map(a => a.storageId));
  for (const f of files) {
    if (known.has(f.storageId)) continue;
    if (!f.storageId.startsWith(uploadPrefix(actor))) throw badRequest(`"${f.name}" couldn't be attached. Add it again.`);
    if ((await objectSize(f.storageId)) === null) throw badRequest(`"${f.name}" didn't finish uploading. Add it again.`);
  }
}

/** Form values → row values (address tidied the same way as before; blanks become null). */
function toRow(raw: RequestInput) {
  const a = normalizeAddressFields({ ...raw, unit: raw.unit ?? undefined });
  const nil = <T>(v: T | undefined) => (v === undefined ? null : v);
  return {
    reportType: a.reportType,
    kind: a.kind,
    lease: nil(a.lease),
    investor: nil(a.investor),
    commercial: nil(a.commercial),
    attachments: a.attachments,
    agentName: a.agentName,
    agentEmail: a.agentEmail,
    agentPhone: nil(a.agentPhone),
    clientName: a.clientName,
    clientEmail: nil(a.clientEmail),
    clientPhone: nil(a.clientPhone),
    street: a.street,
    unit: a.unit || null,
    city: a.city,
    state: a.state,
    zip: a.zip,
    propertyType: a.propertyType,
    beds: nil(a.beds),
    bathsFull: nil(a.bathsFull),
    bathsHalf: nil(a.bathsHalf),
    sqft: nil(a.sqft),
    yearBuilt: nil(a.yearBuilt),
    basement: nil(a.basement),
    garage: nil(a.garage),
    hoaDues: nil(a.hoaDues),
    condition: a.condition,
    upgrades: a.upgrades,
    otherUpgrades: nil(a.otherUpgrades),
    knownIssues: nil(a.knownIssues),
    sellerPriceExpectation: nil(a.sellerPriceExpectation),
    timeline: nil(a.timeline),
    purpose: a.purpose,
    neededBy: nil(a.neededBy),
    branding: a.branding,
    schools: a.kind === "commercial" ? null : nil(a.schools),
    compNotes: nil(a.compNotes),
    notes: nil(a.notes),
  };
}
type RowValues = ReturnType<typeof toRow>;

const FIELD_LABELS: Record<string, string> = {
  reportType: "Sale / lease", lease: "Lease details", investor: "Investor numbers", kind: "Residential / commercial",
  commercial: "Building facts & income", attachments: "Documents", agentName: "Agent", clientName: "Client name",
  clientEmail: "Client email", clientPhone: "Client phone", street: "Street", unit: "Unit", city: "City", zip: "ZIP",
  propertyType: "Property type", beds: "Bedrooms", bathsFull: "Full baths", bathsHalf: "Half baths", sqft: "Square feet",
  yearBuilt: "Year built", basement: "Basement", garage: "Garage", hoaDues: "HOA dues", condition: "Condition",
  upgrades: "Upgrades", otherUpgrades: "Other upgrades", knownIssues: "Known issues", sellerPriceExpectation: "Price expectation",
  timeline: "Timeline", purpose: "Purpose", neededBy: "Needed by", branding: "Branding", schools: "Schools",
  compNotes: "Comp preferences", notes: "Notes",
};

// ---------- Agent side ----------

export function me(actor: AuthUser) {
  return { name: actor.name, email: emailOf(actor), isAdmin: isAdmin(actor) };
}

export async function quota(actor: AuthUser, agentName?: string) {
  const name = agentName || actor.name || undefined;
  return { ...(await cmaQuota(name)), agentName: name ?? null, isAdmin: isAdmin(actor) };
}

export async function list(actor: AuthUser) {
  const rows = isAdmin(actor) ? await repo.listAll() : await repo.listForUser(actor.id, emailOf(actor));
  return { items: await Promise.all(rows.map(withUrls)) };
}

export async function get(actor: AuthUser, id: string) {
  return withUrls(await editable(actor, id));
}

/** A link the browser uploads one file to; the returned key goes in the request's attachments. */
export async function createUpload(actor: AuthUser, f: { name: string; size: number; contentType: string }) {
  const safe = f.name.replace(/[^\w.-]+/g, "_").slice(-120);
  const key = `${uploadPrefix(actor)}${newId()}-${safe}`;
  return { key, uploadUrl: await signedUploadUrl(key, f.contentType), contentType: f.contentType };
}

export async function submit(actor: AuthUser, input: RequestInput) {
  await checkAttachments(actor, input.attachments);
  const values = toRow(input);
  const q = await cmaQuota(values.agentName);
  const overCap = !isAdmin(actor) && (q.agentUsed >= q.agentCap || q.teamUsed >= q.teamCap);
  const r = await repo.insertRequest({
    ...values,
    userId: actor.id,
    submittedByEmail: emailOf(actor),
    status: overCap ? "approval" : "submitted",
    statusNote: overCap
      ? q.teamUsed >= q.teamCap
        ? `Team limit reached (${q.teamCap} CMAs this month). Sent to an admin for approval.`
        : `${values.agentName} has used ${q.agentUsed} of ${q.agentCap} CMAs this month. Sent to an admin for approval.`
      : null,
  });
  if (overCap) await mailApprovalNeeded(r, await listEmailsByRoles(["admin"]));
  return { id: r.id, status: r.status, statusNote: r.statusNote };
}

const norm = (v: unknown) => JSON.stringify(v ?? null);
const short = (x: unknown) => {
  if (x === undefined || x === null || x === "") return "";
  const t = typeof x === "string" ? x : JSON.stringify(x);
  return t.length > 1500 ? `${t.slice(0, 1500)}…` : t;
};

/** Agent fixes or adds details. Queued requests just update; finished ones go back for a rebuild. */
export async function update(actor: AuthUser, id: string, input: RequestInput) {
  const r = await editable(actor, id);
  await checkAttachments(actor, input.attachments, r.attachments);
  const values = toRow(input);
  const keys = (Object.keys(values) as (keyof RowValues)[]).filter(k => k !== "agentEmail" && k !== "agentPhone" && k !== "state");
  const changedKeys = keys.filter(k => norm(values[k]) !== norm(r[k as keyof CmaRequestRow]));
  if (!changedKeys.length) return { changed: [] as string[], status: r.status };
  const changed = changedKeys.map(k => FIELD_LABELS[k] ?? k);
  const diff = changedKeys.map(k =>
    k === "attachments"
      ? { field: k, from: r.attachments.map(a => a.name).join(", "), to: values.attachments.map(a => a.name).join(", ") }
      : { field: k, from: short(r[k as keyof CmaRequestRow]), to: short(values[k]) },
  );
  const patch: Parameters<typeof repo.updateRequest>[1] = {
    ...values,
    revisions: [...r.revisions, { at: Date.now(), byEmail: emailOf(actor), type: "details", changed, diff }],
  };
  if (r.status === "needs_info") {
    patch.status = "submitted";
    patch.statusNote = "Details updated. Back in the queue.";
  } else if (r.status === "building") {
    patch.revisionPending = true;
  } else if (r.status !== "submitted" && r.status !== "approval") {
    patch.status = "revision";
    patch.statusNote = `Updated ${changed.join(", ")}. The CMA is being rebuilt.`;
  }
  const updated = await repo.updateRequest(id, patch);
  return { changed, status: updated.status };
}

/** Agent sets their own list price (or asking rent) on a finished CMA; the builder redoes the files. */
export async function setListPrice(actor: AuthUser, id: string, listPrice: number, note?: string | null) {
  const r = await editable(actor, id);
  if (r.status !== "ready" && r.status !== "revision") throw conflict("The list price can be changed once the CMA is ready.");
  const isLease = r.reportType === "lease";
  if (listPrice < (isLease ? 1 : 10_000)) throw badRequest(isLease ? "Enter the asking rent in dollars." : "Enter a list price in dollars (at least $10,000).");
  // Commercial lease rates are $/SF/yr (e.g. 27.50): keep cents.
  const price = isLease ? Math.round(listPrice * 100) / 100 : Math.round(listPrice);
  const unit = !isLease ? "" : r.kind === "commercial" ? "/SF/yr" : "/mo";
  await repo.updateRequest(id, {
    agentListPrice: price,
    agentListPriceNote: note ?? null,
    recommendedListPrice: r.recommendedListPrice ?? r.listPrice,
    listPrice: price,
    status: "revision",
    statusNote: `${isLease ? "Asking rent" : "List price"} changed to $${price.toLocaleString("en-US")}${unit}. The PDF and workbook are being updated.`,
    revisions: [...r.revisions, { at: Date.now(), byEmail: emailOf(actor), type: "list_price", changed: ["List price"], listPrice: price, note: note ?? undefined }],
  });
  return { ok: true };
}

/** Admin approves / declines an over-the-limit request. */
export async function decideApproval(actor: AuthUser, id: string, approve: boolean) {
  if (!isAdmin(actor)) throw forbidden("Only admins can approve extra CMAs.");
  const r = await repo.findRequest(id);
  if (!r || r.status !== "approval") throw conflict("Nothing to approve.");
  await repo.updateRequest(
    id,
    approve ? { status: "submitted", statusNote: `Approved by ${actor.name || "an admin"}. In the queue.` } : { status: "failed", statusNote: `Declined by ${actor.name || "an admin"}` },
  );
  return { ok: true };
}

// ---------- For the listing-based CMA Builder ----------

/** Property facts an agent already typed on a CMA request for this street (prefills the builder). */
export async function factsForStreet(actor: AuthUser, street: string) {
  const r = await repo.latestForStreet(street, isAdmin(actor) ? undefined : emailOf(actor));
  if (!r) return null;
  return {
    requestId: r.id,
    propertyType: r.propertyType,
    beds: r.beds,
    bathsFull: r.bathsFull,
    bathsHalf: r.bathsHalf,
    sqft: r.sqft,
    yearBuilt: r.yearBuilt,
    condition: r.condition,
    garage: r.garage,
    city: r.city,
    state: r.state,
    zip: r.zip,
    upgrades: r.upgrades.map(u => u.item),
    createdAt: r.createdAt,
  };
}

// ---------- CMA builder (worker) ----------

export async function workerPending() {
  return { count: (await repo.listByStatus(["submitted", "revision"], 100)).length };
}

export async function workerList(status: string) {
  return { items: await repo.listByStatus([status]) };
}

export async function workerGet(id: string) {
  const r = await repo.findRequest(id);
  if (!r) throw notFound("Request not found.");
  return withUrls(r);
}

export async function workerSetStatus(a: { id: string; status: string; statusNote?: string; valueLow?: number; valueHigh?: number; listPrice?: number; recommendedListPrice?: number }) {
  const r = await repo.findRequest(a.id);
  if (!r) throw notFound("Request not found.");
  const { id, status, ...rest } = a;
  const patch: Parameters<typeof repo.updateRequest>[1] = { status, ...rest };
  if (status === "building") {
    patch.pickedUpAt = new Date();
    patch.revisionPending = false;
  }
  if (status === "ready") {
    patch.completedAt = new Date();
    // The agent edited while this build ran: keep the new files but queue the edit for another pass.
    if (r.revisionPending) {
      patch.status = "revision";
      patch.revisionPending = false;
      patch.statusNote = "Your edits came in while this version was building. The report is being updated with them.";
    }
  }
  await repo.updateRequest(id, patch);
  return { ok: true };
}

/** Upload link for the finished PDF / workbook (then report the key with workerFiles). */
export async function workerUploadUrl(id: string, file: "pdf" | "workbook", contentType: string) {
  if (!(await repo.findRequest(id))) throw notFound("Request not found.");
  const key = `cma-files/${id}/${file}-${Date.now()}.${file === "pdf" ? "pdf" : "xlsx"}`;
  return { key, uploadUrl: await signedUploadUrl(key, contentType) };
}

export async function workerFiles(a: { id: string; pdfKey?: string; workbookKey?: string }) {
  if (!(await repo.findRequest(a.id))) throw notFound("Request not found.");
  for (const k of [a.pdfKey, a.workbookKey]) {
    if (k && (!k.startsWith(`cma-files/${a.id}/`) || (await objectSize(k)) === null)) throw badRequest("That file wasn't uploaded for this request.");
  }
  await repo.updateRequest(a.id, { ...(a.pdfKey ? { pdfKey: a.pdfKey } : {}), ...(a.workbookKey ? { workbookKey: a.workbookKey } : {}) });
  return { ok: true };
}
