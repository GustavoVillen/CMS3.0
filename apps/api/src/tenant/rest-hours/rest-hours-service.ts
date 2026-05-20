// STCW Manila / MLC 2006 — Hours of Rest tracking.
//
// Reglas (STCW A-VIII/1.2):
//   - Mínimo 10 horas de descanso en cualquier período de 24 h.
//   - Mínimo 77 horas de descanso en cualquier período de 7 días.
//   - Las 10 horas pueden dividirse en máximo 2 períodos, uno de los cuales
//     debe ser de al menos 6 horas consecutivas; los intervalos entre
//     períodos consecutivos de descanso no excederán 14 h.
//
// Cada fila representa un día con un Json[24] donde true=descanso.
// Las violaciones se calculan al guardar para que el listado las filtre
// sin recomputar, pero también se recomputan en window queries.

import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { publishAudit } from "../../platform/audit/audit-publisher";

export interface RestHoursListFilters {
  vesselCode?: string | null;
  crewId?: string | null;
  fromDate?: string | null;
  toDate?: string | null;
  onlyViolations?: boolean;
}

export interface RestHoursWriteInput {
  vesselCode?: string;
  crewId?: string;
  recordDate?: string;          // ISO YYYY-MM-DD
  hoursData?: boolean[];        // length 24
  notes?: string | null;
}

interface Violation {
  kind: "MIN_10H_PER_24H" | "MIN_77H_PER_7D" | "MAX_2_PERIODS_PER_24H" | "MIN_6H_CONSECUTIVE";
  details: string;
}

function canWrite(s: TenantAccessSession): boolean {
  const r = s.user.role;
  return r === "TENANT_ADMIN" || r === "FLEET_SUPERINTENDENT" || r === "MAINTENANCE_MANAGER" || r === "TECHNICIAN_OPERATOR";
}
function ensureCanWrite(s: TenantAccessSession) {
  if (!canWrite(s)) throw new RouteError(403, "FORBIDDEN", "No autorizado para registrar horas de descanso.");
}
function normOpt(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const t = String(v).trim();
  return t || null;
}
function parseISODate(value: unknown, field: string): Date {
  const s = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new RouteError(400, "VALIDATION_ERROR", `${field} debe ser YYYY-MM-DD.`);
  }
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
  if (Number.isNaN(dt.getTime())) throw new RouteError(400, "VALIDATION_ERROR", `${field} fecha inválida.`);
  return dt;
}
function validateHoursArray(v: unknown): boolean[] {
  if (!Array.isArray(v) || v.length !== 24) {
    throw new RouteError(400, "VALIDATION_ERROR", "hoursData debe ser un array de 24 booleans.");
  }
  return v.map(b => !!b);
}

/**
 * Calcula violaciones STCW para un día específico mirando una ventana
 * extendida (días anteriores + el día actual) para poder evaluar las
 * reglas de 24h y 7 días que cruzan medianoche.
 */
export function computeViolations(
  hoursDataByDay: Array<{ date: Date; hours: boolean[] }>,
  targetDate: Date,
): { totalRest: number; violations: Violation[] } {
  // Normaliza a UTC midnight para comparación
  const targetKey = targetDate.toISOString().slice(0, 10);
  const sorted = hoursDataByDay
    .slice()
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  // Ensamblar serie temporal continua: array donde cada elemento es { hour, isRest }.
  // Solo procesamos los últimos 7 días hasta el targetDate inclusive.
  const sevenDaysAgo = new Date(targetDate.getTime() - 6 * 24 * 60 * 60 * 1000);
  const window = sorted.filter(d => d.date >= sevenDaysAgo && d.date <= targetDate);
  // si no hay 7 días, asumimos work=true (peor caso para el cálculo)

  // Recopilamos los 24h del día target
  const today = sorted.find(d => d.date.toISOString().slice(0, 10) === targetKey);
  const todayHours = today ? today.hours : new Array(24).fill(false);
  const totalRest = todayHours.filter(Boolean).length;

  const violations: Violation[] = [];

  // Regla 1: mínimo 10 h descanso en 24 h (el "día target")
  if (totalRest < 10) {
    violations.push({
      kind: "MIN_10H_PER_24H",
      details: `Sólo ${totalRest}h de descanso en 24h (mínimo STCW: 10h).`,
    });
  }

  // Regla 2: períodos de descanso. Contamos cuántos bloques consecutivos
  // de descanso hay en el día. Si hay más de 2, viola. El más largo debe
  // ser ≥6h.
  let blocks: number[] = [];
  let current = 0;
  for (const isRest of todayHours) {
    if (isRest) current++;
    else if (current > 0) { blocks.push(current); current = 0; }
  }
  if (current > 0) blocks.push(current);

  if (blocks.length > 2) {
    violations.push({
      kind: "MAX_2_PERIODS_PER_24H",
      details: `${blocks.length} períodos de descanso en 24h (máximo STCW: 2).`,
    });
  }
  if (totalRest >= 10 && blocks.length > 0) {
    const longest = Math.max(...blocks);
    if (longest < 6) {
      violations.push({
        kind: "MIN_6H_CONSECUTIVE",
        details: `El período más largo de descanso es ${longest}h (mínimo STCW: 6h consecutivas).`,
      });
    }
  }

  // Regla 3: mínimo 77 h en 7 días. Si no tenemos 7 días, asumimos work
  // (peor caso) — pero solo flaggeamos si tenemos el día target con datos.
  let restIn7Days = 0;
  for (const d of window) restIn7Days += d.hours.filter(Boolean).length;
  if (window.length === 7 && restIn7Days < 77) {
    violations.push({
      kind: "MIN_77H_PER_7D",
      details: `${restIn7Days}h de descanso en 7 días (mínimo STCW: 77h).`,
    });
  }

  return { totalRest, violations };
}

