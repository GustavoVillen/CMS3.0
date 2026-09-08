// Modelo de la PLANILLA DE MANTENIMIENTO: cómo se arma la planilla de papel del
// armador a partir de los planes del buque.
//
//   Ítem | Descripción (equipo + modelo) | Tarea a realizar | Realizar cada |
//   Última verificación | Próximo recorrido | Muestreo | Inspección |
//   Mantenimiento | Proveedor | Fuera de servicio
//
// Las tareas se agrupan por GRUPO SFI (G0: Inspecciones y Pruebas, G1: Casco y
// Estructuras…) y, dentro de cada grupo, por equipo: un bloque de filas con el
// número de ítem y la descripción del equipo abarcando todo el bloque.
//
// ⚠️ Este archivo es la ÚNICA fuente de esa estructura. Lo usan las dos salidas:
//   · export-maintenance-sheet.ts  → la planilla en Excel (se imprime)
//   · pages/MaintenanceSheet.tsx   → la misma planilla en pantalla
// Separado justamente para que no se puedan desfasar: si el papel y la pantalla
// numeran los ítems distinto o agrupan distinto, la planilla deja de servir para
// trabajar contra ella.

/** Plan tal como lo devuelve `/app/pms/maintenance-plans`, recortado a lo que la planilla usa. */
export interface SheetPlan {
  id: string;
  taskCode: string;
  title: string;
  assetId?: string | null;
  assetName: string | null;
  triggerType: string;
  frequencyHours: number | null;
  frequencyMonths: number | null;
  lastExecutionDate: string | null;
  lastExecutionHours?: number | null;
  nextDueDate: string | null;
  nextDueHours?: number | null;
  /** Estado calculado por la API (OVERDUE / DUE / IN_WINDOW / UPCOMING / …). */
  executionStatus?: string | null;
  /** Horómetro actual del equipo. Necesario para el semáforo de las tareas por horas. */
  assetCurrentHours?: number | null;
  /** Grupo SFI del plan (0–9). Si falta, se deriva del código SFI del equipo. */
  sfiGroupNumber?: number | null;
  /** MAINTENANCE / INSPECTION — separa las dos columnas de tipo. */
  taskType?: string | null;
  /** Si la tarea es una toma de muestra (fluido, vibración, termografía…). */
  samplingKind?: string | null;
  /** Área responsable. El taller sólo cuenta cuando es PROVEEDOR. */
  department?: string | null;
  providerName?: string | null;
  providerRequests?: Array<{ providerId: string; providerName?: string | null }> | null;
}

export interface AssetInfo {
  id: string;
  name: string | null;
  manufacturer?: string | null;
  model?: string | null;
  sfiCode?: string | null;
  status?: string | null;
}

export const isHours = (t: string) => t === "HOURS" || t === "RUNNING_HOURS";
export const isMonths = (t: string) => t === "MONTHS" || t === "CALENDAR";

// ─── Grupos SFI ───────────────────────────────────────────────────────────────
// Mismas etiquetas que el resto de la app (claves "sfi.g.N" del diccionario i18n).
export const SFI_GROUP_NAMES: Record<number, string> = {
  0: "Inspecciones y Pruebas",
  1: "Casco y Estructuras",
  2: "Sistemas de Carga",
  3: "LCI y Salvamento",
  4: "Sistemas de Navegación",
  5: "Sistemas de Habitabilidad",
  6: "Sistemas de Propulsión y Generación",
  7: "Sistemas Auxiliares",
  8: "Sistemas Eléctricos",
  9: "Sistemas de Automatización y Control",
};
export const NO_GROUP = 99;

/** Primer dígito del código SFI del equipo → grupo (fallback si el plan no lo trae). */
export function groupOfSfiCode(sfiCode: string | null | undefined): number | null {
  const d = (sfiCode ?? "").trim()[0];
  return /^[0-9]$/.test(d ?? "") ? Number(d) : null;
}

/** Grupo SFI del plan como dígito (300 → 3), igual que la pantalla de Planes. */
export function groupOfPlanNumber(n: number | null | undefined): number | null {
  if (n == null) return null;
  const d = n < 10 ? n : Math.floor(n / 100);
  return d >= 0 && d <= 9 ? d : null;
}

export function groupBanner(g: number): string {
  return g === NO_GROUP ? "Sin grupo SFI asignado" : `G${g}: ${SFI_GROUP_NAMES[g] ?? ""}`;
}

// ─── Columnas de tipo de trabajo ─────────────────────────────────────────────
// Se marcan con un ícono y no con "SI/NO": la planilla se imprime y se lee de un
// vistazo, y el ojo encuentra el símbolo mucho más rápido que la palabra.
export const ICON_SAMPLING = "🧪";
export const ICON_INSPECTION = "🔍";
export const ICON_MAINTENANCE = "🔧";
export const ICON_PROVIDER = "🏭";

/** ¿La tarea es una toma de muestra que va al laboratorio? */
export function isSampling(p: SheetPlan): boolean {
  return !!(p.samplingKind && String(p.samplingKind).trim());
}

