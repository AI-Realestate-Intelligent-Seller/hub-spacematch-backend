// All database queries for email templates. Only email-template.service.ts calls this file.
import { desc, eq } from "drizzle-orm";
import { getOrm } from "../../db/client.js";
import { newId } from "../../utils/id.js";
import { type EmailTemplateRow, emailTemplates, type NewEmailTemplateRow } from "./email-template.model.js";

export async function listByOwner(email: string, limit = 200): Promise<EmailTemplateRow[]> {
  return getOrm().select().from(emailTemplates).where(eq(emailTemplates.ownerEmail, email)).orderBy(desc(emailTemplates.updatedAt)).limit(limit);
}

export async function listByStatus(status: string, limit = 200): Promise<EmailTemplateRow[]> {
  return getOrm().select().from(emailTemplates).where(eq(emailTemplates.status, status)).orderBy(desc(emailTemplates.updatedAt)).limit(limit);
}

export async function findTemplate(id: string): Promise<EmailTemplateRow | undefined> {
  const [row] = await getOrm().select().from(emailTemplates).where(eq(emailTemplates.id, id)).limit(1);
  return row;
}

export async function insertTemplate(values: Omit<NewEmailTemplateRow, "id">): Promise<EmailTemplateRow> {
  const [row] = await getOrm()
    .insert(emailTemplates)
    .values({ id: newId(), ...values })
    .returning();
  return row!;
}

export async function updateTemplate(id: string, patch: Partial<Omit<NewEmailTemplateRow, "id" | "createdAt">>): Promise<EmailTemplateRow | undefined> {
  const [row] = await getOrm()
    .update(emailTemplates)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(emailTemplates.id, id))
    .returning();
  return row;
}

export async function deleteTemplate(id: string): Promise<void> {
  await getOrm().delete(emailTemplates).where(eq(emailTemplates.id, id));
}
