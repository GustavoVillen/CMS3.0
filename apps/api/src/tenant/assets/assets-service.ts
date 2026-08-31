import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { listDevAssetsForTenant } from "../../platform/data/dev-domain-store";
import { RouteError } from "../../http/route-error";
import { hasPermission } from "../auth/role-permissions";
import { publishAudit } from "../../platform/audit/audit-publisher";
import { buildChangeDiff } from "../audit/build-change-diff";
import { loadCurrentHoursByAsset, loadCurrentHoursForAsset } from "../asset-hours/asset-hours-service";

export interface AssetListFilters {
  vesselCode?: string | null;
  status?: string | null;
  criticality?: string | null;
  trackDailyReport?: boolean | null;
  isSafetyCritical?: boolean | null;
}

export interface CreateAssetInput {
  vesselCode: string;
  assetCode: string;
  name: string;
  sfiCode?: string | null;
  criticality?: "A" | "B" | "C";
  criticalityRationale?: string | null;
  status?: "OPERATIONAL" | "DEGRADED" | "OUT_OF_SERVICE";
  trackDailyReport?: boolean;
  isSafetyCritical?: boolean;
  planNotRequired?: boolean;
  planNotRequiredReason?: string | null;
  isStandby?: boolean;
  standbyTestPlanId?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  installationDate?: string | Date | null;
  lastOverhaulDate?: string | Date | null;
  replacementDate?: string | Date | null;
  equipmentClassId?: string | null;
  parentAssetId?: string | null;
}

export interface UpdateAssetInput {
  vesselCode?: string;
  assetCode?: string;
  name?: string;
  sfiCode?: string | null;
  criticality?: "A" | "B" | "C";
  criticalityRationale?: string | null;
  status?: "OPERATIONAL" | "DEGRADED" | "OUT_OF_SERVICE";
  trackDailyReport?: boolean;
  isSafetyCritical?: boolean;
  planNotRequired?: boolean;
  planNotRequiredReason?: string | null;
  isStandby?: boolean;
  standbyTestPlanId?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  installationDate?: string | Date | null;
  lastOverhaulDate?: string | Date | null;
  replacementDate?: string | Date | null;
  equipmentClassId?: string | null;
  parentAssetId?: string | null;
}

interface AssetRecord {
  id: string;
  tenantId: string;
  vesselCode: string;
  assetCode: string;
  sfiCode: string | null;
  name: string;
  criticality: string;
  status: string;
  trackDailyReport: boolean;
  isSafetyCritical: boolean;
  isStandby: boolean;
  standbyTestPlanId: string | null;
  manufacturer: string | null;
  model: string | null;
  serialNumber: string | null;
  installationDate: Date | null;
  lastOverhaulDate: Date | null;
  replacementDate: Date | null;
  equipmentClassId: string | null;
  parentAssetId: string | null;
  createdAt: Date;
  createdByUserId: string;
  updatedAt: Date;
  updatedByUserId: string;
  deletedAt: Date | null;
  /** Última lectura de horómetro (AssetHoursReading). Ver tenant/asset-hours. */
  currentHours: number | null;
  /** Fecha (YYYY-MM-DD) y origen de esa lectura, para que la UI muestre de cuándo es. */
  currentHoursDate?: string | null;
  currentHoursSource?: string | null;
}

/** ISM 10.3 no admite excepción: si el equipo es crítico para la seguridad,
 *  lleva plan y prueba periódica aunque la empresa quiera atenderlo por correctivo. */
function assertNotExemptIfSafetyCritical(): never {
  throw new RouteError(
    400,
    "SAFETY_CRITICAL_NEEDS_PLAN",
    "Un equipo crítico para la seguridad (ISM 10.3) no puede marcarse como que no requiere plan de mantenimiento.",
  );
}

/** ISM 10.3 — la prueba periódica de un equipo de reserva es una tarea DEL
 *  equipo. Apuntar a un plan de otro equipo (o inexistente) haría que el panel
 *  muestre como probado algo que nunca se probó. */
