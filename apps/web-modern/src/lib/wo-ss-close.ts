// Al cerrar una OT: avisar que tiene SS abiertas y preguntar si se cierran también.
//
// Antes del POST /close de la OT se llama a `askCloseServiceRequests`. Si la OT
// tiene SS sin cerrar, <WoSsCloseHost> (montado una vez en la app) las muestra
// y pide la recepción: quién recibe y si hay conformidad. Con la OT ya cerrada,
// `closeServiceRequestsWithWo` cierra las SS elegidas con esos datos
// (POST /service-requests/:id/close-with-work-order).
//
// Una SS que todavía no se había mandado al taller también se da por recibida
// (decisión de Gustavo, 01-oct-2026); el servidor lo asienta en su hoja de ruta.

import { api, ApiError } from "./api";

export interface OpenWoServiceRequest {
  id: string;
  serviceRequestCode: string;
  status: string;
  providerName: string | null;
}

/** Lo que eligió el usuario. `ids` vacío = cerrar sólo la OT. */
export interface SsClosePlan {
  ids: string[];
  receivedByName: string;
  receptionConform: boolean;
}

export interface WoSsCloseRequest {
  items: OpenWoServiceRequest[];
  defaultReceiver: string;
  resolve: (plan: SsClosePlan | null) => void;
}

const CLOSED_SS = new Set(["COMPLETED", "CANCELLED", "REJECTED"]);
const ONLY_WO: SsClosePlan = { ids: [], receivedByName: "", receptionConform: true };

let listener: ((req: WoSsCloseRequest) => void) | null = null;
// Los errores los muestra el host: la ventana de la OT ya se cerró cuando llegan.
let errorListener: ((errors: string[]) => void) | null = null;

export function subscribeWoSsClose(fn: (req: WoSsCloseRequest) => void, onErrors: (errors: string[]) => void): () => void {
  listener = fn;
  errorListener = onErrors;
  return () => {
    if (listener === fn) listener = null;
    if (errorListener === onErrors) errorListener = null;
  };
}

/**
 * Pregunta por las SS abiertas de la OT antes de cerrarla.
 * - `null`: el usuario canceló, la OT no se cierra.
 * - plan con `ids` vacío: no hay SS abiertas, o eligió cerrar sólo la OT.
 */
export async function askCloseServiceRequests(workOrderId: string, defaultReceiver: string): Promise<SsClosePlan | null> {
  let items: OpenWoServiceRequest[];
  try {
    const res = await api.get<{ items: OpenWoServiceRequest[] }>(`/app/pms/work-orders/${workOrderId}/service-requests`);
    items = (res.items ?? []).filter(sr => !CLOSED_SS.has(sr.status));
  } catch {
    return ONLY_WO; // sin la lista no se frena el cierre de la OT
  }
  if (items.length === 0 || !listener) return ONLY_WO;
  const show = listener;
  return new Promise<SsClosePlan | null>(resolve => show({ items, defaultReceiver, resolve }));
}

/** Cierra las SS elegidas (con la OT ya cerrada). Si alguna falla, el host lo avisa. */
export async function closeServiceRequestsWithWo(plan: SsClosePlan): Promise<string[]> {
  const errors: string[] = [];
  for (const id of plan.ids) {
    try {
      await api.post(`/app/pms/service-requests/${id}/close-with-work-order`, {
        receivedByName: plan.receivedByName,
        receptionConform: plan.receptionConform,
      });
    } catch (e) {
      errors.push(e instanceof ApiError ? e.message : String(e));
    }
  }
  if (errors.length > 0) errorListener?.(errors);
  return errors;
}
