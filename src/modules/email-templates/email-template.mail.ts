// Template review emails (were emailTemplates.mailReview / mailOwner in Convex).
import { hubLink, shell, table, textTable } from "../../integrations/email/layout.js";
import { sendMail } from "../../integrations/email/mailer.js";
import type { EmailTemplateRow } from "./email-template.model.js";

/** To each reviewer (admins + ops): an agent suggested a template for the team. */
export async function mailReviewers(r: EmailTemplateRow, reviewers: string[]) {
  const rows: [string, string][] = [["Template", r.title], ["Subject", r.subject], ["Email", r.body.slice(0, 600) + (r.body.length > 600 ? "…" : "")]];
  const title = `${r.ownerName} suggested an email for the team`;
  for (const to of reviewers) {
    await sendMail({
      to,
      subject: `Email template to review: ${r.title}`,
      html: shell(title, `<p style="color:#3d3a35;font-size:15px">Approve it and every agent gets it in their Emails library.</p>${table(rows)}`, {
        href: hubLink("/emails?tab=review"),
        label: "Review it",
      }),
      text: `${title}\n\n${textTable(rows)}\n\nReview it: ${hubLink("/emails?tab=review")}`,
      tag: "email-template:review",
    });
  }
}

/** To the owner: approved or not. */
export async function mailOwner(r: EmailTemplateRow) {
  if (r.status !== "team" && r.status !== "declined") return;
  const ok = r.status === "team";
  const rows: [string, string][] = [["Template", r.title], ...(r.reviewNote ? [["Note", r.reviewNote] as [string, string]] : [])];
  const title = ok ? "Your email is in the team library" : "Your email wasn't added to the team library";
  const line = ok ? "Every agent can use it now. Thanks for sharing it." : "It's still saved under My templates for you to use.";
  await sendMail({
    to: r.ownerEmail,
    subject: ok ? `Approved: ${r.title}` : `Not added: ${r.title}`,
    html: shell(title, `<p style="color:#3d3a35;font-size:15px">${line}</p>${table(rows)}`, { href: hubLink("/emails?tab=mine"), label: "Open Emails" }),
    text: `${title}\n\n${line}\n${textTable(rows)}\n\nOpen Emails: ${hubLink("/emails?tab=mine")}`,
    tag: "email-template:decision",
  });
}
