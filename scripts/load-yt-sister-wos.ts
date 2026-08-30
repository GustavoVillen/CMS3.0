/**
 * Carga el historial de OT de YT010 en sus barcazas gemelas YT012 y YT013.
 *
 * Contexto: el export_work_orders (YT).xlsx contenía las 16 OT reales de YT010
 * triplicadas (mismos id/planId/assetId para las tres barcazas). O sea: YT010 ya
 * las tiene; hay que REPLICAR esas 16 OT en YT012 y YT013, enganchadas a los
 * planes PROPIOS de cada barcaza (que ya existen, clonados de YT010).
 *
 * Los campos pesados (criterios de aceptación, LOTO, análisis de riesgo,
 * consecuencias, descripción, department, taskMaster) NO se pasan: openFormalWorkOrder
 * los hereda del plan automáticamente (maintenance-plans-service.ts:1268-1284).
 *
 * Fase 1 (este script): por cada OT, mapea por TÍTULO al plan de la barcaza y corre
 *   el ciclo real de la API (open-work-order → APRUEBA → AUTORIZA → close).
 *   Vuelca wo-sister-results.json (woId + código original + fechas) para la Fase 2.
 *
 * Fase 2 (scripts/backdate-wo-migration.ts en el VPS): retro-fecha timestamps y
 *   SOBRESCRIBE workOrderCode con el código original (SS-YT012-20-0001, etc.).
 *
 * Uso:
 *   GPMS_TOKEN=<token> npx tsx scripts/load-yt-sister-wos.ts            # DRY-RUN (mapea, no escribe)
 *   GPMS_TOKEN=<token> npx tsx scripts/load-yt-sister-wos.ts --live     # ejecuta el ciclo
 *   VESSELS=YT012 ...  (default: YT012,YT013)
 */
import { writeFileSync } from "node:fs";

// ── Config ──────────────────────────────────────────────────────────────────
const BASE_URL = process.env.BASE_URL || "https://mercurio.cms3.shipcms.cloud";
const TOKEN = process.env.GPMS_TOKEN || "";
const VESSELS = (process.env.VESSELS || "YT012,YT013").split(",").map(s => s.trim()).filter(Boolean);
const SLEEP_MS = Number(process.env.SLEEP_MS || 250);
const OUT = process.env.OUT_FILE || "wo-sister-results.json";
const args = process.argv.slice(2);
const LIVE = args.includes("--live");

// ── Plantillas: las 16 OT (idénticas entre barcazas salvo prefijo del código) ──
// suffix = "{YY}-{NNNN}" → código final: SS-{VESSEL}-{suffix}
interface Tpl {
  suffix: string; title: string;
  open: string; due: string; start: string; completed: string;
  est: number;
}
const TEMPLATES: Tpl[] = [
  { suffix: "20-0001", title: "Medicion de Espesores por Ultrasonido de Espacios (NDT)", open: "2020-01-01", due: "2020-01-06", start: "2020-01-01", completed: "2020-01-02", est: 8 },
  { suffix: "20-0002", title: "DIQUE SECO: Recorrido completo MOTOR Y BOMBA DE CARGA", open: "2020-01-01", due: "2020-01-06", start: "2020-01-01", completed: "2020-01-02", est: 96 },
  { suffix: "20-0003", title: "DIQUE SECO: Desarme y Prueba Hidraulica de Tuberias y Valvulas de Carga", open: "2020-01-01", due: "2020-01-06", start: "2020-01-01", completed: "2020-01-02", est: 96 },
  { suffix: "24-0001", title: "Inspeccion interna de TANQUES DE CARGA CADA 4 AÑOS", open: "2024-01-01", due: "2024-01-06", start: "2024-01-01", completed: "2024-01-02", est: 4 },
  { suffix: "24-0002", title: "Mantenimento del Motor CADA 4 AÑOS", open: "2024-01-01", due: "2024-01-06", start: "2024-01-01", completed: "2024-01-02", est: 8 },
  { suffix: "24-0003", title: "Mantenimento del Motor CADA 4 AÑOS", open: "2024-01-01", due: "2024-01-06", start: "2024-01-01", completed: "2024-01-02", est: 8 },
  { suffix: "26-0001", title: "Inspeccion Interna ANUAL de PIQUES y COFFERDAMS", open: "2026-01-01", due: "2026-01-06", start: "2026-01-01", completed: "2026-01-02", est: 6 },
  { suffix: "26-0002", title: "Inspecciones y Pruebas SEMESTRALES", open: "2026-07-01", due: "2026-07-06", start: "2026-07-01", completed: "2026-07-02", est: 1 },
  { suffix: "26-0003", title: "Mantenimiento ANUAL - MOTOR y BOMBA", open: "2026-01-01", due: "2026-01-06", start: "2026-01-01", completed: "2026-01-02", est: 2 },
  { suffix: "26-0004", title: "Valvulas P/V: Prueba Neumatica", open: "2026-01-01", due: "2026-01-06", start: "2026-01-01", completed: "2026-01-02", est: 4 },
  { suffix: "26-0005", title: "Inspecciones y Pruebas SEMESTRALES", open: "2026-07-01", due: "2026-07-06", start: "2026-07-01", completed: "2026-07-02", est: 4 },
  { suffix: "26-0006", title: "Prueba hidráulica ANUAL de líneas de carga/descarga, válvulas de carga y tanques de carga", open: "2026-01-01", due: "2026-01-06", start: "2026-01-01", completed: "2026-01-02", est: 2 },
  { suffix: "26-0007", title: "Prueba Hydraulica ANUAL de la linea de Incendio", open: "2026-01-01", due: "2026-01-06", start: "2026-01-01", completed: "2026-01-02", est: 2 },
  { suffix: "26-0008", title: "Certificado ANUAL de Manometros de Carga/ Termometro de Cabezal", open: "2026-01-01", due: "2026-01-06", start: "2026-01-01", completed: "2026-01-02", est: 0 },
  { suffix: "26-0009", title: "Alarmas de Nivel: Reemplazo de Baterias", open: "2026-01-01", due: "2026-01-06", start: "2026-01-01", completed: "2026-01-02", est: 1 },
  { suffix: "26-0010", title: "Alarmas de Nivel: Recorrido anual/ Certificacion", open: "2026-01-01", due: "2026-01-06", start: "2026-01-01", completed: "2026-01-02", est: 5 },
];

