import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Clock, Download, ExternalLink, GitBranch, Loader2, Sparkles, Trash2, X } from "lucide-react";
import { useFetch } from "../lib/hooks";
import { api, ApiError } from "../lib/api";
import { MocModal, type MocPrefill } from "./Moc";
import { DataTable, StatusBadge, type Column } from "../components/DataTable";
import { ModalCloseButton } from "../components/ModalCloseButton";
import { VesselLabel } from "../components/EntityLabels";
import { fmtDate, FILTER_ALL_VALUE, fromFilterSelectValue, toFilterSelectValue } from "../lib/utils";
import { PageHeader } from "../components/PageHeader";
import { ExportExcelButton } from "../components/ExportExcelButton";
import { useT, useWoTerms } from "../lib/i18n";
import { useDeepLink } from "../lib/deep-link";
import { CopyLinkButton } from "../components/CopyLinkButton";
import { RiskMatrix } from "../components/RiskMatrix";
import { deriveRiskLevelFromMatrix, toUiRiskLevel, toUiRiskProbability, toUiRiskConsequence, type RiskLevel, type RiskProbability, type RiskConsequence } from "../lib/risk";
import { useCopilotEmitter, useCopilotScreenContext } from "../lib/copilot-context";
import { useEscapeGuard, useDirtyTracker } from "../lib/escape-guard";

const SOURCE_ROUTE: Record<string, string> = {
  WORK_ORDER:       "/work-orders",
  DEFECT:           "/defects",
  MAINTENANCE_PLAN: "/maintenance-plans",
};

interface Deferral {
  id: string;
  tenantId: string;
  vesselCode: string;
  assetId: string;
  assetName: string | null;
  sourceType: string;
  sourceId: string;
  sourceCode: string | null;
  deferralCode: string;
  status: string;
  requestedAt: string;
  requestedByUserId: string;
  requestedByName: string | null;
  targetDate: string | null;
  justification: string | null;
  compensatoryMeasures: string | null;
  riskLevel: string | null;
  riskProbability: string | null;
  riskConsequence: string | null;
  riskAnalysisResult: string | null;
  reviewNotes: string | null;
  decisionAt: string | null;
  decidedByUserId: string | null;
  decidedByName: string | null;
  approverName: string | null;
  rejectorName: string | null;
  activeSince: string | null;
  expiredAt: string | null;
  closedAt: string | null;
  closeNotes: string | null;
  rejectionReason: string | null;
  createdAt: string;
}

interface ListResponse {
  items: Deferral[];
  total: number;
}


interface WorkOrderReference {
  id: string;
  workOrderCode: string;
  title: string | null;
}

interface DefectReference {
  id: string;
  defectCode: string;
  classification: string;
}

interface MaintenancePlanReference {
  id: string;
  taskCode: string;
  title: string;
}

const SOURCE_STYLES: Record<string, string> = {
  DEFECT: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20",
  WORK_ORDER: "bg-accent/10 text-accent border-accent/20",
  MAINTENANCE_PLAN: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20",
};

function SourceTypeBadge({ sourceType }: { sourceType: string }) {
  const cls = SOURCE_STYLES[sourceType] ?? "bg-fg/5 text-text-industrial/40 border-fg/10";
  return (
    <span className={`inline-block text-[10px] px-2 py-0.5 rounded-full border font-bold ${cls}`}>
      {sourceType}
    </span>
  );
}

function normalizeOptionalText(value: string): string | undefined {
  const text = value.trim();
  return text || undefined;
}

interface ReviewModalProps {
  deferralId: string;
  compensatoryMeasures?: string;
  onClose: () => void;
  onSuccess: () => void;
}

