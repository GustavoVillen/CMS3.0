/**
 * DON CHICUETO — pone al día el estado de los planes con la planilla de AGOSTO 2026.
 *
 * La planilla del buque (`08- PMP DON CHICUETO - AGOSTO.xlsm`, cierre 31/08/2026)
 * no sólo dice qué tareas existen: trae el ÚLTIMO y el PRÓXIMO trabajo de cada
 * una. Los planes del sistema venían con el estado de la carga anterior
 * (junio/julio), así que en pantalla todo aparecía corrido un par de meses.
 *
 * Este script sincroniza ese estado. El emparejamiento planilla ↔ plan se hizo
 * aparte (por equipo y tarea, anclando cada solapa de motor a su equipo) y quedó
 * congelado en `scripts/data/dch-agosto-2026-estado.json`, que es la entrada:
 * así lo que se aplica es auditable y se puede volver a correr igual.
 *
 * Dos reglas de seguridad:
 *   - NUNCA retrocede. Si el sistema tiene una fecha (u hora) más nueva que la
 *     planilla —porque se cerró una OT después del 31/08— se deja como está y se
 *     lista aparte. La planilla es de papel; una OT cerrada es evidencia.
 *   - No mezcla unidades: un plan que vence por horas sólo se toca con horas, y
 *     uno que vence por fecha sólo con fechas. Lo que no coincide se reporta.
 *
 * Además carga las lecturas de horómetro de los cinco motores al 31/08/2026
 * (MANUAL, idempotente por el unique de AssetHoursReading).
 *
 * Uso:
 *   pnpm exec tsx --env-file .env scripts/sync-dch-agosto-2026.ts
 *   DRY=1 ...   lista todo lo que cambiaría, sin escribir
 */
import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { readFileSync, writeFileSync } from "node:fs";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
} as any) as any;

const SLUG = process.env.TENANT_SLUG ?? "mercurio";
const VESSEL = "DCH";
const DRY = process.env.DRY === "1";
const FUENTE = "scripts/data/dch-agosto-2026-estado.json";
const CIERRE = new Date("2026-08-31T00:00:00.000Z"); // fecha de cierre de la planilla

type Entrada = {
  taskCode: string;
  tipo: "FECHA" | "HORAS";
  ultimo: string | number | null;
  proximo: string | number;
  hoja: string;
  trabajo: string;
};