// Overrides por suffix cuando el título de la OT difiere del del plan (erratas /
// variantes). Valor = título EXACTO del plan en YT012/YT013 (idéntico en ambas).
const MANUAL_MAP: Record<string, string> = {
  "24-0002": "Mantenimiento del Motor CADA 4 AÑOS",
  "24-0003": "Mantenimiento del Motor CADA 4 AÑOS",
  "26-0006": "Prueba Hidráulica ANUAL de líneas de carga/descarga, válvulas de carga y manifold",
  "26-0007": "Prueba Hidráulica ANUAL de la línea de Incendio",
};

const APROBO = "Humberto Portillo";       // aprobadoByName (paso APRUEBA)
const AUTORIZO = "Jorge Bael";            // autorizadoByName (paso AUTORIZA)
const EJECUTO = "Mantenimiento Barcazas"; // executedByName (cierre)

// ── Helpers ─────────────────────────────────────────────────────────────────
const norm = (s: string) => s.toLowerCase()
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9]+/g, " ").trim();
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

interface Plan { id: string; taskCode: string; title: string; }

class TokenError extends Error {}
async function apiCall<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE_URL + path, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (res.status === 401) throw new TokenError(`401 en ${method} ${path}`);
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : null) as T;
}

async function loadPlans(vessel: string): Promise<Plan[]> {
  const p = await apiCall<{ items: Plan[] }>("GET", `/app/pms/maintenance-plans?vesselCode=${vessel}&limit=500`);
  return p.items;
}

/** Mapea título de OT → plan por título normalizado (manual, exacto, luego contains). */
function matchPlan(title: string, plans: Plan[], suffix: string): { plan: Plan | null; how: string; options: Plan[] } {
  if (MANUAL_MAP[suffix]) {
    const nm = norm(MANUAL_MAP[suffix]);
    const p = plans.find(pl => norm(pl.title) === nm) ?? null;
    return { plan: p, how: "manual", options: p ? [p] : [] };
  }
  const nt = norm(title);
  let hits = plans.filter(p => norm(p.title) === nt);
  if (hits.length === 1) return { plan: hits[0], how: "exact", options: hits };
  if (hits.length > 1) return { plan: hits[0], how: "exact-multi", options: hits }; // mismo título = mismo plan (OK)
  hits = plans.filter(p => { const np = norm(p.title); return np && (nt.includes(np) || np.includes(nt)); });
  if (hits.length === 1) return { plan: hits[0], how: "contains", options: hits };
  return { plan: null, how: hits.length > 1 ? "ambiguous" : "none", options: hits };
}

interface FireResult {
  vessel: string; excelCode: string; planTaskCode: string; woId: string; apiCode: string;
  openDate: string; dueDate: string; startDate: string; completedDate: string;
  aprobadoAt: string; autorizadoAt: string;
}

