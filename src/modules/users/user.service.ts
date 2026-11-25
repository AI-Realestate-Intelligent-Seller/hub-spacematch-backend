// Business rules for users: who may sign up, profile edits, admin changes to role/status.
import { config } from "../../config/index.js";
import { signedDownloadUrl } from "../../integrations/storage/storage.client.js";
import type { AuthUser } from "../../types/auth.js";
import { badRequest, forbidden, notFound } from "../../utils/http-error.js";
import * as repo from "./user.repository.js";
import type { InvitationRow, UserRow } from "./user.model.js";

/** Fields any signed-in user may see about themselves (and admins about anyone). */
export function toPublicUser(u: UserRow) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    status: u.status,
    emailVerified: u.emailVerified,
    phone: u.phone,
    title: u.title,
    licenseNo: u.licenseNo,
    bio: u.bio,
    photoKey: u.photoKey,
    driveFolderId: u.driveFolderId,
    lastLoginAt: u.lastLoginAt,
    removedAt: u.removedAt,
    createdAt: u.createdAt,
  };
}
export type PublicUser = ReturnType<typeof toPublicUser>;

// ---------- Sign-up / sign-in rules (called from Better Auth hooks) ----------

export type SignupDecision = { allowed: true; role: repo.Role } | { allowed: false; reason: string };

/**
 * Who may create an account:
 *  - only emails at an allowed domain (AUTH_ALLOWED_DOMAINS, default linchpin.net); everyone else is refused;
 *  - the role is "agent", unless an open invitation for that email gives another role (admin/ops/guest).
 * Invitations no longer let outside domains in: they only decide the role.
 */
export async function decideSignup(email: string): Promise<SignupDecision> {
  const normalized = email.trim().toLowerCase();
  const domain = normalized.split("@")[1] ?? "";
  if (!config.auth.allowedEmailDomains.includes(domain)) {
    const allowed = config.auth.allowedEmailDomains.map(d => `@${d}`).join(" or ");
    return { allowed: false, reason: `Only ${allowed} email addresses can sign up.` };
  }
  const invitation = await repo.findOpenInvitation(normalized);
  return { allowed: true, role: invitation?.role ?? "agent" };
}

export async function onUserCreated(email: string): Promise<void> {
  await repo.markInvitationAccepted(email);
}

/** Refuses a new session for removed users. Returns a reason when refused. */
export async function checkCanSignIn(userId: string): Promise<string | null> {
  const user = await repo.findUserById(userId);
  if (!user) return "Account not found.";
  if (user.status === "removed") return "This account has been removed. Contact a SpaceMatch admin.";
  return null;
}

export async function recordLogin(userId: string): Promise<void> {
  await repo.updateUser(userId, { lastLoginAt: new Date() });
}

// ---------- Signed-in user ----------

export async function getMe(actor: AuthUser): Promise<PublicUser> {
  const user = await repo.findUserById(actor.id);
  if (!user) throw notFound("Your account was not found.");
  return toPublicUser(user);
}

export async function updateMe(
  actor: AuthUser,
  patch: { name?: string; phone?: string | null; title?: string | null; licenseNo?: string | null; bio?: string | null },
): Promise<PublicUser> {
  const user = await repo.updateUser(actor.id, patch);
  if (!user) throw notFound("Your account was not found.");
  return toPublicUser(user);
}

// ---------- For other modules ----------

/** An active user by id (e.g. the agent a listing is assigned to), or undefined. */
export async function findActiveUser(id: string): Promise<Pick<UserRow, "id" | "email" | "name" | "phone" | "role"> | undefined> {
  const u = await repo.findUserById(id);
  return u && u.status === "active" ? { id: u.id, email: u.email, name: u.name, phone: u.phone, role: u.role } : undefined;
}

/** An active user by email (e.g. a listing's agent shown on the seller page), or undefined. */
export async function findActiveUserByEmail(email: string): Promise<Pick<UserRow, "id" | "email" | "name" | "phone" | "role"> | undefined> {
  const u = await repo.findUserByEmail(email);
  return u && u.status === "active" ? { id: u.id, email: u.email, name: u.name, phone: u.phone, role: u.role } : undefined;
}

