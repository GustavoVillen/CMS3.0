/**
 * Actualiza ULTIMA EJECUCION y PROXIMO VENCIMIENTO de los planes de DON CHICUETO (DCH)
 * segun las planillas de papel "R/E DON CHICUETO - MANTENIMIENTO PROGRAMADO".
 *
 * Criterios acordados con el usuario:
 *  - Cuando varias filas de la planilla caen en un mismo plan, se toma la MAS RECIENTE.
 *  - Las filas con ultimo trabajo "0" (nunca realizado) se dejan SIN historial (null).
 *  - Solo se cargan filas cuyo tipo de dato coincide con el disparador del plan:
 *    horas -> plan por HORAS, fecha -> plan por CALENDARIO. Cargar una fecha en un plan
 *    por horas dejaria el plan sin proximo vencimiento calculable.
 *
 * Solo toca lastExecutionHours/Date y nextDueHours/Date. No crea ordenes de trabajo.
 * nextDue se calcula con la MISMA formula del sistema (recalculateNextDue).
 * executionStatus se deriva en lectura, no se setea.
 * Idempotente. DRY=1 para previsualizar.
 *
 * Uso:
 *   export $(grep -E '^DATABASE_URL=' .env | xargs)
 *   DRY=1 npx tsx scripts/apply-dch-engines-history.ts
 *   npx tsx scripts/apply-dch-engines-history.ts
 */
import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
} as any) as any;

const SLUG = process.env.TENANT_SLUG ?? "mercurio";
const VESSEL = process.env.DST_VESSEL ?? "DCH";
const DRY = process.env.DRY === "1";

function addMonths(d: Date, n: number): Date {
  const r = new Date(d.getTime());
  const day = r.getUTCDate();
  r.setUTCDate(1);
  r.setUTCMonth(r.getUTCMonth() + n);
  const last = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate();
  r.setUTCDate(Math.min(day, last));
  return r;
}
function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}
/** Misma logica que recalculateNextDue() del service. */
function computeNextDue(
  trigger: string, fh: number | null, fm: number | null,
  lastDate: Date | null, lastHours: number | null,
): { nextDueDate: Date | null; nextDueHours: number | null } {
  if (trigger === "MONTHS" || trigger === "CALENDAR")
    return fm && fm > 0 && lastDate ? { nextDueDate: addMonths(lastDate, fm), nextDueHours: null } : { nextDueDate: null, nextDueHours: null };
  if (trigger === "HOURS" || trigger === "RUNNING_HOURS")
    return lastHours != null && fh && fh > 0 ? { nextDueDate: null, nextDueHours: lastHours + fh } : { nextDueDate: null, nextDueHours: null };
  if (trigger === "DAY")
    return fm && fm > 0 && lastDate ? { nextDueDate: addDays(lastDate, fm), nextDueHours: null } : { nextDueDate: null, nextDueHours: null };
  if (trigger === "WEEK")
    return fm && fm > 0 && lastDate ? { nextDueDate: addDays(lastDate, fm * 7), nextDueHours: null } : { nextDueDate: null, nextDueHours: null };
  return { nextDueDate: null, nextDueHours: null };
}

type Entry = {
  taskCode: string;
  hours?: number;   // ultima ejecucion por contador
  date?: string;    // ultima ejecucion por calendario (YYYY-MM-DD)
  clear?: true;     // fila en "0": dejar sin historial
  from: string;     // fila(s) de la planilla que respaldan el valor
};