async function assertPlanBelongsToAsset(
  prisma: NonNullable<ReturnType<typeof getPrismaClient>>,
  tenantId: string,
  assetId: string,
  planId: string,
): Promise<void> {
  const plan = await prisma.maintenancePlan.findFirst({
    // No se exige que esté ACTIVE: si el plan se da de baja más adelante, el
    // panel ya lo lee como "sin prueba periódica", y bloquear el guardado del
    // equipo por eso sería una trampa (no se podría ni editar el nombre).
    where: { id: planId, tenantId, assetId, deletedAt: null },
    select: { id: true },
  });
  if (!plan) {
    throw new RouteError(
      400,
      "STANDBY_TEST_PLAN_NOT_FOUND",
      "La tarea elegida como prueba periódica no pertenece a este equipo.",
    );
  }
}

function canManageAssets(session: TenantAccessSession): boolean {
  return hasPermission(session, "asset.manage");
}

function ensureCanManageAssets(session: TenantAccessSession): void {
  if (!canManageAssets(session)) {
    throw new RouteError(403, "FORBIDDEN", "No autorizado para crear/editar/eliminar assets.");
  }
}

function normalizeRequiredText(value: unknown, field: string): string {
  const text = String(value ?? "").trim();
  if (!text) throw new RouteError(400, "VALIDATION_ERROR", `El campo ${field} es requerido.`);
  return text;
}

function normalizeOptionalText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function parseOptionalDate(value: unknown, field: string): Date | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw new RouteError(400, "VALIDATION_ERROR", `Fecha inválida en ${field}.`);
  }
  return parsed;
}

function applyVesselScope(
  session: TenantAccessSession,
  where: Record<string, unknown>,
  requestedVesselCode?: string | null,
  forbidOutOfScope = false,
): void {
  if (session.user.role === "TENANT_ADMIN") {
    if (requestedVesselCode) where.vesselCode = requestedVesselCode;
    return;
  }

  if (requestedVesselCode) {
    if (!session.user.assignedVesselCodes.includes(requestedVesselCode)) {
      if (forbidOutOfScope) throw new RouteError(403, "FORBIDDEN", "Sin acceso al vessel solicitado.");
      where.vesselCode = "__NO_ASSIGNED_VESSEL__";
      return;
    }
    where.vesselCode = requestedVesselCode;
    return;
  }

  if (session.user.assignedVesselCodes.length === 0) {
    where.vesselCode = "__NO_ASSIGNED_VESSEL__";
    return;
  }
  where.vesselCode = { in: session.user.assignedVesselCodes };
}

function isUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if (!("code" in error)) return false;
  return (error as { code?: unknown }).code === "P2002";
}

async function resolveTenantId(session: TenantAccessSession): Promise<string | null> {
  const prisma = getPrismaClient();
  if (!prisma) return null;
  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  return tenant?.id ?? null;
}

