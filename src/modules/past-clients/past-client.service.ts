// Past clients (was the "Past clients" part of convex/marketMe.ts). Each agent sees only their own.
import type { AuthUser } from "../../types/auth.js";
import { notFound } from "../../utils/http-error.js";
import * as repo from "./past-client.repository.js";
import type { ClientInput } from "./past-client.validation.js";

const emailOf = (u: AuthUser) => u.email.toLowerCase();

async function own(actor: AuthUser, id: string) {
  const row = await repo.findClient(id);
  if (!row || row.agentEmail !== emailOf(actor)) throw notFound("Client not found.");
  return row;
}

const values = (a: ClientInput) => ({ name: a.name, phone: a.phone ?? null, email: a.email ?? null, address: a.address ?? null, closedOn: a.closedOn, side: a.side });

export async function listClients(actor: AuthUser) {
  return { items: await repo.listForAgent(emailOf(actor)) };
}

export async function addClient(actor: AuthUser, a: ClientInput) {
  return repo.insertClient({ ...values(a), agentUserId: actor.id, agentEmail: emailOf(actor), done: [] });
}

export async function updateClient(actor: AuthUser, id: string, a: ClientInput) {
  await own(actor, id);
  return (await repo.updateClient(id, values(a)))!;
}

export async function removeClient(actor: AuthUser, id: string) {
  await own(actor, id);
  await repo.deleteClient(id);
  return { ok: true };
}

/** Mark a touch (e.g. "anniv-2027") sent or not sent. */
export async function markTouch(actor: AuthUser, id: string, key: string, done: boolean) {
  const row = await own(actor, id);
  const next = done ? [...new Set([...row.done, key])] : row.done.filter(k => k !== key);
  return (await repo.updateClient(id, { done: next.slice(-200) }))!;
}
