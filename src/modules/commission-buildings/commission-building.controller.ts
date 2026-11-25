// HTTP only: validate input, call the service, send the result.
import type { Request, Response } from "express";
import type { AuthUser } from "../../types/auth.js";
import { unauthorized } from "../../utils/http-error.js";
import * as service from "./commission-building.service.js";
import { addBuildingBody, buildingIdParams, moderateBody, reportBody, updateBuildingBody, verifyBody } from "./commission-building.validation.js";

function actor(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
const idOf = (req: Request) => buildingIdParams.parse(req.params).id;

export async function list(req: Request, res: Response) {
  res.json(await service.listBuildings(actor(req)));
}
export async function create(req: Request, res: Response) {
  res.status(201).json(await service.addBuilding(actor(req), addBuildingBody.parse(req.body)));
}
export async function update(req: Request, res: Response) {
  res.json(await service.updateBuilding(actor(req), idOf(req), updateBuildingBody.parse(req.body)));
}
export async function remove(req: Request, res: Response) {
  res.json(await service.removeBuilding(actor(req), idOf(req)));
}
export async function verify(req: Request, res: Response) {
  const { verified, how } = verifyBody.parse(req.body);
  res.json(await service.verifyBuilding(actor(req), idOf(req), verified, how));
}
export async function report(req: Request, res: Response) {
  res.json(await service.reportBuilding(actor(req), idOf(req), reportBody.parse(req.body).note));
}
export async function moderate(req: Request, res: Response) {
  res.json(await service.moderateBuilding(actor(req), idOf(req), moderateBody.parse(req.body)));
}
