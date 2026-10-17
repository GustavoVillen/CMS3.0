// Papelera: lo borrado en el sistema, para volver a ponerlo en su lugar.
//
// Los módulos de abajo borran "suave": marcan deletedAt / deletedByUserId y
// esconden el registro, sin tocar nada más (relevado módulo por módulo en oct
// 2026). Por eso restaurar es sólo limpiar esas dos marcas: el registro vuelve
// con su código, su historial y sus vínculos tal como estaban.
//
// Quedan AFUERA a propósito los borrados que hacen algo más, porque limpiar la
// marca no los deshace: la OT (no se borra, se anula), el diferimiento (al
// cancelarse devuelve la OT a PLANNED), el avance de OT (regenera las
// observaciones), el documento de IA (cambia de estado), el requisito de
// zafarrancho (se deshabilita), adjuntos y certificaciones del tripulante
// (cuelgan de otro registro) y Modos de Falla (módulo dormante). Tampoco
// aparece el equipo REEMPLAZADO por una OT de "equipo nuevo": no se borró, se
// dio de baja (replacementDate) y sus tareas quedaron inactivas.
//
// Permisos:
//   - Ver la papelera y restaurar cualquier cosa: `trash.restore` (por defecto
//     sólo TENANT_ADMIN; se puede tildar a otros roles en Equipo → Permisos).
//   - "Deshacer" lo que uno mismo acaba de borrar: lo puede quien lo borró,
//     dentro de UNDO_WINDOW_MS, sin necesitar `trash.restore` (si pudo borrarlo,
//     puede arrepentirse en el momento).
//   - Siempre dentro del tenant y del alcance por buque del usuario.

import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { hasPermission } from "../auth/role-permissions";
import { publishAudit } from "../../platform/audit/audit-publisher";

export const TRASH_KINDS = [
  "plan", "asset", "spare", "defect", "certificate", "provider", "crew", "drill",
  "permit", "moc", "nearMiss", "externalAudit", "fluidSample", "checklist",
  "serviceRequest", "spareRequest", "drydockSpec", "stockLocation", "bitacora", "vessel",
] as const;
export type TrashKind = typeof TRASH_KINDS[number];

/** Tiempo para "Deshacer" lo propio sin permiso de papelera (el aviso dura 10 s; margen para conexiones lentas). */
const UNDO_WINDOW_MS = 2 * 60_000;

type Row = Record<string, any>;

interface KindDef {
  /** Delegate de Prisma. */
  model: string;
  /** Nombre del modelo para la auditoría (`<Entity>.restored`). */
  entity: string;
  /** Campo de buque, o null si el registro es de toda la empresa. */
  vesselField: string | null;
  /** Campo del equipo al que pertenece (para mostrarlo y para no dejar huérfanos). */
  assetField?: string;
  /** Campos que se leen para armar la fila. */
  select: string[];
  code: (r: Row) => string;
  label: (r: Row) => string;
  /** Filtro extra: lo que no es un borrado de verdad. */
  extraWhere?: Record<string, unknown>;
}

const cut = (s: unknown, n = 90) => {
  const v = String(s ?? "").replace(/\s+/g, " ").trim();
  return v.length > n ? v.slice(0, n - 1) + "…" : v;
};

