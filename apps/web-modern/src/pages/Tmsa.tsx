// TMSA Elemento 4 — Reliability & Maintenance.
//
// Panel de evidencia read-only: por buque, muestra los grupos del Elemento 4
// (y adyacentes de mantenimiento) con semáforo + métricas, y exporta un PDF de
// evidencia. Reusa el endpoint /app/tmsa/maintenance (tmsa-service.ts) y respeta
// el buque seleccionado en el contexto global (igual que ComplianceDashboard).

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ShieldCheck, Download, Loader2, CheckCircle2, AlertTriangle, XCircle, Info, ChevronRight, Sparkles, ClipboardCheck } from "lucide-react";
import { useFetch } from "../lib/hooks";
import { api, ApiError } from "../lib/api";
import { PageHeader } from "../components/PageHeader";
import { ModalCloseButton } from "../components/ModalCloseButton";
import { useVesselContext } from "../lib/vessel-context";
import { downloadAuthedFile } from "../lib/authed-media";
import { useT, type TranslationKey } from "../lib/i18n";

// ─── Types (espejo de tmsa-service.ts) ──────────────────────────────────────────
type TmsaStatus = "OK" | "ATTENTION" | "GAP" | "INFO";
interface TmsaMetric { key: string; value: number; kind: "count" | "pct"; }
interface TmsaGroup { key: string; element: string; status: TmsaStatus; metrics: TmsaMetric[]; }
interface TmsaVesselEvidence {
  vesselCode: string;
  vesselName: string;
  summary: { ok: number; attention: number; gap: number; info: number };
  groups: TmsaGroup[];
}

type TmsaEntityType = "asset" | "workOrder" | "maintenancePlan" | "deferral" | "spare" | "spareRequest" | "fluidAnalysis" | "defect" | "moc" | "certificate" | "inspection" | "permit" | "drydockSpec";
interface TmsaDetailItem {
  id: string;
  code: string;
  label: string;
  sublabel?: string | null;
  entityType: TmsaEntityType;
}

