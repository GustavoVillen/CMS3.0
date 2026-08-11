// Autorizaciones por rol — UNICA fuente de verdad.
//
// Antes cada modulo tenia su propia lista de roles escrita a mano
// (`role === "TENANT_ADMIN" || role === "FLEET_SUPERINTENDENT"`). Ahora esas
// listas viven aca como DEFAULTS y el TENANT_ADMIN puede cambiarlas desde
// Equipo → Permisos por rol (se guardan en TenantSetting.rolePermissions).
//
// INVARIANTES (se aplican en el servidor, no se pueden romper desde la UI):
//   - TENANT_ADMIN  → SIEMPRE todas las autorizaciones.
//   - AUDITOR_READONLY → SIEMPRE ninguna. El rol es solo-lectura por definicion
//     y medio sistema lo asume (`role !== "AUDITOR_READONLY"` como gate de
//     escritura generico); permitir tildarle cosas dejaria el sistema incoherente.
//
// Los defaults son EXACTAMENTE lo que el codigo hacia antes de este cambio: con
// la configuracion vacia el comportamiento es identico al historico.

import type { TenantRole } from "@cms3/shared-types";
import type { TenantAccessSession } from "./session-store";
import { RouteError } from "../../http/route-error";
import { getPrismaClient } from "../../platform/data/prisma-client";

// ─── Catalogo ────────────────────────────────────────────────────────────────

export const PERMISSION_GROUPS = ["maintenance", "procurement", "safety", "crew", "system"] as const;
export type PermissionGroup = typeof PERMISSION_GROUPS[number];

export interface PermissionDef {
  key: string;
  group: PermissionGroup;
  /** Clave i18n del frontend (perm.<key en camelCase>). */
  labelKey: string;
}

export const PERMISSIONS: readonly PermissionDef[] = [
  // Mantenimiento
  { key: "wo.authorize",             group: "maintenance", labelKey: "perm.woAuthorize" },
  { key: "wo.manage",                group: "maintenance", labelKey: "perm.woManage" },
  { key: "wo.operate",               group: "maintenance", labelKey: "perm.woOperate" },
  { key: "plan.manage",              group: "maintenance", labelKey: "perm.planManage" },
  { key: "asset.manage",             group: "maintenance", labelKey: "perm.assetManage" },
  { key: "defect.write",             group: "maintenance", labelKey: "perm.defectWrite" },
  { key: "defect.delete",            group: "maintenance", labelKey: "perm.defectDelete" },
  // Solicitudes y compras
  { key: "sr.approve",               group: "procurement", labelKey: "perm.srApprove" },
  { key: "sr.authorize",             group: "procurement", labelKey: "perm.srAuthorize" },
  { key: "spareRequest.approve",     group: "procurement", labelKey: "perm.spareRequestApprove" },
  { key: "spare.manage",             group: "procurement", labelKey: "perm.spareManage" },
  { key: "stock.manage",             group: "procurement", labelKey: "perm.stockManage" },
  { key: "provider.manage",          group: "procurement", labelKey: "perm.providerManage" },
  // Seguridad
  { key: "permit.authorize",         group: "safety",      labelKey: "perm.permitAuthorize" },
  { key: "permit.manage",            group: "safety",      labelKey: "perm.permitManage" },
  { key: "moc.approve",              group: "safety",      labelKey: "perm.mocApprove" },
  { key: "externalAudit.manage",     group: "safety",      labelKey: "perm.externalAuditManage" },
  { key: "inspection.execute",       group: "safety",      labelKey: "perm.inspectionExecute" },
  { key: "checklist.manageTemplates", group: "safety",     labelKey: "perm.checklistManageTemplates" },
  // Tripulacion
  { key: "crew.manage",              group: "crew",        labelKey: "perm.crewManage" },
  { key: "crewCert.manage",          group: "crew",        labelKey: "perm.crewCertManage" },
  { key: "drill.manage",             group: "crew",        labelKey: "perm.drillManage" },
  { key: "certificate.manage",       group: "crew",        labelKey: "perm.certificateManage" },
  // Sistema
  { key: "team.manage",              group: "system",      labelKey: "perm.teamManage" },
];

