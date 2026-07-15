// Voyage Tank Report (Formulario M2) — servicio de CRUD del documento por viaje.
// Espeja el patrón de daily-reports-service.ts: scope por tenant + vessel asignado,
// roles vía ensureCanManage, reportCode incremental anual, bloqueo al cerrar.

import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { applyAssignedVesselScope } from "../auth/vessel-scope";
import { integrateVoyageTankReportHours } from "./voyage-tank-reports-integration-service";
import { log } from "../../common/logger";

// Plantilla por defecto de carboneras/tanques (orden del formulario M2 en papel).
// Se siembra al crear el reporte para que grilla y PDF coincidan siempre.
export const DEFAULT_TANK_TEMPLATE: string[] = [
  "TANQUE N°1 Estribor",
  "TANQUE N°2 Babor",
  "TANQUE N°3 Central",
  "TANQUE N°4 Babor",
  "TANQUE N°5 Estribor",
  "TANQUE Diario",
  "TANQUE de decantación",
];

export interface VoyageTankReportListFilters {
  vesselCode?: string | null;
  status?: string | null;
}

export interface CreateVoyageTankReportInput {
  vesselCode: string;
  voyageCode: string;
  tramo?: string | null;
  reportDateTime?: string | null;
  status?: "DRAFT" | "SUBMITTED" | "CLOSED";
  kmStart?: number | null;
  kmEnd?: number | null;
  dateStart?: string | null;
  dateEnd?: string | null;
  daysNav?: number | null;
  bunkerReceivedLts?: number | null;
  bargeDeliveredLts?: number | null;
  signatory?: string | null;
  notes?: string | null;
}

export type UpdateVoyageTankReportInput = Partial<Omit<CreateVoyageTankReportInput, "vesselCode">>;

function ensureCanManage(session: TenantAccessSession) {
  const allowed = ["TENANT_ADMIN", "FLEET_SUPERINTENDENT", "MAINTENANCE_MANAGER", "TECHNICIAN_OPERATOR"];
  if (!allowed.includes(session.user.role)) {
    throw new RouteError(403, "FORBIDDEN", "No autorizado para gestionar mediciones de tanques.");
  }
}

function parseOptionalFloat(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseOptionalInt(v: unknown): number | null {
  const n = parseOptionalFloat(v);
  return n === null ? null : Math.round(n);
}

function parseOptionalDate(v: unknown): Date | null {
  if (!v) return null;
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d;
}

export async function listVoyageTankReports(session: TenantAccessSession, filters: VoyageTankReportListFilters = {}) {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) return [];

  const where: Record<string, unknown> = { tenantId: tenant.id, deletedAt: null };
  applyAssignedVesselScope(session, where, filters.vesselCode ?? null);
  if (filters.status) where.status = filters.status;

  return prisma.voyageTankReport.findMany({ where, orderBy: { createdAt: "desc" } });
}

export async function getVoyageTankReport(session: TenantAccessSession, id: string) {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");

  const where: Record<string, unknown> = { id, tenantId: tenant.id, deletedAt: null };
  applyAssignedVesselScope(session, where);

  const record = await prisma.voyageTankReport.findFirst({ where });
  if (!record) throw new RouteError(404, "NOT_FOUND", "Medición no encontrada.");
  return record;
}

