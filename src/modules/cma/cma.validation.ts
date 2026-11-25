import { z } from "zod";
import { blankToNull, idParam, optionalEmail, optionalPhone, optionalText } from "../../utils/fields.js";

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // Supabase free plan: 50 MB per file
export const MAX_ATTACHMENTS = 25;
export const STATUSES = ["submitted", "building", "needs_info", "approval", "ready", "revision", "failed"] as const;

const req = (max: number, label: string) => z.string({ error: `Add the ${label}.` }).trim().min(1, `Add the ${label}.`).max(max, `${label[0]!.toUpperCase()}${label.slice(1)} is too long (${max} characters max).`);
const opt = (max: number, label: string) => optionalText(max, label).optional();
/** Optional numeric text (beds, baths, sqft…): digits with an optional decimal / commas / "+". */
const optNumber = (label: string, re: RegExp, example: string) =>
  z.preprocess(blankToNull, z.string().trim().max(20, `${label} is too long.`).regex(re, `${label} must be a number, e.g. ${example}.`).nullable()).optional();
const thisYear = new Date().getFullYear();

const stringMap = (maxKeys: number, label: string) =>
  z
    .record(z.string().max(60), z.string().max(4000, `A ${label} answer is too long (4000 characters max).`))
    .refine(m => Object.keys(m).length <= maxKeys, `Too many ${label} fields.`)
    .nullable()
    .optional();

export const attachmentSchema = z
  .object({
    storageId: z.string().min(1).max(300),
    name: z.string().trim().min(1).max(255),
    size: z.number().int().min(0).max(MAX_UPLOAD_BYTES, "Files can be 50 MB at most."),
    contentType: z.string().max(150).optional(),
  })
  .strict();

export const requestBody = z
  .object({
    reportType: z.enum(["sale", "lease"]).default("sale"),
    kind: z.enum(["residential", "commercial"]).default("residential"),
    lease: stringMap(80, "lease"),
    investor: stringMap(120, "investor"),
    commercial: stringMap(40, "building"),
    attachments: z.array(attachmentSchema).max(MAX_ATTACHMENTS, `Attach at most ${MAX_ATTACHMENTS} files.`).default([]),
    agentName: req(120, "agent"),
    agentEmail: z.email("The agent's email doesn't look right.").transform(v => v.toLowerCase()),
    agentPhone: optionalPhone.optional(),
    clientName: req(120, "client name").refine(v => /\p{L}/u.test(v), "Client name needs letters."),
    clientEmail: optionalEmail.optional(),
    clientPhone: optionalPhone.optional(),
    street: req(200, "street address").refine(v => /\d/.test(v), "The street address needs a house number."),
    unit: opt(20, "Unit"),
    city: req(80, "city").refine(v => /^[\p{L}][\p{L}\s.'-]*$/u.test(v), "City should be letters only."),
    state: z.string().trim().regex(/^[A-Za-z]{2}$/, "Use the 2-letter state, e.g. IL.").transform(v => v.toUpperCase()).default("IL"),
    zip: z.string({ error: "Add the ZIP." }).trim().regex(/^\d{5}(-\d{4})?$/, "ZIP must be 5 digits."),
    propertyType: req(80, "property type"),
    beds: optNumber("Beds", /^\d{1,2}(\.\d)?\+?$/, "3"),
    bathsFull: optNumber("Full baths", /^\d{1,2}\+?$/, "2"),
    bathsHalf: optNumber("Half baths", /^\d{1,2}\+?$/, "1"),
    sqft: optNumber("Square feet", /^\d{1,3}(,?\d{3})*$/, "1,850"),
    yearBuilt: z
      .preprocess(blankToNull, z.string().trim().regex(/^\d{4}$/, "Year built must be 4 digits, e.g. 1998.").refine(v => +v >= 1800 && +v <= thisYear + 2, `Year built must be between 1800 and ${thisYear + 2}.`).nullable())
      .optional(),
    basement: opt(200, "Basement"),
    garage: opt(200, "Garage"),
    hoaDues: opt(100, "HOA dues"),
    condition: req(80, "overall condition"),
    upgrades: z
      .array(z.object({ item: z.string().trim().min(1).max(120), year: z.string().trim().max(20).optional(), notes: z.string().trim().max(1000).optional() }).strict())
      .max(60)
      .default([]),
    otherUpgrades: opt(3000, "Other upgrades"),
    knownIssues: opt(3000, "Known issues"),
    sellerPriceExpectation: opt(200, "Price expectation"),
    timeline: opt(200, "Timeline"),
    purpose: req(200, "purpose"),
    neededBy: z.preprocess(blankToNull, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a real date.").nullable()).optional(),
    branding: req(120, "branding"),
    schools: opt(80, "Schools"),
    compNotes: opt(3000, "Comp notes"),
    notes: opt(4000, "Notes"),
  })
  .strict();

export const listPriceBody = z
  .object({
    listPrice: z.number({ error: "Enter the price in dollars." }).positive("Enter the price in dollars.").max(1_000_000_000, "That price looks too high."),
    note: optionalText(500, "Note").optional(),
  })
  .strict();

export const approvalBody = z.object({ approve: z.boolean() }).strict();
export const quotaQuery = z.object({ agentName: z.string().trim().max(120).optional() });
export const uploadBody = z
  .object({
    name: z.string().trim().min(1, "The file needs a name.").max(255),
    size: z.number().int().min(1, "The file is empty.").max(MAX_UPLOAD_BYTES, "Files can be 50 MB at most."),
    contentType: z.string().max(150).default("application/octet-stream"),
  })
  .strict();

// ---------- CMA builder (worker) ----------
export const workerStatusBody = z
  .object({
    id: z.string().min(1).max(64),
    status: z.enum(STATUSES),
    statusNote: z.string().max(2000).optional(),
    valueLow: z.number().optional(),
    valueHigh: z.number().optional(),
    listPrice: z.number().optional(),
    recommendedListPrice: z.number().optional(),
  })
  .strict();
export const workerUploadBody = z.object({ id: z.string().min(1).max(64), file: z.enum(["pdf", "workbook"]), contentType: z.string().max(150) }).strict();
export const workerFilesBody = z.object({ id: z.string().min(1).max(64), pdfKey: z.string().max(300).optional(), workbookKey: z.string().max(300).optional() }).strict();

export const cmaIdParams = idParam;
export type RequestInput = z.infer<typeof requestBody>;
