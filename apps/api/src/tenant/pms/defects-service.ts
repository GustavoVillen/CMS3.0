import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { publishAudit } from "../../platform/audit/audit-publisher";

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

function canCloseDefect(session: TenantAccessSession): boolean {
  return session.user.role === "TENANT_ADMIN" || session.user.role === "FLEET_SUPERINTENDENT" || session.user.role === "MAINTENANCE_MANAGER";
}

function canDeleteDefect(session: TenantAccessSession): boolean {
  return session.user.role === "TENANT_ADMIN";
}

function ensureCanWriteDefects(session: TenantAccessSession) {
  if (!canWriteDefects(session)) throw new RouteError(403, "FORBIDDEN", "No autorizado para modificar defects.");
}

function ensureCanCloseDefect(session: TenantAccessSession) {
  if (!canCloseDefect(session)) throw new RouteError(403, "FORBIDDEN", "No autorizado para cerrar defects.");
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

  return defect.findMany({ where, orderBy: { reportedAt: "desc" } });
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
  return record;
}

export async function createDefect(session: TenantAccessSession, payload: CreateDefectInput) {
  ensureCanWriteDefects(session);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const defect = defectDelegate(prismaRaw);

  const tenantId = await getTenantIdOrThrow(session);
  const vesselCode = normalizeRequiredText(payload.vesselCode, "vesselCode").toUpperCase();
  applyVesselScope(session, {}, vesselCode, true);

  const year = new Date().getFullYear();
  const yy = String(year).slice(-2);
  const defectCount = await defect.count({ where: { tenantId, vesselCode, createdAt: { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) } } });
  const defectCode = `DEF-${vesselCode}-${yy}-${String(defectCount + 1).padStart(4, "0")}`;
  const reportedAt = parseOptionalDate(payload.reportedAt, "reportedAt") ?? new Date();

  const created = await defect.create({
    data: {
      tenantId,
      vesselCode,
      assetId: normalizeRequiredText(payload.assetId, "assetId"),
      workOrderId: normalizeOptionalText(payload.workOrderId),
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
  void publishAudit(prismaRaw, {
    tenantId,
    actorUserId: session.user.id,
    action: "Defect.created",
    entityType: "Defect",
    entityId: created.id,
    metadata: { defectCode, vesselCode, severity: created.severity, classification: created.classification },
  });
  return created;
}

export async function updateDefect(session: TenantAccessSession, id: string, payload: UpdateDefectInput) {
  ensureCanWriteDefects(session);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const defect = defectDelegate(prismaRaw);

  const current = await getDefect(session, id);
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
