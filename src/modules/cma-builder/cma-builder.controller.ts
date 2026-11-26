// HTTP only: validate input, call the service, send the result.
import type { Request, Response } from "express";
import type { AuthUser } from "../../types/auth.js";
import { unauthorized } from "../../utils/http-error.js";
import { approvedFacts } from "./cma-builder.public.js";
import * as service from "./cma-builder.service.js";
import * as v from "./cma-builder.validation.js";

function actor(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
const listingId = (req: Request) => v.listingParams.parse(req.params).id;
const reportId = (req: Request) => v.reportParams.parse(req.params).id;

/** Report HTML is shown in a sandboxed iframe: no scripts, no outside requests. */
function sendReportHtml(res: Response, html: string) {
  res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'self'");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.type("html").send(html);
}

// ---------- /listings/:id/cma ----------
export const providers = (_req: Request, res: Response) => res.json(service.providers());
export async function defaults(req: Request, res: Response) {
  res.json(await service.defaults(actor(req), listingId(req)));
}
export async function request(req: Request, res: Response) {
  res.status(202).json(await service.request(actor(req), listingId(req), v.requestBody.parse(req.body)));
}
export async function status(req: Request, res: Response) {
  res.json(await service.status(actor(req), listingId(req)));
}
export async function current(req: Request, res: Response) {
  res.json(await service.current(actor(req), listingId(req)));
}
export async function history(req: Request, res: Response) {
  const q = v.historyQuery.parse(req.query);
  res.json(await service.history(actor(req), listingId(req), q.limit, q.offset));
}
export async function context(req: Request, res: Response) {
  res.json(await service.context(actor(req), listingId(req)));
}
export async function facts(req: Request, res: Response) {
  const id = listingId(req);
  await service.status(actor(req), id); // access check
  res.json(await approvedFacts(id));
}

// ---------- /cma-reports/:id ----------
export async function listRequests(req: Request, res: Response) {
  res.json(await service.listRequests(actor(req)));
}
export async function get(req: Request, res: Response) {
  res.json(await service.get(actor(req), reportId(req)));
}
export async function update(req: Request, res: Response) {
  res.json(await service.update(actor(req), reportId(req), v.patchReportBody.parse(req.body)));
}
export async function comparables(req: Request, res: Response) {
  res.json(await service.comparables(actor(req), reportId(req)));
}
export async function addComparable(req: Request, res: Response) {
  res.status(201).json(await service.addComparable(actor(req), reportId(req), v.addCompBody.parse(req.body)));
}
export async function updateComparable(req: Request, res: Response) {
  const p = v.compParams.parse(req.params);
  res.json(await service.updateComparable(actor(req), p.id, p.comparableId, v.patchCompBody.parse(req.body)));
}
export async function removeComparable(req: Request, res: Response) {
  const p = v.compParams.parse(req.params);
  res.json(await service.removeComparable(actor(req), p.id, p.comparableId));
}
export async function selection(req: Request, res: Response) {
  res.json(await service.setSelection(actor(req), reportId(req), v.selectionBody.parse(req.body).selectedIds));
}
export async function importCsv(req: Request, res: Response) {
  res.json(await service.importCsv(actor(req), reportId(req), v.importBody.parse(req.body).csv));
}
export async function calculate(req: Request, res: Response) {
  res.json(await service.calculate(actor(req), reportId(req)));
}
export async function publish(req: Request, res: Response) {
  v.publishBody.parse(req.body);
  res.json(await service.publish(actor(req), reportId(req)));
}
export async function revise(req: Request, res: Response) {
  res.json(await service.revise(actor(req), reportId(req)));
}
export async function refresh(req: Request, res: Response) {
  const { provider } = v.refreshBody.parse(req.body ?? {});
  res.status(202).json(await service.refresh(actor(req), reportId(req), { provider }));
}
export async function retry(req: Request, res: Response) {
  res.status(202).json(await service.retry(actor(req), reportId(req)));
}
export async function cancel(req: Request, res: Response) {
  res.json(await service.cancel(actor(req), reportId(req)));
}
export async function preview(req: Request, res: Response) {
  sendReportHtml(res, await service.previewHtml(actor(req), reportId(req), req.query.audience === "seller" ? "seller" : "agent"));
}
export async function pdf(req: Request, res: Response) {
  res.setHeader("Cache-Control", "no-store");
  res.json(await service.pdf(actor(req), reportId(req), req.query.format === "pptx" ? "pptx" : "pdf", req.query.download === "1"));
}

// ---------- /portal/:token/cma (seller, public) ----------
const token = (req: Request) => v.tokenParams.parse(req.params).token;
export async function sellerCma(req: Request, res: Response) {
  res.setHeader("Cache-Control", "no-store");
  res.json(await service.sellerCma(token(req)));
}
export async function sellerReport(req: Request, res: Response) {
  sendReportHtml(res, await service.sellerReportHtml(token(req)));
}
export async function sellerPdf(req: Request, res: Response) {
  res.setHeader("Cache-Control", "no-store");
  res.json(await service.sellerPdf(token(req), req.query.format === "pptx" ? "pptx" : "pdf", req.query.download === "1"));
}
