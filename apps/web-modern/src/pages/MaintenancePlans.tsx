import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Clock,
  FileSpreadsheet,
  Filter,
  Loader2,
  Plus,
  X,
  Zap,
} from "lucide-react";
import { useFetch } from "../lib/hooks";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { DataTable, StatusBadge, type Column } from "../components/DataTable";
import { FILTER_ALL_VALUE, fmtDate, fromFilterSelectValue, toFilterSelectValue } from "../lib/utils";
import { PageHeader } from "../components/PageHeader";
import { ExcelPanel } from "../components/ExcelPanel";
import { useT } from "../lib/i18n";
import { useCopilotEmitter, useCopilotApplyFields } from "../lib/copilot-context";
import { CreateWorkOrderModal } from "../components/CreateWorkOrderModal";

// ─── Types ────────────────────────────────────────────────────────────────────

interface MaintenancePlan {
  id: string;
  tenantId: string;
  vesselCode: string;
  assetId: string;
  assetName?: string | null;
  activeWorkOrderCode?: string | null;
  assetCurrentHours?: number | null;
  taskCode: string;
  title: string;
  description: string | null;
  taskType: "MAINTENANCE" | "INSPECTION";
  triggerType: string;
  frequencyHours: number | null;
  frequencyMonths: number | null;
  status: string;
  executionStatus: string;
  lastExecutionDate: string | null;
  lastExecutionHours: number | null;
  nextDueDate: string | null;
  nextDueHours: number | null;
  taskMasterId: string | null;
  triggerResultMode: string;
  checklistTemplate: string | null;
  createdAt: string;
  responsible?: string | null;
  acceptanceCriteria?: string | null;
  evidenceRequired?: string | null;
  sfiGroupNumber?: number | null;
  sfiSubgroupCode?: string | null;
  riskLevel?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | null;
  riskAnalysisResult?: string | null;
}

interface ListResponse {
  items: MaintenancePlan[];
  total: number;
}

interface SfiNode {
  id: string;
  code: string;
  description: string;
  groupNumber: number;
  groupName: string;
}

// ─── Badge helpers ────────────────────────────────────────────────────────────

function computeStatus(plan: MaintenancePlan): string {
  if (plan.executionStatus === "IN_WINDOW") return "IN_WINDOW";
  const now = Date.now();
  if (plan.nextDueHours != null) {
    const hours = plan.assetCurrentHours ?? 0;
    const diff = plan.nextDueHours - hours;
    if (diff <= 0) return "OVERDUE";
    if (diff <= 50) return "DUE";
    if (diff <= 250) return "UPCOMING";
    return "FUTURE";
  }
  if (plan.nextDueDate) {
    const daysLeft = (new Date(plan.nextDueDate).getTime() - now) / 86_400_000;
    if (daysLeft < 0) return "OVERDUE";
    if (daysLeft <= 7) return "DUE";
    if (daysLeft <= 30) return "UPCOMING";
    return "FUTURE";
  }
  return plan.executionStatus ?? "FUTURE";
}

function StatusBadgeInline({ plan, onClickWo }: { plan: MaintenancePlan; onClickWo?: () => void }) {
  const es = computeStatus(plan);
  if (es === "OVERDUE")
    return (
      <div className="flex flex-col items-start gap-0.5">
        <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-bold bg-red-500/10 text-red-400 border-red-500/20 whitespace-nowrap">
          <AlertTriangle className="w-2.5 h-2.5" /> VENCIDA
        </span>
      </div>
    );
  if (es === "DUE")
    return (
      <div className="flex flex-col items-start gap-0.5">
        <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-bold bg-orange-500/10 text-orange-400 border-orange-500/20 whitespace-nowrap">
          <AlertTriangle className="w-2.5 h-2.5" /> POR VENCER
        </span>
      </div>
    );
  if (es === "IN_WINDOW")
    return (
      <div className="flex flex-col items-start gap-0.5">
        <button
          type="button"
          onClick={onClickWo}
          disabled={!onClickWo || !plan.activeWorkOrderCode}
          className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-bold bg-orange-500/10 text-orange-300 border-orange-500/20 whitespace-nowrap disabled:cursor-default enabled:hover:bg-orange-500/20 enabled:cursor-pointer transition-colors"
        >
          <Clock className="w-2.5 h-2.5" /> EN PROCESO
        </button>
        {plan.activeWorkOrderCode && (
          <span className="text-[9px] text-orange-400/70 font-mono pl-1">OT: {plan.activeWorkOrderCode}</span>
        )}
      </div>
    );
  if (es === "UPCOMING")
    return (
      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-bold bg-yellow-500/10 text-yellow-400 border-yellow-500/20 whitespace-nowrap">
        <Clock className="w-2.5 h-2.5" /> PRÓXIMO
      </span>
    );
  if (es === "COMPLETED")
    return (
      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-bold bg-emerald-500/10 text-emerald-400 border-emerald-500/20 whitespace-nowrap">
        <CheckCircle2 className="w-2.5 h-2.5" /> VÁLIDO
      </span>
    );
  // FUTURE
  return (
    <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-bold bg-emerald-500/10 text-emerald-400 border-emerald-500/20 whitespace-nowrap">
      <CheckCircle2 className="w-2.5 h-2.5" /> VÁLIDO
    </span>
  );
}

// ─── Misc helpers ─────────────────────────────────────────────────────────────

const EDITABLE_STATUSES = ["ACTIVE", "INACTIVE", "DRAFT"] as const;
const RISK_LEVELS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
const RISK_LEVEL_OPTS: [string, string, string, string][] = [
  ["LOW",      "L", "bg-success-sea text-primary-bg border-success-sea",  "text-success-sea border-success-sea/40"],
  ["MEDIUM",   "M", "bg-yellow-400 text-primary-bg border-yellow-400",    "text-yellow-400 border-yellow-400/40"],
  ["HIGH",     "H", "bg-red-500 text-white border-red-500",               "text-red-400 border-red-400/40"],
  ["CRITICAL", "C", "bg-red-700 text-white border-red-700",               "text-red-600 border-red-600/40"],
];

// SFI tab filter — G0-G9 filter by first digit of sfiGroupNumber (e.g. G6 = 600-699)
type SfiTab = "ALL" | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | "NONE";
const SFI_TABS: { key: SfiTab; label: string }[] = [
  { key: "ALL",  label: "TODOS" },
  { key: 0,      label: "G0" },
  { key: 1,      label: "G1" },
  { key: 2,      label: "G2" },
  { key: 3,      label: "G3" },
  { key: 4,      label: "G4" },
  { key: 5,      label: "G5" },
  { key: 6,      label: "G6" },
  { key: 7,      label: "G7" },
  { key: 8,      label: "G8" },
  { key: 9,      label: "G9" },
];

function sfiTabOf(sfiGroupNumber: number | null | undefined): SfiTab {
  if (sfiGroupNumber == null) return "NONE";
  const digit = sfiGroupNumber < 10 ? sfiGroupNumber : Math.floor(sfiGroupNumber / 100);
  return digit >= 0 && digit <= 9 ? digit as SfiTab : "NONE";
}
type RiskLevel = (typeof RISK_LEVELS)[number] | "";

function toUiRiskLevel(value: string | null | undefined): RiskLevel {
  const n = String(value ?? "").toUpperCase() as RiskLevel;
  return (RISK_LEVELS as readonly string[]).includes(n) ? n : "";
}

function formatFrequency(plan: MaintenancePlan): string {
  const tt = plan.triggerType.toUpperCase();
  if (tt === "CALENDAR" || tt === "MONTHS") return plan.frequencyMonths != null ? `${plan.frequencyMonths} mo` : "—";
  if (tt === "HOURS" || tt === "RUNNING_HOURS") return plan.frequencyHours != null ? `${plan.frequencyHours} h` : "—";
  if (tt === "DAY") return plan.frequencyMonths != null ? `${plan.frequencyMonths} d` : "—";
  if (tt === "WEEK") return plan.frequencyMonths != null ? `${plan.frequencyMonths} sem` : "—";
  return "—";
}

function normalizeOptionalText(value: string): string | null {
  const t = value.trim();
  return t || null;
}

const TRIGGER_TYPES = ["MONTHS", "HOURS", "CALENDAR", "RUNNING_HOURS", "CONDITION", "EVENT", "DAY", "WEEK"] as const;
type TriggerType = (typeof TRIGGER_TYPES)[number];
const TRIGGER_RESULT_MODES = ["DUE_ONLY", "AUTO_WO", "CHECKLIST"] as const;

function needsHours(tt: string) { return tt === "HOURS" || tt === "RUNNING_HOURS"; }
function needsMonths(tt: string) { return tt === "MONTHS" || tt === "CALENDAR"; }
function needsDays(tt: string) { return tt === "DAY"; }
function needsWeeks(tt: string) { return tt === "WEEK"; }
function needsDateFreq(tt: string) { return needsMonths(tt) || needsDays(tt) || needsWeeks(tt); }

const inputCls = "w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-text-industrial/30 focus:outline-none focus:border-accent/50";
const selectCls = "w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-accent/50";
const labelCls = "block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider";

