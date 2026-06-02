import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  FlaskConical, Plus, Upload, Sparkles, Loader2, X, Eye, Edit3, Save,
  CheckCircle2, AlertTriangle, AlertOctagon, Trash2, FileText, TrendingUp,
  ArrowUpDown, ChevronUp, ChevronDown, Clipboard,
} from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Legend } from "recharts";
import { useFetch } from "../lib/hooks";
import { api, ApiError } from "../lib/api";
import { MarkdownText } from "../components/MarkdownText";
import { PageHeader } from "../components/PageHeader";
import { ExportExcelButton } from "../components/ExportExcelButton";
import { useT } from "../lib/i18n";
import { useAuth } from "../lib/auth";
import { useVesselContext } from "../lib/vessel-context";
import { fmtDate } from "../lib/utils";
import { useEscapeGuard, useDirtyTracker } from "../lib/escape-guard";

// ─── Types ────────────────────────────────────────────────────────────────────

const FLUID_TYPES = [
  "ENGINE_OIL", "HYDRAULIC_OIL", "GEARBOX_OIL", "TRANSMISSION_OIL",
  "FUEL_DIESEL", "FUEL_GASOIL",
  "COOLING_WATER", "BOILER_WATER", "POTABLE_WATER",
  "REFRIGERANT", "OTHER",
] as const;
type FluidType = typeof FLUID_TYPES[number];

const VERDICTS = ["NORMAL", "CAUTION", "CRITICAL", "ACTION_REQUIRED"] as const;
type Verdict = typeof VERDICTS[number];

const SAMPLE_STATUSES = ["DRAFT", "SENT", "REPORTED", "ARCHIVED"] as const;
type SampleStatus = typeof SAMPLE_STATUSES[number];

const FLUID_LABELS: Record<FluidType, string> = {
  ENGINE_OIL:       "Aceite motor",
  HYDRAULIC_OIL:    "Hidráulico",
  GEARBOX_OIL:      "Reductora",
  TRANSMISSION_OIL: "Transmisión",
  FUEL_DIESEL:      "Diesel",
  FUEL_GASOIL:      "Gasoil",
  COOLING_WATER:    "Refrigeración",
  BOILER_WATER:     "Caldera",
  POTABLE_WATER:    "Agua potable",
  REFRIGERANT:      "Refrigerante",
  OTHER:            "Otro",
};

const VERDICT_STYLES: Record<Verdict, { bg: string; text: string; border: string; label: string; Icon: React.ComponentType<{ className?: string }> }> = {
  NORMAL:           { bg: "bg-green-500/10",  text: "text-green-700 dark:text-green-400",  border: "border-green-500/20",  label: "NORMAL",           Icon: CheckCircle2 },
  CAUTION:          { bg: "bg-yellow-500/10", text: "text-yellow-700 dark:text-yellow-400", border: "border-yellow-500/20", label: "PRECAUCIÓN",       Icon: AlertTriangle },
  CRITICAL:         { bg: "bg-red-500/10",    text: "text-red-700 dark:text-red-400",    border: "border-red-500/20",    label: "CRÍTICO",          Icon: AlertOctagon },
  ACTION_REQUIRED:  { bg: "bg-red-500/15",    text: "text-red-700 dark:text-red-300",    border: "border-red-500/30",    label: "ACCIÓN REQUERIDA", Icon: AlertOctagon },
};

interface FluidParameter { value: number | string; unit?: string; }
interface FluidResult {
  id: string;
  receivedAt: string;
  verdict: Verdict;
  summary: string | null;
  parameters: Record<string, FluidParameter | number | string>;
  reportUrl: string | null;
  reportMime: string | null;
  aiAnalysis: string | null;
  aiAnalysisGeneratedAt: string | null;
}
// Tipos de muestreo. FLUID es el caso histórico. Al ampliar el módulo a CBM,
// la misma tabla almacena también vibración, termografía, etc. `fluidType`
// queda null cuando kind !== "FLUID".
type SampleKind = "FLUID" | "VIBRATION" | "THERMAL" | "ULTRASOUND" | "OTHER";

