// HTTP only: validate input, call the service, send the result.
import type { Request, Response } from "express";
import type { AuthUser } from "../../types/auth.js";
import { unauthorized } from "../../utils/http-error.js";
import * as service from "./user.service.js";
import {
  adminUpdateUserBody,
  invitationEmailParams,
  inviteBody,
  listUsersQuery,
  updateMeBody,
  userIdParams,
} from "./user.validation.js";

function actor(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

export async function getMe(req: Request, res: Response) {
  res.json(await service.getMe(actor(req)));
}

export async function updateMe(req: Request, res: Response) {
  res.json(await service.updateMe(actor(req), updateMeBody.parse(req.body)));
}

export async function listUsers(req: Request, res: Response) {
  res.json({ items: await service.listUsers(listUsersQuery.parse(req.query)) });
}

export async function adminUpdateUser(req: Request, res: Response) {
  const { id } = userIdParams.parse(req.params);
  res.json(await service.adminUpdateUser(actor(req), id, adminUpdateUserBody.parse(req.body)));
}

export async function listInvitations(_req: Request, res: Response) {
  res.json({ items: await service.listInvitations() });
}

export async function inviteUser(req: Request, res: Response) {
  res.status(201).json(await service.inviteUser(actor(req), inviteBody.parse(req.body)));
}

export async function revokeInvitation(req: Request, res: Response) {
  const { email } = invitationEmailParams.parse(req.params);
  res.json(await service.revokeInvitation(email));
}
