/**
 * READ-ONLY — Genera la planilla de revisión para alinear el Plan de Mantenimiento
 * del MAO 01 (M01) con el del MAO 02 (M02), que es el válido.
 *
 * NO escribe nada en la base. Produce un .xlsx con cuatro hojas:
 *   1. "Titulos a cambiar"  — 1 fila por plan emparejado con título distinto.
 *                             Columna APLICAR: SI/NO (default SI) → la revisa el usuario.
 *   2. "Planes a desactivar"— los que sólo existen en M01. Misma columna APLICAR.
 *   3. "Otros cambios"      — frecuencia distinta y planes faltantes en M01.
 *   4. "Resumen"            — conteos e impacto (OT/worklogs ligados).
 *
 * El emparejamiento es por SUFIJO de taskCode (M01-ALT-BR-02 ↔ M02-ALT-BR-02),
 * no por título: los títulos son justamente lo que difiere. Ojo que el código
 * NO es garantía de que sea la misma tarea (ej. COCINA-01 apunta a tareas
 * distintas en cada buque) — por eso esta planilla se revisa a mano.
 *
 * Uso:  DATABASE_URL=<url> npx tsx scripts/review-m01-vs-m02.ts [salida.xlsx]
 */
import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import ExcelJS from "exceljs";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
} as any) as any;

const SLUG = process.env.TENANT_SLUG ?? "mercurio";
const SRC = process.env.SRC_VESSEL ?? "M02"; // el válido
const DST = process.env.DST_VESSEL ?? "M01"; // el que se corrige
const OUT = process.argv[2] ?? "Revision_MAO01_vs_MAO02.xlsx";