/** Emails of active users with any of these roles. */
export async function listEmailsByRoles(roles: repo.Role[]): Promise<string[]> {
  return (await repo.listUsers({ status: "active" })).filter(u => roles.includes(u.role)).map(u => u.email);
}

/** Emails of active admins and ops (who review and approve team items). */
export async function listStaffEmails(): Promise<string[]> {
  return (await repo.listUsers({ status: "active" })).filter(u => u.role === "admin" || u.role === "ops").map(u => u.email);
}

/**
 * The team roster for agent pickers, business cards and public "meet your agent" pages: active
 * agents and admins (ops and guests aren't agents). Same fields the old public roster had.
 */
export async function listRoster() {
  const rows = (await repo.listUsers({ status: "active" })).filter(u => u.role === "agent" || u.role === "admin");
  return Promise.all(
    rows.map(async u => ({
      name: u.name,
      email: u.email,
      phone: u.phone ?? "",
      title: u.title ?? undefined,
      lic: u.licenseNo ?? undefined,
      bio: u.bio ?? undefined,
      photo: u.photoKey ? await signedDownloadUrl(u.photoKey, 24 * 3600).catch(() => undefined) : undefined,
    })),
  );
}

/** People a listing (or other work) can be assigned to: active agents, ops and admins. */
export async function listAssignableAgents(): Promise<{ id: string; name: string; email: string; role: repo.Role }[]> {
  return (await repo.listUsers({ status: "active" }))
    .filter(u => u.role === "agent" || u.role === "ops" || u.role === "admin")
    .map(u => ({ id: u.id, name: u.name, email: u.email, role: u.role }));
}

// ---------- Admin ----------

export async function listUsers(filter: { role?: repo.Role; status?: repo.Status }): Promise<PublicUser[]> {
  return (await repo.listUsers(filter)).map(toPublicUser);
}

export async function adminUpdateUser(
  actor: AuthUser,
  id: string,
  patch: {
    role?: repo.Role;
    status?: repo.Status;
    name?: string;
    phone?: string | null;
    title?: string | null;
    licenseNo?: string | null;
    bio?: string | null;
    driveFolderId?: string | null;
  },
): Promise<PublicUser> {
  const target = await repo.findUserById(id);
  if (!target) throw notFound("User not found.");
  if (target.id === actor.id && ((patch.role && patch.role !== "admin") || patch.status === "removed")) {
    throw badRequest("You can't remove yourself or take away your own admin role.");
  }

  const update: Parameters<typeof repo.updateUser>[1] = { ...patch };
  if (patch.status === "removed" && target.status !== "removed") update.removedAt = new Date();
  if (patch.status === "active" && target.status === "removed") update.removedAt = null;

  const user = await repo.updateUser(id, update);
  // Removing someone signs them out on every device straight away.
  if (patch.status === "removed") await repo.deleteSessionsForUser(id);
  return toPublicUser(user!);
}

export async function listInvitations(): Promise<InvitationRow[]> {
  return repo.listInvitations();
}

export async function inviteUser(actor: AuthUser, input: { email: string; role: repo.Role; note?: string }): Promise<InvitationRow> {
  const domain = input.email.split("@")[1] ?? "";
  if (!config.auth.allowedEmailDomains.includes(domain)) {
    throw badRequest(`Only ${config.auth.allowedEmailDomains.map(d => `@${d}`).join(" or ")} emails can be invited.`);
  }
  const existing = await repo.findUserByEmail(input.email);
  if (existing) throw badRequest("This person already has an account. Change their role on the Team screen instead.");
  if (input.role === "admin" && actor.role !== "admin") throw forbidden("Only admins can invite admins.");
  return repo.upsertInvitation({ ...input, invitedBy: actor.email });
}

export async function revokeInvitation(email: string): Promise<InvitationRow> {
  const row = await repo.revokeInvitation(email);
  if (!row) throw notFound("Invitation not found.");
  return row;
}
