// Catálogo del formulario controlado de Orden de Trabajo (REGI-OPE-26.3).
//
// El texto está en español porque es el redactado oficial del documento
// controlado del cliente: se imprime tal cual en el papel y no se traduce.
// Mismo criterio que `moc-form-catalog.ts` (REGI-GES-06.1).
//
// Los `value` son los valores del enum en la base; los `label`, lo que dice el papel.

export interface FormOption { value: string; label: string }

/** SOLICITADO POR */
export const WO_REQUESTED_BY: FormOption[] = [
  { value: "CUBIERTA", label: "Cubierta" },
  { value: "MAQUINAS", label: "Máquinas" },
  { value: "TECNICA",  label: "Técnica" },
  { value: "OPS_SSMA", label: "Ops / SSMA" },
];

/** ASIGNADO A — es el área, no la persona (esa es `assignedToUserId`). */
export const WO_ASSIGNED_TO: FormOption[] = [
  { value: "TRIPULACION", label: "Tripulación" },
  { value: "TERCERIZADO", label: "Tercerizado" },
  { value: "TECNICA",     label: "Técnica" },
  { value: "OPS_SSMA",    label: "Ops / SSMA" },
];

/**
 * CONDICIÓN — en qué situación estaba el buque cuando se hizo el trabajo.
 * No sale del papel: es dato del sistema (evidencia TMSA de las prácticas
 * observadas durante la navegación), así que las etiquetas van por i18n
 * (`wo.condition.<valor>`) y acá viajan sólo los valores del enum.
 */
export const WO_OPERATING_CONDITIONS = ["NAVEGACION", "PUERTO", "FONDEADO", "DIQUE"] as const;
export type WoOperatingCondition = (typeof WO_OPERATING_CONDITIONS)[number];

/** SISTEMA */
export const WO_SYSTEM_AREAS: FormOption[] = [
  { value: "MAQUINAS",    label: "Máquinas" },
  { value: "RE_CUBIERTA", label: "R/E Cubierta" },
  { value: "BARCAZAS",    label: "Barcazas" },
];

/**
 * TIPO DE MANTENIMIENTO. El sistema guarda además un `type` grueso
 * (Preventivo/Correctivo/Inspección) que se deriva de esta opción — es el eje
 * que usan los indicadores (MTTR) y el flujo OT→Defecto.
 */
export const WO_MAINTENANCE_KINDS: FormOption[] = [
  { value: "PREVENTIVO",               label: "Preventivo" },
  { value: "CORRECTIVO_PROGRAMADO",    label: "Correctivo programado" },
  { value: "CORRECTIVO_NO_PROGRAMADO", label: "Correctivo no programado" },
  { value: "PREDICTIVO",               label: "Predictivo" },
  { value: "EMERGENCIA",               label: "Emergencia" },
];

/**
 * Igual que WO_MAINTENANCE_KINDS, más "Inspección" — el papel no la lista
 * (no tiene equivalente fino), pero la empresa la usa seguido al abrir una OT
 * a mano. Las 5 primeras viajan como `maintenanceKind` (el backend deriva el
 * `type` grueso, PREVENTIVE/CORRECTIVE); "Inspección" viaja directo como
 * `type: "INSPECTION"` — quien la guarda tiene que mandarla aparte, no como
 * maintenanceKind (el backend no sabe derivar un type desde ese valor).
 */
export const WO_MAINTENANCE_KINDS_OR_INSPECTION: FormOption[] = [
  ...WO_MAINTENANCE_KINDS,
  { value: "INSPECTION", label: "Inspección" },
];

/**
 * PRIORIDAD. El papel la expresa como plazo; el sistema la guarda como nivel.
 * Es el mismo dato con otro nombre — por eso se mapea acá y no se duplica una
 * columna. Elegir una opción del formulario cambia la prioridad de la OT.
 */
export const WO_PRIORITY_FORM_LABELS: Record<string, string> = {
  CRITICAL: "Inmediato",
  HIGH:     "Dentro de las 24hs",
  MEDIUM:   "Dentro de la semana",
  LOW:      "Dentro del mes",
};

/** Las 4 opciones del recuadro PRIORIDAD, en el orden del papel. */
export const WO_PRIORITY_OPTIONS: FormOption[] = [
  { value: "CRITICAL", label: "Inmediato" },
  { value: "HIGH",     label: "Dentro de las 24hs" },
  { value: "MEDIUM",   label: "Dentro de la semana" },
  { value: "LOW",      label: "Dentro del mes" },
];

/** REPUESTOS / MATERIALES: recuadros separados en el papel. */
export const WO_ITEM_KINDS: FormOption[] = [
  { value: "SPARE",    label: "Repuesto" },
  { value: "MATERIAL", label: "Material" },
];
