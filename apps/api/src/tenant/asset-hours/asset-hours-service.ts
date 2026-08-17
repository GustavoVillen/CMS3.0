// ---------------------------------------------------------------------------
// Horas de equipos — ÚNICO dueño de las lecturas de horómetro.
// ---------------------------------------------------------------------------
// Antes las "horas actuales" de un equipo se deducían del último renglón de
// DailyEquipmentHours (Reporte Diario), con dos problemas:
//   1. El Reporte Diario está dormante: la carga viva de horómetros es el M2
//      (VoyageEngineHours), que escribía en otra tabla → las horas quedaban
//      congeladas y los planes por horas dejaban de vencer.
//   2. La "última" lectura se elegía por createdAt (cuándo se tipeó) y no por el
//      día al que corresponden las horas; como guardar un reporte borra y recrea
//      sus renglones, editar un reporte viejo pisaba las horas actuales.
//
// Ahora las tres vías de carga (planilla manual, M2 al enviarse, renglón del
// Reporte Diario) escriben AssetHoursReading por `recordHoursReadings`, y todo
// consumidor lee con `loadCurrentHoursByAsset`. DailyEquipmentHours y
// VoyageEngineHours siguen guardando lo suyo (consumos, horas del tramo).

import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { hasPermission } from "../auth/role-permissions";
import { applyAssignedVesselScope } from "../auth/vessel-scope";
import { publishAudit } from "../../platform/audit/audit-publisher";
import { log } from "../../common/logger";

type PrismaClientLike = NonNullable<ReturnType<typeof getPrismaClient>>;

export type HoursReadingSource = "MANUAL" | "VOYAGE_TANK_REPORT" | "DAILY_REPORT";

/** Prioridad cuando dos orígenes tienen lecturas del MISMO día para el mismo equipo:
 *  lo cargado a mano manda sobre lo automático. Se refleja en el ORDER BY de las
 *  consultas de "última lectura" (número más bajo = gana). */
const SOURCE_PRIORITY_SQL = `CASE "source"
  WHEN 'MANUAL' THEN 0
  WHEN 'VOYAGE_TANK_REPORT' THEN 1
  ELSE 2
END`;

export interface CurrentHours {
  runningHours: number;
  readingDate: string;   // YYYY-MM-DD
  source: HoursReadingSource;
}

interface CurrentHoursRow {
  assetId: string;
  runningHours: number;
  readingDate: Date;
  source: HoursReadingSource;
}

function toIsoDate(value: Date | string): string {
  if (typeof value === "string") return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

/** Parsea YYYY-MM-DD a Date en UTC medianoche (la columna es @db.Date). */
export function parseReadingDate(value: unknown, field = "readingDate"): Date {
  const text = String(value ?? "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (!match) {
    throw new RouteError(400, "VALIDATION_ERROR", `Fecha inválida en ${field} (se espera YYYY-MM-DD).`);
  }
  const parsed = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new RouteError(400, "VALIDATION_ERROR", `Fecha inválida en ${field}.`);
  }
  return parsed;
}

async function resolveTenantId(session: TenantAccessSession): Promise<string | null> {
  const prisma = getPrismaClient();
  if (!prisma) return null;
  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  return tenant?.id ?? null;
}

export function canWriteAssetHours(session: TenantAccessSession): boolean {
  return hasPermission(session, "assetHours.write");
}

export function ensureCanWriteAssetHours(session: TenantAccessSession): void {
  if (!canWriteAssetHours(session)) {
    throw new RouteError(403, "FORBIDDEN", "No autorizado para cargar horas de equipos.");
  }
}

// ---------------------------------------------------------------------------
// LECTURA — un solo lugar para "las horas actuales del equipo"
// ---------------------------------------------------------------------------

/**
 * Última lectura de horómetro por equipo. Reemplaza las copias del mismo query
 * que había en assets, maintenance-plans, plan-map, due-items y reliability.
 * Nunca tira: si la consulta falla devuelve el mapa vacío (el consumidor degrada
 * a "sin horas" en vez de romper la pantalla entera).
 */
