import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { isDevelopmentMode } from "../../common/runtime-mode";

const PASSWORD_KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = scryptSync(password, salt, PASSWORD_KEYLEN).toString("hex");
  return `scrypt$${salt}$${derivedKey}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  if (storedHash.startsWith("plain$")) {
    // Los hashes "plain$" sólo existen en los stores en memoria de desarrollo.
    // Allow-list sobre "development", no deny-list sobre "production": con
    // NODE_ENV sin definir o mal escrito, la versión anterior aceptaba la
    // comparación en texto plano. Mismo criterio que runtime-mode.ts y env.ts.
    if (!isDevelopmentMode()) return false;
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

// Pre-computed at module load. Used to equalize timing when no real hash exists,
// preventing user enumeration via response-time side-channels.
const DUMMY_HASH = hashPassword("__timing_dummy_never_matches__");

/**
 * Verify a password against a hash. If `storedHash` is null/undefined/empty,
 * runs scrypt on a dummy hash anyway to keep response time constant — prevents
 * an attacker from distinguishing "user/vessel exists" from "doesn't exist"
 * via timing attacks. Always returns false in the dummy case.
 */
export function verifyPasswordOrTimingDummy(
  password: string,
  storedHash: string | null | undefined,
): boolean {
  if (!storedHash) {
    verifyPassword(password, DUMMY_HASH);
    return false;
  }
  return verifyPassword(password, storedHash);
}
