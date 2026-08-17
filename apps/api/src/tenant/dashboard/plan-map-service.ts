import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { applyAssignedVesselScope } from "../auth/vessel-scope";
import { deriveExecutionStatus } from "../maintenance-plans/maintenance-plans-service";
import { loadCurrentHoursNumberByAsset } from "../asset-hours/asset-hours-service";

// ---------------------------------------------------------------------------
// Mapa del Plan — cómo está ESTRUCTURADO el plan de mantenimiento de un buque.
// ---------------------------------------------------------------------------
// Responde "¿cómo está armado el plan?", no "¿cuándo cae el trabajo?" (eso ya lo
// contestan la proyección de carga semanal y el Gantt). Agrega los planes activos
// del buque en tres cortes:
//   - Estructural: grupo SFI → familia de equipos → equipo → sus tareas.
//   - Ritmo: cuántas tareas caen en cada frecuencia (calendario y horas de marcha).
//   - Carga: horas-hombre al año por sistema.
//
// Solo lectura. Sin cambios de schema: todo sale de MaintenancePlan + Asset.
//
// PESO: el select lista los campos uno por uno a propósito. `description` guarda
// los checklists completos de cada tarea (el 90% del peso del registro) y esta
// vista no los usa: traerlos multiplicaría por diez el payload para nada.

export interface PlanMapFilters {
  vesselCode?: string | null;
}

/** Clave de familia de equipos. El texto visible lo pone el frontend (i18n). */
export type FamilyKey =
  | "mainEngines" | "auxEngines" | "gearboxes" | "propellers" | "shafts"
  | "alternators" | "radars" | "vhf" | "winches" | "pumps" | "compressors"
  | "airReceivers" | "filters" | "switchboards" | "firefighting" | "mooring"
  | "steering" | "fuel" | "other";

/** Clave de peldaño de la escalera de frecuencias por calendario. */
export type CalendarKey = "WEEK" | "M1" | "M3" | "M6" | "M12" | "M18" | "M24" | "M36" | "M60" | "M120" | "MX";

/**
 * Estado de vencimiento resumido, el que se pinta en la ficha de cada equipo.
 * Se deriva de los seis estados del sistema para que se lea de un vistazo:
 *   OVERDUE            → overdue    (vencido)
 *   DUE / UPCOMING     → dueSoon    (por vencer)
 *   IN_WINDOW          → inWindow   (con OT abierta, en ventana de ejecución)
 *   FUTURE / COMPLETED → onSchedule (al día)
 *   sin fecha ni horas → unscheduled (nunca se le cargó el arranque)
 */
export type DueState = "overdue" | "dueSoon" | "inWindow" | "onSchedule" | "unscheduled";

/** Orden de atención: lo peor manda al pintar la ficha del equipo. */
const DUE_PRIORITY: Record<DueState, number> = {
  overdue: 4, dueSoon: 3, inWindow: 2, unscheduled: 1, onSchedule: 0,
};

export interface PlanMapTask {
  title: string;
  /** Frecuencia ya normalizada: horas de marcha, meses, semanal o por evento. */
  freqHours: number | null;
  freqMonths: number | null;
  trigger: string;
  riskLevel: string | null;
  dueState: DueState;
}

export interface PlanMapAsset {
  id: string;
  assetCode: string;
  name: string;
  criticality: string;
  safetyCritical: boolean;
  tasks: number;
  /** El peor estado entre sus tareas: es el color de la ficha. */
  dueState: DueState;
  items: PlanMapTask[];
}

export interface PlanMapFamily {
  family: FamilyKey;
  assets: PlanMapAsset[];
  tasks: number;
}

export interface PlanMapSystem {
  group: number;                 // grupo SFI (0-9)
  tasks: number;
  assetCount: number;
  riskHigh: number;
  riskMedium: number;
  riskLow: number;
  riskNone: number;
  families: PlanMapFamily[];
}

export interface PlanMapWorkload {
  group: number;
  /** Horas-hombre al año que no dependen de la marcha (semanales y por meses). */
  calendarHours: number;
  /** Horas-hombre por CADA hora de marcha. El frontend multiplica por las horas/año elegidas. */
  hoursPerRunHour: number;
  /** Ejecuciones al año por calendario (mismo criterio que calendarHours). */
  calendarOccurrences: number;
  /** Ejecuciones por cada hora de marcha. */
  occurrencesPerRunHour: number;
}

