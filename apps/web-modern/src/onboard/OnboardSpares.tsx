// Consumo de repuestos: qué tipo → cuál → cuánto → ¿para qué trabajo? → descontar.
//
// El pañol de un buque tiene decenas de repuestos, así que la pantalla abre por
// CATEGORÍA (Preview V38): un botón por tipo, con cuántos tiene, y recién ahí la
// lista. El buscador va arriba de todo y busca en todo el pañol — el que ya sabe
// el nombre o el P/N no pasa por las categorías.
//
// El trabajo se pregunta AL FINAL, después de elegir (decisión del usuario): al
// tocar "Descontar" aparece la lista de OT abiertas, o consumo general del buque.
//
// Cada línea es un movimiento de salida (ISSUE) propio, igual que el que crea
// la confirmación de repuestos de un avance (V29): SUMA al consumo de la OT,
// nunca reemplaza la lista que ya cargó otro. El stock insuficiente se avisa
// pero no bloquea, igual que en la PC: queda para revisar el inventario.

import React, { useMemo, useState } from "react";
import { PackageMinus, Package, History, Minus, Plus, X, Loader2, Search, AlertTriangle, ArrowLeft, Boxes } from "lucide-react";
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
  category: string | null;
  reorderPoint: number;
  location: string | null;
  manufacturerPartNumber: string | null;
  internalPartNumber: string | null;
  onHand: number;
}

interface Line { spare: SpareRow; qty: number }
interface Target { id: string | null; code: string | null; title: string }

const fmtQty = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

/** Categoría elegida = todo el pañol (el "Ver todos" del final de la grilla). */
const ALL = "__ALL__";

/**
 * Misma categoría escrita de varias formas = un solo botón. El catálogo real
 * tiene "Filtro" y "Filtros", "Electrico" y "Eléctrico", "Sensor" y "Sensores":
 * sin esto saldrían dos botones para lo mismo. Se agrupa ignorando mayúsculas,
 * tildes y el plural. NO toca el catálogo: es sólo cómo se muestra.
 */
function categoryKey(name: string): string {
  let k = name.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (k.endsWith("s")) k = k.slice(0, -1);
  if (k.endsWith("e")) k = k.slice(0, -1);
  return k;
}
const hasAccent = (s: string) => (/[áéíóúüñÁÉÍÓÚÜÑ]/.test(s) ? 1 : 0);

interface CategoryGroup { key: string; label: string; items: SpareRow[] }

/** Agrupa el pañol por categoría, primero las que más repuestos tienen. */
function groupByCategory(items: SpareRow[], noCategoryLabel: string): CategoryGroup[] {
  const map = new Map<string, { names: Map<string, number>; items: SpareRow[] }>();
  for (const s of items) {
    const raw = s.category?.trim() || noCategoryLabel;
    const key = categoryKey(raw);
    const entry = map.get(key) ?? { names: new Map<string, number>(), items: [] };
    entry.names.set(raw, (entry.names.get(raw) ?? 0) + 1);
    entry.items.push(s);
    map.set(key, entry);
  }
  return [...map.entries()]
    // Se muestra la forma más usada; a igual uso, la que lleva tilde.
    .map(([key, e]) => ({
      key,
      label: [...e.names.entries()].sort((a, b) => b[1] - a[1] || hasAccent(b[0]) - hasAccent(a[0]) || a[0].localeCompare(b[0]))[0]![0],
      items: e.items,
    }))
    .sort((a, b) => b.items.length - a.items.length || a.label.localeCompare(b.label));
}

