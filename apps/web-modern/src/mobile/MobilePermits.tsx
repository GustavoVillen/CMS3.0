// MobilePermits — bandeja de permisos de trabajo para el celular (/m-permisos).
//
// Pensada para el que AUTORIZA los permisos (en Mercurio, el Jefe SSMA): un
// link directo que abre sólo los permisos que esperan su aprobación, con lo
// necesario para decidir — tipo, buque, qué se hace, dónde, cuándo, peligros,
// controles, EPP, personal y la prueba de gases — y dos botones grandes.
//
// Aprobar deja el permiso ACTIVO en el mismo momento (lo hace el backend en
// approvePermit). La excepción es espacio confinado sin prueba de gases PASS
// de menos de 30 minutos: queda aprobado y se activa a bordo al cargarla. La
// hoja de confirmación lo avisa antes de firmar.
//
// No es la app completa (/m): es una pantalla de una sola función, como
// /m-approvals. Sin reglas propias: se muestra según "permit.authorize" y el
// backend vuelve a validar en cada acción.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  LogOut, ChevronLeft, ChevronRight, RefreshCw, Lock, Check, X, FileText, Loader2, CheckCircle2,
  AlertTriangle, Flame, Wind, ArrowUp, Zap, Snowflake, Waves,
} from "lucide-react";
import { useAuth, useCan } from "../lib/auth";
import { useVesselContext } from "../lib/vessel-context";
import { useT, type TranslationKey } from "../lib/i18n";
import { api, ApiError } from "../lib/api";
import { CmsLogo } from "../components/CmsLogo";
import { AlertDialog } from "../components/AlertDialog";
import { AutoTextArea } from "../components/AutoTextArea";
import { GuideNeedTag, RequiredMark } from "../components/GuideKit";
import { splitBullets } from "../onboard/shared";
import { downloadPermitFile } from "../lib/permit-files";

// ─── Tipos (espejo de permits-service.ts) ────────────────────────────────────

interface GasTest { verdict: "PASS" | "FAIL"; testedAt: string; o2Pct: number | null; lelPct: number | null; h2sPpm: number | null; coPpm: number | null }
interface Participant { id: string; name: string; role: ParticipantRole }
type ParticipantRole = "PERFORMER" | "FIRE_WATCH" | "STAND_BY" | "ATTENDANT" | "SUPERVISOR";

interface Permit {
  id: string;
  permitCode: string;
  vesselCode: string;
  type: string;
  status: string;
  location: string;
  description: string;
  plannedStart: string;
  plannedEnd: string;
  hazardsIdentified: string | null;
  controlMeasures: string | null;
  ppeRequired: string | null;
  workOrderCode: string | null;
  gasTests: GasTest[];
  participants: Participant[];
}

