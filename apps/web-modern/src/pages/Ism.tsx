// Código ISM · Capítulo 10 — Mantenimiento del buque y el equipo.
//
// Panel de evidencia read-only, hermano del de TMSA: por buque muestra qué
// respalda cada cláusula del Capítulo 10, con semáforo, métricas en vivo,
// drill-down a los registros concretos, análisis IA y PDF para el auditor.
//
// Consume /app/ism/chapter10 (ism-service.ts), que reusa la misma evidencia de
// mantenimiento que TMSA y le suma los bloques propios del Capítulo 10.

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { LifeBuoy, Download, Loader2, CheckCircle2, AlertTriangle, XCircle, Info, ChevronRight, Sparkles, ClipboardCheck } from "lucide-react";
import { useFetch } from "../lib/hooks";
import { api, ApiError } from "../lib/api";
import { PageHeader } from "../components/PageHeader";
import { ModalCloseButton } from "../components/ModalCloseButton";
import { useVesselContext } from "../lib/vessel-context";
import { downloadAuthedFile } from "../lib/authed-media";
import { useT, type TranslationKey } from "../lib/i18n";
import { moduleListLink } from "../lib/tmsa-filter";
import { ComplianceFixModal, FixBlock, fixSteps, findingValue, type ComplianceFinding, type FixChip } from "../components/compliance/FixModal";

// ─── Types (espejo de ism-service.ts) ───────────────────────────────────────
type IsmStatus = "OK" | "ATTENTION" | "GAP" | "INFO";
interface IsmMetric { key: string; value: number; kind: "count" | "pct"; }
type IsmFinding = ComplianceFinding;
interface IsmGroup { key: string; clause: string; status: IsmStatus; own: boolean; metrics: IsmMetric[]; findings?: IsmFinding[]; }
interface IsmVesselEvidence {
  /** "" cuando el item consolida toda la flota. */
  vesselCode: string;
  vesselName: string;
  /** Cuántos buques entraron en el total (1 salvo en el item de flota). */
  vesselCount: number;
  summary: { ok: number; attention: number; gap: number; info: number };
  groups: IsmGroup[];
}

type IsmEntityType = "asset" | "workOrder" | "maintenancePlan" | "deferral" | "spare" | "spareRequest" | "fluidAnalysis" | "defect" | "moc" | "certificate" | "inspection" | "permit" | "drydockSpec";
interface IsmDetailItem {
  id: string;
  code: string;
  label: string;
  sublabel?: string | null;
  entityType: IsmEntityType;
}

/** Las siete cláusulas del Capítulo 10, en el orden del Código. */
const CLAUSES = ["10.1", "10.2.1", "10.2.2", "10.2.3", "10.2.4", "10.3", "10.4"] as const;
type Clause = (typeof CLAUSES)[number];

/** Clave i18n de cada cláusula, sin puntos (no se pueden usar en la clave). */
const clauseKey = (c: string) => c.replace(/\./g, "-");