const SHEETS: { sheet: string; rows: Entry[] }[] = [
  {
    sheet: "MOTOR PPAL BABOR (contador 39.501)",
    rows: [
      { taskCode: "DCH-MP-BR-01", hours: 39441, from: "Aceite lubricante / Filtro aceite / Filtro aceite turbosoplante (39.441)" },
      { taskCode: "DCH-MP-BR-07", hours: 39441, from: "Filtro de combustible (39.441) + Filtro de aire (37.531) -> mas reciente" },
      { taskCode: "DCH-MP-BR-05", hours: 34749, from: "Balancines / Turbosoplante (34.749)" },
      { taskCode: "DCH-MP-BR-24", hours: 21450, from: "Bombas de agua (21.450)" },
      { taskCode: "DCH-MP-BR-10", hours: 26000, from: "Cambio de inyectores (26.000)" },
      { taskCode: "DCH-MP-BR-16", clear: true, from: "Movimiento, recorrido completo (0 = nunca realizado)" },
      { taskCode: "DCH-6-003", clear: true, from: "Movimiento, recorrido completo (0 = nunca realizado)" },
      { taskCode: "DCH-MP-BR-18", date: "2026-06-26", from: "Analisis de aceite (26/06/26)" },
      { taskCode: "DCH-MP-BR-20", date: "2026-01-19", from: "Baterias control (19/01/26)" },
    ],
  },
  {
    sheet: "MOTOR PPAL ESTRIBOR (contador 39.414)",
    rows: [
      { taskCode: "DCH-MP-ER-01", hours: 39359, from: "Aceite lubricante / Filtro aceite / Filtro aceite turbosoplante (39.359)" },
      { taskCode: "DCH-MP-ER-07", hours: 39359, from: "Filtro de combustible / Filtro de aire (39.359)" },
      { taskCode: "DCH-MP-ER-05", hours: 34670, from: "Balancines / Turbosoplante (34.670)" },
      { taskCode: "DCH-MP-ER-24", hours: 21450, from: "Bombas de agua (21.450)" },
      { taskCode: "DCH-MP-ER-10", hours: 38500, from: "Cambio de inyectores (38.500)" },
      { taskCode: "DCH-MP-ER-16", clear: true, from: "Movimiento, recorrido completo (0 = nunca realizado)" },
      { taskCode: "DCH-MP-ER-18", date: "2026-06-25", from: "Analisis de aceite (25/06/26)" },
      { taskCode: "DCH-MP-ER-20", date: "2026-01-19", from: "Baterias control (19/01/26)" },
    ],
  },
  {
    sheet: "MOTOR AUXILIAR BABOR (contador 40.094)",
    rows: [
      { taskCode: "DCH-MA-BR-01", hours: 39850, from: "Filtro de aceite y aceite (39.850)" },
      { taskCode: "DCH-MA-BR-03", hours: 39850, from: "Filtro gasoil / Filtro aire (39.850) + Limpieza enfriador (37.648) -> mas reciente" },
      { taskCode: "DCH-MA-BR-08", hours: 38950, from: "Luz de valvulas y timing de inyectores (38.950)" },
      { taskCode: "DCH-MA-BR-18", hours: 38950, from: "Luz de valvulas y timing de inyectores (38.950)" },
      { taskCode: "DCH-MA-BR-11", hours: 37672, from: "Inyectores - cambio por recorridos (37.672)" },
      { taskCode: "DCH-MA-BR-06", date: "2026-05-28", from: "Analisis de aceite (28/05/26)" },
      { taskCode: "DCH-MA-BR-20", date: "2026-01-19", from: "Bateria de arranque (19/01/26)" },
    ],
  },
  {
    sheet: "MOTOR AUXILIAR ESTRIBOR (contador 38.452)",
    rows: [
      { taskCode: "DCH-MA-ER-01", hours: 38452, from: "Filtro de aceite y aceite (38.452)" },
      { taskCode: "DCH-MA-ER-03", hours: 38452, from: "Filtro aire (38.452) + Filtro gasoil (38.002) + Limpieza enfriador (37.488) -> mas reciente" },
      { taskCode: "DCH-MA-ER-08", hours: 37488, from: "Luz de valvulas y timing de inyectores (37.488)" },
      { taskCode: "DCH-MA-ER-18", hours: 37488, from: "Luz de valvulas y timing de inyectores (37.488)" },
      { taskCode: "DCH-MA-ER-11", hours: 37488, from: "Inyectores - cambio por recorridos (37.488)" },
      { taskCode: "DCH-MA-ER-06", date: "2026-05-04", from: "Analisis de aceite (04/05/26)" },
      { taskCode: "DCH-MA-ER-20", date: "2026-01-19", from: "Bateria de arranque (19/01/26)" },
    ],
  },
  {
    sheet: "CAJAS REDUCTORAS",
    rows: [
      { taskCode: "DCH-CR-ER-03", date: "2026-06-26", from: "Caja ER - Muestreo de aceites para analisis (26/06/26)" },
      { taskCode: "DCH-CR-BR-03", date: "2026-06-26", from: "Caja BR - Muestreo de aceites para analisis (26/06/26)" },
    ],
  },
  {
    sheet: "ALTERNADORES",
    rows: [
      { taskCode: "DCH-ALT-ER-01", date: "2025-08-14", from: "Alternador N°1 ER - Aislacion tomar (14/08/25)" },
      { taskCode: "DCH-ALT-ER-02", date: "2025-07-17", from: "Alternador N°1 ER - Rotor y estator limpiar (17/07/25)" },
      { taskCode: "DCH-ALT-ER-03", date: "2025-07-17", from: "Alternador N°1 ER - Rotor y estator, cambiar rodamiento (17/07/25)" },
      { taskCode: "DCH-ALT-ER-05", date: "2026-01-20", from: "Alternador N°1 ER - Caja de borneras, estado de excitacion (20/01/26)" },
      { taskCode: "DCH-ALT-BR-01", date: "2025-09-14", from: "Alternador N°2 BR - Aislacion tomar (14/09/25)" },
      { taskCode: "DCH-ALT-BR-02", date: "2025-09-14", from: "Alternador N°2 BR - Rotor y estator limpiar (14/09/25)" },
      { taskCode: "DCH-ALT-BR-03", date: "2025-09-14", from: "Alternador N°2 BR - Rotor y estator, cambiar rodamiento (14/09/25)" },
      { taskCode: "DCH-ALT-BR-05", date: "2026-01-20", from: "Alternador N°2 BR - Caja de borneras, estado de excitacion (20/01/26)" },
    ],
  },
  {
    sheet: "COMPRESORES / BOTELLONES",
    rows: [
      { taskCode: "DCH-COMP-NK40-13", date: "2025-02-27", from: "Compresor CETEC - Recorrido gral. (27/02/25)" },
      { taskCode: "DCH-COMP-NK40-11", date: "2025-10-28", from: "Compresor N°1 - Motor electrico tomar aislacion (28/10/25)" },
    ],
  },
  {
    sheet: "SISTEMA DE GOBIERNO",
    rows: [
      { taskCode: "DCH-HID-GOB-07", date: "2026-07-15", from: "Mecanismos - Engrase (15/07/26)" },
      { taskCode: "DCH-HID-GOB-04", date: "2026-01-21", from: "Tanque-Filtro de aceite y aceite - Cambiar (21/01/26)" },
      { taskCode: "DCH-HID-GOB-03", date: "2026-01-21", from: "Tanque-Filtro de aceite y aceite - Cambiar (21/01/26)" },
      { taskCode: "DCH-HID-GOB-08", date: "2024-11-01", from: "Bombas - Recorrido general (01/11/24)" },
    ],
  },
  {
    sheet: "LINEA DE EJE",
    rows: [
      { taskCode: "DCH-EJE-ER-01", date: "2026-06-20", from: "Linea de eje EB - Empaquetadura de bocina, controlar estado (20/06/26)" },
      { taskCode: "DCH-EJE-ER-02", date: "2025-10-30", from: "Linea de eje EB - Empaquetadura de bocina, cambiar (30/10/25)" },
      { taskCode: "DCH-EJE-ER-06", date: "2025-10-30", from: "Linea de eje EB - Eje portahelice, tomar huelgos en dique seco (30/10/25)" },
      { taskCode: "DCH-EJE-BR-01", date: "2026-06-20", from: "Linea de eje BR - Empaquetadura de bocina, controlar estado (20/06/26)" },
      { taskCode: "DCH-EJE-BR-02", date: "2025-10-30", from: "Linea de eje BR - Empaquetadura de bocina, cambiar (30/10/25)" },
      { taskCode: "DCH-EJE-BR-06", date: "2024-11-01", from: "Linea de eje BR - Eje portahelice, tomar huelgos en dique seco (01/11/24)" },
    ],
  },
  {
    sheet: "MOTOR LANCHA DE TRABAJO",
    rows: [
      { taskCode: "DCH-MOTOR-LANCHA-04", date: "2026-06-22", from: "Aceite y filtro de aceite de motor - cambiar (22/06/26)" },
    ],
  },
  {
    sheet: "BOMBAS",
    rows: [
      { taskCode: "DCH-EB-INC-P-06", date: "2026-06-22", from: "Bomba incendio principal - verificar funcionamiento, presion (22/06/26)" },
      { taskCode: "DCH-EB-INC-P-07", date: "2026-06-22", from: "Bomba incendio principal - control de empaquetadura (22/06/26)" },
      { taskCode: "DCH-EB-INC-P-03", date: "2026-06-25", from: "Bomba incendio principal - motor electrico tomar aislacion (25/06/26)" },
      { taskCode: "DCH-EB-INC-P-01", date: "2024-11-19", from: "Bomba incendio principal - bomba recorrido general (19/11/24)" },
      { taskCode: "DCH-MBBA-PORT-02", date: "2025-11-10", from: "Motobomba incendio emergencia - cambio de aceite, filtro aire y combustible (10/11/25)" },
      { taskCode: "DCH-EB-ACH-SENT-04", date: "2025-08-14", from: "Bombas achique sentina - motor electrico tomar aislacion (14/08/25)" },
      { taskCode: "DCH-EB-ACH-SENT-01", date: "2025-06-20", from: "Bombas achique sentina - bomba recorrido general (20/06/25)" },
      { taskCode: "DCH-EB-AP1-01", date: "2026-06-25", from: "Bomba agua potable - 26.01 verificar funcionamiento y manometro (25/06/26)" },
      { taskCode: "DCH-EB-AP1-04", date: "2026-06-25", from: "Bomba agua potable - 26.03 motor electrico tomar aislacion (25/06/26)" },
      { taskCode: "DCH-EB-AP1-02", date: "2022-11-19", from: "Bomba agua potable - 26.02 bomba recorrido general (19/11/22)" },
      { taskCode: "DCH-EB-AP2-05", date: "2026-06-25", from: "Bomba agua potable - 26.01 verificar funcionamiento y manometro (25/06/26)" },
      { taskCode: "DCH-EB-AP2-04", date: "2026-06-25", from: "Bomba agua potable - 26.03 motor electrico tomar aislacion (25/06/26)" },
      { taskCode: "DCH-EB-AP2-01", date: "2022-11-19", from: "Bomba agua potable - 26.02 bomba recorrido general (19/11/22)" },
      { taskCode: "DCH-EB-REF1-04", date: "2026-06-25", from: "Bombas refrigeracion motores aux - motor electrico tomar aislacion (25/06/26)" },
      { taskCode: "DCH-EB-REF1-01", date: "2022-11-19", from: "Bombas refrigeracion motores aux - bomba recorrido general (19/11/22)" },
      { taskCode: "DCH-EB-REF2-04", date: "2026-06-25", from: "Bombas refrigeracion motores aux - motor electrico tomar aislacion (25/06/26)" },
      { taskCode: "DCH-EB-REF2-01", date: "2022-11-19", from: "Bombas refrigeracion motores aux - bomba recorrido general (19/11/22)" },
      { taskCode: "DCH-EB-TRASV-03", date: "2025-08-22", from: "Bomba trasvase combustible - motor electrico tomar aislacion (22/08/25)" },
    ],
  },
  {
    sheet: "TOMAS DE MAR",
    rows: [
      { taskCode: "DCH-FILT-MAR-01", date: "2026-06-22", from: "Filtro - Limpiar / control de rejilla-canasto (22/06/26)" },
    ],
  },
  {
    sheet: "COCINA / TERMOTANQUES",
    rows: [
      { taskCode: "DCH-TERMOTQ-01", date: "2026-06-23", from: "Termotanque - Inspeccion visual / extraccion de fondo (23/06/26)" },
      { taskCode: "DCH-TERMOTQ-02", date: "2026-06-25", from: "Termotanque - Toma de aislacion (25/06/26)" },
    ],
  },
  {
    sheet: "NAVEGACION Y COMUNICACION",
    rows: [
      { taskCode: "DCH-AIS-01", date: "2025-08-19", from: "AIS Emtrak A-200 (19/08/25)" },
      { taskCode: "DCH-BAROM-01", date: "2025-08-20", from: "Barometro (20/08/25)" },
      { taskCode: "DCH-COMPAS-01", date: "2025-08-20", from: "Compas magnetico (20/08/25)" },
      { taskCode: "DCH-RADAR-BR-01", date: "2026-02-26", from: "Radar de babor SAMYUNG SMR 3700 (26/02/26)" },
      { taskCode: "DCH-RADAR-ER-01", date: "2026-02-26", from: "Radar de estribor FURUNO FAR 2117BB (26/02/26)" },
      { taskCode: "DCH-ECO-REMOL-01", date: "2025-08-19", from: "Ecosondas babor / estribor / remolcador (19/08/25)" },
      { taskCode: "DCH-VHF-BR-01", date: "2025-08-19", from: "Radio VHF babor (19/08/25)" },
      { taskCode: "DCH-VHF-ER-01", date: "2025-08-19", from: "Radio VHF estribor (19/08/25)" },
    ],
  },
];

