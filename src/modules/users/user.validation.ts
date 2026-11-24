import { z } from "zod";
import { ROLES } from "../../types/auth.js";

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

export const updateMeBody = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    phone: optionalText(40),
    title: optionalText(120),
    licenseNo: optionalText(60),
    bio: optionalText(2000),
  })
  .strict();

export const listUsersQuery = z.object({
  role: z.enum(ROLES).optional(),
  status: z.enum(["active", "removed"]).optional(),
});

export const userIdParams = z.object({ id: z.string().min(1).max(64) });

export const adminUpdateUserBody = z
  .object({
    role: z.enum(ROLES).optional(),
    status: z.enum(["active", "removed"]).optional(),
    name: z.string().trim().min(1).max(120).optional(),
    phone: optionalText(40),
    title: optionalText(120),
    licenseNo: optionalText(60),
    bio: optionalText(2000),
    driveFolderId: optionalText(200),
  })
  .strict()
  .refine(v => Object.keys(v).length > 0, { message: "Nothing to update." });

export const inviteBody = z
  .object({
    email: z.email().transform(v => v.trim().toLowerCase()),
    role: z.enum(ROLES).default("guest"),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

export const invitationEmailParams = z.object({ email: z.email().transform(v => v.toLowerCase()) });
