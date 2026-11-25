import { z } from "zod";
import { FEEDBACK_AREAS, FEEDBACK_CATEGORIES, FEEDBACK_KINDS } from "../../shared/feedback-defs.js";
import { idParam, optionalText } from "../../utils/fields.js";

export const DECISIONS = ["approved", "building", "shipped", "later", "declined", "reviewed"] as const;
export const SHOT_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export const MAX_SHOT_BYTES = 4 * 1024 * 1024; // Vercel caps request bodies at 4.5 MB

export const createFeedbackBody = z
  .object({
    kind: z.enum(FEEDBACK_KINDS.map(k => k.id) as [string, ...string[]], { error: "Pick fix, make it better, or add-on." }),
    area: z.enum(FEEDBACK_AREAS, { error: "Pick where in the Hub." }),
    title: z.string({ error: "Add a short title." }).trim().min(4, "Add a short title (4 characters or more).").max(120, "Title is too long (120 characters max)."),
    details: z.string().trim().max(3000, "Details are too long (3000 characters max).").default(""),
    blocking: z.boolean().optional(),
    shotKey: z.string().max(200).nullable().optional(),
  })
  .strict();

export const decideBody = z
  .object({
    status: z.enum(DECISIONS, { error: "Unknown status." }),
    note: optionalText(1000, "Note").optional(),
    category: z
      .string()
      .refine(v => v in FEEDBACK_CATEGORIES, "Unknown category.")
      .optional(),
  })
  .strict();

export const feedbackIdParams = idParam;
export type CreateFeedbackInput = z.infer<typeof createFeedbackBody>;
