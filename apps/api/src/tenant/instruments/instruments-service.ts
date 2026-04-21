import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";

export interface InstrumentListFilters {
  vesselCode?: string | null;
  status?: string | null;
  instrumentType?: string | null;
  calibrationDue?: boolean;
}

export interface CreateInstrumentInput {
  vesselCode?: string | null;
  code: string;
  name: string;
  instrumentType: string;
  serialNumber?: string | null;
  calibrationRequired?: boolean;
  calibrationDate?: string | Date | null;
  calibrationDueDate?: string | Date | null;
  status?: string;
  notes?: string | null;
}

export interface UpdateInstrumentInput {
  vesselCode?: string | null;
  code?: string;
  name?: string;
  instrumentType?: string;
  serialNumber?: string | null;
  calibrationRequired?: boolean;
  calibrationDate?: string | Date | null;
  calibrationDueDate?: string | Date | null;
  status?: string;
  notes?: string | null;
}

export interface RecordCalibrationInput {
  calibrationDate: string | Date;
  calibrationDueDate?: string | Date | null;
  notes?: string | null;
}

type InstrumentDelegate = {
  findMany(args: { where: Record<string, unknown>; orderBy?: Array<Record<string, "asc" | "desc">> }): Promise<InstrumentRecord[]>;
  findFirst(args: { where: Record<string, unknown> }): Promise<InstrumentRecord | null>;
  create(args: { data: Record<string, unknown> }): Promise<InstrumentRecord>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<InstrumentRecord>;
};

interface InstrumentRecord {
  id: string;
  tenantId: string;
  vesselCode: string | null;
  code: string;
  name: string;
  instrumentType: string;
  serialNumber: string | null;
  calibrationRequired: boolean;
  calibrationDate: Date | null;
  calibrationDueDate: Date | null;
  status: string;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

function instrumentDelegate(prisma: NonNullable<ReturnType<typeof getPrismaClient>>): InstrumentDelegate {
  return (prisma as unknown as { instrument: InstrumentDelegate }).instrument;
}

function canManageInstruments(session: TenantAccessSession): boolean {
  return session.user.role === "TENANT_ADMIN" || session.user.role === "FLEET_SUPERINTENDENT" || session.user.role === "MAINTENANCE_MANAGER";
}

function normalizeOptionalText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function normalizeRequiredText(value: unknown, field: string): string {
  const text = String(value ?? "").trim();
  if (!text) throw new RouteError(400, "VALIDATION_ERROR", `El campo ${field} es requerido.`);
  return text;
}

function parseOptionalDate(value: unknown, field: string): Date | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw new RouteError(400, "VALIDATION_ERROR", `Fecha inválida en ${field}.`);
  }
  return parsed;
}

function parseRequiredDate(value: unknown, field: string): Date {
  const parsed = parseOptionalDate(value, field);
  if (!parsed) throw new RouteError(400, "VALIDATION_ERROR", `El campo ${field} es requerido.`);
  return parsed;
}

function parseBooleanQuery(value: string | null): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

function buildVesselWhere(session: TenantAccessSession, requestedVesselCode?: string | null): Record<string, unknown> {
  if (session.user.role === "TENANT_ADMIN") {
    return requestedVesselCode ? { vesselCode: requestedVesselCode } : {};
  }

  if (requestedVesselCode) {
    if (!session.user.assignedVesselCodes.includes(requestedVesselCode)) {
      throw new RouteError(403, "FORBIDDEN", "No tienes acceso al vessel solicitado.");
    }
    return { vesselCode: requestedVesselCode };
  }

  if (session.user.assignedVesselCodes.length === 0) {
    return { vesselCode: "__NO_ASSIGNED_VESSEL__" };
  }

  return { vesselCode: { in: session.user.assignedVesselCodes } };
}

async function resolveTenantId(session: TenantAccessSession): Promise<string | null> {
  const prisma = getPrismaClient();
  if (!prisma) return null;
  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  return tenant?.id ?? null;
}

async function getTenantIdOrThrow(session: TenantAccessSession): Promise<string> {
  const tenantId = await resolveTenantId(session);
  if (!tenantId) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");
  return tenantId;
}

function isUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if (!("code" in error)) return false;
  const code = (error as { code?: unknown }).code;
  return code === "P2002";
}

export async function listTenantInstruments(
  session: TenantAccessSession,
  filters: InstrumentListFilters = {},
) {
  const prisma = getPrismaClient();
  if (!prisma) return [];

  const tenantId = await resolveTenantId(session);
  if (!tenantId) return [];

  const where: Record<string, unknown> = { tenantId, deletedAt: null };
  Object.assign(where, buildVesselWhere(session, filters.vesselCode ?? null));

  if (filters.status) where.status = filters.status;
  if (filters.instrumentType) where.instrumentType = filters.instrumentType;
  if (filters.calibrationDue) {
    const threshold = new Date();
    threshold.setDate(threshold.getDate() + 30);
    where.calibrationRequired = true;
    where.calibrationDueDate = { lte: threshold };
  }

  return instrumentDelegate(prisma).findMany({
    where,
    orderBy: [{ vesselCode: "asc" }, { code: "asc" }],
  });
}

export async function getTenantInstrument(session: TenantAccessSession, id: string) {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(404, "NOT_FOUND", "Instrumento no encontrado.");

  const tenantId = await getTenantIdOrThrow(session);
  const where: Record<string, unknown> = { id, tenantId, deletedAt: null };
  Object.assign(where, buildVesselWhere(session));

  const instrument = await instrumentDelegate(prisma).findFirst({ where });
  if (!instrument) throw new RouteError(404, "NOT_FOUND", "Instrumento no encontrado.");
  return instrument;
}

export async function createTenantInstrument(session: TenantAccessSession, payload: CreateInstrumentInput) {
  if (!canManageInstruments(session)) {
    throw new RouteError(403, "FORBIDDEN", "Solo TENANT_ADMIN, FLEET_SUPERINTENDENT o MAINTENANCE_MANAGER pueden crear instrumentos.");
  }

  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const tenantId = await getTenantIdOrThrow(session);
  const vesselCode = normalizeOptionalText(payload.vesselCode);
  if (session.user.role !== "TENANT_ADMIN" && vesselCode && !session.user.assignedVesselCodes.includes(vesselCode)) {
    throw new RouteError(403, "FORBIDDEN", "No tienes acceso al vessel solicitado.");
  }

  const data = {
    tenantId,
    vesselCode,
    code: normalizeRequiredText(payload.code, "code").toUpperCase(),
    name: normalizeRequiredText(payload.name, "name"),
    instrumentType: normalizeRequiredText(payload.instrumentType, "instrumentType"),
    serialNumber: normalizeOptionalText(payload.serialNumber),
    calibrationRequired: Boolean(payload.calibrationRequired),
    calibrationDate: parseOptionalDate(payload.calibrationDate, "calibrationDate"),
    calibrationDueDate: parseOptionalDate(payload.calibrationDueDate, "calibrationDueDate"),
    status: normalizeOptionalText(payload.status) ?? "ACTIVE",
    notes: normalizeOptionalText(payload.notes),
  };

  try {
    return await instrumentDelegate(prisma).create({ data });
  } catch (error: unknown) {
    if (isUniqueConstraintError(error)) {
      throw new RouteError(409, "DUPLICATE_CODE", `Ya existe un instrumento con código ${data.code}.`);
    }
    throw error;
  }
}

