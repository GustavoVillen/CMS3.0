// Vetting · BIQ5 — Cuestionario OCIMF de inspección de barcazas y remolcadores.
//
// Tercer panel de evidencia read-only, hermano de TMSA e ISM: por capítulo del
// BIQ muestra qué respalda el sistema, con semáforo, métricas en vivo,
// drill-down a los registros, análisis IA y PDF de preparación. Lo que sólo se
// ve mirando el buque queda escrito como "a verificar a bordo".
//
// Consume /app/vetting/biq (vetting-service.ts). Los textos del BIQ son de
// OCIMF: acá van resumidos con palabras propias (`vet.chapter.*`) y con el
// número de pregunta.

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Binoculars, Download, Loader2, CheckCircle2, AlertTriangle, XCircle, Info, ChevronRight, Sparkles, ClipboardCheck } from "lucide-react";
import { useFetch } from "../lib/hooks";
import { api, ApiError } from "../lib/api";
import { PageHeader } from "../components/PageHeader";
import { ModalCloseButton } from "../components/ModalCloseButton";
import { useVesselContext } from "../lib/vessel-context";
import { useHiddenNavPaths } from "../lib/nav-config";
import { downloadAuthedFile } from "../lib/authed-media";
import { useT, type TranslationKey } from "../lib/i18n";
import { auditMetricLabelKey, moduleListLink } from "../lib/tmsa-filter";
import { ComplianceFixModal, FixBlock, fixSteps, findingValue, type ComplianceFinding, type FixChip } from "../components/compliance/FixModal";

// ─── Types (espejo de vetting-service.ts) ───────────────────────────────────
type VetStatus = "OK" | "ATTENTION" | "GAP" | "INFO";
interface VetMetric { key: string; value: number; kind: "count" | "pct"; }
type VetFinding = ComplianceFinding;
interface VetGroup { key: string; chapter: Chapter; questions: string; status: VetStatus; own: boolean; metrics: VetMetric[]; findings?: VetFinding[]; }
interface VetVesselEvidence {
  /** "" cuando el item consolida toda la flota. */
  vesselCode: string;
  vesselName: string;
  vesselCount: number;
  crewedCount: number;
  uncrewedCount: number;
  summary: { ok: number; attention: number; gap: number; info: number };
  groups: VetGroup[];
}

type VetEntityType = "asset" | "workOrder" | "maintenancePlan" | "deferral" | "spare" | "spareRequest" | "fluidAnalysis" | "defect" | "moc" | "certificate" | "inspection" | "permit" | "drydockSpec"
  | "vessel" | "crew" | "drill" | "externalAudit";
interface VetDetailItem {
  id: string;
  code: string;
  label: string;
  sublabel?: string | null;
  entityType: VetEntityType;
}

/** Los trece capítulos del BIQ5, en el orden del cuestionario. */
const CHAPTERS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13"] as const;
type Chapter = (typeof CHAPTERS)[number];

const STATUS_META: Record<VetStatus, { icon: typeof CheckCircle2; cls: string; pill: string }> = {
  OK:        { icon: CheckCircle2, cls: "text-emerald-600 dark:text-emerald-400", pill: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20" },
  ATTENTION: { icon: AlertTriangle, cls: "text-yellow-700 dark:text-yellow-400", pill: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-300 border-yellow-500/20" },
  GAP:       { icon: XCircle, cls: "text-red-700 dark:text-red-400", pill: "bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/20" },
  INFO:      { icon: Info, cls: "text-text-industrial/50", pill: "bg-fg/5 text-text-industrial/60 border-fg/10" },
};

function metricValue(m: VetMetric): string {
  return m.kind === "pct" ? `${Math.round(m.value * 100)}%` : m.value.toLocaleString("es-AR");
}

/** Mismo mapeo de deep-links que TMSA e ISM, más las entidades propias del vetting. */
function navFor(item: VetDetailItem): string {
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
    case "vessel": return "/vessels";
    case "crew": return "/crew";
    case "drill": return "/drills";
    case "externalAudit": return "/external-audits";
  }
}

/** Los grupos propios tienen `vet.group.*`; los heredados de TMSA, `tmsa.group.*`. */
const groupLabelKey = (g: { key: string; own: boolean }): TranslationKey =>
  (g.own ? `vet.group.${g.key}` : `tmsa.group.${g.key}`) as TranslationKey;

/** Idem para el texto de "qué está mal / cómo se arregla". */
const fixKey = (own: boolean, key: string, part: "title" | "what" | "how"): TranslationKey =>
  `${own ? "vet" : "tmsa"}.fix.${key}.${part}` as TranslationKey;

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
  group: VetGroup;
  groupLabel: string;
}

