// Textos de una OT que ejecuta VARIOS ítems del PDM.
//
// Con un solo plan la OT hereda el texto tal cual (comportamiento de siempre).
// Con varios, cada campo se arma como un bloque por ítem, encabezado por su
// código, para que el papel diga qué corresponde a qué:
//
//   M01-ALARM-TK-02 · Tanque diario G.O.: prueba de alarma de bajo nivel
//   M01-ALARM-TK-03 · Tanques de sedimentación G.O.: prueba de alarma de alto nivel
//
// Los dos campos que NO son texto libre (nivel de riesgo y consecuencia RCM) no
// se pueden concatenar: se toma el MÁS EXIGENTE de los planes incluidos. Bajar
// el riesgo de una OT porque uno de sus ítems es benigno sería peligroso; el
// detalle de cada uno queda en el análisis de riesgo y en la justificación.
//
// Sin imports de servicios: este módulo lo usan tanto la apertura de la OT
// (maintenance-plans-service) como el alta/baja de planes (work-order-plans-
// service), y no puede cerrar un ciclo entre ellos.

export interface PlanTextSource {
  taskCode: string;
  title: string;
  description?: string | null;
  acceptanceCriteria?: string | null;
  loto?: string | null;
  riskLevel?: string | null;
  riskAnalysisResult?: string | null;
  consequenceCategory?: string | null;
  consequenceRationale?: string | null;
}

const RISK_ORDER = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
// Del más grave al menos grave: si un ítem compromete la seguridad, la OT entera
// se trata como de seguridad.
const CONSEQUENCE_ORDER = ["SAFETY", "ENVIRONMENTAL", "OPERATIONAL", "NON_OPERATIONAL"];

function clean(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

/**
 * Une un campo de texto de varios planes. `sep` es "\n" para el título (una
 * línea por ítem) y "\n\n" para los textos largos (un párrafo por ítem).
 * Devuelve null si ningún plan tiene ese campo cargado.
 */
export function mergePlanField(
  plans: PlanTextSource[],
  pick: (plan: PlanTextSource) => string | null | undefined,
  sep: "\n" | "\n\n" = "\n\n",
): string | null {
  if (plans.length === 0) return null;
  // Un solo plan: el texto sale como siempre, sin el prefijo del código.
  if (plans.length === 1) return clean(pick(plans[0]!));

  const blocks: string[] = [];
  for (const plan of plans) {
    const value = clean(pick(plan));
    if (!value) continue;
    blocks.push(`${plan.taskCode} · ${value}`);
  }
  return blocks.length > 0 ? blocks.join(sep) : null;
}

/** Título de la OT: una línea "CÓDIGO · título" por ítem del PDM. */
export function mergePlanTitles(plans: PlanTextSource[]): string | null {
  return mergePlanField(plans, (p) => p.title, "\n");
}

/** El nivel de riesgo más alto de los planes incluidos. */
export function mergeRiskLevel(plans: PlanTextSource[]): string | null {
  let best: string | null = null;
  for (const plan of plans) {
    const value = clean(plan.riskLevel);
    if (!value) continue;
    const i = RISK_ORDER.indexOf(value);
    if (i < 0) continue;
    if (best === null || i > RISK_ORDER.indexOf(best)) best = value;
  }
  return best;
}

/** La consecuencia RCM más grave de los planes incluidos. */
export function mergeConsequenceCategory(plans: PlanTextSource[]): string | null {
  let best: string | null = null;
  for (const plan of plans) {
    const value = clean(plan.consequenceCategory);
    if (!value) continue;
    const i = CONSEQUENCE_ORDER.indexOf(value);
    if (i < 0) continue;
    if (best === null || i < CONSEQUENCE_ORDER.indexOf(best)) best = value;
  }
  return best;
}

/** Todos los campos que la OT hereda de sus planes, ya combinados. */
export interface MergedPlanText {
  title: string | null;
  description: string | null;
  acceptanceCriteria: string | null;
  loto: string | null;
  riskLevel: string | null;
  riskAnalysisResult: string | null;
  consequenceCategory: string | null;
  consequenceRationale: string | null;
}

export function mergePlanTexts(plans: PlanTextSource[]): MergedPlanText {
  return {
    title:                mergePlanTitles(plans),
    // TAREA. Muchos planes no tienen descripción propia: la tarea ES el título.
    // Con varios ítems, ese plan igual tiene que aparecer en la lista — si no,
    // el recuadro queda vacío o muestra sólo algunos y parece que se perdieron.
    // Con un solo plan no se cambia nada: si no hay descripción, va vacío.
    description: plans.length > 1
      ? mergePlanField(plans, (p) => clean(p.description) ?? p.title)
      : mergePlanField(plans, (p) => p.description),
    acceptanceCriteria:   mergePlanField(plans, (p) => p.acceptanceCriteria),
    loto:                 mergePlanField(plans, (p) => p.loto),
    riskLevel:            mergeRiskLevel(plans),
    riskAnalysisResult:   mergePlanField(plans, (p) => p.riskAnalysisResult),
    consequenceCategory:  mergeConsequenceCategory(plans),
    consequenceRationale: mergePlanField(plans, (p) => p.consequenceRationale),
  };
}
