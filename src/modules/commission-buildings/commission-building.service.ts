// 100% commission rentals rules (was convex/commissionBuildings.ts). Any agent adds a building;
// admins/ops ("the office") verify, move between lists, hide and clear reports.
import type { AuthUser } from "../../types/auth.js";
import { conflict, forbidden, notFound } from "../../utils/http-error.js";
import { listStaffEmails } from "../users/user.service.js";
import { mailStaff } from "./commission-building.mail.js";
import type { CommissionBuildingRow } from "./commission-building.model.js";
import * as repo from "./commission-building.repository.js";
import { type AddBuildingInput, CONFIRM_HOW, type UpdateBuildingInput, VERIFY_HOW } from "./commission-building.validation.js";

const canVerify = (u: AuthUser) => u.role === "admin" || u.role === "ops";
const emailOf = (u: AuthUser) => u.email.toLowerCase();
const nameOf = (u: AuthUser) => u.name || u.email;

const SUFFIX: Record<string, string> = {
  street: "st", avenue: "ave", av: "ave", road: "rd", drive: "dr", place: "pl", court: "ct", boulevard: "blvd",
  parkway: "pkwy", terrace: "ter", lane: "ln", north: "n", south: "s", east: "e", west: "w",
};
/** "1212 S. Michigan Avenue, Chicago" and "1212 s michigan ave" are the same building. */
export function buildingKey(address: string): string {
  return (address.toLowerCase().split(",")[0] ?? "")
    .replace(/[.#]/g, "")
    .replace(/\b(apt|unit|suite|ste)\b.*$/, "")
    .split(/\s+/)
    .filter(Boolean)
    .map(w => SUFFIX[w] ?? w)
    .join(" ");
}

const listName = (noPay: boolean) => (noPay ? "the list under Doesn't pay" : "the list");

/** Turns validated input into row values (same clean-up as before). */
function toRow(a: UpdateBuildingInput) {
  const address = a.address.replace(/\s+/g, " ");
  const noPay = a.status === "no_pay";
  const reason = noPay ? (a.noPayReason ?? "none") : null;
  // Only "pays less than a full month" carries a percent on the no-pay list; the other reasons are 0.
  const pct = noPay && reason !== "under" ? 0 : a.commissionPct;
  return {
    name: a.name || address.split(",")[0]!,
    address,
    addressKey: buildingKey(address),
    neighborhood: a.neighborhood ?? null,
    manager: a.manager ?? null,
    commissionPct: pct,
    status: noPay ? "no_pay" : "pays",
    noPayReason: reason,
    bonus: noPay ? null : (a.bonus ?? null),
    keyRule: a.keyRule ?? null,
    terms: a.terms ?? null,
    phone: a.phone ?? null,
    email: a.email ?? null,
    brokerUrl: a.brokerUrl ?? null,
    website: a.website ?? null,
    sourceNote: a.sourceNote ?? null,
    sourceUrl: a.sourceUrl ?? null,
    offerEnds: noPay ? null : (a.offerEnds ?? null),
  };
}

async function notify(b: CommissionBuildingRow, kind: "added" | "reported") {
  await mailStaff(b, kind, await listStaffEmails());
}

export async function listBuildings(actor: AuthUser) {
  const all = await repo.listBuildings();
  return {
    viewer: { email: emailOf(actor), name: nameOf(actor), isAdmin: actor.role === "admin", canVerify: canVerify(actor) },
    verifyHow: VERIFY_HOW,
    confirmHow: CONFIRM_HOW,
    items: all.filter(b => canVerify(actor) || !b.hidden),
  };
}

export async function addBuilding(actor: AuthUser, { verify, verifiedHow, ...a }: AddBuildingInput) {
  const row = toRow(a);
  const dup = await repo.findByKey(row.addressKey);
  if (dup) throw conflict(`${dup.name} at ${dup.address.split(",")[0]} is already on ${listName(dup.status === "no_pay")}.`);
  const stamp = !!verify && canVerify(actor);
  const b = await repo.insertBuilding({
    ...row,
    verified: stamp,
    ...(stamp ? { verifiedAt: new Date(), verifiedByName: nameOf(actor), verifiedByEmail: emailOf(actor), verifiedHow: verifiedHow ?? (row.status === "no_pay" ? CONFIRM_HOW[0] : VERIFY_HOW[0]) } : {}),
    hidden: false,
    addedByUserId: actor.id,
    addedByEmail: emailOf(actor),
    addedByName: nameOf(actor),
  });
  if (!stamp) await notify(b, "added");
  return b;
}

export async function updateBuilding(actor: AuthUser, id: string, a: UpdateBuildingInput) {
  const b = await repo.findBuilding(id);
  if (!b || (b.hidden && !canVerify(actor))) throw notFound("Building not found.");
  const own = b.addedByEmail === emailOf(actor);
  if (!canVerify(actor) && !own) throw forbidden("Only the agent who added it or the office can edit this. Use Report a change instead.");
  if (!canVerify(actor) && b.verified) throw forbidden("This one is verified. Use Report a change and the office will update it.");
  const row = toRow(a);
  // Moving a building between the two lists is the office's call, and the old stamp no longer says what was checked.
  const moved = row.status !== b.status;
  if (moved && !canVerify(actor)) throw forbidden("Only the office can move a building to the other list. Use Report a change instead.");
  if (row.addressKey !== b.addressKey) {
    const dup = await repo.findByKey(row.addressKey);
    if (dup && dup.id !== id) throw conflict(`${dup.name} is already on the list at that address.`);
  }
  return (await repo.updateBuilding(id, {
    ...row,
    ...(moved ? { verified: false, verifiedAt: null, verifiedByName: null, verifiedByEmail: null, verifiedHow: null } : {}),
  }))!;
}

/** Office only: stamp on (with how it was confirmed) or off. Stamping clears any open report. */
export async function verifyBuilding(actor: AuthUser, id: string, verified: boolean, how?: string | null) {
  if (!canVerify(actor)) throw forbidden("Only admins or ops can verify a building.");
  const b = await repo.findBuilding(id);
  if (!b) throw notFound("Building not found.");
  return (await repo.updateBuilding(
    id,
    verified
      ? { verified: true, verifiedAt: new Date(), verifiedByName: nameOf(actor), verifiedByEmail: emailOf(actor), verifiedHow: how ?? null, flagNote: null, flaggedByName: null, flaggedAt: null }
      : { verified: false, verifiedAt: null, verifiedByName: null, verifiedByEmail: null, verifiedHow: null },
  ))!;
}

/** Any agent: "this changed". Everyone sees the note until the office re-checks. */
export async function reportBuilding(actor: AuthUser, id: string, note: string) {
  const b = await repo.findBuilding(id);
  if (!b || (b.hidden && !canVerify(actor))) throw notFound("Building not found.");
  const updated = (await repo.updateBuilding(id, { flagNote: note, flaggedByName: nameOf(actor), flaggedAt: new Date() }))!;
  await notify(updated, "reported");
  return updated;
}

export async function moderateBuilding(actor: AuthUser, id: string, m: { hidden?: boolean; clearReport?: boolean }) {
  if (!canVerify(actor)) throw forbidden("Only the office can do that.");
  const b = await repo.findBuilding(id);
  if (!b) throw notFound("Building not found.");
  return (await repo.updateBuilding(id, {
    ...(m.hidden !== undefined ? { hidden: m.hidden } : {}),
    ...(m.clearReport ? { flagNote: null, flaggedByName: null, flaggedAt: null } : {}),
  }))!;
}

export async function removeBuilding(actor: AuthUser, id: string) {
  const b = await repo.findBuilding(id);
  if (!b) throw notFound("Building not found.");
  const ownUnverified = b.addedByEmail === emailOf(actor) && !b.verified;
  if (!canVerify(actor) && !ownUnverified) throw forbidden("Only the office can remove this building.");
  await repo.deleteBuilding(id);
  return { ok: true };
}