async function fire(vessel: string, tpl: Tpl, plan: Plan): Promise<FireResult> {
  const excelCode = `SS-${vessel}-${tpl.suffix}`;
  // Campos pesados NO se pasan: los hereda del plan. Solo livianos + backdating.
  const created = await apiCall<{ id: string; workOrderCode: string }>(
    "POST", `/app/pms/maintenance-plans/${plan.id}/open-work-order`,
    { title: tpl.title, openDate: tpl.open, dueDate: tpl.due, estimatedHours: tpl.est, priority: "MEDIUM" },
  );
  await sleep(SLEEP_MS);
  await apiCall("POST", `/app/pms/work-orders/${created.id}/approval`, { step: "APRUEBA", name: APROBO });
  await sleep(SLEEP_MS);
  await apiCall("POST", `/app/pms/work-orders/${created.id}/approval`, { step: "AUTORIZA", name: AUTORIZO });
  await sleep(SLEEP_MS);
  await apiCall("POST", `/app/pms/work-orders/${created.id}/close`, {
    woResult: "SATISFACTORY", executedByName: EJECUTO, completedDate: tpl.completed, actualHours: tpl.est,
  });
  return {
    vessel, excelCode, planTaskCode: plan.taskCode, woId: created.id, apiCode: created.workOrderCode,
    openDate: tpl.open, dueDate: tpl.due, startDate: tpl.start, completedDate: tpl.completed,
    aprobadoAt: tpl.completed, autorizadoAt: tpl.completed,
  };
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  if (!TOKEN) { console.error("Falta GPMS_TOKEN."); process.exit(1); }

  console.log(`\n========== CARGA OT GEMELAS (${LIVE ? "LIVE" : "DRY-RUN"}) ==========`);
  console.log(`Base:     ${BASE_URL}`);
  console.log(`Barcazas: ${VESSELS.join(", ")}`);
  console.log(`Plantillas: ${TEMPLATES.length} OT por barcaza\n`);

  // Resolver mapeo por barcaza
  const jobs: { vessel: string; tpl: Tpl; plan: Plan }[] = [];
  let unresolved = 0;
  for (const vessel of VESSELS) {
    const plans = await loadPlans(vessel);
    console.log(`-- ${vessel}: ${plans.length} planes --`);
    for (const tpl of TEMPLATES) {
      const m = matchPlan(tpl.title, plans, tpl.suffix);
      if (m.plan) {
        jobs.push({ vessel, tpl, plan: m.plan });
        console.log(`  ✓ ${tpl.suffix} [${m.how}] "${tpl.title.slice(0, 50)}" → ${m.plan.taskCode}`);
      } else {
        unresolved++;
        console.log(`  ✗ ${tpl.suffix} [${m.how}] "${tpl.title.slice(0, 50)}" — SIN PLAN`);
      }
    }
    console.log("");
  }

  console.log(`Resueltas: ${jobs.length} | Sin resolver: ${unresolved}`);

  if (!LIVE) {
    console.log(`\n(Para ejecutar: GPMS_TOKEN=<token> npx tsx scripts/load-yt-sister-wos.ts --live)\n`);
    return;
  }
  if (unresolved > 0) { console.error(`\n!! Hay ${unresolved} OT sin plan. Revisá los títulos antes de --live. Abortando.`); process.exit(1); }

  // ── LIVE ──
  // Dedupe idempotente: saltear códigos que ya existan en la barcaza.
  const existingByVessel: Record<string, Set<string>> = {};
  for (const vessel of VESSELS) {
    const ex = await apiCall<{ items: { workOrderCode: string }[] }>("GET", `/app/pms/work-orders?vesselCode=${vessel}&limit=1000`);
    existingByVessel[vessel] = new Set(ex.items.map(w => w.workOrderCode));
  }
  const pending = jobs.filter(j => !existingByVessel[j.vessel].has(`SS-${j.vessel}-${j.tpl.suffix}`));
  console.log(`\nDedupe: ${jobs.length - pending.length} ya existen, ${pending.length} pendientes.`);

  // Orden cronológico (por completed) para que la secuencia de códigos API sea coherente.
  pending.sort((a, b) => (a.tpl.completed < b.tpl.completed ? -1 : 1));

  console.log(`\n########## LIVE — ${pending.length} OT en ${BASE_URL} ##########\n`);
  const results = { ok: [] as FireResult[], errors: [] as { vessel: string; code: string; error: string }[] };
  const flush = () => writeFileSync(OUT, JSON.stringify(results, null, 2), "utf8");
  let done = 0;
  for (const { vessel, tpl, plan } of pending) {
    try {
      const r = await fire(vessel, tpl, plan);
      results.ok.push(r); done++;
      console.log(`  [${done}/${pending.length}] OK ${r.excelCode} → ${plan.taskCode} (api ${r.apiCode})`);
    } catch (err) {
      if (err instanceof TokenError) { console.error(`\n!! TOKEN inválido/expirado. Abortando (idempotente, reintentá).`); flush(); process.exit(2); }
      const msg = err instanceof Error ? err.message : String(err);
      results.errors.push({ vessel, code: `SS-${vessel}-${tpl.suffix}`, error: msg });
      console.error(`  ERR SS-${vessel}-${tpl.suffix}: ${msg}`);
    }
    if (done % 10 === 0) flush();
    await sleep(SLEEP_MS);
  }
  flush();
  console.log(`\n========== RESUMEN ==========`);
  console.log(`OK: ${results.ok.length} | Errores: ${results.errors.length}`);
  console.log(`Resultado → ${OUT}`);
  console.log(`Fase 2: copiar ${OUT} al VPS y correr: npx tsx scripts/backdate-wo-migration.ts ${OUT}`);
}

main().catch(e => { console.error(e); process.exit(1); });