export interface PlanMapUpcoming {
  taskCode: string;
  title: string;
  assetName: string;
  nextDueDate: string;
  dueState: DueState;
}

export interface PlanMapResponse {
  vessel: { code: string; name: string; vesselType: string | null } | null;
  systems: PlanMapSystem[];
  calendarLadder: { key: CalendarKey; count: number }[];
  hoursLadder: { hours: number; count: number }[];
  eventCount: number;
  workload: PlanMapWorkload[];
  state: {
    total: number;
    inspections: number;
    overdue: number;
    dueSoon: number;
    inWindow: number;
    onSchedule: number;
    /** Sin fecha ni horas de referencia: nunca se les cargó el arranque. */
    unscheduled: number;
    /** Sin NINGÚN nivel cargado. "Bajo" es un riesgo evaluado, no cuenta acá. */
    noRisk: number;
    riskHigh: number;
    riskMedium: number;
    riskLow: number;
    assetsWithPlan: number;
    assetsTotal: number;
    criticalityA: number;
    safetyCritical: number;
  };
  upcoming: PlanMapUpcoming[];
}

const EMPTY: PlanMapResponse = {
  vessel: null,
  systems: [],
  calendarLadder: [],
  hoursLadder: [],
  eventCount: 0,
  workload: [],
  state: {
    total: 0, inspections: 0, overdue: 0, dueSoon: 0, inWindow: 0, onSchedule: 0,
    unscheduled: 0, noRisk: 0, riskHigh: 0, riskMedium: 0, riskLow: 0,
    assetsWithPlan: 0, assetsTotal: 0, criticalityA: 0, safetyCritical: 0,
  },
  upcoming: [],
};

// ---------------------------------------------------------------------------
// Familias de equipos
// ---------------------------------------------------------------------------
// Lista ORDENADA: gana el primer patrón que coincide, así que el orden es la
// regla. Las familias por tipo de máquina van antes que las funcionales: una
// "Bomba de Incendio" es una bomba, no un equipo contraincendio — para quien
// mantiene, la familia útil es la del equipo.
//
// Los patrones leen el nombre del equipo tal como lo carga el armador, hoy en
// español. Un tenant que cargue nombres en inglés cae casi todo en "other": la
// pantalla sigue funcionando, solo pierde el agrupamiento fino.
const FAMILY_PATTERNS: [RegExp, FamilyKey][] = [
  [/^motor(es)?\s+principal/i,        "mainEngines"],
  [/^motor(es)?\s+auxiliar/i,         "auxEngines"],
  [/^caja(s)?\s+reductora/i,          "gearboxes"],
  [/^h[eé]lice/i,                     "propellers"],
  [/^l[ií]nea(s)?\s+de\s+eje/i,       "shafts"],
  [/^alternador/i,                    "alternators"],
  [/^radar/i,                         "radars"],
  [/^radio\b|vhf/i,                   "vhf"],
  [/^cabrestante|^guinche|^winche/i,  "winches"],
  [/bomba/i,                          "pumps"],
  [/compresor/i,                      "compressors"],
  [/^botell[oó]n/i,                   "airReceivers"],
  [/^filtro/i,                        "filters"],
  [/^tablero|bater[ií]a/i,            "switchboards"],
  [/incendio|co2|detecci[oó]n/i,      "firefighting"],
  [/amarre|fondeo/i,                  "mooring"],
  [/gobierno|hidr[aá]ulica/i,         "steering"],
  [/purificadora|combustible/i,       "fuel"],
];

function familyOf(name: string): FamilyKey {
  for (const [re, key] of FAMILY_PATTERNS) if (re.test(name)) return key;
  return "other";
}

/** Peldaño de la escalera de calendario para un plan por meses. */
function calendarKey(trigger: string, months: number | null): CalendarKey | null {
  if (trigger === "WEEK") return "WEEK";
  if (trigger !== "MONTHS" || months == null) return null;
  switch (months) {
    case 1:   return "M1";
    case 3:   return "M3";
    case 6:   return "M6";
    case 12:  return "M12";
    case 18:  return "M18";
    case 24:  return "M24";
    case 36:  return "M36";
    case 60:  return "M60";
    case 120: return "M120";
    default:  return "MX";
  }
}

