// Elegir una Orden de Trabajo YA ABIERTA para colgarle una Solicitud de
// Servicio.
//
// Toda SS nace de una OT abierta. Los otros caminos del asistente crean primero
// la OT; este es para cuando la orden ya existe — el caso más común a bordo.
//
// Se listan agrupadas por equipo y plegadas, igual que el tablero de OT
// (KanbanBoard en pages/WorkOrders.tsx): el mismo golpe de vista para el mismo
// dato. Si un día el tablero cambia de forma, hay que mirar los dos.

import React from "react";
import { ChevronDown, Wrench, Loader2 } from "lucide-react";
import { useFetch } from "../../lib/hooks";
import { useT } from "../../lib/i18n";
import { ModalCloseButton } from "../ModalCloseButton";
import { fmtDate } from "../../lib/utils";

/** Sólo lo que la lista necesita mostrar y agrupar. */
interface PickerWorkOrder {
  id: string;
  workOrderCode: string;
  title: string | null;
  status: string;
  dueDate: string | null;
  assetId: string | null;
  assetName: string | null;
}

/**
 * Estados de OT que admiten abrir una SS. Igual que WO_OPEN_STATUSES_FOR_SS en
 * pages/WorkOrders.tsx, que es lo que gatea el botón dentro de la propia OT:
 * ofrecer acá una orden que después no deja crearla sería un callejón sin salida.
 */
const OPEN_STATUSES = ["PLANNED", "IN_PROGRESS", "ON_HOLD", "DEFERRED"];

function groupByAsset(items: PickerWorkOrder[]) {
  const map = new Map<string, { label: string; items: PickerWorkOrder[] }>();
  for (const w of items) {
    const key = w.assetId ?? w.assetName ?? "—";
    const label = w.assetName ?? w.assetId ?? "—";
    const g = map.get(key);
    if (g) g.items.push(w); else map.set(key, { label, items: [w] });
  }
  return [...map.entries()]
    .map(([key, g]) => ({ key, label: g.label, items: g.items }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Chip de estado, con el mismo criterio de colores que el tablero. */
function StatusChip({ wo }: { wo: PickerWorkOrder }) {
  const t = useT();
  const overdue = !!wo.dueDate && new Date(wo.dueDate) < new Date();
  const cls = wo.status === "ON_HOLD" || wo.status === "DEFERRED"
    ? "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20"
    : overdue
      ? "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20"
      : "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20";
  const label = wo.status === "ON_HOLD" || wo.status === "DEFERRED"
    ? t("wo.status.postponed")
    : overdue ? t("wo.status.overdue") : t("wo.status.open");
  return (
    <span className={`shrink-0 inline-block text-[10px] px-2 py-0.5 rounded-full border font-bold ${cls}`}>
      {label}
    </span>
  );
}

export function OpenWorkOrdersPicker({ onClose, onPick, title, subtitle }: {
  onClose: () => void;
  /** La OT elegida: el que llama decide adónde llevarla. */
  onPick: (wo: { id: string; workOrderCode: string }) => void;
  /** Encabezado propio del que llama. Sin esto, el de la SS (uso original). */
  title?: string;
  subtitle?: string;
}) {
  const t = useT();
  // useFetch inyecta el buque del contexto: se listan las OT del buque elegido.
  const { data, loading } = useFetch<{ items: PickerWorkOrder[] }>("/app/work-orders");
  const abiertas = (data?.items ?? []).filter(w => OPEN_STATUSES.includes(w.status));
  const grupos = groupByAsset(abiertas);
  // Arrancan plegados, como el tablero. Con un solo equipo no tiene sentido
  // esconderlo: se abre solo.
  const [expandidos, setExpandidos] = React.useState<Set<string>>(new Set());
  React.useEffect(() => {
    if (grupos.length === 1) setExpandidos(new Set([grupos[0].key]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grupos.length]);
  const toggle = (key: string) =>
    setExpandidos(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-2xl bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl p-6 space-y-4 max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-sm font-bold text-fg">{title ?? t("dashboard.woPicker.title")}</h2>
            <p className="text-xs text-text-industrial/50 mt-0.5">{subtitle ?? t("dashboard.woPicker.subtitle")}</p>
          </div>
          <ModalCloseButton onClose={onClose} />
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2">
          {loading && abiertas.length === 0 && (
            <p className="flex items-center gap-2 text-xs text-text-industrial/50 py-6 justify-center">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> {t("common.loading")}
            </p>
          )}

          {!loading && grupos.length === 0 && (
            <p className="text-xs text-text-industrial/50 text-center py-8">{t("dashboard.woPicker.empty")}</p>
          )}

          {grupos.map(group => {
            const plegado = !expandidos.has(group.key);
            return (
              <div key={group.key} className="rounded-lg border border-fg/10 bg-fg/[0.02]">
                <button
                  type="button"
                  onClick={() => toggle(group.key)}
                  className="w-full flex items-center gap-1.5 px-2 py-2 text-left rounded-lg hover:bg-fg/[0.05] transition-colors"
                  title={group.label}
                >
                  <ChevronDown className={`w-3.5 h-3.5 text-text-industrial/40 shrink-0 transition-transform duration-150 ${plegado ? "-rotate-90" : ""}`} />
                  <Wrench className="w-3 h-3 text-accent/70 shrink-0" />
                  <span className="text-[12px] font-bold text-fg truncate flex-1">{group.label}</span>
                  <span className="text-[10px] font-bold text-text-industrial/50 bg-fg/10 rounded-full px-1.5 py-0.5 shrink-0">
                    {group.items.length}
                  </span>
                </button>

                {!plegado && (
                  <div className="flex flex-col gap-1.5 p-2 pt-0">
                    {group.items.map(wo => (
                      <button
                        key={wo.id}
                        type="button"
                        onClick={() => onPick({ id: wo.id, workOrderCode: wo.workOrderCode })}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-fg/[0.03] border border-fg/10 hover:border-accent/40 hover:bg-fg/[0.07] transition-all text-left"
                      >
                        <span className="font-mono text-[11px] font-bold text-accent shrink-0">{wo.workOrderCode}</span>
                        <span className="flex-1 min-w-0 truncate text-xs text-fg">{wo.title || "—"}</span>
                        {wo.dueDate && (
                          <span className="shrink-0 text-[10px] text-text-industrial/40 tabular-nums">{fmtDate(wo.dueDate)}</span>
                        )}
                        <StatusChip wo={wo} />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
