/**
 * Backfill de AssetHoursReading — pasa el historial de horómetros ya cargado a la
 * tabla única de lecturas.
 *
 * De dónde sale cada lectura:
 *   - DailyEquipmentHours (renglón de horas del Reporte Diario) con assetId y
 *     runningHoursTotal → source=DAILY_REPORT, readingDate = DailyReport.reportDate.
 *   - VoyageEngineHours (horómetros del M2) con assetId y hoursFinal →
 *     source=VOYAGE_TANK_REPORT, readingDate = dateEnd ?? reportDateTime ?? createdAt.
 *
 * Reglas:
 *   - Idempotente: upsert por (tenantId, assetId, readingDate, source). Re-correr no
 *     duplica ni pisa con valores menores.
 *   - Colisión dentro de la misma corrida (mismo equipo, misma fecha, mismo origen):
 *     gana el valor MAYOR (el horómetro sólo avanza; un valor menor el mismo día es
 *     casi siempre un renglón viejo del mismo reporte).
 *   - NO avanza planes de mantenimiento: es migración de historia, no carga nueva.
 *   - Corre sobre TODOS los tenants.
 *
 * Uso:
 *   DATABASE_URL=<url> npx tsx scripts/backfill-asset-hours-readings.ts
 *   DRY=1 ...        → sólo informa, no escribe
 *   TENANT_SLUG=...  → limitar a un tenant
 */
import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
} as any) as any;

const DRY = process.env.DRY === "1";
const ONLY_SLUG = process.env.TENANT_SLUG ?? null;

type Source = "DAILY_REPORT" | "VOYAGE_TANK_REPORT";

interface Candidate {
  tenantId: string;
  vesselCode: string;
  assetId: string;
  readingDate: Date;
  runningHours: number;
  source: Source;
  sourceRecordId: string;
  createdByUserId: string;
}

/** Normaliza cualquier fecha a medianoche UTC (la columna readingDate es @db.Date). */
function toDateOnly(value: Date | string): Date {
  const iso = value instanceof Date ? value.toISOString() : String(value);
  return new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
}

function keyOf(c: Candidate): string {
  return `${c.assetId}|${c.readingDate.toISOString().slice(0, 10)}|${c.source}`;
}