export type PermissionKey = string;

const ALL_PERMISSION_KEYS: readonly string[] = PERMISSIONS.map((p) => p.key);
const VALID_KEYS = new Set<string>(ALL_PERMISSION_KEYS);

/** Roles cuya matriz NO se puede editar (ver invariantes arriba). */
export const LOCKED_ROLES: ReadonlySet<TenantRole> = new Set<TenantRole>(["TENANT_ADMIN", "AUDITOR_READONLY"]);

export const CONFIGURABLE_ROLES: readonly TenantRole[] = [
  "FLEET_SUPERINTENDENT",
  "MAINTENANCE_MANAGER",
  "TECHNICIAN_OPERATOR",
  "INSPECTOR_COMPLIANCE",
  "PROCUREMENT_STORE",
  "HSE_MANAGER",
];

export const ALL_TENANT_ROLES: readonly TenantRole[] = [
  "TENANT_ADMIN",
  "FLEET_SUPERINTENDENT",
  "MAINTENANCE_MANAGER",
  "TECHNICIAN_OPERATOR",
  "INSPECTOR_COMPLIANCE",
  "PROCUREMENT_STORE",
  "HSE_MANAGER",
  "AUDITOR_READONLY",
];

// ─── Defaults de fabrica ─────────────────────────────────────────────────────
// = comportamiento historico del codigo, rol por rol.

export const DEFAULT_ROLE_PERMISSIONS: Record<TenantRole, readonly string[]> = {
  TENANT_ADMIN: ALL_PERMISSION_KEYS,

  // Superintendente tecnico (tierra): autoriza OT y SS, aprueba MOC y permisos.
  FLEET_SUPERINTENDENT: [
    "wo.authorize", "wo.manage", "wo.operate", "plan.manage", "asset.manage",
    "sr.approve", "sr.authorize", "spareRequest.approve", "stock.manage",
    "permit.authorize", "permit.manage", "moc.approve", "externalAudit.manage",
    "inspection.execute", "checklist.manageTemplates",
    "crew.manage", "crewCert.manage", "drill.manage", "certificate.manage",
  ],

  // Capitan / Jefe de Maquinas (a bordo): aprueba a bordo, NO autoriza.
  MAINTENANCE_MANAGER: [
    "wo.manage", "wo.operate", "plan.manage", "asset.manage", "defect.write",
    "sr.approve", "spareRequest.approve", "spare.manage", "stock.manage", "provider.manage",
    "permit.manage", "externalAudit.manage", "inspection.execute", "checklist.manageTemplates",
    "crew.manage", "crewCert.manage", "drill.manage", "certificate.manage",
  ],

  // Tripulante: opera la OT, no la habilita.
  TECHNICIAN_OPERATOR: [
    "wo.operate", "defect.write", "permit.manage", "crew.manage", "certificate.manage",
  ],

  INSPECTOR_COMPLIANCE: [
    "defect.write", "externalAudit.manage", "inspection.execute",
    "crew.manage", "certificate.manage",
  ],

  PROCUREMENT_STORE: [
    "spare.manage", "stock.manage", "provider.manage",
  ],

  // Jefe SSMA — perfil de seguridad. Autoriza permisos de trabajo (el pedido que
  // origino esta pantalla), lleva auditorias, inspecciones, simulacros y
  // checklists. No autoriza OT ni toca planes/repuestos: el admin lo tilda si quiere.
  HSE_MANAGER: [
    "permit.authorize", "permit.manage", "externalAudit.manage", "inspection.execute",
    "checklist.manageTemplates", "drill.manage", "certificate.manage",
  ],

  AUDITOR_READONLY: [],
};

// ─── Resolucion + cache ──────────────────────────────────────────────────────
// Mismo patron que tenant-cache.ts: TTL corto + invalidacion explicita al guardar.

