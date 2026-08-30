/**
 * Simulación del mantenimiento PREVENTIVO de DON CHICUETO (DCH) que se debería
 * haber hecho desde ene/2026, abriendo una SS COMPLETA (CLOSED) por cada ejecución
 * y reprogramando el timing del plan. Insert directo en DB (VPS), idempotente.
 *
 * Alcance (decidido con el usuario):
 *  - Planes MONTHS SIN historial (nextDueDate null): se generan las ocurrencias
 *    desde 2026-01-01 a 2026-06-29 a su frecuencia (≈113 SS). Anclados al inicio.
 *  - Planes HOURS + EVENT (52): 1 SS c/u, fecha DISTRIBUIDA en el semestre.
 *  - OMITIDOS: semanales (WEEK) y diario (DAY) [alta frecuencia]; planes MONTHS
 *    CON historial (su próximo vencimiento ya cae > jun/2026 → nada vencido).
 *
 * Cada SS (igual que las 64 correctivas):
 *  - Tramitación: SOLICITA Oscar Duarte, APRUEBA Ronald Silva, AUTORIZA Jorge Bael,
 *    CIERRA Oscar Duarte — con userIds reales → FIRMAS incrustadas en el PDF.
 *  - Campos heredados del plan (acceptanceCriteria/loto/riskLevel/análisis/RCM);
 *    los que falten, generados por criticidad/keywords.
 *  - status CLOSED, fechas = día simulado, nota de avance, resultado SATISFACTORY.
 *
 * Reprograma: lastExecutionDate = última ocurrencia; nextDueDate = +frecuencia
 * (MONTHS). executionStatus se deriva en lectura, no se setea.
 *
 * Uso (VPS):
 *   export $(grep -E '^DATABASE_URL=' .env | xargs)
 *   DRY=1 npx tsx scripts/sim-dch-pm.ts
 *   npx tsx scripts/sim-dch-pm.ts
 */
import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
} as any) as any;

const DRY = process.env.DRY === "1";
const VESSEL = "DCH";
const TENANT_SLUG = "mercurio";
const START = "2026-01-01";
const END = "2026-06-29";

const OSCAR = "cmqzd266m00wfmel400orx52a";   // Oscar Duarte — Jefe de Máquinas (solicita + cierra)
const RONALD = "cmqp9rgb5005g1ml4onazz8ut";  // Ronald Silva (aprueba)
const JORGE = "cmqp9qix900591ml4haiefuh9";   // Jorge Bael (autoriza)
const JEFE_NAME = "Oscar Duarte";

