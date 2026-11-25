// Random, URL-safe ids and tokens (no look-alike characters: 0/O, 1/l/I).
import { randomBytes } from "node:crypto";

const ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function randomString(length: number): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i]! % ALPHABET.length];
  return out;
}

/** Primary key for a new row. */
export const newId = () => randomString(20);