/**
 * Talleres externos de la tarea.
 *
 * Mismo criterio que usa el backend al abrir la OT (openFormalWorkOrder): los
 * proveedores del plan sólo cuentan cuando el área es PROVEEDOR. De acá salen
 * tanto los nombres que muestra la columna "Proveedor" como la cuenta de SS que
 * va a generar una OT (una SS por taller, no por tarea).
 */
export function providerIdsOf(p: SheetPlan): string[] {
  if (p.department !== "PROVEEDOR") return [];
  return [...new Set((p.providerRequests ?? []).map(r => r.providerId).filter(Boolean))];
}

export function providerNamesOf(p: SheetPlan): string[] {
  if (p.department !== "PROVEEDOR") return [];
  const names = (p.providerRequests ?? [])
    .map(r => (r.providerName ?? "").trim())
    .filter(Boolean);
  if (names.length > 0) return [...new Set(names)];
  const single = (p.providerName ?? "").trim();
  return single ? [single] : [];
}

/** Celda "Proveedor" de la planilla impresa: ícono + talleres. */
export function providerLabel(p: SheetPlan): string {
  if (p.department !== "PROVEEDOR") return "";
  const list = providerNamesOf(p);
  // Área PROVEEDOR sin taller elegido todavía: igual se marca, porque el trabajo
  // se terceriza y eso cambia cómo se tramita la OT.
  if (list.length === 0) return ICON_PROVIDER;
  return `${ICON_PROVIDER} ${list.join(", ")}`;
}

/** "Realizar cada": número de horas, o el lapso en palabras (6 meses, 7 días…). */
export function everyLabel(p: SheetPlan): string | number {
  const t = p.triggerType;
  if (isHours(t)) return p.frequencyHours ?? "—";
  // DAY y WEEK guardan su valor en frequencyMonths (ver recalculateNextDue en la API).
  const n = p.frequencyMonths;
  if (n == null) return "—";
  if (isMonths(t)) return n === 1 ? "1 mes" : `${n} meses`;
  if (t === "DAY") return n === 1 ? "1 día" : `${n} días`;
  if (t === "WEEK") return n === 1 ? "1 semana" : `${n} semanas`;
  if (t === "CONDITION") return "Según condición";
  if (t === "EVENT") return "Por evento";
  return "—";
}

