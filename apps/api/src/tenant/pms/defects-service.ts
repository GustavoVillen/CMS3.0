import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { publishAudit } from "../../platform/audit/audit-publisher";
import { assertNotLocked, assertCanReopen, assertReopenReason } from "../../common/record-lock";
import { createCapaInternal } from "./capa-service";
import { log } from "../../common/logger";
import { withUniqueRetry } from "../../common/unique-retry";
import { enqueueNotificationForRoles } from "../notifications/notifications-service";

export interface DefectListFilters {
  vesselCode?: string | null;
  status?: string | null;
  severity?: string | null;
  operationalState?: string | null;
  assetId?: string | null;
}

export interface CreateDefectInput {
  vesselCode: string;
  assetId: string;
  workOrderId?: string | null;
  status?: "OPEN" | "UNDER_REVIEW" | "IN_PROGRESS" | "DEFERRED" | "RESOLVED" | "CLOSED";
  severity?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  operationalState?: "NORMAL" | "DEGRADED" | "RESTRICTED" | "NO_GO";
  classification: string;
  reportedAt?: string | Date | null;
  description: string;
  immediateAction?: string | null;
  correctiveAction?: string | null;
  rcaAnalysis?: string | null;
  rcaMethodology?: "FIVE_WHYS" | "FISHBONE" | "FTA" | "BARRIER_ANALYSIS" | null;
  rcaImmediateCause?: string | null;
  rcaContributingCause?: string | null;
  rcaRootCause?: string | null;
  rcaPreventiveActions?: string | null;
  rcaCompletedAt?: string | Date | null;
  rcaApprovedAt?: string | Date | null;
  capaDescription?: string | null;
  repairType?: string | null;
}

export interface UpdateDefectInput {
  vesselCode?: string;
  assetId?: string;
  workOrderId?: string | null;
  status?: "OPEN" | "UNDER_REVIEW" | "IN_PROGRESS" | "DEFERRED" | "RESOLVED" | "CLOSED";
  severity?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  operationalState?: "NORMAL" | "DEGRADED" | "RESTRICTED" | "NO_GO";
  classification?: string;
  reportedAt?: string | Date | null;
  description?: string;
  immediateAction?: string | null;
  correctiveAction?: string | null;
  rcaAnalysis?: string | null;
  rcaMethodology?: "FIVE_WHYS" | "FISHBONE" | "FTA" | "BARRIER_ANALYSIS" | null;
  rcaImmediateCause?: string | null;
  rcaContributingCause?: string | null;
  rcaRootCause?: string | null;
  rcaPreventiveActions?: string | null;
  rcaCompletedAt?: string | Date | null;
  rcaApprovedAt?: string | Date | null;
  capaDescription?: string | null;
  repairType?: string | null;
}

interface DefectRecord {
  id: string;
  tenantId: string;
  vesselCode: string;
  assetId: string;
  workOrderId: string | null;
  defectCode: string;
  status: string;
  severity: string;
  operationalState: string;
  classification: string;
  reportedAt: Date;
  description: string;
  immediateAction: string | null;
  correctiveAction: string | null;
  rcaAnalysis: string | null;
  rcaMethodology: "FIVE_WHYS" | "FISHBONE" | "FTA" | "BARRIER_ANALYSIS" | null;
  rcaImmediateCause: string | null;
  rcaContributingCause: string | null;
  rcaRootCause: string | null;
  rcaPreventiveActions: string | null;
  rcaCompletedAt: Date | null;
  rcaApprovedAt: Date | null;
  rcaApprovedByUserId: string | null;
  capaDescription: string | null;
  repairType: string | null;
  createdAt: Date;
  createdByUserId: string;
  updatedAt: Date;
  updatedByUserId: string;
  deletedAt: Date | null;
  deletedByUserId: string | null;
}

