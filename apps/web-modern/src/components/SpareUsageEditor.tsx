import React, { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useFetch } from "../lib/hooks";
import { useT } from "../lib/i18n";

// ---------------------------------------------------------------------------
// SpareUsageEditor — sección "Repuestos utilizados" reutilizable.
//
// Replica la UI de consumo de repuestos de las OT (WorkOrders.tsx) como
// componente controlado. Se usa en el reporte de ejecución de planes con modo
// "Mantenimiento Express". Reutiliza las claves i18n `wo.spares.*` y el endpoint
// `/app/pms/spares`. Envía al padre el arreglo de líneas; el padre lo mapea a
// `{ spareId, qty, unit }` para el backend.
// ---------------------------------------------------------------------------

export interface SpareLine {
  spareId: string;
  spareName: string;
  unit: string;
  qty: number;
  criticality: string;
  available: number;
}

interface SpareCatalogItem {
  id: string;
  sku: string;
  name: string;
  unit: string;
  criticality: string;
  onHand: number;
  available: number;
}

const inputCls = "w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 disabled:opacity-60";

function CritBadge({ crit }: { crit: string }) {
  const cls =
    crit === "A" ? "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20"
    : crit === "B" ? "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20"
    : "bg-fg/5 text-fg/40 border-fg/10";
  return (
    <span className={`inline-flex items-center justify-center w-4 h-4 rounded text-[9px] font-bold border shrink-0 ${cls}`}>
      {crit || "?"}
    </span>
  );
}

interface SpareUsageEditorProps {
  vesselCode: string;
  value: SpareLine[];
  onChange: (lines: SpareLine[]) => void;
}