const KINDS: Record<TrashKind, KindDef> = {
  plan:          { model: "maintenancePlan",  entity: "MaintenancePlan",  vesselField: "vesselCode", assetField: "assetId", select: ["taskCode", "title"], code: r => r.taskCode, label: r => cut(r.title) },
  asset:         { model: "asset",            entity: "Asset",            vesselField: "vesselCode", select: ["assetCode", "name"], code: r => r.assetCode, label: r => cut(r.name), extraWhere: { replacementDate: null } },
  spare:         { model: "spare",            entity: "Spare",            vesselField: "vesselCode", select: ["sku", "name"], code: r => r.sku, label: r => cut(r.name) },
  defect:        { model: "defect",           entity: "Defect",           vesselField: "vesselCode", assetField: "assetId", select: ["defectCode", "description"], code: r => r.defectCode, label: r => cut(r.description) },
  certificate:   { model: "certificate",      entity: "Certificate",      vesselField: "vesselCode", assetField: "assetId", select: ["certificateCode", "name"], code: r => r.certificateCode, label: r => cut(r.name) },
  provider:      { model: "provider",         entity: "Provider",         vesselField: null, select: ["providerCode", "name"], code: r => r.providerCode, label: r => cut(r.name) },
  crew:          { model: "crew",             entity: "Crew",             vesselField: "vesselCode", select: ["crewCode", "firstName", "lastName"], code: r => r.crewCode, label: r => cut(`${r.firstName ?? ""} ${r.lastName ?? ""}`) },
  drill:         { model: "drill",            entity: "Drill",            vesselField: "vesselCode", select: ["drillCode"], code: r => r.drillCode, label: r => r.drillCode },
  permit:        { model: "permitToWork",     entity: "PermitToWork",     vesselField: "vesselCode", assetField: "assetId", select: ["permitCode", "description"], code: r => r.permitCode, label: r => cut(r.description) },
  moc:           { model: "mocRecord",        entity: "MocRecord",        vesselField: "vesselCode", select: ["mocCode", "title"], code: r => r.mocCode, label: r => cut(r.title) },
  nearMiss:      { model: "nearMissReport",   entity: "NearMissReport",   vesselField: "vesselCode", assetField: "assetId", select: ["nearMissCode", "description"], code: r => r.nearMissCode, label: r => cut(r.description) },
  externalAudit: { model: "externalAudit",    entity: "ExternalAudit",    vesselField: "vesselCode", select: ["auditCode", "inspectorName"], code: r => r.auditCode, label: r => cut(r.inspectorName || r.auditCode) },
  fluidSample:   { model: "fluidSample",      entity: "FluidSample",      vesselField: "vesselCode", assetField: "assetId", select: ["sampleCode", "labName"], code: r => r.sampleCode, label: r => cut(r.labName || r.sampleCode) },
  checklist:     { model: "checklistExecution", entity: "ChecklistExecution", vesselField: "vesselCode", select: ["executionCode"], code: r => r.executionCode, label: r => r.executionCode },
  serviceRequest:{ model: "serviceRequest",   entity: "ServiceRequest",   vesselField: "vesselCode", select: ["serviceRequestCode", "title", "description"], code: r => r.serviceRequestCode, label: r => cut(r.title || r.description) },
  spareRequest:  { model: "spareRequest",     entity: "SpareRequest",     vesselField: "requestedForVesselCode", select: ["requestCode"], code: r => r.requestCode, label: r => r.requestCode },
  drydockSpec:   { model: "drydockSpec",      entity: "DrydockSpec",      vesselField: "vesselCode", select: ["specCode", "title"], code: r => r.specCode, label: r => cut(r.title) },
  stockLocation: { model: "stockLocation",    entity: "StockLocation",    vesselField: "vesselCode", select: ["code", "name"], code: r => r.code, label: r => cut(r.name) },
  bitacora:      { model: "bitacoraEntry",    entity: "BitacoraEntry",    vesselField: "vesselCode", select: ["entryCode", "title"], code: r => r.entryCode, label: r => cut(r.title) },
  vessel:        { model: "vessel",           entity: "Vessel",           vesselField: null, select: ["code", "name"], code: r => r.code, label: r => cut(r.name) },
};

export function isTrashKind(v: unknown): v is TrashKind {
  return typeof v === "string" && (TRASH_KINDS as readonly string[]).includes(v);
}

