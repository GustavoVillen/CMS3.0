import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, RotateCcw, Search, ShieldCheck, Trash2 } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { useT, useLocale, type TranslationKey } from "../lib/i18n";
import { useVesselContext } from "../lib/vessel-context";
import { PageHeader } from "../components/PageHeader";
import { AlertDialog } from "../components/AlertDialog";
import { announceRestored } from "../lib/delete-undo";

// Papelera: lo que se borró en el sistema, con quién y cuándo, y el botón para
// volverlo a su lugar. Sólo con el permiso trash.restore (por defecto, el
// administrador). La lógica y los módulos incluidos están en el backend:
// apps/api/src/tenant/trash/trash-service.ts.

interface TrashItem {
  kind: string;
  id: string;
  code: string;
  label: string;
  vesselCode: string | null;
  vesselName: string | null;
  assetId: string | null;
  assetName: string | null;
  assetDeleted: boolean;
  deletedAt: string;
  deletedByName: string | null;
}

const KINDS = [
  "plan", "asset", "spare", "defect", "certificate", "provider", "crew", "drill", "permit", "moc",
  "nearMiss", "externalAudit", "fluidSample", "checklist", "serviceRequest", "spareRequest",
  "drydockSpec", "stockLocation", "bitacora", "vessel",
] as const;

const KIND_STYLE: Record<string, string> = {
  plan: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  asset: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  spare: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  defect: "bg-red-500/10 text-red-700 dark:text-red-300",
};

const PERIODS = [
  { days: 7, key: "trash.period.7" },
  { days: 30, key: "trash.period.30" },
  { days: 0, key: "trash.period.all" },
] as const;

type Group = "today" | "week" | "month" | "older";

function groupOf(iso: string): Group {
  const d = new Date(iso);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = d.getTime();
  if (t >= startToday) return "today";
  if (t >= startToday - 6 * 86_400_000) return "week";
  if (t >= startToday - 29 * 86_400_000) return "month";
  return "older";
}

/** Lo que hay que preguntar antes de restaurar. */
type Pending =
  | { type: "parent"; ids: string[]; parents: TrashItem[] }
  | { type: "children"; ids: string[]; children: TrashItem[] };

const key = (i: { kind: string; id: string }) => `${i.kind}:${i.id}`;

