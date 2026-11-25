// Reusable zod field rules for request bodies (phone, email, website, text with limits).
// The frontend mirrors these in frontend/src/lib/formRules.ts.
import { z } from "zod";

/** "" / whitespace → null (clears the field); undefined stays undefined (leave unchanged). */
export const blankToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);

/** Optional text, trimmed, with a max length; "" → null. */
export const optionalText = (max: number, label: string) =>
  z.preprocess(blankToNull, z.string().trim().max(max, `${label} is too long (${max} characters max).`).nullable());

/** Required text, trimmed. */
export const requiredText = (max: number, label: string, emptyMessage = `Add ${label.toLowerCase()}.`) =>
  z.string({ error: emptyMessage }).trim().min(1, emptyMessage).max(max, `${label} is too long (${max} characters max).`);

/** Optional email, lower-cased. */
export const optionalEmail = z.preprocess(
  blankToNull,
  z
    .email("That email doesn't look right.")
    .max(200, "Email is too long.")
    .transform(v => v.toLowerCase())
    .nullable(),
);

/** Optional US phone: 10 digits (a leading 1 is dropped), stored as (312) 555-0100. */
export const optionalPhone = z.preprocess(
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

/** Optional website. "acme.com" becomes "https://acme.com"; must be a real web address. */
export const optionalWebsite = z.preprocess(
  blankToNull,
  z
    .string()
    .trim()
    .max(300, "Website is too long.")
    .transform(v => (/^https?:\/\//i.test(v) ? v : `https://${v}`))
    .refine(v => {
      try {
        const u = new URL(v);
        return (u.protocol === "https:" || u.protocol === "http:") && /\.[a-z]{2,}$/i.test(u.hostname);
      } catch {
        return false;
      }
    }, "That website doesn't look right (e.g. acme.com).")
    .nullable(),
);

export const idParam = z.object({ id: z.string().min(1).max(64) });
