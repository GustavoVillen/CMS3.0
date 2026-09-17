// Solicitud de repuestos armada desde varios ítems tildados en Repuestos & Stock
// (Preview V3). Reusa los endpoints de siempre: crea la solicitud en Borrador y
// le agrega un ítem por repuesto. Envío y aprobación siguen en Solicitudes.

import React, { useState } from "react";
import { Loader2, ShoppingCart, X } from "lucide-react";
import { api, ApiError } from "../../lib/api";
import { useT, type TranslationKey } from "../../lib/i18n";
import { ModalCloseButton } from "../ModalCloseButton";
import { AlertDialog } from "../AlertDialog";
import { RequiredMark } from "../GuideKit";

export interface BatchSpare {
  id: string; sku: string; name: string; vesselCode: string; unit: string;
  available: number; minStock: number; reorderPoint: number; targetStock: number | null;
}

interface Props {
  spares: BatchSpare[];
  vesselName: string;
  onRemove: (id: string) => void;
  onClose: () => void;
  /** Solicitud creada: el padre limpia la selección y abre Solicitudes. */
  onCreated: () => void;
}

const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
const inputCls = "w-full rounded-lg border border-fg/10 bg-fg/5 px-2.5 py-1.5 text-xs text-fg focus:outline-none focus:border-accent/50";
const labelCls = "block text-[10px] font-semibold uppercase tracking-wider text-text-industrial/60 mb-1";

/** Lo que falta para llegar al stock objetivo (o al punto de reposición / mínimo). */
function suggestedQuantity(s: BatchSpare): number {
  const goal = s.targetStock ?? Math.max(s.reorderPoint, s.minStock);
  return Math.max(1, Math.ceil(goal - Math.max(0, s.available)));
}

export const SpareRequestBatchModal: React.FC<Props> = ({ spares, vesselName, onRemove, onClose, onCreated }) => {
  const t = useT();
  const [quantities, setQuantities] = useState<Record<string, string>>(
    () => Object.fromEntries(spares.map(s => [s.id, String(suggestedQuantity(s))])),
  );
  const [priority, setPriority] = useState<(typeof PRIORITIES)[number]>("MEDIUM");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [alert, setAlert] = useState<{ title?: string; message: string; done?: boolean } | null>(null);

  const create = async () => {
    // Todo se valida antes de crear nada: una cantidad mala no deja un borrador a medias.
    const invalid = spares.find(s => !(Number(quantities[s.id]) > 0));
    if (spares.length === 0) { setAlert({ message: t("sp.batch.empty") }); return; }
    if (invalid) { setAlert({ message: t("sp.batch.badQty").replace("{name}", invalid.name) }); return; }

    setSaving(true);
    let code: string | null = null;
    let added = 0;
    try {
      const request = await api.post<{ id: string; requestCode: string }>("/app/pms/spare-requests", {
        priority,
        notes: notes.trim() || null,
        requestedForVesselCode: spares[0]!.vesselCode,
      });
      code = request.requestCode;
      for (const s of spares) {
        await api.post(`/app/pms/spare-requests/${request.id}/items`, {
          spareId: s.id, description: s.name, quantity: Number(quantities[s.id]), unit: s.unit,
        });
        added++;
      }
      setAlert({
        title: t("sp.batch.createdTitle"),
        message: t("sp.batch.created").replace("{code}", code).replace("{n}", String(added)),
        done: true,
      });
    } catch (err) {
      const reason = err instanceof ApiError ? err.message : t("sp.batch.error");
      // Si la cabecera ya se creó, se dice cuál quedó y con cuántos ítems.
      setAlert({
        message: code
          ? t("sp.batch.partial").replace("{code}", code).replace("{n}", String(added)).replace("{reason}", reason)
          : reason,
        done: !!code,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      {alert && (
        <AlertDialog title={alert.title} message={alert.message}
          onClose={() => { const done = alert.done; setAlert(null); if (done) onCreated(); }} />
      )}
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border border-fg/10 bg-surface shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-fg/10 px-5 py-3.5">
          <div>
            <h2 className="text-sm font-bold text-fg">{t("sp.batch.button")}</h2>
            <p className="text-[11px] text-text-industrial/50">{t("sp.batch.subtitle").replace("{vessel}", vesselName).replace("{n}", String(spares.length))}</p>
          </div>
          <ModalCloseButton onClose={onClose} />
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className={labelCls}>{t("col.priority")}</label>
              <select value={priority} onChange={e => setPriority(e.target.value as typeof priority)} className={inputCls}>
                {PRIORITIES.map(p => <option key={p} value={p}>{t(`sp.batch.prio.${p}` as TranslationKey)}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>{t("sp.forms.vessel")}</label>
              <input value={vesselName} disabled className={`${inputCls} opacity-70`} />
            </div>
          </div>

          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-fg/10 text-[10px] uppercase tracking-wider text-text-industrial/50">
                <th className="py-1.5 text-left">{t("sp.v23.col.spare")}</th>
                <th className="py-1.5 text-right">{t("sp.batch.onBoard")}</th>
                <th className="py-1.5 text-right">{t("sp.batch.quantity")}<RequiredMark /></th>
                <th className="py-1.5 pl-2 text-left">{t("sp.batch.unit")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {spares.map(s => (
                <tr key={s.id} className="border-b border-fg/5">
                  <td className="py-1.5 pr-2">
                    <div className="font-semibold text-fg">{s.name}</div>
                    <div className="font-mono text-[10.5px] text-text-industrial/50">{s.sku}</div>
                  </td>
                  <td className="py-1.5 text-right">{s.available}</td>
                  <td className="py-1.5 text-right">
                    <input type="number" min={0} step="any" value={quantities[s.id] ?? ""}
                      onChange={e => setQuantities(q => ({ ...q, [s.id]: e.target.value }))}
                      className="w-20 rounded-md border border-fg/10 bg-fg/5 px-2 py-1 text-right text-xs text-fg focus:outline-none focus:border-accent/50" />
                  </td>
                  <td className="py-1.5 pl-2 text-text-industrial/60">{s.unit}</td>
                  <td className="py-1.5 text-right">
                    <button type="button" onClick={() => onRemove(s.id)} title={t("sp.batch.remove")}
                      className="rounded p-1 text-red-600 hover:bg-red-500/10"><X className="h-3.5 w-3.5" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div>
            <label className={labelCls}>{t("sp.batch.notes")}</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder={t("sp.batch.notesPh")} className={inputCls} />
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-fg/10 px-5 py-3">
          <p className="text-[11px] text-text-industrial/50">{t("sp.batch.footer")}</p>
          <button type="button" onClick={() => void create()} disabled={saving || spares.length === 0}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-orange-600 px-4 py-2 text-xs font-bold text-white hover:brightness-110 disabled:opacity-40">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShoppingCart className="h-3.5 w-3.5" />}
            {t("sp.batch.create")}
          </button>
        </div>
      </div>
    </div>
  );
};
