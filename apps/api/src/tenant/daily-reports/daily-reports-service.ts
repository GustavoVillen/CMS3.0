import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { listDevDailyReportsForTenant } from "../../platform/data/dev-domain-store";
import { RouteError } from "../../http/route-error";

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
  notes?: string | null;
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

export async function listTenantDailyReports(session: TenantAccessSession, filters: DailyReportListFilters = {}) {
  const prisma = getPrismaClient();
  if (!prisma) {
    return listDevDailyReportsForTenant(session.tenantSlug, session.user.role, session.user.assignedVesselCodes, filters);
  }

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) return [];

  const where: Record<string, unknown> = { tenantId: tenant.id, deletedAt: null };
  if (session.user.role !== "TENANT_ADMIN" && session.user.assignedVesselCodes.length > 0) {
    where.vesselCode = { in: session.user.assignedVesselCodes };
  }
  if (filters.vesselCode) where.vesselCode = filters.vesselCode;
  if (filters.status) where.status = filters.status;
  if (filters.reportDate) where.reportDate = new Date(filters.reportDate);

  return prisma.dailyReport.findMany({ where, orderBy: { reportDate: "desc" } });
}

export async function getTenantDailyReport(session: TenantAccessSession, id: string) {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");

  const where: Record<string, unknown> = { id, tenantId: tenant.id, deletedAt: null };
  if (session.user.role !== "TENANT_ADMIN" && session.user.assignedVesselCodes.length > 0) {
    where.vesselCode = { in: session.user.assignedVesselCodes };
  }

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
  const year = new Date().getFullYear();
  const yy = String(year).slice(-2);
  const rptCount = await prisma.dailyReport.count({ where: { tenantId: tenant.id, vesselCode, createdAt: { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) } } });
  const reportCode = `RPT-${vesselCode}-${yy}-${String(rptCount + 1).padStart(4, "0")}`;

  return await prisma.dailyReport.create({
    data: {
      tenantId: tenant.id,
      vesselCode,
      reportCode,
      reportDate: new Date(input.reportDate),
      status: (input.status ?? "DRAFT") as never,
      summary: input.summary?.trim() || null,
      positionLat: parseOptionalFloat(input.positionLat),
      positionLon: parseOptionalFloat(input.positionLon),
      engineHoursMain: parseOptionalFloat(input.engineHoursMain),
      generatorHours: parseOptionalFloat(input.generatorHours),
      fuelConsumedLiters: parseOptionalFloat(input.fuelConsumedLiters),
      notes: input.notes?.trim() || null,
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
  if (input.notes !== undefined) data.notes = input.notes?.trim() || null;
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
