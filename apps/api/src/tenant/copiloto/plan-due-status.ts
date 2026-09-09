/**
 * B-02 — El estado de vencimiento que el copiloto tiene que responder es el
 * MISMO que pinta la pantalla, y la pantalla no lo lee de la base.
 *
 * En `MaintenancePlan` hay dos columnas guardadas (`status` y `executionStatus`)
 * que quedaron congeladas: al revisar la flota de mercurio, CERO planes de 38
 * buques tenian `status = OVERDUE`, mientras 235 estaban vencidos de verdad por
 * fecha (61 en DON CHICUETO, 52 en LATERE, 23 en MAO 01). Habia planes vencidos
 * desde el ano 2000 con `executionStatus = FUTURE` guardado.
 *
 * La lista de planes deriva el estado en el momento con `deriveExecutionStatus`
 * y por eso muestra "Vencida". El copiloto filtraba por la columna, que nunca
 * matchea, y respondia "no hay tareas vencidas" con total seguridad.
 *
 * Este modulo aplica la misma derivacion canonica a las filas que trae el tool.
 * Es una funcion pura para poder testearla sin base ni modelo.
 */
import { deriveExecutionStatus } from "../maintenance-plans/maintenance-plans-service";

/** Estados de vencimiento reales, los mismos que muestra la pantalla. */
export const EXECUTION_STATUSES = ["FUTURE", "UPCOMING", "IN_WINDOW", "DUE", "OVERDUE", "COMPLETED"] as const;

type Locale = "es" | "en" | "pt";

/**
 * A-01/B-02 — el copiloto no puede escupir el codigo crudo en medio de una
 * frase. Se traduce aca, del lado del dato, para que el modelo reciba la
 * etiqueta ya resuelta en el idioma del usuario.
 */
const LABELS: Record<Locale, Record<string, string>> = {
  es: { OVERDUE: "Vencida", DUE: "Por vencer", IN_WINDOW: "En ventana", UPCOMING: "Próxima", FUTURE: "Futura", COMPLETED: "Completada" },
  en: { OVERDUE: "Overdue", DUE: "Due", IN_WINDOW: "In window", UPCOMING: "Upcoming", FUTURE: "Future", COMPLETED: "Completed" },
  pt: { OVERDUE: "Vencida", DUE: "A vencer", IN_WINDOW: "Na janela", UPCOMING: "Próxima", FUTURE: "Futura", COMPLETED: "Concluída" },
};

export function executionStatusLabel(code: string, locale: string): string {
  const dict = LABELS[(locale?.slice(0, 2) as Locale)] ?? LABELS.es;
  return dict[code] ?? code;
}

export interface PlanRowForStatus {
  assetId?: string | null;
  executionStatus?: string | null;
  nextDueDate?: Date | string | null;
  nextDueHours?: number | null;
  triggerType?: string | null;
}

/**
 * Deriva el estado real de cada plan, opcionalmente filtra por uno, y agrega la
 * etiqueta traducida. `currentHoursByAsset` es necesario para los planes por
 * horas: sin el, un plan por horas se evalua contra 0 y sale siempre vencido.
 */
export function resolvePlanDueStatus<T extends PlanRowForStatus>(
  plans: T[],
  currentHoursByAsset: Map<string, number>,
  opts: { filter?: string | null; locale?: string } = {},
): (T & { executionStatus: string; executionStatusLabel: string })[] {
  const locale = opts.locale ?? "es";
  const resolved = plans.map((p) => {
    const code = deriveExecutionStatus(
      p as Parameters<typeof deriveExecutionStatus>[0],
      p.nextDueHours != null ? currentHoursByAsset.get(p.assetId ?? "") ?? null : null,
    );
    return { ...p, executionStatus: code, executionStatusLabel: executionStatusLabel(code, locale) };
  });
  if (!opts.filter) return resolved;
  const wanted = String(opts.filter).toUpperCase();
  return resolved.filter((p) => p.executionStatus === wanted);
}
