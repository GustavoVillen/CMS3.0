import React, { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Droplets, Loader2, Sparkles, Wrench } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { useT, type TranslationKey } from "../lib/i18n";
import { useAuth, useCan } from "../lib/auth";
import { useEscapeGuard, useDirtyTracker } from "../lib/escape-guard";
import { WO_MAINTENANCE_KINDS } from "../lib/wo-form-catalog";
import { AssetSearchDropdown } from "./AssetSearchDropdown";
import { ModalCloseButton } from "./ModalCloseButton";
import { AssigneeSelect } from "./AssigneeSelect";
import { PlanLinkSuggestionDialog, type PlanLinkCandidate } from "./PlanLinkSuggestionDialog";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WoPrefill {
  source: "plan" | "defect" | "audit-finding" | "wo-deficiency";
  sourceId: string;
  sourceCode: string;
  sourceLabel: string;
  vesselCode: string;
  assetId: string;
  assetName?: string | null;
  // Cuando el origen no trae un activo (ej. finding de auditoría externa), el usuario
  // debe elegirlo: se renderiza un selector de activo dentro del modo prefill.
  assetSelectable?: boolean;
  type: string;
  priority?: string;
  criticality?: string;
  title?: string | null;
  description?: string | null;
  dueDate?: string | null;
  responsible?: string | null;
  acceptanceCriteria?: string | null;
  riskLevel?: string | null;
  riskAnalysisResult?: string | null;
  consequenceCategory?: "SAFETY" | "ENVIRONMENTAL" | "OPERATIONAL" | "NON_OPERATIONAL" | null;
  consequenceRationale?: string | null;
  estimatedHours?: number | null;
  checklistDocUrl?: string | null;
  loto?: string | null;
  samplingFluidType?: string | null;
  /**
   * Otros ítems del PDM que ejecuta la MISMA OT (parada de astillero). El plan
   * de `sourceId` es el principal: da equipo, título y datos heredados. Al
   * cerrar la OT avanzan todos. Solo aplica con source = "plan".
   */
  additionalPlans?: Array<{ id: string; taskCode: string; title: string; assetName?: string | null }>;
}

const FLUID_TYPE_KEYS: Record<string, TranslationKey> = {
  ENGINE_OIL:    "fluid.type.engineOil",
  HYDRAULIC_OIL: "fluid.type.hydraulicOil",
  GEAR_OIL:      "fluid.type.gearOil",
  FUEL:          "fluid.type.fuel",
  COOLANT:       "fluid.type.coolant",
  REFRIGERANT:   "fluid.type.coolant",
  OTHER:         "fluid.type.other",
};

/**
 * Valor de un campo que la OT hereda del plan. Vacío + el prefill nunca lo trajo
 * (`undefined`) ⇒ se manda `undefined`: el backend hereda del plan. Vacío pero
 * el prefill SÍ lo traía ⇒ el usuario lo borró a propósito, se manda `null`.
 */
function keepFromPlan(current: string, prefilled: string | null | undefined): string | null | undefined {
  const text = current.trim();
  if (text) return text;
  return prefilled === undefined ? undefined : null;
}

/**
 * Alto de un textarea según su contenido. Con varios ítems del PDM estos campos
 * traen un bloque por ítem: con el alto fijo de antes se veía sólo el primero y
 * parecía que faltaba el resto.
 */
function autoRows(text: string, min: number, max = 12): number {
  return Math.min(max, Math.max(min, text.split("\n").length));
}

/** Taller configurado en los planes de la OT (con para qué se lo contrata). */
interface PlanProviderPreview { id: string; name: string; purposes: string[]; taskCodes: string[] }

interface Asset { id: string; assetCode: string; name: string; }
interface Vessel { code: string; name: string; }
interface PlanCandidateApi {
  id: string; taskCode: string; title: string; triggerType: string;
  nextDueDate?: string | null; nextDueHours?: number | null; executionStatus?: string | null;
}
interface ExtractedFieldApi<T> { value: T | null; confidence: "high" | "medium" | "low"; }
interface ExtractedWorkOrderApi {
  title: ExtractedFieldApi<string>;
  description: ExtractedFieldApi<string>;
  acceptanceCriteria: ExtractedFieldApi<string>;
  priority: ExtractedFieldApi<"LOW" | "MEDIUM" | "HIGH" | "CRITICAL">;
  dueDate: ExtractedFieldApi<string>;
  assetReferenceText: ExtractedFieldApi<string>;
  assetIdSuggestion: { id: string; name: string; score: number } | null;
}

