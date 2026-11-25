// Ad order emails (were adOrders.mailAdmins / mailAgent in Convex).
import { esc, hubLink, shell, table, textTable } from "../../integrations/email/layout.js";
import { sendMail } from "../../integrations/email/mailer.js";
import { streetOf } from "../../shared/ad-kit.js";
import type { AdOrderRow } from "./ad-order.model.js";

export const TIER_NAME: Record<string, string> = { essential: "Essential", signature: "Signature", luxury: "Luxury" };
const money = (n: number) => `$${n.toLocaleString("en-US")}`;

const orderRows = (o: AdOrderRow): [string, string][] => [
  ["Listing", o.address],
  ["Agent", o.agentName],
  ["Package", `${TIER_NAME[o.tier] ?? o.tier}${o.openHouse ? " + open house" : ""}`],
  ["Ad spend", money(o.spend)],
  ["SpaceMatch fee", money(o.fee + o.surcharge)],
  ["Total", money(o.total)],
  ["Payment", o.payment === "ahead" ? "Pay ahead (Zelle or check)" : "From commission at closing"],
  ["Agent note", o.note ?? ""],
];

/** To admins/ops: a new order to approve. */
export async function mailNewOrder(o: AdOrderRow, to: string[]) {
  const title = `Ad order: ${streetOf(o.address)}`;
  const line = `${o.agentName} ordered listing ads and authorized the charge.`;
  for (const t of to) {
    await sendMail({
      to: t,
      subject: `🟡 Ad order to approve — ${streetOf(o.address)} (${o.agentName})`,
      html: shell(title, `<p style="margin:0 0 14px">${esc(line)}</p>${table(orderRows(o))}`, { href: hubLink("/ad-orders"), label: "Approve or decline" }),
      text: `${title}\n\n${line}\n\n${textTable(orderRows(o))}\n\nApprove or decline: ${hubLink("/ad-orders")}`,
      tag: "ad-order:new",
    });
  }
}

/** To the agent (and whoever ordered, plus ops for pay-at-closing): approved or declined. */
export async function mailDecision(o: AdOrderRow, to: string[]) {
  const ok = o.status === "approved";
  const how = o.payment === "ahead"
    ? "Please send payment by Zelle or check; an admin marks it paid."
    : "It comes out of your commission at closing. If this listing doesn't close, it carries to your next closing.";
  const title = ok ? `Ads approved: ${streetOf(o.address)}` : `Ad order declined: ${streetOf(o.address)}`;
  const line = ok
    ? `Your ${TIER_NAME[o.tier] ?? o.tier} package is approved. The ad kit (copy, YouTube script, campaign names, tracking links) is on the listing's Ads & web tab. ${how}`
    : "An admin declined this order.";
  const link = o.listingId ? hubLink(`/listings/${o.listingId}`) : hubLink("/ad-orders");
  for (const t of to) {
    await sendMail({
      to: t,
      subject: `${ok ? "✅ Ads approved" : "Ad order declined"} — ${streetOf(o.address)}`,
      html: shell(title, `<p style="margin:0 0 14px">${esc(line)}</p>${o.adminNote ? `<p style="margin:0 0 14px"><b>Note:</b> ${esc(o.adminNote)}</p>` : ""}${table(orderRows(o))}`, { href: link, label: "Open the listing" }),
      text: `${title}\n\n${line}${o.adminNote ? `\nNote: ${o.adminNote}` : ""}\n\n${textTable(orderRows(o))}\n\nOpen the listing: ${link}`,
      tag: "ad-order:decision",
    });
  }
}