/** Quita el prefijo de buque para emparejar la misma tarea entre buques. */
const suffix = (code: string) => code.replace(/^M0\d[-_]?/i, "").trim().toUpperCase();
const same = (a: string | null, b: string | null) =>
  (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

/** Frecuencia legible, para que la planilla se entienda sin saber el modelo. */
function freqLabel(p: any): string {
  switch (p.triggerType) {
    case "HOURS": case "RUNNING_HOURS": return `cada ${p.frequencyHours ?? "?"} h`;
    case "MONTHS": case "CALENDAR":     return `cada ${p.frequencyMonths ?? "?"} meses`;
    case "DAY":                          return "diaria";
    case "WEEK":                         return "semanal";
    case "EVENT":                        return "por evento";
    case "CONDITION":                    return "por condición";
    default:                             return String(p.triggerType);
  }
}

async function loadPlans(tenantId: string, vesselCode: string) {
  const plans = await prisma.maintenancePlan.findMany({
    where: { tenantId, vesselCode },
    select: {
      id: true, taskCode: true, title: true, description: true, assetId: true,
      triggerType: true, frequencyHours: true, frequencyMonths: true, status: true,
      lastExecutionDate: true, nextDueDate: true,
    },
  });
  const assets = await prisma.asset.findMany({
    where: { id: { in: [...new Set(plans.map((p: any) => p.assetId))] } },
    select: { id: true, name: true },
  });
  const nameOf = new Map(assets.map((a: any) => [a.id, a.name]));
  return plans.map((p: any) => ({ ...p, assetName: nameOf.get(p.assetId) ?? "(sin equipo)" }));
}

function styleHeader(ws: ExcelJS.Worksheet) {
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF7" } };
  ws.views = [{ state: "frozen", ySplit: 1 }];
}

async function main() {
  const tenant = await prisma.tenant.findFirst({ where: { slug: SLUG }, select: { id: true } });
  if (!tenant) throw new Error(`No existe el tenant ${SLUG}`);

  const [valid, target] = await Promise.all([
    loadPlans(tenant.id, SRC),
    loadPlans(tenant.id, DST),
  ]);

  const bySuffixValid = new Map(valid.map((p: any) => [suffix(p.taskCode), p]));
  const bySuffixTarget = new Map(target.map((p: any) => [suffix(p.taskCode), p]));

  const matched = target.filter((p: any) => bySuffixValid.has(suffix(p.taskCode)));
  const onlyTarget = target.filter((p: any) => !bySuffixValid.has(suffix(p.taskCode)));
  const onlyValid = valid.filter((p: any) => !bySuffixTarget.has(suffix(p.taskCode)));

  const titleChanges = matched
    .map((p: any) => ({ dst: p, src: bySuffixValid.get(suffix(p.taskCode)) }))
    .filter(({ dst, src }: any) => !same(dst.title, src.title));

  const freqChanges = matched
    .map((p: any) => ({ dst: p, src: bySuffixValid.get(suffix(p.taskCode)) }))
    .filter(({ dst, src }: any) =>
      dst.triggerType !== src.triggerType ||
      dst.frequencyHours !== src.frequencyHours ||
      dst.frequencyMonths !== src.frequencyMonths);

  // Cuántas OT cuelgan de cada plan que se propone desactivar: es el dato que
  // dice si desactivarlo deja trabajo real sin su tarea de origen.
  const idsOnlyTarget = onlyTarget.map((p: any) => p.id);
  const woByPlan = idsOnlyTarget.length
    ? await prisma.workOrder.groupBy({
        by: ["maintenancePlanId"],
        where: { tenantId: tenant.id, maintenancePlanId: { in: idsOnlyTarget } },
        _count: { _all: true },
      })
    : [];
  const woCount = new Map(woByPlan.map((w: any) => [w.maintenancePlanId, w._count._all]));

  const allTargetIds = target.map((p: any) => p.id);
  const [woLinked, woTotal, logLinked] = await Promise.all([
    prisma.workOrder.count({ where: { tenantId: tenant.id, maintenancePlanId: { in: allTargetIds } } }),
    prisma.workOrder.count({ where: { tenantId: tenant.id, vesselCode: DST } }),
    prisma.workLog.count({ where: { maintenancePlanId: { in: allTargetIds } } }),
  ]);

  const wb = new ExcelJS.Workbook();
  const fmtDate = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : "");

  // ── Hoja 1: títulos ────────────────────────────────────────────────────────
  const ws1 = wb.addWorksheet("Titulos a cambiar");
  ws1.columns = [
    { header: "APLICAR (SI/NO)", key: "aplicar", width: 16 },
    { header: "Equipo", key: "equipo", width: 42 },
    { header: "Código", key: "cod", width: 22 },
    { header: `Título actual (${DST})`, key: "actual", width: 60 },
    { header: `Título nuevo (${SRC})`, key: "nuevo", width: 60 },
    { header: "Frecuencia", key: "freq", width: 18 },
    { header: "Última ejecución", key: "ult", width: 16 },
    { header: "¿Se parecen?", key: "similar", width: 14 },
  ];
  for (const { dst, src } of titleChanges) {
    // Heurística sólo informativa: si no comparten ninguna palabra larga, es
    // candidato a que el código se haya reusado para otra tarea (caso COCINA-01).
    const words = (s: string) => new Set((s.toLowerCase().match(/[a-záéíóúñ]{5,}/g) ?? []));
    const wa = words(dst.title), wbb = words(src.title);
    const shared = [...wa].filter(w => wbb.has(w)).length;
    ws1.addRow({
      aplicar: "SI", equipo: dst.assetName, cod: dst.taskCode,
      actual: dst.title, nuevo: src.title, freq: freqLabel(dst),
      ult: fmtDate(dst.lastExecutionDate),
      similar: shared > 0 ? "sí" : "REVISAR",
    });
  }
  ws1.eachRow((row, i) => {
    if (i > 1 && row.getCell("similar").value === "REVISAR") {
      row.getCell("similar").font = { bold: true, color: { argb: "FFB00020" } };
      row.getCell("actual").font = { color: { argb: "FFB00020" } };
      row.getCell("nuevo").font = { color: { argb: "FFB00020" } };
    }
  });
  styleHeader(ws1);

  // ── Hoja 2: desactivaciones ────────────────────────────────────────────────
  const ws2 = wb.addWorksheet("Planes a desactivar");
  ws2.columns = [
    { header: "APLICAR (SI/NO)", key: "aplicar", width: 16 },
    { header: "Equipo", key: "equipo", width: 42 },
    { header: "Código", key: "cod", width: 22 },
    { header: "Tarea", key: "tarea", width: 70 },
    { header: "Frecuencia", key: "freq", width: 18 },
    { header: "Última ejecución", key: "ult", width: 16 },
    { header: "Próximo vencimiento", key: "prox", width: 18 },
    { header: "OT asociadas", key: "ot", width: 14 },
  ];
  for (const p of onlyTarget) {
    ws2.addRow({
      aplicar: "SI", equipo: p.assetName, cod: p.taskCode, tarea: p.title,
      freq: freqLabel(p), ult: fmtDate(p.lastExecutionDate), prox: fmtDate(p.nextDueDate),
      ot: woCount.get(p.id) ?? 0,
    });
  }
  // Resaltar los que tienen historial real: desactivarlos saca del plan una
  // tarea que a bordo se viene ejecutando.
  ws2.eachRow((row, i) => {
    if (i > 1 && row.getCell("ult").value) {
      row.getCell("ult").font = { bold: true, color: { argb: "FFB00020" } };
    }
  });
  styleHeader(ws2);

  // ── Hoja 3: otros cambios ──────────────────────────────────────────────────
  const ws3 = wb.addWorksheet("Otros cambios");
  ws3.columns = [
    { header: "APLICAR (SI/NO)", key: "aplicar", width: 16 },
    { header: "Tipo", key: "tipo", width: 22 },
    { header: "Equipo", key: "equipo", width: 42 },
    { header: "Código", key: "cod", width: 22 },
    { header: "Tarea", key: "tarea", width: 60 },
    { header: `Actual (${DST})`, key: "actual", width: 24 },
    { header: `Debería ser (${SRC})`, key: "nuevo", width: 24 },
  ];
  for (const { dst, src } of freqChanges) {
    ws3.addRow({
      aplicar: "SI", tipo: "Cambio de frecuencia", equipo: dst.assetName,
      cod: dst.taskCode, tarea: dst.title, actual: freqLabel(dst), nuevo: freqLabel(src),
    });
  }
  for (const p of onlyValid) {
    ws3.addRow({
      aplicar: "SI", tipo: `Falta en ${DST} — dar de alta`, equipo: p.assetName,
      cod: p.taskCode, tarea: p.title, actual: "(no existe)", nuevo: freqLabel(p),
    });
  }
  styleHeader(ws3);

  // ── Hoja 4: resumen ────────────────────────────────────────────────────────
  const ws4 = wb.addWorksheet("Resumen");
  ws4.columns = [{ header: "Concepto", key: "k", width: 58 }, { header: "Valor", key: "v", width: 16 }];
  const rows: Array<[string, string | number]> = [
    [`Planes en ${DST} (a corregir)`, target.length],
    [`Planes en ${SRC} (el válido)`, valid.length],
    ["Planes emparejados por código", matched.length],
    ["→ con título distinto (hoja 1)", titleChanges.length],
    ["→ con frecuencia distinta (hoja 3)", freqChanges.length],
    [`Sólo en ${DST} — a desactivar (hoja 2)`, onlyTarget.length],
    ["→ de esos, con historial de ejecución", onlyTarget.filter((p: any) => p.lastExecutionDate).length],
    ["→ de esos, con OT asociadas", onlyTarget.filter((p: any) => (woCount.get(p.id) ?? 0) > 0).length],
    [`Sólo en ${SRC} — a dar de alta (hoja 3)`, onlyValid.length],
    ["", ""],
    [`OT totales de ${DST}`, woTotal],
    ["OT ligadas a planes (NO se tocan)", woLinked],
    ["Registros de trabajo ligados (NO se tocan)", logLinked],
  ];
  for (const [k, v] of rows) ws4.addRow({ k, v });
  styleHeader(ws4);

  await wb.xlsx.writeFile(OUT);
  console.log(`✅ ${OUT}`);
  console.log(`   Títulos a cambiar: ${titleChanges.length}`);
  console.log(`   Planes a desactivar: ${onlyTarget.length} (${onlyTarget.filter((p: any) => p.lastExecutionDate).length} con historial)`);
  console.log(`   Otros cambios: ${freqChanges.length + onlyValid.length}`);
  await prisma.$disconnect();
}

main().catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1); });
