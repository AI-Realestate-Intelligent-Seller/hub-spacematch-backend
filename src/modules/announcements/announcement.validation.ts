import { z } from "zod";
import { idParam, optionalText, optionalWebsite } from "../../utils/fields.js";

export const postBody = z
  .object({
    title: optionalText(140, "Headline").optional(),
    body: z.string({ error: "Write something first." }).trim().min(1, "Write something first.").max(4000, "The announcement is too long (4000 characters max)."),
    link: optionalWebsite.optional(),
    pinned: z.boolean().default(false),
    notify: z.boolean().default(true),
  })
  .strict();

export const pinBody = z.object({ pinned: z.boolean() }).strict();

export const subscribeBody = z
  .object({
    endpoint: z.url("Invalid subscription.").max(1000),
    p256dh: z.string().min(1).max(200),
    auth: z.string().min(1).max(100),
  })
  .strict();
export const unsubscribeBody = z.object({ endpoint: z.string().min(1).max(1000) }).strict();

export const announcementIdParams = idParam;
export type PostInput = z.infer<typeof postBody>;
