import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams, useLocation } from "react-router-dom";
import {
  FlaskConical, Plus, Upload, Sparkles, Loader2, X, Eye, Edit3, Save,
  Trash2, FileText, TrendingUp,
  ArrowUpDown, ChevronUp, ChevronDown, Clipboard,
  Activity, AlertOctagon, AlertTriangle, AudioLines, Clock, Droplets, Files, Hourglass, Pencil, ScanLine, Search, TestTube, Thermometer,
  Check, CheckCircle2, ClipboardList, List, Ship, Wrench, ListChecks, ArrowRight,
} from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Legend } from "recharts";
import { useFetch } from "../lib/hooks";
import { api, ApiError } from "../lib/api";
import { ModalCloseButton } from "../components/ModalCloseButton";
import { AlertDialog } from "../components/AlertDialog";
import { MarkdownText } from "../components/MarkdownText";
import { PageHeader } from "../components/PageHeader";
import { ExportExcelButton } from "../components/ExportExcelButton";
import { useT, useWoTerms, type TranslationKey } from "../lib/i18n";
import { textMatches } from "../lib/text-search";
import { useAuth, useCan } from "../lib/auth";
import { useCopilotEmitter, useCopilotScreenContext } from "../lib/copilot-context";
import { useVesselContext } from "../lib/vessel-context";
import { fmtDate } from "../lib/utils";
import { useEscapeGuard, useDirtyTracker } from "../lib/escape-guard";
import { AuthedDocLink } from "../lib/authed-media";
import { useTmsaFilter, applyTmsaFilter, TmsaFilterBanner } from "../lib/tmsa-filter";
import {
  FLUID_TYPES, FLUID_LABELS, VERDICTS, VERDICT_STYLES, SAMPLE_STATUSES, SAMPLE_KIND_LABELS,
  VerdictBadge, assetLabel, ConfidenceBadge, ModalShell,
  inputCls, labelCls,
  type FluidType, type Verdict, type SampleStatus, type FluidParameter, type FluidResult,
  type FluidSample, type AssetItem,
} from "../components/fluid-analyses/shared";
import { ScanFluidSampleWizard } from "../components/fluid-analyses/ScanFluidSampleWizard";
import { FluidBatchUploadModal } from "../components/fluid-analyses/FluidBatchUploadModal";
import { AutoTextArea } from "../components/AutoTextArea";
import { GuideField, GuideNeedTag, RequiredMark } from "../components/GuideKit";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ListResponse { items: FluidSample[]; total: number; }

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function uploadAndExtract(file: File, vesselCode: string | null, referenceDate: string | null, sampleNumber?: string | null): Promise<{ extracted: any; file: { url: string; name: string; mime: string } }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/octet-stream",
    "X-Filename": encodeURIComponent(file.name),
  };
  const token = localStorage.getItem("gpms_token");
  const slug  = localStorage.getItem("gpms_tenant_slug");
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (slug)  headers["X-Tenant-Slug"] = slug;
  if (vesselCode) headers["X-Vessel-Code"] = vesselCode;
  if (referenceDate) headers["X-Reference-Date"] = referenceDate;
  if (sampleNumber && sampleNumber.trim()) headers["X-Sample-Number"] = encodeURIComponent(sampleNumber.trim());
  const res = await fetch("/app/fluid-analyses/extract", { method: "POST", headers, body: file });
  if (!res.ok) {
    let msg = res.statusText;
    try { const j = await res.json(); msg = j?.error?.message ?? msg; } catch { /* noop */ }
    throw new Error(msg);
  }
  return res.json();
}

// ─── Main page ────────────────────────────────────────────────────────────────

/** Días sin moverse a partir de los cuales una muestra se marca demorada (V18). */
const FA_DRAFT_LATE_DAYS = 7;
const FA_SENT_LATE_DAYS = 14;

const KIND_ICON: Record<string, typeof FlaskConical> = {
  FLUID: Droplets, VIBRATION: Activity, THERMAL: Thermometer, ULTRASOUND: AudioLines, OTHER: FlaskConical,
};
const FA_STATUS_CLS: Record<string, string> = {
  DRAFT: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  SENT: "bg-blue-500/15 text-blue-800 dark:text-blue-300",
  REPORTED: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
  ARCHIVED: "bg-fg/5 text-text-industrial/60",
};
type FaCardKey = "draft" | "sent" | "bad" | "caution";

/** Días desde una fecha ISO hasta hoy (0 si no hay fecha). */
function faDaysSince(iso: string | null | undefined): number {
  if (!iso) return 0;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000));
}
/** Cuántos días lleva la muestra en su estado actual (creada / enviada). */
const faWaitDays = (s: FluidSample) => (s.status === "SENT" ? faDaysSince(s.sentAt ?? s.createdAt) : faDaysSince(s.createdAt));
const faIsLate = (s: FluidSample) =>
  (s.status === "DRAFT" && faWaitDays(s) > FA_DRAFT_LATE_DAYS) || (s.status === "SENT" && faWaitDays(s) > FA_SENT_LATE_DAYS);
const faIsBad = (s: FluidSample) => s.result?.verdict === "CRITICAL" || s.result?.verdict === "ACTION_REQUIRED";

function faMatchCard(s: FluidSample, key: FaCardKey): boolean {
  switch (key) {
    case "draft":   return s.status === "DRAFT";
    case "sent":    return s.status === "SENT";
    case "bad":     return s.status === "REPORTED" && faIsBad(s);
    case "caution": return s.status === "REPORTED" && s.result?.verdict === "CAUTION";
  }
}