const CALENDAR_ORDER: CalendarKey[] = ["WEEK", "M1", "M3", "M6", "M12", "M18", "M24", "M36", "M60", "M120", "MX"];

/** Ejecuciones al año de un plan de calendario (0 si depende de la marcha o de un evento). */
function annualOccurrences(trigger: string, months: number | null): number {
  if (trigger === "WEEK") return 52;
  if (trigger === "MONTHS" && months && months > 0) return 12 / months;
  return 0;
}

async function resolveTenantId(session: TenantAccessSession): Promise<string | null> {
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) return null;
  const prisma = prismaRaw as unknown as {
    tenant: { findUnique(args: unknown): Promise<{ id: string } | null> };
  };
  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  return tenant?.id ?? null;
}

interface PlanRow {
  taskCode: string;
  title: string;
  assetId: string;
  triggerType: string;
  frequencyHours: number | null;
  frequencyMonths: number | null;
  estimatedHours: number | null;
  riskLevel: string | null;
  taskType: string;
  executionStatus: string;
  sfiGroupNumber: number | null;
  nextDueDate: Date | null;
  nextDueHours: number | null;
}

/** Traduce los seis estados del sistema al semáforo de la ficha. */
function toDueState(plan: PlanRow, currentHours: number | null): DueState {
  // Sin fecha ni horómetro de referencia el plan no vence nunca: no está "al día",
  // le falta el arranque. Las de evento no se programan por definición.
  if (plan.nextDueDate == null && plan.nextDueHours == null) {
    return plan.triggerType === "EVENT" ? "onSchedule" : "unscheduled";
  }
  switch (deriveExecutionStatus(plan as never, currentHours)) {
    case "OVERDUE":   return "overdue";
    case "DUE":
    case "UPCOMING":  return "dueSoon";
    case "IN_WINDOW": return "inWindow";
    default:          return "onSchedule";
  }
}

interface AssetRow {
  id: string;
  assetCode: string;
  name: string;
  criticality: string;
  isSafetyCritical: boolean;
}