const fmt = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "—");
const fmtH = (n: number | null) => (n == null ? "—" : n.toLocaleString("es-AR"));

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: SLUG }, select: { id: true } });
  if (!tenant) throw new Error(`Tenant '${SLUG}' no encontrado.`);
  const tid: string = tenant.id;
  const member = await prisma.tenantMembership.findFirst({
    where: { tenantId: tid, role: "TENANT_ADMIN" }, select: { userId: true },
  });
  const uid: string | undefined = member?.userId;
  if (!uid) throw new Error(`No hay TENANT_ADMIN en '${SLUG}'.`);

  let ok = 0, miss = 0, skip = 0;
  const seen = new Set<string>();

  for (const grp of SHEETS) {
    console.log(`\n━━━ ${grp.sheet}`);
    for (const e of grp.rows) {
      if (seen.has(e.taskCode)) throw new Error(`taskCode duplicado en el mapeo: ${e.taskCode}`);
      seen.add(e.taskCode);

      const plan = await prisma.maintenancePlan.findUnique({
        where: { tenantId_vesselCode_taskCode: { tenantId: tid, vesselCode: VESSEL, taskCode: e.taskCode } },
        select: {
          id: true, title: true, triggerType: true, frequencyHours: true, frequencyMonths: true,
          lastExecutionHours: true, lastExecutionDate: true, nextDueHours: true, nextDueDate: true,
        },
      });
      if (!plan) { console.warn(`  ⚠ plan no encontrado: ${e.taskCode}`); miss++; continue; }

      const trig = String(plan.triggerType);
      const isHours = trig === "HOURS" || trig === "RUNNING_HOURS";

      // Guarda: no mezclar tipo de dato con tipo de disparador.
      if (!e.clear && typeof e.hours === "number" && !isHours) {
        console.warn(`  ⚠ ${e.taskCode}: la planilla da HORAS pero el plan es por calendario (${trig}). Se omite.`);
        skip++; continue;
      }
      if (!e.clear && e.date && isHours) {
        console.warn(`  ⚠ ${e.taskCode}: la planilla da FECHA pero el plan es por horas. Se omite.`);
        skip++; continue;
      }

      let lastDate: Date | null = null;
      let lastHours: number | null = null;
      if (e.clear) {
        // sin historial: se limpian ambos
      } else if (typeof e.hours === "number") {
        lastHours = e.hours;
      } else if (e.date) {
        lastDate = new Date(`${e.date}T12:00:00.000Z`);
      }

      const nd = computeNextDue(trig, plan.frequencyHours, plan.frequencyMonths, lastDate, lastHours);

      const antes = `ult=${fmtH(plan.lastExecutionHours)}/${fmt(plan.lastExecutionDate)} prox=${fmtH(plan.nextDueHours)}/${fmt(plan.nextDueDate)}`;
      const desp = `ult=${fmtH(lastHours)}/${fmt(lastDate)} prox=${fmtH(nd.nextDueHours)}/${fmt(nd.nextDueDate)}`;
      console.log(`  ${e.taskCode.padEnd(20)} ${plan.title}`);
      console.log(`      ${e.from}`);
      console.log(`      antes: ${antes}`);
      console.log(`      ahora: ${desp}`);

      if (!DRY) {
        await prisma.maintenancePlan.update({
          where: { id: plan.id },
          data: {
            lastExecutionHours: lastHours,
            lastExecutionDate: lastDate,
            nextDueHours: nd.nextDueHours,
            nextDueDate: nd.nextDueDate,
            updatedByUserId: uid,
          },
        });
      }
      ok++;
    }
  }

  console.log(
    `\n${DRY ? "DRY-RUN (no se escribio nada). " : "✅ Completado. "}` +
      `${ok} planes actualizados${skip ? ` · ${skip} omitidos por tipo de dato` : ""}${miss ? ` · ${miss} no encontrados` : ""}.`,
  );
}

main().catch((e) => { console.error("❌", e?.message ?? e); process.exit(1); }).finally(() => prisma.$disconnect());
