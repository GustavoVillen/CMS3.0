// Crew Capability Matrix — quién puede hacer qué tarea crítica.

import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";

const AREAS = [
  "ECDIS", "BWMS", "IG_SYSTEM", "CARGO_HANDLING", "MOORING_MASTER",
  "ENCLOSED_SPACE_ENTRY", "HOT_WORK", "RADAR_ARPA", "GMDSS",
  "BRIDGE_RESOURCE_MGMT", "ENGINE_ROOM_RESOURCE", "FIRE_FIGHTING",
  "SURVIVAL_CRAFT", "MEDICAL_FIRST_AID", "HIGH_VOLTAGE",
  "CRANE_OPERATION", "OTHER",
] as const;
const LEVELS = ["TRAINED", "CERTIFIED", "EXPERT"] as const;

export interface MatrixFilters {
  vesselCode?: string | null;
  area?: string | null;
}

export interface UpsertCapabilityInput {
  crewId: string;
  area: string;
  level?: string;
  certificationId?: string | null;
  notes?: string | null;
  validUntil?: string | Date | null;
}

function canWrite(s: TenantAccessSession): boolean {
  const r = s.user.role;
  return r === "TENANT_ADMIN" || r === "FLEET_SUPERINTENDENT" || r === "MAINTENANCE_MANAGER";
}
function ensureCanWrite(s: TenantAccessSession) {
  if (!canWrite(s)) throw new RouteError(403, "FORBIDDEN", "No autorizado para editar la matriz.");
}
function normReq(v: unknown, f: string): string {
  const t = String(v ?? "").trim();
  if (!t) throw new RouteError(400, "VALIDATION_ERROR", `${f} requerido.`);
  return t;
}
function normOpt(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const t = String(v).trim();
  return t || null;
}
function parseOptDate(v: unknown, f: string): Date | null {
  if (v === undefined || v === null || v === "") return null;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) throw new RouteError(400, "VALIDATION_ERROR", `${f} fecha inválida.`);
  return d;
}
function parseEnum<T extends string>(v: unknown, allowed: readonly T[], f: string): T {
  const s = String(v ?? "").trim().toUpperCase();
  if (!allowed.includes(s as T)) throw new RouteError(400, "VALIDATION_ERROR", `${f} inválido: ${s}.`);
  return s as T;
}

type Delegate = {
  findMany(a: unknown): Promise<Record<string, unknown>[]>;
  findFirst(a: unknown): Promise<Record<string, unknown> | null>;
  upsert(a: unknown): Promise<Record<string, unknown>>;
  delete(a: unknown): Promise<unknown>;
};
function capDel(prisma: NonNullable<ReturnType<typeof getPrismaClient>>) {
  return (prisma as unknown as { crewCapability: Delegate }).crewCapability;
}

