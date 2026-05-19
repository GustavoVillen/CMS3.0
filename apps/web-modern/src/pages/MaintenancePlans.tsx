import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Clock,
  ExternalLink,
  FileDown,
  FileSpreadsheet,
  FileText,
  Filter,
  GitBranch,
  Loader2,
  Maximize2,
  Minimize2,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { MocModal, type MocPrefill } from "./Moc";
import { useFetch } from "../lib/hooks";
import { api, ApiError } from "../lib/api";
import { downloadAuthedFile } from "../lib/authed-media";
import { useAuth } from "../lib/auth";
import { useVesselContext } from "../lib/vessel-context";
import { DataTable, StatusBadge, type Column } from "../components/DataTable";
import { FILTER_ALL_VALUE, fmtDate, fromFilterSelectValue, parseLocalDate, toFilterSelectValue } from "../lib/utils";
import { PageHeader } from "../components/PageHeader";
import { VesselLabel } from "../components/EntityLabels";
import { ExcelPanel } from "../components/ExcelPanel";
import { useT } from "../lib/i18n";
import { useCopilotEmitter, useCopilotApplyFields, useCopilotScreenContext } from "../lib/copilot-context";
import { CreateWorkOrderModal } from "../components/CreateWorkOrderModal";
import { RichTextArea } from "../components/RichTextArea";
import { useEscapeGuard, useDirtyTracker } from "../lib/escape-guard";

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
  estimatedHours: number | null;
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
  loto?: string | null;
  sfiGroupNumber?: number | null;
  sfiSubgroupCode?: string | null;
  riskLevel?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | null;
  riskAnalysisResult?: string | null;
  consequenceCategory?: "SAFETY" | "ENVIRONMENTAL" | "OPERATIONAL" | "NON_OPERATIONAL" | null;
  consequenceRationale?: string | null;
  samplingFluidType?: string | null;
  windowMode?: string | null;
  windowLeadDays?: number | null;
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
  if (plan.lastExecutionDate == null && plan.lastExecutionHours == null) return "NEVER_EXECUTED";
  const now = Date.now();
  if (plan.nextDueHours != null) {
    const hours = plan.assetCurrentHours ?? 0;
    const diff = plan.nextDueHours - hours;
    if (diff <= 0)   return "OVERDUE";
    if (diff <= 50)  return "DUE";
    if (diff <= 250) return "UPCOMING";
    return "FUTURE";
  }
  if (plan.nextDueDate) {
    const daysLeft = (parseLocalDate(plan.nextDueDate).getTime() - now) / 86_400_000;
    if (daysLeft < 0)   return "OVERDUE";
    if (daysLeft <= 7)  return "DUE";
    if (daysLeft <= 30) return "UPCOMING";
    return "FUTURE";
  }
  return plan.executionStatus ?? "FUTURE";
}

