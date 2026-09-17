import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Archive, BarChart3, CalendarCheck, ChevronRight, FileSpreadsheet, Loader2, Mail, Package, Phone, PhoneOff, Plus, Save, Search, Trash2, Truck, Wrench, X,
} from "lucide-react";
import { api, ApiError } from "../lib/api";
import { useFetch } from "../lib/hooks";
import { DataTable, fmtDate, type Column } from "../components/DataTable";
import { PageHeader } from "../components/PageHeader";
import { ModalCloseButton } from "../components/ModalCloseButton";
import { AlertDialog } from "../components/AlertDialog";
import { ExcelPanel } from "../components/ExcelPanel";
import { GuideSection, GuideField, GuideNeedTag, GuidePill, RequiredMark } from "../components/GuideKit";
import { useT, type TranslationKey } from "../lib/i18n";
import { useCan } from "../lib/auth";
import { useVesselContext } from "../lib/vessel-context";
import { useEscapeGuard, useDirtyTracker } from "../lib/escape-guard";
import { AutoTextArea } from "../components/AutoTextArea";
import { textMatches } from "../lib/text-search";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Provider {
  id: string; providerCode: string; name: string;
  category: string | null; status: string;
  contactName: string | null; contactEmail: string | null;
  contactPhone: string | null; location: string | null; notes: string | null; createdAt: string;
}
interface ListResponse { items: Provider[]; total: number; }

/** Lo que cada proveedor hace con nosotros: se arma cruzando SS, planes y recepciones. */
interface SsLite { id: string; serviceRequestCode: string; status: string; vesselCode: string; openDate: string; title: string | null; description: string | null; providerId: string | null }
interface PlanLite { id: string; vesselCode: string; providerId: string | null; status: string }
interface ReceiptLite { id: string; receiptCode: string; vesselCode: string; providerName: string | null; receivedAt: string }
interface ProviderLinks { ss: SsLite[]; plans: PlanLite[]; receipts: ReceiptLite[] }