async function tenantIdOrThrow(s: TenantAccessSession): Promise<string> {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "DB no disponible.");
  const tenant = await prisma.tenant.findUnique({ where: { slug: s.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");
  return tenant.id;
}

/**
 * Snapshot de la matriz para un vessel: trae todos los crew ONBOARD + sus
 * capabilities. Si filters.area se pasa, solo retorna esa columna.
 */
export async function getMatrix(session: TenantAccessSession, filters: MatrixFilters = {}) {
  const prisma = getPrismaClient();
  if (!prisma) return { crew: [], capabilities: [], areas: AREAS };
  const tenantId = await tenantIdOrThrow(session);
  const vesselCode = filters.vesselCode?.toUpperCase();
  if (vesselCode && session.user.role !== "TENANT_ADMIN" && !session.user.assignedVesselCodes.includes(vesselCode)) {
    throw new RouteError(403, "FORBIDDEN", "Sin acceso al vessel.");
  }

  const crew = await (prisma as unknown as {
    crew: { findMany(a: unknown): Promise<Array<{ id: string; firstName: string; lastName: string; rankDefinition: { code: string; name: string } | null; vesselCode: string }>> };
  }).crew.findMany({
    where: {
      tenantId,
      deletedAt: null,
      status: "ONBOARD",
      ...(vesselCode ? { vesselCode } : (session.user.role !== "TENANT_ADMIN" ? { vesselCode: { in: session.user.assignedVesselCodes } } : {})),
    },
    select: { id: true, firstName: true, lastName: true, rankDefinition: { select: { code: true, name: true } }, vesselCode: true },
    orderBy: { lastName: "asc" },
  });

  // Map rankDefinition to rank string for backward compatibility
  const crewWithRank = crew.map(c => ({
    ...c,
    rank: c.rankDefinition?.name ?? "Unknown",
  }));

  const crewIds = crewWithRank.map(c => c.id);
  const capWhere: Record<string, unknown> = { tenantId };
  if (crewIds.length > 0) capWhere.crewId = { in: crewIds };
  else return { crew: [], capabilities: [], areas: AREAS };
  if (filters.area) capWhere.area = parseEnum(filters.area, AREAS, "area");

  const caps = await capDel(prisma).findMany({ where: capWhere, orderBy: [{ crewId: "asc" }, { area: "asc" }] });
  return { crew: crewWithRank, capabilities: caps, areas: AREAS };
}

export async function upsertCapability(session: TenantAccessSession, input: UpsertCapabilityInput) {
  ensureCanWrite(session);
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "DB no disponible.");
  const tenantId = await tenantIdOrThrow(session);
  const crewId = normReq(input.crewId, "crewId");

  // Validar tenant ownership del crew + scope vessel del usuario.
  const crew = await (prisma as unknown as {
    crew: { findFirst(a: unknown): Promise<{ id: string; vesselCode: string } | null> };
  }).crew.findFirst({
    where: { id: crewId, tenantId, deletedAt: null },
    select: { id: true, vesselCode: true },
  });
  if (!crew) throw new RouteError(404, "NOT_FOUND", "Tripulante no encontrado.");
  if (session.user.role !== "TENANT_ADMIN" && !session.user.assignedVesselCodes.includes(crew.vesselCode)) {
    throw new RouteError(403, "FORBIDDEN", "Sin acceso al vessel del tripulante.");
  }

  const area = parseEnum(input.area, AREAS, "area");
  const level = input.level ? parseEnum(input.level, LEVELS, "level") : "CERTIFIED";

  return capDel(prisma).upsert({
    where: { crewId_area: { crewId, area } },
    create: {
      tenantId, crewId, area, level,
      certificationId: normOpt(input.certificationId),
      notes: normOpt(input.notes),
      validUntil: parseOptDate(input.validUntil, "validUntil"),
      createdByUserId: session.user.id,
      updatedByUserId: session.user.id,
    },
    update: {
      level,
      certificationId: normOpt(input.certificationId),
      notes: normOpt(input.notes),
      validUntil: parseOptDate(input.validUntil, "validUntil"),
      updatedByUserId: session.user.id,
    },
  });
}

export async function deleteCapability(session: TenantAccessSession, crewId: string, area: string) {
  ensureCanWrite(session);
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "DB no disponible.");
  const tenantId = await tenantIdOrThrow(session);
  const crew = await (prisma as unknown as {
    crew: { findFirst(a: unknown): Promise<{ id: string; vesselCode: string } | null> };
  }).crew.findFirst({
    where: { id: crewId, tenantId, deletedAt: null },
    select: { id: true, vesselCode: true },
  });
  if (!crew) throw new RouteError(404, "NOT_FOUND", "Tripulante no encontrado.");
  if (session.user.role !== "TENANT_ADMIN" && !session.user.assignedVesselCodes.includes(crew.vesselCode)) {
    throw new RouteError(403, "FORBIDDEN", "Sin acceso al vessel del tripulante.");
  }
  const areaEnum = parseEnum(area, AREAS, "area");
  await capDel(prisma).delete({ where: { crewId_area: { crewId, area: areaEnum } } });
}