export type RolePermissionMatrix = Record<string, string[]>;

interface Entry {
  value: RolePermissionMatrix;
  expiresAt: number;
}

const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, Entry>();

/** Aplica overrides sobre los defaults y fuerza las invariantes de Admin/Auditor. */
function buildMatrix(overrides: unknown): RolePermissionMatrix {
  const stored = (overrides && typeof overrides === "object" && !Array.isArray(overrides))
    ? overrides as Record<string, unknown>
    : {};

  const matrix: RolePermissionMatrix = {};
  for (const role of ALL_TENANT_ROLES) {
    if (role === "TENANT_ADMIN") { matrix[role] = [...ALL_PERMISSION_KEYS]; continue; }
    if (role === "AUDITOR_READONLY") { matrix[role] = []; continue; }

    const override = stored[role];
    if (Array.isArray(override)) {
      matrix[role] = override.filter((k): k is string => typeof k === "string" && VALID_KEYS.has(k));
    } else {
      matrix[role] = [...DEFAULT_ROLE_PERMISSIONS[role]];
    }
  }
  return matrix;
}

/**
 * Matriz efectiva del tenant. Fail-safe: si la DB no responde devuelve los
 * defaults del codigo (nunca deja a todos sin permisos ni le da permisos de mas
 * a nadie — es exactamente el comportamiento historico).
 */
export async function resolveRolePermissions(tenantSlug: string): Promise<RolePermissionMatrix> {
  const now = Date.now();
  const hit = cache.get(tenantSlug);
  if (hit && hit.expiresAt > now) return hit.value;

  const prisma = getPrismaClient();
  if (!prisma) return buildMatrix(null);

  let stored: unknown = null;
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { slug: tenantSlug },
      select: { settings: { select: { rolePermissions: true } } },
    });
    stored = tenant?.settings?.rolePermissions ?? null;
  } catch {
    return buildMatrix(null);
  }

  const value = buildMatrix(stored);
  cache.set(tenantSlug, { value, expiresAt: now + TTL_MS });
  return value;
}

export function invalidateRolePermissionsCache(tenantSlug: string): void {
  cache.delete(tenantSlug);
}

/** Autorizaciones efectivas de un rol concreto — se guardan en la sesion al loguear. */
export async function resolvePermissionsForRole(tenantSlug: string, role: TenantRole): Promise<string[]> {
  const matrix = await resolveRolePermissions(tenantSlug);
  return matrix[role] ?? [...(DEFAULT_ROLE_PERMISSIONS[role] ?? [])];
}

// ─── Chequeo (sincronico: la lista viaja en la sesion) ───────────────────────

/**
 * Fallback a los defaults del rol si la sesion es vieja (token emitido antes de
 * este deploy): garantiza que nadie se quede sin permisos tras actualizar.
 */
export function hasPermission(session: TenantAccessSession, key: PermissionKey): boolean {
  const list = session.user.permissions ?? DEFAULT_ROLE_PERMISSIONS[session.user.role] ?? [];
  return list.includes(key);
}

export function ensurePermission(session: TenantAccessSession, key: PermissionKey, message: string): void {
  if (!hasPermission(session, key)) throw new RouteError(403, "FORBIDDEN", message);
}

/** Sanea lo que manda el cliente antes de guardarlo. */
export function sanitizeMatrix(input: unknown): RolePermissionMatrix {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new RouteError(400, "INVALID_BODY", "Se esperaba { rolePermissions: { [rol]: string[] } }.");
  }
  const raw = input as Record<string, unknown>;
  const clean: RolePermissionMatrix = {};
  for (const role of CONFIGURABLE_ROLES) {
    const value = raw[role];
    if (!Array.isArray(value)) continue;
    clean[role] = Array.from(new Set(
      value.filter((k): k is string => typeof k === "string" && VALID_KEYS.has(k)),
    ));
  }
  return clean;
}
