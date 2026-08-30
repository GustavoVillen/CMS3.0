/**
 * Migración de WO históricas desde MisDocs/SOLICITUDSERVICIOS.xlsx → planes de M01.
 *
 * Fase 1 (este script):
 *   - Mapea cada WO (por título = nombreAsset + títuloPlan) a un plan existente.
 *   - DRY-RUN (default): reporta mapeo, casos borde y conteos. No escribe nada.
 *   - --live: por cada WO, en orden cronológico, maneja el ciclo real de la API
 *     (open-work-order → APRUEBA → AUTORIZA → close) con los DATOS DEL EXCEL.
 *     Vuelca wo-migration-results.json (woId + código del Excel + fechas reales).
 *
 * Fase 2 (scripts/backdate-wo-migration.ts, en el VPS):
 *   - Retro-fecha timestamps y SOBRESCRIBE workOrderCode con el del Excel.
 *
 * Uso:
 *   npx tsx scripts/migrate-wo-from-ss.ts                 # dry-run (offline, usa JSON dumps)
 *   GPMS_TOKEN=<token> npx tsx scripts/migrate-wo-from-ss.ts --live
 *
 * Requiere (para dry-run): MisDocs/m01-plans.json y MisDocs/m01-assets.json.
 */
import ExcelJS from "exceljs";
import { readFileSync, writeFileSync } from "node:fs";

// ── Config ────────────────────────────────────────────────────────────────────
const BASE_URL = process.env.BASE_URL || "https://mercurio.cms3.shipcms.cloud";
const TOKEN = process.env.GPMS_TOKEN || "";
const VESSEL = process.env.VESSEL_CODE || "M01";
const SLEEP_MS = Number(process.env.SLEEP_MS || 250);
const EXCEL = process.env.EXCEL_FILE || "MisDocs/SOLICITUDSERVICIOS.xlsx";
const OUT = process.env.OUT_FILE || "wo-migration-results.json";
const args = process.argv.slice(2);
const LIVE = args.includes("--live");
const LIMIT = (() => { const a = args.find(x => x.startsWith("--limit=")); return a ? Number(a.split("=")[1]) : null; })();

// Casos borde resueltos a mano (título WO normalizado → taskCode del plan).
// Se completan tras ver los candidatos en el dry-run.
const MANUAL_MAP: Record<string, string> = {
  "detectores de humo calor inspeccion anual": "M01-DET-HUMO-03",
  "detectores de humo calor mantenimiento cada 60 meses": "M01-DET-HUMO-04",
  "sistema de gobierno y maniobra mantenimiento cada 5 anos": "M01-HID-GOB-08",
};

// ── Helpers ──────────────────────────────────────────────────────────────────
const norm = (s: string) => s.toLowerCase()
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9]+/g, " ").trim();
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function cellText(c: any): string {
  if (c == null) return "";
  if (typeof c === "object") {
    if ("text" in c) return String((c as any).text);
    if ("result" in c) return String((c as any).result);
    if ("richText" in c) return ((c as any).richText as any[]).map(r => r.text).join("");
  }
  return String(c);
}
const num = (s: string): number | null => { const n = Number(s); return s.trim() && !Number.isNaN(n) ? n : null; };
const dateOnly = (s: string): string | null => { const d = cellText(s).slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null; };

// ── Tipos ──────────────────────────────────────────────────────────────────────
interface Plan { id: string; taskCode: string; title: string; assetId: string | null; }
interface Asset { id: string; assetCode: string; name: string; }
interface WoRow {
  rowNumber: number;
  workOrderCode: string; title: string;
  openDate: string | null; dueDate: string | null; startDate: string | null; completedDate: string | null;
  aprobadoAt: string | null; autorizadoAt: string | null;
  estimatedHours: number | null; actualHours: number | null;
  description: string; closeNotes: string; observations: string;
  assignedToUserId: string; executedByName: string;
  aprobadoByName: string; autorizadoByName: string;
  woResult: string; priority: string;
  acceptanceCriteria: string; loto: string; riskLevel: string; riskAnalysisResult: string;
  consequenceCategory: string; consequenceRationale: string;
}

// ── HTTP ────────────────────────────────────────────────────────────────────────
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

// ── Carga de planes/assets (JSON dump para dry-run, API para live) ──────────────
async function loadPlansAssets(fromApi: boolean): Promise<{ plans: Plan[]; assets: Asset[] }> {
  if (fromApi) {
    const p = await apiCall<{ items: Plan[] }>("GET", `/app/pms/maintenance-plans?vesselCode=${VESSEL}`);
    const a = await apiCall<{ items: Asset[] }>("GET", `/app/pms/assets?vesselCode=${VESSEL}&limit=500`);
    return { plans: p.items, assets: a.items };
  }
  return {
    plans: JSON.parse(readFileSync("MisDocs/m01-plans.json", "utf8")),
    assets: JSON.parse(readFileSync("MisDocs/m01-assets.json", "utf8")),
  };
}