const STATUS_META: Record<IsmStatus, { icon: typeof CheckCircle2; cls: string; pill: string }> = {
  OK:        { icon: CheckCircle2, cls: "text-emerald-600 dark:text-emerald-400", pill: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20" },
  ATTENTION: { icon: AlertTriangle, cls: "text-yellow-700 dark:text-yellow-400", pill: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-300 border-yellow-500/20" },
  GAP:       { icon: XCircle, cls: "text-red-700 dark:text-red-400", pill: "bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/20" },
  INFO:      { icon: Info, cls: "text-text-industrial/50", pill: "bg-fg/5 text-text-industrial/60 border-fg/10" },
};

function metricValue(m: IsmMetric): string {
  return m.kind === "pct" ? `${Math.round(m.value * 100)}%` : m.value.toLocaleString("es-AR");
}

/** Mismo mapeo de deep-links que usa el panel TMSA. */
function navFor(item: IsmDetailItem): string {
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

/**
 * Rótulo de un bloque de evidencia. Los bloques propios del Capítulo 10 tienen
 * su clave `ism.group.*`; los heredados del panel TMSA reusan `tmsa.group.*`
 * para no duplicar veinte traducciones que ya existen.
 */
const groupLabelKey = (g: IsmGroup): TranslationKey =>
  (g.own ? `ism.group.${g.key}` : `tmsa.group.${g.key}`) as TranslationKey;

/** Idem para las métricas: las propias empiezan con "ism". */
const metricLabelKey = (key: string): TranslationKey =>
  (key.startsWith("ism") ? `ism.metric.${key}` : `tmsa.metric.${key}`) as TranslationKey;

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
  clause: string;
  status: IsmStatus;
  metrics: IsmMetric[];
  findings: IsmFinding[];
}

interface IsmAssessment {
  narrative: string;
  recommendedAction: string;
}

// Panel de análisis IA — mismo contrato que el de TMSA, contra el endpoint ISM.
const IsmAiAssessment: React.FC<{
  vesselCode: string;
  groupKey: string;
  metricKey?: string;
  auto?: boolean;
}> = ({ vesselCode, groupKey, metricKey, auto }) => {
  const t = useT();
  const [assessment, setAssessment] = useState<IsmAssessment | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const startedRef = useRef(false);

  const analyze = useCallback(async () => {
    if (startedRef.current) return;
    startedRef.current = true;
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const res = await api.post<IsmAssessment>("/app/ism/chapter10/assessment", {
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
      {analyzeError && <p className="text-xs text-red-700 dark:text-red-400">{analyzeError}</p>}
      {assessment && (
        <div className="space-y-2">
          <p className="text-xs text-fg/80 leading-relaxed">{assessment.narrative}</p>
          {assessment.recommendedAction && (
            <div className="bg-accent/5 border border-accent/15 rounded-lg px-3 py-2">
              <p className="text-[10px] uppercase tracking-wider text-accent/70 font-bold mb-0.5">{t("tmsa.detail.recommendedAction")}</p>
              <p className="text-xs text-fg/80 leading-relaxed">{assessment.recommendedAction}</p>
            </div>
          )}
          <p className="text-[10px] text-text-industrial/40 italic">{t("ism.detail.analyzeDisclaimer")}</p>
        </div>
      )}
    </div>
  );
};

// Modal del bloque completo: se abre desde el badge de estado y analiza solo.
const IsmGroupAssessmentModal: React.FC<{ target: GroupAssessTarget; onClose: () => void }> = ({ target, onClose }) => {
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
              {target.vesselName} · ISM {target.clause}
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
          <p className="text-xs text-text-industrial/70 italic leading-relaxed">
            {t(`ism.clause.${clauseKey(target.clause)}.text` as TranslationKey)}
          </p>
          {/* Qué está mal y cómo se arregla, antes de las métricas: el mismo
              diagnóstico que da el badge del checklist (ver IsmFixModal). */}
          {target.findings.map(f => (
            <FixBlock
              key={f.key}
              pill={STATUS_META[f.status].pill}
              title={t(`ism.fix.${f.key}.title` as TranslationKey)}
              value={findingValue(f)}
              what={t(`ism.fix.${f.key}.what` as TranslationKey)}
              steps={fixSteps(t(`ism.fix.${f.key}.how` as TranslationKey))}
            />
          ))}
          <div>
            <p className="text-[10px] uppercase tracking-wider text-text-industrial/40 mb-1.5">{t("tmsa.assess.metrics")}</p>
            <dl className="space-y-1">
              {target.metrics.map(m => (
                <div key={m.key} className="flex items-center justify-between gap-2 text-[11px]">
                  <dt className="text-text-industrial/60 truncate">{t(metricLabelKey(m.key))}</dt>
                  <dd className="font-bold text-fg shrink-0">{metricValue(m)}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="pt-3 border-t border-fg/10">
            <IsmAiAssessment vesselCode={target.vesselCode} groupKey={target.groupKey} auto />
          </div>
        </div>
      </div>
    </div>
  );
};

const IsmDrillDownModal: React.FC<{ target: DrillDownTarget; onClose: () => void }> = ({ target, onClose }) => {
  const t = useT();
  const navigate = useNavigate();
  const path = `/app/ism/chapter10/detail?vesselCode=${encodeURIComponent(target.vesselCode)}&metric=${encodeURIComponent(target.metricKey)}`;
  const { data, loading, error } = useFetch<{ items: IsmDetailItem[] }>(path, [path]);
  const items = data?.items ?? [];
  const listLink = moduleListLink(target.metricKey, target.vesselCode);

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
          {/* Mismo destino que el badge de la pestaña Checklist: la planilla del
              módulo filtrada por estos registros. */}
          {listLink && (
            <button
              type="button"
              onClick={() => { onClose(); navigate(listLink); }}
              className="ml-auto inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-fg/5 border border-fg/10 hover:border-accent/40 hover:bg-fg/10 transition-all text-[11px] font-medium text-fg/70 shrink-0"
            >
              {t("tmsa.detail.openList")}
              <ChevronRight className="w-3 h-3 opacity-50" />
            </button>
          )}
          <ModalCloseButton onClose={onClose} />
        </div>

        <div className="px-5 py-3 border-b border-fg/10">
          <IsmAiAssessment vesselCode={target.vesselCode} groupKey={target.groupKey} metricKey={target.metricKey} />
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

// ─── Ventana "qué está mal / cómo se arregla" ───────────────────────────────
// El marco y los bloques son los compartidos con el panel TMSA
// (components/compliance/FixModal): acá sólo se resuelve el texto del Capítulo
// 10 (`ism.fix.*`) y qué explica cada badge.

interface FixTarget {
  /** Qué badge se apretó: el estado del buque o la capacidad del sistema. */
  kind: "usage" | "capacity";
  clause: Clause;
  status: IsmStatus;
  /** Rótulo del badge de capacidad (Cumple / Parcial / No cubre). */
  ratingLabel?: string;
  findings: IsmFinding[];
  chips: ChecklistChip[];
  /** Sin buque elegido no hay estado en vivo que explicar. */
  hasVessel: boolean;
}

const IsmFixModal: React.FC<{
  target: FixTarget;
  onClose: () => void;
  onGoEvidence: () => void;
}> = ({ target, onClose, onGoEvidence }) => {
  const t = useT();
  const navigate = useNavigate();
  const meta = STATUS_META[target.status];
  const ck = clauseKey(target.clause);
  const isCapacity = target.kind === "capacity";

  const chips: FixChip[] = target.chips.map(chip => ({
    label: t(chip.navKey),
    onClick: () => { onClose(); chip.tab ? onGoEvidence() : navigate(chip.route!); },
  }));

  return (
    <ComplianceFixModal
      eyebrow={`ISM ${target.clause}`}
      title={t(`ism.clause.${ck}.title` as TranslationKey)}
      statusPill={meta.pill}
      StatusIcon={meta.icon}
      statusLabel={isCapacity ? (target.ratingLabel ?? "") : t(`tmsa.status.${target.status}` as TranslationKey)}
      chips={chips}
      onClose={onClose}
    >
      {isCapacity ? (
        // La capacidad no depende del buque: se explica qué cubre el sistema.
        <FixBlock
          pill={STATUS_META.INFO.pill}
          title={t("fix.capacityTitle")}
          what={t("fix.capacityWhat")}
          extra={t(`ism.clause.${ck}.expl` as TranslationKey)}
        />
      ) : !target.hasVessel ? (
        <p className="text-xs text-text-industrial/60">{t("fix.noVessel")}</p>
      ) : target.findings.length === 0 ? (
        <FixBlock pill={STATUS_META.OK.pill} title={t("fix.noneTitle")} what={t("fix.noneWhat")} />
      ) : (
        target.findings.map(f => (
          <FixBlock
            key={f.key}
            pill={STATUS_META[f.status].pill}
            title={t(`ism.fix.${f.key}.title` as TranslationKey)}
            value={findingValue(f)}
            what={t(`ism.fix.${f.key}.what` as TranslationKey)}
            steps={fixSteps(t(`ism.fix.${f.key}.how` as TranslationKey))}
          />
        ))
      )}
    </ComplianceFixModal>
  );
};

// ─── Checklist del Capítulo 10 ──────────────────────────────────────────────
// Una tarjeta por cláusula, con el texto del Código y qué tan bien la respalda
// el sistema. El rating es una propiedad de CMS3 (no cambia por buque); el dato
// en vivo sale del mismo endpoint de evidencia.
type Rating = "full" | "partial" | "none";
const RATING_STATUS: Record<Rating, IsmStatus> = { full: "OK", partial: "ATTENTION", none: "GAP" };

interface ChecklistChip { navKey: TranslationKey; route?: string; tab?: boolean; }
interface ChecklistItem {
  clause: Clause;
  rating: Rating;
  /** Bloque de evidencia del que se toma el estado en vivo del buque. */
  liveGroupKey?: string;
  chips: ChecklistChip[];
}

const CHECKLIST_ITEMS: ChecklistItem[] = [
  { clause: "10.1", rating: "full", liveGroupKey: "regulatoryBasis",
    chips: [{ navKey: "nav.maintenancePlans", route: "/maintenance-plans" }, { navKey: "nav.certificates", route: "/certificates" }, { navKey: "nav.inspections", route: "/inspections" }] },
  { clause: "10.2.1", rating: "full", liveGroupKey: "inspections",
    chips: [{ navKey: "nav.inspections", route: "/inspections" }, { navKey: "nav.checklists", route: "/checklists" }] },
  { clause: "10.2.2", rating: "full", liveGroupKey: "nonConformity",
    chips: [{ navKey: "nav.defects", route: "/defects" }, { navKey: "nav.externalAudits", route: "/external-audits" }] },
  { clause: "10.2.3", rating: "full", liveGroupKey: "correctiveAction",
    chips: [{ navKey: "nav.defects", route: "/defects" }, { navKey: "nav.workOrders", route: "/work-orders" }, { navKey: "nav.deferrals", route: "/deferrals" }] },
  { clause: "10.2.4", rating: "full", liveGroupKey: "maintenanceRecords",
    chips: [{ navKey: "nav.workOrders", route: "/work-orders" }, { navKey: "ism.tabs.evidence", tab: true }] },
  { clause: "10.3", rating: "full", liveGroupKey: "standbyTesting",
    chips: [{ navKey: "nav.assets", route: "/assets" }, { navKey: "nav.checklists", route: "/checklists" }, { navKey: "nav.spares", route: "/spares" }] },
  { clause: "10.4", rating: "full", liveGroupKey: "plannedMaintenance",
    chips: [{ navKey: "nav.maintenancePlans", route: "/maintenance-plans" }, { navKey: "nav.maintenanceGantt", route: "/maintenance-gantt" }] },
];

function findLiveGroup(items: IsmVesselEvidence[], groupKey?: string): IsmGroup | null {
  if (!groupKey || items.length !== 1) return null;
  return items[0].groups.find(g => g.key === groupKey) ?? null;
}

const IsmChecklistCard: React.FC<{ item: ChecklistItem; items: IsmVesselEvidence[]; onGoEvidence: () => void }> = ({ item, items, onGoEvidence }) => {
  const t = useT();
  const navigate = useNavigate();
  // Los dos badges abren la misma ventana; cambia qué explica (ver FixTarget).
  const [fix, setFix] = useState<FixTarget | null>(null);
  const capMeta = STATUS_META[RATING_STATUS[item.rating]];
  const CapIcon = capMeta.icon;
  const group = findLiveGroup(items, item.liveGroupKey);
  // findLiveGroup ya exige que haya UN solo buque seleccionado: ese es el buque
  // al que pertenecen los números, y el que viaja en el link a la planilla.
  const vesselCode = items.length === 1 ? items[0].vesselCode : "";
  const usageMeta = group ? STATUS_META[group.status] : null;
  const UsageIcon = usageMeta?.icon;
  const ck = clauseKey(item.clause);

  return (
    <div className="bg-fg/[0.03] border border-fg/10 rounded-xl p-4">
      <div className="mb-2">
        <p className="text-[10px] font-mono uppercase tracking-wider text-text-industrial/40">ISM {item.clause}</p>
        <h4 className="text-sm font-semibold text-fg leading-snug mt-0.5">{t(`ism.clause.${ck}.title` as TranslationKey)}</h4>
      </div>
      {/* Texto del Código: es lo que el auditor lee y contra lo que compara. */}
      <p className="text-xs text-text-industrial/70 leading-relaxed italic border-l-2 border-fg/10 pl-2.5">
        {t(`ism.clause.${ck}.text` as TranslationKey)}
      </p>
      <p className="text-xs text-text-industrial/70 leading-relaxed mt-2">{t(`ism.clause.${ck}.expl` as TranslationKey)}</p>

      <div className="grid grid-cols-2 gap-2 mt-2.5">
        <div>
          <p className="text-[9px] uppercase tracking-wider text-text-industrial/40 mb-1">{t("tmsa.checklist.capacityLabel")}</p>
          <button
            type="button"
            onClick={() => setFix({
              kind: "capacity",
              clause: item.clause,
              status: RATING_STATUS[item.rating],
              ratingLabel: t(`tmsa.checklist.rating.${item.rating}` as TranslationKey),
              findings: [],
              chips: item.chips,
              hasVessel: !!group,
            })}
            title={t("fix.capacityTitle")}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold hover:brightness-110 transition-all ${capMeta.pill}`}
          >
            <CapIcon className="w-3 h-3" />
            {t(`tmsa.checklist.rating.${item.rating}` as TranslationKey)}
          </button>
        </div>
        <div>
          <p className="text-[9px] uppercase tracking-wider text-text-industrial/40 mb-1">{t("tmsa.checklist.usageLabel")}</p>
          {group && usageMeta && UsageIcon ? (
            <button
              type="button"
              onClick={() => setFix({
                kind: "usage",
                clause: item.clause,
                status: group.status,
                findings: group.findings ?? [],
                chips: item.chips,
                hasVessel: true,
              })}
              title={t("fix.title")}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold hover:brightness-110 transition-all ${usageMeta.pill}`}
            >
              <UsageIcon className="w-3 h-3" />
              {t(`tmsa.status.${group.status}` as TranslationKey)}
            </button>
          ) : (
            <span className="text-[10px] text-text-industrial/40 italic">{t("tmsa.checklist.noVessel")}</span>
          )}
        </div>
      </div>

      {group && group.metrics.length > 0 && (
        <dl className="flex flex-wrap gap-1.5 mt-2">
          {group.metrics.map(m => {
            // El badge ENTERO abre la planilla del módulo con esos mismos
            // registros. Los porcentajes y las métricas sin planilla propia
            // quedan como badge apagado, sin cursor ni hover (ver Tmsa.tsx).
            // Sin condición sobre vesselCode: en el bloque de flota va vacío a
            // propósito y el link sale sin buque (planilla de toda la flota).
            const link = m.kind === "count" ? moduleListLink(m.key, vesselCode) : null;
            const content = (
              <>
                <dt className="text-text-industrial/60">{t(metricLabelKey(m.key))}:</dt>
                <dd className="font-bold">{metricValue(m)}</dd>
              </>
            );
            return link ? (
              <button
                key={m.key}
                type="button"
                onClick={() => navigate(link)}
                title={t("tmsa.detail.openList")}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] bg-fg/5 border border-fg/10 text-accent hover:bg-accent/10 hover:border-accent/40 transition-all"
              >
                {content}
              </button>
            ) : (
              <span
                key={m.key}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] bg-fg/[0.03] border border-fg/5 text-fg/70"
              >
                {content}
              </span>
            );
          })}
        </dl>
      )}

      {fix && <IsmFixModal target={fix} onClose={() => setFix(null)} onGoEvidence={onGoEvidence} />}

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

const IsmChecklistView: React.FC<{ items: IsmVesselEvidence[]; onGoEvidence: () => void }> = ({ items, onGoEvidence }) => {
  const t = useT();
  const counts = CHECKLIST_ITEMS.reduce(
    (acc, it) => { acc[it.rating]++; return acc; },
    { full: 0, partial: 0, none: 0 } as Record<Rating, number>,
  );

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs text-text-industrial/60 max-w-3xl">{t("ism.checklist.subtitle")}</p>
        <p className="text-[10px] text-text-industrial/40 italic mt-1">{t("ism.checklist.scope")}</p>
      </div>
      <div className="flex items-center gap-4 text-[11px] font-medium">
        <span className="text-emerald-600 dark:text-emerald-400">{t("tmsa.checklist.rating.full")} {counts.full}</span>
        <span className="text-yellow-700 dark:text-yellow-400">{t("tmsa.checklist.rating.partial")} {counts.partial}</span>
        <span className="text-red-700 dark:text-red-400">{t("tmsa.checklist.rating.none")} {counts.none}</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
        {CHECKLIST_ITEMS.map(it => (
          <IsmChecklistCard key={it.clause} item={it} items={items} onGoEvidence={onGoEvidence} />
        ))}
      </div>
      <p className="text-[10px] text-text-industrial/40 italic max-w-3xl pt-2 border-t border-fg/5">{t("ism.checklist.disclaimer")}</p>
    </div>
  );
};

// ─── Página ─────────────────────────────────────────────────────────────────

export const IsmPage: React.FC = () => {
  const t = useT();
  const { selectedVesselCode } = useVesselContext();
  const qs = selectedVesselCode ? `?vesselCode=${encodeURIComponent(selectedVesselCode)}` : "";
  const path = `/app/ism/chapter10${qs}`;
  const { data, loading, error, reload } = useFetch<{ items: IsmVesselEvidence[] }>(path, [path]);
  const [drillDown, setDrillDown] = useState<DrillDownTarget | null>(null);
  const [groupAssess, setGroupAssess] = useState<GroupAssessTarget | null>(null);

  // El botón del Dashboard entra directo al checklist (?tab=checklist), igual
  // que el de TMSA.
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<"evidence" | "checklist">(searchParams.get("tab") === "evidence" ? "evidence" : "checklist");

  const exportPdf = () => {
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = selectedVesselCode
      ? `ism-cap10-${selectedVesselCode}-${dateStr}.pdf`
      : `ism-cap10-flota-${dateStr}.pdf`;
    void downloadAuthedFile(`/app/ism/chapter10/pdf${qs}`, filename);
  };

  const items = data?.items ?? [];

  return (
    <div className="space-y-4">
      <PageHeader icon={LifeBuoy} title={t("ism.title")} onReload={reload}>
        <button
          type="button"
          onClick={exportPdf}
          disabled={items.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent/10 border border-accent/20 text-xs font-medium text-accent hover:bg-accent/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          title={t("ism.exportTitle")}
        >
          <Download className="w-3.5 h-3.5" />
          {t("ism.export")}
        </button>
      </PageHeader>

      <div className="flex items-center gap-1 border-b border-fg/10">
        <button
          type="button"
          onClick={() => setTab("checklist")}
          className={`flex items-center gap-1.5 px-3 py-2 text-xs font-bold border-b-2 transition-colors ${tab === "checklist" ? "border-accent text-accent" : "border-transparent text-text-industrial/50 hover:text-fg"}`}
        >
          <ClipboardCheck className="w-3.5 h-3.5" />
          {t("ism.tabs.checklist")}
        </button>
        <button
          type="button"
          onClick={() => setTab("evidence")}
          className={`px-3 py-2 text-xs font-bold border-b-2 transition-colors ${tab === "evidence" ? "border-accent text-accent" : "border-transparent text-text-industrial/50 hover:text-fg"}`}
        >
          {t("ism.tabs.evidence")}
        </button>
      </div>

      {loading && (
        <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-accent" /></div>
      )}
      {error && !loading && (
        <p className="text-sm text-red-600 dark:text-red-400">{t("ism.loadError")}</p>
      )}

      {tab === "checklist" ? (
        !loading && <IsmChecklistView items={items} onGoEvidence={() => setTab("evidence")} />
      ) : (
        <>
          <p className="text-xs text-text-industrial/60 max-w-3xl">{t("ism.subtitle")}</p>
          {!loading && items.length > 0 && (
            <p className="text-[10px] text-text-industrial/40 italic">
              {t("tmsa.detail.hint")} · {t("tmsa.assess.hint")}
            </p>
          )}
          {!loading && !error && items.length === 0 && (
            <p className="text-sm text-text-industrial/50 py-6">{t("tmsa.empty")}</p>
          )}

          {!loading && items.map(v => (
            <section key={v.vesselCode} className="space-y-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                {/* Un buque, o el nombre de la empresa + cuántos buques cuando el
                bloque consolida la flota. */}
            <h3 className="text-sm font-bold text-fg">
              {v.vesselName}
              {!v.vesselCode && (
                <span className="ml-2 font-medium text-text-industrial/50">
                  · {t("tmsa.fleetVessels").replace("{n}", String(v.vesselCount))}
                </span>
              )}
            </h3>
                <div className="flex items-center gap-3 text-[11px] font-medium">
                  <span className="text-emerald-600 dark:text-emerald-400">{t("tmsa.status.OK")} {v.summary.ok}</span>
                  <span className="text-yellow-700 dark:text-yellow-400">{t("tmsa.status.ATTENTION")} {v.summary.attention}</span>
                  <span className="text-red-700 dark:text-red-400">{t("tmsa.status.GAP")} {v.summary.gap}</span>
                </div>
              </div>

              {/* Los bloques vienen ordenados por cláusula: se abre un
                  encabezado con el texto del Código cada vez que cambia. */}
              {CLAUSES.map(clause => {
                const groups = v.groups.filter(g => g.clause === clause);
                if (groups.length === 0) return null;
                const ck = clauseKey(clause);
                return (
                  <div key={clause} className="space-y-2">
                    <div className="pt-1 border-t border-dashed border-fg/10">
                      <p className="text-[10px] font-mono uppercase tracking-wider text-text-industrial/40">
                        ISM {clause} · {t(`ism.clause.${ck}.title` as TranslationKey)}
                      </p>
                      <p className="text-[11px] text-text-industrial/55 italic max-w-3xl mt-0.5">
                        {t(`ism.clause.${ck}.text` as TranslationKey)}
                      </p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                      {groups.map(g => {
                        const meta = STATUS_META[g.status];
                        const Icon = meta.icon;
                        const label = t(groupLabelKey(g));
                        return (
                          <div key={g.key} className="bg-fg/[0.03] border border-fg/10 rounded-xl p-3.5">
                            <div className="flex items-start justify-between gap-2 mb-2.5">
                              <div className="min-w-0">
                                <p className="text-[9px] uppercase tracking-wider text-text-industrial/40">ISM {g.clause}</p>
                                <p className="text-sm font-semibold text-fg leading-tight">{label}</p>
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
                                    groupLabel: label,
                                    clause: g.clause,
                                    status: g.status,
                                    metrics: g.metrics,
                                    findings: g.findings ?? [],
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
                                const metricLabel = t(metricLabelKey(m.key));
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
                                    onClick={() => setDrillDown({ vesselCode: v.vesselCode, groupKey: g.key, metricKey: m.key, groupLabel: label, metricLabel })}
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
                  </div>
                );
              })}
            </section>
          ))}

          {!loading && items.length > 0 && (
            <p className="text-[10px] text-text-industrial/40 italic max-w-3xl pt-2 border-t border-fg/5">
              {t("ism.disclaimer")}
            </p>
          )}
        </>
      )}

      {drillDown && <IsmDrillDownModal target={drillDown} onClose={() => setDrillDown(null)} />}
      {groupAssess && <IsmGroupAssessmentModal target={groupAssess} onClose={() => setGroupAssess(null)} />}
    </div>
  );
};