interface VetAssessment {
  narrative: string;
  recommendedAction: string;
}

// Panel de análisis IA — mismo contrato que el de ISM, contra el endpoint de vetting.
const VetAiAssessment: React.FC<{
  vesselCode: string;
  groupKey: string;
  metricKey?: string;
  auto?: boolean;
}> = ({ vesselCode, groupKey, metricKey, auto }) => {
  const t = useT();
  const [assessment, setAssessment] = useState<VetAssessment | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const startedRef = useRef(false);

  const analyze = useCallback(async () => {
    if (startedRef.current) return;
    startedRef.current = true;
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const res = await api.post<VetAssessment>("/app/vetting/biq/assessment", {
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
          <p className="text-[10px] text-text-industrial/40 italic">{t("vet.detail.analyzeDisclaimer")}</p>
        </div>
      )}
    </div>
  );
};

/** Los hallazgos de un bloque: qué está mal y cómo se arregla. */
const FindingBlocks: React.FC<{ group: VetGroup }> = ({ group }) => {
  const t = useT();
  return (
    <>
      {(group.findings ?? []).map(f => (
        <FixBlock
          key={f.key}
          pill={STATUS_META[f.status].pill}
          title={t(fixKey(group.own, f.key, "title"))}
          value={findingValue(f)}
          what={t(fixKey(group.own, f.key, "what"))}
          steps={fixSteps(t(fixKey(group.own, f.key, "how")))}
        />
      ))}
    </>
  );
};

// Modal del bloque completo: se abre desde el badge de estado y analiza solo.
const VetGroupAssessmentModal: React.FC<{ target: GroupAssessTarget; onClose: () => void }> = ({ target, onClose }) => {
  const t = useT();
  const { group } = target;
  const meta = STATUS_META[group.status];
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
              {target.vesselName} · BIQ {group.questions}
            </p>
            <h2 className="text-sm font-bold text-fg truncate">{target.groupLabel}</h2>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold ${meta.pill}`}>
              <Icon className="w-3 h-3" />
              {t(`tmsa.status.${group.status}` as TranslationKey)}
            </span>
            <ModalCloseButton onClose={onClose} />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <p className="text-xs text-text-industrial/70 italic leading-relaxed">
            {t(`vet.chapter.${group.chapter}.what` as TranslationKey)}
          </p>
          <FindingBlocks group={group} />
          <div>
            <p className="text-[10px] uppercase tracking-wider text-text-industrial/40 mb-1.5">{t("tmsa.assess.metrics")}</p>
            <dl className="space-y-1">
              {group.metrics.map(m => (
                <div key={m.key} className="flex items-center justify-between gap-2 text-[11px]">
                  <dt className="text-text-industrial/60 truncate">{t(auditMetricLabelKey(m.key))}</dt>
                  <dd className="font-bold text-fg shrink-0">{metricValue(m)}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="pt-3 border-t border-fg/10">
            <VetAiAssessment vesselCode={target.vesselCode} groupKey={group.key} auto />
          </div>
        </div>
      </div>
    </div>
  );
};

const VetDrillDownModal: React.FC<{ target: DrillDownTarget; onClose: () => void }> = ({ target, onClose }) => {
  const t = useT();
  const navigate = useNavigate();
  const path = `/app/vetting/biq/detail?vesselCode=${encodeURIComponent(target.vesselCode)}&metric=${encodeURIComponent(target.metricKey)}`;
  const { data, loading, error } = useFetch<{ items: VetDetailItem[] }>(path, [path]);
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
          <VetAiAssessment vesselCode={target.vesselCode} groupKey={target.groupKey} metricKey={target.metricKey} />
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

// ─── Cuestionario: una tarjeta por capítulo ─────────────────────────────────
// El rating es una propiedad del sistema (no cambia por buque): cuánto del
// capítulo puede respaldar con datos. El estado en vivo sale de la evidencia.
type Rating = "full" | "partial" | "none";
const RATING_STATUS: Record<Rating, VetStatus> = { full: "OK", partial: "ATTENTION", none: "GAP" };
/** A qué buques apunta el capítulo. */
type Applies = "all" | "tugs" | "barges" | "packed";

interface ChecklistChip { navKey: TranslationKey; route?: string; tab?: boolean; }
interface ChapterItem {
  chapter: Chapter;
  rating: Rating;
  applies: Applies;
  /** Bloques de evidencia del capítulo, en el orden en que se muestran. */
  groupKeys: string[];
  chips: ChecklistChip[];
}

const CHAPTER_ITEMS: ChapterItem[] = [
  { chapter: "1", rating: "partial", applies: "all", groupKeys: ["vesselParticulars"],
    chips: [{ navKey: "nav.vessels", route: "/vessels" }] },
  { chapter: "2", rating: "partial", applies: "all", groupKeys: ["classSurveys", "certificates", "externalInspections"],
    chips: [{ navKey: "nav.certificates", route: "/certificates" }, { navKey: "nav.externalAudits", route: "/external-audits" }] },
  { chapter: "3", rating: "partial", applies: "tugs", groupKeys: ["crewCompliance"],
    chips: [{ navKey: "nav.crew", route: "/crew" }, { navKey: "nav.crewMatrix", route: "/crew-matrix" }, { navKey: "nav.restHours", route: "/rest-hours" }] },
  { chapter: "4", rating: "partial", applies: "all", groupKeys: ["navEquipment"],
    chips: [{ navKey: "nav.assets", route: "/equipment" }, { navKey: "nav.maintenancePlans", route: "/maintenance-plans" }] },
  { chapter: "5", rating: "partial", applies: "all", groupKeys: ["fireFighting", "lifeSaving", "drills", "permits"],
    chips: [{ navKey: "nav.maintenancePlans", route: "/maintenance-plans" }, { navKey: "nav.drills", route: "/drills" }, { navKey: "nav.permits", route: "/permits" }] },
  { chapter: "6", rating: "none", applies: "all", groupKeys: [],
    chips: [{ navKey: "nav.drills", route: "/drills" }] },
  { chapter: "7", rating: "partial", applies: "all", groupKeys: ["structure"],
    chips: [{ navKey: "nav.maintenancePlans", route: "/maintenance-plans" }, { navKey: "nav.certificates", route: "/certificates" }] },
  { chapter: "8", rating: "partial", applies: "barges", groupKeys: ["cargoSystem"],
    chips: [{ navKey: "nav.assets", route: "/equipment" }, { navKey: "nav.maintenancePlans", route: "/maintenance-plans" }] },
  { chapter: "9", rating: "partial", applies: "all", groupKeys: ["mooring"],
    chips: [{ navKey: "nav.maintenancePlans", route: "/maintenance-plans" }] },
  { chapter: "10", rating: "partial", applies: "all", groupKeys: ["towing"],
    chips: [{ navKey: "nav.maintenancePlans", route: "/maintenance-plans" }] },
  { chapter: "11", rating: "partial", applies: "all", groupKeys: ["machinerySafety", "pmsCoverage", "plannedMaintenance", "criticalSpares", "deferralControl"],
    chips: [{ navKey: "nav.maintenancePlans", route: "/maintenance-plans" }, { navKey: "nav.workOrders", route: "/work-orders" }, { navKey: "nav.spares", route: "/spares" }] },
  { chapter: "12", rating: "none", applies: "all", groupKeys: [], chips: [] },
  { chapter: "13", rating: "none", applies: "packed", groupKeys: [], chips: [] },
];

interface FixTarget {
  kind: "usage" | "capacity";
  chapter: Chapter;
  /** El bloque cuyo badge se apretó (sólo en "usage"). */
  group?: VetGroup;
  status: VetStatus;
  ratingLabel?: string;
  chips: ChecklistChip[];
}

const VetFixModal: React.FC<{
  target: FixTarget;
  onClose: () => void;
  onGoEvidence: () => void;
}> = ({ target, onClose, onGoEvidence }) => {
  const t = useT();
  const navigate = useNavigate();
  const meta = STATUS_META[target.status];
  const isCapacity = target.kind === "capacity";
  const group = target.group;

  const chips: FixChip[] = target.chips.map(chip => ({
    label: t(chip.navKey),
    onClick: () => { onClose(); chip.tab ? onGoEvidence() : navigate(chip.route!); },
  }));

  return (
    <ComplianceFixModal
      eyebrow={group ? `BIQ ${group.questions}` : `BIQ · ${t("vet.chapterLabel")} ${target.chapter}`}
      title={group ? t(groupLabelKey(group)) : t(`vet.chapter.${target.chapter}.title` as TranslationKey)}
      statusPill={meta.pill}
      StatusIcon={meta.icon}
      statusLabel={isCapacity ? (target.ratingLabel ?? "") : t(`tmsa.status.${target.status}` as TranslationKey)}
      chips={chips}
      onClose={onClose}
    >
      {isCapacity || !group ? (
        <FixBlock
          pill={STATUS_META.INFO.pill}
          title={t("fix.capacityTitle")}
          what={t(`vet.chapter.${target.chapter}.system` as TranslationKey)}
          extra={`${t("vet.checklist.onboardLabel")}: ${t(`vet.chapter.${target.chapter}.onboard` as TranslationKey)}`}
        />
      ) : (group.findings ?? []).length === 0 ? (
        <FixBlock pill={STATUS_META.OK.pill} title={t("fix.noneTitle")} what={t("fix.noneWhat")} />
      ) : (
        <FindingBlocks group={group} />
      )}
    </ComplianceFixModal>
  );
};

const VetChapterCard: React.FC<{
  item: ChapterItem;
  evidence: VetVesselEvidence | null;
  /** Módulos que la empresa ocultó del menú: sus accesos no se ofrecen. */
  hiddenPaths: string[];
  onGoEvidence: () => void;
}> = ({ item: rawItem, evidence, hiddenPaths, onGoEvidence }) => {
  const t = useT();
  const navigate = useNavigate();
  const [fix, setFix] = useState<FixTarget | null>(null);
  // Mismo criterio que el menú y el Dashboard: un módulo oculto no se ofrece.
  const item = { ...rawItem, chips: rawItem.chips.filter(c => !c.route || !hiddenPaths.includes(c.route)) };
  const capMeta = STATUS_META[RATING_STATUS[item.rating]];
  const CapIcon = capMeta.icon;
  const ch = item.chapter;
  const groups = evidence
    ? item.groupKeys.map(k => evidence.groups.find(g => g.key === k)).filter((g): g is VetGroup => !!g)
    : [];
  // En el bloque de flota va vacío a propósito: el link sale sin buque.
  const vesselCode = evidence?.vesselCode ?? "";

  return (
    <div className="bg-fg/[0.03] border border-fg/10 rounded-xl p-4">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-mono uppercase tracking-wider text-text-industrial/40">BIQ · {t("vet.chapterLabel")} {ch}</p>
          <h4 className="text-sm font-semibold text-fg leading-snug mt-0.5">{t(`vet.chapter.${ch}.title` as TranslationKey)}</h4>
        </div>
        <span className="shrink-0 px-2 py-0.5 rounded-full bg-fg/5 border border-fg/10 text-[10px] font-medium text-text-industrial/60">
          {t(`vet.applies.${item.applies}` as TranslationKey)}
        </span>
      </div>
      {/* Qué mira el inspector: resumen propio del capítulo (el texto es de OCIMF). */}
      <p className="text-xs text-text-industrial/70 leading-relaxed italic border-l-2 border-fg/10 pl-2.5">
        {t(`vet.chapter.${ch}.what` as TranslationKey)}
      </p>
      <p className="text-xs text-text-industrial/70 leading-relaxed mt-2">
        <span className="font-semibold text-fg/80">{t("vet.checklist.systemLabel")}: </span>
        {t(`vet.chapter.${ch}.system` as TranslationKey)}
      </p>
      <p className="text-xs text-text-industrial/70 leading-relaxed mt-1">
        <span className="font-semibold text-fg/80">{t("vet.checklist.onboardLabel")}: </span>
        {t(`vet.chapter.${ch}.onboard` as TranslationKey)}
      </p>

      <div className="mt-2.5">
        <p className="text-[9px] uppercase tracking-wider text-text-industrial/40 mb-1">{t("tmsa.checklist.capacityLabel")}</p>
        <button
          type="button"
          onClick={() => setFix({
            kind: "capacity", chapter: ch, status: RATING_STATUS[item.rating],
            ratingLabel: t(`tmsa.checklist.rating.${item.rating}` as TranslationKey), chips: item.chips,
          })}
          title={t("fix.capacityTitle")}
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold hover:brightness-110 transition-all ${capMeta.pill}`}
        >
          <CapIcon className="w-3 h-3" />
          {t(`tmsa.checklist.rating.${item.rating}` as TranslationKey)}
        </button>
      </div>

      {item.groupKeys.length > 0 && (
        <div className="mt-2.5">
          <p className="text-[9px] uppercase tracking-wider text-text-industrial/40 mb-1">{t("tmsa.checklist.usageLabel")}</p>
          {!evidence ? (
            <span className="text-[10px] text-text-industrial/40 italic">{t("tmsa.checklist.noVessel")}</span>
          ) : groups.length === 0 ? (
            // El backend no arma los bloques de un módulo oculto por la empresa.
            <span className="text-[10px] text-text-industrial/50 italic">{t("vet.checklist.moduleHidden")}</span>
          ) : (
            <div className="space-y-2">
              {groups.map(g => {
                const meta = STATUS_META[g.status];
                const Icon = meta.icon;
                return (
                  <div key={g.key}>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setFix({ kind: "usage", chapter: ch, group: g, status: g.status, chips: item.chips })}
                        title={t("fix.title")}
                        className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold hover:brightness-110 transition-all ${meta.pill}`}
                      >
                        <Icon className="w-3 h-3" />
                        {t(`tmsa.status.${g.status}` as TranslationKey)}
                      </button>
                      <span className="text-xs font-medium text-fg/80 truncate">{t(groupLabelKey(g))}</span>
                    </div>
                    {g.metrics.length > 0 && (
                      <dl className="flex flex-wrap gap-1.5 mt-1.5">
                        {g.metrics.map(m => {
                          // El badge entero abre la planilla con esos mismos
                          // registros; los que no tienen planilla quedan apagados.
                          const link = m.kind === "count" ? moduleListLink(m.key, vesselCode) : null;
                          const content = (
                            <>
                              <dt className="text-text-industrial/60">{t(auditMetricLabelKey(m.key))}:</dt>
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
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {fix && <VetFixModal target={fix} onClose={() => setFix(null)} onGoEvidence={onGoEvidence} />}

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

const VetChecklistView: React.FC<{ items: VetVesselEvidence[]; onGoEvidence: () => void }> = ({ items, onGoEvidence }) => {
  const t = useT();
  const counts = CHAPTER_ITEMS.reduce(
    (acc, it) => { acc[it.rating]++; return acc; },
    { full: 0, partial: 0, none: 0 } as Record<Rating, number>,
  );
  // El estado en vivo es de UN bloque: el buque elegido, o la flota consolidada.
  const evidence = items.length === 1 ? items[0]! : null;
  const hiddenPaths = useHiddenNavPaths();

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs text-text-industrial/60 max-w-3xl">{t("vet.checklist.subtitle")}</p>
        <p className="text-[10px] text-text-industrial/40 italic mt-1">{t("vet.checklist.scope")}</p>
      </div>
      <div className="flex items-center gap-4 text-[11px] font-medium">
        <span className="text-emerald-600 dark:text-emerald-400">{t("tmsa.checklist.rating.full")} {counts.full}</span>
        <span className="text-yellow-700 dark:text-yellow-400">{t("tmsa.checklist.rating.partial")} {counts.partial}</span>
        <span className="text-red-700 dark:text-red-400">{t("tmsa.checklist.rating.none")} {counts.none}</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
        {CHAPTER_ITEMS.map(it => (
          <VetChapterCard key={it.chapter} item={it} evidence={evidence} hiddenPaths={hiddenPaths} onGoEvidence={onGoEvidence} />
        ))}
      </div>
      <p className="text-[10px] text-text-industrial/40 italic max-w-3xl pt-2 border-t border-fg/5">{t("vet.checklist.disclaimer")}</p>
    </div>
  );
};

// ─── Página ─────────────────────────────────────────────────────────────────

export const VettingPage: React.FC = () => {
  const t = useT();
  const { selectedVesselCode } = useVesselContext();
  const qs = selectedVesselCode ? `?vesselCode=${encodeURIComponent(selectedVesselCode)}` : "";
  const path = `/app/vetting/biq${qs}`;
  const { data, loading, error, reload } = useFetch<{ items: VetVesselEvidence[] }>(path, [path]);
  const [drillDown, setDrillDown] = useState<DrillDownTarget | null>(null);
  const [groupAssess, setGroupAssess] = useState<GroupAssessTarget | null>(null);

  // El botón del Dashboard entra directo al cuestionario, igual que TMSA e ISM.
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<"evidence" | "checklist">(searchParams.get("tab") === "evidence" ? "evidence" : "checklist");

  const exportPdf = () => {
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = selectedVesselCode
      ? `vetting-biq5-${selectedVesselCode}-${dateStr}.pdf`
      : `vetting-biq5-flota-${dateStr}.pdf`;
    void downloadAuthedFile(`/app/vetting/biq/pdf${qs}`, filename);
  };

  const items = data?.items ?? [];

  return (
    <div className="space-y-4">
      <PageHeader icon={Binoculars} title={t("vet.title")} onReload={reload}>
        <button
          type="button"
          onClick={exportPdf}
          disabled={items.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent/10 border border-accent/20 text-xs font-medium text-accent hover:bg-accent/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          title={t("vet.exportTitle")}
        >
          <Download className="w-3.5 h-3.5" />
          {t("vet.export")}
        </button>
      </PageHeader>

      <div className="flex items-center gap-1 border-b border-fg/10">
        <button
          type="button"
          onClick={() => setTab("checklist")}
          className={`flex items-center gap-1.5 px-3 py-2 text-xs font-bold border-b-2 transition-colors ${tab === "checklist" ? "border-accent text-accent" : "border-transparent text-text-industrial/50 hover:text-fg"}`}
        >
          <ClipboardCheck className="w-3.5 h-3.5" />
          {t("vet.tabs.checklist")}
        </button>
        <button
          type="button"
          onClick={() => setTab("evidence")}
          className={`px-3 py-2 text-xs font-bold border-b-2 transition-colors ${tab === "evidence" ? "border-accent text-accent" : "border-transparent text-text-industrial/50 hover:text-fg"}`}
        >
          {t("vet.tabs.evidence")}
        </button>
      </div>

      {loading && (
        <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-accent" /></div>
      )}
      {error && !loading && (
        <p className="text-sm text-red-600 dark:text-red-400">{t("vet.loadError")}</p>
      )}

      {tab === "checklist" ? (
        !loading && <VetChecklistView items={items} onGoEvidence={() => setTab("evidence")} />
      ) : (
        <>
          <p className="text-xs text-text-industrial/60 max-w-3xl">{t("vet.subtitle")}</p>
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

              {/* Los bloques vienen en el orden del cuestionario: se abre un
                  encabezado con el capítulo cada vez que cambia. */}
              {CHAPTERS.map(ch => {
                const groups = v.groups.filter(g => g.chapter === ch);
                if (groups.length === 0) return null;
                return (
                  <div key={ch} className="space-y-2">
                    <div className="pt-1 border-t border-dashed border-fg/10">
                      <p className="text-[10px] font-mono uppercase tracking-wider text-text-industrial/40">
                        BIQ · {t("vet.chapterLabel")} {ch} · {t(`vet.chapter.${ch}.title` as TranslationKey)}
                      </p>
                      <p className="text-[11px] text-text-industrial/55 italic max-w-3xl mt-0.5">
                        {t(`vet.chapter.${ch}.what` as TranslationKey)}
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
                                <p className="text-[9px] uppercase tracking-wider text-text-industrial/40">BIQ {g.questions}</p>
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
                                  onClick={() => setGroupAssess({ vesselCode: v.vesselCode, vesselName: v.vesselName, group: g, groupLabel: label })}
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
                                const metricLabel = t(auditMetricLabelKey(m.key));
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
              {t("vet.disclaimer")}
            </p>
          )}
        </>
      )}

      {drillDown && <VetDrillDownModal target={drillDown} onClose={() => setDrillDown(null)} />}
      {groupAssess && <VetGroupAssessmentModal target={groupAssess} onClose={() => setGroupAssess(null)} />}
    </div>
  );
};
