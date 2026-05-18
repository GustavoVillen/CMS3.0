import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { publishAudit } from "../../platform/audit/audit-publisher";
import { applyAssignedVesselScope } from "../auth/vessel-scope";
import { assertCanReopen, assertReopenReason } from "../../common/record-lock";

const PERMIT_TYPES = ["HOT_WORK", "ENCLOSED_SPACE_ENTRY", "WORKING_ALOFT", "ELECTRICAL_ISOLATION"] as const;
type PermitType = typeof PERMIT_TYPES[number];

const TERMINAL_STATUSES = new Set(["CLOSED", "CANCELLED", "REJECTED"]);
const EDITABLE_STATUSES = new Set(["DRAFT", "REQUESTED"]);

export interface PermitListFilters {
  vesselCode?: string | null;
  status?: string | null;
  type?: string | null;
  workOrderId?: string | null;
}

export interface PermitWriteInput {
  vesselCode?: string;
  permitCode?: string;
  type?: string;
  assetId?: string | null;
  workOrderId?: string | null;
  location?: string;
  description?: string;
  plannedStart?: string;
  plannedEnd?: string;
  validFrom?: string | null;
  validTo?: string | null;
  hazardsIdentified?: string | null;
  controlMeasures?: string | null;
  ppeRequired?: string | null;
  details?: Record<string, unknown>;
  alarmOverride?: boolean;
}

function canManage(session: TenantAccessSession): boolean {
  const r = session.user.role;
  return r === "TENANT_ADMIN" || r === "FLEET_SUPERINTENDENT" || r === "MAINTENANCE_MANAGER" || r === "TECHNICIAN_OPERATOR";
}
function canApprove(session: TenantAccessSession): boolean {
  const r = session.user.role;
  // Capitán/Jefe Máq lo hacen en buque; en plataforma lo mapeamos a TENANT_ADMIN / FLEET_SUPERINTENDENT.
  return r === "TENANT_ADMIN" || r === "FLEET_SUPERINTENDENT";
}
function ensureCanManage(session: TenantAccessSession) {
  if (!canManage(session)) throw new RouteError(403, "FORBIDDEN", "No autorizado para gestionar permisos.");
}
function ensureCanApprove(session: TenantAccessSession) {
  if (!canApprove(session)) throw new RouteError(403, "FORBIDDEN", "Solo Capitán/Superintendente puede aprobar/rechazar permisos.");
}

function normalizeRequired(value: unknown, field: string): string {
  const text = String(value ?? "").trim();
  if (!text) throw new RouteError(400, "VALIDATION_ERROR", `El campo ${field} es requerido.`);
  return text;
}
function normalizeOptional(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}
function parseDate(value: unknown, field: string): Date {
  if (!value) throw new RouteError(400, "VALIDATION_ERROR", `${field} es requerido.`);
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) throw new RouteError(400, "VALIDATION_ERROR", `${field} no es una fecha válida.`);
  return d;
}
function parseOptionalDate(value: unknown): Date | null {
  if (value === undefined || value === null || value === "") return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  return d;
}
function parseType(value: unknown): PermitType {
  const v = String(value ?? "").trim().toUpperCase();
  if (!PERMIT_TYPES.includes(v as PermitType)) {
    throw new RouteError(400, "VALIDATION_ERROR", `type de permiso inválido: ${v}.`);
  }
  return v as PermitType;
}

type PermitRecord = {
  id: string;
  tenantId: string;
  vesselCode: string;
  permitCode: string;
  type: string;
  status: string;
  reopenCount: number;
};

type PermitClient = {
  permitToWork: {
    findMany(args: { where: Record<string, unknown>; orderBy?: unknown; include?: unknown }): Promise<Record<string, unknown>[]>;
    findFirst(args: { where: Record<string, unknown>; include?: unknown }): Promise<Record<string, unknown> | null>;
    create(args: { data: Record<string, unknown> }): Promise<PermitRecord>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<PermitRecord>;
    count(args: { where: Record<string, unknown> }): Promise<number>;
  };
};

function permitClient(prisma: NonNullable<ReturnType<typeof getPrismaClient>>): PermitClient {
  return prisma as unknown as PermitClient;
}