export async function createVoyageTankReport(session: TenantAccessSession, input: CreateVoyageTankReportInput) {
  ensureCanManage(session);
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");

  if (!input.vesselCode?.trim()) throw new RouteError(400, "VALIDATION_ERROR", "vesselCode es requerido.");
  if (!input.voyageCode?.trim()) throw new RouteError(400, "VALIDATION_ERROR", "voyageCode es requerido.");

  const vesselCode = input.vesselCode.trim().toUpperCase();
  const voyageCode = input.voyageCode.trim();

  const dup = await prisma.voyageTankReport.findFirst({
    where: { tenantId: tenant.id, vesselCode, voyageCode, deletedAt: null },
  });
  if (dup) throw new RouteError(409, "DUPLICATE_VOYAGE", `Ya existe una medición para el viaje ${voyageCode} en este buque.`);

  const year = new Date().getFullYear();
  const yy = String(year).slice(-2);
  const count = await prisma.voyageTankReport.count({
    where: { tenantId: tenant.id, vesselCode, createdAt: { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) } },
  });
  const reportCode = `M2-${vesselCode}-${yy}-${String(count + 1).padStart(4, "0")}`;

  return prisma.voyageTankReport.create({
    data: {
      tenantId: tenant.id,
      vesselCode,
      voyageCode,
      reportCode,
      tramo: input.tramo?.trim() || null,
      reportDateTime: parseOptionalDate(input.reportDateTime),
      status: (input.status ?? "DRAFT") as never,
      kmStart: parseOptionalFloat(input.kmStart),
      kmEnd: parseOptionalFloat(input.kmEnd),
      dateStart: parseOptionalDate(input.dateStart),
      dateEnd: parseOptionalDate(input.dateEnd),
      daysNav: parseOptionalInt(input.daysNav),
      bunkerReceivedLts: parseOptionalFloat(input.bunkerReceivedLts),
      bargeDeliveredLts: parseOptionalFloat(input.bargeDeliveredLts),
      signatory: input.signatory?.trim() || null,
      notes: input.notes?.trim() || null,
      createdByUserId: session.user.id,
      updatedByUserId: session.user.id,
      // Sembrar carboneras por defecto para que la grilla arranque poblada.
      tankReadings: {
        create: DEFAULT_TANK_TEMPLATE.map((tankLabel, i) => ({
          tenantId: tenant.id,
          vesselCode,
          tankLabel,
          tankOrder: i,
        })),
      },
    },
  });
}

export async function updateVoyageTankReport(session: TenantAccessSession, id: string, input: UpdateVoyageTankReportInput) {
  ensureCanManage(session);
  const existing = await getVoyageTankReport(session, id);
  if (existing.status === "CLOSED") {
    throw new RouteError(409, "REPORT_CLOSED", "No se puede modificar una medición cerrada.");
  }

  const prisma = getPrismaClient()!;
  const data: Record<string, unknown> = { updatedByUserId: session.user.id };

  if (input.voyageCode !== undefined) {
    const voyageCode = input.voyageCode?.trim();
    if (!voyageCode) throw new RouteError(400, "VALIDATION_ERROR", "voyageCode no puede quedar vacío.");
    if (voyageCode !== existing.voyageCode) {
      const dup = await prisma.voyageTankReport.findFirst({
        where: { tenantId: existing.tenantId, vesselCode: existing.vesselCode, voyageCode, deletedAt: null, id: { not: id } },
      });
      if (dup) throw new RouteError(409, "DUPLICATE_VOYAGE", `Ya existe una medición para el viaje ${voyageCode} en este buque.`);
    }
    data.voyageCode = voyageCode;
  }
  if (input.status !== undefined) data.status = input.status;
  if (input.tramo !== undefined) data.tramo = input.tramo?.trim() || null;
  if (input.reportDateTime !== undefined) data.reportDateTime = parseOptionalDate(input.reportDateTime);
  if (input.kmStart !== undefined) data.kmStart = parseOptionalFloat(input.kmStart);
  if (input.kmEnd !== undefined) data.kmEnd = parseOptionalFloat(input.kmEnd);
  if (input.dateStart !== undefined) data.dateStart = parseOptionalDate(input.dateStart);
  if (input.dateEnd !== undefined) data.dateEnd = parseOptionalDate(input.dateEnd);
  if (input.daysNav !== undefined) data.daysNav = parseOptionalInt(input.daysNav);
  if (input.bunkerReceivedLts !== undefined) data.bunkerReceivedLts = parseOptionalFloat(input.bunkerReceivedLts);
  if (input.bargeDeliveredLts !== undefined) data.bargeDeliveredLts = parseOptionalFloat(input.bargeDeliveredLts);
  if (input.signatory !== undefined) data.signatory = input.signatory?.trim() || null;
  if (input.notes !== undefined) data.notes = input.notes?.trim() || null;

  const updated = await prisma.voyageTankReport.update({ where: { id }, data });

  // Al ENVIAR (transición a SUBMITTED) integramos los horómetros al avance de
  // planes de mantenimiento por horas — antes lo hacía el Reporte Diario. Se
  // corre solo en la transición (no cada guardado) y es tolerante a fallas: si
  // la integración falla, el envío igual queda guardado.
  if (input.status === "SUBMITTED" && existing.status !== "SUBMITTED") {
    try {
      const integration = await integrateVoyageTankReportHours(session, id);
      return { ...updated, _integration: integration };
    } catch (err) {
      log.error("[voyage-tank] integración de horómetros falló:", err);
    }
  }

  return updated;
}