type DefectDelegate = {
  findMany(args: { where: Record<string, unknown>; orderBy?: unknown }): Promise<DefectRecord[]>;
  findFirst(args: { where: Record<string, unknown> }): Promise<DefectRecord | null>;
  create(args: { data: Record<string, unknown> }): Promise<DefectRecord>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<DefectRecord>;
};

interface DefectsPrismaClient {
  tenant: NonNullable<ReturnType<typeof getPrismaClient>>["tenant"];
  defect: DefectDelegate;
}

function defectDelegate(prisma: NonNullable<ReturnType<typeof getPrismaClient>>): DefectDelegate {
  return (prisma as unknown as { defect: DefectDelegate }).defect;
}

function defectsClient(prisma: NonNullable<ReturnType<typeof getPrismaClient>>): DefectsPrismaClient {
  return prisma as unknown as DefectsPrismaClient;
}

function canWriteDefects(session: TenantAccessSession): boolean {
  return (
    session.user.role === "TENANT_ADMIN" ||
    session.user.role === "MAINTENANCE_MANAGER" ||
    session.user.role === "TECHNICIAN_OPERATOR" ||
    session.user.role === "INSPECTOR_COMPLIANCE"
  );
}

/**
 * Cerrar un defecto: permitido a TODOS los roles del tenant salvo
 * AUDITOR_READONLY. Igual criterio que para crear OT — la operación de
 * cierre es entrada normal de tripulación / superintendentes /
 * inspectores; restringirla bloqueaba flujos legítimos.
 *
 * Eliminar (deleteDefect) sigue restringido a TENANT_ADMIN porque es
 * destructivo y rompe trazabilidad.
 */
function canCloseDefect(session: TenantAccessSession): boolean {
  return session.user.role !== "AUDITOR_READONLY";
}

function canDeleteDefect(session: TenantAccessSession): boolean {
  return session.user.role === "TENANT_ADMIN";
}

function ensureCanWriteDefects(session: TenantAccessSession) {
  if (!canWriteDefects(session)) throw new RouteError(403, "FORBIDDEN", "No autorizado para modificar defects.");
}

function ensureCanCloseDefect(session: TenantAccessSession) {
  if (!canCloseDefect(session)) throw new RouteError(403, "FORBIDDEN", "Los usuarios solo-lectura no pueden cerrar defects.");
}

function ensureCanDeleteDefect(session: TenantAccessSession) {
  if (!canDeleteDefect(session)) throw new RouteError(403, "FORBIDDEN", "No autorizado para eliminar defects.");
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
  if (Number.isNaN(parsed.getTime())) throw new RouteError(400, "VALIDATION_ERROR", `Fecha invalida en ${field}.`);
  return parsed;
}

async function resolveTenantId(session: TenantAccessSession): Promise<string | null> {
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) return null;
  const prisma = defectsClient(prismaRaw);
  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
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

/**
 * Resuelve workOrderCode para una lista de defectos que tienen workOrderId,
 * para que el frontend pueda mostrar un badge legible (ej. WO-DONCHI-26-0010)
 * en vez del cuid, y permita navegar al detalle de la OT.
 */
async function attachWorkOrderCodes<T extends { workOrderId: string | null }>(
  prismaRaw: NonNullable<ReturnType<typeof getPrismaClient>>,
  tenantId: string,
  defects: T[],
): Promise<Array<T & { workOrderCode: string | null }>> {
  const ids = [...new Set(defects.map(d => d.workOrderId).filter((v): v is string => !!v))];
  if (ids.length === 0) return defects.map(d => ({ ...d, workOrderCode: null }));
  try {
    const wos = await (prismaRaw as unknown as {
      workOrder: { findMany(a: { where: Record<string, unknown>; select: Record<string, boolean> }): Promise<Array<{ id: string; workOrderCode: string }>> };
    }).workOrder.findMany({ where: { id: { in: ids }, tenantId }, select: { id: true, workOrderCode: true } });
    const codeMap = new Map(wos.map(w => [w.id, w.workOrderCode]));
    return defects.map(d => ({ ...d, workOrderCode: d.workOrderId ? codeMap.get(d.workOrderId) ?? null : null }));
  } catch {
    return defects.map(d => ({ ...d, workOrderCode: null }));
  }
}