function StatusBadgeInline({ plan, onClickWo }: { plan: MaintenancePlan; onClickWo?: () => void }) {
  const t = useT();
  const es = computeStatus(plan);
  if (es === "OVERDUE")
    return (
      <div className="flex flex-col items-start gap-0.5">
        <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-bold bg-red-500/10 text-red-400 border-red-500/20 whitespace-nowrap">
          <AlertTriangle className="w-2.5 h-2.5" /> {t("mp.statusBadge.overdue")}
        </span>
      </div>
    );
  if (es === "DUE")
    return (
      <div className="flex flex-col items-start gap-0.5">
        <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-bold bg-orange-500/10 text-orange-400 border-orange-500/20 whitespace-nowrap">
          <AlertTriangle className="w-2.5 h-2.5" /> {t("mp.statusBadge.due")}
        </span>
      </div>
    );
  if (es === "IN_WINDOW")
    return (
      <div className="flex flex-col items-start gap-1">
        <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-bold bg-orange-500/10 text-orange-300 border-orange-500/20 whitespace-nowrap">
          <Clock className="w-2.5 h-2.5" /> {t("mp.statusBadge.inWindow")}
        </span>
        {plan.activeWorkOrderCode && (
          <button
            type="button"
            onClick={onClickWo}
            disabled={!onClickWo}
            className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-bold bg-white/5 text-accent border-accent/30 font-mono whitespace-nowrap disabled:opacity-40 disabled:cursor-default enabled:hover:bg-accent/10 enabled:cursor-pointer transition-colors"
          >
            <ExternalLink className="w-2.5 h-2.5 shrink-0" />
            {plan.activeWorkOrderCode}
          </button>
        )}
      </div>
    );
  if (es === "NEVER_EXECUTED")
    return (
      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-bold bg-slate-500/10 text-slate-400 border-slate-500/20 whitespace-nowrap">
        <Clock className="w-2.5 h-2.5" /> {t("mp.statusBadge.neverExecuted")}
      </span>
    );
  if (es === "UPCOMING")
    return (
      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-bold bg-yellow-500/10 text-yellow-400 border-yellow-500/20 whitespace-nowrap">
        <Clock className="w-2.5 h-2.5" /> {t("mp.statusBadge.upcoming")}
      </span>
    );
  if (es === "COMPLETED")
    return (
      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-bold bg-emerald-500/10 text-emerald-400 border-emerald-500/20 whitespace-nowrap">
        <CheckCircle2 className="w-2.5 h-2.5" /> {t("mp.statusBadge.valid")}
      </span>
    );
  // FUTURE
  return (
    <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-bold bg-emerald-500/10 text-emerald-400 border-emerald-500/20 whitespace-nowrap">
      <CheckCircle2 className="w-2.5 h-2.5" /> {t("mp.statusBadge.valid")}
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
const sectionLabelCls = "block font-semibold uppercase tracking-wider px-2 py-1 rounded-sm";
const sectionLabelStyle: React.CSSProperties = { backgroundColor: "#0f172a", color: "white", fontSize: "1.2rem" };
const aiLabelStyle: React.CSSProperties = { backgroundColor: "#0c1f3f", color: "white", fontSize: "1.2rem", borderLeft: "3px solid #3b82f6" };

// ─── Asset live-search dropdown ────────────────────────────────────────────────

interface AssetOption { id: string; assetCode: string; name: string | null; }

function AssetSearchDropdown({ assets, value, onChange, disabled, placeholder }: {
  assets: AssetOption[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = assets.find(a => a.id === value) ?? null;

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    if (!q) return assets;
    return assets.filter(a =>
      a.assetCode.toLowerCase().includes(q) || (a.name ?? "").toLowerCase().includes(q)
    );
  }, [assets, query]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleOpen = () => {
    if (disabled) return;
    setOpen(true);
    setQuery("");
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleSelect = (a: AssetOption) => {
    onChange(a.id);
    setOpen(false);
    setQuery("");
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange("");
    setOpen(false);
    setQuery("");
  };

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger */}
      <button
        type="button"
        onClick={handleOpen}
        disabled={disabled}
        className={`${inputCls} flex items-center gap-2 text-left cursor-pointer ${disabled ? "opacity-40 cursor-not-allowed" : "hover:border-accent/40"}`}
      >
        {selected ? (
          <>
            {selected.name
              ? <span className="flex-1 truncate text-yellow-400 text-sm font-semibold">{selected.name}</span>
              : <span className="flex-1 truncate font-mono text-accent text-sm">{selected.assetCode}</span>}
            {selected.name && <span className="text-white/40 text-xs font-mono truncate max-w-[160px]">{selected.assetCode}</span>}
            <X className="w-3.5 h-3.5 text-white/30 hover:text-white shrink-0" onClick={handleClear} />
          </>
        ) : (
          <>
            <span className="flex-1 text-white/30 text-sm">{placeholder ?? t("mp.selectAsset")}</span>
            <ChevronDown className="w-3.5 h-3.5 text-white/30 shrink-0" />
          </>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-[#111827] border border-white/10 rounded-xl shadow-xl overflow-hidden">
          {/* Search input */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
            <Search className="w-3.5 h-3.5 text-white/30 shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Escape") { setOpen(false); setQuery(""); }
                if (e.key === "Enter" && filtered.length === 1) handleSelect(filtered[0]);
              }}
              placeholder={t("mp.searchByCodeOrName")}
              className="flex-1 bg-transparent text-sm text-white placeholder-white/20 outline-none"
            />
          </div>
          {/* Options */}
          <div className="max-h-52 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-3 text-xs text-white/30 text-center">{t("common.noResults")}</div>
            ) : filtered.map(a => (
              <button
                key={a.id}
                type="button"
                onClick={() => handleSelect(a)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/5 transition-colors ${a.id === value ? "bg-accent/10" : ""}`}
              >
                {a.name
                  ? <span className="text-yellow-400 text-xs font-semibold truncate flex-1">{a.name}</span>
                  : <span className="font-mono text-accent text-xs shrink-0">{a.assetCode}</span>}
                {a.name && <span className="font-mono text-white/40 text-xs shrink-0">{a.assetCode}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ExecutionModal ───────────────────────────────────────────────────────────

interface ExecutionModalProps {
  plan: MaintenancePlan;
  userName: string;
  onClose: () => void;
  onSuccess: () => void;
}

const ExecutionModal: React.FC<ExecutionModalProps> = ({ plan, userName, onClose, onSuccess }) => {
  const navigate = useNavigate();
  const t = useT();
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
    if (!executedByName.trim()) { setError(t("mp.exec.executorRequired")); return false; }
    if (result === "CON_DEFICIENCIAS" && !deficienciesNotes.trim()) {
      setError(t("mp.exec.deficienciesRequired"));
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
      setError(err instanceof ApiError ? err.message : t("mp.exec.saveError"));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    if (await doSave()) onSuccess();
  };

  // ESC guard
  const isDirty = useDirtyTracker({
    executedByName, result, notes, deficienciesNotes, completedAt, runningHours,
    docFileName: docFile?.name ?? "",
  });
  useEscapeGuard({
    enabled: !showPrintConfirm,
    isDirty,
    onSave: handleSave,
    onClose,
  });

  const handleSaveAndPdf = async () => {
    if (!await doSave()) return;
    const token = localStorage.getItem("gpms_token");
    const slug  = localStorage.getItem("gpms_tenant_slug");
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    if (slug)  headers["X-Tenant-Slug"] = slug;
    try {
      const res = await fetch(`/app/pms/maintenance-plans/${plan.id}/pdf`, { headers });
      console.log("[PDF] response status:", res.status);
      if (res.ok) {
        const blob = await res.blob();
        console.log("[PDF] blob size:", blob.size);
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement("a");
        a.href     = url;
        a.download = `${plan.taskCode ?? plan.id}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
    } catch (err) {
      console.error("[PDF] fetch error:", err);
      alert(t("mp.exec.pdfFailed"));
    }
    onSuccess();
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
        classification: t("mp.exec.defectClassification"),
        description: deficienciesNotes.trim() || `${t("mp.exec.defectFromPlan")} ${plan.taskCode}`,
        severity: "LOW",
        operationalState: "NORMAL",
      });
      onSuccess();
      navigate(`/defects?defectId=${defect.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("mp.exec.defectFailed"));
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
            <h2 className="text-base font-bold text-white">{t("mp.exec.savedTitle")}</h2>
            <button onClick={onClose} className="text-text-industrial/40 hover:text-white transition-colors"><X className="w-5 h-5" /></button>
          </div>
          <div className="p-6 space-y-4">
            <p className="text-sm text-white/80">{t("mp.exec.printWoQuestion")}</p>
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5 border border-white/10">
              <span className="text-xs text-text-industrial/60 font-mono">{t("wo.entityLabelShort")}: {plan.activeWorkOrderCode}</span>
            </div>
            {error && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{error}</p>}
          </div>
          <div className="flex justify-end gap-2 px-6 py-4 border-t border-white/10">
            <button
              onClick={() => void createDefectAndNavigate()}
              disabled={openingDefect}
              className="px-4 py-2 rounded-xl text-xs text-text-industrial/60 hover:text-white transition-colors disabled:opacity-50"
            >
              {t("mp.exec.continueWithoutPrint")}
            </button>
            <button
              onClick={() => {
                window.open(`/work-orders?autoCode=${plan.activeWorkOrderCode}`, "_blank");
                void createDefectAndNavigate();
              }}
              disabled={openingDefect}
              className="px-4 py-2 rounded-xl bg-accent text-primary-bg font-bold text-xs hover:brightness-110 disabled:opacity-50 transition-all flex items-center gap-1.5"
            >
              {openingDefect ? <Loader2 className="w-4 h-4 animate-spin" /> : t("mp.exec.printAndContinue")}
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
            <h2 className="text-base font-bold text-white">{t("mp.exec.reportTitle")}</h2>
            <p className="text-[11px] text-text-industrial/50 flex items-center gap-1"><span className="font-mono">{plan.taskCode}</span> · <VesselLabel code={plan.vesselCode} className="text-[11px]" showCode /></p>
          </div>
          <button onClick={onClose} className="text-text-industrial/40 hover:text-white transition-colors"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Result selector */}
          <div className="space-y-1.5">
            <label className={labelCls}>{t("mp.exec.resultLabel")}</label>
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
                  {r === "SATISFACTORIO" ? t("mp.exec.satisfactory") : t("mp.exec.withDeficiencies")}
                </button>
              ))}
            </div>
          </div>

          {/* Executed by */}
          <div className="space-y-1.5">
            <label className={labelCls}>{t("mp.exec.executedBy")}</label>
            <input
              value={executedByName}
              onChange={e => setExecutedByName(e.target.value)}
              className={inputCls}
              placeholder={t("mp.exec.executedByPlaceholder")}
            />
          </div>

          {/* Date */}
          <div className="space-y-1.5">
            <label className={labelCls}>{t("mp.exec.executionDate")}</label>
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
              <label className={labelCls}>{t("mp.exec.runningHoursLabel")}</label>
              <input
                type="number"
                min="0"
                value={runningHours}
                onChange={e => setRunningHours(e.target.value)}
                className={inputCls}
                placeholder={t("wo.modal.runningHoursPlaceholder")}
              />
            </div>
          )}

          {/* Notes */}
          <div className="space-y-1.5">
            <label className={labelCls}>{t("wo.modal.observations")}</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              className={inputCls}
              placeholder={t("mp.exec.notesPlaceholder")}
            />
          </div>

          {/* Deficiencies */}
          {result === "CON_DEFICIENCIAS" && (
            <div className="space-y-1.5">
              <label className={labelCls + " text-yellow-400"}>{t("mp.exec.deficienciesLabel")}</label>
              <textarea
                value={deficienciesNotes}
                onChange={e => setDeficienciesNotes(e.target.value)}
                rows={4}
                className={`${inputCls} border-yellow-500/30 focus:border-yellow-400/50`}
                placeholder={t("mp.exec.deficienciesPlaceholder")}
              />
            </div>
          )}

          {/* Document upload */}
          <div className="space-y-1.5">
            <label className={labelCls}>{t("mp.exec.checklistLabel")}</label>
            {docFile ? (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-accent/10 border border-accent/20">
                <span className="text-xs text-accent flex-1 truncate">{docFile.name}</span>
                <button type="button" onClick={() => setDocFile(null)} className="text-text-industrial/40 hover:text-white transition-colors"><X className="w-3.5 h-3.5" /></button>
              </div>
            ) : (
              <label className="flex items-center gap-2 px-3 py-2 rounded-xl border border-dashed border-white/20 cursor-pointer hover:border-accent/40 transition-colors">
                <span className="text-xs text-text-industrial/50">{t("mp.exec.selectFile")}</span>
                <input type="file" className="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.txt"
                  onChange={e => setDocFile(e.target.files?.[0] ?? null)} />
              </label>
            )}
          </div>

          {/* ── DEF question — último campo ───────────────────────────────── */}
          {result === "CON_DEFICIENCIAS" && (
            <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-4 space-y-3">
              <p className="text-xs font-semibold text-yellow-300 uppercase tracking-wider">{t("mp.exec.defLogQuestion")}</p>

              {/* AI analysis */}
              {aiLoading && (
                <div className="flex items-center gap-2 text-xs text-text-industrial/50">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
                  {t("mp.exec.copilotAnalyzing")}
                </div>
              )}
              {aiSuggestion && !aiLoading && (
                <div className="rounded-lg border border-accent/20 bg-accent/5 p-3">
                  <p className="text-[10px] font-bold text-accent uppercase tracking-wider mb-1.5">{t("mp.exec.copilotSuggestion")}</p>
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
                {t("mp.exec.openDefRecord")}
              </button>
            </div>
          )}

          {error && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-white/10">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-white transition-colors">{t("common.cancel")}</button>
          <button
            onClick={() => { void handleSaveAndPdf(); }}
            disabled={saving || uploading}
            className="px-4 py-2 rounded-xl bg-white/10 border border-white/10 text-white font-bold text-xs hover:bg-white/15 disabled:opacity-50 transition-all flex items-center gap-1.5"
          >
            <FileDown className="w-3.5 h-3.5" />
            {t("mp.exec.saveAndPdf")}
          </button>
          <button
            onClick={() => { void handleSave(); }}
            disabled={saving || uploading}
            className="px-4 py-2 rounded-xl bg-accent text-primary-bg font-bold text-xs hover:brightness-110 disabled:opacity-50 transition-all"
          >
            {uploading ? <span className="flex items-center gap-1.5"><Loader2 className="w-4 h-4 animate-spin" /> {t("mp.exec.uploading")}</span>
              : saving ? <Loader2 className="w-4 h-4 animate-spin" />
              : t("mp.exec.saveExecution")}
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
      setAiSuggestion(t("mp.postpone.copilotFail"));
    } finally {
      setAiLoading(false);
    }
  };

  const save = async (waitAuthorization: boolean) => {
    if (!justification.trim()) { setError(t("mp.postpone.justificationRequired")); return; }
    if (!waitAuthorization && !authorizedBy.trim()) {
      setError(t("mp.postpone.authorizerRequired"));
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

  // ESC guard
  const isDirty = useDirtyTracker({
    newDueDate, newDueHours, justification, compensatoryMeasures, authorizedBy,
  });
  useEscapeGuard({
    isDirty,
    onSave: () => save(false),
    onClose,
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-xl bg-[#0D1B2A] border border-white/10 rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div>
            <h2 className="text-base font-bold text-white">{t("mp.postpone.title")}</h2>
            <p className="text-[11px] text-text-industrial/50 flex items-center gap-1"><span className="font-mono">{plan.taskCode}</span> · <VesselLabel code={plan.vesselCode} className="text-[11px]" showCode /></p>
          </div>
          <button onClick={onClose} className="text-text-industrial/40 hover:text-white transition-colors"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Inherited plan context */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white/5 border border-white/10 rounded-xl p-3">
              <p className="text-[10px] uppercase text-text-industrial/40 tracking-wider">{t("mp.postpone.taskLabel")}</p>
              <p className="text-sm font-medium text-white line-clamp-2">{plan.title}</p>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-xl p-3">
              <p className="text-[10px] uppercase text-text-industrial/40 tracking-wider">{t("mp.postpone.currentDue")}</p>
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
              <label className={labelCls}>{t("mp.postpone.newDueHours")}</label>
              <input
                type="number"
                min="0"
                value={newDueHours}
                onChange={e => setNewDueHours(e.target.value)}
                className={inputCls}
                placeholder={t("mp.postpone.newDueHoursPlaceholder")}
              />
            </div>
          ) : (
            <div className="space-y-1.5">
              <label className={labelCls}>{t("mp.postpone.newDueDate")}</label>
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
            <label className={labelCls}>{t("mp.postpone.justification")}</label>
            <textarea
              value={justification}
              onChange={e => setJustification(e.target.value)}
              rows={3}
              className={inputCls}
              placeholder={t("mp.postpone.justificationPlaceholder")}
            />
          </div>

          {/* Compensatory measures */}
          <div className="space-y-1.5">
            <label className={labelCls}>{t("mp.postpone.compensatoryMeasures")}</label>
            <textarea
              value={compensatoryMeasures}
              onChange={e => setCompensatoryMeasures(e.target.value)}
              rows={2}
              className={inputCls}
              placeholder={t("mp.postpone.compensatoryPlaceholder")}
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
              {aiLoading ? <><Loader2 className="w-3 h-3 animate-spin inline mr-1" />{t("common.analyzing")}</> : t("mp.postpone.copilotSuggest")}
            </button>
          </div>

          {aiSuggestion && (
            <div className="rounded-xl border border-accent/20 bg-accent/5 p-4">
              <p className="text-[10px] font-bold text-accent uppercase tracking-wider mb-2">{t("mp.exec.copilotSuggestion")}</p>
              <p className="text-sm text-white/80 whitespace-pre-wrap">{aiSuggestion}</p>
            </div>
          )}

          {/* Authorized by */}
          <div className="space-y-1.5">
            <label className={labelCls}>{t("mp.postpone.authorizedBy")} <span className="text-text-industrial/30">{t("mp.postpone.authorizedByHint")}</span></label>
            <input
              value={authorizedBy}
              onChange={e => setAuthorizedBy(e.target.value)}
              className={inputCls}
              placeholder={t("mp.postpone.authorizedByPlaceholder")}
            />
          </div>

          {error && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{error}</p>}
        </div>

        <div className="flex justify-between gap-2 px-6 py-4 border-t border-white/10">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-white transition-colors">{t("common.cancel")}</button>
          <div className="flex gap-2">
            <button
              onClick={() => { void save(true); }}
              disabled={saving}
              className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-xs text-text-industrial/70 hover:text-white disabled:opacity-50 transition-all"
            >
              {t("mp.postpone.waitAuthorization")}
            </button>
            <button
              onClick={() => { void save(false); }}
              disabled={saving}
              className="px-4 py-2 rounded-xl bg-accent text-primary-bg font-bold text-xs hover:brightness-110 disabled:opacity-50 transition-all"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : t("common.save")}
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
  canDelete: boolean;
  onClose: () => void;
  onSaved: (savedId?: string) => Promise<void>;
  setRequestMessage?: (msg: string | null) => void;
}

const MaintenancePlanModal: React.FC<MaintenancePlanModalProps> = ({ plan, userId, userName, isAdmin, canDelete, onClose, onSaved, setRequestMessage: setReqMsg }) => {
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
  const [loto, setLoto] = useState(plan?.loto ?? "");
  const [sfiGroupNumber, setSfiGroupNumber] = useState<number | null>(plan?.sfiGroupNumber ?? null);
  const [sfiSubgroupCode, setSfiSubgroupCode] = useState(plan?.sfiSubgroupCode ?? "");
  const [riskLevel, setRiskLevel] = useState<RiskLevel>(toUiRiskLevel(plan?.riskLevel));
  const [riskAnalysisResult, setRiskAnalysisResult] = useState(plan?.riskAnalysisResult ?? "");
  const [consequenceCategory, setConsequenceCategory] = useState<"" | "SAFETY" | "ENVIRONMENTAL" | "OPERATIONAL" | "NON_OPERATIONAL">(
    (plan?.consequenceCategory as any) ?? "",
  );
  const [consequenceRationale, setConsequenceRationale] = useState(plan?.consequenceRationale ?? "");
  const [loadingConsequence, setLoadingConsequence] = useState(false);
  const [status, setStatus] = useState(plan?.status ?? "ACTIVE");
  const [triggerType, setTriggerType] = useState<TriggerType>((plan?.triggerType as TriggerType) ?? "MONTHS");
  const [frequencyMonths, setFrequencyMonths] = useState(String(plan?.frequencyMonths ?? ""));
  const [frequencyHours, setFrequencyHours] = useState(String(plan?.frequencyHours ?? ""));
  const [estimatedHours, setEstimatedHours] = useState(String(plan?.estimatedHours ?? ""));
  const [triggerResultMode, setTriggerResultMode] = useState(plan?.triggerResultMode ?? "DUE_ONLY");
  const [windowMode, setWindowMode] = useState(plan?.windowMode ?? "AUTO");
  const [windowLeadDays, setWindowLeadDays] = useState(String(plan?.windowLeadDays ?? ""));
  const [checklistTemplate, setChecklistTemplate] = useState(plan?.checklistTemplate ?? "");
  const [samplingFluidType, setSamplingFluidType] = useState<string>(plan?.samplingFluidType ?? "");
  const [checklistUploading, setChecklistUploading] = useState(false);
  const [checklistUploadError, setChecklistUploadError] = useState<string | null>(null);
  const [loadingCriteria, setLoadingCriteria] = useState(false);
  const [loadingLoto, setLoadingLoto] = useState(false);
  const [loadingRisk, setLoadingRisk] = useState(false);

  const [saving,      setSaving]      = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showExecution, setShowExecution] = useState(false);
  const [expanded,    setExpanded]    = useState(true);
  const [showPostpone, setShowPostpone] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting,    setDeleting]    = useState(false);
  const [confirmDuplicateWO, setConfirmDuplicateWO] = useState(false);
  const [sfiNodes, setSfiNodes] = useState<SfiNode[]>([]);
  const [loadingSfiNodes, setLoadingSfiNodes] = useState(false);
  const [showMoc, setShowMoc] = useState(false);
  // Popup interceptor: aparece al tocar Guardar cuando hay cambio de
  // periodicidad. El user elige Cancelar / Guardar sin MOC / Abrir MOC.
  const [showMocPrompt, setShowMocPrompt] = useState(false);

  // Detección de cambio en frecuencia / trigger — sugiere MOC PROCEDURE_CHANGE.
  // Modificar la frecuencia o el tipo de disparador de un plan aprobado
  // cambia el SMS / cronograma de mantenimiento; ISM 10.3 / TMSA piden
  // que ese cambio quede formalmente justificado y aprobado.
  const planChangedFrequency = !isNew && plan !== null && (
    triggerType !== (plan.triggerType as TriggerType) ||
    (frequencyMonths || "") !== String(plan.frequencyMonths ?? "") ||
    (frequencyHours  || "") !== String(plan.frequencyHours  ?? "")
  );

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
    setTaskCode(plan.taskCode ?? "");
    setTaskType(plan.taskType ?? "MAINTENANCE");
    setTitle(plan.title);
    setDescription(plan.description ?? "");
    setResponsible(plan.responsible ?? "");
    setAcceptanceCriteria(plan.acceptanceCriteria ?? "");
    setLoto(plan.loto ?? "");
    setSfiGroupNumber(plan.sfiGroupNumber ?? null);
    setSfiSubgroupCode(plan.sfiSubgroupCode ?? "");
    setRiskLevel(toUiRiskLevel(plan.riskLevel));
    setRiskAnalysisResult(plan.riskAnalysisResult ?? "");
    setConsequenceCategory((plan.consequenceCategory as any) ?? "");
    setConsequenceRationale(plan.consequenceRationale ?? "");
    setStatus(plan.status);
    setTriggerType((plan.triggerType as TriggerType) ?? "MONTHS");
    setFrequencyMonths(String(plan.frequencyMonths ?? ""));
    setFrequencyHours(String(plan.frequencyHours ?? ""));
    setEstimatedHours(String(plan.estimatedHours ?? ""));
    setTriggerResultMode(plan.triggerResultMode ?? "DUE_ONLY");
    setWindowMode(plan.windowMode ?? "AUTO");
    setWindowLeadDays(String(plan.windowLeadDays ?? ""));
    setChecklistTemplate(plan.checklistTemplate ?? "");
    setSamplingFluidType(plan.samplingFluidType ?? "");
    setChecklistUploading(false);
    setChecklistUploadError(null);
    setActionError(null);
    setShowExecution(false);
    setShowPostpone(false);
  }, [plan]);

  useCopilotEmitter({
    module: "MAINTENANCE_PLANS",
    screen: "MP_EDIT",
    entityId:      plan?.id       ?? null,
    entityCode:    plan?.taskCode ?? "NUEVO",
    vesselCode:    plan?.vesselCode ?? null,
    workflowStage: plan?.executionStatus ?? "NEW",
    canEdit: true,
    fieldValues: {
      title:              title              || null,
      description:        description        || null,
      responsible:        responsible        || null,
      acceptanceCriteria: acceptanceCriteria || null,
      loto:               loto               || null,
      riskLevel:          riskLevel          || null,
      riskAnalysisResult: riskAnalysisResult || null,
      triggerType:        triggerType        || null,
      frequencyMonths:    frequencyMonths    || null,
      frequencyHours:     frequencyHours     || null,
    },
  });

  useCopilotApplyFields((fields) => {
    if (fields.title              !== undefined) setTitle(fields.title);
    if (fields.description        !== undefined) setDescription(fields.description);
    if (fields.responsible        !== undefined) setResponsible(fields.responsible);
    if (fields.acceptanceCriteria !== undefined) setAcceptanceCriteria(fields.acceptanceCriteria);
    if (fields.loto               !== undefined) setLoto(fields.loto);
    if (fields.riskAnalysisResult !== undefined) setRiskAnalysisResult(fields.riskAnalysisResult);
    if (fields.riskLevel          !== undefined) setRiskLevel(toUiRiskLevel(fields.riskLevel));
    if (fields.triggerType        !== undefined && TRIGGER_TYPES.includes(fields.triggerType as TriggerType))
      setTriggerType(fields.triggerType as TriggerType);
    if (fields.frequencyMonths    !== undefined) setFrequencyMonths(fields.frequencyMonths);
    if (fields.frequencyHours     !== undefined) setFrequencyHours(fields.frequencyHours);
  });

  // Asset label resolver: works for both new and existing plans.
  // For new plans: looks up name in the assets list using current assetId.
  // For existing plans: prefers plan.assetName, falls back to assetId.
  const resolveAssetLabel = useCallback((): string | null => {
    if (plan?.assetName) return plan.assetName;
    if (assetId) {
      const found = assets.find(a => a.id === assetId);
      if (found) return found.name ?? found.assetCode ?? null;
      return assetId;
    }
    return plan?.assetId ?? null;
  }, [plan, assetId, assets]);

  const handleAcceptanceCriteriaClick = useCallback(async () => {
    if (readOnly || loadingCriteria) return;
    const prev = acceptanceCriteria;
    setLoadingCriteria(true);
    setAcceptanceCriteria(t("mp.modal.analyzing"));
    try {
      const res = await api.post<{ text: string }>("/app/pms/maintenance-plans/suggest-acceptance-criteria", {
        assetLabel: resolveAssetLabel(),
        taskDesc: description || title || null,
      });
      setAcceptanceCriteria(res.text || prev);
    } catch {
      setAcceptanceCriteria(prev);
    } finally {
      setLoadingCriteria(false);
    }
  }, [readOnly, acceptanceCriteria, description, title, loadingCriteria, resolveAssetLabel, t]);

  const handleLotoClick = useCallback(async () => {
    if (readOnly || loadingLoto) return;
    const prev = loto;
    setLoadingLoto(true);
    setLoto(t("mp.modal.analyzing"));
    try {
      const res = await api.post<{ text: string }>("/app/pms/maintenance-plans/suggest-loto", {
        assetLabel: resolveAssetLabel(),
        taskDesc: description || title || null,
        acceptanceCriteria: acceptanceCriteria || null,
      });
      setLoto(res.text || prev);
    } catch {
      setLoto(prev);
    } finally {
      setLoadingLoto(false);
    }
  }, [readOnly, loto, description, title, acceptanceCriteria, loadingLoto, resolveAssetLabel, t]);

  const handleRiskClick = useCallback(async () => {
    if (readOnly || loadingRisk) return;
    setLoadingRisk(true);
    try {
      const res = await api.post<{ level: string; analysis: string }>("/app/pms/maintenance-plans/suggest-risk", {
        assetLabel: resolveAssetLabel(),
        taskDesc: description || title || null,
        acceptanceCriteria: acceptanceCriteria || null,
        loto: loto || null,
      });
      if (res.level && ["LOW","MEDIUM","HIGH","CRITICAL"].includes(res.level)) {
        setRiskLevel(res.level as RiskLevel);
      }
      if (res.analysis) setRiskAnalysisResult(res.analysis);
    } catch { /* noop */ }
    finally {
      setLoadingRisk(false);
    }
  }, [readOnly, description, title, acceptanceCriteria, loto, loadingRisk, resolveAssetLabel]);

  const handleConsequenceClick = useCallback(async () => {
    if (readOnly || loadingConsequence) return;
    setLoadingConsequence(true);
    try {
      const res = await api.post<{ category: string; rationale: string }>(
        "/app/pms/maintenance-plans/suggest-consequence",
        {
          assetName: resolveAssetLabel() ?? "",
          assetSfiCode: plan?.sfiSubgroupCode ?? sfiSubgroupCode ?? null,
          planTitle: title || null,
          planDescription: description || null,
        },
      );
      if (res.category && ["SAFETY","ENVIRONMENTAL","OPERATIONAL","NON_OPERATIONAL"].includes(res.category)) {
        setConsequenceCategory(res.category as any);
      }
      if (res.rationale) setConsequenceRationale(res.rationale);
    } catch { /* noop */ }
    finally {
      setLoadingConsequence(false);
    }
  }, [readOnly, plan, title, description, loadingConsequence, resolveAssetLabel, sfiSubgroupCode]);

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

      let savedId: string;
      if (isNew) {
        const created = await api.post<{ id: string }>("/app/pms/maintenance-plans", {
          vesselCode: vesselCode.trim().toUpperCase(),
          assetId,
          taskCode: taskCode.trim() || undefined,
          taskType,
          title: title.trim(),
          description: normalizeOptionalText(description),
          responsible: normalizeOptionalText(responsible),
          acceptanceCriteria: normalizeOptionalText(acceptanceCriteria),
          loto: normalizeOptionalText(loto),
          sfiGroupNumber,
          sfiSubgroupCode: normalizeOptionalText(sfiSubgroupCode),
          riskLevel: toUiRiskLevel(riskLevel),
          riskAnalysisResult: normalizeOptionalText(riskAnalysisResult),
          consequenceCategory: consequenceCategory || null,
          consequenceRationale: normalizeOptionalText(consequenceRationale),
          status,
          triggerType,
          frequencyMonths: freqMonths,
          frequencyHours: freqHours,
          estimatedHours: estimatedHours ? Number(estimatedHours) : null,
          triggerResultMode,
          windowMode,
          windowLeadDays: windowLeadDays ? Number(windowLeadDays) : null,
          checklistTemplate: normalizeOptionalText(checklistTemplate),
          samplingFluidType: samplingFluidType || null,
        });
        savedId = created.id;
      } else {
        await api.patch(`/app/pms/maintenance-plans/${plan.id}`, {
          ...(assetId ? { assetId } : {}),
          ...(isAdmin && taskCode.trim() && taskCode.trim() !== plan.taskCode ? { taskCode: taskCode.trim().toUpperCase() } : {}),
          taskType,
          title: title.trim(),
          description: normalizeOptionalText(description),
          responsible: normalizeOptionalText(responsible),
          acceptanceCriteria: normalizeOptionalText(acceptanceCriteria),
          loto: normalizeOptionalText(loto),
          sfiGroupNumber,
          sfiSubgroupCode: normalizeOptionalText(sfiSubgroupCode),
          riskLevel: toUiRiskLevel(riskLevel),
          riskAnalysisResult: normalizeOptionalText(riskAnalysisResult),
          consequenceCategory: consequenceCategory || null,
          consequenceRationale: normalizeOptionalText(consequenceRationale),
          status,
          triggerType,
          frequencyMonths: freqMonths,
          frequencyHours: freqHours,
          estimatedHours: estimatedHours ? Number(estimatedHours) : null,
          triggerResultMode,
          windowMode,
          windowLeadDays: windowLeadDays ? Number(windowLeadDays) : null,
          checklistTemplate: normalizeOptionalText(checklistTemplate),
          samplingFluidType: samplingFluidType || null,
        });
        savedId = plan.id;
      }
      await onSaved(savedId);
      onClose();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t("common.saveError"));
    } finally {
      setSaving(false);
    }
  };

  const canExecute = !isNew && plan.status !== "INACTIVE" && plan.status !== "DRAFT";
  const canPostpone = !isNew && plan.status !== "INACTIVE" && plan.status !== "DRAFT";
  const needsWO = !isNew && (plan.triggerResultMode === "AUTO_WO" || plan.triggerResultMode === "APPROVAL_WO");

  // ESC guard
  const planDirty = useDirtyTracker({
    vesselCode, taskCode, assetId, taskType, title, description, responsible,
    acceptanceCriteria, loto, sfiGroupNumber, sfiSubgroupCode,
    riskLevel, riskAnalysisResult, status, triggerType,
    frequencyMonths, frequencyHours, triggerResultMode,
    windowMode, windowLeadDays,
    checklistTemplate, samplingFluidType,
  });
  useEscapeGuard({
    enabled: !readOnly && !showExecution && !showPostpone && !confirmDelete && !confirmDuplicateWO,
    isDirty: planDirty,
    onSave,
    onClose,
  });

  async function downloadPdf() {
    if (!plan || isNew) return;
    const token = localStorage.getItem("gpms_token");
    const slug  = localStorage.getItem("gpms_tenant_slug");
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    if (slug)  headers["X-Tenant-Slug"] = slug;
    const res = await fetch(`/app/pms/maintenance-plans/${plan.id}/pdf`, { headers });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      alert(`Error ${res.status}: ${text.slice(0, 300) || "No se pudo generar el PDF."}`);
      return;
    }
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `${plan.taskCode ?? plan.id}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  function downloadPdfLegacy() {
    if (!plan || isNew) return;
    const fmtDate = (d: string | null | undefined) => d ? new Date(d).toLocaleDateString("es-AR") : "—";
    const v = (x: unknown) => String(x ?? "").trim() || "—";
    const triggerLbl = (t: string) => ({ CALENDAR: "Meses (calendario)", MONTHS: "Meses (calendario)", HOURS: "Horas de operación", RUNNING_HOURS: "Horas de operación" }[t.toUpperCase()] ?? t);
    const resultLbl = (r: string) => ({ DUE_ONLY: "Solo vencimiento", AUTO_WO: "OT automática", APPROVAL_WO: "OT con aprobación", CHECKLIST: "Completar Checklist" }[r] ?? r);
    const statusLbl = (s: string) => ({ ACTIVE: "Activo", INACTIVE: "Inactivo", OVERDUE: "Vencido", DUE_SOON: "Por vencer" }[s] ?? s);
    const taskTypeLbl = (t: string) => ({ MAINTENANCE: "Mantenimiento", INSPECTION: "Inspección" }[t] ?? t);
    const riskLbl = (r: string) => ({ LOW: "BAJO", MEDIUM: "MEDIO", HIGH: "ALTO", CRITICAL: "CRÍTICO" }[r] ?? r.toUpperCase());
    const riskColor = (r: string) => ({ LOW: "#16a34a", MEDIUM: "#d97706", HIGH: "#ea580c", CRITICAL: "#dc2626" }[r] ?? "#0f172a");

    function bold(text: string): string {
      return text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    }

    function renderText(raw: string | null | undefined): string {
      if (!raw?.trim()) return "—";
      const lines = raw.replace(/ð/g, "").split("\n");
      const out: string[] = [];
      let i = 0;
      while (i < lines.length) {
        const line = lines[i];
        if (line.includes("|")) {
          // Collect contiguous pipe lines as a table block
          const block: string[] = [];
          while (i < lines.length && lines[i].includes("|")) {
            block.push(lines[i]);
            i++;
          }
          // Filter out separator rows (|---|)
          const rows = block
            .filter(l => !/^\s*\|[\s|:-]+\|\s*$/.test(l))
            .map(l => l.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map(c => bold(c.trim())));
          if (rows.length === 0) continue;
          let table = '<table class="md-table">';
          rows.forEach((cells, ri) => {
            const tag = ri === 0 ? "th" : "td";
            table += `<tr>${cells.map(c => `<${tag}>${c || "&nbsp;"}</${tag}>`).join("")}</tr>`;
          });
          table += "</table>";
          out.push(table);
        } else {
          const txt = line.trim();
          out.push(txt ? `<p>${bold(txt)}</p>` : "<br/>");
          i++;
        }
      }
      return out.join("");
    }

    const gen = new Date().toLocaleString("es-AR");
    const assetDisplay = v(plan.assetName ?? assets.find(a => a.id === plan.assetId)?.name ?? plan.assetId);

    const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<title>${v(plan.taskCode)}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  @page{size:A4;margin:1cm}
  @page{@bottom-right{content:"Página " counter(page);font-size:7.5pt;color:#94a3b8;font-family:Arial,sans-serif}}
  html,body{width:100%;font-family:Arial,sans-serif;font-size:10pt;color:#1a1a2e}
  /* ── Outer table: thead/tfoot repeat on every printed page ── */
  table.page-wrap{width:100%;border-collapse:collapse}
  table.page-wrap>thead>tr>td{padding-bottom:4px;border-bottom:1.5px solid #0f2744}
  table.page-wrap>tfoot>tr>td{padding-top:4px;border-top:1px solid #cbd5e1}
  .ph{display:flex;justify-content:space-between;align-items:center;font-size:8pt}
  .ph-l{font-weight:bold;color:#0f2744;letter-spacing:0.4px}
  .ph-r{color:#64748b}
  .pf{font-size:7.5pt;color:#94a3b8}
  /* ── Content ── */
  .content{padding:8px 0}
  h1{font-size:18pt;color:#0f2744;margin-bottom:2px}
  .sub{font-size:9pt;color:#64748b;margin-bottom:10px}
  hr{border:none;border-top:2px solid #0f2744;margin:8px 0 12px}
  .section-title{background:#0f2744;color:#fff;font-size:8pt;font-weight:bold;
    letter-spacing:1px;padding:4px 10px;margin:10px 0 0;text-transform:uppercase;
    break-after:avoid}
  .grid{display:grid;grid-template-columns:repeat(3,1fr);border:1px solid #cbd5e1;border-top:none}
  .cell{padding:6px 10px;border-right:1px solid #cbd5e1;border-bottom:1px solid #cbd5e1;background:#f8fafc}
  .cell:last-child{border-right:none}
  .cell-label{font-size:7pt;font-weight:bold;color:#64748b;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:3px}
  .cell-full .cell-label{font-size:11.2pt;color:#ffffff;background-color:#0f172a;display:block;padding:4px 10px;margin:0 -10px 8px;letter-spacing:0.5px}
  .cell-value{font-size:10pt;font-weight:bold;color:#0f172a}
  .cell-full{grid-column:1/-1;border-right:none;padding-top:14px}
  .red{color:#b91c1c}.blue{color:#1d4ed8}
  .sig-row{display:grid;grid-template-columns:repeat(3,1fr);border:1px solid #cbd5e1;border-top:none;margin-top:20px;break-inside:avoid}
  .sig-cell{padding:8px 10px 28px;border-right:1px solid #cbd5e1;background:#f8fafc}
  .sig-cell:last-child{border-right:none}
  .sig-line{border-top:1px solid #aaa;margin-top:20px}
  .md-table{width:100%;border-collapse:collapse;font-size:9pt;margin:4px 0}
  .md-table th{background:#e2e8f0;font-weight:bold;text-align:left;padding:4px 8px;border:1px solid #cbd5e1}
  .md-table td{padding:4px 8px;border:1px solid #cbd5e1;vertical-align:top}
  .md-table tr:nth-child(even) td{background:#f8fafc}
  p{margin:2px 0;font-size:9.5pt}
</style></head><body>
<table class="page-wrap">
  <thead><tr><td>
    <div class="ph">
      <span class="ph-l" style="display:flex;align-items:center;gap:7px"><img src="/logo.png" style="width:16px;height:16px;object-fit:contain" />PLAN DE MANTENIMIENTO — CMS</span>
      <span class="ph-r">${v(plan.taskCode)} · ${v(plan.vesselCode)}</span>
    </div>
  </td></tr></thead>
  <tfoot><tr><td>
    <div class="pf">
      <span style="display:flex;align-items:center;gap:6px"><img src="/logo.png" style="width:14px;height:14px;object-fit:contain" />Generado: ${gen}</span>
      <span>${v(plan.taskCode)} · ${v(plan.vesselCode)}</span>
    </div>
  </td></tr></tfoot>
  <tbody><tr><td>
    <div class="content">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div style="display:flex;align-items:center;gap:14px">
          <img src="/logo.png" style="width:60px;height:60px;object-fit:contain;flex-shrink:0" />
          <div>
            <h1>PLAN DE MANTENIMIENTO</h1>
            <div class="sub">Copilot Management System</div>
          </div>
        </div>
        <div style="text-align:right;font-size:9pt;color:#64748b">
          <div style="font-size:7pt">Código:</div>
          <div style="font-size:13pt;font-weight:bold;color:#0f2744">${v(plan.taskCode)}</div>
          <div style="font-size:7pt;margin-top:4px">Generado: ${gen}</div>
        </div>
      </div>
      <hr/>

      <div class="section-title">Identificación</div>
      <div class="grid">
        <div class="cell"><div class="cell-label">Embarcación</div><div class="cell-value blue">${v(plan.vesselCode)}</div></div>
        <div class="cell"><div class="cell-label">Activo / Equipo</div><div class="cell-value">${assetDisplay}</div></div>
        <div class="cell"><div class="cell-label">Estado</div><div class="cell-value">${statusLbl(plan.status ?? "")}</div></div>
        <div class="cell"><div class="cell-label">Código de tarea</div><div class="cell-value">${v(plan.taskCode)}</div></div>
        <div class="cell"><div class="cell-label">Grupo SFI</div><div class="cell-value">${plan.sfiGroupNumber != null ? `G${plan.sfiGroupNumber}` : "—"}</div></div>
        <div class="cell"><div class="cell-label">Subgrupo SFI</div><div class="cell-value">${v(plan.sfiSubgroupCode)}</div></div>
        <div class="cell"><div class="cell-label">Tipo de tarea</div><div class="cell-value">${taskTypeLbl(plan.taskType)}</div></div>
        <div class="cell"><div class="cell-label">Responsable</div><div class="cell-value">${v(responsible)}</div></div>
        <div class="cell"><div class="cell-label">Criticidad</div><div class="cell-value">${v(plan.criticality)}</div></div>
      </div>

      <div class="section-title">Planificación y Frecuencia</div>
      <div class="grid">
        <div class="cell"><div class="cell-label">Tipo de trigger</div><div class="cell-value">${triggerLbl(plan.triggerType)}</div></div>
        <div class="cell"><div class="cell-label">Frecuencia (meses)</div><div class="cell-value">${plan.frequencyMonths != null ? `${plan.frequencyMonths} meses` : "—"}</div></div>
        <div class="cell"><div class="cell-label">Frecuencia (horas)</div><div class="cell-value">${plan.frequencyHours != null ? `${plan.frequencyHours} h` : "—"}</div></div>
        <div class="cell"><div class="cell-label">Última ejecución</div><div class="cell-value">${fmtDate(plan.lastExecutionDate)}</div></div>
        <div class="cell"><div class="cell-label">Próximo vencimiento</div><div class="cell-value red">${fmtDate(plan.nextDueDate)}</div></div>
        <div class="cell"><div class="cell-label">Modo de resultado</div><div class="cell-value">${resultLbl(plan.triggerResultMode ?? "")}</div></div>
      </div>

      <div class="section-title">Tareas a Realizar</div>
      <div class="grid">
        <div class="cell cell-full"><div class="cell-label">Título</div><div class="cell-value">${v(title)}</div></div>
        <div class="cell cell-full"><div class="cell-label">Tareas a realizar / Descripción</div><div class="cell-value" style="font-weight:normal">${renderText(description)}</div></div>
        ${acceptanceCriteria ? `<div class="cell cell-full"><div class="cell-label">Criterios de aceptación</div><div class="cell-value" style="font-weight:normal">${renderText(acceptanceCriteria)}</div></div>` : ""}
        ${loto ? `<div class="cell cell-full"><div class="cell-label">Evidencia requerida / LOTO</div><div class="cell-value" style="font-weight:normal">${renderText(loto)}</div></div>` : ""}
        ${riskLevel ? `<div class="cell cell-full"><div class="cell-label">Nivel de riesgo</div><div class="cell-value" style="font-size:13pt;color:${riskColor(riskLevel)}">${riskLbl(riskLevel)}</div></div>
        ${riskAnalysisResult ? `<div class="cell cell-full"><div class="cell-label">Análisis de riesgo</div><div class="cell-value" style="font-weight:normal">${renderText(riskAnalysisResult)}</div></div>` : ""}` : ""}
      </div>

      <div class="sig-row">
        <div class="sig-cell"><div class="cell-label">Responsable de ejecución</div><div class="sig-line"></div></div>
        <div class="sig-cell"><div class="cell-label">Supervisor / Jefe de Máquinas</div><div class="sig-line"></div></div>
        <div class="sig-cell"><div class="cell-label">Verificado por</div><div class="sig-line"></div></div>
      </div>
    </div>
  </td></tr></tbody>
</table>
</body></html>`;

    const win = window.open("", "_blank", "width=900,height=700");
    if (!win) { alert("El navegador bloqueó la ventana emergente. Permita popups para este sitio."); return; }
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 500);
  }

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
        <div className={`w-full bg-[#0D1B2A] border border-white/10 rounded-2xl shadow-2xl flex flex-col transition-all duration-200 ${expanded ? "w-full h-full" : "max-w-2xl max-h-[90vh]"}`} onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0">
            <div>
              <h2 className="text-base font-bold text-white">
                {isNew ? t("mp.newPlan") : t("page.maintenancePlans")}
              </h2>
              {!isNew && <StatusBadgeInline plan={plan} onClickWo={plan.activeWorkOrderCode ? () => { onClose(); navigate(`/work-orders?autoCode=${plan.activeWorkOrderCode}`); } : undefined} />}
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setExpanded(v => !v)} className="p-1.5 rounded-lg text-text-industrial/30 hover:text-white hover:bg-white/5 transition-colors" title={expanded ? t("common.minimize") : t("common.maximize")}>
                {expanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              </button>
              <button onClick={onClose} className="text-text-industrial/40 hover:text-white transition-colors"><X className="w-5 h-5" /></button>
            </div>
          </div>

          {readOnly && (
            <div className="mx-6 mt-3 px-3 py-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-xs text-yellow-400">
              {t("mp.modal.readOnly")}
            </div>
          )}
          <fieldset disabled={readOnly} className="p-6 space-y-4 flex-1 min-h-0 overflow-y-auto disabled:opacity-70">

            {/* Read-only identifiers (edit mode) */}
            {!isNew && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                    <p className="text-[10px] uppercase tracking-wider text-text-industrial/40 mb-1">{t("mp.taskCode")}</p>
                    {isAdmin
                      ? <input
                          value={taskCode}
                          onChange={e => setTaskCode(e.target.value.toUpperCase())}
                          className="w-full bg-transparent border-b border-white/20 focus:border-accent/60 outline-none text-sm font-mono font-bold text-white py-0.5 transition-colors"
                        />
                      : <p className="text-sm font-mono font-bold text-white">{plan.taskCode}</p>
                    }
                  </div>
                  <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                    <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t("col.vessel")}</p>
                    <p className="text-sm"><VesselLabel code={plan.vesselCode} className="text-sm" showCode /></p>
                  </div>
                </div>
                {/* Last / Next execution info */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                    <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t("mp.modal.lastExecution")}</p>
                    <p className="text-sm text-white font-mono">
                      {needsHours(plan.triggerType)
                        ? (plan.lastExecutionHours != null ? `${plan.lastExecutionHours.toLocaleString()}h` : "—")
                        : (fmtDate(plan.lastExecutionDate) ?? "—")}
                    </p>
                  </div>
                  <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                    <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t("mp.modal.nextDueDate")}</p>
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
                    ? <div className="flex items-center gap-2 text-xs text-text-industrial/40 py-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> {t("mp.modal.loadingAssets")}</div>
                    : <AssetSearchDropdown assets={assets} value={assetId} onChange={setAssetId} />
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
                      ? <div className="flex items-center gap-2 text-xs text-text-industrial/40 py-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> {t("common.loading")}</div>
                      : <select value={vesselCode} onChange={e => setVesselCode(e.target.value)} className={selectCls}>
                          <option value="">{t("mp.modal.selectVessel")}</option>
                          {vessels.map(v => <option key={v.code} value={v.code}>{v.code}{v.name ? ` — ${v.name}` : ""}</option>)}
                        </select>
                    }
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className={labelCls}>{t("mp.taskCode")}</label>
                      {taskCodeAuto && taskCode && <span className="text-[9px] text-accent/60 font-mono uppercase tracking-wider">{t("mp.modal.codeAuto")}</span>}
                    </div>
                    <div className="relative">
                      <input
                        value={loadingCode ? "" : taskCode}
                        onChange={e => { setTaskCode(e.target.value.toUpperCase()); setTaskCodeAuto(false); }}
                        placeholder={loadingCode ? t("mp.modal.codeGenerating") : t("mp.modal.codePlaceholder")}
                        className={`${inputCls} pr-8 ${taskCodeAuto && taskCode ? "text-accent/80 font-mono" : ""}`}
                      />
                      {loadingCode && <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-accent/50 animate-spin" />}
                      {!loadingCode && !taskCodeAuto && vesselCode && (
                        <button type="button" onClick={() => setTaskCodeAuto(true)} title={t("mp.modal.regenerateCode")}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-industrial/30 hover:text-accent transition-colors">↺</button>
                      )}
                    </div>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className={labelCls}>{t("mp.asset")}</label>
                  {loadingAssets
                    ? <div className="flex items-center gap-2 text-xs text-text-industrial/40 py-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> {t("mp.modal.loadingAssets")}</div>
                    : <AssetSearchDropdown
                        assets={assets}
                        value={assetId}
                        onChange={setAssetId}
                        disabled={!vesselCode || assets.length === 0}
                        placeholder={!vesselCode ? t("mp.modal.selectVesselFirst") : assets.length === 0 ? t("mp.modal.noAssetsForVessel") : t("mp.selectAsset")}
                      />
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
              <label className={labelCls}>{t("mp.modal.tasksToPerform")}</label>
              <RichTextArea value={description} onChange={setDescription} rows={3} className={inputCls} />
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

            {/* Horas estimadas para ejecutar la tarea */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <label className={labelCls}>{t("mp.estimatedHours")}</label>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={estimatedHours}
                  onChange={e => setEstimatedHours(e.target.value)}
                  placeholder="—"
                  className={inputCls}
                  disabled={readOnly}
                />
              </div>
            </div>

            {/* Ventana de ejecución anticipada */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className={labelCls}>{t("mp.modal.windowMode")}</label>
                <select value={windowMode} onChange={e => { setWindowMode(e.target.value); if (e.target.value === "AUTO") setWindowLeadDays(""); }} className={selectCls} disabled={readOnly}>
                  <option value="AUTO">{t("mp.modal.windowAuto")}</option>
                  <option value="MANUAL">{t("mp.modal.windowManual")}</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className={labelCls}>{t("mp.modal.leadDays")}</label>
                <input
                  type="number" min="0" value={windowLeadDays}
                  onChange={e => setWindowLeadDays(e.target.value)}
                  placeholder={windowMode === "AUTO" ? t("mp.modal.leadDaysAuto") : t("mp.modal.leadDaysManualPlaceholder")}
                  disabled={readOnly || windowMode === "AUTO"}
                  className={inputCls}
                />
                {windowMode === "AUTO" && (
                  <p className="text-[10px] text-text-industrial/40">{t("mp.modal.leadDaysHint")}</p>
                )}
              </div>
            </div>

            {/* Análisis de fluido — si está set, al cerrar la OT del plan se crea automáticamente una muestra DRAFT */}
            <div className="space-y-1.5">
              <label className={labelCls}>
                {t("mp.modal.fluidSampleLabel")} <span className="text-text-industrial/40 normal-case font-normal">{t("mp.modal.optional")}</span>
              </label>
              <select value={samplingFluidType} onChange={e => setSamplingFluidType(e.target.value)} className={selectCls} disabled={readOnly}>
                <option value="">{t("mp.modal.notFluidPlan")}</option>
                <option value="ENGINE_OIL">{t("fluid.plan.engineOil")}</option>
                <option value="HYDRAULIC_OIL">{t("fluid.plan.hydraulic")}</option>
                <option value="GEARBOX_OIL">{t("fluid.plan.gearbox")}</option>
                <option value="TRANSMISSION_OIL">{t("fluid.plan.transmission")}</option>
                <option value="FUEL_DIESEL">{t("fluid.plan.diesel")}</option>
                <option value="FUEL_GASOIL">{t("fluid.plan.gasoil")}</option>
                <option value="COOLING_WATER">{t("fluid.plan.coolingWater")}</option>
                <option value="BOILER_WATER">{t("fluid.plan.boilerWater")}</option>
                <option value="POTABLE_WATER">{t("fluid.plan.potableWater")}</option>
                <option value="REFRIGERANT">{t("fluid.plan.refrigerant")}</option>
                <option value="OTHER">{t("fluid.plan.other")}</option>
              </select>
              {samplingFluidType && (
                <p className="text-[10px] text-accent/70">{t("mp.modal.fluidSampleHint")}</p>
              )}
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
              <label
                onClick={readOnly ? undefined : handleAcceptanceCriteriaClick}
                title={readOnly ? undefined : t("mp.modal.aiCriteriaTooltip")}
                className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider transition-colors ${
                  readOnly
                    ? "text-text-industrial/60 cursor-default"
                    : `text-accent hover:text-white cursor-pointer ${loadingCriteria ? "opacity-60 animate-pulse" : ""}`
                }`}
              >
                {!readOnly && (loadingCriteria ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />)}
                {t("mp.acceptanceCriteria")}
              </label>
              <RichTextArea value={acceptanceCriteria} onChange={setAcceptanceCriteria} rows={2} className={inputCls} disabled={loadingCriteria} />
            </div>

            {/* LOTO */}
            <div className="space-y-1.5">
              <label
                onClick={readOnly ? undefined : handleLotoClick}
                title={readOnly ? undefined : t("wo.ai.lotoTooltip")}
                className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider transition-colors ${
                  readOnly
                    ? "text-text-industrial/60 cursor-default"
                    : `text-accent hover:text-white cursor-pointer ${loadingLoto ? "opacity-60 animate-pulse" : ""}`
                }`}
              >
                {!readOnly && (loadingLoto ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />)}
                {t("mp.loto")}
              </label>
              <RichTextArea value={loto} onChange={setLoto} rows={2} className={inputCls} disabled={loadingLoto} />
            </div>

            {/* Risk level */}
            <div className="space-y-1.5">
              <label
                onClick={readOnly ? undefined : handleRiskClick}
                title={readOnly ? undefined : t("mp.modal.aiRiskTooltip")}
                className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider transition-colors ${
                  readOnly
                    ? "text-text-industrial/60 cursor-default"
                    : `text-accent hover:text-white cursor-pointer ${loadingRisk ? "opacity-60 animate-pulse" : ""}`
                }`}
              >
                {!readOnly && (loadingRisk ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />)}
                {t("mp.riskLevel")}
                <span className="text-[10px] normal-case font-normal text-text-industrial/50 ml-1">{t("wo.modal.riskLevelHint")}</span>
              </label>
              <div className="flex items-center gap-1.5">
                {RISK_LEVEL_OPTS.map(([val, label, activeCls, inactiveLabelCls]) => (
                  <button key={val} type="button" disabled={readOnly || loadingRisk}
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
              <RichTextArea value={riskAnalysisResult} onChange={setRiskAnalysisResult} rows={2} className={inputCls} disabled={loadingRisk} />
            </div>

            {/* RCM consequence — "si esta tarea no se hace, ¿qué pasa?" */}
            <div className="space-y-1.5">
              <label
                onClick={readOnly ? undefined : handleConsequenceClick}
                title={readOnly ? undefined : t("wo.modal.consequenceTooltip")}
                className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider transition-colors ${
                  readOnly
                    ? "text-text-industrial/60 cursor-default"
                    : `text-accent hover:text-white cursor-pointer ${loadingConsequence ? "opacity-60 animate-pulse" : ""}`
                }`}
              >
                {!readOnly && (loadingConsequence ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />)}
                {t("wo.modal.consequenceTitle")}
                <span className="text-[10px] normal-case font-normal text-text-industrial/50 ml-1">{t("wo.modal.consequenceHint")}</span>
              </label>
              <select
                value={consequenceCategory}
                onChange={e => setConsequenceCategory(e.target.value as any)}
                disabled={readOnly || loadingConsequence}
                className={inputCls}
              >
                <option value="">{t("wo.modal.consequenceUnclassified")}</option>
                <option value="SAFETY">{t("wo.modal.consequence.safety")}</option>
                <option value="ENVIRONMENTAL">{t("wo.modal.consequence.environmental")}</option>
                <option value="OPERATIONAL">{t("wo.modal.consequence.operational")}</option>
                <option value="NON_OPERATIONAL">{t("wo.modal.consequence.nonOperational")}</option>
              </select>
              <RichTextArea
                value={consequenceRationale}
                onChange={setConsequenceRationale}
                rows={2}
                className={inputCls}
                disabled={readOnly || loadingConsequence}
              />
            </div>

            {/* Checklist upload — CHECKLIST mode only */}
            {triggerResultMode === "CHECKLIST" && (
              <div className="space-y-1.5">
                <label className={labelCls}>{t("mp.checklistTemplate")}</label>
                <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
                  {checklistTemplate && (checklistTemplate.startsWith("/uploads/") || checklistTemplate.startsWith("/app/files/")) ? (
                    <div className="flex items-center justify-between gap-3">
                      <button type="button"
                        onClick={() => { void downloadAuthedFile(checklistTemplate); }}
                        className="flex items-center gap-2 text-sm text-green-400 hover:text-green-300 truncate"
                        title="Descargar plantilla">
                        <ClipboardList className="w-4 h-4 shrink-0" />
                        <span className="truncate">{checklistTemplate.split("/").pop()}</span>
                      </button>
                      <button type="button" onClick={() => setChecklistTemplate("")} className="text-text-industrial/40 hover:text-red-400 transition-colors shrink-0"><X className="w-4 h-4" /></button>
                    </div>
                  ) : (
                    <p className="text-xs text-text-industrial/40">{t("mp.checklistNoFile")}</p>
                  )}
                  {isNew ? (
                    <p className="text-[10px] text-yellow-400/70">{t("mp.modal.checklistSaveFirst")}</p>
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
          <div className="flex justify-between gap-2 px-6 py-4 border-t border-white/10 bg-[#0D1B2A] shrink-0">
            <div className="flex gap-2">
              {/* Delete button — only ADMIN or FLEET_SUPERINTENDENT, existing plans only */}
              {!isNew && canDelete && (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="px-4 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 font-bold text-xs hover:bg-red-500/20 transition-all flex items-center gap-1.5"
                >
                  <Trash2 className="w-3.5 h-3.5" /> {t("mp.modal.delete")}
                </button>
              )}
              {canExecute && needsWO && !(plan.activeWorkOrderCode && plan.executionStatus === "IN_WINDOW") && (
                <button
                  onClick={() => plan.activeWorkOrderCode ? setConfirmDuplicateWO(true) : setShowExecution(true)}
                  className="px-4 py-2 rounded-xl bg-accent/10 border border-accent/20 text-accent font-bold text-xs hover:bg-accent/15 transition-all"
                >
                  <span className="flex items-center gap-1.5"><Zap className="w-3.5 h-3.5" /> {t("mp.modal.openWO")}</span>
                </button>
              )}
              {canExecute && !needsWO && (
                <button
                  onClick={() => setShowExecution(true)}
                  className="px-4 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-bold text-xs hover:bg-emerald-500/15 transition-all"
                >
                  {t("mp.modal.reportResult")}
                </button>
              )}
            </div>
            <div className="flex gap-2">
              {!isNew && (
                <button
                  onClick={downloadPdf}
                  className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-xs text-text-industrial hover:text-white hover:border-white/20 transition-all flex items-center gap-1.5"
                  title={t("mp.modal.pdfTooltip")}
                >
                  <FileText className="w-3.5 h-3.5" />
                  PDF
                </button>
              )}
              <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-white transition-colors">
                {readOnly ? t("mp.modal.close") : t("common.cancel")}
              </button>
              {!readOnly && (
                <button
                  onClick={() => {
                    // Interceptor: si cambió la periodicidad, mostramos el popup
                    // de MOC antes de guardar. El user decide guardar igual o
                    // abrir MOC primero.
                    if (planChangedFrequency) setShowMocPrompt(true);
                    else void onSave();
                  }}
                  disabled={saving}
                  className="px-4 py-2 rounded-xl font-bold text-xs disabled:opacity-50 transition-all flex items-center gap-1.5 bg-accent text-primary-bg hover:brightness-110"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : t("common.save")}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {confirmDuplicateWO && plan.activeWorkOrderCode && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-md bg-[#0D1B2A] border border-yellow-500/30 rounded-2xl shadow-2xl p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-yellow-500/15 border border-yellow-500/30 flex items-center justify-center shrink-0">
                <Zap className="w-4 h-4 text-yellow-400" />
              </div>
              <div>
                <p className="text-sm font-bold text-white">{t("mp.modal.duplicateWoTitle")}</p>
                <p className="text-xs text-text-industrial/70 mt-1">
                  {t("mp.modal.duplicateWoText")}{" "}
                  <span className="font-mono font-bold text-yellow-400">#{plan.activeWorkOrderCode}</span>.
                  <br />{t("mp.modal.duplicateWoConfirm")}
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setConfirmDuplicateWO(false)}
                className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-white transition-colors"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={() => { setConfirmDuplicateWO(false); setShowExecution(true); }}
                className="px-4 py-2 rounded-xl bg-yellow-500/15 border border-yellow-500/30 text-yellow-400 font-bold text-xs hover:bg-yellow-500/25 transition-all"
              >
                {t("mp.modal.openWoAnyway")}
              </button>
            </div>
          </div>
        </div>
      )}

      {!isNew && showExecution && needsWO && (
        <CreateWorkOrderModal
          prefill={{
            source: "plan",
            sourceId: plan.id,
            sourceCode: plan.taskCode,
            sourceLabel: t("mp.modal.maintenancePlanLabel"),
            vesselCode: plan.vesselCode,
            assetId: plan.assetId,
            assetName: plan.assetName,
            type: plan.taskType === "INSPECTION" ? "INSPECTION" : "PREVENTIVE",
            title: plan.title,
            description: description || plan.description,
            dueDate: plan.nextDueDate,
            acceptanceCriteria: acceptanceCriteria || plan.acceptanceCriteria,
            responsible: responsible || plan.responsible,
            loto: loto || plan.loto,
            riskLevel: riskLevel || plan.riskLevel,
            riskAnalysisResult: riskAnalysisResult || plan.riskAnalysisResult,
            consequenceCategory: (consequenceCategory as ("SAFETY" | "ENVIRONMENTAL" | "OPERATIONAL" | "NON_OPERATIONAL" | "")) || plan.consequenceCategory || null,
            consequenceRationale: consequenceRationale || plan.consequenceRationale,
            estimatedHours: estimatedHours ? Number(estimatedHours) : plan.estimatedHours,
            checklistDocUrl: plan.checklistTemplate,
            samplingFluidType: samplingFluidType || plan.samplingFluidType,
          }}
          onClose={() => setShowExecution(false)}
          onSaved={_woId => { setShowExecution(false); void onSaved(); }}
        />
      )}
      {!isNew && showExecution && !needsWO && (
        <ExecutionModal
          plan={plan}
          userName={userName}
          onClose={() => setShowExecution(false)}
          onSuccess={() => { setShowExecution(false); void onSaved(); }}
        />
      )}
      {!isNew && showPostpone && (
        <PostponeModal
          plan={plan}
          onClose={() => setShowPostpone(false)}
          onSuccess={() => { setShowPostpone(false); void onSaved(); }}
        />
      )}

      {/* Popup interceptor pre-save cuando se detecta cambio de frecuencia.
        * Aparece cuando el user toca "Guardar". Tres opciones:
        *   1. Cancelar — vuelve al form, no guarda nada
        *   2. Guardar sin MOC — procede al save normal (registra la decisión)
        *   3. Abrir MOC primero — abre el MocModal con prefill, el user
        *      después puede volver a guardar el plan */}
      {showMocPrompt && !isNew && plan !== null && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-xl bg-[#0D1B2A] border border-yellow-500/40 rounded-2xl p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <GitBranch className="w-5 h-5 text-yellow-300" />
              <h2 className="text-sm font-bold text-white">¿Gestionar MOC para este cambio?</h2>
            </div>
            <p className="text-sm text-text-industrial leading-relaxed">
              Estás modificando la <strong className="text-white">periodicidad</strong> del plan
              <strong className="text-white"> {plan.taskCode}</strong>. Cambiar el cronograma de un
              plan aprobado afecta el SMS del buque.
            </p>
            <p className="text-xs text-text-industrial/70 leading-relaxed">
              <strong>ISM 10.3 / TMSA element 7</strong> piden que este cambio se gestione mediante
              un <strong>MOC (PROCEDURE_CHANGE)</strong> formal — con análisis de riesgo, aprobación
              de Gerencia Técnica y revisión post-implementación.
            </p>
            <div className="rounded-lg bg-yellow-500/[0.08] border border-yellow-500/30 px-3 py-2 text-[11px] text-yellow-200/90 leading-relaxed">
              <strong>Recomendado</strong>: abrir el MOC primero, esperar la aprobación,
              y después guardar el cambio al plan. Así la trazabilidad queda limpia para auditoría.
            </div>
            <div className="flex justify-end gap-2 pt-1 flex-wrap">
              <button
                onClick={() => setShowMocPrompt(false)}
                className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-white"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  setShowMocPrompt(false);
                  void onSave();
                }}
                disabled={saving}
                className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-text-industrial text-xs hover:bg-white/10 disabled:opacity-50"
                title="Guarda el cambio sin abrir MOC. Asumí la responsabilidad del cambio sin trazabilidad formal."
              >
                Guardar sin MOC
              </button>
              <button
                onClick={() => {
                  setShowMocPrompt(false);
                  setShowMoc(true);
                }}
                className="px-4 py-2 rounded-xl bg-accent text-primary-bg font-bold text-xs hover:brightness-110 flex items-center gap-1.5"
              >
                <GitBranch className="w-3.5 h-3.5" /> Abrir MOC primero
              </button>
            </div>
          </div>
        </div>
      )}

      {showMoc && !isNew && plan !== null && (() => {
        // Resumimos qué cambió para que la IA / el user vean el delta.
        const oldFreq = plan.frequencyMonths != null
          ? `${plan.frequencyMonths} meses`
          : (plan.frequencyHours != null ? `${plan.frequencyHours} h` : "—");
        const newFreq = frequencyMonths
          ? `${frequencyMonths} meses`
          : (frequencyHours ? `${frequencyHours} h` : "—");
        const oldTrigger = plan.triggerType ?? "—";
        const newTrigger = triggerType ?? "—";
        const triggerChanged = oldTrigger !== newTrigger;
        const freqChanged = oldFreq !== newFreq;
        const prefill: MocPrefill = {
          category: "PROCEDURE_CHANGE",
          vesselCode: plan.vesselCode,
          title: `Cambio de periodicidad en plan ${plan.taskCode} — ${plan.title}`,
          reasonForChange: "Modificación del cronograma de mantenimiento aprobado. Justificar el motivo del cambio (recomendación del fabricante, observación de auditoría, ajuste por experiencia operativa, etc.).",
          proposedChange: [
            triggerChanged ? `Tipo de disparador: ${oldTrigger} → ${newTrigger}` : null,
            freqChanged    ? `Frecuencia: ${oldFreq} → ${newFreq}`              : null,
            `Plan afectado: ${plan.taskCode} (${plan.title})`,
            plan.assetName ? `Activo: ${plan.assetName}` : null,
          ].filter(Boolean).join("\n"),
          mitigationActions: "Comunicar el cambio a la tripulación. Programar primera ejecución con la nueva frecuencia. Revisar a los 6 meses si la nueva periodicidad es adecuada.",
          sourceLabel: `Desde Plan de mantenimiento ${plan.taskCode}. El MOC formaliza el cambio de cronograma para auditoría ISM 10.3 / TMSA. Recordá guardar el plan después de aprobar el MOC.`,
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

      {confirmDelete && !isNew && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-sm bg-[#0D1B2A] border border-red-500/30 rounded-2xl shadow-2xl p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-red-500/15 border border-red-500/30 flex items-center justify-center shrink-0">
                <Trash2 className="w-4 h-4 text-red-400" />
              </div>
              <div>
                <p className="text-sm font-bold text-white">{t("mp.modal.deleteTitle")}</p>
                <p className="text-xs text-text-industrial/70 mt-1">
                  {t("mp.modal.deleteText1")}{" "}
                  <span className="font-mono font-bold text-white">{plan.taskCode}</span> {t("mp.modal.deleteText2")}
                </p>
              </div>
            </div>
            {actionError && <p className="text-xs text-red-400">{actionError}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => setConfirmDelete(false)}
                className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-white transition-colors"
              >
                {t("common.cancel")}
              </button>
              <button
                disabled={deleting}
                onClick={async () => {
                  setDeleting(true);
                  setActionError(null);
                  try {
                    await api.delete(`/app/pms/maintenance-plans/${plan.id}`);
                    setConfirmDelete(false);
                    void onSaved();
                  } catch (err) {
                    setActionError(err instanceof Error ? err.message : t("mp.modal.deleteError"));
                    setDeleting(false);
                  }
                }}
                className="px-4 py-2 rounded-xl bg-red-600 text-white font-bold text-xs hover:brightness-110 disabled:opacity-50 transition-all flex items-center gap-1.5"
              >
                {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                {t("mp.modal.deleteConfirm")}
              </button>
            </div>
          </div>
        </div>
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
  const [searchText, setSearchText] = useState("");
  const [editing,       setEditing]       = useState<MaintenancePlan | null>(null);
  const [showModal,     setShowModal]     = useState(false);

  useCopilotEmitter(!editing && !showModal ? { module: "MAINTENANCE_PLANS", screen: "MP_LIST" } : null);
  const { setRequestMessage: setRequestMessageFromContext } = useCopilotScreenContext();
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
  // Reuse VesselContext (already loaded for the header selector) to avoid a duplicate /app/vessels fetch.
  const { vessels } = useVesselContext();
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
    if (searchText.trim()) {
      const q = searchText.trim().toLowerCase();
      items = items.filter(p =>
        (p.vesselCode ?? "").toLowerCase().includes(q) ||
        (p.taskCode ?? "").toLowerCase().includes(q) ||
        (p.title ?? "").toLowerCase().includes(q) ||
        (p.description ?? "").toLowerCase().includes(q) ||
        (p.responsible ?? "").toLowerCase().includes(q) ||
        String(p.sfiGroupNumber ?? "").includes(q) ||
        (p.sfiSubgroupCode ?? "").toLowerCase().includes(q) ||
        (p.assetName ?? "").toLowerCase().includes(q)
      );
    }
    return { items, total: items.length };
  }, [rawData, sfiTab, overdueOnly, searchText]);

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
    return rawData.items.filter(p => {
      const s = computeStatus(p);
      return s === "OVERDUE" || s === "DUE" || s === "IN_WINDOW";
    }).length;
  }, [rawData]);

  const openEdit = async (row: Pick<MaintenancePlan, "id">) => {
    setLoadingDetailId(row.id);
    setPageError(null);
    try {
      const detail = await api.get<MaintenancePlan>(`/app/pms/maintenance-plans/${row.id}`);
      setEditing(detail);
      setShowModal(true);
    } catch (err) {
      setPageError(err instanceof ApiError ? err.message : t("mp.page.detailLoadError"));
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
      header: t("mp.col.vesselTaskSfi"),
      sortValue: row => `${row.vesselCode} ${row.taskCode}`,
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
      header: t("mp.col.equipmentTask"),
      className: "w-96",
      sortValue: row => (row as MaintenancePlan & { assetName?: string | null }).assetName ?? row.title,
      render: row => (
        <div className="flex flex-col gap-0.5">
          <span className="text-[12px] font-bold text-white leading-tight line-clamp-1">
            {(row as MaintenancePlan & { assetName?: string | null }).assetName ?? row.assetId}
          </span>
          <span className="text-[11px] text-text-industrial/60 leading-tight line-clamp-2">{row.title}</span>
        </div>
      ),
    },
    // ── Col 4: FRECUENCIA ───────────────────────────────────────────────────
    {
      key: "frequency",
      header: t("mp.col.frequency"),
      sortValue: row => row.frequencyMonths ?? row.frequencyHours ?? 0,
      render: row => (
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-xs text-text-industrial/80 whitespace-nowrap">{formatFrequency(row)}</span>
          {row.estimatedHours != null && (
            <span className="font-mono text-[10px] text-accent/70 whitespace-nowrap">
              {t("mp.col.estimatedShort")}: {row.estimatedHours} hs
            </span>
          )}
          {needsHours(row.triggerType) && (
            <span className="font-mono text-[10px] text-text-industrial/45 whitespace-nowrap">
              {t("mp.col.accumulated")}: {row.assetCurrentHours != null ? `${row.assetCurrentHours.toLocaleString()} hs` : "—"}
            </span>
          )}
        </div>
      ),
    },
    // ── Col 5: ÚLTIMA EJECUCIÓN ─────────────────────────────────────────────
    {
      key: "lastExecutionDate",
      header: t("mp.col.lastExecution"),
      sortValue: row => row.lastExecutionDate ?? row.lastExecutionHours ?? null,
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
      header: t("mp.col.nextDue"),
      sortValue: row => row.nextDueDate ?? row.nextDueHours ?? null,
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
      header: t("mp.col.status"),
      sortValue: row => computeStatus(row),
      render: row => <StatusBadgeInline plan={row} onClickWo={row.activeWorkOrderCode ? () => navigate(`/work-orders?autoCode=${row.activeWorkOrderCode}`) : undefined} />,
    },
    // ── Col 8: ACCIONES ─────────────────────────────────────────────────────
    {
      key: "taskCode" as keyof MaintenancePlan,
      header: t("mp.col.actions"),
      sortable: false,
      render: row => {
        if (row.status === "INACTIVE" || row.status === "DRAFT") return null;
        const needsWO = row.triggerResultMode === "AUTO_WO" || row.triggerResultMode === "APPROVAL_WO";
        const hasActiveWo = !!row.activeWorkOrderCode && row.executionStatus === "IN_WINDOW";
        return needsWO ? (
          !hasActiveWo ? (
          <button
            onClick={async e => {
              e.stopPropagation();
              // El listado omite acceptanceCriteria, loto, riskAnalysisResult,
              // consequenceRationale y checklistTemplate para reducir payload.
              // Hay que traer el plan completo para que el modal de OT herede
              // esos campos correctamente.
              try {
                const full = await api.get<MaintenancePlan>(`/app/pms/maintenance-plans/${row.id}`);
                setExecuting(full);
              } catch {
                setExecuting(row);
              }
            }}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-accent/30 bg-accent/10 text-accent text-[11px] font-bold hover:bg-accent/20 hover:border-accent/50 transition-all whitespace-nowrap"
          >
            <Zap className="w-3 h-3" /> {t("mp.col.executeWO")}
          </button>
          ) : null
        ) : (
          <button
            onClick={e => { e.stopPropagation(); setReporting(row); }}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-[11px] font-bold hover:bg-emerald-500/20 hover:border-emerald-500/50 transition-all whitespace-nowrap"
          >
            <CheckCircle2 className="w-3 h-3" /> {t("mp.col.report")}
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
          <Plus className="w-3.5 h-3.5" /> {t("mp.page.newTask")}
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
          {t("mp.page.overdueToggle")}
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
            overdueOnly ? "bg-orange-500/30 text-orange-200" : "bg-white/10 text-text-industrial/50"
          }`}>{urgentCount}</span>
        </button>
        {/* Buscador global */}
        <div className="flex items-center gap-1.5 bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5">
          <Search className="w-3 h-3 text-text-industrial/40 shrink-0" />
          <input
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            placeholder={t("mp.page.searchPlaceholder")}
            className="w-56 bg-transparent text-xs text-text-industrial placeholder-text-industrial/30 focus:outline-none"
          />
          {searchText && (
            <button onClick={() => setSearchText("")} className="text-text-industrial/40 hover:text-white transition-colors">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        {/* Filtro por buque: usa el selector global del header (VesselContext).
            Filtro por estado: removido — ACTIVE es el caso 99% del tiempo. */}
        {(overdueOnly || searchText) && (
          <button
            onClick={() => {
              setOverdueOnly(false);
              setSfiTextFilter("");
              setSfiTab("ALL");
              setSearchText("");
            }}
            className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-text-industrial/80 hover:text-white hover:border-red-400/40 transition-all"
          >
            {t("common.clear")}
          </button>
        )}
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
              {tab.key === "ALL" ? t("mp.sfiTab.all") : tab.label}
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
          <Loader2 className="w-4 h-4 animate-spin text-accent" /> {t("mp.page.loadingDetail")}
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
            sourceLabel: t("mp.modal.maintenancePlanLabel"),
            vesselCode: executing.vesselCode,
            assetId: executing.assetId,
            assetName: executing.assetName,
            type: executing.taskType === "INSPECTION" ? "INSPECTION" : "PREVENTIVE",
            title: executing.title,
            description: executing.description,
            dueDate: executing.nextDueDate,
            acceptanceCriteria: executing.acceptanceCriteria,
            responsible: executing.responsible,
            loto: executing.loto,
            riskLevel: executing.riskLevel,
            riskAnalysisResult: executing.riskAnalysisResult,
            consequenceCategory: executing.consequenceCategory,
            consequenceRationale: executing.consequenceRationale,
            estimatedHours: executing.estimatedHours,
            checklistDocUrl: executing.checklistTemplate,
            samplingFluidType: executing.samplingFluidType,
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
          canDelete={user?.role === "TENANT_ADMIN" || user?.role === "FLEET_SUPERINTENDENT"}
          setRequestMessage={setRequestMessageFromContext}
          onClose={() => { setShowModal(false); setEditing(null); }}
          onSaved={async (savedId) => {
            void reload();
            if (savedId) {
              try {
                const detail = await api.get<MaintenancePlan>(`/app/pms/maintenance-plans/${savedId}`);
                setEditing(detail);
              } catch { /* silent, plan stays open */ }
            }
          }}
        />
      )}
    </div>
  );
};
