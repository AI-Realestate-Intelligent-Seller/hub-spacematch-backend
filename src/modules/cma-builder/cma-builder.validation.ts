import { z } from "zod";
import { blankToNull, optionalText } from "../../utils/fields.js";
import { ADJUSTMENT_CATEGORIES, COMP_STATUSES, CONDITIONS, PROPERTY_TYPES } from "./cma-builder.types.js";

const thisYear = new Date().getFullYear();
const optNum = (label: string, min: number, max: number, int = false) =>
  z.preprocess(
    v => (blankToNull(v) === null ? null : typeof v === "string" ? Number(v.replace(/[,$\s]/g, "")) : v),
    (int ? z.number().int(`${label} must be a whole number.`) : z.number({ error: `${label} must be a number.` }))
      .min(min, `${label} must be at least ${min.toLocaleString("en-US")}.`)
      .max(max, `${label} must be at most ${max.toLocaleString("en-US")}.`)
      .nullable(),
  );
const money = (label: string) => optNum(label, 1000, 100_000_000);

export const listingParams = z.object({ id: z.string().min(1).max(64) });
export const reportParams = z.object({ id: z.string().min(1).max(64) });
export const compParams = z.object({ id: z.string().min(1).max(64), comparableId: z.string().min(1).max(64) });
export const tokenParams = z.object({ token: z.string().min(20).max(64) });

export const subjectSchema = z
  .object({
    address: z.string().trim().min(5, "Add the property address.").max(200).refine(v => /\d/.test(v), "The address needs a house number."),
    street: optionalText(200, "Street").optional(),
    city: optionalText(80, "City").optional(),
    state: z.preprocess(blankToNull, z.string().trim().regex(/^[A-Za-z]{2}$/, "Use the 2-letter state.").transform(v => v.toUpperCase()).nullable()).optional(),
    zip: z.preprocess(blankToNull, z.string().trim().regex(/^\d{5}$/, "ZIP must be 5 digits.").nullable()).optional(),
    lat: optNum("Latitude", -90, 90).optional(),
    lng: optNum("Longitude", -180, 180).optional(),
    propertyType: z.enum(PROPERTY_TYPES, { error: "Pick a property type." }),
    beds: optNum("Bedrooms", 0, 30).optional(),
    baths: optNum("Bathrooms", 0, 30).optional(),
    sqft: optNum("Square feet", 200, 50_000, true).optional(),
    lotSqft: optNum("Lot size", 100, 50_000_000, true).optional(),
    yearBuilt: optNum("Year built", 1700, thisYear + 2, true).optional(),
    condition: z.preprocess(blankToNull, z.enum(CONDITIONS).nullable()).optional(),
    garageSpaces: optNum("Garage spaces", 0, 20, true).optional(),
    askingPrice: money("Asking price").optional(),
    mlsNumber: optionalText(30, "MLS number").optional(),
    features: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  })
  .strict();

export const requestBody = z
  .object({
    subject: subjectSchema,
    radiusMi: z.union([z.literal(0.5), z.literal(1), z.literal(3), z.literal(5)], { error: "Radius must be 0.5, 1, 3 or 5 miles." }),
    soldWithinDays: z.union([z.literal(90), z.literal(180), z.literal(365)], { error: "Sold within must be 90, 180 or 365 days." }),
    sqftMin: optNum("Minimum sq ft", 0, 50_000, true).optional(),
    sqftMax: optNum("Maximum sq ft", 0, 50_000, true).optional(),
    bedsMin: optNum("Minimum beds", 0, 30).optional(),
    bedsMax: optNum("Maximum beds", 0, 30).optional(),
    bathsMin: optNum("Minimum baths", 0, 30).optional(),
    propertyTypes: z.array(z.enum(PROPERTY_TYPES)).max(6).default([]),
    statuses: z.array(z.enum(["sold", "active", "pending"])).min(1, "Pick at least one listing status.").max(3),
    instructions: optionalText(2000, "Instructions").optional(),
    provider: z.string().trim().min(1, "Pick a data source.").max(60),
  })
  .strict()
  .refine(v => !(v.sqftMin && v.sqftMax && v.sqftMin > v.sqftMax), { message: "Minimum sq ft is above the maximum.", path: ["sqftMax"] })
  .refine(v => !(v.bedsMin && v.bedsMax && v.bedsMin > v.bedsMax), { message: "Minimum beds is above the maximum.", path: ["bedsMax"] });

const longText = (label: string) => optionalText(6000, label).optional();

