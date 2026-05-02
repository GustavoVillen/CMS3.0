import { createHash } from "node:crypto";

/**
 * Redacta un email para logs/audit, dejando suficiente información para
 * detectar patrones (mismo atacante, mismo dominio) sin almacenar el
 * email completo en logs accesibles a operations.
 *
 * Output: "<dominio>:<hash8>" — ej "gmail.com:a1b2c3d4"
 *
 * - El dominio queda en claro (útil para "ataque desde gmail vs corporate").
 * - El localpart se hashea (sha256, primeros 8 chars) — colisiones bajísimas
 *   para deduplicar attempts del mismo email sin revelarlo.
 * - Si el input no tiene "@" o está vacío, devuelve "invalid".
 */
export function redactEmail(email: string | null | undefined): string {
  const v = String(email ?? "").trim().toLowerCase();
  if (!v) return "invalid";
  const at = v.lastIndexOf("@");
  if (at <= 0 || at === v.length - 1) return "invalid";
  const local  = v.slice(0, at);
  const domain = v.slice(at + 1);
  const hash = createHash("sha256").update(local).digest("hex").slice(0, 8);
  return `${domain}:${hash}`;
}
