import { z } from "zod";
import { blankToNull, idParam, optionalText } from "../../utils/fields.js";

export const AD_STATUSES = ["not_started", "scheduled", "running", "paused", "ended"] as const;

const day = z.preprocess(
  blankToNull,
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a real date.")
    .refine(v => !Number.isNaN(Date.parse(`${v}T12:00:00Z`)), "Use a real date.")
    .nullable(),
);
const amount = (label: string) =>
  z.preprocess(
    blankToNull,
    z
      .number({ error: `${label} must be a number.` })
      .min(0, `${label} can't be negative.`)
      .max(1_000_000_000, `${label} looks too high.`)
      .transform(v => Math.round(v * 100) / 100)
      .nullable(),
  );
const httpsLink = z.preprocess(
  blankToNull,
  z
    .string()
    .trim()
    .max(600, "Ad link is too long.")
    .refine(v => {
      try {
        return new URL(v).protocol === "https:";
      } catch {
        return false;
      }
    }, "Ad link must be a full link starting with https://")
    .nullable(),
);

export const saveAdBody = z
  .object({
    status: z.enum(AD_STATUSES, { error: "Pick a status." }),
    startDate: day.optional(),
    endDate: day.optional(),
    reach: amount("Reach").optional(),
    clicks: amount("Clicks").optional(),
    leads: amount("Leads").optional(),
    spend: amount("Spend").optional(),
    budget: amount("Budget").optional(),
    campaignRef: optionalText(200, "Campaign name").optional(),
    adLink: httpsLink.optional(),
    note: optionalText(400, "Note").optional(),
  })
  .strict()
  .refine(v => !v.startDate || !v.endDate || v.endDate >= v.startDate, { message: "End date is before the start date.", path: ["endDate"] });

export const adParams = idParam.extend({ channel: z.enum(["meta", "google", "lofty"], { error: "Unknown channel." }) });
export type SaveAdInput = z.infer<typeof saveAdBody>;