const d = (s: string | null) => (s ? new Date(`${s}T00:00:00.000Z`) : null);
const iso = (v: Date | null) => (v ? String(v.toISOString()).slice(0, 10) : "-");

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: SLUG }, select: { id: true } });
  if (!tenant) throw new Error(`Tenant ${SLUG} no encontrado.`);
  const tenantId: string = tenant.id;

  const member = await prisma.tenantMembership.findFirst({
    where: { tenantId, role: "TENANT_ADMIN" },
    select: { userId: true },
  });
  if (!member?.userId) throw new Error(`No hay TENANT_ADMIN en ${SLUG}.`);
  const userId: string = member.userId;

  const doc = JSON.parse(readFileSync(FUENTE, "utf8")) as {
    fuente: string;
    horometros: Record<string, number>;
    planes: Entrada[];
  };

  const plans = await prisma.maintenancePlan.findMany({
    where: { tenantId, vesselCode: VESSEL, deletedAt: null },
    select: {
      id: true, taskCode: true, title: true, triggerType: true,
      lastExecutionDate: true, nextDueDate: true,
      lastExecutionHours: true, nextDueHours: true,
    },
  });
  const byCode = new Map<string, any>(plans.map((p: any) => [p.taskCode, p]));

  const cambios: any[] = [];
  const adelantados: any[] = [];
  const desajustes: any[] = [];
  const ausentes: string[] = [];
  let iguales = 0;

  for (const e of doc.planes) {
    const p = byCode.get(e.taskCode);
    if (!p) { ausentes.push(e.taskCode); continue; }

    if (e.tipo === "HORAS") {
      if (p.triggerType !== "HOURS") { desajustes.push({ e, p, por: "el plan vence por fecha" }); continue; }
      // Un 0 en la columna "último trabajo" de la planilla significa "nunca se
      // hizo", no "se hizo a las 0 horas": se deja la última ejecución como está.
      const bruto = Number(e.ultimo);
      const ult = bruto === 0 ? null : bruto;
      const pro = Number(e.proximo);
      if (ult != null && p.lastExecutionHours != null && p.lastExecutionHours > ult) {
        adelantados.push({ e, p, sis: `${p.lastExecutionHours} hs`, pla: `${ult} hs` });
        continue;
      }
      const nuevoUlt = ult ?? p.lastExecutionHours ?? null;
      if (p.lastExecutionHours === nuevoUlt && p.nextDueHours === pro) { iguales++; continue; }
      cambios.push({
        id: p.id, taskCode: p.taskCode, hoja: e.hoja, trabajo: e.trabajo, unidad: "hs",
        de: `${p.lastExecutionHours ?? "-"} → ${p.nextDueHours ?? "-"}`,
        a: `${nuevoUlt ?? "-"} → ${pro}`,
        data: { lastExecutionHours: nuevoUlt, nextDueHours: pro, updatedByUserId: userId },
      });
    } else {
      if (p.triggerType !== "MONTHS") { desajustes.push({ e, p, por: "el plan vence por horas" }); continue; }
      const ult = d(e.ultimo as string), pro = d(e.proximo as string)!;
      // Se compara por día, no por instante: hay fechas guardadas con hora
      // (12:00) que si no serían "más nuevas" que el mismo día a medianoche.
      if (p.lastExecutionDate && ult && iso(p.lastExecutionDate) > iso(ult)) {
        adelantados.push({ e, p, sis: iso(p.lastExecutionDate), pla: iso(ult) });
        continue;
      }
      const igualUlt = iso(p.lastExecutionDate) === iso(ult);
      const igualPro = iso(p.nextDueDate) === iso(pro);
      if (igualUlt && igualPro) { iguales++; continue; }
      cambios.push({
        id: p.id, taskCode: p.taskCode, hoja: e.hoja, trabajo: e.trabajo, unidad: "fecha",
        de: `${iso(p.lastExecutionDate)} → ${iso(p.nextDueDate)}`,
        a: `${iso(ult)} → ${iso(pro)}`,
        data: { lastExecutionDate: ult, nextDueDate: pro, updatedByUserId: userId },
      });
    }
  }

  // Horómetros de los cinco motores al cierre de la planilla.
  const motores = await prisma.asset.findMany({
    where: { tenantId, vesselCode: VESSEL, assetCode: { in: Object.keys(doc.horometros) } },
    select: { id: true, assetCode: true, name: true },
  });
  const lecturas: any[] = [];
  for (const a of motores) {
    const hs = doc.horometros[a.assetCode];
    const previa = await prisma.assetHoursReading.findFirst({
      where: { tenantId, assetId: a.id, readingDate: { lte: CIERRE } },
      orderBy: { readingDate: "desc" },
      select: { readingDate: true, runningHours: true },
    });
    if (previa && previa.runningHours > hs) {
      adelantados.push({ e: { taskCode: `horómetro ${a.assetCode}`, hoja: "horas", trabajo: a.name },
        p: {}, sis: `${previa.runningHours} hs (${iso(previa.readingDate)})`, pla: `${hs} hs` });
      continue;
    }
    lecturas.push({ assetId: a.id, assetCode: a.assetCode, name: a.name, hs,
      previa: previa ? `${previa.runningHours} hs (${iso(previa.readingDate)})` : "sin lectura previa" });
  }

  console.log("── DON CHICUETO · estado según la planilla de agosto 2026 ──");
  console.log(`Fuente: ${doc.fuente}\n`);
  console.log(`Renglones en el archivo: ${doc.planes.length}`);
  console.log(`  ya coincidían:        ${iguales}`);
  console.log(`  se actualizan:        ${cambios.length}`);
  console.log(`  sistema más nuevo:    ${adelantados.length}  (no se tocan)`);
  console.log(`  unidad que no encaja: ${desajustes.length}`);
  console.log(`  plan inexistente:     ${ausentes.length}`);
  console.log(`Lecturas de horómetro a cargar: ${lecturas.length}\n`);

  if (adelantados.length) {
    console.log("── El sistema tiene algo MÁS NUEVO que la planilla (se respeta) ──");
    for (const a of adelantados) console.log(`  ${a.e.taskCode.padEnd(20)}${String(a.e.trabajo).slice(0, 44).padEnd(46)}sistema ${a.sis}  ·  planilla ${a.pla}`);
    console.log();
  }
  if (desajustes.length) {
    console.log("── Unidad que no encaja (se saltean) ──");
    for (const x of desajustes) console.log(`  ${x.e.taskCode.padEnd(20)}${String(x.e.trabajo).slice(0, 44).padEnd(46)}${x.por}`);
    console.log();
  }
  if (ausentes.length) {
    console.log(`── Sin plan en el sistema: ${ausentes.join(", ")}\n`);
  }

  console.log("── Lecturas de horómetro (31/08/2026) ──");
  for (const l of lecturas) console.log(`  ${l.assetCode.padEnd(14)}${String(l.name).slice(0, 32).padEnd(34)}${l.previa}  →  ${l.hs} hs`);

  console.log(`\n── Planes que cambian (${cambios.length}) ──`);
  for (const c of cambios) {
    console.log(`  ${c.taskCode.padEnd(20)}${String(c.trabajo).slice(0, 42).padEnd(44)}${c.unidad.padEnd(6)}${c.de.padEnd(26)} →  ${c.a}`);
  }

  if (DRY) {
    console.log("\n[DRY] No se escribió nada.");
    return;
  }

  const respaldo = "scripts/_tmp-backup-dch-estado-previo.json";
  writeFileSync(respaldo, JSON.stringify(
    cambios.map(c => ({ taskCode: c.taskCode, antes: c.de })), null, 1), "utf8");

  for (const c of cambios) await prisma.maintenancePlan.update({ where: { id: c.id }, data: c.data });

  for (const l of lecturas) {
    await prisma.assetHoursReading.upsert({
      where: { tenantId_assetId_readingDate_source: { tenantId, assetId: l.assetId, readingDate: CIERRE, source: "MANUAL" } },
      update: { runningHours: l.hs, note: "Cierre de la planilla PMP de agosto 2026", updatedByUserId: userId },
      create: {
        tenantId, vesselCode: VESSEL, assetId: l.assetId, readingDate: CIERRE, runningHours: l.hs,
        source: "MANUAL", note: "Cierre de la planilla PMP de agosto 2026", createdByUserId: userId,
      },
    });
  }

  console.log(`\nOK — ${cambios.length} planes actualizados, ${lecturas.length} lecturas de horómetro cargadas.`);
  console.log(`Respaldo del estado previo: ${respaldo}`);
}

main()
  .catch(e => {
    console.error("ERROR:", e.message ?? e);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
