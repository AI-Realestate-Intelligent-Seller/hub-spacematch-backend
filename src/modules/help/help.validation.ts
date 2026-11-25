import { z } from "zod";
import { HELP_STATUSES } from "../../shared/help-due.js";
import { idParam, optionalText } from "../../utils/fields.js";

export const URGENCIES = ["now", "today", "week"] as const;

export const createHelpBody = z
  .object({
    toEmail: z.email("Pick someone from the support team.").transform(v => v.toLowerCase()),
    topic: z.string({ error: "Pick what you need help with." }).trim().min(1, "Pick what you need help with.").max(80, "Topic is too long (80 characters max)."),
    details: z.string().trim().max(2000, "Details are too long (2000 characters max).").default(""),
    urgency: z.enum(URGENCIES, { error: "Pick when you need it." }),
  })
  .strict();

export const setStatusBody = z
  .object({
    status: z.enum(HELP_STATUSES, { error: "Unknown status." }),
    reply: optionalText(1000, "Note").optional(),
  })
  .strict();

export const reassignBody = z.object({ toEmail: z.email("Pick someone from the support team.").transform(v => v.toLowerCase()) }).strict();

export const helpIdParams = idParam;
export type CreateHelpInput = z.infer<typeof createHelpBody>;
