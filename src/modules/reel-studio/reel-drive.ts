import { createSign } from "node:crypto";
import { z } from "zod";
import { config } from "../../config/index.js";
import { serviceUnavailable } from "../../utils/http-error.js";

const folders = z.record(z.string(), z.string().regex(/^[\w-]+$/)).parse(JSON.parse(config.reelStudio.driveFolders));
let cached: { token: string; expires: number } | undefined;

async function accessToken() {
  if (cached && cached.expires > Date.now()) return cached.token;
  const { driveAccount, driveKey } = config.reelStudio;
  if (!driveAccount || !driveKey) throw serviceUnavailable("SpaceMatch Drive is not configured.");
  const audience = "https://oauth2.googleapis.com/token";
  const encode = (obj: object) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const message = [
    encode({ alg: "RS256", typ: "JWT" }),
    encode({ iss: driveAccount, scope: "https://www.googleapis.com/auth/drive.readonly", aud: audience, iat: now, exp: now + 3600 }),
  ].join(".");
  const signature = createSign("RSA-SHA256").update(message).sign(driveKey.replace(/\\n/g, "\n"), "base64url");
  const response = await fetch(audience, {
    method: "POST", signal: AbortSignal.timeout(8000),
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${message}.${signature}` }),
  });
  if (!response.ok) throw serviceUnavailable("Could not authorize SpaceMatch Drive.");
  const result = z.object({ access_token: z.string(), expires_in: z.number() }).parse(await response.json());
  cached = { token: result.access_token, expires: Date.now() + result.expires_in * 1000 - 60_000 };
  return cached.token;
}

async function drive(path: string, params: Record<string, string>, timeout = 8000) {
  const response = await fetch(`https://www.googleapis.com/drive/v3/${path}?${new URLSearchParams(params)}`, {
    headers: { Authorization: `Bearer ${await accessToken()}` }, signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) throw serviceUnavailable("Could not read the assigned SpaceMatch Drive folder.");
  return response;
}

export async function driveClips(email: string, assignedFolder: string | null, ids?: string[]) {
  const folder = assignedFolder || folders[email];
  if (!folder || !/^[\w-]+$/.test(folder) || !config.reelStudio.driveAccount || !config.reelStudio.driveKey) return [];
  const query = [`'${folder}' in parents`, "trashed = false", "mimeType contains 'video/'"];
  if (ids?.length) {
    const files = await Promise.all(ids.map(async id => {
      const r = await drive(`files/${encodeURIComponent(id)}`, { fields: "id,name,mimeType,size,parents,trashed", supportsAllDrives: "true" });
      return z.object({ id: z.string(), name: z.string(), mimeType: z.string(), size: z.coerce.number(), parents: z.array(z.string()), trashed: z.boolean() }).parse(await r.json());
    }));
    return files.filter(f => f.parents.includes(folder) && !f.trashed && f.mimeType.startsWith("video/")).map(f => ({ ...f, id: `drive:${f.id}`, link: "drive" }));
  }
  const r = await drive("files", { q: query.join(" and "), fields: "files(id,name,mimeType,size)", includeItemsFromAllDrives: "true", supportsAllDrives: "true", orderBy: "createdTime desc", pageSize: "100" });
  const { files } = z.object({ files: z.array(z.object({ id: z.string(), name: z.string(), mimeType: z.string(), size: z.coerce.number() })) }).parse(await r.json());
  return files.map(f => ({ ...f, id: `drive:${f.id}`, link: "drive" }));
}

export async function downloadDriveClip(id: string) {
  return drive(`files/${encodeURIComponent(id)}`, { alt: "media", supportsAllDrives: "true" }, 180_000);
}
