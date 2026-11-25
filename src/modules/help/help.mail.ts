// Help request emails (were help.notify / help.notifyAgent in Convex).
import { esc, hubLink, shell, table, textTable } from "../../integrations/email/layout.js";
import { sendMail } from "../../integrations/email/mailer.js";
import { HELP_STATUS_LABEL } from "../../shared/help-due.js";
import type { HelpRequestRow } from "./help.model.js";

const URGENCY: Record<string, string> = { now: "Urgent — within the hour", today: "Today", week: "This week" };

/** To the support person: someone needs help. */
export async function mailNewRequest(r: HelpRequestRow) {
  const rows: [string, string][] = [
    ["From", `${r.fromName} (${r.fromEmail})`],
    ["Needs help with", r.topic],
    ["When", URGENCY[r.urgency] ?? r.urgency],
    ["Details", r.details || "—"],
  ];
  const first = r.fromName.split(" ")[0] ?? r.fromName;
  const title = `${r.fromName} needs help: ${r.topic}`;
  await sendMail({
    to: r.toEmail,
    subject: `${r.urgency === "now" ? "URGENT · " : ""}Help request from ${r.fromName}: ${r.topic}`,
    html: shell(
      title,
      `<p style="color:#3d3a35;font-size:15px">Logged in the Agent Hub. Mark it done there when it's handled so ${esc(first)} sees it.</p>${table(rows)}`,
      { href: hubLink("/help"), label: "Open help requests" },
    ),
    text: `${title}\n\n${textTable(rows)}\n\nOpen help requests: ${hubLink("/help")}`,
    tag: "help:new",
  });
}

/** To the agent: their request moved. */
export async function mailStatusChange(r: HelpRequestRow, note: string) {
  const label = HELP_STATUS_LABEL[r.status] ?? r.status;
  const rows: [string, string][] = [
    ["Status", label],
    ["Handled by", r.toName],
    ...(note ? [["Note", note] as [string, string]] : []),
    ["Your request", r.details || r.topic],
  ];
  const title = `Your help request: ${label}`;
  await sendMail({
    to: r.fromEmail,
    subject: `Help request ${label.toLowerCase()}: ${r.topic}`,
    html: shell(
      title,
      `<p style="color:#3d3a35;font-size:15px">${esc(r.statusBy ?? r.toName)} updated your request <b>${esc(r.topic)}</b>.</p>${table(rows)}`,
      { href: hubLink("/help"), label: "Open help requests" },
    ),
    text: `${title}\n\n${textTable(rows)}\n\nOpen help requests: ${hubLink("/help")}`,
    tag: "help:status",
  });
}
