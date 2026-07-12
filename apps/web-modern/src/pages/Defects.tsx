import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { AlertTriangle, Bot, Camera, Download, ExternalLink, GitBranch, Loader2, Maximize2, Minimize2, Plus, Sparkles, Trash2, X } from "lucide-react";
import { MocModal, type MocPrefill } from "./Moc";
import { useFetch } from "../lib/hooks";
import { api, ApiError } from "../lib/api";
import { DataTable, PriorityBadge, StatusBadge, type Column } from "../components/DataTable";
import { ModalCloseButton } from "../components/ModalCloseButton";
import { VesselLabel, AssetLabel, getAssetName, useAssetsCache } from "../components/EntityLabels";
import { analyzePhotoForDefect, uploadDefectPhoto, listDefectPhotos, deleteDefectPhoto, type DefectPhotoRecord } from "../lib/defect-photos";
import { MicButton } from "../components/MicButton";
import { AuthedImage } from "../lib/authed-media";
import { fmtDate, FILTER_ALL_VALUE, fromFilterSelectValue, toFilterSelectValue } from "../lib/utils";
import { PageHeader } from "../components/PageHeader";
import { ExportExcelButton } from "../components/ExportExcelButton";
import { useT, useWoTerms } from "../lib/i18n";
import { useDeepLink } from "../lib/deep-link";
import { CopyLinkButton } from "../components/CopyLinkButton";
import { useCopilotEmitter, useCopilotApplyFields } from "../lib/copilot-context";
import { CreateWorkOrderModal } from "../components/CreateWorkOrderModal";
import { RichTextArea } from "../components/RichTextArea";
import { useEscapeGuard, useDirtyTracker } from "../lib/escape-guard";
import { useVesselContext } from "../lib/vessel-context";

type RcaMethodology = "FIVE_WHYS" | "FISHBONE" | "FTA" | "BARRIER_ANALYSIS";

interface Defect {
  id: string;
  tenantId: string;
  vesselCode: string;
  assetId: string;
  workOrderId: string | null;
  workOrderCode: string | null;
  // Origen auditoría/inspección externa (cuando classification=EXTERNAL_AUDIT_FINDING).
  sourceType?: string | null;
  sourceId?: string | null;
  auditId?: string | null;
  auditCode?: string | null;
  defectCode: string;
  status: string;
  severity: string;
  operationalState: string;
  classification: string;
  reportedAt: string;
  description: string;
  immediateAction: string | null;
  correctiveAction: string | null;
  rcaAnalysis: string | null;
  rcaMethodology: RcaMethodology | null;
  rcaImmediateCause: string | null;
  rcaContributingCause: string | null;
  rcaRootCause: string | null;
  rcaPreventiveActions: string | null;
  rcaCompletedAt: string | null;
  rcaApprovedAt: string | null;
  rcaApprovedByUserId: string | null;
  capaDescription: string | null;
  repairType: string | null;
  createdAt: string;
}

interface ListResponse {
  items: Defect[];
  total: number;
}

const OP_STATE_STYLES: Record<string, string> = {
  NORMAL: "bg-success-sea/10 text-success-sea border-success-sea/20",
  DEGRADED: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20",
  RESTRICTED: "bg-accent/10 text-accent border-accent/20",
  NO_GO: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20",
};

function OperationalStateBadge({ value }: { value: string }) {
  const cls = OP_STATE_STYLES[value] ?? "bg-fg/5 text-text-industrial/40 border-fg/10";
  return (
    <span className={`inline-block text-[10px] px-2 py-0.5 rounded-full border font-bold ${cls}`}>
      {value}
    </span>
  );
}

function normalizeOptionalText(value: string): string | null {
  const text = value.trim();
  return text || null;
}

function extractCloseNotes(correctiveAction: string | null): string | null {
  if (!correctiveAction || !correctiveAction.includes("[CLOSE]")) return null;
  const parts = correctiveAction.split("[CLOSE]");
  const last = parts[parts.length - 1]?.trim() ?? "";
  return last || correctiveAction.trim();
}

async function downloadDefectPdf(defect: Defect) {
  const token = localStorage.getItem("gpms_token") ?? "";
  const slug  = localStorage.getItem("gpms_tenant_slug") ?? "";
  const res = await fetch(`/app/pms/defects/${defect.id}/pdf`, {
    headers: { Authorization: `Bearer ${token}`, "X-Tenant-Slug": slug },
  });
  if (!res.ok) return;
  const blob = await res.blob();
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `${defect.defectCode}-${defect.vesselCode}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}


// ─── Origen del defecto ───────────────────────────────────────────────────────
// El origen se deriva de la clasificación: las clasificaciones generadas por el
// sistema (WORK_ORDER_FINDING, INSPECTION_FINDING, PREDICTIVE_FLUID_ANALYSIS)
// indican que el defecto nació de una OT / inspección / análisis. Cualquier otra
// clasificación es un registro cargado manualmente.

type DefectOriginKey = "wo" | "inspection" | "fluid" | "audit" | "manual";

function defectOriginKey(classification: string): DefectOriginKey {
  switch (classification) {
    case "WORK_ORDER_FINDING":        return "wo";
    case "INSPECTION_FINDING":        return "inspection";
    case "PREDICTIVE_FLUID_ANALYSIS": return "fluid";
    case "EXTERNAL_AUDIT_FINDING":    return "audit";
    default:                          return "manual";
  }
}

const ORIGIN_STYLES: Record<DefectOriginKey, string> = {
  wo:         "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20",
  inspection: "bg-teal-500/10 text-teal-700 dark:text-teal-400 border-teal-500/20",
  fluid:      "bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 border-cyan-500/20",
  audit:      "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
  manual:     "bg-fg/5 text-text-industrial/60 border-fg/10",
};

const OriginBadge: React.FC<{ classification: string }> = ({ classification }) => {
  const t = useT();
  const key = defectOriginKey(classification);
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-bold whitespace-nowrap ${ORIGIN_STYLES[key]}`}>
      {t("def.origin.prefix")}: {t(`def.origin.${key}` as Parameters<typeof t>[0])}
    </span>
  );
};

// ─── AssetLiveSearch ──────────────────────────────────────────────────────────

interface AssetLiveSearchProps {
  assets: { id: string; assetCode: string; name: string | null }[];
  loading: boolean;
  disabled: boolean;
  value: string;
  onChange: (id: string) => void;
}

const AssetLiveSearch: React.FC<AssetLiveSearchProps> = ({ assets, loading, disabled, value, onChange }) => {
  const [query, setQuery]   = useState("");
  const [open, setOpen]     = useState(false);
  const ref                 = React.useRef<HTMLDivElement>(null);

  const selected = assets.find(a => a.id === value);
  const filtered = query.trim()
    ? assets.filter(a =>
        a.assetCode.toLowerCase().includes(query.toLowerCase()) ||
        (a.name ?? "").toLowerCase().includes(query.toLowerCase())
      )
    : assets;

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const pick = (a: { id: string; assetCode: string; name: string | null }) => {
    onChange(a.id);
    setQuery("");
    setOpen(false);
  };

  const displayValue = selected ? `${selected.assetCode}${selected.name ? ` — ${selected.name}` : ""}` : "";

  return (
    <div ref={ref} className="relative">
      <label className={labelCls}>Equipo *</label>
      <input
        value={open ? query : displayValue}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => { if (!disabled) { setQuery(""); setOpen(true); } }}
        disabled={disabled || loading}
        placeholder={loading ? "Cargando equipos…" : disabled ? "Primero seleccioná un buque" : "Buscar equipo…"}
        className={inputCls}
        autoComplete="off"
      />
      {open && !disabled && filtered.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-xl shadow-2xl max-h-52 overflow-y-auto">
          {filtered.map(a => (
            <button
              key={a.id}
              type="button"
              onMouseDown={() => pick(a)}
              className="w-full text-left px-3 py-2 text-xs text-fg hover:bg-fg/5 transition-colors flex items-center gap-2"
            >
              <span className="font-mono text-accent shrink-0">{a.assetCode}</span>
              {a.name && <span className="text-text-industrial/60 truncate">{a.name}</span>}
            </button>
          ))}
        </div>
      )}
      {open && !disabled && !loading && filtered.length === 0 && (
        <div className="absolute z-50 w-full mt-1 bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-xl shadow-lg px-3 py-2 text-xs text-text-industrial/40">
          Sin resultados
        </div>
      )}
    </div>
  );
};

// ─── CreateDefectModal ────────────────────────────────────────────────────────

// Pre-carga del alta de defecto desde el cierre de una OT correctiva.
export interface DefectPrefill {
  workOrderId?: string;
  vesselCode?: string;
  assetId?: string;
  assetName?: string | null;
  detail?: string;        // detalle breve escrito por el técnico al cerrar la OT
  taskContext?: string | null;
}

interface CreateDefectModalProps {
  prefill?: DefectPrefill;
  onClose: () => void;
  onCreated: (defect: Defect) => void;
}

const SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const OP_STATES  = ["NORMAL", "DEGRADED", "RESTRICTED", "NO_GO"];

const inputCls = "w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/10 transition-all disabled:opacity-50";
const labelCls = "block text-[10px] font-bold text-text-industrial/40 uppercase tracking-widest mb-1.5";