const TYPE_META: Record<string, { key: TranslationKey; Icon: React.FC<{ className?: string }>; tone: string }> = {
  HOT_WORK:             { key: "pm.type.hotWork",       Icon: Flame,     tone: "bg-red-500/15 text-red-700 dark:text-red-300" },
  ENCLOSED_SPACE_ENTRY: { key: "pm.type.enclosedSpace", Icon: Wind,      tone: "bg-orange-500/15 text-orange-700 dark:text-orange-300" },
  WORKING_ALOFT:        { key: "pm.type.workingAloft",  Icon: ArrowUp,   tone: "bg-sky-500/15 text-sky-700 dark:text-sky-300" },
  ELECTRICAL_ISOLATION: { key: "pm.type.electricalIso", Icon: Zap,       tone: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-300" },
  COLD_WORK:            { key: "pm.type.coldWork",      Icon: Snowflake, tone: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300" },
  UNDERWATER_WORK:      { key: "pm.type.underwater",    Icon: Waves,     tone: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300" },
};

/** Misma regla que activationBlock del backend: sólo para avisar antes de firmar. */
const GAS_VALID_MIN = 30;
function gasState(p: Permit): { kind: "none" | "fail" | "stale" | "ok"; minutes: number | null } | null {
  if (p.type !== "ENCLOSED_SPACE_ENTRY") return null;
  const latest = p.gasTests[0];
  if (!latest) return { kind: "none", minutes: null };
  const minutes = Math.max(0, Math.round((Date.now() - new Date(latest.testedAt).getTime()) / 60_000));
  if (latest.verdict !== "PASS") return { kind: "fail", minutes };
  return { kind: minutes <= GAS_VALID_MIN ? "ok" : "stale", minutes };
}
const willActivate = (p: Permit) => { const g = gasState(p); return !g || g.kind === "ok"; };

// ─── Fechas ──────────────────────────────────────────────────────────────────

const hhmm = (d: Date) => d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });

function useFmt() {
  const t = useT();
  return useMemo(() => ({
    /** "Hoy 08:00", "Mañana 14:00" o "12/10 08:00". */
    when(iso: string): string {
      const d = new Date(iso);
      const today = new Date();
      const tomorrow = new Date(); tomorrow.setDate(today.getDate() + 1);
      const day = d.toDateString() === today.toDateString() ? t("mpermit.today")
        : d.toDateString() === tomorrow.toDateString() ? t("mpermit.tomorrow")
        : d.toLocaleDateString(undefined, { day: "2-digit", month: "2-digit" });
      return `${day} ${hhmm(d)}`;
    },
    range(p: Permit): string {
      const a = new Date(p.plannedStart), b = new Date(p.plannedEnd);
      return a.toDateString() === b.toDateString() ? `${this.when(p.plannedStart)} → ${hhmm(b)}` : `${this.when(p.plannedStart)} → ${this.when(p.plannedEnd)}`;
    },
    /** "40 min", "1,5 h" o, pasadas las 48 h, "66 días". */
    span(ms: number): string {
      const min = Math.round(Math.abs(ms) / 60_000);
      if (min < 60) return `${min} min`;
      if (min < 48 * 60) return `${(Math.round(min / 6) / 10).toLocaleString()} h`;
      return t("mpermit.days").replace("{n}", String(Math.round(min / 1440)));
    },
  }), [t]);
}

/** "2026-10-08T08:00" para el <input type="datetime-local">, en hora local. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ─── Pantalla ────────────────────────────────────────────────────────────────

export const MobilePermits: React.FC = () => {
  const { tenant, logout } = useAuth();
  const can = useCan();
  const canAuthorize = can("permit.authorize");
  const { vessels, selectedVesselCode, setSelectedVesselCode, selectedVessel } = useVesselContext();
  const t = useT();

  const [items, setItems]     = useState<Permit[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId]   = useState<string | null>(null);
  const [sheet, setSheet]     = useState<"approve" | "reject" | null>(null);
  const [alert, setAlert]     = useState<string | null>(null);
  const [toast, setToast]     = useState<string | null>(null);

  const vesselName = useCallback(
    (code: string) => vessels.find(v => v.code === code)?.name ?? code,
    [vessels],
  );

  const load = useCallback(async () => {
    if (!canAuthorize) { setLoading(false); return; }
    setLoading(true);
    try {
      const qs = new URLSearchParams({ status: "REQUESTED" });
      if (selectedVesselCode) qs.set("vesselCode", selectedVesselCode);
      const res = await api.get<{ items: Permit[] }>(`/app/permits?${qs.toString()}`);
      // Los que empiezan antes, primero: son los que no pueden esperar.
      setItems([...(res.items ?? [])].sort((a, b) => new Date(a.plannedStart).getTime() - new Date(b.plannedStart).getTime()));
    } catch {
      setItems(null);
      setAlert(t("mpermit.loadError"));
    } finally {
      setLoading(false);
    }
  }, [canAuthorize, selectedVesselCode, t]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!toast) return;
    const h = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(h);
  }, [toast]);

  const open = items?.find(p => p.id === openId) ?? null;

  // Resuelto: sale de la bandeja sin recargar todo (no se pierde el scroll).
  const done = (p: Permit, msg: string) => {
    setItems(prev => prev?.filter(x => x.id !== p.id) ?? prev);
    setSheet(null);
    setOpenId(null);
    setToast(msg);
  };

  return (
    <div className="flex flex-col h-screen bg-surface dark:bg-[#0A1A2A] overflow-hidden relative">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header className="shrink-0 px-4 py-2.5 border-b border-fg/10 flex items-center gap-3 bg-surface dark:bg-[#0D1B2A]">
        {open ? (
          <button type="button" onClick={() => setOpenId(null)} className="shrink-0 p-2 -ml-2 text-text-industrial/60 hover:text-fg" aria-label={t("common.back")}>
            <ChevronLeft className="w-5 h-5" />
          </button>
        ) : (
          <CmsLogo className="w-7 h-7 shrink-0" title={tenant?.name ?? "CMS3.0"} />
        )}
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-[10px] uppercase tracking-widest text-accent font-bold leading-none truncate">{t("mpermit.title")}</span>
          {vessels.length > 1 && !open ? (
            <select
              value={selectedVesselCode ?? ""}
              onChange={e => setSelectedVesselCode(e.target.value || null)}
              className="mt-1 bg-fg/5 border border-fg/10 rounded-lg px-2 py-1 text-xs text-fg focus:outline-none focus:border-accent/50 appearance-none min-w-0"
            >
              <option value="">— {t("common.allVessels")} —</option>
              {vessels.map(v => <option key={v.code} value={v.code}>{v.name}</option>)}
            </select>
          ) : (
            <span className="text-xs text-text-industrial/50 truncate">
              {open ? open.permitCode : selectedVessel?.name ?? ""}
            </span>
          )}
        </div>
        {!open && (
          <button type="button" onClick={() => void load()} disabled={loading} className="shrink-0 p-2 text-text-industrial/40 hover:text-fg disabled:opacity-40" aria-label={t("mpermit.refresh")}>
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        )}
        <button type="button" onClick={logout} className="shrink-0 p-2 -mr-1 text-text-industrial/40 hover:text-fg" aria-label="logout">
          <LogOut className="w-4 h-4" />
        </button>
      </header>

      {/* ── Contenido ───────────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto">
        {!canAuthorize ? (
          <div className="m-5 p-5 rounded-2xl bg-fg/5 text-center space-y-2">
            <Lock className="w-7 h-7 mx-auto text-text-industrial/40" />
            <p className="text-sm font-bold text-fg">{t("mpermit.noPermission")}</p>
            <p className="text-xs text-text-industrial/60">{t("mpermit.noPermissionHint")}</p>
          </div>
        ) : open ? (
          <PermitDetail permit={open} vesselName={vesselName(open.vesselCode)} onError={setAlert} />
        ) : loading && !items ? (
          <p className="p-8 text-center text-sm text-text-industrial/50"><Loader2 className="w-5 h-5 animate-spin inline" /></p>
        ) : !items || items.length === 0 ? (
          <div className="px-6 py-16 text-center space-y-2">
            <CheckCircle2 className="w-10 h-10 mx-auto text-emerald-600" />
            <p className="text-sm font-bold text-fg">{t("mpermit.empty")}</p>
            <p className="text-xs text-text-industrial/50">{t("mpermit.emptyHint")}</p>
          </div>
        ) : (
          <div className="p-3 space-y-3">
            <p className="px-1 text-xs text-text-industrial/60">
              {t("mpermit.count").replace("{n}", String(items.length))}
            </p>
            {items.map(p => (
              <PermitCard key={p.id} permit={p} vesselName={vesselName(p.vesselCode)} onOpen={() => setOpenId(p.id)} />
            ))}
          </div>
        )}
      </main>

      {/* ── Botones de decisión (sólo en el detalle) ────────────────────────── */}
      {open && canAuthorize && (
        <div className="shrink-0 p-3 border-t border-fg/10 bg-surface dark:bg-[#0D1B2A] grid grid-cols-[1fr_1.4fr] gap-2.5">
          <button type="button" onClick={() => setSheet("reject")}
            className="min-h-[52px] rounded-2xl border-2 border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300 text-base font-extrabold flex items-center justify-center gap-1.5 active:scale-[0.98]">
            <X className="w-5 h-5" /> {t("common.reject")}
          </button>
          <button type="button" onClick={() => setSheet("approve")}
            className="min-h-[52px] rounded-2xl bg-emerald-600 text-white text-base font-extrabold flex items-center justify-center gap-1.5 active:scale-[0.98]">
            <Check className="w-5 h-5" /> {willActivate(open) ? t("pm.approveActivate") : t("common.approve")}
          </button>
        </div>
      )}

      {open && sheet === "approve" && (
        <ApproveSheet permit={open} vesselName={vesselName(open.vesselCode)} onClose={() => setSheet(null)}
          onError={msg => { setSheet(null); setAlert(msg); }}
          onDone={active => done(open, t(active ? "mpermit.doneActive" : "mpermit.doneApproved").replace("{code}", open.permitCode))} />
      )}
      {open && sheet === "reject" && (
        <RejectSheet permit={open} onClose={() => setSheet(null)}
          onError={msg => { setSheet(null); setAlert(msg); }}
          onDone={() => done(open, t("mpermit.doneRejected").replace("{code}", open.permitCode))} />
      )}

      {toast && (
        <div className="absolute left-3 right-3 bottom-4 z-[90] rounded-2xl bg-slate-900 text-white text-sm px-4 py-3 shadow-xl" role="status">
          {toast}
        </div>
      )}
      {alert && <AlertDialog message={alert} onClose={() => setAlert(null)} />}
    </div>
  );
};

