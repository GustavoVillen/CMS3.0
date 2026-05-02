import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { getSpareInventoryReport } from "./spare-reports-service";

export type MonthlyReportStatus = "DRAFT" | "SUBMITTED" | "REVIEWED" | "CLOSED";

export interface MonthlyReportListFilters {
  vesselCode?: string | null;
  status?: string | null;
  year?: number | null;
  month?: number | null;
}

export interface CreateMonthlyReportInput {
  vesselCode: string;
  reportYear: number;
  reportMonth: number;
  status?: MonthlyReportStatus;
  operationalStatus?: string | null;
  currentPort?: string | null;
  positionLat?: number | null;
  positionLon?: number | null;
  summary?: string | null;
  nextPort?: string | null;
  etaNextPort?: string | null;
  notes?: string | null;
}

export type UpdateMonthlyReportInput = Partial<Omit<CreateMonthlyReportInput, "vesselCode" | "reportYear" | "reportMonth">>;

const MANAGE_ROLES = ["TENANT_ADMIN", "FLEET_SUPERINTENDENT", "MAINTENANCE_MANAGER", "TECHNICIAN_OPERATOR"];

function ensureCanManage(session: TenantAccessSession) {
  if (!MANAGE_ROLES.includes(session.user.role)) {
    throw new RouteError(403, "FORBIDDEN", "No autorizado para gestionar reportes mensuales.");
  }
}

