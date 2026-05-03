// Vessel scoping helper para queries Prisma — FAIL-CLOSED.
//
// Reglas:
//   - TENANT_ADMIN: ve todo el tenant (no se aplica filtro).
//   - Otros roles con assignedVesselCodes vacío: NO ve nada (vesselCode = sentinel
//     que no matchea ningún registro real).
//   - Otros roles con assignedVesselCodes no vacío: ve solo sus vessels asignados.
//
// IMPORTANTE: el patrón antiguo `if (length > 0) { where.vesselCode = { in: ... } }`
// permitía a usuarios sin vessels asignados ver TODOS los datos del tenant. Esto
// es un bug crítico de aislamiento. Usar SIEMPRE este helper en lugar de ese patrón.

import type { TenantAccessSession } from "./session-store";

/** Sentinel imposible de matchear — fail-closed para usuarios sin vessels asignados. */
export const NO_ASSIGNED_VESSEL_SENTINEL = "__NO_ASSIGNED_VESSEL__";

/**
 * Aplica vessel scope al where clause de una query Prisma.
 * Mutates `where` in place.
 *
 * @param session  Sesión del usuario que ejecuta la query.
 * @param where    Objeto Prisma where que se mutará para agregar `vesselCode`.
 * @param requestedVesselCode  (opcional) Si se pidió un vessel específico vía filtro
 *                             externo, debe estar dentro del scope del usuario o
 *                             se reduce al sentinel.
 */
export function applyAssignedVesselScope(
  session: TenantAccessSession,
  where: Record<string, unknown>,
  requestedVesselCode?: string | null,
): void {
  const role = session.user.role;
  const assigned = session.user.assignedVesselCodes ?? [];

  // TENANT_ADMIN: sin restricción, salvo que pida un vessel específico.
  if (role === "TENANT_ADMIN") {
    if (requestedVesselCode) where.vesselCode = requestedVesselCode;
    return;
  }

  // Pidieron un vessel específico: solo lo deja pasar si está dentro del scope.
  if (requestedVesselCode) {
    if (!assigned.includes(requestedVesselCode)) {
      where.vesselCode = NO_ASSIGNED_VESSEL_SENTINEL;
      return;
    }
    where.vesselCode = requestedVesselCode;
    return;
  }

  // Sin vessels asignados → no ve nada (fail-closed).
  if (assigned.length === 0) {
    where.vesselCode = NO_ASSIGNED_VESSEL_SENTINEL;
    return;
  }

  where.vesselCode = { in: assigned };
}