type Delegate = {
  findMany(a: unknown): Promise<Record<string, unknown>[]>;
  findFirst(a: unknown): Promise<Record<string, unknown> | null>;
  upsert(a: unknown): Promise<Record<string, unknown>>;
  delete(a: unknown): Promise<unknown>;
  count(a: unknown): Promise<number>;
};
function delegate(prisma: NonNullable<ReturnType<typeof getPrismaClient>>) {
  return (prisma as unknown as { crewRestHours: Delegate }).crewRestHours;
}

async function getTenantIdOrThrow(s: TenantAccessSession): Promise<string> {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "DB no disponible.");
  const tenant = await prisma.tenant.findUnique({ where: { slug: s.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");
  return tenant.id;
}
function applyVesselScope(s: TenantAccessSession, where: Record<string, unknown>, requested?: string | null) {
  if (s.user.role === "TENANT_ADMIN") { if (requested) where.vesselCode = requested; return; }
  if (requested) {
    if (!s.user.assignedVesselCodes.includes(requested)) { where.vesselCode = "__NO_ASSIGNED_VESSEL__"; return; }
    where.vesselCode = requested; return;
  }
  if (s.user.assignedVesselCodes.length === 0) { where.vesselCode = "__NO_ASSIGNED_VESSEL__"; return; }
  where.vesselCode = { in: s.user.assignedVesselCodes };
}

export async function listRestHours(session: TenantAccessSession, filters: RestHoursListFilters = {}) {
  const prisma = getPrismaClient();
  if (!prisma) return [];
  const tenantId = await getTenantIdOrThrow(session);
  const where: Record<string, unknown> = { tenantId };
  applyVesselScope(session, where, filters.vesselCode ?? null);
  if (filters.crewId) where.crewId = filters.crewId;
  if (filters.fromDate || filters.toDate) {
    const range: Record<string, Date> = {};
    if (filters.fromDate) range.gte = parseISODate(filters.fromDate, "fromDate");
    if (filters.toDate) range.lte = parseISODate(filters.toDate, "toDate");
    where.recordDate = range;
  }
  if (filters.onlyViolations) where.hasViolation = true;
  return delegate(prisma).findMany({ where, orderBy: [{ recordDate: "desc" }, { crewId: "asc" }] });
}

/**
 * Upsert (insert o update) de un día. Recalcula las violaciones mirando los
 * 6 días anteriores en DB para evaluar la regla de 77h/7d.
 */
export async function upsertRestHours(session: TenantAccessSession, input: RestHoursWriteInput) {
  ensureCanWrite(session);
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "DB no disponible.");
  const tenantId = await getTenantIdOrThrow(session);
  const vesselCode = String(input.vesselCode ?? "").trim().toUpperCase();
  if (!vesselCode) throw new RouteError(400, "VALIDATION_ERROR", "vesselCode requerido.");
  if (session.user.role !== "TENANT_ADMIN" && !session.user.assignedVesselCodes.includes(vesselCode)) {
    throw new RouteError(403, "FORBIDDEN", "Sin acceso al vessel solicitado.");
  }
  const crewId = String(input.crewId ?? "").trim();
  if (!crewId) throw new RouteError(400, "VALIDATION_ERROR", "crewId requerido.");
  const recordDate = parseISODate(input.recordDate, "recordDate");
  const hours = validateHoursArray(input.hoursData);

  // Traer los 6 días anteriores para el cálculo de 7d.
  const sixDaysAgo = new Date(recordDate.getTime() - 6 * 24 * 60 * 60 * 1000);
  const window = await delegate(prisma).findMany({
    where: {
      tenantId, vesselCode, crewId,
      recordDate: { gte: sixDaysAgo, lt: recordDate },
    },
    select: { recordDate: true, hoursData: true } as never,
  }) as Array<{ recordDate: Date; hoursData: unknown }>;

  const allDays: Array<{ date: Date; hours: boolean[] }> = [
    ...window.map(w => ({ date: new Date(w.recordDate), hours: Array.isArray(w.hoursData) ? (w.hoursData as boolean[]) : new Array(24).fill(false) })),
    { date: recordDate, hours },
  ];
  const { totalRest, violations } = computeViolations(allDays, recordDate);

  const row = await delegate(prisma).upsert({
    where: { tenantId_vesselCode_crewId_recordDate: { tenantId, vesselCode, crewId, recordDate } },
    create: {
      tenantId, vesselCode, crewId, recordDate,
      hoursData: hours,
      notes: normOpt(input.notes),
      totalRestHours: totalRest,
      hasViolation: violations.length > 0,
      violationsJson: violations,
      createdByUserId: session.user.id,
      updatedByUserId: session.user.id,
    },
    update: {
      hoursData: hours,
      notes: normOpt(input.notes),
      totalRestHours: totalRest,
      hasViolation: violations.length > 0,
      violationsJson: violations,
      updatedByUserId: session.user.id,
    },
  });
  void publishAudit(prisma, {
    tenantId, actorUserId: session.user.id,
    action: "RestHours.upserted", entityType: "CrewRestHours",
    entityId: (row as { id: string }).id,
    metadata: { vesselCode, crewId, recordDate: recordDate.toISOString().slice(0, 10), totalRest, violations: violations.length },
  });
  return row;
}

/**
 * Snapshot mensual para una vista grilla: trae todos los días del mes de
 * todos los crew ONBOARD del vessel y devuelve un mapa por crewId.
 */
export async function monthlySnapshot(
  session: TenantAccessSession,
  filters: { vesselCode: string; year: number; month: number },
) {
  const prisma = getPrismaClient();
  if (!prisma) return { month: filters.month, year: filters.year, crew: [], rows: [] };
  const tenantId = await getTenantIdOrThrow(session);
  const vesselCode = filters.vesselCode.toUpperCase();
  if (session.user.role !== "TENANT_ADMIN" && !session.user.assignedVesselCodes.includes(vesselCode)) {
    throw new RouteError(403, "FORBIDDEN", "Sin acceso al vessel solicitado.");
  }
  const start = new Date(Date.UTC(filters.year, filters.month - 1, 1));
  const end   = new Date(Date.UTC(filters.year, filters.month, 1));

  const rows = await delegate(prisma).findMany({
    where: { tenantId, vesselCode, recordDate: { gte: start, lt: end } },
  });
  const crew = await (prisma as unknown as {
    crew: { findMany(a: unknown): Promise<Array<{ id: string; firstName: string; lastName: string; rankDefinition: { name: string } | null; status: string }>> };
  }).crew.findMany({
    where: { tenantId, vesselCode, deletedAt: null, status: "ONBOARD" },
    select: { id: true, firstName: true, lastName: true, rankDefinition: { select: { name: true } }, status: true },
    orderBy: { lastName: "asc" },
  });

  // Map rankDefinition to rank string for backward compatibility
  const crewWithRank = crew.map(c => ({
    ...c,
    rank: c.rankDefinition?.name ?? "Unknown",
  }));

  return { month: filters.month, year: filters.year, crew: crewWithRank, rows };
}

export async function deleteRestHoursDay(session: TenantAccessSession, id: string) {
  ensureCanWrite(session);
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "DB no disponible.");
  const tenantId = await getTenantIdOrThrow(session);
  const existing = await delegate(prisma).findFirst({ where: { id, tenantId } }) as unknown as { id: string; vesselCode: string; recordDate: Date; crewId: string } | null;
  if (!existing) throw new RouteError(404, "NOT_FOUND", "Registro no encontrado.");
  if (session.user.role !== "TENANT_ADMIN" && !session.user.assignedVesselCodes.includes(existing.vesselCode)) {
    throw new RouteError(403, "FORBIDDEN", "Sin acceso al vessel del registro.");
  }
  await delegate(prisma).delete({ where: { id } });
  void publishAudit(prisma, {
    tenantId, actorUserId: session.user.id,
    action: "RestHours.deleted", entityType: "CrewRestHours", entityId: id,
    metadata: { vesselCode: existing.vesselCode, crewId: existing.crewId, recordDate: existing.recordDate.toISOString().slice(0, 10) },
  });
}