export const SpareUsageEditor: React.FC<SpareUsageEditorProps> = ({ vesselCode, value, onChange }) => {
  const t = useT();
  const { data: sparesData } = useFetch<{ items: SpareCatalogItem[] }>(
    vesselCode ? `/app/pms/spares?vesselCode=${encodeURIComponent(vesselCode)}&status=ACTIVE` : null,
    [vesselCode],
  );
  const spares = sparesData?.items ?? [];

  const [addingUsage, setAddingUsage] = useState(false);
  const [usageSpareId, setUsageSpareId] = useState("");
  const [usageQty, setUsageQty] = useState("1");
  const [usageSearch, setUsageSearch] = useState("");
  const [usageDropdown, setUsageDropdown] = useState(false);

  // Hidratar nombre/unidad/criticidad/disponible de las líneas prellenadas (que
  // llegan solo con spareId+qty+unit) cuando carga el catálogo. El guard `changed`
  // evita un loop: una vez hidratada, la re-ejecución no dispara onChange.
  useEffect(() => {
    if (spares.length === 0 || value.length === 0) return;
    let changed = false;
    const hydrated = value.map(u => {
      const s = spares.find(x => x.id === u.spareId);
      if (!s) return u;
      const next: SpareLine = {
        ...u,
        available: s.available,
        unit: u.unit || s.unit,
        spareName: u.spareName || `${s.sku} — ${s.name}`,
        criticality: u.criticality || s.criticality,
      };
      if (next.available !== u.available || next.unit !== u.unit || next.spareName !== u.spareName || next.criticality !== u.criticality) {
        changed = true;
      }
      return next;
    });
    if (changed) onChange(hydrated);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sparesData, value]);

  const addUsage = () => {
    const spare = spares.find(s => s.id === usageSpareId);
    if (!spare) return;
    const qty = parseFloat(usageQty);
    if (!qty || qty <= 0) return;
    onChange([...value, {
      spareId: spare.id,
      spareName: `${spare.sku} — ${spare.name}`,
      unit: spare.unit,
      qty,
      criticality: spare.criticality,
      available: spare.available,
    }]);
    setUsageSpareId(""); setUsageQty("1"); setUsageSearch(""); setAddingUsage(false);
  };

  const removeUsage = (idx: number) => onChange(value.filter((_, i) => i !== idx));

  const updateQty = (idx: number, raw: string) => {
    const qty = raw === "" ? 0 : parseFloat(raw);
    onChange(value.map((u, i) => (i === idx ? { ...u, qty: Number.isFinite(qty) ? qty : 0 } : u)));
  };

  return (
    <div className="border border-fg/10 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold text-fg/50 uppercase tracking-wider">{t("wo.spares.section")}</p>
        <button type="button" onClick={() => setAddingUsage(v => !v)}
          className="text-[10px] text-accent/70 hover:text-accent underline">
          {addingUsage ? t("common.cancel") : t("wo.spares.add")}
        </button>
      </div>

      {value.length > 0 && (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] text-fg/30 border-b border-fg/10">
              <th className="text-left py-1">{t("wo.spares.colSpare")}</th>
              <th className="text-right py-1">{t("wo.spares.colQty")}</th>
              <th className="text-left py-1 pl-2">{t("wo.spares.colUnit")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {value.map((u, i) => (
              <tr key={i} className="border-b border-fg/5 last:border-0">
                <td className="py-1.5">
                  <div className="flex items-center gap-1.5">
                    <CritBadge crit={u.criticality} />
                    <span className={u.qty > u.available ? "text-orange-700 dark:text-orange-300" : "text-fg"}>{u.spareName}</span>
                  </div>
                </td>
                <td className="py-1.5 text-right">
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={u.qty}
                    onChange={e => updateQty(i, e.target.value)}
                    className={`w-24 bg-fg/5 border rounded-lg px-2 py-1.5 text-sm font-semibold text-right focus:outline-none focus:border-accent/50 ${u.qty > u.available ? "border-orange-500/40 text-orange-700 dark:text-orange-300" : "border-fg/15 text-fg"}`}
                  />
                </td>
                <td className="py-1.5 pl-2 text-fg/40 align-middle">{u.unit}</td>
                <td className="py-1.5 text-right">
                  <button onClick={() => removeUsage(i)} className="text-fg/20 hover:text-red-700 dark:text-red-400 transition-colors">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {value.some(u => u.qty > u.available) && (
        <p className="text-[10px] text-orange-700 dark:text-orange-400">
          {t("wo.spares.exceedsStock")}
        </p>
      )}

      {addingUsage && (
        <div className="space-y-1.5 pt-1 border-t border-fg/10">
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2 relative">
              <input
                type="text"
                value={usageSearch}
                onChange={e => { setUsageSearch(e.target.value); setUsageSpareId(""); setUsageDropdown(true); }}
                onFocus={() => setUsageDropdown(true)}
                onBlur={() => setTimeout(() => setUsageDropdown(false), 150)}
                placeholder={t("wo.spares.searchPlaceholder")}
                className={inputCls}
              />
              {usageDropdown && (
                <div className="absolute z-20 w-full mt-1 bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-xl shadow-xl max-h-52 overflow-y-auto">
                  {(() => {
                    const q = usageSearch.toLowerCase();
                    const filtered = q
                      ? spares.filter(s => s.sku.toLowerCase().includes(q) || s.name.toLowerCase().includes(q))
                      : spares.slice(0, 30);
                    if (filtered.length === 0) return <p className="px-3 py-2 text-xs text-fg/30">{t("common.noResults")}</p>;
                    return filtered.map(s => (
                      <button key={s.id} type="button"
                        onMouseDown={() => { setUsageSpareId(s.id); setUsageSearch(`${s.sku} — ${s.name}`); setUsageDropdown(false); }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-fg/5">
                        <CritBadge crit={s.criticality} />
                        <span className="flex-1 text-left text-fg">{s.sku} — {s.name}</span>
                        {s.available <= 0
                          ? <span className="text-red-700 dark:text-red-400 text-[10px] font-semibold shrink-0">{t("wo.spares.outOfStock")}</span>
                          : <span className="text-fg/30 text-[10px] shrink-0">{t("wo.spares.available")}: {s.available} {s.unit}</span>
                        }
                      </button>
                    ));
                  })()}
                </div>
              )}
            </div>
            <div className="flex gap-1">
              <input type="number" min="0.01" step="0.01" value={usageQty} onChange={e => setUsageQty(e.target.value)}
                placeholder={t("wo.spares.qtyPlaceholder")} className={inputCls} />
              <button onClick={addUsage} disabled={!usageSpareId}
                className="px-3 py-2 rounded-xl bg-accent/20 text-accent text-xs font-bold hover:bg-accent/30 disabled:opacity-40 shrink-0">
                +
              </button>
            </div>
          </div>
          {usageSpareId && (() => {
            const spare = spares.find(s => s.id === usageSpareId);
            const qty = parseFloat(usageQty);
            if (spare && qty > spare.available) {
              return <p className="text-[10px] text-orange-700 dark:text-orange-400">{t("wo.spares.insufficientStock").replace("{avail}", String(spare.available)).replace("{unit}", spare.unit).replace("{req}", String(qty))}</p>;
            }
            return null;
          })()}
        </div>
      )}

      {value.length === 0 && !addingUsage && (
        <p className="text-xs text-fg/20">{t("wo.spares.empty")}</p>
      )}
    </div>
  );
};
