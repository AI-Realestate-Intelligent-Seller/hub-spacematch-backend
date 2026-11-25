// HTTP only: validate input, call the service, send the result.
import type { Request, Response } from "express";
import type { AuthUser } from "../../types/auth.js";
import { unauthorized } from "../../utils/http-error.js";
import * as service from "./email-template.service.js";
import { rateBody, reviewBody, saveTemplateBody, templateIdParams } from "./email-template.validation.js";

function actor(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

export async function overview(req: Request, res: Response) {
  res.json(await service.overview(actor(req)));
}

export async function create(req: Request, res: Response) {
  res.status(201).json(await service.createTemplate(actor(req), saveTemplateBody.parse(req.body)));
}

export async function update(req: Request, res: Response) {
  const { id } = templateIdParams.parse(req.params);
  res.json(await service.updateTemplate(actor(req), id, saveTemplateBody.parse(req.body)));
}

export async function remove(req: Request, res: Response) {
  const { id } = templateIdParams.parse(req.params);
  res.json(await service.removeTemplate(actor(req), id));
}

export async function suggest(req: Request, res: Response) {
  const { id } = templateIdParams.parse(req.params);
  res.json(await service.suggest(actor(req), id));
}

export async function review(req: Request, res: Response) {
  const { id } = templateIdParams.parse(req.params);
  const { approve, note } = reviewBody.parse(req.body);
  res.json(await service.review(actor(req), id, approve, note));
}

export async function setRate(req: Request, res: Response) {
  res.json(await service.setRate(actor(req), rateBody.parse(req.body).ratePct));
}