const ReviewModal: React.FC<ReviewModalProps> = ({ deferralId, compensatoryMeasures, onClose, onSuccess }) => {
  const t = useT();
  const [reviewNotes, setReviewNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const onSave = useCallback(async () => {
    setSaving(true);
    setActionError(null);
    try {
      await api.post(`/app/pms/deferrals/${deferralId}/review`, {
        reviewNotes: normalizeOptionalText(reviewNotes),
        compensatoryMeasures: compensatoryMeasures ?? null,
      });
      onSuccess();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t("common.saveError"));
    } finally {
      setSaving(false);
    }
  }, [compensatoryMeasures, deferralId, onSuccess, reviewNotes, t]);

  const isDirty = useDirtyTracker({ reviewNotes });
  useEscapeGuard({ isDirty, onSave, onClose });

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-2xl bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-fg/10">
          <h2 className="text-base font-bold text-fg">{t("def2.review")}</h2>
          <ModalCloseButton onClose={onClose} />
        </div>
        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">{t("def2.reviewNotes")}</label>
            <textarea rows={4} value={reviewNotes} onChange={e => setReviewNotes(e.target.value)} className="w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 disabled:opacity-60" />
          </div>
          {actionError && <p className="text-xs text-red-700 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{actionError}</p>}
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-fg/10">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-fg transition-colors">{t("common.cancel")}</button>
          <button onClick={() => { void onSave(); }} disabled={saving} className="px-4 py-2 rounded-xl bg-accent text-accent-fg font-bold text-xs hover:brightness-110 disabled:opacity-50 transition-all">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
};

interface ApproveModalProps {
  deferralId: string;
  initialTargetDate?: string | null;
  initialCompensatoryMeasures?: string | null;
  onClose: () => void;
  onSuccess: () => void;
}

const ApproveModal: React.FC<ApproveModalProps> = ({ deferralId, initialTargetDate, initialCompensatoryMeasures, onClose, onSuccess }) => {
  const t = useT();
  const [targetDate, setTargetDate] = useState(
    initialTargetDate ? new Date(initialTargetDate).toISOString().split("T")[0] ?? "" : ""
  );
  const [compensatoryMeasures, setCompensatoryMeasures] = useState(initialCompensatoryMeasures ?? "");
  const [approverName, setApproverName] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const onSave = useCallback(async () => {
    if (!approverName.trim()) {
      setActionError("El nombre del aprobador es obligatorio.");
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      await api.post(`/app/pms/deferrals/${deferralId}/approve`, {
        targetDate: targetDate || undefined,
        compensatoryMeasures: normalizeOptionalText(compensatoryMeasures),
        approverName: approverName.trim(),
      });
      onSuccess();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t("common.saveError"));
    } finally {
      setSaving(false);
    }
  }, [approverName, compensatoryMeasures, deferralId, onSuccess, t, targetDate]);

  const isDirty = useDirtyTracker({ targetDate, compensatoryMeasures, approverName });
  useEscapeGuard({ isDirty, onSave, onClose });

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-2xl bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-fg/10">
          <h2 className="text-base font-bold text-fg">{t("def2.approve")}</h2>
          <ModalCloseButton onClose={onClose} />
        </div>
        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">{t("label.approvedBy")} *</label>
            <input type="text" value={approverName} onChange={e => setApproverName(e.target.value)} placeholder="Nombre y apellido del aprobador" className="w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 disabled:opacity-60" />
          </div>
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">{t("def2.targetDate")}</label>
            <input type="date" value={targetDate} onChange={e => setTargetDate(e.target.value)} className="w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 disabled:opacity-60" />
          </div>
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">{t("def2.compensatory")}</label>
            <textarea rows={4} value={compensatoryMeasures} onChange={e => setCompensatoryMeasures(e.target.value)} className="w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 disabled:opacity-60" />
          </div>
          {actionError && <p className="text-xs text-red-700 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{actionError}</p>}
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-fg/10">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-fg transition-colors">{t("common.cancel")}</button>
          <button onClick={() => { void onSave(); }} disabled={saving || !approverName.trim()} className="px-4 py-2 rounded-xl bg-accent text-accent-fg font-bold text-xs hover:brightness-110 disabled:opacity-50 transition-all">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
};

interface RejectModalProps {
  deferralId: string;
  onClose: () => void;
  onSuccess: () => void;
}

const RejectModal: React.FC<RejectModalProps> = ({ deferralId, onClose, onSuccess }) => {
  const t = useT();
  const [rejectionReason, setRejectionReason] = useState("");
  const [rejectorName, setRejectorName] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const onSave = useCallback(async () => {
    if (!rejectorName.trim()) {
      setActionError("El nombre del rechazador es obligatorio.");
      return;
    }
    if (!rejectionReason.trim()) {
      setActionError(t("def2.rejectionReason"));
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      await api.post(`/app/pms/deferrals/${deferralId}/reject`, {
        rejectionReason: rejectionReason.trim(),
        rejectorName: rejectorName.trim(),
      });
      onSuccess();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t("common.saveError"));
    } finally {
      setSaving(false);
    }
  }, [deferralId, onSuccess, rejectionReason, rejectorName, t]);

  const isDirty = useDirtyTracker({ rejectionReason, rejectorName });
  useEscapeGuard({ isDirty, onSave, onClose });

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-2xl bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-fg/10">
          <h2 className="text-base font-bold text-fg">{t("def2.reject")}</h2>
          <ModalCloseButton onClose={onClose} />
        </div>
        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">{t("label.rejectedBy")} *</label>
            <input type="text" value={rejectorName} onChange={e => setRejectorName(e.target.value)} placeholder="Nombre y apellido del rechazador" className="w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 disabled:opacity-60" />
          </div>
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">{t("def2.rejectionReason")} *</label>
            <textarea rows={4} value={rejectionReason} onChange={e => setRejectionReason(e.target.value)} className="w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 disabled:opacity-60" />
          </div>
          {actionError && <p className="text-xs text-red-700 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{actionError}</p>}
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-fg/10">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-fg transition-colors">{t("common.cancel")}</button>
          <button onClick={() => { void onSave(); }} disabled={saving || !rejectorName.trim() || !rejectionReason.trim()} className="px-4 py-2 rounded-xl bg-accent text-accent-fg font-bold text-xs hover:brightness-110 disabled:opacity-50 transition-all">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
};

interface CloseDeferralModalProps {
  deferralId: string;
  onClose: () => void;
  onSuccess: () => void;
}

const CloseDeferralModal: React.FC<CloseDeferralModalProps> = ({ deferralId, onClose, onSuccess }) => {
  const t = useT();
  const [closeNotes, setCloseNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const onSave = useCallback(async () => {
    setSaving(true);
    setActionError(null);
    try {
      await api.post(`/app/pms/deferrals/${deferralId}/close`, {
        closeNotes: normalizeOptionalText(closeNotes),
      });
      onSuccess();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t("common.saveError"));
    } finally {
      setSaving(false);
    }
  }, [closeNotes, deferralId, onSuccess, t]);

  const isDirty = useDirtyTracker({ closeNotes });
  useEscapeGuard({ isDirty, onSave, onClose });

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-2xl bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-fg/10">
          <h2 className="text-base font-bold text-fg">{t("def2.close")}</h2>
          <ModalCloseButton onClose={onClose} />
        </div>
        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">{t("def.closeNotes")}</label>
            <textarea rows={4} value={closeNotes} onChange={e => setCloseNotes(e.target.value)} className="w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 disabled:opacity-60" />
          </div>
          {actionError && <p className="text-xs text-red-700 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{actionError}</p>}
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-fg/10">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-fg transition-colors">{t("common.cancel")}</button>
          <button onClick={() => { void onSave(); }} disabled={saving} className="px-4 py-2 rounded-xl bg-accent text-accent-fg font-bold text-xs hover:brightness-110 disabled:opacity-50 transition-all">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
};

interface DeferralModalProps {
  deferral: Deferral;
  onClose: () => void;
  onSuccess: () => void;
}

const DeferralModal: React.FC<DeferralModalProps> = ({ deferral, onClose, onSuccess }) => {
  const t = useT();
  const woTerms = useWoTerms();
  const [showReview, setShowReview] = useState(false);
  const [showApprove, setShowApprove] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [showClose, setShowClose] = useState(false);
  const [showMoc, setShowMoc] = useState(false);
  const [activating, setActivating] = useState(false);
  const [resolvingReferences, setResolvingReferences] = useState(false);
  const [assetDisplayName, setAssetDisplayName] = useState(deferral.assetName ?? deferral.assetId);
  const [sourceDisplayName, setSourceDisplayName] = useState(deferral.sourceId);
  const [actionError, setActionError] = useState<string | null>(null);
  const [compensatoryMeasures, setCompensatoryMeasures] = useState(deferral.compensatoryMeasures ?? "");
  const [loadingCompensatory, setLoadingCompensatory]   = useState(false);
  const [riskProbability, setRiskProbability]           = useState<RiskProbability>(toUiRiskProbability(deferral.riskProbability));
  const [riskConsequence, setRiskConsequence]           = useState<RiskConsequence>(toUiRiskConsequence(deferral.riskConsequence));
  const [riskLevel, setRiskLevel]                       = useState<RiskLevel>(toUiRiskLevel(deferral.riskLevel));
  const [riskAnalysisResult, setRiskAnalysisResult]     = useState(deferral.riskAnalysisResult ?? "");
  const [loadingRisk, setLoadingRisk]                   = useState(false);
  const [downloadingPdf, setDownloadingPdf]             = useState(false);
  const [cancelling, setCancelling]                     = useState(false);
  const [confirmCancel, setConfirmCancel]               = useState(false);
  const [saving, setSaving]                             = useState(false);
  const [savedOk, setSavedOk]                           = useState(false);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setActionError(null);
    setSavedOk(false);
    try {
      await api.patch(`/app/pms/deferrals/${deferral.id}`, {
        compensatoryMeasures,
        riskProbability: riskProbability || null,
        riskConsequence: riskConsequence || null,
        riskLevel: riskLevel || null,
        riskAnalysisResult,
      });
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 2500);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t("common.saveError"));
    } finally {
      setSaving(false);
    }
  }, [compensatoryMeasures, riskProbability, riskConsequence, riskLevel, riskAnalysisResult, deferral.id, t]);

  const handleDeferralRiskClick = useCallback(async () => {
    if (loadingRisk) return;
    setLoadingRisk(true);
    try {
      const res = await api.post<{ level: string; probability: string | null; consequence: string | null; analysis: string }>(
        "/app/pms/deferrals/suggest-deferral-risk",
        { deferralId: deferral.id },
      );
      const aiProb = toUiRiskProbability(res.probability);
      const aiCons = toUiRiskConsequence(res.consequence);
      if (aiProb && aiCons) {
        setRiskProbability(aiProb);
        setRiskConsequence(aiCons);
        setRiskLevel(deriveRiskLevelFromMatrix(aiProb, aiCons));
      } else if (res.level) {
        setRiskLevel(toUiRiskLevel(res.level));
      }
      if (res.analysis) setRiskAnalysisResult(res.analysis);
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : "No se pudo generar el análisis de riesgo con IA.");
    } finally {
      setLoadingRisk(false);
    }
  }, [loadingRisk, deferral.deferralCode, deferral.vesselCode, deferral.targetDate, deferral.justification, deferral.sourceCode, assetDisplayName, sourceDisplayName, woTerms]);

  // ESC guard
  const isDeferralDirty = compensatoryMeasures !== (deferral.compensatoryMeasures ?? "")
    || (riskProbability || "") !== (toUiRiskProbability(deferral.riskProbability) || "")
    || (riskConsequence || "") !== (toUiRiskConsequence(deferral.riskConsequence) || "")
    || riskAnalysisResult !== (deferral.riskAnalysisResult ?? "");
  useEscapeGuard({
    enabled: !showReview && !showApprove && !showReject && !showClose && !confirmCancel,
    isDirty: isDeferralDirty,
    onSave: handleSave,
    onClose,
  });

  const handleCancelDeferral = useCallback(async () => {
    setCancelling(true);
    setActionError(null);
    try {
      await api.delete(`/app/pms/deferrals/${deferral.id}`);
      onSuccess();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t("common.deleteError"));
      setConfirmCancel(false);
    } finally {
      setCancelling(false);
    }
  }, [deferral.id, onSuccess, t]);

  const handleDownloadPdf = useCallback(async () => {
    setDownloadingPdf(true);
    try {
      // Persist locally edited compensatory measures + risk before generating PDF (en estados no terminales)
      if (!isTerminal && isDeferralDirty) {
        try {
          await api.patch(`/app/pms/deferrals/${deferral.id}`, {
            compensatoryMeasures,
            riskProbability: riskProbability || null,
            riskConsequence: riskConsequence || null,
            riskLevel: riskLevel || null,
            riskAnalysisResult,
          });
        } catch { /* non-blocking */ }
      }
      const token = localStorage.getItem("gpms_token") ?? "";
      const slug  = localStorage.getItem("gpms_tenant_slug") ?? "";
      const res   = await fetch(`/app/pms/deferrals/${deferral.id}/pdf`, {
        headers: { Authorization: `Bearer ${token}`, "X-Tenant-Slug": slug },
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `${deferral.deferralCode}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloadingPdf(false);
    }
  }, [deferral.id, deferral.deferralCode, deferral.status, deferral.compensatoryMeasures, compensatoryMeasures, isDeferralDirty, riskProbability, riskConsequence, riskLevel, riskAnalysisResult]);

  const resolveSourceLabel = useCallback(async (): Promise<string> => {
    try {
      if (deferral.sourceType === "WORK_ORDER") {
        const workOrder = await api.get<WorkOrderReference>(`/app/pms/work-orders/${deferral.sourceId}`);
        if (workOrder.title?.trim()) return workOrder.title.trim();
        if (workOrder.workOrderCode?.trim()) return workOrder.workOrderCode.trim();
        return deferral.sourceId;
      }

      if (deferral.sourceType === "DEFECT") {
        const defect = await api.get<DefectReference>(`/app/pms/defects/${deferral.sourceId}`);
        if (defect.classification?.trim()) return defect.classification.trim();
        if (defect.defectCode?.trim()) return defect.defectCode.trim();
        return deferral.sourceId;
      }

      if (deferral.sourceType === "MAINTENANCE_PLAN") {
        const plan = await api.get<MaintenancePlanReference>(`/app/pms/maintenance-plans/${deferral.sourceId}`);
        if (plan.title?.trim()) return plan.title.trim();
        if (plan.taskCode?.trim()) return plan.taskCode.trim();
        return deferral.sourceId;
      }
    } catch {
      return deferral.sourceId;
    }

    return deferral.sourceId;
  }, [deferral.sourceId, deferral.sourceType]);

  useEffect(() => {
    let cancelled = false;

    const resolveReferences = async () => {
      setResolvingReferences(true);
      setAssetDisplayName(deferral.assetName ?? deferral.assetId);
      setSourceDisplayName(deferral.sourceId);
      try {
        const sourceName = await resolveSourceLabel();
        if (cancelled) return;
        setSourceDisplayName(sourceName);
      } finally {
        if (!cancelled) setResolvingReferences(false);
      }
    };

    void resolveReferences();

    return () => {
      cancelled = true;
    };
  }, [deferral.assetId, deferral.sourceId, resolveSourceLabel]);

  const onActivate = useCallback(async () => {
    setActivating(true);
    setActionError(null);
    try {
      await api.post(`/app/pms/deferrals/${deferral.id}/activate`, {});
      onSuccess();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t("common.saveError"));
    } finally {
      setActivating(false);
    }
  }, [deferral.id, onSuccess, t]);

  const showRequestedActions = deferral.status === "REQUESTED";
  const showUnderReviewActions = deferral.status === "UNDER_REVIEW";
  const showApprovedActions = deferral.status === "APPROVED";
  const showActiveActions = deferral.status === "ACTIVE";

  const isTerminal = ["EXPIRED", "REJECTED", "CLOSED"].includes(deferral.status);
  useCopilotScreenContext();

  const handleCompensatoryClick = useCallback(async () => {
    if (isTerminal || loadingCompensatory) return;
    setLoadingCompensatory(true);
    setActionError(null);
    try {
      const res = await api.post<{ text: string }>("/app/pms/deferrals/suggest-compensatory-measures", {
        deferralId: deferral.id,
      });
      if (res.text) setCompensatoryMeasures(res.text);
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : "No se pudo generar las medidas compensatorias con IA.");
    }
    finally { setLoadingCompensatory(false); }
  }, [isTerminal, loadingCompensatory, deferral, sourceDisplayName, woTerms]);
  useCopilotEmitter({
    module: "DEFERRALS",
    screen: "DEFERRAL_VIEW",
    entityId: deferral.id,
    entityCode: deferral.deferralCode,
    vesselCode: deferral.vesselCode,
    workflowStage: deferral.status,
    canEdit: !isTerminal,
    fieldValues: {
      justification: deferral.justification ?? null,
      compensatoryMeasures: deferral.compensatoryMeasures ?? null,
      sourceType: deferral.sourceType ?? null,
      targetDate: deferral.targetDate ? new Date(deferral.targetDate).toISOString().split("T")[0] : null,
    },
    relatedEntities: { sourceId: deferral.sourceId },
  });

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
        <div className="w-full max-w-2xl bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between px-6 py-4 border-b border-fg/10">
            <h2 className="text-base font-bold text-fg">{t("page.deferrals")}</h2>
            <div className="flex items-center gap-1.5">
              <CopyLinkButton />
              <ModalCloseButton onClose={onClose} />
            </div>
          </div>
          <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="bg-fg/5 border border-fg/10 rounded-xl p-3">
                <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t("col.code")}</p>
                <p className="text-sm font-mono font-bold text-fg">{deferral.deferralCode}</p>
              </div>
              <div className="bg-fg/5 border border-fg/10 rounded-xl p-3">
                <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t("col.vessel")}</p>
                <p className="text-sm"><VesselLabel code={deferral.vesselCode} className="text-sm" showCode /></p>
              </div>
              <div className="bg-fg/5 border border-fg/10 rounded-xl p-3">
                <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">Asset</p>
                <p className="text-sm text-fg">{assetDisplayName}</p>
              </div>
              <div className="bg-fg/5 border border-fg/10 rounded-xl p-3">
                <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t("def2.sourceType")}</p>
                <p className="text-sm text-fg">{deferral.sourceType}</p>
              </div>
              <div className="bg-fg/5 border border-fg/10 rounded-xl p-3">
                <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">Source</p>
                <p className="text-sm text-fg">{sourceDisplayName}</p>
              </div>
              <div className="bg-fg/5 border border-fg/10 rounded-xl p-3">
                <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t("col.requested")}</p>
                <p className="text-sm text-fg">
                  {deferral.requestedByName ?? "—"}
                  <span className="text-text-industrial/50"> · {fmtDate(deferral.requestedAt)}</span>
                </p>
              </div>
              {deferral.targetDate && (
                <div className="bg-fg/5 border border-fg/10 rounded-xl p-3">
                  <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t("def2.targetDate")}</p>
                  <p className="text-sm text-fg">{fmtDate(deferral.targetDate)}</p>
                </div>
              )}
              {deferral.justification && (
                <div className="bg-fg/5 border border-fg/10 rounded-xl p-3 sm:col-span-2">
                  <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t("def2.justification")}</p>
                  <p className="text-sm text-fg whitespace-pre-wrap">{deferral.justification}</p>
                </div>
              )}
              {/* Análisis de riesgo del diferimiento (entre Justificación y Medidas Compensatorias) */}
              <div className="sm:col-span-2 space-y-3">
                <RiskMatrix
                  probability={riskProbability}
                  consequence={riskConsequence}
                  level={riskLevel}
                  result={riskAnalysisResult}
                  readOnly={isTerminal}
                  loading={loadingRisk}
                  onSelect={(p, c, lvl) => { setRiskProbability(p); setRiskConsequence(c); setRiskLevel(lvl); }}
                  onResultChange={setRiskAnalysisResult}
                  onSuggest={handleDeferralRiskClick}
                  aiTooltip="Click para que la IA evalúe el riesgo de diferir"
                />
              </div>
              <div className="sm:col-span-2 space-y-1.5">
                <button
                  type="button"
                  onClick={handleCompensatoryClick}
                  disabled={isTerminal || loadingCompensatory}
                  className={`flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-bold transition-colors ${
                    !isTerminal
                      ? loadingCompensatory
                        ? "text-accent/50 animate-pulse cursor-default"
                        : "text-accent/70 hover:text-accent cursor-pointer"
                      : "text-text-industrial/40 cursor-default"
                  }`}
                  title={!isTerminal ? "Click para que la IA genere las medidas compensatorias" : undefined}
                >
                  <Sparkles className="w-3 h-3 shrink-0" />
                  {t("def2.compensatory")}
                  {loadingCompensatory && <span className="ml-1 normal-case font-normal">analizando...</span>}
                </button>
                {!isTerminal ? (
                  <textarea
                    rows={3}
                    value={compensatoryMeasures}
                    onChange={e => setCompensatoryMeasures(e.target.value)}
                    disabled={loadingCompensatory}
                    placeholder="Click en el título para generar con IA, o escribí manualmente…"
                    className="w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 resize-y disabled:opacity-60"
                  />
                ) : (
                  <div className="bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg whitespace-pre-wrap min-h-[2.5rem]">
                    {compensatoryMeasures || <span className="text-text-industrial/30 italic">—</span>}
                  </div>
                )}
              </div>
              {deferral.reviewNotes && (
                <div className="bg-fg/5 border border-fg/10 rounded-xl p-3 sm:col-span-2">
                  <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t("def2.reviewNotes")}</p>
                  <p className="text-sm text-fg whitespace-pre-wrap">{deferral.reviewNotes}</p>
                </div>
              )}
              {deferral.decisionAt && (
                <div className="bg-fg/5 border border-fg/10 rounded-xl p-3 sm:col-span-2">
                  <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">
                    {deferral.status === "APPROVED" ? t("label.approvedBy") : deferral.status === "REJECTED" ? t("label.rejectedBy") : t("label.decision")}
                  </p>
                  <p className="text-sm text-fg">
                    {deferral.status === "APPROVED"
                      ? (deferral.approverName ?? deferral.decidedByName ?? "—")
                      : deferral.status === "REJECTED"
                        ? (deferral.rejectorName ?? deferral.decidedByName ?? "—")
                        : (deferral.decidedByName ?? "—")}
                    <span className="text-text-industrial/50"> · {fmtDate(deferral.decisionAt)}</span>
                    {deferral.decidedByName && (
                      (deferral.status === "APPROVED" && deferral.approverName && deferral.approverName !== deferral.decidedByName) ||
                      (deferral.status === "REJECTED" && deferral.rejectorName && deferral.rejectorName !== deferral.decidedByName)
                    ) && (
                      <span className="text-text-industrial/40 text-xs"> (registrado por {deferral.decidedByName})</span>
                    )}
                  </p>
                </div>
              )}
              {deferral.activeSince && (
                <div className="bg-fg/5 border border-fg/10 rounded-xl p-3">
                  <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t("def2.activeSince")}</p>
                  <p className="text-sm text-fg">{fmtDate(deferral.activeSince)}</p>
                </div>
              )}
              {deferral.closedAt && (
                <div className="bg-fg/5 border border-fg/10 rounded-xl p-3">
                  <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t("col.closed")}</p>
                  <p className="text-sm text-fg">{fmtDate(deferral.closedAt)}</p>
                </div>
              )}
              {deferral.closeNotes && (
                <div className="bg-fg/5 border border-fg/10 rounded-xl p-3 sm:col-span-2">
                  <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t("def.closeNotes")}</p>
                  <p className="text-sm text-fg whitespace-pre-wrap">{deferral.closeNotes}</p>
                </div>
              )}
              {deferral.rejectionReason && (
                <div className="bg-fg/5 border border-fg/10 rounded-xl p-3 sm:col-span-2">
                  <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t("def2.rejectionReason")}</p>
                  <p className="text-sm text-fg whitespace-pre-wrap">{deferral.rejectionReason}</p>
                </div>
              )}
            </div>
            {resolvingReferences && (
              <div className="flex items-center gap-2 text-xs text-text-industrial/60">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
                Resolviendo nombres de referencias...
              </div>
            )}
            {actionError && <p className="text-xs text-red-700 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{actionError}</p>}
          </div>
          <div className="flex items-center justify-between gap-2 px-6 py-4 border-t border-fg/10">
            <div className="flex items-center gap-2">
              <button
                onClick={() => { void handleDownloadPdf(); }}
                disabled={downloadingPdf}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-fg/5 border border-fg/10 text-xs text-text-industrial hover:border-accent/30 disabled:opacity-50 transition-all"
              >
                {downloadingPdf ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                PDF
              </button>
              {/* Abrir MOC: una postergación activa que implica operar con
                * redundancia degradada o bypass amerita un MOC TEMPORARY
                * formal para auditoría SIRE / TMSA. Prefilleamos los campos
                * desde el deferral. */}
              <button
                onClick={() => setShowMoc(true)}
                title="Abrir Management of Change desde esta postergación"
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-fg/5 border border-fg/10 text-xs text-text-industrial hover:border-accent/30 transition-all"
              >
                <GitBranch className="w-3.5 h-3.5" />
                Abrir MOC
              </button>
            </div>
            <div className="flex items-center gap-2">
              {showRequestedActions && (
                <button
                  onClick={() => {
                    if (confirmCancel) { void handleCancelDeferral(); }
                    else { setConfirmCancel(true); }
                  }}
                  disabled={cancelling}
                  title="Cancelar el diferimiento (eliminar)"
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-bold transition-all disabled:opacity-50 ${
                    confirmCancel
                      ? "bg-red-500 text-fg border-red-500 hover:bg-red-600"
                      : "bg-red-500/10 border-red-500/20 text-red-700 dark:text-red-400 hover:bg-red-500/20"
                  }`}
                >
                  {cancelling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  {confirmCancel ? t("confirm.confirmQ") : t("confirm.cancelDeferral")}
                </button>
              )}
              {showRequestedActions && (
                <button
                  onClick={() => { void handleSave(); }}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-fg/5 border border-fg/10 text-fg font-bold text-xs hover:bg-fg/10 disabled:opacity-50 transition-all"
                >
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  {savedOk ? "Guardado ✓" : t("common.save")}
                </button>
              )}
              {showRequestedActions && (
                <button onClick={() => setShowReview(true)} className="px-4 py-2 rounded-xl bg-accent/10 border border-accent/20 text-accent font-bold text-xs hover:brightness-110 transition-all">
                  {t("def2.review")}
                </button>
              )}
              {showUnderReviewActions && (
                <>
                  <button onClick={() => setShowApprove(true)} className="px-4 py-2 rounded-xl bg-success-sea/10 border border-success-sea/20 text-success-sea font-bold text-xs hover:brightness-110 transition-all">
                    {t("def2.approve")}
                  </button>
                  <button onClick={() => setShowReject(true)} className="px-4 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-700 dark:text-red-400 font-bold text-xs hover:bg-red-500/20 transition-all">
                    {t("def2.reject")}
                  </button>
                </>
              )}
              {showApprovedActions && (
                <button onClick={() => { void onActivate(); }} disabled={activating} className="px-4 py-2 rounded-xl bg-accent/10 border border-accent/20 text-accent font-bold text-xs hover:brightness-110 disabled:opacity-50 transition-all">
                  {activating ? <Loader2 className="w-4 h-4 animate-spin" /> : t("def2.activate")}
                </button>
              )}
              {showActiveActions && (
                <button onClick={() => setShowClose(true)} className="px-4 py-2 rounded-xl bg-success-sea/10 border border-success-sea/20 text-success-sea font-bold text-xs hover:brightness-110 transition-all">
                  {t("def2.close")}
                </button>
              )}
              <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-fg transition-colors">{t("common.cancel")}</button>
            </div>
          </div>
        </div>
      </div>

      {showReview && (
        <ReviewModal
          deferralId={deferral.id}
          compensatoryMeasures={compensatoryMeasures}
          onClose={() => setShowReview(false)}
          onSuccess={() => { setShowReview(false); onClose(); onSuccess(); }}
        />
      )}
      {showApprove && (
        <ApproveModal
          deferralId={deferral.id}
          initialTargetDate={deferral.targetDate}
          initialCompensatoryMeasures={compensatoryMeasures || deferral.compensatoryMeasures}
          onClose={() => setShowApprove(false)}
          onSuccess={() => { setShowApprove(false); onClose(); onSuccess(); }}
        />
      )}
      {showReject && (
        <RejectModal
          deferralId={deferral.id}
          onClose={() => setShowReject(false)}
          onSuccess={() => { setShowReject(false); onClose(); onSuccess(); }}
        />
      )}
      {showClose && (
        <CloseDeferralModal
          deferralId={deferral.id}
          onClose={() => setShowClose(false)}
          onSuccess={() => { setShowClose(false); onClose(); onSuccess(); }}
        />
      )}
      {showMoc && (() => {
        const prefill: MocPrefill = {
          category: "TEMPORARY",
          vesselCode: deferral.vesselCode,
          title: `Operación con ${deferral.sourceCode ?? deferral.sourceType} postergada — ${deferral.assetName ?? "activo"}`,
          reasonForChange: `Se postergó ${deferral.sourceType === "WORK_ORDER" ? `la ${woTerms.abbr}` : deferral.sourceType === "DEFECT" ? "el defecto" : "el plan"} ${deferral.sourceCode ?? ""}${deferral.justification ? `. Justificación: ${deferral.justification}` : ""}.`,
          proposedChange: deferral.compensatoryMeasures
            ? `Operación con las siguientes medidas compensatorias hasta el cierre de la postergación${deferral.targetDate ? ` (target: ${fmtDate(deferral.targetDate)})` : ""}:\n\n${deferral.compensatoryMeasures}`
            : `Operación con redundancia degradada hasta el cierre de la postergación${deferral.targetDate ? ` (target: ${fmtDate(deferral.targetDate)})` : ""}.`,
          mitigationActions: deferral.compensatoryMeasures ?? "",
          relatedWorkOrderId: deferral.sourceType === "WORK_ORDER" ? deferral.sourceId : undefined,
          sourceLabel: `Desde Postergación ${deferral.deferralCode} (${deferral.assetName ?? deferral.assetId}). El MOC documenta el cambio operacional mientras dura la postergación; ambos registros conviven hasta el cierre.`,
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
    </>
  );
};

export const DeferralsPage: React.FC = () => {
  const t = useT();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { code: linkCode, open: openLink, close: closeLink } = useDeepLink("/deferrals");
  const [editing, setEditing] = useState<Deferral | null>(null);
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  useCopilotEmitter(!editing ? { module: "DEFERRALS", screen: "DEFERRAL_LIST" } : null);

  const statusFilter = (searchParams.get("status") ?? "").trim();
  const sourceTypeFilter = (searchParams.get("sourceType") ?? "").trim();
  const vesselFilter = (searchParams.get("vesselCode") ?? "").trim();
  const [vesselInput, setVesselInput] = useState(vesselFilter);

  useEffect(() => {
    setVesselInput(vesselFilter);
  }, [vesselFilter]);

  const updateFilters = useCallback((next: { status?: string; sourceType?: string; vesselCode?: string }) => {
    const params = new URLSearchParams(searchParams);
    const nextStatus = next.status !== undefined ? next.status : statusFilter;
    const nextSourceType = next.sourceType !== undefined ? next.sourceType : sourceTypeFilter;
    const nextVessel = next.vesselCode !== undefined ? next.vesselCode : vesselFilter;
    if (nextStatus) params.set("status", nextStatus); else params.delete("status");
    if (nextSourceType) params.set("sourceType", nextSourceType); else params.delete("sourceType");
    if (nextVessel) params.set("vesselCode", nextVessel); else params.delete("vesselCode");
    setSearchParams(params, { replace: true });
  }, [searchParams, setSearchParams, sourceTypeFilter, statusFilter, vesselFilter]);

  const path = useMemo(() => {
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    if (sourceTypeFilter) params.set("sourceType", sourceTypeFilter);
    if (vesselFilter) params.set("vesselCode", vesselFilter);
    const query = params.toString();
    return `/app/pms/deferrals${query ? `?${query}` : ""}`;
  }, [sourceTypeFilter, statusFilter, vesselFilter]);

  const { data, loading, error, reload } = useFetch<ListResponse>(path, [path]);

  // Compat: `?autoCode=` → redirige a la ruta deep-link `/deferrals/:code`.
  const autoCode = (searchParams.get("autoCode") ?? "").trim();
  // `replace`: puente, no destino (ver useDeepLink). Si quedara en el historial,
  // cerrar el diferimiento volvería acá y se reabriría solo.
  useEffect(() => {
    if (autoCode) openLink(autoCode, { replace: true });
  }, [autoCode, openLink]);

  const openDetail = useCallback(async (row: Deferral) => {
    setDetailLoadingId(row.id);
    setDetailError(null);
    try {
      const detailed = await api.get<Deferral>(`/app/pms/deferrals/${row.id}`);
      setEditing(detailed);
    } catch (err) {
      setEditing(row);
      setDetailError(err instanceof ApiError ? err.message : "No se pudo cargar el detalle del diferimiento.");
    } finally {
      setDetailLoadingId(null);
    }
  }, []);

  // Deep-link: la URL `/deferrals/:code` es la fuente de verdad del detalle.
  useEffect(() => {
    if (!linkCode) { if (editing) setEditing(null); return; }
    if (editing?.deferralCode === linkCode) return;
    const inList = data?.items?.find(d => d.deferralCode === linkCode);
    if (inList) { void openDetail(inList); return; }
    // Fuera de los filtros actuales → buscar sin filtro por código.
    setDetailLoadingId("deeplink");
    api.get<{ items: Deferral[] }>(`/app/pms/deferrals`)
      .then(r => {
        const m = r.items.find(d => d.deferralCode === linkCode);
        if (m) return api.get<Deferral>(`/app/pms/deferrals/${m.id}`).then(setEditing).catch(() => setEditing(m));
      })
      .catch(() => {})
      .finally(() => setDetailLoadingId(null));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkCode, data, editing]);

  const columns: Column<Deferral>[] = useMemo(() => [
    {
      key: "deferralCode",
      header: t("col.code"),
      render: row => <span className="font-mono font-bold text-fg text-xs">{row.deferralCode}</span>,
    },
    {
      key: "sourceType",
      header: t("def2.sourceType"),
      render: row => <SourceTypeBadge sourceType={row.sourceType} />,
    },
    {
      key: "sourceCode",
      header: "Documento",
      render: row => {
        const route = SOURCE_ROUTE[row.sourceType];
        if (!row.sourceCode) return <span className="text-text-industrial/30 text-xs">—</span>;
        if (!route) return <span className="font-mono text-xs text-text-industrial/60">{row.sourceCode}</span>;
        // WO usa autoCode (workOrderCode), el resto usa openId (id interno)
        const queryParam = row.sourceType === "WORK_ORDER"
          ? `autoCode=${encodeURIComponent(row.sourceCode)}`
          : `openId=${encodeURIComponent(row.sourceId)}`;
        return (
          <button
            onClick={e => { e.stopPropagation(); navigate(`${route}?${queryParam}`); }}
            className="flex items-center gap-1 font-mono text-xs text-accent hover:text-fg bg-fg/5 hover:bg-accent/10 border border-fg/10 hover:border-accent/30 rounded px-1.5 py-0.5 transition-all"
          >
            {row.sourceCode}
            <ExternalLink className="w-2.5 h-2.5 opacity-60 shrink-0" />
          </button>
        );
      },
    },
    {
      key: "vesselCode",
      header: t("col.vessel"),
      render: row => <VesselLabel code={row.vesselCode} className="text-xs" showCode />,
    },
    {
      key: "status",
      header: t("col.status"),
      render: row => <StatusBadge status={row.status} />,
    },
    {
      key: "requestedAt",
      header: t("col.requested"),
      render: row => fmtDate(row.requestedAt),
    },
    {
      key: "targetDate",
      header: t("def2.targetDate"),
      render: row => fmtDate(row.targetDate),
    },
  ], [t]);

  return (
    <div className="space-y-5">
      <PageHeader icon={Clock} title={t("page.deferrals")} total={data?.total} onReload={reload}>
        <ExportExcelButton module="deferrals" />
      </PageHeader>

      {detailLoadingId && <div className="flex items-center gap-2 text-xs text-text-industrial/60"><Loader2 className="w-4 h-4 animate-spin text-accent" />Cargando detalle del diferimiento...</div>}
      {detailError && <p className="text-xs text-red-700 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{detailError}</p>}

      <DataTable columns={columns} data={data?.items ?? null} loading={loading} error={error} keyFn={row => row.id} emptyText={t("empty.deferrals")} onRowClick={row => openLink(row.deferralCode)} />

      {editing && (
        <DeferralModal
          deferral={editing}
          onClose={() => closeLink()}
          onSuccess={() => { void reload(); }}
        />
      )}
    </div>
  );
};
