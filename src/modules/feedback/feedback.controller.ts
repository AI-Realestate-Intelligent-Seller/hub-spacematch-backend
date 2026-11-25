// HTTP only: validate input, call the service, send the result.
import type { Request, Response } from "express";
import type { AuthUser } from "../../types/auth.js";
import { badRequest, unauthorized } from "../../utils/http-error.js";
import * as service from "./feedback.service.js";
import { createFeedbackBody, decideBody, feedbackIdParams } from "./feedback.validation.js";

function actor(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
const idOf = (req: Request) => feedbackIdParams.parse(req.params).id;

export async function list(req: Request, res: Response) {
  res.json(await service.listFeedback(actor(req)));
}
/** Raw image bytes in the body; Content-Type is the image type. */
export async function uploadShot(req: Request, res: Response) {
  if (!Buffer.isBuffer(req.body)) throw badRequest("Send the screenshot as an image (PNG, JPG, WebP or GIF).");
  res.status(201).json(await service.uploadShot(actor(req), req.body, (req.headers["content-type"] ?? "").split(";")[0]!.trim()));
}
export async function create(req: Request, res: Response) {
  res.status(201).json(await service.createFeedback(actor(req), createFeedbackBody.parse(req.body)));
}
export async function vote(req: Request, res: Response) {
  res.json(await service.toggleVote(actor(req), idOf(req)));
}
export async function decide(req: Request, res: Response) {
  const { status, note, category } = decideBody.parse(req.body);
  res.json(await service.decide(actor(req), idOf(req), status, note, category));
}
export async function remove(req: Request, res: Response) {
  res.json(await service.removeFeedback(actor(req), idOf(req)));
}