const SS_TERMINAL = ["COMPLETED", "REJECTED", "CANCELLED"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const inputCls = "w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 disabled:opacity-60";
const fl = "flex items-center gap-1.5 text-xs font-semibold text-text-industrial/70 mb-1.5";

/** Cruza SS, planes y recepciones con el proveedor. Las recepciones guardan el nombre, no el id. */
function useProviderLinks() {
  const ss = useFetch<{ items: SsLite[] }>("/app/service-requests", []);
  const plans = useFetch<{ items: PlanLite[] }>("/app/pms/maintenance-plans", []);
  const receipts = useFetch<{ items: ReceiptLite[] }>("/app/pms/goods-receipts", []);
  const linksFor = useMemo(() => (p: Provider): ProviderLinks => {
    const name = p.name.trim().toLowerCase();
    return {
      ss: (ss.data?.items ?? []).filter(s => s.providerId === p.id),
      plans: (plans.data?.items ?? []).filter(pl => pl.providerId === p.id && pl.status !== "INACTIVE"),
      receipts: (receipts.data?.items ?? []).filter(r => (r.providerName ?? "").trim().toLowerCase() === name),
    };
  }, [ss.data, plans.data, receipts.data]);
  return { linksFor, loading: ss.loading || plans.loading || receipts.loading };
}

// ---------------------------------------------------------------------------
// ProviderModal
// ---------------------------------------------------------------------------

interface ModalProps {
  provider: Provider | null;
  links: ProviderLinks | null;
  linksLoading: boolean;
  onClose: () => void;
  onSaved: (p: Provider) => void;
}

const ProviderModal: React.FC<ModalProps> = ({ provider, links, linksLoading, onClose, onSaved }) => {
  const t = useT();
  const can = useCan();
  const navigate = useNavigate();
  const { vessels } = useVesselContext();
  // "Gestionar proveedores" de Equipo → Permisos: la misma matriz que valida el backend.
  const canManage = can("provider.manage");
  const isNew = provider === null;

  const [name,          setName]          = useState(provider?.name          ?? "");
  const [category,      setCategory]      = useState(provider?.category      ?? "");
  const [status,        setStatus]        = useState(provider?.status        ?? "ACTIVE");
  const [contactName,   setContactName]   = useState(provider?.contactName   ?? "");
  const [contactEmail,  setContactEmail]  = useState(provider?.contactEmail  ?? "");
  const [contactPhone,  setContactPhone]  = useState(provider?.contactPhone  ?? "");
  const [location,      setLocation]      = useState(provider?.location      ?? "");
  const [notes,         setNotes]         = useState(provider?.notes         ?? "");

  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) { setError(t("prov.nameRequired")); return; }
    setError(null);
    setSaving(true);
    const payload = {
      name:         name.trim(),
      category:     category.trim() || null,
      status:       status,
      contactName:  contactName.trim()  || null,
      contactEmail: contactEmail.trim() || null,
      contactPhone: contactPhone.trim() || null,
      location:     location.trim()     || null,
      notes:        notes.trim()        || null,
    };
    try {
      const result = isNew
        ? await api.post<Provider>("/app/providers", payload)
        : await api.patch<Provider>(`/app/providers/${provider.id}`, payload);
      onSaved(result);
    } catch (e: unknown) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : t("common.saveError"));
    } finally { setSaving(false); }
  };

  // ESC guard
  const isDirty = useDirtyTracker({
    name, category, status,
    contactName, contactEmail, contactPhone, location, notes,
  });
  const requestClose = useEscapeGuard({ isDirty: canManage && isDirty, onSave: canManage ? handleSave : undefined, onClose });

  const handleDelete = async () => {
    if (!provider) return;
    setSaving(true);
    try {
      await api.delete(`/app/providers/${provider.id}`);
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("error.delete"));
      setSaving(false);
      setConfirmDelete(false);
    }
  };

  const vesselName = (code: string) => vessels.find(v => v.code === code)?.name || code;
  const ssOpen = links?.ss.filter(s => !SS_TERMINAL.includes(s.status)) ?? [];
  const plansByVessel = useMemo(() => {
    const m = new Map<string, number>();
    for (const pl of links?.plans ?? []) m.set(pl.vesselCode, (m.get(pl.vesselCode) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [links]);
  const recentSs = [...(links?.ss ?? [])].sort((a, b) => {
    const ao = SS_TERMINAL.includes(a.status) ? 1 : 0, bo = SS_TERMINAL.includes(b.status) ? 1 : 0;
    return ao - bo || b.openDate.localeCompare(a.openDate);
  }).slice(0, 6);

  const box = (icon: React.ReactNode, title: string, right: React.ReactNode, body: React.ReactNode) => (
    <div className="rounded-2xl border border-fg/10 overflow-hidden">
      <h3 className="flex items-center gap-1.5 px-3 py-2.5 border-b border-fg/10 text-[13.5px] font-extrabold text-fg">{icon} {title}<span className="ml-auto">{right}</span></h3>
      <div className="p-3 space-y-2">{body}</div>
    </div>
  );
  const rel = "w-full flex items-center gap-2 rounded-xl border border-fg/10 px-2.5 py-2 text-left text-xs hover:border-accent/40 transition-colors";
  const empty = (txt: string) => <p className="text-xs text-text-industrial/45">{txt}</p>;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-5xl max-h-[92vh] bg-surface dark:bg-[#0D1B2A] border border-fg/10 border-t-4 border-t-teal-700 rounded-2xl shadow-2xl flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>

        {/* Encabezado */}
        <div className="flex items-start gap-3 px-4 sm:px-6 py-3 border-b border-fg/10 shrink-0">
          <span className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 bg-teal-500/15 text-teal-700 dark:text-teal-300"><Truck className="w-6 h-6" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-[10.5px] font-extrabold uppercase tracking-wider text-teal-700 dark:text-teal-400">{t("prov.kicker")}{category.trim() ? ` · ${category.trim()}` : ""}</p>
            <h2 className="text-lg font-black text-fg leading-tight truncate">{name.trim() || t("prov.new")}</h2>
            {(location.trim() || contactName.trim()) && <p className="text-xs text-text-industrial/60 truncate">{[location.trim(), contactName.trim()].filter(Boolean).join(" · ")}</p>}
            {!isNew && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className="rounded-full border border-fg/10 bg-fg/5 px-2 py-0.5 font-mono text-[11px] font-bold text-fg">{provider.providerCode}</span>
                <span className={`rounded-full border px-2 py-0.5 text-[11px] font-extrabold ${provider.status === "ACTIVE" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "border-fg/10 bg-fg/5 text-text-industrial/60"}`}>
                  {provider.status === "ACTIVE" ? t("prov.active") : t("prov.inactive")}
                </span>
                {provider.contactPhone && <a href={`tel:${provider.contactPhone}`} className="inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent/5 px-2 py-0.5 text-[11px] font-bold text-accent"><Phone className="w-3 h-3" />{provider.contactPhone}</a>}
                {provider.contactEmail && <a href={`mailto:${provider.contactEmail}`} className="inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent/5 px-2 py-0.5 text-[11px] font-bold text-accent"><Mail className="w-3 h-3" />{provider.contactEmail}</a>}
              </div>
            )}
          </div>
          <ModalCloseButton onClose={requestClose} />
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className={`grid grid-cols-1 ${isNew ? "" : "lg:grid-cols-[1.2fr_1fr]"} gap-4 px-4 sm:px-6 py-4`}>
            <div className="space-y-3 min-w-0">
              <GuideSection n={1} title={t("prov.sec1")} subtitle={isNew ? t("prov.sec1SubNew") : t("prov.sec1Sub")} open onToggle={() => { /* siempre abierto */ }}
                pill={canManage ? <GuidePill missing={name.trim() ? 0 : 1} completeLabel={t("mp.guide.complete")} missingOne={t("mp.guide.missingOne")} missingMany={t("mp.guide.missingMany")} /> : undefined}>
                {/* Obligatorio (preview V24). */}
                <GuideField id="prov-f-name" missing={canManage && !name.trim()}>
                  <label className={fl}>{t("col.name")}<RequiredMark />{canManage && !name.trim() && <GuideNeedTag label={t("mp.guide.missing")} />}</label>
                  <input value={name} onChange={e => setName(e.target.value)} disabled={!canManage} placeholder={t("prov.namePh")} className={inputCls} />
                </GuideField>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div><label className={fl}>{t("col.category")}</label><input value={category} onChange={e => setCategory(e.target.value)} disabled={!canManage} placeholder={t("prov.categoryPh")} className={inputCls} /></div>
                  <div>
                    <label className={fl}>{t("col.status")}</label>
                    <select value={status} onChange={e => setStatus(e.target.value)} disabled={!canManage} className={inputCls}>
                      <option value="ACTIVE">{t("prov.active")}</option>
                      <option value="INACTIVE">{t("prov.inactive")}</option>
                    </select>
                  </div>
                </div>
                <div><label className={fl}>{t("prov.location")}</label><input value={location} onChange={e => setLocation(e.target.value)} disabled={!canManage} placeholder={t("prov.locationPh")} className={inputCls} /></div>
              </GuideSection>
              <GuideSection n={2} title={t("prov.sec2")} subtitle={t("prov.sec2Sub")} open onToggle={() => { /* siempre abierto */ }}>
                <div><label className={fl}>{t("prov.contactName")}</label><input value={contactName} onChange={e => setContactName(e.target.value)} disabled={!canManage} placeholder={t("prov.contactNamePh")} className={inputCls} /></div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div><label className={fl}>{t("col.phone")}</label><input type="tel" value={contactPhone} onChange={e => setContactPhone(e.target.value)} disabled={!canManage} className={inputCls} /></div>
                  <div><label className={fl}>{t("prov.email")}</label><input type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)} disabled={!canManage} placeholder="correo@proveedor.com" className={inputCls} /></div>
                </div>
                <div>
                  <label className={fl}>{t("prov.notes")}</label>
                  <AutoTextArea value={notes} onChange={e => setNotes(e.target.value)} disabled={!canManage} rows={3} placeholder={t("prov.notesPh")} className={`${inputCls} resize-y min-h-[72px]`} />
                </div>
                {!isNew && <p className="text-[11px] text-text-industrial/45">{t("prov.createdAt")} {fmtDate(provider.createdAt)}</p>}
              </GuideSection>
            </div>

            {/* Derecha: lo que el proveedor hace con nosotros */}
            {!isNew && (
              <div className="space-y-3 min-w-0">
                {box(<BarChart3 className="w-4 h-4" />, t("prov.work"), linksLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" /> : null,
                  <div className="grid grid-cols-3 gap-2">
                    {([[t("prov.kpiSsOpen"), ssOpen.length, "text-blue-700 dark:text-blue-400"], [t("prov.kpiSsTotal"), links?.ss.length ?? 0, "text-fg"], [t("prov.kpiPlans"), links?.plans.length ?? 0, "text-fg"]] as const).map(([l, n, c]) => (
                      <div key={l} className="rounded-xl border border-fg/10 px-2.5 py-2"><p className="text-[10.5px] font-bold text-text-industrial/50">{l}</p><p className={`text-lg font-black ${c}`}>{n}</p></div>
                    ))}
                  </div>)}
                {box(<Wrench className="w-4 h-4" />, t("prov.ss"), null,
                  recentSs.length === 0 ? empty(t("prov.ssEmpty")) : recentSs.map(s => (
                    <button key={s.id} type="button" className={rel} onClick={() => navigate(`/service-requests?code=${encodeURIComponent(s.serviceRequestCode)}`)}>
                      <span className="font-mono text-[11px] font-bold text-accent shrink-0">{s.serviceRequestCode}</span>
                      <span className="truncate text-fg">{s.description || s.title || ""}</span>
                      <span className="ml-auto flex items-center gap-1.5 shrink-0">
                        <span className={`rounded-lg px-1.5 py-0.5 text-[10px] font-extrabold ${SS_TERMINAL.includes(s.status) ? "bg-fg/5 text-text-industrial/60" : "bg-blue-500/10 text-blue-700 dark:text-blue-400"}`}>{t(`ss.stage.${s.status}` as TranslationKey)}</span>
                        <ChevronRight className="w-3.5 h-3.5 text-text-industrial/40" />
                      </span>
                    </button>
                  )))}
                {box(<CalendarCheck className="w-4 h-4" />, t("prov.plans"), null,
                  plansByVessel.length === 0 ? empty(t("prov.plansEmpty")) : plansByVessel.map(([vc, n]) => (
                    <button key={vc} type="button" className={rel} onClick={() => navigate(`/maintenance-plans?vesselCode=${encodeURIComponent(vc)}`)}>
                      {/* Nombre del buque, no el código. */}
                      <b className="text-fg">{vesselName(vc)}</b>
                      <span className="text-text-industrial/55">{t("prov.plansN").replace("{n}", String(n))}</span>
                      <ChevronRight className="ml-auto w-3.5 h-3.5 text-text-industrial/40" />
                    </button>
                  )))}
                {box(<Package className="w-4 h-4" />, t("prov.receipts"), null,
                  (links?.receipts.length ?? 0) === 0 ? empty(t("prov.receiptsEmpty")) : links!.receipts.slice(0, 5).map(r => (
                    <button key={r.id} type="button" className={rel} onClick={() => navigate("/spare-receipts")}>
                      <span className="font-mono text-[11px] font-bold text-accent shrink-0">{r.receiptCode}</span>
                      <span className="text-text-industrial/60">{vesselName(r.vesselCode)}</span>
                      <span className="ml-auto text-[11px] text-text-industrial/50">{fmtDate(r.receivedAt)}</span>
                    </button>
                  )))}
              </div>
            )}
          </div>
        </div>

        {/* Pie */}
        <div className="flex flex-wrap items-center gap-2 px-4 sm:px-6 py-3 border-t border-fg/10 shrink-0">
          {!isNew && canManage && (
            <button type="button" onClick={() => setConfirmDelete(true)} disabled={saving}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-red-500/30 text-xs font-bold text-red-700 dark:text-red-400 hover:bg-red-500/10 disabled:opacity-50">
              <Trash2 className="w-3.5 h-3.5" /> {t("common.delete")}
            </button>
          )}
          <span className="flex-1" />
          <button type="button" onClick={requestClose} className="px-3 py-2 rounded-xl text-xs text-text-industrial hover:text-fg">{t("common.close")}</button>
          {canManage && (
            <button type="button" onClick={() => void handleSave()} disabled={saving}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-teal-700 text-white font-bold text-xs hover:brightness-110 disabled:opacity-50">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} {isNew ? t("prov.create") : t("common.save")}
              {!saving && !name.trim() && <span className="text-[10px] font-semibold opacity-85">{t("mp.guide.saveMissing").replace("{n}", "1")}</span>}
            </button>
          )}
        </div>
      </div>

      {confirmDelete && provider && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={e => e.stopPropagation()}>
          <div className="w-full max-w-md bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-3.5 border-b border-fg/10">
              <h2 className="text-base font-black text-fg">{t("prov.deleteTitle")}</h2>
              <ModalCloseButton onClose={() => setConfirmDelete(false)} className="ml-auto" />
            </div>
            <p className="px-5 py-4 text-sm text-fg">{t("confirm.deleteProvider").replace("{name}", provider.name)}</p>
            <div className="flex items-center gap-2 px-5 py-3 border-t border-fg/10">
              <span className="flex-1" />
              <button type="button" onClick={() => setConfirmDelete(false)} className="px-3 py-2 rounded-xl text-xs text-text-industrial hover:text-fg">{t("common.back")}</button>
              <button type="button" onClick={() => void handleDelete()} disabled={saving} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-600 text-white text-xs font-bold hover:brightness-110 disabled:opacity-50">
                {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} {t("common.delete")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Avisos y errores en ventanita. */}
      {error && <AlertDialog message={error} onClose={() => setError(null)} />}
    </div>
  );
};

