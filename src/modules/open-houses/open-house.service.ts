// Open house calendar (was the "Open house calendar" part of convex/marketMe.ts).
// Anyone adds a slot or hosts an open one; whoever added it (or admins/ops) can remove it.
import type { AuthUser } from "../../types/auth.js";
import { badRequest, conflict, forbidden, notFound } from "../../utils/http-error.js";
import { enqueue } from "../jobs/job.service.js";
import { listingForOpenHouse, openHouseListings } from "../listings/listing.service.js";
import * as repo from "./open-house.repository.js";
import { type AddOpenHouseInput, chicagoDate } from "./open-house.validation.js";

const isStaff = (u: AuthUser) => u.role === "admin" || u.role === "ops";
const emailOf = (u: AuthUser) => u.email.toLowerCase();
const nameOf = (u: AuthUser) => u.name || u.email;

export async function listOpenHouses(actor: AuthUser) {
  const me = emailOf(actor);
  const [slots, listings] = await Promise.all([repo.listFrom(chicagoDate()), openHouseListings()]);
  return {
    me,
    isStaff: isStaff(actor),
    listings,
    slots: slots.map(s => ({ ...s, mine: s.hostEmail === me, canEdit: isStaff(actor) || s.createdByEmail === me })),
  };
}

export async function addOpenHouse(actor: AuthUser, a: AddOpenHouseInput) {
  let address = a.address ?? "";
  let listingAgent = nameOf(actor);
  if (a.listingId) {
    const l = await listingForOpenHouse(a.listingId);
    if (!l) throw badRequest("That listing was not found. Pick another or type the address.");
    address = l.address;
    listingAgent = l.agentName;
  }
  return repo.insertOpenHouse({
    listingId: a.listingId ?? null,
    address,
    date: a.date,
    start: a.start,
    end: a.end,
    listingAgent,
    ...(a.hostMe ? { hostEmail: emailOf(actor), hostName: nameOf(actor) } : {}),
    notes: a.notes ?? null,
    createdByEmail: emailOf(actor),
  });
}

export async function claimOpenHouse(actor: AuthUser, id: string, claim: boolean) {
  const s = await repo.findOpenHouse(id);
  if (!s) throw notFound("That open house was removed.");
  const me = emailOf(actor);
  if (claim) {
    if (s.hostEmail && s.hostEmail !== me) throw conflict(`${s.hostName} is already hosting this one.`);
    const updated = (await repo.updateOpenHouse(id, { hostEmail: me, hostName: nameOf(actor) }))!;
    // Tell whoever added it (phone/browser notification).
    if (s.createdByEmail !== me) {
      await enqueue("push.toEmail", { email: s.createdByEmail, title: `${nameOf(actor)} will host your open house`, body: `${s.address} · ${s.date} ${s.start}–${s.end}`, url: "/open-houses" });
    }
    return updated;
  }
  if (s.hostEmail !== me && !isStaff(actor) && s.createdByEmail !== me) throw forbidden("Only the host can give it up.");
  return (await repo.updateOpenHouse(id, { hostEmail: null, hostName: null }))!;
}

export async function removeOpenHouse(actor: AuthUser, id: string) {
  const s = await repo.findOpenHouse(id);
  if (!s) return { ok: true };
  if (!isStaff(actor) && s.createdByEmail !== emailOf(actor)) throw forbidden("Only whoever added it can remove it.");
  await repo.deleteOpenHouse(id);
  return { ok: true };
}