const SAMPLE_KIND_LABELS: Record<SampleKind, string> = {
  FLUID:      "Fluido",
  VIBRATION:  "Vibración",
  THERMAL:    "Termografía",
  ULTRASOUND: "Ultrasonido",
  OTHER:      "Otro",
};

interface FluidSample {
  id: string;
  vesselCode: string;
  assetId: string;
  sampleCode: string;
  kind: SampleKind;
  fluidType: FluidType | null;
  fluidProduct: string | null;
  sampledAt: string;
  runningHours: number | null;
  containerCode: string | null;
  sentAt: string | null;
  labName: string | null;
  labReference: string | null;
  status: SampleStatus;
  notes: string | null;
  result: FluidResult | null;
  createdAt: string;
  sourceWorkOrderId: string | null;
  sourcePlanId: string | null;
}

interface ListResponse { items: FluidSample[]; total: number; }
interface AssetItem { id: string; name: string | null; assetCode: string | null; vesselCode: string; }

// ─── Helpers ──────────────────────────────────────────────────────────────────

const inputCls  = "w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 disabled:opacity-60";
const labelCls  = "block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider mb-1.5";

function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const s = VERDICT_STYLES[verdict];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold ${s.bg} ${s.text} ${s.border}`}>
      <s.Icon className="w-3 h-3" />
      {s.label}
    </span>
  );
}

async function uploadAndExtract(file: File, vesselCode: string | null): Promise<{ extracted: any; file: { url: string; name: string; mime: string } }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/octet-stream",
    "X-Filename": encodeURIComponent(file.name),
  };
  const token = localStorage.getItem("gpms_token");
  const slug  = localStorage.getItem("gpms_tenant_slug");
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (slug)  headers["X-Tenant-Slug"] = slug;
  if (vesselCode) headers["X-Vessel-Code"] = vesselCode;
  const res = await fetch("/app/fluid-analyses/extract", { method: "POST", headers, body: file });
  if (!res.ok) {
    let msg = res.statusText;
    try { const j = await res.json(); msg = j?.error?.message ?? msg; } catch { /* noop */ }
    throw new Error(msg);
  }
  return res.json();
}

// ─── Main page ────────────────────────────────────────────────────────────────

export const FluidAnalysesPage: React.FC = () => {
  const t = useT();
  const { user } = useAuth();
  const canManage = user?.role === "TENANT_ADMIN" || user?.role === "MAINTENANCE_MANAGER";

  const [filters, setFilters] = useState({ fluidType: "" });
  const [creatingSample, setCreatingSample] = useState(false);
  const [openDetailId, setOpenDetailId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<string>("sampledAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const handleSort = (key: string) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };

  const params = new URLSearchParams();
  if (filters.fluidType)  params.set("fluidType",  filters.fluidType);
  const path = `/app/fluid-analyses${params.toString() ? "?" + params.toString() : ""}`;

  const { data, loading, error, reload } = useFetch<ListResponse>(path, [path]);
  const { data: assetsData } = useFetch<{ items: AssetItem[] }>("/app/assets", []);
  // Reuse VesselContext instead of re-fetching /app/vessels.
  const { vessels: contextVessels } = useVesselContext();

  const assets = useMemo(() => assetsData?.items ?? [], [assetsData?.items]);

  const samples = useMemo(() => {
    const items = [...(data?.items ?? [])];
    items.sort((a, b) => {
      let av: string | number | null = null;
      let bv: string | number | null = null;
      if (sortKey === "sampleCode")  { av = a.sampleCode;  bv = b.sampleCode; }
      if (sortKey === "vesselCode")  { av = a.vesselCode;  bv = b.vesselCode; }
      if (sortKey === "assetId")     { av = assetLabel(a.assetId, assets); bv = assetLabel(b.assetId, assets); }
      if (sortKey === "fluidType")   { av = a.fluidType;   bv = b.fluidType; }
      if (sortKey === "sampledAt")   { av = a.sampledAt;   bv = b.sampledAt; }
      if (sortKey === "runningHours"){ av = a.runningHours ?? -1; bv = b.runningHours ?? -1; }
      if (sortKey === "status")      { av = a.status;      bv = b.status; }
      if (sortKey === "verdict")     { av = a.result?.verdict ?? ""; bv = b.result?.verdict ?? ""; }
      if (sortKey === "report")      { av = a.result?.reportUrl ? 1 : 0; bv = b.result?.reportUrl ? 1 : 0; }
      if (av === null || bv === null) return 0;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return items;
  }, [data?.items, sortKey, sortDir, assets]);

  return (
    <div className="space-y-5">
      {creatingSample && canManage && (
        <SampleFormModal
          mode="create"
          assets={assetsData?.items ?? []}
          vessels={contextVessels}
          onClose={() => setCreatingSample(false)}
          onSaved={() => { setCreatingSample(false); reload(); }}
        />
      )}

      {openDetailId && (
        <SampleDetailModal
          id={openDetailId}
          assets={assetsData?.items ?? []}
          canManage={canManage}
          onClose={() => setOpenDetailId(null)}
          onChanged={reload}
        />
      )}

      <PageHeader icon={FlaskConical} title={t("page.fluidAnalyses")} total={data?.total} onReload={reload}>
        <ExportExcelButton module="fluid_samples" />
        <div className="flex items-center gap-2 flex-wrap">
          <select value={filters.fluidType} onChange={e => setFilters(f => ({ ...f, fluidType: e.target.value }))}
            className="bg-fg/5 border border-fg/10 rounded-lg px-2 py-1.5 text-xs text-text-industrial">
            <option value="">{t("fa.allFluids")}</option>
            {FLUID_TYPES.map(f => <option key={f} value={f}>{FLUID_LABELS[f]}</option>)}
          </select>
          {canManage && (
            <button
              onClick={() => setCreatingSample(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-accent-fg font-bold text-xs hover:brightness-110 transition-all"
            >
              <Plus className="w-3.5 h-3.5" /> {t("fa.newSample")}
            </button>
          )}
        </div>
      </PageHeader>

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
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-fg/10 text-text-industrial/40 text-[10px] uppercase tracking-widest">
                <SortTh label="Código"    col="sampleCode"   sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <SortTh label="Buque"     col="vesselCode"   sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <SortTh label="Equipo"    col="assetId"      sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <SortTh label="Tipo"      col="fluidType"    sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <SortTh label="Toma"      col="sampledAt"    sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <SortTh label="Horas"     col="runningHours" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" />
                <SortTh label="Estado"    col="status"       sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <SortTh label="Veredicto" col="verdict"      sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <SortTh label="Reporte"   col="report"       sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
              </tr>
            </thead>
            <tbody>
              {samples.map(s => (
                <tr key={s.id} onClick={() => setOpenDetailId(s.id)}
                    className="border-b border-fg/5 hover:bg-fg/3 transition-colors cursor-pointer">
                  <td className="px-4 py-3 font-mono font-bold text-accent">{s.sampleCode}</td>
                  <td className="px-4 py-3 text-text-industrial/70">{s.vesselCode}</td>
                  <td className="px-4 py-3 text-text-industrial/70">{assetLabel(s.assetId, assetsData?.items ?? [])}</td>
                  <td className="px-4 py-3 text-text-industrial/70">
                    {s.kind === "FLUID"
                      ? (s.fluidType ? (FLUID_LABELS[s.fluidType] ?? s.fluidType) : "Fluido")
                      : SAMPLE_KIND_LABELS[s.kind] ?? s.kind}
                  </td>
                  <td className="px-4 py-3 text-text-industrial/60">{fmtDate(s.sampledAt)}</td>
                  <td className="px-4 py-3 text-right text-text-industrial/60 font-mono">{s.runningHours ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className="inline-block px-2 py-0.5 rounded-full bg-fg/5 border border-fg/10 text-[10px] font-bold text-text-industrial/60">
                      {s.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">{s.result ? <VerdictBadge verdict={s.result.verdict} /> : <span className="text-text-industrial/30">—</span>}</td>
                  <td className="px-4 py-3">
                    {s.result?.reportUrl
                      ? <a href={s.result.reportUrl} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="text-accent hover:underline inline-flex items-center gap-1"><FileText className="w-3 h-3" /> Ver</a>
                      : <span className="text-text-industrial/20">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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

function assetLabel(assetId: string, assets: AssetItem[]): string {
  const a = assets.find(x => x.id === assetId);
  if (!a) return assetId.slice(0, 8) + "…";
  return a.name ?? a.assetCode ?? assetId;
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
  useEscapeGuard({ isDirty, onSave: submit, onClose });

  return (
    <ModalShell title={mode === "create" ? t("fa.newSample") : `${t("fa.editSample")} ${sample?.sampleCode}`} onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>{t("form.vessel")}</label>
            <select value={vesselCode} onChange={e => { setVesselCode(e.target.value); setAssetId(""); }} className={inputCls}>
              <option value="">{t("fa.selectPh")}</option>
              {vessels.map(v => <option key={v.code} value={v.code}>{v.code}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>{t("form.equipment")}</label>
            <select value={assetId} onChange={e => setAssetId(e.target.value)} className={inputCls} disabled={!vesselCode}>
              <option value="">{t("fa.selectPh")}</option>
              {filteredAssets.map(a => <option key={a.id} value={a.id}>{a.name ?? a.assetCode}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>{t("fa.fluidType")}</label>
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
            <label className={labelCls}>{t("fa.sampleDate")}</label>
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
          <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} className={inputCls + " resize-none"} />
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

  return (
    <ModalShell
      title={`${sample.sampleCode} · ${
        sample.kind === "FLUID"
          ? (sample.fluidType ? FLUID_LABELS[sample.fluidType] : "Fluido")
          : SAMPLE_KIND_LABELS[sample.kind]
      }`}
      onClose={onClose}
      wide
    >
      <div className="space-y-5">
        {sample.sourceWorkOrderId && (
          <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-accent/5 border border-accent/20">
            <div className="flex items-center gap-2 text-xs text-accent/80">
              <Sparkles className="w-3.5 h-3.5" />
              <span>{t("fa.autoGen")}</span>
            </div>
            <button
              onClick={() => navigate(`/work-orders?openId=${encodeURIComponent(sample.sourceWorkOrderId!)}`)}
              className="text-xs font-bold text-accent hover:text-fg inline-flex items-center gap-1"
            >
              {t("fa.viewSourceWo")}
            </button>
          </div>
        )}

        {/* Header info */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label={t("col.vessel")} value={sample.vesselCode} />
          <Stat label={t("capa.equipment")} value={assetLabel(sample.assetId, assets)} />
          <Stat label={t("fa.sampleDate").replace(" *", "")} value={fmtDate(sample.sampledAt)} />
          <Stat label={t("fa.statHours")} value={sample.runningHours != null ? String(sample.runningHours) : "—"} />
          <Stat label={t("fa.statProduct")} value={sample.fluidProduct ?? "—"} />
          <Stat label={t("fa.statLab")} value={sample.labName ?? "—"} />
          <Stat label={t("fa.statLabRef")} value={sample.labReference ?? "—"} />
          <Stat label={t("col.status")} value={sample.status} />
        </div>

        {/* Result section */}
        {sample.result ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-bold text-fg">{t("fa.labResult")}</h3>
              <VerdictBadge verdict={sample.result.verdict} />
            </div>
            {sample.result.summary && (
              <div className="p-3 rounded-xl bg-fg/5 border border-fg/10">
                <p className="text-xs text-text-industrial/70">{sample.result.summary}</p>
              </div>
            )}
            <ParametersTable parameters={sample.result.parameters} />
            {sample.result.reportUrl && (
              <a href={sample.result.reportUrl} target="_blank" rel="noreferrer"
                 className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-fg/5 border border-fg/10 text-xs text-text-industrial hover:border-accent/30">
                <FileText className="w-3.5 h-3.5 text-accent" /> {t("fa.viewOrigReport")}
              </a>
            )}
            {canManage && (
              <button onClick={() => setShowResultForm(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-fg/5 border border-fg/10 text-xs text-text-industrial hover:border-accent/30">
                <Edit3 className="w-3.5 h-3.5 text-accent" /> {t("fa.modifyResult")}
              </button>
            )}
          </div>
        ) : (
          <div className="p-4 rounded-xl border border-dashed border-fg/10 text-center">
            <p className="text-xs text-text-industrial/50 mb-3">{t("fa.noLabResult")}</p>
            {canManage && (
              <button onClick={() => setShowResultForm(true)} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-accent-fg font-bold text-xs hover:brightness-110">
                <Sparkles className="w-3.5 h-3.5" /> {t("fa.loadResultAi")}
              </button>
            )}
          </div>
        )}

        {/* Trend chart — solo para muestras de fluido (los otros kinds usan otros parámetros). */}
        {sample.kind === "FLUID" && sample.fluidType && (
          <div className="space-y-2 pt-2 border-t border-fg/10">
            <h3 className="text-sm font-bold text-fg flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-accent" /> {t("fa.assetTrend")}
            </h3>
            <TrendChart assetId={sample.assetId} fluidType={sample.fluidType} />
          </div>
        )}

        {/* AI insight: tendencias + interpretación + recomendaciones */}
        {sample.result && (
          <AiInsightCard result={sample.result} sampleId={sample.id} onRefresh={load} />
        )}

        {sample.notes && (
          <div className="p-3 rounded-xl bg-fg/5 border border-fg/10">
            <p className="text-[10px] uppercase tracking-wider text-text-industrial/40 mb-1">{t("fa.notes")}</p>
            <p className="text-xs text-text-industrial/70 whitespace-pre-wrap">{sample.notes}</p>
          </div>
        )}

        <div className="flex justify-between items-center gap-2 pt-2 border-t border-fg/10">
          <button onClick={() => downloadFluidPdf(sample.id, sample.sampleCode)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-fg/5 border border-fg/10 text-xs font-bold text-fg hover:border-accent/30">
            <FileText className="w-3.5 h-3.5 text-accent" /> {t("common.savePdf")}
          </button>
          {canManage && (
            <button onClick={remove} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-xs font-bold text-red-700 dark:text-red-400 hover:bg-red-500/20">
              <Trash2 className="w-3.5 h-3.5" /> {t("common.delete")}
            </button>
          )}
        </div>
      </div>
    </ModalShell>
  );
}

// ─── AI insight card ──────────────────────────────────────────────────────────

function AiInsightCard({ result, sampleId, onRefresh }: {
  result: FluidResult;
  sampleId: string;
  onRefresh: () => Promise<void>;
}) {
  const [regenerating, setRegenerating] = useState(false);

  const regenerate = async () => {
    setRegenerating(true);
    try {
      await api.post(`/app/fluid-analyses/${sampleId}/generate-ai-analysis`, {});
      await onRefresh();
    } catch { /* ignore */ }
    finally {
      setRegenerating(false);
    }
  };

  if (!result.aiAnalysis) {
    return (
      <div className="space-y-2 pt-2 border-t border-fg/10">
        <h3 className="text-sm font-bold text-fg flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-accent" /> Análisis IA
        </h3>
        <div className="p-3 rounded-xl bg-fg/5 border border-dashed border-fg/10 text-center">
          <p className="text-xs text-text-industrial/50">
            {regenerating
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin inline-block mr-1" /> Generando análisis...</>
              : "Este análisis aún no tiene insight IA."}
          </p>
          {!regenerating && (
            <button onClick={() => { void regenerate(); }}
              className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent/10 border border-accent/20 text-xs font-bold text-accent hover:bg-accent/20">
              <Sparkles className="w-3.5 h-3.5" /> Generar análisis IA
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2 pt-2 border-t border-fg/10">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-fg flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-accent" /> Análisis IA
        </h3>
        <div className="flex items-center gap-2">
          {result.aiAnalysisGeneratedAt && (
            <span className="text-[10px] text-text-industrial/40">
              Generado: {fmtDate(result.aiAnalysisGeneratedAt)}
            </span>
          )}
          <button
            onClick={() => { void regenerate(); }}
            disabled={regenerating}
            className="text-[10px] text-accent/70 hover:text-accent disabled:opacity-50"
            title="Regenerar análisis"
          >
            {regenerating ? <Loader2 className="w-3 h-3 animate-spin" /> : "Regenerar"}
          </button>
        </div>
      </div>
      <div className="p-3 rounded-xl bg-accent/5 border border-accent/20">
        <MarkdownText
          text={result.aiAnalysis}
          className="text-xs text-text-industrial/80 font-sans"
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-fg/10 bg-fg/5 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-text-industrial/40 font-semibold">{label}</p>
      <p className="text-xs font-bold text-fg truncate mt-0.5">{value}</p>
    </div>
  );
}

function ParametersTable({ parameters }: { parameters: Record<string, FluidParameter | number | string> }) {
  const t = useT();
  const entries = Object.entries(parameters);
  if (entries.length === 0) return <p className="text-xs text-text-industrial/40">{t("fa.noParams")}</p>;
  return (
    <div className="rounded-xl border border-fg/10 overflow-hidden">
      <table className="w-full text-xs">
        <thead className="bg-fg/5">
          <tr className="text-text-industrial/40 text-[10px] uppercase tracking-widest">
            <th className="text-left px-3 py-2 font-semibold">{t("fa.colParam")}</th>
            <th className="text-right px-3 py-2 font-semibold">{t("fa.colValue")}</th>
            <th className="text-left px-3 py-2 font-semibold">{t("fa.colUnit")}</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([key, raw]) => {
            const val = (typeof raw === "object" && raw !== null) ? (raw as FluidParameter).value : raw;
            const unit = (typeof raw === "object" && raw !== null) ? (raw as FluidParameter).unit ?? "" : "";
            return (
              <tr key={key} className="border-t border-fg/5">
                <td className="px-3 py-2 font-mono text-text-industrial/80">{key}</td>
                <td className="px-3 py-2 text-right font-mono text-fg">{String(val)}</td>
                <td className="px-3 py-2 text-text-industrial/50">{unit}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
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
  return (
    <div className="flex items-center gap-2">
      <TrendingUp className="w-3.5 h-3.5 text-accent" />
      <span className="text-[10px] uppercase tracking-wider text-text-industrial/40 font-semibold">{t("fa.paramLabel")}</span>
      <select value={value} onChange={e => onChange(e.target.value)} className="bg-fg/5 border border-fg/10 rounded px-2 py-1 text-xs text-fg font-mono">
        {options.map(o => <option key={o} value={o}>{o}</option>)}
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
  const [file, setFile]             = useState<File | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [reportUrl, setReportUrl]   = useState<string | null>(sample.result?.reportUrl ?? null);
  const [reportMime, setReportMime] = useState<string | null>(sample.result?.reportMime ?? null);

  // Form fields
  const [verdict, setVerdict]       = useState<Verdict | "">(sample.result?.verdict ?? "");
  const [summary, setSummary]       = useState(sample.result?.summary ?? "");
  const [receivedAt, setReceivedAt] = useState(sample.result?.receivedAt ? sample.result.receivedAt.slice(0, 10) : new Date().toISOString().slice(0, 10));
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

  const processFile = useCallback(async (f: File) => {
    setFile(f);
    setExtractError(null);
    setExtracting(true);
    try {
      const { extracted, file: saved } = await uploadAndExtract(f, sample.vesselCode);
      setReportUrl(saved.url);
      setReportMime(saved.mime);

      // Pre-fill form from extraction
      if (extracted.verdict?.value)    setVerdict(extracted.verdict.value);
      if (extracted.summary?.value)    setSummary(extracted.summary.value);
      if (extracted.receivedAt?.value) setReceivedAt(extracted.receivedAt.value);

      const newParams: typeof params = [];
      const extractedParams: Record<string, { value: number | string; unit?: string; confidence: "high" | "medium" | "low" }> = extracted.parameters ?? {};
      for (const [k, p] of Object.entries(extractedParams)) {
        newParams.push({ key: k, value: String(p.value), unit: p.unit ?? "", conf: p.confidence });
      }
      if (newParams.length > 0) setParams(newParams);
    } catch (e: any) {
      setExtractError(e.message ?? "No se pudo extraer el reporte. Cargá los datos manualmente.");
    } finally {
      setExtracting(false);
    }
  }, [sample.vesselCode]);

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
    if (!verdict) { setErr("El veredicto es requerido (la IA puede sugerirlo)."); return; }
    setSaving(true);
    try {
      const paramObj: Record<string, { value: number | string; unit?: string }> = {};
      for (const p of params) {
        const k = p.key.trim();
        if (!k || !p.value.trim()) continue;
        const num = Number(p.value);
        paramObj[k] = { value: Number.isFinite(num) ? num : p.value, unit: p.unit || undefined };
      }
      await api.post(`/app/fluid-analyses/${sample.id}/result`, {
        receivedAt, verdict, summary: summary || null,
        parameters: paramObj, reportUrl, reportMime,
      });
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "No se pudo guardar.");
    } finally { setSaving(false); }
  };

  // ESC guard
  const resultDirty = useDirtyTracker({
    verdict, summary, receivedAt, params, reportUrl,
  });
  useEscapeGuard({ isDirty: resultDirty, onSave: submit, onClose });

  return (
    <ModalShell title={`Cargar resultado · ${sample.sampleCode}`} onClose={onClose} wide>
      <div className="space-y-5">
        {/* Step 1: AI upload */}
        <div
          className="rounded-xl border border-accent/20 bg-accent/5 p-4 space-y-3"
          onPaste={handlePaste}
          tabIndex={-1}
        >
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-accent" />
            <p className="text-xs font-bold text-accent">{t("fa.uploadLabReport")}</p>
          </div>
          <p className="text-[11px] text-text-industrial/60">
            La IA va a leer el archivo y rellenar los campos abajo. Vos confirmás antes de guardar.
            También podés <kbd className="px-1 py-0.5 rounded bg-fg/10 border border-fg/20 text-[10px] font-mono">Ctrl+V</kbd> una imagen del portapapeles.
          </p>
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
            {extracting && <span className="text-xs text-accent flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Analizando con IA...</span>}
            {file && !extracting && <span className="text-xs text-text-industrial/60 truncate max-w-[300px]">{file.name}</span>}
          </div>
          {extractError && <p className="text-xs text-red-700 dark:text-red-400">{extractError}</p>}
          {reportUrl && <a href={reportUrl} target="_blank" rel="noreferrer" className="text-xs text-accent inline-flex items-center gap-1"><FileText className="w-3 h-3" /> Ver archivo cargado</a>}
        </div>

        {/* Step 2: form pre-filled */}
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Fecha de recepción</label>
              <input type="date" value={receivedAt} onChange={e => setReceivedAt(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Veredicto *</label>
              <select value={verdict} onChange={e => setVerdict(e.target.value as Verdict)} className={inputCls}>
                <option value="">Seleccionar...</option>
                {VERDICTS.map(v => <option key={v} value={v}>{VERDICT_STYLES[v].label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className={labelCls}>Resumen / recomendación del lab</label>
            <textarea rows={3} value={summary} onChange={e => setSummary(e.target.value)} className={inputCls + " resize-y"} />
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
                <div className="col-span-3">IA</div>
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

function ConfidenceBadge({ confidence }: { confidence: "high" | "medium" | "low" }) {
  const m = {
    high:   { bg: "bg-green-500/10",  text: "text-green-700 dark:text-green-400",  label: "Alta" },
    medium: { bg: "bg-yellow-500/10", text: "text-yellow-700 dark:text-yellow-400", label: "Verificar" },
    low:    { bg: "bg-red-500/10",    text: "text-red-700 dark:text-red-400",    label: "Dudosa" },
  }[confidence];
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${m.bg} ${m.text}`}>
      IA {m.label}
    </span>
  );
}

// ─── Modal shell ──────────────────────────────────────────────────────────────

function ModalShell({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative w-full ${wide ? "max-w-5xl" : "max-w-2xl"} max-h-[92vh] overflow-y-auto bg-surface dark:bg-[#0D1526] border border-fg/10 rounded-2xl shadow-2xl`}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-fg/10 sticky top-0 bg-surface dark:bg-[#0D1526] z-10">
          <h2 className="text-sm font-bold text-fg">{title}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-fg/5 text-text-industrial/40 hover:text-fg"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