export async function listPermits(session: TenantAccessSession, filters: PermitListFilters = {}) {
  const prisma = getPrismaClient();
  if (!prisma) return [];

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) return [];

  const where: Record<string, unknown> = { tenantId: tenant.id, deletedAt: null };
  applyAssignedVesselScope(session, where, filters.vesselCode ?? null);
  if (filters.status) where.status = filters.status;
  if (filters.type) where.type = filters.type;
  if (filters.workOrderId) where.workOrderId = filters.workOrderId;

  return permitClient(prisma).permitToWork.findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
    include: {
      gasTests: { orderBy: { testedAt: "desc" } },
      participants: true,
    },
  });
}

export async function getPermit(session: TenantAccessSession, id: string) {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");

  const row = await permitClient(prisma).permitToWork.findFirst({
    where: { id, tenantId: tenant.id, deletedAt: null },
    include: {
      gasTests: { orderBy: { testedAt: "desc" } },
      participants: true,
    },
  });
  if (!row) throw new RouteError(404, "NOT_FOUND", "Permiso no encontrado.");

  if (session.user.role !== "TENANT_ADMIN") {
    const vesselCode = (row as { vesselCode: string }).vesselCode;
    if (!session.user.assignedVesselCodes.includes(vesselCode)) {
      throw new RouteError(403, "FORBIDDEN", "Sin acceso al vessel de este permiso.");
    }
  }
  return row;
}

async function generatePermitCode(
  prisma: NonNullable<ReturnType<typeof getPrismaClient>>,
  tenantId: string,
  vesselCode: string,
  type: PermitType,
): Promise<string> {
  const year = new Date().getFullYear();
  const yy = String(year).slice(-2);
  const prefix = type === "HOT_WORK" ? "HW"
    : type === "ENCLOSED_SPACE_ENTRY" ? "ES"
    : type === "WORKING_ALOFT" ? "WA"
    : "EI";
  const count = await permitClient(prisma).permitToWork.count({
    where: { tenantId, vesselCode, type, createdAt: { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) } },
  });
  return `PTW-${prefix}-${vesselCode}-${yy}-${String(count + 1).padStart(4, "0")}`;
}

export async function createPermit(session: TenantAccessSession, input: PermitWriteInput) {
  ensureCanManage(session);

  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");

  const vesselCode = normalizeRequired(input.vesselCode, "vesselCode").toUpperCase();
  const type = parseType(input.type);
  const location = normalizeRequired(input.location, "location");
  const description = normalizeRequired(input.description, "description");
  const plannedStart = parseDate(input.plannedStart, "plannedStart");
  const plannedEnd = parseDate(input.plannedEnd, "plannedEnd");
  if (plannedEnd.getTime() <= plannedStart.getTime()) {
    throw new RouteError(400, "VALIDATION_ERROR", "plannedEnd debe ser posterior a plannedStart.");
  }

  const code = input.permitCode
    ? normalizeRequired(input.permitCode, "permitCode").toUpperCase()
    : await generatePermitCode(prisma, tenant.id, vesselCode, type);

  const existing = await permitClient(prisma).permitToWork.findFirst({
    where: { tenantId: tenant.id, vesselCode, permitCode: code, deletedAt: null },
  });
  if (existing) throw new RouteError(409, "DUPLICATE_CODE", `Ya existe un permiso con código ${code}.`);

  const created = await permitClient(prisma).permitToWork.create({
    data: {
      tenantId: tenant.id,
      vesselCode,
      permitCode: code,
      type,
      status: "DRAFT",
      assetId: normalizeOptional(input.assetId),
      workOrderId: normalizeOptional(input.workOrderId),
      location,
      description,
      plannedStart,
      plannedEnd,
      validFrom: parseOptionalDate(input.validFrom),
      validTo: parseOptionalDate(input.validTo),
      hazardsIdentified: normalizeOptional(input.hazardsIdentified),
      controlMeasures: normalizeOptional(input.controlMeasures),
      ppeRequired: normalizeOptional(input.ppeRequired),
      details: input.details ?? {},
      alarmOverride: !!input.alarmOverride,
      createdByUserId: session.user.id,
      updatedByUserId: session.user.id,
    },
  });

  void publishAudit(prisma, {
    tenantId: tenant.id,
    actorUserId: session.user.id,
    action: "Permit.created",
    entityType: "Permit",
    entityId: created.id,
    metadata: { permitCode: code, vesselCode, type },
  });

  return created;
}