export async function getPlanMap(
  session: TenantAccessSession,
  filters: PlanMapFilters = {},
): Promise<PlanMapResponse> {
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) return EMPTY;

  const tenantId = await resolveTenantId(session);
  if (!tenantId) return EMPTY;

  // El mapa es POR BUQUE: sin buque pedido no tiene sentido (mezclaría la flota).
  const vesselCode = filters.vesselCode?.trim();
  if (!vesselCode) return EMPTY;

  // Puerta de acceso: el helper deja el código pedido sólo si el usuario lo tiene
  // dentro de su alcance (TENANT_ADMIN ve todos); si no, lo reemplaza por un
  // sentinel que no matchea nada. Comparar contra el pedido es el chequeo, y
  // deja el resto de las queries legibles.
  const scopeProbe: Record<string, unknown> = {};
  applyAssignedVesselScope(session, scopeProbe, vesselCode);
  if (scopeProbe.vesselCode !== vesselCode) return EMPTY;

  const db = prismaRaw as unknown as {
    maintenancePlan: { findMany(args: unknown): Promise<PlanRow[]> };
    asset: { findMany(args: unknown): Promise<AssetRow[]> };
    vessel: { findFirst(args: unknown): Promise<{ code: string; name: string; vesselType: string | null } | null> };
  };

  const vessel = await db.vessel.findFirst({
    where: { tenantId, code: vesselCode, deletedAt: null },
    select: { code: true, name: true, vesselType: true },
  });
  if (!vessel) return EMPTY;

  const [plans, assets] = await Promise.all([
    db.maintenancePlan.findMany({
      // INACTIVE es el único estado que sale del plan vigente: DUE_SOON y OVERDUE
      // siguen siendo tareas del plan (y son justo las que importa ver).
      where: { tenantId, vesselCode, deletedAt: null, status: { not: "INACTIVE" } },
      select: {
        taskCode: true, title: true, assetId: true, triggerType: true,
        frequencyHours: true, frequencyMonths: true, estimatedHours: true,
        riskLevel: true, taskType: true, executionStatus: true,
        sfiGroupNumber: true, nextDueDate: true, nextDueHours: true,
      },
      orderBy: { taskCode: "asc" },
    }),
    db.asset.findMany({
      where: { tenantId, vesselCode, deletedAt: null },
      select: { id: true, assetCode: true, name: true, criticality: true, isSafetyCritical: true },
    }),
  ]);

  const assetById = new Map(assets.map(a => [a.id, a]));

  // Horómetro actual de cada equipo: sin esto los planes por horas de marcha se
  // evaluarían contra 0 y saldrían todos vencidos. Misma fuente que el resto del
  // sistema (tenant/asset-hours: planilla manual + M2 + reporte diario).
  const assetIds = [...new Set(plans.map(p => p.assetId))];
  const currentHoursByAsset = await loadCurrentHoursNumberByAsset(prismaRaw, tenantId, assetIds);

  // ── Agregación estructural: grupo SFI → familia → equipo ────────────────────
  interface SysAcc {
    group: number;
    tasks: number;
    riskHigh: number;
    riskMedium: number;
    riskLow: number;
    riskNone: number;
    assets: Map<string, PlanMapAsset>;
  }
  const sysAcc = new Map<number, SysAcc>();
  const calendarCounts = new Map<CalendarKey, number>();
  const hoursCounts = new Map<number, number>();
  const workAcc = new Map<number, PlanMapWorkload>();

  let eventCount = 0;
  let inspections = 0;
  const dueCount: Record<DueState, number> = {
    overdue: 0, dueSoon: 0, inWindow: 0, onSchedule: 0, unscheduled: 0,
  };
  let noRisk = 0, riskHigh = 0, riskMedium = 0, riskLow = 0;

  for (const p of plans) {
    const group = p.sfiGroupNumber ?? 0;
    const sys = sysAcc.get(group)
      ?? { group, tasks: 0, riskHigh: 0, riskMedium: 0, riskLow: 0, riskNone: 0, assets: new Map() };
    sys.tasks++;

    // "Sin evaluar" es SÓLO la ausencia de nivel: BAJO es un riesgo evaluado y
    // meterlo en la misma bolsa inflaba el conteo de tareas sin análisis.
    const risk = (p.riskLevel ?? "").toUpperCase();
    if (risk === "HIGH" || risk === "CRITICAL") { sys.riskHigh++; riskHigh++; }
    else if (risk === "MEDIUM") { sys.riskMedium++; riskMedium++; }
    else if (risk === "LOW") { sys.riskLow++; riskLow++; }
    else { sys.riskNone++; noRisk++; }

    if (p.taskType === "INSPECTION") inspections++;

    const dueState = toDueState(p, currentHoursByAsset.get(p.assetId) ?? null);
    dueCount[dueState]++;

    const asset = assetById.get(p.assetId);
    const entry: PlanMapAsset = sys.assets.get(p.assetId) ?? {
      id: p.assetId,
      assetCode: asset?.assetCode ?? "—",
      name: asset?.name ?? "—",
      criticality: asset?.criticality ?? "C",
      safetyCritical: asset?.isSafetyCritical ?? false,
      tasks: 0,
      dueState: "onSchedule" as DueState,
      items: [] as PlanMapTask[],
    };
    entry.tasks++;
    // La ficha del equipo se pinta con el peor estado de sus tareas.
    if (DUE_PRIORITY[dueState] > DUE_PRIORITY[entry.dueState]) entry.dueState = dueState;
    entry.items.push({
      title: p.title,
      freqHours: p.frequencyHours,
      freqMonths: p.frequencyMonths,
      trigger: p.triggerType,
      riskLevel: p.riskLevel,
      dueState,
    });
    sys.assets.set(p.assetId, entry);
    sysAcc.set(group, sys);

    // ── Ritmo ────────────────────────────────────────────────────────────────
    if (p.triggerType === "EVENT") {
      eventCount++;
    } else if (p.triggerType === "HOURS" && p.frequencyHours && p.frequencyHours > 0) {
      hoursCounts.set(p.frequencyHours, (hoursCounts.get(p.frequencyHours) ?? 0) + 1);
    } else {
      const key = calendarKey(p.triggerType, p.frequencyMonths);
      if (key) calendarCounts.set(key, (calendarCounts.get(key) ?? 0) + 1);
    }

    // ── Carga anual ──────────────────────────────────────────────────────────
    // Las de calendario quedan resueltas en horas/año; las de horas de marcha se
    // dejan expresadas POR HORA DE MARCHA para que el frontend pueda cambiar el
    // supuesto de horas anuales sin volver a pedir datos.
    const est = p.estimatedHours ?? 0;
    const w = workAcc.get(group) ?? {
      group, calendarHours: 0, hoursPerRunHour: 0, calendarOccurrences: 0, occurrencesPerRunHour: 0,
    };
    if (p.triggerType === "HOURS" && p.frequencyHours && p.frequencyHours > 0) {
      w.occurrencesPerRunHour += 1 / p.frequencyHours;
      w.hoursPerRunHour += est / p.frequencyHours;
    } else {
      const occ = annualOccurrences(p.triggerType, p.frequencyMonths);
      w.calendarOccurrences += occ;
      w.calendarHours += occ * est;
    }
    workAcc.set(group, w);
  }

  // ── Armado de la respuesta ──────────────────────────────────────────────────
  const systems: PlanMapSystem[] = [...sysAcc.values()].map(sys => {
    const byFamily = new Map<FamilyKey, PlanMapAsset[]>();
    for (const a of sys.assets.values()) {
      const fam = familyOf(a.name);
      const list = byFamily.get(fam) ?? [];
      list.push(a);
      byFamily.set(fam, list);
    }
    const families: PlanMapFamily[] = [...byFamily.entries()]
      .map(([family, list]) => ({
        family,
        assets: list.sort((x, y) => x.name.localeCompare(y.name, "es", { numeric: true, sensitivity: "base" })),
        tasks: list.reduce((s, x) => s + x.tasks, 0),
      }))
      // Familias más grandes primero; "other" siempre al final.
      .sort((a, b) =>
        Number(a.family === "other") - Number(b.family === "other") ||
        b.assets.length - a.assets.length ||
        b.tasks - a.tasks);

    return {
      group: sys.group,
      tasks: sys.tasks,
      assetCount: sys.assets.size,
      riskHigh: sys.riskHigh,
      riskMedium: sys.riskMedium,
      riskLow: sys.riskLow,
      riskNone: sys.riskNone,
      families,
    };
  }).sort((a, b) => b.tasks - a.tasks);

  const upcoming: PlanMapUpcoming[] = plans
    .filter(p => p.nextDueDate)
    .sort((a, b) => a.nextDueDate!.getTime() - b.nextDueDate!.getTime())
    .slice(0, 8)
    .map(p => ({
      taskCode: p.taskCode,
      title: p.title,
      assetName: assetById.get(p.assetId)?.name ?? "—",
      nextDueDate: p.nextDueDate!.toISOString(),
      dueState: toDueState(p, currentHoursByAsset.get(p.assetId) ?? null),
    }));

  return {
    vessel,
    systems,
    calendarLadder: CALENDAR_ORDER
      .filter(k => calendarCounts.has(k))
      .map(k => ({ key: k, count: calendarCounts.get(k)! })),
    hoursLadder: [...hoursCounts.entries()]
      .map(([hours, count]) => ({ hours, count }))
      .sort((a, b) => a.hours - b.hours),
    eventCount,
    workload: [...workAcc.values()].sort((a, b) => b.calendarHours - a.calendarHours),
    state: {
      total: plans.length,
      inspections,
      overdue: dueCount.overdue,
      dueSoon: dueCount.dueSoon,
      inWindow: dueCount.inWindow,
      onSchedule: dueCount.onSchedule,
      unscheduled: dueCount.unscheduled,
      noRisk,
      riskHigh,
      riskMedium,
      riskLow,
      assetsWithPlan: new Set(plans.map(p => p.assetId)).size,
      assetsTotal: assets.length,
      criticalityA: assets.filter(a => a.criticality === "A").length,
      safetyCritical: assets.filter(a => a.isSafetyCritical).length,
    },
    upcoming,
  };
}
