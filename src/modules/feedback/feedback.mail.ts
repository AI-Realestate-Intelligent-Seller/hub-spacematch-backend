// Feedback emails (were feedback.mailAgent / mailBlocking in Convex).
import { esc, hubLink, shell, table, textTable } from "../../integrations/email/layout.js";
import { sendMail } from "../../integrations/email/mailer.js";
import { FEEDBACK_STATUS } from "../../shared/feedback-defs.js";
import type { FeedbackRow } from "./feedback.model.js";

const AGENT_LINE: Record<string, string> = {
  approved: "It's approved and goes into the next Hub update.",
  shipped: "It's live in the Hub now. Thanks for making the app better.",
  later: "Good idea, but not this round. It stays on the list for a later update.",
  declined: "The team decided not to build this one.",
};

/** To the agent: their idea was approved / shipped / put off / declined. */
export async function mailAgent(r: FeedbackRow) {
  const line = AGENT_LINE[r.status];
  if (!line) return;
  const label = FEEDBACK_STATUS[r.status] ?? r.status;
  const rows: [string, string][] = [["Your idea", r.title], ["Status", label], ...(r.decisionNote ? [["Note", r.decisionNote] as [string, string]] : [])];
  const title = `Your Hub idea: ${label}`;
  await sendMail({
    to: r.fromEmail,
    subject: `Your Hub idea is ${label.toLowerCase()}: ${r.title}`,
    html: shell(title, `<p style="color:#3d3a35;font-size:15px">${esc(line)}</p>${table(rows)}`, { href: hubLink("/feedback"), label: "See all ideas" }),
    text: `${title}\n\n${line}\n\n${textTable(rows)}\n\nSee all ideas: ${hubLink("/feedback")}`,
    tag: "feedback:decision",
  });
}

/** To admins: an agent is blocked by something broken. */
export async function mailBlocking(r: FeedbackRow, admins: string[]) {
  const rows: [string, string][] = [["From", `${r.fromName} (${r.fromEmail})`], ["Where", r.area], ["Problem", r.title], ["Details", r.details || "—"]];
  const title = `${r.fromName} is blocked: ${r.title}`;
  const line = "An agent reported something broken in the Hub that's stopping their work. Please look at it now, or it waits for the weekly review.";
  for (const to of admins) {
    await sendMail({
      to,
      subject: `BLOCKED · Hub problem from ${r.fromName}: ${r.title}`,
      html: shell(title, `<p style="color:#3d3a35;font-size:15px">${line}</p>${table(rows)}`, { href: hubLink("/feedback"), label: "Open feedback" }),
      text: `${title}\n\n${line}\n\n${textTable(rows)}\n\nOpen feedback: ${hubLink("/feedback")}`,
      tag: "feedback:blocking",
    });
  }
}