export async function updatePermit(session: TenantAccessSession, id: string, input: PermitWriteInput) {
  ensureCanManage(session);

  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const current = await getPermit(session, id) as unknown as PermitRecord & { plannedStart: Date; plannedEnd: Date };

  if (!EDITABLE_STATUSES.has(current.status)) {
    throw new RouteError(
      409,
      "RECORD_LOCKED",
      `Solo permisos DRAFT o REQUESTED pueden editarse (actual: ${current.status}). Para corregirlo, un administrador debe re-abrirlo.`,
    );
  }

  const data: Record<string, unknown> = { updatedByUserId: session.user.id };
  if (input.type !== undefined) data.type = parseType(input.type);
  if (input.assetId !== undefined) data.assetId = normalizeOptional(input.assetId);
  if (input.workOrderId !== undefined) data.workOrderId = normalizeOptional(input.workOrderId);
  if (input.location !== undefined) data.location = normalizeRequired(input.location, "location");
  if (input.description !== undefined) data.description = normalizeRequired(input.description, "description");

  const nextStart = input.plannedStart !== undefined ? parseDate(input.plannedStart, "plannedStart") : current.plannedStart;
  const nextEnd = input.plannedEnd !== undefined ? parseDate(input.plannedEnd, "plannedEnd") : current.plannedEnd;
  if (nextEnd.getTime() <= nextStart.getTime()) {
    throw new RouteError(400, "VALIDATION_ERROR", "plannedEnd debe ser posterior a plannedStart.");
  }
  if (input.plannedStart !== undefined) data.plannedStart = nextStart;
  if (input.plannedEnd !== undefined) data.plannedEnd = nextEnd;
  if (input.validFrom !== undefined) data.validFrom = parseOptionalDate(input.validFrom);
  if (input.validTo !== undefined) data.validTo = parseOptionalDate(input.validTo);
  if (input.hazardsIdentified !== undefined) data.hazardsIdentified = normalizeOptional(input.hazardsIdentified);
  if (input.controlMeasures !== undefined) data.controlMeasures = normalizeOptional(input.controlMeasures);
  if (input.ppeRequired !== undefined) data.ppeRequired = normalizeOptional(input.ppeRequired);
  if (input.details !== undefined) data.details = input.details;
  if (input.alarmOverride !== undefined) data.alarmOverride = !!input.alarmOverride;

  const updated = await permitClient(prisma).permitToWork.update({ where: { id }, data });

  void publishAudit(prisma, {
    tenantId: current.tenantId,
    actorUserId: session.user.id,
    action: "Permit.updated",
    entityType: "Permit",
    entityId: id,
    metadata: { permitCode: current.permitCode, vesselCode: current.vesselCode },
  });
  return updated;
}

export async function requestPermit(session: TenantAccessSession, id: string) {
  ensureCanManage(session);
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const current = await getPermit(session, id) as unknown as PermitRecord;
  if (current.status !== "DRAFT") {
    throw new RouteError(409, "INVALID_STATUS_TRANSITION", `Solo permisos DRAFT pueden pedirse aprobación (actual: ${current.status}).`);
  }

  const updated = await permitClient(prisma).permitToWork.update({
    where: { id },
    data: {
      status: "REQUESTED",
      requestedAt: new Date(),
      requestedByUserId: session.user.id,
      updatedByUserId: session.user.id,
    },
  });

  void publishAudit(prisma, {
    tenantId: current.tenantId,
    actorUserId: session.user.id,
    action: "Permit.requested",
    entityType: "Permit",
    entityId: id,
    metadata: { permitCode: current.permitCode, vesselCode: current.vesselCode },
  });
  return updated;
}

