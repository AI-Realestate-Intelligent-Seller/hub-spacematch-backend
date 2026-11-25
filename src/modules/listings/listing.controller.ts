// HTTP only: validate input, call the service, send the result.
import type { Request, Response } from "express";
import type { AuthUser } from "../../types/auth.js";
import { notFound, unauthorized } from "../../utils/http-error.js";
import * as service from "./listing.service.js";
import * as v from "./listing.validation.js";

function actor(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

// ---------- Listings ----------

export async function list(req: Request, res: Response) {
  const { scope } = v.listQuery.parse(req.query);
  res.json(await service.listListings(actor(req), scope));
}

export async function agents(_req: Request, res: Response) {
  res.json({ items: await service.listAgents() });
}

export async function pick(req: Request, res: Response) {
  res.json({ items: await service.pickList(actor(req)) });
}

export async function get(req: Request, res: Response) {
  const { id } = v.idParams.parse(req.params);
  res.json(await service.getListing(actor(req), id));
}

export async function create(req: Request, res: Response) {
  res.status(201).json(await service.createListing(actor(req), v.createListingBody.parse(req.body)));
}

export async function update(req: Request, res: Response) {
  const { id } = v.idParams.parse(req.params);
  res.json(await service.updateListing(actor(req), id, v.updateListingBody.parse(req.body)));
}

export async function remove(req: Request, res: Response) {
  const { id } = v.idParams.parse(req.params);
  res.json(await service.removeListing(actor(req), id));
}

export async function rotateLink(req: Request, res: Response) {
  const { id } = v.idParams.parse(req.params);
  res.json(await service.rotateLink(actor(req), id));
}

export async function linkLofty(req: Request, res: Response) {
  const { id } = v.idParams.parse(req.params);
  res.json(await service.linkLofty(actor(req), id));
}

export async function toggleStep(req: Request, res: Response) {
  const { id, key } = v.stepParams.parse(req.params);
  const { done, note } = v.toggleStepBody.parse(req.body);
  res.json(await service.toggleStep(actor(req), id, key, done, note));
}

export async function saveMetrics(req: Request, res: Response) {
  const { id, weekOf } = v.weekParams.parse(req.params);
  res.json(await service.saveMetrics(actor(req), id, weekOf, v.saveMetricsBody.parse(req.body)));
}

// ---------- Activity ----------

export async function addEvent(req: Request, res: Response) {
  const { id } = v.idParams.parse(req.params);
  res.status(201).json(await service.addEvent(actor(req), id, v.addEventBody.parse(req.body)));
}

export async function addParsedShowing(req: Request, res: Response) {
  const { id } = v.idParams.parse(req.params);
  res.status(201).json(await service.addParsedShowing(actor(req), id, v.parsedShowingBody.parse(req.body)));
}

export async function setEventStatus(req: Request, res: Response) {
  const { eventId } = v.eventParams.parse(req.params);
  const { status, body } = v.setEventStatusBody.parse(req.body);
  res.json(await service.setEventStatus(actor(req), eventId, status, body));
}

export async function removeEvent(req: Request, res: Response) {
  const { eventId } = v.eventParams.parse(req.params);
  res.json(await service.removeEvent(actor(req), eventId));
}

// ---------- ShowingTime inbox ----------

export async function inbox(_req: Request, res: Response) {
  res.json({ items: await service.listInbox() });
}

export async function assignInbox(req: Request, res: Response) {
  const { inboxId } = v.inboxParams.parse(req.params);
  const { listingId } = v.assignInboxBody.parse(req.body);
  res.json(await service.assignInbox(actor(req), inboxId, listingId));
}

// ---------- Suggestions ----------

export async function suggestions(req: Request, res: Response) {
  const { id } = v.idParams.parse(req.params);
  res.json({ items: await service.listSuggestions(actor(req), id) });
}

export async function refreshSuggestions(req: Request, res: Response) {
  const { id } = v.idParams.parse(req.params);
  res.json(await service.refreshSuggestions(actor(req), id));
}

export async function addSuggestion(req: Request, res: Response) {
  const { id } = v.idParams.parse(req.params);
  res.status(201).json(await service.addSuggestion(actor(req), id, v.addSuggestionBody.parse(req.body)));
}

export async function updateSuggestion(req: Request, res: Response) {
  const { suggestionId } = v.suggestionParams.parse(req.params);
  res.json(await service.updateSuggestion(actor(req), suggestionId, v.updateSuggestionBody.parse(req.body)));
}

// ---------- Seller portal (public) ----------

export async function portal(req: Request, res: Response) {
  const parsed = v.tokenParams.safeParse(req.params);
  const data = parsed.success ? await service.portal(parsed.data.token) : null;
  if (!data) throw notFound("This link has expired. Ask your agent for a new one.");
  res.json(data);
}

export async function portalSeen(req: Request, res: Response) {
  const parsed = v.tokenParams.safeParse(req.params);
  res.json(parsed.success ? await service.markSeen(parsed.data.token) : { ok: true });
}

export async function portalApprove(req: Request, res: Response) {
  const parsed = v.tokenParams.safeParse(req.params);
  if (!parsed.success) throw notFound("This link has expired. Ask your agent for a new one.");
  res.json(await service.approvePlan(parsed.data.token));
}