// ─── Piezas ──────────────────────────────────────────────────────────────────

const TypeBadge: React.FC<{ type: string }> = ({ type }) => {
  const t = useT();
  const m = TYPE_META[type];
  if (!m) return <span className="text-xs font-bold">{type}</span>;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-extrabold whitespace-nowrap ${m.tone}`}>
      <m.Icon className="w-3.5 h-3.5" /> {t(m.key)}
    </span>
  );
};

/** "Debía empezar hace 1,5 h" (rojo), "Empieza en 40 min" (ámbar) o la fecha. */
const WhenTag: React.FC<{ permit: Permit }> = ({ permit }) => {
  const t = useT();
  const fmt = useFmt();
  const ms = new Date(permit.plannedStart).getTime() - Date.now();
  if (ms <= 0) {
    return <span className="shrink-0 px-2 py-0.5 rounded-full text-[11px] font-bold bg-red-500/10 text-red-700 dark:text-red-300">{t("mpermit.late").replace("{t}", fmt.span(ms))}</span>;
  }
  if (ms < 3 * 3_600_000) {
    return <span className="shrink-0 px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/15 text-amber-700 dark:text-amber-300">{t("mpermit.soon").replace("{t}", fmt.span(ms))}</span>;
  }
  return <span className="shrink-0 px-2 py-0.5 rounded-full text-[11px] font-bold bg-fg/5 text-text-industrial/60">{fmt.when(permit.plannedStart)}</span>;
};

const GasLine: React.FC<{ permit: Permit }> = ({ permit }) => {
  const t = useT();
  const g = gasState(permit);
  if (!g) return null;
  const ok = g.kind === "ok";
  const text = g.kind === "ok" ? t("mpermit.gasOk").replace("{n}", String(g.minutes))
    : g.kind === "stale" ? t("mpermit.gasStale").replace("{n}", String(g.minutes))
    : g.kind === "fail" ? t("mpermit.gasFail")
    : t("mpermit.gasNone");
  return (
    <div className={`flex items-start gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-bold ${ok ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-amber-500/10 text-amber-700 dark:text-amber-300"}`}>
      {ok ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-px" /> : <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />}
      <span>{text}</span>
    </div>
  );
};

const Meta: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex gap-2 text-[13px]">
    <span className="w-16 shrink-0 text-text-industrial/45">{label}</span>
    <span className="text-fg/80 min-w-0 break-words">{children}</span>
  </div>
);

