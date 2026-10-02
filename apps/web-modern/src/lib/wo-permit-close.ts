// Al cerrar una OT: avisar que tiene permisos de trabajo abiertos y ofrecer cerrarlos.
//
// Antes del POST /close de la OT se llama a `askClosePermits`. Si la OT tiene
// permisos sin cerrar, <WoPermitCloseHost> (montado una vez en la app) los
// muestra, pide lo que les falte (peligros, medidas de control, EPP) y pregunta
// si se cierran. Los permisos se cierran ANTES que la OT: el servidor no deja
// cerrar una OT cuyo plan exige un permiso que no está cerrado.
//
// POST /permits/:id/close-with-work-order recorre los pasos que falten
// (solicitar, aprobar, activar) con los mismos controles de rol que a mano.

import { api, ApiError } from "./api";

export interface OpenWoPermit {
  id: string;
  permitCode: string;
  type: string;
  status: string;
  vesselCode: string;
  location: string | null;
  description: string | null;
  hazardsIdentified: string | null;
  controlMeasures: string | null;
  ppeRequired: string | null;
  /** El plan de la OT exige este tipo de permiso cerrado para cerrar la OT. */
  required: boolean;
}

export interface PermitCloseItem {
  id: string;
  permitCode: string;
  hazardsIdentified?: string;
  controlMeasures?: string;
  ppeRequired?: string;
}

/** Lo que eligió el usuario. `items` vacío = cerrar sólo la OT. */
export interface PermitClosePlan {
  items: PermitCloseItem[];
  closeNotes: string;
}

export interface WoPermitCloseRequest {
  items: OpenWoPermit[];
  resolve: (plan: PermitClosePlan | null) => void;
}

const CLOSED_PERMIT = new Set(["CLOSED", "CANCELLED", "REJECTED"]);
const ONLY_WO: PermitClosePlan = { items: [], closeNotes: "" };

let listener: ((req: WoPermitCloseRequest) => void) | null = null;

export function subscribeWoPermitClose(fn: (req: WoPermitCloseRequest) => void): () => void {
  listener = fn;
  return () => { if (listener === fn) listener = null; };
}

/**
 * Pregunta por los permisos abiertos de la OT antes de cerrarla.
 * - `null`: el usuario canceló, la OT no se cierra.
 * - plan con `items` vacío: no hay permisos abiertos, o eligió cerrar sólo la OT.
 */
export async function askClosePermits(workOrderId: string, requiredTypes: string[]): Promise<PermitClosePlan | null> {
  let items: OpenWoPermit[];
  try {
    const res = await api.get<{ items: Omit<OpenWoPermit, "required">[] }>(`/app/permits?workOrderId=${encodeURIComponent(workOrderId)}`);
    const required = new Set(requiredTypes);
    items = (res.items ?? [])
      .filter(p => !CLOSED_PERMIT.has(p.status))
      .map(p => ({ ...p, required: required.has(p.type) }));
  } catch {
    return ONLY_WO; // sin la lista decide el servidor al cerrar la OT
  }
  if (items.length === 0 || !listener) return ONLY_WO;
  const show = listener;
  return new Promise<PermitClosePlan | null>(resolve => show({ items, resolve }));
}

/**
 * Cierra los permisos elegidos. Corta en el primero que falla y devuelve el
 * mensaje: la OT no se cierra hasta que se resuelva.
 */
export async function closePermitsWithWo(plan: PermitClosePlan): Promise<string | null> {
  for (const it of plan.items) {
    try {
      await api.post(`/app/permits/${it.id}/close-with-work-order`, {
        hazardsIdentified: it.hazardsIdentified ?? null,
        controlMeasures: it.controlMeasures ?? null,
        ppeRequired: it.ppeRequired ?? null,
        closeNotes: plan.closeNotes || null,
      });
    } catch (e) {
      return e instanceof ApiError ? e.message : String(e);
    }
  }
  return null;
}
