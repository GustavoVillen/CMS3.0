import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertOctagon, AlertTriangle, Ban, Bot, Camera, Check, CheckCircle2, CircleDot, ClipboardCheck, Clock, Download, Droplets, ExternalLink,
  GitBranch, Hammer, History, Link2, Loader2, Maximize2, Minimize2, MoreHorizontal, Pencil, Plus, RotateCcw, Save, Search, SearchCheck,
  ShieldQuestion, Ship, Sparkles, Trash2, Wrench, X,
} from "lucide-react";
import { GuideSection, GuideField, GuideNeedTag } from "../components/GuideKit";
import { MocModal, type MocPrefill } from "./Moc";
import { useFetch } from "../lib/hooks";
import { api, ApiError } from "../lib/api";
import { DataTable, type Column } from "../components/DataTable";
import { ModalCloseButton } from "../components/ModalCloseButton";
import { VesselLabel, AssetLabel, getAssetName, useAssetsCache } from "../components/EntityLabels";
import { analyzePhotoForDefect, uploadDefectPhoto, listDefectPhotos, deleteDefectPhoto, type DefectPhotoRecord } from "../lib/defect-photos";
import { MicButton } from "../components/MicButton";
import { AuthedImage } from "../lib/authed-media";
import { fmtDate, FILTER_ALL_VALUE, fromFilterSelectValue, toFilterSelectValue } from "../lib/utils";
import { PageHeader } from "../components/PageHeader";
import { ExportExcelButton } from "../components/ExportExcelButton";
import { useT, useWoTerms, type TranslationKey } from "../lib/i18n";
import { useDeepLink } from "../lib/deep-link";
import { CopyLinkButton } from "../components/CopyLinkButton";
import { useCopilotEmitter, useCopilotApplyFields } from "../lib/copilot-context";
import { CreateWorkOrderModal } from "../components/CreateWorkOrderModal";
import { useAuth } from "../lib/auth";
import { RichTextArea } from "../components/RichTextArea";
import { useEscapeGuard, useDirtyTracker } from "../lib/escape-guard";
import { useVesselContext } from "../lib/vessel-context";
import { useTmsaFilter, applyTmsaFilter, TmsaFilterBanner } from "../lib/tmsa-filter";
import { AutoTextArea } from "../components/AutoTextArea";
import { AlertDialog } from "../components/AlertDialog";
import { textMatches } from "../lib/text-search";

type RcaMethodology = "FIVE_WHYS" | "FISHBONE" | "FTA" | "BARRIER_ANALYSIS";

// Listas cerradas del formulario de edición. Las usan los desplegables y el
// copiloto (que sólo puede cargar uno de estos valores).
const DEFECT_SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
const DEFECT_OPERATIONAL_STATES = ["NORMAL", "DEGRADED", "RESTRICTED", "NO_GO"] as const;
// La severidad usa la misma escala que la prioridad de la OT.
const SEVERITY_LABEL_KEYS: Record<typeof DEFECT_SEVERITIES[number], TranslationKey> = {
  LOW: "priority.low", MEDIUM: "priority.medium", HIGH: "priority.high", CRITICAL: "priority.critical",
};
const OPERATIONAL_STATE_LABEL_KEYS: Record<typeof DEFECT_OPERATIONAL_STATES[number], TranslationKey> = {
  NORMAL: "def.opState.normal", DEGRADED: "def.opState.degraded", RESTRICTED: "def.opState.restricted", NO_GO: "def.opState.noGo",
};
const RCA_METHODOLOGY_OPTIONS: Array<{ value: RcaMethodology; labelKey: TranslationKey }> = [
  { value: "FIVE_WHYS",        labelKey: "def.method.fiveWhys" },
  { value: "FISHBONE",         labelKey: "def.method.fishbone" },
  { value: "FTA",              labelKey: "def.method.fta" },
  { value: "BARRIER_ANALYSIS", labelKey: "def.method.barrierAnalysis" },
];

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
  // ISM 10.2.3 — verificación de eficacia de la medida correctiva.
  effectivenessDueAt: string | null;
  effectivenessVerifiedAt: string | null;
  effectivenessOutcome: "EFFECTIVE" | "PARTIALLY_EFFECTIVE" | "INEFFECTIVE" | null;
  effectivenessNote: string | null;
  createdAt: string;
}

