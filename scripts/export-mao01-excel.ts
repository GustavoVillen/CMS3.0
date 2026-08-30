/**
 * Exporta a Excel los Activos y Planes de Mantenimiento del MAO 01 (buque M01,
 * tenant mercurio) desde la base, con el GRUPO SFI (sin subgrupo).
 * Genera un .xlsx con dos hojas: "Activos" y "Planes de Mantenimiento".
 *
 * Uso:  DATABASE_URL=<url> npx tsx scripts/export-mao01-excel.ts [salida.xlsx]
 */
import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import ExcelJS from "exceljs";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
} as any) as any;

const SLUG = process.env.TENANT_SLUG ?? "mercurio";
const VESSEL = process.env.VESSEL_CODE ?? "M01";
const OUT = process.argv[2] ?? "MAO01_export.xlsx";

const GROUP_NAMES: Record<number, string> = {
  0: "Documentación", 1: "Casco", 2: "Equipo de Carga", 3: "Equipo de Manipulación de Carga",
  4: "Equipo de Barco", 5: "Equipo para Tripulación y Pasajeros", 6: "Componentes Principales",
  7: "Sistemas para Componentes Principales", 8: "Instalaciones Eléctricas", 9: "Automatización, Control y Monitoreo",
};

function groupOf(sfiCode: string | null | undefined): number | null {
  const d = (sfiCode ?? "").trim()[0];
  return /^[0-9]$/.test(d ?? "") ? Number(d) : null;
}
function groupLabel(g: number | null): string {
  return g == null ? "—" : `${g} - ${GROUP_NAMES[g] ?? ""}`;
}
function fmtDate(d: Date | null): string {
  if (!d) return "";
  const x = new Date(d);
  return `${String(x.getUTCDate()).padStart(2, "0")}/${String(x.getUTCMonth() + 1).padStart(2, "0")}/${x.getUTCFullYear()}`;
}
function fmtFreq(p: any): string {
  const tt = String(p.triggerType ?? "").toUpperCase();
  if (tt === "HOURS" || tt === "RUNNING_HOURS") return p.frequencyHours != null ? `${p.frequencyHours} h` : "";
  if (tt === "DAY") return p.frequencyMonths != null ? `${p.frequencyMonths} días` : "";
  if (tt === "WEEK") return p.frequencyMonths != null ? `${p.frequencyMonths} sem` : "";
  if (tt === "MONTHS" || tt === "CALENDAR") return p.frequencyMonths != null ? `${p.frequencyMonths} meses` : "";
  return "";
}
function fmtLast(p: any): string {
  if (p.lastExecutionDate) return fmtDate(p.lastExecutionDate);
  if (p.lastExecutionHours != null) return `${p.lastExecutionHours} h`;
  return "";
}
function fmtNext(p: any): string {
  if (p.nextDueDate) return fmtDate(p.nextDueDate);
  if (p.nextDueHours != null) return `${p.nextDueHours} h`;
  return "";
}

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: SLUG }, select: { id: true } });
  if (!tenant) throw new Error(`Tenant '${SLUG}' no encontrado.`);
  const tid: string = tenant.id;

  const assets = await prisma.asset.findMany({
    where: { tenantId: tid, vesselCode: VESSEL },
    orderBy: { assetCode: "asc" },
  });
  const assetById = new Map<string, any>(assets.map((a: any) => [a.id, a]));

  const plans = await prisma.maintenancePlan.findMany({
    where: { tenantId: tid, vesselCode: VESSEL },
    orderBy: { taskCode: "asc" },
  });

  const wb = new ExcelJS.Workbook();
  wb.creator = "CMS3.0";
  wb.created = new Date();

  // ── Hoja Activos ───────────────────────────────────────────────────────────
  const wsA = wb.addWorksheet("Activos");
  wsA.columns = [
    { header: "Código", key: "code", width: 18 },
    { header: "Nombre", key: "name", width: 42 },
    { header: "Grupo SFI", key: "grp", width: 34 },
    { header: "Código SFI", key: "sfi", width: 12 },
    { header: "Criticidad", key: "crit", width: 11 },
    { header: "Crítico Seguridad", key: "safety", width: 16 },
    { header: "Estado", key: "status", width: 16 },
    { header: "Fabricante", key: "mfr", width: 18 },
    { header: "Modelo", key: "model", width: 22 },
    { header: "N° Serie", key: "serial", width: 16 },
  ];
  for (const a of assets) {
    wsA.addRow({
      code: a.assetCode, name: a.name, grp: groupLabel(groupOf(a.sfiCode)), sfi: a.sfiCode ?? "",
      crit: a.criticality, safety: a.isSafetyCritical ? "Sí" : "No", status: a.status,
      mfr: a.manufacturer ?? "", model: a.model ?? "", serial: a.serialNumber ?? "",
    });
  }
  wsA.getRow(1).font = { bold: true };
  wsA.views = [{ state: "frozen", ySplit: 1 }];
  wsA.autoFilter = "A1:J1";

  // ── Hoja Planes ────────────────────────────────────────────────────────────
  const wsP = wb.addWorksheet("Planes de Mantenimiento");
  wsP.columns = [
    { header: "Código", key: "code", width: 18 },
    { header: "Equipo", key: "asset", width: 40 },
    { header: "Tarea", key: "title", width: 60 },
    { header: "Tipo", key: "type", width: 14 },
    { header: "Grupo SFI", key: "grp", width: 34 },
    { header: "Trigger", key: "trigger", width: 14 },
    { header: "Frecuencia", key: "freq", width: 14 },
    { header: "Horas estimadas", key: "est", width: 15 },
    { header: "Requiere OT", key: "ot", width: 12 },
    { header: "Responsable", key: "resp", width: 32 },
    { header: "Última ejecución", key: "last", width: 16 },
    { header: "Próximo vencimiento", key: "next", width: 18 },
    { header: "Estado", key: "status", width: 12 },
  ];
  for (const p of plans) {
    const asset = assetById.get(p.assetId);
    wsP.addRow({
      code: p.taskCode,
      asset: asset?.name ?? "",
      title: p.title,
      type: p.taskType === "INSPECTION" ? "Inspección" : "Mantenimiento",
      grp: groupLabel(p.sfiGroupNumber ?? groupOf(asset?.sfiCode)),
      trigger: p.triggerType,
      freq: fmtFreq(p),
      est: p.estimatedHours ?? "",
      ot: (p.triggerResultMode === "AUTO_WO" || p.triggerResultMode === "APPROVAL_WO") ? "Sí" : "No",
      resp: p.responsible ?? "",
      last: fmtLast(p),
      next: fmtNext(p),
      status: p.status,
    });
  }
  wsP.getRow(1).font = { bold: true };
  wsP.views = [{ state: "frozen", ySplit: 1 }];
  wsP.autoFilter = "A1:M1";

  await wb.xlsx.writeFile(OUT);
  console.log(`✅ Excel generado: ${OUT}  (${assets.length} activos · ${plans.length} planes)`);
}

main()
  .catch((e) => { console.error("❌ Error:", e?.message ?? e); process.exit(1); })
  .finally(() => prisma.$disconnect());
