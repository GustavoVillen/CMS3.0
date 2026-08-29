import React, { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, ShieldCheck, ShieldAlert, Waypoints } from "lucide-react";
import { useFetch } from "../lib/hooks";
import { ModalCloseButton } from "../components/ModalCloseButton";
import { useEscapeGuard, useDirtyTracker } from "../lib/escape-guard";
import { api, ApiError } from "../lib/api";
import { DataTable, StatusBadge, type Column } from "../components/DataTable";
import { PageHeader } from "../components/PageHeader";
import { useVesselContext } from "../lib/vessel-context";
import { useT } from "../lib/i18n";
import { AutoTextArea } from "../components/AutoTextArea";

// ─── Vocabulario RCM (alineado con el backend / enums Prisma) ───────────────────

const CONSEQUENCE_OPTS = [
  { value: "SAFETY",          label: "Seguridad" },
  { value: "ENVIRONMENTAL",   label: "Ambiental" },
  { value: "OPERATIONAL",     label: "Operacional" },
  { value: "NON_OPERATIONAL", label: "No operacional" },
] as const;

const DETECTION_OPTS = [
  { value: "NONE",       label: "No detectable (falla oculta)" },
  { value: "INSPECTION", label: "Inspección / prueba funcional" },
  { value: "FLUID",      label: "Análisis de fluidos" },
  { value: "VIBRATION",  label: "Vibración" },
  { value: "THERMAL",    label: "Termografía" },
  { value: "ULTRASOUND", label: "Ultrasonido" },
  { value: "CONDITION",  label: "Sensor / condición en línea" },
] as const;

const PROBABILITY_OPTS = [
  { value: "",         label: "— Sin estimar —" },
  { value: "LIKELY",   label: "Probable (alta)" },
  { value: "PROBABLE", label: "Posible (media)" },
  { value: "UNLIKELY", label: "Improbable (baja)" },
  { value: "RARE",     label: "Rara (muy baja)" },
] as const;

const CONSEQUENCE_LABEL: Record<string, string> = Object.fromEntries(CONSEQUENCE_OPTS.map(o => [o.value, o.label]));
const DETECTION_LABEL: Record<string, string> = Object.fromEntries(DETECTION_OPTS.map(o => [o.value, o.label]));

function consequenceCls(value: string | null): string {
  switch (value) {
    case "SAFETY":          return "text-red-700 dark:text-red-400";
    case "ENVIRONMENTAL":   return "text-emerald-700 dark:text-emerald-400";
    case "OPERATIONAL":     return "text-amber-700 dark:text-amber-400";
    case "NON_OPERATIONAL": return "text-text-industrial/60";
    default:                return "text-text-industrial/30";
  }
}

// ─── Tipos ──────────────────────────────────────────────────────────────────────

interface FailureMode {
  id: string;
  code: string;
  vesselCode: string;
  assetId: string;
  title: string;
  failureCause: string | null;
  failureEffect: string | null;
  consequenceCategory: string | null;
  consequenceRationale: string | null;
  detectionMethod: string;
  mitigatingPlanId: string | null;
  probability: string | null;
  status: string;
  // Enriquecidos por el backend
  assetCode: string | null;
  assetName: string | null;
  mitigatingPlanCode: string | null;
  mitigatingPlanTitle: string | null;
  covered: boolean;
}

interface ListResponse { items: FailureMode[]; total: number; }
interface AssetLite { id: string; assetCode: string; name: string | null; }
interface PlanLite { id: string; taskCode: string; title: string; assetId: string; }

const inputCls = "w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50";
const selectCls = "w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg focus:outline-none focus:border-accent/50";
const labelCls = "text-xs font-semibold text-text-industrial/60 uppercase tracking-wider";

// ─── Drawer ───────────────────────────────────────────────────────────────────

interface DrawerProps {
  initial: FailureMode | null;
  onClose: () => void;
  onSaved: () => void;
}

