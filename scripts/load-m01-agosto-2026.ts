/**
 * Carga en MAO 01 (M01) el avance registrado en las planillas de AGOSTO 2026
 * ("plan de mantenimiento - AGOSTO 2026", hojas 'plan de mantenimiento' y
 * 'equipos criticos'), como ORDENES DE TRABAJO COMPLETAS Y CERRADAS.
 *
 * POR QUE ASI Y NO ESCRIBIENDO LA FECHA: si sólo se toca lastExecutionDate, el
 * plan dice "se hizo" y no hay con qué probarlo. La OT cerrada es la evidencia
 * que se le muestra al auditor. Además, cerrar por API hace que el backend
 * recalcule solo el próximo vencimiento, con la misma lógica que usa la
 * tripulación.
 *
 * Reusa el ciclo de scripts/simulate-wo-history.ts (abrir -> avance -> APRUEBA ->
 * AUTORIZA -> cerrar), pero NO simula un reloj: va con la tabla explícita de
 * abajo, sacada fila por fila de la planilla. Lo que el papel no declara hecho,
 * no se carga.
 *
 * DESPUES DE CORRER ESTO: los timestamps quedan estampados en "hoy". Hay que
 * retro-fecharlos con la fase 2, que ya existe:
 *   npx tsx scripts/backdate-wos-bulk.ts wo_results.json
 *
 * Uso:
 *   GPMS_TOKEN=<token de un TENANT_ADMIN de mercurio> npx tsx scripts/load-m01-agosto-2026.ts
 *   GPMS_TOKEN=... npx tsx scripts/load-m01-agosto-2026.ts --live
 */

import { writeFileSync } from "node:fs";
import { buildOpenContent, buildExecutionContent, baseHours, type PlanLike } from "./sim-content-gen";

const BASE_URL = process.env.BASE_URL || "https://mercurio.cms3.shipcms.cloud";
const TOKEN = process.env.GPMS_TOKEN || "";
const VESSEL_CODE = process.env.VESSEL_CODE || "M01";
const OUT_FILE = process.env.OUT_FILE || "wo_results.json";
const SLEEP_MS = Number(process.env.SLEEP_MS || 300);
const LIVE = process.argv.includes("--live");

// Firmas del ciclo, tal como vienen de la planilla de agosto.
const RESPONSIBLE = "Rene Cano";
const EXECUTOR = "Rene Cano";
const APPROVER = "Rene Cano";
const AUTHORIZER = "Jorge Bael";

type Resultado = "SATISFACTORY" | "SATISFACTORY_WITH_OBSERVATIONS";

interface Entrada {
  taskCode: string;
  fecha: string; // YYYY-MM-DD, la que dice la planilla
  origen: string; // de qué fila del papel sale, para poder auditarlo después
  resultado?: Resultado;
  observaciones?: string;
  horas?: number;
}

/**
 * LO QUE LA PLANILLA DE AGOSTO DECLARA HECHO.
 *
 * Las rutinas semanales y mensuales de máquinas hoy viven en dos checklists
 * consolidados (M01-6-001 y M01-6-002); por eso una sola OT del checklist cubre
 * las decenas de renglones que el papel lista por equipo.
 */