// ── Lectura del Excel ───────────────────────────────────────────────────────────
async function loadWoRows(): Promise<WoRow[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(EXCEL);
  const ws = wb.worksheets[0];
  const header = (ws.getRow(1).values as any[]).map(h => (h == null ? "" : String(h).trim()));
  const I = (name: string) => header.indexOf(name);
  const cols = {
    workOrderCode: I("workOrderCode"), title: I("title"),
    openDate: I("openDate"), dueDate: I("dueDate"), startDate: I("startDate"), completedDate: I("completedDate"),
    estimatedHours: I("estimatedHours"), actualHours: I("actualHours"),
    description: I("description"), closeNotes: I("closeNotes"), observations: I("observations"),
    aprobadoAt: I("aprobadoAt"), autorizadoAt: I("autorizadoAt"),
    assignedToUserId: I("assignedToUserId"), executedByName: I("executedByName"),
    aprobadoByName: I("aprobadoByName"), autorizadoByName: I("autorizadoByName"),
    woResult: I("woResult"), priority: I("priority"),
    acceptanceCriteria: I("acceptanceCriteria"), loto: I("loto"), riskLevel: I("riskLevel"),
    riskAnalysisResult: I("riskAnalysisResult"), consequenceCategory: I("consequenceCategory"),
    consequenceRationale: I("consequenceRationale"),
  };
  const rows: WoRow[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const v = ws.getRow(r).values as any[];
    if (!v || v.filter(x => x != null && cellText(x).trim() !== "").length === 0) continue;
    const g = (i: number) => cellText(v[i]).trim();
    rows.push({
      rowNumber: r,
      workOrderCode: g(cols.workOrderCode), title: g(cols.title),
      openDate: dateOnly(g(cols.openDate)), dueDate: dateOnly(g(cols.dueDate)),
      startDate: dateOnly(g(cols.startDate)), completedDate: dateOnly(g(cols.completedDate)),
      aprobadoAt: dateOnly(g(cols.aprobadoAt)), autorizadoAt: dateOnly(g(cols.autorizadoAt)),
      estimatedHours: num(g(cols.estimatedHours)), actualHours: num(g(cols.actualHours)),
      description: g(cols.description), closeNotes: g(cols.closeNotes), observations: g(cols.observations),
      assignedToUserId: g(cols.assignedToUserId), executedByName: g(cols.executedByName),
      aprobadoByName: g(cols.aprobadoByName), autorizadoByName: g(cols.autorizadoByName),
      woResult: g(cols.woResult) || "SATISFACTORY", priority: g(cols.priority),
      acceptanceCriteria: g(cols.acceptanceCriteria), loto: g(cols.loto), riskLevel: g(cols.riskLevel),
      riskAnalysisResult: g(cols.riskAnalysisResult), consequenceCategory: g(cols.consequenceCategory),
      consequenceRationale: g(cols.consequenceRationale),
    });
  }
  return rows;
}

// ── Mapeo título → plan ─────────────────────────────────────────────────────────
interface Candidate { plan: Plan; asset: Asset | null; normFull: string; normTitle: string; normAsset: string; }
function buildCandidates(plans: Plan[], assets: Asset[]): Candidate[] {
  const byId = new Map(assets.map(a => [a.id, a]));
  return plans.map(p => {
    const a = p.assetId ? byId.get(p.assetId) ?? null : null;
    return { plan: p, asset: a, normFull: norm(`${a?.name ?? ""} ${p.title}`), normTitle: norm(p.title), normAsset: norm(a?.name ?? "") };
  });
}
function matchTitle(title: string, cands: Candidate[]): { plan: Plan | null; how: string; options: Plan[] } {
  const nt = norm(title);
  if (MANUAL_MAP[nt]) {
    const p = cands.find(c => c.plan.taskCode === MANUAL_MAP[nt])?.plan ?? null;
    return { plan: p, how: "manual", options: p ? [p] : [] };
  }
  let hits = cands.filter(c => c.normFull === nt);
  if (hits.length === 1) return { plan: hits[0].plan, how: "exact", options: [hits[0].plan] };
  if (hits.length === 0) hits = cands.filter(c => c.normAsset && c.normTitle && nt.includes(c.normAsset) && nt.includes(c.normTitle));
  if (hits.length === 1) return { plan: hits[0].plan, how: "contains", options: [hits[0].plan] };
  return { plan: null, how: hits.length > 1 ? "ambiguous" : "none", options: hits.map(h => h.plan) };
}
// Sugerencias por solape de tokens (para resolver casos sin match)
function suggest(title: string, cands: Candidate[], k = 3): { taskCode: string; plan: string; score: number }[] {
  const toks = new Set(norm(title).split(" ").filter(Boolean));
  return cands.map(c => {
    const ct = new Set(c.normFull.split(" ").filter(Boolean));
    let inter = 0; for (const t of toks) if (ct.has(t)) inter++;
    return { taskCode: c.plan.taskCode, plan: `${c.asset?.name ?? "?"} · ${c.plan.title}`, score: inter / Math.max(1, toks.size) };
  }).sort((a, b) => b.score - a.score).slice(0, k);
}

