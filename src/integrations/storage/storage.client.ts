// File storage through the S3 API (Supabase Storage today, Cloudflare R2 possible later).
// Modules never import the AWS SDK directly; they use this adapter.
import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "../../config/index.js";
import { serviceUnavailable } from "../../utils/http-error.js";

let client: S3Client | undefined;

export function getStorage(): S3Client {
  const s = config.storage;
  if (!s.isConfigured || !s.endpoint || !s.accessKeyId || !s.secretAccessKey) {
    throw serviceUnavailable("File storage is not configured (STORAGE_S3_* variables are empty).");
  }
  client ??= new S3Client({
    endpoint: s.endpoint,
    region: s.region,
    forcePathStyle: true, // required by Supabase Storage's S3 endpoint
    credentials: { accessKeyId: s.accessKeyId, secretAccessKey: s.secretAccessKey },
  });
  return client;
}

/** Health check: confirms the keys work and the bucket exists. Returns latency in ms. */
export async function pingStorage(): Promise<number> {
  const started = Date.now();
  await getStorage().send(new HeadBucketCommand({ Bucket: config.storage.bucket }));
  return Date.now() - started;
}

/** Saves a file (private bucket). `key` is the path inside the bucket, e.g. "feedback/<user>/<id>.png". */
export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await getStorage().send(new PutObjectCommand({ Bucket: config.storage.bucket, Key: key, Body: body, ContentType: contentType }));
}

/** A temporary link to view a private file (default 1 hour). */
export async function signedDownloadUrl(key: string, expiresInSeconds = 3600, filename?: string): Promise<string> {
  return getSignedUrl(getStorage(), new GetObjectCommand({ Bucket: config.storage.bucket, Key: key, ResponseContentDisposition: filename ? `attachment; filename="${filename}"` : undefined }), { expiresIn: expiresInSeconds });
}

export async function deleteObject(key: string): Promise<void> {
  await getStorage().send(new DeleteObjectCommand({ Bucket: config.storage.bucket, Key: key }));
}

/** A temporary link the browser can PUT one file to (big files go straight to storage, not through the API). */
export async function signedUploadUrl(key: string, contentType: string, expiresInSeconds = 900): Promise<string> {
  return getSignedUrl(getStorage(), new PutObjectCommand({ Bucket: config.storage.bucket, Key: key, ContentType: contentType }), { expiresIn: expiresInSeconds });
}

/** Size of a stored file in bytes, or null when it doesn't exist. */
export async function objectSize(key: string): Promise<number | null> {
  try {
    const r = await getStorage().send(new HeadObjectCommand({ Bucket: config.storage.bucket, Key: key }));
    return r.ContentLength ?? 0;
  } catch {
    return null;
  }
}


/** Checks a report artifact while keeping missing files distinct from storage downtime. */
export async function reportObjectExists(key: string): Promise<boolean> {
  try {
    await getStorage().send(new HeadObjectCommand({ Bucket: config.storage.bucket, Key: key }), { abortSignal: AbortSignal.timeout(5000) });
    return true;
  } catch (error) {
    if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return false;
    throw serviceUnavailable("Report storage is temporarily unavailable. Try again shortly.");
  }
}