export async function listDefects(session: TenantAccessSession, filters: DefectListFilters = {}) {
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) return [];
  const defect = defectDelegate(prismaRaw);

  const tenantId = await resolveTenantId(session);
  if (!tenantId) return [];

  const where: Record<string, unknown> = { tenantId, deletedAt: null };
  applyVesselScope(session, where, filters.vesselCode ?? null);
  if (filters.status) where.status = filters.status;
  if (filters.severity) where.severity = filters.severity;
  if (filters.operationalState) where.operationalState = filters.operationalState;
  if (filters.assetId) where.assetId = filters.assetId;

  const items = await defect.findMany({ where, orderBy: { reportedAt: "desc" } });
  return attachWorkOrderCodes(prismaRaw, tenantId, items as Array<{ workOrderId: string | null }>);
}

export async function getDefect(session: TenantAccessSession, id: string) {
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const defect = defectDelegate(prismaRaw);

  const tenantId = await getTenantIdOrThrow(session);
  const where: Record<string, unknown> = { id, tenantId, deletedAt: null };
  applyVesselScope(session, where);

  const record = await defect.findFirst({ where });
  if (!record) throw new RouteError(404, "NOT_FOUND", "Defect no encontrado.");
  const enriched = await attachWorkOrderCodes(prismaRaw, tenantId, [record as { workOrderId: string | null }]);
  return enriched[0];
}

export async function createDefect(session: TenantAccessSession, payload: CreateDefectInput) {
  ensureCanWriteDefects(session);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const defect = defectDelegate(prismaRaw);

  const tenantId = await getTenantIdOrThrow(session);
  const vesselCode = normalizeRequiredText(payload.vesselCode, "vesselCode").toUpperCase();
  applyVesselScope(session, {}, vesselCode, true);
  const assetId = normalizeRequiredText(payload.assetId, "assetId");
  const workOrderId = normalizeOptionalText(payload.workOrderId);

  // Validar tenant ownership de assetId y workOrderId.
  const assetCount = await (prismaRaw as any).asset.count({
    where: { id: assetId, tenantId, deletedAt: null },
  });
  if (assetCount === 0) {
    throw new RouteError(404, "ASSET_NOT_FOUND", "Asset no encontrado o no pertenece a este tenant.");
  }
  if (workOrderId) {
    const woCount = await (prismaRaw as any).workOrder.count({
      where: { id: workOrderId, tenantId, deletedAt: null },
    });
    if (woCount === 0) {
      throw new RouteError(404, "WORK_ORDER_NOT_FOUND", "Work order no encontrada o no pertenece a este tenant.");
    }
  }

  const year = new Date().getFullYear();
  const yy = String(year).slice(-2);
  const reportedAt = parseOptionalDate(payload.reportedAt, "reportedAt") ?? new Date();

  // Race protection: count() + create() puede chocar con @@unique(defectCode)
  // bajo concurrencia. withUniqueRetry reintenta con count+1+attempt en cada
  // colisión P2002 (hasta 5 attempts).
  const created = await withUniqueRetry(async (attempt) => {
    const defectCount = await defect.count({ where: { tenantId, vesselCode, createdAt: { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) } } });
    const defectCode = `DEF-${vesselCode}-${yy}-${String(defectCount + 1 + attempt).padStart(4, "0")}`;
    return defect.create({
      data: {
        tenantId,
        vesselCode,
        assetId,
        workOrderId,
        defectCode,
        status: payload.status ?? "OPEN",
        severity: payload.severity ?? "MEDIUM",
        operationalState: payload.operationalState ?? "NORMAL",
        classification: normalizeRequiredText(payload.classification, "classification"),
        reportedAt,
        description: normalizeRequiredText(payload.description, "description"),
        immediateAction: normalizeOptionalText(payload.immediateAction),
        correctiveAction: normalizeOptionalText(payload.correctiveAction),
        createdByUserId: session.user.id,
        updatedByUserId: session.user.id,
      },
    });
  });
  void publishAudit(prismaRaw, {
    tenantId,
    actorUserId: session.user.id,
    action: "Defect.created",
    entityType: "Defect",
    entityId: created.id,
    metadata: { defectCode: created.defectCode, vesselCode, severity: created.severity, classification: created.classification },
  });

  // Notif: defecto crítico → alerta in-app a admins/superintendentes/jefes
  // con acceso al buque. La unique (tenantId, recipientUserId, sourceType,
  // sourceId) garantiza que reintentos no dupliquen.
  if (created.severity === "CRITICAL") {
    void enqueueNotificationForRoles(prismaRaw, {
      tenantId,
      vesselCode,
      type:       "DEFECT_CRITICAL",
      severity:   "CRITICAL",
      title:      `Defecto crítico — ${created.defectCode}`,
      body:       created.description?.slice(0, 200) ?? null,
      linkUrl:    `/defects?openId=${created.id}`,
      sourceType: "DEFECT",
      sourceId:   created.id,
    }).catch((err) => log.error("[createDefect] notif enqueue failed:", err));
  }
  return created;
}