export const TrashPage: React.FC = () => {
  const t = useT();
  const locale = useLocale();
  const { vessels } = useVesselContext();

  const [days, setDays] = useState<number>(30);
  const [kind, setKind] = useState("");
  const [vesselCode, setVesselCode] = useState("");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<TrashItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ days: String(days) });
      if (kind) params.set("kind", kind);
      if (vesselCode) params.set("vesselCode", vesselCode);
      setItems(await api.get<TrashItem[]>(`/app/trash?${params.toString()}`));
      setSel(new Set());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("trash.loadError"));
    } finally {
      setLoading(false);
    }
  }, [days, kind, vesselCode, t]);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return items;
    return items.filter(i => {
      const hay = `${i.code} ${i.label} ${i.assetName ?? ""} ${i.vesselName ?? ""} ${i.deletedByName ?? ""}`.toLowerCase();
      return words.every(w => hay.includes(w));
    });
  }, [items, q]);

  const byKey = useMemo(() => new Map(items.map(i => [key(i), i])), [items]);
  const kindLabel = (k: string) => t(`trash.kind.${k}` as TranslationKey);

  const fmtWhen = (iso: string) => {
    const d = new Date(iso);
    const time = d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
    if (groupOf(iso) === "today") return `${t("trash.today")} ${time}`;
    return `${d.toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" })} ${time}`;
  };

  // ── Restaurar ─────────────────────────────────────────────────────────────
  const doRestore = async (keys: string[]) => {
    setPending(null);
    setBusy(true);
    try {
      const refs = [...new Set(keys)].map(k => { const [kind, id] = k.split(":"); return { kind, id }; });
      const res = await api.post<{ restored: unknown[] }>("/app/trash/restore", { items: refs });
      announceRestored(res.restored.length);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("trash.loadError"));
    } finally {
      setBusy(false);
    }
  };

  /** Antes de restaurar: que nada quede colgado de un equipo borrado, y ofrecer traer lo que se borró con el equipo. */
  const askRestore = (keys: string[]) => {
    const chosen = new Set(keys);
    const parents: TrashItem[] = [];
    for (const k of keys) {
      const it = byKey.get(k);
      if (!it?.assetDeleted || !it.assetId) continue;
      const pk = `asset:${it.assetId}`;
      if (chosen.has(pk) || parents.some(p => key(p) === pk)) continue;
      parents.push(byKey.get(pk) ?? {
        kind: "asset", id: it.assetId, code: "", label: it.assetName ?? "", vesselCode: it.vesselCode,
        vesselName: it.vesselName, assetId: null, assetName: null, assetDeleted: false, deletedAt: it.deletedAt, deletedByName: null,
      });
    }
    if (parents.length) { setPending({ type: "parent", ids: keys, parents }); return; }

    const assetIds = new Set(keys.filter(k => k.startsWith("asset:")).map(k => k.slice(6)));
    const children = assetIds.size ? items.filter(i => i.assetId && assetIds.has(i.assetId) && !chosen.has(key(i))) : [];
    if (children.length) { setPending({ type: "children", ids: keys, children }); return; }

    void doRestore(keys);
  };

  // ── Selección ─────────────────────────────────────────────────────────────
  const toggle = (k: string) => setSel(prev => {
    const next = new Set(prev);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });
  const allSelected = visible.length > 0 && visible.every(i => sel.has(key(i)));
  const toggleAll = () => setSel(allSelected ? new Set() : new Set(visible.map(key)));

  // ── Render ────────────────────────────────────────────────────────────────
  const groups: Group[] = ["today", "week", "month", "older"];
  const ctl = "border border-fg/10 bg-surface rounded-xl px-3 py-2 text-sm text-fg focus:outline-none focus:border-accent";

  return (
    <div className="space-y-4">
      <PageHeader icon={Trash2} title={t("page.trash")} total={loading ? undefined : visible.length} onReload={() => void load()} />
      <p className="text-sm text-text-industrial/60 -mt-2">{t("trash.subtitle")}</p>

      <div className="flex flex-wrap gap-2 items-center">
        <div className="inline-flex rounded-xl border border-fg/10 bg-surface overflow-hidden" role="group">
          {PERIODS.map(p => (
            <button key={p.days} type="button" onClick={() => setDays(p.days)}
              className={`px-3 py-2 text-sm ${days === p.days ? "bg-accent/10 text-accent font-bold" : "text-text-industrial/60 hover:bg-fg/5"}`}>
              {t(p.key)}
            </button>
          ))}
        </div>
        <select value={kind} onChange={e => setKind(e.target.value)} className={ctl} aria-label={t("trash.col.kind")}>
          <option value="">{t("trash.filter.allKinds")}</option>
          {KINDS.map(k => <option key={k} value={k}>{kindLabel(k)}</option>)}
        </select>
        <select value={vesselCode} onChange={e => setVesselCode(e.target.value)} className={ctl} aria-label={t("trash.col.vessel")}>
          <option value="">{t("trash.filter.allVessels")}</option>
          {vessels.map(v => <option key={v.code} value={v.code}>{v.name}</option>)}
        </select>
        <label className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-industrial/40" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={t("trash.search")} className={`${ctl} w-full pl-9`} />
        </label>
      </div>

      <div className="rounded-2xl border border-fg/10 bg-surface overflow-hidden">
        {sel.size > 0 && (
          <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 bg-accent/5 border-b border-fg/10 text-sm">
            <span><b>{sel.size}</b> {t("trash.selected")}</span>
            <span className="flex-1" />
            <button type="button" onClick={() => setSel(new Set())} className="px-3 py-1.5 rounded-lg text-sm hover:bg-fg/5">{t("trash.clearSelection")}</button>
            <button type="button" disabled={busy} onClick={() => askRestore([...sel])}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-accent text-accent-fg text-sm font-bold hover:bg-accent/80 disabled:opacity-50">
              <RotateCcw className="w-4 h-4" />{t("trash.restoreSelected")}
            </button>
          </div>
        )}

        {/* Encabezado de columnas (sólo pantallas anchas) */}
        <div className="hidden md:grid grid-cols-[28px_130px_minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)_140px_120px] gap-3 px-4 py-2.5 border-b border-fg/10 bg-fg/[0.02] text-xs font-semibold text-text-industrial/60">
          <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label={t("trash.selectAll")} className="mt-0.5" />
          <span>{t("trash.col.kind")}</span>
          <span>{t("trash.col.what")}</span>
          <span>{t("trash.col.vessel")}</span>
          <span>{t("trash.col.asset")}</span>
          <span>{t("trash.col.deletedBy")}</span>
          <span>{t("trash.col.when")}</span>
          <span />
        </div>

        {loading ? (
          <div className="py-12 text-center text-sm text-text-industrial/50">{t("common.loading")}</div>
        ) : visible.length === 0 ? (
          <div className="py-12 px-4 text-center">
            <div className="inline-flex w-11 h-11 rounded-xl bg-fg/5 items-center justify-center mb-2.5"><Check className="w-5 h-5 text-text-industrial/50" /></div>
            <div className="font-semibold text-fg">{t("trash.empty.title")}</div>
            <div className="text-sm text-text-industrial/60 mt-1">{t("trash.empty.body")}</div>
          </div>
        ) : groups.map(g => {
          const rows = visible.filter(i => groupOf(i.deletedAt) === g);
          if (!rows.length) return null;
          return (
            <div key={g}>
              <div className="px-4 py-1.5 bg-fg/[0.02] border-b border-fg/5 text-xs font-semibold text-text-industrial/60">{t(`trash.group.${g}` as TranslationKey)}</div>
              {rows.map(i => {
                const k = key(i);
                return (
                  <div key={k} className="grid grid-cols-[28px_minmax(0,1fr)_auto] md:grid-cols-[28px_130px_minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)_140px_120px] gap-x-3 gap-y-1 items-center px-4 py-2.5 border-b border-fg/5 text-sm hover:bg-accent/[0.03]">
                    <input type="checkbox" checked={sel.has(k)} onChange={() => toggle(k)} aria-label={`${i.code} ${i.label}`} />
                    <span className="md:order-none order-2 col-start-2 md:col-start-auto">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${KIND_STYLE[i.kind] ?? "bg-fg/5 text-text-industrial/70"}`}>{kindLabel(i.kind)}</span>
                    </span>
                    <div className="min-w-0 col-start-2 md:col-start-auto row-start-1 md:row-start-auto">
                      <div className="font-semibold text-fg truncate" title={i.label}>{i.label || i.code}</div>
                      {i.code && i.label !== i.code && <div className="text-xs text-text-industrial/50">{i.code}</div>}
                      {i.assetDeleted && (
                        <div className="inline-flex items-center gap-1 text-xs text-amber-600 mt-0.5"><AlertTriangle className="w-3 h-3" />{t("trash.assetAlsoDeleted")}</div>
                      )}
                    </div>
                    <span className="col-start-2 md:col-start-auto text-text-industrial/80 truncate">{i.vesselName ?? "—"}</span>
                    <span className="col-start-2 md:col-start-auto text-text-industrial/80 truncate">{i.assetName ?? "—"}</span>
                    <span className="col-start-2 md:col-start-auto text-text-industrial/80 truncate">{i.deletedByName ?? "—"}</span>
                    <span className="col-start-2 md:col-start-auto text-text-industrial/70 whitespace-nowrap">{fmtWhen(i.deletedAt)}</span>
                    <div className="col-start-3 row-start-1 md:col-start-auto md:row-start-auto text-right">
                      <button type="button" disabled={busy} onClick={() => askRestore([k])}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-fg/10 text-xs font-semibold text-fg hover:border-accent hover:text-accent disabled:opacity-50">
                        <RotateCcw className="w-3.5 h-3.5" />{t("trash.restore")}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      <p className="flex items-start gap-1.5 text-xs text-text-industrial/60">
        <ShieldCheck className="w-4 h-4 shrink-0" />{t("trash.note")}
      </p>

      {pending && (
        <div className="fixed inset-0 z-[210] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={() => setPending(null)}>
          <div role="alertdialog" aria-modal="true" onClick={e => e.stopPropagation()}
            className="bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <h2 className="text-base font-bold text-fg flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              {pending.type === "parent" ? t("trash.dlg.parentTitle") : t("trash.dlg.childrenTitle")}
            </h2>
            <div className="text-sm text-text-industrial/80 leading-relaxed">
              {pending.type === "parent" ? t("trash.dlg.parentBody") : t("trash.dlg.childrenBody")}
              <ul className="mt-2 list-disc pl-5 text-fg max-h-48 overflow-y-auto">
                {(pending.type === "parent" ? pending.parents : pending.children).map(p => (
                  <li key={key(p)}>{p.code ? `${p.code} · ` : ""}{p.label}</li>
                ))}
              </ul>
            </div>
            <div className="flex flex-wrap justify-end gap-2 pt-1">
              <button type="button" onClick={() => setPending(null)}
                className="px-4 py-2.5 rounded-xl bg-fg/5 border border-fg/10 text-sm font-semibold text-fg hover:bg-fg/10">{t("common.cancel")}</button>
              {pending.type === "children" && (
                <button type="button" onClick={() => void doRestore(pending.ids)}
                  className="px-4 py-2.5 rounded-xl bg-fg/5 border border-fg/10 text-sm font-semibold text-fg hover:bg-fg/10">{t("trash.dlg.onlyAsset")}</button>
              )}
              <button type="button" autoFocus
                onClick={() => void doRestore(pending.type === "parent"
                  ? [...pending.ids, ...pending.parents.map(key)]
                  : [...pending.ids, ...pending.children.map(key)])}
                className="px-5 py-2.5 rounded-xl bg-accent text-accent-fg text-sm font-bold hover:bg-accent/80">
                {pending.type === "parent" ? t("trash.dlg.restoreBoth") : t("trash.dlg.assetAndChildren")}
              </button>
            </div>
          </div>
        </div>
      )}

      {error && <AlertDialog message={error} onClose={() => setError(null)} />}
    </div>
  );
};