const FailureModeDrawer: React.FC<DrawerProps> = ({ initial, onClose, onSaved }) => {
  const isEdit = Boolean(initial);
  const { vessels } = useVesselContext();

  const [vesselCode, setVesselCode] = useState(initial?.vesselCode ?? "");
  const [assetId, setAssetId] = useState(initial?.assetId ?? "");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [failureCause, setFailureCause] = useState(initial?.failureCause ?? "");
  const [failureEffect, setFailureEffect] = useState(initial?.failureEffect ?? "");
  const [consequenceCategory, setConsequenceCategory] = useState(initial?.consequenceCategory ?? "");
  const [consequenceRationale, setConsequenceRationale] = useState(initial?.consequenceRationale ?? "");
  const [detectionMethod, setDetectionMethod] = useState(initial?.detectionMethod ?? "NONE");
  const [mitigatingPlanId, setMitigatingPlanId] = useState(initial?.mitigatingPlanId ?? "");
  const [probability, setProbability] = useState(initial?.probability ?? "");
  const [status, setStatus] = useState(initial?.status ?? "ACTIVE");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [assets, setAssets] = useState<AssetLite[]>([]);
  const [plans, setPlans] = useState<PlanLite[]>([]);

  // Un solo buque asignado → autoselección.
  useEffect(() => {
    if (vessels.length === 1 && vessels[0] && !vesselCode) setVesselCode(vessels[0].code);
  }, [vessels, vesselCode]);

  // Activos del buque.
  useEffect(() => {
    if (!vesselCode) { setAssets([]); return; }
    api.get<{ items: AssetLite[] }>(`/app/pms/assets?vesselCode=${encodeURIComponent(vesselCode)}&limit=500`)
      .then(r => setAssets(r.items ?? []))
      .catch(() => setAssets([]));
  }, [vesselCode]);

  // Planes del buque (para el selector de plan mitigante).
  useEffect(() => {
    if (!vesselCode) { setPlans([]); return; }
    api.get<{ items: PlanLite[] }>(`/app/pms/maintenance-plans?vesselCode=${encodeURIComponent(vesselCode)}`)
      .then(r => setPlans(r.items ?? []))
      .catch(() => setPlans([]));
  }, [vesselCode]);

  // Al cambiar de buque en alta, reseteamos activo y plan (pertenecen al buque).
  const onVesselChange = (code: string) => {
    setVesselCode(code);
    if (!isEdit) { setAssetId(""); setMitigatingPlanId(""); }
  };

  // Planes del activo primero, luego el resto del buque.
  const sortedPlans = useMemo(() => {
    const ofAsset = plans.filter(p => p.assetId === assetId);
    const others = plans.filter(p => p.assetId !== assetId);
    return [...ofAsset, ...others];
  }, [plans, assetId]);

  const save = async () => {
    if (!vesselCode) { setErr("El buque es requerido."); return; }
    if (!assetId)    { setErr("El activo es requerido."); return; }
    if (!title.trim()) { setErr("El modo de falla es requerido."); return; }
    setSaving(true); setErr(null);
    try {
      const payload = {
        vesselCode,
        assetId,
        title: title.trim(),
        failureCause: failureCause.trim() || null,
        failureEffect: failureEffect.trim() || null,
        consequenceCategory: consequenceCategory || null,
        consequenceRationale: consequenceRationale.trim() || null,
        detectionMethod: detectionMethod || "NONE",
        mitigatingPlanId: mitigatingPlanId || null,
        probability: probability || null,
        status,
      };
      if (isEdit) await api.patch(`/app/pms/failure-modes/${initial!.id}`, payload);
      else        await api.post("/app/pms/failure-modes", payload);
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Error al guardar.");
    } finally {
      setSaving(false);
    }
  };

  const isDirty = useDirtyTracker({ vesselCode, assetId, title, failureCause, failureEffect, consequenceCategory, consequenceRationale, detectionMethod, mitigatingPlanId, probability, status });
  const requestClose = useEscapeGuard({ isDirty, onSave: save, onClose });

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full sm:max-w-2xl bg-surface dark:bg-[#0D1B2A] border border-fg/10 sm:rounded-2xl shadow-2xl flex flex-col max-h-[95vh]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-fg/10 shrink-0">
          <div>
            <h2 className="text-base font-bold text-fg">{isEdit ? "Editar Modo de Falla" : "Nuevo Modo de Falla"}</h2>
            {isEdit && <p className="text-[10px] text-text-industrial/40 font-mono">{initial!.code}</p>}
          </div>
          <ModalCloseButton onClose={requestClose} />
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Buque + Activo */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className={labelCls}>Buque *</label>
              <select value={vesselCode} onChange={e => onVesselChange(e.target.value)} disabled={isEdit} className={selectCls}>
                <option value="">— Seleccionar —</option>
                {vessels.map(v => <option key={v.code} value={v.code}>{v.name}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className={labelCls}>Activo *</label>
              <select value={assetId} onChange={e => setAssetId(e.target.value)} disabled={!vesselCode} className={selectCls}>
                <option value="">— Seleccionar —</option>
                {assets.map(a => <option key={a.id} value={a.id}>{a.assetCode} — {a.name ?? ""}</option>)}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className={labelCls}>Modo de falla *</label>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Obstrucción del impulsor" className={inputCls} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className={labelCls}>Causa de la falla</label>
              <AutoTextArea value={failureCause} onChange={e => setFailureCause(e.target.value)} rows={2} placeholder="Desgaste, cavitación…" className={inputCls} />
            </div>
            <div className="space-y-1.5">
              <label className={labelCls}>Efecto en el equipo</label>
              <AutoTextArea value={failureEffect} onChange={e => setFailureEffect(e.target.value)} rows={2} placeholder="Pérdida de caudal, sobrecalentamiento…" className={inputCls} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className={labelCls}>Consecuencia (RCM)</label>
              <select value={consequenceCategory} onChange={e => setConsequenceCategory(e.target.value)} className={selectCls}>
                <option value="">— Sin clasificar —</option>
                {CONSEQUENCE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className={labelCls}>Probabilidad</label>
              <select value={probability} onChange={e => setProbability(e.target.value)} className={selectCls}>
                {PROBABILITY_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className={labelCls}>Justificación de la consecuencia</label>
            <AutoTextArea value={consequenceRationale} onChange={e => setConsequenceRationale(e.target.value)} rows={2} placeholder="Si esta falla ocurre, ¿qué pasa? (personas / ambiente / operación / costo)" className={inputCls} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className={labelCls}>¿Cómo se detecta / previene?</label>
              <select value={detectionMethod} onChange={e => setDetectionMethod(e.target.value)} className={selectCls}>
                {DETECTION_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className={labelCls}>Estado</label>
              <select value={status} onChange={e => setStatus(e.target.value)} className={selectCls}>
                <option value="ACTIVE">Activo</option>
                <option value="INACTIVE">Inactivo</option>
              </select>
            </div>
          </div>

          {/* Plan mitigante — el link que cierra el lazo RCM */}
          <div className="space-y-1.5">
            <label className={labelCls}>Plan que lo mitiga</label>
            <select value={mitigatingPlanId} onChange={e => setMitigatingPlanId(e.target.value)} disabled={!vesselCode} className={selectCls}>
              <option value="">— Sin plan asignado (hueco de cobertura) —</option>
              {sortedPlans.map(p => (
                <option key={p.id} value={p.id}>
                  {p.taskCode} — {p.title}{p.assetId === assetId ? "" : " (otro activo)"}
                </option>
              ))}
            </select>
            <p className="text-[10px] text-text-industrial/40">
              Si ningún plan mitiga este modo de falla, dejalo sin asignar: aparecerá marcado como hueco de cobertura.
            </p>
          </div>

          {err && <p className="text-xs text-red-700 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{err}</p>}
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-fg/10 shrink-0">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-fg transition-colors">Cancelar</button>
          <button onClick={() => { void save(); }} disabled={saving} className="px-4 py-2 rounded-xl bg-accent text-accent-fg font-bold text-xs hover:brightness-110 disabled:opacity-50 flex items-center gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export const FailureModesPage: React.FC = () => {
  const t = useT();
  const { selectedVesselCode } = useVesselContext();
  const path = selectedVesselCode
    ? `/app/pms/failure-modes?vesselCode=${encodeURIComponent(selectedVesselCode)}`
    : "/app/pms/failure-modes";
  const { data, loading, error, reload } = useFetch<ListResponse>(path, [path]);
  const [editing, setEditing] = useState<FailureMode | null | "new">(null);

  const uncovered = (data?.items ?? []).filter(f => f.status === "ACTIVE" && !f.covered).length;

  const COLUMNS: Column<FailureMode>[] = [
    { key: "code",    header: t("col.code"), render: r => <span className="font-mono font-bold text-fg text-xs">{r.code}</span> },
    { key: "asset",   header: "Activo",      render: r => <span className="text-xs text-fg">{r.assetCode ?? "—"}{r.assetName ? ` · ${r.assetName}` : ""}</span> },
    { key: "title",   header: "Modo de falla", render: r => <span className="font-medium text-fg">{r.title}</span> },
    { key: "consequenceCategory", header: "Consecuencia", render: r => <span className={`font-semibold text-xs ${consequenceCls(r.consequenceCategory)}`}>{r.consequenceCategory ? CONSEQUENCE_LABEL[r.consequenceCategory] ?? r.consequenceCategory : "—"}</span> },
    { key: "detectionMethod", header: "Detección", render: r => <span className="text-xs text-text-industrial/60">{DETECTION_LABEL[r.detectionMethod] ?? r.detectionMethod}</span> },
    { key: "covered", header: "Cobertura", render: r => (
      r.covered
        ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400" title={r.mitigatingPlanCode ? `Plan ${r.mitigatingPlanCode}` : undefined}><ShieldCheck className="w-3.5 h-3.5" />{r.mitigatingPlanCode ?? "Cubierto"}</span>
        : <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 dark:text-amber-400"><ShieldAlert className="w-3.5 h-3.5" />Sin plan</span>
    ) },
    { key: "status",  header: t("col.status"), render: r => <StatusBadge status={r.status} /> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader icon={Waypoints} title={t("page.failureModes")} total={data?.total} onReload={reload}>
        <button onClick={() => setEditing("new")} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent/10 border border-accent/20 text-xs text-accent hover:bg-accent/20 transition-all">
          <Plus className="w-3.5 h-3.5" /> Nuevo modo de falla
        </button>
      </PageHeader>

      {uncovered > 0 && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-800 dark:text-amber-300">
          <ShieldAlert className="w-4 h-4 shrink-0" />
          <span><b>{uncovered}</b> {uncovered === 1 ? "modo de falla activo no tiene" : "modos de falla activos no tienen"} un plan de mantenimiento que lo mitigue (hueco de cobertura RCM).</span>
        </div>
      )}

      <DataTable
        columns={COLUMNS}
        data={data?.items ?? null}
        loading={loading}
        error={error}
        keyFn={r => r.id}
        emptyText="No hay modos de falla registrados."
        onRowClick={row => setEditing(row)}
      />
      {editing && (
        <FailureModeDrawer
          initial={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
        />
      )}
    </div>
  );
};
