// Zod schemas for every listings endpoint. The frontend checks the same rules first
// (frontend/src/lib/listingForms.ts) so people see errors as they type; these are the real ones.
import { z } from "zod";
import { LAUNCH_STEPS, LISTING_STATUSES } from "../../shared/launch-steps.js";

// ---------- Field rules ----------

/** Empty string / null → null (clears the field); undefined → leave unchanged. */
const blankToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);

export const MAX_PRICE_CENTS = 500_000_000 * 100; // $500M
export const MIN_PRICE_CENTS = 1_000 * 100; // $1,000

const address = z
  .string()
  .trim()
  .min(5, "Add the full property address.")
  .max(200, "Address is too long (200 characters max).")
  .refine(v => /\d/.test(v) && /[a-z]/i.test(v), "Use a street address with a house number, e.g. 1234 N Main St.");

const personName = z
  .string()
  .trim()
  .min(2, "Add the seller's name.")
  .max(120, "Name is too long (120 characters max).")
  .regex(/^[\p{L}][\p{L}\s.'&,-]*$/u, "Use letters only (spaces, & . ' - are fine).");

const mlsNumber = z.preprocess(
  blankToNull,
  z
    .string()
    .trim()
    .regex(/^\d{6,10}$/, "MLS # is 6 to 10 digits.")
    .nullable(),
);

const priceCents = z.preprocess(
  blankToNull,
  z
    .number({ error: "Price must be a number." })
    .int("Price must be whole cents.")
    .min(MIN_PRICE_CENTS, "Price must be at least $1,000.")
    .max(MAX_PRICE_CENTS, "Price looks too high.")
    .nullable(),
);

const email = z.preprocess(
  blankToNull,
  z
    .email("That email doesn't look right.")
    .max(200)
    .transform(v => v.toLowerCase())
    .nullable(),
);

/** US phone: 10 digits (a leading 1 is dropped). Stored as (312) 555-0100. */
const phone = z.preprocess(
  blankToNull,
  z
    .string()
    .trim()
    .regex(/^[\d\s()+.-]+$/, "Use digits only.")
    .transform(v => v.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, ""))
    .refine(v => v.length === 10, "Phone must be 10 digits.")
    .transform(v => `(${v.slice(0, 3)}) ${v.slice(3, 6)}-${v.slice(6)}`)
    .nullable(),
);

const httpsUrl = (label: string) =>
  z.preprocess(
    blankToNull,
    z
      .string()
      .trim()
      .max(600, `${label} is too long.`)
      .refine(v => {
        try {
          return new URL(v).protocol === "https:";
        } catch {
          return false;
        }
      }, `${label} must be a full link starting with https://`)
      .nullable(),
  );

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a real date.").refine(v => !Number.isNaN(Date.parse(`${v}T12:00:00Z`)) && new Date(`${v}T12:00:00Z`).toISOString().startsWith(v), "Use a real date.");

const liveDate = z.preprocess(
  blankToNull,
  isoDate
    .refine(v => v >= "2000-01-01", "Date looks too far back.")
    .refine(v => Date.parse(`${v}T12:00:00Z`) <= Date.now() + 365 * 864e5, "Date can't be more than a year ahead.")
    .nullable(),
);

const count = z.preprocess(
  blankToNull,
  z
    .number({ error: "Use a number." })
    .int("Use a whole number.")
    .min(0, "Can't be negative.")
    .max(10_000_000, "Number looks too high.")
    .nullable(),
);

const optionalText = (max: number, label: string) =>
  z.preprocess(blankToNull, z.string().trim().max(max, `${label} is too long (${max} characters max).`).nullable());

// ---------- Params / query ----------

export const idParams = z.object({ id: z.string().min(1).max(64) });
export const eventParams = z.object({ eventId: z.string().min(1).max(64) });
export const suggestionParams = z.object({ suggestionId: z.string().min(1).max(64) });
export const inboxParams = z.object({ inboxId: z.string().min(1).max(64) });
export const tokenParams = z.object({ token: z.string().min(20).max(64) });
export const stepParams = idParams.extend({
  key: z.enum(LAUNCH_STEPS.map(s => s.key) as [string, ...string[]], { error: "Unknown launch step." }),
});
export const weekParams = idParams.extend({
  weekOf: isoDate.refine(v => new Date(`${v}T12:00:00Z`).getUTCDay() === 1, "Week must start on a Monday."),
});

export const listQuery = z.object({ scope: z.enum(["mine", "all"]).default("all") });

// ---------- Bodies ----------

