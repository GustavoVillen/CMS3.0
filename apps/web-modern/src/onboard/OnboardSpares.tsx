// Consumo de repuestos: ¿para qué trabajo? → buscar → cantidad → descontar.
//
// Cada línea es un movimiento de salida (ISSUE) propio, igual que el que crea
// la confirmación de repuestos de un avance (V29): SUMA al consumo de la OT,
// nunca reemplaza la lista que ya cargó otro. Sin OT = consumo general del buque
// (decisión del usuario). El stock insuficiente se avisa pero no bloquea, igual
// que en la PC: queda para revisar el inventario.

import React, { useMemo, useState } from "react";
import { PackageMinus, Package, History, Minus, Plus, X, Loader2, Search, AlertTriangle } from "lucide-react";
import { useT, useWoTerms } from "../lib/i18n";
import { useFetch } from "../lib/hooks";
import { api } from "../lib/api";
import { useVesselContext } from "../lib/vessel-context";
import { AlertDialog } from "../components/AlertDialog";
import { Screen, Head, MainButton, DoneScreen, Sheet, inputCls } from "./ui";
import { errorText, useOpenWorkOrders } from "./shared";

interface SpareRow {
  id: string;
  sku: string;
  name: string;
  unit: string;
  reorderPoint: number;
  location: string | null;
  manufacturerPartNumber: string | null;
  internalPartNumber: string | null;
  onHand: number;
}

interface Line { spare: SpareRow; qty: number }

const fmtQty = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

