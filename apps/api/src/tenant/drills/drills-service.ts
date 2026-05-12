import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { publishAudit } from "../../platform/audit/audit-publisher";
import { applyAssignedVesselScope } from "../auth/vessel-scope";
import { assertCanReopen, assertReopenReason } from "../../common/record-lock";

const DRILL_TYPES = [
  "FIRE", "ABANDON_SHIP", "ENCLOSED_SPACE", "MAN_OVERBOARD",
  "POLLUTION", "SECURITY", "MEDICAL", "STEERING_GEAR", "BLACKOUT",
  "OIL_SPILL", "OTHER",
] as const;
type DrillType = typeof DRILL_TYPES[number];

export interface DrillListFilters {
  vesselCode?: string | null;
  status?: string | null;
  type?: string | null;
}

export interface DrillWriteInput {
  vesselCode?: string;
  drillCode?: string;
  type?: string;
  scheduledDate?: string;
  scenario?: string | null;
  observations?: string | null;
  lessonsLearned?: string | null;
  participantCrewIds?: string[];
}

export interface CompleteDrillInput {
  completedDate?: string;
  observations?: string | null;
  lessonsLearned?: string | null;
  participantCrewIds?: string[];
}

function canManage(session: TenantAccessSession): boolean {
  const r = session.user.role;
  return r === "TENANT_ADMIN" || r === "FLEET_SUPERINTENDENT" || r === "MAINTENANCE_MANAGER";
}

function ensureCanManage(session: TenantAccessSession) {
  if (!canManage(session)) throw new RouteError(403, "FORBIDDEN", "No autorizado para gestionar simulacros.");
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

function parseType(value: unknown): DrillType {
  const v = String(value ?? "").trim().toUpperCase();
  if (!DRILL_TYPES.includes(v as DrillType)) {
    throw new RouteError(400, "VALIDATION_ERROR", `type de simulacro inválido: ${v}.`);
  }
  return v as DrillType;
}

function parseParticipantIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(v => String(v ?? "").trim()).filter(Boolean);
}

type DrillClient = {
  drill: {
    findMany(args: { where: Record<string, unknown>; orderBy?: unknown }): Promise<Record<string, unknown>[]>;
    findFirst(args: { where: Record<string, unknown> }): Promise<Record<string, unknown> | null>;
    create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<Record<string, unknown>>;
    count(args: { where: Record<string, unknown> }): Promise<number>;
  };
};

function drillClient(prisma: NonNullable<ReturnType<typeof getPrismaClient>>): DrillClient {
  return prisma as unknown as DrillClient;
}

export async function listDrills(session: TenantAccessSession, filters: DrillListFilters = {}) {
  const prisma = getPrismaClient();
  if (!prisma) return [];

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) return [];

  const where: Record<string, unknown> = { tenantId: tenant.id, deletedAt: null };
  applyAssignedVesselScope(session, where, filters.vesselCode ?? null);
  if (filters.status) where.status = filters.status;
  if (filters.type) where.type = filters.type;

  return drillClient(prisma).drill.findMany({
    where,
    orderBy: [{ scheduledDate: "desc" }],
  });
}

export async function getDrill(session: TenantAccessSession, id: string) {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");

  const row = await drillClient(prisma).drill.findFirst({
    where: { id, tenantId: tenant.id, deletedAt: null },
  });
  if (!row) throw new RouteError(404, "NOT_FOUND", "Simulacro no encontrado.");

  if (session.user.role !== "TENANT_ADMIN") {
    const vesselCode = (row as { vesselCode: string }).vesselCode;
    if (!session.user.assignedVesselCodes.includes(vesselCode)) {
      throw new RouteError(403, "FORBIDDEN", "Sin acceso al vessel de este simulacro.");
    }
  }
  return row;
}