export async function updateDefect(session: TenantAccessSession, id: string, payload: UpdateDefectInput) {
  ensureCanWriteDefects(session);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const defect = defectDelegate(prismaRaw);

  const current = await getDefect(session, id);
  // Lockdown vetting: defectos RESOLVED/CLOSED no se editan sin /reopen.
  assertNotLocked("DEFECT", current.status);

  if (payload.vesselCode !== undefined) {
    const requested = normalizeRequiredText(payload.vesselCode, "vesselCode").toUpperCase();
    if (requested !== current.vesselCode) {
      throw new RouteError(400, "VESSEL_IMMUTABLE", "No se permite cambiar vesselCode.");
    }
  }

  const data: Record<string, unknown> = { updatedByUserId: session.user.id };
  if (payload.assetId !== undefined) data.assetId = normalizeRequiredText(payload.assetId, "assetId");
  if (payload.workOrderId !== undefined) data.workOrderId = normalizeOptionalText(payload.workOrderId);
  if (payload.status !== undefined) data.status = payload.status;
  if (payload.severity !== undefined) data.severity = payload.severity;
  if (payload.operationalState !== undefined) data.operationalState = payload.operationalState;
  if (payload.classification !== undefined) data.classification = normalizeRequiredText(payload.classification, "classification");
  if (payload.reportedAt !== undefined) data.reportedAt = parseOptionalDate(payload.reportedAt, "reportedAt");
  if (payload.description !== undefined) data.description = normalizeRequiredText(payload.description, "description");
  if (payload.immediateAction !== undefined) data.immediateAction = normalizeOptionalText(payload.immediateAction);
  if (payload.correctiveAction !== undefined) data.correctiveAction = normalizeOptionalText(payload.correctiveAction);
  if (payload.rcaAnalysis !== undefined) data.rcaAnalysis = normalizeOptionalText(payload.rcaAnalysis);
  if (payload.rcaMethodology !== undefined) data.rcaMethodology = payload.rcaMethodology || null;
  if (payload.rcaImmediateCause !== undefined) data.rcaImmediateCause = normalizeOptionalText(payload.rcaImmediateCause);
  if (payload.rcaContributingCause !== undefined) data.rcaContributingCause = normalizeOptionalText(payload.rcaContributingCause);
  if (payload.rcaRootCause !== undefined) data.rcaRootCause = normalizeOptionalText(payload.rcaRootCause);
  if (payload.rcaPreventiveActions !== undefined) data.rcaPreventiveActions = normalizeOptionalText(payload.rcaPreventiveActions);
  if (payload.rcaCompletedAt !== undefined) data.rcaCompletedAt = parseOptionalDate(payload.rcaCompletedAt, "rcaCompletedAt");
  if (payload.rcaApprovedAt !== undefined) {
    data.rcaApprovedAt = parseOptionalDate(payload.rcaApprovedAt, "rcaApprovedAt");
    data.rcaApprovedByUserId = data.rcaApprovedAt ? session.user.id : null;
  }
  if (payload.capaDescription !== undefined) data.capaDescription = normalizeOptionalText(payload.capaDescription);
  if (payload.repairType !== undefined) data.repairType = normalizeOptionalText(payload.repairType);

  const updated = await defect.update({ where: { id: current.id }, data });
  void publishAudit(prismaRaw, {
    tenantId: current.tenantId,
    actorUserId: session.user.id,
    action: "Defect.updated",
    entityType: "Defect",
    entityId: current.id,
    metadata: { defectCode: current.defectCode, vesselCode: current.vesselCode },
  });

  // Notif: si la severity pasó a CRITICAL en esta edición (de algo distinto),
  // encolar alerta. La unique constraint hace el resto si ya existía.
  const newSeverity = (updated as { severity?: string }).severity ?? current.severity;
  if (newSeverity === "CRITICAL" && current.severity !== "CRITICAL") {
    void enqueueNotificationForRoles(prismaRaw, {
      tenantId:   current.tenantId,
      vesselCode: current.vesselCode,
      type:       "DEFECT_CRITICAL",
      severity:   "CRITICAL",
      title:      `Defecto crítico — ${current.defectCode}`,
      body:       (((updated as { description?: string | null }).description) ?? current.description)?.slice(0, 200) ?? null,
      linkUrl:    `/defects?openId=${current.id}`,
      sourceType: "DEFECT",
      sourceId:   current.id,
    }).catch((err) => log.error("[updateDefect] notif enqueue failed:", err));
  }

  // Trigger: si recién se aprobó el RCA (transición null → fecha), crear
  // automáticamente una CAPA preventiva con sourceType=RCA. Anti-duplicado
  // por (sourceType, sourceId): no crea si ya existe activa.
  const wasJustApproved =
    payload.rcaApprovedAt !== undefined &&
    data.rcaApprovedAt !== null &&
    current.rcaApprovedAt === null;
  if (wasJustApproved) {
    try {
      const severity = (updated as { severity?: string }).severity ?? current.severity;
      const priority =
        severity === "CRITICAL" ? "CRITICAL" :
        severity === "HIGH"     ? "HIGH"     :
        severity === "MEDIUM"   ? "MEDIUM"   :
        "LOW";
      const description = [
        (updated as { rcaPreventiveActions?: string | null }).rcaPreventiveActions
          ?? current.rcaPreventiveActions ?? null,
        (updated as { rcaRootCause?: string | null }).rcaRootCause
          ?? current.rcaRootCause ?? null,
      ].filter(Boolean).join("\n\n").trim() || null;
      // $transaction envuelve la creación de CAPA para que el advisory lock
      // dentro de createCapaInternal funcione (pg_advisory_xact_lock requiere
      // tx activa). Sin tx, dos requests simultáneas pueden crear 2 CAPAs
      // duplicadas para el mismo defecto.
      const capaResult = await (prismaRaw as unknown as { $transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T> }).$transaction(async (tx) =>
        createCapaInternal(tx as Parameters<typeof createCapaInternal>[0], {
          tenantId:    current.tenantId,
          vesselCode:  current.vesselCode,
          assetId:     current.assetId,
          // El RCA vive dentro del defecto — anclamos la CAPA al defectId.
          sourceType:  "DEFECT",
          sourceId:    current.id,
          priority:    priority as "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
          title:       `CAPA preventiva — RCA aprobado del defecto ${current.defectCode}`,
          description,
          actorUserId: session.user.id,
        }),
      );
      if (capaResult && !capaResult.alreadyExisted) {
        void publishAudit(prismaRaw, {
          tenantId: current.tenantId,
          actorUserId: session.user.id,
          action: "Capa.created",
          entityType: "Capa",
          entityId: capaResult.id,
          metadata: { capaCode: capaResult.capaCode, autoGeneratedBy: "RCA_APPROVED", defectCode: current.defectCode, vesselCode: current.vesselCode },
        });
      }
    } catch (err) {
      log.error("[updateDefect] auto-CAPA from RCA approval failed:", err);
    }
  }

  return updated;
}

