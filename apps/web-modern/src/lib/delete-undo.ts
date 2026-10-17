// "Deshacer" un borrado recién hecho (aviso abajo + Ctrl+Z).
//
// Los módulos de la Papelera borran "suave" (el registro queda escondido, no se
// pierde). Acá se anota cada DELETE exitoso de esos módulos y, durante
// UNDO_MS, se ofrece volverlo atrás con POST /app/trash/restore. El servidor
// deja hacerlo a quien lo borró sin pedir el permiso de papelera.
//
// Varios borrados seguidos (borrar varias filas de una vez) se juntan en un
// solo "Deshacer" que los trae a todos.
//
// La lista de rutas tiene que coincidir con TRASH_KINDS del backend
// (apps/api/src/tenant/trash/trash-service.ts). Lo que no figura acá (adjuntos,
// avances de OT, diferimientos…) no ofrece Deshacer: su borrado hace algo más
// que esconder el registro.

import { api } from "./api";

const UNDO_MS = 10_000;

const DELETE_PATHS: Array<[RegExp, string]> = [
  [/^\/app\/pms\/maintenance-plans\/([^/]+)$/, "plan"],
  [/^\/app\/pms\/assets\/([^/]+)$/,            "asset"],
  [/^\/app\/pms\/spares\/([^/]+)$/,            "spare"],
  [/^\/app\/pms\/defects\/([^/]+)$/,           "defect"],
  [/^\/app\/certificates\/([^/]+)$/,           "certificate"],
  [/^\/app\/providers\/([^/]+)$/,              "provider"],
  [/^\/app\/crew\/([^/]+)$/,                   "crew"],
  [/^\/app\/drills\/([^/]+)$/,                 "drill"],
  [/^\/app\/permits\/([^/]+)$/,                "permit"],
  [/^\/app\/mocs\/([^/]+)$/,                   "moc"],
  [/^\/app\/near-miss\/([^/]+)$/,              "nearMiss"],
  [/^\/app\/external-audits\/([^/]+)$/,        "externalAudit"],
  [/^\/app\/fluid-analyses\/([^/]+)$/,         "fluidSample"],
  [/^\/app\/checklist-executions\/([^/]+)$/,   "checklist"],
  [/^\/app\/pms\/service-requests\/([^/]+)$/,  "serviceRequest"],
  [/^\/app\/pms\/spare-requests\/([^/]+)$/,    "spareRequest"],
  [/^\/app\/pms\/drydock-specs\/([^/]+)$/,     "drydockSpec"],
  [/^\/app\/pms\/stock-locations\/([^/]+)$/,   "stockLocation"],
  [/^\/app\/bitacora\/([^/]+)$/,               "bitacora"],
  [/^\/app\/vessels\/([^/]+)$/,                "vessel"],
];

export type DeleteUndoEvent =
  | { type: "deleted"; kind: string; count: number }
  | { type: "restoring" }
  | { type: "restored"; count: number }
  | { type: "failed"; message: string }
  | { type: "expired" };

/** Se dispara en window cuando algo vuelve de la papelera: la pantalla abierta se recarga. */
export const TRASH_RESTORED_EVENT = "trash:restored";

let pending: Array<{ kind: string; id: string }> = [];
let lastAt = 0;
let timer: number | null = null;
let busy = false;
const listeners = new Set<(e: DeleteUndoEvent) => void>();

export function subscribeDeleteUndo(fn: (e: DeleteUndoEvent) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
const emit = (e: DeleteUndoEvent) => listeners.forEach(fn => fn(e));

/** ¿Hay un borrado que todavía se puede deshacer? (Ctrl+Z le da prioridad.) */
export function hasPendingDelete(): boolean {
  return pending.length > 0 && Date.now() - lastAt <= UNDO_MS;
}

/** Lo llama api.ts después de cada DELETE exitoso. */
export function noteDeleted(path: string): void {
  const clean = path.split("?")[0]!;
  for (const [re, kind] of DELETE_PATHS) {
    const m = re.exec(clean);
    if (!m) continue;
    const now = Date.now();
    if (now - lastAt > UNDO_MS) pending = [];
    pending.push({ kind, id: decodeURIComponent(m[1]!) });
    lastAt = now;
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(() => { pending = []; timer = null; emit({ type: "expired" }); }, UNDO_MS);
    emit({ type: "deleted", kind: pending[0]!.kind, count: pending.length });
    return;
  }
}

/** Aviso "N registros restaurados" para lo que se restauró desde la Papelera (sin recargar la pantalla). */
export function announceRestored(count: number): void {
  emit({ type: "restored", count });
}

export async function undoLastDelete(): Promise<void> {
  if (busy || !hasPendingDelete()) return;
  const items = pending;
  pending = [];
  if (timer) { window.clearTimeout(timer); timer = null; }
  busy = true;
  emit({ type: "restoring" });
  try {
    await api.post("/app/trash/restore", { items });
    emit({ type: "restored", count: items.length });
    window.dispatchEvent(new CustomEvent(TRASH_RESTORED_EVENT));
  } catch (e) {
    emit({ type: "failed", message: e instanceof Error ? e.message : "" });
  } finally {
    busy = false;
  }
}