const CARGA: Entrada[] = [
  // ── Ronda SEMANAL de máquinas: las 4 semanas de agosto ────────────────────────
  { taskCode: "M01-6-001", fecha: "2026-08-05", origen: "equipos criticos, semana 1 (05/08)" },
  { taskCode: "M01-6-001", fecha: "2026-08-12", origen: "equipos criticos, semana 2 (12/08)" },
  { taskCode: "M01-6-001", fecha: "2026-08-19", origen: "equipos criticos, semana 3 (19/08)" },
  { taskCode: "M01-6-001", fecha: "2026-08-26", origen: "equipos criticos, semana 4 (26/08)" },

  // ── Ronda MENSUAL de máquinas ─────────────────────────────────────────────────
  {
    taskCode: "M01-6-002",
    fecha: "2026-08-30",
    origen: "equipos criticos + plan de maquinas, mensuales del 26 al 31/08",
    resultado: "SATISFACTORY_WITH_OBSERVATIONS",
    observaciones:
      "Quedan sin probar por reparaciones en curso (declarado 'stand by' en la planilla de agosto): " +
      "seguridades de MP Estribor y MP Babor, seguridades de MA Estribor y MA Babor, y gobierno de emergencia de ambos MP. " +
      "La Bomba de Incendio de Emergencia figura DESMONTADA y el Tanque de Residuos de la Purificadora, desmontado y desembarcado.",
  },

  // ── Tareas con plan propio y fecha propia en la planilla ──────────────────────
  { taskCode: "M01-8-002", fecha: "2026-08-29", origen: "plan de maquinas fila 213 — control de ajustes generales" },
  { taskCode: "M01-FILT-MAR-01", fecha: "2026-08-28", origen: "plan de maquinas fila 171 — filtros tomas de mar" },
  { taskCode: "M01-VGA-01", fecha: "2026-08-20", origen: "equipos criticos item 8 — precintos de valvulas de gran achique" },
  { taskCode: "M01-COMP-PITO-02", fecha: "2026-08-01", origen: "plan de maquinas fila 187 — cambio de aceite compresor del pito" },
  {
    taskCode: "M01-HID-GOB-07",
    fecha: "2026-08-30",
    origen: "plan de maquinas filas 191 y 197 — engrase de transmision antagonica y guinches",
    resultado: "SATISFACTORY_WITH_OBSERVATIONS",
    observaciones:
      "Engrase y control de flexibles de la transmision antagonica y de los guinches de maniobra: realizados. " +
      "Timon de emergencia y operacion EGA de motores principales: NO probados, en 'stand by' por reparaciones segun la planilla de agosto.",
  },

  // ── Fechas que la planilla de agosto corrige respecto de lo cargado ───────────
  { taskCode: "M01-7-018", fecha: "2026-03-15", origen: "plan de maquinas fila 194 — filtros de aceite del circuito hidraulico" },
  { taskCode: "M01-RADAR-BR-01", fecha: "2026-04-15", origen: "plan de maquinas fila 242 — radar de babor" },
  { taskCode: "M01-VHF-BR-01", fecha: "2026-04-15", origen: "plan de maquinas fila 257 — radio VHF babor" },
  { taskCode: "M01-VHF-ER-01", fecha: "2026-04-15", origen: "plan de maquinas fila 260 — radio VHF estribor" },
];

/**
 * Lo que la planilla de agosto declara NO hecho. No se carga nada por estos:
 * se imprimen al final para que quede constancia de por qué el plan no avanza.
 */
const NO_REALIZADO: { que: string; motivo: string }[] = [
  { que: "Seguridades de MP Estribor y MP Babor (alarmas LED P-T, parada EGA)", motivo: "stand by por reparaciones" },
  { que: "Seguridades de MA Estribor y MA Babor (alarmas Vigia)", motivo: "stand by por reparaciones" },
  { que: "Gobierno de emergencia de MP Estribor y MP Babor", motivo: "stand by por reparaciones" },
  { que: "Operacion EGA de motores principales (telegrafo y acelerador)", motivo: "stand by por reparaciones" },
  { que: "Timon de emergencia", motivo: "stand by por reparaciones" },
  { que: "Bomba de Incendio de Emergencia acoplada a MP", motivo: "DESMONTADA" },
  { que: "Tanque de Residuos de la Purificadora G.O.", motivo: "desmontado / desembarcado" },
];

// ── API ─────────────────────────────────────────────────────────────────────────
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

/**
 * Firma un paso del circuito tolerando que ya esté firmado.
 *
 * Una OT de INSPECCION nace enviada, aprobada y autorizada a nombre de "Sistema"
 * por regla de negocio (apps/api/src/tenant/work-orders/wo-inspection-flow.ts):
 * la inspeccion la hace la propia tripulacion y no compromete gasto. En esas no
 * hay nada que firmar y el 409 ALREADY_* es la respuesta correcta, no un error.
 */