function parseOptFloat(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseOptDate(v: unknown): Date | null {
  if (!v) return null;
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d;
}

async function resolveTenantId(session: TenantAccessSession): Promise<string> {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");
  return tenant.id;
}

function applyVesselScope(session: TenantAccessSession, where: Record<string, unknown>) {
  if (session.user.role !== "TENANT_ADMIN" && session.user.assignedVesselCodes.length > 0) {
    where.vesselCode = { in: session.user.assignedVesselCodes };
  }
}

export async function listTenantMonthlyReports(
  session: TenantAccessSession,
  filters: MonthlyReportListFilters = {},
) {
  const prisma = getPrismaClient();
  if (!prisma) return [];
  const tenantId = await resolveTenantId(session);

  const where: Record<string, unknown> = { tenantId, deletedAt: null };
  applyVesselScope(session, where);
  if (filters.vesselCode) where.vesselCode = filters.vesselCode;
  if (filters.status) where.status = filters.status;
  if (filters.year)  where.reportYear  = filters.year;
  if (filters.month) where.reportMonth = filters.month;

  return (prisma as any).monthlyReport.findMany({
    where,
    orderBy: [{ reportYear: "desc" }, { reportMonth: "desc" }],
  });
}

export async function getTenantMonthlyReport(session: TenantAccessSession, id: string) {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const tenantId = await resolveTenantId(session);

  const where: Record<string, unknown> = { id, tenantId, deletedAt: null };
  applyVesselScope(session, where);

  const record = await (prisma as any).monthlyReport.findFirst({ where });
  if (!record) throw new RouteError(404, "NOT_FOUND", "Reporte mensual no encontrado.");
  return record;
}

export async function createTenantMonthlyReport(
  session: TenantAccessSession,
  input: CreateMonthlyReportInput,
) {
  ensureCanManage(session);
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const tenantId = await resolveTenantId(session);

  if (!input.vesselCode?.trim()) throw new RouteError(400, "VALIDATION_ERROR", "vesselCode es requerido.");
  if (!input.reportYear || !input.reportMonth) {
    throw new RouteError(400, "VALIDATION_ERROR", "reportYear y reportMonth son requeridos.");
  }
  if (input.reportMonth < 1 || input.reportMonth > 12) {
    throw new RouteError(400, "VALIDATION_ERROR", "reportMonth debe estar entre 1 y 12.");
  }

  const vesselCode = input.vesselCode.trim().toUpperCase();

  if (session.user.role !== "TENANT_ADMIN" && !session.user.assignedVesselCodes.includes(vesselCode)) {
    throw new RouteError(403, "FORBIDDEN", "Sin acceso al vessel solicitado.");
  }

  // One report per (vessel, year, month).
  const existing = await (prisma as any).monthlyReport.findFirst({
    where: { tenantId, vesselCode, reportYear: input.reportYear, reportMonth: input.reportMonth, deletedAt: null },
  });
  if (existing) {
    throw new RouteError(409, "DUPLICATE", "Ya existe un reporte mensual para ese período y buque.");
  }

  return (prisma as any).monthlyReport.create({
    data: {
      tenantId,
      vesselCode,
      reportYear:  input.reportYear,
      reportMonth: input.reportMonth,
      status: (input.status ?? "DRAFT") as never,
      operationalStatus: (input.operationalStatus || null) as never,
      currentPort: input.currentPort?.trim() || null,
      positionLat: parseOptFloat(input.positionLat),
      positionLon: parseOptFloat(input.positionLon),
      summary: input.summary?.trim() || null,
      nextPort: input.nextPort?.trim() || null,
      etaNextPort: parseOptDate(input.etaNextPort),
      notes: input.notes?.trim() || null,
      createdByUserId: session.user.id,
      updatedByUserId: session.user.id,
    },
  });
}

export async function updateTenantMonthlyReport(
  session: TenantAccessSession,
  id: string,
  input: UpdateMonthlyReportInput,
) {
  ensureCanManage(session);
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const tenantId = await resolveTenantId(session);

  const where: Record<string, unknown> = { id, tenantId, deletedAt: null };
  applyVesselScope(session, where);
  const existing = await (prisma as any).monthlyReport.findFirst({ where });
  if (!existing) throw new RouteError(404, "NOT_FOUND", "Reporte mensual no encontrado.");
  if (existing.status === "CLOSED") {
    throw new RouteError(409, "CLOSED", "El reporte está cerrado y no puede editarse.");
  }

  const data: Record<string, unknown> = { updatedByUserId: session.user.id };
  if (input.status            !== undefined) data.status            = input.status;
  if (input.operationalStatus !== undefined) data.operationalStatus = input.operationalStatus || null;
  if (input.currentPort       !== undefined) data.currentPort       = input.currentPort?.trim() || null;
  if (input.positionLat       !== undefined) data.positionLat       = parseOptFloat(input.positionLat);
  if (input.positionLon       !== undefined) data.positionLon       = parseOptFloat(input.positionLon);
  if (input.summary           !== undefined) data.summary           = input.summary?.trim() || null;
  if (input.nextPort          !== undefined) data.nextPort          = input.nextPort?.trim() || null;
  if (input.etaNextPort       !== undefined) data.etaNextPort       = parseOptDate(input.etaNextPort);
  if (input.notes             !== undefined) data.notes             = input.notes?.trim() || null;

  return (prisma as any).monthlyReport.update({ where: { id }, data });
}

/**
 * Submit: freeze the inventory snapshot at this moment, mark status=SUBMITTED,
 * record submittedBy/At. Once submitted the report still allows REVIEWED/CLOSED
 * transitions but the snapshot does not change.
 */
export async function submitTenantMonthlyReport(session: TenantAccessSession, id: string) {
  ensureCanManage(session);
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const tenantId = await resolveTenantId(session);

  const where: Record<string, unknown> = { id, tenantId, deletedAt: null };
  applyVesselScope(session, where);
  const existing = await (prisma as any).monthlyReport.findFirst({ where });
  if (!existing) throw new RouteError(404, "NOT_FOUND", "Reporte mensual no encontrado.");
  if (existing.status === "CLOSED") {
    throw new RouteError(409, "CLOSED", "El reporte ya está cerrado.");
  }

  // Freeze inventory snapshot (no department filter — full inventory of the vessel).
  const inv = await getSpareInventoryReport(session, {
    vesselCode: existing.vesselCode,
    department: null,
    asOfDate: null,
  });

  const snapshot = {
    asOfDate: inv.filters.asOfDate,
    items: inv.items.map((it) => ({
      id: it.id,
      sku: it.sku,
      name: it.name,
      sfiCode: it.sfiCode,
      sfiName: (it as any).sfiName ?? null,
      department: it.department,
      onHand: it.onHand,
      unit: it.unit,
      minStock: it.minStock,
      reorderPoint: it.reorderPoint,
      belowReorder: it.belowReorder,
      location: it.location,
      lastMovementAt: it.lastMovementAt,
    })),
    summary: inv.summary,
  };

  return (prisma as any).monthlyReport.update({
    where: { id },
    data: {
      status: "SUBMITTED",
      submittedAt: new Date(),
      submittedByUserId: session.user.id,
      inventorySnapshot: snapshot as never,
      inventorySnapshotAt: new Date(),
      updatedByUserId: session.user.id,
    },
  });
}
