// CIERRE EN GRUPO de las OT de un lote.
//
// La inspección semanal de un convoy se hace de una sola pasada sobre las
// quince barcazas amarradas, así que el resultado se carga una sola vez. Cada
// embarcación conserva SU orden de trabajo: se cierran de a una contra el
// backend, cada una con su historial y su plan avanzando con su frecuencia.
//
// La barcaza que tuvo un hallazgo distinto se destilda y queda abierta, para
// cerrarla aparte con lo suyo. Es el caso normal, no la excepción.

import React, { useState } from "react";
import { Loader2 } from "lucide-react";
import { api, ApiError } from "../../lib/api";
import { useT } from "../../lib/i18n";
import { FormModal } from "../FormModal";
import { AlertDialog } from "../AlertDialog";
import { VesselLabel } from "../EntityLabels";

/** Lo mínimo que hace falta de cada OT del lote. */
export interface BatchCloseWo {
  id: string;
  workOrderCode: string;
  vesselCode: string;
  status: string;
  title: string | null;
}

export interface BatchCloseResult {
  batchId: string;
  closed: Array<{ id: string; workOrderCode: string; vesselCode: string; vesselName: string }>;
  failed: Array<{ id: string; workOrderCode: string; vesselCode: string; vesselName: string; error: string }>;
}

interface Props {
  /** Todas las OT del lote; las ya cerradas o canceladas se filtran acá. */
  items: BatchCloseWo[];
  groupLabel: string;
  onClose: () => void;
  onDone: (result: BatchCloseResult) => void;
}

const inputCls = "w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg focus:outline-none focus:border-accent/50";
const labelCls = "text-[11px] font-bold uppercase tracking-wider text-text-industrial/60";

export const BatchCloseModal: React.FC<Props> = ({ items, groupLabel, onClose, onDone }) => {
  const t = useT();
  // Sólo lo que todavía se puede cerrar. Una OT ya cerrada no vuelve a cerrarse.
  const closable = items.filter(w => w.status !== "CLOSED" && w.status !== "CANCELLED");

  const [picked, setPicked] = useState<Set<string>>(new Set(closable.map(w => w.id)));
  const [woResult, setWoResult] = useState("");
  const [executedByName, setExecutedByName] = useState("");
  const [completedDate, setCompletedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [observations, setObservations] = useState("");
  const [saving, setSaving] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);

  const toggle = (id: string) => {
    setPicked(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };

  const submit = async () => {
    if (!woResult) { setAlert(t("wo.modal.resultRequired")); return; }
    if (picked.size === 0) { setAlert(t("wo.batch.noneToClose")); return; }
    setSaving(true);
    try {
      const res = await api.post<BatchCloseResult>("/app/pms/work-orders/batch-close", {
        workOrderIds: [...picked],
        woResult,
        executedByName: executedByName.trim() || null,
        completedDate: completedDate || null,
        observations: observations.trim() || null,
      });
      onDone(res);
    } catch (e) {
      console.error("[wo-batch-close] failed:", e);
      setAlert(e instanceof ApiError ? e.message : t("common.saveError"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <FormModal
        title={t("wo.batch.closeTitle")}
        subtitle={groupLabel}
        onClose={onClose}
        footer={
          <>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-text-industrial bg-fg/5 border border-fg/10 hover:text-fg transition-colors"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={saving}
              className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-accent hover:brightness-110 disabled:opacity-40 transition-all flex items-center gap-2"
            >
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {t("wo.batch.closeConfirm").replace("{n}", String(picked.size))}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-[11px] text-text-industrial/60 leading-relaxed">{t("wo.batch.closeSubtitle")}</p>

          <div className="space-y-1.5">
            <label className={labelCls}>{t("wo.modal.result")} *</label>
            <div className="flex gap-2">
              {[["SATISFACTORY", t("wo.modal.result.satisfactory"), "bg-success-sea/10 text-success-sea border-success-sea/30"],
                ["WITH_DEFICIENCIES", t("wo.modal.result.withDeficiencies"), "bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/30"]].map(([val, label, cls]) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setWoResult(woResult === val ? "" : String(val))}
                  className={`flex-1 py-2 rounded-xl border text-xs font-bold transition-all ${woResult === val ? cls : "bg-fg/5 text-text-industrial/50 border-fg/10 hover:border-fg/30"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className={labelCls}>{t("wo.modal.executionDate")}</label>
              <input type="date" value={completedDate} onChange={e => setCompletedDate(e.target.value)} className={inputCls} />
            </div>
            <div className="space-y-1.5">
              <label className={labelCls}>{t("wo.modal.executedBy")}</label>
              <input type="text" value={executedByName} onChange={e => setExecutedByName(e.target.value)} className={inputCls} />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className={labelCls}>{t("wo.modal.observations")}</label>
            <textarea rows={3} value={observations} onChange={e => setObservations(e.target.value)} className={inputCls} />
          </div>

          <div className="space-y-1.5">
            <label className={labelCls}>{t("wo.batch.selectedCount").replace("{n}", String(picked.size))}</label>
            <div className="space-y-1 max-h-52 overflow-y-auto pr-1">
              {closable.map(w => (
                <label
                  key={w.id}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                    picked.has(w.id) ? "bg-accent/10 border-accent/40" : "bg-fg/5 border-fg/10 hover:border-accent/30"
                  }`}
                >
                  <input type="checkbox" checked={picked.has(w.id)} onChange={() => toggle(w.id)} className="w-4 h-4 shrink-0" />
                  {/* Nombre del buque, no el código. */}
                  <span className="text-xs font-semibold text-fg truncate flex-1">
                    <VesselLabel code={w.vesselCode} />
                  </span>
                  <span className="text-[10px] font-mono text-text-industrial/50 shrink-0">{w.workOrderCode}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </FormModal>
      {alert && <AlertDialog message={alert} onClose={() => setAlert(null)} />}
    </>
  );
};