const STATUS_META: Record<TmsaStatus, { icon: typeof CheckCircle2; cls: string; pill: string }> = {
  OK:        { icon: CheckCircle2, cls: "text-emerald-600 dark:text-emerald-400", pill: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20" },
  ATTENTION: { icon: AlertTriangle, cls: "text-yellow-700 dark:text-yellow-400", pill: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-300 border-yellow-500/20" },
  GAP:       { icon: XCircle, cls: "text-red-700 dark:text-red-400", pill: "bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/20" },
  INFO:      { icon: Info, cls: "text-text-industrial/50", pill: "bg-fg/5 text-text-industrial/60 border-fg/10" },
};

function metricValue(m: TmsaMetric): string {
  return m.kind === "pct" ? `${Math.round(m.value * 100)}%` : m.value.toLocaleString("es-AR");
}

// Ruta de navegación por tipo de entidad — reusa los query params de deep-link
// que cada pantalla ya soporta (mismo patrón que el resto de la app: Assets
// ?open=, WorkOrders ?autoCode=, MaintenancePlans ?openId=, Defects ?defectId=,
// Deferrals ?autoCode=). Spares/SpareRequests/FluidAnalyses/MOC todavía no
// tienen "abrir por id" — navega al listado del módulo.
function navFor(item: TmsaDetailItem): string {
  switch (item.entityType) {
    case "asset": return `/assets?open=${encodeURIComponent(item.id)}`;
    case "workOrder": return `/work-orders?autoCode=${encodeURIComponent(item.code)}`;
    case "maintenancePlan": return `/maintenance-plans?openId=${encodeURIComponent(item.id)}`;
    case "deferral": return `/deferrals?autoCode=${encodeURIComponent(item.code)}`;
    case "defect": return `/defects?defectId=${encodeURIComponent(item.id)}`;
    case "spare": return "/spares";
    case "spareRequest": return "/spare-requests";
    case "fluidAnalysis": return "/fluid-analyses";
    case "moc": return "/moc";
    case "certificate": return "/certificates";
    case "inspection": return "/inspections";
    case "permit": return "/permits";
    case "drydockSpec": return `/drydock-specs/${encodeURIComponent(item.code)}`;
  }
}

interface DrillDownTarget {
  vesselCode: string;
  groupKey: string;
  metricKey: string;
  groupLabel: string;
  metricLabel: string;
}

interface GroupAssessTarget {
  vesselCode: string;
  vesselName: string;
  groupKey: string;
  groupLabel: string;
  element: string;
  status: TmsaStatus;
  metrics: TmsaMetric[];
}

interface TmsaAssessment {
  narrative: string;
  recommendedAction: string;
}

// Panel de análisis IA. Compartido por el drill-down de una métrica (botón
// "Analizar con IA") y por el modal del sub-requisito completo, que se dispara
// desde el badge de estado y arranca solo (auto).
const TmsaAiAssessment: React.FC<{
  vesselCode: string;
  groupKey: string;
  metricKey?: string;
  auto?: boolean;
}> = ({ vesselCode, groupKey, metricKey, auto }) => {
  const t = useT();
  const [assessment, setAssessment] = useState<TmsaAssessment | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const startedRef = useRef(false);

  const analyze = useCallback(async () => {
    if (startedRef.current) return;
    startedRef.current = true;
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const res = await api.post<TmsaAssessment>("/app/tmsa/maintenance/assessment", {
        vesselCode,
        groupKey,
        ...(metricKey ? { metricKey } : {}),
      });
      setAssessment(res);
    } catch (e) {
      setAnalyzeError(e instanceof ApiError ? e.message : t("tmsa.detail.analyzeError"));
      startedRef.current = false; // permitir reintentar
    } finally {
      setAnalyzing(false);
    }
  }, [vesselCode, groupKey, metricKey, t]);

  useEffect(() => {
    if (auto) void analyze();
  }, [auto, analyze]);

  return (
    <div className="space-y-2">
      {!assessment && !analyzing && (
        <button
          type="button"
          onClick={() => { void analyze(); }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent/10 border border-accent/20 text-xs font-medium text-accent hover:bg-accent/20 transition-all"
        >
          <Sparkles className="w-3.5 h-3.5" />
          {analyzeError ? t("tmsa.detail.analyzeRetry") : t("tmsa.detail.analyze")}
        </button>
      )}
      {analyzing && (
        <div className="flex items-center gap-2 text-xs text-text-industrial/60">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
          {t("tmsa.detail.analyzing")}
        </div>
      )}
      {analyzeError && (
        <p className="text-xs text-red-700 dark:text-red-400">{analyzeError}</p>
      )}
      {assessment && (
        <div className="space-y-2">
          <p className="text-xs text-fg/80 leading-relaxed">{assessment.narrative}</p>
          {assessment.recommendedAction && (
            <div className="bg-accent/5 border border-accent/15 rounded-lg px-3 py-2">
              <p className="text-[10px] uppercase tracking-wider text-accent/70 font-bold mb-0.5">{t("tmsa.detail.recommendedAction")}</p>
              <p className="text-xs text-fg/80 leading-relaxed">{assessment.recommendedAction}</p>
            </div>
          )}
          <p className="text-[10px] text-text-industrial/40 italic">{t("tmsa.detail.analyzeDisclaimer")}</p>
        </div>
      )}
    </div>
  );
};

// Modal del sub-requisito completo: se abre al presionar el badge de estado
// (Brecha / Atención / Info) y analiza el grupo entero con IA.
const TmsaGroupAssessmentModal: React.FC<{ target: GroupAssessTarget; onClose: () => void }> = ({ target, onClose }) => {
  const t = useT();
  const meta = STATUS_META[target.status];
  const Icon = meta.icon;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-lg max-h-[85vh] flex flex-col bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-fg/10">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-text-industrial/40 truncate">
              {target.vesselName} · TMSA {target.element}
            </p>
            <h2 className="text-sm font-bold text-fg truncate">{target.groupLabel}</h2>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold ${meta.pill}`}>
              <Icon className="w-3 h-3" />
              {t(`tmsa.status.${target.status}` as TranslationKey)}
            </span>
            <ModalCloseButton onClose={onClose} />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-text-industrial/40 mb-1.5">{t("tmsa.assess.metrics")}</p>
            <dl className="space-y-1">
              {target.metrics.map(m => (
                <div key={m.key} className="flex items-center justify-between gap-2 text-[11px]">
                  <dt className="text-text-industrial/60 truncate">{t(`tmsa.metric.${m.key}` as TranslationKey)}</dt>
                  <dd className="font-bold text-fg shrink-0">{metricValue(m)}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="pt-3 border-t border-fg/10">
            <TmsaAiAssessment vesselCode={target.vesselCode} groupKey={target.groupKey} auto />
          </div>
        </div>
      </div>
    </div>
  );
};

const TmsaDrillDownModal: React.FC<{ target: DrillDownTarget; onClose: () => void }> = ({ target, onClose }) => {
  const t = useT();
  const navigate = useNavigate();
  const path = `/app/tmsa/maintenance/detail?vesselCode=${encodeURIComponent(target.vesselCode)}&metric=${encodeURIComponent(target.metricKey)}`;
  const { data, loading, error } = useFetch<{ items: TmsaDetailItem[] }>(path, [path]);
  const items = data?.items ?? [];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-lg max-h-[85vh] flex flex-col bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-fg/10">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-text-industrial/40 truncate">{target.groupLabel}</p>
            <h2 className="text-sm font-bold text-fg truncate">{target.metricLabel}</h2>
          </div>
          <ModalCloseButton onClose={onClose} />
        </div>

        <div className="px-5 py-3 border-b border-fg/10">
          <TmsaAiAssessment vesselCode={target.vesselCode} groupKey={target.groupKey} metricKey={target.metricKey} />
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-2">
          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-accent" /></div>
          ) : error ? (
            <p className="text-xs text-red-700 dark:text-red-400 px-3 py-4">{t("tmsa.detail.loadError")}</p>
          ) : items.length === 0 ? (
            <p className="text-xs text-text-industrial/50 px-3 py-4">{t("tmsa.detail.empty")}</p>
          ) : (
            <ul className="divide-y divide-fg/5">
              {items.map(item => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => { onClose(); navigate(navFor(item)); }}
                    className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-fg/[0.04] transition-colors rounded-lg"
                    title={t("tmsa.detail.rowHint")}
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-accent font-mono">{item.code}</p>
                      <p className="text-xs text-fg/80 truncate">{item.label}</p>
                      {item.sublabel && <p className="text-[10px] text-text-industrial/50 truncate">{item.sublabel}</p>}
                    </div>
                    <ChevronRight className="w-3.5 h-3.5 text-text-industrial/30 shrink-0" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── Checklist OCIMF (Elemento 4 + 4A) ──────────────────────────────────────
// Mapeo estático de los 26 ítems oficiales TMSA3 → capacidad real de CMS3.
// El rating (full/partial/none) es una propiedad del sistema, no cambia por
// buque. Donde existe una métrica real del mismo endpoint de evidencia
// (/app/tmsa/maintenance), se muestra el dato en vivo del buque seleccionado.
type ChecklistRating = "full" | "partial" | "none";
const RATING_STATUS: Record<ChecklistRating, TmsaStatus> = { full: "OK", partial: "ATTENTION", none: "GAP" };

interface ChecklistChip { navKey: TranslationKey; route?: string; tab?: boolean; }
interface ChecklistItem {
  id: string;
  stage: 1 | 2 | 3 | 4;
  element: "4" | "4a";
  rating: ChecklistRating;
  /** Grupo del mismo endpoint de evidencia (/app/tmsa/maintenance) que responde
   * "¿este buque lo está usando?" — status + métricas reales, no un texto fijo.
   * Sin este campo, el ítem no tiene forma de verificarse con datos (ver
   * tmsa.checklist.usage.unverified). */
  liveGroupKey?: string;
  chips: ChecklistChip[];
}

const CHECKLIST_ITEMS: ChecklistItem[] = [
  { id: "4-1-1", stage: 1, element: "4", rating: "full", liveGroupKey: "pmsCoverage",
    chips: [{ navKey: "nav.maintenancePlans", route: "/maintenance-plans" }, { navKey: "nav.spares", route: "/spares" }] },
  { id: "4-1-2", stage: 1, element: "4", rating: "full", liveGroupKey: "defectReporting",
    chips: [{ navKey: "nav.defects", route: "/defects" }] },
  { id: "4-1-3", stage: 1, element: "4", rating: "full", liveGroupKey: "plannedMaintenance",
    chips: [{ navKey: "tmsa.tabs.evidence", tab: true }, { navKey: "nav.maintenanceGantt", route: "/maintenance-gantt" }] },
  { id: "4-1-4", stage: 1, element: "4", rating: "full", liveGroupKey: "plannedMaintenance",
    chips: [{ navKey: "nav.maintenanceGantt", route: "/maintenance-gantt" }, { navKey: "tmsa.tabs.evidence", tab: true }] },
  { id: "4-2-1", stage: 2, element: "4", rating: "full", liveGroupKey: "certificates",
    chips: [{ navKey: "nav.certificates", route: "/certificates" }] },
  { id: "4-2-2", stage: 2, element: "4", rating: "partial", liveGroupKey: "inspections",
    chips: [{ navKey: "nav.inspections", route: "/inspections" }] },
  { id: "4-2-3", stage: 2, element: "4", rating: "full", liveGroupKey: "inspections",
    chips: [{ navKey: "nav.inspections", route: "/inspections" }, { navKey: "tmsa.tabs.evidence", tab: true }] },
  { id: "4-2-4", stage: 2, element: "4", rating: "full", liveGroupKey: "drydockSpec",
    chips: [{ navKey: "nav.drydockSpecs", route: "/drydock-specs" }, { navKey: "nav.deferrals", route: "/deferrals" }] },
  { id: "4-3-1", stage: 3, element: "4", rating: "full", liveGroupKey: "plannedMaintenance",
    chips: [{ navKey: "nav.workOrders", route: "/work-orders" }, { navKey: "nav.defects", route: "/defects" }] },
  { id: "4-3-2", stage: 3, element: "4", rating: "full", liveGroupKey: "criticalSpares",
    chips: [{ navKey: "nav.spares", route: "/spares" }] },
  { id: "4-3-3", stage: 3, element: "4", rating: "full", liveGroupKey: "plannedMaintenance",
    chips: [{ navKey: "tmsa.tabs.evidence", tab: true }] },
  { id: "4-3-4", stage: 3, element: "4", rating: "partial", liveGroupKey: "inspections",
    chips: [{ navKey: "nav.inspections", route: "/inspections" }] },
  { id: "4-4-1", stage: 4, element: "4", rating: "full", liveGroupKey: "criticalSpares",
    chips: [{ navKey: "nav.spares", route: "/spares" }, { navKey: "nav.spareRequests", route: "/spare-requests" }] },
  { id: "4-4-2", stage: 4, element: "4", rating: "full", liveGroupKey: "drydockSpec",
    chips: [{ navKey: "nav.deferrals", route: "/deferrals" }, { navKey: "nav.drydockSpecs", route: "/drydock-specs" }] },
  { id: "4-4-3", stage: 4, element: "4", rating: "full",
    chips: [{ navKey: "tmsa.tabs.evidence", tab: true }] },
  { id: "4-4-4", stage: 4, element: "4", rating: "full", liveGroupKey: "conditionMonitoring",
    chips: [{ navKey: "nav.fluidAnalyses", route: "/fluid-analyses" }] },
  { id: "4-4-5", stage: 4, element: "4", rating: "full", liveGroupKey: "engineeringAudit",
    chips: [{ navKey: "nav.workOrders", route: "/work-orders" }, { navKey: "nav.team", route: "/team" },
            { navKey: "tmsa.tabs.evidence", tab: true }] },

  { id: "4a-1-1", stage: 1, element: "4a", rating: "full", liveGroupKey: "criticalEquipment",
    chips: [{ navKey: "nav.assets", route: "/assets" }] },
  { id: "4a-1-2", stage: 1, element: "4a", rating: "full", liveGroupKey: "criticalEquipment",
    chips: [{ navKey: "tmsa.tabs.evidence", tab: true }, { navKey: "nav.workOrders", route: "/work-orders" }] },
  { id: "4a-1-3", stage: 1, element: "4a", rating: "full", liveGroupKey: "defectReporting",
    chips: [{ navKey: "nav.defects", route: "/defects" }] },
  { id: "4a-1-4", stage: 1, element: "4a", rating: "full",
    chips: [{ navKey: "nav.maintenancePlans", route: "/maintenance-plans" }] },
  { id: "4a-2-1", stage: 2, element: "4a", rating: "partial", liveGroupKey: "permits",
    chips: [{ navKey: "nav.permits", route: "/permits" }] },
  { id: "4a-2-2", stage: 2, element: "4a", rating: "full",
    chips: [{ navKey: "nav.maintenancePlans", route: "/maintenance-plans" }] },
  { id: "4a-3-1", stage: 3, element: "4a", rating: "partial", chips: [] },
  { id: "4a-3-2", stage: 3, element: "4a", rating: "full", liveGroupKey: "conditionMonitoring",
    chips: [{ navKey: "nav.fluidAnalyses", route: "/fluid-analyses" }] },
  { id: "4a-4-1", stage: 4, element: "4a", rating: "full", liveGroupKey: "criticalEquipment",
    chips: [{ navKey: "tmsa.tabs.evidence", tab: true }] },
];

function findLiveGroup(items: TmsaVesselEvidence[], groupKey?: string): TmsaGroup | null {
  if (!groupKey || items.length !== 1) return null;
  return items[0].groups.find(g => g.key === groupKey) ?? null;
}

const TmsaChecklistCard: React.FC<{ item: ChecklistItem; items: TmsaVesselEvidence[]; onGoEvidence: () => void }> = ({ item, items, onGoEvidence }) => {
  const t = useT();
  const navigate = useNavigate();
  const capMeta = STATUS_META[RATING_STATUS[item.rating]];
  const CapIcon = capMeta.icon;
  const group = findLiveGroup(items, item.liveGroupKey);
  const usageMeta = group ? STATUS_META[group.status] : null;
  const UsageIcon = usageMeta?.icon;

  return (
    <div className="bg-fg/[0.03] border border-fg/10 rounded-xl p-4">
      <div className="mb-2">
        <p className="text-[10px] font-mono uppercase tracking-wider text-text-industrial/40">{item.id.toUpperCase().replace(/-/g, ".")}</p>
        <h4 className="text-sm font-semibold text-fg leading-snug mt-0.5">{t(`tmsa.checklist.item.${item.id}.q` as TranslationKey)}</h4>
      </div>
      <p className="text-xs text-text-industrial/70 leading-relaxed">{t(`tmsa.checklist.item.${item.id}.expl` as TranslationKey)}</p>

      <div className="grid grid-cols-2 gap-2 mt-2.5">
        <div>
          <p className="text-[9px] uppercase tracking-wider text-text-industrial/40 mb-1">{t("tmsa.checklist.capacityLabel")}</p>
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold ${capMeta.pill}`}>
            <CapIcon className="w-3 h-3" />
            {t(`tmsa.checklist.rating.${item.rating}` as TranslationKey)}
          </span>
        </div>
        <div>
          <p className="text-[9px] uppercase tracking-wider text-text-industrial/40 mb-1">{t("tmsa.checklist.usageLabel")}</p>
          {item.liveGroupKey ? (
            group && usageMeta && UsageIcon ? (
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold ${usageMeta.pill}`}>
                <UsageIcon className="w-3 h-3" />
                {t(`tmsa.status.${group.status}` as TranslationKey)}
              </span>
            ) : (
              <span className="text-[10px] text-text-industrial/40 italic">{t("tmsa.checklist.noVessel")}</span>
            )
          ) : (
            <span className="text-[10px] text-text-industrial/40 italic">{t("tmsa.checklist.usage.unverified")}</span>
          )}
        </div>
      </div>

      {group && group.metrics.length > 0 && (
        <dl className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5">
          {group.metrics.map(m => (
            <div key={m.key} className="flex items-center gap-1 text-[10px]">
              <dt className="text-text-industrial/50">{t(`tmsa.metric.${m.key}` as TranslationKey)}:</dt>
              <dd className="font-bold text-fg/80">{metricValue(m)}</dd>
            </div>
          ))}
        </dl>
      )}

      {item.chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2.5 pt-2.5 border-t border-fg/10">
          {item.chips.map((chip, i) => (
            <button
              key={i}
              type="button"
              onClick={() => { chip.tab ? onGoEvidence() : navigate(chip.route!); }}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-fg/5 border border-fg/10 hover:border-accent/40 hover:bg-fg/10 transition-all text-[10px] font-medium text-fg/70"
            >
              {t(chip.navKey)}
              <ChevronRight className="w-2.5 h-2.5 opacity-50" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const TmsaChecklistView: React.FC<{ items: TmsaVesselEvidence[]; onGoEvidence: () => void }> = ({ items, onGoEvidence }) => {
  const t = useT();
  const counts = CHECKLIST_ITEMS.reduce(
    (acc, it) => { acc[it.rating]++; return acc; },
    { full: 0, partial: 0, none: 0 } as Record<ChecklistRating, number>,
  );

  const renderElement = (element: "4" | "4a") => {
    const els = CHECKLIST_ITEMS.filter(it => it.element === element);
    return (
      <section key={element} className="space-y-3">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t(`tmsa.checklist.element.${element}` as TranslationKey)}</p>
          <p className="text-xs text-text-industrial/60 max-w-2xl mt-0.5">{t(`tmsa.checklist.element.${element}.subtitle` as TranslationKey)}</p>
        </div>
        {([1, 2, 3, 4] as const).map(stage => {
          const stageItems = els.filter(it => it.stage === stage);
          if (stageItems.length === 0) return null;
          return (
            <div key={stage} className="space-y-2">
              <p className="text-[10px] font-mono uppercase tracking-wider text-text-industrial/40 pt-1 border-t border-dashed border-fg/10">
                {t(`tmsa.checklist.stage.${stage}` as TranslationKey)}
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {stageItems.map(it => <TmsaChecklistCard key={it.id} item={it} items={items} onGoEvidence={onGoEvidence} />)}
              </div>
            </div>
          );
        })}
      </section>
    );
  };

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs text-text-industrial/60 max-w-3xl">{t("tmsa.checklist.subtitle")}</p>
        <p className="text-[10px] text-text-industrial/40 italic mt-1">{t("tmsa.checklist.scope")}</p>
      </div>
      <div className="flex items-center gap-4 text-[11px] font-medium">
        <span className="text-emerald-600 dark:text-emerald-400">{t("tmsa.checklist.rating.full")} {counts.full}</span>
        <span className="text-yellow-700 dark:text-yellow-400">{t("tmsa.checklist.rating.partial")} {counts.partial}</span>
        <span className="text-red-700 dark:text-red-400">{t("tmsa.checklist.rating.none")} {counts.none}</span>
      </div>
      {renderElement("4")}
      {renderElement("4a")}
      <p className="text-[10px] text-text-industrial/40 italic max-w-3xl pt-2 border-t border-fg/5">{t("tmsa.checklist.disclaimer")}</p>
    </div>
  );
};

export const TmsaPage: React.FC = () => {
  const t = useT();
  const { selectedVesselCode } = useVesselContext();
  const qs = selectedVesselCode ? `?vesselCode=${encodeURIComponent(selectedVesselCode)}` : "";
  const path = `/app/tmsa/maintenance${qs}`;
  const { data, loading, error, reload } = useFetch<{ items: TmsaVesselEvidence[] }>(path, [path]);
  const [drillDown, setDrillDown] = useState<DrillDownTarget | null>(null);
  const [groupAssess, setGroupAssess] = useState<GroupAssessTarget | null>(null);

  // Pestaña inicial: el botón "Auditoría TMSA" del Dashboard linkea directo a
  // ?tab=checklist. El cambio manual de pestaña no reescribe la URL (no hace
  // falta para este caso de uso).
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<"evidence" | "checklist">(searchParams.get("tab") === "checklist" ? "checklist" : "evidence");

  const exportPdf = () => {
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = selectedVesselCode
      ? `tmsa-elemento4-${selectedVesselCode}-${dateStr}.pdf`
      : `tmsa-elemento4-flota-${dateStr}.pdf`;
    void downloadAuthedFile(`/app/tmsa/maintenance/pdf${qs}`, filename);
  };

  const items = data?.items ?? [];

  return (
    <div className="space-y-4">
      <PageHeader icon={ShieldCheck} title={t("tmsa.title")} onReload={reload}>
        <button
          type="button"
          onClick={exportPdf}
          disabled={items.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent/10 border border-accent/20 text-xs font-medium text-accent hover:bg-accent/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          title={t("tmsa.exportTitle")}
        >
          <Download className="w-3.5 h-3.5" />
          {t("tmsa.export")}
        </button>
      </PageHeader>

      <div className="flex items-center gap-1 border-b border-fg/10">
        <button
          type="button"
          onClick={() => setTab("evidence")}
          className={`px-3 py-2 text-xs font-bold border-b-2 transition-colors ${tab === "evidence" ? "border-accent text-accent" : "border-transparent text-text-industrial/50 hover:text-fg"}`}
        >
          {t("tmsa.tabs.evidence")}
        </button>
        <button
          type="button"
          onClick={() => setTab("checklist")}
          className={`flex items-center gap-1.5 px-3 py-2 text-xs font-bold border-b-2 transition-colors ${tab === "checklist" ? "border-accent text-accent" : "border-transparent text-text-industrial/50 hover:text-fg"}`}
        >
          <ClipboardCheck className="w-3.5 h-3.5" />
          {t("tmsa.tabs.checklist")}
        </button>
      </div>

      {tab === "checklist" ? (
        <TmsaChecklistView items={items} onGoEvidence={() => setTab("evidence")} />
      ) : (
      <>
      <p className="text-xs text-text-industrial/60 max-w-3xl">{t("tmsa.subtitle")}</p>
      {!loading && items.length > 0 && (
        <p className="text-[10px] text-text-industrial/40 italic">
          {t("tmsa.detail.hint")} · {t("tmsa.assess.hint")}
        </p>
      )}

      {loading && (
        <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-accent" /></div>
      )}
      {error && !loading && (
        <p className="text-sm text-red-600 dark:text-red-400">{t("tmsa.loadError")}</p>
      )}
      {!loading && !error && items.length === 0 && (
        <p className="text-sm text-text-industrial/50 py-6">{t("tmsa.empty")}</p>
      )}

      {!loading && items.map(v => (
        <section key={v.vesselCode} className="space-y-3">
          {/* Encabezado de buque + resumen */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h3 className="text-sm font-bold text-fg">{v.vesselName}</h3>
            <div className="flex items-center gap-3 text-[11px] font-medium">
              <span className="text-emerald-600 dark:text-emerald-400">{t("tmsa.status.OK")} {v.summary.ok}</span>
              <span className="text-yellow-700 dark:text-yellow-400">{t("tmsa.status.ATTENTION")} {v.summary.attention}</span>
              <span className="text-red-700 dark:text-red-400">{t("tmsa.status.GAP")} {v.summary.gap}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {v.groups.map(g => {
              const meta = STATUS_META[g.status];
              const Icon = meta.icon;
              const groupLabel = t(`tmsa.group.${g.key}` as TranslationKey);
              return (
                <div key={g.key} className="bg-fg/[0.03] border border-fg/10 rounded-xl p-3.5">
                  <div className="flex items-start justify-between gap-2 mb-2.5">
                    <div className="min-w-0">
                      <p className="text-[9px] uppercase tracking-wider text-text-industrial/40">TMSA {g.element}</p>
                      <p className="text-sm font-semibold text-fg leading-tight">{groupLabel}</p>
                    </div>
                    {g.status === "OK" ? (
                      <span className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold ${meta.pill}`}>
                        <Icon className="w-3 h-3" />
                        {t(`tmsa.status.${g.status}` as TranslationKey)}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setGroupAssess({
                          vesselCode: v.vesselCode,
                          vesselName: v.vesselName,
                          groupKey: g.key,
                          groupLabel,
                          element: g.element,
                          status: g.status,
                          metrics: g.metrics,
                        })}
                        title={t("tmsa.assess.hint")}
                        className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold cursor-pointer hover:brightness-110 hover:ring-1 hover:ring-fg/20 transition-all ${meta.pill}`}
                      >
                        <Icon className="w-3 h-3" />
                        {t(`tmsa.status.${g.status}` as TranslationKey)}
                        <Sparkles className="w-2.5 h-2.5 opacity-70" />
                      </button>
                    )}
                  </div>
                  <dl className="space-y-1">
                    {g.metrics.map(m => {
                      const metricLabel = t(`tmsa.metric.${m.key}` as TranslationKey);
                      const clickable = m.kind === "count";
                      const row = (
                        <div className="flex items-center justify-between gap-2 text-[11px]">
                          <dt className="text-text-industrial/60 truncate">{metricLabel}</dt>
                          <dd className="font-bold text-fg shrink-0">{metricValue(m)}</dd>
                        </div>
                      );
                      return clickable ? (
                        <button
                          key={m.key}
                          type="button"
                          onClick={() => setDrillDown({ vesselCode: v.vesselCode, groupKey: g.key, metricKey: m.key, groupLabel, metricLabel })}
                          className="w-full text-left rounded-md px-1 -mx-1 hover:bg-fg/[0.05] transition-colors"
                          title={t("tmsa.detail.hint")}
                        >
                          {row}
                        </button>
                      ) : (
                        <div key={m.key}>{row}</div>
                      );
                    })}
                  </dl>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {!loading && items.length > 0 && (
        <p className="text-[10px] text-text-industrial/40 italic max-w-3xl pt-2 border-t border-fg/5">
          {t("tmsa.disclaimer")}
        </p>
      )}
      </>
      )}

      {drillDown && <TmsaDrillDownModal target={drillDown} onClose={() => setDrillDown(null)} />}
      {groupAssess && <TmsaGroupAssessmentModal target={groupAssess} onClose={() => setGroupAssess(null)} />}
    </div>
  );
};
