// HTTP only: validate input, call the service, send the result.
import type { Request, Response } from "express";
import type { AuthUser } from "../../types/auth.js";
import { unauthorized } from "../../utils/http-error.js";
import * as service from "./open-house.service.js";
import { addOpenHouseBody, claimBody, openHouseIdParams } from "./open-house.validation.js";

function actor(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
const idOf = (req: Request) => openHouseIdParams.parse(req.params).id;

export async function list(req: Request, res: Response) {
  res.json(await service.listOpenHouses(actor(req)));
}
export async function create(req: Request, res: Response) {
  res.status(201).json(await service.addOpenHouse(actor(req), addOpenHouseBody.parse(req.body)));
}
export async function claim(req: Request, res: Response) {
  res.json(await service.claimOpenHouse(actor(req), idOf(req), claimBody.parse(req.body).claim));
}
export async function remove(req: Request, res: Response) {
  res.json(await service.removeOpenHouse(actor(req), idOf(req)));
}
