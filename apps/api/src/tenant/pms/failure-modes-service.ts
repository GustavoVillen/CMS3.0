import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { publishAudit } from "../../platform/audit/audit-publisher";
import { withUniqueRetry } from "../../common/unique-retry";

// ---------------------------------------------------------------------------
// FailureMode (RCM) — modo de falla de un activo.
// ---------------------------------------------------------------------------
// Cierra el lazo RCM que faltaba: cada modo de falla apunta al plan que lo
// mitiga (mitigatingPlanId) y los defectos apuntan al modo que se materializó
// (Defect.failureModeId). Acoplamiento flojo por id, scope tenant+vessel,
// soft-delete + audit — mismas convenciones que defects-service.
// ---------------------------------------------------------------------------

const CONSEQUENCE = ["SAFETY", "ENVIRONMENTAL", "OPERATIONAL", "NON_OPERATIONAL"] as const;
type ConsequenceCategory = (typeof CONSEQUENCE)[number];

const DETECTION = ["NONE", "INSPECTION", "FLUID", "VIBRATION", "THERMAL", "ULTRASOUND", "CONDITION"] as const;
type DetectionMethod = (typeof DETECTION)[number];

const PROBABILITY = ["LIKELY", "PROBABLE", "UNLIKELY", "RARE"] as const;
type Probability = (typeof PROBABILITY)[number];

export interface FailureModeListFilters {
  vesselCode?: string | null;
  assetId?: string | null;
  status?: string | null;
}

export interface CreateFailureModeInput {
  vesselCode: string;
  assetId: string;
  title: string;
  failureCause?: string | null;
  failureEffect?: string | null;
  consequenceCategory?: ConsequenceCategory | null;
  consequenceRationale?: string | null;
  detectionMethod?: DetectionMethod | null;
  mitigatingPlanId?: string | null;
  probability?: Probability | null;
  status?: string | null;
}

export interface UpdateFailureModeInput {
  vesselCode?: string;
  assetId?: string;
  title?: string;
  failureCause?: string | null;
  failureEffect?: string | null;
  consequenceCategory?: ConsequenceCategory | null;
  consequenceRationale?: string | null;
  detectionMethod?: DetectionMethod | null;
  mitigatingPlanId?: string | null;
  probability?: Probability | null;
  status?: string | null;
}

interface FailureModeRecord {
  id: string;
  tenantId: string;
  vesselCode: string;
  assetId: string;
  code: string;
  title: string;
  failureCause: string | null;
  failureEffect: string | null;
  consequenceCategory: ConsequenceCategory | null;
  consequenceRationale: string | null;
  detectionMethod: DetectionMethod;
  mitigatingPlanId: string | null;
  probability: string | null;
  status: string;
  createdAt: Date;
  createdByUserId: string;
  updatedAt: Date;
  updatedByUserId: string;
  deletedAt: Date | null;
  deletedByUserId: string | null;
}

type FailureModeDelegate = {
  findMany(args: { where: Record<string, unknown>; orderBy?: unknown }): Promise<FailureModeRecord[]>;
  findFirst(args: { where: Record<string, unknown> }): Promise<FailureModeRecord | null>;
  create(args: { data: Record<string, unknown> }): Promise<FailureModeRecord>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<FailureModeRecord>;
};

function failureModeDelegate(prisma: NonNullable<ReturnType<typeof getPrismaClient>>): FailureModeDelegate {
  return (prisma as unknown as { failureMode: FailureModeDelegate }).failureMode;
}

// --- Permisos: mismo criterio que defects (RCM lo mantiene el equipo técnico) ---
function canWriteFailureModes(session: TenantAccessSession): boolean {
  return (
    session.user.role === "TENANT_ADMIN" ||
    session.user.role === "MAINTENANCE_MANAGER" ||
    session.user.role === "TECHNICIAN_OPERATOR" ||
    session.user.role === "INSPECTOR_COMPLIANCE"
  );
}

function canDeleteFailureMode(session: TenantAccessSession): boolean {
  return session.user.role === "TENANT_ADMIN";
}

function ensureCanWrite(session: TenantAccessSession) {
  if (!canWriteFailureModes(session)) throw new RouteError(403, "FORBIDDEN", "No autorizado para modificar modos de falla.");
}