export async function approvePermit(
  session: TenantAccessSession,
  id: string,
  payload: { validFrom?: string | null; validTo?: string | null },
) {
  ensureCanApprove(session);
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const current = await getPermit(session, id) as unknown as PermitRecord & { plannedStart: Date; plannedEnd: Date };
  if (current.status !== "REQUESTED") {
    throw new RouteError(409, "INVALID_STATUS_TRANSITION", `Solo permisos REQUESTED pueden aprobarse (actual: ${current.status}).`);
  }

  const validFrom = parseOptionalDate(payload?.validFrom) ?? current.plannedStart;
  const validTo = parseOptionalDate(payload?.validTo) ?? current.plannedEnd;
  if (validTo.getTime() <= validFrom.getTime()) {
    throw new RouteError(400, "VALIDATION_ERROR", "validTo debe ser posterior a validFrom.");
  }

  const updated = await permitClient(prisma).permitToWork.update({
    where: { id },
    data: {
      status: "APPROVED",
      approvedAt: new Date(),
      approvedByUserId: session.user.id,
      validFrom,
      validTo,
      updatedByUserId: session.user.id,
    },
  });

  void publishAudit(prisma, {
    tenantId: current.tenantId,
    actorUserId: session.user.id,
    action: "Permit.approved",
    entityType: "Permit",
    entityId: id,
    metadata: {
      permitCode: current.permitCode,
      vesselCode: current.vesselCode,
      validFrom: validFrom.toISOString(),
      validTo: validTo.toISOString(),
    },
  });
  return updated;
}

export async function rejectPermit(session: TenantAccessSession, id: string, payload: { reason: string }) {
  ensureCanApprove(session);
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const current = await getPermit(session, id) as unknown as PermitRecord;
  if (current.status !== "REQUESTED") {
    throw new RouteError(409, "INVALID_STATUS_TRANSITION", `Solo permisos REQUESTED pueden rechazarse (actual: ${current.status}).`);
  }
  const reason = normalizeRequired(payload?.reason, "reason");

  const updated = await permitClient(prisma).permitToWork.update({
    where: { id },
    data: {
      status: "REJECTED",
      rejectionReason: reason,
      updatedByUserId: session.user.id,
    },
  });

  void publishAudit(prisma, {
    tenantId: current.tenantId,
    actorUserId: session.user.id,
    action: "Permit.rejected",
    entityType: "Permit",
    entityId: id,
    metadata: { permitCode: current.permitCode, vesselCode: current.vesselCode, reason },
  });
  return updated;
}

export async function activatePermit(session: TenantAccessSession, id: string) {
  ensureCanManage(session);
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const current = await getPermit(session, id) as unknown as PermitRecord & {
    type: string;
    gasTests: { verdict: string; testedAt: Date }[];
  };
  if (current.status !== "APPROVED") {
    throw new RouteError(409, "INVALID_STATUS_TRANSITION", `Solo permisos APPROVED pueden activarse (actual: ${current.status}).`);
  }

  // ENCLOSED_SPACE_ENTRY: exigir al menos un gas test PASS reciente (< 30 min antes de activar).
  if (current.type === "ENCLOSED_SPACE_ENTRY") {
    const latest = current.gasTests[0];
    if (!latest || latest.verdict !== "PASS") {
      throw new RouteError(
        400,
        "GAS_TEST_REQUIRED",
        "Para entrada a espacio confinado se requiere al menos un gas test con verdict PASS antes de activar.",
      );
    }
    const ageMs = Date.now() - new Date(latest.testedAt).getTime();
    if (ageMs > 30 * 60 * 1000) {
      throw new RouteError(
        400,
        "GAS_TEST_STALE",
        "El último gas test PASS tiene más de 30 minutos. Realizá uno nuevo antes de activar.",
      );
    }
  }

  const updated = await permitClient(prisma).permitToWork.update({
    where: { id },
    data: {
      status: "ACTIVE",
      activatedAt: new Date(),
      activatedByUserId: session.user.id,
      updatedByUserId: session.user.id,
    },
  });

  void publishAudit(prisma, {
    tenantId: current.tenantId,
    actorUserId: session.user.id,
    action: "Permit.activated",
    entityType: "Permit",
    entityId: id,
    metadata: { permitCode: current.permitCode, vesselCode: current.vesselCode },
  });
  return updated;
}