const PermitCard: React.FC<{ permit: Permit; vesselName: string; onOpen: () => void }> = ({ permit, vesselName, onOpen }) => {
  const t = useT();
  const fmt = useFmt();
  return (
    <button type="button" onClick={onOpen}
      className="w-full text-left rounded-2xl border border-fg/10 bg-fg/[0.02] dark:bg-[#0D1B2A] p-3.5 space-y-2 active:scale-[0.99] transition-transform">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <TypeBadge type={permit.type} />
        <WhenTag permit={permit} />
      </div>
      <div>
        <p className="text-[11px] font-mono font-bold text-accent">{permit.permitCode}</p>
        <p className="text-xs text-text-industrial/50">{vesselName}</p>
      </div>
      <h3 className="text-[15px] font-bold text-fg leading-snug break-words">{permit.description}</h3>
      <div className="space-y-1">
        <Meta label={t("mpermit.where")}>{permit.location}</Meta>
        <Meta label={t("mpermit.schedule")}>{fmt.range(permit)}</Meta>
        {permit.workOrderCode && <Meta label={t("mpermit.wo")}>{permit.workOrderCode}</Meta>}
      </div>
      <GasLine permit={permit} />
      <p className="flex items-center gap-0.5 text-[13px] font-bold text-accent">{t("mpermit.review")} <ChevronRight className="w-4 h-4" /></p>
    </button>
  );
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="space-y-1.5">
    <h4 className="text-[10px] font-bold uppercase tracking-widest text-text-industrial/45">{title}</h4>
    {children}
  </section>
);

