// "¿Este repuesto se cambia en todos los servicios de este tipo?"
//
// Cuando en una OT que viene de un plan se carga un repuesto que el plan no
// tiene, se le pregunta a quien puede modificar planes si es una renovación de
// todos los servicios de ese tipo. Con Sí, el repuesto se suma al plan (sus
// "repuestos a reemplazar") y las próximas OT del plan lo heredan al abrirse.
//
// Lo usan los dos lugares donde se cargan repuestos de una OT: "Repuestos y
// materiales previstos" y "Repuestos utilizados" (en la OT y en el Consumo de
// Repuestos del Dashboard / Seguimiento). Una sola ventanita para todos.
//
// No pregunta: sin permiso de modificar planes (el servidor lo vuelve a exigir),
// OT sin plan, repuesto que el plan ya tiene, o repuesto al que ya se le
// contestó No en esa OT.

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useFetch } from "../../lib/hooks";
import { api } from "../../lib/api";
import { useCan } from "../../lib/auth";
import { useT } from "../../lib/i18n";
import { FormModal } from "../FormModal";
import { AlertDialog } from "../AlertDialog";
import type { WoPlanRow } from "./WoPlansPanel";

/** Repuesto recién cargado en la OT. */
export interface PlanSpareCandidate {
  spareId: string;
  /** "SKU — Nombre", como se guarda en el plan. */
  label: string;
  quantity: number;
  unit: string;
}

// Los No por OT, en memoria de la página: cerrar y volver a abrir la misma OT no
// vuelve a preguntar por el mismo repuesto.
const declined = new Map<string, Set<string>>();

const inputCls = "w-full bg-fg/5 border border-fg/10 rounded-lg px-3 py-2 text-sm text-fg focus:outline-none focus:border-accent/50";

export function usePlanSparePrompt(workOrderId: string | null | undefined) {
  const t = useT();
  const can = useCan();
  const enabled = !!workOrderId && can("plan.manage");
  const { data, reload } = useFetch<{ items: WoPlanRow[] }>(
    enabled ? `/app/pms/work-orders/${workOrderId}/plans` : null,
    [workOrderId, enabled],
  );
  const plans = data?.items ?? null;

  const [queue, setQueue] = useState<PlanSpareCandidate[]>([]);
  // Lo agregado en esta sesión: la lista de planes puede no haberse recargado aún.
  const [added, setAdded] = useState<Set<string>>(new Set()); // `${planId}:${spareId}`
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [qty, setQty] = useState("1");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pendingPlans = useCallback((spareId: string) => (plans ?? []).filter(p =>
    !(p.spareIds ?? []).includes(spareId) && !added.has(`${p.id}:${spareId}`)), [plans, added]);

  const ask = useCallback((c: PlanSpareCandidate) => {
    if (!enabled || !workOrderId || !c.spareId) return;
    if (declined.get(workOrderId)?.has(c.spareId)) return;
    setQueue(q => (q.some(x => x.spareId === c.spareId) ? q : [...q, c]));
  }, [enabled, workOrderId]);

  const head = queue[0] ?? null;
  const candidates = head ? pendingPlans(head.spareId) : [];

  // Con los planes ya cargados: si ninguno le falta este repuesto, no hay nada que
  // preguntar. Si no, arranca con el plan principal tildado y la cantidad de la OT.
  useEffect(() => {
    if (!head || plans === null) return;
    if (candidates.length === 0) { setQueue(q => q.slice(1)); return; }
    const primary = candidates.find(p => p.isPrimary) ?? candidates[0]!;
    setSelected(new Set([primary.id]));
    setQty(String(head.quantity > 0 ? head.quantity : 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [head?.spareId, plans === null]);

  const responderNo = () => {
    if (!head || !workOrderId) return;
    const set = declined.get(workOrderId) ?? new Set<string>();
    set.add(head.spareId);
    declined.set(workOrderId, set);
    setQueue(q => q.slice(1));
  };

  const responderSi = async () => {
    if (!head) return;
    const ids = candidates.filter(p => selected.has(p.id)).map(p => p.id);
    if (ids.length === 0) { setError(t("planSpare.pickPlan")); return; }
    const quantity = Number(qty.replace(",", "."));
    if (!(quantity > 0)) { setError(t("planSpare.qtyRequired")); return; }
    setSaving(true);
    try {
      for (const id of ids) {
        await api.post(`/app/pms/maintenance-plans/${id}/spares`, {
          spareId: head.spareId, quantity, unit: head.unit, workOrderId,
        });
      }
      setAdded(prev => new Set([...prev, ...ids.map(id => `${id}:${head.spareId}`)]));
      setQueue(q => q.slice(1));
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("planSpare.error"));
    } finally {
      setSaving(false);
    }
  };

  const element = (
    <>
      {head && plans !== null && candidates.length > 0 && (
        <FormModal title={t("planSpare.title")} onClose={responderNo}
          footer={<>
            <button type="button" onClick={responderNo} disabled={saving}
              className="px-4 py-2 rounded-xl border border-fg/10 text-xs font-bold text-text-industrial hover:border-accent/30">
              {t("planSpare.no")}
            </button>
            <button type="button" onClick={() => { void responderSi(); }} disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-accent text-accent-fg text-xs font-bold hover:brightness-110 disabled:opacity-50">
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} {t("planSpare.yes")}
            </button>
          </>}>
          <div className="space-y-3">
            <p className="text-sm text-fg">
              {t("planSpare.question").replace("{spare}", head.label)}
            </p>
            <p className="text-xs text-text-industrial/60">{t("planSpare.hint")}</p>
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">
                {candidates.length > 1 ? t("planSpare.plans") : t("planSpare.plan")}
              </label>
              {candidates.length > 1 ? (
                <div className="space-y-1">
                  {candidates.map(p => (
                    <label key={p.id} className="flex items-start gap-2 text-sm text-fg cursor-pointer">
                      <input type="checkbox" className="mt-1 accent-accent" checked={selected.has(p.id)}
                        onChange={e => setSelected(prev => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(p.id); else next.delete(p.id);
                          return next;
                        })} />
                      <span><b className="font-mono text-xs">{p.taskCode}</b> — {p.title}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-fg"><b className="font-mono text-xs">{candidates[0]!.taskCode}</b> — {candidates[0]!.title}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">{t("planSpare.qty")}</label>
              <div className="flex items-center gap-2">
                <input type="number" min={0} step="any" value={qty} onChange={e => setQty(e.target.value)}
                  className={`${inputCls} max-w-[8rem]`} />
                <span className="text-sm text-text-industrial/70">{head.unit}</span>
              </div>
            </div>
          </div>
        </FormModal>
      )}
      {error && <AlertDialog message={error} onClose={() => setError(null)} />}
    </>
  );

  return { ask, element };
}
