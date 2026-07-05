import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { listDevDailyReportsForTenant } from "../../platform/data/dev-domain-store";
import { RouteError } from "../../http/route-error";
import { applyAssignedVesselScope } from "../auth/vessel-scope";

export interface DailyReportListFilters {
  vesselCode?: string | null;
  status?: string | null;
  reportDate?: string | null;
}

export interface CreateDailyReportInput {
  vesselCode: string;
  reportDate: string; // ISO date string
  status?: "DRAFT" | "SUBMITTED" | "REVIEWED" | "CLOSED";
  summary?: string | null;
  positionLat?: number | null;
  positionLon?: number | null;
  engineHoursMain?: number | null;
  generatorHours?: number | null;
  fuelConsumedLiters?: number | null;
  oilConsumedLiters?: number | null;
  notes?: string | null;
  operationalStatus?: string | null;
  currentPort?: string | null;
  nextPort?: string | null;
  etaNextPort?: string | null;
  etdNextPort?: string | null;
  portCallType?: string | null;
  estimatedStayHours?: number | null;
  maintenanceOpportunity?: string | null;
  sparesReceiptPossible?: string | null;
  operationalRemarks?: string | null;
}

export type UpdateDailyReportInput = Partial<Omit<CreateDailyReportInput, "vesselCode" | "reportDate">>;

function ensureCanManage(session: TenantAccessSession) {
  const allowed = ["TENANT_ADMIN", "FLEET_SUPERINTENDENT", "MAINTENANCE_MANAGER", "TECHNICIAN_OPERATOR"];
  if (!allowed.includes(session.user.role)) {
    throw new RouteError(403, "FORBIDDEN", "No autorizado para gestionar reportes diarios.");
  }
}

function parseOptionalFloat(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseOptionalDate(v: unknown): Date | null {
  if (!v) return null;
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Parse a date string respecting the tenant timezone.
 * For date-only strings (YYYY-MM-DD), interprets as noon in the tenant timezone
 * so the stored UTC instant always maps back to the same calendar date locally.
 */
function parseTenantLocalDate(dateStr: string, tenantTz: string): Date {
  if (dateStr.includes("T")) return new Date(dateStr);
  const [y, mo, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, mo! - 1, d!, 12, 0, 0));
  const tzOffset = new Intl.DateTimeFormat("en", { timeZone: tenantTz, timeZoneName: "shortOffset" })
    .formatToParts(dt).find(p => p.type === "timeZoneName")?.value ?? "";
  const match = tzOffset.match(/([+-])(\d+):?(\d*)/);
  if (match) {
    const sign = match[1] === "+" ? -1 : 1;
    dt.setUTCMinutes(dt.getUTCMinutes() + sign * (parseInt(match[2]!) * 60 + parseInt(match[3] || "0")));
  }
  return dt;
}

export async function listTenantDailyReports(session: TenantAccessSession, filters: DailyReportListFilters = {}) {
  const prisma = getPrismaClient();
  if (!prisma) {
    return listDevDailyReportsForTenant(session.tenantSlug, session.user.role, session.user.assignedVesselCodes, filters);
  }

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) return [];

  const where: Record<string, unknown> = { tenantId: tenant.id, deletedAt: null };
  applyAssignedVesselScope(session, where, filters.vesselCode ?? null);
  if (filters.status) where.status = filters.status;
  if (filters.reportDate) {
    const tenantTz = (tenant as any).settings?.timezone ?? "UTC";
    where.reportDate = parseTenantLocalDate(filters.reportDate, tenantTz);
  }

  return prisma.dailyReport.findMany({ where, orderBy: { reportDate: "desc" } });
}

export async function getTenantDailyReport(session: TenantAccessSession, id: string) {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");

  const where: Record<string, unknown> = { id, tenantId: tenant.id, deletedAt: null };
  applyAssignedVesselScope(session, where);

  const record = await prisma.dailyReport.findFirst({ where });
  if (!record) throw new RouteError(404, "NOT_FOUND", "Reporte no encontrado.");
  return record;
}

export async function createTenantDailyReport(session: TenantAccessSession, input: CreateDailyReportInput) {
  ensureCanManage(session);
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");

  if (!input.vesselCode?.trim()) throw new RouteError(400, "VALIDATION_ERROR", "vesselCode es requerido.");
  if (!input.reportDate) throw new RouteError(400, "VALIDATION_ERROR", "reportDate es requerido.");

  const vesselCode = input.vesselCode.trim().toUpperCase();
  const tenantTz = (tenant as any).settings?.timezone ?? "UTC";
  const year = new Date().getFullYear();
  const yy = String(year).slice(-2);
  const rptCount = await prisma.dailyReport.count({ where: { tenantId: tenant.id, vesselCode, createdAt: { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) } } });
  const reportCode = `RPT-${vesselCode}-${yy}-${String(rptCount + 1).padStart(4, "0")}`;

  return await prisma.dailyReport.create({
    data: {
      tenantId: tenant.id,
      vesselCode,
      reportCode,
      reportDate: parseTenantLocalDate(input.reportDate, tenantTz),
      status: (input.status ?? "DRAFT") as never,
      summary: input.summary?.trim() || null,
      positionLat: parseOptionalFloat(input.positionLat),
      positionLon: parseOptionalFloat(input.positionLon),
      engineHoursMain: parseOptionalFloat(input.engineHoursMain),
      generatorHours: parseOptionalFloat(input.generatorHours),
      fuelConsumedLiters: parseOptionalFloat(input.fuelConsumedLiters),
      oilConsumedLiters: parseOptionalFloat(input.oilConsumedLiters),
      notes: input.notes?.trim() || null,
      operationalStatus: (input.operationalStatus || null) as never,
      currentPort: input.currentPort?.trim() || null,
      nextPort: input.nextPort?.trim() || null,
      etaNextPort: parseOptionalDate(input.etaNextPort),
      etdNextPort: parseOptionalDate(input.etdNextPort),
      portCallType: (input.portCallType || null) as never,
      estimatedStayHours: parseOptionalFloat(input.estimatedStayHours),
      maintenanceOpportunity: (input.maintenanceOpportunity || "UNKNOWN") as never,
      sparesReceiptPossible: (input.sparesReceiptPossible || "UNKNOWN") as never,
      operationalRemarks: input.operationalRemarks?.trim() || null,
      createdByUserId: session.user.id,
      updatedByUserId: session.user.id,
    },
  });
}