export async function loadCurrentHoursByAsset(
  prisma: PrismaClientLike,
  tenantId: string,
  assetIds: string[],
): Promise<Map<string, CurrentHours>> {
  const map = new Map<string, CurrentHours>();
  const ids = [...new Set(assetIds.filter(Boolean))];
  if (ids.length === 0) return map;

  try {
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(", ");
    const tenantPlaceholder = `$${ids.length + 1}`;
    // ROW_NUMBER no tiene equivalente directo en el ORM. Scope de tenant explícito
    // (defense in depth) además del filtro por assetIds que ya viene scopeado.
    const rows = await prisma.$queryRawUnsafe<CurrentHoursRow[]>(
      `SELECT "assetId", "runningHours", "readingDate", "source"
       FROM (
         SELECT "assetId", "runningHours", "readingDate", "source",
                ROW_NUMBER() OVER (
                  PARTITION BY "assetId"
                  ORDER BY "readingDate" DESC, ${SOURCE_PRIORITY_SQL} ASC, "createdAt" DESC
                ) AS rn
         FROM "AssetHoursReading"
         WHERE "assetId" IN (${placeholders})
           AND "tenantId" = ${tenantPlaceholder}
       ) sub WHERE rn = 1`,
      ...ids, tenantId,
    );
    for (const row of rows) {
      map.set(row.assetId, {
        runningHours: Number(row.runningHours),
        readingDate: toIsoDate(row.readingDate),
        source: row.source,
      });
    }
  } catch (err) {
    log.error("[asset-hours] carga de horas actuales falló:", err);
  }
  return map;
}

/** Atajo para los consumidores que sólo necesitan el número. */
export async function loadCurrentHoursNumberByAsset(
  prisma: PrismaClientLike,
  tenantId: string,
  assetIds: string[],
): Promise<Map<string, number>> {
  const full = await loadCurrentHoursByAsset(prisma, tenantId, assetIds);
  const map = new Map<string, number>();
  for (const [assetId, current] of full) map.set(assetId, current.runningHours);
  return map;
}

/** Horas actuales de un solo equipo. */
export async function loadCurrentHoursForAsset(
  prisma: PrismaClientLike,
  tenantId: string,
  assetId: string,
): Promise<CurrentHours | null> {
  const map = await loadCurrentHoursByAsset(prisma, tenantId, [assetId]);
  return map.get(assetId) ?? null;
}

/**
 * Horas operadas por equipo en un período (delta entre la primera y la última
 * lectura del rango). Lo usa Confiabilidad para MTBF. Se filtra por readingDate
 * (el día real de la lectura), no por createdAt.
 */
export async function loadOperatingHoursDelta(
  prisma: PrismaClientLike,
  tenantId: string,
  assetIds: string[],
  from: Date,
  to: Date,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const ids = [...new Set(assetIds.filter(Boolean))];
  if (ids.length === 0) return map;

  try {
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(", ");
    const tenantPh = `$${ids.length + 1}`;
    const fromPh = `$${ids.length + 2}`;
    const toPh = `$${ids.length + 3}`;
    const rows = await prisma.$queryRawUnsafe<{ assetId: string; oph: number }[]>(
      `SELECT "assetId", (MAX("runningHours") - MIN("runningHours"))::float AS oph
       FROM "AssetHoursReading"
       WHERE "assetId" IN (${placeholders})
         AND "tenantId" = ${tenantPh}
         AND "readingDate" >= ${fromPh} AND "readingDate" <= ${toPh}
       GROUP BY "assetId"`,
      ...ids, tenantId, from, to,
    );
    for (const row of rows) {
      const value = Number(row.oph);
      if (Number.isFinite(value) && value > 0) map.set(row.assetId, value);
    }
  } catch (err) {
    log.error("[asset-hours] delta de horas operadas falló:", err);
  }
  return map;
}

// ---------------------------------------------------------------------------
// AVANCE DE PLANES POR HORAS
// ---------------------------------------------------------------------------

/**
 * Avanza los planes HOURS/RUNNING_HOURS de un equipo con la lectura recibida.
 * Es la lógica que estaba duplicada en daily-report-integration-service (Step 1)
 * y voyage-tank-reports-integration-service, movida acá SIN cambios de criterio:
 *   - bootstrap: plan sin nextDueHours → (lastExecutionHours ?? lectura) + frecuencia.
 *   - avance: refresca windowOpenHours cuando la lectura se acerca al vencimiento.
 * Devuelve cuántos planes se tocaron.
 */