export const OnboardSpares: React.FC<{ onExit: () => void }> = ({ onExit }) => {
  const t = useT();
  const woTerms = useWoTerms();
  const { selectedVesselCode } = useVesselContext();
  const openWos = useOpenWorkOrders();
  const spares = useFetch<{ items: SpareRow[] }>("/app/pms/spares");

  const [target, setTarget] = useState<{ id: string | null; code: string | null; title: string } | null>(null);
  const [query, setQuery] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [pick, setPick] = useState<{ spare: SpareRow; qty: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const [done, setDone] = useState<Line[] | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = spares.data?.items ?? [];
    const hits = q
      ? list.filter(s => `${s.name} ${s.sku} ${s.manufacturerPartNumber ?? ""} ${s.internalPartNumber ?? ""}`.toLowerCase().includes(q))
      : list;
    return hits.slice(0, 60);
  }, [spares.data, query]);

  const save = async () => {
    if (!selectedVesselCode || !target) return;
    setBusy(true);
    const saved: Line[] = [];
    try {
      for (const l of lines) {
        await api.post("/app/pms/stock-movements", {
          vesselCode: selectedVesselCode,
          spareId: l.spare.id,
          movementType: "ISSUE",
          quantity: l.qty,
          unit: l.spare.unit,
          occurredAt: new Date().toISOString(),
          referenceType: target.id ? "WORK_ORDER" : null,
          referenceId: target.id,
          notes: target.code ? t("ob.spares.noteWo").replace("{code}", target.code) : t("ob.spares.noteGeneral"),
        });
        saved.push(l);
      }
      setDone(saved);
    } catch (e) {
      // Lo que ya salió no se repite: se sacan de la lista las líneas guardadas.
      setLines(prev => prev.filter(l => !saved.includes(l)));
      setAlert(`${errorText(e, t("ob.sendFailed"))}${saved.length ? `\n${t("ob.spares.partial").replace("{n}", String(saved.length))}` : ""}`);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <DoneScreen
        icon={<PackageMinus className="w-10 h-10" />}
        title={t("ob.spares.done")}
        code={target?.code ?? t("ob.spares.general")}
        lines={[
          ...done.map(l => ({ icon: <Package className="w-[17px] h-[17px]" />, text: `${l.spare.name} · ${fmtQty(l.qty)} ${l.spare.unit}` })),
          { icon: <History className="w-[17px] h-[17px]" />, text: t("ob.spares.trace") },
        ]}
        onHome={onExit}
      />
    );
  }

  if (!target) {
    return (
      <Screen head={<Head title={t("ob.tile.spares")} sub={t("ob.spares.forWhat")} onBack={onExit} />}>
        {openWos.loading && openWos.items.length === 0 && <div className="flex justify-center py-6"><Loader2 className="w-6 h-6 animate-spin text-accent" /></div>}
        {openWos.items.map(w => (
          <button key={w.id} type="button" onClick={() => setTarget({ id: w.id, code: w.workOrderCode, title: w.title ?? w.workOrderCode })}
            className="w-full text-left bg-surface border border-fg/10 rounded-2xl p-3.5 flex flex-col gap-1 active:bg-fg/5">
            <span className="text-[12.5px] font-semibold text-text-industrial/60">{w.assetName ?? "—"}</span>
            <span className="text-base font-extrabold leading-snug">{w.title ?? w.workOrderCode}</span>
            <span className="font-mono text-xs font-semibold text-text-industrial/60">{w.workOrderCode}</span>
          </button>
        ))}
        <button type="button" onClick={() => setTarget({ id: null, code: null, title: t("ob.spares.general") })}
          className="w-full text-left bg-surface border border-dashed border-fg/20 rounded-2xl p-3.5 flex flex-col gap-1 active:bg-fg/5">
          <span className="text-[12.5px] font-semibold text-text-industrial/60">{t("ob.spares.noWo").replace("{wo}", woTerms.abbr)}</span>
          <span className="text-base font-extrabold">{t("ob.spares.general")}</span>
          <span className="text-[12.5px] text-text-industrial/60">{t("ob.spares.generalHint")}</span>
        </button>
      </Screen>
    );
  }

  const stockPill = (s: SpareRow) => s.onHand <= 0
    ? { cls: "bg-danger/15 text-danger", text: t("ob.spares.none") }
    : s.onHand <= s.reorderPoint
      ? { cls: "bg-warning/15 text-warning", text: t("ob.spares.left").replace("{n}", `${fmtQty(s.onHand)} ${s.unit}`) }
      : { cls: "bg-success/15 text-success", text: t("ob.spares.has").replace("{n}", `${fmtQty(s.onHand)} ${s.unit}`) };

  const pickQty = pick ? Number(pick.qty.replace(",", ".")) : 0;
  const pickValid = Number.isFinite(pickQty) && pickQty > 0;
  const already = pick ? lines.find(l => l.spare.id === pick.spare.id)?.qty ?? 0 : 0;

  return (
    <Screen
      head={<Head title={t("ob.tile.spares")} sub={target.code ? `${target.code} · ${target.title}` : target.title} onBack={() => { setTarget(null); setLines([]); }} />}
      foot={<MainButton busy={busy} disabled={lines.length === 0} icon={<PackageMinus className="w-5 h-5" />}
        label={lines.length ? (lines.length === 1 ? t("ob.spares.saveOne") : t("ob.spares.saveN")).replace("{n}", String(lines.length)) : t("ob.spares.pickFirst")}
        onClick={() => void save()} />}
    >
      {lines.length > 0 && (
        <div className="bg-surface border-[1.5px] border-accent rounded-2xl px-3.5 pt-2.5 pb-1">
          <p className="text-xs font-extrabold uppercase tracking-[0.07em] text-text-industrial/45">{t("ob.spares.cart")}</p>
          {lines.map(l => (
            <div key={l.spare.id} className="flex items-center gap-2.5 py-2.5 border-t border-fg/10 first-of-type:border-t-0">
              <span className="min-w-0 flex-1"><b className="block text-[14.5px] font-bold truncate">{l.spare.name}</b><span className="font-mono text-xs text-text-industrial/60">{l.spare.sku}</span></span>
              <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-accent/15 text-accent font-mono">{fmtQty(l.qty)} {l.spare.unit}</span>
              <button type="button" aria-label={t("ob.remove")} onClick={() => setLines(prev => prev.filter(x => x !== l))}
                className="w-10 h-10 rounded-xl bg-fg/5 grid place-items-center"><X className="w-4 h-4" /></button>
            </div>
          ))}
        </div>
      )}
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-industrial/40" />
        <input id="ob-spare-q" className={`${inputCls} pl-9`} value={query} onChange={e => setQuery(e.target.value)} placeholder={t("ob.spares.search")} />
      </div>
      {spares.loading && !spares.data ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-accent" /></div>
      ) : filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-text-industrial/50">{t("ob.noResults")}</p>
      ) : filtered.map(s => {
        const p = stockPill(s);
        const pn = s.manufacturerPartNumber || s.internalPartNumber || s.sku;
        return (
          <button key={s.id} type="button" onClick={() => setPick({ spare: s, qty: "1" })}
            className="w-full text-left bg-surface border border-fg/10 rounded-2xl px-3.5 py-3 flex items-center gap-3 active:bg-fg/5">
            <span className="min-w-0 flex-1">
              <b className="block text-[15px] font-bold leading-snug">{s.name}</b>
              <span className="block text-[12.5px] text-text-industrial/60 truncate"><span className="font-mono">P/N {pn}</span>{s.location ? ` · ${s.location}` : ""}</span>
            </span>
            <span className={`shrink-0 text-xs font-bold px-2.5 py-1 rounded-full ${p.cls}`}>{p.text}</span>
          </button>
        );
      })}

      {pick && (
        <Sheet title={pick.spare.name} sub={`P/N ${pick.spare.manufacturerPartNumber || pick.spare.sku}${pick.spare.location ? ` · ${pick.spare.location}` : ""}`} onClose={() => setPick(null)}>
          <div className="flex items-center justify-center gap-4">
            <button type="button" aria-label={t("ob.spares.less")}
              onClick={() => setPick(p => p && ({ ...p, qty: String(Math.max(1, (Number(p.qty.replace(",", ".")) || 1) - 1)) }))}
              className="w-[66px] h-[66px] rounded-[18px] border-[1.5px] border-fg/10 bg-fg/5 grid place-items-center"><Minus className="w-7 h-7" /></button>
            <input id="ob-spare-qty" inputMode="decimal" value={pick.qty} onChange={e => setPick(p => p && ({ ...p, qty: e.target.value }))}
              aria-label={t("ob.spares.qty")}
              className="w-[110px] text-center text-[42px] font-extrabold tabular-nums bg-transparent text-fg focus:outline-none border-b-2 border-fg/10 focus:border-accent" />
            <button type="button" aria-label={t("ob.spares.more")}
              onClick={() => setPick(p => p && ({ ...p, qty: String((Number(p.qty.replace(",", ".")) || 0) + 1) }))}
              className="w-[66px] h-[66px] rounded-[18px] border-[1.5px] border-fg/10 bg-fg/5 grid place-items-center"><Plus className="w-7 h-7" /></button>
          </div>
          <p className="text-center text-[12.5px] text-text-industrial/60">{t("ob.spares.used").replace("{unit}", pick.spare.unit)}</p>
          {pickValid && pickQty + already > pick.spare.onHand && (
            <div className="flex gap-2.5 items-start rounded-2xl p-3 bg-warning/10 text-[13.5px]">
              <AlertTriangle className="w-[17px] h-[17px] shrink-0 text-warning mt-px" />
              <span>{t("ob.spares.overStock").replace("{n}", `${fmtQty(pick.spare.onHand)} ${pick.spare.unit}`)}</span>
            </div>
          )}
          <div className="grid grid-cols-[1fr_1.4fr] gap-2">
            <button type="button" onClick={() => setPick(null)} className="min-h-12 rounded-2xl border-[1.5px] border-fg/10 font-bold">{t("ob.cancel")}</button>
            <MainButton disabled={!pickValid} label={t("ob.add")} icon={<Plus className="w-[18px] h-[18px]" />}
              onClick={() => {
                const s = pick.spare;
                setLines(prev => prev.some(l => l.spare.id === s.id)
                  ? prev.map(l => l.spare.id === s.id ? { ...l, qty: l.qty + pickQty } : l)
                  : [...prev, { spare: s, qty: pickQty }]);
                setPick(null);
              }} />
          </div>
        </Sheet>
      )}
      {alert && <AlertDialog message={alert} onClose={() => setAlert(null)} />}
    </Screen>
  );
};
