// Simulacion temporal del historial de OTs para M01 (MAO 01).
//
// Reloj virtual dia a dia (START..END). Cada dia, por cada plan elegible cuyo
// vencimiento (nextDue) cayo en/antes de ese dia, genera una OT COMPLETA via la
// API (open -> avance -> APRUEBA -> AUTORIZA -> close) fechada ese dia, lo que
// reprograma el plan en el backend; luego recalcula el proximo vencimiento.
//
// Anchor inicial = estado ACTUAL del sistema (nextDueDate/lastExecutionDate de
// cada plan). No regenera el pasado: arranca despues de la ultima ejecucion real.
//
// Uso:
//   GPMS_TOKEN=<token> npx tsx scripts/simulate-wo-history.ts            # dry-run (default)
//   GPMS_TOKEN=<token> npx tsx scripts/simulate-wo-history.ts --live     # ejecuta en prod
//   ...  --start=2026-01-01 --end=2026-06-19 --limit=5
//
// Los timestamps (openDate/aprobadoAt/autorizadoAt) los estampa la API en "hoy";
// se retro-fechan al dia simulado con scripts/backdate-wos-bulk.ts (fase 2, en el VPS).

import { writeFileSync } from "node:fs";
import {
  buildOpenContent,
  buildExecutionContent,
  baseHours,
  type PlanLike,
} from "./sim-content-gen";

// ── Config ──────────────────────────────────────────────────────────────────────
const BASE_URL = process.env.BASE_URL || "https://mercurio.cms3.shipcms.cloud";
const TOKEN = process.env.GPMS_TOKEN || "";
const VESSEL_CODE = process.env.VESSEL_CODE || "M01";
const RESPONSIBLE = "Jefe de Maquinas";
const EXECUTOR = "Jefe de Maquinas";
const APPROVER = "Jefe de Maquinas";
const AUTHORIZER = "Gerente de Mantenimiento";
const SLEEP_MS = Number(process.env.SLEEP_MS || 300);
const OUT_FILE = process.env.OUT_FILE || "wo_results.json";

// Planes por horometro con fecha REAL conocida (planilla fisica). No son simulables
// por fecha, pero se registra 1 OT en su fecha real (si el plan no tiene OT previa).
const MANUAL_DATES: Record<string, string> = {
  "M01-MP-ER-04": "2026-02-17", "M01-MP-BR-04": "2026-02-17",
  "M01-MP-ER-01": "2026-02-17", "M01-MP-BR-01": "2026-02-17",
  "M01-MP-ER-03": "2025-09-09", "M01-MP-BR-03": "2025-09-09",
  "M01-MP-ER-05": "2025-10-03", "M01-MP-BR-05": "2025-10-03",
  "M01-MP-ER-09": "2025-07-15", "M01-MP-BR-09": "2024-05-14",
  "M01-MA-ER-01": "2026-03-07", "M01-MA-BR-01": "2026-03-13",
  "M01-MA-ER-03": "2026-03-07", "M01-MA-BR-03": "2026-03-13",
  "M01-MA-ER-07": "2025-09-23", "M01-MA-BR-08": "2025-08-26",
  "M01-MA-BR-07": "2025-08-06", "M01-MA-ER-11": "2024-12-05",
  "M01-MA-BR-16": "2025-10-03", "M01-MA-ER-16": "2025-09-23",
  "M01-CR-ER-02": "2025-11-24", "M01-CR-BR-02": "2025-11-07",
};

// ── Args ────────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const LIVE = args.includes("--live");
const getArg = (name: string): string | null => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split("=").slice(1).join("=") : null;
};
const START_STR = getArg("start") || "2026-01-01";
const END_STR = getArg("end") || "2026-06-19";
const LIMIT = getArg("limit") ? Number(getArg("limit")) : null;
const MAX_DATES_PRINT = Number(getArg("max-dates") || 8);

