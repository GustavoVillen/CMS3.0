import { RouteError } from "./route-error";

/**
 * In-memory account lockout — complementa el rate-limit por IP del login.
 *
 * Por qué: rate-limit por IP no protege contra brute force distribuido (botnet
 * con muchas IPs distintas atacando una sola cuenta). Lockout por identificador
 * detecta el ataque al usuario individual.
 *
 * Trade-off conocido: un atacante puede usar este mecanismo para bloquear
 * cuentas legítimas a propósito. Por eso la ventana es corta (15 min) y se
 * resetea automáticamente. Para el operador esto es aceptable; sin lockout,
 * un brute force distribuido es indefendible solo con rate-limit por IP.
 *
 * Para multi-instance: migrar a DB o Redis (count + lastFailureAt por user).
 */

const MAX_FAILURES = 5;
const WINDOW_MS    = 15 * 60 * 1000;

interface FailureRecord {
  count: number;
  firstFailureAt: number;
  lockedUntil: number | null;
}

const failures = new Map<string, FailureRecord>();

function bucketKey(scope: string, identifier: string): string {
  return `${scope}:${identifier.toLowerCase().trim()}`;
}

/** Throws 429 si la cuenta está bloqueada por exceso de fallos. */
export function assertNotLocked(scope: string, identifier: string): void {
  const key = bucketKey(scope, identifier);
  const rec = failures.get(key);
  if (!rec) return;
  const now = Date.now();
  if (rec.lockedUntil && rec.lockedUntil > now) {
    const secs = Math.ceil((rec.lockedUntil - now) / 1000);
    throw new RouteError(
      429,
      "ACCOUNT_TEMPORARILY_LOCKED",
      `Demasiados intentos fallidos. Intentá de nuevo en ${secs}s.`,
    );
  }
}

/** Registra un fallo de login. Tras MAX_FAILURES en WINDOW_MS, bloquea. */
export function recordLoginFailure(scope: string, identifier: string): void {
  const key = bucketKey(scope, identifier);
  const now = Date.now();
  const rec = failures.get(key);
  if (!rec || now - rec.firstFailureAt > WINDOW_MS) {
    failures.set(key, { count: 1, firstFailureAt: now, lockedUntil: null });
    return;
  }
  rec.count += 1;
  if (rec.count >= MAX_FAILURES) {
    rec.lockedUntil = now + WINDOW_MS;
  }
}

/** Limpia el contador al login exitoso. */
export function clearLoginFailures(scope: string, identifier: string): void {
  failures.delete(bucketKey(scope, identifier));
}

/** Cleanup periódico — drop registros viejos. */
export function evictExpiredLockouts(): void {
  const now = Date.now();
  for (const [key, rec] of failures) {
    const keepUntil = Math.max(rec.firstFailureAt + WINDOW_MS, rec.lockedUntil ?? 0);
    if (keepUntil < now) failures.delete(key);
  }
}
