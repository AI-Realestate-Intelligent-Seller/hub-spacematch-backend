import { z } from "zod";
import { idParam, optionalEmail, optionalPhone, optionalText, optionalWebsite } from "../../utils/fields.js";

export const VENDOR_CATEGORIES = [
  "Lenders", "Attorneys", "Title & closing", "Inspectors", "Contractors", "Maintenance & handyman",
  "Listing prep & media", "Movers & storage", "Property management", "Insurance", "Marketing & print", "Team support", "Other",
] as const;

const vendorFields = {
  name: z
    .string({ error: "Add the contact name." })
    .trim()
    .min(1, "Add the contact name.")
    .min(2, "Name is too short.")
    .max(120, "Name is too long (120 characters max).")
    .refine(v => /\p{L}/u.test(v), "Name needs letters."),
  company: optionalText(120, "Company"),
  category: z.enum(VENDOR_CATEGORIES, { error: "Pick a category." }),
  subcategory: optionalText(80, "Type"),
  description: optionalText(2000, "Description"),
  phone: optionalPhone,
  email: optionalEmail,
  website: optionalWebsite,
  address: optionalText(200, "Address"),
  areas: optionalText(200, "Areas served"),
  languages: optionalText(200, "Languages"),
  perk: optionalText(200, "Team perk"),
  private: z.boolean().default(false),
};

const reachable = (v: { phone?: string | null; email?: string | null; website?: string | null }) => !!(v.phone || v.email || v.website);
const reachMsg = { message: "Add a phone, email or website so agents can reach them.", path: ["phone"] };

export const vendorBody = z.object(vendorFields).strict().refine(reachable, reachMsg);

export const vendorIdParams = idParam;

export const moderateBody = z
  .object({ preferred: z.boolean().optional(), hidden: z.boolean().optional(), onWebsite: z.boolean().optional() })
  .strict()
  .refine(v => Object.keys(v).length > 0, { message: "Nothing to change." });

export const rateBody = z
  .object({
    rating: z.number({ error: "Pick 1 to 5 stars." }).int("Pick 1 to 5 stars.").min(1, "Pick 1 to 5 stars.").max(5, "Pick 1 to 5 stars."),
    note: optionalText(500, "Note").optional(),
  })
  .strict();

export type VendorInput = z.infer<typeof vendorBody>;
