import { z } from "zod";
import { blankToNull } from "../../utils/fields.js";

/** Which hosts and paths each platform's video links can have (the Reels service checks again). */
const RULES = {
  instagram: { hosts: /(^|\.)instagram\.com$/i, path: /^\/(?:[\w.]+\/)?reels?\/[\w-]+/i, msg: "Use an Instagram Reel link, e.g. https://www.instagram.com/reel/ABC123/" },
  youtube: { hosts: /(^|\.)(youtube\.com|youtu\.be)$/i, path: /^\/(shorts\/[\w-]+|watch|[\w-]{6,})/i, msg: "Use a YouTube video or Shorts link, e.g. https://youtube.com/shorts/ABC123" },
  tiktok: { hosts: /(^|\.)tiktok\.com$/i, path: /^\/(@[\w.-]+\/video\/\d+|[\w-]+\/?$)/i, msg: "Use a TikTok video link, e.g. https://www.tiktok.com/@name/video/123" },
  facebook: { hosts: /(^|\.)(facebook\.com|fb\.watch)$/i, path: /^\/(reel\/|share\/(r|v)\/|watch|[\w.-]+\/videos\/|[\w-]+\/?$)/i, msg: "Use a Facebook Reel or video link, e.g. https://www.facebook.com/reel/123" },
} as const;
export type Platform = keyof typeof RULES;
export const PLATFORMS = Object.keys(RULES) as Platform[];

const socialLink = (p: Platform) =>
  z.preprocess(
    blankToNull,
    z
      .string()
      .trim()
      .max(600, "That link is too long.")
      .refine(v => {
        try {
          const u = new URL(v);
          return u.protocol === "https:" && RULES[p].hosts.test(u.hostname) && RULES[p].path.test(u.pathname + (u.search ? "?" : ""));
        } catch {
          return false;
        }
      }, RULES[p].msg)
      .nullable(),
  );

export const fetchBody = z
  .object({
    instagram: socialLink("instagram").optional(),
    youtube: socialLink("youtube").optional(),
    tiktok: socialLink("tiktok").optional(),
    facebook: socialLink("facebook").optional(),
  })
  .strict();

export type FetchInput = z.infer<typeof fetchBody>;
