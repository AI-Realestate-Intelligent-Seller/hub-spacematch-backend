import { z } from "zod";
import { idParam, optionalText } from "../../utils/fields.js";

export const TIERS = ["essential", "signature", "luxury"] as const;

export const placeBody = z
  .object({
    listingId: z.string().min(1).max(64),
    tier: z.enum(TIERS, { error: "Pick a package." }),
    openHouse: z.boolean(),
    payment: z.enum(["ahead", "closing"], { error: "Pick how you'll pay." }),
    authorized: z.literal(true, { error: "Tick the box to authorize the charge." }),
    note: optionalText(500, "Note").optional(),
  })
  .strict();

export const decideBody = z
  .object({
    action: z.enum(["approve", "decline"]),
    tier: z.enum(TIERS).optional(),
    note: optionalText(500, "Note").optional(),
  })
  .strict();

export const statusBody = z.object({ status: z.enum(["live", "done", "approved"]) }).strict();

export const paymentBody = z
  .object({
    paymentStatus: z.enum(["unpaid", "paid", "deducted", "rolled"]),
    note: optionalText(200, "Note").optional(),
  })
  .strict();

const price = (label: string) => z.number({ error: `${label} must be a number.` }).int(`${label} must be whole dollars.`).min(0, `${label} can't be negative.`).max(50_000, `${label} looks too high.`);

export const pricingBody = z
  .object({
    tiers: z.array(z.object({ key: z.enum(TIERS), spend: price("Ad spend"), fee: price("Fee") }).strict()).min(1).max(3),
    ohSpend: price("Open-house ad spend"),
    ohFee: price("Open-house fee"),
    closingSurcharge: price("Pay-at-closing surcharge"),
  })
  .strict();

export const orderIdParams = idParam;
export const listingIdParams = z.object({ listingId: z.string().min(1).max(64) });