export async function listTenantAssets(session: TenantAccessSession, filters: AssetListFilters = {}) {
  const prisma = getPrismaClient();
  if (!prisma) {
    return listDevAssetsForTenant(session.tenantSlug, session.user.role, session.user.assignedVesselCodes, filters.vesselCode)
      .filter((item) => {
        if (filters.status && item.status !== filters.status) return false;
        if (filters.criticality && item.criticality !== filters.criticality) return false;
        return true;
      });
  }

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) return [];

  const conditions: string[] = [`"tenantId" = $1`, `"deletedAt" IS NULL`];
  const params: unknown[] = [tenant.id];

  const addParam = (col: string, val: unknown) => { params.push(val); conditions.push(`"${col}" = $${params.length}`); };

  // Vessel scope (FAIL-CLOSED). TENANT_ADMIN ve todo el tenant. Cualquier otro
  // rol solo ve sus vessels asignados; sin asignación → no ve nada (sentinel).
  // Si vino filters.vesselCode, se valida contra el scope del usuario.
  const requestedVessel = filters.vesselCode?.toUpperCase() ?? null;
  if (session.user.role === "TENANT_ADMIN") {
    if (requestedVessel) addParam("vesselCode", requestedVessel);
  } else {
    const assigned = session.user.assignedVesselCodes ?? [];
    if (requestedVessel) {
      addParam("vesselCode", assigned.includes(requestedVessel) ? requestedVessel : "__NO_ASSIGNED_VESSEL__");
    } else if (assigned.length === 0) {
      addParam("vesselCode", "__NO_ASSIGNED_VESSEL__");
    } else {
      const placeholders = assigned.map((_: string, i: number) => `$${params.length + i + 1}`).join(", ");
      assigned.forEach((c: string) => params.push(c));
      conditions.push(`"vesselCode" IN (${placeholders})`);
    }
  }

  if (filters.status) addParam("status", filters.status);
  if (filters.criticality) addParam("criticality", filters.criticality);
  if (filters.trackDailyReport != null) addParam("trackDailyReport", filters.trackDailyReport);
  if (filters.isSafetyCritical != null) addParam("isSafetyCritical", filters.isSafetyCritical);

  const rows = await prisma.$queryRawUnsafe<AssetRecord[]>(
    `SELECT a.* FROM "Asset" a WHERE ${conditions.join(" AND ")} ORDER BY a."vesselCode" ASC, a."assetCode" ASC`,
    ...params,
  );

  // Las horas actuales salen de AssetHoursReading vía el módulo asset-hours (única
  // fuente: planilla manual + M2 + reporte diario), no de un subquery propio.
  const currentMap = await loadCurrentHoursByAsset(prisma, tenant.id, rows.map((r) => r.id));
  return rows.map((row) => {
    const current = currentMap.get(row.id) ?? null;
    return {
      ...row,
      currentHours: current?.runningHours ?? null,
      currentHoursDate: current?.readingDate ?? null,
      currentHoursSource: current?.source ?? null,
    };
  });
}

export async function getTenantAsset(session: TenantAccessSession, id: string): Promise<AssetRecord> {
  const prisma = getPrismaClient();
  if (!prisma) {
    const items = listDevAssetsForTenant(session.tenantSlug, session.user.role, session.user.assignedVesselCodes);
    const record = items.find((item) => item.id === id);
    if (!record) throw new RouteError(404, "NOT_FOUND", "Asset no encontrado.");
    return record as unknown as AssetRecord;
  }

  const tenantId = await resolveTenantId(session);
  if (!tenantId) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");

  const rows = await prisma.$queryRawUnsafe<AssetRecord[]>(
    `SELECT a.* FROM "Asset" a
     WHERE a."id" = $1 AND a."tenantId" = $2 AND a."deletedAt" IS NULL LIMIT 1`,
    id, tenantId,
  );
  if (!rows.length) throw new RouteError(404, "NOT_FOUND", "Asset no encontrado.");

  const current = await loadCurrentHoursForAsset(prisma, tenantId, id);
  return {
    ...rows[0]!,
    currentHours: current?.runningHours ?? null,
    currentHoursDate: current?.readingDate ?? null,
    currentHoursSource: current?.source ?? null,
  };
}

