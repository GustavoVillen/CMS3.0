import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { AlertTriangle, CheckCheck, ExternalLink, FileSpreadsheet, FileText, Loader2, Maximize2, Minimize2, Plus, Wrench, X } from "lucide-react";
import { useFetch } from "../lib/hooks";
import { api, ApiError } from "../lib/api";
import { DataTable, StatusBadge, type Column } from "../components/DataTable";
import { FILTER_ALL_VALUE, fmtDate, fromFilterSelectValue, parseLocalDate, toFilterSelectValue } from "../lib/utils";
import { PageHeader } from "../components/PageHeader";
import { ExcelPanel } from "../components/ExcelPanel";
import { CreateWorkOrderModal } from "../components/CreateWorkOrderModal";
import { useT } from "../lib/i18n";
import { useAuth } from "../lib/auth";
import { printWorkOrder } from "../lib/print-work-order";
import { useCopilotEmitter, useCopilotApplyFields } from "../lib/copilot-context";
import { useEscapeGuard, useDirtyTracker } from "../lib/escape-guard";

// ── Types ─────────────────────────────────────────────────────────────────────

interface WorkOrder {
  id: string;
  tenantId: string;
  vesselCode: string;
  assetId: string;
  maintenancePlanId: string | null;
  workOrderCode: string;
  type: string;
  status: string;
  priority: string;
  criticality: string;
  openDate: string;
  startDate: string | null;
  dueDate: string | null;
  completedDate: string | null;
  holdReason: string | null;
  cancelReason: string | null;
  closeNotes: string | null;
  independentVerifier: string | null;
  testResult: string | null;
  title: string | null;
  description: string | null;
  assignedToUserId: string | null;
  assignedToUserName: string | null;
  assetName: string | null;
  estimatedHours: number | null;
  // Plan fields
  acceptanceCriteria: string | null;
  loto: string | null;
  riskLevel: string | null;
  riskAnalysisResult: string | null;
  checklistDocUrl: string | null;
  // Result fields
  woResult: string | null;
  executedByName: string | null;
  observations: string | null;
  supportingDocUrl: string | null;
  createdAt: string;
  // Mercurio form fields
  department: "CUBIERTA" | "MAQUINAS" | "BARCAZA" | "SERVICIOS" | null;
  location: string | null;
  communicationMethod: string[];
  distribution: string[];
}


interface ListResponse { items: WorkOrder[]; total: number; }
type ActionType = "hold" | "close" | "cancel";
interface ActionTarget { workOrder: WorkOrder; type: ActionType; }

// ── Helpers ───────────────────────────────────────────────────────────────────

function toDateInputValue(value: string | null | undefined): string {
  if (!value) return "";
  return value.includes("T") ? value.slice(0, 10) : value;
}
function normalizeOptionalText(value: string): string | null {
  const text = value.trim();
  return text || null;
}
function canEditStatus(status: string): boolean {
  return status === "PLANNED" || status === "IN_PROGRESS" || status === "ON_HOLD";
}

const inputCls = "w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 disabled:opacity-60";
const labelCls = "block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider";
const sectionLabelCls = "block font-semibold uppercase tracking-wider px-2 py-1 rounded-sm";
const sectionLabelStyle: React.CSSProperties = { backgroundColor: "#0f172a", color: "white", fontSize: "1.2rem" };

// ── CategoryBadge ─────────────────────────────────────────────────────────────

function CategoryBadge({ type }: { type: string }) {
  if (type === "INSPECTION")
    return <span className="inline-block text-[10px] px-2 py-0.5 rounded-full border font-bold bg-teal-500/10 text-teal-400 border-teal-500/20">Inspección</span>;
  if (type === "CORRECTIVE")
    return <span className="inline-block text-[10px] px-2 py-0.5 rounded-full border font-bold bg-orange-500/10 text-orange-400 border-orange-500/20">Reparación</span>;
  return <span className="inline-block text-[10px] px-2 py-0.5 rounded-full border font-bold bg-blue-500/10 text-blue-400 border-blue-500/20">Mantenimiento</span>;
}

// ── WoStatusBadge ─────────────────────────────────────────────────────────────

function WoStatusBadge({ status, dueDate }: { status: string; dueDate: string | null }) {
  const isClosed = status === "CLOSED" || status === "CANCELLED";
  const isOpen   = !isClosed;
  const isOverdue = isOpen && !!dueDate && parseLocalDate(dueDate) < new Date();
  if (isClosed)          return <span className="inline-block text-[10px] px-2 py-0.5 rounded-full border font-bold bg-white/5 text-text-industrial/50 border-white/10">Cerrada</span>;
  if (status === "ON_HOLD") return <span className="inline-block text-[10px] px-2 py-0.5 rounded-full border font-bold bg-yellow-500/10 text-yellow-400 border-yellow-500/20">Postergada</span>;
  if (isOverdue)         return <span className="inline-block text-[10px] px-2 py-0.5 rounded-full border font-bold bg-red-500/10 text-red-400 border-red-500/20">Vencida</span>;
  return <span className="inline-block text-[10px] px-2 py-0.5 rounded-full border font-bold bg-green-500/10 text-green-400 border-green-500/20">Abierta</span>;
}

// ── HoldModal ─────────────────────────────────────────────────────────────────

