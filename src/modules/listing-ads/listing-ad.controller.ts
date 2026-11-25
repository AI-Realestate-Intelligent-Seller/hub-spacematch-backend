// HTTP only: validate input, call the service, send the result.
import type { Request, Response } from "express";
import type { AuthUser } from "../../types/auth.js";
import { idParam } from "../../utils/fields.js";
import { unauthorized } from "../../utils/http-error.js";
import * as service from "./listing-ad.service.js";
import { adParams, saveAdBody } from "./listing-ad.validation.js";

function actor(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

export async function list(req: Request, res: Response) {
  res.json(await service.forListing(actor(req), idParam.parse(req.params).id));
}
export async function save(req: Request, res: Response) {
  const { id, channel } = adParams.parse(req.params);
  res.json(await service.saveAd(actor(req), id, channel, saveAdBody.parse(req.body)));
}
