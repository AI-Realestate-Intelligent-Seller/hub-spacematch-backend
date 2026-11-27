// HTTP only: validate input, call the service, send the result.
import type { Request, Response } from "express";
import type { AuthUser } from "../../types/auth.js";
import { idParam } from "../../utils/fields.js";
import { unauthorized } from "../../utils/http-error.js";
import * as service from "./listing-social.service.js";
import { fetchBody } from "./listing-social.validation.js";

function actor(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

export async function get(req: Request, res: Response) {
  res.json(await service.getSocial(actor(req), idParam.parse(req.params).id, req.query.live === "1"));
}
export async function fetchNow(req: Request, res: Response) {
  res.json(await service.fetchStats(actor(req), idParam.parse(req.params).id, fetchBody.parse(req.body)));
}
export async function saveLinks(req: Request, res: Response) {
  res.json(await service.saveLinks(actor(req), idParam.parse(req.params).id, fetchBody.parse(req.body)));
}