export async function closePermit(session: TenantAccessSession, id: string, payload: { closeNotes?: string | null }) {
  ensureCanManage(session);
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const current = await getPermit(session, id) as unknown as PermitRecord;
  if (current.status !== "ACTIVE") {
    throw new RouteError(409, "INVALID_STATUS_TRANSITION", `Solo permisos ACTIVE pueden cerrarse (actual: ${current.status}).`);
  }

  const updated = await permitClient(prisma).permitToWork.update({
    where: { id },
    data: {
      status: "CLOSED",
      closedAt: new Date(),
      closedByUserId: session.user.id,
      closeNotes: normalizeOptional(payload?.closeNotes),
      updatedByUserId: session.user.id,
    },
  });

  void publishAudit(prisma, {
    tenantId: current.tenantId,
    actorUserId: session.user.id,
    action: "Permit.closed",
    entityType: "Permit",
    entityId: id,
    metadata: { permitCode: current.permitCode, vesselCode: current.vesselCode },
  });
  return updated;
}

export async function cancelPermit(session: TenantAccessSession, id: string, payload: { reason: string }) {
  ensureCanManage(session);
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const current = await getPermit(session, id) as unknown as PermitRecord;
  if (TERMINAL_STATUSES.has(current.status)) {
    throw new RouteError(409, "INVALID_STATUS_TRANSITION", `No se puede cancelar un permiso ${current.status}.`);
  }
  const reason = normalizeRequired(payload?.reason, "reason");

  const updated = await permitClient(prisma).permitToWork.update({
    where: { id },
    data: {
      status: "CANCELLED",
      cancelReason: reason,
      updatedByUserId: session.user.id,
    },
  });

  void publishAudit(prisma, {
    tenantId: current.tenantId,
    actorUserId: session.user.id,
    action: "Permit.cancelled",
    entityType: "Permit",
    entityId: id,
    metadata: { permitCode: current.permitCode, vesselCode: current.vesselCode, reason, previousStatus: current.status },
  });
  return updated;
}

export async function reopenPermit(session: TenantAccessSession, id: string, payload: { reason: string }) {
  assertCanReopen(session.user.role);
  const reason = assertReopenReason(payload?.reason);

  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const current = await getPermit(session, id) as unknown as PermitRecord;
  if (!TERMINAL_STATUSES.has(current.status)) {
    throw new RouteError(
      409,
      "INVALID_STATUS_TRANSITION",
      `Solo permisos terminales (CLOSED, CANCELLED, REJECTED) pueden re-abrirse (actual: ${current.status}).`,
    );
  }

  // Volvemos a DRAFT — edición libre + flujo completo nuevamente.
  const updated = await permitClient(prisma).permitToWork.update({
    where: { id },
    data: {
      status: "DRAFT",
      closedAt: null,
      closeNotes: null,
      cancelReason: null,
      rejectionReason: null,
      reopenCount: { increment: 1 },
      lastReopenAt: new Date(),
      lastReopenReason: reason,
      lastReopenByUserId: session.user.id,
      updatedByUserId: session.user.id,
    },
  });

  void publishAudit(prisma, {
    tenantId: current.tenantId,
    actorUserId: session.user.id,
    action: "Permit.reopened",
    entityType: "Permit",
    entityId: id,
    metadata: { permitCode: current.permitCode, vesselCode: current.vesselCode, previousStatus: current.status, reason },
  });
  return updated;
}

export async function deletePermit(session: TenantAccessSession, id: string) {
  if (session.user.role !== "TENANT_ADMIN") {
    throw new RouteError(403, "FORBIDDEN", "Solo TENANT_ADMIN puede eliminar permisos.");
  }
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const current = await getPermit(session, id) as unknown as PermitRecord;
  await permitClient(prisma).permitToWork.update({
    where: { id },
    data: { deletedAt: new Date(), deletedByUserId: session.user.id, updatedByUserId: session.user.id },
  });

  void publishAudit(prisma, {
    tenantId: current.tenantId,
    actorUserId: session.user.id,
    action: "Permit.deleted",
    entityType: "Permit",
    entityId: id,
    metadata: { permitCode: current.permitCode, vesselCode: current.vesselCode },
  });
}

/** Helper para gas-tests/participants: cargar permiso y validar acceso, sin requerir status. */
export async function getPermitForRelatedWrite(session: TenantAccessSession, permitId: string) {
  return getPermit(session, permitId) as unknown as Promise<PermitRecord>;
}