async function generateDrillCode(prisma: NonNullable<ReturnType<typeof getPrismaClient>>, tenantId: string, vesselCode: string): Promise<string> {
  const year = new Date().getFullYear();
  const yy = String(year).slice(-2);
  const count = await drillClient(prisma).drill.count({
    where: { tenantId, vesselCode, createdAt: { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) } },
  });
  return `DRL-${vesselCode}-${yy}-${String(count + 1).padStart(4, "0")}`;
}

export async function createDrill(session: TenantAccessSession, input: DrillWriteInput) {
  ensureCanManage(session);

  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");

  const vesselCode = normalizeRequired(input.vesselCode, "vesselCode").toUpperCase();
  const type = parseType(input.type);
  const scheduledDate = parseDate(input.scheduledDate, "scheduledDate");

  const code = input.drillCode
    ? normalizeRequired(input.drillCode, "drillCode").toUpperCase()
    : await generateDrillCode(prisma, tenant.id, vesselCode);

  const existing = await drillClient(prisma).drill.findFirst({
    where: { tenantId: tenant.id, vesselCode, drillCode: code, deletedAt: null },
  });
  if (existing) throw new RouteError(409, "DUPLICATE_CODE", `Ya existe un simulacro con código ${code}.`);

  const created = await drillClient(prisma).drill.create({
    data: {
      tenantId: tenant.id,
      vesselCode,
      drillCode: code,
      type,
      status: "SCHEDULED",
      scheduledDate,
      scenario: normalizeOptional(input.scenario),
      observations: normalizeOptional(input.observations),
      lessonsLearned: normalizeOptional(input.lessonsLearned),
      participantCrewIds: parseParticipantIds(input.participantCrewIds),
      createdByUserId: session.user.id,
      updatedByUserId: session.user.id,
    },
  });

  void publishAudit(prisma, {
    tenantId: tenant.id,
    actorUserId: session.user.id,
    action: "Drill.created",
    entityType: "Drill",
    entityId: created.id as string,
    metadata: { drillCode: code, vesselCode, type, scheduledDate: scheduledDate.toISOString() },
  });

  return created;
}

export async function updateDrill(session: TenantAccessSession, id: string, input: DrillWriteInput) {
  ensureCanManage(session);

  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const current = await getDrill(session, id);
  const status = (current as { status: string }).status;
  if (status === "COMPLETED" || status === "CANCELLED") {
    throw new RouteError(409, "RECORD_LOCKED", `Este simulacro está ${status}. Sólo un administrador puede re-abrirlo con justificación.`);
  }

  const data: Record<string, unknown> = { updatedByUserId: session.user.id };
  if (input.type !== undefined) data.type = parseType(input.type);
  if (input.scheduledDate !== undefined) data.scheduledDate = parseDate(input.scheduledDate, "scheduledDate");
  if (input.scenario !== undefined) data.scenario = normalizeOptional(input.scenario);
  if (input.observations !== undefined) data.observations = normalizeOptional(input.observations);
  if (input.lessonsLearned !== undefined) data.lessonsLearned = normalizeOptional(input.lessonsLearned);
  if (input.participantCrewIds !== undefined) data.participantCrewIds = parseParticipantIds(input.participantCrewIds);

  const updated = await drillClient(prisma).drill.update({ where: { id }, data });

  void publishAudit(prisma, {
    tenantId: (current as { tenantId: string }).tenantId,
    actorUserId: session.user.id,
    action: "Drill.updated",
    entityType: "Drill",
    entityId: id,
    metadata: { drillCode: (current as { drillCode: string }).drillCode },
  });

  return updated;
}