// ── Ciclo de una WO via API ──────────────────────────────────────────────────────
interface FireResult {
  rowNumber: number; excelCode: string; planTaskCode: string; woId: string; apiCode: string;
  openDate: string | null; dueDate: string | null; startDate: string | null; completedDate: string | null;
  aprobadoAt: string | null; autorizadoAt: string | null;
}
async function fire(wo: WoRow, plan: Plan): Promise<FireResult> {
  const created = await apiCall<{ id: string; workOrderCode: string }>(
    "POST", `/app/pms/maintenance-plans/${plan.id}/open-work-order`,
    {
      title: wo.title || plan.title,
      dueDate: wo.dueDate ?? wo.completedDate ?? wo.openDate,
      estimatedHours: wo.estimatedHours,
      assignedToUserId: wo.assignedToUserId || null,
      description: wo.description || undefined,
      priority: wo.priority || undefined,
      acceptanceCriteria: wo.acceptanceCriteria || undefined,
      loto: wo.loto || undefined,
      riskLevel: wo.riskLevel || undefined,
      riskAnalysisResult: wo.riskAnalysisResult || undefined,
      consequenceCategory: wo.consequenceCategory || undefined,
      consequenceRationale: wo.consequenceRationale || undefined,
    },
  );
  await sleep(SLEEP_MS);
  if (wo.observations || wo.closeNotes) {
    await apiCall("POST", `/app/pms/work-orders/${created.id}/progress-notes?kind=TEXT`, { text: wo.observations || wo.closeNotes });
    await sleep(SLEEP_MS);
  }
  await apiCall("POST", `/app/pms/work-orders/${created.id}/approval`, { step: "APRUEBA", name: wo.aprobadoByName || "Jefe de Maquinas" });
  await sleep(SLEEP_MS);
  await apiCall("POST", `/app/pms/work-orders/${created.id}/approval`, { step: "AUTORIZA", name: wo.autorizadoByName || "Gerente de Mantenimiento" });
  await sleep(SLEEP_MS);
  await apiCall("POST", `/app/pms/work-orders/${created.id}/close`, {
    woResult: wo.woResult === "WITH_DEFICIENCIES" ? "WITH_DEFICIENCIES" : "SATISFACTORY",
    executedByName: wo.executedByName || wo.assignedToUserId || null,
    completedDate: wo.completedDate ?? wo.openDate,
    actualHours: wo.actualHours,
    observations: wo.observations || wo.closeNotes || undefined,
  });
  return {
    rowNumber: wo.rowNumber, excelCode: wo.workOrderCode, planTaskCode: plan.taskCode,
    woId: created.id, apiCode: created.workOrderCode,
    openDate: wo.openDate, dueDate: wo.dueDate, startDate: wo.startDate, completedDate: wo.completedDate,
    aprobadoAt: wo.aprobadoAt, autorizadoAt: wo.autorizadoAt,
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────────
async function main() {
  if (LIVE && !TOKEN) { console.error("Falta GPMS_TOKEN para --live."); process.exit(1); }

  const { plans, assets } = await loadPlansAssets(LIVE);
  const cands = buildCandidates(plans, assets);
  const rows = await loadWoRows();

  // Resolver mapeo por fila
  const resolved: { wo: WoRow; plan: Plan }[] = [];
  const unresolved: { wo: WoRow; how: string; options: Plan[] }[] = [];
  const codeSeen = new Set<string>();
  const dupCodes: string[] = [];
  for (const wo of rows) {
    if (codeSeen.has(wo.workOrderCode)) dupCodes.push(wo.workOrderCode); else codeSeen.add(wo.workOrderCode);
    const m = matchTitle(wo.title, cands);
    if (m.plan) resolved.push({ wo, plan: m.plan });
    else unresolved.push({ wo, how: m.how, options: m.options });
  }

  console.log(`\n========== MIGRACIÓN WO ${VESSEL} (${LIVE ? "LIVE" : "DRY-RUN"}) ==========`);
  console.log(`Filas Excel:        ${rows.length}`);
  console.log(`Planes / Assets:    ${plans.length} / ${assets.length}  (fuente: ${LIVE ? "API" : "JSON dump"})`);
  console.log(`Resueltas a plan:   ${resolved.length}`);
  console.log(`Sin resolver:       ${unresolved.length}`);
  console.log(`Códigos duplicados en Excel: ${dupCodes.length}${dupCodes.length ? " → " + dupCodes.slice(0, 10).join(", ") : ""}`);

  if (unresolved.length) {
    console.log(`\n-- SIN RESOLVER (con sugerencias por solape) --`);
    const seenTitles = new Set<string>();
    for (const u of unresolved) {
      const key = norm(u.wo.title);
      if (seenTitles.has(key)) continue; seenTitles.add(key);
      console.log(`\n  [${u.how}] "${u.wo.title.slice(0, 75)}"`);
      if (u.options.length > 1) u.options.forEach(o => console.log(`     candidato: ${o.taskCode} · ${o.title}`));
      for (const s of suggest(u.wo.title, cands)) console.log(`     sugerencia ${(s.score * 100).toFixed(0)}%: ${s.taskCode} · ${s.plan.slice(0, 60)}`);
    }
    console.log(`\n  → Completá MANUAL_MAP en el script con: norm(título) → taskCode\n`);
  }

  if (!LIVE) {
    console.log(`\n-- Muestra de resueltas (primeras 5) --`);
    for (const { wo, plan } of resolved.slice(0, 5))
      console.log(`  ${wo.workOrderCode} [${wo.completedDate}] "${wo.title.slice(0, 45)}" → ${plan.taskCode}`);
    console.log(`\n(Para ejecutar: GPMS_TOKEN=<token> npx tsx scripts/migrate-wo-from-ss.ts --live)\n`);
    return;
  }

  // ── LIVE ──
  if (unresolved.length) { console.error(`\n!! Hay ${unresolved.length} sin resolver. Completá MANUAL_MAP antes de --live. Abortando.`); process.exit(1); }

  // Dedupe idempotente: saltear WOs cuyo código del Excel YA exista en el sistema.
  // (Requiere haber backdateado las corridas previas para que tengan su código del Excel.)
  const existing = await apiCall<{ items: { workOrderCode: string }[] }>("GET", `/app/pms/work-orders?vesselCode=${VESSEL}`);
  const existingCodes = new Set(existing.items.map(w => w.workOrderCode));
  const before = resolved.length;
  let pending = resolved.filter(({ wo }) => !existingCodes.has(wo.workOrderCode));
  if (before - pending.length > 0) console.log(`Dedupe: ${before - pending.length} ya existen (saltadas), ${pending.length} pendientes.`);

  let jobs = pending.sort((a, b) =>
    (a.wo.completedDate ?? a.wo.openDate ?? "") < (b.wo.completedDate ?? b.wo.openDate ?? "") ? -1 : 1);
  if (LIMIT != null) { console.log(`[--limit=${LIMIT}]`); jobs = jobs.slice(0, LIMIT); }

  console.log(`\n########## LIVE — ${jobs.length} WO en ${BASE_URL} ##########\n`);
  const results = { ok: [] as FireResult[], errors: [] as { row: number; code: string; error: string }[] };
  const flush = () => writeFileSync(OUT, JSON.stringify(results, null, 2), "utf8");
  let done = 0;
  for (const { wo, plan } of jobs) {
    try {
      const r = await fire(wo, plan);
      results.ok.push(r); done++;
      console.log(`  [${done}/${jobs.length}] OK ${wo.workOrderCode} → ${plan.taskCode} (api ${r.apiCode})`);
    } catch (err) {
      if (err instanceof TokenError) { console.error(`\n!! TOKEN inválido/expirado. Abortando (idempotente, reintentá).`); flush(); process.exit(2); }
      const msg = err instanceof Error ? err.message : String(err);
      results.errors.push({ row: wo.rowNumber, code: wo.workOrderCode, error: msg });
      console.error(`  [${done}/${jobs.length}] ERR ${wo.workOrderCode}: ${msg}`);
    }
    if (done % 25 === 0) flush();
    await sleep(SLEEP_MS);
  }
  flush();
  console.log(`\n========== RESUMEN ==========`);
  console.log(`OK: ${results.ok.length} | Errores: ${results.errors.length}`);
  console.log(`Resultado → ${OUT}`);
  console.log(`Fase 2: copiar ${OUT} al VPS y correr scripts/backdate-wo-migration.ts`);
}

main().catch(e => { console.error(e); process.exit(1); });