export interface TrashItem {
  kind: TrashKind;
  id: string;
  code: string;
  label: string;
  vesselCode: string | null;
  vesselName: string | null;
  assetId: string | null;
  assetName: string | null;
  /** El equipo al que pertenece también está en la papelera: restaurar este registro solo lo dejaría colgado. */
  assetDeleted: boolean;
  deletedAt: string;
  deletedByName: string | null;
}

export interface TrashFilters {
  /** Días hacia atrás (default 30). 0 o null = todo. */
  days?: number | null;
  kind?: string | null;
  vesselCode?: string | null;
  q?: string | null;
  /** Sólo lo de este equipo (el equipo mismo y lo que le pertenece). */
  assetId?: string | null;
}

function db() {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  return prisma as any;
}

async function getTenantIdOrThrow(session: TenantAccessSession): Promise<string> {
  const tenant = await db().tenant.findUnique({ where: { slug: session.tenantSlug }, select: { id: true } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");
  return tenant.id;
}

/**
 * Alcance por buque, fail-closed: el administrador ve todo; los demás, sólo sus
 * buques. Un registro sin buque (proveedor, buque, depósito general) lo ve sólo
 * quien tiene alcance de empresa (TENANT_ADMIN) o el permiso de papelera.
 */
function scopeWhere(session: TenantAccessSession, def: KindDef, requested?: string | null): Record<string, unknown> | null {
  const isAdmin = session.user.role === "TENANT_ADMIN";
  const assigned = session.user.assignedVesselCodes ?? [];
  if (def.model === "vessel") {
    if (isAdmin) return requested ? { code: requested } : {};
    const codes = requested ? assigned.filter(c => c === requested) : assigned;
    return codes.length ? { code: { in: codes } } : null;
  }
  if (!def.vesselField) return requested ? null : {};
  if (isAdmin) return requested ? { [def.vesselField]: requested } : {};
  const codes = requested ? assigned.filter(c => c === requested) : assigned;
  return codes.length ? { [def.vesselField]: { in: codes } } : null;
}

function requireTrashPermission(session: TenantAccessSession) {
  if (!hasPermission(session, "trash.restore")) {
    throw new RouteError(403, "FORBIDDEN", "Solo el administrador puede ver y restaurar lo borrado.");
  }
}

export function canUseTrash(session: TenantAccessSession): boolean {
  return hasPermission(session, "trash.restore");
}

// ---------------------------------------------------------------------------
// Listado
// ---------------------------------------------------------------------------

export async function listTrash(session: TenantAccessSession, filters: TrashFilters = {}): Promise<TrashItem[]> {
  requireTrashPermission(session);
  const prisma = db();
  const tenantId = await getTenantIdOrThrow(session);

  const days = filters.days == null ? 30 : Number(filters.days);
  const since = days > 0 ? new Date(Date.now() - days * 86_400_000) : null;
  const kinds = isTrashKind(filters.kind) ? [filters.kind] : [...TRASH_KINDS];
  const assetId = filters.assetId?.trim() || null;

  const perKind = await Promise.all(kinds.map(async kind => {
    const def = KINDS[kind];
    const scope = scopeWhere(session, def, filters.vesselCode || null);
    if (!scope) return [] as Array<{ kind: TrashKind; def: KindDef; row: Row }>;
    if (assetId && kind !== "asset" && !def.assetField) return [];
    const where: Record<string, unknown> = {
      tenantId,
      deletedAt: since ? { not: null, gte: since } : { not: null },
      ...scope,
      ...(def.extraWhere ?? {}),
    };
    if (assetId) {
      if (kind === "asset") where.id = assetId;
      else where[def.assetField!] = assetId;
    }
    const select: Record<string, true> = { id: true, deletedAt: true, deletedByUserId: true };
    for (const f of def.select) select[f] = true;
    if (def.vesselField) select[def.vesselField] = true;
    if (def.assetField) select[def.assetField] = true;
    const rows: Row[] = await prisma[def.model].findMany({ where, select, orderBy: { deletedAt: "desc" }, take: 300 });
    return rows.map(row => ({ kind, def, row }));
  }));
  const flat = perKind.flat();
  if (flat.length === 0) return [];

  // Nombres: quién borró, de qué buque, de qué equipo (aunque el equipo esté borrado).
  const userIds = [...new Set(flat.map(f => f.row.deletedByUserId).filter(Boolean))] as string[];
  const assetIds = [...new Set(flat.map(f => (f.def.assetField ? f.row[f.def.assetField] : null)).filter(Boolean))] as string[];
  const [users, assets, vessels] = await Promise.all([
    userIds.length ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, formName: true, firstName: true, lastName: true, email: true } }) : [],
    assetIds.length ? prisma.asset.findMany({ where: { id: { in: assetIds }, tenantId }, select: { id: true, name: true, deletedAt: true } }) : [],
    prisma.vessel.findMany({ where: { tenantId }, select: { code: true, name: true } }),
  ]);
  const userName = new Map<string, string>(users.map((u: Row) => [u.id, (u.formName || [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email) as string]));
  const assetById = new Map<string, Row>(assets.map((a: Row) => [a.id, a]));
  const vesselName = new Map<string, string>(vessels.map((v: Row) => [v.code, v.name]));

  let items: TrashItem[] = flat.map(({ kind, def, row }) => {
    const vesselCode: string | null = def.model === "vessel" ? row.code : def.vesselField ? (row[def.vesselField] ?? null) : null;
    const aId: string | null = def.assetField ? (row[def.assetField] ?? null) : null;
    const asset = aId ? assetById.get(aId) : undefined;
    return {
      kind,
      id: row.id,
      code: def.code(row) ?? "",
      label: def.label(row) ?? "",
      vesselCode,
      vesselName: vesselCode ? (vesselName.get(vesselCode) ?? vesselCode) : null,
      assetId: aId,
      assetName: asset?.name ?? null,
      assetDeleted: !!asset?.deletedAt,
      deletedAt: new Date(row.deletedAt).toISOString(),
      deletedByName: row.deletedByUserId ? (userName.get(row.deletedByUserId) ?? null) : null,
    };
  });

  const q = filters.q?.trim().toLowerCase();
  if (q) {
    const words = q.split(/\s+/).filter(Boolean);
    items = items.filter(i => {
      const hay = `${i.code} ${i.label} ${i.assetName ?? ""} ${i.vesselName ?? ""}`.toLowerCase();
      return words.every(w => hay.includes(w));
    });
  }
  items.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  return items.slice(0, 500);
}

