import { z } from "zod";
import { blankToNull, idParam, optionalEmail, optionalPhone, optionalText, optionalWebsite } from "../../utils/fields.js";

export const MIN_PCT = 100;
export const MAX_PCT = 400;
export const VERIFY_HOW = ["Building's own broker page", "Broker email or flyer from the building", "Called the leasing office", "We were paid this on a deal"] as const;
export const CONFIRM_HOW = ["Building's own website or broker page", "Email from the building", "Called the leasing office", "Happened on one of our deals"] as const;

const offerEnds = z.preprocess(
  blankToNull,
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a real date.")
    .refine(v => !Number.isNaN(Date.parse(`${v}T12:00:00Z`)), "Use a real date.")
    .nullable(),
);

const buildingFields = z.object({
  name: optionalText(120, "Building name"),
  address: z
    .string({ error: "Add the building's street address." })
    .trim()
    .min(1, "Add the building's street address.")
    .max(200, "Address is too long (200 characters max).")
    .refine(v => /\d/.test(v), "The address needs a street number."),
  neighborhood: optionalText(160, "Neighborhood"),
  manager: optionalText(160, "Management company"),
  commissionPct: z.number({ error: "Enter the percent as a number." }).int("Use a whole number."),
  status: z.enum(["pays", "no_pay"]).default("pays"),
  noPayReason: z.enum(["none", "under", "unpaid"]).nullable().optional(),
  bonus: optionalText(160, "Bonus"),
  keyRule: optionalText(160, "Rule"),
  terms: optionalText(1500, "How to get paid"),
  phone: optionalPhone,
  email: optionalEmail,
  brokerUrl: optionalWebsite,
  website: optionalWebsite,
  sourceNote: optionalText(400, "How you know"),
  sourceUrl: optionalWebsite,
  offerEnds,
});

/** The percent rules depend on the list (same messages as before). */
function checkPct(v: z.infer<typeof buildingFields>, ctx: z.RefinementCtx) {
  const pct = v.commissionPct;
  if (v.status === "no_pay") {
    if ((v.noPayReason ?? "none") === "under" && (pct < 1 || pct >= MIN_PCT)) {
      ctx.addIssue({ code: "custom", path: ["commissionPct"], message: "Enter what it pays as a percent of one month's rent, from 1 to 99. If it pays 100% or more, add it to the 100% list." });
    }
  } else if (pct < MIN_PCT) {
    ctx.addIssue({ code: "custom", path: ["commissionPct"], message: "This list is only for buildings paying 100% of a month's rent or more. If it pays less, add it under Doesn't pay." });
  } else if (pct > MAX_PCT) {
    ctx.addIssue({ code: "custom", path: ["commissionPct"], message: `${pct}% looks too high. Enter the percent of one month's rent (100 = a full month).` });
  }
}

export const addBuildingBody = buildingFields
  .extend({ verify: z.boolean().optional(), verifiedHow: optionalText(160, "How you confirmed it").optional() })
  .strict()
  .superRefine((v, ctx) => {
    checkPct(v, ctx);
    if (!v.sourceNote && !v.sourceUrl) {
      ctx.addIssue({ code: "custom", path: ["sourceNote"], message: "Tell the team how you know: a link, a broker email, a call or a deal you closed there." });
    }
  });

export const updateBuildingBody = buildingFields.strict().superRefine(checkPct);

export const verifyBody = z
  .object({ verified: z.boolean(), how: optionalText(160, "How you confirmed it").optional() })
  .strict()
  .refine(v => !v.verified || !!v.how, { message: "Say how you confirmed it.", path: ["how"] });

export const reportBody = z
  .object({ note: z.string({ error: "Say what changed." }).trim().min(4, "Say what changed.").max(400, "Note is too long (400 characters max).") })
  .strict();

export const moderateBody = z
  .object({ hidden: z.boolean().optional(), clearReport: z.boolean().optional() })
  .strict()
  .refine(v => v.hidden !== undefined || v.clearReport, { message: "Nothing to change." });

export const buildingIdParams = idParam;
export type AddBuildingInput = z.infer<typeof addBuildingBody>;
export type UpdateBuildingInput = z.infer<typeof updateBuildingBody>;