interface CreateWorkOrderModalProps {
  prefill?: WoPrefill;
  initialVesselCode?: string;
  onClose: () => void;
  onSaved: (woId: string) => void | Promise<void>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const labelCls = "block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider";
const inputCls = "w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 disabled:opacity-60";
// [value, label, activeCls, inactiveLabelCls]
const RISK_LEVEL_OPTS: [string, string, string, string][] = [
  ["LOW",      "L", "bg-success-sea text-[#0B132B] border-success-sea",       "text-success-sea border-success-sea/40"],
  ["MEDIUM",   "M", "bg-yellow-400 text-[#0B132B] border-yellow-400",         "text-yellow-700 dark:text-yellow-400 border-yellow-400/40"],
  ["HIGH",     "H", "bg-red-500 text-fg border-red-500",                    "text-red-700 dark:text-red-400 border-red-400/40"],
  ["CRITICAL", "C", "bg-red-700 text-fg border-red-700",                    "text-red-600 border-red-600/40"],
];

/**
 * TIPO para los tenants con el formulario REGI-OPE-26.3: los 5 del papel, más
 * "Inspección" — que el papel no lista pero la empresa usa al crear OT a mano.
 * Las 5 viajan como `maintenanceKind` (el backend deriva el type grueso);
 * "Inspección" viaja como `type`, porque no tiene equivalente fino.
 */
const WO_KIND_OPTIONS = [
  ...WO_MAINTENANCE_KINDS,
  { value: "INSPECTION", label: "Inspección" },
];

/** Tipo grueso de un prefill (ej. OT correctiva nacida de un defecto) → opción fina. */
function kindFromType(t?: string): string {
  if (t === "INSPECTION") return "INSPECTION";
  // Un correctivo que nace de un defecto es, por definición, no programado.
  if (t === "CORRECTIVE") return "CORRECTIVO_NO_PROGRAMADO";
  return "PREVENTIVO";
}

function TypeBadge({ type }: { type: string }) {
  const t = useT();
  if (type === "INSPECTION") return <span className="inline-block text-[10px] px-2 py-0.5 rounded-full border font-bold bg-teal-500/10 text-teal-700 dark:text-teal-400 border-teal-500/20">{t("wo.type.inspection")}</span>;
  if (type === "CORRECTIVE")  return <span className="inline-block text-[10px] px-2 py-0.5 rounded-full border font-bold bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20">{t("wo.type.corrective")}</span>;
  return <span className="inline-block text-[10px] px-2 py-0.5 rounded-full border font-bold bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20">{t("wo.type.preventive")}</span>;
}

// ── Component ─────────────────────────────────────────────────────────────────

export const CreateWorkOrderModal: React.FC<CreateWorkOrderModalProps> = ({ prefill, initialVesselCode, onClose, onSaved }) => {
  const t = useT();
  const { user, tenant } = useAuth();
  const isMercurio = !!tenant?.workOrderPdfTemplate?.startsWith("MERCURIO");
  // Solo TENANT_ADMIN puede backdatear la apertura y abrir en nombre de otro.
  const isAdmin = user?.role === "TENANT_ADMIN";
  const today = new Date().toISOString().slice(0, 10);

  // "Abierta por (en nombre de)": queda como SOLICITA / createdByUserId.
  const [onBehalfUserId, setOnBehalfUserId] = useState("");
  const [teamUsers, setTeamUsers] = useState<{ userId: string; firstName: string | null; lastName: string | null }[]>([]);

  // ── INFO fields (standalone mode only) ────────────────────────────────────
  const [vesselCode, setVesselCode]   = useState(prefill?.vesselCode ?? initialVesselCode ?? "");
  const [vessels, setVessels]         = useState<Vessel[]>([]);
  const [assetId, setAssetId]         = useState(prefill?.assetId ?? "");
  const [assets, setAssets]           = useState<Asset[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [resolvedAssetName, setResolvedAssetName] = useState(prefill?.assetName ?? null);
  const [type, setType]               = useState(prefill?.type ?? "PREVENTIVE");
  // Mercurio elige el tipo FINO del REGI-OPE-26.3 (5 opciones) en vez del grueso
  // (Preventivo/Correctivo/Inspección): es el que dice su formulario. El backend
  // deriva el grueso desde éste, así MTTR / OT→Defecto / reportes no se enteran.
  // "Inspección" no está en el papel pero se mantiene: la empresa la usa a mano
  // (ej. "Inspección subacua del sistema de propulsión").
  const [maintKind, setMaintKind]     = useState(kindFromType(prefill?.type));
  const [priority, setPriority]       = useState(prefill?.priority ?? "MEDIUM");
  const [criticality, setCriticality] = useState(prefill?.criticality ?? "B");
  const [openDate, setOpenDate]       = useState(today);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // ── PLAN fields ───────────────────────────────────────────────────────────
  // Arranque optimista con lo que trae el listado; el efecto de más abajo pide
  // al backend los textos combinados reales y los reemplaza.
  const [title, setTitle] = useState(() => {
    const extras = prefill?.additionalPlans ?? [];
    if (extras.length === 0) return prefill?.title ?? "";
    return [
      `${prefill!.sourceCode} · ${prefill!.title ?? ""}`.trim(),
      ...extras.map(p => `${p.taskCode} · ${p.title}`),
    ].join("\n");
  });
  // Valor con el que se abrió el título: sirve para no pisar lo que el usuario
  // haya escrito mientras llegaban los textos combinados del backend.
  const titleInitialRef = useRef(title);
  // Talleres a los que va este trabajo, según los planes. Se muestran debajo de
  // la tarea: quien abre la OT tiene que ver a quién se le va a encargar antes
  // de crearla (al guardar se abre una SS por taller).
  const [planProviders, setPlanProviders] = useState<PlanProviderPreview[]>([]);
  // El usuario puede mandarlo a otro taller distinto del que trae el plan,
  // ad hoc para esta OT (no toca la configuración del plan). Clave = providerId
  // original que trajo el plan, valor = providerId elegido.
  const [providerOverride, setProviderOverride] = useState<Record<string, string>>({});
  const [availableProviders, setAvailableProviders] = useState<Array<{ id: string; name: string }>>([]);
  useEffect(() => {
    if (planProviders.length === 0 || availableProviders.length > 0) return;
    api.get<{ items: Array<{ id: string; name: string }> }>("/app/providers?status=ACTIVE")
      .then(res => setAvailableProviders(res.items ?? []))
      .catch(() => setAvailableProviders([]));
  }, [planProviders.length, availableProviders.length]);
  const [description, setDescription]           = useState(prefill?.description ?? "");
  const [assignedTo, setAssignedTo]             = useState(prefill?.responsible ?? "");
  const [dueDate, setDueDate]                   = useState(prefill?.dueDate ? prefill.dueDate.slice(0, 10) : "");
  const [acceptanceCriteria, setAcceptanceCriteria] = useState(prefill?.acceptanceCriteria ?? "");
  const [loto, setLoto]                         = useState(prefill?.loto ?? "");
  const [riskLevel, setRiskLevel]               = useState(prefill?.riskLevel ?? "");
  const [riskAnalysisResult, setRiskAnalysisResult] = useState(prefill?.riskAnalysisResult ?? "");
  const [consequenceCategory, setConsequenceCategory] = useState<string>(prefill?.consequenceCategory ?? "");
  const [consequenceRationale, setConsequenceRationale] = useState(prefill?.consequenceRationale ?? "");
  const [estimatedHours, setEstimatedHours] = useState(prefill?.estimatedHours != null ? String(prefill.estimatedHours) : "");
  const [checklistDocFile, setChecklistDocFile] = useState<File | null>(null);

  /**
   * Textos heredados de los planes, tal como van a quedar guardados.
   *
   * El listado de planes NO trae los campos pesados (criterios, LOTO, análisis
   * de riesgo, justificación RCM) ni la tarea de los otros ítems, así que el
   * formulario los mostraba vacíos o sólo con el ítem principal. Se piden al
   * backend, que es el único que sabe combinarlos (un bloque por ítem, el
   * riesgo más alto y la consecuencia más grave).
   *
   * Sólo pisa un campo si sigue con el valor con el que se abrió la ventana:
   * si el usuario ya escribió algo mientras llegaba la respuesta, manda lo suyo.
   */
  useEffect(() => {
    if (prefill?.source !== "plan") return;
    const ids = [prefill.sourceId, ...(prefill.additionalPlans ?? []).map(p => p.id)];
    let cancelled = false;
    api.get<{
      title: string | null; description: string | null; acceptanceCriteria: string | null;
      loto: string | null; riskLevel: string | null; riskAnalysisResult: string | null;
      consequenceCategory: string | null; consequenceRationale: string | null;
      providers: PlanProviderPreview[];
    }>(`/app/pms/maintenance-plans/merged-text?ids=${ids.map(encodeURIComponent).join(",")}`)
      .then(m => {
        if (cancelled) return;
        setPlanProviders(m.providers ?? []);
        const keep = (setter: (fn: (prev: string) => string) => void, initial: string, next: string | null) => {
          setter(prev => (prev === initial ? (next ?? "") : prev));
        };
        keep(setTitle, titleInitialRef.current, m.title);
        keep(setDescription, prefill.description ?? "", m.description);
        keep(setAcceptanceCriteria, prefill.acceptanceCriteria ?? "", m.acceptanceCriteria);
        keep(setLoto, prefill.loto ?? "", m.loto);
        keep(setRiskLevel, prefill.riskLevel ?? "", m.riskLevel);
        keep(setRiskAnalysisResult, prefill.riskAnalysisResult ?? "", m.riskAnalysisResult);
        keep(setConsequenceCategory, prefill.consequenceCategory ?? "", m.consequenceCategory);
        keep(setConsequenceRationale, prefill.consequenceRationale ?? "", m.consequenceRationale);
      })
      .catch(() => { /* se queda con lo que trajo el listado */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState<string | null>(null);

  // ── AI: loading states + helpers para sugerir Criterios / LOTO / Riesgo / Consecuencia ──
  const [loadingTask,        setLoadingTask]        = useState(false);
  const [loadingCriteria,    setLoadingCriteria]    = useState(false);
  const [loadingLoto,        setLoadingLoto]        = useState(false);
  const [loadingRisk,        setLoadingRisk]        = useState(false);
  const [loadingConsequence, setLoadingConsequence] = useState(false);
  // IA: detección del activo que mejor corresponde a la deficiencia (modo audit-finding).
  const [suggestingAsset, setSuggestingAsset] = useState(false);
  const [assetSuggested,  setAssetSuggested]  = useState(false);
  const autoSuggestedAssetRef = useRef(false);

  // IA: sugerencia automática de a qué ítem(s) del plan de mantenimiento del
  // equipo podría corresponder esta OT (solo modo standalone). El vínculo real
  // se crea recién al guardar, y solo si el usuario confirma en el popup.
  const can = useCan();
  const canLinkPlan = can("wo.operate") || can("wo.manage");
  const [planLinkCandidates, setPlanLinkCandidates] = useState<PlanLinkCandidate[] | null>(null);
  const [planLinkMode, setPlanLinkMode] = useState<"confirm" | "choose" | null>(null);
  const [confirmedPlanIds, setConfirmedPlanIds] = useState<string[]>([]);
  // Estado del botón "Detectar" (manual) y del intento automático: antes esto
  // corría en silencio y si no encontraba nada no se enteraba nadie — por eso
  // parecía que "a veces no funcionaba". Ahora siempre queda un rastro visible.
  const [detectingPlanLink, setDetectingPlanLink] = useState(false);
  const [planLinkNoMatch, setPlanLinkNoMatch] = useState(false);
  // Guarda el assetId con el que ya se sugirió, para volver a sugerir si el
  // usuario cambia de equipo (a diferencia de la sugerencia de activo, que
  // corre una sola vez).
  const suggestedPlanForAssetRef = useRef<string | null>(null);

  // Etiqueta del activo a partir del prefill o de la lista cargada
  const aiAssetLabel = prefill?.sourceLabel
    ?? assets.find(a => a.id === assetId)?.name
    ?? null;
  const aiTaskDesc = description.trim() || title.trim() || null;

  // Sugerir las tareas a ejecutar. A diferencia del resto de las sugerencias,
  // ésta parte del TÍTULO (la tarea todavía está vacía: es lo que se completa).
  // Si ya hay texto escrito no se pisa: se agrega debajo.
  const handleTaskClick = useCallback(async () => {
    if (loadingTask) return;
    const base = title.trim();
    if (!base) {
      setErr(t("wo.ai.completeTitleFirstError"));
      return;
    }
    setLoadingTask(true);
    setErr(null);
    try {
      const yaEscrito = description.trim();
      const res = await api.post<{ text: string }>("/app/pms/work-orders/suggest-task", {
        assetLabel: aiAssetLabel,
        taskDesc: base,
        existingTasks: yaEscrito || null,
      });
      // Reemplaza, no agrega: cuando ya había tareas la IA devuelve la lista
      // completa con las del usuario integradas, así no quedan duplicadas ni
      // desordenadas.
      const sugerido = (res.text ?? "").trim();
      if (sugerido) setDescription(sugerido);
      else setErr(t("wo.ai.noText"));
    } catch (e) {
      console.error("[suggest-task] failed:", e);
      setErr(e instanceof ApiError ? `${t("wo.ai.taskPrefix")}: ${e.message}` : t("wo.ai.suggestFailed"));
    }
    finally { setLoadingTask(false); }
  }, [loadingTask, aiAssetLabel, title, description, t]);

  const handleCriteriaClick = useCallback(async () => {
    if (loadingCriteria) return;
    if (!aiTaskDesc) {
      setErr(t("wo.ai.completeTaskFirstError"));
      return;
    }
    setLoadingCriteria(true);
    setErr(null);
    try {
      const res = await api.post<{ text: string }>("/app/pms/work-orders/suggest-acceptance-criteria", {
        assetLabel: aiAssetLabel,
        taskDesc: aiTaskDesc,
      });
      if (res.text) setAcceptanceCriteria(res.text);
      else setErr(t("wo.ai.noText"));
    } catch (e) {
      console.error("[suggest-acceptance] failed:", e);
      setErr(e instanceof ApiError ? `${t("wo.ai.criteriaPrefix")}: ${e.message}` : t("wo.ai.suggestFailed"));
    }
    finally { setLoadingCriteria(false); }
  }, [loadingCriteria, aiAssetLabel, aiTaskDesc, t]);

  const handleLotoClick = useCallback(async () => {
    if (loadingLoto) return;
    if (!aiTaskDesc) {
      setErr(t("wo.ai.completeTaskFirstError"));
      return;
    }
    setLoadingLoto(true);
    setErr(null);
    try {
      const res = await api.post<{ text: string }>("/app/pms/work-orders/suggest-loto", {
        assetLabel: aiAssetLabel,
        taskDesc: aiTaskDesc,
        acceptanceCriteria: acceptanceCriteria || null,
      });
      if (res.text) setLoto(res.text);
      else setErr(t("wo.ai.noText"));
    } catch (e) {
      console.error("[suggest-loto] failed:", e);
      setErr(e instanceof ApiError ? `${t("wo.ai.lotoPrefix")}: ${e.message}` : t("wo.ai.suggestFailed"));
    }
    finally { setLoadingLoto(false); }
  }, [loadingLoto, aiAssetLabel, aiTaskDesc, acceptanceCriteria, t]);

  const handleRiskClick = useCallback(async () => {
    if (loadingRisk) return;
    if (!aiTaskDesc) {
      setErr(t("wo.ai.completeTaskFirstError"));
      return;
    }
    setLoadingRisk(true);
    setErr(null);
    try {
      const res = await api.post<{ level: string; analysis: string }>("/app/pms/work-orders/suggest-risk", {
        assetLabel: aiAssetLabel,
        taskDesc: aiTaskDesc,
        acceptanceCriteria: acceptanceCriteria || null,
        loto: loto || null,
      });
      if (res.level && ["LOW","MEDIUM","HIGH","CRITICAL"].includes(res.level)) setRiskLevel(res.level);
      if (res.analysis) setRiskAnalysisResult(res.analysis);
    } catch (e) {
      console.error("[suggest-risk] failed:", e);
      setErr(e instanceof ApiError ? `${t("wo.ai.riskPrefix")}: ${e.message}` : t("wo.ai.suggestFailed"));
    }
    finally { setLoadingRisk(false); }
  }, [loadingRisk, aiAssetLabel, aiTaskDesc, acceptanceCriteria, loto, t]);

  const handleConsequenceClick = useCallback(async () => {
    if (loadingConsequence) return;
    if (!aiTaskDesc) {
      setErr(t("wo.ai.completeTaskFirstError"));
      return;
    }
    setLoadingConsequence(true);
    setErr(null);
    try {
      const res = await api.post<{ category: string; rationale: string }>("/app/pms/work-orders/suggest-consequence", {
        assetName: aiAssetLabel ?? "",
        planTitle: title.trim() || null,
        planDescription: description.trim() || null,
      });
      if (res.category) setConsequenceCategory(res.category);
      if (res.rationale) setConsequenceRationale(res.rationale);
    } catch (e) {
      console.error("[suggest-consequence] failed:", e);
      setErr(e instanceof ApiError ? `${t("wo.ai.consequencePrefix")}: ${e.message}` : t("wo.ai.suggestFailed"));
    }
    finally { setLoadingConsequence(false); }
  }, [loadingConsequence, aiAssetLabel, aiTaskDesc, title, description, t]);

  // IA: detecta el activo que mejor corresponde a la deficiencia (solo modo audit-finding,
  // donde el origen no trae activo). Elige entre los equipos ya cargados del buque.
  const handleSuggestAsset = useCallback(async () => {
    if (!prefill?.assetSelectable || suggestingAsset || assets.length === 0) return;
    const taskDesc = (prefill.description ?? description).trim();
    if (!taskDesc) return;
    setSuggestingAsset(true);
    try {
      const res = await api.post<{ assetId: string | null }>("/app/pms/work-orders/suggest-asset", {
        taskDesc,
        assets: assets.map(a => ({ id: a.id, code: a.assetCode, name: a.name })),
      });
      if (res.assetId && assets.some(a => a.id === res.assetId)) {
        setAssetId(res.assetId);
        setAssetSuggested(true);
      }
    } catch (e) {
      console.error("[suggest-asset] failed:", e);
    } finally { setSuggestingAsset(false); }
  }, [prefill, suggestingAsset, assets, description]);

  // Auto-sugerir el activo una vez al abrir, cuando ya cargaron los equipos y no hay uno elegido.
  useEffect(() => {
    if (!prefill?.assetSelectable || autoSuggestedAssetRef.current) return;
    if (assets.length === 0 || assetId) return;
    if (!(prefill.description ?? "").trim()) return;
    autoSuggestedAssetRef.current = true;
    void handleSuggestAsset();
  }, [prefill, assets, assetId, handleSuggestAsset]);

  // IA: a qué ítem(s) del plan de mantenimiento del mismo equipo podría
  // corresponder esta OT. Solo en creación libre (standalone): la OT que ya
  // nace de un plan (prefill.source === "plan") ya viene vinculada.
  const handleSuggestPlanLinks = useCallback(async () => {
    if (prefill || !assetId || !canLinkPlan) return;
    const taskDesc = title.trim() || description.trim();
    if (!taskDesc) return;
    setDetectingPlanLink(true);
    setPlanLinkNoMatch(false);
    try {
      const plansRes = await api.get<{ items: PlanCandidateApi[] }>(
        `/app/pms/maintenance-plans?assetId=${encodeURIComponent(assetId)}&status=ACTIVE&limit=100`,
      );
      const items = plansRes.items ?? [];
      if (items.length === 0) { setPlanLinkNoMatch(true); return; }
      const res = await api.post<{ matches: { id: string; confidence: "high" | "medium" | "low" }[] }>(
        "/app/pms/work-orders/suggest-plan-links",
        {
          assetLabel: assets.find(a => a.id === assetId)?.name ?? null,
          title: title.trim() || null,
          taskDesc: description.trim() || null,
          plans: items.map(p => ({
            id: p.id, taskCode: p.taskCode, title: p.title, triggerType: p.triggerType,
            nextDueDate: p.nextDueDate, nextDueHours: p.nextDueHours, executionStatus: p.executionStatus,
          })),
        },
      );
      const matches = res.matches ?? [];
      if (matches.length === 0) { setPlanLinkNoMatch(true); return; }
      const candidates: PlanLinkCandidate[] = [];
      for (const m of matches) {
        const plan = items.find(p => p.id === m.id);
        if (!plan) continue;
        candidates.push({
          id: plan.id, taskCode: plan.taskCode, title: plan.title,
          nextDueDate: plan.nextDueDate, nextDueHours: plan.nextDueHours, confidence: m.confidence,
        });
      }
      if (candidates.length === 0) { setPlanLinkNoMatch(true); return; }
      const highs = candidates.filter(c => c.confidence === "high");
      setPlanLinkCandidates(candidates);
      setPlanLinkMode(candidates.length === 1 && highs.length === 1 ? "confirm" : "choose");
    } catch (e) {
      console.error("[suggest-plan-links] failed:", e);
      setPlanLinkNoMatch(true);
    } finally {
      setDetectingPlanLink(false);
    }
  }, [prefill, assetId, canLinkPlan, title, description, assets]);

  // Dispara la sugerencia automáticamente, sin que el usuario la pida, en
  // cuanto hay equipo + título/descripción cargados. Se re-arma si el usuario
  // cambia de equipo, para no sugerir en base a un equipo que ya no aplica.
  // Debounce de 800ms: sin esto, el efecto disparaba con la PRIMERA letra
  // tipeada (ej. "A" de "Análisis de Aceite") y marcaba el equipo como "ya
  // sugerido", mandándole a la IA un texto sin sentido y sin volver a
  // intentarlo aunque el usuario terminara de escribir el título real.
  useEffect(() => {
    if (prefill || !assetId || !canLinkPlan) return;
    if (!(title.trim() || description.trim())) return;
    if (suggestedPlanForAssetRef.current === assetId) return;
    const timer = setTimeout(() => {
      suggestedPlanForAssetRef.current = assetId;
      void handleSuggestPlanLinks();
    }, 800);
    return () => clearTimeout(timer);
  }, [prefill, assetId, canLinkPlan, title, description, handleSuggestPlanLinks]);

  // El aviso de "sin coincidencias" queda desactualizado en cuanto el usuario
  // sigue editando el título/tarea: se limpia para no sugerir que el texto
  // nuevo tampoco tiene plan, cuando en realidad todavía no se volvió a buscar.
  useEffect(() => { setPlanLinkNoMatch(false); }, [title, description]);

  // Al confirmar, el usuario dijo "esta OT ES este ítem del plan": hereda los
  // campos que el plan ya tiene definidos (criterios, LOTO, riesgo, RCM,
  // talleres) usando el mismo endpoint y el mismo criterio "no pisar lo que
  // el usuario ya escribió a mano" que usa el modo prefill=plan (ver
  // useEffect de arriba). Título y tarea son la excepción: se reemplazan por
  // los del plan aunque el usuario ya haya escrito algo — lo que había era
  // sólo el texto con el que se buscó la coincidencia, no la identidad
  // definitiva de la OT.
  const handlePlanLinkConfirm = useCallback(async (planIds: string[]) => {
    // El título pasa a ser "<código> <título del plan>" — misma identidad con
    // la que ese ítem se ve en todos lados (Ítems del PDM, PDF, etc.).
    const primary = planLinkCandidates?.find(c => c.id === planIds[0]);
    if (primary) setTitle(`${primary.taskCode} ${primary.title}`.trim());

    setConfirmedPlanIds(planIds);
    setPlanLinkCandidates(null);
    setPlanLinkMode(null);
    try {
      const merged = await api.get<{
        description: string | null;
        acceptanceCriteria: string | null; loto: string | null;
        riskLevel: string | null; riskAnalysisResult: string | null;
        consequenceCategory: string | null; consequenceRationale: string | null;
        providers: PlanProviderPreview[];
      }>(`/app/pms/maintenance-plans/merged-text?ids=${planIds.map(encodeURIComponent).join(",")}`);
      if (merged.description) setDescription(merged.description);
      if (!acceptanceCriteria.trim() && merged.acceptanceCriteria) setAcceptanceCriteria(merged.acceptanceCriteria);
      if (!loto.trim() && merged.loto) setLoto(merged.loto);
      if (!riskLevel && merged.riskLevel) setRiskLevel(merged.riskLevel);
      if (!riskAnalysisResult.trim() && merged.riskAnalysisResult) setRiskAnalysisResult(merged.riskAnalysisResult);
      if (!consequenceCategory && merged.consequenceCategory) setConsequenceCategory(merged.consequenceCategory);
      if (!consequenceRationale.trim() && merged.consequenceRationale) setConsequenceRationale(merged.consequenceRationale);
      if (merged.providers?.length) setPlanProviders(merged.providers);
    } catch (e) {
      console.error("[plan-link] merged-text failed:", e);
    }
  }, [planLinkCandidates, acceptanceCriteria, loto, riskLevel, riskAnalysisResult, consequenceCategory, consequenceRationale]);

  const handlePlanLinkDismiss = useCallback(() => {
    setPlanLinkCandidates(null);
    setPlanLinkMode(null);
  }, []);

  // Si el usuario cambia de equipo, los vínculos confirmados (y cualquier
  // sugerencia pendiente) quedaban referidos al equipo anterior: se descartan.
  useEffect(() => {
    setConfirmedPlanIds([]);
    setPlanLinkCandidates(null);
    setPlanLinkMode(null);
    setPlanLinkNoMatch(false);
  }, [assetId]);

  // IA: escanear una OT llenada a mano en papel (foto o PDF) y precompletar el
  // formulario. Solo en creación libre — nunca guarda nada por sí sola, el
  // usuario revisa y confirma con el botón Guardar de siempre.
  const scanInputRef = useRef<HTMLInputElement>(null);
  const [scanning, setScanning] = useState(false);
  const [scanNotice, setScanNotice] = useState<string | null>(null);

  const handleScanFile = useCallback(async (file: File) => {
    if (scanning) return;
    setScanning(true);
    setErr(null);
    setScanNotice(null);
    try {
      const res = await api.uploadRaw<{ extracted: ExtractedWorkOrderApi }>(
        "/app/pms/work-orders/extract-scan",
        file,
        {
          "X-Filename": encodeURIComponent(file.name),
          ...(vesselCode.trim() ? { "X-Vessel-Code": vesselCode.trim().toUpperCase() } : {}),
        },
      );
      const ex = res.extracted;
      const lowConfidenceLabels: string[] = [];
      const apply = (field: ExtractedFieldApi<string>, label: string, setter: (v: string) => void) => {
        if (!field.value) return;
        setter(field.value);
        if (field.confidence !== "high") lowConfidenceLabels.push(label);
      };
      apply(ex.title, t("wo.modal.titleField"), setTitle);
      apply(ex.description, t("wo.modal.task"), setDescription);
      apply(ex.acceptanceCriteria, t("wo.modal.acceptanceCriteria"), setAcceptanceCriteria);
      if (ex.priority.value) setPriority(ex.priority.value);
      if (ex.dueDate.value) setDueDate(ex.dueDate.value);
      // Solo preselecciona el equipo si ya está en la lista cargada del buque
      // (misma validación anti-alucinación que handleSuggestAsset): un id que
      // no está en `assets` sería de otro buque o inexistente.
      if (!assetId && ex.assetIdSuggestion && assets.some(a => a.id === ex.assetIdSuggestion!.id)) {
        setAssetId(ex.assetIdSuggestion.id);
        setAssetSuggested(true);
      }
      setScanNotice(lowConfidenceLabels.length > 0
        ? `${t("wo.ai.scan.reviewFields")}: ${lowConfidenceLabels.join(", ")}`
        : t("wo.ai.scan.done"));
    } catch (e) {
      console.error("[extract-scan] failed:", e);
      setErr(e instanceof ApiError ? e.message : t("wo.ai.scan.failed"));
    } finally { setScanning(false); }
  }, [scanning, vesselCode, assetId, assets, t]);

  // Usuarios del tenant para el selector "Abierta por (en nombre de)" — solo admin.
  // El endpoint /app/team/members ya es admin-only.
  useEffect(() => {
    if (!isAdmin) return;
    api.get<{ userId: string; firstName: string | null; lastName: string | null }[]>("/app/team/members")
      .then(rows => setTeamUsers(Array.isArray(rows) ? rows : []))
      .catch(() => setTeamUsers([]));
  }, [isAdmin]);

  // Vessel list for standalone mode
  useEffect(() => {
    if (prefill) return;
    api.get<{ items: Vessel[] }>("/app/vessels?limit=200")
      .then(res => setVessels(res.items ?? []))
      .catch(() => setVessels([]));
  }, [prefill]);

  // Asset lookup for standalone mode
  useEffect(() => {
    if (prefill) return;
    setAssets([]);
    setAssetId("");
    clearTimeout(debounceRef.current);
    const code = vesselCode.trim().toUpperCase();
    if (!code) return;
    debounceRef.current = setTimeout(async () => {
      setLoadingAssets(true);
      try {
        const res = await api.get<{ items: Asset[] }>(`/app/pms/assets?vesselCode=${encodeURIComponent(code)}&limit=200`);
        setAssets(res.items ?? []);
      } catch { setAssets([]); }
      finally { setLoadingAssets(false); }
    }, 400);
    return () => clearTimeout(debounceRef.current);
  }, [vesselCode, prefill]);

  // Asset list for prefill mode when the source has no asset (audit findings): user picks one.
  useEffect(() => {
    if (!prefill?.assetSelectable || !prefill.vesselCode) return;
    setLoadingAssets(true);
    api.get<{ items: Asset[] }>(`/app/pms/assets?vesselCode=${encodeURIComponent(prefill.vesselCode)}&limit=200`)
      .then(res => setAssets(res.items ?? []))
      .catch(() => setAssets([]))
      .finally(() => setLoadingAssets(false));
  }, [prefill]);

  // Resolve asset name from API when prefill has assetId but no assetName
  useEffect(() => {
    if (!prefill || prefill.assetSelectable || prefill.assetName || !prefill.assetId || !prefill.vesselCode) return;
    api.get<{ items: Asset[] }>(`/app/pms/assets?vesselCode=${encodeURIComponent(prefill.vesselCode)}&limit=200`)
      .then(res => {
        const found = res.items?.find(a => a.id === prefill.assetId);
        if (found) setResolvedAssetName(found.name);
      })
      .catch(() => {});
  }, [prefill]);

  const onSave = useCallback(async () => {
    setErr(null);
    if (!prefill) {
      if (!vesselCode.trim()) { setErr(t("wo.modal.vesselRequired")); return; }
      if (!assetId)           { setErr(t("wo.modal.equipmentRequired")); return; }
    } else if (prefill.assetSelectable && !assetId) {
      setErr(t("wo.modal.equipmentRequired")); return;
    }
    setSaving(true);
    try {
      let woId: string;

      if (prefill?.source === "plan") {
        const created = await api.post<{ id: string }>(`/app/pms/maintenance-plans/${prefill.sourceId}/open-work-order`, {
          title:              title.trim()              || undefined,
          description:        description.trim()        || undefined,
          assignedToUserId:   assignedTo.trim()         || undefined,
          dueDate:            dueDate                   || null,
          // Criterios, LOTO, análisis de riesgo y justificación RCM NO vienen en
          // el listado de planes (son los campos pesados que la lista recorta).
          // Si el prefill no los trajo, mandar null los borraría al abrir la OT:
          // se manda undefined = "no opino" y el backend hereda del plan (y con
          // varios ítems, arma el texto combinado de todos).
          acceptanceCriteria: keepFromPlan(acceptanceCriteria, prefill.acceptanceCriteria),
          loto:               keepFromPlan(loto, prefill.loto),
          riskLevel:          riskLevel                 || null,
          riskAnalysisResult: keepFromPlan(riskAnalysisResult, prefill.riskAnalysisResult),
          consequenceCategory: consequenceCategory || null,
          consequenceRationale: keepFromPlan(consequenceRationale, prefill.consequenceRationale),
          estimatedHours:     estimatedHours ? Number(estimatedHours) : null,
          // Solo admin: fecha de apertura y abrir en nombre de otro (SOLICITA).
          openDate:           isAdmin && openDate ? openDate : undefined,
          createdByUserId:    isAdmin && onBehalfUserId ? onBehalfUserId : undefined,
          // Otros ítems del PDM que cubre la misma OT.
          additionalPlanIds:  prefill.additionalPlans?.map(p => p.id),
          providerOverride:   Object.keys(providerOverride).length > 0 ? providerOverride : undefined,
        });
        woId = created.id;
      } else {
        const created = await api.post<{ id: string }>("/app/pms/work-orders", {
          vesselCode:         (prefill?.vesselCode ?? vesselCode).trim().toUpperCase(),
          assetId:            prefill?.assetSelectable ? assetId : (prefill?.assetId ?? assetId),
          // Mercurio manda el tipo fino y el backend deriva el grueso; el resto
          // sigue mandando el grueso. "Inspección" no tiene fino: va como type.
          ...(isMercurio
            ? (maintKind === "INSPECTION"
                ? { type: "INSPECTION" }
                : { maintenanceKind: maintKind })
            : { type: prefill?.type ?? type }),
          priority:           prefill?.priority ?? priority,
          criticality:        prefill?.criticality ?? criticality,
          openDate,
          dueDate:            dueDate || null,
          title:              title.trim()              || null,
          description:        description.trim()        || null,
          assignedToUserId:   assignedTo.trim()         || null,
          acceptanceCriteria: acceptanceCriteria.trim() || null,
          loto,
          riskLevel:          riskLevel                 || null,
          riskAnalysisResult: riskAnalysisResult.trim() || null,
          consequenceCategory: consequenceCategory || null,
          consequenceRationale: consequenceRationale.trim() || null,
          estimatedHours:     estimatedHours ? Number(estimatedHours) : null,
          // Solo admin: abrir en nombre de otro usuario (SOLICITA). openDate ya va arriba.
          createdByUserId:    isAdmin && onBehalfUserId ? onBehalfUserId : undefined,
        });
        woId = created.id;
      }

      // Upload checklist doc after WO is created (needs id)
      if (checklistDocFile && woId) {
        try {
          const res = await api.upload<{ url: string }>(`/app/attachments/upload?entityType=WorkOrder&entityId=${woId}`, checklistDocFile);
          if (res.url) {
            await api.patch(`/app/pms/work-orders/${woId}`, { checklistDocUrl: res.url });
          }
        } catch { /* non-blocking */ }
      }

      // Vincular los ítems del plan que el usuario confirmó en el popup de la
      // IA. La OT ya quedó guardada: si un vínculo falla no se pierde el alta
      // (se puede vincular a mano desde la orden después) — mismo criterio
      // no bloqueante que el adjunto de checklist, arriba.
      if (confirmedPlanIds.length > 0 && woId) {
        const hasOverride = Object.keys(providerOverride).length > 0;
        for (const planId of confirmedPlanIds) {
          try {
            await api.post(`/app/pms/work-orders/${woId}/plans`, {
              planId, providerOverride: hasOverride ? providerOverride : undefined,
            });
          }
          catch (e) { console.error("[link-plan] failed:", e); }
        }
      }

      await onSaved(woId);
    } catch (e) { setErr(e instanceof ApiError ? e.message : t("common.saveError")); }
    finally { setSaving(false); }
  }, [prefill, vesselCode, assetId, type, priority, criticality, openDate, dueDate,
      title, description, assignedTo, acceptanceCriteria, loto, riskLevel, riskAnalysisResult,
      consequenceCategory, consequenceRationale, estimatedHours,
      checklistDocFile, confirmedPlanIds, providerOverride, isAdmin, onBehalfUserId, onSaved, t]);

  // ESC guard
  const isDirty = useDirtyTracker({
    vesselCode, assetId, type, priority, criticality, openDate, dueDate,
    title, description, assignedTo, acceptanceCriteria, loto, riskLevel, riskAnalysisResult,
    consequenceCategory, consequenceRationale, estimatedHours,
    checklistDocFileName: checklistDocFile?.name ?? "",
    onBehalfUserId,
  });
  const requestClose = useEscapeGuard({ isDirty, onSave, onClose });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-2xl bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-fg/10 shrink-0">
          <div className="flex items-center gap-3">
            <Wrench className="w-4 h-4 text-accent" />
            <div>
              <h2 className="text-sm font-bold text-fg">{t("wo.modal.title")}</h2>
              {prefill && (
                <p className="text-[10px] text-text-industrial/50 mt-0.5">
                  {t("wo.modal.fromSource")} {prefill.sourceLabel}: <span className="font-mono text-accent">{prefill.sourceCode}</span>
                </p>
              )}
            </div>
          </div>
          <ModalCloseButton onClose={requestClose} />
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-6 space-y-6">

          {/* ── INFORMACIÓN ── */}
          <section>
            <p className="text-[10px] uppercase tracking-widest text-text-industrial/40 font-semibold mb-3">{t("wo.modal.section.info")}</p>

            {!prefill && (
              <div className="mb-3">
                <input ref={scanInputRef} type="file"
                  accept="application/pdf,image/jpeg,image/png,image/gif,image/webp"
                  capture="environment" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) void handleScanFile(f); e.target.value = ""; }} />
                <button type="button" onClick={() => scanInputRef.current?.click()}
                  disabled={scanning || !vesselCode.trim()}
                  title={!vesselCode.trim() ? t("wo.ai.scan.selectVesselFirst") : t("wo.ai.scan.tooltip")}
                  className={`flex items-center gap-1.5 text-xs font-semibold text-accent transition-colors disabled:opacity-40 ${!scanning && vesselCode.trim() ? "hover:text-fg cursor-pointer" : ""}`}>
                  {scanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
                  {t("wo.ai.scan.button")}
                </button>
                {scanNotice && (
                  <p className="text-[10px] text-accent mt-1 flex items-center gap-1">
                    <Sparkles className="w-3 h-3 shrink-0" /> {scanNotice}
                  </p>
                )}
              </div>
            )}

            {prefill ? (
              <div className="space-y-3">
                {/* Ítems del PDM que cubre esta OT. Solo aparece cuando se
                    generó una sola orden desde varios planes (astillero). */}
                {prefill.additionalPlans && prefill.additionalPlans.length > 0 && (
                  <div className="rounded-xl border border-accent/25 bg-accent/[0.06] p-3 space-y-1.5">
                    <p className="text-[10px] uppercase tracking-widest text-accent font-bold">
                      Ítems del PDM incluidos ({prefill.additionalPlans.length + 1})
                    </p>
                    <p className="text-[11px] text-fg">
                      <span className="font-mono font-bold">{prefill.sourceCode}</span>
                      <span className="text-text-industrial/60"> · {prefill.title}</span>
                    </p>
                    {prefill.additionalPlans.map(p => (
                      <p key={p.id} className="text-[11px] text-fg">
                        <span className="font-mono font-bold">{p.taskCode}</span>
                        <span className="text-text-industrial/60"> · {p.title}{p.assetName ? ` · ${p.assetName}` : ""}</span>
                      </p>
                    ))}
                    <p className="text-[10px] text-text-industrial/50 pt-0.5">
                      Al cerrar la orden se dan por ejecutados todos estos ítems.
                    </p>
                  </div>
                )}
                {prefill.assetSelectable && (
                  <div className="space-y-1.5">
                    <label
                      onClick={() => { void handleSuggestAsset(); }}
                      title={t("wo.ai.suggestAssetTooltip")}
                      className={`flex items-center gap-1.5 text-xs font-semibold text-accent uppercase tracking-wider transition-colors ${assets.length > 0 ? `hover:text-fg cursor-pointer ${suggestingAsset ? "opacity-60 animate-pulse" : ""}` : "opacity-50"}`}
                    >
                      {suggestingAsset ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                      {t("wo.modal.equipment")} *
                    </label>
                    {loadingAssets
                      ? <div className="flex items-center gap-2 py-2.5"><Loader2 className="w-3.5 h-3.5 animate-spin text-accent" /><span className="text-xs text-text-industrial/50">{t("common.loading")}</span></div>
                      : assets.length > 0
                        ? <AssetSearchDropdown assets={assets} value={assetId}
                            onChange={id => { setAssetId(id); setAssetSuggested(false); }}
                            placeholder={t("wo.modal.selectEquipment")} />
                        : <input value={assetId} onChange={e => { setAssetId(e.target.value); setAssetSuggested(false); }}
                            placeholder={t("wo.modal.noEquipmentEnterId")} className={inputCls} />
                    }
                    {assetSuggested && assetId && (
                      <p className="text-[10px] text-accent flex items-center gap-1">
                        <Sparkles className="w-3 h-3" /> {t("wo.ai.assetSuggested")}
                      </p>
                    )}
                  </div>
                )}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {([
                    [t("wo.modal.vessel"),    prefill.vesselCode,                   "font-mono text-accent"],
                    prefill.assetSelectable
                      ? null
                      : [t("wo.modal.equipment"), resolvedAssetName ?? prefill.assetId, "text-fg"],
                    [t("wo.modal.type"),      null, null, <TypeBadge key="t" type={prefill.type} />],
                    [t("wo.modal.priority"),  prefill.priority   ?? "MEDIUM",       "text-fg"],
                    [t("wo.modal.criticality"), prefill.criticality ?? "B",         "text-fg"],
                    prefill.dueDate
                      ? [t("wo.modal.nextDueDate"), prefill.dueDate.slice(0, 10), "text-fg"]
                      : null,
                  ].filter(Boolean) as [string, string | null, string | null, React.ReactNode?][]).map(([label, value, cls, node], i) => (
                    <div key={i} className="bg-fg/5 border border-fg/10 rounded-xl p-2.5">
                      <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{label}</p>
                      {node ?? <p className={`text-xs mt-0.5 ${cls ?? ""}`}>{value || "—"}</p>}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className={labelCls}>{t("wo.modal.vessel")} *</label>
                    <select value={vesselCode} onChange={e => setVesselCode(e.target.value)} className={inputCls}>
                      <option value="">{t("wo.modal.selectVessel")}</option>
                      {vessels.map(v => (
                        <option key={v.code} value={v.code}>{v.code} — {v.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className={labelCls}>{t("wo.modal.equipment")} *</label>
                    {loadingAssets
                      ? <div className="flex items-center gap-2 py-2.5"><Loader2 className="w-3.5 h-3.5 animate-spin text-accent" /><span className="text-xs text-text-industrial/50">{t("common.loading")}</span></div>
                      : assets.length > 0
                        ? <AssetSearchDropdown assets={assets} value={assetId} onChange={setAssetId}
                            placeholder={t("wo.modal.selectEquipment")} />
                        : <input value={assetId} onChange={e => setAssetId(e.target.value)}
                            placeholder={vesselCode ? t("wo.modal.noEquipmentEnterId") : t("wo.modal.enterVesselFirst")}
                            className={inputCls} />
                    }
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <label className={labelCls}>{t("wo.modal.type")}</label>
                    {isMercurio ? (
                      <select value={maintKind} onChange={e => setMaintKind(e.target.value)} className={inputCls}>
                        {WO_KIND_OPTIONS.map(o => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    ) : (
                      <select value={type} onChange={e => setType(e.target.value)} className={inputCls}>
                        <option value="PREVENTIVE">{t("wo.type.preventive")}</option>
                        <option value="CORRECTIVE">{t("wo.type.corrective")}</option>
                        <option value="INSPECTION">{t("wo.type.inspection")}</option>
                      </select>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <label className={labelCls}>{t("wo.modal.priority")}</label>
                    <select value={priority} onChange={e => setPriority(e.target.value)} title={t("priority.hint")} className={inputCls}>
                      <option value="LOW">{t("priority.low")}</option>
                      <option value="MEDIUM">{t("priority.medium")}</option>
                      <option value="HIGH">{t("priority.high")}</option>
                      <option value="CRITICAL">{t("priority.critical")}</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className={labelCls}>{t("wo.modal.criticality")}</label>
                    <select value={criticality} onChange={e => setCriticality(e.target.value)} className={inputCls}>
                      <option value="A">A</option>
                      <option value="B">B</option>
                      <option value="C">C</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className={labelCls}>{t("wo.modal.openDate")}</label>
                    <input type="date" value={openDate} onChange={e => setOpenDate(e.target.value)} className={inputCls} />
                  </div>
                  <div className="space-y-1.5">
                    <label className={labelCls}>{t("wo.modal.dueDate")}</label>
                    <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className={inputCls} />
                  </div>
                </div>
              </div>
            )}

            {/* Admin: fecha de apertura (backdating) + abrir en nombre de otro usuario.
                En modo standalone la fecha de apertura ya está arriba, así que acá
                solo se agrega cuando el origen es un plan (donde no estaba). */}
            {isAdmin && (
              <div className="grid grid-cols-2 gap-3 mt-3 pt-3 border-t border-fg/10">
                {prefill && (
                  <div className="space-y-1.5">
                    <label className={labelCls}>{t("wo.modal.openDate")}</label>
                    <input type="date" value={openDate} onChange={e => setOpenDate(e.target.value)} className={inputCls} />
                  </div>
                )}
                <div className="space-y-1.5">
                  <label className={labelCls}>{t("wo.modal.openedBy")}</label>
                  <select value={onBehalfUserId} onChange={e => setOnBehalfUserId(e.target.value)} className={inputCls}>
                    <option value="">{t("wo.modal.openedBySelf")}</option>
                    {teamUsers.map(u => (
                      <option key={u.userId} value={u.userId}>
                        {[u.firstName, u.lastName].filter(Boolean).join(" ") || u.userId}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </section>

          {/* ── PLAN ── */}
          <section className="space-y-4">
            <p className="text-[10px] uppercase tracking-widest text-text-industrial/40 font-semibold border-t border-fg/10 pt-4">{t("wo.modal.section.plan")}</p>

            <div className="space-y-1.5">
              <label className={labelCls}>{t("wo.modal.titleField")}</label>
              {/* Textarea, no input: cuando la OT cubre varios ítems del PDM el
                  título es una línea por ítem y en un input se vería sólo la
                  primera. Con un solo ítem se ve igual que antes (una fila). */}
              <textarea
                rows={Math.min(6, Math.max(1, title.split("\n").length))}
                value={title}
                onChange={e => setTitle(e.target.value)}
                className={`${inputCls} resize-y`}
                placeholder={t("wo.modal.titlePlaceholder")}
              />
            </div>

            {/* Detección de plan: corre sola una vez por equipo (silenciosa si
                no encuentra nada), pero acá se puede repetir a mano en
                cualquier momento — típicamente después de terminar de escribir
                el título, que es cuando el intento automático ya pasó. */}
            {!prefill && canLinkPlan && (
              <div className="space-y-1">
                <button
                  type="button"
                  onClick={() => { void handleSuggestPlanLinks(); }}
                  disabled={detectingPlanLink || !assetId || !(title.trim() || description.trim())}
                  title={!assetId ? t("wo.ai.planLink.detectNeedsEquipment") : !(title.trim() || description.trim()) ? t("wo.ai.completeTitleFirst") : t("wo.ai.planLink.detectTooltip")}
                  className={`flex items-center gap-1.5 text-xs font-semibold text-accent transition-colors disabled:opacity-40 ${!detectingPlanLink && assetId && (title.trim() || description.trim()) ? "hover:text-fg cursor-pointer" : ""}`}
                >
                  {detectingPlanLink ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  {t("wo.ai.planLink.detectButton")}
                </button>
                {planLinkNoMatch && (
                  <p className="text-[10px] text-text-industrial/50">{t("wo.ai.planLink.noMatch")}</p>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              {/* Clic en el rótulo = la IA propone las tareas a partir del
                  equipo y el título (mismo gesto que Criterios / LOTO / Riesgo). */}
              <label
                onClick={handleTaskClick}
                title={!title.trim() ? t("wo.ai.completeTitleFirst") : t("wo.ai.taskTooltip")}
                className={`flex items-center gap-1.5 text-xs font-semibold text-accent uppercase tracking-wider transition-colors ${title.trim() ? `hover:text-fg cursor-pointer ${loadingTask ? "opacity-60 animate-pulse" : ""}` : "opacity-50"}`}
              >
                {loadingTask ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                {t("wo.modal.task")}
              </label>
              <textarea rows={autoRows(description, 3)} value={description} onChange={e => setDescription(e.target.value)}
                disabled={loadingTask}
                className={`${inputCls} resize-y`} />
            </div>

            {/* Talleres del trabajo. Sale de los planes (área = Proveedor): al
                crear la OT se abre una solicitud de servicio por cada uno. Va
                acá, debajo de la tarea, para que se vea a quién se le encarga
                antes de crear la orden. */}
            {planProviders.length > 0 && (
              <div className="rounded-xl border border-accent/25 bg-accent/[0.06] p-3 space-y-1.5">
                <p className="text-[10px] uppercase tracking-widest text-accent font-bold">
                  {planProviders.length === 1 ? "Proveedor" : `Proveedores (${planProviders.length})`}
                </p>
                {planProviders.map(p => (
                  <div key={p.id} className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-fg">
                    {availableProviders.length > 0 ? (
                      <select
                        value={providerOverride[p.id] ?? p.id}
                        onChange={e => setProviderOverride(prev => ({ ...prev, [p.id]: e.target.value }))}
                        className="bg-fg/5 border border-fg/10 rounded px-1.5 py-0.5 text-[11px] font-semibold text-fg focus:outline-none focus:border-accent/50"
                      >
                        {!availableProviders.some(ap => ap.id === p.id) && <option value={p.id}>{p.name}</option>}
                        {availableProviders.map(ap => <option key={ap.id} value={ap.id}>{ap.name}</option>)}
                      </select>
                    ) : (
                      <span className="font-semibold">{p.name}</span>
                    )}
                    {p.purposes.length > 0 && (
                      <span className="text-text-industrial/60">· {p.purposes.join(" / ")}</span>
                    )}
                    {p.taskCodes.length > 0 && (
                      <span className="text-text-industrial/45 font-mono">· {p.taskCodes.join(", ")}</span>
                    )}
                  </div>
                ))}
                <p className="text-[10px] text-text-industrial/50 pt-0.5">
                  {planProviders.length === 1
                    ? "Al crear la orden se abre una solicitud de servicio para este taller."
                    : "Al crear la orden se abre una solicitud de servicio por taller."}
                </p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className={labelCls}>{t("wo.modal.assignee")}</label>
                <AssigneeSelect value={assignedTo} onChange={setAssignedTo} className={inputCls} />
              </div>
              <div className="space-y-1.5">
                <label className={labelCls}>{t("wo.modal.dueDate")}</label>
                <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className={inputCls} />
              </div>
            </div>
            <div className="space-y-1.5">
              <label
                onClick={handleCriteriaClick}
                title={!aiTaskDesc ? t("wo.ai.completeTaskFirst") : t("wo.ai.criteriaTooltip")}
                className={`flex items-center gap-1.5 text-xs font-semibold text-accent uppercase tracking-wider transition-colors ${aiTaskDesc ? `hover:text-fg cursor-pointer ${loadingCriteria ? "opacity-60 animate-pulse" : ""}` : "opacity-50"}`}
              >
                {loadingCriteria ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                {t("wo.modal.acceptanceCriteria")}
              </label>
              <textarea rows={autoRows(acceptanceCriteria, 2)} value={acceptanceCriteria} onChange={e => setAcceptanceCriteria(e.target.value)}
                disabled={loadingCriteria}
                className={`${inputCls} resize-y`} placeholder={t("wo.modal.acceptancePlaceholder")} />
            </div>
            <div className="space-y-1.5">
              <label
                onClick={handleLotoClick}
                title={!aiTaskDesc ? t("wo.ai.completeTaskFirst") : t("wo.ai.lotoTooltip")}
                className={`flex items-center gap-1.5 text-xs font-semibold text-accent uppercase tracking-wider transition-colors ${aiTaskDesc ? `hover:text-fg cursor-pointer ${loadingLoto ? "opacity-60 animate-pulse" : ""}` : "opacity-50"}`}
              >
                {loadingLoto ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                {t("wo.modal.loto")}
              </label>
              <textarea rows={autoRows(loto, 2)} value={loto} onChange={e => setLoto(e.target.value)}
                disabled={loadingLoto}
                className={`${inputCls} resize-y`} placeholder={t("wo.modal.lotoPlaceholder")} />
            </div>
            <div className="space-y-1.5">
              <label
                onClick={handleRiskClick}
                title={!aiTaskDesc ? t("wo.ai.completeTaskFirst") : t("wo.ai.riskTooltip")}
                className={`flex items-center gap-1.5 text-xs font-semibold text-accent uppercase tracking-wider transition-colors ${aiTaskDesc ? `hover:text-fg cursor-pointer ${loadingRisk ? "opacity-60 animate-pulse" : ""}` : "opacity-50"}`}
              >
                {loadingRisk ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                {t("wo.modal.riskLevel")}
                <span className="text-[10px] normal-case font-normal text-text-industrial/50 ml-1">{t("wo.modal.riskLevelHint")}</span>
              </label>
              <div className="flex gap-1.5">
                {RISK_LEVEL_OPTS.map(([val, label, activeCls, inactiveLabelCls]) => (
                  <button key={val} type="button"
                    disabled={loadingRisk}
                    onClick={() => setRiskLevel(riskLevel === val ? "" : val)}
                    className={`w-9 h-9 rounded-lg border font-bold text-sm transition-all disabled:opacity-50 ${riskLevel === val ? activeCls : `bg-fg/5 ${inactiveLabelCls} hover:bg-fg/10`}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <label className={labelCls}>{t("wo.modal.riskAnalysisResult")}</label>
              <textarea rows={autoRows(riskAnalysisResult, 2)} value={riskAnalysisResult} onChange={e => setRiskAnalysisResult(e.target.value)}
                disabled={loadingRisk}
                className={`${inputCls} resize-y`} placeholder={t("wo.modal.riskPlaceholder")} />
            </div>

            {/* RCM consecuencia */}
            <div className="space-y-1.5">
              <label
                onClick={handleConsequenceClick}
                title={!aiTaskDesc ? t("wo.ai.completeTaskFirst") : t("wo.modal.consequenceTooltip")}
                className={`flex items-center gap-1.5 text-xs font-semibold text-accent uppercase tracking-wider transition-colors ${aiTaskDesc ? `hover:text-fg cursor-pointer ${loadingConsequence ? "opacity-60 animate-pulse" : ""}` : "opacity-50"}`}
              >
                {loadingConsequence ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                {t("wo.modal.consequenceCategory")}
              </label>
              <select value={consequenceCategory} onChange={e => setConsequenceCategory(e.target.value)}
                disabled={loadingConsequence} className={inputCls}>
                <option value="">—</option>
                <option value="SAFETY">{t("wo.modal.consequence.safety")}</option>
                <option value="ENVIRONMENTAL">{t("wo.modal.consequence.environmental")}</option>
                <option value="OPERATIONAL">{t("wo.modal.consequence.operational")}</option>
                <option value="NON_OPERATIONAL">{t("wo.modal.consequence.nonOperational")}</option>
              </select>
            </div>
            {consequenceCategory && (
              <div className="space-y-1.5">
                <label className={labelCls}>{t("wo.modal.consequenceRationale")}</label>
                <textarea rows={autoRows(consequenceRationale, 2)} value={consequenceRationale} onChange={e => setConsequenceRationale(e.target.value)}
                  disabled={loadingConsequence}
                  className={`${inputCls} resize-y`} placeholder={t("wo.modal.consequenceRationalePlaceholder")} />
              </div>
            )}

            {/* Horas estimadas */}
            <div className="space-y-1.5">
              <label className={labelCls}>{t("wo.modal.estimatedHours")}</label>
              <input type="number" min="0" step="0.5" value={estimatedHours}
                onChange={e => setEstimatedHours(e.target.value)}
                className={inputCls} placeholder="—" />
            </div>

            <div className="space-y-1.5">
              <label className={labelCls}>{t("wo.modal.checklistDoc")}</label>
              {prefill?.checklistDocUrl ? (
                <a href={prefill.checklistDocUrl} target="_blank" rel="noreferrer"
                  className="block text-xs text-accent underline truncate">{prefill.checklistDocUrl}</a>
              ) : !prefill ? (
                <input type="file" onChange={e => setChecklistDocFile(e.target.files?.[0] ?? null)}
                  className="block w-full text-xs text-text-industrial/60 file:mr-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-accent/10 file:text-accent hover:file:bg-accent/20 cursor-pointer" />
              ) : (
                <p className="text-xs text-text-industrial/40 italic">{t("wo.modal.noChecklistDoc")}</p>
              )}
            </div>
          </section>

          {prefill?.samplingFluidType && (
            <div className="flex items-start gap-2.5 bg-teal-500/10 border border-teal-500/25 rounded-xl px-4 py-3">
              <Droplets className="w-4 h-4 text-teal-700 dark:text-teal-400 mt-0.5 shrink-0" />
              <p className="text-xs text-teal-700 dark:text-teal-300 leading-relaxed">
                {t("wo.modal.fluidSampleNotice").split("{fluid}").map((part, i, arr) => (
                  <React.Fragment key={i}>
                    {part}
                    {i < arr.length - 1 && (
                      <span className="font-semibold">
                        {FLUID_TYPE_KEYS[prefill.samplingFluidType!]
                          ? t(FLUID_TYPE_KEYS[prefill.samplingFluidType!])
                          : prefill.samplingFluidType}
                      </span>
                    )}
                  </React.Fragment>
                ))}
              </p>
            </div>
          )}

          {err && <p className="text-xs text-red-700 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{err}</p>}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-fg/10 shrink-0">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-fg">{t("common.cancel")}</button>
          <button onClick={() => { void onSave(); }} disabled={saving}
            className="px-4 py-2 rounded-xl bg-accent text-accent-fg font-bold text-xs hover:brightness-110 disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : t("wo.modal.create")}
          </button>
        </div>
      </div>

      {planLinkCandidates && planLinkMode && (
        <PlanLinkSuggestionDialog
          candidates={planLinkCandidates}
          mode={planLinkMode}
          onConfirm={handlePlanLinkConfirm}
          onDismiss={handlePlanLinkDismiss}
        />
      )}
    </div>
  );
};
