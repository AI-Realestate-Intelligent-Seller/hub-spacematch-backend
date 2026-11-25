// "Extra CMA needs your OK" (was notify.cmaApprovalNeeded): to admins when a request is over the limit.
import { esc, hubLink, shell, table, textTable } from "../../integrations/email/layout.js";
import { sendMail } from "../../integrations/email/mailer.js";
import type { CmaRequestRow } from "./cma.model.js";

export async function mailApprovalNeeded(r: CmaRequestRow, admins: string[]) {
  const rows: [string, string][] = [
    ["Agent", r.agentName],
    ["Client", r.clientName],
    ["Address", `${r.street}${r.unit ? ` #${r.unit}` : ""}, ${r.city}`],
    ["Purpose", r.purpose],
  ];
  const title = "Extra CMA needs your OK";
  for (const to of admins) {
    await sendMail({
      to,
      subject: `CMA approval: ${r.agentName} — ${r.street}`,
      html: shell(title, `<p style="margin:0 0 14px">${esc(r.statusNote ?? "")}</p>${table(rows)}`, { href: hubLink("/requests"), label: "Approve or decline" }),
      text: `${title}\n\n${r.statusNote ?? ""}\n\n${textTable(rows)}\n\nApprove or decline: ${hubLink("/requests")}`,
      tag: "cma:approval-needed",
    });
  }
}
