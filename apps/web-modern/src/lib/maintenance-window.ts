// Ventana de ejecución de un plan de mantenimiento: desde cuándo se puede
// hacer la tarea, hasta que vence.
//
// Un solo criterio para toda la app. Lo usan el diagrama de Gantt del
// escritorio (la barra) y la agenda del celular (el "se puede desde…"). Si
// alguna vez cambia la regla, cambia acá y las dos pantallas la siguen.
//
// Prioridad (misma semántica que execution-windows del backend y que el modal
// del plan):
//   1. windowOpenDate cargada a mano → manda.
//   2. MANUAL con windowLeadDays → vencimiento − esos días.
//   3. AUTO → ~10% del ciclo (frequencyMonths, o el largo real última→próxima).
// Se recorta contra la última ejecución: la ventana nunca puede abrir antes de
// que la tarea se haya hecho por última vez.

export const DAY_MS = 86_400_000;
export const DAYS_PER_MONTH = 30.44;

/** Lo que hace falta de un plan para ubicar su ventana. */
export interface WindowPlanFields {
  windowMode?: "AUTO" | "MANUAL" | null;
  windowLeadDays?: number | null;
  windowOpenDate?: string | null;
  frequencyMonths?: number | null;
}

export function parseDateOrNull(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Apertura de la ventana. `nextDue` es el vencimiento (real o proyectado) y
 * `lastExec` la última ejecución; devuelve null si no hay con qué calcularla.
 */
export function windowOpenOf(
  plan: WindowPlanFields,
  nextDue: Date | null,
  lastExec: Date | null,
): Date | null {
  if (!nextDue) return null;

  const explicit = parseDateOrNull(plan.windowOpenDate);
  if (explicit) return explicit;

  let leadDays: number | null = null;
  if (plan.windowMode === "MANUAL" && plan.windowLeadDays && plan.windowLeadDays > 0) {
    leadDays = plan.windowLeadDays;
  } else if (plan.frequencyMonths && plan.frequencyMonths > 0) {
    leadDays = plan.frequencyMonths * DAYS_PER_MONTH * 0.1;
  } else if (lastExec) {
    // Planes por horas: no hay frecuencia en meses, pero el largo del ciclo
    // se puede leer del propio tramo última ejecución → próximo vencimiento.
    leadDays = ((nextDue.getTime() - lastExec.getTime()) / DAY_MS) * 0.1;
  }
  if (leadDays == null || !(leadDays > 0)) return null;

  const open = new Date(nextDue.getTime() - leadDays * DAY_MS);
  if (lastExec && open < lastExec) return lastExec;
  return open;
}
