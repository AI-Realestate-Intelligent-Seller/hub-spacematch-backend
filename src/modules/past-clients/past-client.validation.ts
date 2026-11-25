import { z } from "zod";
import { idParam, optionalEmail, optionalPhone, optionalText } from "../../utils/fields.js";

export const SIDES = ["buyer", "seller", "renter", "landlord"] as const;

export const clientBody = z
  .object({
    name: z
      .string({ error: "Type the client's name." })
      .trim()
      .min(1, "Type the client's name.")
      .min(2, "Name is too short.")
      .max(80, "Name is too long (80 characters max).")
      .regex(/^[\p{L}][\p{L}\s.'&,-]*$/u, "Use letters only (spaces, & . ' - are fine)."),
    phone: optionalPhone,
    email: optionalEmail,
    address: optionalText(160, "Address"),
    closedOn: z
      .string({ error: "Pick the closing date." })
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the closing date.")
      .refine(v => !Number.isNaN(Date.parse(`${v}T12:00:00Z`)), "Pick a real date.")
      .refine(v => v >= "1950-01-01", "That date looks too far back.")
      .refine(v => Date.parse(`${v}T12:00:00Z`) <= Date.now() + 180 * 864e5, "Closing date can't be more than 6 months ahead."),
    side: z.enum(SIDES, { error: "Pick buyer, seller, renter or landlord." }),
  })
  .strict();

export const touchBody = z
  .object({
    key: z.string().trim().min(1).max(40).regex(/^[\w-]+$/, "Unknown touch."),
    done: z.boolean(),
  })
  .strict();

export const clientIdParams = idParam;
export type ClientInput = z.infer<typeof clientBody>;