const HoldModal: React.FC<{ workOrder: WorkOrder; onClose: () => void; onSuccess: () => void }> = ({ workOrder, onClose, onSuccess }) => {
  const t = useT();
  const [holdReason, setHoldReason] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onSave = useCallback(async () => {
    if (!holdReason.trim()) { setErr(t("wo.holdReason")); return; }
    setSaving(true); setErr(null);
    try {
      await api.post(`/app/pms/work-orders/${workOrder.id}/hold`, {
        holdReason: holdReason.trim(),
        targetDate: targetDate || null,
      });
      onSuccess();
    }
    catch (e) { setErr(e instanceof ApiError ? e.message : t("common.saveError")); }
    finally { setSaving(false); }
  }, [holdReason, targetDate, onSuccess, t, workOrder.id]);

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md bg-[#0D1B2A] border border-white/10 rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <h2 className="text-sm font-bold text-white">{t("wo.hold")}</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-text-industrial/40 hover:text-white" /></button>
        </div>
        <div className="p-6 space-y-3">
          <label className={labelCls}>{t("wo.holdReason")}</label>
          <textarea rows={4} value={holdReason} onChange={e => setHoldReason(e.target.value)} className={inputCls} />
          <label className={labelCls}>Fecha estimada de reanudación</label>
          <input type="date" value={targetDate} onChange={e => setTargetDate(e.target.value)} className={inputCls} />
          {err && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{err}</p>}
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-white/10">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-white">{t("common.cancel")}</button>
          <button onClick={() => { void onSave(); }} disabled={saving} className="px-4 py-2 rounded-xl bg-accent text-primary-bg font-bold text-xs hover:brightness-110 disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── CancelModal ───────────────────────────────────────────────────────────────

const CancelModal: React.FC<{ workOrder: WorkOrder; onClose: () => void; onSuccess: () => void }> = ({ workOrder, onClose, onSuccess }) => {
  const t = useT();
  const [cancelReason, setCancelReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onSave = useCallback(async () => {
    if (!cancelReason.trim()) { setErr(t("wo.cancelReason")); return; }
    setSaving(true); setErr(null);
    try { await api.post(`/app/pms/work-orders/${workOrder.id}/cancel`, { cancelReason: cancelReason.trim() }); onSuccess(); }
    catch (e) { setErr(e instanceof ApiError ? e.message : t("common.saveError")); }
    finally { setSaving(false); }
  }, [cancelReason, onSuccess, t, workOrder.id]);

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md bg-[#0D1B2A] border border-white/10 rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <h2 className="text-sm font-bold text-white">{t("wo.cancel")}</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-text-industrial/40 hover:text-white" /></button>
        </div>
        <div className="p-6 space-y-3">
          <label className={labelCls}>{t("wo.cancelReason")}</label>
          <textarea rows={4} value={cancelReason} onChange={e => setCancelReason(e.target.value)} className={inputCls} />
          {err && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{err}</p>}
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-white/10">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-white">{t("common.cancel")}</button>
          <button onClick={() => { void onSave(); }} disabled={saving} className="px-4 py-2 rounded-xl bg-accent text-primary-bg font-bold text-xs hover:brightness-110 disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── AddWorkLogModal (unused — kept for future reference) ─────────────────────

// ── CritBadge ─────────────────────────────────────────────────────────────────

function CritBadge({ crit }: { crit: string }) {
  const cls =
    crit === "A" ? "bg-red-500/10 text-red-400 border-red-500/20"
    : crit === "B" ? "bg-yellow-500/10 text-yellow-400 border-yellow-500/20"
    : "bg-white/5 text-white/40 border-white/10";
  return (
    <span className={`inline-flex items-center justify-center w-4 h-4 rounded text-[9px] font-bold border shrink-0 ${cls}`}>
      {crit || "?"}
    </span>
  );
}

// ── WorkOrderModal ────────────────────────────────────────────────────────────

interface WorkOrderModalProps {
  workOrder: WorkOrder;
  canManage: boolean;
  onClose: () => void;
  onSaved: () => void;
  onOpenAction: (wo: WorkOrder, type: ActionType) => void;
}

const WorkOrderModal: React.FC<WorkOrderModalProps> = ({ workOrder, canManage, onClose, onSaved, onOpenAction }) => {
  const t = useT();
  const navigate = useNavigate();
  const isEditable = canEditStatus(workOrder.status);

  // Linked deferral status (when WO is ON_HOLD)
  const [deferralStatus, setDeferralStatus] = useState<string | null>(null);
  const [deferralTargetDate, setDeferralTargetDate] = useState<string | null>(null);
  useEffect(() => {
    if (workOrder.status !== "ON_HOLD") { setDeferralStatus(null); setDeferralTargetDate(null); return; }
    let cancelled = false;
    api.get<{ items: { status: string; requestedAt: string; targetDate: string | null }[] }>(`/app/pms/deferrals?sourceId=${encodeURIComponent(workOrder.id)}`)
      .then(r => {
        if (cancelled) return;
        const items = (r.items ?? []).slice().sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime());
        setDeferralStatus(items[0]?.status ?? null);
        setDeferralTargetDate(items[0]?.targetDate ?? null);
      })
      .catch(() => { if (!cancelled) { setDeferralStatus(null); setDeferralTargetDate(null); } });
    return () => { cancelled = true; };
  }, [workOrder.id, workOrder.status]);

  // ── Mercurio form fields ──
  const [department, setDepartment]         = useState<string>(workOrder.department ?? "");
  const [location, setLocation]             = useState(workOrder.location ?? "");
  const [commMethod, setCommMethod]         = useState<string[]>(workOrder.communicationMethod ?? []);
  const [distribution, setDistribution]     = useState<string[]>(workOrder.distribution ?? []);

  function toggleArr(arr: string[], set: (v: string[]) => void, val: string) {
    set(arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val]);
  }

  // ── Plan fields ──
  const [title, setTitle]                   = useState(workOrder.title ?? "");
  const [description, setDescription]       = useState(workOrder.description ?? "");
  const [assignedTo, setAssignedTo]         = useState(workOrder.assignedToUserName ?? workOrder.assignedToUserId ?? "");
  const [dueDate, setDueDate]               = useState(toDateInputValue(workOrder.dueDate));
  const [acceptanceCriteria, setAcceptanceCriteria] = useState(workOrder.acceptanceCriteria ?? "");
  const [loto, setLoto]                     = useState(workOrder.loto ?? "");
  const [riskLevel, setRiskLevel]           = useState(workOrder.riskLevel ?? "");
  const [riskAnalysisResult, setRiskAnalysisResult] = useState(workOrder.riskAnalysisResult ?? "");
  const [checklistDocFile, setChecklistDocFile] = useState<File | null>(null);
  const [checklistDocUrl] = useState(workOrder.checklistDocUrl ?? "");

  // ── Result fields ──
  const [woResult, setWoResult]             = useState(workOrder.woResult ?? "");
  const [executedByName, setExecutedByName] = useState(workOrder.executedByName ?? "");
  const [executionDate, setExecutionDate]   = useState(toDateInputValue(workOrder.completedDate));
  const [runningHoursAtExecution, setRunningHoursAtExecution] = useState(
    (workOrder as any).runningHoursAtExecution != null ? String((workOrder as any).runningHoursAtExecution) : ""
  );
  const [observations, setObservations]     = useState(workOrder.observations ?? workOrder.closeNotes ?? "");
  const [deficienciasText, setDeficienciasText] = useState("");
  const [supportingDocFile, setSupportingDocFile] = useState<File | null>(null);
  const [supportingDocUrl] = useState(workOrder.supportingDocUrl ?? "");

  // ── Spare usages ──
  interface SpareUsage { spareId: string; spareName: string; unit: string; qty: number; criticality: string; available: number; }
  const initialSpareUsages: SpareUsage[] = ((workOrder as any).spareUsages ?? []).map((u: any) => ({
    spareId: u.spareId,
    spareName: `${u.sku ?? ""}${u.sku && u.name ? " — " : ""}${u.name ?? u.spareId}`,
    unit: u.unit ?? "",
    qty: Number(u.qty) || 0,
    criticality: u.criticality ?? "C",
    available: 0, // populated below from sparesData when it loads
  }));
  const [spareUsages,    setSpareUsages]    = useState<SpareUsage[]>(initialSpareUsages);
  const [addingUsage,    setAddingUsage]    = useState(false);
  const [usageSpareId,   setUsageSpareId]   = useState("");
  const [usageQty,       setUsageQty]       = useState("1");
  const [usageSearch,    setUsageSearch]    = useState("");
  const [usageDropdown,  setUsageDropdown]  = useState(false);
  const [closingWarning, setClosingWarning] = useState<string | null>(null);

  const { data: sparesData } = useFetch<{ items: Array<{ id: string; sku: string; name: string; unit: string; criticality: string; onHand: number; available: number }> }>(
    workOrder.vesselCode ? `/app/pms/spares?vesselCode=${workOrder.vesselCode}&status=ACTIVE` : null,
  );
  const woSpares = sparesData?.items ?? [];

  // Hydrate `available` on existing spareUsages once the spares catalog loads
  useEffect(() => {
    if (woSpares.length === 0) return;
    setSpareUsages(prev => prev.map(u => {
      const s = woSpares.find(x => x.id === u.spareId);
      return s ? { ...u, available: s.available, unit: u.unit || s.unit } : u;
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sparesData]);

  const addUsage = () => {
    const spare = woSpares.find(s => s.id === usageSpareId);
    if (!spare) return;
    const qty = parseFloat(usageQty);
    if (!qty || qty <= 0) return;
    setSpareUsages(prev => [...prev, {
      spareId: spare.id,
      spareName: `${spare.sku} — ${spare.name}`,
      unit: spare.unit,
      qty,
      criticality: spare.criticality,
      available: spare.available,
    }]);
    setUsageSpareId(""); setUsageQty("1"); setUsageSearch(""); setAddingUsage(false);
  };

  const removeUsage = (idx: number) => setSpareUsages(prev => prev.filter((_, i) => i !== idx));

  // ── Defect registration prompt ──
  type DefectPrompt = "idle" | "ask" | "creating" | "created" | "declined";
  const [defectPrompt, setDefectPrompt] = useState<DefectPrompt>("idle");
  const [createdDefectCode, setCreatedDefectCode] = useState<string | null>(null);

  const handleWoResultChange = (val: string) => {
    const next = woResult === val ? "" : val;
    setWoResult(next);
    if (next === "WITH_DEFICIENCIES") setDefectPrompt("ask");
    else { setDefectPrompt("idle"); setCreatedDefectCode(null); }
  };

  const openDefectRecord = useCallback(async () => {
    setDefectPrompt("creating");
    try {
      const body = {
        vesselCode: workOrder.vesselCode,
        assetId: workOrder.assetId,
        workOrderId: workOrder.id,
        classification: "WORK_ORDER_FINDING",
        severity: "MEDIUM",
        description: deficienciasText.trim() || observations.trim() || `Deficiencias encontradas en OT ${workOrder.workOrderCode}`,
      };
      const res = await api.post<{ id: string; defectCode: string }>("/app/pms/defects", body);
      setCreatedDefectCode(res.defectCode ?? null);
      setDefectPrompt("created");
      navigate(`/defects?defectId=${res.id}`);
    } catch { setDefectPrompt("ask"); }
  }, [deficienciasText, observations, workOrder, navigate]);

  const [saving,          setSaving]         = useState(false);
  const [closing,         setClosing]        = useState(false);
  const [err,             setErr]            = useState<string | null>(null);
  const [expanded,        setExpanded]       = useState(true);
  const [loadingCriteria, setLoadingCriteria] = useState(false);
  const [loadingLoto,     setLoadingLoto]    = useState(false);
  const [loadingRisk,     setLoadingRisk]    = useState(false);

  useCopilotEmitter({
    module: "WORK_ORDERS",
    screen: "WO_EDIT",
    entityId: workOrder.id,
    entityCode: workOrder.workOrderCode,
    vesselCode: workOrder.vesselCode,
    workflowStage: workOrder.status,
    canEdit: isEditable,
    fieldValues: {
      title:              title              || null,
      description:        description        || null,
      acceptanceCriteria: acceptanceCriteria || null,
      loto:               loto               || null,
      riskLevel:          riskLevel          || null,
      riskAnalysisResult: riskAnalysisResult || null,
    },
  });

  useCopilotApplyFields(isEditable ? (fields) => {
    if (fields.title              !== undefined) setTitle(fields.title);
    if (fields.description        !== undefined) setDescription(fields.description);
    if (fields.acceptanceCriteria !== undefined) setAcceptanceCriteria(fields.acceptanceCriteria);
    if (fields.loto               !== undefined) setLoto(fields.loto);
    if (fields.riskAnalysisResult !== undefined) setRiskAnalysisResult(fields.riskAnalysisResult);
    if (fields.riskLevel          !== undefined && ["LOW","MEDIUM","HIGH","CRITICAL"].includes(fields.riskLevel))
      setRiskLevel(fields.riskLevel);
  } : null);

  const handleAcceptanceCriteriaClick = useCallback(async () => {
    if (!isEditable || loadingCriteria) return;
    setLoadingCriteria(true);
    setAcceptanceCriteria("Analizando...");
    try {
      const res = await api.post<{ text: string }>("/app/pms/work-orders/suggest-acceptance-criteria", {
        assetLabel: workOrder.assetName ?? null,
        taskDesc: description || title || null,
      });
      setAcceptanceCriteria(res.text || "");
    } catch { setAcceptanceCriteria(""); }
    finally { setLoadingCriteria(false); }
  }, [isEditable, loadingCriteria, workOrder.assetName, description, title]);

  const handleLotoClick = useCallback(async () => {
    if (!isEditable || loadingLoto) return;
    setLoadingLoto(true);
    setLoto("Analizando...");
    try {
      const res = await api.post<{ text: string }>("/app/pms/work-orders/suggest-loto", {
        assetLabel: workOrder.assetName ?? null,
        taskDesc: description || title || null,
        acceptanceCriteria: acceptanceCriteria || null,
      });
      setLoto(res.text || "");
    } catch { setLoto(""); }
    finally { setLoadingLoto(false); }
  }, [isEditable, loadingLoto, workOrder.assetName, description, title, acceptanceCriteria]);

  const handleRiskClick = useCallback(async () => {
    if (!isEditable || loadingRisk) return;
    setLoadingRisk(true);
    try {
      const res = await api.post<{ level: string; analysis: string }>("/app/pms/work-orders/suggest-risk", {
        assetLabel: workOrder.assetName ?? null,
        taskDesc: description || title || null,
        acceptanceCriteria: acceptanceCriteria || null,
        loto: loto || null,
      });
      if (res.level && ["LOW","MEDIUM","HIGH","CRITICAL"].includes(res.level)) setRiskLevel(res.level);
      if (res.analysis) setRiskAnalysisResult(res.analysis);
    } catch { /* noop */ }
    finally { setLoadingRisk(false); }
  }, [isEditable, loadingRisk, workOrder.assetName, description, title, acceptanceCriteria, loto]);

  const uploadIfNeeded = useCallback(async (file: File | null, currentUrl: string) => {
    if (!file) return currentUrl || null;
    const res = await api.upload<{ url: string }>(`/app/attachments/upload?entityType=WorkOrder&entityId=${workOrder.id}`, file);
    return res.url ?? null;
  }, [workOrder.id]);

  const [generatingPdf, setGeneratingPdf] = useState(false);
  const handleGeneratePdf = useCallback(async () => {
    setGeneratingPdf(true);
    try {
      // Persist current edits (only when the WO is editable) before downloading the PDF
      if (isEditable) {
        try {
          await api.patch(`/app/pms/work-orders/${workOrder.id}`, {
            title: normalizeOptionalText(title),
            description: normalizeOptionalText(description),
            assignedToUserId: normalizeOptionalText(assignedTo),
            dueDate: dueDate || null,
            acceptanceCriteria: normalizeOptionalText(acceptanceCriteria),
            loto,
            riskLevel: normalizeOptionalText(riskLevel),
            riskAnalysisResult: normalizeOptionalText(riskAnalysisResult),
          });
        } catch { /* non-blocking — still try to print */ }
      }
      await printWorkOrder(workOrder);
    } finally {
      setGeneratingPdf(false);
    }
  }, [isEditable, workOrder, title, description, assignedTo, dueDate, acceptanceCriteria, loto, riskLevel, riskAnalysisResult]);

  const onSave = useCallback(async () => {
    setSaving(true); setErr(null);
    try {
      const [chkUrl, supUrl] = await Promise.all([
        uploadIfNeeded(checklistDocFile, checklistDocUrl),
        uploadIfNeeded(supportingDocFile, supportingDocUrl),
      ]);
      await api.patch(`/app/pms/work-orders/${workOrder.id}`, {
        title: normalizeOptionalText(title),
        description: normalizeOptionalText(description),
        assignedToUserId: normalizeOptionalText(assignedTo),
        dueDate: dueDate || null,
        acceptanceCriteria: normalizeOptionalText(acceptanceCriteria),
        loto,
        riskLevel: normalizeOptionalText(riskLevel),
        riskAnalysisResult: normalizeOptionalText(riskAnalysisResult),
        department: (department as any) || null,
        location: normalizeOptionalText(location),
        communicationMethod: commMethod,
        distribution,
        checklistDocUrl: chkUrl,
        woResult: normalizeOptionalText(woResult),
        executedByName: normalizeOptionalText(executedByName),
        completedDate: executionDate || null,
        runningHoursAtExecution: runningHoursAtExecution ? Number(runningHoursAtExecution) : null,
        observations: normalizeOptionalText(observations),
        supportingDocUrl: supUrl,
        spareUsages: spareUsages.map(u => ({ spareId: u.spareId, qty: u.qty, unit: u.unit })),
      });
      onSaved();
    } catch (e) { setErr(e instanceof ApiError ? e.message : t("common.saveError")); }
    finally { setSaving(false); }
  }, [title, description, assignedTo, dueDate, acceptanceCriteria, loto, riskLevel, riskAnalysisResult,
      department, location, commMethod, distribution,
      checklistDocFile, checklistDocUrl, supportingDocFile, supportingDocUrl,
      woResult, executedByName, executionDate, runningHoursAtExecution, observations,
      spareUsages, uploadIfNeeded, onSaved, t, workOrder.id]);

  // ESC guard
  const isDirty = useDirtyTracker({
    title, description, assignedTo, dueDate, acceptanceCriteria, loto, riskLevel, riskAnalysisResult,
    department, location, commMethod, distribution,
    checklistDocFileName: checklistDocFile?.name ?? "",
    woResult, executedByName, executionDate, runningHoursAtExecution, observations,
    supportingDocFileName: supportingDocFile?.name ?? "",
  });
  const woClosedReadOnly = workOrder.status === "CLOSED" || workOrder.status === "CANCELLED";
  useEscapeGuard({
    enabled: !woClosedReadOnly,
    isDirty,
    onSave,
    onClose,
  });

  const onClose_WO = useCallback(async () => {
    if (!woResult) { setErr("El resultado de la OT es requerido para cerrar."); return; }
    setClosing(true); setErr(null);
    try {
      const supUrl = await uploadIfNeeded(supportingDocFile, supportingDocUrl);
      const res = await api.post<{ id: string; failedMovements?: string[] }>(`/app/pms/work-orders/${workOrder.id}/close`, {
        woResult,
        executedByName: normalizeOptionalText(executedByName),
        completedDate: executionDate || null,
        observations: normalizeOptionalText(observations),
        supportingDocUrl: supUrl,
        runningHoursAtExecution: runningHoursAtExecution ? Number(runningHoursAtExecution) : null,
        spareUsages: spareUsages.map(u => ({ spareId: u.spareId, qty: u.qty, unit: u.unit })),
      });
      if (res.failedMovements && res.failedMovements.length > 0) {
        setClosingWarning(`OT cerrada. No se pudo registrar el movimiento de stock para ${res.failedMovements.length} repuesto(s). Verifique el stock manualmente.`);
      } else {
        onSaved();
      }
    } catch (e) { setErr(e instanceof ApiError ? e.message : t("common.saveError")); }
    finally { setClosing(false); }
  }, [woResult, executedByName, executionDate, observations, supportingDocFile, supportingDocUrl,
      spareUsages, uploadIfNeeded, onSaved, t, workOrder.id]);

  const isClosed = workOrder.status === "CLOSED" || workOrder.status === "CANCELLED";
  const canPostpone = workOrder.status === "PLANNED" || workOrder.status === "IN_PROGRESS";
  const canCancel   = !isClosed;
  const canClose    = !isClosed && !!woResult.trim();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className={`w-full bg-[#0D1B2A] border border-white/10 rounded-2xl shadow-2xl flex flex-col transition-all duration-200 ${expanded ? "w-full h-full" : "max-w-3xl max-h-[90%]"}`} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-3">
            <Wrench className="w-4 h-4 text-accent" />
            <div>
              <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">Orden de Trabajo</p>
              <h2 className="text-sm font-bold text-white font-mono">{workOrder.workOrderCode}</h2>
            </div>
            <WoStatusBadge status={workOrder.status} dueDate={workOrder.dueDate} />
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setExpanded(v => !v)} className="p-1.5 rounded-lg text-text-industrial/30 hover:text-white hover:bg-white/5 transition-colors" title={expanded ? "Reducir" : "Ampliar"}>
              {expanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
            <button onClick={onClose}><X className="w-5 h-5 text-text-industrial/40 hover:text-white" /></button>
          </div>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-6 space-y-6">

          {/* ── INFORMACIÓN ── */}
          <section>
            <p className="text-[10px] uppercase tracking-widest text-text-industrial/40 font-semibold mb-3">Información</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {([
                ["Embarcación",      workOrder.vesselCode,            "font-mono text-accent"],
                ["Equipo",           workOrder.assetName ?? workOrder.assetId, "text-white"],
                ["Tipo",             null, null, <CategoryBadge key="cat" type={workOrder.type} />],
                ["Estado",           null, null, <WoStatusBadge key="st" status={workOrder.status} dueDate={workOrder.dueDate} />],
                ["Prioridad",        workOrder.priority,              "text-white"],
                ["Criticidad",       workOrder.criticality,           "text-white"],
                ["F. Apertura",      fmtDate(workOrder.openDate),     "text-white"],
                ["F. Vencimiento",   fmtDate(workOrder.dueDate),      workOrder.dueDate && !isClosed && parseLocalDate(workOrder.dueDate) < new Date() ? "text-red-400 font-semibold" : "text-white"],
              ] as [string, string | null, string | null, React.ReactNode?][]).map(([label, value, cls, node], i) => (
                <div key={i} className="bg-white/5 border border-white/10 rounded-xl p-2.5">
                  <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{label}</p>
                  {node ?? <p className={`text-xs mt-0.5 ${cls ?? ""}`}>{value || "—"}</p>}
                </div>
              ))}
            </div>
            {workOrder.holdReason && (() => {
              const inProcess = deferralStatus === "REQUESTED" || deferralStatus === "UNDER_REVIEW";
              const approved  = deferralStatus === "APPROVED" || deferralStatus === "ACTIVE";
              const closed    = deferralStatus === "CLOSED" || deferralStatus === "EXPIRED";
              const rejected  = deferralStatus === "REJECTED";
              const badge = inProcess
                ? { label: deferralStatus === "UNDER_REVIEW" ? "En revisión" : "Solicitada", cls: "bg-blue-500/20 text-blue-300 border-blue-500/30" }
                : approved
                ? { label: deferralStatus === "ACTIVE" ? "Aprobada · Activa" : "Aprobada", cls: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" }
                : rejected
                ? { label: "Rechazada", cls: "bg-red-500/20 text-red-300 border-red-500/30" }
                : closed
                ? { label: deferralStatus === "EXPIRED" ? "Vencida" : "Cerrada", cls: "bg-white/10 text-text-industrial/60 border-white/10" }
                : null;
              const originalDue = workOrder.dueDate;
              const postponedTo = deferralTargetDate;
              const postponedDays = originalDue && postponedTo
                ? Math.round((new Date(postponedTo).getTime() - new Date(originalDue).getTime()) / 86_400_000)
                : null;
              return (
                <div className="mt-2 rounded-xl border border-yellow-500/20 bg-yellow-500/10 px-3 py-2">
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <p className="text-[10px] uppercase tracking-wider text-yellow-400">Motivo de postergación</p>
                    {badge && (
                      <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${badge.cls}`}>
                        {badge.label}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-yellow-300">{workOrder.holdReason}</p>
                  <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[10px] text-yellow-400/70">
                    {originalDue && (
                      <span>Vencimiento original: <span className="font-semibold text-yellow-300">{fmtDate(originalDue)}</span></span>
                    )}
                    {postponedTo && (
                      <span>Fecha objetivo: <span className="font-semibold text-yellow-300">{fmtDate(postponedTo)}</span></span>
                    )}
                    {postponedDays !== null && (
                      <span>Postergado: <span className="font-semibold text-yellow-300">{postponedDays > 0 ? `+${postponedDays} días` : `${postponedDays} días`}</span></span>
                    )}
                  </div>
                </div>
              );
            })()}
            {workOrder.cancelReason && (
              <div className="mt-2 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wider text-red-400 mb-0.5">Motivo de cancelación</p>
                <p className="text-xs text-red-300">{workOrder.cancelReason}</p>
              </div>
            )}
          </section>

          {/* ── PLAN ── */}
          <section className="space-y-4">
            <p className="text-[10px] uppercase tracking-widest text-text-industrial/40 font-semibold border-t border-white/10 pt-4">Plan</p>

            {/* ── Departamento + Ubicación ── */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className={labelCls}>Departamento</label>
                <div className="flex flex-wrap gap-2">
                  {(["CUBIERTA", "MAQUINAS", "BARCAZA", "SERVICIOS"] as const).map(d => (
                    <button key={d} type="button" disabled={!isEditable}
                      onClick={() => setDepartment(department === d ? "" : d)}
                      className={`px-2 py-1 rounded text-xs font-bold border transition-colors ${
                        department === d
                          ? "bg-accent text-white border-accent"
                          : "bg-white/5 text-text-industrial/60 border-white/10 hover:border-accent/40"
                      }`}
                    >{d}</button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <label className={labelCls}>Ubicación</label>
                <input value={location} onChange={e => setLocation(e.target.value)} disabled={!isEditable}
                  className={inputCls} placeholder="Ej: Sala de máquinas, Cubierta proa…" />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className={labelCls}>Título de la OT</label>
              <input value={title} onChange={e => setTitle(e.target.value)} disabled={!isEditable} className={inputCls} placeholder="Descripción breve de la tarea" />
            </div>
            <div className="space-y-1.5">
              <label className={sectionLabelCls} style={sectionLabelStyle}>Tarea</label>
              <textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} disabled={!isEditable} className={`${inputCls} resize-y`} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className={labelCls}>Responsable</label>
                <input value={assignedTo} onChange={e => setAssignedTo(e.target.value)} disabled={!isEditable} className={inputCls} placeholder="Nombre del responsable" />
              </div>
              <div className="space-y-1.5">
                <label className={labelCls}>F. Vencimiento</label>
                <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} disabled={!isEditable} className={inputCls} />
              </div>
            </div>
            <div className="space-y-1.5">
              <label
                className={`${sectionLabelCls} ${isEditable ? `cursor-pointer transition-colors ${loadingCriteria ? "opacity-60 animate-pulse" : "hover:opacity-80"}` : ""}`}
                style={sectionLabelStyle}
                onClick={handleAcceptanceCriteriaClick}
                title={isEditable ? "Click para que la IA genere los criterios de aceptación" : undefined}
              >
                Criterios de aceptación{loadingCriteria && <span className="ml-1 text-[9px] normal-case font-normal">analizando...</span>}
              </label>
              <textarea rows={2} value={acceptanceCriteria} onChange={e => setAcceptanceCriteria(e.target.value)} disabled={!isEditable || loadingCriteria} className={`${inputCls} resize-y`} placeholder="Condiciones que deben cumplirse para dar la tarea por completada" />
            </div>
            <div className="space-y-1.5">
              <label
                className={`${sectionLabelCls} ${isEditable ? `cursor-pointer transition-colors ${loadingLoto ? "opacity-60 animate-pulse" : "hover:opacity-80"}` : ""}`}
                style={sectionLabelStyle}
                onClick={handleLotoClick}
                title={isEditable ? "Click para que la IA genere el procedimiento LOTO" : undefined}
              >
                LOTO{loadingLoto && <span className="ml-1 text-[9px] normal-case font-normal">analizando...</span>}
              </label>
              <textarea rows={2} value={loto} onChange={e => setLoto(e.target.value)} disabled={!isEditable || loadingLoto} className={`${inputCls} resize-y`} placeholder="Procedimiento de bloqueo y etiquetado" />
            </div>
            <div className="space-y-1.5">
              <label
                className={`${labelCls} ${isEditable ? `cursor-pointer transition-colors ${loadingRisk ? "text-accent/60 animate-pulse" : "hover:text-accent"}` : ""}`}
                onClick={handleRiskClick}
                title={isEditable ? "Click para que la IA analice el nivel de riesgo" : undefined}
              >
                Nivel de Riesgo{loadingRisk && <span className="ml-1 text-[9px] text-accent/60 normal-case font-normal">analizando...</span>}
              </label>
              <div className="flex gap-1.5">
                {([
                  ["LOW",      "L", "bg-success-sea text-primary-bg border-success-sea",       "text-success-sea border-success-sea/40"],
                  ["MEDIUM",   "M", "bg-yellow-400 text-primary-bg border-yellow-400",         "text-yellow-400 border-yellow-400/40"],
                  ["HIGH",     "H", "bg-red-500 text-white border-red-500",                    "text-red-400 border-red-400/40"],
                  ["CRITICAL", "C", "bg-red-700 text-white border-red-700",                    "text-red-600 border-red-600/40"],
                ] as [string, string, string, string][]).map(([val, label, activeCls, inactiveLabelCls]) => (
                  <button key={val} type="button" disabled={!isEditable || loadingRisk}
                    onClick={() => setRiskLevel(riskLevel === val ? "" : val)}
                    className={`w-9 h-9 rounded-lg border font-bold text-sm transition-all disabled:opacity-50 ${riskLevel === val ? activeCls : `bg-white/5 ${inactiveLabelCls} hover:bg-white/10`}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <label className={sectionLabelCls} style={sectionLabelStyle}>Resultado Análisis de Riesgo</label>
              <textarea rows={2} value={riskAnalysisResult} onChange={e => setRiskAnalysisResult(e.target.value)} disabled={!isEditable || loadingRisk} className={`${inputCls} resize-y`} placeholder="Ej: Aceptable con controles" />
            </div>
            <div className="space-y-1.5">
              <label className={labelCls}>Documento Checklist</label>
              {checklistDocUrl && !checklistDocFile && (
                <a href={checklistDocUrl} target="_blank" rel="noreferrer" className="block text-xs text-accent underline mb-1 truncate">{checklistDocUrl}</a>
              )}
              <input type="file" disabled={!isEditable} onChange={e => setChecklistDocFile(e.target.files?.[0] ?? null)}
                className="block w-full text-xs text-text-industrial/60 file:mr-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-accent/10 file:text-accent hover:file:bg-accent/20 disabled:opacity-50 cursor-pointer" />
            </div>
          </section>

          {/* ── RESULTADO ── */}
          <section className="space-y-4 bg-blue-500/10 border border-blue-500/20 rounded-2xl p-4">
            <p className="text-[10px] uppercase tracking-widest text-blue-300 font-semibold">Resultado de la Orden de Trabajo</p>

            <div className="space-y-1.5">
              <label className={labelCls}>Resultado *</label>
              <div className="flex gap-2">
                {[["SATISFACTORY", "Satisfactorio", "bg-success-sea/10 text-success-sea border-success-sea/30"],
                  ["WITH_DEFICIENCIES", "Con deficiencias", "bg-orange-500/10 text-orange-400 border-orange-500/30"]].map(([val, label, cls]) => (
                  <button key={val} type="button" disabled={!isEditable}
                    onClick={() => handleWoResultChange(val)}
                    className={`flex-1 py-2 rounded-xl border text-xs font-bold transition-all disabled:opacity-50 ${woResult === val ? cls : "bg-white/5 text-text-industrial/50 border-white/10 hover:border-white/30"}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* ── Deficiencias encontradas ── */}
            {woResult === "WITH_DEFICIENCIES" && (
              <div className="space-y-1.5">
                <label className={labelCls}>Deficiencias encontradas</label>
                <textarea rows={3} value={deficienciasText} onChange={e => setDeficienciasText(e.target.value)} disabled={!isEditable} className={`${inputCls} resize-none border-orange-500/30 focus:border-orange-400/60`} placeholder="Descripción detallada de las deficiencias encontradas" />
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className={labelCls}>Ejecutado por</label>
                <input value={executedByName} onChange={e => setExecutedByName(e.target.value)} disabled={!isEditable} className={inputCls} placeholder="Nombre del ejecutante" />
              </div>
              <div className="space-y-1.5">
                <label className={labelCls}>Fecha de ejecución</label>
                <input type="date" value={executionDate} onChange={e => setExecutionDate(e.target.value)} disabled={!isEditable} className={inputCls} />
              </div>
            </div>
            {workOrder.maintenancePlanId && (
              <div className="space-y-1.5">
                <label className={labelCls}>Horas del motor al momento de ejecución</label>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={runningHoursAtExecution}
                  onChange={e => setRunningHoursAtExecution(e.target.value)}
                  disabled={!isEditable}
                  className={inputCls}
                  placeholder="ej. 3500"
                />
              </div>
            )}
            <div className="space-y-1.5">
              <label className={labelCls}>Observaciones</label>
              <textarea rows={3} value={observations} onChange={e => setObservations(e.target.value)} disabled={!isEditable} className={`${inputCls} resize-none`} placeholder="Observaciones, hallazgos o notas de cierre" />
            </div>
            <div className="space-y-1.5">
              <label className={labelCls}>Documento respaldatorio</label>
              {supportingDocUrl && !supportingDocFile && (
                <a href={supportingDocUrl} target="_blank" rel="noreferrer" className="block text-xs text-accent underline mb-1 truncate">{supportingDocUrl}</a>
              )}
              <input type="file" disabled={!isEditable} onChange={e => setSupportingDocFile(e.target.files?.[0] ?? null)}
                className="block w-full text-xs text-text-industrial/60 file:mr-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-accent/10 file:text-accent hover:file:bg-accent/20 disabled:opacity-50 cursor-pointer" />
            </div>

            {/* ── Repuestos utilizados ── */}
            <div className="border border-white/10 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-bold text-white/50 uppercase tracking-wider">Repuestos utilizados</p>
                {isEditable && (
                  <button type="button" onClick={() => setAddingUsage(v => !v)}
                    className="text-[10px] text-accent/70 hover:text-accent underline">
                    {addingUsage ? "Cancelar" : "+ Agregar repuesto"}
                  </button>
                )}
              </div>

              {spareUsages.length > 0 && (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[10px] text-white/30 border-b border-white/10">
                      <th className="text-left py-1">Repuesto</th>
                      <th className="text-right py-1">Cant.</th>
                      <th className="text-left py-1 pl-2">Ud.</th>
                      {isEditable && <th />}
                    </tr>
                  </thead>
                  <tbody>
                    {spareUsages.map((u, i) => (
                      <tr key={i} className="border-b border-white/5 last:border-0">
                        <td className="py-1.5">
                          <div className="flex items-center gap-1.5">
                            <CritBadge crit={u.criticality} />
                            <span className={u.qty > u.available ? "text-orange-300" : "text-white"}>{u.spareName}</span>
                          </div>
                        </td>
                        <td className="py-1.5 text-right text-white/70">{u.qty}</td>
                        <td className="py-1.5 pl-2 text-white/40">{u.unit}</td>
                        {isEditable && (
                          <td className="py-1.5 text-right">
                            <button onClick={() => removeUsage(i)} className="text-white/20 hover:text-red-400 transition-colors">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {spareUsages.some(u => u.qty > u.available) && (
                <p className="text-[10px] text-orange-400">
                  ⚠ Algunos repuestos superan el stock disponible. El cierre continuará, pero verifique el inventario.
                </p>
              )}

              {addingUsage && (
                <div className="space-y-1.5 pt-1 border-t border-white/10">
                  <div className="grid grid-cols-3 gap-2">
                    <div className="col-span-2 relative">
                      <input
                        type="text"
                        value={usageSearch}
                        onChange={e => { setUsageSearch(e.target.value); setUsageSpareId(""); setUsageDropdown(true); }}
                        onFocus={() => setUsageDropdown(true)}
                        onBlur={() => setTimeout(() => setUsageDropdown(false), 150)}
                        placeholder="Buscar por SKU o nombre..."
                        className={inputCls}
                      />
                      {usageDropdown && (
                        <div className="absolute z-20 w-full mt-1 bg-[#0D1B2A] border border-white/10 rounded-xl shadow-xl max-h-52 overflow-y-auto">
                          {(() => {
                            const q = usageSearch.toLowerCase();
                            const filtered = q
                              ? woSpares.filter(s => s.sku.toLowerCase().includes(q) || s.name.toLowerCase().includes(q))
                              : woSpares.slice(0, 30);
                            if (filtered.length === 0) return <p className="px-3 py-2 text-xs text-white/30">Sin resultados</p>;
                            return filtered.map(s => (
                              <button key={s.id} type="button"
                                onMouseDown={() => { setUsageSpareId(s.id); setUsageSearch(`${s.sku} — ${s.name}`); setUsageDropdown(false); }}
                                className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-white/5">
                                <CritBadge crit={s.criticality} />
                                <span className="flex-1 text-left text-white">{s.sku} — {s.name}</span>
                                {s.available <= 0
                                  ? <span className="text-red-400 text-[10px] font-semibold shrink-0">SIN STOCK</span>
                                  : <span className="text-white/30 text-[10px] shrink-0">disp: {s.available} {s.unit}</span>
                                }
                              </button>
                            ));
                          })()}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <input type="number" min="0.01" step="0.01" value={usageQty} onChange={e => setUsageQty(e.target.value)}
                        placeholder="Cant." className={inputCls} />
                      <button onClick={addUsage} disabled={!usageSpareId}
                        className="px-3 py-2 rounded-xl bg-accent/20 text-accent text-xs font-bold hover:bg-accent/30 disabled:opacity-40 shrink-0">
                        +
                      </button>
                    </div>
                  </div>
                  {usageSpareId && (() => {
                    const spare = woSpares.find(s => s.id === usageSpareId);
                    const qty = parseFloat(usageQty);
                    if (spare && qty > spare.available) {
                      return <p className="text-[10px] text-orange-400">⚠ Stock insuficiente: disponible {spare.available} {spare.unit}, solicitado {qty}</p>;
                    }
                    return null;
                  })()}
                </div>
              )}

              {spareUsages.length === 0 && !addingUsage && (
                <p className="text-xs text-white/20">Sin repuestos registrados.</p>
              )}
            </div>

            {/* ── Prompt abrir DEF ── */}
            {woResult === "WITH_DEFICIENCIES" && defectPrompt !== "idle" && (
              <div className="rounded-xl border border-orange-500/20 bg-orange-500/5 px-4 py-3 space-y-2.5">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-orange-400 shrink-0" />
                  <p className="text-xs font-semibold text-orange-300">¿Deseas abrir un registro en el Log de Defectos?</p>
                </div>
                {defectPrompt === "ask" && (
                  <div className="flex gap-2">
                    <button type="button" onClick={() => { void openDefectRecord(); }}
                      className="flex-1 py-1.5 rounded-lg bg-orange-500/20 border border-orange-500/30 text-orange-300 font-bold text-xs hover:bg-orange-500/30 transition-all">
                      Abrir Registro DEF
                    </button>
                    <button type="button" onClick={() => setDefectPrompt("declined")}
                      className="flex-1 py-1.5 rounded-lg bg-white/5 border border-white/10 text-text-industrial/50 font-bold text-xs hover:border-white/20 transition-all">
                      No abrir Registro DEF
                    </button>
                  </div>
                )}
                {defectPrompt === "creating" && (
                  <div className="flex items-center gap-2 text-xs text-text-industrial/50">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" /> Creando registro...
                  </div>
                )}
                {defectPrompt === "created" && (
                  <div className="flex items-center gap-2 text-xs text-success-sea font-semibold">
                    <CheckCheck className="w-3.5 h-3.5 shrink-0" />
                    Registro de defecto creado: <span className="font-mono">{createdDefectCode}</span>
                  </div>
                )}
                {defectPrompt === "declined" && (
                  <p className="text-xs text-text-industrial/40">No se abrirá registro de defecto.</p>
                )}
              </div>
            )}
          </section>

          {/* ── Medio de comunicación ── */}
          <section className="space-y-3 border-t border-white/10 pt-4">
            <p className="text-[10px] uppercase tracking-widest text-text-industrial/40 font-semibold">Medio de comunicación utilizado</p>
            <div className="flex gap-3 flex-wrap">
              {(["IMPRESO", "EMAIL", "WHAPP", "OTRO"] as const).map(opt => (
                <button key={opt} type="button" disabled={!isEditable}
                  onClick={() => toggleArr(commMethod, setCommMethod, opt)}
                  className={`px-3 py-1 rounded text-xs font-bold border transition-colors ${
                    commMethod.includes(opt)
                      ? "bg-accent text-white border-accent"
                      : "bg-white/5 text-text-industrial/60 border-white/10 hover:border-accent/40"
                  }`}
                >{opt}</button>
              ))}
            </div>
          </section>

          {/* ── Distribución ── */}
          <section className="space-y-3 border-t border-white/10 pt-4">
            <p className="text-[10px] uppercase tracking-widest text-text-industrial/40 font-semibold">Distribución</p>
            <div className="flex gap-2 flex-wrap">
              {(["GGE","PDT","JTE","JOP","JRH","JVE","JCO","JSE","JUR","ADM","CAP","JMA"] as const).map(code => (
                <button key={code} type="button" disabled={!isEditable}
                  onClick={() => toggleArr(distribution, setDistribution, code)}
                  className={`w-12 py-1 rounded text-xs font-bold border transition-colors ${
                    distribution.includes(code)
                      ? "bg-accent text-white border-accent"
                      : "bg-white/5 text-text-industrial/60 border-white/10 hover:border-accent/40"
                  }`}
                >{code}</button>
              ))}
            </div>
          </section>

          {closingWarning && (
            <div className="rounded-xl border border-orange-500/20 bg-orange-500/5 px-4 py-3 space-y-2">
              <p className="text-xs text-orange-300">{closingWarning}</p>
              <button onClick={onSaved} className="px-4 py-1.5 rounded-lg bg-orange-500/20 border border-orange-500/30 text-orange-300 font-bold text-xs hover:bg-orange-500/30 transition-all">
                Aceptar y cerrar
              </button>
            </div>
          )}
          {err && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{err}</p>}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-6 py-4 border-t border-white/10 shrink-0">
          <div className="flex gap-2">
            <button onClick={() => { void handleGeneratePdf(); }} disabled={generatingPdf}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-xs text-text-industrial hover:border-accent/30 disabled:opacity-50 transition-all">
              {generatingPdf ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />} Generar PDF
            </button>
            <button onClick={() => canPostpone && onOpenAction(workOrder, "hold")} disabled={!canPostpone}
              className="px-4 py-2 rounded-xl bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 font-bold text-xs hover:bg-yellow-500/20 disabled:opacity-30 disabled:cursor-not-allowed">
              Postergar
            </button>
            <button onClick={() => { void onClose_WO(); }} disabled={!canClose || closing}
              title={!woResult.trim() ? "Completar el Resultado de la OT antes de cerrar" : undefined}
              className="px-4 py-2 rounded-xl bg-success-sea/10 border border-success-sea/20 text-success-sea font-bold text-xs hover:brightness-110 disabled:opacity-30 disabled:cursor-not-allowed">
              {closing ? <Loader2 className="w-4 h-4 animate-spin" /> : "Cerrar OT"}
            </button>
          </div>
          <div className="flex gap-2">
            <button onClick={() => canCancel && onOpenAction(workOrder, "cancel")} disabled={!canCancel}
              className="px-4 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 font-bold text-xs hover:bg-red-500/20 disabled:opacity-30 disabled:cursor-not-allowed">
              Cancelar OT
            </button>
            {isEditable && canManage && (
              <button onClick={() => { void onSave(); }} disabled={saving}
                className="px-4 py-2 rounded-xl bg-accent text-primary-bg font-bold text-xs hover:brightness-110 disabled:opacity-50">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : t("common.save")}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Page ──────────────────────────────────────────────────────────────────────

export const WorkOrdersPage: React.FC = () => {
  const t = useT();
  const { user } = useAuth();
  const navigate = useNavigate();
  const canManage = user?.role === "TENANT_ADMIN" || user?.role === "MAINTENANCE_MANAGER";

  const [searchParams, setSearchParams] = useSearchParams();
  const [editing, setEditing]         = useState<WorkOrder | null>(null);
  const [showCreate, setShowCreate]   = useState(false);

  useCopilotEmitter(!editing && !showCreate ? { module: "WORK_ORDERS", screen: "WO_LIST" } : null);
  const [showExcel, setShowExcel]     = useState(false);
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [tableActionError, setTableActionError] = useState<string | null>(null);
  const [actionTarget, setActionTarget] = useState<ActionTarget | null>(null);

  const statusFilter   = (searchParams.get("status")    ?? "").trim();
  const typeFilter     = (searchParams.get("type")      ?? "").trim();
  const priorityFilter = (searchParams.get("priority")  ?? "").trim();
  const vesselFilter   = (searchParams.get("vesselCode") ?? "").trim();
  const viewFilter     = (searchParams.get("view")      ?? "").trim(); // open | overdue | closed
  const autoCode       = (searchParams.get("autoCode")  ?? "").trim();
  const [vesselInput, setVesselInput] = useState(vesselFilter);
  useEffect(() => { setVesselInput(vesselFilter); }, [vesselFilter]);

  const updateFilters = useCallback((next: { status?: string; type?: string; priority?: string; vesselCode?: string }) => {
    const params = new URLSearchParams(searchParams);
    const s = next.status    !== undefined ? next.status    : statusFilter;
    const tp = next.type     !== undefined ? next.type      : typeFilter;
    const pr = next.priority !== undefined ? next.priority  : priorityFilter;
    const v  = next.vesselCode !== undefined ? next.vesselCode : vesselFilter;
    if (s)  params.set("status",    s);  else params.delete("status");
    if (tp) params.set("type",      tp); else params.delete("type");
    if (pr) params.set("priority",  pr); else params.delete("priority");
    if (v)  params.set("vesselCode", v); else params.delete("vesselCode");
    setSearchParams(params, { replace: true });
  }, [priorityFilter, searchParams, setSearchParams, statusFilter, typeFilter, vesselFilter]);

  const path = useMemo(() => {
    const params = new URLSearchParams();
    if (statusFilter)   params.set("status",    statusFilter);
    if (typeFilter)     params.set("type",      typeFilter);
    if (priorityFilter) params.set("priority",  priorityFilter);
    if (vesselFilter)   params.set("vesselCode", vesselFilter);
    const q = params.toString();
    return `/app/pms/work-orders${q ? `?${q}` : ""}`;
  }, [priorityFilter, statusFilter, typeFilter, vesselFilter]);

  const { data, loading, error, reload } = useFetch<ListResponse>(path, [path]);

  // Map of workOrderId → {id, deferralCode} for ON_HOLD WOs
  const [deferralMap, setDeferralMap] = useState<Map<string, { id: string; deferralCode: string }>>(new Map());
  useEffect(() => {
    const onHoldIds = (data?.items ?? []).filter(w => w.status === "ON_HOLD").map(w => w.id);
    if (onHoldIds.length === 0) { setDeferralMap(new Map()); return; }
    let cancelled = false;
    api.get<{ items: { id: string; deferralCode: string; sourceId: string }[] }>("/app/pms/deferrals")
      .then(r => {
        if (cancelled) return;
        const map = new Map<string, { id: string; deferralCode: string }>();
        for (const d of r.items ?? []) {
          if (onHoldIds.includes(d.sourceId)) map.set(d.sourceId, { id: d.id, deferralCode: d.deferralCode });
        }
        setDeferralMap(map);
      })
      .catch(() => { if (!cancelled) setDeferralMap(new Map()); });
    return () => { cancelled = true; };
  }, [data]);

  const visibleItems = useMemo(() => {
    const items = data?.items ?? null;
    if (!items || !viewFilter) return items;
    const now = new Date();
    const CLOSED = new Set(["CLOSED", "CANCELLED"]);
    if (viewFilter === "closed")    return items.filter(w => CLOSED.has(w.status));
    if (viewFilter === "postponed") return items.filter(w => w.status === "ON_HOLD");
    if (viewFilter === "overdue")   return items.filter(w => !CLOSED.has(w.status) && w.status !== "ON_HOLD" && !!w.dueDate && parseLocalDate(w.dueDate) < now);
    if (viewFilter === "open")      return items.filter(w => !CLOSED.has(w.status) && w.status !== "ON_HOLD" && !(!!w.dueDate && parseLocalDate(w.dueDate) < now));
    return items;
  }, [data, viewFilter]);

  // Auto-open WO when arriving from a plan badge click
  useEffect(() => {
    if (!autoCode || !data?.items?.length) return;
    const match = data.items.find(w => w.workOrderCode === autoCode);
    if (!match) return;
    setDetailLoadingId(match.id);
    api.get<WorkOrder>(`/app/pms/work-orders/${match.id}`)
      .then(detailed => setEditing(detailed))
      .catch(() => setEditing(match))
      .finally(() => setDetailLoadingId(null));
    const params = new URLSearchParams(searchParams);
    params.delete("autoCode");
    setSearchParams(params, { replace: true });
  }, [autoCode, data, searchParams, setSearchParams]);

  const openDetail = useCallback(async (row: WorkOrder) => {
    setDetailLoadingId(row.id);
    setTableActionError(null);
    try {
      const detailed = await api.get<WorkOrder>(`/app/pms/work-orders/${row.id}`);
      setEditing(detailed);
    } catch { setEditing(row); }
    finally { setDetailLoadingId(null); }
  }, []);

  const openActionModal = useCallback((wo: WorkOrder, type: ActionType) => {
    setActionTarget({ workOrder: wo, type });
  }, []);

  const onActionSuccess = useCallback(() => {
    setActionTarget(null);
    setEditing(null);
    void reload();
  }, [reload]);

  const columns: Column<WorkOrder>[] = useMemo(() => [
    {
      key: "workOrderCode", header: "Código / Embarcación",
      sortValue: r => `${r.vesselCode} ${r.workOrderCode}`,
      render: r => (
        <div>
          <div className="font-mono font-bold text-white text-xs">{r.workOrderCode}</div>
          <div className="font-mono text-accent text-[10px] mt-0.5">{r.vesselCode}</div>
        </div>
      ),
    },
    {
      key: "title", header: "Equipo / Tarea",
      sortValue: r => r.assetName ?? r.title ?? "",
      render: r => (
        <div>
          <div className="text-xs text-white font-medium">{r.assetName ?? "—"}</div>
          <div className="text-[10px] text-text-industrial/50 line-clamp-1 mt-0.5">{r.title?.trim() || "—"}</div>
        </div>
      ),
    },
    { key: "type",   header: "Categoría",   render: r => <CategoryBadge type={r.type} /> },
    { key: "assignedToUserId", header: "Responsable", sortValue: r => r.assignedToUserName ?? "", render: r => <span className="text-xs text-text-industrial/70">{r.assignedToUserName ?? "—"}</span> },
    { key: "openDate", header: "F. Apertura",    render: r => <span className="text-xs text-text-industrial/60 whitespace-nowrap">{fmtDate(r.openDate)}</span> },
    {
      key: "dueDate", header: "F. Vencimiento",
      render: r => {
        if (!r.dueDate) return <span className="text-xs text-text-industrial/30">—</span>;
        const overdue = r.status !== "CLOSED" && r.status !== "CANCELLED" && parseLocalDate(r.dueDate) < new Date();
        return <span className={`text-xs whitespace-nowrap font-medium ${overdue ? "text-red-400" : "text-text-industrial/60"}`}>{fmtDate(r.dueDate)}</span>;
      },
    },
    {
      key: "status", header: "Estado",
      render: r => {
        const deferral = r.status === "ON_HOLD" ? deferralMap.get(r.id) : undefined;
        return (
          <div className="flex flex-col items-start gap-1">
            <WoStatusBadge status={r.status} dueDate={r.dueDate} />
            {deferral && (
              <button
                type="button"
                onClick={e => { e.stopPropagation(); navigate(`/deferrals?autoCode=${deferral.deferralCode}`); }}
                className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-bold bg-white/5 text-yellow-300 border-yellow-500/30 font-mono whitespace-nowrap hover:bg-yellow-500/10 cursor-pointer transition-colors"
              >
                <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                {deferral.deferralCode}
              </button>
            )}
          </div>
        );
      },
    },
  ], [deferralMap, navigate]);

  return (
    <div className="space-y-5">
      <PageHeader icon={Wrench} title={t("page.workOrders")} total={data?.total} onReload={reload}>
        {canManage && (
          <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-primary-bg font-bold text-xs hover:brightness-110 transition-all">
            <Plus className="w-3.5 h-3.5" /> {t("wo.new")}
          </button>
        )}
        <button onClick={() => setShowExcel(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-text-industrial hover:border-accent/30 transition-all">
          <FileSpreadsheet className="w-3.5 h-3.5 text-accent" /> Excel
        </button>
        <select value={toFilterSelectValue(statusFilter)} onChange={e => updateFilters({ status: fromFilterSelectValue(e.target.value) })} className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-text-industrial focus:outline-none focus:border-accent/50">
          <option value={FILTER_ALL_VALUE}>Todos los estados</option>
          <option value="PLANNED">Planificada</option>
          <option value="IN_PROGRESS">En progreso</option>
          <option value="ON_HOLD">En espera</option>
          <option value="CLOSED">Cerrada</option>
          <option value="CANCELLED">Cancelada</option>
        </select>
        <select value={toFilterSelectValue(typeFilter)} onChange={e => updateFilters({ type: fromFilterSelectValue(e.target.value) })} className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-text-industrial focus:outline-none focus:border-accent/50">
          <option value={FILTER_ALL_VALUE}>Todas las categorías</option>
          <option value="PREVENTIVE">Mantenimiento</option>
          <option value="CORRECTIVE">Reparación</option>
          <option value="INSPECTION">Inspección</option>
        </select>
        <select value={toFilterSelectValue(priorityFilter)} onChange={e => updateFilters({ priority: fromFilterSelectValue(e.target.value) })} className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-text-industrial focus:outline-none focus:border-accent/50">
          <option value={FILTER_ALL_VALUE}>Todas las prioridades</option>
          <option value="LOW">Baja</option>
          <option value="MEDIUM">Media</option>
          <option value="HIGH">Alta</option>
          <option value="CRITICAL">Crítica</option>
        </select>
        <div className="flex items-center gap-2">
          <input value={vesselInput} onChange={e => setVesselInput(e.target.value.toUpperCase())} onKeyDown={e => { if (e.key === "Enter") updateFilters({ vesselCode: vesselInput.trim() }); }} placeholder={t("common.filterByVessel")} className="w-44 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-text-industrial placeholder-text-industrial/30 focus:outline-none focus:border-accent/50" />
          <button onClick={() => updateFilters({ vesselCode: vesselInput.trim() })} className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-text-industrial hover:border-accent/30">{t("common.apply")}</button>
          {(statusFilter || typeFilter || priorityFilter || vesselFilter) && (
            <button onClick={() => updateFilters({ status: "", type: "", priority: "", vesselCode: "" })} className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-text-industrial/80 hover:text-white hover:border-red-400/40">{t("common.clear")}</button>
          )}
        </div>
      </PageHeader>

      {detailLoadingId && <div className="flex items-center gap-2 text-xs text-text-industrial/60"><Loader2 className="w-4 h-4 animate-spin text-accent" />Cargando detalle...</div>}
      {tableActionError && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{tableActionError}</p>}

      <DataTable columns={columns} data={visibleItems} loading={loading} error={error} keyFn={r => r.id} emptyText={t("empty.workOrders")} onRowClick={row => { void openDetail(row); }} />

      {showCreate && (
        <CreateWorkOrderModal
          onClose={() => setShowCreate(false)}
          onSaved={() => { setShowCreate(false); void reload(); }}
        />
      )}
      {editing && (
        <WorkOrderModal
          workOrder={editing}
          canManage={canManage}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void reload(); }}
          onOpenAction={openActionModal}
        />
      )}
      {actionTarget?.type === "hold"   && <HoldModal   workOrder={actionTarget.workOrder} onClose={() => setActionTarget(null)} onSuccess={onActionSuccess} />}
      {actionTarget?.type === "cancel" && <CancelModal workOrder={actionTarget.workOrder} onClose={() => setActionTarget(null)} onSuccess={onActionSuccess} />}
      {showExcel && <ExcelPanel module="work_orders" onClose={() => setShowExcel(false)} />}
    </div>
  );
};
