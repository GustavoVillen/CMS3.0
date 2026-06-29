import React, { useCallback, useEffect, useRef, useState } from "react";
import { Droplets, Loader2, Sparkles, Wrench, X } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { useT, type TranslationKey } from "../lib/i18n";
import { useAuth } from "../lib/auth";
import { useEscapeGuard, useDirtyTracker } from "../lib/escape-guard";
import { AssetSearchDropdown } from "./AssetSearchDropdown";

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

interface Asset { id: string; assetCode: string; name: string; }
interface Vessel { code: string; name: string; }

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

function TypeBadge({ type }: { type: string }) {
  const t = useT();
  if (type === "INSPECTION") return <span className="inline-block text-[10px] px-2 py-0.5 rounded-full border font-bold bg-teal-500/10 text-teal-700 dark:text-teal-400 border-teal-500/20">{t("wo.type.inspection")}</span>;
  if (type === "CORRECTIVE")  return <span className="inline-block text-[10px] px-2 py-0.5 rounded-full border font-bold bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20">{t("wo.type.corrective")}</span>;
  return <span className="inline-block text-[10px] px-2 py-0.5 rounded-full border font-bold bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20">{t("wo.type.preventive")}</span>;
}

// ── Component ─────────────────────────────────────────────────────────────────

export const CreateWorkOrderModal: React.FC<CreateWorkOrderModalProps> = ({ prefill, initialVesselCode, onClose, onSaved }) => {
  const t = useT();
  const { user } = useAuth();
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
  const [priority, setPriority]       = useState(prefill?.priority ?? "MEDIUM");
  const [criticality, setCriticality] = useState(prefill?.criticality ?? "B");
  const [openDate, setOpenDate]       = useState(today);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // ── PLAN fields ───────────────────────────────────────────────────────────
  const [title, setTitle]                       = useState(prefill?.title ?? "");
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

  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState<string | null>(null);

  // ── AI: loading states + helpers para sugerir Criterios / LOTO / Riesgo / Consecuencia ──
  const [loadingCriteria,    setLoadingCriteria]    = useState(false);
  const [loadingLoto,        setLoadingLoto]        = useState(false);
  const [loadingRisk,        setLoadingRisk]        = useState(false);
  const [loadingConsequence, setLoadingConsequence] = useState(false);
  // IA: detección del activo que mejor corresponde a la deficiencia (modo audit-finding).
  const [suggestingAsset, setSuggestingAsset] = useState(false);
  const [assetSuggested,  setAssetSuggested]  = useState(false);
  const autoSuggestedAssetRef = useRef(false);

  // Etiqueta del activo a partir del prefill o de la lista cargada
  const aiAssetLabel = prefill?.sourceLabel
    ?? assets.find(a => a.id === assetId)?.name
    ?? null;
  const aiTaskDesc = description.trim() || title.trim() || null;

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
          acceptanceCriteria: acceptanceCriteria.trim() || null,
          loto,
          riskLevel:          riskLevel                 || null,
          riskAnalysisResult: riskAnalysisResult.trim() || null,
          consequenceCategory: consequenceCategory || null,
          consequenceRationale: consequenceRationale.trim() || null,
          estimatedHours:     estimatedHours ? Number(estimatedHours) : null,
          // Solo admin: fecha de apertura y abrir en nombre de otro (SOLICITA).
          openDate:           isAdmin && openDate ? openDate : undefined,
          createdByUserId:    isAdmin && onBehalfUserId ? onBehalfUserId : undefined,
        });
        woId = created.id;
      } else {
        const created = await api.post<{ id: string }>("/app/pms/work-orders", {
          vesselCode:         (prefill?.vesselCode ?? vesselCode).trim().toUpperCase(),
          assetId:            prefill?.assetSelectable ? assetId : (prefill?.assetId ?? assetId),
          type:               prefill?.type    ?? type,
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

      await onSaved(woId);
    } catch (e) { setErr(e instanceof ApiError ? e.message : t("common.saveError")); }
    finally { setSaving(false); }
  }, [prefill, vesselCode, assetId, type, priority, criticality, openDate, dueDate,
      title, description, assignedTo, acceptanceCriteria, loto, riskLevel, riskAnalysisResult,
      consequenceCategory, consequenceRationale, estimatedHours,
      checklistDocFile, isAdmin, onBehalfUserId, onSaved, t]);

  // ESC guard
  const isDirty = useDirtyTracker({
    vesselCode, assetId, type, priority, criticality, openDate, dueDate,
    title, description, assignedTo, acceptanceCriteria, loto, riskLevel, riskAnalysisResult,
    consequenceCategory, consequenceRationale, estimatedHours,
    checklistDocFileName: checklistDocFile?.name ?? "",
    onBehalfUserId,
  });
  useEscapeGuard({ isDirty, onSave, onClose });

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
          <button onClick={onClose}><X className="w-5 h-5 text-text-industrial/40 hover:text-fg" /></button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-6 space-y-6">

          {/* ── INFORMACIÓN ── */}
          <section>
            <p className="text-[10px] uppercase tracking-widest text-text-industrial/40 font-semibold mb-3">{t("wo.modal.section.info")}</p>

            {prefill ? (
              <div className="space-y-3">
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
                    <select value={type} onChange={e => setType(e.target.value)} className={inputCls}>
                      <option value="PREVENTIVE">{t("wo.type.preventive")}</option>
                      <option value="CORRECTIVE">{t("wo.type.corrective")}</option>
                      <option value="INSPECTION">{t("wo.type.inspection")}</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className={labelCls}>{t("wo.modal.priority")}</label>
                    <select value={priority} onChange={e => setPriority(e.target.value)} className={inputCls}>
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
              <input value={title} onChange={e => setTitle(e.target.value)} className={inputCls} placeholder={t("wo.modal.titlePlaceholder")} />
            </div>
            <div className="space-y-1.5">
              <label className={labelCls}>{t("wo.modal.task")}</label>
              <textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} className={`${inputCls} resize-y`} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className={labelCls}>{t("wo.modal.assignee")}</label>
                <input value={assignedTo} onChange={e => setAssignedTo(e.target.value)} className={inputCls} placeholder={t("wo.modal.assigneePlaceholder")} />
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
              <textarea rows={2} value={acceptanceCriteria} onChange={e => setAcceptanceCriteria(e.target.value)}
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
              <textarea rows={2} value={loto} onChange={e => setLoto(e.target.value)}
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
              <textarea rows={2} value={riskAnalysisResult} onChange={e => setRiskAnalysisResult(e.target.value)}
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
                <textarea rows={2} value={consequenceRationale} onChange={e => setConsequenceRationale(e.target.value)}
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
    </div>
  );
};