function ensureCanDelete(session: TenantAccessSession) {
  if (!canDeleteFailureMode(session)) throw new RouteError(403, "FORBIDDEN", "No autorizado para eliminar modos de falla.");
}

// --- Normalizadores ---
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

function normalizeEnum<T extends string>(value: unknown, allowed: readonly T[], field: string): T | null {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value).trim().toUpperCase() as T;
  if (!allowed.includes(text)) throw new RouteError(400, "VALIDATION_ERROR", `Valor invalido en ${field}.`);
  return text;
}

// --- Tenant / scope (idénticos a defects-service) ---
async function resolveTenantId(session: TenantAccessSession): Promise<string | null> {
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) return null;
  const tenant = await (prismaRaw as unknown as {
    tenant: { findUnique(a: { where: { slug: string } }): Promise<{ id: string } | null> };
  }).tenant.findUnique({ where: { slug: session.tenantSlug } });
  return tenant?.id ?? null;
}

async function getTenantIdOrThrow(session: TenantAccessSession): Promise<string> {
  const tenantId = await resolveTenantId(session);
  if (!tenantId) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");
  return tenantId;
}

function applyVesselScope(
  session: TenantAccessSession,
  where: Record<string, unknown>,
  requestedVesselCode?: string | null,
  forbidOutOfScope = false,
) {
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

type EnrichedFields = {
  assetCode: string | null;
  assetName: string | null;
  mitigatingPlanCode: string | null;
  mitigatingPlanTitle: string | null;
  covered: boolean;
};

/**
 * Enriquece los modos de falla con datos legibles para el frontend:
 *  - assetCode + assetName (el registro sólo guarda assetId cuid),
 *  - el plan que los mitiga (taskCode + título + estado),
 *  - `covered` = true si tiene un plan mitigante VIGENTE (ACTIVE) asociado.
 * Si el plan referenciado ya no existe o está inactivo, `covered` = false —
 * esto es lo que permite detectar huecos de cobertura del plan de mantenimiento.
 */
async function attachCoverage<T extends { assetId: string; mitigatingPlanId: string | null }>(
  prismaRaw: NonNullable<ReturnType<typeof getPrismaClient>>,
  tenantId: string,
  items: T[],
): Promise<Array<T & EnrichedFields>> {
  const empty: EnrichedFields = { assetCode: null, assetName: null, mitigatingPlanCode: null, mitigatingPlanTitle: null, covered: false };

  const assetIds = [...new Set(items.map(i => i.assetId).filter(Boolean))];
  const planIds = [...new Set(items.map(i => i.mitigatingPlanId).filter((v): v is string => !!v))];

  const assetMap = new Map<string, { assetCode: string; name: string | null }>();
  const planMap = new Map<string, { taskCode: string; title: string; status: string }>();

  try {
    if (assetIds.length > 0) {
      const assets = await (prismaRaw as unknown as {
        asset: { findMany(a: { where: Record<string, unknown>; select: Record<string, boolean> }): Promise<Array<{ id: string; assetCode: string; name: string | null }>> };
      }).asset.findMany({ where: { id: { in: assetIds }, tenantId }, select: { id: true, assetCode: true, name: true } });
      assets.forEach(a => assetMap.set(a.id, { assetCode: a.assetCode, name: a.name }));
    }
    if (planIds.length > 0) {
      const plans = await (prismaRaw as unknown as {
        maintenancePlan: { findMany(a: { where: Record<string, unknown>; select: Record<string, boolean> }): Promise<Array<{ id: string; taskCode: string; title: string; status: string }>> };
      }).maintenancePlan.findMany({ where: { id: { in: planIds }, tenantId, deletedAt: null }, select: { id: true, taskCode: true, title: true, status: true } });
      plans.forEach(p => planMap.set(p.id, { taskCode: p.taskCode, title: p.title, status: p.status }));
    }
  } catch {
    return items.map(i => ({ ...i, ...empty }));
  }

  return items.map(i => {
    const asset = assetMap.get(i.assetId) ?? null;
    const plan = i.mitigatingPlanId ? planMap.get(i.mitigatingPlanId) ?? null : null;
    return {
      ...i,
      assetCode: asset?.assetCode ?? null,
      assetName: asset?.name ?? null,
      mitigatingPlanCode: plan?.taskCode ?? null,
      mitigatingPlanTitle: plan?.title ?? null,
      covered: !!plan && plan.status === "ACTIVE",
    };
  });
}

async function assertAssetInTenant(
  prismaRaw: NonNullable<ReturnType<typeof getPrismaClient>>,
  tenantId: string,
  assetId: string,
) {
  const count = await (prismaRaw as unknown as {
    asset: { count(a: { where: Record<string, unknown> }): Promise<number> };
  }).asset.count({ where: { id: assetId, tenantId, deletedAt: null } });
  if (count === 0) throw new RouteError(404, "ASSET_NOT_FOUND", "Asset no encontrado o no pertenece a este tenant.");
}

async function assertPlanInTenant(
  prismaRaw: NonNullable<ReturnType<typeof getPrismaClient>>,
  tenantId: string,
  planId: string,
) {
  const count = await (prismaRaw as unknown as {
    maintenancePlan: { count(a: { where: Record<string, unknown> }): Promise<number> };
  }).maintenancePlan.count({ where: { id: planId, tenantId, deletedAt: null } });
  if (count === 0) throw new RouteError(404, "PLAN_NOT_FOUND", "Plan de mantenimiento no encontrado o no pertenece a este tenant.");
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function listFailureModes(session: TenantAccessSession, filters: FailureModeListFilters = {}) {
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) return [];
  const del = failureModeDelegate(prismaRaw);

  const tenantId = await resolveTenantId(session);
  if (!tenantId) return [];

  const where: Record<string, unknown> = { tenantId, deletedAt: null };
  applyVesselScope(session, where, filters.vesselCode ?? null);
  if (filters.assetId) where.assetId = filters.assetId;
  if (filters.status) where.status = filters.status;

  const items = await del.findMany({ where, orderBy: { code: "asc" } });
  return attachCoverage(prismaRaw, tenantId, items);
}

export async function getFailureMode(session: TenantAccessSession, id: string) {
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const del = failureModeDelegate(prismaRaw);

  const tenantId = await getTenantIdOrThrow(session);
  const where: Record<string, unknown> = { id, tenantId, deletedAt: null };
  applyVesselScope(session, where);

  const record = await del.findFirst({ where });
  if (!record) throw new RouteError(404, "NOT_FOUND", "Modo de falla no encontrado.");
  const [enriched] = await attachCoverage(prismaRaw, tenantId, [record]);
  return enriched;
}

export async function createFailureMode(session: TenantAccessSession, payload: CreateFailureModeInput) {
  ensureCanWrite(session);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const del = failureModeDelegate(prismaRaw);

  const tenantId = await getTenantIdOrThrow(session);
  const vesselCode = normalizeRequiredText(payload.vesselCode, "vesselCode").toUpperCase();
  applyVesselScope(session, {}, vesselCode, true);
  const assetId = normalizeRequiredText(payload.assetId, "assetId");
  const title = normalizeRequiredText(payload.title, "title");
  const mitigatingPlanId = normalizeOptionalText(payload.mitigatingPlanId);

  await assertAssetInTenant(prismaRaw, tenantId, assetId);
  if (mitigatingPlanId) await assertPlanInTenant(prismaRaw, tenantId, mitigatingPlanId);

  // Código secuencial por buque: FM-{vesselCode}-NNNN. Race-safe con withUniqueRetry
  // (reintenta con count+1+attempt ante colisión P2002 con @@unique(code)).
  const created = await withUniqueRetry(async (attempt) => {
    const existing = await del.findMany({ where: { tenantId, vesselCode } });
    const code = `FM-${vesselCode}-${String(existing.length + 1 + attempt).padStart(4, "0")}`;
    return del.create({
      data: {
        tenantId,
        vesselCode,
        assetId,
        code,
        title,
        failureCause: normalizeOptionalText(payload.failureCause),
        failureEffect: normalizeOptionalText(payload.failureEffect),
        consequenceCategory: normalizeEnum(payload.consequenceCategory, CONSEQUENCE, "consequenceCategory"),
        consequenceRationale: normalizeOptionalText(payload.consequenceRationale),
        detectionMethod: normalizeEnum(payload.detectionMethod, DETECTION, "detectionMethod") ?? "NONE",
        mitigatingPlanId,
        probability: normalizeEnum(payload.probability, PROBABILITY, "probability"),
        status: normalizeOptionalText(payload.status) ?? "ACTIVE",
        createdByUserId: session.user.id,
        updatedByUserId: session.user.id,
      },
    });
  });

  void publishAudit(prismaRaw, {
    tenantId,
    actorUserId: session.user.id,
    action: "FailureMode.created",
    entityType: "FailureMode",
    entityId: created.id,
    metadata: { code: created.code, vesselCode, assetId, consequenceCategory: created.consequenceCategory },
  });

  const [enriched] = await attachCoverage(prismaRaw, tenantId, [created]);
  return enriched;
}

export async function updateFailureMode(session: TenantAccessSession, id: string, payload: UpdateFailureModeInput) {
  ensureCanWrite(session);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const del = failureModeDelegate(prismaRaw);

  const current = await getFailureMode(session, id);
  const tenantId = current.tenantId;

  if (payload.vesselCode !== undefined) {
    const requested = normalizeRequiredText(payload.vesselCode, "vesselCode").toUpperCase();
    if (requested !== current.vesselCode) throw new RouteError(400, "VESSEL_IMMUTABLE", "No se permite cambiar vesselCode.");
  }

  const data: Record<string, unknown> = { updatedByUserId: session.user.id };
  if (payload.assetId !== undefined) {
    const assetId = normalizeRequiredText(payload.assetId, "assetId");
    await assertAssetInTenant(prismaRaw, tenantId, assetId);
    data.assetId = assetId;
  }
  if (payload.title !== undefined) data.title = normalizeRequiredText(payload.title, "title");
  if (payload.failureCause !== undefined) data.failureCause = normalizeOptionalText(payload.failureCause);
  if (payload.failureEffect !== undefined) data.failureEffect = normalizeOptionalText(payload.failureEffect);
  if (payload.consequenceCategory !== undefined) data.consequenceCategory = normalizeEnum(payload.consequenceCategory, CONSEQUENCE, "consequenceCategory");
  if (payload.consequenceRationale !== undefined) data.consequenceRationale = normalizeOptionalText(payload.consequenceRationale);
  if (payload.detectionMethod !== undefined) data.detectionMethod = normalizeEnum(payload.detectionMethod, DETECTION, "detectionMethod") ?? "NONE";
  if (payload.mitigatingPlanId !== undefined) {
    const planId = normalizeOptionalText(payload.mitigatingPlanId);
    if (planId) await assertPlanInTenant(prismaRaw, tenantId, planId);
    data.mitigatingPlanId = planId;
  }
  if (payload.probability !== undefined) data.probability = normalizeEnum(payload.probability, PROBABILITY, "probability");
  if (payload.status !== undefined) data.status = normalizeOptionalText(payload.status) ?? "ACTIVE";

  const updated = await del.update({ where: { id: current.id }, data });
  void publishAudit(prismaRaw, {
    tenantId,
    actorUserId: session.user.id,
    action: "FailureMode.updated",
    entityType: "FailureMode",
    entityId: current.id,
    metadata: { code: current.code, vesselCode: current.vesselCode },
  });

  const [enriched] = await attachCoverage(prismaRaw, tenantId, [updated]);
  return enriched;
}

export async function softDeleteFailureMode(session: TenantAccessSession, id: string) {
  ensureCanDelete(session);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const del = failureModeDelegate(prismaRaw);

  const current = await getFailureMode(session, id);
  await del.update({
    where: { id: current.id },
    data: { deletedAt: new Date(), deletedByUserId: session.user.id, updatedByUserId: session.user.id },
  });
  void publishAudit(prismaRaw, {
    tenantId: current.tenantId,
    actorUserId: session.user.id,
    action: "FailureMode.deleted",
    entityType: "FailureMode",
    entityId: current.id,
    metadata: { code: current.code, vesselCode: current.vesselCode },
  });
  return { ok: true };
}
