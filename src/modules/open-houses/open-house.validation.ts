import { z } from "zod";
import { blankToNull, idParam, optionalText } from "../../utils/fields.js";

export const chicagoDate = (t = Date.now()) => new Date(t).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const addOpenHouseBody = z
  .object({
    listingId: z.preprocess(blankToNull, z.string().max(64).nullable()).optional(),
    address: z.preprocess(
      blankToNull,
      z.string().trim().max(160, "Address is too long (160 characters max).").refine(v => /\d/.test(v), "The address needs a street number.").nullable(),
    ).optional(),
    date: z
      .string({ error: "Pick a date." })
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.")
      .refine(v => v >= chicagoDate(), "Pick a date from today on.")
      .refine(v => v <= chicagoDate(Date.now() + 365 * 864e5), "Pick a date within the next year."),
    start: z.string({ error: "Pick a start time." }).regex(HHMM, "Pick a start time."),
    end: z.string({ error: "Pick an end time." }).regex(HHMM, "Pick an end time."),
    hostMe: z.boolean(),
    notes: optionalText(300, "Notes").optional(),
  })
  .strict()
  .refine(v => v.end > v.start, { message: "End time must be after the start time.", path: ["end"] })
  .refine(v => !!v.listingId || !!v.address, { message: "Pick a listing or type the address.", path: ["address"] });

export const claimBody = z.object({ claim: z.boolean() }).strict();
export const openHouseIdParams = idParam;
export type AddOpenHouseInput = z.infer<typeof addOpenHouseBody>;
