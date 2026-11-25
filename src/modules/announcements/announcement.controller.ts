// HTTP only: validate input, call the service, send the result.
import type { Request, Response } from "express";
import type { AuthUser } from "../../types/auth.js";
import { unauthorized } from "../../utils/http-error.js";
import * as service from "./announcement.service.js";
import { announcementIdParams, pinBody, postBody, subscribeBody, unsubscribeBody } from "./announcement.validation.js";

function actor(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
const idOf = (req: Request) => announcementIdParams.parse(req.params).id;

export async function list(req: Request, res: Response) {
  res.json(await service.listAnnouncements(actor(req)));
}
export async function create(req: Request, res: Response) {
  res.status(201).json(await service.post(actor(req), postBody.parse(req.body)));
}
export async function pin(req: Request, res: Response) {
  res.json(await service.setPinned(actor(req), idOf(req), pinBody.parse(req.body).pinned));
}
export async function remove(req: Request, res: Response) {
  res.json(await service.remove(actor(req), idOf(req)));
}
export async function subscribe(req: Request, res: Response) {
  res.json(await service.subscribe(actor(req), subscribeBody.parse(req.body)));
}
export async function unsubscribe(req: Request, res: Response) {
  actor(req);
  res.json(await service.unsubscribe(unsubscribeBody.parse(req.body).endpoint));
}
