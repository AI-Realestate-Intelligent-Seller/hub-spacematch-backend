import { z } from "zod";
import { idParam, optionalText } from "../../utils/fields.js";

/** Client groups in the email library (frontend/src/lib/emailLibrary.ts SEGMENTS) + "other". */
export const EMAIL_SEGMENTS = [
  "kickoff", "renters", "buyers-0-3", "buyers-3-6", "buyers-6-12", "buyers-1-3y", "sellers", "past-buyers", "past-sellers",
  "vendors", "mailer", "under-contract", "reviews", "expired", "open-house", "anniversary", "cold", "neighbors", "rate-drop", "other",
] as const;

/** Merge fields an email may use, e.g. {first_name}. */
export const MERGE_FIELDS = ["first_name", "agent_first", "agent_name", "agent_phone", "neighborhood"] as const;

const unknownFields = (s: string) => [...s.matchAll(/\{([^{}]*)\}/g)].map(m => m[1] ?? "").filter(k => !(MERGE_FIELDS as readonly string[]).includes(k));
const fieldsMsg = (s: string) => `Unknown field ${unknownFields(s).map(k => `{${k}}`).join(", ")}. Use the + buttons to add fields.`;

export const saveTemplateBody = z
  .object({
    title: z.string().trim().max(120, "Name is too long (120 characters max).").default(""),
    segment: z.enum(EMAIL_SEGMENTS, { error: "Pick who it's for." }),
    subject: z
      .string({ error: "Add a subject." })
      .trim()
      .min(1, "Add a subject.")
      .max(200, "Subject is too long (200 characters max).")
      .superRefine((v, ctx) => {
        if (unknownFields(v).length) ctx.addIssue({ code: "custom", message: fieldsMsg(v) });
      }),
    body: z
      .string({ error: "Write something in the email first." })
      .trim()
      .min(1, "Write something in the email first.")
      .min(20, "The email is too short to send (20 characters min).")
      .max(8000, "The email is too long (8000 characters max).")
      .superRefine((v, ctx) => {
        if (unknownFields(v).length) ctx.addIssue({ code: "custom", message: fieldsMsg(v) });
      }),
    basedOn: optionalText(80, "Based on").optional(),
  })
  .strict();

export const reviewBody = z.object({ approve: z.boolean(), note: optionalText(500, "Note").optional() }).strict();

export const rateBody = z
  .object({
    ratePct: z
      .number({ error: "Enter the rate as a number, e.g. 6.85." })
      .gt(1, "Enter a rate between 1% and 15%.")
      .lt(15, "Enter a rate between 1% and 15%.")
      .refine(v => Math.round(v * 1000) === v * 1000, "Use at most 3 decimals."),
  })
  .strict();

export const templateIdParams = idParam;
export type SaveTemplateInput = z.infer<typeof saveTemplateBody>;
