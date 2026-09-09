// Revalidación en vivo de la sesión contra la base, en CADA request autenticado.
//
// Problema que resuelve (auditoría 2026-09-09): el access token es opaco y la
// sesión vive en un Map en memoria con una FOTO del rol, los buques y los
// permisos tomada al loguear. Dar de baja a alguien, cambiarle el rol o sacarle
// un buque no tocaba esa foto: el token seguía operativo —con los accesos
// viejos— hasta vencer (15 min). Con más de una instancia el problema empeora:
// el Map de la instancia B no se entera de nada de lo que pasó en la A.
//
// Solución: antes de despachar cualquier ruta, se relee la membership real
// (una query indexada por @@unique([tenantId, userId])) y:
//   · si ya no existe, está REVOKED/SUSPENDED, o el User no está ACTIVE
//     → 401 y se borra el token del Map;
//   · si sigue vigente, se sincroniza el snapshot de la sesión (rol, buques,
//     permisos) con lo que dice la base AHORA.
//
// Es la base de datos —compartida por todas las instancias— la que manda, así
// que la baja y el cambio de permisos valen para el request siguiente en
// cualquier instancia, sin necesidad de sticky sessions ni de un store externo.

import type { IncomingMessage } from "node:http";
import type { TenantRole } from "@cms3/shared-types";
import { getBearerToken } from "../../http/bearer-token";
import { RouteError } from "../../http/route-error";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { getCachedTenantBySlug } from "../tenant-cache";
import { resolvePermissionsForRole } from "./role-permissions";
import { getTenantAccessSession, revokeTenantAccessSession } from "./session-store";

/** Estados de membership que dejan de habilitar el acceso. */
const BLOCKED_MEMBERSHIP_STATUS = new Set(["REVOKED", "SUSPENDED", "INVITED"]);

export interface LiveMembership {
  role: TenantRole;
  assignedVesselCodes: string[];
}

/**
 * Membership vigente del usuario en el tenant, o `null` si ya no puede operar
 * (dado de baja, suspendido, o el usuario global deshabilitado).
 */
export async function loadLiveMembership(
  tenantSlug: string,
  userId: string,
): Promise<LiveMembership | null> {
  const prisma = getPrismaClient();
  if (!prisma) return null;

  const tenant = await getCachedTenantBySlug(tenantSlug);
  if (!tenant) return null;

  const membership = await (prisma as any).tenantMembership.findUnique({
    where: { tenantId_userId: { tenantId: tenant.id, userId } },
    select: {
      role: true,
      status: true,
      assignedVesselCodes: true,
      user: { select: { status: true } },
    },
  });

  return membershipToLive(membership);
}

/**
 * Decisión pura: ¿esta fila de membership habilita a operar, y con qué rol y
 * buques? Separada de la query para poder probarla sin base de datos.
 */
export function membershipToLive(membership: {
  role?: unknown;
  status?: unknown;
  assignedVesselCodes?: unknown;
  user?: { status?: unknown } | null;
} | null | undefined): LiveMembership | null {
  if (!membership) return null;
  if (BLOCKED_MEMBERSHIP_STATUS.has(String(membership.status))) return null;
  if (String(membership.user?.status) !== "ACTIVE") return null;

  return {
    role: membership.role as TenantRole,
    assignedVesselCodes: (membership.assignedVesselCodes ?? []) as string[],
  };
}

/**
 * Corre antes del dispatch de rutas. No exige sesión: si el request no trae
 * Bearer token, o el token no resuelve a una sesión de tenant (por ejemplo es
 * de la consola de plataforma), no hace nada y cada ruta decide como siempre.
 *
 * @throws 401 AUTH_SESSION_REVOKED si el usuario ya no puede operar en el tenant.
 */
export async function enforceLiveTenantSession(request: IncomingMessage): Promise<void> {
  const accessToken = getBearerToken(request);
  if (!accessToken) return;

  const session = getTenantAccessSession(accessToken);
  if (!session) return;

  const prisma = getPrismaClient();
  if (!prisma) return; // dev sin DB: el store en memoria es la única verdad.

  const live = await loadLiveMembership(session.tenantSlug, session.user.id);

  if (!live) {
    revokeTenantAccessSession(accessToken);
    throw new RouteError(
      401,
      "AUTH_SESSION_REVOKED",
      "Tu acceso a esta empresa fue dado de baja o suspendido. Volvé a iniciar sesión.",
    );
  }

  // Sincronizar el snapshot con la base. El Map guarda la MISMA referencia de
  // objeto que devuelve requireTenantAccessSession, así que todo el request
  // (routers y services) ve el rol, los buques y los permisos actuales.
  session.user.role = live.role;
  session.user.assignedVesselCodes = live.assignedVesselCodes;
  session.user.permissions = await resolvePermissionsForRole(session.tenantSlug, live.role);
}