export const patchReportBody = z
  .object({
    researchApprovals: z.array(z.string().min(1).max(80)).max(50).optional(),
    subject: subjectSchema.partial().strict().optional(),
    content: z
      .object({
        executiveSummary: longText("Executive summary"),
        propertyObservations: longText("Property observations"),
        pricingRecommendation: longText("Pricing recommendation"),
        marketingRecommendations: longText("Marketing recommendations"),
        comparableNotes: longText("Comparable notes"),
        recommendedLow: money("Recommended low").optional(),
        recommendedHigh: money("Recommended high").optional(),
        recommendedListPrice: money("Recommended list price").optional(),
        sections: z.object({ overview: z.boolean(), comparables: z.boolean(), market: z.boolean(), adjustments: z.boolean(), recommendations: z.boolean() }).strict().optional(),
        showCompAddressesToSeller: z.boolean().optional(),
      })
      .strict()
      .refine(c => !(c.recommendedLow && c.recommendedHigh && c.recommendedLow > c.recommendedHigh), { message: "The recommended low is above the high.", path: ["recommendedHigh"] })
      .optional(),
    override: z
      .object({
        value: z.number({ error: "Enter the value in dollars." }).min(1000).max(100_000_000),
        reason: z.string().trim().min(10, "Explain the override in at least 10 characters.").max(2000),
      })
      .strict()
      .nullable()
      .optional(),
    settings: z.object({ sizeAdjustmentFactor: z.number().min(0).max(1) }).strict().optional(),
  })
  .strict();

const compFields = {
  status: z.enum(COMP_STATUSES, { error: "Pick sold, pending, active or off market." }),
  address: z.string().trim().min(5, "Add the address.").max(200).refine(v => /\d/.test(v), "The address needs a house number."),
  city: optionalText(80, "City").optional(),
  state: optionalText(2, "State").optional(),
  zip: z.preprocess(blankToNull, z.string().trim().regex(/^\d{5}$/, "ZIP must be 5 digits.").nullable()).optional(),
  lat: optNum("Latitude", -90, 90).optional(),
  lng: optNum("Longitude", -180, 180).optional(),
  propertyType: z.preprocess(blankToNull, z.enum(PROPERTY_TYPES).nullable()).optional(),
  originalListPrice: money("Original list price").optional(),
  listPrice: money("List price").optional(),
  soldPrice: money("Sold price").optional(),
  soldDate: z.preprocess(blankToNull, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a real date.").nullable()).optional(),
  listDate: z.preprocess(blankToNull, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a real date.").nullable()).optional(),
  daysOnMarket: optNum("Days on market", 0, 5000, true).optional(),
  beds: optNum("Bedrooms", 0, 30).optional(),
  baths: optNum("Bathrooms", 0, 30).optional(),
  sqft: optNum("Square feet", 100, 100_000, true).optional(),
  lotSqft: optNum("Lot size", 100, 50_000_000, true).optional(),
  yearBuilt: optNum("Year built", 1700, thisYear + 2, true).optional(),
  condition: z.preprocess(blankToNull, z.enum(CONDITIONS).nullable()).optional(),
  garageSpaces: optNum("Garage spaces", 0, 20, true).optional(),
  distanceMi: optNum("Distance", 0, 100).optional(),
  sourceUrl: optionalText(500, "Source link").optional(),
  notes: optionalText(1000, "Notes").optional(),
};

export const addCompBody = z
  .object(compFields)
  .strict()
  .refine(c => c.status !== "sold" || (c.soldPrice && c.soldDate), { message: "A sold comparable needs a sold price and date.", path: ["soldPrice"] })
  .refine(c => c.status === "sold" || c.listPrice || c.originalListPrice, { message: "Add the list price.", path: ["listPrice"] });

export const adjustmentInput = z
  .object({
    id: z.string().max(40).optional(),
    category: z.enum(ADJUSTMENT_CATEGORIES, { error: "Pick an adjustment type." }),
    amount: z.number({ error: "Enter the amount in dollars." }).min(-10_000_000).max(10_000_000).refine(v => v !== 0, "The amount can't be 0."),
    reason: z.string().trim().min(3, "Say why (a few words).").max(500),
    suggested: z.boolean().optional(),
  })
  .strict();

export const patchCompBody = z
  .object({
    selected: z.boolean().optional(),
    adjustments: z.array(adjustmentInput).max(20).optional(),
    notes: optionalText(1000, "Notes").optional(),
    // Only for comparables the agent added (manual / CSV); collected records stay as collected.
    fields: z.object(compFields).partial().strict().optional(),
  })
  .strict();

export const selectionBody = z.object({ selectedIds: z.array(z.string().min(1).max(64)).max(500) }).strict();
export const importBody = z.object({ csv: z.string().min(1, "The file is empty.").max(900_000, "The file is too big (900 KB max).") }).strict();
export const publishBody = z.object({ confirm: z.literal(true, { error: "Confirm before publishing." }) }).strict();
export const historyQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30), offset: z.coerce.number().int().min(0).default(0) });

export type RequestInput = z.infer<typeof requestBody>;
export type PatchReportInput = z.infer<typeof patchReportBody>;
export type AddCompInput = z.infer<typeof addCompBody>;
export type PatchCompInput = z.infer<typeof patchCompBody>;

export const refreshBody = z.object({ provider: z.string().trim().min(1).max(60).optional() }).strict();
