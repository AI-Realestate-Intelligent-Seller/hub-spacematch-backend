// HTTP only: validate input, call the service, send the result.
import type { Request, Response } from "express";
import type { AuthUser } from "../../types/auth.js";
import { unauthorized } from "../../utils/http-error.js";
import * as service from "./ad-order.service.js";
import { decideBody, listingIdParams, orderIdParams, paymentBody, placeBody, pricingBody, statusBody } from "./ad-order.validation.js";

function actor(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
const idOf = (req: Request) => orderIdParams.parse(req.params).id;

export async function config(req: Request, res: Response) {
  res.json(await service.config(actor(req)));
}
export async function forListing(req: Request, res: Response) {
  res.json(await service.forListing(actor(req), listingIdParams.parse(req.params).listingId));
}
export async function place(req: Request, res: Response) {
  res.status(201).json(await service.place(actor(req), placeBody.parse(req.body)));
}
export async function cancel(req: Request, res: Response) {
  res.json(await service.cancel(actor(req), idOf(req)));
}
export async function mine(req: Request, res: Response) {
  res.json(await service.mine(actor(req)));
}
export async function queue(req: Request, res: Response) {
  res.json(await service.queue(actor(req)));
}
export async function decide(req: Request, res: Response) {
  const { action, tier, note } = decideBody.parse(req.body);
  res.json(await service.decide(actor(req), idOf(req), action, tier, note));
}
export async function setStatus(req: Request, res: Response) {
  res.json(await service.setStatus(actor(req), idOf(req), statusBody.parse(req.body).status));
}
export async function setPayment(req: Request, res: Response) {
  const { paymentStatus, note } = paymentBody.parse(req.body);
  res.json(await service.setPayment(actor(req), idOf(req), paymentStatus, note));
}
export async function savePricing(req: Request, res: Response) {
  res.json(await service.savePricing(actor(req), pricingBody.parse(req.body)));
}
