import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { publishAudit } from "../../platform/audit/audit-publisher";
import { applyAssignedVesselScope } from "../auth/vessel-scope";
import { assertCanReopen, assertReopenReason } from "../../common/record-lock";

const CREW_RANKS = [
  "CAPTAIN", "CHIEF_OFFICER", "SECOND_OFFICER", "THIRD_OFFICER",
  "CHIEF_ENGINEER", "SECOND_ENGINEER", "THIRD_ENGINEER", "FOURTH_ENGINEER",
  "ELECTRICIAN", "BOSUN", "AB_SEAMAN", "OS_SEAMAN", "OILER", "WIPER",
  "COOK", "STEWARD", "CADET", "RADIO_OPERATOR", "PILOT", "PILOTIN", "OTHER",
] as const;
type CrewRank = typeof CREW_RANKS[number];

export interface CrewListFilters {
  vesselCode?: string | null;
  status?: string | null;
  rank?: string | null;
}

export interface CrewWriteInput {
  vesselCode?: string;
  crewCode?: string;
  firstName?: string;
  lastName?: string;
  rank?: string;
  nationality?: string | null;
  dateOfBirth?: string | null;
  passportNumber?: string | null;
  signOnDate?: string;
  signOffDate?: string | null;
  notes?: string | null;
}

function canManage(session: TenantAccessSession): boolean {
  const r = session.user.role;
  return r === "TENANT_ADMIN" || r === "FLEET_SUPERINTENDENT" || r === "MAINTENANCE_MANAGER";
}

function ensureCanManage(session: TenantAccessSession) {
  if (!canManage(session)) throw new RouteError(403, "FORBIDDEN", "No autorizado para gestionar tripulación.");
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

function parseRank(value: unknown): CrewRank {
  const v = String(value ?? "").trim().toUpperCase();
  if (!CREW_RANKS.includes(v as CrewRank)) {
    throw new RouteError(400, "VALIDATION_ERROR", `rank inválido: ${v}.`);
  }
  return v as CrewRank;
}

type CrewClient = {
  crew: {
    findMany(args: { where: Record<string, unknown>; orderBy?: unknown; include?: unknown }): Promise<Record<string, unknown>[]>;
    findFirst(args: { where: Record<string, unknown>; include?: unknown }): Promise<Record<string, unknown> | null>;
    create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<Record<string, unknown>>;
    count(args: { where: Record<string, unknown> }): Promise<number>;
  };
};

function crewClient(prisma: NonNullable<ReturnType<typeof getPrismaClient>>): CrewClient {
  return prisma as unknown as CrewClient;
}

export async function listCrew(session: TenantAccessSession, filters: CrewListFilters = {}) {
  const prisma = getPrismaClient();
  if (!prisma) return [];

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) return [];

  const where: Record<string, unknown> = { tenantId: tenant.id, deletedAt: null };
  applyAssignedVesselScope(session, where, filters.vesselCode ?? null);
  if (filters.status) where.status = filters.status;
  if (filters.rank) where.rank = filters.rank;

  return crewClient(prisma).crew.findMany({
    where,
    orderBy: [{ status: "asc" }, { lastName: "asc" }],
    include: { certifications: { where: { deletedAt: null } } },
  });
}

export async function getCrew(session: TenantAccessSession, id: string) {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");

  const row = await crewClient(prisma).crew.findFirst({
    where: { id, tenantId: tenant.id, deletedAt: null },
    include: { certifications: { where: { deletedAt: null } } },
  });
  if (!row) throw new RouteError(404, "NOT_FOUND", "Tripulante no encontrado.");

  if (session.user.role !== "TENANT_ADMIN") {
    const vesselCode = (row as { vesselCode: string }).vesselCode;
    if (!session.user.assignedVesselCodes.includes(vesselCode)) {
      throw new RouteError(403, "FORBIDDEN", "Sin acceso al vessel de este tripulante.");
    }
  }
  return row;
}

async function generateCrewCode(prisma: NonNullable<ReturnType<typeof getPrismaClient>>, tenantId: string, vesselCode: string): Promise<string> {
  const year = new Date().getFullYear();
  const yy = String(year).slice(-2);
  const count = await crewClient(prisma).crew.count({
    where: { tenantId, vesselCode, createdAt: { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) } },
  });
  return `CR-${vesselCode}-${yy}-${String(count + 1).padStart(4, "0")}`;
}

export async function createCrew(session: TenantAccessSession, input: CrewWriteInput) {
  ensureCanManage(session);

  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");

  const vesselCode = normalizeRequired(input.vesselCode, "vesselCode").toUpperCase();
  const firstName = normalizeRequired(input.firstName, "firstName");
  const lastName = normalizeRequired(input.lastName, "lastName");
  const rank = parseRank(input.rank);
  const signOnDate = parseDate(input.signOnDate, "signOnDate");

  const code = input.crewCode ? normalizeRequired(input.crewCode, "crewCode").toUpperCase() : await generateCrewCode(prisma, tenant.id, vesselCode);

  const existing = await crewClient(prisma).crew.findFirst({
    where: { tenantId: tenant.id, vesselCode, crewCode: code, deletedAt: null },
  });
  if (existing) throw new RouteError(409, "DUPLICATE_CODE", `Ya existe un tripulante con código ${code}.`);

  const created = await crewClient(prisma).crew.create({
    data: {
      tenantId: tenant.id,
      vesselCode,
      crewCode: code,
      firstName,
      lastName,
      rank,
      nationality: normalizeOptional(input.nationality),
      dateOfBirth: parseOptionalDate(input.dateOfBirth),
      passportNumber: normalizeOptional(input.passportNumber),
      signOnDate,
      signOffDate: parseOptionalDate(input.signOffDate),
      status: "ONBOARD",
      notes: normalizeOptional(input.notes),
      createdByUserId: session.user.id,
      updatedByUserId: session.user.id,
    },
  });

  void publishAudit(prisma, {
    tenantId: tenant.id,
    actorUserId: session.user.id,
    action: "Crew.created",
    entityType: "Crew",
    entityId: created.id as string,
    metadata: { crewCode: code, vesselCode, firstName, lastName, rank },
  });

  return created;
}