export async function advanceHoursPlansForAsset(
  prisma: PrismaClientLike,
  tenantId: string,
  vesselCode: string,
  assetId: string,
  currentHours: number,
): Promise<number> {
  const plans = await (prisma as any).maintenancePlan.findMany({
    where: {
      tenantId,
      vesselCode,
      assetId,
      triggerType: { in: ["HOURS", "RUNNING_HOURS"] },
      deletedAt: null,
      status: { not: "INACTIVE" },
    },
  });

  let touched = 0;
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
      touched++;
    }
  }
  return touched;
}

// ---------------------------------------------------------------------------
// ESCRITURA — escritor único de lecturas
// ---------------------------------------------------------------------------

export interface HoursReadingInput {
  assetId: string;
  runningHours: number;
  /** YYYY-MM-DD. Si falta, la resuelve el llamador (planilla = fecha elegida). */
  readingDate: string | Date;
  note?: string | null;
}

export interface RecordReadingsOptions {
  source: HoursReadingSource;
  sourceRecordId?: string | null;
  /** Se salta el chequeo de permiso: para las vías automáticas (M2, reporte diario),
   *  donde el permiso ya lo validó la acción que las dispara. */
  skipPermissionCheck?: boolean;
  /** Cuando es false, la lectura NO avanza planes por horas (backfill). */
  advancePlans?: boolean;
}

export interface RecordReadingsResult {
  saved: number;
  plansTouched: number;
}

/**
 * Escritor único de lecturas. Idempotente por (tenant, equipo, fecha, origen):
 * recargar el mismo día por la misma vía actualiza el valor, no duplica.
 * No juzga si la lectura "baja": eso lo advierte la UI y, si el usuario confirma,
 * la lectura entra con `note`. Acá sólo se rechazan valores imposibles.
 */
export async function recordHoursReadings(
  session: TenantAccessSession,
  entries: HoursReadingInput[],
  options: RecordReadingsOptions,
): Promise<RecordReadingsResult> {
  if (!options.skipPermissionCheck) ensureCanWriteAssetHours(session);

  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const tenantId = await resolveTenantId(session);
  if (!tenantId) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");

  const clean = entries.filter((e) => e && e.assetId && e.runningHours != null);
  if (clean.length === 0) return { saved: 0, plansTouched: 0 };

  for (const entry of clean) {
    const hours = Number(entry.runningHours);
    if (!Number.isFinite(hours) || hours < 0) {
      throw new RouteError(400, "VALIDATION_ERROR", "Las horas deben ser un número mayor o igual a cero.");
    }
  }

  // Los equipos tienen que existir, ser del tenant y estar dentro del alcance de
  // buque del usuario. Sin esto, con un assetId ajeno se podían escribir horas de
  // otro buque del tenant.
  const assetIds = [...new Set(clean.map((e) => e.assetId))];
  const assetWhere: Record<string, unknown> = { id: { in: assetIds }, tenantId, deletedAt: null };
  applyAssignedVesselScope(session, assetWhere);
  const assets = await (prisma as any).asset.findMany({
    where: assetWhere,
    select: { id: true, vesselCode: true, name: true },
  }) as Array<{ id: string; vesselCode: string; name: string }>;

  const assetMap = new Map(assets.map((a) => [a.id, a]));
  const missing = assetIds.filter((id) => !assetMap.has(id));
  if (missing.length > 0) {
    throw new RouteError(403, "FORBIDDEN", "Hay equipos fuera de tu alcance o inexistentes.");
  }

  const advancePlans = options.advancePlans !== false;
  let saved = 0;
  let plansTouched = 0;

  for (const entry of clean) {
    const asset = assetMap.get(entry.assetId)!;
    const readingDate = entry.readingDate instanceof Date
      ? entry.readingDate
      : parseReadingDate(entry.readingDate);
    const runningHours = Number(entry.runningHours);
    const note = entry.note?.trim() || null;

    await (prisma as any).assetHoursReading.upsert({
      where: {
        tenantId_assetId_readingDate_source: {
          tenantId,
          assetId: entry.assetId,
          readingDate,
          source: options.source,
        },
      },
      create: {
        tenantId,
        vesselCode: asset.vesselCode,
        assetId: entry.assetId,
        readingDate,
        runningHours,
        source: options.source,
        sourceRecordId: options.sourceRecordId ?? null,
        note,
        createdByUserId: session.user.id,
      },
      update: {
        runningHours,
        note,
        sourceRecordId: options.sourceRecordId ?? null,
        updatedByUserId: session.user.id,
      },
    });
    saved++;

    if (advancePlans) {
      try {
        plansTouched += await advanceHoursPlansForAsset(
          prisma, tenantId, asset.vesselCode, entry.assetId, runningHours,
        );
      } catch (err) {
        // Una lectura guardada vale más que el avance del plan: si el avance
        // falla, la lectura queda igual y se registra el error.
        log.error("[asset-hours] avance de planes falló:", err);
      }
    }
  }

  void publishAudit(prisma, {
    tenantId,
    actorUserId: session.user.id,
    action: "AssetHours.recorded",
    entityType: "AssetHoursReading",
    entityId: clean[0]!.assetId,
    metadata: {
      source: options.source,
      sourceRecordId: options.sourceRecordId ?? null,
      count: saved,
      assets: clean.map((e) => ({ assetId: e.assetId, runningHours: Number(e.runningHours) })),
    },
  });

  return { saved, plansTouched };
}

