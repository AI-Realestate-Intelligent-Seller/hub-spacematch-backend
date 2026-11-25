// One short email to admins/ops when a building needs their stamp or an agent reports a change.
import { hubLink, shell, table, textTable } from "../../integrations/email/layout.js";
import { sendMail } from "../../integrations/email/mailer.js";
import type { CommissionBuildingRow } from "./commission-building.model.js";

export async function mailStaff(b: CommissionBuildingRow, kind: "added" | "reported", staff: string[]) {
  const added = kind === "added";
  const noPay = b.status === "no_pay";
  const pays = noPay
    ? b.noPayReason === "under"
      ? `Pays ${b.commissionPct}% of one month's rent (under a full month)`
      : b.noPayReason === "unpaid" ? "Didn't pay on a deal" : "No broker commission"
    : `${b.commissionPct}% of one month's rent${b.bonus ? ` + ${b.bonus}` : ""}`;
  const title = added
    ? noPay ? `${b.addedByName} added a building that doesn't pay` : `${b.addedByName} added a 100% commission building`
    : `${b.flaggedByName ?? "An agent"} reported a change at ${b.name}`;
  const line = added
    ? noPay
      ? "Confirm it with the building (their website, an email or a call), then tap Confirm so agents see the stamp."
      : "Confirm it with the building (broker page, flyer or a call), then tap Verify so agents see the stamp."
    : "Re-check it with the building. Stamp it again if nothing changed, or edit, move or remove it.";
  const rows: [string, string][] = [
    ["Building", `${b.name} · ${b.address}`],
    ["List", noPay ? "Doesn't pay" : "Pays 100% or more"],
    ["Commission", pays],
    ["Managed by", b.manager ?? ""],
    [added ? "How they know" : "What changed", (added ? [b.sourceNote, b.sourceUrl].filter(Boolean).join(" · ") : b.flagNote) ?? ""],
  ];
  const link = hubLink(`/commission-rentals?b=${b.id}${noPay ? "&list=nopay" : ""}`);
  for (const to of staff) {
    await sendMail({
      to,
      subject: title,
      html: shell(title, `<p style="color:#3d3a35;font-size:15px">${line}</p>${table(rows)}`, { href: link, label: "Open the building" }),
      text: `${title}\n\n${line}\n\n${textTable(rows)}\n\nOpen the building: ${link}`,
      tag: `commission-building:${kind}`,
    });
  }
}