export async function updateTenantInstrument(
  session: TenantAccessSession,
  id: string,
  payload: UpdateInstrumentInput,
) {
  if (!canManageInstruments(session)) {
    throw new RouteError(403, "FORBIDDEN", "Solo TENANT_ADMIN, FLEET_SUPERINTENDENT o MAINTENANCE_MANAGER pueden editar instrumentos.");
  }

  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const current = await getTenantInstrument(session, id);
  if (session.user.role !== "TENANT_ADMIN" && payload.vesselCode !== undefined) {
    const requested = normalizeOptionalText(payload.vesselCode);
    if (requested && !session.user.assignedVesselCodes.includes(requested)) {
      throw new RouteError(403, "FORBIDDEN", "No tienes acceso al vessel solicitado.");
    }
  }

  const data: Record<string, unknown> = {};
  if (payload.vesselCode !== undefined) data.vesselCode = normalizeOptionalText(payload.vesselCode);
  if (payload.code !== undefined) data.code = normalizeRequiredText(payload.code, "code").toUpperCase();
  if (payload.name !== undefined) data.name = normalizeRequiredText(payload.name, "name");
  if (payload.instrumentType !== undefined) data.instrumentType = normalizeRequiredText(payload.instrumentType, "instrumentType");
  if (payload.serialNumber !== undefined) data.serialNumber = normalizeOptionalText(payload.serialNumber);
  if (payload.calibrationRequired !== undefined) data.calibrationRequired = Boolean(payload.calibrationRequired);
  if (payload.calibrationDate !== undefined) data.calibrationDate = parseOptionalDate(payload.calibrationDate, "calibrationDate");
  if (payload.calibrationDueDate !== undefined) data.calibrationDueDate = parseOptionalDate(payload.calibrationDueDate, "calibrationDueDate");
  if (payload.status !== undefined) data.status = normalizeRequiredText(payload.status, "status");
  if (payload.notes !== undefined) data.notes = normalizeOptionalText(payload.notes);

  if (!Object.keys(data).length) return current;

  try {
    return await instrumentDelegate(prisma).update({ where: { id: current.id }, data });
  } catch (error: unknown) {
    if (isUniqueConstraintError(error)) {
      throw new RouteError(409, "DUPLICATE_CODE", "Ya existe un instrumento con ese código.");
    }
    throw error;
  }
}

export async function softDeleteTenantInstrument(session: TenantAccessSession, id: string) {
  if (!canManageInstruments(session)) {
    throw new RouteError(403, "FORBIDDEN", "Solo TENANT_ADMIN, FLEET_SUPERINTENDENT o MAINTENANCE_MANAGER pueden eliminar instrumentos.");
  }

  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const current = await getTenantInstrument(session, id);
  return instrumentDelegate(prisma).update({
    where: { id: current.id },
    data: { deletedAt: new Date() },
  });
}

export async function recordCalibration(
  session: TenantAccessSession,
  id: string,
  payload: RecordCalibrationInput,
) {
  if (!canManageInstruments(session)) {
    throw new RouteError(403, "FORBIDDEN", "Solo TENANT_ADMIN, FLEET_SUPERINTENDENT o MAINTENANCE_MANAGER pueden registrar calibración.");
  }

  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const current = await getTenantInstrument(session, id);
  const calibrationDate = parseRequiredDate(payload.calibrationDate, "calibrationDate");
  const calibrationDueDate = parseOptionalDate(payload.calibrationDueDate, "calibrationDueDate");
  const noteText = normalizeOptionalText(payload.notes);
  const timestamp = new Date().toISOString();
  const suffix = noteText ? ` - ${noteText}` : "";
  const calibrationLog = `[${timestamp}] Calibration recorded by ${session.user.email}${suffix}`;
  const notes = current.notes ? `${current.notes}\n${calibrationLog}` : calibrationLog;

  return instrumentDelegate(prisma).update({
    where: { id: current.id },
    data: {
      calibrationDate,
      calibrationDueDate,
      status: "ACTIVE",
      notes,
      deletedAt: null,
    },
  });
}

export async function listOverdueCalibrations(session: TenantAccessSession, vesselCode?: string | null) {
  const prisma = getPrismaClient();
  if (!prisma) return [];

  const tenantId = await resolveTenantId(session);
  if (!tenantId) return [];

  const where: Record<string, unknown> = {
    tenantId,
    deletedAt: null,
    calibrationRequired: true,
    calibrationDueDate: { lt: new Date() },
  };
  Object.assign(where, buildVesselWhere(session, vesselCode ?? null));

  return instrumentDelegate(prisma).findMany({
    where,
    orderBy: [{ calibrationDueDate: "asc" }, { vesselCode: "asc" }, { code: "asc" }],
  });
}

export function parseCalibrationDueQuery(value: string | null): boolean {
  return parseBooleanQuery(value);
}
