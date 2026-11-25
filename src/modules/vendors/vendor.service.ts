// Vendor directory rules (was convex/vendors.ts). Everyone sees team vendors; private ones only
// their author and admins. Admins mark Preferred, hide, and pick what shows on the public website.
import type { AuthUser } from "../../types/auth.js";
import { forbidden, notFound } from "../../utils/http-error.js";
import type { VendorRow } from "./vendor.model.js";
import * as repo from "./vendor.repository.js";
import type { VendorInput } from "./vendor.validation.js";

const isAdmin = (u: AuthUser) => u.role === "admin";
const viewer = (u: AuthUser) => ({ email: u.email.toLowerCase(), name: u.name || u.email, isAdmin: isAdmin(u) });

const canSee = (v: VendorRow, u: AuthUser) => {
  const me = u.email.toLowerCase();
  return (isAdmin(u) || !v.hidden) && (!v.private || v.addedByEmail === me || isAdmin(u));
};
const isOwner = (v: VendorRow, u: AuthUser) => v.addedByEmail === u.email.toLowerCase();

export async function listVendors(actor: AuthUser) {
  const [all, reviews] = await Promise.all([repo.listVendors(), repo.listReviews()]);
  const me = actor.email.toLowerCase();
  const items = all
    .filter(v => canSee(v, actor))
    .map(v => {
      const rs = reviews.filter(r => r.vendorId === v.id);
      return {
        ...v,
        ratingCount: rs.length,
        rating: rs.length ? rs.reduce((s, r) => s + r.rating, 0) / rs.length : null,
        myRating: rs.find(r => r.userEmail === me)?.rating ?? null,
        notes: rs.filter(r => r.note).map(r => ({ by: r.userName, note: r.note!, rating: r.rating })),
      };
    });
  return { viewer: viewer(actor), items };
}

const nullable = (input: VendorInput) => ({
  name: input.name,
  company: input.company ?? null,
  category: input.category,
  subcategory: input.subcategory ?? null,
  description: input.description ?? null,
  phone: input.phone ?? null,
  email: input.email ?? null,
  website: input.website ?? null,
  address: input.address ?? null,
  areas: input.areas ?? null,
  languages: input.languages ?? null,
  perk: input.perk ?? null,
  private: input.private,
});

export async function addVendor(actor: AuthUser, input: VendorInput) {
  return repo.insertVendor({
    ...nullable(input),
    addedByUserId: actor.id,
    addedByEmail: actor.email.toLowerCase(),
    addedByName: actor.name || actor.email,
    source: "agent",
  });
}

export async function updateVendor(actor: AuthUser, id: string, input: VendorInput) {
  const v = await repo.findVendor(id);
  if (!v || !canSee(v, actor)) throw notFound("Vendor not found.");
  if (!isAdmin(actor) && !isOwner(v, actor)) throw forbidden("Only the person who added this vendor (or an admin) can edit it.");
  return (await repo.updateVendor(id, nullable(input)))!;
}

export async function removeVendor(actor: AuthUser, id: string) {
  const v = await repo.findVendor(id);
  if (!v || !canSee(v, actor)) throw notFound("Vendor not found.");
  if (!isAdmin(actor) && !isOwner(v, actor)) throw forbidden("Only admins can remove other agents' vendors.");
  await repo.deleteVendor(id);
  return { ok: true };
}

export async function moderateVendor(actor: AuthUser, id: string, patch: { preferred?: boolean; hidden?: boolean; onWebsite?: boolean }) {
  if (!isAdmin(actor)) throw forbidden("Only admins can mark Preferred or hide vendors.");
  const v = await repo.findVendor(id);
  if (!v) throw notFound("Vendor not found.");
  return (await repo.updateVendor(id, patch))!;
}

export async function rateVendor(actor: AuthUser, id: string, rating: number, note?: string | null) {
  const v = await repo.findVendor(id);
  if (!v || !canSee(v, actor)) throw notFound("Vendor not found.");
  const me = actor.email.toLowerCase();
  const existing = await repo.findReview(id, me);
  // A rating without a note keeps the earlier note (same as before).
  await repo.upsertReview({ vendorId: id, userEmail: me, userName: actor.name || actor.email, rating, note: note === undefined ? (existing?.note ?? null) : note });
  return { ok: true };
}

/** Public "Trusted Local Pros" list for spacematchinc.com: no contact details, perks, notes,
 *  ratings or who added it. Only non-private, non-hidden vendors an admin hasn't switched off. */
export async function publicPros() {
  return (await repo.listVendors())
    .filter(v => !v.private && !v.hidden && v.onWebsite)
    .map(v => ({
      id: v.id,
      name: v.name,
      company: v.company,
      category: v.category,
      subcategory: v.subcategory,
      areas: v.areas,
      languages: v.languages,
      preferred: v.preferred,
      hasContact: !!(v.phone || v.email || v.website),
    }))
    .sort((a, b) => a.category.localeCompare(b.category) || Number(b.preferred) - Number(a.preferred) || a.name.localeCompare(b.name));
}
