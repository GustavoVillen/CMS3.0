// Voyage Tank Report (Formulario M2) — carga full + upsert de hijos.
// Patrón delete-all-then-recreate espejo de daily-report-integration-service.ts.
// Sin integración PMS (no avanza planes ni WorkLogs): es un documento standalone.

import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { refreshExecutionStatuses } from "../pms/execution-windows-service";
import { log } from "../../common/logger";

function scopedWhere(session: TenantAccessSession, tenantId: string, id: string): Record<string, unknown> {
  const where: Record<string, unknown> = { id, tenantId, deletedAt: null };
  // FAIL-CLOSED: ADMIN y FLEET_SUPERINTENDENT ven todo el tenant; el resto solo
  // sus vessels asignados; sin asignación → no ve nada.
  if (session.user.role !== "TENANT_ADMIN" && session.user.role !== "FLEET_SUPERINTENDENT") {
    where.vesselCode = session.user.assignedVesselCodes.length === 0
      ? "__NO_ASSIGNED_VESSEL__"
      : { in: session.user.assignedVesselCodes };
  }
  return where;
}

export async function getVoyageTankReportFull(session: TenantAccessSession, reportId: string) {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");

  const report = await prisma.voyageTankReport.findFirst({
    where: scopedWhere(session, tenant.id, reportId),
    include: {
      tankReadings: { orderBy: { tankOrder: "asc" } },
      engineHours: { orderBy: { engineOrder: "asc" } },
    },
  });
  if (!report) throw new RouteError(404, "NOT_FOUND", "Medición no encontrada.");
  return report;
}

async function assertEditable(session: TenantAccessSession, reportId: string) {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");
  const report = await prisma.voyageTankReport.findFirst({ where: scopedWhere(session, tenant.id, reportId) });
  if (!report) throw new RouteError(404, "NOT_FOUND", "Medición no encontrada.");
  if (report.status === "CLOSED") throw new RouteError(409, "REPORT_CLOSED", "No se puede modificar una medición cerrada.");
  return { prisma, tenant, report };
}

export interface TankReadingInput {
  tankLabel: string;
  tankOrder?: number | null;
  liquidHeightMmInitial?: number | null;
  waterHeightMmInitial?: number | null;
  volumeTotalLtsInitial?: number | null;
  volumeWaterLtsInitial?: number | null;
  liquidHeightMmFinal?: number | null;
  waterHeightMmFinal?: number | null;
  volumeTotalLtsFinal?: number | null;
  volumeWaterLtsFinal?: number | null;
}

