// Shared look for Hub notification emails (was shell/table/esc in the old convex/notify.ts).
import { config } from "../../config/index.js";

export const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Link to a page in the Hub web app, e.g. hubLink("/help"). */
export const hubLink = (path: string) => `${config.appUrl}${path.startsWith("/") ? path : `/${path}`}`;

/** Two-column details table. Values are escaped; new lines become <br>. */
export function table(rows: [string, string][]): string {
  return `<table style="border-collapse:collapse;width:100%;margin:14px 0">${rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:8px 12px;border-bottom:1px solid #eee;color:#6b665d;font-size:13px;width:40%;vertical-align:top">${esc(k)}</td><td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:14px;color:#0A0A0A">${esc(v).replace(/\n/g, "<br>")}</td></tr>`,
    )
    .join("")}</table>`;
}

/** Page frame with a title, body HTML and an optional button. `brand` is the small header line
 *  (emails to sellers say "SPACEMATCH" instead of "SPACEMATCH · AGENT HUB"). */
export function shell(title: string, bodyHtml: string, cta?: { href: string; label: string }, brand = "SPACEMATCH · AGENT HUB"): string {
  return `<!doctype html><html><body style="margin:0;background:#F7F5F1;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:560px;margin:0 auto;padding:28px 20px">
  <div style="font-size:11px;letter-spacing:4px;color:#9C7434;font-weight:700;margin-bottom:14px">${esc(brand)}</div>
  <div style="background:#fff;border-radius:16px;padding:24px">
    <h2 style="font-family:Georgia,serif;color:#0A0A0A;margin:0 0 14px;font-size:22px">${esc(title)}</h2>
    ${bodyHtml}
    ${cta ? `<p style="margin:22px 0 0"><a href="${esc(cta.href)}" style="background:#9C7434;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:700;display:inline-block">${esc(cta.label)}</a></p>` : ""}
  </div>
</div></body></html>`;
}

/** Plain-text version of a table, for the text part of the email. */
export const textTable = (rows: [string, string][]) => rows.map(([k, v]) => `${k}: ${v}`).join("\n");