const CreateDefectModal: React.FC<CreateDefectModalProps> = ({ prefill, onClose, onCreated }) => {
  const t = useT();
  // Reuse VesselContext (loaded once for the header) instead of re-fetching /app/vessels.
  const { vessels } = useVesselContext();
  const [assets, setAssets]                   = useState<{ id: string; assetCode: string; name: string | null }[]>([]);
  const [loadingAssets, setLoadingAssets]     = useState(false);
  const [vesselCode, setVesselCode]           = useState(prefill?.vesselCode ?? "");
  const [assetId, setAssetId]                 = useState(prefill?.assetId ?? "");
  const [classification, setClassification]   = useState("");
  const [description, setDescription]         = useState("");
  const [severity, setSeverity]               = useState("MEDIUM");
  // Auto-IA al abrir desde una OT correctiva (redacta descripción + clasifica severidad).
  const [aiAutoLoading, setAiAutoLoading]     = useState(false);
  const [operationalState, setOperationalState] = useState("NORMAL");
  const [immediateAction, setImmediateAction] = useState("");
  const [saving, setSaving]                   = useState(false);
  const [err, setErr]                         = useState<string | null>(null);
  const [expanded, setExpanded]               = useState(true);
  const [loadingImmediate, setLoadingImmediate] = useState(false);

  const selectedAsset = assets.find(a => a.id === assetId);

  // ── Asistente IA: sugerencia de clasificación + detección de duplicados ──
  interface ClassifySuggestion {
    classification: string;
    severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
    shouldBeNearMiss: boolean;
    nearMissReason: string | null;
    confidence: "HIGH" | "MEDIUM" | "LOW";
  }
  interface SimilarDefect {
    id: string; defectCode: string; description: string; status: string;
    severity: string; reportedAt: string; similarity: number;
  }
  const [suggestion, setSuggestion]           = useState<ClassifySuggestion | null>(null);
  const [loadingSuggestion, setLoadingSuggestion] = useState(false);
  const [similar, setSimilar]                 = useState<SimilarDefect[]>([]);

  // Debounce: cuando la descripción tiene >=20 chars y el asset está
  // seleccionado, dispara después de 800ms de inactividad la búsqueda
  // de duplicados. La clasificación NO se llama automáticamente — es
  // explícita con un botón porque consume IA.
  useEffect(() => {
    const desc = description.trim();
    if (desc.length < 15) { setSimilar([]); return; }
    const handler = window.setTimeout(() => {
      api.post<{ items: SimilarDefect[] }>("/app/pms/defects/find-similar", {
        description: desc,
        assetId: assetId || null,
        vesselCode: vesselCode || null,
      }).then(r => setSimilar(r.items ?? [])).catch(() => setSimilar([]));
    }, 800);
    return () => window.clearTimeout(handler);
  }, [description, assetId, vesselCode]);

  const handleSuggestClassification = useCallback(async () => {
    if (loadingSuggestion) return;
    if (description.trim().length < 10) { setErr("Completá una descripción de al menos 10 caracteres para sugerir clasificación."); return; }
    setLoadingSuggestion(true); setErr(null);
    try {
      const res = await api.post<ClassifySuggestion>("/app/pms/defects/suggest-classification", {
        description: description.trim(),
        assetLabel: selectedAsset?.name ?? selectedAsset?.assetCode ?? null,
        operationalState,
      });
      setSuggestion(res);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "No se pudo sugerir clasificación.");
    } finally { setLoadingSuggestion(false); }
  }, [loadingSuggestion, description, selectedAsset, operationalState]);

  const applySuggestion = () => {
    if (!suggestion) return;
    setClassification(suggestion.classification);
    setSeverity(suggestion.severity);
    setSuggestion(null);
  };

  // Fotos pendientes: el usuario las agrega antes de crear el defecto.
  // Cada slot guarda el File original + preview URL + estado de análisis IA.
  interface PendingPhoto { file: File; preview: string; analyzed: boolean }
  const [pendingPhotos, setPendingPhotos] = useState<PendingPhoto[]>([]);
  const [analyzing, setAnalyzing]         = useState(false);
  const photoInputRef                     = React.useRef<HTMLInputElement>(null);

  const onPhotosSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    const added = files.map(f => ({ file: f, preview: URL.createObjectURL(f), analyzed: false }));
    setPendingPhotos(prev => [...prev, ...added]);
    if (e.target) e.target.value = ""; // permite re-seleccionar la misma foto
  };

  const removePhoto = (idx: number) => {
    setPendingPhotos(prev => {
      const next = [...prev];
      const removed = next.splice(idx, 1)[0];
      if (removed) URL.revokeObjectURL(removed.preview);
      return next;
    });
  };

  /**
   * Analiza con IA las fotos que aún no se analizaron. Concatena la descripción
   * técnica al campo `description`. Hace el análisis ANTES de comprimir a la
   * resolución de storage para no perder detalles.
   */
  const handleAnalyzePhotos = useCallback(async () => {
    if (analyzing) return;
    const toAnalyze = pendingPhotos.filter(p => !p.analyzed);
    if (toAnalyze.length === 0) { setErr("Todas las fotos ya fueron analizadas."); return; }
    setAnalyzing(true);
    setErr(null);
    try {
      const assetLabel = selectedAsset?.name ?? selectedAsset?.assetCode ?? null;
      const additions: string[] = [];
      for (const p of toAnalyze) {
        try {
          const res = await analyzePhotoForDefect({
            file: p.file,
            existingDescription: description,
            assetLabel,
          });
          if (res.text?.trim()) additions.push(res.text.trim());
        } catch {
          additions.push(`(No se pudo analizar ${p.file.name})`);
        }
      }
      if (additions.length > 0) {
        setDescription(prev => {
          const block = additions.join("\n\n");
          return prev.trim()
            ? `${prev.trim()}\n\n— Análisis IA de fotos —\n${block}`
            : `— Análisis IA de fotos —\n${block}`;
        });
      }
      setPendingPhotos(prev => prev.map(p => ({ ...p, analyzed: true })));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Error al analizar las fotos.");
    } finally { setAnalyzing(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analyzing, pendingPhotos, description, selectedAsset?.name, selectedAsset?.assetCode]);

  // Auto-select sole vessel (preserves prior behavior).
  useEffect(() => {
    if (vessels.length === 1 && vessels[0] && !vesselCode) setVesselCode(vessels[0].code);
  }, [vessels, vesselCode]);

  const handleImmediateActionClick = useCallback(async () => {
    if (loadingImmediate) return;
    if (!description.trim()) { setErr("Completá la descripción antes de pedir la sugerencia."); return; }
    setLoadingImmediate(true);
    setImmediateAction("Analizando...");
    setErr(null);
    try {
      const res = await api.post<{ text: string }>("/app/pms/defects/suggest-immediate-action", {
        description,
        severity,
        operationalState,
        assetLabel: selectedAsset?.name ?? selectedAsset?.assetCode ?? null,
        vesselCode: vesselCode || null,
      });
      setImmediateAction(res.text || "");
    } catch (e) {
      setImmediateAction("");
      setErr(e instanceof ApiError ? e.message : "No se pudo generar la sugerencia.");
    } finally { setLoadingImmediate(false); }
  }, [loadingImmediate, description, severity, operationalState, selectedAsset, vesselCode]);

  useCopilotEmitter({
    module: "DEFECTS",
    screen: "DEFECT_CREATE",
    vesselCode: vesselCode || undefined,
    canEdit: true,
    fieldValues: {
      vesselCode: vesselCode || null,
      assetCode: selectedAsset?.assetCode ?? null,
      assetName: selectedAsset?.name ?? null,
      classification: classification || null,
      description: description || null,
      severity,
      operationalState,
      immediateAction: immediateAction || null,
    },
    relatedEntities: { assetId: assetId || null },
  });

  useEffect(() => {
    if (!vesselCode) { setAssets([]); setAssetId(""); return; }
    setLoadingAssets(true);
    setAssetId("");
    api.get<{ items: { id: string; assetCode: string; name: string | null }[] }>(
      `/app/pms/assets?vesselCode=${encodeURIComponent(vesselCode)}&limit=200`
    )
      .then(r => setAssets(r.items ?? []))
      .catch(() => setAssets([]))
      .finally(() => setLoadingAssets(false));
  }, [vesselCode]);

  // Re-aplica el equipo del prefill una vez cargados los assets del buque
  // (el efecto de cambio de buque resetea assetId a "").
  const prefillAssetAppliedRef = React.useRef(false);
  useEffect(() => {
    if (!prefill?.assetId || prefillAssetAppliedRef.current) return;
    if (!assets.some(a => a.id === prefill.assetId)) return;
    prefillAssetAppliedRef.current = true;
    setAssetId(prefill.assetId);
  }, [assets, prefill?.assetId]);

  // Auto-IA (alta desde OT correctiva): redacta la descripción a partir del
  // detalle del técnico y luego clasifica la severidad. Best-effort: si algo
  // falla, queda el detalle crudo como descripción y la severidad por defecto.
  const autoAiRanRef = React.useRef(false);
  useEffect(() => {
    if (!prefill?.detail || autoAiRanRef.current) return;
    autoAiRanRef.current = true;
    void (async () => {
      setAiAutoLoading(true);
      const assetLabel = prefill.assetName ?? null;
      let desc = (prefill.detail ?? "").trim();
      try {
        const d = await api.post<{ text: string }>("/app/pms/defects/suggest-description", {
          detail: prefill.detail, assetLabel, taskContext: prefill.taskContext ?? null,
        });
        if (d.text?.trim()) desc = d.text.trim();
      } catch { /* best-effort */ }
      setDescription(desc);
      try {
        const c = await api.post<ClassifySuggestion>("/app/pms/defects/suggest-classification", {
          description: desc, assetLabel, operationalState,
        });
        setSeverity(c.severity);
        setClassification(c.classification);
      } catch { /* best-effort */ }
      setAiAutoLoading(false);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vesselCode)           { setErr(t("error.vesselRequired")); return; }
    if (!assetId)              { setErr(t("error.assetRequired")); return; }
    if (!classification.trim()) { setErr(t("error.classificationRequired")); return; }
    if (!description.trim())   { setErr(t("error.descriptionRequired")); return; }
    setSaving(true); setErr(null);
    try {
      const defect = await api.post<Defect>("/app/pms/defects", {
        vesselCode,
        assetId,
        classification: classification.trim(),
        description: description.trim(),
        severity,
        operationalState,
        immediateAction: immediateAction.trim() || null,
        workOrderId: prefill?.workOrderId ?? null,
      });
      // Upload fotos pendientes después de crear el defecto. Si una falla,
      // sigue con el resto y reporta al final pero no bloquea el flujo.
      const failed: string[] = [];
      for (const p of pendingPhotos) {
        try { await uploadDefectPhoto(defect.id, p.file); }
        catch { failed.push(p.file.name); }
      }
      pendingPhotos.forEach(p => URL.revokeObjectURL(p.preview));
      if (failed.length > 0) {
        setErr(`Defecto creado, pero ${failed.length} foto(s) fallaron al subir: ${failed.join(", ")}`);
      }
      onCreated(defect);
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : "Error al crear el defecto.");
    } finally {
      setSaving(false);
    }
  };

  // ESC guard
  const isDirty = useDirtyTracker({
    vesselCode, assetId, classification, description, severity, operationalState, immediateAction,
  });
  useEscapeGuard({
    isDirty,
    onSave: () => handleSubmit({ preventDefault: () => {} } as React.FormEvent),
    onClose,
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className={`w-full bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl flex flex-col transition-all duration-200 ${expanded ? "w-full h-full" : "max-w-xl max-h-[90vh]"}`} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-fg/10 shrink-0">
          <h2 className="text-base font-bold text-fg">{t("def.newTitle")}</h2>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setExpanded(v => !v)} className="p-1.5 rounded-lg text-text-industrial/30 hover:text-fg hover:bg-fg/5 transition-colors" title={expanded ? "Reducir" : "Ampliar"}>
              {expanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
            <ModalCloseButton onClose={onClose} />
          </div>
        </div>
        <form onSubmit={e => { void handleSubmit(e); }} className="p-6 space-y-4 flex-1 overflow-y-auto">
          {prefill?.workOrderId && (
            <div className="flex items-center gap-2 text-xs rounded-xl px-3 py-2 bg-accent/10 border border-accent/20 text-accent">
              {aiAutoLoading
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" /> {t("def.fromWoAnalyzing")}</>
                : <><Sparkles className="w-3.5 h-3.5 shrink-0" /> {t("def.fromWoReady")}</>}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>{t("form.vessel")}</label>
              <select value={vesselCode} onChange={e => setVesselCode(e.target.value)} className={inputCls + " appearance-none"} required>
                <option value="">{t("asset.selectVessel")}</option>
                {vessels.map(v => (
                  <option key={v.code} value={v.code}>{v.code}{v.name ? ` — ${v.name}` : ""}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>{t("form.severity")}</label>
              <select value={severity} onChange={e => setSeverity(e.target.value)} className={inputCls + " appearance-none"}>
                {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <AssetLiveSearch
            assets={assets}
            loading={loadingAssets}
            disabled={!vesselCode}
            value={assetId}
            onChange={setAssetId}
          />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>{t("form.operationalState")}</label>
              <select value={operationalState} onChange={e => setOperationalState(e.target.value)} className={inputCls + " appearance-none"}>
                {OP_STATES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>{t("form.classification")}</label>
              <input value={classification} onChange={e => setClassification(e.target.value)} className={inputCls} placeholder={t("def.classificationPh")} />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className={labelCls + " mb-0"}>{t("form.description")}</label>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => { void handleSuggestClassification(); }}
                  disabled={loadingSuggestion || description.trim().length < 10}
                  title={description.trim().length < 10 ? "Escribí al menos 10 caracteres para sugerir clasificación" : "Sugerir clasificación + severidad con IA"}
                  className="flex items-center gap-1 px-2 py-1 rounded-md bg-accent/10 border border-accent/30 text-accent text-[10px] font-bold uppercase tracking-wider disabled:opacity-40 disabled:cursor-not-allowed hover:bg-accent/20"
                >
                  {loadingSuggestion ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                  IA
                </button>
                <MicButton onAppend={chunk => setDescription(prev => (prev.trim() ? prev + " " : "") + chunk)} />
              </div>
            </div>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={4} className={inputCls + " resize-y"} placeholder={t("def.descPh")} />
          </div>

          {/* ── Sugerencia IA ─────────────────────────────────────────────── */}
          {suggestion && (
            <div className="rounded-xl border border-accent/30 bg-accent/[0.05] p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-accent" />
                  <p className="text-[10px] font-bold uppercase tracking-widest text-accent">{t("def.aiSuggestion")} <span className="text-text-industrial/40 normal-case ml-1">· {t("def.aiConfidence")} {suggestion.confidence.toLowerCase()}</span></p>
                </div>
                <button type="button" onClick={() => setSuggestion(null)} className="text-text-industrial/40 hover:text-fg" title="Descartar"><X className="w-3.5 h-3.5" /></button>
              </div>
              {suggestion.shouldBeNearMiss ? (
                <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-2.5 text-xs text-yellow-200">
                  <p className="font-bold mb-1">💡 Esto podría ser un Near Miss, no un defecto</p>
                  <p className="text-yellow-100/80">{suggestion.nearMissReason ?? "El evento descrito no tiene daño material concreto — encaja mejor como observación de riesgo o near miss."}</p>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2 items-center">
                  <span className="text-[10px] text-text-industrial/60">{t("def.classLabel")}</span>
                  <span className="px-2 py-0.5 rounded-md bg-fg/10 text-fg text-xs font-bold">{suggestion.classification}</span>
                  <span className="text-[10px] text-text-industrial/60 ml-2">{t("def.sevLabel")}</span>
                  <span className="px-2 py-0.5 rounded-md bg-fg/10 text-fg text-xs font-bold">{suggestion.severity}</span>
                  <button type="button" onClick={applySuggestion} className="ml-auto px-2.5 py-1 rounded-lg bg-accent text-accent-fg text-[10px] font-bold uppercase tracking-wider">
                    Aplicar
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── Banner de posibles duplicados ─────────────────────────────── */}
          {similar.length > 0 && (
            <div className="rounded-xl border border-orange-500/30 bg-orange-500/[0.06] p-3 space-y-1.5">
              <div className="flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-orange-700 dark:text-orange-400" />
                <p className="text-[10px] font-bold uppercase tracking-widest text-orange-700 dark:text-orange-400">
                  {similar.length === 1 ? "Posible duplicado" : `${similar.length} posibles duplicados`}
                </p>
              </div>
              <p className="text-[10px] text-orange-200/80">{t("def.similarOpen")}</p>
              <ul className="space-y-1 mt-1">
                {similar.map(s => (
                  <li key={s.id} className="text-[11px] text-text-industrial/80 bg-fg/[0.04] border border-fg/10 rounded-md px-2 py-1 flex items-center gap-2">
                    <span className="font-mono text-orange-700 dark:text-orange-300/80 shrink-0">{s.defectCode}</span>
                    <span className="text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-fg/5 text-text-industrial/60 shrink-0">{s.status}</span>
                    <span className="text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-fg/5 text-text-industrial/60 shrink-0">{s.severity}</span>
                    <span className="truncate">{s.description}</span>
                    <span className="ml-auto text-[9px] text-text-industrial/40 shrink-0">{Math.round(s.similarity * 100)}%</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <label
              onClick={handleImmediateActionClick}
              title={!description.trim() ? "Completá la descripción primero" : "Sugerir con IA"}
              className={`flex items-center gap-1.5 text-[10px] font-bold text-accent uppercase tracking-widest mb-1.5 transition-colors ${description.trim() ? `cursor-pointer hover:text-fg ${loadingImmediate ? "opacity-60 animate-pulse" : ""}` : "opacity-50"}`}
            >
              {loadingImmediate ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              Acción inmediata
              {loadingImmediate && <span className="ml-1 text-[9px] normal-case font-normal">analizando…</span>}
            </label>
            <textarea value={immediateAction} onChange={e => setImmediateAction(e.target.value)} rows={3} disabled={loadingImmediate} className={inputCls + " resize-y"} placeholder={t("def.immediateActionPh")} />
          </div>

          {/* ── Fotos del defecto ─────────────────────────────────────────── */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className={labelCls + " mb-0"}>Fotos {pendingPhotos.length > 0 && `(${pendingPhotos.length})`}</p>
              <div className="flex items-center gap-2">
                {pendingPhotos.length > 0 && (
                  <button
                    type="button"
                    onClick={() => { void handleAnalyzePhotos(); }}
                    disabled={analyzing}
                    title="La IA analiza las fotos y agrega la descripción técnica al campo Descripción"
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-accent/10 border border-accent/30 text-accent text-[10px] font-bold uppercase tracking-wider hover:bg-accent/20 disabled:opacity-50"
                  >
                    {analyzing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                    {analyzing ? "Analizando…" : "Analizar con IA"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => photoInputRef.current?.click()}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-fg/5 border border-fg/10 text-text-industrial hover:border-accent/40 hover:text-fg text-[10px] font-bold uppercase tracking-wider"
                >
                  <Camera className="w-3 h-3" />
                  Cargar fotos
                </button>
                <input ref={photoInputRef} type="file" accept="image/*" multiple capture="environment" className="hidden" onChange={onPhotosSelected} />
              </div>
            </div>
            {pendingPhotos.length === 0 ? (
              <button
                type="button"
                onClick={() => photoInputRef.current?.click()}
                className="w-full border border-dashed border-fg/10 rounded-xl py-6 flex flex-col items-center gap-2 text-text-industrial/40 hover:text-fg hover:border-accent/40 transition-colors"
              >
                <Camera className="w-6 h-6" />
                <span className="text-xs">{t("def.noPhotos")}</span>
              </button>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                {pendingPhotos.map((p, i) => (
                  <div key={i} className={`relative aspect-square bg-fg/5 border rounded-lg overflow-hidden group ${p.analyzed ? "border-accent/40" : "border-fg/10"}`}>
                    <img src={p.preview} alt="" className="w-full h-full object-cover" />
                    {p.analyzed && (
                      <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-accent text-accent-fg text-[8px] font-bold uppercase tracking-wider flex items-center gap-0.5">
                        <Sparkles className="w-2.5 h-2.5" />IA
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => removePhoto(i)}
                      className="absolute top-1 right-1 p-1 rounded-full bg-black/60 text-fg/80 opacity-0 group-hover:opacity-100 hover:bg-red-500 hover:text-fg transition-all"
                      title="Quitar"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {err && <p className="text-xs text-red-700 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{err}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-fg transition-colors">Cancelar</button>
            <button type="submit" disabled={saving} className="px-4 py-2 rounded-xl bg-accent text-accent-fg font-bold text-xs hover:brightness-110 disabled:opacity-50 transition-all flex items-center gap-1.5">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              Crear defecto
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ─── DefectModal ──────────────────────────────────────────────────────────────

interface DefectModalProps {
  defect: Defect;
  onClose: () => void;
  onSaved: () => void;
  /** Refresca la lista de fondo sin cerrar el modal (ej. tras "Aprobar RCA"). */
  onReload: () => void;
}

const fldCls = "w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 disabled:opacity-60 transition-all";
const fldLabel = "block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider";

const DefectModal: React.FC<DefectModalProps> = ({ defect, onClose, onSaved, onReload }) => {
  const t = useT();
  const woTerms = useWoTerms();
  const navigate = useNavigate();
  const [description, setDescription]         = useState(defect.description ?? "");
  const [classification, setClassification]   = useState(defect.classification ?? "");
  const [severity, setSeverity]               = useState(defect.severity ?? "MEDIUM");
  const [operationalState, setOperationalState] = useState(defect.operationalState ?? "NORMAL");
  const [status, setStatus]                   = useState(defect.status ?? "OPEN");
  const [immediateAction, setImmediateAction] = useState(defect.immediateAction ?? "");
  const [correctiveAction, setCorrectiveAction] = useState(defect.correctiveAction ?? "");
  const [rcaAnalysis, setRcaAnalysis]         = useState(defect.rcaAnalysis ?? "");
  const [rcaMethodology, setRcaMethodology]   = useState<RcaMethodology | "">(defect.rcaMethodology ?? "");
  const [rcaImmediateCause, setRcaImmediateCause]       = useState(defect.rcaImmediateCause ?? "");
  const [rcaContributingCause, setRcaContributingCause] = useState(defect.rcaContributingCause ?? "");
  const [rcaRootCause, setRcaRootCause]                 = useState(defect.rcaRootCause ?? "");
  const [rcaPreventiveActions, setRcaPreventiveActions] = useState(defect.rcaPreventiveActions ?? "");
  const [rcaApprovedAt, setRcaApprovedAt]               = useState<string | null>(defect.rcaApprovedAt);
  const [repairType, setRepairType]           = useState<"TEMPORARIA" | "PERMANENTE" | null>(
    defect.repairType === "TEMPORARIA" || defect.repairType === "PERMANENTE" ? defect.repairType : null,
  );

  const [saving, setSaving]           = useState(false);
  const [closing, setClosing]         = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [expanded, setExpanded]       = useState(true);
  const [rcaAnalyzing, setRcaAnalyzing]       = useState(false);
  const [rcaAnalysisError, setRcaAnalysisError] = useState<string | null>(null);
  const [loadingImmediate, setLoadingImmediate] = useState(false);
  useAssetsCache(); // cache de nombres de assets para getAssetName en el handler

  // ── Fotos del defecto ──
  const [photos, setPhotos]                 = useState<DefectPhotoRecord[]>([]);
  const [photosLoading, setPhotosLoading]   = useState(false);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [analyzingPhotos, setAnalyzingPhotos] = useState(false);
  const [lightboxPhoto, setLightboxPhoto]   = useState<DefectPhotoRecord | null>(null);
  const photoInputRef = React.useRef<HTMLInputElement>(null);

  const reloadPhotos = useCallback(async () => {
    setPhotosLoading(true);
    try { setPhotos(await listDefectPhotos(defect.id)); }
    catch { /* silenciar — la lista vacía es válida */ }
    finally { setPhotosLoading(false); }
  }, [defect.id]);

  useEffect(() => { void reloadPhotos(); }, [reloadPhotos]);

  const onPhotosSelectedEdit = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    if (e.target) e.target.value = "";
    setUploadingPhotos(true);
    try {
      for (const f of files) { try { await uploadDefectPhoto(defect.id, f); } catch { /* ignore */ } }
      await reloadPhotos();
    } finally { setUploadingPhotos(false); }
  };

  const removePhotoEdit = async (photoId: string) => {
    if (!window.confirm(t("confirm.deletePhoto"))) return;
    try { await deleteDefectPhoto(photoId); await reloadPhotos(); }
    catch (e) { setActionError(e instanceof ApiError ? e.message : "Error al eliminar la foto."); }
  };

  /**
   * Analiza con IA las fotos ya subidas y concatena descripción técnica al campo
   * description. Carga la foto desde su URL, la pasa a base64 y la manda al
   * endpoint de visión. No es óptimo (ya está comprimida), pero útil para
   * defectos existentes.
   */
  const handleAnalyzeStoredPhotos = useCallback(async () => {
    if (analyzingPhotos || isClosed) return;
    if (photos.length === 0) { setActionError("No hay fotos para analizar."); return; }
    setAnalyzingPhotos(true);
    setActionError(null);
    try {
      const assetLabel = getAssetName(defect.assetId);
      const additions: string[] = [];
      for (const p of photos) {
        const url = p.description; // backend guarda la URL en description
        if (!url) continue;
        try {
          // Descargar la imagen y convertir a base64
          const resp = await fetch(url);
          const blob = await resp.blob();
          const file = new File([blob], p.filename, { type: blob.type || "image/jpeg" });
          const res = await analyzePhotoForDefect({ file, existingDescription: description, assetLabel });
          if (res.text?.trim()) additions.push(res.text.trim());
        } catch {
          additions.push(`(No se pudo analizar ${p.filename})`);
        }
      }
      if (additions.length > 0) {
        const block = additions.join("\n\n");
        setDescription(prev => prev.trim()
          ? `${prev.trim()}\n\n— Análisis IA de fotos —\n${block}`
          : `— Análisis IA de fotos —\n${block}`);
      }
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : "Error al analizar las fotos.");
    } finally { setAnalyzingPhotos(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analyzingPhotos, photos, description, defect.assetId]);

  const handleImmediateActionClick = useCallback(async () => {
    if (loadingImmediate || isClosed) return;
    if (!description.trim()) { setActionError("Completá la descripción antes de pedir la sugerencia."); return; }
    setLoadingImmediate(true);
    setImmediateAction("Analizando...");
    setActionError(null);
    try {
      const assetLabel = getAssetName(defect.assetId);
      const res = await api.post<{ text: string }>("/app/pms/defects/suggest-immediate-action", {
        description,
        severity,
        operationalState,
        assetLabel,
        vesselCode: defect.vesselCode,
      });
      setImmediateAction(res.text || "");
    } catch (e) {
      setImmediateAction(defect.immediateAction ?? "");
      setActionError(e instanceof ApiError ? e.message : "No se pudo generar la sugerencia.");
    } finally { setLoadingImmediate(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingImmediate, description, severity, operationalState, defect.assetId, defect.vesselCode, defect.immediateAction]);

  // Post-save flow state
  const [postSaveStep, setPostSaveStep] = useState<null | "ask-permanent-wo">(null);
  const [showCreateWo, setShowCreateWo] = useState(false);
  const [showMoc, setShowMoc] = useState(false);

  useEffect(() => {
    setDescription(defect.description ?? "");
    setClassification(defect.classification ?? "");
    setSeverity(defect.severity ?? "MEDIUM");
    setOperationalState(defect.operationalState ?? "NORMAL");
    setStatus(defect.status ?? "OPEN");
    setImmediateAction(defect.immediateAction ?? "");
    setCorrectiveAction(defect.correctiveAction ?? "");
    setRcaAnalysis(defect.rcaAnalysis ?? "");
    setRcaMethodology(defect.rcaMethodology ?? "");
    setRcaImmediateCause(defect.rcaImmediateCause ?? "");
    setRcaContributingCause(defect.rcaContributingCause ?? "");
    setRcaRootCause(defect.rcaRootCause ?? "");
    setRcaPreventiveActions(defect.rcaPreventiveActions ?? "");
    setRcaApprovedAt(defect.rcaApprovedAt);
    setRepairType(defect.repairType === "TEMPORARIA" || defect.repairType === "PERMANENTE" ? defect.repairType : null);
    setActionError(null);
    setPostSaveStep(null);
    setShowCreateWo(false);
  }, [defect]);

  const isClosed = defect.status === "CLOSED";
  const closeNotes = extractCloseNotes(defect.correctiveAction);

  useCopilotEmitter({
    module: "DEFECTS",
    screen: "DEFECT_EDIT",
    entityId: defect.id,
    entityCode: defect.defectCode,
    vesselCode: defect.vesselCode,
    workflowStage: defect.status,
    canEdit: !isClosed,
    fieldValues: {
      description:           description           || null,
      classification:        classification        || null,
      severity:              severity              || null,
      operationalState:      operationalState      || null,
      immediateAction:       immediateAction       || null,
      correctiveAction:      correctiveAction      || null,
      rcaAnalysis:           rcaAnalysis           || null,
      rcaMethodology:        rcaMethodology        || null,
      rcaImmediateCause:     rcaImmediateCause     || null,
      rcaContributingCause:  rcaContributingCause  || null,
      rcaRootCause:          rcaRootCause          || null,
      rcaPreventiveActions:  rcaPreventiveActions  || null,
    },
    relatedEntities: { workOrderId: defect.workOrderId, assetId: defect.assetId },
  });

  const analyzeRca = useCallback(async () => {
    if (rcaAnalyzing) return;
    setRcaAnalyzing(true);
    setRcaAnalysisError(null);

    const prompt = [
      `[MODO ANÁLISIS AUTOMÁTICO — No hagas preguntas previas. Procedé directamente al análisis completo y completá los campos faltantes del RCA con un bloque [CAMPOS].]`,
      ``,
      `Completá los campos faltantes del RCA para el defecto ${defect.defectCode} del buque ${defect.vesselCode}.`,
      ``,
      `Datos del defecto:`,
      `- Descripción: ${description || defect.description}`,
      `- Severidad: ${severity}`,
      `- Estado operacional: ${operationalState}`,
      immediateAction ? `- Acción inmediata: ${immediateAction}` : null,
      ``,
      `Instrucciones:`,
      `1. Consultá query_defects (assetId: "${defect.assetId}") y query_work_orders para identificar patrones o fallas recurrentes en este equipo.`,
      `2. Elegí la metodología más adecuada: FIVE_WHYS, FISHBONE, FTA o BARRIER_ANALYSIS.`,
      `3. Identificá causa inmediata, causa contribuyente y causa raíz.`,
      `4. Proponé acciones preventivas concretas.`,
      `5. Devolvé TODO en un único bloque [CAMPOS]{"rcaMethodology":"...","rcaAnalysis":"...","rcaImmediateCause":"...","rcaContributingCause":"...","rcaRootCause":"...","rcaPreventiveActions":"..."}[/CAMPOS]`,
    ].filter(Boolean).join("\n");

    try {
      const reader = await api.stream("/app/copiloto/chat", {
        capability: "defect_assistant",
        locale: navigator.language?.split("-")[0] ?? "es",
        messages: [{ role: "user", content: prompt }],
        // El RCA se apoya en las query_* (defectos/OTs), no en los manuales del
        // tenant. Saltear la base documental aligera el prompt y acelera bastante.
        includeKnowledgeDocs: false,
        screenContext: {
          module: "DEFECTS",
          screen: "DEFECT_EDIT",
          entityId: defect.id,
          entityCode: defect.defectCode,
          vesselCode: defect.vesselCode,
          fieldValues: {
            description: description || null,
            severity,
            operationalState,
            immediateAction: immediateAction || null,
          },
          relatedEntities: { assetId: defect.assetId },
        },
      });

      let fullResponse = "";
      outer: while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const line of value.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") break outer;
          try {
            const parsed = JSON.parse(data) as { text?: string; error?: string };
            if (parsed.error) { setRcaAnalysisError(parsed.error); break outer; }
            if (parsed.text) fullResponse += parsed.text;
          } catch { /* partial SSE chunk */ }
        }
      }

      const match = fullResponse.match(/\[CAMPOS\]([\s\S]*?)\[\/CAMPOS\]/);
      if (match) {
        try {
          const fields = JSON.parse(match[1].trim()) as Record<string, string>;
          if (fields.rcaMethodology && ["FIVE_WHYS", "FISHBONE", "FTA", "BARRIER_ANALYSIS"].includes(fields.rcaMethodology)) {
            setRcaMethodology(fields.rcaMethodology as RcaMethodology);
          }
          if (fields.rcaAnalysis)          setRcaAnalysis(fields.rcaAnalysis);
          if (fields.rcaImmediateCause)    setRcaImmediateCause(fields.rcaImmediateCause);
          if (fields.rcaContributingCause) setRcaContributingCause(fields.rcaContributingCause);
          if (fields.rcaRootCause)         setRcaRootCause(fields.rcaRootCause);
          if (fields.rcaPreventiveActions) setRcaPreventiveActions(fields.rcaPreventiveActions);
        } catch {
          setRcaAnalysisError(t("common.saveError"));
        }
      } else {
        setRcaAnalysisError(t("error.aiNoAnalysis"));
      }
    } catch (e: any) {
      setRcaAnalysisError(e?.message ?? "Error al conectar con el copiloto.");
    } finally {
      setRcaAnalyzing(false);
    }
  }, [defect, description, severity, operationalState, immediateAction, rcaAnalyzing]);

  useCopilotApplyFields(!isClosed ? (fields) => {
    if (fields.description          !== undefined) setDescription(fields.description);
    if (fields.classification       !== undefined) setClassification(fields.classification);
    if (fields.immediateAction      !== undefined) setImmediateAction(fields.immediateAction);
    if (fields.correctiveAction     !== undefined) setCorrectiveAction(fields.correctiveAction);
    if (fields.rcaAnalysis          !== undefined) setRcaAnalysis(fields.rcaAnalysis);
    if (fields.rcaMethodology       !== undefined && (["FIVE_WHYS", "FISHBONE", "FTA", "BARRIER_ANALYSIS", ""].includes(fields.rcaMethodology))) setRcaMethodology(fields.rcaMethodology as RcaMethodology | "");
    if (fields.rcaImmediateCause    !== undefined) setRcaImmediateCause(fields.rcaImmediateCause);
    if (fields.rcaContributingCause !== undefined) setRcaContributingCause(fields.rcaContributingCause);
    if (fields.rcaRootCause         !== undefined) setRcaRootCause(fields.rcaRootCause);
    if (fields.rcaPreventiveActions !== undefined) setRcaPreventiveActions(fields.rcaPreventiveActions);
  } : null);

  const patchDefect = useCallback(async (extra?: Record<string, unknown>) => {
    if (!description.trim()) { setActionError(t("error.briefDescRequired")); return false; }
    if (!classification.trim()) { setActionError(t("def.classification")); return false; }
    setSaving(true); setActionError(null);
    try {
      await api.patch(`/app/pms/defects/${defect.id}`, {
        description: description.trim(),
        severity,
        operationalState,
        classification: classification.trim(),
        immediateAction: normalizeOptionalText(immediateAction),
        correctiveAction: normalizeOptionalText(correctiveAction),
        rcaAnalysis: normalizeOptionalText(rcaAnalysis),
        rcaMethodology: rcaMethodology || null,
        rcaImmediateCause: normalizeOptionalText(rcaImmediateCause),
        rcaContributingCause: normalizeOptionalText(rcaContributingCause),
        rcaRootCause: normalizeOptionalText(rcaRootCause),
        rcaPreventiveActions: normalizeOptionalText(rcaPreventiveActions),
        repairType: repairType ?? null,
        status,
        ...extra,
      });
      return true;
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t("common.saveError"));
      return false;
    } finally {
      setSaving(false);
    }
  }, [classification, correctiveAction, defect.id, description, immediateAction, operationalState, rcaAnalysis, rcaMethodology, rcaImmediateCause, rcaContributingCause, rcaRootCause, rcaPreventiveActions, repairType, severity, status, t]);

  const closeDefectAndWo = useCallback(async () => {
    setClosing(true);
    try {
      // Backend requires RESOLVED before CLOSED
      if (defect.status !== "RESOLVED") {
        await api.patch(`/app/pms/defects/${defect.id}`, { status: "RESOLVED" });
      }
      if (defect.workOrderId) {
        await api.post(`/app/pms/work-orders/${defect.workOrderId}/close`, {
          woResult: "SATISFACTORY",
          observations: `Reparación permanente registrada en defecto ${defect.defectCode}`,
        }).catch(() => {}); // WO might already be closed — ignore
      }
      await api.post(`/app/pms/defects/${defect.id}/close`, {
        closeNotes: `Reparación permanente completada.`,
      });
      onSaved();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Error al cerrar el registro.");
    } finally {
      setClosing(false);
    }
  }, [defect.defectCode, defect.id, defect.status, defect.workOrderId, onSaved]);

  const handleSave = useCallback(async () => {
    if (!await patchDefect()) return;
    if (repairType === "PERMANENTE") {
      await closeDefectAndWo();
    } else if (repairType === "TEMPORARIA") {
      setPostSaveStep("ask-permanent-wo");
    } else {
      onSaved();
    }
  }, [closeDefectAndWo, onSaved, patchDefect, repairType]);

  // ESC guard: dirty si algun campo editable difiere del valor original del defect
  const isDirty = !isClosed && (
    description           !== (defect.description           ?? "") ||
    classification        !== (defect.classification        ?? "") ||
    severity              !== (defect.severity              ?? "MEDIUM") ||
    operationalState      !== (defect.operationalState      ?? "NORMAL") ||
    status                !== (defect.status                ?? "OPEN") ||
    immediateAction       !== (defect.immediateAction       ?? "") ||
    correctiveAction      !== (defect.correctiveAction      ?? "") ||
    rcaAnalysis           !== (defect.rcaAnalysis           ?? "") ||
    (rcaMethodology || null) !== (defect.rcaMethodology     ?? null) ||
    rcaImmediateCause     !== (defect.rcaImmediateCause     ?? "") ||
    rcaContributingCause  !== (defect.rcaContributingCause  ?? "") ||
    rcaRootCause          !== (defect.rcaRootCause          ?? "") ||
    rcaPreventiveActions  !== (defect.rcaPreventiveActions  ?? "") ||
    repairType            !== (defect.repairType === "TEMPORARIA" || defect.repairType === "PERMANENTE" ? defect.repairType : null)
  );
  useEscapeGuard({ isDirty, onSave: handleSave, onClose });

  // "ask-permanent-wo" screen
  if (postSaveStep === "ask-permanent-wo") {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
        <div className="w-full max-w-md bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between px-6 py-4 border-b border-fg/10">
            <h2 className="text-base font-bold text-fg">{t("def.tempRepairTitle")}</h2>
            <ModalCloseButton onClose={onClose} />
          </div>
          <div className="p-6 space-y-3">
            <p className="text-sm text-fg/80">{t("def.tempRepairAsk")}</p>
            <p className="text-xs text-text-industrial/40">{t("def.tempRepairHint")}</p>
            {actionError && <p className="text-xs text-red-700 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{actionError}</p>}
          </div>
          <div className="flex justify-end gap-2 px-6 py-4 border-t border-fg/10">
            <button onClick={onSaved} className="px-4 py-2 rounded-xl text-xs text-text-industrial/60 hover:text-fg transition-colors">
              No, mantener abierto
            </button>
            <button
              onClick={() => { setPostSaveStep(null); setShowCreateWo(true); }}
              className="px-4 py-2 rounded-xl bg-accent text-accent-fg font-bold text-xs hover:brightness-110 transition-all"
            >
              Sí, crear {woTerms.abbr} permanente
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (showCreateWo) {
    return (
      <CreateWorkOrderModal
        prefill={{
          source: "defect",
          sourceId: defect.id,
          sourceCode: defect.defectCode,
          sourceLabel: "Defecto",
          vesselCode: defect.vesselCode,
          assetId: defect.assetId,
          type: "CORRECTIVE",
          priority: defect.severity,
          description: defect.description,
        }}
        onClose={() => { setShowCreateWo(false); onClose(); }}
        onSaved={async (woId) => {
          // Link new WO to the defect, then close defect + original WO
          await api.patch(`/app/pms/defects/${defect.id}`, { workOrderId: woId });
          setShowCreateWo(false);
          await closeDefectAndWo();
        }}
      />
    );
  }

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
        <div className={`w-full bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl flex flex-col transition-all duration-200 ${expanded ? "w-full h-full" : "max-w-2xl max-h-[90vh]"}`} onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between px-6 py-4 border-b border-fg/10 shrink-0">
            <div>
              <h2 className="text-base font-bold text-fg">{t("page.defects")}</h2>
              <p className="text-[11px] text-text-industrial/50 flex items-center gap-1"><span className="font-mono">{defect.defectCode}</span> · <VesselLabel code={defect.vesselCode} className="text-[11px]" showCode /> · <AssetLabel id={defect.assetId} className="text-sm font-bold text-accent" /></p>
            </div>
            <div className="flex items-center gap-1.5">
              <CopyLinkButton />
              <button onClick={() => setExpanded(v => !v)} className="p-1.5 rounded-lg text-text-industrial/30 hover:text-fg hover:bg-fg/5 transition-colors" title={expanded ? "Reducir" : "Ampliar"}>
                {expanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              </button>
              <ModalCloseButton onClose={onClose} />
            </div>
          </div>

          <div className="p-6 space-y-4 flex-1 overflow-y-auto">
            {/* Meta info */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { label: t("def.reportedAt"), value: fmtDate(defect.reportedAt) },
                { label: t("col.status"),     value: defect.status },
                { label: t("col.severity"),   value: defect.severity },
                { label: t("def.operationalState"), value: defect.operationalState },
              ].map(({ label, value }) => (
                <div key={label} className="bg-fg/5 border border-fg/10 rounded-xl px-3 py-2">
                  <p className="text-[9px] uppercase tracking-wider text-text-industrial/40 mb-0.5">{label}</p>
                  <p className="text-xs font-bold text-fg truncate">{value}</p>
                </div>
              ))}
            </div>

            {/* Banner OT RESOLUTORA — solo cuando workOrderId representa la OT que resolvió
                el defecto. Si el origen es una OT (WORK_ORDER_FINDING), workOrderId ES la OT
                de origen (no se puede crear correctiva: el botón queda deshabilitado), así que
                NO se muestra acá para no confundirla con una resolutora — ya la muestra el
                badge de Origen. */}
            {defectOriginKey(defect.classification) !== "wo" && (defect.status === "RESOLVED" || defect.status === "CLOSED") && defect.workOrderCode && (
              <button
                type="button"
                onClick={() => navigate(`/work-orders?autoCode=${defect.workOrderCode}`)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-success-sea/5 border border-success-sea/30 hover:bg-success-sea/15 transition-colors text-left group"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[10px] uppercase tracking-wider text-success-sea/70 font-bold">{t("def.resolvedViaWo")}</span>
                  <span className="font-mono font-bold text-success-sea text-xs">{defect.workOrderCode}</span>
                </div>
                <ExternalLink className="w-3.5 h-3.5 text-success-sea/60 group-hover:text-success-sea shrink-0" />
              </button>
            )}

            {isClosed && closeNotes && (
              <div className="rounded-xl border border-success-sea/20 bg-success-sea/10 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wider text-success-sea mb-1">{t("def.closeNotes")}</p>
                <p className="text-sm text-success-sea">{closeNotes}</p>
              </div>
            )}

            {/* Descripción breve */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className={fldLabel}>{t("form.briefDesc")}</label>
                {!isClosed && <MicButton onAppend={chunk => setDescription(prev => (prev.trim() ? prev + " " : "") + chunk)} />}
              </div>
              <textarea rows={2} value={description} onChange={e => setDescription(e.target.value)} disabled={isClosed} className={fldCls + " resize-y"} placeholder={t("def.briefDescPh")} />
            </div>

            {/* Clasificación + selects */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label className={fldLabel}>{t("def.classification")}</label>
                {defectOriginKey(defect.classification) === "wo" && defect.workOrderCode ? (
                  <button
                    type="button"
                    onClick={() => navigate(`/work-orders?autoCode=${defect.workOrderCode}`)}
                    title={t("def.origin.openWo")}
                    className="inline-flex items-center gap-1.5 group"
                  >
                    <OriginBadge classification={defect.classification} />
                    <span className="font-mono text-[10px] text-blue-700 dark:text-blue-400 group-hover:underline">{defect.workOrderCode}</span>
                    <ExternalLink className="w-3 h-3 text-blue-700 dark:text-blue-400/60 group-hover:text-blue-400 shrink-0" />
                  </button>
                ) : defectOriginKey(defect.classification) === "audit" && defect.auditId ? (
                  <button
                    type="button"
                    onClick={() => navigate(`/external-audits?auditId=${defect.auditId}`)}
                    title={t("def.origin.openAudit")}
                    className="inline-flex items-center gap-1.5 group"
                  >
                    <OriginBadge classification={defect.classification} />
                    {defect.auditCode && <span className="font-mono text-[10px] text-amber-700 dark:text-amber-400 group-hover:underline">{defect.auditCode}</span>}
                    <ExternalLink className="w-3 h-3 text-amber-700 dark:text-amber-400/60 group-hover:text-amber-400 shrink-0" />
                  </button>
                ) : (
                  <OriginBadge classification={defect.classification} />
                )}
              </div>
              <input value={classification} onChange={e => setClassification(e.target.value)} disabled={isClosed} className={fldCls} />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <label className={fldLabel}>{t("col.severity")}</label>
                <select value={severity} onChange={e => setSeverity(e.target.value)} disabled={isClosed} className={fldCls}>
                  {["LOW","MEDIUM","HIGH","CRITICAL"].map(v => <option key={v}>{v}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className={fldLabel}>{t("def.operationalState")}</label>
                <select value={operationalState} onChange={e => setOperationalState(e.target.value)} disabled={isClosed} className={fldCls}>
                  {["NORMAL","DEGRADED","RESTRICTED","NO_GO"].map(v => <option key={v}>{v}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className={fldLabel}>{t("col.status")}</label>
                <select value={status} onChange={e => setStatus(e.target.value)} disabled={isClosed} className={fldCls}>
                  {["OPEN","UNDER_REVIEW","IN_PROGRESS","DEFERRED","RESOLVED"].map(v => <option key={v}>{v}</option>)}
                </select>
              </div>
            </div>

            {/* Acción inmediata */}
            <div className="space-y-1.5">
              <label
                onClick={!isClosed ? handleImmediateActionClick : undefined}
                title={!description.trim() ? "Completá la descripción primero" : isClosed ? undefined : "Sugerir con IA"}
                className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider transition-colors ${isClosed ? "text-text-industrial/60" : `text-accent ${description.trim() ? `cursor-pointer hover:text-fg ${loadingImmediate ? "opacity-60 animate-pulse" : ""}` : "opacity-50"}`}`}
              >
                {!isClosed && (loadingImmediate ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />)}
                {t("def.immediateAction")}
                {loadingImmediate && <span className="ml-1 text-[9px] normal-case font-normal">analizando…</span>}
              </label>
              <textarea rows={3} value={immediateAction} onChange={e => setImmediateAction(e.target.value)} disabled={isClosed || loadingImmediate} className={fldCls + " resize-y"} placeholder={t("def.immediateActionPh")} />
            </div>

            {/* Fotos del defecto */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <p className={fldLabel}>Fotos {photos.length > 0 && `(${photos.length})`}</p>
                <div className="flex items-center gap-2">
                  {photos.length > 0 && (
                    <button
                      type="button"
                      onClick={() => { void handleAnalyzeStoredPhotos(); }}
                      disabled={analyzingPhotos || isClosed}
                      title="La IA analiza las fotos y agrega descripción técnica al campo Descripción"
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-accent/10 border border-accent/30 text-accent text-[10px] font-bold uppercase tracking-wider hover:bg-accent/20 disabled:opacity-50"
                    >
                      {analyzingPhotos ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                      {analyzingPhotos ? "Analizando…" : "Analizar con IA"}
                    </button>
                  )}
                  {!isClosed && (
                    <button
                      type="button"
                      onClick={() => photoInputRef.current?.click()}
                      disabled={uploadingPhotos}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-fg/5 border border-fg/10 text-text-industrial hover:border-accent/40 hover:text-fg text-[10px] font-bold uppercase tracking-wider disabled:opacity-50"
                    >
                      {uploadingPhotos ? <Loader2 className="w-3 h-3 animate-spin" /> : <Camera className="w-3 h-3" />}
                      Agregar fotos
                    </button>
                  )}
                  <input ref={photoInputRef} type="file" accept="image/*" multiple capture="environment" className="hidden" onChange={(e) => { void onPhotosSelectedEdit(e); }} />
                </div>
              </div>
              {photosLoading ? (
                <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-accent" /></div>
              ) : photos.length === 0 ? (
                <p className="text-xs text-text-industrial/40 italic text-center py-3">{t("def.noPhotosShort")} {!isClosed && t("def.clickAddPhotos")}</p>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                  {photos.map(p => (
                    <div key={p.id} className="relative aspect-square bg-fg/5 border border-fg/10 rounded-lg overflow-hidden group">
                      {p.description && (
                        <button type="button" onClick={() => setLightboxPhoto(p)} className="w-full h-full">
                          <AuthedImage src={p.description} alt={p.filename} className="w-full h-full object-cover" />
                        </button>
                      )}
                      {!isClosed && (
                        <button
                          type="button"
                          onClick={() => { void removePhotoEdit(p.id); }}
                          className="absolute top-1 right-1 p-1 rounded-full bg-black/60 text-fg/80 opacity-0 group-hover:opacity-100 hover:bg-red-500 hover:text-fg transition-all"
                          title="Eliminar"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Análisis RCA estructurado */}
            <div className="rounded-xl border border-fg/10 bg-fg/2 p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-bold text-text-industrial/80 uppercase tracking-wider">{t("def.rcaTitle")}</p>
                <div className="flex items-center gap-2">
                  {rcaApprovedAt && (
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/40">
                      {t("def.rcaApproved")} · {fmtDate(rcaApprovedAt)}
                    </span>
                  )}
                  {!isClosed && (
                    <button
                      type="button"
                      onClick={() => { void analyzeRca(); }}
                      disabled={rcaAnalyzing}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-accent/10 text-accent border border-accent/30 text-[10px] font-bold hover:bg-accent/20 disabled:opacity-50 transition-colors"
                    >
                      {rcaAnalyzing
                        ? <Loader2 className="w-3 h-3 animate-spin" />
                        : <Bot className="w-3 h-3" />}
                      {rcaAnalyzing ? "Analizando…" : "Analizar con IA"}
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className={fldLabel}>{t("def.rcaMethodology")}</label>
                  <select value={rcaMethodology} onChange={e => setRcaMethodology(e.target.value as RcaMethodology | "")} disabled={isClosed} className={fldCls}>
                    <option value="">—</option>
                    <option value="FIVE_WHYS">{t("def.method.fiveWhys")}</option>
                    <option value="FISHBONE">{t("def.method.fishbone")}</option>
                    <option value="FTA">{t("def.method.fta")}</option>
                    <option value="BARRIER_ANALYSIS">{t("def.method.barrierAnalysis")}</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className={fldLabel}>{t("def.rcaSummary")}</label>
                <RichTextArea rows={2} value={rcaAnalysis} onChange={setRcaAnalysis} disabled={isClosed} className={fldCls} placeholder={t("def.rcaSummaryPh")} />
              </div>

              <div className="space-y-1.5">
                <label className={fldLabel}>{t("def.rcaImmediateCause")}</label>
                <RichTextArea rows={2} value={rcaImmediateCause} onChange={setRcaImmediateCause} disabled={isClosed} className={fldCls} placeholder={t("def.rcaImmediatePh")} />
              </div>

              <div className="space-y-1.5">
                <label className={fldLabel}>{t("def.rcaContributingCause")}</label>
                <RichTextArea rows={2} value={rcaContributingCause} onChange={setRcaContributingCause} disabled={isClosed} className={fldCls} placeholder={t("def.rcaContributingPh")} />
              </div>

              <div className="space-y-1.5">
                <label className={fldLabel}>{t("def.rcaRootCause")}</label>
                <RichTextArea rows={2} value={rcaRootCause} onChange={setRcaRootCause} disabled={isClosed} className={fldCls} placeholder={t("def.rcaRootPh")} />
              </div>

              <div className="space-y-1.5">
                <label className={fldLabel}>{t("def.rcaPreventiveActions")}</label>
                <RichTextArea rows={2} value={rcaPreventiveActions} onChange={setRcaPreventiveActions} disabled={isClosed} className={fldCls} placeholder={t("def.rcaPreventivePh")} />
              </div>

              {!isClosed && !rcaApprovedAt && rcaRootCause.trim() && (
                <button
                  type="button"
                  onClick={async () => {
                    const now = new Date().toISOString();
                    // Guarda TODOS los campos del formulario (no solo RCA) — mismo patchDefect
                    // que usa "Guardar" — y no cierra el modal (a diferencia de handleSave).
                    if (!await patchDefect({ rcaApprovedAt: now })) return;
                    setRcaApprovedAt(now);
                    onReload();
                  }}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/40 hover:bg-emerald-500/25 transition-colors"
                >
                  {t("def.rcaApprove")}
                </button>
              )}
            </div>

            {rcaAnalysisError && (
              <p className="text-xs text-red-700 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{rcaAnalysisError}</p>
            )}

            {/* Tipo de reparación — último campo */}
            {!isClosed && (
              <div className="rounded-xl border border-fg/10 bg-fg/2 p-4 space-y-3">
                <p className="text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">¿La acción fue una corrección temporaria o permanente?</p>
                <div className="flex gap-2">
                  {(["TEMPORARIA", "PERMANENTE"] as const).map(rt => (
                    <button
                      key={rt}
                      type="button"
                      onClick={() => setRepairType(prev => prev === rt ? null : rt)}
                      className={`flex-1 py-2.5 rounded-xl border text-xs font-bold transition-all ${
                        repairType === rt
                          ? rt === "PERMANENTE"
                            ? "bg-emerald-500/15 border-emerald-500/50 text-emerald-700 dark:text-emerald-400"
                            : "bg-yellow-500/15 border-yellow-500/50 text-yellow-700 dark:text-yellow-400"
                          : "bg-fg/5 border-fg/10 text-text-industrial/50 hover:border-fg/20 hover:text-fg"
                      }`}
                    >
                      {rt === "TEMPORARIA" ? "⚠ Temporaria" : "✓ Permanente"}
                    </button>
                  ))}
                </div>
                {repairType === "PERMANENTE" && (
                  <p className="text-[11px] text-emerald-700 dark:text-emerald-400/70">{t("def.saveWillCloseWo")}</p>
                )}
                {repairType === "TEMPORARIA" && (
                  <p className="text-[11px] text-yellow-700 dark:text-yellow-400/70">{t("def.saveWillAskWo")}</p>
                )}
              </div>
            )}

            {actionError && <p className="text-xs text-red-700 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{actionError}</p>}
          </div>

          <div className="flex justify-between gap-2 px-6 py-4 border-t border-fg/10">
            <div className="flex items-center gap-2">
              <button onClick={() => { void downloadDefectPdf(defect); }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-fg/5 border border-fg/10 text-xs text-text-industrial hover:border-accent/30 transition-all">
                <Download className="w-3.5 h-3.5" /> PDF
              </button>
              {!isClosed && (
                <button onClick={() => setShowCreateWo(true)} disabled={!!defect.workOrderId}
                  title={defect.workOrderId ? `Ya tiene una ${woTerms.abbr} asociada` : undefined}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-fg/5 border border-fg/10 text-xs text-text-industrial hover:border-accent/30 disabled:opacity-40 disabled:cursor-not-allowed transition-all">
                  Crear {woTerms.abbr} Correctiva
                </button>
              )}
              {/* Abrir MOC: defectos CRITICAL o con status DEFERRED suelen
                * implicar operación con redundancia degradada o bypass →
                * amerita MOC TEMPORARY formal para auditoría. */}
              {!isClosed && (severity === "CRITICAL" || status === "DEFERRED") && (
                <button
                  onClick={() => setShowMoc(true)}
                  title="Documentar el cambio operacional con un MOC formal"
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-fg/5 border border-fg/10 text-xs text-text-industrial hover:border-accent/30 transition-all"
                >
                  <GitBranch className="w-3.5 h-3.5" /> Abrir MOC
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-fg transition-colors">{t("common.cancel")}</button>
              {!isClosed && (
                <button onClick={() => { void handleSave(); }} disabled={saving || closing}
                  className={`px-4 py-2 rounded-xl font-bold text-xs hover:brightness-110 disabled:opacity-50 transition-all ${
                    repairType === "PERMANENTE"
                      ? "bg-emerald-500/80 text-fg"
                      : "bg-accent text-accent-fg"
                  }`}>
                  {(saving || closing) ? <Loader2 className="w-4 h-4 animate-spin" />
                    : repairType === "PERMANENTE" ? "Guardar y cerrar"
                    : t("common.save")}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Abrir MOC desde el defecto: documenta el cambio operacional
        * mientras dura la condición degradada. */}
      {showMoc && (() => {
        const prefill: MocPrefill = {
          category: "TEMPORARY",
          vesselCode: defect.vesselCode,
          title: `Operación con defecto ${defect.defectCode} (${classification || "—"})`,
          reasonForChange: `Defecto severidad ${severity} reportado el ${fmtDate(defect.reportedAt)}: ${description.slice(0, 250)}${description.length > 250 ? "…" : ""}`,
          proposedChange: status === "DEFERRED"
            ? "Operación con el defecto postergado, manteniendo medidas de mitigación hasta resolución definitiva."
            : `Operación temporal con el equipo en estado ${operationalState}, hasta completar la acción correctiva.`,
          mitigationActions: [immediateAction, correctiveAction].filter(Boolean).join("\n\n"),
          relatedWorkOrderId: defect.workOrderId ?? undefined,
          sourceLabel: `Desde Defecto ${defect.defectCode} (severidad ${severity}, estado ${status}). El MOC documenta el modo de operación con el equipo degradado mientras dura la condición.`,
        };
        return (
          <MocModal
            moc={null}
            prefill={prefill}
            onClose={() => setShowMoc(false)}
            onSaved={() => { setShowMoc(false); }}
          />
        );
      })()}

      {/* Lightbox para ampliar fotos al click en el mosaico */}
      {lightboxPhoto && lightboxPhoto.description && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm" onClick={() => setLightboxPhoto(null)}>
          <ModalCloseButton onClose={() => setLightboxPhoto(null)} className="absolute top-4 right-4 z-10" />
          <div className="max-w-5xl max-h-full flex flex-col items-center gap-2" onClick={e => e.stopPropagation()}>
            <AuthedImage src={lightboxPhoto.description} alt={lightboxPhoto.filename} className="max-h-[85vh] rounded-lg object-contain" />
            <p className="text-[10px] text-fg/40">{lightboxPhoto.filename}  ·  {fmtDate(lightboxPhoto.uploadedAt)}</p>
          </div>
        </div>
      )}
    </>
  );
};

export const DefectsPage: React.FC = () => {
  const t = useT();
  const [searchParams, setSearchParams] = useSearchParams();
  const { code: linkCode, open: openLink, close: closeLink } = useDeepLink("/defects");
  const [editing, setEditing] = useState<Defect | null>(null);
  const [creating, setCreating] = useState(false);
  const [createPrefill, setCreatePrefill] = useState<DefectPrefill | undefined>(undefined);
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  useCopilotEmitter(!editing ? { module: "DEFECTS", screen: "DEFECT_LIST" } : null);

  // Alta de defecto pre-cargada desde el cierre de una OT correctiva.
  // El detalle viaja por router state (no por URL); se consume una sola vez.
  useEffect(() => {
    const fromWo = (location.state as { createDefectFromWo?: DefectPrefill } | null)?.createDefectFromWo;
    if (!fromWo) return;
    setCreatePrefill(fromWo);
    setCreating(true);
    navigate(location.pathname, { replace: true, state: null });
  }, [location, navigate]);

  const statusFilter = (searchParams.get("status") ?? "").trim();
  const severityFilter = (searchParams.get("severity") ?? "").trim();
  const vesselFilter = (searchParams.get("vesselCode") ?? "").trim();
  // Compat: `?defectId=` (por id) → resuelve el código y redirige a `/defects/:code`.
  const autoDefectId = searchParams.get("defectId");
  useEffect(() => {
    if (!autoDefectId) return;
    const params = new URLSearchParams(searchParams);
    params.delete("defectId");
    setSearchParams(params, { replace: true });
    api.get<Defect>(`/app/pms/defects/${autoDefectId}`)
      .then(d => openLink(d.defectCode))
      .catch(() => {});
  }, [autoDefectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const [vesselInput, setVesselInput] = useState(vesselFilter);

  useEffect(() => {
    setVesselInput(vesselFilter);
  }, [vesselFilter]);

  const updateFilters = useCallback((next: { status?: string; severity?: string; vesselCode?: string }) => {
    const params = new URLSearchParams(searchParams);
    const nextStatus = next.status !== undefined ? next.status : statusFilter;
    const nextSeverity = next.severity !== undefined ? next.severity : severityFilter;
    const nextVessel = next.vesselCode !== undefined ? next.vesselCode : vesselFilter;
    if (nextStatus) params.set("status", nextStatus); else params.delete("status");
    if (nextSeverity) params.set("severity", nextSeverity); else params.delete("severity");
    if (nextVessel) params.set("vesselCode", nextVessel); else params.delete("vesselCode");
    setSearchParams(params, { replace: true });
  }, [searchParams, setSearchParams, severityFilter, statusFilter, vesselFilter]);

  const path = useMemo(() => {
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    if (severityFilter) params.set("severity", severityFilter);
    if (vesselFilter) params.set("vesselCode", vesselFilter);
    const query = params.toString();
    return `/app/pms/defects${query ? `?${query}` : ""}`;
  }, [severityFilter, statusFilter, vesselFilter]);

  const { data, loading, error, reload } = useFetch<ListResponse>(path, [path]);

  const openDetail = useCallback(async (row: Defect) => {
    setDetailLoadingId(row.id);
    setDetailError(null);
    try {
      const detailed = await api.get<Defect>(`/app/pms/defects/${row.id}`);
      setEditing(detailed);
    } catch (err) {
      setEditing(row);
      setDetailError(err instanceof ApiError ? err.message : "No se pudo cargar el detalle del defecto.");
    } finally {
      setDetailLoadingId(null);
    }
  }, []);

  // Deep-link: la URL `/defects/:code` es la fuente de verdad del detalle.
  useEffect(() => {
    if (!linkCode) { if (editing) setEditing(null); return; }
    if (editing?.defectCode === linkCode) return;
    const inList = data?.items?.find(d => d.defectCode === linkCode);
    if (inList) { void openDetail(inList); return; }
    setDetailLoadingId("deeplink");
    api.get<{ items: Defect[] }>(`/app/pms/defects`)
      .then(r => {
        const m = r.items.find(d => d.defectCode === linkCode);
        if (m) return api.get<Defect>(`/app/pms/defects/${m.id}`).then(setEditing).catch(() => setEditing(m));
      })
      .catch(() => {})
      .finally(() => setDetailLoadingId(null));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkCode, data, editing]);

  const columns: Column<Defect>[] = useMemo(() => [
    {
      key: "defectCode",
      header: t("col.code"),
      render: row => <span className="font-mono font-bold text-fg text-xs">{row.defectCode}</span>,
    },
    {
      key: "classification",
      header: t("def.classification"),
      render: row => {
        const originKey = defectOriginKey(row.classification);
        const mainText = originKey === "manual"
          ? row.classification
          : t(`def.class.${originKey}` as Parameters<typeof t>[0]);
        return (
          <div className="space-y-0.5">
            <div className="flex items-center gap-1.5">
              <OriginBadge classification={row.classification} />
              <span className="font-medium text-fg line-clamp-1">{mainText}</span>
            </div>
            {row.description && (
              <div className="text-[11px] text-text-industrial/60 line-clamp-2">{row.description}</div>
            )}
          </div>
        );
      },
    },
    {
      key: "vesselCode",
      header: t("col.vessel"),
      render: row => <VesselLabel code={row.vesselCode} className="text-xs" showCode />,
    },
    {
      key: "severity",
      header: t("col.severity"),
      render: row => <PriorityBadge priority={row.severity} />,
    },
    {
      key: "operationalState",
      header: t("def.operationalState"),
      render: row => <OperationalStateBadge value={row.operationalState} />,
    },
    {
      key: "status",
      header: t("col.status"),
      render: row => <StatusBadge status={row.status} />,
    },
    {
      key: "reportedAt",
      header: t("def.reportedAt"),
      render: row => fmtDate(row.reportedAt),
    },
  ], [t]);

  return (
    <div className="space-y-5">
      <PageHeader icon={AlertTriangle} title={t("page.defects")} total={data?.total} onReload={reload}>
        <ExportExcelButton module="defects" />
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-accent/10 border border-accent/20 text-accent text-xs font-bold hover:bg-accent/20 transition-all"
        >
          <Plus className="w-3.5 h-3.5" /> Nuevo Defecto
        </button>
      </PageHeader>

      {detailLoadingId && <div className="flex items-center gap-2 text-xs text-text-industrial/60"><Loader2 className="w-4 h-4 animate-spin text-accent" />{t("def.loadingDetail")}</div>}
      {detailError && <p className="text-xs text-red-700 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{detailError}</p>}

      <DataTable columns={columns} data={data?.items ?? null} loading={loading} error={error} keyFn={row => row.id} emptyText={t("empty.defects")} onRowClick={row => openLink(row.defectCode)} />

      {creating && (
        <CreateDefectModal
          prefill={createPrefill}
          onClose={() => { setCreating(false); setCreatePrefill(undefined); }}
          onCreated={defect => { setCreating(false); setCreatePrefill(undefined); void reload(); openLink(defect.defectCode); }}
        />
      )}
      {editing && (
        <DefectModal
          defect={editing}
          onClose={() => closeLink()}
          onSaved={() => {
            closeLink();
            void reload();
          }}
          onReload={() => void reload()}
        />
      )}
    </div>
  );
};
