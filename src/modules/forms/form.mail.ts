import { eq } from "drizzle-orm";
import { getOrm } from "../../db/client.js";
import { hubLink, shell } from "../../integrations/email/layout.js";
import { sendMail } from "../../integrations/email/mailer.js";
import { formById } from "./form-catalog.js";
import { formSubmissions } from "./form.model.js";

export async function notifyFormReceived(id: string) {
  const [row] = await getOrm().select().from(formSubmissions).where(eq(formSubmissions.id, id)).limit(1);
  if (!row) return;
  const title = formById(row.formId)?.title ?? "Form";
  const href = hubLink(`/inbox?open=${encodeURIComponent(id)}`);
  const result = await sendMail({
    to: row.agentEmail ?? "team@spacematchinc.com",
    subject: `New submission · ${title}`,
    text: `A new form response is in your Hub inbox.\n${href}`,
    html: shell("New form response", "<p>A new response is in your Hub inbox.</p>", { href, label: "Open response" }),
    tag: "forms.received",
  });
  if (result.status === "failed") throw new Error("Form notification delivery failed.");
}
