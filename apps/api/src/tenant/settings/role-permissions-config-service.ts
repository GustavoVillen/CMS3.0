// Configuracion de "Permisos por rol" (Equipo → Permisos por rol).
// Espejo de nav-config-service.ts: lectura abierta a cualquier usuario
// autenticado (la UI la necesita para saber que botones mostrar), escritura
// solo TENANT_ADMIN (validado en el router).

import type { TenantAccessSession } from "../auth/session-store";
import { refreshTenantSessionPermissions } from "../auth/session-store";
import {
  PERMISSIONS,
  ALL_TENANT_ROLES,
  CONFIGURABLE_ROLES,
  DEFAULT_ROLE_PERMISSIONS,
  invalidateRolePermissionsCache,
  resolveRolePermissions,
  sanitizeMatrix,
  type RolePermissionMatrix,
} from "../auth/role-permissions";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";

export interface RolePermissionsPayload {
  /** Catalogo completo: que autorizaciones existen y en que grupo van. */
  catalog: typeof PERMISSIONS;
  /** Orden de las columnas en la grilla. */
  roles: readonly string[];
  /** Roles que el admin puede editar (Admin y Auditor quedan bloqueados). */
  editableRoles: readonly string[];
  /** Matriz efectiva: rol → claves tildadas. */
  matrix: RolePermissionMatrix;
  /** Valores de fabrica, para el boton "Restaurar valores por defecto". */
  defaults: Record<string, readonly string[]>;
  /** Autorizaciones del usuario que pregunta — la UI gatea sus botones con esto. */
  mine: string[];
}

export async function getRolePermissions(session: TenantAccessSession): Promise<RolePermissionsPayload> {
  const matrix = await resolveRolePermissions(session.tenantSlug);
  return {
    catalog: PERMISSIONS,
    roles: ALL_TENANT_ROLES,
    editableRoles: CONFIGURABLE_ROLES,
    matrix,
    defaults: DEFAULT_ROLE_PERMISSIONS,
    mine: matrix[session.user.role] ?? [],
  };
}

/**
 * Guarda la matriz. Solo se persisten los roles configurables: Admin (todo) y
 * Auditor (nada) se recalculan siempre desde el codigo, asi que aunque el
 * cliente los mande se descartan.
 */
export async function setRolePermissions(
  session: TenantAccessSession,
  input: unknown,
): Promise<RolePermissionsPayload> {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");

  const clean = sanitizeMatrix(input);

  await prisma.tenantSetting.update({
    where: { tenantId: tenant.id },
    data: { rolePermissions: clean },
  });

  // Cambiar quien autoriza que tiene que quedar trazado (auditorias TMSA).
  try {
    await prisma.auditEvent.create({
      data: {
        tenantId:    tenant.id,
        actorType:   "TENANT_USER",
        actorUserId: session.user.id,
        action:      "ROLE_PERMISSIONS_UPDATED",
        entityType:  "TenantSetting",
        entityId:    tenant.id,
        metadata:    { rolePermissions: clean },
      },
    });
  } catch { /* la bitacora no debe bloquear el guardado */ }

  invalidateRolePermissionsCache(session.tenantSlug);

  // Impacta en las sesiones abiertas: el usuario ve el cambio en su proxima
  // accion, sin volver a loguearse.
  const matrix = await resolveRolePermissions(session.tenantSlug);
  refreshTenantSessionPermissions(session.tenantSlug, matrix);

  return getRolePermissions(session);
}