export async function upsertVoyageTankReadings(session: TenantAccessSession, reportId: string, entries: TankReadingInput[]) {
  const { prisma, tenant, report } = await assertEditable(session, reportId);

  await prisma.voyageTankReading.deleteMany({ where: { voyageReportId: reportId } });

  const num = (v: unknown): number | null => {
    if (v === null || v === undefined || (v as string) === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const results = [];
  let i = 0;
  for (const entry of entries) {
    results.push(await prisma.voyageTankReading.create({
      data: {
        tenantId: tenant.id,
        vesselCode: report.vesselCode,
        voyageReportId: reportId,
        tankLabel: entry.tankLabel,
        tankOrder: entry.tankOrder ?? i,
        liquidHeightMmInitial: num(entry.liquidHeightMmInitial),
        waterHeightMmInitial: num(entry.waterHeightMmInitial),
        volumeTotalLtsInitial: num(entry.volumeTotalLtsInitial),
        volumeWaterLtsInitial: num(entry.volumeWaterLtsInitial),
        liquidHeightMmFinal: num(entry.liquidHeightMmFinal),
        waterHeightMmFinal: num(entry.waterHeightMmFinal),
        volumeTotalLtsFinal: num(entry.volumeTotalLtsFinal),
        volumeWaterLtsFinal: num(entry.volumeWaterLtsFinal),
      },
    }));
    i++;
  }
  return results;
}

export interface EngineHoursInput {
  assetId?: string | null;
  engineLabel: string;
  engineOrder?: number | null;
  hoursInitial?: number | null;
  hoursFinal?: number | null;
}

export async function upsertVoyageEngineHours(session: TenantAccessSession, reportId: string, entries: EngineHoursInput[]) {
  const { prisma, tenant, report } = await assertEditable(session, reportId);

  await prisma.voyageEngineHours.deleteMany({ where: { voyageReportId: reportId } });

  const num = (v: unknown): number | null => {
    if (v === null || v === undefined || (v as string) === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const results = [];
  let i = 0;
  for (const entry of entries) {
    results.push(await prisma.voyageEngineHours.create({
      data: {
        tenantId: tenant.id,
        vesselCode: report.vesselCode,
        voyageReportId: reportId,
        assetId: entry.assetId ?? null,
        engineLabel: entry.engineLabel,
        engineOrder: entry.engineOrder ?? i,
        hoursInitial: num(entry.hoursInitial),
        hoursFinal: num(entry.hoursFinal),
      },
    }));
    i++;
  }
  return results;
}

/**
 * Integra los horómetros del M2 al PMS (avance de planes de mantenimiento por
 * horas). Antes esto lo hacía el Reporte Diario al confirmarse; ahora corre al
 * marcar el M2 como SUBMITTED. Usa `hoursFinal` como lectura acumulada actual
 * de cada motor (equivalente a runningHoursTotal del reporte diario):
 *   - bootstrap: si un plan HOURS/RUNNING_HOURS del asset no tiene nextDueHours,
 *     lo siembra (base = lastExecutionHours ?? hoursFinal) + frequencyHours.
 *   - avance: refresca windowOpenHours cuando la lectura se acerca al vencimiento.
 * Luego recalcula executionStatus de los planes del tenant (misma fn que el
 * reporte diario). Réplica de daily-report-integration-service (Steps 1-2).
 */
export async function integrateVoyageTankReportHours(
  session: TenantAccessSession,
  reportId: string,
): Promise<{ updatedRunningHoursCount: number; recalculatedPlansCount: number }> {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");

  const report = await prisma.voyageTankReport.findFirst({
    where: { id: reportId, tenantId: tenant.id, deletedAt: null },
    include: { engineHours: true },
  });
  if (!report) throw new RouteError(404, "NOT_FOUND", "Medición no encontrada.");

  const vesselCode = report.vesselCode;
  const engineRows = (report.engineHours ?? []) as Array<{ assetId: string | null; hoursFinal: number | null }>;
  let updatedRunningHoursCount = 0;

  for (const e of engineRows) {
    if (!e.assetId || e.hoursFinal == null) continue;
    const currentHours = e.hoursFinal;

    const plans = await (prisma as any).maintenancePlan.findMany({
      where: {
        tenantId: tenant.id,
        vesselCode,
        assetId: e.assetId,
        triggerType: { in: ["HOURS", "RUNNING_HOURS"] },
        deletedAt: null,
        status: { not: "INACTIVE" },
      },
    });

    for (const plan of plans) {
      if (!plan.frequencyHours || plan.frequencyHours <= 0) continue;
      const updates: Record<string, unknown> = {};

      if (plan.nextDueHours == null) {
        // Bootstrap: nunca se le seteó vencimiento por horas.
        const baseHours = plan.lastExecutionHours ?? currentHours;
        updates.nextDueHours = baseHours + plan.frequencyHours;
        updates.windowOpenHours = (baseHours + plan.frequencyHours) - plan.frequencyHours * 0.1;
      } else if (currentHours > plan.nextDueHours - plan.frequencyHours * 0.5) {
        // Se acerca al vencimiento: refrescar la apertura de ventana.
        updates.windowOpenHours = plan.nextDueHours - plan.frequencyHours * 0.1;
      }

      if (Object.keys(updates).length > 0) {
        await (prisma as any).maintenancePlan.update({ where: { id: plan.id }, data: updates });
        updatedRunningHoursCount++;
      }
    }
  }

  // Recalcular executionStatus del tenant con la lectura máxima (mismo patrón daily).
  const maxHours = engineRows.reduce<number | undefined>((m, e) => {
    if (e.hoursFinal == null) return m;
    return m == null || e.hoursFinal > m ? e.hoursFinal : m;
  }, undefined);

  let recalculatedPlansCount = 0;
  try {
    recalculatedPlansCount = await refreshExecutionStatuses(tenant.id, maxHours);
  } catch (err) {
    log.error("[voyage-tank integrate] refreshExecutionStatuses failed:", err);
  }

  return { updatedRunningHoursCount, recalculatedPlansCount };
}