interface ListResponse {
  items: Defect[];
  total: number;
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


// ─── Verificación de eficacia (ISM 10.2.3) ────────────────────────────────────
// Al cerrar un defecto hay que decir CÓMO se comprobó que quedó resuelto. Son
// opciones tocables porque la carga la hace la tripulación a bordo: escribir un
// texto libre en un teléfono es la fricción que hace que nadie lo complete.

type CloseCheckKey = "tested" | "watch" | "chief" | "other";

const CLOSE_CHECK_OPTIONS: { key: CloseCheckKey; labelKey: TranslationKey }[] = [
  { key: "tested", labelKey: "def.verify.optionTested" },
  { key: "watch",  labelKey: "def.verify.optionWatch" },
  { key: "chief",  labelKey: "def.verify.optionChief" },
  { key: "other",  labelKey: "def.verify.optionOther" },
];

function effectivenessLabelKey(outcome: string | null): TranslationKey {
  if (outcome === "INEFFECTIVE") return "def.verify.ineffective";
  if (outcome === "PARTIALLY_EFFECTIVE") return "def.verify.partial";
  return "def.verify.effective";
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
        textMatches(a.assetCode, query.toLowerCase()) ||
        textMatches(a.name ?? "", query.toLowerCase())
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
  const requestClose = useEscapeGuard({
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
            <ModalCloseButton onClose={requestClose} />
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
            {/* Obligatorios: se resaltan mientras falten (preview V24). */}
            <GuideField id="def-new-vessel" missing={!vesselCode}>
              <label className={labelCls}>{t("form.vessel")}{!vesselCode && <GuideNeedTag label={t("mp.guide.missing")} />}</label>
              <select value={vesselCode} onChange={e => setVesselCode(e.target.value)} className={inputCls + " appearance-none"} required>
                <option value="">{t("asset.selectVessel")}</option>
                {vessels.map(v => (
                  <option key={v.code} value={v.code}>{v.name || v.code}</option>
                ))}
              </select>
            </GuideField>
            <div>
              <label className={labelCls}>{t("form.severity")}</label>
              <select value={severity} onChange={e => setSeverity(e.target.value)} className={inputCls + " appearance-none"}>
                {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <GuideField id="def-new-asset" missing={!assetId}>
            {!assetId && <GuideNeedTag label={t("mp.guide.missing")} />}
            <AssetLiveSearch
              assets={assets}
              loading={loadingAssets}
              disabled={!vesselCode}
              value={assetId}
              onChange={setAssetId}
            />
          </GuideField>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>{t("form.operationalState")}</label>
              <select value={operationalState} onChange={e => setOperationalState(e.target.value)} className={inputCls + " appearance-none"}>
                {OP_STATES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <GuideField id="def-new-class" missing={!classification.trim()}>
              <label className={labelCls}>{t("form.classification")}{!classification.trim() && <GuideNeedTag label={t("mp.guide.missing")} />}</label>
              <input value={classification} onChange={e => setClassification(e.target.value)} className={inputCls} placeholder={t("def.classificationPh")} />
            </GuideField>
          </div>
          <GuideField id="def-new-desc" missing={!description.trim()}>
            <div className="flex items-center justify-between mb-1.5">
              <label className={labelCls + " mb-0"}>{t("form.description")}{!description.trim() && <GuideNeedTag label={t("mp.guide.missing")} />}</label>
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
            <AutoTextArea value={description} onChange={e => setDescription(e.target.value)} rows={4} className={inputCls + " resize-y"} placeholder={t("def.descPh")} />
          </GuideField>

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
            <AutoTextArea value={immediateAction} onChange={e => setImmediateAction(e.target.value)} rows={3} disabled={loadingImmediate} className={inputCls + " resize-y"} placeholder={t("def.immediateActionPh")} />
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

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-fg transition-colors">Cancelar</button>
            <button type="submit" disabled={saving} className="px-4 py-2 rounded-xl bg-accent text-accent-fg font-bold text-xs hover:brightness-110 disabled:opacity-50 transition-all flex items-center gap-1.5">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              Crear defecto
              {!saving && [!vesselCode, !assetId, !classification.trim(), !description.trim()].some(Boolean) && (
                <span className="text-[10px] font-semibold opacity-85">{t("mp.guide.saveMissing").replace("{n}", String([!vesselCode, !assetId, !classification.trim(), !description.trim()].filter(Boolean).length))}</span>
              )}
            </button>
          </div>
        </form>
        {/* Fuera del <form>: el OK del aviso no debe enviar el formulario. */}
        {err && <AlertDialog message={err} onClose={() => setErr(null)} />}
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
  /** Acción pedida desde el botón de la fila del listado (V21). */
  initialAction?: "createWo" | "close" | null;
  /** "Volvió a fallar": el listado ofrece cargar la reincidencia como defecto nuevo. */
  onRecurrence?: (defect: Defect) => void;
}

const fldCls = "w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 disabled:opacity-60 transition-all";

const DefectModal: React.FC<DefectModalProps> = ({ defect, onClose, onSaved, onReload, initialAction, onRecurrence }) => {
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
  // ISM 10.2.3 — cómo se comprobó que el problema quedó resuelto. Es obligatorio
  // para cerrar: viaja como nota de cierre y arranca el reloj de los 30 días
  // para confirmar que no volvió.
  const [closeCheck, setCloseCheck]     = useState<CloseCheckKey | null>(null);
  const [closeCheckOther, setCloseCheckOther] = useState("");

  const [saving, setSaving]           = useState(false);
  const [closing, setClosing]         = useState(false);
  const [deleting, setDeleting]       = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // Eliminar un defecto es exclusivo del administrador: es destructivo y corta
  // la trazabilidad de la OT / auditoría que lo originó. Debe coincidir con
  // canDeleteDefect del backend, que valida igual.
  const { user } = useAuth();
  const isAdmin = user?.role === "TENANT_ADMIN";

  /**
   * Borra el defecto (lógico) y cierra el modal. Pide confirmación nombrando el
   * código, para que no se borre otro por error al tener varios abiertos.
   */
  const handleDelete = async () => {
    if (!window.confirm(t("confirm.deleteDefect").replace("{code}", defect.defectCode))) return;
    setDeleting(true);
    setActionError(null);
    try {
      await api.delete(`/app/pms/defects/${defect.id}`);
      onSaved();
      onClose();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : "No se pudo eliminar el defecto.");
    } finally {
      setDeleting(false);
    }
  };
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
      // correctiveAction no va: el formulario no lo muestra (ahí se guarda la
      // nota de cierre) y el copiloto lo estaría escribiendo a ciegas.
      rcaAnalysis:           rcaAnalysis           || null,
      rcaMethodology:        rcaMethodology        || null,
      rcaImmediateCause:     rcaImmediateCause     || null,
      rcaContributingCause:  rcaContributingCause  || null,
      rcaRootCause:          rcaRootCause          || null,
      rcaPreventiveActions:  rcaPreventiveActions  || null,
    },
    // Listas cerradas: el copiloto tiene que proponer uno de estos valores exactos.
    fieldOptions: {
      severity:         DEFECT_SEVERITIES.map(v => ({ value: v, label: t(SEVERITY_LABEL_KEYS[v]) })),
      operationalState: DEFECT_OPERATIONAL_STATES.map(v => ({ value: v, label: t(OPERATIONAL_STATE_LABEL_KEYS[v]) })),
      rcaMethodology:   RCA_METHODOLOGY_OPTIONS.map(o => ({ value: o.value, label: t(o.labelKey) })),
    },
    relatedEntities: { workOrderId: defect.workOrderId, assetId: defect.assetId },
  });

  const analyzeRca = useCallback(async () => {
    if (rcaAnalyzing) return;
    setRcaAnalyzing(true);
    setRcaAnalysisError(null);
    try {
      const fields = await api.post<{
        rcaMethodology: RcaMethodology;
        rcaAnalysis: string;
        rcaImmediateCause: string;
        rcaContributingCause: string;
        rcaRootCause: string;
        rcaPreventiveActions: string;
      }>("/app/pms/defects/suggest-rca", {
        defectId: defect.id,
        description: description || defect.description,
        severity,
        operationalState,
        immediateAction: immediateAction || null,
        correctiveAction: correctiveAction || null,
      });
      setRcaMethodology(fields.rcaMethodology);
      setRcaAnalysis(fields.rcaAnalysis);
      setRcaImmediateCause(fields.rcaImmediateCause);
      setRcaContributingCause(fields.rcaContributingCause);
      setRcaRootCause(fields.rcaRootCause);
      setRcaPreventiveActions(fields.rcaPreventiveActions);
    } catch (e) {
      setRcaAnalysisError(e instanceof ApiError ? e.message : "No se pudo generar el análisis RCA.");
    } finally {
      setRcaAnalyzing(false);
    }
  }, [defect.id, defect.description, description, severity, operationalState, immediateAction, correctiveAction, rcaAnalyzing]);

  useCopilotApplyFields(!isClosed ? (fields) => {
    if (fields.description          !== undefined) setDescription(fields.description);
    if (fields.classification       !== undefined) setClassification(fields.classification);
    if (fields.severity             !== undefined && (DEFECT_SEVERITIES as readonly string[]).includes(fields.severity)) setSeverity(fields.severity);
    if (fields.operationalState     !== undefined && (DEFECT_OPERATIONAL_STATES as readonly string[]).includes(fields.operationalState)) setOperationalState(fields.operationalState);
    if (fields.immediateAction      !== undefined) setImmediateAction(fields.immediateAction);
    if (fields.rcaAnalysis          !== undefined) setRcaAnalysis(fields.rcaAnalysis);
    if (fields.rcaMethodology       !== undefined && (["", ...RCA_METHODOLOGY_OPTIONS.map(o => o.value)] as string[]).includes(fields.rcaMethodology)) setRcaMethodology(fields.rcaMethodology as RcaMethodology | "");
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

  /**
   * Texto de la comprobación elegida al cerrar, o null si todavía no se eligió
   * (o se eligió "Otra" y no se escribió nada). El backend lo exige: es la
   * constancia de que alguien verificó el arreglo, no un comentario opcional.
   */
  const closeCheckText = useMemo(() => {
    if (!closeCheck) return null;
    if (closeCheck === "other") return closeCheckOther.trim() || null;
    const opt = CLOSE_CHECK_OPTIONS.find(o => o.key === closeCheck)!;
    return t(opt.labelKey);
  }, [closeCheck, closeCheckOther, t]);

  /**
   * `noteOverride` es para el camino "reparación temporaria + OT permanente":
   * ahí el defecto se cierra porque el trabajo definitivo sigue en la OT nueva,
   * no porque alguien haya comprobado el arreglo, así que la constancia de
   * cierre la escribe el sistema y no se le pide nada más al usuario.
   */
  const closeDefectAndWo = useCallback(async (noteOverride?: string) => {
    const note = noteOverride ?? closeCheckText;
    if (!note) { setActionError(t("def.verify.required")); return; }
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
      await api.post(`/app/pms/defects/${defect.id}/close`, { closeNotes: note });
      onSaved();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Error al cerrar el registro.");
    } finally {
      setClosing(false);
    }
  }, [closeCheckText, defect.defectCode, defect.id, defect.status, defect.workOrderId, onSaved, t]);

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
  // Se abre sólo por su ruta (/defects/:code), que ya es la marca de historial:
  // otra marca igual hacía que, con cambios sin guardar, cerrar reabriera el
  // diálogo sin fin. Mismo arreglo que Planes y OT.
  // Guardar desde el aviso de cambios sin guardar = guardar sin cerrar (V21).
  const requestClose = useEscapeGuard({ isDirty, onSave: async () => { if (await patchDefect()) onSaved(); }, onClose, skipHistory: true });

  // ── Vista guiada del defecto (preview V21) ──────────────────────────────────
  // Ventana "Cerrar el defecto": reparación permanente (con cómo se comprobó) o
  // temporaria (abre la OT definitiva). Reemplaza el bloque del final del form.
  const [closeDlg, setCloseDlg] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const initialActionDone = React.useRef(false);
  const originKey = defectOriginKey(defect.classification);
  // Con origen OT, workOrderId ES la OT de origen: no es la que repara.
  const repairWoCode = originKey !== "wo" ? defect.workOrderCode : null;
  const canCreateWo = !isClosed && !defect.workOrderId;

  /** Guardar sin cerrar (el cierre va por su ventana). */
  const saveOnly = useCallback(async () => {
    if (await patchDefect()) onSaved();
  }, [patchDefect, onSaved]);

  /** Cambio de etapa desde "Más acciones": se guarda enseguida con el resto del formulario. */
  const setStage = useCallback(async (next: string) => {
    setMoreOpen(false);
    setStatus(next);
    if (await patchDefect({ status: next })) onReload();
  }, [patchDefect, onReload]);

  /** Cerrar desde la ventana: permanente → guarda y cierra; temporaria → abre la OT definitiva. */
  const confirmClose = useCallback(async () => {
    if (repairType === "PERMANENTE") {
      if (!closeCheckText) { setActionError(t("def.verify.required")); return; }
      if (!await patchDefect({ repairType: "PERMANENTE" })) return;
      setCloseDlg(false);
      await closeDefectAndWo();
    } else if (repairType === "TEMPORARIA") {
      if (!await patchDefect({ repairType: "TEMPORARIA" })) return;
      setCloseDlg(false);
      setShowCreateWo(true);
    }
  }, [repairType, closeCheckText, patchDefect, closeDefectAndWo, t]);

  /** ISM 10.2.3 — confirmar desde el defecto si el arreglo sigue funcionando. */
  const verifyEffectiveness = useCallback(async (outcome: "EFFECTIVE" | "INEFFECTIVE") => {
    setVerifying(true);
    try {
      await api.post(`/app/pms/defects/${defect.id}/verify-effectiveness`, { outcome });
      onReload();
      if (outcome === "INEFFECTIVE") onRecurrence?.(defect);
      else onSaved();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t("def.verify.error"));
    } finally {
      setVerifying(false);
    }
  }, [defect, onReload, onRecurrence, onSaved, t]);

  // Acción pedida desde el listado ("Crear OT correctiva" / "Cerrar defecto").
  useEffect(() => {
    if (initialActionDone.current || !initialAction) return;
    initialActionDone.current = true;
    if (initialAction === "createWo" && canCreateWo) setShowCreateWo(true);
    if (initialAction === "close" && !isClosed) setCloseDlg(true);
  }, [initialAction, canCreateWo, isClosed]);


  // "ask-permanent-wo" screen
  if (postSaveStep === "ask-permanent-wo") {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
        <div className="w-full max-w-md bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between px-6 py-4 border-b border-fg/10">
            <h2 className="text-base font-bold text-fg">{t("def.tempRepairTitle")}</h2>
            <ModalCloseButton onClose={requestClose} />
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
          await closeDefectAndWo(t("def.verify.closedIntoWo"));
        }}
      />
    );
  }

  // Etapa del recorrido: Reportado → En reparación → Cerrado → Confirmado.
  const verifyDue = isClosed && !!defect.effectivenessDueAt && !defect.effectivenessVerifiedAt;
  const verifyDueNow = verifyDue && new Date(defect.effectivenessDueAt!).getTime() <= Date.now();
  const stepIdx = isClosed
    ? (defect.effectivenessVerifiedAt ? 4 : 3)
    : status === "RESOLVED" ? 2
    : (status === "IN_PROGRESS" || !!repairWoCode) ? 1 : 0;
  const reportedDays = Math.max(0, Math.floor((Date.now() - new Date(defect.reportedAt).getTime()) / 86_400_000));
  const rcaRecommended = !isClosed && (severity === "HIGH" || severity === "CRITICAL") && !rcaRootCause.trim();
  const btn = "inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all disabled:opacity-50";
  const aiPill = (onClick: () => void, loading: boolean, label: string, Icon: typeof Sparkles = Sparkles) => isClosed ? null : (
    <button type="button" onClick={onClick} disabled={loading}
      className="ml-auto inline-flex items-center gap-1 rounded-full border border-violet-500/35 bg-violet-500/[0.07] px-2 py-0.5 text-[10.5px] font-extrabold text-violet-700 dark:text-violet-300 hover:bg-violet-500/15 disabled:opacity-60">
      {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Icon className="w-3 h-3" />} {label}
    </button>
  );
  const fl = "flex items-center gap-1.5 text-xs font-semibold text-text-industrial/70 mb-1.5";

  // Recuadro "qué hacer ahora" según la etapa.
  const nextCard = (() => {
    const card = (tone: string, iconBox: string, Icon: typeof Sparkles, title: string, desc: string, actions: React.ReactNode) => (
      <div className={`flex flex-wrap items-center gap-3 rounded-2xl border-[1.5px] px-3.5 py-3 ${tone}`}>
        <span className={`w-10 h-10 rounded-xl flex items-center justify-center text-white shrink-0 ${iconBox}`}><Icon className="w-5 h-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-black text-fg">{title}</p>
          <p className="text-[12.5px] text-text-industrial/70">{desc}</p>
        </div>
        <div className="flex flex-wrap gap-2 ml-auto">{actions}</div>
      </div>
    );
    if (isClosed && defect.effectivenessVerifiedAt) {
      return card("border-emerald-500/40 bg-emerald-500/[0.08]", defect.effectivenessOutcome === "INEFFECTIVE" ? "bg-red-600" : "bg-emerald-500", CheckCircle2,
        `${t("def.guide.verified")}: ${t(effectivenessLabelKey(defect.effectivenessOutcome))}`,
        fmtDate(defect.effectivenessVerifiedAt) ?? "", null);
    }
    if (verifyDueNow) {
      return card("border-amber-400/60 bg-amber-500/[0.08]", "bg-amber-500", ShieldQuestion, t("def.guide.verifyTitle"), t("def.guide.verifyDesc"),
        user?.role !== "AUDITOR_READONLY" && (
          <>
            <button type="button" disabled={verifying} onClick={() => { void verifyEffectiveness("EFFECTIVE"); }} className={`${btn} bg-emerald-600 text-white hover:brightness-110`}>
              {verifying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} {t("def.verify.stillOk")}
            </button>
            <button type="button" disabled={verifying} onClick={() => { void verifyEffectiveness("INEFFECTIVE"); }} className={`${btn} border border-red-500/35 bg-surface text-red-700 dark:text-red-400 hover:bg-red-500/10`}>
              <RotateCcw className="w-3.5 h-3.5" /> {t("def.verify.failedAgain")}
            </button>
          </>
        ));
    }
    if (isClosed) {
      return card("border-emerald-500/40 bg-emerald-500/[0.08]", "bg-emerald-500", CheckCircle2, t("def.guide.closedTitle"),
        verifyDue ? `${t("def.verify.pendingUntil")} ${fmtDate(defect.effectivenessDueAt)}` : (closeNotes ?? ""), null);
    }
    const closeBtn = (primary: boolean) => (
      <button type="button" onClick={() => { setRepairType(prev => prev ?? "PERMANENTE"); setCloseDlg(true); }}
        className={`${btn} ${primary ? "bg-emerald-600 text-white hover:brightness-110" : "border border-fg/10 bg-surface text-fg hover:border-fg/25"}`}>
        <Check className="w-3.5 h-3.5" /> {primary ? t("def.guide.close") : t("def.guide.alreadyFixed")}
      </button>
    );
    if (repairWoCode && status !== "RESOLVED") {
      return card("border-blue-400/60 bg-blue-500/[0.07]", "bg-blue-600", Hammer,
        t("def.guide.workTitle").replace("{code}", repairWoCode), t("def.guide.workDesc"),
        <>
          <button type="button" onClick={() => navigate(`/work-orders?autoCode=${repairWoCode}`)} className={`${btn} border border-fg/10 bg-surface text-fg hover:border-fg/25`}>
            <ExternalLink className="w-3.5 h-3.5" /> {t("def.guide.goWo")}
          </button>
          {closeBtn(true)}
        </>);
    }
    if (status === "RESOLVED") {
      return card("border-emerald-500/40 bg-emerald-500/[0.07]", "bg-emerald-600", CheckCircle2, t("def.guide.resolvedTitle"), t("def.guide.resolvedDesc"), closeBtn(true));
    }
    return card(status === "DEFERRED" ? "border-yellow-500/50 bg-yellow-500/[0.08]" : "border-red-400/50 bg-red-500/[0.06]",
      status === "DEFERRED" ? "bg-yellow-600" : "bg-red-600", Wrench,
      status === "DEFERRED" ? t("def.guide.deferredTitle") : t("def.guide.openTitle"),
      canCreateWo ? t("def.guide.openDesc") : t("def.guide.openDescNoWo"),
      <>
        {canCreateWo && (
          <button type="button" onClick={() => setShowCreateWo(true)} className={`${btn} bg-accent text-accent-fg hover:brightness-110`}>
            <Wrench className="w-3.5 h-3.5" /> {t("def.guide.createWo").replace("{abbr}", woTerms.abbr)}
          </button>
        )}
        {closeBtn(false)}
      </>);
  })();

  const sevCls: Record<string, string> = {
    CRITICAL: "border-red-700 bg-red-700 text-white", HIGH: "border-orange-500 bg-orange-500/15 text-orange-700 dark:text-orange-300",
    MEDIUM: "border-yellow-500 bg-yellow-500/15 text-yellow-800 dark:text-yellow-300", LOW: "border-emerald-500 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  };
  const opCls: Record<string, string> = {
    NO_GO: "border-red-700 bg-red-700 text-white", RESTRICTED: "border-orange-500 bg-orange-500/15 text-orange-700 dark:text-orange-300",
    DEGRADED: "border-yellow-500 bg-yellow-500/15 text-yellow-800 dark:text-yellow-300", NORMAL: "border-emerald-500 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  };
  const labels = [t("def.step.reported"), t("def.step.repair"), t("def.step.closed"), t("def.step.confirmed")];

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
        <div className={`w-full bg-surface dark:bg-[#0D1B2A] border border-fg/10 border-t-4 border-t-red-600 rounded-2xl shadow-2xl flex flex-col overflow-hidden transition-all duration-200 ${expanded ? "w-full h-full" : "max-w-3xl max-h-[92vh]"}`} onClick={e => e.stopPropagation()}>
          {/* Encabezado: sobre qué equipo, qué pasó y lo que lo identifica */}
          <div className="flex items-start gap-3 px-4 sm:px-6 py-3 border-b border-fg/10 shrink-0">
            <span className="w-10 h-10 rounded-xl bg-red-500/10 text-red-700 dark:text-red-400 flex items-center justify-center shrink-0"><AlertTriangle className="w-5 h-5" /></span>
            <div className="min-w-0 flex-1">
              <p className="text-[10.5px] font-extrabold uppercase tracking-wider text-red-700 dark:text-red-400">
                {t("def.guide.kicker")} · {t(`def.origin.${originKey}` as TranslationKey)}
              </p>
              <h2 className="text-lg font-black text-fg leading-tight truncate"><AssetLabel id={defect.assetId} className="text-lg font-black text-fg" /></h2>
              {description.trim() && <p className="text-xs text-text-industrial/70 line-clamp-1">{description}</p>}
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className="rounded-full border border-fg/10 bg-fg/5 px-2 py-0.5 font-mono text-[11px] font-bold text-fg">{defect.defectCode}</span>
                {/* Nombre del buque, no el código. */}
                <span className="inline-flex items-center gap-1 rounded-full border border-fg/10 bg-fg/5 px-2 py-0.5 text-[11px] font-bold text-text-industrial/70"><Ship className="w-3 h-3" /><VesselLabel code={defect.vesselCode} className="text-[11px]" /></span>
                <span className={`rounded-full border px-2 py-0.5 text-[11px] font-extrabold ${sevCls[severity] ?? ""}`}>{t(SEVERITY_LABEL_KEYS[severity as typeof DEFECT_SEVERITIES[number]] ?? "priority.medium")}</span>
                <span className={`rounded-full border px-2 py-0.5 text-[11px] font-extrabold ${opCls[operationalState] ?? ""}`}>{t(`def.op.${operationalState}` as TranslationKey)}</span>
                {originKey === "wo" && defect.workOrderCode && (
                  <button type="button" onClick={() => navigate(`/work-orders?autoCode=${defect.workOrderCode}`)} title={t("def.origin.openWo")}
                    className="inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent/5 px-2 py-0.5 font-mono text-[11px] font-bold text-accent hover:bg-accent/15">
                    <Wrench className="w-3 h-3" /> {defect.workOrderCode} · {t("def.guide.generatedIt")}
                  </button>
                )}
                {originKey === "audit" && defect.auditId && (
                  <button type="button" onClick={() => navigate(`/external-audits?auditId=${defect.auditId}`)} title={t("def.origin.openAudit")}
                    className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-bold text-amber-800 dark:text-amber-300">
                    <ClipboardCheck className="w-3 h-3" /> {defect.auditCode ?? t("def.origin.audit")}
                  </button>
                )}
                <span className="rounded-full border border-fg/10 bg-fg/5 px-2 py-0.5 text-[11px] font-bold text-text-industrial/60">{t("def.guide.reportedAgo").replace("{n}", String(reportedDays))}</span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <CopyLinkButton />
              <button onClick={() => setExpanded(v => !v)} className="p-1.5 rounded-lg text-text-industrial/30 hover:text-fg hover:bg-fg/5 transition-colors" title={expanded ? t("common.minimize") : t("common.maximize")}>
                {expanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              </button>
              <ModalCloseButton onClose={requestClose} />
            </div>
          </div>

          {/* Recorrido */}
          <div className="flex flex-wrap items-center gap-2 px-4 sm:px-6 py-2.5 border-b border-fg/10 bg-fg/[0.02] shrink-0">
            {labels.map((l, i) => {
              const done = i < stepIdx;
              const cur = i === stepIdx;
              return (
                <React.Fragment key={l}>
                  {i > 0 && <span className="w-5 h-px bg-fg/15" />}
                  <span className={`flex items-center gap-1.5 text-xs font-bold ${done ? "text-emerald-700 dark:text-emerald-400" : cur ? "text-fg" : "text-text-industrial/40"}`}>
                    <span className={`w-6 h-6 rounded-full border-2 flex items-center justify-center text-[11px] ${done ? "bg-emerald-500 border-emerald-500 text-white" : cur ? "bg-red-600 border-red-600 text-white" : "border-fg/25"}`}>
                      {done ? <Check className="w-3.5 h-3.5" /> : i + 1}
                    </span>
                    {l}
                  </span>
                </React.Fragment>
              );
            })}
            {status === "DEFERRED" && !isClosed && (
              <span className="ml-auto rounded-full bg-yellow-500/15 px-2 py-0.5 text-[11px] font-extrabold text-yellow-800 dark:text-yellow-300">{t("def.st.DEFERRED")}</span>
            )}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="px-4 sm:px-6 pt-4">{nextCard}</div>
            <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-4 px-4 sm:px-6 py-4">
              {/* Izquierda: qué pasó y por qué */}
              <div className="space-y-3 min-w-0">
                <GuideSection n={1} title={t("def.sec.what")} subtitle={t("def.sec.whatSub")} open onToggle={() => { /* siempre abierto */ }}>
                  <GuideField id="def-e-desc" missing={!isClosed && !description.trim()}>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className={`${fl} mb-0`}>{t("def.guide.found")}{!isClosed && !description.trim() && <GuideNeedTag label={t("mp.guide.missing")} />}</label>
                      {!isClosed && <MicButton onAppend={chunk => setDescription(prev => (prev.trim() ? prev + " " : "") + chunk)} />}
                    </div>
                    <AutoTextArea rows={2} value={description} onChange={e => setDescription(e.target.value)} disabled={isClosed} className={fldCls + " resize-y"} placeholder={t("def.briefDescPh")} />
                  </GuideField>
                  <div>
                    <label className={fl}>{t("col.severity")}</label>
                    <div className="flex flex-wrap gap-1.5">
                      {DEFECT_SEVERITIES.map(v => (
                        <button key={v} type="button" disabled={isClosed} onClick={() => setSeverity(v)}
                          className={`rounded-full border-[1.5px] px-3 py-1 text-xs font-bold transition-colors disabled:opacity-70 ${severity === v ? sevCls[v] : "border-fg/10 bg-surface text-text-industrial/60 hover:text-fg"}`}>
                          {t(SEVERITY_LABEL_KEYS[v])}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className={fl}>{t("def.guide.equipmentState")}</label>
                    <div className="flex flex-wrap gap-1.5">
                      {DEFECT_OPERATIONAL_STATES.map(v => (
                        <button key={v} type="button" disabled={isClosed} onClick={() => setOperationalState(v)}
                          className={`rounded-xl border-[1.5px] px-3 py-1 text-left transition-colors disabled:opacity-70 ${operationalState === v ? opCls[v] : "border-fg/10 bg-surface text-text-industrial/60 hover:text-fg"}`}>
                          <span className="block text-xs font-bold">{t(`def.op.${v}` as TranslationKey)}</span>
                          <span className="block text-[10px] opacity-80">{t(`def.opHint.${v}` as TranslationKey)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <GuideField id="def-e-class" missing={!isClosed && !classification.trim()}>
                    <label className={fl}>{t("def.classification")}{!isClosed && !classification.trim() && <GuideNeedTag label={t("mp.guide.missing")} />}</label>
                    <input value={classification} onChange={e => setClassification(e.target.value)} disabled={isClosed} className={fldCls} />
                  </GuideField>

                  {/* Fotos del defecto */}
                  <div>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <p className={`${fl} mb-0`}>{t("def.guide.photos")} {photos.length > 0 && `(${photos.length})`}</p>
                      {photos.length > 0 && aiPill(() => { void handleAnalyzeStoredPhotos(); }, analyzingPhotos, t("def.guide.describeAi"))}
                      <input ref={photoInputRef} type="file" accept="image/*" multiple capture="environment" className="hidden" onChange={(e) => { void onPhotosSelectedEdit(e); }} />
                    </div>
                    {photosLoading ? (
                      <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-accent" /></div>
                    ) : (
                      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                        {photos.map(p => (
                          <div key={p.id} className="relative aspect-square bg-fg/5 border border-fg/10 rounded-xl overflow-hidden group">
                            {p.description && (
                              <button type="button" onClick={() => setLightboxPhoto(p)} className="w-full h-full">
                                <AuthedImage src={p.description} alt={p.filename} className="w-full h-full object-cover" />
                              </button>
                            )}
                            {!isClosed && (
                              <button type="button" onClick={() => { void removePhotoEdit(p.id); }} title={t("common.delete")}
                                className="absolute top-1 right-1 p-1 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 hover:bg-red-500 transition-all">
                                <Trash2 className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        ))}
                        {!isClosed && (
                          <button type="button" onClick={() => photoInputRef.current?.click()} disabled={uploadingPhotos}
                            className="aspect-square rounded-xl border-[1.5px] border-dashed border-fg/25 flex flex-col items-center justify-center gap-1 text-[11px] font-bold text-text-industrial/60 hover:border-accent/40 hover:text-fg disabled:opacity-50">
                            {uploadingPhotos ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />} {t("def.guide.addPhotos")}
                          </button>
                        )}
                        {isClosed && photos.length === 0 && <p className="col-span-full text-xs text-text-industrial/40 italic">{t("def.noPhotosShort")}</p>}
                      </div>
                    )}
                  </div>

                  <div>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <label className={`${fl} mb-0`}>{t("def.guide.immediate")}</label>
                      {aiPill(() => { void handleImmediateActionClick(); }, loadingImmediate, t("mp.guide.suggestAi"))}
                    </div>
                    <AutoTextArea rows={2} value={immediateAction} onChange={e => setImmediateAction(e.target.value)} disabled={isClosed || loadingImmediate} className={fldCls + " resize-y"} placeholder={t("def.immediateActionPh")} />
                  </div>
                </GuideSection>

                <GuideSection n={2} title={t("def.sec.why")} subtitle={t("def.sec.whySub")} open onToggle={() => { /* siempre abierto */ }}
                  pill={rcaApprovedAt
                    ? <span className="rounded-full bg-success-sea/15 px-2 py-0.5 text-[10px] font-bold text-success-sea whitespace-nowrap">{t("def.rcaApproved")} · {fmtDate(rcaApprovedAt)}</span>
                    : rcaRecommended ? <span className="rounded-full bg-amber-600 px-2.5 py-0.5 text-[11px] font-bold text-white whitespace-nowrap">{t("def.guide.recommended")}</span> : undefined}>
                  <GuideField id="def-rca" missing={rcaRecommended}>
                    <div className="flex items-center gap-1.5">
                      <label className={`${fl} mb-0`}>{t("def.rcaMethodology")}</label>
                      {rcaRecommended && <GuideNeedTag label={t("def.guide.recommendedHigh")} />}
                      {aiPill(() => { void analyzeRca(); }, rcaAnalyzing, t("def.guide.analyzeAi"), Bot)}
                    </div>
                    <select value={rcaMethodology} onChange={e => setRcaMethodology(e.target.value as RcaMethodology | "")} disabled={isClosed} className={fldCls}>
                      <option value="">—</option>
                      {RCA_METHODOLOGY_OPTIONS.map(o => <option key={o.value} value={o.value}>{t(o.labelKey)}</option>)}
                    </select>
                  </GuideField>
                  <div>
                    <label className={fl}>{t("def.rcaSummary")}</label>
                    <RichTextArea rows={2} value={rcaAnalysis} onChange={setRcaAnalysis} disabled={isClosed} className={fldCls} placeholder={t("def.rcaSummaryPh")} />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className={fl}>{t("def.rcaImmediateCause")}</label>
                      <RichTextArea rows={2} value={rcaImmediateCause} onChange={setRcaImmediateCause} disabled={isClosed} className={fldCls} placeholder={t("def.rcaImmediatePh")} />
                    </div>
                    <div>
                      <label className={fl}>{t("def.rcaContributingCause")}</label>
                      <RichTextArea rows={2} value={rcaContributingCause} onChange={setRcaContributingCause} disabled={isClosed} className={fldCls} placeholder={t("def.rcaContributingPh")} />
                    </div>
                  </div>
                  <div>
                    <label className={fl}>{t("def.rcaRootCause")}</label>
                    <RichTextArea rows={2} value={rcaRootCause} onChange={setRcaRootCause} disabled={isClosed} className={fldCls} placeholder={t("def.rcaRootPh")} />
                  </div>
                  <div>
                    <label className={fl}>{t("def.rcaPreventiveActions")}</label>
                    <RichTextArea rows={2} value={rcaPreventiveActions} onChange={setRcaPreventiveActions} disabled={isClosed} className={fldCls} placeholder={t("def.rcaPreventivePh")} />
                  </div>
                  {!isClosed && !rcaApprovedAt && rcaRootCause.trim() && (
                    <button
                      type="button"
                      onClick={async () => {
                        const now = new Date().toISOString();
                        // Guarda TODOS los campos del formulario (no solo RCA) — mismo patchDefect
                        // que usa "Guardar" — y no cierra el modal.
                        if (!await patchDefect({ rcaApprovedAt: now })) return;
                        setRcaApprovedAt(now);
                        onReload();
                      }}
                      className="self-start px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/40 hover:bg-emerald-500/25 transition-colors"
                    >
                      {t("def.rcaApprove")}
                    </button>
                  )}
                </GuideSection>
              </div>

              {/* Derecha: relacionado, cierre e historia */}
              <div className="space-y-3 min-w-0">
                <div className="rounded-2xl border border-fg/10 overflow-hidden">
                  <h3 className="flex items-center gap-1.5 px-3 py-2.5 border-b border-fg/10 text-[13.5px] font-extrabold text-fg"><Link2 className="w-4 h-4" /> {t("def.guide.related")}</h3>
                  <div className="p-3 space-y-2.5">
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <p className="text-[10.5px] font-semibold text-text-industrial/45">{t("def.origin.prefix")}</p>
                        <p className="font-bold text-fg">{originKey === "manual" ? t("def.origin.manual") : t(`def.class.${originKey}` as TranslationKey)}</p>
                      </div>
                      <div>
                        <p className="text-[10.5px] font-semibold text-text-industrial/45">{t("def.guide.repairWo")}</p>
                        {repairWoCode ? (
                          <button type="button" onClick={() => navigate(`/work-orders?autoCode=${repairWoCode}`)} className="font-mono font-bold text-accent hover:underline">{repairWoCode}</button>
                        ) : <p className="font-bold text-text-industrial/50">{t("def.guide.noRepairWo")}</p>}
                      </div>
                    </div>
                    {!isClosed && (severity === "CRITICAL" || status === "DEFERRED" || operationalState === "NO_GO" || operationalState === "RESTRICTED") && (
                      <button onClick={() => setShowMoc(true)} title={t("def.guide.mocHint")}
                        className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-fg/10 text-xs font-bold text-fg hover:border-accent/30 transition-all">
                        <GitBranch className="w-3.5 h-3.5" /> {t("def.guide.openMoc")}
                      </button>
                    )}
                  </div>
                </div>

                {isClosed && (
                  <div className="rounded-2xl border border-emerald-500/30 overflow-hidden">
                    <h3 className="flex items-center gap-1.5 px-3 py-2.5 border-b border-emerald-500/20 bg-emerald-500/[0.06] text-[13.5px] font-extrabold text-fg"><CheckCircle2 className="w-4 h-4 text-emerald-600" /> {t("def.guide.closeBox")}</h3>
                    <div className="p-3 space-y-2 text-xs">
                      {defect.repairType && <p><span className="text-text-industrial/50">{t("def.guide.repairKind")}:</span> <b>{defect.repairType === "PERMANENTE" ? t("def.guide.permanent") : t("def.guide.temporary")}</b></p>}
                      {closeNotes && <p><span className="text-text-industrial/50">{t("def.closeNotes")}:</span> <b>{closeNotes}</b></p>}
                      {(defect.effectivenessVerifiedAt || defect.effectivenessDueAt) && (
                        <p><span className="text-text-industrial/50">{t("def.verify.result")}:</span> <b>{defect.effectivenessVerifiedAt
                          ? `${t(effectivenessLabelKey(defect.effectivenessOutcome))} · ${fmtDate(defect.effectivenessVerifiedAt)}`
                          : `${t("def.verify.pendingUntil")} ${fmtDate(defect.effectivenessDueAt)}`}</b></p>
                      )}
                      {defect.effectivenessNote && <p className="text-text-industrial/70">{defect.effectivenessNote}</p>}
                    </div>
                  </div>
                )}

                <div className="rounded-2xl border border-fg/10 overflow-hidden">
                  <h3 className="flex items-center gap-1.5 px-3 py-2.5 border-b border-fg/10 text-[13.5px] font-extrabold text-fg"><History className="w-4 h-4" /> {t("def.guide.history")}</h3>
                  <ol className="p-3 space-y-2 text-xs">
                    {[
                      { on: true, color: "bg-red-600", text: t("def.guide.hReported"), date: defect.reportedAt },
                      { on: !!repairWoCode, color: "bg-blue-600", text: `${t("def.guide.hWo")} ${repairWoCode ?? ""}`, date: null },
                      { on: !!defect.rcaApprovedAt, color: "bg-violet-600", text: t("def.guide.hRca"), date: defect.rcaApprovedAt },
                      { on: isClosed, color: "bg-emerald-500", text: t("def.guide.hClosed"), date: null },
                      { on: !!defect.effectivenessVerifiedAt, color: defect.effectivenessOutcome === "INEFFECTIVE" ? "bg-red-600" : "bg-emerald-600", text: `${t("def.guide.hVerified")}: ${t(effectivenessLabelKey(defect.effectivenessOutcome))}`, date: defect.effectivenessVerifiedAt },
                      { on: verifyDue, color: "bg-amber-500", text: t("def.guide.hVerifyPending"), date: defect.effectivenessDueAt },
                    ].filter(e => e.on).map((e, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className={`mt-1 w-2.5 h-2.5 rounded-full shrink-0 ${e.color}`} />
                        <span><b className="text-fg">{e.text}</b>{e.date && <span className="text-text-industrial/55"> · {fmtDate(e.date)}</span>}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 px-4 sm:px-6 py-3 border-t border-fg/10 shrink-0">
            <button onClick={() => { void downloadDefectPdf(defect); }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-fg/5 border border-fg/10 text-xs text-text-industrial hover:border-accent/30 transition-all">
              <Download className="w-3.5 h-3.5" /> PDF
            </button>
            {!isClosed && (
              <div className="relative">
                <button type="button" onClick={() => setMoreOpen(v => !v)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-fg/5 border border-fg/10 text-xs text-text-industrial hover:border-accent/30">
                  <MoreHorizontal className="w-3.5 h-3.5" /> {t("wo.guide.more")}
                </button>
                {moreOpen && (
                  <div className="absolute bottom-full left-0 mb-1.5 z-20 min-w-[14rem] rounded-xl border border-fg/10 bg-surface dark:bg-[#0D1B2A] p-1.5 shadow-xl">
                    {(["OPEN", "UNDER_REVIEW", "IN_PROGRESS", "DEFERRED", "RESOLVED"] as const).filter(s => s !== status).map(s => (
                      <button key={s} type="button" disabled={saving} onClick={() => { void setStage(s); }}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-fg hover:bg-fg/5 disabled:opacity-50">
                        {t("def.guide.markAs").replace("{status}", t(`def.st.${s}` as TranslationKey))}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {/* Eliminar: SÓLO administrador (ensureCanDeleteDefect). Borrado lógico. */}
            {isAdmin && (
              <button onClick={() => { void handleDelete(); }} disabled={deleting} title={t("common.delete")}
                className="flex items-center justify-center p-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-700 dark:text-red-400 hover:bg-red-500/20 disabled:opacity-50 transition-all">
                {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              </button>
            )}
            <span className="flex-1" />
            {!isClosed && isDirty && (
              <span className="inline-flex items-center gap-1 text-[11.5px] font-bold text-amber-700 dark:text-amber-400"><CircleDot className="w-3 h-3" /> {t("mp.guide.dirty")}</span>
            )}
            <button onClick={onClose} className="px-3 py-2 rounded-xl text-xs text-text-industrial hover:text-fg transition-colors">{isClosed ? t("common.close") : t("common.cancel")}</button>
            {!isClosed && (
              <button onClick={() => { void saveOnly(); }} disabled={saving || closing}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-accent text-accent-fg font-bold text-xs hover:brightness-110 disabled:opacity-50 transition-all">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-3.5 h-3.5" />} {t("common.save")}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Cerrar el defecto: reparación permanente (cómo se comprobó) o temporaria (OT definitiva). */}
      {closeDlg && (
        <div className="fixed inset-0 z-[65] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-lg bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-5 py-3.5 border-b border-fg/10">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              <h2 className="text-base font-black text-fg">{t("def.guide.closeDlgTitle")}</h2>
              <ModalCloseButton onClose={() => setCloseDlg(false)} className="ml-auto" />
            </div>
            <div className="px-5 py-4 space-y-3.5">
              <div>
                <p className={fl}>{t("def.guide.definitiveQ")}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {(["PERMANENTE", "TEMPORARIA"] as const).map(rt => {
                    const on = repairType === rt;
                    return (
                      <button key={rt} type="button" onClick={() => setRepairType(rt)}
                        className={`rounded-xl border-2 p-2.5 text-left transition-colors ${on ? (rt === "PERMANENTE" ? "border-emerald-500 bg-emerald-500/10" : "border-amber-500 bg-amber-500/10") : "border-fg/10 hover:border-fg/25"}`}>
                        <span className="block text-[13px] font-extrabold text-fg">{rt === "PERMANENTE" ? t("def.guide.permYes") : t("def.guide.tempNo")}</span>
                        <span className="block text-[11px] text-text-industrial/60">{rt === "PERMANENTE" ? t("def.guide.permHint") : t("def.guide.tempHint").replace("{abbr}", woTerms.abbr)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              {repairType === "PERMANENTE" && (
                <GuideField id="def-close-check" missing={!closeCheckText}>
                  <p className={fl}>{t("def.verify.closeQuestion")}{!closeCheckText && <GuideNeedTag label={t("mp.exec.required")} />}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {CLOSE_CHECK_OPTIONS.map(opt => (
                      <button key={opt.key} type="button" onClick={() => setCloseCheck(prev => prev === opt.key ? null : opt.key)}
                        className={`py-2 px-3 rounded-xl border-2 text-xs font-bold text-left transition-all ${closeCheck === opt.key ? "border-emerald-500 bg-emerald-500/10 text-fg" : "border-fg/10 text-text-industrial/70 hover:border-fg/25"}`}>
                        {t(opt.labelKey)}
                      </button>
                    ))}
                  </div>
                  {closeCheck === "other" && (
                    <input type="text" value={closeCheckOther} onChange={e => setCloseCheckOther(e.target.value)} placeholder={t("def.verify.otherPh")} className={fldCls} />
                  )}
                  <p className="text-[11px] text-text-industrial/55">{t("def.verify.closeHint")}</p>
                </GuideField>
              )}
              {repairType === "TEMPORARIA" && (
                <p className="rounded-xl border border-amber-400/60 bg-amber-500/[0.08] px-3 py-2 text-xs text-amber-900 dark:text-amber-200">{t("def.guide.tempExplain").replace("{abbr}", woTerms.abbr)}</p>
              )}
            </div>
            <div className="flex items-center gap-2 px-5 py-3 border-t border-fg/10">
              <span className="flex-1" />
              <button type="button" onClick={() => setCloseDlg(false)} className="px-3 py-2 rounded-xl text-xs text-text-industrial hover:text-fg">{t("common.cancel")}</button>
              <button type="button" onClick={() => { void confirmClose(); }} disabled={!repairType || saving || closing}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:brightness-110 disabled:opacity-50">
                {(saving || closing) ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                {repairType === "TEMPORARIA" ? t("def.guide.createPermWo").replace("{abbr}", woTerms.abbr) : t("def.guide.close")}
              </button>
            </div>
          </div>
        </div>
      )}

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

      {/* Validaciones y errores de acción: ventanita con OK, no recuadro al pie
          (en un formulario tan largo el recuadro quedaba fuera de la vista y
          parecía que el botón no había hecho nada). */}
      {actionError && <AlertDialog message={actionError} onClose={() => setActionError(null)} />}
      {rcaAnalysisError && <AlertDialog message={rcaAnalysisError} onClose={() => setRcaAnalysisError(null)} />}
    </>
  );
};

/**
 * ISM 10.2.3 — franja "Para revisar".
 *
 * Los defectos cerrados hace 30 días o más que todavía no confirmaron si el
 * problema volvió. Son dos botones y nada más: la tripulación no tiene que
 * abrir el registro ni escribir nada para dejar la evidencia que pide el
 * Código. "Volvió a fallar" no re-abre el defecto (eso es exclusivo del
 * administrador): registra que la medida no fue efectiva y ofrece cargar la
 * reincidencia como un defecto nuevo, que es el circuito de siempre.
 */
const EffectivenessReviewStrip: React.FC<{
  items: Defect[];
  onDone: () => void;
  onRecurrence: (defect: Defect) => void;
}> = ({ items, onDone, onRecurrence }) => {
  const t = useT();
  const { user } = useAuth();
  const canVerify = user?.role !== "AUDITOR_READONLY";
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const verify = useCallback(async (row: Defect, outcome: "EFFECTIVE" | "INEFFECTIVE") => {
    setBusyId(row.id);
    try {
      await api.post(`/app/pms/defects/${row.id}/verify-effectiveness`, { outcome });
      if (outcome === "INEFFECTIVE") onRecurrence(row);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("def.verify.error"));
    } finally {
      setBusyId(null);
    }
  }, [onDone, onRecurrence, t]);

  if (items.length === 0) return null;

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
        <span className="text-xs font-bold text-amber-700 dark:text-amber-300">
          {t("def.verify.stripTitle")} ({items.length})
        </span>
        <span className="text-[11px] text-text-industrial/60">{t("def.verify.stripHint")}</span>
      </div>
      <div className="space-y-1.5">
        {items.map(row => (
          <div key={row.id} className="flex items-center gap-2 flex-wrap px-3 py-2 rounded-lg bg-fg/5 border border-fg/10">
            <span className="font-mono font-bold text-fg text-xs">{row.defectCode}</span>
            <VesselLabel code={row.vesselCode} className="text-[11px]" />
            <AssetLabel id={row.assetId} className="text-[11px] text-text-industrial/70 truncate max-w-[220px]" />
            <span className="text-[11px] text-text-industrial/50 truncate flex-1 min-w-[120px]">{row.description}</span>
            {canVerify && (
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  disabled={busyId === row.id}
                  onClick={() => { void verify(row, "EFFECTIVE"); }}
                  className="px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-emerald-700 dark:text-emerald-400 text-[11px] font-bold hover:bg-emerald-500/25 disabled:opacity-50 transition-colors"
                >
                  {busyId === row.id ? <Loader2 className="w-3 h-3 animate-spin" /> : t("def.verify.stillOk")}
                </button>
                <button
                  type="button"
                  disabled={busyId === row.id}
                  onClick={() => { void verify(row, "INEFFECTIVE"); }}
                  className="px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-700 dark:text-red-400 text-[11px] font-bold hover:bg-red-500/20 disabled:opacity-50 transition-colors"
                >
                  {t("def.verify.failedAgain")}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      {error && <AlertDialog message={error} onClose={() => setError(null)} />}
    </div>
  );
};

export const DefectsPage: React.FC = () => {
  const t = useT();
  const [searchParams] = useSearchParams();
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
  // ISM 10.2.3: `?verification=DUE` llega desde el Dashboard y muestra sólo los
  // defectos que esperan la confirmación de que el problema no volvió.
  const verificationFilter = (searchParams.get("verification") ?? "").trim();
  // Compat: `?defectId=` (por id) → resuelve el código y redirige a `/defects/:code`.
  //
  // Este redirector es un PUENTE, no un destino: se resuelve con UNA sola
  // navegación en `replace`, sin dejar rastro en el historial. Así, un defecto
  // abierto desde una OT vuelve a esa OT al cerrarse, y no a la lista.
  //
  // Antes eran dos pasos (limpiar el param + openLink) y se pisaban entre sí:
  // openLink conserva la query, así que el `defectId` sobrevivía y se terminaba
  // en `/defects/:code?defectId=…`, con el efecto volviendo a dispararse.
  const autoDefectId = searchParams.get("defectId");
  // Filtro que llega desde una métrica del panel TMSA (lib/tmsa-filter.tsx).
  const tmsaFilter = useTmsaFilter();
  useEffect(() => {
    if (!autoDefectId) return;
    api.get<Defect>(`/app/pms/defects/${autoDefectId}`)
      .then(d => {
        const params = new URLSearchParams(searchParams);
        params.delete("defectId");
        const qs = params.toString();
        navigate(`/defects/${encodeURIComponent(d.defectCode)}${qs ? `?${qs}` : ""}`, { replace: true });
      })
      .catch(() => {});
  }, [autoDefectId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Listado (preview V21) ──────────────────────────────────────────────────
  // Se trae todo y se filtra en cliente: los filtros cruzan estado, severidad,
  // estado del equipo, origen y equipo, y los contadores necesitan el total.
  // Los parámetros viejos de la URL (?status, ?severity, ?vesselCode,
  // ?verification=DUE) siguen funcionando: arrancan el filtro correspondiente.
  const { vessels: contextVessels } = useVesselContext();
  const woTerms = useWoTerms();
  useAssetsCache(); // nombres de equipos para el buscador y el filtro
  const [cardSel, setCardSel] = useState<"" | "crit" | "stop" | "nowo" | "verify">(() => (verificationFilter === "DUE" ? "verify" : ""));
  const [stageSel, setStageSel] = useState<"open" | "closed" | "all">(() =>
    statusFilter === "CLOSED" || statusFilter === "RESOLVED" ? "closed" : statusFilter ? "all" : "open");
  const [statusExact] = useState(statusFilter);
  const [sevSel, setSevSel] = useState(severityFilter);
  const [opSel, setOpSel] = useState("");
  const [originSel, setOriginSel] = useState("");
  const [assetSel, setAssetSel] = useState("");
  const [vesselSel, setVesselSel] = useState(vesselFilter);
  const [search, setSearch] = useState("");
  const [pendingAction, setPendingAction] = useState<"createWo" | "close" | null>(null);
  // `/defects/:code?action=createWo`: llega desde el flujograma de un resultado
  // crítico de Muestreos y Análisis (preview V46). Se consume y se limpia la URL.
  const urlAction = searchParams.get("action");
  useEffect(() => {
    if (urlAction !== "createWo") return;
    setPendingAction("createWo");
    const params = new URLSearchParams(searchParams);
    params.delete("action");
    const qs = params.toString();
    navigate(`${location.pathname}${qs ? `?${qs}` : ""}`, { replace: true });
  }, [urlAction]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data, loading, error, reload } = useFetch<ListResponse>("/app/pms/defects", []);

  // Franja "Para confirmar": los cerrados hace 30+ días sin confirmar. Se pide
  // aparte para que aparezca esté como esté filtrada la pantalla.
  const reviewDue = useFetch<ListResponse>("/app/pms/defects?verification=DUE", []);
  const allItems = useMemo(() => applyTmsaFilter(data?.items ?? null, tmsaFilter, r => r.id) ?? [], [data, tmsaFilter]);

  const isOpenDefect = (d: Defect) => d.status !== "RESOLVED" && d.status !== "CLOSED";
  const ageDays = (d: Defect) => Math.max(0, Math.floor((Date.now() - new Date(d.reportedAt).getTime()) / 86_400_000));
  /** Abierto hace demasiado para su severidad: crítico +7 d, alto +15 d, cualquiera +30 d. */
  const isLate = (d: Defect) => isOpenDefect(d) && ((d.severity === "CRITICAL" && ageDays(d) > 7) || (d.severity === "HIGH" && ageDays(d) > 15) || ageDays(d) > 30);
  const repairWo = (d: Defect) => (defectOriginKey(d.classification) !== "wo" ? d.workOrderCode : null);
  const isVerifyDue = (d: Defect) => d.status === "CLOSED" && !!d.effectivenessDueAt && !d.effectivenessVerifiedAt && new Date(d.effectivenessDueAt).getTime() <= Date.now();
  const matchCard = (d: Defect, key: typeof cardSel) => {
    switch (key) {
      case "crit":   return isOpenDefect(d) && d.severity === "CRITICAL";
      case "stop":   return isOpenDefect(d) && (d.operationalState === "NO_GO" || d.operationalState === "RESTRICTED");
      case "nowo":   return isOpenDefect(d) && !d.workOrderId;
      case "verify": return isVerifyDue(d);
      default:       return true;
    }
  };

  const beforeStage = useMemo(() => {
    let items = allItems;
    if (cardSel) items = items.filter(d => matchCard(d, cardSel));
    if (statusExact && !["CLOSED", "RESOLVED"].includes(statusExact)) items = items.filter(d => d.status === statusExact);
    if (sevSel) items = items.filter(d => d.severity === sevSel);
    if (opSel) items = items.filter(d => d.operationalState === opSel);
    if (originSel) items = items.filter(d => defectOriginKey(d.classification) === originSel);
    if (assetSel) items = items.filter(d => d.assetId === assetSel);
    if (vesselSel) items = items.filter(d => d.vesselCode === vesselSel);
    const q = search.trim().toLowerCase();
    if (q) {
      items = items.filter(d =>
        textMatches(d.defectCode, q) || textMatches(d.description ?? "", q) ||
        textMatches(getAssetName(d.assetId) ?? "", q) || textMatches(d.workOrderCode ?? "", q) || textMatches(d.classification ?? "", q),
      );
    }
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allItems, cardSel, statusExact, sevSel, opSel, originSel, assetSel, vesselSel, search]);

  const stageFilter = useCallback((items: Defect[], key: typeof stageSel) => {
    if (key === "all") return items;
    if (key === "closed") return items.filter(d => !isOpenDefect(d));
    // "Abiertos" deja afuera los cerrados, salvo que se busque o se pidan los "para confirmar".
    if (search.trim() || cardSel === "verify") return items;
    return items.filter(isOpenDefect);
  }, [search, cardSel]);
  const shown = useMemo(() => stageFilter(beforeStage, stageSel), [beforeStage, stageFilter, stageSel]);

  const summary = useMemo(() => ({
    crit: allItems.filter(d => matchCard(d, "crit")).length,
    stop: allItems.filter(d => matchCard(d, "stop")).length,
    nowo: allItems.filter(d => matchCard(d, "nowo")).length,
    verify: allItems.filter(d => matchCard(d, "verify")).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [allItems]);
  const assetOptions = useMemo(() => {
    const ids = [...new Set(allItems.map(d => d.assetId).filter(Boolean))];
    return ids.map(id => ({ id, label: getAssetName(id) ?? id })).sort((a, b) => a.label.localeCompare(b.label));
  }, [allItems]);
  const vesselOptions = useMemo(() => [...new Set(allItems.map(d => d.vesselCode))], [allItems]);
  const vesselName = (code: string) => contextVessels.find(v => v.code === code)?.name || code;

  const openDetail = useCallback(async (row: Defect) => {
    setDetailLoadingId(row.id);
    setDetailError(null);
    try {
      const detailed = await api.get<Defect>(`/app/pms/defects/${row.id}`);
      setEditing(detailed);
    } catch (err) {
      setEditing(row);
      setDetailError(err instanceof ApiError ? err.message : t("def.guide.loadError"));
    } finally {
      setDetailLoadingId(null);
    }
  }, [t]);

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

  const SEV_CHIP: Record<string, string> = {
    CRITICAL: "bg-red-700 text-white", HIGH: "bg-orange-500/15 text-orange-700 dark:text-orange-300",
    MEDIUM: "bg-yellow-500/15 text-yellow-800 dark:text-yellow-300", LOW: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  };
  const OP_CHIP: Record<string, string> = {
    NO_GO: "bg-red-600 text-white", RESTRICTED: "bg-orange-500/15 text-orange-700 dark:text-orange-300",
    DEGRADED: "bg-yellow-500/15 text-yellow-800 dark:text-yellow-300", NORMAL: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  };
  const ST_CHIP: Record<string, string> = {
    OPEN: "border-red-500/30 bg-red-500/[0.06] text-red-700 dark:text-red-400",
    UNDER_REVIEW: "border-red-500/30 bg-red-500/[0.06] text-red-700 dark:text-red-400",
    IN_PROGRESS: "border-blue-500/30 bg-blue-500/[0.06] text-blue-700 dark:text-blue-400",
    DEFERRED: "border-yellow-500/35 bg-yellow-500/10 text-yellow-800 dark:text-yellow-300",
    RESOLVED: "border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-700 dark:text-emerald-400",
    CLOSED: "border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-700 dark:text-emerald-400",
  };
  const chip = (cls: string, label: string) => <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] font-extrabold ${cls}`}>{label}</span>;
  const originCell = (d: Defect) => {
    const key = defectOriginKey(d.classification);
    const Icon = { wo: Wrench, inspection: SearchCheck, fluid: Droplets, audit: ClipboardCheck, manual: Pencil }[key];
    return <span className="inline-flex items-center gap-1 text-[11px] font-bold text-text-industrial/60 whitespace-nowrap"><Icon className="w-3 h-3" />{t(`def.origin.${key}` as TranslationKey)}</span>;
  };
  const ageCell = (d: Defect) => isOpenDefect(d)
    ? <span className={`inline-flex items-center gap-1 text-[11.5px] whitespace-nowrap ${isLate(d) ? "font-extrabold text-red-700 dark:text-red-400" : "text-text-industrial/60"}`}>{isLate(d) && <Clock className="w-3 h-3" />}{t("def.list.ago").replace("{n}", String(ageDays(d)))}</span>
    : <span className="text-[11.5px] text-text-industrial/45">{t("def.st.CLOSED")}</span>;
  const rowAction = (d: Defect) => {
    const base = "inline-flex items-center gap-1 whitespace-nowrap rounded-lg border px-2 py-1 text-[11px] font-bold transition-colors";
    if (isVerifyDue(d)) {
      return <button type="button" onClick={e => { e.stopPropagation(); openLink(d.defectCode); }} className={`${base} border-amber-400/60 bg-amber-500/10 text-amber-800 dark:text-amber-300 hover:bg-amber-500/20`}><ShieldQuestion className="w-3 h-3" /> {t("def.list.actVerify")}</button>;
    }
    if (!isOpenDefect(d)) return null;
    if (!d.workOrderId) {
      return <button type="button" onClick={e => { e.stopPropagation(); setPendingAction("createWo"); openLink(d.defectCode); }} className={`${base} border-accent/35 bg-accent/5 text-accent hover:bg-accent/15`}><Wrench className="w-3 h-3" /> {t("def.guide.createWo").replace("{abbr}", woTerms.abbr)}</button>;
    }
    return <button type="button" onClick={e => { e.stopPropagation(); setPendingAction("close"); openLink(d.defectCode); }} className={`${base} border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/20`}><CheckCircle2 className="w-3 h-3" /> {t("def.guide.close")}</button>;
  };

  const columns: Column<Defect>[] = [
    {
      key: "defectCode", header: t("def.list.col.defect"), sortValue: r => r.defectCode,
      render: row => (
        <div>
          <div className="font-mono font-bold text-fg text-xs whitespace-nowrap">{row.defectCode}</div>
          {/* Nombre del buque, no el código. */}
          <div className="text-[10.5px] text-text-industrial/50">{vesselName(row.vesselCode)}</div>
        </div>
      ),
    },
    {
      key: "assetId", header: t("def.list.col.what"), sortValue: r => getAssetName(r.assetId) ?? "",
      render: row => (
        <div className="min-w-0">
          <AssetLabel id={row.assetId} className="text-xs font-bold text-fg" />
          {row.description && <div className="text-[11.5px] text-text-industrial/60 line-clamp-2">{row.description}</div>}
        </div>
      ),
    },
    { key: "classification", header: t("def.origin.prefix"), render: originCell },
    {
      key: "severity", header: t("col.severity"),
      sortValue: r => ({ CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 } as Record<string, number>)[r.severity] ?? 9,
      render: row => chip(SEV_CHIP[row.severity] ?? "bg-fg/10", t(SEVERITY_LABEL_KEYS[row.severity as typeof DEFECT_SEVERITIES[number]] ?? "priority.medium")),
    },
    { key: "operationalState", header: t("def.guide.equipmentState"), render: row => chip(OP_CHIP[row.operationalState] ?? "bg-fg/10", t(`def.op.${row.operationalState}` as TranslationKey)) },
    { key: "status", header: t("def.list.col.stage"), render: row => <span className={`inline-block whitespace-nowrap rounded-lg border px-2 py-0.5 text-[10.5px] font-extrabold ${ST_CHIP[row.status] ?? ""}`}>{t(`def.st.${row.status}` as TranslationKey)}</span> },
    { key: "reportedAt", header: t("def.list.col.open"), sortValue: r => r.reportedAt, render: ageCell },
    {
      key: "workOrderCode", header: t("def.list.col.wo"),
      render: row => repairWo(row)
        ? <span className="font-mono text-[11px] font-bold text-accent">{repairWo(row)}</span>
        : <span className="text-text-industrial/30">—</span>,
    },
    { key: "action", header: "", render: row => rowAction(row) },
  ];

  const summaryCards: { key: Exclude<typeof cardSel, "">; n: number; label: string; hint: string; icon: typeof Wrench; cls: string; num: string }[] = [
    { key: "crit", n: summary.crit, label: t("def.sum.crit"), hint: t("def.sum.critHint"), icon: AlertOctagon, cls: "border-l-red-600", num: "text-red-700 dark:text-red-400" },
    { key: "stop", n: summary.stop, label: t("def.sum.stop"), hint: t("def.sum.stopHint"), icon: Ban, cls: "border-l-orange-500", num: "text-orange-700 dark:text-orange-400" },
    { key: "nowo", n: summary.nowo, label: t("def.sum.nowo"), hint: t("def.sum.nowoHint"), icon: Wrench, cls: "border-l-blue-600", num: "text-blue-700 dark:text-blue-400" },
    { key: "verify", n: summary.verify, label: t("def.sum.verify"), hint: t("def.sum.verifyHint"), icon: ShieldQuestion, cls: "border-l-amber-500", num: "text-amber-700 dark:text-amber-400" },
  ];
  const selCls = (on: boolean) => `rounded-lg border px-2 py-1.5 text-xs focus:outline-none focus:border-accent/50 ${on ? "border-accent bg-accent/5 font-bold text-accent" : "border-fg/10 bg-fg/5 text-fg"}`;

  return (
    <div className="space-y-4">
      <PageHeader icon={AlertTriangle} title={t("page.defects")} total={shown.length} onReload={reload}>
        <ExportExcelButton module="defects" />
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-red-600 text-white text-xs font-bold hover:brightness-110 transition-all"
        >
          <Plus className="w-3.5 h-3.5" /> {t("def.list.report")}
        </button>
      </PageHeader>

      {detailLoadingId && <div className="flex items-center gap-2 text-xs text-text-industrial/60"><Loader2 className="w-4 h-4 animate-spin text-accent" />{t("def.loadingDetail")}</div>}
      {detailError && <AlertDialog message={detailError} onClose={() => setDetailError(null)} />}

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

      <EffectivenessReviewStrip
        items={reviewDue.data?.items ?? []}
        onDone={() => { void reviewDue.reload(); void reload(); }}
        onRecurrence={row => {
          setCreatePrefill({
            vesselCode: row.vesselCode,
            assetId: row.assetId,
            detail: `${t("def.verify.recurrence")} ${row.defectCode}: ${row.description}`,
          });
          setCreating(true);
        }}
      />

      {/* Filtros */}
      <div className="rounded-2xl border border-fg/10 bg-surface p-3 space-y-2.5">
        <div className="flex flex-wrap gap-1.5">
          {([["open", t("def.list.stageOpen")], ["closed", t("def.list.stageClosed")], ["all", t("def.list.stageAll")]] as const).map(([k, label]) => {
            const on = stageSel === k;
            return (
              <button key={k} type="button" onClick={() => setStageSel(k)}
                className={`inline-flex items-center gap-1.5 rounded-full border-[1.5px] px-3 py-1 text-xs font-bold transition-colors ${on ? "border-accent bg-accent text-accent-fg" : "border-fg/10 bg-surface text-text-industrial/60 hover:text-fg"}`}>
                {label}
                <span className={`rounded-full px-1.5 text-[10px] ${on ? "bg-white/25" : "bg-fg/10"}`}>{stageFilter(beforeStage, k).length}</span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={sevSel} onChange={e => setSevSel(e.target.value)} className={selCls(!!sevSel)}>
            <option value="">{t("def.list.sevAll")}</option>
            {DEFECT_SEVERITIES.slice().reverse().map(v => <option key={v} value={v}>{t(SEVERITY_LABEL_KEYS[v])}</option>)}
          </select>
          <select value={opSel} onChange={e => setOpSel(e.target.value)} className={selCls(!!opSel)}>
            <option value="">{t("def.list.opAll")}</option>
            {DEFECT_OPERATIONAL_STATES.map(v => <option key={v} value={v}>{t(`def.op.${v}` as TranslationKey)}</option>)}
          </select>
          <select value={originSel} onChange={e => setOriginSel(e.target.value)} className={selCls(!!originSel)}>
            <option value="">{t("def.list.originAll")}</option>
            {(["wo", "inspection", "fluid", "audit", "manual"] as const).map(k => <option key={k} value={k}>{t(`def.origin.${k}` as TranslationKey)}</option>)}
          </select>
          <select value={assetSel} onChange={e => setAssetSel(e.target.value)} className={`${selCls(!!assetSel)} max-w-[14rem]`}>
            <option value="">{t("wo.fl.assetAll")}</option>
            {assetOptions.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
          {vesselOptions.length > 1 && (
            <select value={vesselSel} onChange={e => setVesselSel(e.target.value)} className={selCls(!!vesselSel)}>
              <option value="">{t("def.list.vesselAll")}</option>
              {vesselOptions.map(v => <option key={v} value={v}>{vesselName(v)}</option>)}
            </select>
          )}
          <div className="flex items-center gap-1.5 rounded-lg border border-fg/10 bg-fg/5 px-2.5 py-1.5 w-full sm:w-auto sm:ml-auto">
            <Search className="w-3.5 h-3.5 text-text-industrial/40 shrink-0" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t("def.list.search")}
              className="w-full sm:w-60 bg-transparent text-xs text-fg placeholder-text-industrial/30 focus:outline-none" />
            {search && <button type="button" onClick={() => setSearch("")} className="text-text-industrial/40 hover:text-fg"><X className="w-3 h-3" /></button>}
          </div>
        </div>
      </div>

      <TmsaFilterBanner filter={tmsaFilter} shown={shown.length} total={data?.items?.length ?? 0} />

      {/* Escritorio: tabla · Celular: tarjetas */}
      <div className="hidden md:block">
        <DataTable columns={columns} data={shown} loading={loading} error={error} keyFn={row => row.id} emptyText={t("empty.defects")}
          onRowClick={row => openLink(row.defectCode)}
          rowClassName={row => (isLate(row) || (isOpenDefect(row) && row.operationalState === "NO_GO") ? "bg-red-500/[0.06] shadow-[inset_4px_0_0_rgb(220,38,38)]" : "")} />
      </div>
      <div className="md:hidden flex flex-col gap-2">
        {loading && <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-accent" /></div>}
        {!loading && shown.length === 0 && <p className="py-8 text-center text-sm text-text-industrial/40">{t("empty.defects")}</p>}
        {shown.map(d => (
          <div key={d.id} onClick={() => openLink(d.defectCode)}
            className={`rounded-xl border border-fg/10 border-l-4 px-3 py-2.5 space-y-1.5 cursor-pointer ${isLate(d) ? "border-l-red-600 bg-red-500/[0.06]" : "border-l-fg/10 bg-surface"}`}>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-xs font-bold text-fg">{d.defectCode}</span>
              {chip(SEV_CHIP[d.severity] ?? "bg-fg/10", t(SEVERITY_LABEL_KEYS[d.severity as typeof DEFECT_SEVERITIES[number]] ?? "priority.medium"))}
              {chip(OP_CHIP[d.operationalState] ?? "bg-fg/10", t(`def.op.${d.operationalState}` as TranslationKey))}
            </div>
            <AssetLabel id={d.assetId} className="block text-[13px] font-bold text-fg" />
            {d.description && <p className="text-xs text-text-industrial/60 line-clamp-2">{d.description}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-block rounded-lg border px-2 py-0.5 text-[10.5px] font-extrabold ${ST_CHIP[d.status] ?? ""}`}>{t(`def.st.${d.status}` as TranslationKey)}</span>
              {ageCell(d)}
            </div>
            {rowAction(d)}
          </div>
        ))}
      </div>

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
          initialAction={pendingAction}
          onClose={() => { setPendingAction(null); closeLink(); }}
          onSaved={() => {
            setPendingAction(null);
            closeLink();
            void reload();
            void reviewDue.reload();
          }}
          onReload={() => { void reload(); void reviewDue.reload(); }}
          onRecurrence={row => {
            setPendingAction(null);
            closeLink();
            setCreatePrefill({
              vesselCode: row.vesselCode,
              assetId: row.assetId,
              detail: `${t("def.verify.recurrence")} ${row.defectCode}: ${row.description}`,
            });
            setCreating(true);
          }}
        />
      )}
    </div>
  );
};
