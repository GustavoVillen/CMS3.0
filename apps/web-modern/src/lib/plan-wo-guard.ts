// Aviso antes de abrir una OT desde el plan cuando el ítem ya tiene una abierta.
//
// Todas las pantallas que abren una OT desde un ítem del PDM llaman a
// `confirmPlanWoDuplicate` justo antes del POST /open-work-order. La ventana la
// dibuja <PlanWoDuplicateHost> (montado una sola vez en la app), que ofrece ir a
// la OT abierta o abrir otra igual.
//
// El servidor tiene el mismo control: sin `allowDuplicate: true` no deja abrir
// otra OT del mismo ítem (409 PLAN_WO_ALREADY_OPEN). Así una pantalla que no
// pregunte tampoco duplica.

import { api } from "./api";

export interface OpenPlanWorkOrder {
  planId: string;
  taskCode: string;
  workOrderId: string;
  workOrderCode: string;
  status: string;
}

export type PlanWoDecision = "duplicate" | "cancel";

export interface PlanWoGuardRequest {
  items: OpenPlanWorkOrder[];
  resolve: (decision: PlanWoDecision) => void;
}

let listener: ((req: PlanWoGuardRequest) => void) | null = null;

export function subscribePlanWoGuard(fn: (req: PlanWoGuardRequest) => void): () => void {
  listener = fn;
  return () => { if (listener === fn) listener = null; };
}

/**
 * Pregunta si el ítem ya tiene una OT abierta.
 * - `null`: el usuario no sigue (canceló o fue a ver la OT abierta).
 * - `true`: eligió abrir otra igual → mandar `allowDuplicate: true`.
 * - `false`: no había ninguna abierta (o no se pudo consultar: decide el servidor).
 */
export async function confirmPlanWoDuplicate(planIds: string[]): Promise<boolean | null> {
  const ids = [...new Set(planIds.filter(Boolean))];
  if (ids.length === 0) return false;
  let items: OpenPlanWorkOrder[];
  try {
    const res = await api.get<{ items: OpenPlanWorkOrder[] }>(
      `/app/pms/maintenance-plans/open-work-orders?ids=${ids.map(encodeURIComponent).join(",")}`,
    );
    items = res.items ?? [];
  } catch {
    return false;
  }
  if (items.length === 0 || !listener) return false;
  const show = listener;
  const decision = await new Promise<PlanWoDecision>(resolve => show({ items, resolve }));
  return decision === "duplicate" ? true : null;
}