export async function createTenantAsset(session: TenantAccessSession, payload: CreateAssetInput): Promise<AssetRecord> {
  ensureCanManageAssets(session);
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const tenantId = await resolveTenantId(session);
  if (!tenantId) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");

  const vesselCode = normalizeRequiredText(payload.vesselCode, "vesselCode").toUpperCase();
  applyVesselScope(session, {}, vesselCode, true);

  const data: Record<string, unknown> = {
    tenantId,
    vesselCode,
    assetCode: normalizeRequiredText(payload.assetCode, "assetCode").toUpperCase(),
    sfiCode: normalizeOptionalText(payload.sfiCode),
    name: normalizeRequiredText(payload.name, "name"),
    criticality: payload.criticality ?? "B",
    criticalityRationale: normalizeOptionalText(payload.criticalityRationale),
    status: payload.status ?? "OPERATIONAL",
    trackDailyReport: payload.trackDailyReport ?? false,
    isSafetyCritical: payload.isSafetyCritical ?? false,
    // Un equipo sin plan por decisión tiene que decir por qué; si no viene el
    // motivo, la excepción no se guarda (queda como equipo que lleva plan).
    planNotRequired: payload.planNotRequired ?? false,
    // ISM 10.3: un equipo crítico para la seguridad no puede quedar exento —
    // el Código exige mantenerlo y probarlo, no es una decisión de la empresa.
    ...(payload.planNotRequired && payload.isSafetyCritical ? assertNotExemptIfSafetyCritical() : {}),
    planNotRequiredReason: payload.planNotRequired ? normalizeOptionalText(payload.planNotRequiredReason) : null,
    // ISM 10.3: "de reserva" es una precisión sobre un equipo crítico para la
    // seguridad; fuera de ese universo no significa nada y no se guarda.
    isStandby: (payload.isStandby ?? false) && (payload.isSafetyCritical ?? false),
    // La prueba periódica se elige entre los planes del equipo, y un equipo
    // recién creado todavía no tiene ninguno: se designa al editarlo.
    standbyTestPlanId: null,
    manufacturer: normalizeOptionalText(payload.manufacturer),
    model: normalizeOptionalText(payload.model),
    serialNumber: normalizeOptionalText(payload.serialNumber),
    installationDate: parseOptionalDate(payload.installationDate, "installationDate"),
    lastOverhaulDate: parseOptionalDate(payload.lastOverhaulDate, "lastOverhaulDate"),
    replacementDate: parseOptionalDate(payload.replacementDate, "replacementDate"),
    createdByUserId: session.user.id,
    updatedByUserId: session.user.id,
  };

  try {
    const created = await (prisma as unknown as {
      asset: { create(args: { data: Record<string, unknown> }): Promise<AssetRecord> };
    }).asset.create({ data });
    void publishAudit(prisma, {
      tenantId,
      actorUserId: session.user.id,
      action: "Asset.created",
      entityType: "Asset",
      entityId: created.id,
      metadata: { assetCode: created.assetCode, name: created.name, vesselCode: created.vesselCode },
    });
    return created as unknown as AssetRecord;
  } catch (error: unknown) {
    if (isUniqueConstraintError(error)) {
      throw new RouteError(409, "DUPLICATE_ASSET_CODE", "Ya existe un asset con ese código en el vessel.");
    }
    throw error;
  }
}

