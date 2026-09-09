// Alcance y validación de vínculos de las solicitudes de repuestos.
//
// Auditoría 2026-09-09 (BUG-001 y BUG-003). Dos agujeros distintos, misma raíz:
// los servicios de ítems y de reservas comprobaban la EMPRESA pero no el BUQUE,
// y aceptaban un `spareId` cualquiera sin verificar de quién era ese repuesto.
//
// ── La regla de buque no es nueva ────────────────────────────────────────────
// Ya estaba escrita en `spare-requests-service.ts` (listSpareRequests /
// getRequestOrThrow) y es la que aplica toda la pantalla de Solicitudes:
//
//     · TENANT_ADMIN ve y opera todo el tenant;
//     · una solicitud SIN buque (`requestedForVesselCode = null`) es general y
//       la ve toda la empresa — es una compra que todavía no tiene destino;
//     · una solicitud CON buque sólo la ve quien tiene ese buque asignado.
//
// Acá se centraliza para que los tres servicios usen la MISMA función y no se
// vuelvan a separar. No se inventa ningún rol ni se cambia la matriz de permisos.
//
// ── La regla del repuesto se dedujo del flujo real ───────────────────────────
// La pantalla (`SpareRequests.tsx`) sólo ofrece repuestos del buque de la
// solicitud: `/app/pms/spares?vesselCode=<el de la solicitud>`. El backend no
// comprobaba nada, así que un POST directo podía enlazar el repuesto de otro
// buque —o de otra empresa— y desde ahí mover su stock. Lo que se exige ahora:
//
//     1. el repuesto es de esta empresa y no está borrado;
//     2. su buque está dentro del alcance de quien lo enlaza (fail-closed);
//     3. si la solicitud es de un buque, el repuesto es de ESE buque.
//
// Si la solicitud es general (sin buque), vale cualquier repuesto que el usuario
// ya pueda ver: es el caso de la compra centralizada, y (2) lo mantiene acotado.
//
// NO se toca el estado del repuesto (ACTIVE/OBSOLETE): la pantalla filtra por
// ACTIVE, pero prohibirlo en el backend es una decisión de negocio, no de
// seguridad, y bloquearía solicitudes viejas sobre repuestos dados de baja.

import type { TenantAccessSession } from "../auth/session-store";
import { RouteError } from "../../http/route-error";
import type { getPrismaClient } from "../../platform/data/prisma-client";

type PrismaLike = NonNullable<ReturnType<typeof getPrismaClient>>;

/** Lo mínimo que hace falta saber de una solicitud para decidir el alcance. */
export interface RequestScope {
  tenantId: string;
  requestedForVesselCode: string | null;
}

/**
 * ¿Este usuario alcanza a un registro de este buque?
 *
 * Decisión pura, sin base de datos, para poder probarla sola.
 * `null` = registro general del tenant (sin buque) → lo ve toda la empresa.
 */
export function hasVesselAccess(session: TenantAccessSession, vesselCode: string | null): boolean {
  if (session.user.role === "TENANT_ADMIN") return true;
  if (!vesselCode) return true;
  return (session.user.assignedVesselCodes ?? []).includes(vesselCode);
}

/**
 * Exige alcance sobre el buque de una solicitud.
 *
 * Contesta 404 —no 403— a propósito: quien no tiene el buque asignado no debe
 * poder distinguir "existe pero no es tuya" de "no existe". Es el mismo código
 * y el mismo mensaje que ya devolvía `spare-requests-service`.
 */
export function assertVesselAccess(session: TenantAccessSession, vesselCode: string | null): void {
  if (!hasVesselAccess(session, vesselCode)) {
    throw new RouteError(404, "NOT_FOUND", "Solicitud no encontrada.");
  }
}

/**
 * Decisión pura sobre si un repuesto puede enlazarse a una solicitud.
 * Separada de la query para poder probar la matriz completa sin base.
 *
 * @param spare  Repuesto YA leído filtrando por tenant, o `null` si no existe
 *               en esta empresa / está borrado.
 * @returns `null` si el vínculo es válido; si no, el motivo del rechazo.
 */
export function checkSpareLink(
  session: TenantAccessSession,
  request: Pick<RequestScope, "requestedForVesselCode">,
  spare: { vesselCode: string } | null,
): null | "NOT_FOUND" | "OUT_OF_SCOPE" | "OTHER_VESSEL" {
  // No existe en esta empresa (o está borrado): para el que pregunta, no existe.
  if (!spare) return "NOT_FOUND";

  // Fuera del alcance de buques del usuario.
  if (!hasVesselAccess(session, spare.vesselCode)) return "OUT_OF_SCOPE";

  // La solicitud tiene buque: el repuesto tiene que ser de ese buque.
  const requestVessel = request.requestedForVesselCode;
  if (requestVessel && spare.vesselCode !== requestVessel) return "OTHER_VESSEL";

  return null;
}

/**
 * Lee el repuesto dentro de la empresa y valida el vínculo. Devuelve el
 * repuesto para que el llamador no tenga que volver a buscarlo.
 *
 * @throws 404 SPARE_NOT_FOUND     no es de esta empresa, está borrado, o el
 *                                 usuario no alcanza su buque.
 * @throws 400 SPARE_OTHER_VESSEL  es de un buque distinto al de la solicitud.
 */
export async function assertSpareLinkable(
  prisma: PrismaLike,
  session: TenantAccessSession,
  request: RequestScope,
  spareId: string,
): Promise<{ id: string; vesselCode: string; unit: string }> {
  const spare = await prisma.spare.findFirst({
    where: { id: spareId, tenantId: request.tenantId, deletedAt: null },
    select: { id: true, vesselCode: true, unit: true },
  });

  const problem = checkSpareLink(session, request, spare);
  if (problem === "OTHER_VESSEL") {
    throw new RouteError(
      400,
      "SPARE_OTHER_VESSEL",
      `El repuesto pertenece al buque ${spare!.vesselCode} y la solicitud es del buque ` +
        `${request.requestedForVesselCode}. Un repuesto sólo puede pedirse para su propio buque.`,
    );
  }
  if (problem) {
    throw new RouteError(404, "SPARE_NOT_FOUND", "Repuesto no encontrado.");
  }

  return spare!;
}