async function firmar(woId: string, step: "ENVIA" | "APRUEBA" | "AUTORIZA", name: string, fecha: string): Promise<"firmado" | "ya estaba"> {
  try {
    await api("POST", `/app/pms/work-orders/${woId}/approval`, { step, name, actionDate: fecha });
    return "firmado";
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    if (/ALREADY_SUBMITTED|ALREADY_APPROVED|ALREADY_AUTHORIZED/.test(msg)) return "ya estaba";
    throw err;
  }
}

interface ApiPlan extends PlanLike {
  id: string;
  assetName?: string;
  triggerType: string;
  frequencyMonths?: number | null;
  frequencyHours?: number | null;
  lastExecutionDate?: string | null;
  nextDueDate?: string | null;
  /** Si el plan declara area PROVEEDOR, al abrir la OT el backend crea la SS solo. */
  department?: string | null;
  providerId?: string | null;
  providerRequests?: { providerId: string; purpose?: string }[] | null;
}

/** La lista de planes viene recortada (sin LOTO/criterios/riesgo). El detalle los trae. */
async function planDetalle(id: string): Promise<ApiPlan> {
  return api<ApiPlan>("GET", `/app/pms/maintenance-plans/${id}`);
}

/** Cuantas SS va a generar la apertura de la OT de este plan. */
function ssDelPlan(p: ApiPlan): number {
  if (Array.isArray(p.providerRequests) && p.providerRequests.length) return p.providerRequests.length;
  if (p.department === "PROVEEDOR" && p.providerId) return 1;
  return 0;
}

interface FireResult {
  taskCode: string;
  planId: string;
  woId: string;
  workOrderCode: string;
  simDay: string;
  firmas?: string;
}

/**
 * Toda OT que se llegó a abrir, aunque después falle un paso. Sin esto, una
 * corrida cortada a la mitad deja OT sueltas en la base y ningún registro de
 * cuáles son. Se vuelca a wo_results.json para poder limpiarlas con
 * scripts/delete-wos-by-id.ts.
 */
const creadas: { taskCode: string; woId: string; workOrderCode: string }[] = [];

async function fire(plan: ApiPlan, e: Entrada, occ: number): Promise<FireResult> {
  // Todos los campos de la OT: los que el plan ya trae se heredan, los que faltan
  // los completa el mismo generador que usa scripts/simulate-wo-history.ts.
  const open = buildOpenContent(plan);
  const exec = buildExecutionContent(plan, open.riskLevel, occ);
  const horas = e.horas ?? baseHours(plan, open.riskLevel);

  // `openDate` retro-fecha la apertura (solo TENANT_ADMIN): la OT nace con la
  // fecha real del trabajo, sin necesidad de corregir timestamps despues.
  const wo = await api<{ id: string; workOrderCode: string }>(
    "POST",
    `/app/pms/maintenance-plans/${plan.id}/open-work-order`,
    {
      title: plan.title,
      openDate: e.fecha,
      dueDate: e.fecha,
      estimatedHours: horas,
      assignedToUserId: RESPONSIBLE,
      description: `${open.description}\n\nOrigen del registro: planilla de mantenimiento de agosto 2026 del R/E MAO 01 — ${e.origen}.`,
      acceptanceCriteria: open.acceptanceCriteria,
      loto: open.loto,
      riskLevel: open.riskLevel,
      riskAnalysisResult: open.riskAnalysisResult,
      consequenceCategory: open.consequenceCategory,
      consequenceRationale: open.consequenceRationale,
    },
  );
  creadas.push({ taskCode: plan.taskCode, woId: wo.id, workOrderCode: wo.workOrderCode });
  await sleep(SLEEP_MS);

  await api("POST", `/app/pms/work-orders/${wo.id}/progress-notes?kind=TEXT`, {
    text: `${exec.avance} Registro trasladado desde la planilla de agosto 2026 con su fecha real de ejecucion.`,
  });
  await sleep(SLEEP_MS);

  // Circuito completo: ENVIA -> APRUEBA -> AUTORIZA, cada firma con su fecha real.
  const f1 = await firmar(wo.id, "ENVIA", EXECUTOR, e.fecha);
  await sleep(SLEEP_MS);
  const f2 = await firmar(wo.id, "APRUEBA", APPROVER, e.fecha);
  await sleep(SLEEP_MS);
  const f3 = await firmar(wo.id, "AUTORIZA", AUTHORIZER, e.fecha);
  await sleep(SLEEP_MS);
  const firmas = [f1, f2, f3].every((x) => x === "ya estaba")
    ? "autofirmada por regla de inspeccion"
    : `${EXECUTOR} / ${APPROVER} / ${AUTHORIZER}`;

  await api("POST", `/app/pms/work-orders/${wo.id}/close`, {
    woResult: e.resultado ?? "SATISFACTORY",
    executedByName: EXECUTOR,
    completedDate: e.fecha,
    actualHours: horas,
    observations: e.observaciones ?? exec.observations,
  });

  return { taskCode: plan.taskCode, planId: plan.id, woId: wo.id, workOrderCode: wo.workOrderCode, simDay: e.fecha, firmas };
}

