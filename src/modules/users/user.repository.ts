// All database queries for users and invitations. Only user.service.ts calls this file.
import { and, asc, eq, isNull, type SQL } from "drizzle-orm";
import { getOrm } from "../../db/client.js";
import { sessions } from "../auth/auth.model.js";
import { type InvitationRow, type UserRow, userInvitations, users } from "./user.model.js";

export type Role = UserRow["role"];
export type Status = UserRow["status"];

export async function findUserById(id: string): Promise<UserRow | undefined> {
  const [row] = await getOrm().select().from(users).where(eq(users.id, id)).limit(1);
  return row;
}

export async function findUserByEmail(email: string): Promise<UserRow | undefined> {
  const [row] = await getOrm().select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
  return row;
}

export async function listUsers(filter: { role?: Role; status?: Status }): Promise<UserRow[]> {
  const where: SQL[] = [];
  if (filter.role) where.push(eq(users.role, filter.role));
  if (filter.status) where.push(eq(users.status, filter.status));
  return getOrm()
    .select()
    .from(users)
    .where(where.length ? and(...where) : undefined)
    .orderBy(asc(users.name));
}

export async function updateUser(
  id: string,
  patch: Partial<Pick<UserRow, "name" | "phone" | "title" | "licenseNo" | "bio" | "photoKey" | "driveFolderId" | "role" | "status" | "removedAt" | "lastLoginAt">>,
): Promise<UserRow | undefined> {
  const [row] = await getOrm().update(users).set(patch).where(eq(users.id, id)).returning();
  return row;
}

/** Marks an email as confirmed (used by the operator CLI, which is trusted). */
export async function setEmailVerified(email: string): Promise<UserRow | undefined> {
  const [row] = await getOrm()
    .update(users)
    .set({ emailVerified: true })
    .where(eq(users.email, email.toLowerCase()))
    .returning();
  return row;
}

/** Signs a user out everywhere (used when an admin removes them). */
export async function deleteSessionsForUser(userId: string): Promise<number> {
  const rows = await getOrm().delete(sessions).where(eq(sessions.userId, userId)).returning({ id: sessions.id });
  return rows.length;
}

export async function findOpenInvitation(email: string): Promise<InvitationRow | undefined> {
  const [row] = await getOrm()
    .select()
    .from(userInvitations)
    .where(and(eq(userInvitations.email, email.toLowerCase()), isNull(userInvitations.revokedAt)))
    .limit(1);
  return row;
}

export async function listInvitations(): Promise<InvitationRow[]> {
  return getOrm().select().from(userInvitations).orderBy(asc(userInvitations.email));
}

/** Creates or re-opens an invitation (idempotent: used by the admin screen and the seed). */
export async function upsertInvitation(input: { email: string; role: Role; invitedBy: string; note?: string }): Promise<InvitationRow> {
  const email = input.email.toLowerCase();
  const [row] = await getOrm()
    .insert(userInvitations)
    .values({ email, role: input.role, invitedBy: input.invitedBy, note: input.note })
    .onConflictDoUpdate({
      target: userInvitations.email,
      set: { role: input.role, invitedBy: input.invitedBy, note: input.note ?? null, revokedAt: null },
    })
    .returning();
  return row!;
}

export async function markInvitationAccepted(email: string): Promise<void> {
  await getOrm()
    .update(userInvitations)
    .set({ acceptedAt: new Date() })
    .where(and(eq(userInvitations.email, email.toLowerCase()), isNull(userInvitations.acceptedAt)));
}

export async function revokeInvitation(email: string): Promise<InvitationRow | undefined> {
  const [row] = await getOrm()
    .update(userInvitations)
    .set({ revokedAt: new Date() })
    .where(eq(userInvitations.email, email.toLowerCase()))
    .returning();
  return row;
}
