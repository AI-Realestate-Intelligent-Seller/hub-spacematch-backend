// HTTP only: validate input, call the service, send the result.
import type { Request, Response } from "express";
import type { AuthUser } from "../../types/auth.js";
import { unauthorized } from "../../utils/http-error.js";
import * as service from "./past-client.service.js";
import { clientBody, clientIdParams, touchBody } from "./past-client.validation.js";

function actor(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
const idOf = (req: Request) => clientIdParams.parse(req.params).id;

export async function list(req: Request, res: Response) {
  res.json(await service.listClients(actor(req)));
}
export async function create(req: Request, res: Response) {
  res.status(201).json(await service.addClient(actor(req), clientBody.parse(req.body)));
}
export async function update(req: Request, res: Response) {
  res.json(await service.updateClient(actor(req), idOf(req), clientBody.parse(req.body)));
}
export async function remove(req: Request, res: Response) {
  res.json(await service.removeClient(actor(req), idOf(req)));
}
export async function touch(req: Request, res: Response) {
  const { key, done } = touchBody.parse(req.body);
  res.json(await service.markTouch(actor(req), idOf(req), key, done));
}
