import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";

const PASSWORD_KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = scryptSync(password, salt, PASSWORD_KEYLEN).toString("hex");
  return `scrypt$${salt}$${derivedKey}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  if (storedHash.startsWith("plain$")) {
    if (process.env.NODE_ENV === "production") return false;
    return storedHash.slice("plain$".length) === password;
  }

  if (!storedHash.startsWith("scrypt$")) return false;

  const [, salt, hashHex] = storedHash.split("$");
  if (!salt || !hashHex) return false;

  const derivedKey = scryptSync(password, salt, PASSWORD_KEYLEN);
  const stored = Buffer.from(hashHex, "hex");
  if (stored.length !== derivedKey.length) return false;

  return timingSafeEqual(derivedKey, stored);
}

export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
