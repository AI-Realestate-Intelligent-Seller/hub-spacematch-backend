// HTTP only: validate input, call the service, send the result.
import type { Request, Response } from "express";
import type { AuthUser } from "../../types/auth.js";
import { notFound, unauthorized } from "../../utils/http-error.js";
import * as service from "./market-me.service.js";
import { createReviewBody, noteBody, settingsBody, statsBody, tokenParams } from "./market-me.validation.js";

function actor(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
const tokenOf = (req: Request) => {
  const p = tokenParams.safeParse(req.params);
  if (!p.success) throw notFound("This link isn't active anymore. Please contact your agent.");
  return p.data.token;
};

export async function getSettings(req: Request, res: Response) {
  res.json(await service.getSettings(actor(req)));
}
export async function saveSettings(req: Request, res: Response) {
  res.json(await service.saveSettings(actor(req), settingsBody.parse(req.body)));
}
export async function myReviews(req: Request, res: Response) {
  res.json(await service.myReviews(actor(req)));
}
export async function createReview(req: Request, res: Response) {
  const { clientName, channel } = createReviewBody.parse(req.body);
  res.status(201).json(await service.createReview(actor(req), clientName, channel));
}
export async function marketKit(req: Request, res: Response) {
  res.json(await service.marketKit(actor(req)));
}
export async function enterStats(req: Request, res: Response) {
  res.json(await service.enterStats(actor(req), statsBody.parse(req.body)));
}

// ---------- Public ----------
export async function reviewView(req: Request, res: Response) {
  const data = await service.reviewView(tokenOf(req));
  if (!data) throw notFound("This link isn't active anymore. Please contact your agent.");
  res.json(data);
}
export async function reviewOpen(req: Request, res: Response) {
  res.json(await service.reviewPing(tokenOf(req), "open"));
}
export async function reviewClick(req: Request, res: Response) {
  res.json(await service.reviewPing(tokenOf(req), "click"));
}
export async function reviewNote(req: Request, res: Response) {
  res.json(await service.reviewPing(tokenOf(req), "note", noteBody.parse(req.body).note));
}