// ---------------------------------------------------------------------------
// Restaurar
// ---------------------------------------------------------------------------

export interface RestoreRef { kind: TrashKind; id: string }

export interface RestoreResult {
  restored: Array<{ kind: TrashKind; id: string; code: string; label: string; vesselCode: string | null }>;
}

/** Acepta `{kind,id}` o el texto "kind:id" (lo que devuelve el copiloto). */
export function parseRestoreRefs(raw: unknown): RestoreRef[] {
  if (!Array.isArray(raw)) throw new RouteError(400, "INVALID_ITEMS", "Faltan los registros a restaurar.");
  const refs: RestoreRef[] = [];
  for (const it of raw) {
    let kind: unknown, id: unknown;
    if (typeof it === "string") [kind, id] = it.split(":");
    else if (it && typeof it === "object") ({ kind, id } = it as Record<string, unknown>);
    if (!isTrashKind(kind) || typeof id !== "string" || !id.trim()) {
      throw new RouteError(400, "INVALID_ITEMS", "Registro a restaurar inválido.");
    }
    refs.push({ kind, id: id.trim() });
  }
  if (refs.length === 0) throw new RouteError(400, "INVALID_ITEMS", "Faltan los registros a restaurar.");
  if (refs.length > 200) throw new RouteError(400, "TOO_MANY_ITEMS", "Se pueden restaurar hasta 200 registros por vez.");
  return refs;
}

