// Semáforo de mantenimiento: el peor estado entre los planes activos.
//
// Vive acá y no dentro de una pantalla porque lo usan varias (la ficha de
// estado del equipo y el selector del Dashboard) y tienen que decir lo mismo
// con los mismos colores. Si mañana cambia el criterio de "próximo a vencer",
// se cambia en un solo lugar.

// OUT_OF_SERVICE no sale de los planes sino del EQUIPO (Asset.status): una
// máquina parada no se puede atender, así que sus tareas vencidas no son un
// atraso de mantenimiento sino una consecuencia de la baja. Pintarla de rojo
// junto a las demás manda a la tripulación a un trabajo que no puede hacer.
export type Severity = "OVERDUE" | "UPCOMING" | "OK" | "OUT_OF_SERVICE";

/** executionStatus del backend → semáforo. Lo que no está mapeado cuenta como OK. */
export const SEVERITY_RANK: Record<string, Severity> = {
  OVERDUE: "OVERDUE",
  DUE: "UPCOMING",
  IN_WINDOW: "UPCOMING",
  UPCOMING: "UPCOMING",
  FUTURE: "OK",
  COMPLETED: "OK",
};

export interface PlanForStatus {
  status: string;
  executionStatus: string;
}

/** El peor estado manda: un solo plan vencido pinta todo el equipo de rojo. */
export function worstSeverity(plans: PlanForStatus[]): Severity {
  let worst: Severity = "OK";
  for (const p of plans) {
    if (p.status !== "ACTIVE") continue;
    const sev = SEVERITY_RANK[p.executionStatus] ?? "OK";
    if (sev === "OVERDUE") return "OVERDUE";
    if (sev === "UPCOMING") worst = "UPCOMING";
  }
  return worst;
}

/**
 * Estado de UN equipo: primero la condición de la máquina, después sus planes.
 * Un equipo fuera de servicio no muestra vencimientos: muestra que está parado.
 */
export function assetSeverity(assetStatus: string | null | undefined, plans: PlanForStatus[]): Severity {
  if (assetStatus === "OUT_OF_SERVICE") return "OUT_OF_SERVICE";
  return worstSeverity(plans);
}

/**
 * Combina varios semáforos (p. ej. todos los equipos de un grupo SFI).
 * Los equipos fuera de servicio no arrastran al grupo: sólo si TODOS están
 * parados el grupo entero queda marcado como fuera de servicio.
 */
export function worstOf(severities: Severity[]): Severity {
  if (severities.length === 0) return "OK";
  if (severities.includes("OVERDUE")) return "OVERDUE";
  if (severities.includes("UPCOMING")) return "UPCOMING";
  if (severities.includes("OK")) return "OK";
  return "OUT_OF_SERVICE";
}

/** Clases del semáforo. Mismas que ya usaba la ficha de estado del equipo. */
export const SEVERITY_STYLE: Record<Severity, { badge: string; chip: string; labelKey: string }> = {
  OVERDUE: {
    badge: "bg-danger/10 text-danger border-danger/25",
    chip: "bg-danger/10 border-danger/40 text-danger",
    labelKey: "dashboard.equipmentStatus.overdue",
  },
  UPCOMING: {
    badge: "bg-warning/10 text-warning border-warning/25",
    chip: "bg-warning/10 border-warning/40 text-warning",
    labelKey: "dashboard.equipmentStatus.upcoming",
  },
  OK: {
    badge: "bg-success/10 text-success border-success/25",
    chip: "bg-success/10 border-success/40 text-success",
    labelKey: "dashboard.equipmentStatus.ok",
  },
  // Gris a propósito: no es ni bueno ni malo, es una máquina dada de baja.
  OUT_OF_SERVICE: {
    badge: "bg-fg/5 text-text-industrial border-fg/25",
    chip: "bg-fg/10 border-fg/30 text-text-industrial",
    labelKey: "dashboard.equipmentStatus.outOfService",
  },
};