// ── Date helpers (portados de recalculateNextDue del backend) ───────────────────
function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}
function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}
const pad = (n: number) => String(n).padStart(2, "0");
function iso(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
/** Parsea "YYYY-MM-DD[...]" como medianoche LOCAL (para que setMonth/setDate matcheen el backend). */
function parseDateOnly(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

// ── Tipos de la API ─────────────────────────────────────────────────────────────
interface ApiPlan extends PlanLike {
  id: string;
  triggerType: string;
  frequencyMonths: number | null;
  frequencyHours: number | null;
  lastExecutionDate: string | null;
  nextDueDate: string | null;
}

const DATE_TRIGGERS = new Set(["MONTHS", "CALENDAR", "DAY", "WEEK"]);

/** Recurrencia por fecha (espejo de recalculateNextDue para triggers de fecha). */
function recalc(plan: ApiPlan, base: Date): Date | null {
  const tt = String(plan.triggerType || "").toUpperCase();
  const fm = plan.frequencyMonths ?? null;
  if (tt === "MONTHS" || tt === "CALENDAR") return fm && fm > 0 ? addMonths(base, fm) : null;
  if (tt === "DAY") return fm && fm > 0 ? addDays(base, fm) : null;
  if (tt === "WEEK") return fm && fm > 0 ? addDays(base, fm * 7) : null;
  return null; // HOURS/RUNNING_HOURS/CONDITION/EVENT no son date-driven
}

// ── HTTP ────────────────────────────────────────────────────────────────────────
class TokenError extends Error {}

async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE_URL + path, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (res.status === 401) throw new TokenError(`401 en ${method} ${path}: ${text.slice(0, 200)}`);
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : null) as T;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Plan elegible / anchor ──────────────────────────────────────────────────────
interface Eligible {
  plan: ApiPlan;
  anchor: Date;
  occurrences: string[]; // fechas ISO YYYY-MM-DD
  manual?: boolean;      // true = OT por fecha real conocida (horometro), no recurrente
}
interface Omitted {
  taskCode: string;
  triggerType: string;
  reason: string;
}

function computeAnchor(plan: ApiPlan, start: Date, lastOt: string | undefined): Date {
  // DEDUPE: si el plan ya tiene OT(s) reales, el proximo ciclo arranca DESPUES de
  // la ultima OT existente (preservar + agregar solo lo faltante). Esto evita
  // duplicar lo ya cargado aunque el nextDueDate del plan haya quedado desfasado.
  if (lastOt) {
    const nd = recalc(plan, parseDateOnly(lastOt));
    if (nd) return nd;
  }
  if (plan.nextDueDate) return parseDateOnly(plan.nextDueDate);
  if (plan.lastExecutionDate) {
    const nd = recalc(plan, parseDateOnly(plan.lastExecutionDate));
    if (nd) return nd;
  }
  return start; // sin historial -> vencido al inicio
}

/** Construye el calendario de ocurrencias por plan (deterministico, sin tocar la API). */
function buildSchedule(plans: ApiPlan[], start: Date, end: Date, existingLatest: Map<string, string>) {
  const eligible: Eligible[] = [];
  const omitted: Omitted[] = [];
  let dedupedPlans = 0;

  for (const plan of plans) {
    const tt = String(plan.triggerType || "").toUpperCase();
    if (!DATE_TRIGGERS.has(tt)) {
      // Horometro con fecha real conocida -> 1 OT en esa fecha (si no tiene OT previa).
      const md = MANUAL_DATES[plan.taskCode];
      if ((tt === "HOURS" || tt === "RUNNING_HOURS") && md) {
        if (existingLatest.has(plan.id)) {
          omitted.push({ taskCode: plan.taskCode, triggerType: tt, reason: "horometro c/fecha pero ya tiene OT (dedupe)" });
        } else {
          eligible.push({ plan, anchor: parseDateOnly(md), occurrences: [md.slice(0, 10)], manual: true });
        }
        continue;
      }
      omitted.push({ taskCode: plan.taskCode, triggerType: tt, reason: tt === "HOURS" || tt === "RUNNING_HOURS" ? "horometro (sin fecha)" : "sin recurrencia por fecha" });
      continue;
    }
    if (!plan.frequencyMonths || plan.frequencyMonths <= 0) {
      omitted.push({ taskCode: plan.taskCode, triggerType: tt, reason: "frecuencia nula/invalida" });
      continue;
    }

    const lastOt = existingLatest.get(plan.id);
    if (lastOt) dedupedPlans++;
    const anchor = computeAnchor(plan, start, lastOt);
    const occurrences: string[] = [];
    let nd: Date | null = anchor;
    let guard = 0;
    while (nd && nd <= end && guard < 2000) {
      const fireDay = nd < start ? start : nd;
      occurrences.push(iso(fireDay));
      nd = recalc(plan, fireDay);
      guard++;
    }
    eligible.push({ plan, anchor, occurrences });
  }
  return { eligible, omitted, dedupedPlans };
}

// ── Ciclo completo de una OT (5 llamadas) ───────────────────────────────────────
interface FireResult {
  taskCode: string;
  planId: string;
  woId: string;
  workOrderCode: string;
  simDay: string;
}

async function fire(plan: ApiPlan, simDay: string, occ: number): Promise<FireResult> {
  const open = buildOpenContent(plan);
  const exec = buildExecutionContent(plan, open.riskLevel, occ);

  // 1) Abrir OT desde el plan (status PLANNED)
  const wo = await api<{ id: string; workOrderCode: string }>(
    "POST",
    `/app/pms/maintenance-plans/${plan.id}/open-work-order`,
    {
      title: plan.title,
      dueDate: simDay,
      estimatedHours: baseHours(plan, open.riskLevel),
      assignedToUserId: RESPONSIBLE,
      description: open.description,
      acceptanceCriteria: open.acceptanceCriteria,
      loto: open.loto,
      riskLevel: open.riskLevel,
      riskAnalysisResult: open.riskAnalysisResult,
      consequenceCategory: open.consequenceCategory,
      consequenceRationale: open.consequenceRationale,
    },
  );
  await sleep(SLEEP_MS);

  // 2) Avance (progress note TEXT)
  await api("POST", `/app/pms/work-orders/${wo.id}/progress-notes?kind=TEXT`, { text: exec.avance });
  await sleep(SLEEP_MS);

  // 3) Aprobar
  await api("POST", `/app/pms/work-orders/${wo.id}/approval`, { step: "APRUEBA", name: APPROVER });
  await sleep(SLEEP_MS);

  // 4) Autorizar
  await api("POST", `/app/pms/work-orders/${wo.id}/approval`, { step: "AUTORIZA", name: AUTHORIZER });
  await sleep(SLEEP_MS);

  // 5) Cerrar con resultado y fecha de ejecucion
  await api("POST", `/app/pms/work-orders/${wo.id}/close`, {
    woResult: "SATISFACTORY",
    executedByName: EXECUTOR,
    completedDate: simDay,
    actualHours: exec.actualHours,
    observations: exec.observations,
  });

  return { taskCode: plan.taskCode, planId: plan.id, woId: wo.id, workOrderCode: wo.workOrderCode, simDay };
}

// ── Reporte ─────────────────────────────────────────────────────────────────────
function coverage(eligible: Eligible[]) {
  const fields = ["acceptanceCriteria", "loto", "riskLevel", "riskAnalysisResult", "consequenceCategory", "description"] as const;
  const counts: Record<string, number> = {};
  for (const f of fields) counts[f] = 0;
  for (const e of eligible) {
    for (const f of fields) {
      const v = (e.plan as any)[f];
      if (v != null && String(v).trim().length > 0) counts[f]++;
    }
  }
  return counts;
}

function printDryRun(eligible: Eligible[], omitted: Omitted[]) {
  const totalOTs = eligible.reduce((a, e) => a + e.occurrences.length, 0);
  const manual = eligible.filter((e) => e.manual);
  const dateDriven = eligible.filter((e) => !e.manual);
  console.log("\n========== DRY-RUN (no escribe nada) ==========");
  console.log(`Ventana: ${START_STR} -> ${END_STR}`);
  console.log(`Planes date-driven: ${dateDriven.length} -> ${dateDriven.reduce((a, e) => a + e.occurrences.length, 0)} OTs`);
  console.log(`Planes horometro c/fecha real: ${manual.length} -> ${manual.length} OTs`);
  console.log(`OTs a generar (TOTAL): ${totalOTs}`);
  console.log(`Planes omitidos: ${omitted.length}`);

  // Por trigger
  const byTrigger: Record<string, { plans: number; ots: number }> = {};
  for (const e of eligible) {
    const tt = String(e.plan.triggerType).toUpperCase();
    byTrigger[tt] = byTrigger[tt] || { plans: 0, ots: 0 };
    byTrigger[tt].plans++;
    byTrigger[tt].ots += e.occurrences.length;
  }
  console.log("\n-- Por triggerType --");
  for (const [tt, v] of Object.entries(byTrigger)) console.log(`  ${tt}: ${v.plans} planes -> ${v.ots} OTs`);

  // Cobertura de campos en planes
  console.log("\n-- Cobertura de campos en planes elegibles (cargado / generado) --");
  const cov = coverage(eligible);
  for (const [f, c] of Object.entries(cov)) console.log(`  ${f}: ${c}/${eligible.length} cargados (${eligible.length - c} se generan)`);

  // Detalle por plan
  console.log("\n-- Calendario por plan --");
  for (const e of eligible) {
    const occ = e.occurrences;
    const shown = occ.slice(0, MAX_DATES_PRINT).join(", ") + (occ.length > MAX_DATES_PRINT ? `, ... (+${occ.length - MAX_DATES_PRINT})` : "");
    const tag = e.manual ? "[HOROMETRO fecha-real]" : `[${e.plan.triggerType} x${e.plan.frequencyMonths}] anchor=${iso(e.anchor)}`;
    console.log(`  ${e.plan.taskCode} ${tag} -> ${occ.length} OTs: ${shown}`);
  }

  // Muestra de contenido generado (primeros 5)
  console.log("\n-- Muestra de contenido generado (primeros 5 planes) --");
  for (const e of eligible.slice(0, 5)) {
    const open = buildOpenContent(e.plan);
    const exec = buildExecutionContent(e.plan, open.riskLevel, 0);
    console.log(`\n  [${e.plan.taskCode}] ${e.plan.title}`);
    console.log(`    Tarea:        ${open.description}`);
    console.log(`    Criterios:    ${open.acceptanceCriteria}`);
    console.log(`    LOTO:         ${open.loto}`);
    console.log(`    Nivel riesgo: ${open.riskLevel}`);
    console.log(`    Analisis:     ${open.riskAnalysisResult}`);
    console.log(`    RCM:          ${open.consequenceCategory} — ${open.consequenceRationale}`);
    console.log(`    Avance:       ${exec.avance}`);
    console.log(`    Observac.:    ${exec.observations}`);
    console.log(`    Horas:        ${exec.actualHours}`);
    console.log(`    (generados:   ${open.generated.length ? open.generated.join(", ") : "ninguno — todo heredado del plan"})`);
  }

  if (omitted.length) {
    console.log("\n-- Omitidos --");
    for (const o of omitted) console.log(`  ${o.taskCode} [${o.triggerType}] — ${o.reason}`);
  }
  console.log("\n(Para ejecutar en produccion: agregar --live)\n");
}

// ── Main ────────────────────────────────────────────────────────────────────────
async function main() {
  const start = parseDateOnly(START_STR);
  const end = parseDateOnly(END_STR);

  console.log(`Validando token y cargando planes de ${VESSEL_CODE}...`);
  const data = await api<{ items: ApiPlan[]; total: number }>("GET", `/app/pms/maintenance-plans?vesselCode=${VESSEL_CODE}`);
  let plans = data.items;
  console.log(`Planes recibidos: ${plans.length} (total=${data.total})`);

  // OTs existentes -> ultima fecha por plan (para dedupe: no duplicar lo ya cargado)
  const existing = await api<{ items: { maintenancePlanId: string | null; completedDate: string | null }[] }>("GET", `/app/pms/work-orders?vesselCode=${VESSEL_CODE}`);
  const existingLatest = new Map<string, string>();
  for (const w of existing.items) {
    if (!w.maintenancePlanId || !w.completedDate) continue;
    const d = w.completedDate.slice(0, 10);
    const prev = existingLatest.get(w.maintenancePlanId);
    if (!prev || d > prev) existingLatest.set(w.maintenancePlanId, d);
  }
  console.log(`OTs existentes: ${existing.items.length} (en ${existingLatest.size} planes con fecha)`);

  // Schedule deterministico
  let { eligible, omitted, dedupedPlans } = buildSchedule(plans, start, end, existingLatest);
  console.log(`Planes elegibles con OT previa (anchor reajustado al proximo ciclo): ${dedupedPlans}`);
  if (LIMIT != null) {
    console.log(`\n[--limit=${LIMIT}] Procesando solo los primeros ${LIMIT} planes elegibles.`);
    eligible = eligible.slice(0, LIMIT);
  }

  printDryRun(eligible, omitted);

  if (!LIVE) return;

  // ── LIVE ──
  const totalOTs = eligible.reduce((a, e) => a + e.occurrences.length, 0);
  console.log(`\n########## LIVE — generando ${totalOTs} OTs en ${BASE_URL} ##########\n`);

  // Jobs ordenados cronologicamente (y por taskCode dentro del dia)
  const jobs: { plan: ApiPlan; simDay: string; occ: number }[] = [];
  for (const e of eligible) e.occurrences.forEach((day, occ) => jobs.push({ plan: e.plan, simDay: day, occ }));
  jobs.sort((a, b) => (a.simDay < b.simDay ? -1 : a.simDay > b.simDay ? 1 : a.plan.taskCode.localeCompare(b.plan.taskCode)));

  const results = { ok: [] as FireResult[], errors: [] as { taskCode: string; simDay: string; error: string }[], skipped: omitted };
  const flush = () => writeFileSync(OUT_FILE, JSON.stringify(results, null, 2), "utf8");

  let done = 0;
  for (const job of jobs) {
    try {
      const r = await fire(job.plan, job.simDay, job.occ);
      results.ok.push(r);
      done++;
      console.log(`  [${done}/${jobs.length}] OK  ${r.taskCode} -> ${r.simDay}  (${r.workOrderCode})`);
    } catch (err) {
      if (err instanceof TokenError) {
        console.error(`\n!! TOKEN INVALIDO/EXPIRADO. Abortando. Refresca GPMS_TOKEN (localStorage gpms_token) y reintenta — es idempotente.`);
        flush();
        process.exit(2);
      }
      const msg = err instanceof Error ? err.message : String(err);
      results.errors.push({ taskCode: job.plan.taskCode, simDay: job.simDay, error: msg });
      console.error(`  [${done}/${jobs.length}] ERR ${job.plan.taskCode} -> ${job.simDay}: ${msg}`);
    }
    if (done % 25 === 0) flush();
    await sleep(SLEEP_MS);
  }
  flush();

  console.log(`\n========== RESUMEN ==========`);
  console.log(`OK:       ${results.ok.length}`);
  console.log(`Errores:  ${results.errors.length}`);
  console.log(`Omitidos: ${results.skipped.length}`);
  console.log(`Resultado guardado en ${OUT_FILE}`);
  if (results.errors.length) console.log(`Revisar errores en ${OUT_FILE}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