// ─── ExecutionModal ───────────────────────────────────────────────────────────

interface ExecutionModalProps {
  plan: MaintenancePlan;
  userName: string;
  onClose: () => void;
  onSuccess: () => void;
}

const ExecutionModal: React.FC<ExecutionModalProps> = ({ plan, userName, onClose, onSuccess }) => {
  const navigate = useNavigate();
  const [executedByName, setExecutedByName] = useState(userName);
  const [result, setResult] = useState<"SATISFACTORIO" | "CON_DEFICIENCIAS">("SATISFACTORIO");
  const [notes, setNotes] = useState("");
  const [deficienciesNotes, setDeficienciesNotes] = useState("");
  const [completedAt, setCompletedAt] = useState(new Date().toISOString().slice(0, 10));
  const [runningHours, setRunningHours] = useState("");
  const [docFile, setDocFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [openingDefect, setOpeningDefect] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // AI suggestion — auto-triggered while typing deficiencies
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  // Post-save WO print confirmation screen
  const [showPrintConfirm, setShowPrintConfirm] = useState(false);

  const isHoursBased = needsHours(plan.triggerType);

  // Debounced AI analysis when deficiencies notes changes
  React.useEffect(() => {
    if (result !== "CON_DEFICIENCIAS" || !deficienciesNotes.trim()) {
      setAiSuggestion(null);
      setAiLoading(false);
      return;
    }
    setAiLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await api.post<{ suggestion: string }>("/app/copiloto/analyze-deficiency", {
          planTitle: plan.title,
          vesselCode: plan.vesselCode,
          deficienciesNotes: deficienciesNotes.trim(),
        });
        setAiSuggestion(res.suggestion ?? null);
      } catch {
        setAiSuggestion(null);
      } finally {
        setAiLoading(false);
      }
    }, 1200);
    return () => clearTimeout(timer);
  }, [deficienciesNotes, result, plan.title, plan.vesselCode]);

  const doSave = async (): Promise<boolean> => {
    if (!executedByName.trim()) { setError("El nombre del ejecutor es requerido."); return false; }
    if (result === "CON_DEFICIENCIAS" && !deficienciesNotes.trim()) {
      setError("Debe describir las deficiencias encontradas.");
      return false;
    }
    setSaving(true);
    setError(null);
    try {
      if (docFile) {
        setUploading(true);
        await api.upload(`/app/pms/maintenance-plans/${plan.id}/upload-checklist`, docFile);
        setUploading(false);
      }
      await api.post(`/app/pms/maintenance-plans/${plan.id}/report-execution`, {
        executedByName: executedByName.trim(),
        result,
        notes: normalizeOptionalText(notes),
        deficienciesNotes: result === "CON_DEFICIENCIAS" ? normalizeOptionalText(deficienciesNotes) : null,
        completedAt,
        runningHoursAtExecution: isHoursBased && runningHours ? Number(runningHours) : null,
      });
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error al guardar la ejecución.");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    if (await doSave()) onSuccess();
  };

  const handleOpenDef = async () => {
    if (!await doSave()) return;
    // If there's an active WO, ask about printing first
    if (plan.activeWorkOrderCode) {
      setShowPrintConfirm(true);
    } else {
      await createDefectAndNavigate();
    }
  };

  const createDefectAndNavigate = async () => {
    setOpeningDefect(true);
    try {
      const defect = await api.post<{ id: string; defectCode: string }>("/app/pms/defects", {
        vesselCode: plan.vesselCode,
        assetId: plan.assetId,
        classification: "Deficiencia de Mantenimiento",
        description: deficienciesNotes.trim() || `Deficiencia encontrada durante ejecución de ${plan.taskCode}`,
        severity: "LOW",
        operationalState: "NORMAL",
      });
      onSuccess();
      navigate(`/defects?defectId=${defect.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo crear el defecto.");
      setShowPrintConfirm(false);
    } finally {
      setOpeningDefect(false);
    }
  };

  // Print WO confirmation screen
  if (showPrintConfirm) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
        <div className="w-full max-w-md bg-[#0D1B2A] border border-white/10 rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
            <h2 className="text-base font-bold text-white">Ejecución guardada</h2>
            <button onClick={onClose} className="text-text-industrial/40 hover:text-white transition-colors"><X className="w-5 h-5" /></button>
          </div>
          <div className="p-6 space-y-4">
            <p className="text-sm text-white/80">¿Deseas imprimir la Work Order asociada?</p>
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5 border border-white/10">
              <span className="text-xs text-text-industrial/60 font-mono">OT: {plan.activeWorkOrderCode}</span>
            </div>
            {error && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{error}</p>}
          </div>
          <div className="flex justify-end gap-2 px-6 py-4 border-t border-white/10">
            <button
              onClick={() => void createDefectAndNavigate()}
              disabled={openingDefect}
              className="px-4 py-2 rounded-xl text-xs text-text-industrial/60 hover:text-white transition-colors disabled:opacity-50"
            >
              No, continuar
            </button>
            <button
              onClick={() => {
                window.open(`/work-orders?autoCode=${plan.activeWorkOrderCode}`, "_blank");
                void createDefectAndNavigate();
              }}
              disabled={openingDefect}
              className="px-4 py-2 rounded-xl bg-accent text-primary-bg font-bold text-xs hover:brightness-110 disabled:opacity-50 transition-all flex items-center gap-1.5"
            >
              {openingDefect ? <Loader2 className="w-4 h-4 animate-spin" /> : "Imprimir y continuar"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-xl bg-[#0D1B2A] border border-white/10 rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div>
            <h2 className="text-base font-bold text-white">Reportar Ejecución</h2>
            <p className="text-[11px] text-text-industrial/50 font-mono">{plan.taskCode} · {plan.vesselCode}</p>
          </div>
          <button onClick={onClose} className="text-text-industrial/40 hover:text-white transition-colors"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Result selector */}
          <div className="space-y-1.5">
            <label className={labelCls}>Resultado</label>
            <div className="flex gap-2">
              {(["SATISFACTORIO", "CON_DEFICIENCIAS"] as const).map(r => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setResult(r)}
                  className={`flex-1 py-2.5 rounded-xl border text-xs font-bold transition-all ${
                    result === r
                      ? r === "SATISFACTORIO"
                        ? "bg-emerald-500/15 border-emerald-500/50 text-emerald-400"
                        : "bg-yellow-500/15 border-yellow-500/50 text-yellow-400"
                      : "bg-white/5 border-white/10 text-text-industrial/50 hover:border-white/20 hover:text-white"
                  }`}
                >
                  {r === "SATISFACTORIO" ? "✓ Satisfactorio" : "⚠ Con Deficiencias"}
                </button>
              ))}
            </div>
          </div>

          {/* Executed by */}
          <div className="space-y-1.5">
            <label className={labelCls}>Ejecutado por</label>
            <input
              value={executedByName}
              onChange={e => setExecutedByName(e.target.value)}
              className={inputCls}
              placeholder="Nombre del técnico / inspector"
            />
          </div>

          {/* Date */}
          <div className="space-y-1.5">
            <label className={labelCls}>Fecha de ejecución</label>
            <input
              type="date"
              value={completedAt}
              onChange={e => setCompletedAt(e.target.value)}
              className={inputCls}
            />
          </div>

          {/* Running hours */}
          {isHoursBased && (
            <div className="space-y-1.5">
              <label className={labelCls}>Horas de motor al ejecutar</label>
              <input
                type="number"
                min="0"
                value={runningHours}
                onChange={e => setRunningHours(e.target.value)}
                className={inputCls}
                placeholder="ej. 3500"
              />
            </div>
          )}

          {/* Notes */}
          <div className="space-y-1.5">
            <label className={labelCls}>Observaciones</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              className={inputCls}
              placeholder="Notas generales de la ejecución…"
            />
          </div>

          {/* Deficiencies */}
          {result === "CON_DEFICIENCIAS" && (
            <div className="space-y-1.5">
              <label className={labelCls + " text-yellow-400"}>Deficiencias encontradas *</label>
              <textarea
                value={deficienciesNotes}
                onChange={e => setDeficienciesNotes(e.target.value)}
                rows={4}
                className={`${inputCls} border-yellow-500/30 focus:border-yellow-400/50`}
                placeholder="Describí en detalle las deficiencias encontradas…"
              />
            </div>
          )}

          {/* Document upload */}
          <div className="space-y-1.5">
            <label className={labelCls}>Documento / Lista de chequeo</label>
            {docFile ? (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-accent/10 border border-accent/20">
                <span className="text-xs text-accent flex-1 truncate">{docFile.name}</span>
                <button type="button" onClick={() => setDocFile(null)} className="text-text-industrial/40 hover:text-white transition-colors"><X className="w-3.5 h-3.5" /></button>
              </div>
            ) : (
              <label className="flex items-center gap-2 px-3 py-2 rounded-xl border border-dashed border-white/20 cursor-pointer hover:border-accent/40 transition-colors">
                <span className="text-xs text-text-industrial/50">Seleccionar archivo (PDF, DOC, XLS, imagen…)</span>
                <input type="file" className="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.txt"
                  onChange={e => setDocFile(e.target.files?.[0] ?? null)} />
              </label>
            )}
          </div>

          {/* ── DEF question — último campo ───────────────────────────────── */}
          {result === "CON_DEFICIENCIAS" && (
            <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-4 space-y-3">
              <p className="text-xs font-semibold text-yellow-300 uppercase tracking-wider">¿Deseas abrir un registro en el log de defectos?</p>

              {/* AI analysis */}
              {aiLoading && (
                <div className="flex items-center gap-2 text-xs text-text-industrial/50">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
                  El copiloto está analizando las deficiencias…
                </div>
              )}
              {aiSuggestion && !aiLoading && (
                <div className="rounded-lg border border-accent/20 bg-accent/5 p-3">
                  <p className="text-[10px] font-bold text-accent uppercase tracking-wider mb-1.5">Sugerencia del Copiloto</p>
                  <p className="text-xs text-white/80 whitespace-pre-wrap">{aiSuggestion}</p>
                </div>
              )}

              <button
                type="button"
                onClick={() => void handleOpenDef()}
                disabled={saving || openingDefect || uploading}
                className="w-full py-2.5 rounded-xl bg-red-500/15 border border-red-500/30 text-red-400 font-bold text-xs hover:bg-red-500/25 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
              >
                {(saving || openingDefect) ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Abrir registro DEF
              </button>
            </div>
          )}

          {error && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-white/10">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-white transition-colors">Cancelar</button>
          <button
            onClick={() => { void handleSave(); }}
            disabled={saving || uploading}
            className="px-4 py-2 rounded-xl bg-accent text-primary-bg font-bold text-xs hover:brightness-110 disabled:opacity-50 transition-all"
          >
            {uploading ? <span className="flex items-center gap-1.5"><Loader2 className="w-4 h-4 animate-spin" /> Subiendo…</span>
              : saving ? <Loader2 className="w-4 h-4 animate-spin" />
              : "Guardar ejecución"}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── PostponeModal ────────────────────────────────────────────────────────────

interface PostponeModalProps {
  plan: MaintenancePlan;
  onClose: () => void;
  onSuccess: () => void;
}

const PostponeModal: React.FC<PostponeModalProps> = ({ plan, onClose, onSuccess }) => {
  const t = useT();
  const [newDueDate, setNewDueDate] = useState("");
  const [newDueHours, setNewDueHours] = useState("");
  const [justification, setJustification] = useState("");
  const [compensatoryMeasures, setCompensatoryMeasures] = useState("");
  const [authorizedBy, setAuthorizedBy] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);

  const isHoursBased = needsHours(plan.triggerType);

  const emitContext = useCopilotEmitter({
    module: "MAINTENANCE_PLANS",
    screen: "MP_POSTPONE",
    entityId: plan.id,
    entityCode: plan.taskCode,
    vesselCode: plan.vesselCode,
    workflowStage: "POSTPONEMENT",
    canEdit: true,
    fieldValues: {
      justification: justification || null,
      compensatoryMeasures: compensatoryMeasures || null,
      authorizedBy: authorizedBy || null,
    },
  });
  void emitContext;

  const fetchAiSuggestion = async () => {
    if (!justification.trim()) return;
    setAiLoading(true);
    setAiSuggestion(null);
    try {
      const res = await api.post<{ suggestion: string }>("/app/copiloto/analyze-postponement", {
        planTitle: plan.title,
        vesselCode: plan.vesselCode,
        triggerType: plan.triggerType,
        justification: justification.trim(),
        newDueDate: newDueDate || null,
        newDueHours: newDueHours || null,
      });
      setAiSuggestion(res.suggestion ?? null);
    } catch {
      setAiSuggestion("No se pudo obtener sugerencia del copiloto.");
    } finally {
      setAiLoading(false);
    }
  };

  const save = async (waitAuthorization: boolean) => {
    if (!justification.trim()) { setError("La justificación es requerida."); return; }
    if (!waitAuthorization && !authorizedBy.trim()) {
      setError("Para guardar como aprobado, ingresá el nombre del autorizante.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.post(`/app/pms/maintenance-plans/${plan.id}/postpone`, {
        newDueDate: newDueDate || null,
        newDueHours: isHoursBased && newDueHours ? Number(newDueHours) : null,
        justification: justification.trim(),
        compensatoryMeasures: normalizeOptionalText(compensatoryMeasures),
        authorizedBy: waitAuthorization ? null : authorizedBy.trim() || null,
      });
      onSuccess();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.saveError"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-xl bg-[#0D1B2A] border border-white/10 rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div>
            <h2 className="text-base font-bold text-white">Postergar Plan</h2>
            <p className="text-[11px] text-text-industrial/50 font-mono">{plan.taskCode} · {plan.vesselCode}</p>
          </div>
          <button onClick={onClose} className="text-text-industrial/40 hover:text-white transition-colors"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Inherited plan context */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white/5 border border-white/10 rounded-xl p-3">
              <p className="text-[10px] uppercase text-text-industrial/40 tracking-wider">Tarea</p>
              <p className="text-sm font-medium text-white line-clamp-2">{plan.title}</p>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-xl p-3">
              <p className="text-[10px] uppercase text-text-industrial/40 tracking-wider">Vencimiento actual</p>
              <p className="text-sm font-mono text-accent">
                {isHoursBased
                  ? (plan.nextDueHours != null ? `${plan.nextDueHours.toLocaleString()}h` : "—")
                  : (fmtDate(plan.nextDueDate) ?? "—")}
              </p>
            </div>
          </div>

          {/* New due */}
          {isHoursBased ? (
            <div className="space-y-1.5">
              <label className={labelCls}>Nuevas horas de vencimiento</label>
              <input
                type="number"
                min="0"
                value={newDueHours}
                onChange={e => setNewDueHours(e.target.value)}
                className={inputCls}
                placeholder="ej. 4000"
              />
            </div>
          ) : (
            <div className="space-y-1.5">
              <label className={labelCls}>Nueva fecha de vencimiento</label>
              <input
                type="date"
                value={newDueDate}
                onChange={e => setNewDueDate(e.target.value)}
                className={inputCls}
              />
            </div>
          )}

          {/* Justification */}
          <div className="space-y-1.5">
            <label className={labelCls}>Justificación *</label>
            <textarea
              value={justification}
              onChange={e => setJustification(e.target.value)}
              rows={3}
              className={inputCls}
              placeholder="Motivo de la postergación…"
            />
          </div>

          {/* Compensatory measures */}
          <div className="space-y-1.5">
            <label className={labelCls}>Medidas compensatorias</label>
            <textarea
              value={compensatoryMeasures}
              onChange={e => setCompensatoryMeasures(e.target.value)}
              rows={2}
              className={inputCls}
              placeholder="Medidas a tomar mientras el plan está postergado…"
            />
          </div>

          {/* AI Suggestion button */}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => { void fetchAiSuggestion(); }}
              disabled={aiLoading || !justification.trim()}
              className="px-3 py-1.5 rounded-lg bg-accent/10 border border-accent/20 text-accent text-xs font-semibold disabled:opacity-40 hover:bg-accent/15 transition-all"
            >
              {aiLoading ? <><Loader2 className="w-3 h-3 animate-spin inline mr-1" />Analizando…</> : "Copiloto: sugerir mejoras"}
            </button>
          </div>

          {aiSuggestion && (
            <div className="rounded-xl border border-accent/20 bg-accent/5 p-4">
              <p className="text-[10px] font-bold text-accent uppercase tracking-wider mb-2">Sugerencia del Copiloto</p>
              <p className="text-sm text-white/80 whitespace-pre-wrap">{aiSuggestion}</p>
            </div>
          )}

          {/* Authorized by */}
          <div className="space-y-1.5">
            <label className={labelCls}>Autorizado por <span className="text-text-industrial/30">(opcional — si no, queda esperando autorización)</span></label>
            <input
              value={authorizedBy}
              onChange={e => setAuthorizedBy(e.target.value)}
              className={inputCls}
              placeholder="Nombre del autorizante"
            />
          </div>

          {error && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{error}</p>}
        </div>

        <div className="flex justify-between gap-2 px-6 py-4 border-t border-white/10">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-white transition-colors">Cancelar</button>
          <div className="flex gap-2">
            <button
              onClick={() => { void save(true); }}
              disabled={saving}
              className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-xs text-text-industrial/70 hover:text-white disabled:opacity-50 transition-all"
            >
              Esperar Autorización
            </button>
            <button
              onClick={() => { void save(false); }}
              disabled={saving}
              className="px-4 py-2 rounded-xl bg-accent text-primary-bg font-bold text-xs hover:brightness-110 disabled:opacity-50 transition-all"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Guardar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Plan detail modal ────────────────────────────────────────────────────────

interface MaintenancePlanModalProps {
  plan: MaintenancePlan | null;
  userId: string | null;
  userName: string;
  isAdmin: boolean;
  onClose: () => void;
  onSaved: () => void;
}

const MaintenancePlanModal: React.FC<MaintenancePlanModalProps> = ({ plan, userId, userName, isAdmin, onClose, onSaved }) => {
  const t = useT();
  const navigate = useNavigate();
  const isNew = plan === null;
  const readOnly = !isNew && !isAdmin;

  const [vesselCode, setVesselCode] = useState("");
  const [taskCode, setTaskCode] = useState("");
  const [taskCodeAuto, setTaskCodeAuto] = useState(true);
  const [loadingCode, setLoadingCode] = useState(false);
  const [assetId, setAssetId] = useState("");
  const [assets, setAssets] = useState<{ id: string; assetCode: string; name: string | null }[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [vessels, setVessels] = useState<{ code: string; name: string }[]>([]);
  const [loadingVessels, setLoadingVessels] = useState(false);
  const vesselDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [taskType, setTaskType] = useState<"MAINTENANCE" | "INSPECTION">(plan?.taskType ?? "MAINTENANCE");
  const [title, setTitle] = useState(plan?.title ?? "");
  const [description, setDescription] = useState(plan?.description ?? "");
  const [responsible, setResponsible] = useState(plan?.responsible ?? "");
  const [acceptanceCriteria, setAcceptanceCriteria] = useState(plan?.acceptanceCriteria ?? "");
  const [loto, setLoto] = useState(plan?.evidenceRequired ?? "");
  const [sfiGroupNumber, setSfiGroupNumber] = useState<number | null>(plan?.sfiGroupNumber ?? null);
  const [sfiSubgroupCode, setSfiSubgroupCode] = useState(plan?.sfiSubgroupCode ?? "");
  const [riskLevel, setRiskLevel] = useState<RiskLevel>(toUiRiskLevel(plan?.riskLevel));
  const [riskAnalysisResult, setRiskAnalysisResult] = useState(plan?.riskAnalysisResult ?? "");
  const [status, setStatus] = useState(plan?.status ?? "ACTIVE");
  const [triggerType, setTriggerType] = useState<TriggerType>((plan?.triggerType as TriggerType) ?? "MONTHS");
  const [frequencyMonths, setFrequencyMonths] = useState(String(plan?.frequencyMonths ?? ""));
  const [frequencyHours, setFrequencyHours] = useState(String(plan?.frequencyHours ?? ""));
  const [triggerResultMode, setTriggerResultMode] = useState(plan?.triggerResultMode ?? "DUE_ONLY");
  const [checklistTemplate, setChecklistTemplate] = useState(plan?.checklistTemplate ?? "");
  const [checklistUploading, setChecklistUploading] = useState(false);
  const [checklistUploadError, setChecklistUploadError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showExecution, setShowExecution] = useState(false);
  const [showPostpone, setShowPostpone] = useState(false);
  const [sfiNodes, setSfiNodes] = useState<SfiNode[]>([]);
  const [loadingSfiNodes, setLoadingSfiNodes] = useState(false);

  useEffect(() => {
    if (!isNew) return;
    setLoadingVessels(true);
    api.get<{ items: { code: string; name: string }[] }>("/app/vessels")
      .then(res => setVessels(res.items ?? []))
      .catch(() => setVessels([]))
      .finally(() => setLoadingVessels(false));
  }, [isNew]);

  const fetchSuggestedCode = useRef(async (vc: string, sfi: number | null) => {
    if (!vc) { setTaskCode(""); return; }
    setLoadingCode(true);
    try {
      const params = new URLSearchParams({ vesselCode: vc });
      if (sfi !== null) params.set("sfiGroupNumber", String(sfi));
      const res = await api.get<{ code: string }>(`/app/pms/maintenance-plans/suggest-code?${params}`);
      setTaskCode(res.code);
    } catch { /* silent */ }
    finally { setLoadingCode(false); }
  });

  useEffect(() => {
    if (!isNew || !taskCodeAuto) return;
    void fetchSuggestedCode.current(vesselCode, sfiGroupNumber);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew, vesselCode, sfiGroupNumber, taskCodeAuto]);

  useEffect(() => {
    const vc = isNew ? vesselCode : plan?.vesselCode;
    if (!vc) return;
    if (isNew) { setAssetId(""); setAssets([]); }
    if (vesselDebounce.current) clearTimeout(vesselDebounce.current);
    vesselDebounce.current = setTimeout(async () => {
      setLoadingAssets(true);
      try {
        const res = await api.get<{ items: { id: string; assetCode: string; name: string | null }[] }>(
          `/app/pms/assets?vesselCode=${encodeURIComponent(vc)}&limit=200`
        );
        setAssets(res.items ?? []);
      } catch { setAssets([]); }
      finally { setLoadingAssets(false); }
    }, 400);
  }, [vesselCode, isNew, plan?.vesselCode]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoadingSfiNodes(true);
      try {
        const r = await api.get<{ items: SfiNode[] }>("/app/pms/sfi");
        if (!cancelled) setSfiNodes(r.items ?? []);
      } catch { if (!cancelled) setSfiNodes([]); }
      finally { if (!cancelled) setLoadingSfiNodes(false); }
    };
    void load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!plan) return;
    setAssetId(plan.assetId ?? "");
    setTaskType(plan.taskType ?? "MAINTENANCE");
    setTitle(plan.title);
    setDescription(plan.description ?? "");
    setResponsible(plan.responsible ?? "");
    setAcceptanceCriteria(plan.acceptanceCriteria ?? "");
    setLoto(plan.evidenceRequired ?? "");
    setSfiGroupNumber(plan.sfiGroupNumber ?? null);
    setSfiSubgroupCode(plan.sfiSubgroupCode ?? "");
    setRiskLevel(toUiRiskLevel(plan.riskLevel));
    setRiskAnalysisResult(plan.riskAnalysisResult ?? "");
    setStatus(plan.status);
    setTriggerType((plan.triggerType as TriggerType) ?? "MONTHS");
    setFrequencyMonths(String(plan.frequencyMonths ?? ""));
    setFrequencyHours(String(plan.frequencyHours ?? ""));
    setTriggerResultMode(plan.triggerResultMode ?? "DUE_ONLY");
    setChecklistTemplate(plan.checklistTemplate ?? "");
    setChecklistUploading(false);
    setChecklistUploadError(null);
    setActionError(null);
    setShowExecution(false);
    setShowPostpone(false);
  }, [plan]);

  useCopilotEmitter(plan ? {
    module: "MAINTENANCE_PLANS",
    screen: "MP_EDIT",
    entityId: plan.id,
    entityCode: plan.taskCode,
    vesselCode: plan.vesselCode,
    workflowStage: plan.executionStatus,
    canEdit: true,
    fieldValues: {
      title:              title              || null,
      description:        description        || null,
      responsible:        responsible        || null,
      acceptanceCriteria: acceptanceCriteria || null,
      evidenceRequired:   loto               || null,
      riskLevel:          riskLevel          || null,
      riskAnalysisResult: riskAnalysisResult || null,
      triggerType:        triggerType        || null,
      frequencyMonths:    frequencyMonths    || null,
      frequencyHours:     frequencyHours     || null,
    },
  } : null);

  useCopilotApplyFields(plan ? (fields) => {
    if (fields.title              !== undefined) setTitle(fields.title);
    if (fields.description        !== undefined) setDescription(fields.description);
    if (fields.responsible        !== undefined) setResponsible(fields.responsible);
    if (fields.acceptanceCriteria !== undefined) setAcceptanceCriteria(fields.acceptanceCriteria);
    if (fields.evidenceRequired   !== undefined) setLoto(fields.evidenceRequired);
    if (fields.riskAnalysisResult !== undefined) setRiskAnalysisResult(fields.riskAnalysisResult);
    if (fields.riskLevel          !== undefined) setRiskLevel(toUiRiskLevel(fields.riskLevel));
    if (fields.triggerType        !== undefined && TRIGGER_TYPES.includes(fields.triggerType as TriggerType))
      setTriggerType(fields.triggerType as TriggerType);
    if (fields.frequencyMonths    !== undefined) setFrequencyMonths(fields.frequencyMonths);
    if (fields.frequencyHours     !== undefined) setFrequencyHours(fields.frequencyHours);
  } : null);

  const sfiGroups = useMemo(() => {
    const map = new Map<number, string>();
    for (const node of sfiNodes) {
      if (!map.has(node.groupNumber)) map.set(node.groupNumber, node.groupName);
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([groupNumber, groupName]) => ({ groupNumber, groupName }));
  }, [sfiNodes]);

  const sfiSubgroups = useMemo(() => {
    if (sfiGroupNumber === null) return [];
    return sfiNodes.filter(n => n.groupNumber === sfiGroupNumber).sort((a, b) => a.code.localeCompare(b.code));
  }, [sfiGroupNumber, sfiNodes]);

  const onSave = async () => {
    setSaving(true);
    setActionError(null);
    try {
      const freqMonths = needsDateFreq(triggerType) && frequencyMonths ? Number(frequencyMonths) : null;
      const freqHours  = needsHours(triggerType)   && frequencyHours  ? Number(frequencyHours)  : null;

      if (isNew) {
        await api.post("/app/pms/maintenance-plans", {
          vesselCode: vesselCode.trim().toUpperCase(),
          assetId,
          taskCode: taskCode.trim() || undefined,
          taskType,
          title: title.trim(),
          description: normalizeOptionalText(description),
          responsible: normalizeOptionalText(responsible),
          acceptanceCriteria: normalizeOptionalText(acceptanceCriteria),
          evidenceRequired: normalizeOptionalText(loto),
          sfiGroupNumber,
          sfiSubgroupCode: normalizeOptionalText(sfiSubgroupCode),
          riskLevel: toUiRiskLevel(riskLevel),
          riskAnalysisResult: normalizeOptionalText(riskAnalysisResult),
          status,
          triggerType,
          frequencyMonths: freqMonths,
          frequencyHours: freqHours,
          triggerResultMode,
          checklistTemplate: normalizeOptionalText(checklistTemplate),
        });
      } else {
        await api.patch(`/app/pms/maintenance-plans/${plan.id}`, {
          ...(assetId ? { assetId } : {}),
          taskType,
          title: title.trim(),
          description: normalizeOptionalText(description),
          responsible: normalizeOptionalText(responsible),
          acceptanceCriteria: normalizeOptionalText(acceptanceCriteria),
          evidenceRequired: normalizeOptionalText(loto),
          sfiGroupNumber,
          sfiSubgroupCode: normalizeOptionalText(sfiSubgroupCode),
          riskLevel: toUiRiskLevel(riskLevel),
          riskAnalysisResult: normalizeOptionalText(riskAnalysisResult),
          status,
          triggerType,
          frequencyMonths: freqMonths,
          frequencyHours: freqHours,
          triggerResultMode,
          checklistTemplate: normalizeOptionalText(checklistTemplate),
        });
      }
      onSaved();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t("common.saveError"));
    } finally {
      setSaving(false);
    }
  };

  const canExecute = !isNew && plan.status !== "INACTIVE" && plan.status !== "DRAFT";
  const canPostpone = !isNew && plan.status !== "INACTIVE" && plan.status !== "DRAFT";
  const needsWO = !isNew && (plan.triggerResultMode === "AUTO_WO" || plan.triggerResultMode === "APPROVAL_WO");

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
        <div className="w-full max-w-2xl bg-[#0D1B2A] border border-white/10 rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
            <div>
              <h2 className="text-base font-bold text-white">
                {isNew ? t("mp.newPlan") : t("page.maintenancePlans")}
              </h2>
              {!isNew && <StatusBadgeInline plan={plan} onClickWo={plan.activeWorkOrderCode ? () => { onClose(); navigate(`/work-orders?autoCode=${plan.activeWorkOrderCode}`); } : undefined} />}
            </div>
            <button onClick={onClose} className="text-text-industrial/40 hover:text-white transition-colors"><X className="w-5 h-5" /></button>
          </div>

          {readOnly && (
            <div className="mx-6 mt-3 px-3 py-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-xs text-yellow-400">
              Solo lectura — la edición de planes está restringida al administrador.
            </div>
          )}
          <fieldset disabled={readOnly} className="p-6 space-y-4 max-h-[75vh] overflow-y-auto disabled:opacity-70">

            {/* Read-only identifiers (edit mode) */}
            {!isNew && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                    <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t("mp.taskCode")}</p>
                    <p className="text-sm font-mono font-bold text-white">{plan.taskCode}</p>
                  </div>
                  <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                    <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t("col.vessel")}</p>
                    <p className="text-sm font-mono text-accent">{plan.vesselCode}</p>
                  </div>
                </div>
                {/* Last / Next execution info */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                    <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">Última ejecución</p>
                    <p className="text-sm text-white font-mono">
                      {needsHours(plan.triggerType)
                        ? (plan.lastExecutionHours != null ? `${plan.lastExecutionHours.toLocaleString()}h` : "—")
                        : (fmtDate(plan.lastExecutionDate) ?? "—")}
                    </p>
                  </div>
                  <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                    <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">Próximo vencimiento</p>
                    <p className="text-sm font-mono text-accent">
                      {needsHours(plan.triggerType)
                        ? (plan.nextDueHours != null ? `${plan.nextDueHours.toLocaleString()}h` : "—")
                        : (fmtDate(plan.nextDueDate) ?? "—")}
                    </p>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className={labelCls}>{t("mp.asset")}</label>
                  {loadingAssets
                    ? <div className="flex items-center gap-2 text-xs text-text-industrial/40 py-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Cargando activos…</div>
                    : <select value={assetId} onChange={e => setAssetId(e.target.value)} className={selectCls}>
                        <option value="">— Seleccioná un activo —</option>
                        {assets.map(a => <option key={a.id} value={a.id}>{a.assetCode}{a.name ? ` — ${a.name}` : ""}</option>)}
                      </select>
                  }
                </div>
              </>
            )}

            {/* Create-only identifiers */}
            {isNew && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className={labelCls}>{t("mp.vesselCode")}</label>
                    {loadingVessels
                      ? <div className="flex items-center gap-2 text-xs text-text-industrial/40 py-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Cargando…</div>
                      : <select value={vesselCode} onChange={e => setVesselCode(e.target.value)} className={selectCls}>
                          <option value="">— Seleccioná un buque —</option>
                          {vessels.map(v => <option key={v.code} value={v.code}>{v.code}{v.name ? ` — ${v.name}` : ""}</option>)}
                        </select>
                    }
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className={labelCls}>{t("mp.taskCode")}</label>
                      {taskCodeAuto && taskCode && <span className="text-[9px] text-accent/60 font-mono uppercase tracking-wider">Auto</span>}
                    </div>
                    <div className="relative">
                      <input
                        value={loadingCode ? "" : taskCode}
                        onChange={e => { setTaskCode(e.target.value.toUpperCase()); setTaskCodeAuto(false); }}
                        placeholder={loadingCode ? "Generando…" : "o dejá vacío para auto-generar"}
                        className={`${inputCls} pr-8 ${taskCodeAuto && taskCode ? "text-accent/80 font-mono" : ""}`}
                      />
                      {loadingCode && <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-accent/50 animate-spin" />}
                      {!loadingCode && !taskCodeAuto && vesselCode && (
                        <button type="button" onClick={() => setTaskCodeAuto(true)} title="Regenerar código"
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-industrial/30 hover:text-accent transition-colors">↺</button>
                      )}
                    </div>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className={labelCls}>{t("mp.asset")}</label>
                  {loadingAssets
                    ? <div className="flex items-center gap-2 text-xs text-text-industrial/40 py-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Cargando activos…</div>
                    : <select value={assetId} onChange={e => setAssetId(e.target.value)} className={selectCls} disabled={assets.length === 0}>
                        <option value="">{!vesselCode ? "Seleccioná un buque primero" : assets.length === 0 ? "Sin activos para este buque" : "Seleccioná un activo…"}</option>
                        {assets.map(a => <option key={a.id} value={a.id}>{a.assetCode}{a.name ? ` — ${a.name}` : ""}</option>)}
                      </select>
                  }
                </div>
              </>
            )}

            {/* Task type */}
            <div className="space-y-1.5">
              <label className={labelCls}>{t("mp.taskType")}</label>
              <div className="flex gap-2">
                {(["MAINTENANCE", "INSPECTION"] as const).map(tt => (
                  <button key={tt} type="button" onClick={() => setTaskType(tt)}
                    className={`flex-1 py-2 rounded-xl border text-xs font-bold transition-all ${
                      taskType === tt
                        ? "bg-accent/15 border-accent/50 text-accent"
                        : "bg-white/5 border-white/10 text-text-industrial/50 hover:border-white/20 hover:text-white"
                    }`}>
                    {t(`mp.taskType.${tt}` as any)}
                  </button>
                ))}
              </div>
            </div>

            {/* SFI */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className={labelCls}>{t("mp.sfiGroup")}</label>
                <select value={sfiGroupNumber === null ? "" : String(sfiGroupNumber)}
                  onChange={e => { setSfiGroupNumber(e.target.value ? Number(e.target.value) : null); setSfiSubgroupCode(""); }}
                  className={selectCls} disabled={loadingSfiNodes}>
                  <option value="">{loadingSfiNodes ? t("common.loading") : t("mp.selectSfiGroup")}</option>
                  {sfiGroups.map(g => <option key={g.groupNumber} value={g.groupNumber}>{g.groupNumber} - {t(`sfi.g.${g.groupNumber}` as Parameters<typeof t>[0]) || g.groupName}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className={labelCls}>{t("mp.sfiSubgroup")}</label>
                <select value={sfiSubgroupCode} onChange={e => setSfiSubgroupCode(e.target.value)}
                  className={selectCls} disabled={loadingSfiNodes || sfiGroupNumber === null}>
                  <option value="">{sfiGroupNumber === null ? t("mp.selectSfiGroupFirst") : t("mp.selectSfiSubgroup")}</option>
                  {sfiSubgroups.map(n => <option key={n.id} value={n.code}>{n.code} - {t(`sfi.c.${n.code}` as Parameters<typeof t>[0]) || n.description}</option>)}
                </select>
              </div>
            </div>

            {/* Title */}
            <div className="space-y-1.5">
              <label className={labelCls}>{t("col.title")}</label>
              <input value={title} onChange={e => setTitle(e.target.value)} className={inputCls} />
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <label className={labelCls}>{t("col.description")}</label>
              <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} className={inputCls} />
            </div>

            {/* Trigger + Frequency + Mode */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <label className={labelCls}>{t("mp.triggerType")}</label>
                <select value={triggerType} onChange={e => setTriggerType(e.target.value as TriggerType)} className={selectCls}>
                  {TRIGGER_TYPES.map(tt => <option key={tt} value={tt}>{t(`mp.tt.${tt}` as any)}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className={labelCls}>
                  {needsHours(triggerType) ? t("mp.frequencyHours") : needsDays(triggerType) ? t("mp.frequencyDays") : needsWeeks(triggerType) ? t("mp.frequencyWeeks") : t("mp.frequencyMonths")}
                </label>
                {needsHours(triggerType)
                  ? <input type="number" min="1" value={frequencyHours} onChange={e => setFrequencyHours(e.target.value)} className={inputCls} disabled={triggerType === "CONDITION" || triggerType === "EVENT"} />
                  : <input type="number" min="1" value={frequencyMonths} onChange={e => setFrequencyMonths(e.target.value)} className={inputCls} disabled={triggerType === "CONDITION" || triggerType === "EVENT"} />
                }
              </div>
              <div className="space-y-1.5">
                <label className={labelCls}>{t("mp.triggerResultMode")}</label>
                <select value={triggerResultMode} onChange={e => setTriggerResultMode(e.target.value)} className={selectCls}>
                  {TRIGGER_RESULT_MODES.map(m => <option key={m} value={m}>{t(`mp.trm.${m}` as any)}</option>)}
                </select>
              </div>
            </div>

            {/* Responsible + Status */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className={labelCls}>{t("mp.responsible")}</label>
                <input value={responsible} onChange={e => setResponsible(e.target.value)} className={inputCls} />
              </div>
              <div className="space-y-1.5">
                <label className={labelCls}>{t("col.status")}</label>
                <select value={status} onChange={e => setStatus(e.target.value)} className={selectCls}>
                  {EDITABLE_STATUSES.map(item => <option key={item} value={item}>{t(`mp.status.${item}` as any)}</option>)}
                </select>
              </div>
            </div>

            {/* Acceptance criteria */}
            <div className="space-y-1.5">
              <label className={labelCls}>{t("mp.acceptanceCriteria")}</label>
              <textarea value={acceptanceCriteria} onChange={e => setAcceptanceCriteria(e.target.value)} rows={2} className={inputCls} />
            </div>

            {/* LOTO */}
            <div className="space-y-1.5">
              <label className={labelCls}>{t("mp.loto")}</label>
              <textarea value={loto} onChange={e => setLoto(e.target.value)} rows={2} className={inputCls} />
            </div>

            {/* Risk level */}
            <div className="space-y-1.5">
              <label className={labelCls}>{t("mp.riskLevel")}</label>
              <div className="flex items-center gap-1.5">
                {RISK_LEVEL_OPTS.map(([val, label, activeCls, inactiveLabelCls]) => (
                  <button key={val} type="button" disabled={readOnly}
                    onClick={() => setRiskLevel(riskLevel === val ? "" : val as RiskLevel)}
                    aria-pressed={riskLevel === val}
                    className={`w-9 h-9 rounded-lg border font-bold text-sm transition-all disabled:opacity-50 ${riskLevel === val ? activeCls : `bg-white/5 ${inactiveLabelCls} hover:bg-white/10`}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Risk analysis */}
            <div className="space-y-1.5">
              <label className={labelCls}>{t("mp.riskAnalysisResult")}</label>
              <textarea value={riskAnalysisResult} onChange={e => setRiskAnalysisResult(e.target.value)} rows={2} className={inputCls} />
            </div>

            {/* Checklist upload — CHECKLIST mode only */}
            {triggerResultMode === "CHECKLIST" && (
              <div className="space-y-1.5">
                <label className={labelCls}>{t("mp.checklistTemplate")}</label>
                <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
                  {checklistTemplate && checklistTemplate.startsWith("/uploads/") ? (
                    <div className="flex items-center justify-between gap-3">
                      <a href={checklistTemplate} target="_blank" rel="noreferrer"
                        className="flex items-center gap-2 text-sm text-green-400 hover:text-green-300 truncate">
                        <ClipboardList className="w-4 h-4 shrink-0" />
                        <span className="truncate">{checklistTemplate.split("/").pop()}</span>
                      </a>
                      <button type="button" onClick={() => setChecklistTemplate("")} className="text-text-industrial/40 hover:text-red-400 transition-colors shrink-0"><X className="w-4 h-4" /></button>
                    </div>
                  ) : (
                    <p className="text-xs text-text-industrial/40">{t("mp.checklistNoFile")}</p>
                  )}
                  {isNew ? (
                    <p className="text-[10px] text-yellow-400/70">Guardá el plan primero para poder subir el documento.</p>
                  ) : (
                    <label className={`flex items-center gap-2 cursor-pointer w-fit px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                      checklistUploading ? "border-white/10 text-text-industrial/40 cursor-not-allowed" : "border-green-500/30 text-green-400 hover:bg-green-500/10"
                    }`}>
                      {checklistUploading ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {t("mp.checklistUploading")}</> : <><FileSpreadsheet className="w-3.5 h-3.5" /> {t("mp.checklistUpload")}</>}
                      <input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.txt" className="sr-only"
                        disabled={checklistUploading || isNew}
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file || !plan) return;
                          e.target.value = "";
                          setChecklistUploading(true);
                          setChecklistUploadError(null);
                          try {
                            const res = await api.upload(`/app/pms/maintenance-plans/${plan.id}/upload-checklist`, file);
                            setChecklistTemplate((res as { url: string }).url);
                          } catch (err) {
                            setChecklistUploadError(err instanceof ApiError ? err.message : t("common.saveError"));
                          } finally {
                            setChecklistUploading(false);
                          }
                        }}
                      />
                    </label>
                  )}
                  {checklistUploadError && <p className="text-xs text-red-400">{checklistUploadError}</p>}
                </div>
              </div>
            )}

            {actionError && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{actionError}</p>}
          </fieldset>

          {/* Footer — always shows Reportar Ejecución + Postergar for active plans */}
          <div className="flex justify-between gap-2 px-6 py-4 border-t border-white/10">
            <div className="flex gap-2">
              {canExecute && needsWO && !(plan.activeWorkOrderCode && plan.executionStatus === "IN_WINDOW") && (
                <button
                  onClick={() => setShowExecution(true)}
                  className="px-4 py-2 rounded-xl bg-accent/10 border border-accent/20 text-accent font-bold text-xs hover:bg-accent/15 transition-all"
                >
                  <span className="flex items-center gap-1.5"><Zap className="w-3.5 h-3.5" /> Abrir OT</span>
                </button>
              )}
              {canExecute && !needsWO && (
                <button
                  onClick={() => setShowExecution(true)}
                  className="px-4 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-bold text-xs hover:bg-emerald-500/15 transition-all"
                >
                  Reportar Resultado
                </button>
              )}
              {canPostpone && (
                <button
                  onClick={() => setShowPostpone(true)}
                  className="px-4 py-2 rounded-xl bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 font-bold text-xs hover:bg-yellow-500/15 transition-all"
                >
                  Postergar
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-white transition-colors">
                {readOnly ? "Cerrar" : t("common.cancel")}
              </button>
              {!readOnly && (
                <button onClick={() => { void onSave(); }} disabled={saving}
                  className="px-4 py-2 rounded-xl bg-accent text-primary-bg font-bold text-xs hover:brightness-110 disabled:opacity-50 transition-all">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : t("common.save")}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {!isNew && showExecution && needsWO && (
        <CreateWorkOrderModal
          prefill={{
            source: "plan",
            sourceId: plan.id,
            sourceCode: plan.taskCode,
            sourceLabel: "Plan de Mantenimiento",
            vesselCode: plan.vesselCode,
            assetId: plan.assetId,
            assetName: plan.assetName,
            type: plan.taskType === "INSPECTION" ? "INSPECTION" : "PREVENTIVE",
            title: plan.title,
            description: description || plan.description,
            dueDate: plan.nextDueDate,
            acceptanceCriteria: acceptanceCriteria || plan.acceptanceCriteria,
            responsible: responsible || plan.responsible,
            loto: loto || plan.evidenceRequired,
            riskLevel: riskLevel || plan.riskLevel,
            riskAnalysisResult: riskAnalysisResult || plan.riskAnalysisResult,
            checklistDocUrl: plan.checklistTemplate,
          }}
          onClose={() => setShowExecution(false)}
          onSaved={_woId => { setShowExecution(false); onSaved(); }}
        />
      )}
      {!isNew && showExecution && !needsWO && (
        <ExecutionModal
          plan={plan}
          userName={userName}
          onClose={() => setShowExecution(false)}
          onSuccess={() => { setShowExecution(false); onSaved(); }}
        />
      )}
      {!isNew && showPostpone && (
        <PostponeModal
          plan={plan}
          onClose={() => setShowPostpone(false)}
          onSuccess={() => { setShowPostpone(false); onSaved(); }}
        />
      )}
    </>
  );
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export const MaintenancePlansPage: React.FC = () => {
  const t = useT();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const statusFilter        = (searchParams.get("status")          ?? "").trim();
  const vesselFilter        = (searchParams.get("vesselCode")      ?? "").trim();
  const executionFilter     = (searchParams.get("executionStatus") ?? "").trim();

  const [sfiTab,        setSfiTab]        = useState<SfiTab>("ALL");
  const [overdueOnly,   setOverdueOnly]   = useState(false);
  const [sfiTextFilter, setSfiTextFilter] = useState("");
  const [editing,       setEditing]       = useState<MaintenancePlan | null>(null);
  const [showModal,     setShowModal]     = useState(false);

  useCopilotEmitter(!editing && !showModal ? { module: "MAINTENANCE_PLANS", screen: "MP_LIST" } : null);
  const [showExcel,     setShowExcel]     = useState(false);
  const [executing,     setExecuting]     = useState<MaintenancePlan | null>(null);
  const [reporting,     setReporting]     = useState<MaintenancePlan | null>(null);
  const [loadingDetailId, setLoadingDetailId] = useState<string | null>(null);
  const [pageError,     setPageError]     = useState<string | null>(null);

  const updateFilters = (next: { status?: string; vesselCode?: string; executionStatus?: string }) => {
    const params = new URLSearchParams(searchParams);
    const ns = next.status          !== undefined ? next.status          : statusFilter;
    const nv = next.vesselCode      !== undefined ? next.vesselCode      : vesselFilter;
    const ne = next.executionStatus !== undefined ? next.executionStatus : executionFilter;
    if (ns) params.set("status", ns); else params.delete("status");
    if (nv) params.set("vesselCode", nv); else params.delete("vesselCode");
    if (ne) params.set("executionStatus", ne); else params.delete("executionStatus");
    setSearchParams(params, { replace: true });
  };

  const path = useMemo(() => {
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    if (vesselFilter) params.set("vesselCode", vesselFilter);
    const query = params.toString();
    return `/app/pms/maintenance-plans${query ? `?${query}` : ""}`;
  }, [statusFilter, vesselFilter]);

  const { data: rawData, loading, error, reload } = useFetch<ListResponse>(path, [path]);
  const { data: vesselsData } = useFetch<{ items: { id: string; code: string; name: string }[] }>("/app/vessels", []);
  const vessels = vesselsData?.items ?? [];
  const vesselNameMap = useMemo(() => new Map(vessels.map(v => [v.code, v.name])), [vessels]);

  // ── Client-side filters: SFI tab + overdue toggle + SFI text ──────────────
  const data = useMemo(() => {
    if (!rawData) return null;
    let items = rawData.items;

    if (sfiTab !== "ALL") {
      items = items.filter(p => sfiTabOf(p.sfiGroupNumber) === sfiTab);
    }
    if (executionFilter) {
      items = items.filter(p => computeStatus(p) === executionFilter);
    } else if (overdueOnly) {
      items = items.filter(p => { const s = computeStatus(p); return s === "OVERDUE" || s === "DUE" || s === "IN_WINDOW"; });
    }
    if (sfiTextFilter.trim()) {
      const q = sfiTextFilter.trim().toLowerCase();
      items = items.filter(p =>
        String(p.sfiGroupNumber ?? "").includes(q) ||
        (p.sfiSubgroupCode ?? "").toLowerCase().includes(q)
      );
    }
    return { items, total: items.length };
  }, [rawData, sfiTab, overdueOnly, sfiTextFilter]);

  // ── Counts per SFI tab (from raw data, before SFI filter) ─────────────────
  const sfiTabCounts = useMemo(() => {
    if (!rawData) return {} as Record<string, number>;
    const counts: Record<string, number> = { ALL: rawData.items.length };
    for (const p of rawData.items) {
      const k = String(sfiTabOf(p.sfiGroupNumber));
      counts[k] = (counts[k] ?? 0) + 1;
    }
    return counts;
  }, [rawData]);

  // ── Count of overdue/due/in_window for the toggle badge ───────────────────
  const urgentCount = useMemo(() => {
    if (!rawData) return 0;
    return rawData.items.filter(p =>
      p.executionStatus === "OVERDUE" || p.executionStatus === "DUE" || p.executionStatus === "IN_WINDOW"
    ).length;
  }, [rawData]);

  const openEdit = async (row: Pick<MaintenancePlan, "id">) => {
    setLoadingDetailId(row.id);
    setPageError(null);
    try {
      const detail = await api.get<MaintenancePlan>(`/app/pms/maintenance-plans/${row.id}`);
      setEditing(detail);
      setShowModal(true);
    } catch (err) {
      setPageError(err instanceof ApiError ? err.message : "No se pudo cargar el detalle del plan.");
    } finally {
      setLoadingDetailId(null);
    }
  };

  // Auto-open plan when navigating from Bitácora (?openId=entityId)
  useEffect(() => {
    const openId = searchParams.get("openId");
    if (!openId) return;
    const params = new URLSearchParams(searchParams);
    params.delete("openId");
    setSearchParams(params, { replace: true });
    void openEdit({ id: openId });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const userName = user?.name ?? user?.email ?? "";

  const columns: Column<MaintenancePlan>[] = useMemo(() => [
    // ── Col 1: EMBARCACIÓN / TASKID / SFI ──────────────────────────────────
    {
      key: "vesselCode",
      header: "EMBARCACIÓN / TASKID / SFI",
      sortable: false,
      render: row => (
        <div className="flex flex-col gap-0.5 min-w-[130px]">
          <span className="text-[11px] font-bold text-accent leading-tight">{vesselNameMap.get(row.vesselCode) ?? row.vesselCode}</span>
          <span className="text-[11px] font-bold text-white font-mono leading-tight">{row.taskCode}</span>
          {row.sfiGroupNumber != null && (
            <span className="text-[10px] text-text-industrial/50 font-mono leading-tight">
              SFI: {row.sfiSubgroupCode ?? row.sfiGroupNumber}
              {row.riskLevel === "HIGH" || row.riskLevel === "CRITICAL" ? (
                <span className="ml-1 inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-red-500/20 text-red-400 text-[8px] font-bold border border-red-500/30">!</span>
              ) : null}
            </span>
          )}
        </div>
      ),
    },
    // ── Col 2: EQUIPO / TAREA ───────────────────────────────────────────────
    {
      key: "title",
      header: "EQUIPO / TAREA",
      sortable: false,
      className: "w-72",
      render: row => (
        <div className="flex flex-col gap-0.5">
          <span className="text-[12px] font-bold text-white leading-tight line-clamp-1">
            {(row as MaintenancePlan & { assetName?: string | null }).assetName ?? row.assetId}
          </span>
          <span className="text-[11px] text-text-industrial/60 leading-tight line-clamp-2">{row.title}</span>
        </div>
      ),
    },
    // ── Col 3: RESPONSABLE ──────────────────────────────────────────────────
    {
      key: "responsible",
      header: "RESPONSABLE",
      render: row => row.responsible
        ? <span className="text-xs text-text-industrial/80 line-clamp-1">{row.responsible}</span>
        : <span className="text-text-industrial/30 text-xs">—</span>,
    },
    // ── Col 4: FRECUENCIA ───────────────────────────────────────────────────
    {
      key: "frequency",
      header: "FRECUENCIA (HS / MES)",
      sortable: false,
      render: row => (
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-xs text-text-industrial/80 whitespace-nowrap">{formatFrequency(row)}</span>
          {needsHours(row.triggerType) && (
            <span className="font-mono text-[10px] text-text-industrial/45 whitespace-nowrap">
              Acum: {row.assetCurrentHours != null ? `${row.assetCurrentHours.toLocaleString()} hs` : "—"}
            </span>
          )}
        </div>
      ),
    },
    // ── Col 5: ÚLTIMA EJECUCIÓN ─────────────────────────────────────────────
    {
      key: "lastExecutionDate",
      header: "ÚLTIMA EJECUCIÓN",
      render: row => {
        if (needsHours(row.triggerType)) {
          return row.lastExecutionHours != null
            ? <span className="font-mono text-xs text-white whitespace-nowrap">{row.lastExecutionHours.toLocaleString()} hs</span>
            : <span className="text-text-industrial/30 text-xs">0 hs</span>;
        }
        return row.lastExecutionDate
          ? <span className="font-mono text-xs text-white whitespace-nowrap">{fmtDate(row.lastExecutionDate)}</span>
          : <span className="text-text-industrial/30 text-xs">—</span>;
      },
    },
    // ── Col 6: PRÓXIMO VENCIMIENTO ──────────────────────────────────────────
    {
      key: "nextDueDate",
      header: "PRÓXIMO VENCIMIENTO",
      render: row => {
        const isOverdue = row.executionStatus === "OVERDUE";
        if (needsHours(row.triggerType)) {
          return row.nextDueHours != null
            ? <span className={`font-mono text-xs whitespace-nowrap ${isOverdue ? "text-red-400 font-bold" : "text-white"}`}>{row.nextDueHours.toLocaleString()} hs</span>
            : <span className="text-text-industrial/30 text-xs">—</span>;
        }
        return row.nextDueDate
          ? <span className={`font-mono text-xs whitespace-nowrap ${isOverdue ? "text-red-400 font-bold" : "text-white"}`}>{fmtDate(row.nextDueDate)}</span>
          : <span className="text-text-industrial/30 text-xs">—</span>;
      },
    },
    // ── Col 7: STATUS ───────────────────────────────────────────────────────
    {
      key: "situacion",
      header: "STATUS",
      sortable: false,
      render: row => <StatusBadgeInline plan={row} onClickWo={row.activeWorkOrderCode ? () => navigate(`/work-orders?autoCode=${row.activeWorkOrderCode}`) : undefined} />,
    },
    // ── Col 8: ACCIONES ─────────────────────────────────────────────────────
    {
      key: "taskCode" as keyof MaintenancePlan,
      header: "ACCIONES",
      sortable: false,
      render: row => {
        if (row.status === "INACTIVE" || row.status === "DRAFT") return null;
        const needsWO = row.triggerResultMode === "AUTO_WO" || row.triggerResultMode === "APPROVAL_WO";
        const hasActiveWo = !!row.activeWorkOrderCode && row.executionStatus === "IN_WINDOW";
        return needsWO ? (
          !hasActiveWo ? (
          <button
            onClick={e => { e.stopPropagation(); setExecuting(row); }}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-accent/30 bg-accent/10 text-accent text-[11px] font-bold hover:bg-accent/20 hover:border-accent/50 transition-all whitespace-nowrap"
          >
            <Zap className="w-3 h-3" /> EJECUTAR OT
          </button>
          ) : null
        ) : (
          <button
            onClick={e => { e.stopPropagation(); setReporting(row); }}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-[11px] font-bold hover:bg-emerald-500/20 hover:border-emerald-500/50 transition-all whitespace-nowrap"
          >
            <CheckCircle2 className="w-3 h-3" /> REPORTAR
          </button>
        );
      },
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [t, vesselNameMap]);

  return (
    <div className="space-y-4">
      <PageHeader icon={ClipboardList} title={t("page.maintenancePlans")} total={data?.total} onReload={reload}>
        {/* Nueva tarea */}
        <button
          onClick={() => { setEditing(null); setShowModal(true); }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-primary-bg font-bold text-xs hover:brightness-110 transition-all"
        >
          <Plus className="w-3.5 h-3.5" /> NUEVA TAREA
        </button>
        {/* Excel */}
        <button
          onClick={() => setShowExcel(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-text-industrial hover:border-accent/30 transition-all"
        >
          <FileSpreadsheet className="w-3.5 h-3.5 text-accent" /> Excel
        </button>
        {/* Toggle VENCIDOS / PRÓX. */}
        <button
          onClick={() => setOverdueOnly(o => !o)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold transition-all ${
            overdueOnly
              ? "bg-orange-500/20 border-orange-500/40 text-orange-300"
              : "bg-white/5 border-white/10 text-text-industrial/60 hover:border-orange-400/30"
          }`}
        >
          <AlertTriangle className="w-3.5 h-3.5" />
          VENCIDOS / PRÓX. 7 DÍAS
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
            overdueOnly ? "bg-orange-500/30 text-orange-200" : "bg-white/10 text-text-industrial/50"
          }`}>{urgentCount}</span>
        </button>
        {/* Filtrar por SFI */}
        <div className="flex items-center gap-1.5 bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5">
          <Filter className="w-3 h-3 text-text-industrial/40 shrink-0" />
          <input
            value={sfiTextFilter}
            onChange={e => setSfiTextFilter(e.target.value)}
            placeholder="Filtrar por SFI"
            className="w-32 bg-transparent text-xs text-text-industrial placeholder-text-industrial/30 focus:outline-none"
          />
          {sfiTextFilter && (
            <button onClick={() => setSfiTextFilter("")} className="text-text-industrial/40 hover:text-white transition-colors">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        {/* Status filter */}
        <select
          value={toFilterSelectValue(statusFilter)}
          onChange={e => updateFilters({ status: fromFilterSelectValue(e.target.value) })}
          className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-text-industrial focus:outline-none focus:border-accent/50"
        >
          <option value={FILTER_ALL_VALUE}>{t("status.all")}</option>
          <option value="ACTIVE">{t("mp.status.ACTIVE")}</option>
          <option value="INACTIVE">{t("mp.status.INACTIVE")}</option>
          <option value="DRAFT">{t("mp.status.DRAFT")}</option>
        </select>
        {/* Vessel filter */}
        <div className="flex items-center gap-2">
          <select
            value={toFilterSelectValue(vesselFilter)}
            onChange={e => updateFilters({ vesselCode: fromFilterSelectValue(e.target.value) })}
            className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-text-industrial focus:outline-none focus:border-accent/50"
          >
            <option value={FILTER_ALL_VALUE}>Todos los buques</option>
            {vessels.map(v => (
              <option key={v.code} value={v.code}>{v.name}</option>
            ))}
          </select>
          {(statusFilter || vesselFilter || overdueOnly || sfiTextFilter) && (
            <button
              onClick={() => {
                updateFilters({ status: "", vesselCode: "" });
                setOverdueOnly(false);
                setSfiTextFilter("");
                setSfiTab("ALL");
              }}
              className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-text-industrial/80 hover:text-white hover:border-red-400/40 transition-all"
            >
              {t("common.clear")}
            </button>
          )}
        </div>
      </PageHeader>

      {/* ── Tabs SFI ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 flex-wrap">
        {SFI_TABS.map(tab => {
          const count = tab.key === "ALL" ? (rawData?.total ?? 0) : (sfiTabCounts[String(tab.key)] ?? 0);
          const isActive = sfiTab === tab.key;
          return (
            <button
              key={String(tab.key)}
              onClick={() => setSfiTab(tab.key)}
              className={`px-3 py-1 rounded-lg text-[11px] font-bold border transition-all ${
                isActive
                  ? "bg-accent text-primary-bg border-accent"
                  : "bg-white/5 text-text-industrial/60 border-white/10 hover:bg-white/10 hover:text-white"
              }`}
            >
              {tab.label}
              {count > 0 && (
                <span className={`ml-1 text-[10px] ${isActive ? "opacity-70" : "text-text-industrial/40"}`}>
                  ({count})
                </span>
              )}
            </button>
          );
        })}
      </div>

      {pageError && (
        <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{pageError}</p>
      )}
      {loadingDetailId && (
        <div className="flex items-center gap-2 text-xs text-text-industrial/60">
          <Loader2 className="w-4 h-4 animate-spin text-accent" /> Cargando detalle del plan...
        </div>
      )}

      <DataTable
        columns={columns}
        data={data?.items ?? null}
        loading={loading}
        error={error}
        keyFn={row => row.id}
        emptyText={t("empty.maintenancePlans")}
        onRowClick={row => { void openEdit(row); }}
      />

      {showExcel && <ExcelPanel module="maintenance_plans" onClose={() => { setShowExcel(false); void reload(); }} />}

      {executing && (
        <CreateWorkOrderModal
          prefill={{
            source: "plan",
            sourceId: executing.id,
            sourceCode: executing.taskCode,
            sourceLabel: "Plan de Mantenimiento",
            vesselCode: executing.vesselCode,
            assetId: executing.assetId,
            assetName: executing.assetName,
            type: executing.taskType === "INSPECTION" ? "INSPECTION" : "PREVENTIVE",
            title: executing.title,
            description: executing.description,
            dueDate: executing.nextDueDate,
            acceptanceCriteria: executing.acceptanceCriteria,
            responsible: executing.responsible,
            loto: executing.evidenceRequired,
            riskLevel: executing.riskLevel,
            riskAnalysisResult: executing.riskAnalysisResult,
            checklistDocUrl: executing.checklistTemplate,
          }}
          onClose={() => setExecuting(null)}
          onSaved={_woId => { setExecuting(null); void reload(); }}
        />
      )}

      {reporting && (
        <ExecutionModal
          plan={reporting}
          userName={userName}
          onClose={() => setReporting(null)}
          onSuccess={() => { setReporting(null); void reload(); }}
        />
      )}

      {showModal && (
        <MaintenancePlanModal
          plan={editing}
          userId={user?.id ?? null}
          userName={userName}
          isAdmin={user?.role === "TENANT_ADMIN"}
          onClose={() => { setShowModal(false); setEditing(null); }}
          onSaved={() => { setShowModal(false); setEditing(null); void reload(); }}
        />
      )}
    </div>
  );
};
