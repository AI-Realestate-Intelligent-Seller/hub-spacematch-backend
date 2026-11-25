// HTTP only: validate input, call the service, send the result.
import type { Request, Response } from "express";
import type { AuthUser } from "../../types/auth.js";
import { unauthorized } from "../../utils/http-error.js";
import * as service from "./vendor.service.js";
import { moderateBody, rateBody, vendorBody, vendorIdParams } from "./vendor.validation.js";

function actor(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

export async function list(req: Request, res: Response) {
  res.json(await service.listVendors(actor(req)));
}

export async function create(req: Request, res: Response) {
  res.status(201).json(await service.addVendor(actor(req), vendorBody.parse(req.body)));
}

export async function update(req: Request, res: Response) {
  const { id } = vendorIdParams.parse(req.params);
  res.json(await service.updateVendor(actor(req), id, vendorBody.parse(req.body)));
}

export async function remove(req: Request, res: Response) {
  const { id } = vendorIdParams.parse(req.params);
  res.json(await service.removeVendor(actor(req), id));
}

export async function moderate(req: Request, res: Response) {
  const { id } = vendorIdParams.parse(req.params);
  res.json(await service.moderateVendor(actor(req), id, moderateBody.parse(req.body)));
}

export async function rate(req: Request, res: Response) {
  const { id } = vendorIdParams.parse(req.params);
  const { rating, note } = rateBody.parse(req.body);
  res.json(await service.rateVendor(actor(req), id, rating, note));
}

export async function publicPros(_req: Request, res: Response) {
  res.json({ items: await service.publicPros() });
}
