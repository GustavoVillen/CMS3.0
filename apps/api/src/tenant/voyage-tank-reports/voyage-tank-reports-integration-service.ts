// Voyage Tank Report (Formulario M2) — carga full + upsert de hijos.
// Patrón delete-all-then-recreate espejo de daily-report-integration-service.ts.
// Sin integración PMS (no avanza planes ni WorkLogs): es un documento standalone.

import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { refreshExecutionStatuses } from "../pms/execution-windows-service";
import { log } from "../../common/logger";
import { recordHoursReadings } from "../asset-hours/asset-hours-service";

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
 * Integra los horómetros del M2 al PMS al marcarlo SUBMITTED. `hoursFinal` es la
 * lectura acumulada de cada motor: se asienta como AssetHoursReading (única fuente
 * de "horas actuales" del equipo) por el escritor de tenant/asset-hours, que además
 * avanza los planes HOURS/RUNNING_HOURS del equipo. Después recalcula el
 * executionStatus de los planes del tenant.
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

  const engineRows = (report.engineHours ?? []) as Array<{ assetId: string | null; hoursFinal: number | null }>;

  // Las horas finales del M2 se registran como lecturas de horómetro: son la fuente
  // viva de "horas actuales" del equipo (el Reporte Diario está dormante). El escritor
  // único también avanza los planes por horas, así que no se duplica esa lógica acá.
  const readingDate = (report.dateEnd ?? report.reportDateTime ?? report.createdAt)
    .toISOString().slice(0, 10);

  let updatedRunningHoursCount = 0;
  try {
    const result = await recordHoursReadings(
      session,
      engineRows
        .filter((e) => e.assetId && e.hoursFinal != null)
        .map((e) => ({ assetId: e.assetId!, runningHours: e.hoursFinal!, readingDate })),
      {
        source: "VOYAGE_TANK_REPORT",
        sourceRecordId: reportId,
        // El permiso ya lo validó el envío del M2; quien puede enviarlo puede
        // asentar sus horómetros.
        skipPermissionCheck: true,
      },
    );
    updatedRunningHoursCount = result.plansTouched;
  } catch (err) {
    log.error("[voyage-tank integrate] registro de horómetros falló:", err);
  }

  // Recalcular executionStatus del tenant con la lectura máxima (mismo patrón daily).
  const maxHours = engineRows.reduce<number | undefined>((m, e) => {
    if (e.hoursFinal == null) return m;
    return m == null || e.hoursFinal > m ? e.hoursFinal : m;
  }, undefined);

  let recalculatedPlansCount = 0;
  try {
    recalculatedPlansCount = await refreshExecutionStatuses(tenant.id, maxHours, report.vesselCode);
  } catch (err) {
    log.error("[voyage-tank integrate] refreshExecutionStatuses failed:", err);
  }

  return { updatedRunningHoursCount, recalculatedPlansCount };
}