export async function closeDefect(session: TenantAccessSession, id: string, payload: { closeNotes?: string }) {
  ensureCanCloseDefect(session);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const defect = defectDelegate(prismaRaw);

  const current = await getDefect(session, id);
  if (current.status !== "RESOLVED") {
    throw new RouteError(409, "INVALID_STATUS_TRANSITION", `Solo RESOLVED puede pasar a CLOSED (actual: ${current.status}).`);
  }

  const note = normalizeOptionalText(payload.closeNotes);
  const correctiveAction = note
    ? (current.correctiveAction ? `${current.correctiveAction}\n[CLOSE] ${note}` : `[CLOSE] ${note}`)
    : current.correctiveAction;

  const closed = await defect.update({
    where: { id: current.id },
    data: { status: "CLOSED", correctiveAction, updatedByUserId: session.user.id },
  });
  void publishAudit(prismaRaw, {
    tenantId: current.tenantId,
    actorUserId: session.user.id,
    action: "Defect.closed",
    entityType: "Defect",
    entityId: current.id,
    metadata: { defectCode: current.defectCode, vesselCode: current.vesselCode },
  });
  return closed;
}

export async function reopenDefect(
  session: TenantAccessSession,
  id: string,
  payload: { reason: string },
) {
  assertCanReopen(session.user.role);
  const reason = assertReopenReason(payload?.reason);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const defect = defectDelegate(prismaRaw);

  const current = await getDefect(session, id);
  if (current.status !== "RESOLVED" && current.status !== "CLOSED") {
    throw new RouteError(409, "INVALID_STATUS_TRANSITION", `Solo defectos RESOLVED o CLOSED pueden re-abrirse (actual: ${current.status}).`);
  }

  const now = new Date();
  const reopened = await defect.update({
    where: { id: current.id },
    data: {
      status: "IN_PROGRESS",
      reopenCount: { increment: 1 },
      lastReopenAt: now,
      lastReopenReason: reason,
      lastReopenByUserId: session.user.id,
      updatedByUserId: session.user.id,
    } as Record<string, unknown>,
  });

  void publishAudit(prismaRaw, {
    tenantId: current.tenantId,
    actorUserId: session.user.id,
    action: "Defect.reopened",
    entityType: "Defect",
    entityId: current.id,
    metadata: {
      defectCode: current.defectCode,
      vesselCode: current.vesselCode,
      previousStatus: current.status,
      newStatus: "IN_PROGRESS",
      reason,
    },
  });

  return reopened;
}

export async function softDeleteDefect(session: TenantAccessSession, id: string) {
  ensureCanDeleteDefect(session);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const defect = defectDelegate(prismaRaw);

  const current = await getDefect(session, id);
  const deleted = await defect.update({
    where: { id: current.id },
    data: { deletedAt: new Date(), deletedByUserId: session.user.id, updatedByUserId: session.user.id },
  });
  void publishAudit(prismaRaw, {
    tenantId: current.tenantId,
    actorUserId: session.user.id,
    action: "Defect.deleted",
    entityType: "Defect",
    entityId: current.id,
    metadata: { defectCode: current.defectCode, vesselCode: current.vesselCode },
  });
  return deleted;
}