export async function completeDrill(session: TenantAccessSession, id: string, input: CompleteDrillInput) {
  ensureCanManage(session);

  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const current = await getDrill(session, id);
  if ((current as { status: string }).status !== "SCHEDULED") {
    throw new RouteError(409, "INVALID_STATUS_TRANSITION", `Solo simulacros SCHEDULED pueden completarse (actual: ${(current as { status: string }).status}).`);
  }

  const completedDate = input.completedDate ? parseDate(input.completedDate, "completedDate") : new Date();

  const data: Record<string, unknown> = {
    status: "COMPLETED",
    completedDate,
    updatedByUserId: session.user.id,
  };
  if (input.observations !== undefined) data.observations = normalizeOptional(input.observations);
  if (input.lessonsLearned !== undefined) data.lessonsLearned = normalizeOptional(input.lessonsLearned);
  if (input.participantCrewIds !== undefined) data.participantCrewIds = parseParticipantIds(input.participantCrewIds);

  const updated = await drillClient(prisma).drill.update({ where: { id }, data });

  void publishAudit(prisma, {
    tenantId: (current as { tenantId: string }).tenantId,
    actorUserId: session.user.id,
    action: "Drill.completed",
    entityType: "Drill",
    entityId: id,
    metadata: {
      drillCode: (current as { drillCode: string }).drillCode,
      vesselCode: (current as { vesselCode: string }).vesselCode,
      completedDate: completedDate.toISOString(),
    },
  });

  return updated;
}

export async function cancelDrill(session: TenantAccessSession, id: string, payload: { reason: string }) {
  ensureCanManage(session);

  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const current = await getDrill(session, id);
  if ((current as { status: string }).status !== "SCHEDULED") {
    throw new RouteError(409, "INVALID_STATUS_TRANSITION", "Solo simulacros SCHEDULED pueden cancelarse.");
  }

  const reason = String(payload?.reason ?? "").trim();
  if (!reason) throw new RouteError(400, "VALIDATION_ERROR", "El motivo de cancelación es requerido.");

  const updated = await drillClient(prisma).drill.update({
    where: { id },
    data: {
      status: "CANCELLED",
      observations: `[CANCELLED] ${reason}`,
      updatedByUserId: session.user.id,
    },
  });

  void publishAudit(prisma, {
    tenantId: (current as { tenantId: string }).tenantId,
    actorUserId: session.user.id,
    action: "Drill.cancelled",
    entityType: "Drill",
    entityId: id,
    metadata: { drillCode: (current as { drillCode: string }).drillCode, reason },
  });

  return updated;
}

export async function reopenDrill(session: TenantAccessSession, id: string, payload: { reason: string }) {
  assertCanReopen(session.user.role);
  const reason = assertReopenReason(payload?.reason);

  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const current = await getDrill(session, id);
  const status = (current as { status: string }).status;
  if (status !== "COMPLETED" && status !== "CANCELLED") {
    throw new RouteError(409, "INVALID_STATUS_TRANSITION", `Solo simulacros COMPLETED o CANCELLED pueden re-abrirse (actual: ${status}).`);
  }

  const now = new Date();
  const reopened = await drillClient(prisma).drill.update({
    where: { id },
    data: {
      status: "SCHEDULED",
      completedDate: null,
      reopenCount: { increment: 1 },
      lastReopenAt: now,
      lastReopenReason: reason,
      lastReopenByUserId: session.user.id,
      updatedByUserId: session.user.id,
    },
  });

  void publishAudit(prisma, {
    tenantId: (current as { tenantId: string }).tenantId,
    actorUserId: session.user.id,
    action: "Drill.reopened",
    entityType: "Drill",
    entityId: id,
    metadata: { drillCode: (current as { drillCode: string }).drillCode, previousStatus: status, reason },
  });

  return reopened;
}

export async function deleteDrill(session: TenantAccessSession, id: string) {
  if (session.user.role !== "TENANT_ADMIN") {
    throw new RouteError(403, "FORBIDDEN", "Solo TENANT_ADMIN puede eliminar simulacros.");
  }

  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const current = await getDrill(session, id);
  await drillClient(prisma).drill.update({
    where: { id },
    data: { deletedAt: new Date(), deletedByUserId: session.user.id, updatedByUserId: session.user.id },
  });

  void publishAudit(prisma, {
    tenantId: (current as { tenantId: string }).tenantId,
    actorUserId: session.user.id,
    action: "Drill.deleted",
    entityType: "Drill",
    entityId: id,
    metadata: { drillCode: (current as { drillCode: string }).drillCode },
  });
}