export const OnboardSpares: React.FC<{ onExit: () => void }> = ({ onExit }) => {
  const t = useT();
  const woTerms = useWoTerms();
  const { selectedVesselCode, selectedVessel } = useVesselContext();
  const openWos = useOpenWorkOrders();
  // Sólo el pañol del buque elegido: el descuento se hace contra ESE buque y el
  // servidor rechaza un repuesto de otro. Sin el filtro, quien ve toda la flota
  // (Capitán, admin) elegía a ciegas y el error aparecía recién al guardar.
  const spares = useFetch<{ items: SpareRow[] }>(selectedVesselCode ? `/app/pms/spares?vesselCode=${encodeURIComponent(selectedVesselCode)}` : null);

  const [cat, setCat] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [pick, setPick] = useState<{ spare: SpareRow; qty: string } | null>(null);
  const [asking, setAsking] = useState(false);   // ¿para qué trabajo? (último paso)
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const [done, setDone] = useState<{ lines: Line[]; target: Target } | null>(null);

  const all = spares.data?.items ?? [];
  const groups = useMemo(() => groupByCategory(all, t("ob.spares.noCategory")), [all, t]);
  const current = cat && cat !== ALL ? groups.find(g => g.key === cat) ?? null : null;

  const searching = query.trim().length > 0;
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q) {
      return all
        .filter(s => `${s.name} ${s.sku} ${s.manufacturerPartNumber ?? ""} ${s.internalPartNumber ?? ""}`.toLowerCase().includes(q))
        .slice(0, 60);
    }
    if (cat === ALL) return all;
    return current?.items ?? [];
  }, [all, query, cat, current]);

  const save = async (target: Target) => {
    if (!selectedVesselCode) return;
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
      setDone({ lines: saved, target });
    } catch (e) {
      // Lo que ya salió no se repite: se sacan de la lista las líneas guardadas.
      setLines(prev => prev.filter(l => !saved.includes(l)));
      setAsking(false);
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
        code={done.target.code ?? t("ob.spares.general")}
        lines={[
          ...done.lines.map(l => ({ icon: <Package className="w-[17px] h-[17px]" />, text: `${l.spare.name} · ${fmtQty(l.qty)} ${l.spare.unit}` })),
          { icon: <History className="w-[17px] h-[17px]" />, text: t("ob.spares.trace") },
        ]}
        onHome={onExit}
      />
    );
  }

  // ── Último paso: ¿a qué trabajo se le carga el consumo? ────────────────────
  if (asking) {
    const choose = (target: Target) => { if (!busy) void save(target); };
    return (
      <Screen head={<Head title={t("ob.spares.forWhat")} sub={(lines.length === 1 ? t("ob.spares.saveOne") : t("ob.spares.saveN")).replace("{n}", String(lines.length))} onBack={() => setAsking(false)} />}>
        {busy && <div className="flex justify-center py-4"><Loader2 className="w-6 h-6 animate-spin text-accent" /></div>}
        {openWos.loading && openWos.items.length === 0 && <div className="flex justify-center py-6"><Loader2 className="w-6 h-6 animate-spin text-accent" /></div>}
        {openWos.items.map(w => (
          <button key={w.id} type="button" disabled={busy} onClick={() => choose({ id: w.id, code: w.workOrderCode, title: w.title ?? w.workOrderCode })}
            className="w-full text-left bg-surface border border-fg/10 rounded-2xl p-3.5 flex flex-col gap-1 active:bg-fg/5 disabled:opacity-50">
            <span className="text-[12.5px] font-semibold text-text-industrial/60">{w.assetName ?? "—"}</span>
            <span className="text-base font-extrabold leading-snug">{w.title ?? w.workOrderCode}</span>
            <span className="font-mono text-xs font-semibold text-text-industrial/60">{w.workOrderCode}</span>
          </button>
        ))}
        <button type="button" disabled={busy} onClick={() => choose({ id: null, code: null, title: t("ob.spares.general") })}
          className="w-full text-left bg-surface border border-dashed border-fg/20 rounded-2xl p-3.5 flex flex-col gap-1 active:bg-fg/5 disabled:opacity-50">
          <span className="text-[12.5px] font-semibold text-text-industrial/60">{t("ob.spares.noWo").replace("{wo}", woTerms.abbr)}</span>
          <span className="text-base font-extrabold">{t("ob.spares.general")}</span>
          <span className="text-[12.5px] text-text-industrial/60">{t("ob.spares.generalHint")}</span>
        </button>
        {alert && <AlertDialog message={alert} onClose={() => setAlert(null)} />}
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
  const showList = searching || cat !== null;

  return (
    <Screen
      head={<>
        <Head title={t("ob.tile.spares")} sub={selectedVessel?.name} onBack={onExit} />
        {/* El buscador va arriba de todo y fijo: busca en TODO el pañol, sin
            importar en qué categoría se esté parado. */}
        <div className="shrink-0 bg-surface px-4 pb-3 border-b border-fg/10">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-industrial/40" />
            <input id="ob-spare-q" className={`${inputCls} pl-9 pr-11`} value={query} onChange={e => setQuery(e.target.value)} placeholder={t("ob.spares.search")} />
            {searching && (
              <button type="button" aria-label={t("ob.remove")} onClick={() => setQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-fg/5 grid place-items-center">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </>}
      foot={<MainButton busy={busy} disabled={lines.length === 0} icon={<PackageMinus className="w-5 h-5" />}
        label={lines.length ? (lines.length === 1 ? t("ob.spares.saveOne") : t("ob.spares.saveN")).replace("{n}", String(lines.length)) : t("ob.spares.pickFirst")}
        onClick={() => setAsking(true)} />}
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

      {spares.loading && !spares.data ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-accent" /></div>
      ) : !showList ? (
        /* ── Paso 1: ¿qué tipo de repuesto? ──────────────────────────────── */
        <>
          <p className="text-xs font-extrabold uppercase tracking-[0.07em] text-text-industrial/45 px-0.5">{t("ob.spares.whatKind")}</p>
          <div className="grid grid-cols-2 gap-2.5">
            {groups.map(g => (
              <button key={g.key} type="button" onClick={() => setCat(g.key)}
                className="min-h-[76px] rounded-2xl border-[1.5px] border-fg/10 bg-surface p-3 flex flex-col justify-center gap-0.5 text-left active:bg-fg/5">
                <b className="text-[15px] font-extrabold leading-tight">{g.label}</b>
                <small className="text-[12.5px] font-semibold text-text-industrial/60">
                  {(g.items.length === 1 ? t("ob.spares.itemsOne") : t("ob.spares.itemsN")).replace("{n}", String(g.items.length))}
                </small>
              </button>
            ))}
            {all.length > 0 && (
              <button type="button" onClick={() => setCat(ALL)}
                className="col-span-2 min-h-[60px] rounded-2xl border-[1.5px] border-dashed border-fg/20 bg-surface px-3.5 flex items-center justify-between gap-3 text-left active:bg-fg/5">
                <span className="flex items-center gap-2.5"><Boxes className="w-[19px] h-[19px] text-text-industrial/50" /><b className="text-[15px] font-extrabold">{t("ob.spares.all")}</b></span>
                <small className="text-[12.5px] font-semibold text-text-industrial/60">{t("ob.spares.itemsN").replace("{n}", String(all.length))}</small>
              </button>
            )}
          </div>
          {all.length === 0 && <p className="py-8 text-center text-sm text-text-industrial/50">{t("ob.noResults")}</p>}
        </>
      ) : (
        /* ── Paso 2: los repuestos de esa categoría (o lo que dio el buscador) ── */
        <>
          {searching
            ? <p className="text-xs font-extrabold uppercase tracking-[0.07em] text-text-industrial/45 px-0.5">{t("ob.spares.foundAll")}</p>
            : <button type="button" onClick={() => setCat(null)}
                className="self-start min-h-10 px-3.5 rounded-full border border-fg/10 bg-surface text-[13px] font-bold inline-flex items-center gap-1.5 active:bg-fg/5">
                <ArrowLeft className="w-4 h-4" />
                {cat === ALL ? t("ob.spares.all") : current?.label} · {t("ob.spares.backToKinds")}
              </button>}
          {visible.length === 0 ? (
            <p className="py-8 text-center text-sm text-text-industrial/50">{t("ob.noResults")}</p>
          ) : visible.map(s => {
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
        </>
      )}

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