// ---------------------------------------------------------------------------
// ProvidersPage
// ---------------------------------------------------------------------------

type ProvCard = "" | "ssOpen" | "plans" | "noContact" | "inactive";

export const ProvidersPage: React.FC = () => {
  const t = useT();
  const can = useCan();
  const canManage = can("provider.manage");

  const [showExcel, setShowExcel] = useState(false);
  const [selected,  setSelected]  = useState<Provider | null | "new">(null);
  // ── Listado (preview V23) ──────────────────────────────────────────────────
  // Se trae todo y se filtra en cliente (son pocas decenas).
  const { data, loading, error, reload } = useFetch<ListResponse>("/app/providers", []);
  const { linksFor, loading: linksLoading } = useProviderLinks();
  const [cardSel, setCardSel] = useState<ProvCard>("");
  const [statusSel, setStatusSel] = useState<"ACTIVE" | "INACTIVE" | "">("ACTIVE");
  const [catSel, setCatSel] = useState("");
  const [search, setSearch] = useState("");

  const handleSaved = (p: Provider) => { reload(); setSelected(p); };

  const items = useMemo(() => data?.items ?? [], [data]);
  const categories = useMemo(() => [...new Set(items.map(p => p.category).filter(Boolean) as string[])].sort(), [items]);
  const stats = useMemo(() => new Map(items.map(p => {
    const l = linksFor(p);
    return [p.id, { ssOpen: l.ss.filter(s => !SS_TERMINAL.includes(s.status)).length, ss: l.ss.length, plans: l.plans.length, receipts: l.receipts.length }];
  })), [items, linksFor]);
  const st = (p: Provider) => stats.get(p.id) ?? { ssOpen: 0, ss: 0, plans: 0, receipts: 0 };
  const matchCard = (p: Provider, k: ProvCard) => {
    switch (k) {
      case "ssOpen":    return st(p).ssOpen > 0;
      case "plans":     return st(p).plans > 0;
      case "noContact": return p.status === "ACTIVE" && !p.contactName?.trim() && !p.contactPhone?.trim() && !p.contactEmail?.trim();
      case "inactive":  return p.status !== "ACTIVE";
      default:          return true;
    }
  };
  const shown = useMemo(() => {
    let r = items;
    if (cardSel) r = r.filter(p => matchCard(p, cardSel));
    else if (statusSel) r = r.filter(p => p.status === statusSel);
    if (catSel) r = r.filter(p => p.category === catSel);
    const q = search.trim().toLowerCase();
    if (q) r = r.filter(p => textMatches(p.name, q) || textMatches(p.providerCode, q) || textMatches(p.category ?? "", q) || textMatches(p.contactName ?? "", q));
    return r;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, cardSel, statusSel, catSel, search, stats]);

  const workCell = (p: Provider) => {
    const s = st(p);
    if (linksLoading) return <Loader2 className="w-3.5 h-3.5 animate-spin text-text-industrial/30" />;
    if (!s.ss && !s.plans && !s.receipts) return <span className="text-[11px] text-text-industrial/40">{t("prov.noActivity")}</span>;
    const mini = "inline-flex items-center gap-1 mr-2 text-[11px] whitespace-nowrap";
    return (
      <span className="flex flex-wrap">
        {s.ssOpen > 0 && <span className={`${mini} font-bold text-blue-700 dark:text-blue-400`}><Wrench className="w-3 h-3" />{t("prov.ssOpenN").replace("{n}", String(s.ssOpen))}</span>}
        {s.ss > 0 && <span className={`${mini} text-text-industrial/60`}>{t("prov.ssN").replace("{n}", String(s.ss))}</span>}
        {s.plans > 0 && <span className={`${mini} text-text-industrial/60`}><CalendarCheck className="w-3 h-3" />{t("prov.plansN").replace("{n}", String(s.plans))}</span>}
        {s.receipts > 0 && <span className={`${mini} text-text-industrial/60`}><Package className="w-3 h-3" />{t("prov.receiptsN").replace("{n}", String(s.receipts))}</span>}
      </span>
    );
  };
  const contactCell = (p: Provider) => p.contactName || p.contactPhone || p.contactEmail
    ? <div className="min-w-0"><div className="text-xs text-fg">{p.contactName ?? "—"}</div><div className="text-[10.5px] text-text-industrial/50 truncate">{p.contactPhone ?? p.contactEmail}</div></div>
    : <span className="inline-flex items-center gap-1 text-[11px] font-bold text-red-700 dark:text-red-400"><PhoneOff className="w-3 h-3" />{t("prov.noContactShort")}</span>;
  const statusChip = (p: Provider) => (
    <span className={`inline-block whitespace-nowrap rounded-lg border px-2 py-0.5 text-[10.5px] font-extrabold ${p.status === "ACTIVE" ? "border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-700 dark:text-emerald-400" : "border-fg/10 bg-fg/5 text-text-industrial/60"}`}>
      {p.status === "ACTIVE" ? t("prov.active") : t("prov.inactive")}
    </span>
  );

  const COLUMNS: Column<Provider>[] = [
    { key: "name", header: t("prov.col.provider"), sortValue: r => r.name, render: r => <div><div className="text-xs font-bold text-fg">{r.name}</div><div className="font-mono text-[10.5px] text-text-industrial/50">{r.providerCode}</div></div> },
    { key: "category", header: t("col.category"), sortValue: r => r.category ?? "", render: r => <span className="text-xs text-text-industrial/70">{r.category ?? "—"}</span> },
    { key: "contactName", header: t("prov.contact"), render: contactCell },
    { key: "work", header: t("prov.work"), sortValue: r => st(r).ss + st(r).plans + st(r).receipts, render: workCell },
    { key: "location", header: t("col.location"), render: r => <span className="text-xs text-text-industrial/55">{r.location ?? "—"}</span> },
    { key: "status", header: t("col.status"), render: statusChip },
  ];

  const summaryCards: { key: Exclude<ProvCard, "">; label: string; hint: string; icon: typeof Truck; cls: string; num: string }[] = [
    { key: "ssOpen", label: t("prov.sum.ssOpen"), hint: t("prov.sum.ssOpenHint"), icon: Wrench, cls: "border-l-blue-600", num: "text-blue-700 dark:text-blue-400" },
    { key: "plans", label: t("prov.sum.plans"), hint: t("prov.sum.plansHint"), icon: CalendarCheck, cls: "border-l-violet-600", num: "text-violet-700 dark:text-violet-400" },
    { key: "noContact", label: t("prov.sum.noContact"), hint: t("prov.sum.noContactHint"), icon: PhoneOff, cls: "border-l-red-600", num: "text-red-700 dark:text-red-400" },
    { key: "inactive", label: t("prov.sum.inactive"), hint: t("prov.sum.inactiveHint"), icon: Archive, cls: "border-l-fg/30", num: "text-text-industrial/70" },
  ];
  const selCls = (on: boolean) => `rounded-lg border px-2 py-1.5 text-xs focus:outline-none focus:border-accent/50 ${on ? "border-accent bg-accent/5 font-bold text-accent" : "border-fg/10 bg-fg/5 text-fg"}`;
  const selectedLinks = selected && selected !== "new" ? linksFor(selected) : null;

  return (
    <div className="space-y-4">
      {showExcel && <ExcelPanel module="providers" onClose={() => { setShowExcel(false); reload(); }} />}
      {selected && (
        <ProviderModal
          key={selected === "new" ? "new" : selected.id}
          provider={selected === "new" ? null : selected}
          links={selectedLinks}
          linksLoading={linksLoading}
          onClose={() => { setSelected(null); reload(); }}
          onSaved={handleSaved}
        />
      )}

      <PageHeader icon={Truck} title={t("page.providers")} total={shown.length} onReload={reload}>
        <button onClick={() => setShowExcel(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-fg/5 border border-fg/10 text-xs text-text-industrial hover:border-accent/30 transition-all">
          <FileSpreadsheet className="w-3.5 h-3.5 text-accent" /> Excel
        </button>
        {canManage && (
          <button onClick={() => setSelected("new")} className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-teal-700 text-white text-xs font-bold hover:brightness-110 transition-all">
            <Plus className="w-3.5 h-3.5" /> {t("prov.new")}
          </button>
        )}
      </PageHeader>

      {/* Resumen: tocar una tarjeta filtra. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        {summaryCards.map(c => {
          const on = cardSel === c.key;
          return (
            <button key={c.key} type="button" onClick={() => setCardSel(on ? "" : c.key)}
              className={`flex flex-col items-start gap-0.5 rounded-2xl border-[1.5px] border-l-4 bg-surface px-3 py-2.5 text-left transition-all ${c.cls} ${on ? "border-accent ring-2 ring-accent/20" : "border-fg/10 hover:border-fg/25"}`}>
              <span className={`text-2xl font-extrabold leading-tight ${c.num}`}>{linksLoading && (c.key === "ssOpen" || c.key === "plans") ? "…" : items.filter(p => matchCard(p, c.key)).length}</span>
              <span className="flex items-center gap-1 text-xs font-semibold text-text-industrial/70"><c.icon className="w-3.5 h-3.5" />{c.label}</span>
              <span className="text-[10px] text-text-industrial/40">{c.hint}</span>
            </button>
          );
        })}
      </div>

      {/* Filtros */}
      <div className="rounded-2xl border border-fg/10 bg-surface p-3">
        <div className="flex flex-wrap items-center gap-2">
          <select value={catSel} onChange={e => setCatSel(e.target.value)} className={selCls(!!catSel)}>
            <option value="">{t("prov.catAll")}</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={statusSel} onChange={e => setStatusSel(e.target.value as typeof statusSel)} disabled={!!cardSel} className={selCls(statusSel !== "ACTIVE")}>
            <option value="ACTIVE">{t("prov.statusActive")}</option>
            <option value="INACTIVE">{t("prov.statusInactive")}</option>
            <option value="">{t("prov.statusAll")}</option>
          </select>
          <div className="flex items-center gap-1.5 rounded-lg border border-fg/10 bg-fg/5 px-2.5 py-1.5 w-full sm:w-auto sm:ml-auto">
            <Search className="w-3.5 h-3.5 text-text-industrial/40 shrink-0" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t("prov.search")}
              className="w-full sm:w-64 bg-transparent text-xs text-fg placeholder-text-industrial/30 focus:outline-none" />
            {search && <button type="button" onClick={() => setSearch("")} className="text-text-industrial/40 hover:text-fg"><X className="w-3 h-3" /></button>}
          </div>
        </div>
      </div>

      {/* Escritorio: tabla · Celular: tarjetas */}
      <div className="hidden md:block">
        <DataTable columns={COLUMNS} data={shown} loading={loading} error={error} keyFn={r => r.id} emptyText={t("empty.providers")} onRowClick={r => setSelected(r)} />
      </div>
      <div className="md:hidden flex flex-col gap-2">
        {loading && <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-accent" /></div>}
        {!loading && shown.length === 0 && <p className="py-8 text-center text-sm text-text-industrial/40">{t("empty.providers")}</p>}
        {shown.map(p => (
          <div key={p.id} onClick={() => setSelected(p)} className="rounded-xl border border-fg/10 bg-surface px-3 py-2.5 space-y-1 cursor-pointer">
            <div className="flex items-center gap-2"><b className="text-[13px] text-fg">{p.name}</b><span className="ml-auto">{statusChip(p)}</span></div>
            <p className="text-[11px] text-text-industrial/55">{p.providerCode}{p.category ? ` · ${p.category}` : ""}</p>
            {workCell(p)}
          </div>
        ))}
      </div>
    </div>
  );
};
