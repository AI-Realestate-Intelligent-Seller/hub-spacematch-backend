// HTTP only: validate input, call the service, send the result.
import type { Request, Response } from "express";
import type { AuthUser } from "../../types/auth.js";
import { unauthorized } from "../../utils/http-error.js";
import * as service from "./help.service.js";
import { createHelpBody, helpIdParams, reassignBody, setStatusBody } from "./help.validation.js";

function actor(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

export async function list(req: Request, res: Response) {
  res.json(await service.listRequests(actor(req)));
}

export async function create(req: Request, res: Response) {
  res.status(201).json(await service.createRequest(actor(req), createHelpBody.parse(req.body)));
}

export async function setStatus(req: Request, res: Response) {
  const { id } = helpIdParams.parse(req.params);
  const { status, reply } = setStatusBody.parse(req.body);
  res.json(await service.setStatus(actor(req), id, status, reply));
}

export async function reassign(req: Request, res: Response) {
  const { id } = helpIdParams.parse(req.params);
  res.json(await service.reassign(actor(req), id, reassignBody.parse(req.body).toEmail));
}