export async function restoreTrash(session: TenantAccessSession, refs: RestoreRef[]): Promise<RestoreResult> {
  const prisma = db();
  const tenantId = await getTenantIdOrThrow(session);
  const fullAccess = canUseTrash(session);
  const now = Date.now();

  // 1. Encontrar cada registro DENTRO del tenant y del alcance del usuario.
  const found: Array<{ ref: RestoreRef; def: KindDef; row: Row }> = [];
  for (const ref of refs) {
    const def = KINDS[ref.kind];
    const scope = scopeWhere(session, def, null);
    const row = scope ? await prisma[def.model].findFirst({
      where: { id: ref.id, tenantId, deletedAt: { not: null }, ...scope, ...(def.extraWhere ?? {}) },
    }) : null;
    if (!row) throw new RouteError(404, "NOT_IN_TRASH", "Ese registro no está en la papelera (puede que ya se haya restaurado).");
    // Sin permiso de papelera: sólo lo que uno mismo acaba de borrar.
    if (!fullAccess) {
      const own = row.deletedByUserId === session.user.id && now - new Date(row.deletedAt).getTime() <= UNDO_WINDOW_MS;
      if (!own) throw new RouteError(403, "FORBIDDEN", "Solo el administrador puede restaurar lo borrado.");
    }
    found.push({ ref, def, row });
  }

  // 2. No dejar registros colgados de un equipo borrado: el equipo tiene que
  //    venir en el mismo pedido.
  const assetsInRequest = new Set(found.filter(f => f.ref.kind === "asset").map(f => f.ref.id));
  const parentIds = [...new Set(found.map(f => (f.def.assetField ? f.row[f.def.assetField] : null)).filter((x): x is string => !!x && !assetsInRequest.has(x)))];
  if (parentIds.length) {
    const deletedParents = await prisma.asset.findMany({
      where: { id: { in: parentIds }, tenantId, deletedAt: { not: null } },
      select: { id: true, name: true, replacementDate: true },
    });
    if (deletedParents.length) {
      const names = deletedParents.map((a: Row) => a.name).join(", ");
      const replaced = deletedParents.some((a: Row) => a.replacementDate);
      throw new RouteError(409, replaced ? "ASSET_REPLACED" : "ASSET_DELETED", replaced
        ? `El equipo ${names} fue reemplazado por uno nuevo: sus registros no se pueden restaurar.`
        : `El equipo ${names} también está borrado: restauralo junto con sus registros.`);
    }
  }

  // 3. Restaurar: limpiar las dos marcas, y nada más.
  const restored: RestoreResult["restored"] = [];
  await prisma.$transaction(async (tx: any) => {
    for (const { ref, def, row } of found) {
      const data: Record<string, unknown> = { deletedAt: null };
      if ("deletedByUserId" in row) data.deletedByUserId = null;
      if ("updatedByUserId" in row) data.updatedByUserId = session.user.id;
      await tx[def.model].update({ where: { id: ref.id }, data });
      restored.push({
        kind: ref.kind, id: ref.id, code: def.code(row) ?? "", label: def.label(row) ?? "",
        vesselCode: def.model === "vessel" ? row.code : def.vesselField ? (row[def.vesselField] ?? null) : null,
      });
    }
  });

  for (const r of restored) {
    const { row, def } = found.find(f => f.ref.id === r.id && f.ref.kind === r.kind)!;
    void publishAudit(prisma, {
      tenantId,
      actorUserId: session.user.id,
      action: `${def.entity}.restored`,
      entityType: def.entity,
      entityId: r.id,
      metadata: {
        code: r.code, label: r.label, vesselCode: r.vesselCode,
        deletedAt: new Date(row.deletedAt).toISOString(), deletedByUserId: row.deletedByUserId ?? null,
        via: fullAccess ? "trash" : "undo",
      },
    });
  }
  return { restored };
}
