import { RouteError } from "../http/route-error";

/**
 * Record lockdown (vetting / SIRE 2.0 / TMSA 4):
 *
 * Una vez que un registro operativo cae en un estado terminal, no se puede
 * modificar más. Para corregir un registro cerrado, un TENANT_ADMIN debe
 * disparar un reopen explícito con justificación, que queda auditado en los
 * campos reopenCount / lastReopenAt / lastReopenReason / lastReopenByUserId.
 *
 * Esto evita que un usuario silenciosamente reescriba el resultado de una OT
 * cerrada, una inspección completada o un CAPA verificado, lo que es una de
 * las primeras cosas que mira un vetting auditor.
 */

export type LockableRecordType =
  | "WORK_ORDER"
  | "SERVICE_REQUEST"
  | "DEFECT"
  | "DEFERRAL"
  | "INSPECTION"
  | "CAPA";

const TERMINAL_STATUSES: Record<LockableRecordType, ReadonlySet<string>> = {
  WORK_ORDER:      new Set(["CLOSED", "CANCELLED"]),
  SERVICE_REQUEST: new Set(["COMPLETED", "CANCELLED", "REJECTED"]),
  DEFECT:          new Set(["RESOLVED", "CLOSED"]),
  DEFERRAL:        new Set(["CLOSED", "EXPIRED", "REJECTED"]),
  INSPECTION:      new Set(["COMPLETED", "CANCELLED"]),
  CAPA:            new Set(["VERIFIED_EFFECTIVE", "CLOSED", "CANCELLED"]),
};

export function isLockedStatus(type: LockableRecordType, status: string | null | undefined): boolean {
  if (!status) return false;
  return TERMINAL_STATUSES[type].has(status);
}

/**
 * Lanza RECORD_LOCKED 409 si el registro está en estado terminal.
 * Llamar al principio de cualquier update sobre un registro lockable.
 */
export function assertNotLocked(type: LockableRecordType, status: string | null | undefined): void {
  if (isLockedStatus(type, status)) {
    throw new RouteError(
      409,
      "RECORD_LOCKED",
      `Este registro está cerrado (${status}). Solo un administrador puede re-abrirlo con justificación.`,
    );
  }
}

/**
 * Verifica que el usuario tenga rol TENANT_ADMIN antes de re-abrir.
 * Devuelve RouteError 403 si no.
 */
export function assertCanReopen(role: string | null | undefined): void {
  if (role !== "TENANT_ADMIN") {
    throw new RouteError(
      403,
      "FORBIDDEN_REOPEN",
      "Solo un administrador del tenant puede re-abrir registros cerrados.",
    );
  }
}

/**
 * Verifica que se haya proporcionado una justificación válida para el reopen.
 */
export function assertReopenReason(reason: unknown): string {
  if (typeof reason !== "string" || reason.trim().length < 5) {
    throw new RouteError(
      400,
      "REOPEN_REASON_REQUIRED",
      "La justificación de re-apertura es obligatoria (mínimo 5 caracteres).",
    );
  }
  return reason.trim();
}
