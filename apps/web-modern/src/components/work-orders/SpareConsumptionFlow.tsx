// "Consumo de Repuestos / Materiales" (acceso del Dashboard).
//
// Dos pasos: elegir una OT abierta y registrar sobre ella los repuestos que se
// usaron. Es CONSUMO REAL: cada línea genera un movimiento de salida de stock
// (StockMovement ISSUE con referencia a la OT) y baja las existencias del buque.
//
// No confundir con los recuadros REPUESTOS / MATERIALES de la OT
// (PlannedItemsEditor): esos son la lista prevista del trabajo y no tocan el
// stock. Los materiales sueltos sin ficha en el catálogo (grasa, trapos) van ahí.
//
// El guardado manda SIEMPRE la lista completa, no lo agregado: el backend
// reemplaza los movimientos de la OT con lo que recibe (applySpareUsagesToWo).
// Mandar sólo lo nuevo borraría lo ya consumido.

import React from "react";
import { Loader2, ChevronLeft, Plus, Trash2, AlertTriangle } from "lucide-react";
import { useFetch } from "../../lib/hooks";
import { api } from "../../lib/api";
import { useT } from "../../lib/i18n";
import { ModalCloseButton } from "../ModalCloseButton";
import { AlertDialog } from "../AlertDialog";
import { OpenWorkOrdersPicker } from "../service-requests/OpenWorkOrdersPicker";
import { SpareSearchDropdown, type WoSpareOption } from "./PlannedItemsEditor";

/** Lo que el detalle de la OT devuelve de cada consumo ya registrado. */
interface WoSpareUsage {
  spareId: string;
  qty: number;
  unit: string;
  sku?: string;
  name?: string;
}

interface WoDetail {
  id: string;
  workOrderCode: string;
  title: string | null;
  vesselCode: string;
  assetName: string | null;
  spareUsages?: WoSpareUsage[];
}

/** Fila editable del consumo. `label` sólo para los repuestos fuera del catálogo. */
interface UsageRow {
  spareId: string;
  qty: number;
  unit: string;
  label: string;
}

