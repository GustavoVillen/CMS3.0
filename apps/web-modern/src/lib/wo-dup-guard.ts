// Aviso antes de abrir una OT a mano cuando el equipo ya tiene una abierta que
// parece la misma (OT abierta dos veces por error — ver
// apps/api/src/tenant/work-orders/wo-duplicates.ts).
//
// Lo llaman el alta de OT (común, desde un defecto y desde "Nueva SS") y la App
// a bordo, justo antes del POST /work-orders. La ventana la dibuja
// <WoDuplicateHost> (montado una sola vez en la app). Mismo patrón que
// plan-wo-guard, que cubre la OT abierta desde un ítem del plan.
//
// Es un aviso: si el servidor no contesta, se sigue como si no hubiera nada.

import { api } from "./api";

export interface PossibleDuplicateWo {
  id: string;
  workOrderCode: string;
  title: string | null;
  status: string;
  openDate: string;
  createdByName: string | null;
  reason: "SAME_PLAN" | "SIMILAR_TITLE";
  serviceRequests: Array<{ id: string; serviceRequestCode: string; status: string; providerName: string | null }>;
}

export type WoDupDecision =
  /** No había nada parecido, o el usuario dijo que es otro trabajo. */
  | { kind: "new" }
  /** No sigue. `navigated`: se fue a ver la OT abierta (la pantalla que preguntó se cierra). */
  | { kind: "cancel"; navigated?: boolean }
  /** Alta de SS: pedirla en esa OT en vez de abrir otra. */
  | { kind: "use"; workOrder: { id: string; workOrderCode: string } };

export interface WoDupGuardRequest {
  items: PossibleDuplicateWo[];
  /** Ofrecer "Pedir la SS en esta OT" (alta de OT + SS). */
  offerUse: boolean;
  resolve: (decision: WoDupDecision) => void;
}

let listener: ((req: WoDupGuardRequest) => void) | null = null;

export function subscribeWoDupGuard(fn: (req: WoDupGuardRequest) => void): () => void {
  listener = fn;
  return () => { if (listener === fn) listener = null; };
}

export async function confirmWoDuplicate(input: {
  vesselCode: string;
  assetId: string;
  title: string;
  offerUse?: boolean;
}): Promise<WoDupDecision> {
  if (!input.vesselCode || !input.assetId) return { kind: "new" };
  let items: PossibleDuplicateWo[];
  try {
    const qs = new URLSearchParams({ vesselCode: input.vesselCode, assetId: input.assetId, title: input.title });
    const res = await api.get<{ items: PossibleDuplicateWo[] }>(`/app/pms/work-orders/possible-duplicates?${qs.toString()}`);
    items = res.items ?? [];
  } catch {
    return { kind: "new" };
  }
  if (items.length === 0 || !listener) return { kind: "new" };
  const show = listener;
  return new Promise<WoDupDecision>(resolve => show({ items, offerUse: !!input.offerUse, resolve }));
}