export function fmtDate(s: string | null | undefined): string | null {
  if (!s) return null;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getUTCFullYear()}`;
}

/** Última verificación / próximo recorrido: horómetro si el plan va por horas, si no fecha. */
export function milestone(p: SheetPlan, which: "last" | "next"): string | number {
  if (isHours(p.triggerType)) {
    const h = which === "last" ? p.lastExecutionHours : p.nextDueHours;
    return h ?? "N/A";
  }
  return fmtDate(which === "last" ? p.lastExecutionDate : p.nextDueDate) ?? "N/A";
}

// ─── Semáforo de la planilla ─────────────────────────────────────────────────
//
// Rojo = vencida. Amarillo = "ya casi", medido CONTRA SU PROPIO CICLO y no con
// un plazo fijo: al 90% del ciclo cumplido se enciende, con un tope de 30 días
// (o 250 horas) para que una tarea de ciclo muy largo no se encienda con meses
// de anticipación.
//
// El plazo fijo de 30 días que usa el resto del PMS ("por vencer") no sirve para
// esta planilla: una tarea MENSUAL nunca está a más de 30 días de vencer, así que
// salía amarilla incluso el mismo día en que se la ejecutaba, y el amarillo dejaba
// de significar algo. Con el ciclo propio: mensual avisa 3 días antes, trimestral
// 9, anual 30.
//
// Ojo: esto es sólo el COLOR de la planilla (pantalla y Excel). El estado del
// plan —lo que cuentan el Dashboard, el Gantt y los reportes— no cambia.
const SOON_FRACTION = 0.1;
const SOON_MAX_DAYS = 30;
const SOON_MAX_HOURS = 250;
const DAY_MS = 86_400_000;

/** Largo del ciclo en días: el real (última → próximo) o, si falta, la frecuencia. */
function cycleDays(p: SheetPlan): number | null {
  if (p.lastExecutionDate && p.nextDueDate) {
    const d = (new Date(p.nextDueDate).getTime() - new Date(p.lastExecutionDate).getTime()) / DAY_MS;
    if (d > 0) return d;
  }
  const n = p.frequencyMonths;
  if (n == null || n <= 0) return null;
  if (isMonths(p.triggerType)) return n * 30;
  if (p.triggerType === "DAY") return n;
  if (p.triggerType === "WEEK") return n * 7;
  return null;
}

export type Severity = "overdue" | "soon" | "none";

export function severityOf(p: SheetPlan): Severity {
  const status = (p.executionStatus ?? "").toUpperCase();
  if (status === "OVERDUE") return "overdue";
  // Ya hay una OT abierta ejecutándose: la tarea está en juego, se marca igual.
  if (status === "IN_WINDOW") return "soon";

  // Tareas por horómetro: lo que queda contra el ciclo en horas.
  if (isHours(p.triggerType) && p.nextDueHours != null) {
    if (p.assetCurrentHours == null) return status === "DUE" || status === "UPCOMING" ? "soon" : "none";
    const left = p.nextDueHours - p.assetCurrentHours;
    if (left <= 0) return "overdue";
    const cycle = p.frequencyHours && p.frequencyHours > 0 ? p.frequencyHours : null;
    const threshold = cycle ? Math.min(cycle * SOON_FRACTION, SOON_MAX_HOURS) : SOON_MAX_HOURS;
    return left <= threshold ? "soon" : "none";
  }

  // Tareas por calendario.
  if (p.nextDueDate) {
    const left = (new Date(p.nextDueDate).getTime() - Date.now()) / DAY_MS;
    if (left < 0) return "overdue";
    const cycle = cycleDays(p);
    const threshold = cycle ? Math.min(cycle * SOON_FRACTION, SOON_MAX_DAYS) : SOON_MAX_DAYS;
    return left <= threshold ? "soon" : "none";
  }

  return status === "DUE" || status === "UPCOMING" ? "soon" : "none";
}

/** Orden estable dentro del equipo: primero las de horas, después las de calendario. */
export function sortPlans(a: SheetPlan, b: SheetPlan): number {
  const ah = isHours(a.triggerType) ? 0 : 1;
  const bh = isHours(b.triggerType) ? 0 : 1;
  if (ah !== bh) return ah - bh;
  const av = (isHours(a.triggerType) ? a.frequencyHours : a.frequencyMonths) ?? Number.MAX_SAFE_INTEGER;
  const bv = (isHours(b.triggerType) ? b.frequencyHours : b.frequencyMonths) ?? Number.MAX_SAFE_INTEGER;
  if (av !== bv) return av - bv;
  return a.title.localeCompare(b.title, "es");
}

/** Bloque de filas de un equipo dentro de una banda de grupo SFI. */
export interface EquipBlock {
  key: string;
  /** Número de ítem de la planilla (el de la primera columna), correlativo global. */
  itemNumber: number;
  name: string;
  /** Marca y modelo, la segunda línea de la descripción. */
  subtitle: string;
  group: number;
  outOfService: boolean;
  plans: SheetPlan[];
}

/** Una banda de grupo SFI con sus bloques de equipo, en orden de impresión. */
export interface SheetGroup {
  group: number;
  banner: string;
  blocks: EquipBlock[];
}

/**
 * Arma la planilla completa: agrupa por GRUPO SFI DE LA TAREA y, dentro, por
 * equipo — mismo criterio que la pantalla de Planes de Mantenimiento. El grupo lo
 * declara cada plan; el código SFI del equipo sólo se usa cuando el plan no trae
 * grupo. Un equipo con tareas de grupos distintos (una bomba de incendio con
 * tareas de LCI y de auxiliares) aparece como un bloque en cada banda, igual que
 * en la planilla de papel.
 *
 * El número de ítem se asigna acá, en el orden final de impresión, para que el
 * papel y la pantalla numeren idéntico.
 */
export function buildSheetGroups(
  plans: SheetPlan[],
  assetById: Map<string, AssetInfo>,
): SheetGroup[] {
  const blocks = new Map<string, EquipBlock>();
  for (const p of plans) {
    const a = p.assetId ? assetById.get(p.assetId) : undefined;
    const group = groupOfPlanNumber(p.sfiGroupNumber) ?? groupOfSfiCode(a?.sfiCode) ?? NO_GROUP;
    const key = `${group}__${p.assetId ?? `sin:${p.assetName ?? ""}`}`;
    if (!blocks.has(key)) {
      blocks.set(key, {
        key,
        itemNumber: 0,                 // se asigna abajo, con el orden final
        name: p.assetName ?? a?.name ?? "Sin equipo asignado",
        subtitle: [a?.manufacturer, a?.model].filter(Boolean).join(" "),
        group,
        // Equipo parado: sus tareas siguen venciendo, pero no se ejecutan. Sin
        // esta marca, la planilla muestra rojos que nadie puede cerrar.
        outOfService: a?.status === "OUT_OF_SERVICE",
        plans: [],
      });
    }
    blocks.get(key)!.plans.push(p);
  }

  const equipos = [...blocks.values()].sort((a, b) => a.name.localeCompare(b.name, "es"));
  equipos.forEach(e => e.plans.sort(sortPlans));

  // Bloques repartidos por grupo SFI, en orden 0…9 y "sin grupo" al final.
  const byGroup = new Map<number, EquipBlock[]>();
  for (const e of equipos) {
    if (!byGroup.has(e.group)) byGroup.set(e.group, []);
    byGroup.get(e.group)!.push(e);
  }

  let item = 0;
  return [...byGroup.keys()].sort((a, b) => a - b).map(g => {
    const list = byGroup.get(g)!;
    list.forEach(e => { e.itemNumber = ++item; });
    return { group: g, banner: groupBanner(g), blocks: list };
  });
}