// ── main ────────────────────────────────────────────────────────────────────────
async function main() {
  if (!TOKEN) {
    console.error("Falta GPMS_TOKEN (token de sesion de un TENANT_ADMIN de mercurio).");
    process.exit(1);
  }

  console.log(`${LIVE ? "== LIVE ==" : "== DRY-RUN (no se crea nada) =="}  ${BASE_URL}  buque=${VESSEL_CODE}\n`);

  const data = await api<{ items: ApiPlan[]; total: number }>("GET", `/app/pms/maintenance-plans?vesselCode=${VESSEL_CODE}`);
  const plans = data.items;
  const porCodigo = new Map(plans.map((p) => [p.taskCode, p]));
  console.log(`Planes vivos de ${VESSEL_CODE}: ${plans.length}\n`);

  // OTs ya cargadas, para no duplicar si el script se corre dos veces.
  const existing = await api<{ items: { maintenancePlanId: string | null; completedDate: string | null }[] }>(
    "GET",
    `/app/pms/work-orders?vesselCode=${VESSEL_CODE}`,
  );
  const yaCargado = new Set<string>();
  for (const w of existing.items) {
    if (w.maintenancePlanId && w.completedDate) yaCargado.add(`${w.maintenancePlanId}|${w.completedDate.slice(0, 10)}`);
  }
  console.log(`OTs existentes en el buque: ${existing.items.length}\n`);

  const aCargar: { plan: ApiPlan; e: Entrada }[] = [];
  const omitidas: { e: Entrada; motivo: string }[] = [];

  for (const e of CARGA) {
    const plan = porCodigo.get(e.taskCode);
    if (!plan) {
      omitidas.push({ e, motivo: "el plan no existe o no esta vivo" });
      continue;
    }
    if (yaCargado.has(`${plan.id}|${e.fecha}`)) {
      omitidas.push({ e, motivo: "ya hay una OT cerrada de ese plan en esa fecha" });
      continue;
    }
    aCargar.push({ plan, e });
  }

  // El detalle trae los campos que la lista recorta (LOTO, criterios, riesgo) y el
  // area/proveedor, que es lo que decide si ademas de la OT sale una SS.
  const detalles = new Map<string, ApiPlan>();
  for (const id of new Set(aCargar.map((x) => x.plan.id))) {
    try {
      detalles.set(id, await planDetalle(id));
    } catch {
      /* si el detalle falla se sigue con lo que trajo la lista */
    }
  }
  for (const x of aCargar) x.plan = { ...x.plan, ...(detalles.get(x.plan.id) ?? {}) };

  let totalSS = 0;
  console.log(`──── OT a generar (${aCargar.length}) ────`);
  for (const { plan, e } of aCargar) {
    const marca = e.resultado === "SATISFACTORY_WITH_OBSERVATIONS" ? " [con observaciones]" : "";
    const ss = ssDelPlan(plan);
    totalSS += ss;
    console.log(`  ${e.fecha}  ${e.taskCode.padEnd(18)} ${plan.title}${marca}`);
    console.log(`              ultima actual: ${plan.lastExecutionDate?.slice(0, 10) ?? "-"} · proxima actual: ${plan.nextDueDate?.slice(0, 10) ?? "-"}`);
    console.log(`              area: ${plan.department ?? "-"}${ss ? ` · genera ${ss} SS al abrir la OT` : " · sin SS (trabajo de a bordo)"}`);
    console.log(`              origen: ${e.origen}`);
  }
  console.log(`\n  Total: ${aCargar.length} OT y ${totalSS} SS.`);
  if (totalSS === 0) {
    console.log("  Ninguno de estos planes declara area PROVEEDOR, asi que no corresponde ninguna SS:");
    console.log("  todo el avance de agosto es trabajo de la tripulacion.");
  }

  if (omitidas.length) {
    console.log(`\n──── Omitidas (${omitidas.length}) ────`);
    for (const { e, motivo } of omitidas) console.log(`  ${e.fecha}  ${e.taskCode.padEnd(18)} ${motivo}`);
  }

  console.log(`\n──── Lo que la planilla declara NO hecho (no se carga nada) ────`);
  for (const n of NO_REALIZADO) console.log(`  · ${n.que} — ${n.motivo}`);

  if (!LIVE) {
    console.log("\nDRY-RUN: no se creo ninguna OT. Agregá --live para ejecutar.");
    return;
  }

  console.log(`\n########## LIVE — generando ${aCargar.length} OT ##########\n`);
  const results = { ok: [] as FireResult[], errors: [] as { taskCode: string; simDay: string; error: string }[] };

  // Cronológico: el backend recalcula el próximo vencimiento sobre la última cerrada.
  aCargar.sort((a, b) => (a.e.fecha < b.e.fecha ? -1 : a.e.fecha > b.e.fecha ? 1 : a.e.taskCode.localeCompare(b.e.taskCode)));

  // Contador por plan: le da variedad al texto de avance/observaciones cuando el
  // mismo plan se ejecuta varias veces (las 4 rondas semanales, por ejemplo).
  const occPorPlan = new Map<string, number>();

  for (const { plan, e } of aCargar) {
    const occ = occPorPlan.get(plan.taskCode) ?? 0;
    occPorPlan.set(plan.taskCode, occ + 1);
    try {
      const r = await fire(plan, e, occ);
      results.ok.push(r);
      console.log(`  OK  ${e.fecha}  ${e.taskCode.padEnd(18)} ${r.workOrderCode}  firmas: ${r.firmas}`);
    } catch (err: any) {
      if (err instanceof TokenError) {
        console.error(`\nToken vencido o invalido. Se cortó acá; lo hecho hasta ahora quedó en ${OUT_FILE}.`);
        break;
      }
      results.errors.push({ taskCode: e.taskCode, simDay: e.fecha, error: String(err?.message ?? err) });
      console.error(`  ERR ${e.fecha}  ${e.taskCode.padEnd(18)} ${err?.message ?? err}`);
    }
  }

  writeFileSync(OUT_FILE, JSON.stringify({ ...results, creadas }, null, 2), "utf8");
  console.log(`\nOT completas: ${results.ok.length} · errores: ${results.errors.length}`);
  console.log(`Resultado en ${OUT_FILE}.`);
  if (results.errors.length) {
    const aMedias = creadas.filter((c) => !results.ok.some((o) => o.woId === c.woId));
    if (aMedias.length) {
      console.log(`\nOT que quedaron a medio crear (${aMedias.length}). Para borrarlas:`);
      console.log(`  npx tsx scripts/delete-wos-by-id.ts ${aMedias.map((c) => c.woId).join(" ")}`);
    }
  }
}

main().catch((e) => {
  console.error("ERROR:", e);
  process.exit(1);
});