export async function updateCrew(session: TenantAccessSession, id: string, input: CrewWriteInput) {
  ensureCanManage(session);

  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const current = await getCrew(session, id);
  // Lockdown vetting: un crew SIGNED_OFF no se edita sin /reopen explícito.
  if ((current as { status: string }).status === "SIGNED_OFF") {
    throw new RouteError(409, "RECORD_LOCKED", "Este tripulante ya está SIGNED_OFF. Sólo un administrador puede re-abrirlo con justificación.");
  }

  const data: Record<string, unknown> = { updatedByUserId: session.user.id };
  if (input.firstName !== undefined) data.firstName = normalizeRequired(input.firstName, "firstName");
  if (input.lastName !== undefined) data.lastName = normalizeRequired(input.lastName, "lastName");
  if (input.rank !== undefined) data.rank = parseRank(input.rank);
  if (input.nationality !== undefined) data.nationality = normalizeOptional(input.nationality);
  if (input.dateOfBirth !== undefined) data.dateOfBirth = parseOptionalDate(input.dateOfBirth);
  if (input.passportNumber !== undefined) data.passportNumber = normalizeOptional(input.passportNumber);
  if (input.signOnDate !== undefined) data.signOnDate = parseDate(input.signOnDate, "signOnDate");
  if (input.notes !== undefined) data.notes = normalizeOptional(input.notes);

  const updated = await crewClient(prisma).crew.update({ where: { id }, data });

  void publishAudit(prisma, {
    tenantId: (current as { tenantId: string }).tenantId,
    actorUserId: session.user.id,
    action: "Crew.updated",
    entityType: "Crew",
    entityId: id,
    metadata: { crewCode: (current as { crewCode: string }).crewCode },
  });

  return updated;
}

export async function signOffCrew(session: TenantAccessSession, id: string, payload: { signOffDate?: string; notes?: string | null }) {
  ensureCanManage(session);

  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const current = await getCrew(session, id);
  if ((current as { status: string }).status !== "ONBOARD") {
    throw new RouteError(409, "INVALID_STATUS_TRANSITION", "Solo se puede dar de baja a un tripulante ONBOARD.");
  }

  const signOff = payload.signOffDate ? parseDate(payload.signOffDate, "signOffDate") : new Date();

  const updated = await crewClient(prisma).crew.update({
    where: { id },
    data: {
      status: "SIGNED_OFF",
      signOffDate: signOff,
      notes: payload.notes !== undefined ? normalizeOptional(payload.notes) : undefined,
      updatedByUserId: session.user.id,
    },
  });

  void publishAudit(prisma, {
    tenantId: (current as { tenantId: string }).tenantId,
    actorUserId: session.user.id,
    action: "Crew.signedOff",
    entityType: "Crew",
    entityId: id,
    metadata: { crewCode: (current as { crewCode: string }).crewCode, signOffDate: signOff.toISOString() },
  });

  return updated;
}

export async function reopenCrew(session: TenantAccessSession, id: string, payload: { reason: string }) {
  assertCanReopen(session.user.role);
  const reason = assertReopenReason(payload?.reason);

  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const current = await getCrew(session, id);
  if ((current as { status: string }).status !== "SIGNED_OFF") {
    throw new RouteError(409, "INVALID_STATUS_TRANSITION", "Sólo se puede re-abrir un tripulante SIGNED_OFF.");
  }

  const now = new Date();
  const reopened = await crewClient(prisma).crew.update({
    where: { id },
    data: {
      status: "ONBOARD",
      signOffDate: null,
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
    action: "Crew.reopened",
    entityType: "Crew",
    entityId: id,
    metadata: { crewCode: (current as { crewCode: string }).crewCode, reason },
  });

  return reopened;
}

export async function deleteCrew(session: TenantAccessSession, id: string) {
  if (session.user.role !== "TENANT_ADMIN") {
    throw new RouteError(403, "FORBIDDEN", "Solo TENANT_ADMIN puede eliminar tripulación.");
  }

  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const current = await getCrew(session, id);
  await crewClient(prisma).crew.update({
    where: { id },
    data: { deletedAt: new Date(), deletedByUserId: session.user.id, updatedByUserId: session.user.id },
  });

  void publishAudit(prisma, {
    tenantId: (current as { tenantId: string }).tenantId,
    actorUserId: session.user.id,
    action: "Crew.deleted",
    entityType: "Crew",
    entityId: id,
    metadata: { crewCode: (current as { crewCode: string }).crewCode },
  });
}