const Bullets: React.FC<{ text: string | null }> = ({ text }) => {
  const items = splitBullets(text ?? "");
  if (items.length === 0) return <p className="text-sm text-text-industrial/40">—</p>;
  return (
    <ul className="list-disc pl-5 space-y-1">
      {items.map((it, i) => <li key={i} className="text-sm text-fg/80 leading-snug">{it}</li>)}
    </ul>
  );
};

const PermitDetail: React.FC<{ permit: Permit; vesselName: string; onError: (msg: string) => void }> = ({ permit, vesselName, onError }) => {
  const t = useT();
  const fmt = useFmt();
  const [pdfBusy, setPdfBusy] = useState(false);
  const latestGas = permit.gasTests[0];
  const ppe = splitBullets(permit.ppeRequired ?? "");

  const openPdf = async () => {
    setPdfBusy(true);
    try {
      await downloadPermitFile(permit.id, "pdf", `${permit.permitCode}.pdf`);
    } catch {
      onError(t("mpermit.pdfError"));
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <div className="p-4 space-y-4">
      <div className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <TypeBadge type={permit.type} />
          <WhenTag permit={permit} />
        </div>
        <p className="text-xs text-text-industrial/50">{vesselName}{permit.workOrderCode ? ` · ${permit.workOrderCode}` : ""}</p>
        <h2 className="text-[17px] font-bold text-fg leading-snug break-words">{permit.description}</h2>
        <div className="space-y-1">
          <Meta label={t("mpermit.where")}>{permit.location}</Meta>
          <Meta label={t("mpermit.schedule")}>{fmt.range(permit)}</Meta>
        </div>
        <GasLine permit={permit} />
        {latestGas && permit.type === "ENCLOSED_SPACE_ENTRY" && (
          <p className="px-1 text-xs text-text-industrial/50">
            {[
              latestGas.o2Pct != null && `O₂ ${latestGas.o2Pct} %`,
              latestGas.lelPct != null && `LEL ${latestGas.lelPct} %`,
              latestGas.h2sPpm != null && `H₂S ${latestGas.h2sPpm} ppm`,
              latestGas.coPpm != null && `CO ${latestGas.coPpm} ppm`,
            ].filter(Boolean).join(" · ")}
          </p>
        )}
      </div>

      <Section title={t("mpermit.hazards")}><Bullets text={permit.hazardsIdentified} /></Section>
      <Section title={t("mpermit.controls")}><Bullets text={permit.controlMeasures} /></Section>
      <Section title={t("mpermit.ppe")}>
        {ppe.length === 0 ? <p className="text-sm text-text-industrial/40">—</p> : (
          <div className="flex flex-wrap gap-1.5">
            {ppe.map((it, i) => <span key={i} className="px-2.5 py-1 rounded-full bg-fg/5 border border-fg/10 text-xs text-fg/80">{it}</span>)}
          </div>
        )}
      </Section>
      <Section title={t("mpermit.people")}>
        {permit.participants.length === 0 ? <p className="text-sm text-text-industrial/40">—</p> : (
          <div className="space-y-0.5">
            {permit.participants.map(pp => (
              <p key={pp.id} className="text-sm text-fg/80">
                {pp.name} <span className="text-text-industrial/45">· {t(`mpermit.role.${pp.role}` as TranslationKey)}</span>
              </p>
            ))}
          </div>
        )}
      </Section>

      <button type="button" onClick={() => void openPdf()} disabled={pdfBusy}
        className="w-full min-h-[48px] rounded-xl border border-fg/10 bg-surface text-sm font-bold text-fg/80 flex items-center justify-center gap-2 disabled:opacity-50">
        {pdfBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />} {t("mpermit.pdf")}
      </button>
    </div>
  );
};

/** Hoja inferior común a aprobar y rechazar. El clic afuera la cierra. */
const Sheet: React.FC<{ onClose: () => void; children: React.ReactNode }> = ({ onClose, children }) => (
  <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
    <div role="dialog" className="w-full max-w-lg rounded-t-3xl bg-surface dark:bg-[#0D1B2A] p-5 pb-6 space-y-3" onClick={e => e.stopPropagation()}>
      {children}
    </div>
  </div>
);

const ApproveSheet: React.FC<{
  permit: Permit;
  vesselName: string;
  onClose: () => void;
  onError: (msg: string) => void;
  onDone: (active: boolean) => void;
}> = ({ permit, vesselName, onClose, onError, onDone }) => {
  const t = useT();
  const fmt = useFmt();
  const activates = willActivate(permit);
  const [edit, setEdit] = useState(false);
  const [from, setFrom] = useState(toLocalInput(permit.plannedStart));
  const [to, setTo]     = useState(toLocalInput(permit.plannedEnd));
  const [busy, setBusy] = useState(false);
  const badRange = edit && (!from || !to || new Date(to).getTime() <= new Date(from).getTime());

  const approve = async () => {
    if (badRange) return;
    setBusy(true);
    try {
      const res = await api.post<{ status: string }>(`/app/permits/${permit.id}/approve`,
        edit ? { validFrom: new Date(from).toISOString(), validTo: new Date(to).toISOString() } : {});
      onDone(res.status === "ACTIVE");
    } catch (e) {
      onError(e instanceof ApiError ? e.message : t("common.saveError"));
    } finally {
      setBusy(false);
    }
  };

  const inputCls = "w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2.5 text-[15px] text-fg focus:outline-none focus:border-accent/50";
  return (
    <Sheet onClose={onClose}>
      <div>
        <h3 className="text-lg font-extrabold text-fg">{t("mpermit.approveTitle").replace("{code}", permit.permitCode)}</h3>
        <p className="text-sm text-text-industrial/55">{t((TYPE_META[permit.type]?.key ?? "pm.type.hotWork"))} · {vesselName}</p>
      </div>
      <div className={`rounded-xl px-3 py-2 text-[13px] font-semibold ${activates ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-amber-500/10 text-amber-800 dark:text-amber-300"}`}>
        {activates ? t("mpermit.willActivate") : t("mpermit.wontActivate")}
      </div>
      {!edit ? (
        <>
          <div className="rounded-xl bg-fg/5 px-3 py-2.5">
            <p className="text-xs text-text-industrial/55">{t("mpermit.validity")}</p>
            <p className="text-base font-bold text-fg">{fmt.range(permit)}</p>
          </div>
          <button type="button" onClick={() => setEdit(true)} className="text-[13px] font-bold text-accent py-1">{t("mpermit.changeTime")}</button>
        </>
      ) : (
        <div className="space-y-2">
          <label className="block">
            <span className="block text-[11px] font-bold uppercase tracking-wider text-text-industrial/55 mb-1">{t("pm.validFrom")}</span>
            <input type="datetime-local" value={from} onChange={e => setFrom(e.target.value)} className={inputCls} />
          </label>
          <label className="block">
            <span className="block text-[11px] font-bold uppercase tracking-wider text-text-industrial/55 mb-1">{t("pm.validUntil")}</span>
            <input type="datetime-local" value={to} onChange={e => setTo(e.target.value)} className={`${inputCls} ${badRange ? "border-amber-500 border-2" : ""}`} />
          </label>
          {badRange && <p className="text-xs font-bold text-amber-700 dark:text-amber-300">{t("mpermit.badRange")}</p>}
        </div>
      )}
      <div className="grid grid-cols-[1fr_1.6fr] gap-2.5 pt-1">
        <button type="button" onClick={onClose} disabled={busy} className="min-h-[52px] rounded-2xl bg-fg/5 text-fg/70 text-base font-bold">{t("common.cancel")}</button>
        <button type="button" onClick={() => void approve()} disabled={busy || badRange}
          className="min-h-[52px] rounded-2xl bg-emerald-600 text-white text-base font-extrabold flex items-center justify-center gap-1.5 disabled:opacity-50">
          {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}
          {activates ? t("pm.approveActivate") : t("common.approve")}
        </button>
      </div>
    </Sheet>
  );
};

const REJECT_SUGGESTIONS: TranslationKey[] = ["mpermit.sugg.gas", "mpermit.sugg.controls", "mpermit.sugg.time", "mpermit.sugg.people"];

const RejectSheet: React.FC<{
  permit: Permit;
  onClose: () => void;
  onError: (msg: string) => void;
  onDone: () => void;
}> = ({ permit, onClose, onError, onDone }) => {
  const t = useT();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const missing = !reason.trim();

  const reject = async () => {
    if (missing) return;
    setBusy(true);
    try {
      await api.post(`/app/permits/${permit.id}/reject`, { reason: reason.trim() });
      onDone();
    } catch (e) {
      onError(e instanceof ApiError ? e.message : t("common.saveError"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet onClose={onClose}>
      <div>
        <h3 className="text-lg font-extrabold text-fg">{t("mpermit.rejectTitle").replace("{code}", permit.permitCode)}</h3>
        <p className="text-sm text-text-industrial/55">{t("mpermit.rejectSub")}</p>
      </div>
      <label className="block">
        <span className="block text-[11px] font-bold uppercase tracking-wider text-text-industrial/55 mb-1">
          {t("mpermit.reason")}<RequiredMark />{missing && <GuideNeedTag label={t("mp.guide.missing")} />}
        </span>
        <AutoTextArea rows={3} value={reason} onChange={e => setReason(e.target.value)} placeholder={t("mpermit.reasonPh")}
          className={`w-full rounded-xl px-3 py-2.5 text-[15px] text-fg focus:outline-none resize-none ${missing ? "border-2 border-amber-500 bg-amber-50 dark:bg-amber-500/10" : "border border-fg/10 bg-fg/5"}`} />
      </label>
      <div className="flex flex-wrap gap-1.5">
        {REJECT_SUGGESTIONS.map(k => (
          <button key={k} type="button" onClick={() => setReason(t(k))}
            className="px-3 py-1.5 rounded-full border border-fg/10 bg-surface text-xs text-fg/80">{t(k)}</button>
        ))}
      </div>
      <div className="grid grid-cols-[1fr_1.6fr] gap-2.5 pt-1">
        <button type="button" onClick={onClose} disabled={busy} className="min-h-[52px] rounded-2xl bg-fg/5 text-fg/70 text-base font-bold">{t("common.cancel")}</button>
        <button type="button" onClick={() => void reject()} disabled={busy || missing}
          className="min-h-[52px] rounded-2xl bg-red-600 text-white text-base font-extrabold flex items-center justify-center gap-1.5 disabled:opacity-50">
          {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <X className="w-5 h-5" />} {t("common.reject")}
        </button>
      </div>
    </Sheet>
  );
};

export default MobilePermits;