// ── date helpers (UTC, mediodía para evitar corrimientos) ──
const d = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`);
const pad = (n: number) => String(n).padStart(2, "0");
const isoOf = (x: Date) => `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`;
function addMonths(x: Date, n: number): Date {
  const r = new Date(x.getTime());
  const day = r.getUTCDate();
  r.setUTCDate(1);
  r.setUTCMonth(r.getUTCMonth() + n);
  const last = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate();
  r.setUTCDate(Math.min(day, last));
  return r;
}
const addDays = (x: Date, n: number) => new Date(x.getTime() + n * 86_400_000);
const pad4 = (n: number) => String(n).padStart(4, "0");

const riskFromCrit = (c: string) => (c === "A" ? "HIGH" : c === "C" ? "LOW" : "MEDIUM");
const prioFromCrit = (c: string) => (c === "A" ? "HIGH" : c === "C" ? "LOW" : "MEDIUM");

const SAFETY_RX = /incend|co2|deteccion|detección|emergenc|lci|extinc|escape|arrest|alarma|salvavid|abandono|bote|evacua/i;
const ENV_RX = /sewage|sanidad|aguas|combustible|aceite|sentina|oleos|oleoso|derrame|lastre|slop/i;

function inferType(title: string, desc: string): "PREVENTIVE" | "INSPECTION" {
  return /inspecc|prueba|control|medicion|medición|verificac|test/i.test(`${title} ${desc}`) ? "INSPECTION" : "PREVENTIVE";
}
function inferCons(title: string, asset: string): "SAFETY" | "ENVIRONMENTAL" | "OPERATIONAL" | "NON_OPERATIONAL" {
  const s = `${title} ${asset}`;
  if (SAFETY_RX.test(s)) return "SAFETY";
  if (ENV_RX.test(s)) return "ENVIRONMENTAL";
  return "OPERATIONAL";
}
function consRationale(c: string): string {
  switch (c) {
    case "SAFETY": return "La omisión compromete la seguridad de personas o la respuesta ante emergencia (incendio / protección).";
    case "ENVIRONMENTAL": return "La omisión puede derivar en derrame o contaminación (combustible / aceite / aguas).";
    case "NON_OPERATIONAL": return "Impacto acotado al costo de reparación, sin afectar operación, seguridad ni ambiente.";
    default: return "La omisión afecta la disponibilidad operativa del remolcador (propulsión / gobierno / servicios).";
  }
}
function genAcceptance(tipo: string): string {
  return tipo === "INSPECTION"
    ? "Inspección/prueba completada según el plan; estado del equipo documentado; hallazgos registrados. Equipo apto para servicio."
    : "Mantenimiento ejecutado según el plan; equipo operativo, sin fugas ni alarmas y con parámetros dentro de rango nominal.";
}
const GEN_LOTO =
  "Bloqueo y etiquetado (LOTO) de las fuentes de energía del equipo (eléctrica / neumática / hidráulica). Verificación de energía cero y purga de presión antes de intervenir. Señalización del área.";
function genRisk(title: string, crit: string, tipo: string): string {
  const nivel = crit === "A" ? "ALTO" : crit === "C" ? "BAJO" : "MEDIO";
  return tipo === "INSPECTION"
    ? `Inspección/prueba programada de "${title}". La falta de control periódico impide detectar desgaste o anomalías antes de la falla. Riesgo ${nivel}; mitigado por control planificado. Sin hallazgos que comprometan el servicio tras la verificación.`
    : `Mantenimiento programado de "${title}". La omisión acelera el desgaste y eleva la probabilidad de falla en servicio. Riesgo ${nivel}; mitigado por mantenimiento preventivo según plan. Equipo operativo dentro de parámetros tras la intervención.`;
}

interface Plan {
  id: string; taskCode: string; title: string; description: string | null; assetId: string | null;
  triggerType: string; frequencyMonths: number | null; frequencyHours: number | null;
  nextDueDate: Date | null; lastExecutionDate: Date | null;
  acceptanceCriteria: string | null; loto: string | null; riskLevel: string | null;
  riskAnalysisResult: string | null; consequenceCategory: string | null; consequenceRationale: string | null;
  estimatedHours: number | null;
}
interface Job { plan: Plan; day: string; }

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG }, select: { id: true } });
  if (!tenant) throw new Error(`Tenant ${TENANT_SLUG} no encontrado`);
  const tenantId = tenant.id;

  const assets = await prisma.asset.findMany({
    where: { tenantId, vesselCode: VESSEL, deletedAt: null },
    select: { id: true, name: true, criticality: true },
  });
  const critMap = new Map<string, string>(assets.map((a: any) => [a.id, a.criticality]));
  const nameMap = new Map<string, string>(assets.map((a: any) => [a.id, a.name ?? ""]));

  const plans: Plan[] = await prisma.maintenancePlan.findMany({
    where: { tenantId, vesselCode: VESSEL, deletedAt: null },
    select: {
      id: true, taskCode: true, title: true, description: true, assetId: true,
      triggerType: true, frequencyMonths: true, frequencyHours: true,
      nextDueDate: true, lastExecutionDate: true,
      acceptanceCriteria: true, loto: true, riskLevel: true,
      riskAnalysisResult: true, consequenceCategory: true, consequenceRationale: true,
      estimatedHours: true,
    },
  });

  const startD = d(START), endD = d(END);
  const jobs: Job[] = [];
  const skippedNoAsset: string[] = [];

  // 1) MONTHS sin historial → ocurrencias desde inicio
  const monthsPlans = plans.filter(p =>
    String(p.triggerType).toUpperCase() === "MONTHS" && !p.nextDueDate && (p.frequencyMonths ?? 0) > 0);
  for (const p of monthsPlans) {
    if (!p.assetId) { skippedNoAsset.push(p.taskCode); continue; }
    let cur = startD;
    let guard = 0;
    while (cur <= endD && guard < 500) {
      jobs.push({ plan: p, day: isoOf(cur) });
      cur = addMonths(cur, p.frequencyMonths!);
      guard++;
    }
  }

  // 2) HOURS + EVENT → 1 SS c/u, fecha distribuida determinísticamente en el semestre
  const hourEventPlans = plans
    .filter(p => ["HOURS", "RUNNING_HOURS", "EVENT"].includes(String(p.triggerType).toUpperCase()))
    .sort((a, b) => a.taskCode.localeCompare(b.taskCode));
  const totalDays = Math.round((endD.getTime() - startD.getTime()) / 86_400_000); // 179
  const n = hourEventPlans.length;
  hourEventPlans.forEach((p, i) => {
    if (!p.assetId) { skippedNoAsset.push(p.taskCode); return; }
    const off = n > 1 ? Math.round((i * totalDays) / (n - 1)) : 0;
    jobs.push({ plan: p, day: isoOf(addDays(startD, off)) });
  });

  // Orden cronológico (y por taskCode dentro del día)
  jobs.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.plan.taskCode.localeCompare(b.plan.taskCode)));

  // Última ocurrencia por plan (para reprogramar)
  const lastOccByPlan = new Map<string, string>();
  for (const j of jobs) {
    const prev = lastOccByPlan.get(j.plan.id);
    if (!prev || j.day > prev) lastOccByPlan.set(j.plan.id, j.day);
  }

  console.log(`\n===== SIM PM DCH (${DRY ? "DRY-RUN" : "LIVE"}) =====`);
  console.log(`Ventana: ${START} → ${END}`);
  console.log(`Planes MONTHS sin historial: ${monthsPlans.length} → ${jobs.filter(j => String(j.plan.triggerType).toUpperCase() === "MONTHS").length} SS`);
  console.log(`Planes HOURS/EVENT: ${hourEventPlans.length} → ${jobs.length - jobs.filter(j => String(j.plan.triggerType).toUpperCase() === "MONTHS").length} SS`);
  console.log(`TOTAL SS a generar: ${jobs.length}`);
  if (skippedNoAsset.length) console.log(`Omitidos sin assetId: ${skippedNoAsset.length} (${skippedNoAsset.join(", ")})`);

  // Idempotencia: borrar SS de simulación previas (plan-based + creadas por Oscar). NO toca SS-0001 (Admin) ni las 64 correctivas (planId null).
  const prev = await prisma.workOrder.findMany({
    where: { tenantId, vesselCode: VESSEL, maintenancePlanId: { not: null }, createdByUserId: OSCAR },
    select: { id: true },
  });
  console.log(`Idempotencia: ${prev.length} SS de simulación previas serán borradas y reinsertadas.`);

  if (DRY) {
    console.log(`\n-- Muestra (primeras 8) --`);
    for (const j of jobs.slice(0, 8)) {
      const crit = critMap.get(j.plan.assetId!) ?? "B";
      console.log(`  [${j.day}] ${j.plan.taskCode} (${j.plan.triggerType} crit ${crit}) → "${j.plan.title.slice(0, 50)}"`);
    }
    console.log(`\n(DRY-RUN: no se escribió nada.)\n`);
    await prisma.$disconnect();
    return;
  }

  if (prev.length) {
    const ids = prev.map((p: any) => p.id);
    await prisma.workOrderProgressNote.deleteMany({ where: { workOrderId: { in: ids } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: ids } } });
  }

  // Correlativo: max existente + 1
  const all = await prisma.workOrder.findMany({
    where: { tenantId, vesselCode: VESSEL, workOrderCode: { startsWith: "SS-DCH-26-" } },
    select: { workOrderCode: true },
  });
  let seq = all.reduce((m: number, w: any) => Math.max(m, Number(w.workOrderCode.split("-")[3]) || 0), 0);

  let ok = 0;
  for (const j of jobs) {
    const p = j.plan;
    const crit = critMap.get(p.assetId!) ?? "B";
    const when = d(j.day);
    const tipo = inferType(p.title, p.description ?? "");
    const cons = (p.consequenceCategory as string) ?? inferCons(p.title, nameMap.get(p.assetId!) ?? "");
    const code = `SS-${VESSEL}-26-${pad4(++seq)}`;
    const hrs = p.estimatedHours ?? 4;
    const avance = `Se ejecutó el mantenimiento programado: ${p.title}. Tareas del plan completadas y equipo probado en funcionamiento.`;
    const closeNote = `Mantenimiento ejecutado conforme al plan. Equipo operativo y verificado, sin novedades pendientes.`;

    await prisma.workOrder.create({
      data: {
        tenantId,
        vesselCode: VESSEL,
        assetId: p.assetId!,
        maintenancePlanId: p.id,
        workOrderCode: code,
        type: tipo,
        status: "CLOSED",
        priority: prioFromCrit(crit),
        criticality: crit,
        openDate: when, startDate: when, dueDate: when, completedDate: when,
        title: p.title,
        description: p.description ?? p.title,
        assignedToUserId: JEFE_NAME,
        estimatedHours: hrs,
        actualHours: hrs,
        acceptanceCriteria: p.acceptanceCriteria ?? genAcceptance(tipo),
        loto: p.loto ?? GEN_LOTO,
        riskLevel: p.riskLevel ?? riskFromCrit(crit),
        riskAnalysisResult: p.riskAnalysisResult ?? genRisk(p.title, crit, tipo),
        consequenceCategory: cons,
        consequenceRationale: p.consequenceRationale ?? consRationale(cons),
        department: "MAQUINAS",
        communicationMethod: ["IMPRESO", "EMAIL"],
        distribution: [],
        // Tramitación + firmas (userIds reales)
        aprobadoByName: "Ronald Silva", aprobadoByUserId: RONALD, aprobadoAt: when,
        autorizadoByName: "Jorge Bael", autorizadoByUserId: JORGE, autorizadoAt: when,
        // Resultado / cierre
        woResult: "SATISFACTORY",
        executedByName: JEFE_NAME,
        observations: closeNote,
        closeNotes: closeNote,
        // Auditoría → SOLICITA + CIERRA = Oscar (firma)
        createdAt: when,
        createdByUserId: OSCAR,
        updatedByUserId: OSCAR,
        progressNotes: {
          create: [{
            tenantId, vesselCode: VESSEL, kind: "TEXT",
            text: avance, processedText: avance, processed: true,
            createdAt: when, createdByUserId: OSCAR,
          }],
        },
      },
    });
    ok++;
    if (ok % 25 === 0 || ok === jobs.length) console.log(`  [${ok}/${jobs.length}] ${code} ${p.taskCode} OK`);
  }

  // Reprogramar planes simulados
  let reprog = 0;
  for (const [planId, lastDay] of lastOccByPlan) {
    const p = plans.find(pp => pp.id === planId)!;
    const data: Record<string, unknown> = { lastExecutionDate: d(lastDay), updatedByUserId: OSCAR };
    if (String(p.triggerType).toUpperCase() === "MONTHS" && (p.frequencyMonths ?? 0) > 0) {
      data.nextDueDate = addMonths(d(lastDay), p.frequencyMonths!);
    }
    await prisma.maintenancePlan.update({ where: { id: planId }, data });
    reprog++;
  }

  console.log(`\n===== LISTO: ${ok} SS creadas (CLOSED) · ${reprog} planes reprogramados =====\n`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