export async function updateTenantDailyReport(session: TenantAccessSession, id: string, input: UpdateDailyReportInput) {
  ensureCanManage(session);
  const existing = await getTenantDailyReport(session, id);
  if (existing.status === "CLOSED") {
    throw new RouteError(409, "REPORT_CLOSED", "No se puede modificar un reporte cerrado.");
  }

  const prisma = getPrismaClient()!;
  const data: Record<string, unknown> = { updatedByUserId: session.user.id };

  if (input.status !== undefined) data.status = input.status;
  if (input.summary !== undefined) data.summary = input.summary?.trim() || null;
  if (input.positionLat !== undefined) data.positionLat = parseOptionalFloat(input.positionLat);
  if (input.positionLon !== undefined) data.positionLon = parseOptionalFloat(input.positionLon);
  if (input.engineHoursMain !== undefined) data.engineHoursMain = parseOptionalFloat(input.engineHoursMain);
  if (input.generatorHours !== undefined) data.generatorHours = parseOptionalFloat(input.generatorHours);
  if (input.fuelConsumedLiters !== undefined) data.fuelConsumedLiters = parseOptionalFloat(input.fuelConsumedLiters);
  if (input.oilConsumedLiters !== undefined) data.oilConsumedLiters = parseOptionalFloat(input.oilConsumedLiters);
  if (input.notes !== undefined) data.notes = input.notes?.trim() || null;
  if (input.operationalStatus !== undefined) data.operationalStatus = input.operationalStatus || null;
  if (input.currentPort !== undefined) data.currentPort = input.currentPort?.trim() || null;
  if (input.nextPort !== undefined) data.nextPort = input.nextPort?.trim() || null;
  if (input.etaNextPort !== undefined) data.etaNextPort = parseOptionalDate(input.etaNextPort);
  if (input.etdNextPort !== undefined) data.etdNextPort = parseOptionalDate(input.etdNextPort);
  if (input.portCallType !== undefined) data.portCallType = input.portCallType || null;
  if (input.estimatedStayHours !== undefined) data.estimatedStayHours = parseOptionalFloat(input.estimatedStayHours);
  if (input.maintenanceOpportunity !== undefined) data.maintenanceOpportunity = input.maintenanceOpportunity || "UNKNOWN";
  if (input.sparesReceiptPossible !== undefined) data.sparesReceiptPossible = input.sparesReceiptPossible || "UNKNOWN";
  if (input.operationalRemarks !== undefined) data.operationalRemarks = input.operationalRemarks?.trim() || null;

  return prisma.dailyReport.update({ where: { id }, data });
}

/**
 * Reabre un reporte diario para corrección (solo ADMIN): lo vuelve a DRAFT y
 * limpia integratedAt, de modo que se desbloqueen todas las tabs para editar.
 * NO revierte la integración ya aplicada (WorkLogs / avance de planes); solo
 * habilita la edición. No re-integra por sí mismo.
 */
export async function reopenDailyReport(session: TenantAccessSession, id: string) {
  if (session.user.role !== "TENANT_ADMIN") {
    throw new RouteError(403, "FORBIDDEN", "Solo un administrador puede reabrir un reporte diario.");
  }
  await getTenantDailyReport(session, id); // valida tenant + scope (404 si no accesible)
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  return prisma.dailyReport.update({
    where: { id },
    data: { status: "DRAFT", integratedAt: null, updatedByUserId: session.user.id },
  });
}

export interface FuelConsumptionPoint {
  date: string;   // YYYY-MM-DD
  liters: number;
}

export async function getFuelConsumptionTrend(
  session: TenantAccessSession,
  vesselCode: string | null,
  days = 30,
): Promise<FuelConsumptionPoint[]> {
  const prisma = getPrismaClient();
  if (!prisma) return [];

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) return [];

  const since = new Date();
  since.setDate(since.getDate() - (days - 1));
  since.setUTCHours(0, 0, 0, 0);

  const where: Record<string, unknown> = {
    tenantId: tenant.id,
    deletedAt: null,
    fuelConsumedLiters: { not: null },
    status: { in: ["SUBMITTED", "REVIEWED", "CLOSED"] },
    reportDate: { gte: since },
  };

  applyAssignedVesselScope(session, where, vesselCode ?? null);

  const records = await prisma.dailyReport.findMany({
    where,
    select: { reportDate: true, fuelConsumedLiters: true },
    orderBy: { reportDate: "asc" },
  });

  // Group by calendar date (YYYY-MM-DD), sum liters per day
  const byDate = new Map<string, number>();
  for (const r of records) {
    const key = r.reportDate.toISOString().slice(0, 10);
    byDate.set(key, (byDate.get(key) ?? 0) + (r.fuelConsumedLiters ?? 0));
  }

  return Array.from(byDate.entries()).map(([date, liters]) => ({ date, liters }));
}
