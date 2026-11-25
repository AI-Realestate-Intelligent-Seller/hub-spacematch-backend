import { z } from "zod";
import { MARKET_AREAS, MAX_AGENT_AREAS } from "../../shared/market-defs.js";

// Google review links agents can paste: g.page/r/…/review, search.google.com/local/writereview?placeid=…, maps links.
const GOOGLE_HOSTS = ["g.page", "search.google.com", "www.google.com", "google.com", "maps.app.goo.gl", "goo.gl", "maps.google.com", "g.co"];
const GOOGLE_MSG = "That doesn't look like a Google review link. It should start with g.page or search.google.com.";

/** "" clears the link (the SpaceMatch page is used); otherwise a Google link, saved as https. */
const reviewUrl = z
  .string()
  .trim()
  .max(500, "That link is too long.")
  .transform((v, ctx) => {
    if (!v) return null;
    try {
      const u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
      if (!GOOGLE_HOSTS.includes(u.hostname.toLowerCase())) throw new Error("host");
      u.protocol = "https:";
      return u.toString();
    } catch {
      ctx.addIssue({ code: "custom", message: GOOGLE_MSG });
      return z.NEVER;
    }
  });

export const settingsBody = z
  .object({
    reviewUrl: reviewUrl.optional(),
    areas: z
      .array(z.string().refine(k => MARKET_AREAS.some(a => a.key === k), "Unknown area."))
      .max(MAX_AGENT_AREAS, `Pick up to ${MAX_AGENT_AREAS} areas.`)
      .transform(a => [...new Set(a)])
      .optional(),
  })
  .strict()
  .refine(v => v.reviewUrl !== undefined || v.areas !== undefined, { message: "Nothing to save." });

export const createReviewBody = z
  .object({
    clientName: z
      .string({ error: "Type the client's name." })
      .trim()
      .min(1, "Type the client's name.")
      .min(2, "Name is too short.")
      .max(60, "Name is too long (60 characters max).")
      .regex(/^[\p{L}][\p{L}\s.'&,-]*$/u, "Use letters only (spaces, & . ' - are fine)."),
    channel: z.enum(["text", "email", "copy"]),
  })
  .strict();

const thisMonth = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" }).slice(0, 7);
const whole = (label: string, max: number) =>
  z.number({ error: `Enter ${label} as a number.` }).int(`${label[0]!.toUpperCase()}${label.slice(1)} must be a whole number.`).min(0, `${label[0]!.toUpperCase()}${label.slice(1)} can't be negative.`).max(max, `${label[0]!.toUpperCase()}${label.slice(1)} looks too high.`);

export const statsBody = z
  .object({
    area: z.string().refine(k => MARKET_AREAS.some(a => a.key === k), "Unknown area."),
    month: z
      .string({ error: "Pick the month." })
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Pick the month.")
      .refine(v => v >= "2000-01", "That month is too far back.")
      .refine(v => v <= thisMonth(), "Pick this month or an earlier one."),
    median: whole("the median price", 100_000_000).refine(v => v >= 1000, "Median price looks too low."),
    sales: whole("homes sold", 100_000),
    domMedian: whole("days on market", 3650),
    active: whole("homes for sale", 100_000),
  })
  .strict();

export const tokenParams = z.object({ token: z.string().regex(/^[a-z0-9]{6,12}$/, "Unknown link.") });
export const noteBody = z
  .object({ note: z.string({ error: "Write a note first." }).trim().min(1, "Write a note first.").max(1000, "Your note is too long (1000 characters max).") })
  .strict();

export type SettingsInput = z.infer<typeof settingsBody>;
export type StatsInput = z.infer<typeof statsBody>;