export function SpareConsumptionFlow({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [wo, setWo] = React.useState<{ id: string; workOrderCode: string } | null>(null);

  if (!wo) {
    return (
      <OpenWorkOrdersPicker
        onClose={onClose}
        onPick={setWo}
        title={t("dashboard.spareUse.pickTitle")}
        subtitle={t("dashboard.spareUse.pickSubtitle")}
      />
    );
  }
  return <SpareConsumptionModal woId={wo.id} onBack={() => setWo(null)} onClose={onClose} />;
}

function SpareConsumptionModal({ woId, onBack, onClose }: {
  woId: string;
  onBack: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const { data: wo, loading } = useFetch<WoDetail>(`/app/pms/work-orders/${woId}`, [woId]);
  // Catálogo del buque de la OT, con stock. Igual que en la pantalla de la OT.
  const { data: sparesData } = useFetch<{ items: WoSpareOption[] }>(
    wo?.vesselCode ? `/app/pms/spares?vesselCode=${wo.vesselCode}&status=ACTIVE` : null,
    [wo?.vesselCode],
  );
  const spares = sparesData?.items ?? [];
  const spareById = new Map(spares.map(s => [s.id, s]));

  const [rows, setRows] = React.useState<UsageRow[] | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [aviso, setAviso] = React.useState<string | null>(null);

  // Lo ya consumido en esta OT es el punto de partida: se edita o se le suma.
  React.useEffect(() => {
    if (!wo || rows !== null) return;
    setRows((wo.spareUsages ?? []).map(u => ({
      spareId: u.spareId,
      qty: Number(u.qty) || 0,
      unit: u.unit ?? "",
      label: `${u.sku ?? ""}${u.sku && u.name ? " — " : ""}${u.name ?? u.spareId}`,
    })));
  }, [wo, rows]);

  const filas = rows ?? [];
  const patch = (i: number, p: Partial<UsageRow>) =>
    setRows(prev => (prev ?? []).map((r, idx) => (idx === i ? { ...r, ...p } : r)));
  const quitar = (i: number) => setRows(prev => (prev ?? []).filter((_, idx) => idx !== i));
  const agregar = () => setRows(prev => [...(prev ?? []), { spareId: "", qty: 1, unit: "ud", label: "" }]);

  const guardar = async () => {
    if (filas.some(r => !r.spareId)) { setAviso(t("dashboard.spareUse.errNoSpare")); return; }
    if (filas.some(r => !(r.qty > 0))) { setAviso(t("dashboard.spareUse.errQty")); return; }
    // Un mismo repuesto en dos filas se guardaría como dos movimientos: se suman.
    const merged = new Map<string, { spareId: string; qty: number; unit: string }>();
    for (const r of filas) {
      const prev = merged.get(r.spareId);
      if (prev) prev.qty += r.qty;
      else merged.set(r.spareId, { spareId: r.spareId, qty: r.qty, unit: r.unit });
    }
    setSaving(true);
    try {
      // Lista completa: el backend reemplaza los movimientos de esta OT.
      await api.patch(`/app/pms/work-orders/${woId}`, { spareUsages: [...merged.values()] });
      onClose();
    } catch (e) {
      setAviso(e instanceof Error ? e.message : t("dashboard.spareUse.errSave"));
    } finally {
      setSaving(false);
    }
  };

  /** Stock del repuesto elegido, con el semáforo de Repuestos & Stock. */
  const stockInfo = (r: UsageRow) => {
    const s = r.spareId ? spareById.get(r.spareId) : null;
    if (!s) return null;
    const critical = s.onHand < s.minStock;
    const warning = !critical && s.onHand <= s.reorderPoint;
    const cls = critical
      ? "text-red-700 dark:text-red-400"
      : warning ? "text-yellow-700 dark:text-yellow-400" : "text-emerald-700 dark:text-emerald-400";
    return { s, cls, insuficiente: r.qty > s.onHand };
  };

  return (
    // El clic afuera NO cierra: perder el consumo cargado por un clic al costado
    // es un mal negocio (mismo criterio que FormModal). Se sale por la X.
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div
        className="w-full max-w-3xl bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl p-6 space-y-4 max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-fg truncate">
              {wo ? `${wo.workOrderCode} — ${wo.title || "—"}` : t("dashboard.spareUse.button")}
            </h2>
            <p className="text-xs text-text-industrial/50 mt-0.5 truncate">
              {wo?.assetName || t("dashboard.spareUse.subtitle")}
            </p>
          </div>
          <ModalCloseButton onClose={onClose} />
        </div>

        {/* Alto mínimo generoso: el desplegable de repuestos se despliega DENTRO
            de esta zona y con la ventana al alto justo del contenido quedaba
            recortado — no se veían las opciones. */}
        <div className="flex-1 min-h-[min(24rem,55vh)] overflow-y-auto space-y-3">
          {loading && !wo && (
            <p className="flex items-center gap-2 text-xs text-text-industrial/50 py-6 justify-center">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> {t("common.loading")}
            </p>
          )}

          {wo && (
            <>
              {/* El consumo baja el stock: conviene decirlo donde se carga. */}
              <p className="text-[11px] text-text-industrial/50">{t("dashboard.spareUse.hint")}</p>

              {filas.length === 0 && (
                <p className="text-[11px] text-text-industrial/40 italic">{t("dashboard.spareUse.empty")}</p>
              )}

              {filas.map((r, i) => {
                const info = stockInfo(r);
                return (
                  <div key={i} className="flex gap-1.5 items-center">
                    <SpareSearchDropdown
                      spares={spares}
                      value={r.spareId}
                      fallbackLabel={r.label}
                      onChange={id => {
                        const s = spareById.get(id);
                        patch(i, s
                          ? { spareId: s.id, unit: s.unit, label: `${s.sku} — ${s.name}` }
                          : { spareId: id });
                      }}
                    />
                    <input
                      type="number" min={0} step="any"
                      className={`w-20 shrink-0 text-center bg-fg/5 border rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-accent/50 ${
                        info?.insuficiente ? "border-orange-500/40 text-orange-700 dark:text-orange-300" : "border-fg/10 text-fg"
                      }`}
                      value={r.qty}
                      onChange={e => patch(i, { qty: Number(e.target.value) })}
                    />
                    <span className="w-10 shrink-0 text-[11px] text-text-industrial/50">{r.unit}</span>
                    {info ? (
                      <span className={`w-24 shrink-0 text-right text-[11px] font-bold ${info.cls}`}
                        title={t("dashboard.spareUse.stockTitle")}>
                        {info.insuficiente && <AlertTriangle className="inline w-3 h-3 mr-0.5 -mt-0.5" />}
                        {info.s.onHand} {info.s.unit}
                      </span>
                    ) : <span className="w-24 shrink-0" />}
                    <button
                      type="button"
                      onClick={() => quitar(i)}
                      className="shrink-0 p-1.5 rounded-lg text-text-industrial/40 hover:text-red-500 hover:bg-red-500/10"
                      aria-label={t("dashboard.spareUse.remove")}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}

              <button
                type="button"
                onClick={agregar}
                className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-accent/10 border border-accent/20 text-accent text-[10px] font-bold uppercase tracking-wider hover:bg-accent/20"
              >
                <Plus className="w-3 h-3" /> {t("dashboard.spareUse.add")}
              </button>
            </>
          )}
        </div>

        <div className="shrink-0 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1 text-[11px] font-bold text-text-industrial/60 hover:text-accent"
          >
            <ChevronLeft className="w-3.5 h-3.5" /> {t("dashboard.spareUse.back")}
          </button>
          <button
            type="button"
            onClick={() => { void guardar(); }}
            disabled={saving || !wo}
            className="px-4 py-2 rounded-xl bg-accent text-white text-xs font-bold hover:bg-accent/90 disabled:opacity-40"
          >
            {saving ? t("common.saving") : t("dashboard.spareUse.save")}
          </button>
        </div>
      </div>

      {aviso && <AlertDialog message={aviso} onClose={() => setAviso(null)} />}
    </div>
  );
}
