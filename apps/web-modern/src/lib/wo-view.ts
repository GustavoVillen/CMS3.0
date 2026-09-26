// Etapa de una OT y criterios de sus tarjetas/filtros ("Vencidas", "Esperando
// mi firma", "En ejecución"…). Viven acá y no en la página de OT porque
// Aprobaciones muestra las mismas tarjetas: con una sola definición, las dos
// pantallas cuentan exactamente lo mismo.

import { parseLocalDate } from "./utils";

/** Lo mínimo de una OT que miran la etapa y los filtros. */
export interface WoViewItem {
  id: string;
  status: string;
  dueDate: string | null;
  assignedToUserId: string | null;
  enviadoAprobacionAt: string | null;
  aprobadoAt: string | null;
  autorizadoAt: string | null;
}

// ── Tramitación: etapa derivada de la cadena de aprobación + estado diferido ──
// Los identificadores internos se conservan (SOLICITADA/APROBADA/AUTORIZADA)
// aunque las etiquetas visibles ahora digan "Pendiente de aprobación" /
// "Pendiente de autorización" / "Autorizada y en proceso": renombrarlos
// obligaría a tocar el arrastre, los filtros, el móvil y los badges sin ganar
// nada. El texto sale de i18n (wo.kanban.*).
export type WoStage = "EN_PREPARACION" | "SOLICITADA" | "APROBADA" | "AUTORIZADA" | "DIFERIDA" | "HIDDEN";
export function woStage(wo: WoViewItem): WoStage {
  if (wo.status === "CLOSED" || wo.status === "CANCELLED") return "HIDDEN"; // no van al tablero
  if (wo.status === "ON_HOLD") return "DIFERIDA";
  if (wo.autorizadoAt) return "AUTORIZADA";
  if (wo.aprobadoAt) return "APROBADA";
  // Sin enviar a aprobar todavía: la está completando quien la abrió.
  if (!wo.enviadoAprobacionAt) return "EN_PREPARACION";
  return "SOLICITADA";
}

export interface WoViewContext {
  /** Estado del diferimiento de cada OT diferida (sólo lo usan los postponed*). */
  deferralMap?: Map<string, { status: string }>;
  canApprove: boolean;
  canAuthorize: boolean;
  userId: string | null;
}

/** Mismos criterios que tenían los chips de la lista (y los enlaces del Dashboard). */
export function woViewFilter<T extends WoViewItem>(items: T[], key: string, ctx: WoViewContext): T[] {
  const now = new Date();
  const CLOSED = new Set(["CLOSED", "CANCELLED"]);
  const overdue = (w: T) => !CLOSED.has(w.status) && w.status !== "ON_HOLD" && !!w.dueDate && parseLocalDate(w.dueDate) < now;
  const deferralStatus = (w: T) => ctx.deferralMap?.get(w.id)?.status;
  switch (key) {
    case "closed":            return items.filter(w => CLOSED.has(w.status));
    case "postponed":         return items.filter(w => w.status === "ON_HOLD");
    case "postponedRejected": return items.filter(w => w.status === "ON_HOLD" && deferralStatus(w) === "REJECTED");
    case "postponedPending":  return items.filter(w => {
      if (w.status !== "ON_HOLD") return false;
      const s = deferralStatus(w);
      return s === "REQUESTED" || s === "UNDER_REVIEW";
    });
    // Pendientes de tramitación: mismas etapas que las columnas del tablero.
    case "toApprove":         return items.filter(w => woStage(w) === "SOLICITADA");
    case "toAuthorize":       return items.filter(w => woStage(w) === "APROBADA");
    // "en proceso" gana sobre la etapa de firma, igual que la etiqueta de la tarjeta.
    case "inProgress":        return items.filter(w => w.status === "IN_PROGRESS");
    case "authorized":        return items.filter(w => w.status !== "IN_PROGRESS" && woStage(w) === "AUTORIZADA");
    case "inPreparation":     return items.filter(w => w.status !== "IN_PROGRESS" && woStage(w) === "EN_PREPARACION");
    case "overdue":           return items.filter(overdue);
    case "open":              return items.filter(w => !CLOSED.has(w.status) && w.status !== "ON_HOLD" && !overdue(w));
    // Tarjeta "Esperando mi firma" / "Asignadas a mí": sale de los permisos y
    // del responsable de cada OT (el backend ya los tiene; nada nuevo).
    case "mine":
      return ctx.canApprove || ctx.canAuthorize
        ? items.filter(w => (ctx.canApprove && woStage(w) === "SOLICITADA") || (ctx.canAuthorize && woStage(w) === "APROBADA"))
        : items.filter(w => !CLOSED.has(w.status) && !!ctx.userId && w.assignedToUserId === ctx.userId);
    default:                  return items;
  }
}
