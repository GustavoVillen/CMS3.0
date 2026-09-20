// Tipos y reglas de presentación del asesor técnico (Preview V2, 19/09/2026).
// Espejo de maintenance-advisor-service.ts. Separado de los componentes para
// que Fast Refresh siga funcionando.
//
// Todo lo que acá se deriva (para cuándo, qué área toca, qué buques) sale de
// datos del sistema, no de la IA: la prioridad del hallazgo y los registros
// reales que cita.

import type { TranslationKey } from "../../lib/i18n";

export type FindingPriority = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
export type ActionStatus = "OPEN" | "IN_PROGRESS" | "VERIFIED" | "CANCELLED";

export interface EvidenceItem {
  id: string;
  kind: string;
  code: string | null;
  vesselCode: string | null;
  vesselName: string | null;
  assetName: string | null;
  date: string | null;
  title: string;
  detail: string;
  link: string | null;
}

export interface AdvisorFinding {
  key: string;
  priority: FindingPriority;
  title: string;
  vessels: string[];
  whyItMatters: string;
  evidenceIds: string[];
  facts: string;
  assessment: string;
  recommendedAction: string;
  responsibleRole: string;
  targetDays: number | null;
  target: string;
  verify: string;
  managementAdvice: string;
  systemic: boolean;
  alternatives: Array<{ option: string; pros: string; cons: string; risk: string; cost: string; operational: string }>;
  noEvidence: boolean;
}

export interface AdvisorAction {
  id: string;
  reportId: string | null;
  findingKey: string | null;
  title: string;
  vesselCode: string | null;
  vesselName: string | null;
  responsibleName: string;
  targetDate: string;
  priority: FindingPriority;
  status: ActionStatus;
  verificationCriteria: string | null;
  verificationNote: string | null;
}

/** Conversación del Director con el asesor sobre un tema (Preview V3). */
export interface AdvisorProposal {
  action: string;
  who: string;
  when: string;
  targetDays: number | null;
  verify: string;
}

export interface AdvisorMessage {
  id: string;
  findingKey: string;
  step: "WHAT" | "DO";
  role: "DIRECTOR" | "ADVISOR";
  text: string;
  proposal: AdvisorProposal | null;
  warning: string | null;
  appliedAt: string | null;
  createdAt: string;
  createdByName: string | null;
}

/**
 * Plan vigente del tema: la última propuesta del asesor que el Director adoptó;
 * si no hay ninguna, el plan original del informe.
 */
export function currentPlan(f: AdvisorFinding, messages: AdvisorMessage[]): AdvisorProposal & { adjusted: boolean; appliedId: string | null } {
  const applied = messages
    .filter(m => m.findingKey === f.key && m.appliedAt && m.proposal)
    .sort((a, b) => (a.appliedAt! < b.appliedAt! ? 1 : -1))[0];
  if (applied?.proposal) return { ...applied.proposal, adjusted: true, appliedId: applied.id };
  return { action: f.recommendedAction, who: f.responsibleRole, when: f.target, targetDays: f.targetDays, verify: f.verify, adjusted: false, appliedId: null };
}

// ── Radiografía de equipos (20/09/2026) ──────────────────────────────────────

export type AssetHealthState = "FRAGILE" | "WATCH" | "OK";

export interface AssetHealthSignal { code: string; n?: number }

export interface AssetHealthRow {
  assetId: string;
  assetName: string;
  assetCode: string;
  vesselCode: string;
  vesselName: string | null;
  criticality: string;
  safetyCritical: boolean;
  state: AssetHealthState;
  score: number;
  signals: AssetHealthSignal[];
  counts: {
    correctives: number; unplanned: number; defects: number; defectsReopened: number;
    labAlarms: number; labCautions: number; deferrals: number; overduePlans: number;
    spareIssues: number; spareQty: number;
  };
  noBackup: boolean;
}

export interface FleetModelIssue {
  manufacturer: string | null;
  model: string;
  vessels: string[];
  assets: number;
  defects: number;
  unplanned: number;
}

export interface AssetHealthResult {
  rows: AssetHealthRow[];
  fragile: number;
  watch: number;
  fleetModels: FleetModelIssue[];
}

/** Comparación con el análisis anterior del mismo alcance. */
export interface AdvisorTrend {
  previousAt: string;
  metrics: Record<string, { before: number | null; now: number | null }>;
  assets: Record<string, { state: string; score: number }>;
}