async function main() {
  const tenants = await prisma.tenant.findMany({
    where: ONLY_SLUG ? { slug: ONLY_SLUG } : {},
    select: { id: true, slug: true },
    orderBy: { slug: "asc" },
  }) as Array<{ id: string; slug: string }>;

  if (tenants.length === 0) throw new Error("No hay tenants que procesar.");

  console.log(`\n${DRY ? "[DRY] " : ""}Backfill de lecturas de horómetro — ${tenants.length} tenant(s)\n`);

  let grandTotal = 0;

  for (const tenant of tenants) {
    // Usuario al que se le atribuyen las lecturas sin autor conocido.
    const admin = await prisma.tenantMembership.findFirst({
      where: { tenantId: tenant.id, role: "TENANT_ADMIN" },
      select: { userId: true },
    }) as { userId: string } | null;

    const assets = await prisma.asset.findMany({
      where: { tenantId: tenant.id },
      select: { id: true, vesselCode: true, name: true },
    }) as Array<{ id: string; vesselCode: string; name: string }>;
    const assetMap = new Map(assets.map((a) => [a.id, a]));

    if (assets.length === 0) {
      console.log(`── ${tenant.slug}: sin equipos, se saltea`);
      continue;
    }

    const candidates: Candidate[] = [];

    // ── 1) Reporte Diario ────────────────────────────────────────────────────
    const dailyRows = await prisma.dailyEquipmentHours.findMany({
      where: { tenantId: tenant.id, assetId: { not: null }, runningHoursTotal: { not: null } },
      select: { assetId: true, runningHoursTotal: true, dailyReportId: true },
    }) as Array<{ assetId: string; runningHoursTotal: number; dailyReportId: string }>;

    const dailyReportIds = [...new Set(dailyRows.map((r) => r.dailyReportId))];
    const dailyReports = dailyReportIds.length > 0
      ? await prisma.dailyReport.findMany({
          where: { id: { in: dailyReportIds } },
          select: { id: true, reportDate: true, createdByUserId: true },
        }) as Array<{ id: string; reportDate: Date; createdByUserId: string | null }>
      : [];
    const reportMap = new Map(dailyReports.map((r) => [r.id, r]));

    for (const row of dailyRows) {
      const asset = assetMap.get(row.assetId);
      const report = reportMap.get(row.dailyReportId);
      if (!asset || !report?.reportDate) continue;
      const hours = Number(row.runningHoursTotal);
      if (!Number.isFinite(hours) || hours < 0) continue;
      const author = report.createdByUserId ?? admin?.userId;
      if (!author) continue;
      candidates.push({
        tenantId: tenant.id,
        vesselCode: asset.vesselCode,
        assetId: row.assetId,
        readingDate: toDateOnly(report.reportDate),
        runningHours: hours,
        source: "DAILY_REPORT",
        sourceRecordId: row.dailyReportId,
        createdByUserId: author,
      });
    }

    // ── 2) Medición de Tanques (M2) ──────────────────────────────────────────
    const engineRows = await prisma.voyageEngineHours.findMany({
      where: { tenantId: tenant.id, assetId: { not: null }, hoursFinal: { not: null } },
      select: { assetId: true, hoursFinal: true, voyageReportId: true },
    }) as Array<{ assetId: string; hoursFinal: number; voyageReportId: string }>;

    const voyageIds = [...new Set(engineRows.map((r) => r.voyageReportId))];
    const voyageReports = voyageIds.length > 0
      ? await prisma.voyageTankReport.findMany({
          where: { id: { in: voyageIds } },
          select: { id: true, dateEnd: true, reportDateTime: true, createdAt: true, createdByUserId: true },
        }) as Array<{
          id: string; dateEnd: Date | null; reportDateTime: Date | null;
          createdAt: Date; createdByUserId: string | null;
        }>
      : [];
    const voyageMap = new Map(voyageReports.map((r) => [r.id, r]));

    for (const row of engineRows) {
      const asset = assetMap.get(row.assetId);
      const report = voyageMap.get(row.voyageReportId);
      if (!asset || !report) continue;
      const hours = Number(row.hoursFinal);
      if (!Number.isFinite(hours) || hours < 0) continue;
      const author = report.createdByUserId ?? admin?.userId;
      if (!author) continue;
      candidates.push({
        tenantId: tenant.id,
        vesselCode: asset.vesselCode,
        assetId: row.assetId,
        readingDate: toDateOnly(report.dateEnd ?? report.reportDateTime ?? report.createdAt),
        runningHours: hours,
        source: "VOYAGE_TANK_REPORT",
        sourceRecordId: row.voyageReportId,
        createdByUserId: author,
      });
    }

    // ── 3) Deduplicar quedándose con el valor mayor ───────────────────────────
    const deduped = new Map<string, Candidate>();
    for (const candidate of candidates) {
      const key = keyOf(candidate);
      const existing = deduped.get(key);
      if (!existing || candidate.runningHours > existing.runningHours) deduped.set(key, candidate);
    }

    const before = await prisma.assetHoursReading.count({ where: { tenantId: tenant.id } });

    // ── 4) Escribir ──────────────────────────────────────────────────────────
    let written = 0;
    if (!DRY) {
      for (const candidate of deduped.values()) {
        const existing = await prisma.assetHoursReading.findUnique({
          where: {
            tenantId_assetId_readingDate_source: {
              tenantId: candidate.tenantId,
              assetId: candidate.assetId,
              readingDate: candidate.readingDate,
              source: candidate.source,
            },
          },
          select: { id: true, runningHours: true },
        }) as { id: string; runningHours: number } | null;

        if (existing) {
          // Re-corrida: sólo sube el valor si el histórico era mayor. Nunca lo baja
          // (una lectura manual posterior no se pisa con historia vieja).
          if (candidate.runningHours > Number(existing.runningHours)) {
            await prisma.assetHoursReading.update({
              where: { id: existing.id },
              data: { runningHours: candidate.runningHours },
            });
            written++;
          }
          continue;
        }

        await prisma.assetHoursReading.create({
          data: {
            tenantId: candidate.tenantId,
            vesselCode: candidate.vesselCode,
            assetId: candidate.assetId,
            readingDate: candidate.readingDate,
            runningHours: candidate.runningHours,
            source: candidate.source,
            sourceRecordId: candidate.sourceRecordId,
            createdByUserId: candidate.createdByUserId,
          },
        });
        written++;
      }
    }

    const after = DRY ? before : await prisma.assetHoursReading.count({ where: { tenantId: tenant.id } });
    grandTotal += written;

    const byVessel = new Map<string, number>();
    for (const candidate of deduped.values()) {
      byVessel.set(candidate.vesselCode, (byVessel.get(candidate.vesselCode) ?? 0) + 1);
    }

    console.log(`── ${tenant.slug}`);
    console.log(`   origen: ${dailyRows.length} renglones de reporte diario + ${engineRows.length} horómetros de M2`);
    console.log(`   lecturas únicas: ${deduped.size}   escritas: ${written}   tabla: ${before} → ${after}`);
    for (const [vessel, count] of [...byVessel].sort()) {
      console.log(`     ${vessel}: ${count}`);
    }

    // Control: horas actuales resultantes por equipo con seguimiento.
    const tracked = await prisma.asset.findMany({
      where: { tenantId: tenant.id, trackDailyReport: true, deletedAt: null },
      select: { id: true, name: true, vesselCode: true },
      orderBy: [{ vesselCode: "asc" }, { assetCode: "asc" }],
    }) as Array<{ id: string; name: string; vesselCode: string }>;

    if (tracked.length > 0) {
      console.log(`   horas actuales por equipo con seguimiento (${tracked.length}):`);
      for (const asset of tracked) {
        const last = await prisma.assetHoursReading.findFirst({
          where: { tenantId: tenant.id, assetId: asset.id },
          orderBy: [{ readingDate: "desc" }, { createdAt: "desc" }],
          select: { runningHours: true, readingDate: true, source: true },
        }) as { runningHours: number; readingDate: Date; source: string } | null;
        const detail = last
          ? `${Number(last.runningHours).toLocaleString("es-AR")} h  (${last.readingDate.toISOString().slice(0, 10)}, ${last.source})`
          : "sin lecturas";
        console.log(`     ${asset.vesselCode}  ${asset.name.padEnd(38).slice(0, 38)} ${detail}`);
      }
    }
    console.log("");
  }

  console.log(`${DRY ? "[DRY] " : ""}Total escrito: ${grandTotal} lectura(s).\n`);
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
