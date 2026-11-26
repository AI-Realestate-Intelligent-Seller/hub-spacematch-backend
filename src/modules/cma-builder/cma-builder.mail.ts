// Agent notifications for the CMA Builder. Sellers are never emailed from here: they see a CMA only
// after the agent publishes it (on their page and in the weekly report).
import { esc, hubLink, shell, table, textTable } from "../../integrations/email/layout.js";
import { sendMail } from "../../integrations/email/mailer.js";

const money = (n: number | null | undefined) => (n == null ? "–" : `$${Math.round(n).toLocaleString("en-US")}`);

export async function mailReadyForReview(a: { to: string; listingId: string; address: string; version: number; soldCount: number; estimate: number | null; insufficient: boolean }) {
  const rows: [string, string][] = [
    ["Listing", a.address],
    ["Sold comparables", String(a.soldCount)],
    ["Preliminary value", a.insufficient ? "Not enough data yet: add or import comparables" : money(a.estimate)],
  ];
  const link = hubLink(`/listings/${a.listingId}/cma`);
  const title = "Your CMA is ready for review";
  await sendMail({
    to: a.to,
    subject: `CMA ready for review · ${a.address}`,
    html: shell(title, `<p style="margin:0 0 12px">Version ${a.version} finished collecting. Review the comparables and the value before anything is shown to your seller.</p>${table(rows)}`, { href: link, label: "Open CMA Builder" }),
    text: `${title}\n\n${textTable(rows)}\n\nOpen CMA Builder: ${link}`,
    tag: "cma-builder:ready",
  });
}

export async function mailCollectionFailed(a: { to: string; listingId: string; address: string; message: string }) {
  const link = hubLink(`/listings/${a.listingId}/cma`);
  await sendMail({
    to: a.to,
    subject: `CMA collection stopped · ${a.address}`,
    html: shell("CMA collection stopped", `<p style="margin:0 0 12px">${esc(a.message)}</p><p>You can retry, pick another data source, or add comparables by hand / CSV in the CMA Builder.</p>`, { href: link, label: "Open CMA Builder" }),
    text: `CMA collection stopped\n\n${a.message}\n\nOpen CMA Builder: ${link}`,
    tag: "cma-builder:failed",
  });
}

export async function mailMarketChanged(a: { to: string; listingId: string; address: string; previous: number; next: number; changePct: number; newSales: number }) {
  const rows: [string, string][] = [
    ["Listing", a.address],
    ["Published value", money(a.previous)],
    ["New preliminary value", money(a.next)],
    ["Change", `${a.changePct > 0 ? "+" : ""}${a.changePct.toFixed(1)}%`],
    ["New comparable sales", String(a.newSales)],
  ];
  const link = hubLink(`/listings/${a.listingId}/cma`);
  await sendMail({
    to: a.to,
    subject: `Market update: CMA moved ${a.changePct > 0 ? "+" : ""}${a.changePct.toFixed(1)}% · ${a.address}`,
    html: shell("The weekly CMA refresh found a change", `<p style="margin:0 0 12px">A new draft is waiting for your review. Nothing changes for your seller until you publish it.</p>${table(rows)}`, { href: link, label: "Review the draft" }),
    text: `The weekly CMA refresh found a change\n\n${textTable(rows)}\n\nReview: ${link}`,
    tag: "cma-builder:market-changed",
  });
}