export const SIGNAL_LABEL: Record<string, TranslationKey> = {
  UNPLANNED: "advisor.signal.unplanned",
  CORRECTIVE: "advisor.signal.corrective",
  DEFECTS_REPEATED: "advisor.signal.defects",
  DEFECT_REOPENED: "advisor.signal.reopened",
  LAB_ALARM: "advisor.signal.labAlarm",
  LAB_CAUTION: "advisor.signal.labCaution",
  DEFERRAL: "advisor.signal.deferral",
  OVERDUE: "advisor.signal.overdue",
  SPARES: "advisor.signal.spares",
  NO_BACKUP: "advisor.signal.noBackup",
  DEGRADED: "advisor.signal.degraded",
};

/** Señales que pintan rojo (las que más delatan al equipo). */
export const SIGNAL_STRONG = new Set(["UNPLANNED", "LAB_ALARM", "NO_BACKUP", "DEGRADED"]);

export const ASSET_STATE_STYLE: Record<AssetHealthState, { badge: string; label: TranslationKey }> = {
  FRAGILE: { badge: "bg-red-600 text-white", label: "advisor.assetState.fragile" },
  WATCH: { badge: "bg-amber-400/30 text-amber-900 dark:text-amber-200", label: "advisor.assetState.watch" },
  OK: { badge: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400", label: "advisor.assetState.ok" },
};

/**
 * Flecha de comparación contra el análisis anterior. En estos números, MENOS es
 * mejor (vencidos, defectos, equipos delicados): bajar es 🟢, subir es 🔴.
 */
export function trendOf(t: AdvisorTrend | null | undefined, key: string): { dir: "up" | "down" | "same"; before: number; now: number } | null {
  const m = t?.metrics?.[key];
  if (!m || m.before == null || m.now == null) return null;
  if (m.before === m.now) return { dir: "same", before: m.before, now: m.now };
  return { dir: m.now > m.before ? "up" : "down", before: m.before, now: m.now };
}

export interface AdvisorMetrics {
  plansOverdue: number;
  plansOverdueCritical: number;
  deferralsActive: number;
  criticalSparesBelowMin: number;
  criticalSparesNeverCounted?: number;
  criticalSparesWithMin?: number;
  assetsWithRepeatedDefects: number;
  labAlarmsWithoutAction: number;
  defectsOpenHigh: number;
  closedWithoutEvidence60d: number;
  closedWorkOrders60d?: number;
  fragileAssets?: number;
  watchAssets?: number;
  hoursPlansDueSoon?: number;
}

// ─── Para cuándo (en vez de Crítica / Alta / Media / Baja) ────────────────────

export type Bucket = "today" | "week" | "month" | "later";
export const BUCKETS: Bucket[] = ["today", "week", "month", "later"];
export const BUCKET_OF: Record<FindingPriority, Bucket> = { CRITICAL: "today", HIGH: "week", MEDIUM: "month", LOW: "later" };
export const BUCKET_LABEL: Record<Bucket, TranslationKey> = {
  today: "advisor.bucket.today", week: "advisor.bucket.week", month: "advisor.bucket.month", later: "advisor.bucket.later",
};
export const BUCKET_ICON: Record<Bucket, string> = { today: "🔴", week: "🟠", month: "🔵", later: "⚪" };
/** Clases por bucket: borde de la fila, píldora, barra. */
export const BUCKET_STYLE: Record<Bucket, { border: string; pill: string; bar: string }> = {
  today: { border: "border-l-red-600", pill: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30", bar: "bg-red-600" },
  week:  { border: "border-l-amber-500", pill: "bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-500/30", bar: "bg-amber-500" },
  month: { border: "border-l-blue-400", pill: "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30", bar: "bg-blue-400" },
  later: { border: "border-l-slate-300", pill: "bg-fg/5 text-text-industrial border-fg/15", bar: "bg-slate-400" },
};

// ─── Áreas de los semáforos ───────────────────────────────────────────────────

export type Area = "plan" | "failures" | "spares" | "closure";
export const AREAS: Area[] = ["plan", "failures", "spares", "closure"];
export const AREA_LABEL: Record<Area, TranslationKey> = {
  plan: "advisor.area.plan", failures: "advisor.area.failures", spares: "advisor.area.spares", closure: "advisor.area.closure",
};
export const AREA_ICON: Record<Area, string> = { plan: "📅", failures: "🔁", spares: "📦", closure: "✅" };
const KIND_AREA: Record<string, Area> = {
  PLAN: "plan", DEFERRAL: "plan", DEFECT: "failures", LAB: "failures", SPARE: "spares", SPARE_REQUEST: "spares", WORK_ORDER: "closure",
};

export type Health = "bad" | "warn" | "ok" | "nodata";
export const HEALTH_LABEL: Record<Health, TranslationKey> = {
  bad: "advisor.status.bad", warn: "advisor.status.warn", ok: "advisor.status.ok", nodata: "advisor.status.nodata",
};
export const HEALTH_STYLE: Record<Health, { dot: string; word: string }> = {
  bad: { dot: "bg-red-500/10", word: "text-red-700 dark:text-red-400" },
  warn: { dot: "bg-amber-500/10", word: "text-amber-700 dark:text-amber-400" },
  ok: { dot: "bg-emerald-500/10", word: "text-emerald-700 dark:text-emerald-400" },
  nodata: { dot: "bg-fg/5", word: "text-text-industrial/70" },
};

/** Semáforo de cada área con su frase corta. Los números son del sistema. */
export function areaHealth(m: AdvisorMetrics): Record<Area, { health: Health; text: TranslationKey; n?: number }> {
  const neverCounted = m.criticalSparesNeverCounted ?? 0;
  const reallyBelow = m.criticalSparesBelowMin - neverCounted;
  return {
    plan: m.plansOverdueCritical > 0 ? { health: "bad", text: "advisor.h.planCritical", n: m.plansOverdueCritical }
      : m.plansOverdue > 0 ? { health: "warn", text: "advisor.h.planOverdue", n: m.plansOverdue }
      : { health: "ok", text: "advisor.h.planOk" },
    failures: m.defectsOpenHigh > 0 ? { health: "bad", text: "advisor.h.defectsHigh", n: m.defectsOpenHigh }
      : m.labAlarmsWithoutAction > 0 ? { health: "bad", text: "advisor.h.labNoAction", n: m.labAlarmsWithoutAction }
      : m.assetsWithRepeatedDefects > 0 ? { health: "warn", text: "advisor.h.repeated", n: m.assetsWithRepeatedDefects }
      : { health: "ok", text: "advisor.h.failuresOk" },
    // criticalSparesWithMin / closedWorkOrders60d no existen en informes previos
    // al 19/09 (V2): ahí `undefined` no significa "cero", se decide con lo demás.
    spares: m.criticalSparesWithMin === 0 ? { health: "nodata", text: "advisor.h.sparesNoMin" }
      : reallyBelow > 0 ? { health: "bad", text: "advisor.h.sparesBelow", n: reallyBelow }
      : neverCounted > 0 ? { health: "nodata", text: "advisor.h.sparesNeverCounted" }
      : { health: "ok", text: "advisor.h.sparesOk" },
    closure: m.closedWorkOrders60d === 0 ? { health: "nodata", text: "advisor.h.closureNone" }
      : m.closedWithoutEvidence60d > 0 ? { health: "warn", text: "advisor.h.closureMissing", n: m.closedWithoutEvidence60d }
      : { health: "ok", text: "advisor.h.closureOk" },
  };
}

/** Registros reales que cita un hallazgo. */
export function findingEvidence(f: AdvisorFinding, evidence: EvidenceItem[]): EvidenceItem[] {
  return evidence.filter(e => f.evidenceIds.includes(e.id));
}

/** Buques de un hallazgo, sacados de sus registros (no del texto de la IA). */
export function findingVesselCodes(f: AdvisorFinding, evidence: EvidenceItem[]): string[] {
  return Array.from(new Set(findingEvidence(f, evidence).map(e => e.vesselCode).filter((c): c is string => !!c)));
}

export function findingAreas(f: AdvisorFinding, evidence: EvidenceItem[]): Set<Area> {
  return new Set(findingEvidence(f, evidence).map(e => KIND_AREA[e.kind]).filter((a): a is Area => !!a));
}

export const EVIDENCE_ICON: Record<string, string> = {
  PLAN: "📅", WORK_ORDER: "🛠️", DEFECT: "⚠️", DEFERRAL: "⏸️", LAB: "🧪", SPARE: "📦", SPARE_REQUEST: "🛒",
  CERTIFICATE: "📜", PROVIDER_NC: "🏭", CREW: "👥", ALERT: "🔔", KPI: "📊",
};

/** "Vencido hace 2 días" / "Vence hoy" / "En 3 días" — con su color. */
export function dueBadge(targetDate: string, t: (k: TranslationKey) => string): { text: string; cls: string } {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(targetDate.slice(0, 10) + "T00:00:00");
  const diff = Math.round((due.getTime() - today.getTime()) / 86400000);
  if (diff < 0) return { text: t("advisor.fu.late").replace("{n}", String(-diff)), cls: "bg-red-500/10 text-red-700 dark:text-red-400" };
  if (diff === 0) return { text: t("advisor.fu.today"), cls: "bg-amber-500/15 text-amber-800 dark:text-amber-300" };
  if (diff <= 3) return { text: t("advisor.fu.in").replace("{n}", String(diff)), cls: "bg-amber-500/15 text-amber-800 dark:text-amber-300" };
  return { text: `${t("advisor.fu.in").replace("{n}", String(diff))}`, cls: "bg-fg/5 text-text-industrial" };
}