export const createListingBody = z
  .object({
    address,
    mlsNumber: mlsNumber.optional(),
    priceCents: priceCents.optional(),
    sellerName: personName,
    sellerEmail: email.optional(),
    sellerPhone: phone.optional(),
    agentUserId: z.preprocess(blankToNull, z.string().min(1).max(64).nullable()).optional(), // staff only: list for another agent
  })
  .strict();

const linksBody = z
  .object({
    zillow: httpsUrl("Zillow link").optional(),
    website: httpsUrl("Website link").optional(),
    reel: httpsUrl("Reel link").optional(),
    tour: httpsUrl("3D tour link").optional(),
    youtube: httpsUrl("YouTube link").optional(),
    tiktok: httpsUrl("TikTok link").optional(),
    facebook: httpsUrl("Facebook link").optional(),
  })
  .strict();

export const updateListingBody = z
  .object({
    address: address.optional(),
    mlsNumber: mlsNumber.optional(),
    priceCents: priceCents.optional(),
    status: z.enum(LISTING_STATUSES, { error: "Unknown status." }).optional(),
    photoUrl: httpsUrl("Photo link").optional(),
    sellerName: personName.optional(),
    sellerEmail: email.optional(),
    sellerPhone: phone.optional(),
    liveDate: liveDate.optional(),
    weeklyEmail: z.boolean().optional(),
    links: linksBody.optional(),
  })
  .strict()
  .refine(v => Object.keys(v).length > 0, { message: "Nothing to update." });

export const toggleStepBody = z
  .object({
    done: z.boolean(),
    note: optionalText(300, "Note").optional(),
  })
  .strict();

export const saveMetricsBody = z
  .object({
    zillowViews: count.optional(),
    zillowSaves: count.optional(),
    mlsSaved: count.optional(),
    mlsMaybe: count.optional(),
    mlsNotInterested: count.optional(),
    adViews: count.optional(),
    adClicks: count.optional(),
    reelViews: count.optional(),
    tiktokViews: count.optional(),
    fbViews: count.optional(),
    youtubeViews: count.optional(),
    tiktokLink: httpsUrl("TikTok link").optional(),
    facebookLink: httpsUrl("Facebook link").optional(),
  })
  .strict();

export const addEventBody = z
  .object({
    kind: z.enum(["update", "offer", "showing", "feedback"]),
    title: z.string().trim().min(1, "Add a short title.").max(140, "Title is too long (140 characters max)."),
    body: optionalText(2000, "Details").optional(),
    when: optionalText(80, "When").optional(),
  })
  .strict();

/** Output of parseShowingTime() (frontend parses the pasted email with the same code). */
export const parsedShowingBody = z
  .object({
    kind: z.enum(["feedback", "showing", "cancelled"]),
    address: z.string().max(200),
    mls: z.string().max(20).optional(),
    when: z.string().max(120).optional(),
    interest: z.string().max(200).optional(),
    priceOpinion: z.string().max(200).optional(),
    rating: z.string().max(20).optional(),
    experience: z.string().max(500).optional(),
    comments: z.string().max(2000).optional(),
    answers: z.array(z.object({ q: z.string().max(500), a: z.string().max(2000) })).max(30),
    buyerAgent: z.string().max(200).optional(),
  })
  .strict();

export const setEventStatusBody = z
  .object({
    status: z.enum(["published", "hidden", "pending"]),
    body: optionalText(2000, "Comment").optional(),
  })
  .strict();

const suggestionText = {
  title: z.string().trim().min(1, "Add a title.").max(120, "Title is too long (120 characters max)."),
  why: z.string().trim().max(300, "Why is too long (300 characters max).").default(""),
  action: z.string().trim().max(300, "What we'll do is too long (300 characters max).").default(""),
};

export const addSuggestionBody = z.object(suggestionText).strict();

export const updateSuggestionBody = z
  .object({
    title: suggestionText.title.optional(),
    why: z.string().trim().max(300, "Why is too long (300 characters max).").optional(),
    action: z.string().trim().max(300, "What we'll do is too long (300 characters max).").optional(),
    status: z.enum(["draft", "published", "dismissed"]).optional(),
  })
  .strict()
  .refine(v => Object.keys(v).length > 0, { message: "Nothing to update." });

export const assignInboxBody = z.object({ listingId: z.string().min(1).max(64) }).strict();

export type CreateListingInput = z.infer<typeof createListingBody>;
export type UpdateListingInput = z.infer<typeof updateListingBody>;
export type SaveMetricsInput = z.infer<typeof saveMetricsBody>;
export type AddEventInput = z.infer<typeof addEventBody>;
export type ParsedShowingInput = z.infer<typeof parsedShowingBody>;
export type UpdateSuggestionInput = z.infer<typeof updateSuggestionBody>;
