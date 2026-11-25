// HTTP only: validate input, call the service, send the result.
import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { config } from "../../config/index.js";
import type { AuthUser } from "../../types/auth.js";
import { HttpError, unauthorized } from "../../utils/http-error.js";
import * as service from "./cma.service.js";
import { approvalBody, cmaIdParams, listPriceBody, quotaQuery, requestBody, STATUSES, uploadBody, workerFilesBody, workerStatusBody, workerUploadBody } from "./cma.validation.js";
import { z } from "zod";

function actor(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
const idOf = (req: Request) => cmaIdParams.parse(req.params).id;

export const me = (req: Request, res: Response) => res.json(service.me(actor(req)));
export async function quota(req: Request, res: Response) {
  res.json(await service.quota(actor(req), quotaQuery.parse(req.query).agentName));
}
export async function list(req: Request, res: Response) {
  res.json(await service.list(actor(req)));
}
export async function get(req: Request, res: Response) {
  res.json(await service.get(actor(req), idOf(req)));
}
export async function upload(req: Request, res: Response) {
  res.status(201).json(await service.createUpload(actor(req), uploadBody.parse(req.body)));
}
export async function submit(req: Request, res: Response) {
  res.status(201).json(await service.submit(actor(req), requestBody.parse(req.body)));
}
export async function update(req: Request, res: Response) {
  res.json(await service.update(actor(req), idOf(req), requestBody.parse(req.body)));
}
export async function setListPrice(req: Request, res: Response) {
  const { listPrice, note } = listPriceBody.parse(req.body);
  res.json(await service.setListPrice(actor(req), idOf(req), listPrice, note));
}
export async function approval(req: Request, res: Response) {
  res.json(await service.decideApproval(actor(req), idOf(req), approvalBody.parse(req.body).approve));
}

// ---------- CMA builder (x-worker-key) ----------
export function requireWorkerKey(req: Request, _res: Response, next: NextFunction) {
  const key = config.cmaWorker.key;
  if (!key) throw new HttpError(503, "not_configured", "The CMA worker routes are off (CMA_WORKER_KEY is not set).");
  const sent = Buffer.from(req.header("x-worker-key") ?? "");
  const want = Buffer.from(key);
  if (sent.length !== want.length || !timingSafeEqual(sent, want)) throw unauthorized("Wrong worker key.");
  next();
}
export async function workerPending(_req: Request, res: Response) {
  res.json(await service.workerPending());
}
export async function workerList(req: Request, res: Response) {
  res.json(await service.workerList(z.object({ status: z.enum(STATUSES) }).parse(req.query).status));
}
export async function workerGet(req: Request, res: Response) {
  res.json(await service.workerGet(idOf(req)));
}
export async function workerStatus(req: Request, res: Response) {
  res.json(await service.workerSetStatus(workerStatusBody.parse(req.body)));
}
export async function workerUploadUrl(req: Request, res: Response) {
  const { id, file, contentType } = workerUploadBody.parse(req.body);
  res.json(await service.workerUploadUrl(id, file, contentType));
}
export async function workerFiles(req: Request, res: Response) {
  res.json(await service.workerFiles(workerFilesBody.parse(req.body)));
}