export const FluidAnalysesPage: React.FC = () => {
  const t = useT();
  // Mismo tilde que el backend (`fluid.manage`, ensureCanManageFluidAnalyses).
  const canManage = useCan()("fluid.manage");

  const navigate = useNavigate();

  // Deep-link desde la alerta "sin procesar" del Dashboard: ?status=DRAFT
  // arranca con ese estado elegido.
  const [searchParams, setSearchParams] = useSearchParams();
  const { key: locationKey } = useLocation();
  const statusParam = (searchParams.get("status") ?? "").trim();
  const [creatingSample, setCreatingSample] = useState(false);
  const [scanningWizard, setScanningWizard] = useState(false);
  const [batchUpload, setBatchUpload] = useState(false);
  const [openDetailId, setOpenDetailId] = useState<string | null>(null);

  // ── Filtros (preview V18) ──
  const [cardSel, setCardSel] = useState<FaCardKey | "">("");
  const [stageSel, setStageSel] = useState<string>(() => ((SAMPLE_STATUSES as readonly string[]).includes(statusParam) ? statusParam : ""));
  const [kindSel, setKindSel] = useState("");
  const [assetSel, setAssetSel] = useState("");
  const [verdictSel, setVerdictSel] = useState("");
  const [search, setSearch] = useState("");

  // Deep-link para abrir una muestra desde otra pantalla (hoy: el código FA que
  // se muestra junto a las SS en el modal de OT): ?openId=<id>.
  const openIdParam = (searchParams.get("openId") ?? "").trim();
  useEffect(() => {
    if (openIdParam) setOpenDetailId(openIdParam);
  }, [openIdParam]);

  /**
   * Cerrar el detalle. Si se llegó por deep-link, se vuelve a la pantalla
   * anterior — la muestra abierta desde una OT vuelve a esa OT. Si la muestra
   * fue la primera pantalla de la sesión (link pegado) no hay a dónde volver:
   * sólo se limpia el parámetro. Mismo criterio que useDeepLink y que la SS.
   */
  const closeDetail = () => {
    setOpenDetailId(null);
    if (!openIdParam) return;
    if (locationKey !== "default") { navigate(-1); return; }
    const params = new URLSearchParams(searchParams);
    params.delete("openId");
    setSearchParams(params, { replace: true });
  };
  // Orden por defecto: código descendente (la muestra más nueva primero). Los
  // códigos son correlativos, así que ordenar por código deja la grilla en el
  // orden de carga, que es el que espera el usuario al entrar.
  const [sortKey, setSortKey] = useState<string>("sampleCode");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const handleSort = (key: string) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };

  const { data, loading, error, reload } = useFetch<ListResponse>("/app/fluid-analyses", []);
  // Filtro que llega desde una métrica del panel TMSA (lib/tmsa-filter.tsx).
  // Acá el emparejamiento va por CÓDIGO: la métrica cuenta resultados de
  // análisis y esta planilla lista muestras; lo que comparten es el sampleCode.
  const tmsaFilter = useTmsaFilter();

  // ?code=FA-M01-0037 — para links que sólo conocen el CÓDIGO y no el id
  // interno (típicamente el copiloto, que cita códigos en su respuesta). Se
  // resuelve contra la lista ya cargada; no hace falta consultar de nuevo.
  const codeParam = (searchParams.get("code") ?? "").trim().toUpperCase();
  useEffect(() => {
    if (!codeParam) return;
    const hit = (data?.items ?? []).find(s => s.sampleCode.toUpperCase() === codeParam);
    if (hit) setOpenDetailId(hit.id);
  }, [codeParam, data]);

  const { data: assetsData } = useFetch<{ items: AssetItem[] }>("/app/assets", []);
  // Reuse VesselContext instead of re-fetching /app/vessels.
  const { vessels: contextVessels } = useVesselContext();

  const assets = useMemo(() => assetsData?.items ?? [], [assetsData?.items]);
  const vesselName = (code: string) => contextVessels.find(v => v.code === code)?.name || code;
  const scoped = useMemo(() => applyTmsaFilter(data?.items ?? [], tmsaFilter, s => s.sampleCode) ?? [], [data?.items, tmsaFilter]);

  /** Todo menos el estado: base de los contadores de los botones de estado. */
  const beforeStage = useMemo(() => {
    let items = scoped;
    if (cardSel) items = items.filter(s => faMatchCard(s, cardSel));
    if (kindSel) items = items.filter(s => s.kind === kindSel);
    if (assetSel) items = items.filter(s => s.assetId === assetSel);
    if (verdictSel) items = items.filter(s => s.result?.verdict === verdictSel);
    const q = search.trim().toLowerCase();
    if (q) {
      items = items.filter(s =>
        textMatches(s.sampleCode, q) || textMatches(assetLabel(s.assetId, assets), q) ||
        textMatches(s.sourceWorkOrderCode ?? "", q) || textMatches(vesselName(s.vesselCode), q) ||
        textMatches(s.fluidType ? (FLUID_LABELS[s.fluidType] ?? "") : "", q),
      );
    }
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoped, cardSel, kindSel, assetSel, verdictSel, search, assets, contextVessels]);

  /** "Activas" deja afuera las archivadas, salvo que se esté buscando. */
  const stageFilter = useCallback((items: FluidSample[], key: string) => {
    if (key) return items.filter(s => s.status === key);
    if (search.trim()) return items;
    return items.filter(s => s.status !== "ARCHIVED");
  }, [search]);

  const samples = useMemo(() => {
    const items = [...stageFilter(beforeStage, stageSel)];
    items.sort((a, b) => {
      let av: string | number | null = null;
      let bv: string | number | null = null;
      if (sortKey === "sampleCode")  { av = a.sampleCode;  bv = b.sampleCode; }
      if (sortKey === "assetId")     { av = assetLabel(a.assetId, assets); bv = assetLabel(b.assetId, assets); }
      if (sortKey === "kind")        { av = a.kind;        bv = b.kind; }
      if (sortKey === "sampledAt")   { av = a.sampledAt;   bv = b.sampledAt; }
      if (sortKey === "status")      { av = a.status;      bv = b.status; }
      if (sortKey === "verdict")     { av = a.result?.verdict ?? ""; bv = b.result?.verdict ?? ""; }
      if (sortKey === "sourceWo")    { av = a.sourceWorkOrderCode ?? ""; bv = b.sourceWorkOrderCode ?? ""; }
      if (av === null || bv === null) return 0;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return items;
  }, [beforeStage, stageFilter, stageSel, sortKey, sortDir, assets]);

  const summary = useMemo(() => ({
    draft: scoped.filter(s => faMatchCard(s, "draft")).length,
    sent: scoped.filter(s => faMatchCard(s, "sent")).length,
    bad: scoped.filter(s => faMatchCard(s, "bad")).length,
    caution: scoped.filter(s => faMatchCard(s, "caution")).length,
  }), [scoped]);
  const assetOptions = useMemo(() => {
    const ids = [...new Set(scoped.map(s => s.assetId))];
    return ids.map(id => ({ id, label: assetLabel(id, assets) })).sort((a, b) => a.label.localeCompare(b.label));
  }, [scoped, assets]);

  // Borrado desde la propia fila (mismo endpoint y mismo permiso que el botón
  // del detalle: baja lógica, sólo admin/manager).
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const removeSample = async (s: FluidSample) => {
    if (!confirm(`${t("confirm.deleteSample")}\n\n${s.sampleCode}`)) return;
    setDeletingId(s.id);
    try {
      await api.delete(`/app/fluid-analyses/${s.id}`);
      reload();
    } catch (e) {
      setDeleteError(e instanceof ApiError ? e.message : t("common.error"));
    } finally {
      setDeletingId(null);
    }
  };

  // Próximo paso de cada muestra: todos abren la muestra, donde se carga la
  // toma o el informe del laboratorio.
  const rowAction = (s: FluidSample) => {
    if (!canManage) return null;
    if (s.status === "DRAFT") return { label: t("fa.list.actTake"), icon: Pencil, cls: "border-accent/35 bg-accent/5 text-accent hover:bg-accent/15" };
    if (s.status === "SENT") return { label: t("fa.list.actReport"), icon: ScanLine, cls: "border-violet-500/35 bg-violet-500/[0.07] text-violet-700 dark:text-violet-300 hover:bg-violet-500/15" };
    if (s.status === "REPORTED" && faIsBad(s)) return { label: t("fa.list.actSeeResult"), icon: AlertOctagon, cls: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400 hover:bg-red-500/20" };
    return null;
  };
  const renderAction = (s: FluidSample) => {
    const a = rowAction(s);
    if (!a) return null;
    const Icon = a.icon;
    return (
      <button type="button" onClick={e => { e.stopPropagation(); setOpenDetailId(s.id); }}
        className={`inline-flex items-center gap-1 whitespace-nowrap rounded-lg border px-2 py-1 text-[11px] font-bold transition-colors ${a.cls}`}>
        <Icon className="w-3 h-3" /> {a.label}
      </button>
    );
  };
  const kindCell = (s: FluidSample) => {
    const Icon = KIND_ICON[s.kind] ?? FlaskConical;
    return (
      <div>
        <span className="inline-flex items-center gap-1.5 font-semibold text-fg"><Icon className="w-3.5 h-3.5" />{t(`mp.samp.kind.${s.kind}` as TranslationKey)}</span>
        {s.kind === "FLUID" && s.fluidType && <div className="text-[10.5px] text-text-industrial/50">{FLUID_LABELS[s.fluidType] ?? s.fluidType}</div>}
      </div>
    );
  };
  // OT correctiva con la que se cerró el defecto del resultado (preview V47).
  const repairWoLink = (s: FluidSample) => s.result?.defectWorkOrderCode ? (
    <button type="button"
      onClick={e => { e.stopPropagation(); navigate(`/work-orders?openId=${encodeURIComponent(s.result!.defectWorkOrderId!)}`); }}
      className="mt-1 flex items-center gap-1 text-[11px] font-bold text-accent hover:underline">
      <Wrench className="w-3 h-3 shrink-0" />
      <span className="font-mono">{s.result.defectWorkOrderCode}</span>
      {s.result.defectWorkOrderStatus && (
        <span className="font-semibold text-text-industrial/55">· {t(`fa.woSt.${s.result.defectWorkOrderStatus}` as TranslationKey)}</span>
      )}
    </button>
  ) : null;

  const waitCell = (s: FluidSample) => {
    if (s.status !== "DRAFT" && s.status !== "SENT") return null;
    const late = faIsLate(s);
    const key = s.status === "SENT" ? "fa.list.sentAgo" : "fa.list.createdAgo";
    return (
      <span className={`inline-flex items-center gap-1 text-[11px] ${late ? "font-bold text-red-700 dark:text-red-400" : "text-text-industrial/60"}`}>
        {late && <Clock className="w-3 h-3" />}{t(key).replace("{n}", String(faWaitDays(s)))}
      </span>
    );
  };
  const statusChip = (s: FluidSample) => (
    <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] font-extrabold ${FA_STATUS_CLS[s.status] ?? FA_STATUS_CLS.ARCHIVED}`}>
      {t(`fa.st.${s.status}` as TranslationKey)}
    </span>
  );

  const summaryCards: { key: FaCardKey; n: number; label: string; hint: string; icon: typeof FlaskConical; cls: string; num: string }[] = [
    { key: "draft", n: summary.draft, label: t("fa.sum.draft"), hint: t("fa.sum.draftHint"), icon: TestTube, cls: "border-l-amber-500", num: "text-amber-700 dark:text-amber-400" },
    { key: "sent", n: summary.sent, label: t("fa.sum.sent"), hint: t("fa.sum.sentHint"), icon: Hourglass, cls: "border-l-blue-600", num: "text-blue-700 dark:text-blue-400" },
    { key: "bad", n: summary.bad, label: t("fa.sum.bad"), hint: t("fa.sum.badHint"), icon: AlertOctagon, cls: "border-l-red-600", num: "text-red-700 dark:text-red-400" },
    { key: "caution", n: summary.caution, label: t("fa.sum.caution"), hint: t("fa.sum.cautionHint"), icon: AlertTriangle, cls: "border-l-yellow-600", num: "text-yellow-700 dark:text-yellow-400" },
  ];
  const selCls = (on: boolean) => `rounded-lg border px-2 py-1.5 text-xs focus:outline-none focus:border-accent/50 ${on ? "border-accent bg-accent/5 font-bold text-accent" : "border-fg/10 bg-fg/5 text-fg"}`;

  return (
    <div className="space-y-4">
      {deleteError && <AlertDialog message={deleteError} onClose={() => setDeleteError(null)} />}

      {creatingSample && canManage && (
        <SampleFormModal
          mode="create"
          assets={assetsData?.items ?? []}
          vessels={contextVessels}
          onClose={() => setCreatingSample(false)}
          onSaved={() => { setCreatingSample(false); reload(); }}
        />
      )}

      {scanningWizard && canManage && (
        <ScanFluidSampleWizard
          assets={assetsData?.items ?? []}
          vessels={contextVessels}
          onClose={() => setScanningWizard(false)}
          onDone={(id) => { setScanningWizard(false); reload(); setOpenDetailId(id); }}
        />
      )}

      {batchUpload && canManage && (
        <FluidBatchUploadModal
          vessels={contextVessels.map(v => ({ code: v.code, name: v.name ?? null }))}
          onClose={() => { setBatchUpload(false); reload(); }}
          onSaved={reload}
          onGoToModule={() => { setBatchUpload(false); reload(); }}
        />
      )}

      {openDetailId && (
        <SampleDetailModal
          id={openDetailId}
          assets={assetsData?.items ?? []}
          canManage={canManage}
          onClose={closeDetail}
          onChanged={reload}
        />
      )}

      <PageHeader icon={FlaskConical} title={t("page.fluidAnalyses")} total={samples.length} onReload={reload}>
        {canManage && (
          <button onClick={() => setCreatingSample(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-fg/5 border border-fg/10 text-xs font-bold text-fg hover:border-accent/30 transition-all">
            <Plus className="w-3.5 h-3.5" /> {t("fa.newSample")}
          </button>
        )}
        {canManage && (
          <button onClick={() => setBatchUpload(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-fg/5 border border-fg/10 text-xs font-bold text-fg hover:border-accent/30 transition-all">
            <Files className="w-3.5 h-3.5" /> {t("fa.list.batch")}
          </button>
        )}
        {canManage && (
          <button onClick={() => setScanningWizard(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-700 text-white font-bold text-xs hover:brightness-110 transition-all">
            <ScanLine className="w-3.5 h-3.5" /> {t("fa.list.scan")}
          </button>
        )}
        <ExportExcelButton module="fluid_samples" />
      </PageHeader>

      {/* Resumen: lo que necesita atención. Tocar una tarjeta filtra. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        {summaryCards.map(c => {
          const on = cardSel === c.key;
          return (
            <button key={c.key} type="button" onClick={() => setCardSel(on ? "" : c.key)}
              className={`flex flex-col items-start gap-0.5 rounded-2xl border-[1.5px] border-l-4 bg-surface px-3 py-2.5 text-left transition-all ${c.cls} ${on ? "border-accent ring-2 ring-accent/20" : "border-fg/10 hover:border-fg/25"}`}>
              <span className={`text-2xl font-extrabold leading-tight ${c.num}`}>{c.n}</span>
              <span className="flex items-center gap-1 text-xs font-semibold text-text-industrial/70"><c.icon className="w-3.5 h-3.5" />{c.label}</span>
              <span className="text-[10px] text-text-industrial/40">{c.hint}</span>
            </button>
          );
        })}
      </div>

      {/* Filtros */}
      <div className="rounded-2xl border border-fg/10 bg-surface p-3 space-y-2.5">
        <div className="flex flex-wrap gap-1.5">
          {(["", ...SAMPLE_STATUSES] as string[]).map(k => {
            const on = stageSel === k;
            return (
              <button key={k || "active"} type="button" onClick={() => setStageSel(k)}
                className={`inline-flex items-center gap-1.5 rounded-full border-[1.5px] px-3 py-1 text-xs font-bold transition-colors ${on ? "border-accent bg-accent text-accent-fg" : "border-fg/10 bg-surface text-text-industrial/60 hover:text-fg"}`}>
                {k ? t(`fa.st.${k}` as TranslationKey) : t("fa.list.active")}
                <span className={`rounded-full px-1.5 text-[10px] ${on ? "bg-white/25" : "bg-fg/10"}`}>{stageFilter(beforeStage, k).length}</span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={kindSel} onChange={e => setKindSel(e.target.value)} className={selCls(!!kindSel)}>
            <option value="">{t("fa.list.kindAll")}</option>
            {Object.keys(SAMPLE_KIND_LABELS).map(k => <option key={k} value={k}>{t(`mp.samp.kind.${k}` as TranslationKey)}</option>)}
          </select>
          <select value={assetSel} onChange={e => setAssetSel(e.target.value)} className={`${selCls(!!assetSel)} max-w-[14rem]`}>
            <option value="">{t("wo.fl.assetAll")}</option>
            {assetOptions.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
          <select value={verdictSel} onChange={e => setVerdictSel(e.target.value)} className={selCls(!!verdictSel)}>
            <option value="">{t("fa.list.verdictAll")}</option>
            {VERDICTS.map(v => <option key={v} value={v}>{t(`fa.vd.${v}` as TranslationKey)}</option>)}
          </select>
          <div className="flex items-center gap-1.5 rounded-lg border border-fg/10 bg-fg/5 px-2.5 py-1.5 w-full sm:w-auto sm:ml-auto">
            <Search className="w-3.5 h-3.5 text-text-industrial/40 shrink-0" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t("fa.list.search")}
              className="w-full sm:w-60 bg-transparent text-xs text-fg placeholder-text-industrial/30 focus:outline-none" />
            {search && (
              <button type="button" onClick={() => setSearch("")} className="text-text-industrial/40 hover:text-fg"><X className="w-3 h-3" /></button>
            )}
          </div>
        </div>
      </div>

      <TmsaFilterBanner filter={tmsaFilter} shown={samples.length} total={data?.items?.length ?? 0} />

      <div className="bento-card overflow-hidden p-0">
        {loading && <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-accent" /></div>}
        {!loading && error && <p className="p-6 text-xs text-red-700 dark:text-red-400">{error}</p>}
        {!loading && !error && samples.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-text-industrial/30 gap-3">
            <FlaskConical className="w-8 h-8" />
            <p className="text-sm">{t("fa.emptyState")}</p>
          </div>
        )}
        {!loading && !error && samples.length > 0 && (
          <>
            {/* Escritorio: tabla */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-fg/10 text-text-industrial/40 text-[10px] uppercase tracking-widest">
                    <SortTh label={t("fa.col.sample")} col="sampleCode" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                    <SortTh label={t("form.equipment")} col="assetId" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                    <SortTh label={t("mp.samp.what")} col="kind" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                    <SortTh label={t("fa.col.taken")} col="sampledAt" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                    <SortTh label={t("fa.col.status")} col="status" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                    <SortTh label={t("fa.col.result")} col="verdict" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                    <SortTh label={t("fa.col.sourceWo")} col="sourceWo" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                    <th className="px-4 py-3"><span className="sr-only">{t("common.actions")}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {samples.map(s => (
                    <tr key={s.id} onClick={() => setOpenDetailId(s.id)}
                      className={`border-b border-fg/5 transition-colors cursor-pointer ${faIsBad(s) ? "bg-red-500/[0.06] shadow-[inset_4px_0_0_rgb(220,38,38)] hover:bg-red-500/10" : "hover:bg-fg/3"}`}>
                      <td className="px-4 py-2.5">
                        <div className="font-mono font-bold text-accent">{s.sampleCode}</div>
                        {/* Nombre del buque, no el código. */}
                        <div className="text-[10.5px] text-text-industrial/50">{vesselName(s.vesselCode)}</div>
                      </td>
                      <td className="px-4 py-2.5 font-semibold text-fg">{assetLabel(s.assetId, assets)}</td>
                      <td className="px-4 py-2.5">{kindCell(s)}</td>
                      <td className="px-4 py-2.5 text-text-industrial/70">
                        {s.status === "DRAFT" ? <span className="text-text-industrial/40">{t("fa.list.notTaken")}</span> : (
                          <>
                            {fmtDate(s.sampledAt)}
                            {s.runningHours != null && <div className="text-[10.5px] text-text-industrial/50 font-mono">{s.runningHours.toLocaleString()} h</div>}
                          </>
                        )}
                      </td>
                      <td className="px-4 py-2.5"><div className="flex flex-col items-start gap-0.5">{statusChip(s)}{waitCell(s)}</div></td>
                      <td className="px-4 py-2.5">{s.result ? <><VerdictBadge verdict={s.result.verdict} />{repairWoLink(s)}</> : <span className="text-text-industrial/30">—</span>}</td>
                      <td className="px-4 py-2.5">
                        {s.sourceWorkOrderCode ? (
                          <button type="button"
                            onClick={e => { e.stopPropagation(); navigate(`/work-orders?autoCode=${s.sourceWorkOrderCode}`); }}
                            className="font-mono text-[11px] text-accent hover:underline">
                            {s.sourceWorkOrderCode}
                          </button>
                        ) : <span className="text-text-industrial/20">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {renderAction(s)}
                          {canManage && (
                            <button type="button" title={t("common.delete")} aria-label={t("common.delete")}
                              disabled={deletingId === s.id}
                              onClick={e => { e.stopPropagation(); void removeSample(s); }}
                              className="inline-flex items-center justify-center p-1.5 rounded-lg text-text-industrial/40 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40">
                              {deletingId === s.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Celular: tarjetas */}
            <div className="md:hidden flex flex-col gap-2 p-2">
              {samples.map(s => (
                <div key={s.id} onClick={() => setOpenDetailId(s.id)}
                  className={`rounded-xl border border-fg/10 border-l-4 px-3 py-2.5 space-y-1.5 cursor-pointer ${faIsBad(s) ? "border-l-red-600 bg-red-500/[0.06]" : "border-l-fg/10 bg-surface"}`}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-xs font-bold text-accent">{s.sampleCode}</span>
                    {statusChip(s)}
                    {s.result && <VerdictBadge verdict={s.result.verdict} />}
                  </div>
                  {repairWoLink(s)}
                  <div className="text-[13px] font-bold text-fg">{assetLabel(s.assetId, assets)}</div>
                  <div className="flex flex-wrap items-center gap-2.5 text-xs">
                    {kindCell(s)}
                    {waitCell(s)}
                    {s.sourceWorkOrderCode && <span className="ml-auto font-mono text-[11px] text-accent">{s.sourceWorkOrderCode}</span>}
                  </div>
                  {renderAction(s)}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

function SortTh({ label, col, sortKey, sortDir, onSort, align = "left" }: {
  label: string;
  col: string;
  sortKey: string;
  sortDir: "asc" | "desc";
  onSort: (col: string) => void;
  align?: "left" | "right";
}) {
  const active = sortKey === col;
  const Icon = active ? (sortDir === "asc" ? ChevronUp : ChevronDown) : ArrowUpDown;
  return (
    <th className={`px-4 py-3 font-semibold text-${align}`}>
      <button
        type="button"
        onClick={() => onSort(col)}
        className={`inline-flex items-center gap-1 hover:text-fg transition-colors ${active ? "text-accent" : ""}`}
      >
        {label}
        <Icon className="w-3 h-3 shrink-0" />
      </button>
    </th>
  );
}

// ─── Sample form (create / edit) ──────────────────────────────────────────────

function SampleFormModal({
  mode, sample, assets, vessels, onClose, onSaved,
}: {
  mode: "create" | "edit";
  sample?: FluidSample;
  assets: AssetItem[];
  vessels: Array<{ code: string; name: string | null }>;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const t = useT();
  const [vesselCode, setVesselCode]   = useState(sample?.vesselCode ?? "");
  const [assetId, setAssetId]         = useState(sample?.assetId ?? "");
  const [fluidType, setFluidType]     = useState<FluidType>(sample?.fluidType ?? "ENGINE_OIL");
  const [fluidProduct, setFluidProduct] = useState(sample?.fluidProduct ?? "");
  const [sampledAt, setSampledAt]     = useState(sample?.sampledAt ? sample.sampledAt.slice(0, 10) : new Date().toISOString().slice(0, 10));
  const [runningHours, setRunningHours] = useState(sample?.runningHours != null ? String(sample.runningHours) : "");
  const [containerCode, setContainerCode] = useState(sample?.containerCode ?? "");
  const [labName, setLabName]         = useState(sample?.labName ?? "");
  const [labReference, setLabReference] = useState(sample?.labReference ?? "");
  const [notes, setNotes]             = useState(sample?.notes ?? "");
  const [saving, setSaving]           = useState(false);
  const [err, setErr]                 = useState<string | null>(null);

  const filteredAssets = vesselCode ? assets.filter(a => a.vesselCode === vesselCode) : assets;

  const submit = async () => {
    setErr(null);
    if (!vesselCode || !assetId) { setErr("Buque y equipo son requeridos."); return; }
    setSaving(true);
    try {
      const payload = {
        vesselCode, assetId, fluidType, fluidProduct: fluidProduct || null,
        sampledAt, runningHours: runningHours ? Number(runningHours) : null,
        containerCode: containerCode || null, labName: labName || null,
        labReference: labReference || null, notes: notes || null,
      };
      const result: FluidSample = mode === "create"
        ? await api.post("/app/fluid-analyses", payload)
        : await api.patch(`/app/fluid-analyses/${sample!.id}`, payload);
      onSaved(result.id);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "No se pudo guardar.");
    } finally { setSaving(false); }
  };

  // ESC guard
  const isDirty = useDirtyTracker({
    vesselCode, assetId, fluidType, fluidProduct, sampledAt, runningHours,
    containerCode, labName, labReference, notes,
  });
  const requestClose = useEscapeGuard({ isDirty, onSave: submit, onClose });

  return (
    <ModalShell title={mode === "create" ? t("fa.newSample") : `${t("fa.editSample")} ${sample?.sampleCode}`} onClose={requestClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          {/* Obligatorios: se resaltan mientras falten (preview V24). */}
          <GuideField id="fa-f-vessel" missing={!vesselCode}>
            <label className={labelCls}>{t("form.vessel").replace(/\s*\*\s*$/, "")}<RequiredMark />{!vesselCode && <GuideNeedTag label={t("mp.guide.missing")} />}</label>
            <select value={vesselCode} onChange={e => { setVesselCode(e.target.value); setAssetId(""); }} className={inputCls}>
              <option value="">{t("fa.selectPh")}</option>
              {vessels.map(v => <option key={v.code} value={v.code}>{v.name || v.code}</option>)}
            </select>
          </GuideField>
          <GuideField id="fa-f-asset" missing={!assetId}>
            <label className={labelCls}>{t("form.equipment").replace(/\s*\*\s*$/, "")}<RequiredMark />{!assetId && <GuideNeedTag label={t("mp.guide.missing")} />}</label>
            <select value={assetId} onChange={e => setAssetId(e.target.value)} className={inputCls} disabled={!vesselCode}>
              <option value="">{t("fa.selectPh")}</option>
              {filteredAssets.map(a => <option key={a.id} value={a.id}>{a.name ?? a.assetCode}</option>)}
            </select>
          </GuideField>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>{t("fa.fluidType").replace(/\s*\*\s*$/, "")}<RequiredMark /></label>
            <select value={fluidType} onChange={e => setFluidType(e.target.value as FluidType)} className={inputCls}>
              {FLUID_TYPES.map(f => <option key={f} value={f}>{FLUID_LABELS[f]}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>{t("fa.productBrand")}</label>
            <input value={fluidProduct} onChange={e => setFluidProduct(e.target.value)} className={inputCls} placeholder="Mobilgard M312 SAE 30" />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={labelCls}>{t("fa.sampleDate").replace(/\s*\*\s*$/, "")}<RequiredMark /></label>
            <input type="date" value={sampledAt} onChange={e => setSampledAt(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>{t("fa.runHours")}</label>
            <input type="number" value={runningHours} onChange={e => setRunningHours(e.target.value)} className={inputCls} placeholder="12500" />
          </div>
          <div>
            <label className={labelCls}>{t("fa.containerId")}</label>
            <input value={containerCode} onChange={e => setContainerCode(e.target.value)} className={inputCls} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>{t("fa.lab")}</label>
            <input value={labName} onChange={e => setLabName(e.target.value)} className={inputCls} placeholder="Mobil Serv" />
          </div>
          <div>
            <label className={labelCls}>{t("fa.labRef")}</label>
            <input value={labReference} onChange={e => setLabReference(e.target.value)} className={inputCls} />
          </div>
        </div>
        <div>
          <label className={labelCls}>{t("fa.notes")}</label>
          <AutoTextArea rows={2} value={notes} onChange={e => setNotes(e.target.value)} className={inputCls + " resize-none"} />
        </div>
        {err && <p className="text-xs text-red-700 dark:text-red-400">{err}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-3 py-2 rounded-lg text-xs text-text-industrial/60 hover:text-fg">{t("common.cancel")}</button>
          <button onClick={submit} disabled={saving} className="px-4 py-2 rounded-lg bg-accent text-accent-fg font-bold text-xs hover:brightness-110 disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : t("common.save")}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

// ─── Sample detail modal ──────────────────────────────────────────────────────

function SampleDetailModal({
  id, assets, canManage, onClose, onChanged,
}: {
  id: string;
  assets: AssetItem[];
  canManage: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const t = useT();
  const navigate = useNavigate();
  const { user } = useAuth();
  // El horómetro lo corrige quien está frente al equipo, no sólo quien
  // administra el módulo: lo habilitamos a todo rol salvo el de sólo lectura.
  const canEditHours = user?.role !== "AUDITOR_READONLY";
  const [sample, setSample]       = useState<FluidSample | null>(null);
  const [loading, setLoading]     = useState(true);
  const [err, setErr]             = useState<string | null>(null);
  const [showResultForm, setShowResultForm] = useState(false);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try { setSample(await api.get<FluidSample>(`/app/fluid-analyses/${id}`)); }
    catch (e) { setErr(e instanceof ApiError ? e.message : "Error al cargar."); }
    finally  { setLoading(false); }
  };
  useEffect(() => { void load(); }, [id]);

  // ── Copiloto ──
  // Lo que ve el usuario, para que el copiloto sepa de qué muestra y de qué
  // defecto se habla sin preguntar.
  const can = useCan();
  const { pushCopilotOffer } = useCopilotScreenContext();
  const result = sample?.result ?? null;
  const defectCode = result?.defectCode ?? null;
  useCopilotEmitter(sample ? {
    module: "FLUID_ANALYSES",
    screen: "FLUID_SAMPLE_DETAIL",
    entityId: sample.id,
    entityCode: sample.sampleCode,
    vesselCode: sample.vesselCode,
    workflowStage: result?.verdict ?? sample.status,
    relatedEntities: { assetId: sample.assetId, defectCode, defectStatus: result?.defectStatus ?? null },
  } : null);

  // Resultado grave con su defecto todavía por completar: el copiloto ofrece
  // abrirlo. Si el defecto ya está cerrado o ya tiene su OT, el trabajo ya
  // siguió su curso y no hay nada que ofrecer; tampoco a quien no puede
  // editar defectos.
  const offerVerdict = result?.verdict === "CRITICAL" || result?.verdict === "ACTION_REQUIRED" ? result.verdict : null;
  const shouldOfferDefect = !!offerVerdict && !!defectCode
    && result?.defectStatus !== "RESOLVED" && result?.defectStatus !== "CLOSED"
    && !result?.defectWorkOrderId && can("defect.write");
  useEffect(() => {
    if (!shouldOfferDefect || !sample || !defectCode || !offerVerdict) return;
    const lead = t(offerVerdict === "CRITICAL" ? "fa.copilotOffer.critical" : "fa.copilotOffer.actionRequired");
    pushCopilotOffer({
      key: `fluid-defect:${sample.id}`,
      text: `${lead} **${defectCode}**. ${t("fa.copilotOffer.ask")}`,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldOfferDefect, sample?.id]);

  // Límites del fluido: marcan los valores fuera de rango en la tabla (V20).
  const { vessels: contextVessels } = useVesselContext();
  const [thresholds, setThresholds] = useState<ThresholdLite[]>([]);
  const fluidTypeForThresholds = sample?.kind === "FLUID" ? sample?.fluidType ?? null : null;
  useEffect(() => {
    if (!fluidTypeForThresholds) { setThresholds([]); return; }
    let cancelled = false;
    api.get<{ items: ThresholdLite[] }>(`/app/fluid-analyses-thresholds?fluidType=${fluidTypeForThresholds}`)
      .then(r => { if (!cancelled) setThresholds(r.items ?? []); })
      .catch(() => { if (!cancelled) setThresholds([]); });
    return () => { cancelled = true; };
  }, [fluidTypeForThresholds]);

  const remove = async () => {
    if (!confirm(t("confirm.deleteSample"))) return;
    try { await api.delete(`/app/fluid-analyses/${id}`); onChanged(); onClose(); } catch { /* noop */ }
  };

  if (loading) return <ModalShell title="Cargando…" onClose={onClose}><div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-accent" /></div></ModalShell>;
  if (err)     return <ModalShell title="Error"     onClose={onClose}><p className="text-xs text-red-700 dark:text-red-400">{err}</p></ModalShell>;
  if (!sample) return null;

  if (showResultForm) {
    return (
      <ResultFormModal
        sample={sample}
        onClose={() => setShowResultForm(false)}
        onSaved={() => { setShowResultForm(false); void load(); onChanged(); }}
      />
    );
  }

  // ── Vista del detalle (preview V20) ──
  const headerAssetName = assets.find(a => a.id === sample.assetId)?.name ?? null;
  const kindLabel = t(`mp.samp.kind.${sample.kind}` as TranslationKey);
  const KindIcon = KIND_ICON[sample.kind] ?? FlaskConical;
  const vesselLabel = contextVessels.find(v => v.code === sample.vesselCode)?.name || sample.vesselCode;
  const verdict = sample.result?.verdict ?? null;
  const VERDICT_BANNER: Record<Verdict, { box: string; icon: string; title: string; Icon: typeof FlaskConical }> = {
    NORMAL:          { box: "bg-emerald-500/10 border-emerald-500/40", icon: "bg-emerald-500", title: "text-emerald-700 dark:text-emerald-400", Icon: CheckCircle2 },
    CAUTION:         { box: "bg-amber-500/10 border-amber-500/40",     icon: "bg-amber-500",   title: "text-amber-700 dark:text-amber-400",     Icon: AlertTriangle },
    CRITICAL:        { box: "bg-red-500/10 border-red-500/40",         icon: "bg-red-600",     title: "text-red-700 dark:text-red-400",         Icon: AlertOctagon },
    ACTION_REQUIRED: { box: "bg-red-500/10 border-red-500/40",         icon: "bg-red-700",     title: "text-red-700 dark:text-red-400",         Icon: AlertOctagon },
  };
  // Recorrido: creada → tomada → en el laboratorio → informe.
  const stepIdx = sample.result ? 4 : sample.status === "SENT" ? 3 : sample.status === "DRAFT" ? 1 : 2;
  const track: { title: string; sub: string }[] = [
    { title: t("fa.track.created"), sub: `${fmtDate(sample.createdAt) ?? "—"}${sample.sourceWorkOrderId ? ` · ${t("fa.track.createdByWo")}` : ""}` },
    { title: t("fa.track.taken"), sub: sample.status === "DRAFT" ? t("fa.list.notTaken") : `${fmtDate(sample.sampledAt) ?? "—"}${sample.runningHours != null ? ` · ${sample.runningHours.toLocaleString()} h` : ""}` },
    { title: t("fa.track.atLab"), sub: sample.sentAt || sample.labName ? [sample.sentAt ? fmtDate(sample.sentAt) : null, sample.labName].filter(Boolean).join(" · ") : "—" },
    { title: t("fa.track.report"), sub: sample.result ? `${fmtDate(sample.result.receivedAt) ?? "—"}` : sample.status === "SENT" ? t("fa.list.sentAgo").replace("{n}", String(faWaitDays(sample))) : "—" },
  ];
  const facts: { label: string; value: string }[] = [
    { label: t("fa.col.taken"), value: sample.status === "DRAFT" ? "—" : (fmtDate(sample.sampledAt) ?? "—") },
    { label: t("fa.statProduct"), value: sample.fluidProduct ?? "—" },
    { label: t("fa.containerId"), value: sample.containerCode ?? "—" },
    { label: t("fa.statLab"), value: sample.labName ?? "—" },
    { label: t("fa.statLabRef"), value: sample.labReference ?? "—" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-6xl max-h-[92vh] flex flex-col bg-surface dark:bg-[#0D1526] border border-fg/10 border-t-4 border-t-violet-600 rounded-2xl shadow-2xl overflow-hidden">
        {/* Encabezado: el equipo es lo primero que se pregunta. */}
        <div className="flex items-start gap-3 px-5 py-3 border-b border-fg/10 shrink-0">
          <span className="w-10 h-10 rounded-xl bg-violet-500/15 text-violet-700 dark:text-violet-300 flex items-center justify-center shrink-0"><KindIcon className="w-5 h-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-[10.5px] font-extrabold uppercase tracking-wider text-violet-700 dark:text-violet-300">
              {[t("fa.detail.kicker"), kindLabel, sample.kind === "FLUID" && sample.fluidType ? FLUID_LABELS[sample.fluidType] : null].filter(Boolean).join(" · ")}
            </p>
            <h2 className="text-lg font-black text-fg leading-tight truncate">{headerAssetName ?? sample.sampleCode}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <span className="rounded-full border border-fg/10 bg-fg/5 px-2 py-0.5 font-mono text-[11px] font-bold text-fg">{sample.sampleCode}</span>
              {/* Nombre del buque, no el código. */}
              <span className="inline-flex items-center gap-1 rounded-full border border-fg/10 bg-fg/5 px-2 py-0.5 text-[11px] font-bold text-text-industrial/70"><Ship className="w-3 h-3" />{vesselLabel}</span>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-extrabold ${FA_STATUS_CLS[sample.status] ?? FA_STATUS_CLS.ARCHIVED}`}>{t(`fa.st.${sample.status}` as TranslationKey)}</span>
              {sample.sourceWorkOrderId && (
                <button type="button" onClick={() => navigate(`/work-orders?openId=${encodeURIComponent(sample.sourceWorkOrderId!)}`)}
                  className="inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent/5 px-2 py-0.5 text-[11px] font-bold text-accent hover:bg-accent/15">
                  <Wrench className="w-3 h-3" /> {sample.sourceWorkOrderCode ? `${sample.sourceWorkOrderCode} · ` : ""}{t("fa.detail.fromWo")}
                </button>
              )}
            </div>
          </div>
          <ModalCloseButton onClose={onClose} />
        </div>

        {/* Recorrido de la muestra */}
        <div className="grid grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto] items-center gap-2.5 px-5 py-2.5 border-b border-fg/10 bg-fg/[0.02] shrink-0">
          {track.map((s, i) => {
            const done = i < stepIdx;
            const cur = i === stepIdx;
            return (
              <div key={i} className="flex items-center gap-2 min-w-0">
                <span className={`w-6 h-6 rounded-full border-2 flex items-center justify-center text-[11px] font-extrabold shrink-0 ${
                  done ? "bg-emerald-500 border-emerald-500 text-white" : cur ? "bg-violet-600 border-violet-600 text-white" : "border-fg/25 text-text-industrial/40"
                }`}>{done ? <Check className="w-3.5 h-3.5" /> : i + 1}</span>
                <span className="min-w-0">
                  <span className={`block text-xs font-extrabold ${done || cur ? "text-fg" : "text-text-industrial/40"}`}>{s.title}</span>
                  <span className="block text-[10.5px] text-text-industrial/60 truncate">{s.sub}</span>
                </span>
              </div>
            );
          })}
          {!sample.result && canManage && sample.status !== "ARCHIVED" && (
            <button type="button" onClick={() => setShowResultForm(true)}
              className="col-span-2 lg:col-span-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-violet-700 px-3.5 py-2 text-xs font-extrabold text-white hover:brightness-110 whitespace-nowrap">
              <ScanLine className="w-4 h-4" /> {t("fa.list.actReport")}
            </button>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="grid grid-cols-1 lg:grid-cols-[1.35fr_1fr] gap-4 p-5">
            {/* Izquierda: resultado y valores */}
            <div className="space-y-4 min-w-0">
              {sample.result && verdict ? (() => {
                const b = VERDICT_BANNER[verdict];
                return (
                  <div className={`flex items-start gap-3 rounded-2xl border-[1.5px] p-3.5 ${b.box}`}>
                    <span className={`w-10 h-10 rounded-xl flex items-center justify-center text-white shrink-0 ${b.icon}`}><b.Icon className="w-5 h-5" /></span>
                    <div className="min-w-0">
                      <p className={`text-lg font-black ${b.title}`}>{t(`fa.vd.${verdict}` as TranslationKey)}</p>
                      {sample.result.summary && <p className="mt-0.5 text-[13px] leading-snug text-fg/85">{sample.result.summary}</p>}
                      <div className="mt-2 flex flex-wrap gap-2">
                        {defectCode && (
                          <button type="button" onClick={() => navigate(`/defects/${encodeURIComponent(defectCode)}`)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/35 bg-surface px-2.5 py-1 text-xs font-bold text-red-700 dark:text-red-400 hover:bg-red-500/10">
                            <AlertOctagon className="w-3.5 h-3.5" /> {t("fa.linkedDefect")} {defectCode}
                          </button>
                        )}
                        {/* El archivo va por /app/files/* con Bearer token; AuthedDocLink lo baja autenticado. */}
                        {sample.result.reportUrl && (
                          <AuthedDocLink src={sample.result.reportUrl} label={t("fa.viewOrigReport")}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-fg/10 bg-surface px-2.5 py-1 text-xs font-bold text-fg hover:border-fg/25" />
                        )}
                        {canManage && (
                          <button type="button" onClick={() => setShowResultForm(true)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-fg/10 bg-surface px-2.5 py-1 text-xs font-bold text-fg hover:border-fg/25">
                            <Edit3 className="w-3.5 h-3.5" /> {t("fa.modifyResult")}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })() : (
                <div className="flex items-start gap-3 rounded-2xl border-[1.5px] border-dashed border-blue-400/60 bg-blue-500/[0.06] p-3.5">
                  <span className="w-10 h-10 rounded-xl bg-blue-500 text-white flex items-center justify-center shrink-0"><Hourglass className="w-5 h-5" /></span>
                  <div>
                    <p className="text-base font-black text-blue-700 dark:text-blue-300">{sample.status === "DRAFT" ? t("fa.detail.waitTake") : t("fa.detail.waitReport")}</p>
                    <p className="mt-0.5 text-[13px] text-fg/75">{t("fa.detail.waitReportHint")}</p>
                  </div>
                </div>
              )}
              {sample.result && (verdict === "CRITICAL" || verdict === "ACTION_REQUIRED") && (
                <CriticalResultFlow result={sample.result} canCreateWo={user?.role !== "AUDITOR_READONLY"} />
              )}
              {sample.result && <ParametersTable parameters={sample.result.parameters} thresholds={thresholds} />}
            </div>

            {/* Derecha: datos de la toma, tendencia y lo que dice la IA */}
            <div className="space-y-4 min-w-0">
              <div className="rounded-2xl border border-fg/10 overflow-hidden">
                <h3 className="flex items-center gap-1.5 px-3 py-2.5 border-b border-fg/10 text-[13.5px] font-extrabold text-fg"><ClipboardList className="w-4 h-4" /> {t("fa.detail.takeData")}</h3>
                <div className="grid grid-cols-2 gap-2 p-2.5">
                  {facts.slice(0, 1).map(f => <Stat key={f.label} label={f.label} value={f.value} />)}
                  <StatHours
                    label={t("fa.statHours")}
                    sampleId={sample.id}
                    value={sample.runningHours}
                    canEdit={canEditHours}
                    onSaved={updated => { setSample(updated); onChanged(); }}
                  />
                  {facts.slice(1).map(f => <Stat key={f.label} label={f.label} value={f.value} />)}
                </div>
              </div>

              {sample.kind === "FLUID" && sample.fluidType && (
                <div className="rounded-2xl border border-fg/10 overflow-hidden">
                  <h3 className="flex items-center gap-1.5 px-3 py-2.5 border-b border-fg/10 text-[13.5px] font-extrabold text-fg"><TrendingUp className="w-4 h-4" /> {t("fa.assetTrend")}</h3>
                  <div className="p-2.5"><TrendChart assetId={sample.assetId} fluidType={sample.fluidType} /></div>
                </div>
              )}

              {sample.result && <AiInsightCard result={sample.result} sampleId={sample.id} onRefresh={load} />}

              {sample.notes && (
                <div className="p-3 rounded-xl bg-fg/5 border border-fg/10">
                  <p className="text-[10px] uppercase tracking-wider text-text-industrial/40 mb-1">{t("fa.notes")}</p>
                  <p className="text-xs text-text-industrial/70 whitespace-pre-wrap">{sample.notes}</p>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 px-5 py-3 border-t border-fg/10 shrink-0">
          <button onClick={() => downloadFluidPdf(sample.id, sample.sampleCode)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-fg/5 border border-fg/10 text-xs font-bold text-fg hover:border-accent/30">
            <FileText className="w-3.5 h-3.5 text-accent" /> {t("common.savePdf")}
          </button>
          {canManage && (
            <button onClick={remove} title={t("common.delete")}
              className="flex items-center justify-center p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-700 dark:text-red-400 hover:bg-red-500/20">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
          <span className="flex-1" />
          <button onClick={onClose} className="px-4 py-1.5 rounded-lg bg-violet-700 text-white text-xs font-bold hover:brightness-110">
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── AI insight card ──────────────────────────────────────────────────────────

function AiInsightCard({ result, sampleId, onRefresh }: {
  result: FluidResult;
  sampleId: string;
  onRefresh: () => Promise<void>;
}) {
  const t = useT();
  const [regenerating, setRegenerating] = useState(false);

  const regenerate = async () => {
    // Marca de tiempo del análisis actual (null si aún no hay). Sirve para
    // detectar cuándo llegó uno NUEVO al regenerar uno existente.
    const prevGen = result.aiAnalysisGeneratedAt ?? null;
    setRegenerating(true);
    try {
      // Lanza la generación en segundo plano (responde al instante).
      await api.post(`/app/fluid-analyses/${sampleId}/generate-ai-analysis`, {});
      // Sondea la muestra hasta que aparezca un análisis nuevo (o se agote el tiempo).
      const started = Date.now();
      while (Date.now() - started < 180_000) {
        await new Promise(r => setTimeout(r, 4000));
        let fresh: { result?: FluidResult | null } | null = null;
        try { fresh = await api.get<{ result?: FluidResult | null }>(`/app/fluid-analyses/${sampleId}`); }
        catch { /* transitorio: reintentar en la próxima vuelta */ }
        const gen = fresh?.result?.aiAnalysisGeneratedAt ?? null;
        if (fresh?.result?.aiAnalysis && gen !== prevGen) break;
      }
      await onRefresh();
    } catch { /* ignore */ }
    finally {
      setRegenerating(false);
    }
  };

  if (!result.aiAnalysis) {
    return (
      <div className="rounded-2xl border border-fg/10 overflow-hidden">
        <h3 className="flex items-center gap-1.5 px-3 py-2.5 border-b border-fg/10 text-[13.5px] font-extrabold text-fg">
          <Sparkles className="w-4 h-4 text-violet-600" /> {t("fa.detail.aiTitle")}
        </h3>
        <div className="p-3 text-center">
          <p className="text-xs text-text-industrial/50">
            {regenerating
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin inline-block mr-1" /> {t("fa.detail.aiGenerating")}</>
              : t("fa.detail.aiNone")}
          </p>
          {!regenerating && (
            <button onClick={() => { void regenerate(); }}
              className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-500/10 border border-violet-500/25 text-xs font-bold text-violet-700 dark:text-violet-300 hover:bg-violet-500/20">
              <Sparkles className="w-3.5 h-3.5" /> {t("fa.detail.aiGenerate")}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-fg/10 overflow-hidden">
      <h3 className="flex items-center gap-1.5 px-3 py-2.5 border-b border-fg/10 text-[13.5px] font-extrabold text-fg">
        <Sparkles className="w-4 h-4 text-violet-600" /> {t("fa.detail.aiTitle")}
        <span className="ml-auto flex items-center gap-1.5 text-[11px] font-semibold text-text-industrial/50">
          {result.aiAnalysisGeneratedAt && t("fa.detail.aiGenerated").replace("{date}", fmtDate(result.aiAnalysisGeneratedAt) ?? "")}
          <button
            onClick={() => { void regenerate(); }}
            disabled={regenerating}
            className="text-accent hover:underline disabled:opacity-50"
          >
            {regenerating ? <Loader2 className="w-3 h-3 animate-spin" /> : t("fa.detail.aiRegenerate")}
          </button>
        </span>
      </h3>
      <div className="p-3 bg-violet-500/[0.04]">
        <MarkdownText
          text={result.aiAnalysis}
          className="text-[12.5px] text-text-industrial/85 font-sans"
        />
      </div>
    </div>
  );
}

async function downloadFluidPdf(sampleId: string, sampleCode: string) {
  const token = localStorage.getItem("gpms_token") ?? "";
  const slug  = localStorage.getItem("gpms_tenant_slug") ?? "";
  try {
    const r = await fetch(`/app/fluid-analyses/${sampleId}/pdf`, {
      headers: { Authorization: `Bearer ${token}`, "X-Tenant-Slug": slug },
    });
    if (!r.ok) return;
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${sampleCode}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  } catch { /* ignore */ }
}

/**
 * Igual que <Stat> pero editable in situ. Se usa sólo para el horómetro, que es
 * el dato que la tripulación corrige más seguido (se carga desde el reporte del
 * lab y a veces viene mal o vacío). Guarda contra una ruta propia y acotada a
 * ese campo — ver updateFluidSampleRunningHours en el backend.
 */
function StatHours({
  label, sampleId, value, canEdit, onSaved,
}: {
  label: string;
  sampleId: string;
  value: number | null;
  canEdit: boolean;
  onSaved: (s: FluidSample) => void;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState("");
  const [saving, setSaving]   = useState(false);
  const [err, setErr]         = useState<string | null>(null);

  const open = () => {
    if (!canEdit) return;
    setDraft(value != null ? String(value) : "");
    setErr(null);
    setEditing(true);
  };

  const save = async () => {
    const raw = draft.trim();
    const next = raw === "" ? null : Number(raw);
    if (next !== null && (!Number.isFinite(next) || next < 0)) { setErr(t("fa.hoursInvalid")); return; }
    if (next === value) { setEditing(false); return; }
    setSaving(true);
    setErr(null);
    try {
      const updated = await api.patch<FluidSample>(`/app/fluid-analyses/${sampleId}/running-hours`, { runningHours: next });
      onSaved(updated);
      setEditing(false);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t("fa.hoursInvalid"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-fg/10 bg-fg/5 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-text-industrial/40 font-semibold">{label}</p>
      {editing ? (
        <div className="flex items-center gap-1 mt-0.5">
          <input
            type="number"
            min={0}
            autoFocus
            value={draft}
            disabled={saving}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter") { e.preventDefault(); void save(); }
              if (e.key === "Escape") { e.preventDefault(); setEditing(false); }
            }}
            className="w-full bg-transparent border-b border-accent text-xs font-bold text-fg outline-none"
          />
          <button onClick={() => void save()} disabled={saving} title={t("common.save")} className="text-accent hover:text-fg shrink-0">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={open}
          disabled={!canEdit}
          title={canEdit ? t("fa.hoursEdit") : undefined}
          className={`group flex items-center gap-1 w-full text-left mt-0.5 ${canEdit ? "cursor-pointer" : "cursor-default"}`}
        >
          <span className="text-xs font-bold text-fg truncate">{value != null ? String(value) : "—"}</span>
          {canEdit && <Edit3 className="w-3 h-3 text-text-industrial/30 opacity-0 group-hover:opacity-100 shrink-0" />}
        </button>
      )}
      {err && <p className="text-[10px] text-red-700 dark:text-red-400 mt-0.5">{err}</p>}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-fg/10 bg-fg/5 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-text-industrial/40 font-semibold">{label}</p>
      <p className="text-xs font-bold text-fg truncate mt-0.5">{value}</p>
    </div>
  );
}

// ─── Valores del laboratorio agrupados (preview V20) ─────────────────────────

/** Grupo de cada parámetro (clave en minúscula tal como la guarda el informe). */
const PARAM_GROUP: Record<string, "wear" | "contam" | "additive" | "props"> = {
  fe: "wear", cu: "wear", al: "wear", cr: "wear", pb: "wear", sn: "wear", ni: "wear", mn: "wear", ag: "wear", v: "wear", cd: "wear", ti: "wear",
  si: "contam", na: "contam", k: "contam", h2o: "contam", water: "contam", agua: "contam", soot: "contam", fuel: "contam",
  ca: "additive", p: "additive", zn: "additive", mg: "additive", b: "additive", ba: "additive", mo: "additive",
  visc40: "props", visc100: "props", v40: "props", v100: "props", viscosity: "props", tbn: "props", tan: "props", oxidation: "props", nitration: "props",
};
const PARAM_GROUP_ORDER = ["wear", "contam", "additive", "props", "other"] as const;

/**
 * "¿Qué hacer con este resultado?" (preview V46). Resultado crítico → defecto →
 * OT correctiva (se crea DESDE el defecto) → ejecutar y cerrar → nueva medición.
 * Marca el paso actual y ofrece una sola acción.
 */
function CriticalResultFlow({ result, canCreateWo }: { result: FluidResult; canCreateWo: boolean }) {
  const t = useT();
  const navigate = useNavigate();
  const woTerms = useWoTerms();
  const defectCode = result.defectCode ?? null;
  const defectClosed = result.defectStatus === "CLOSED" || result.defectStatus === "RESOLVED";
  const woId = result.defectWorkOrderId ?? null;
  const woCode = result.defectWorkOrderCode ?? woTerms.abbr;
  // Al crear la OT desde Defectos, el defecto se cierra en el acto: el trabajo
  // sigue en la OT. Por eso el avance lo marca el estado de la OT, no el del defecto.
  const woStatus = result.defectWorkOrderStatus ?? null;
  const woClosed = woStatus === "CLOSED";
  const current = !defectCode ? 1
    : woId ? (woClosed ? 4 : 3)
    : defectClosed ? 4 // reparado a bordo sin OT
    : 2;
  // Los pasos con registro propio llevan a él: el defecto y la OT correctiva.
  const steps: Array<{ title: string; sub: string; onClick?: () => void }> = [
    { title: t("fa.flow.s1"), sub: t("fa.flow.s1Sub") },
    { title: t("fa.flow.s2"), sub: defectCode ?? t("fa.flow.noDefect"),
      onClick: defectCode ? () => navigate(`/defects/${encodeURIComponent(defectCode)}`) : undefined },
    { title: t("fa.flow.s3").replace("{wo}", woTerms.abbr), sub: woId ? woCode : t("fa.flow.s3Sub"),
      onClick: woId ? () => navigate(`/work-orders?openId=${encodeURIComponent(woId)}`)
        : defectCode && canCreateWo ? () => navigate(`/defects/${encodeURIComponent(defectCode)}?action=createWo`) : undefined },
    { title: t("fa.flow.s4"), sub: t("fa.flow.s4Sub").replace("{wo}", woTerms.abbr) },
    { title: t("fa.flow.s5"), sub: t("fa.flow.s5Sub") },
  ];
  const goDefect = (action?: string) => defectCode
    ? navigate(`/defects/${encodeURIComponent(defectCode)}${action ? `?action=${action}` : ""}`)
    : navigate("/defects");
  const now: { tone: string; text: string; button?: { label: string; onClick: () => void } } =
    current === 1 ? { tone: "orange", text: t("fa.flow.nowNoDefect"), button: { label: t("fa.flow.goDefects"), onClick: () => goDefect() } }
    : current === 2 ? { tone: "orange", text: t("fa.flow.nowCreateWo").replace(/\{wo\}/g, woTerms.abbr),
        button: canCreateWo ? { label: t("fa.flow.goCreateWo").replace("{wo}", woTerms.abbr), onClick: () => goDefect("createWo") } : undefined }
    : current === 3 ? { tone: "blue",
        text: t(woStatus === "PLANNED" ? "fa.flow.nowWoPlanned" : woStatus === "CANCELLED" ? "fa.flow.nowWoCancelled" : "fa.flow.nowWoRunning")
          .replace("{code}", woCode),
        button: { label: t("fa.flow.viewWo").replace("{wo}", woTerms.abbr), onClick: () => navigate(`/work-orders?openId=${encodeURIComponent(woId!)}`) } }
    : { tone: "green", text: t("fa.flow.nowRemeasure") };
  const toneCls: Record<string, string> = {
    orange: "border-orange-400/60 bg-orange-500/[0.08] [&_b]:text-orange-800 dark:[&_b]:text-orange-300",
    blue: "border-blue-400/50 bg-blue-500/[0.07] [&_b]:text-blue-800 dark:[&_b]:text-blue-300",
    green: "border-emerald-400/50 bg-emerald-500/[0.07] [&_b]:text-emerald-800 dark:[&_b]:text-emerald-300",
  };
  const btnCls: Record<string, string> = { orange: "bg-orange-600", blue: "bg-blue-600", green: "bg-emerald-600" };
  return (
    <div className="rounded-2xl border border-red-500/25 bg-surface p-3.5">
      <p className="flex items-center gap-1.5 text-[13.5px] font-extrabold text-fg mb-3"><ListChecks className="w-4 h-4 text-red-600" /> {t("fa.flow.title")}</p>
      <ol className="grid grid-cols-5 gap-1">
        {steps.map((s, i) => {
          const done = i < current;
          const cur = i === current;
          return (
            <li key={i} className="relative min-w-0">
              <button type="button" onClick={s.onClick} disabled={!s.onClick}
                className={`w-full flex flex-col items-center text-center rounded-lg pb-1 ${s.onClick ? "cursor-pointer hover:bg-fg/5 [&_.step-title]:hover:underline" : "cursor-default"}`}>
              {i < steps.length - 1 && (
                <span className={`absolute top-[13px] left-1/2 w-full h-0.5 ${done ? "bg-emerald-500" : "bg-fg/15"}`} />
              )}
              <span className={`relative z-[1] w-7 h-7 rounded-full border-2 flex items-center justify-center text-[11px] font-extrabold ${
                done ? "bg-emerald-500 border-emerald-500 text-white"
                  : cur ? "bg-orange-600 border-orange-600 text-white ring-4 ring-orange-500/20"
                  : "bg-surface border-fg/20 text-text-industrial/40"
              }`}>{done ? <Check className="w-3.5 h-3.5" /> : i + 1}</span>
              <span className={`step-title mt-1.5 text-[11px] font-extrabold leading-tight ${cur ? "text-orange-700 dark:text-orange-300" : done ? "text-fg" : "text-text-industrial/50"}`}>{s.title}</span>
              <span className="mt-0.5 text-[10px] leading-tight text-text-industrial/55 break-words">{s.sub}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <div className={`mt-3 flex flex-wrap items-center gap-2.5 rounded-xl border px-3 py-2 text-[12.5px] text-fg/85 ${toneCls[now.tone]}`}>
        <span className="min-w-0 flex-1"><b>{t("fa.flow.now")}</b> {now.text}</span>
        {now.button && (
          <button type="button" onClick={now.button.onClick}
            className={`ml-auto inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-extrabold text-white hover:brightness-110 ${btnCls[now.tone]}`}>
            {now.button.label} <ArrowRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

/** Nombre legible del parámetro; si no está en la lista, la clave tal cual. */
function useParamLabel() {
  const t = useT();
  return (key: string) => {
    const k = key.toLowerCase();
    const tk = `fa.param.${k}` as TranslationKey;
    const label = t(tk);
    // useT devuelve "[clave]" cuando no hay traducción: ahí se muestra la clave cruda.
    return label === `[${tk}]` ? key : label;
  };
}

interface ThresholdLite { parameter: string; cautionMin: number | null; cautionMax: number | null; criticalMin: number | null; criticalMax: number | null }
/** "crit" / "caution" / null según los límites cargados del parámetro. */
function paramLevel(key: string, value: unknown, thresholds: ThresholdLite[]): "crit" | "caution" | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  const th = thresholds.find(x => x.parameter.toLowerCase() === key.toLowerCase());
  if (!th) return null;
  if ((th.criticalMax != null && n > th.criticalMax) || (th.criticalMin != null && n < th.criticalMin)) return "crit";
  if ((th.cautionMax != null && n > th.cautionMax) || (th.cautionMin != null && n < th.cautionMin)) return "caution";
  return null;
}

function ParametersTable({ parameters, thresholds = [] }: { parameters: Record<string, FluidParameter | number | string>; thresholds?: ThresholdLite[] }) {
  const t = useT();
  const paramLabel = useParamLabel();
  const [showAll, setShowAll] = useState(false);
  const entries = Object.entries(parameters).map(([key, raw]) => {
    const val = (typeof raw === "object" && raw !== null) ? (raw as FluidParameter).value : raw;
    const unit = (typeof raw === "object" && raw !== null) ? (raw as FluidParameter).unit ?? "" : "";
    return { key, val, unit, level: paramLevel(key, val, thresholds), group: PARAM_GROUP[key.toLowerCase()] ?? "other" };
  });
  if (entries.length === 0) return <p className="text-xs text-text-industrial/40">{t("fa.noParams")}</p>;
  const flagged = entries.filter(e => e.level);
  const listAll = showAll || flagged.length === 0;

  const row = (e: typeof entries[number]) => (
    <tr key={e.key} className={`border-t border-fg/5 ${e.level === "crit" ? "bg-red-500/[0.08]" : e.level === "caution" ? "bg-amber-500/[0.08]" : ""}`}>
      <td className="px-3 py-1.5 w-12 font-mono text-[10.5px] uppercase text-text-industrial/40">{e.key}</td>
      <td className="px-3 py-1.5 text-fg">
        {paramLabel(e.key)}
        {e.level && (
          <span className={`ml-1.5 rounded-full px-1.5 py-px text-[10px] font-extrabold ${e.level === "crit" ? "bg-red-500/15 text-red-700 dark:text-red-400" : "bg-amber-500/20 text-amber-800 dark:text-amber-300"}`}>
            {e.level === "crit" ? t("fa.vd.CRITICAL") : t("fa.vd.CAUTION")}
          </span>
        )}
      </td>
      <td className="px-3 py-1.5 text-right font-mono font-bold text-fg">{String(e.val)}</td>
      <td className="px-3 py-1.5 w-20 text-text-industrial/50">{e.unit}</td>
    </tr>
  );

  return (
    <div className="rounded-2xl border border-fg/10 overflow-hidden">
      <h3 className="flex items-center gap-1.5 px-3 py-2.5 border-b border-fg/10 text-[13.5px] font-extrabold text-fg">
        <List className="w-4 h-4" /> {t("fa.detail.values")}
        <span className="ml-auto text-[11px] font-semibold text-text-industrial/60">
          {flagged.length ? t("fa.detail.outOfRange").replace("{n}", String(flagged.length)) : t("fa.detail.allInRange")}
        </span>
      </h3>
      {listAll ? PARAM_GROUP_ORDER.map(g => {
        const rows = entries.filter(e => e.group === g);
        if (!rows.length) return null;
        return (
          <div key={g}>
            <p className="px-3 pt-2 pb-1 text-[10px] font-extrabold uppercase tracking-wider text-text-industrial/45">{t(`fa.detail.group.${g}` as TranslationKey)}</p>
            <table className="w-full text-xs"><tbody>{rows.map(row)}</tbody></table>
          </div>
        );
      }) : (
        <div>
          <p className="px-3 pt-2 pb-1 text-[10px] font-extrabold uppercase tracking-wider text-text-industrial/45">{t("fa.detail.flaggedGroup")}</p>
          <table className="w-full text-xs"><tbody>{flagged.map(row)}</tbody></table>
        </div>
      )}
      {flagged.length > 0 && (
        <button type="button" onClick={() => setShowAll(v => !v)}
          className="w-full border-t border-fg/10 bg-fg/5 py-2 text-xs font-bold text-text-industrial/70 hover:text-fg">
          {showAll ? t("fa.detail.showFlagged") : t("fa.detail.showAll").replace("{n}", String(entries.length))}
        </button>
      )}
    </div>
  );
}

// ─── Trend chart for asset + fluid type ──────────────────────────────────────

interface TrendPoint {
  sampleId: string;
  sampleCode: string;
  sampledAt: string;
  runningHours: number | null;
  verdict: Verdict | null;
  values: Record<string, number>;
}
interface ThresholdRow {
  parameter: string;
  cautionMin: number | null; cautionMax: number | null;
  criticalMin: number | null; criticalMax: number | null;
  direction: "HIGH_BAD" | "LOW_BAD" | "RANGE";
}

function TrendChart({ assetId, fluidType }: { assetId: string; fluidType: FluidType }) {
  const t = useT();
  const [points, setPoints] = useState<TrendPoint[]>([]);
  const [thresholds, setThresholds] = useState<ThresholdRow[]>([]);
  const [selectedParam, setSelectedParam] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [trend, thr] = await Promise.all([
          api.get<{ items: TrendPoint[] }>(`/app/fluid-analyses-trend?assetId=${assetId}&fluidType=${fluidType}&limit=12`),
          api.get<{ items: ThresholdRow[] }>(`/app/fluid-analyses-thresholds?fluidType=${fluidType}`),
        ]);
        if (cancelled) return;
        setPoints(trend.items);
        setThresholds(thr.items);
        // Default selected parameter: first param that appears in any sample
        const allKeys = new Set<string>();
        trend.items.forEach(p => Object.keys(p.values).forEach(k => allKeys.add(k)));
        const first = Array.from(allKeys)[0] ?? "";
        setSelectedParam(first);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [assetId, fluidType]);

  if (loading) return <div className="flex justify-center py-6"><Loader2 className="w-4 h-4 animate-spin text-accent" /></div>;
  if (points.length < 2) {
    return (
      <div className="rounded-xl border border-dashed border-fg/10 p-4 text-center">
        <p className="text-xs text-text-industrial/40">{t("fa.needTwoSamples")}</p>
      </div>
    );
  }

  const availableParams = Array.from(new Set(points.flatMap(p => Object.keys(p.values)))).sort();
  const param = selectedParam || availableParams[0];
  const threshold = thresholds.find(t => t.parameter === param);

  const data = points.map(p => ({
    label: new Date(p.sampledAt).toLocaleDateString("es-AR", { day: "2-digit", month: "short" }),
    sampleCode: p.sampleCode,
    value: p.values[param] ?? null,
    verdict: p.verdict,
  })).filter(d => d.value !== null);

  if (data.length < 2) {
    return (
      <div className="space-y-2">
        <ParamSelector value={param} options={availableParams} onChange={setSelectedParam} />
        <div className="rounded-xl border border-dashed border-fg/10 p-4 text-center">
          <p className="text-xs text-text-industrial/40">{t("fa.notEnoughForParam").replace("{param}", param)}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <ParamSelector value={param} options={availableParams} onChange={setSelectedParam} />
        <span className="text-[10px] text-text-industrial/40">{t("fa.lastNSamples").replace("{n}", String(data.length))}</span>
      </div>
      <div className="rounded-xl border border-fg/10 bg-fg/5 p-3">
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={data} margin={{ top: 5, right: 12, left: 0, bottom: 5 }}>
            <XAxis dataKey="label" stroke="#64748b" fontSize={10} />
            <YAxis stroke="#64748b" fontSize={10} />
            <Tooltip
              contentStyle={{ background: "#0D1526", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }}
              labelStyle={{ color: "#fbbf24" }}
              formatter={(value: any, _name: any, props: any) => [`${value}${threshold?.direction ? "" : ""}`, props.payload.sampleCode]}
            />
            {threshold?.cautionMax != null && <ReferenceLine y={threshold.cautionMax} stroke="#facc15" strokeDasharray="3 3" label={{ value: t("fa.refCaution"), fill: "#facc15", fontSize: 9, position: "right" }} />}
            {threshold?.criticalMax != null && <ReferenceLine y={threshold.criticalMax} stroke="#ef4444" strokeDasharray="3 3" label={{ value: t("fa.refCritical"), fill: "#ef4444", fontSize: 9, position: "right" }} />}
            {threshold?.cautionMin != null && <ReferenceLine y={threshold.cautionMin} stroke="#facc15" strokeDasharray="3 3" label={{ value: t("fa.refCaution"), fill: "#facc15", fontSize: 9, position: "right" }} />}
            {threshold?.criticalMin != null && <ReferenceLine y={threshold.criticalMin} stroke="#ef4444" strokeDasharray="3 3" label={{ value: t("fa.refCritical"), fill: "#ef4444", fontSize: 9, position: "right" }} />}
            <Line type="monotone" dataKey="value" stroke="#fb923c" strokeWidth={2} dot={{ r: 4, strokeWidth: 0, fill: "#fb923c" }} activeDot={{ r: 6 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function ParamSelector({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) {
  const t = useT();
  const paramLabel = useParamLabel();
  return (
    <div className="flex items-center gap-2">
      <TrendingUp className="w-3.5 h-3.5 text-accent" />
      <span className="text-[10px] uppercase tracking-wider text-text-industrial/40 font-semibold">{t("fa.paramLabel")}</span>
      <select value={value} onChange={e => onChange(e.target.value)} className="bg-fg/5 border border-fg/10 rounded px-2 py-1 text-xs text-fg font-mono">
        {options.map(o => <option key={o} value={o}>{paramLabel(o)}</option>)}
      </select>
    </div>
  );
}

// ─── Result form (with AI extraction) ─────────────────────────────────────────

function ResultFormModal({
  sample, onClose, onSaved,
}: {
  sample: FluidSample;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const [file, setFile]             = useState<File | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [reportUrl, setReportUrl]   = useState<string | null>(sample.result?.reportUrl ?? null);
  const [reportMime, setReportMime] = useState<string | null>(sample.result?.reportMime ?? null);

  // Form fields
  const [verdict, setVerdict]       = useState<Verdict | "">(sample.result?.verdict ?? "");
  const [summary, setSummary]       = useState(sample.result?.summary ?? "");
  const [receivedAt, setReceivedAt] = useState(sample.result?.receivedAt ? sample.result.receivedAt.slice(0, 10) : new Date().toISOString().slice(0, 10));
  // Horómetro al momento del muestreo. La IA lo lee del reporte; se guarda en la
  // muestra y se asienta en la OT de origen ("horas al momento de ejecución").
  const [runningHours, setRunningHours] = useState(sample.runningHours != null ? String(sample.runningHours) : "");
  const [runningHoursConf, setRunningHoursConf] = useState<"high" | "medium" | "low" | null>(null);
  const [params, setParams]         = useState<Array<{ key: string; value: string; unit: string; conf: "high" | "medium" | "low" | null }>>(() => {
    const existing = sample.result?.parameters;
    if (!existing) return [{ key: "", value: "", unit: "", conf: null }];
    return Object.entries(existing).map(([k, raw]) => {
      const v = (typeof raw === "object" && raw !== null) ? String((raw as FluidParameter).value) : String(raw);
      const u = (typeof raw === "object" && raw !== null) ? ((raw as FluidParameter).unit ?? "") : "";
      return { key: k, value: v, unit: u, conf: null };
    });
  });

  const [saving, setSaving]         = useState(false);
  const [err, setErr]               = useState<string | null>(null);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [extractNote, setExtractNote]   = useState<string | null>(null);
  // Cuando el reporte del lab trae el historial de varias muestras del mismo
  // equipo, este número le dice a la IA cuál analizar — nunca "la más reciente"
  // por default si el usuario ya sabe cuál es.
  const [sampleNumber, setSampleNumber] = useState("");

  const processFile = useCallback(async (f: File) => {
    setFile(f);
    setExtractError(null);
    setExtractNote(null);
    setExtracting(true);
    try {
      const referenceDate = sample.sampledAt ? sample.sampledAt.slice(0, 10) : null;
      const { extracted, file: saved } = await uploadAndExtract(f, sample.vesselCode, referenceDate, sampleNumber);
      setReportUrl(saved.url);
      setReportMime(saved.mime);

      // Pre-fill form from extraction
      if (extracted.verdict?.value)    setVerdict(extracted.verdict.value);
      if (extracted.summary?.value)    setSummary(extracted.summary.value);
      if (extracted.receivedAt?.value) setReceivedAt(extracted.receivedAt.value);
      // Horómetro: `!= null` y no truthy — 0 es una lectura válida (equipo nuevo
      // o recién reacondicionado).
      if (extracted.runningHours?.value != null) {
        setRunningHours(String(extracted.runningHours.value));
        setRunningHoursConf(extracted.runningHours.confidence ?? null);
      }

      const newParams: typeof params = [];
      const extractedParams: Record<string, { value: number | string; unit?: string; confidence: "high" | "medium" | "low" }> = extracted.parameters ?? {};
      for (const [k, p] of Object.entries(extractedParams)) {
        newParams.push({ key: k, value: String(p.value), unit: p.unit ?? "", conf: p.confidence });
      }
      if (newParams.length > 0) setParams(newParams);
      if (typeof extracted.notes === "string" && extracted.notes.trim()) setExtractNote(extracted.notes.trim());
    } catch (e: any) {
      setExtractError(e.message ?? "No se pudo extraer el reporte. Cargá los datos manualmente.");
    } finally {
      setExtracting(false);
    }
  }, [sample.vesselCode, sample.sampledAt, sampleNumber]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    void processFile(f);
  };

  // Paste image desde portapapeles (Ctrl+V dentro del bloque de upload).
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    if (extracting || saving) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const blob = item.getAsFile();
        if (!blob) continue;
        e.preventDefault();
        const ext = item.type.split("/")[1] ?? "png";
        const f = new File([blob], `clipboard-${Date.now()}.${ext}`, { type: item.type });
        void processFile(f);
        return;
      }
    }
  }, [processFile, extracting, saving]);

  // Botón explícito "Pegar del portapapeles" (Permissions API moderna).
  const handlePasteButton = useCallback(async () => {
    if (extracting || saving) return;
    setExtractError(null);
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imgType = item.types.find(t => t.startsWith("image/"));
        if (imgType) {
          const blob = await item.getType(imgType);
          const ext = imgType.split("/")[1] ?? "png";
          const f = new File([blob], `clipboard-${Date.now()}.${ext}`, { type: imgType });
          void processFile(f);
          return;
        }
      }
      setExtractError("El portapapeles no contiene una imagen. Copiá primero una captura del reporte.");
    } catch {
      setExtractError("El navegador no permitió leer el portapapeles. Probá pegar con Ctrl+V o subí el archivo.");
    }
  }, [processFile, extracting, saving]);

  const updateParam = (i: number, patch: Partial<typeof params[0]>) => {
    setParams(p => p.map((x, idx) => idx === i ? { ...x, ...patch } : x));
  };
  const addParam    = () => setParams(p => [...p, { key: "", value: "", unit: "", conf: null }]);
  const removeParam = (i: number) => setParams(p => p.filter((_, idx) => idx !== i));

  const submit = async () => {
    setErr(null);
    if (!verdict) { setErr("El veredicto es requerido."); return; }
    setSaving(true);
    try {
      const paramObj: Record<string, { value: number | string; unit?: string }> = {};
      for (const p of params) {
        const k = p.key.trim();
        if (!k || !p.value.trim()) continue;
        const num = Number(p.value);
        paramObj[k] = { value: Number.isFinite(num) ? num : p.value, unit: p.unit || undefined };
      }
      // trim() y no falsy: "0" es una lectura válida del horómetro.
      const hoursText = runningHours.trim();
      const hoursNum  = Number(hoursText);
      await api.post(`/app/fluid-analyses/${sample.id}/result`, {
        receivedAt, verdict, summary: summary || null,
        parameters: paramObj, reportUrl, reportMime,
        runningHours: hoursText && Number.isFinite(hoursNum) ? hoursNum : null,
      });
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "No se pudo guardar.");
    } finally { setSaving(false); }
  };

  // ESC guard
  const resultDirty = useDirtyTracker({
    verdict, summary, receivedAt, runningHours, params, reportUrl,
  });
  const requestClose = useEscapeGuard({ isDirty: resultDirty, onSave: submit, onClose });

  return (
    <ModalShell title={`Cargar resultado · ${sample.sampleCode}`} onClose={requestClose} wide>
      <div className="space-y-5">
        {/* Step 1: AI upload */}
        <div
          className="rounded-xl border border-accent/20 bg-accent/5 p-4 space-y-3"
          onPaste={handlePaste}
          tabIndex={-1}
        >
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-accent" />
            <p className="text-xs font-bold text-accent">{t("fa.uploadLabReport")}</p>
          </div>
          <p className="text-[11px] text-text-industrial/60">
            El sistema va a leer el archivo y rellenar los campos abajo. Vos confirmás antes de guardar.
            También podés <kbd className="px-1 py-0.5 rounded bg-fg/10 border border-fg/20 text-[10px] font-mono">Ctrl+V</kbd> una imagen del portapapeles.
          </p>
          <div className="space-y-1">
            <label className={labelCls}>{t("fa.sampleNumberHint")}</label>
            <input
              value={sampleNumber}
              onChange={e => setSampleNumber(e.target.value)}
              placeholder={t("fa.sampleNumberPh")}
              disabled={extracting || saving}
              className={inputCls}
            />
            <p className="text-[10px] text-text-industrial/45">{t("fa.sampleNumberHelp")}</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <label className="cursor-pointer">
              <span className="px-3 py-1.5 rounded-lg bg-accent text-accent-fg font-bold text-xs hover:brightness-110 inline-flex items-center gap-1.5">
                <Upload className="w-3.5 h-3.5" /> {file ? "Cambiar archivo" : "Subir reporte"}
              </span>
              <input type="file" accept="application/pdf,image/jpeg,image/png,image/gif,image/webp,image/heic" onChange={handleFileChange} className="hidden" disabled={extracting || saving} />
            </label>
            <button
              type="button"
              onClick={() => { void handlePasteButton(); }}
              disabled={extracting || saving}
              title="Pegar imagen desde el portapapeles"
              className="px-3 py-1.5 rounded-lg bg-fg/5 border border-fg/15 text-xs text-text-industrial hover:text-fg hover:border-accent/40 disabled:opacity-50 inline-flex items-center gap-1.5 transition-all"
            >
              <Clipboard className="w-3.5 h-3.5 text-accent" /> Pegar imagen
            </button>
            {extracting && <span className="text-xs text-accent flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Analizando...</span>}
            {file && !extracting && <span className="text-xs text-text-industrial/60 truncate max-w-[300px]">{file.name}</span>}
          </div>
          {extractError && <p className="text-xs text-red-700 dark:text-red-400">{extractError}</p>}
          {extractNote && <p className="text-[11px] text-text-industrial/60 italic">Nota: {extractNote}</p>}
          {reportUrl && <AuthedDocLink src={reportUrl} label="Ver archivo cargado" className="text-xs text-accent inline-flex items-center gap-1" />}
        </div>

        {/* Step 2: form pre-filled */}
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Fecha de recepción</label>
              <input type="date" value={receivedAt} onChange={e => setReceivedAt(e.target.value)} className={inputCls} />
            </div>
            <GuideField id="fa-f-verdict" missing={!verdict}>
              <label className={labelCls}>{t("fa.verdict").replace(/\s*\*\s*$/, "")}<RequiredMark />{!verdict && <GuideNeedTag label={t("mp.guide.missing")} />}</label>
              <select value={verdict} onChange={e => setVerdict(e.target.value as Verdict)} className={inputCls}>
                <option value="">{t("fa.selectPh")}</option>
                {VERDICTS.map(v => <option key={v} value={v}>{VERDICT_STYLES[v].label}</option>)}
              </select>
            </GuideField>
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <label className={labelCls + " mb-0"}>{t("fa.runHours")} al momento del muestreo</label>
              {runningHoursConf && <ConfidenceBadge confidence={runningHoursConf} />}
            </div>
            <input
              type="number" inputMode="numeric" min={0}
              value={runningHours}
              onChange={e => { setRunningHours(e.target.value); setRunningHoursConf(null); }}
              className={inputCls}
              placeholder="12500"
            />
            {sample.sourceWorkOrderId && (
              <p className="text-[10px] text-text-industrial/40 mt-1">
                Se asienta en la OT de origen como horas al momento de ejecución (no pisa un valor ya cargado).
              </p>
            )}
          </div>
          <div>
            <label className={labelCls}>Resumen / recomendación del lab</label>
            <AutoTextArea rows={3} value={summary} onChange={e => setSummary(e.target.value)} className={inputCls + " resize-y"} />
          </div>

          {/* Parameters */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className={labelCls + " mb-0"}>Parámetros</label>
              <button onClick={addParam} className="text-[10px] text-accent hover:underline">+ Agregar</button>
            </div>
            <div className="space-y-1.5">
              <div className="grid grid-cols-12 gap-2 text-[10px] uppercase tracking-wider text-text-industrial/40">
                <div className="col-span-3">Parámetro</div>
                <div className="col-span-3">Valor</div>
                <div className="col-span-2">Unidad</div>
                <div className="col-span-3">Confianza</div>
                <div className="col-span-1"></div>
              </div>
              {params.map((p, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-center">
                  <input value={p.key}   onChange={e => updateParam(i, { key: e.target.value })}   className={`${inputCls} col-span-3 py-1 text-xs font-mono`} placeholder="fe" />
                  <input value={p.value} onChange={e => updateParam(i, { value: e.target.value })} className={`${inputCls} col-span-3 py-1 text-xs font-mono`} placeholder="45" />
                  <input value={p.unit}  onChange={e => updateParam(i, { unit: e.target.value })}  className={`${inputCls} col-span-2 py-1 text-xs`} placeholder="ppm" />
                  <div className="col-span-3">
                    {p.conf && <ConfidenceBadge confidence={p.conf} />}
                  </div>
                  <button onClick={() => removeParam(i)} className="col-span-1 text-text-industrial/40 hover:text-red-400 justify-self-center"><X className="w-3.5 h-3.5" /></button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {err && <p className="text-xs text-red-700 dark:text-red-400">{err}</p>}
        <div className="flex justify-end gap-2 pt-2 border-t border-fg/10">
          <button onClick={onClose} className="px-3 py-2 rounded-lg text-xs text-text-industrial/60 hover:text-fg">Cancelar</button>
          <button onClick={submit} disabled={saving || extracting} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-accent-fg font-bold text-xs hover:brightness-110 disabled:opacity-50">
            <Save className="w-3.5 h-3.5" />{saving ? "Guardando..." : "Confirmar y guardar"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