export async function updateTenantAsset(
  session: TenantAccessSession,
  id: string,
  payload: UpdateAssetInput,
): Promise<AssetRecord> {
  ensureCanManageAssets(session);
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const current = await getTenantAsset(session, id);

  const data: Record<string, unknown> = {
    updatedByUserId: session.user.id,
    updatedAt: new Date(),
  };
  if (payload.vesselCode !== undefined) data.vesselCode = normalizeRequiredText(payload.vesselCode, "vesselCode").toUpperCase();
  if (payload.assetCode !== undefined) data.assetCode = normalizeRequiredText(payload.assetCode, "assetCode").toUpperCase();
  if (payload.name !== undefined) data.name = normalizeRequiredText(payload.name, "name");
  if (payload.sfiCode !== undefined) data.sfiCode = normalizeOptionalText(payload.sfiCode);
  if (payload.criticality !== undefined) data.criticality = payload.criticality;
  if (payload.criticalityRationale !== undefined) data.criticalityRationale = normalizeOptionalText(payload.criticalityRationale);
  if (payload.status !== undefined) data.status = payload.status;
  if (payload.trackDailyReport !== undefined) data.trackDailyReport = payload.trackDailyReport;
  if (payload.isSafetyCritical !== undefined) data.isSafetyCritical = payload.isSafetyCritical;
  // Salir de "no requiere plan" limpia el motivo: dejarlo colgado haría que el
  // equipo muestre una excepción que ya no existe.
  if (payload.planNotRequired !== undefined) {
    const safetyCritical = payload.isSafetyCritical
      ?? (current as unknown as { isSafetyCritical?: boolean }).isSafetyCritical
      ?? false;
    if (payload.planNotRequired && safetyCritical) assertNotExemptIfSafetyCritical();
    data.planNotRequired = payload.planNotRequired;
    if (!payload.planNotRequired) data.planNotRequiredReason = null;
  }
  if (payload.planNotRequiredReason !== undefined && payload.planNotRequired !== false) {
    data.planNotRequiredReason = normalizeOptionalText(payload.planNotRequiredReason);
  }
  // ISM 10.3 — equipo de reserva y cuál de sus tareas es la prueba periódica.
  // Las dos marcas cuelgan de isSafetyCritical: si el equipo deja de ser crítico
  // para la seguridad, se caen (si no, el panel contaría un equipo de reserva
  // que ya no pertenece al universo del 10.3).
  const safetyCriticalAfter = payload.isSafetyCritical
    ?? (current as unknown as { isSafetyCritical?: boolean }).isSafetyCritical
    ?? false;
  const standbyAfter = (payload.isStandby
    ?? (current as unknown as { isStandby?: boolean }).isStandby
    ?? false) && safetyCriticalAfter;
  if (payload.isStandby !== undefined || payload.isSafetyCritical !== undefined) {
    data.isStandby = standbyAfter;
  }
  if (!standbyAfter) {
    // Sin equipo de reserva no hay prueba periódica que designar: dejar el
    // puntero colgado mostraría una prueba que el panel ya no lee.
    if (payload.isStandby !== undefined || payload.isSafetyCritical !== undefined) data.standbyTestPlanId = null;
  } else if (payload.standbyTestPlanId !== undefined) {
    const planId = normalizeOptionalText(payload.standbyTestPlanId);
    if (planId) await assertPlanBelongsToAsset(prisma, current.tenantId, current.id, planId);
    data.standbyTestPlanId = planId;
  }
  if (payload.manufacturer !== undefined) data.manufacturer = normalizeOptionalText(payload.manufacturer);
  if (payload.model !== undefined) data.model = normalizeOptionalText(payload.model);
  if (payload.serialNumber !== undefined) data.serialNumber = normalizeOptionalText(payload.serialNumber);
  if (payload.installationDate !== undefined) data.installationDate = parseOptionalDate(payload.installationDate, "installationDate");
  if (payload.lastOverhaulDate !== undefined) data.lastOverhaulDate = parseOptionalDate(payload.lastOverhaulDate, "lastOverhaulDate");
  if (payload.replacementDate !== undefined) data.replacementDate = parseOptionalDate(payload.replacementDate, "replacementDate");

  // updateMany scoped { id, tenantId } — defense in depth on top of the
  // getTenantAsset() check above. update() returns the row but only accepts
  // unique-where; updateMany accepts compound non-unique scope.
  const result = await (prisma as unknown as {
    asset: { updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }> };
  }).asset.updateMany({
    where: { id: current.id, tenantId: current.tenantId },
    data,
  });
  if (result.count === 0) throw new RouteError(404, "NOT_FOUND", "Asset no encontrado.");

  const updated = await getTenantAsset(session, current.id);
  const changedKeys = Object.keys(data).filter(k => !["updatedByUserId", "updatedAt"].includes(k));
  const changes = buildChangeDiff(
    current as unknown as Record<string, unknown>,
    data,
    changedKeys,
  );
  void publishAudit(prisma, {
    tenantId: updated.tenantId,
    actorUserId: session.user.id,
    action: "Asset.updated",
    entityType: "Asset",
    entityId: updated.id,
    metadata: { assetCode: updated.assetCode, name: updated.name, vesselCode: updated.vesselCode, changes },
  });
  return updated;
}

export async function deleteTenantAsset(session: TenantAccessSession, id: string): Promise<void> {
  ensureCanManageAssets(session);
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const current = await getTenantAsset(session, id);
  await prisma.asset.update({
    where: { id: current.id },
    data: {
      deletedAt: new Date(),
      deletedByUserId: session.user.id,
      updatedByUserId: session.user.id,
    },
  });
  void publishAudit(prisma, {
    tenantId: current.tenantId,
    actorUserId: session.user.id,
    action: "Asset.deleted",
    entityType: "Asset",
    entityId: current.id,
    metadata: { assetCode: current.assetCode, name: current.name, vesselCode: current.vesselCode },
  });
}