// ---------------------------------------------------------------------------
// PLANILLA "HORAS DE EQUIPOS"
// ---------------------------------------------------------------------------

export interface HoursSheetRow {
  assetId: string;
  assetCode: string;
  assetName: string;
  sfiCode: string | null;
  vesselCode: string;
  trackDailyReport: boolean;
  lastReading: CurrentHours | null;
  /** Días entre la última lectura y hoy. Null si nunca se cargó. */
  daysSinceReading: number | null;
  /** Lectura ya cargada para la fecha pedida (para que la planilla venga rellena). */
  readingOnDate: { runningHours: number; source: HoursReadingSource; note: string | null } | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Planilla de un buque para una fecha: equipos con seguimiento de horas, su última
 * lectura y lo ya cargado para esa fecha. `includeUntracked` suma los equipos sin
 * seguimiento (para el botón "agregar equipo" de la pantalla).
 */
export async function listVesselHoursSheet(
  session: TenantAccessSession,
  params: { vesselCode: string; readingDate?: string | null; includeUntracked?: boolean },
): Promise<{ vesselCode: string; readingDate: string; canWrite: boolean; rows: HoursSheetRow[] }> {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const tenantId = await resolveTenantId(session);
  if (!tenantId) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");

  const vesselCode = String(params.vesselCode ?? "").trim();
  if (!vesselCode) throw new RouteError(400, "VALIDATION_ERROR", "Falta el buque.");

  const readingDate = params.readingDate
    ? parseReadingDate(params.readingDate)
    : parseReadingDate(new Date().toISOString().slice(0, 10));

  const where: Record<string, unknown> = { tenantId, deletedAt: null };
  applyAssignedVesselScope(session, where, vesselCode);
  if (!params.includeUntracked) where.trackDailyReport = true;

  const assets = await (prisma as any).asset.findMany({
    where,
    select: {
      id: true, assetCode: true, name: true, sfiCode: true,
      vesselCode: true, trackDailyReport: true,
    },
    orderBy: [{ assetCode: "asc" }],
  }) as Array<{
    id: string; assetCode: string; name: string; sfiCode: string | null;
    vesselCode: string; trackDailyReport: boolean;
  }>;

  const assetIds = assets.map((a) => a.id);
  const [currentMap, onDateRows] = await Promise.all([
    loadCurrentHoursByAsset(prisma, tenantId, assetIds),
    assetIds.length > 0
      ? (prisma as any).assetHoursReading.findMany({
          where: { tenantId, assetId: { in: assetIds }, readingDate },
          select: { assetId: true, runningHours: true, source: true, note: true, createdAt: true },
        }) as Promise<Array<{
          assetId: string; runningHours: number; source: HoursReadingSource;
          note: string | null; createdAt: Date;
        }>>
      : Promise.resolve([]),
  ]);

  // Si hay más de un origen para la misma fecha, se muestra el de mayor prioridad
  // (manual > M2 > reporte diario) — el mismo criterio que "última lectura".
  const priority: Record<HoursReadingSource, number> = {
    MANUAL: 0, VOYAGE_TANK_REPORT: 1, DAILY_REPORT: 2,
  };
  const onDateMap = new Map<string, { runningHours: number; source: HoursReadingSource; note: string | null }>();
  for (const row of [...onDateRows].sort((a, b) =>
    priority[a.source] - priority[b.source] || b.createdAt.getTime() - a.createdAt.getTime()
  )) {
    if (!onDateMap.has(row.assetId)) {
      onDateMap.set(row.assetId, {
        runningHours: Number(row.runningHours),
        source: row.source,
        note: row.note,
      });
    }
  }

  const todayMs = parseReadingDate(new Date().toISOString().slice(0, 10)).getTime();

  const rows: HoursSheetRow[] = assets.map((asset) => {
    const lastReading = currentMap.get(asset.id) ?? null;
    let daysSinceReading: number | null = null;
    if (lastReading) {
      const diff = todayMs - parseReadingDate(lastReading.readingDate).getTime();
      daysSinceReading = Math.max(0, Math.round(diff / DAY_MS));
    }
    return {
      assetId: asset.id,
      assetCode: asset.assetCode,
      assetName: asset.name,
      sfiCode: asset.sfiCode,
      vesselCode: asset.vesselCode,
      trackDailyReport: asset.trackDailyReport,
      lastReading,
      daysSinceReading,
      readingOnDate: onDateMap.get(asset.id) ?? null,
    };
  });

  return {
    vesselCode,
    readingDate: toIsoDate(readingDate),
    canWrite: canWriteAssetHours(session),
    rows,
  };
}

export interface HoursHistoryEntry {
  id: string;
  readingDate: string;
  runningHours: number;
  source: HoursReadingSource;
  note: string | null;
  createdAt: string;
  createdByUserId: string;
  createdByName: string | null;
}

/** Historial de lecturas de un equipo (para auditar de dónde salió cada horómetro). */
export async function getAssetHoursHistory(
  session: TenantAccessSession,
  assetId: string,
  limit = 60,
): Promise<{ assetId: string; assetName: string; entries: HoursHistoryEntry[] }> {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const tenantId = await resolveTenantId(session);
  if (!tenantId) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");

  const assetWhere: Record<string, unknown> = { id: assetId, tenantId, deletedAt: null };
  applyAssignedVesselScope(session, assetWhere);
  const asset = await (prisma as any).asset.findFirst({
    where: assetWhere,
    select: { id: true, name: true },
  }) as { id: string; name: string } | null;
  if (!asset) throw new RouteError(404, "NOT_FOUND", "Equipo no encontrado.");

  const rows = await (prisma as any).assetHoursReading.findMany({
    where: { tenantId, assetId },
    orderBy: [{ readingDate: "desc" }, { createdAt: "desc" }],
    take: Math.min(Math.max(limit, 1), 200),
  }) as Array<{
    id: string; readingDate: Date; runningHours: number; source: HoursReadingSource;
    note: string | null; createdAt: Date; createdByUserId: string;
  }>;

  const userIds = [...new Set(rows.map((r) => r.createdByUserId).filter(Boolean))];
  const users = userIds.length > 0
    ? await (prisma as any).user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, firstName: true, lastName: true, formName: true },
      }) as Array<{ id: string; firstName: string | null; lastName: string | null; formName: string | null }>
    : [];
  const userMap = new Map(users.map((u) => [
    u.id,
    u.formName?.trim() || [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || null,
  ]));

  return {
    assetId: asset.id,
    assetName: asset.name,
    entries: rows.map((r) => ({
      id: r.id,
      readingDate: toIsoDate(r.readingDate),
      runningHours: Number(r.runningHours),
      source: r.source,
      note: r.note,
      createdAt: r.createdAt.toISOString(),
      createdByUserId: r.createdByUserId,
      createdByName: userMap.get(r.createdByUserId) ?? null,
    })),
  };
}
