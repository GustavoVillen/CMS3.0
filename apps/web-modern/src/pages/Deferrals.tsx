import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Clock, Loader2, X } from "lucide-react";
import { useFetch } from "../lib/hooks";
import { api, ApiError } from "../lib/api";
import { DataTable, StatusBadge, type Column } from "../components/DataTable";
import { fmtDate, FILTER_ALL_VALUE, fromFilterSelectValue, toFilterSelectValue } from "../lib/utils";
import { PageHeader } from "../components/PageHeader";
import { useT } from "../lib/i18n";
import { useCopilotEmitter, useCopilotScreenContext } from "../lib/copilot-context";

interface Deferral {
  id: string;
  tenantId: string;
  vesselCode: string;
  assetId: string;
  assetName: string | null;
  sourceType: string;
  sourceId: string;
  deferralCode: string;
  status: string;
  requestedAt: string;
  requestedByUserId: string;
  targetDate: string | null;
  justification: string | null;
  compensatoryMeasures: string | null;
  reviewNotes: string | null;
  decisionAt: string | null;
  decidedByUserId: string | null;
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
  DEFECT: "bg-red-500/10 text-red-400 border-red-500/20",
  WORK_ORDER: "bg-accent/10 text-accent border-accent/20",
  MAINTENANCE_PLAN: "bg-blue-500/10 text-blue-400 border-blue-500/20",
};

function SourceTypeBadge({ sourceType }: { sourceType: string }) {
  const cls = SOURCE_STYLES[sourceType] ?? "bg-white/5 text-text-industrial/40 border-white/10";
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
  onClose: () => void;
  onSuccess: () => void;
}

const ReviewModal: React.FC<ReviewModalProps> = ({ deferralId, onClose, onSuccess }) => {
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
      });
      onSuccess();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t("common.saveError"));
    } finally {
      setSaving(false);
    }
  }, [deferralId, onSuccess, reviewNotes, t]);

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-2xl bg-[#0D1B2A] border border-white/10 rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <h2 className="text-base font-bold text-white">{t("def2.review")}</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-text-industrial/40 hover:text-white" /></button>
        </div>
        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">{t("def2.reviewNotes")}</label>
            <textarea rows={4} value={reviewNotes} onChange={e => setReviewNotes(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 disabled:opacity-60" />
          </div>
          {actionError && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{actionError}</p>}
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-white/10">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-white transition-colors">{t("common.cancel")}</button>
          <button onClick={() => { void onSave(); }} disabled={saving} className="px-4 py-2 rounded-xl bg-accent text-primary-bg font-bold text-xs hover:brightness-110 disabled:opacity-50 transition-all">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
};

interface ApproveModalProps {
  deferralId: string;
  onClose: () => void;
  onSuccess: () => void;
}

const ApproveModal: React.FC<ApproveModalProps> = ({ deferralId, onClose, onSuccess }) => {
  const t = useT();
  const [targetDate, setTargetDate] = useState("");
  const [compensatoryMeasures, setCompensatoryMeasures] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const onSave = useCallback(async () => {
    setSaving(true);
    setActionError(null);
    try {
      await api.post(`/app/pms/deferrals/${deferralId}/approve`, {
        targetDate: targetDate || undefined,
        compensatoryMeasures: normalizeOptionalText(compensatoryMeasures),
      });
      onSuccess();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t("common.saveError"));
    } finally {
      setSaving(false);
    }
  }, [compensatoryMeasures, deferralId, onSuccess, t, targetDate]);

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-2xl bg-[#0D1B2A] border border-white/10 rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <h2 className="text-base font-bold text-white">{t("def2.approve")}</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-text-industrial/40 hover:text-white" /></button>
        </div>
        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">{t("def2.targetDate")}</label>
            <input type="date" value={targetDate} onChange={e => setTargetDate(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 disabled:opacity-60" />
          </div>
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">{t("def2.compensatory")}</label>
            <textarea rows={4} value={compensatoryMeasures} onChange={e => setCompensatoryMeasures(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 disabled:opacity-60" />
          </div>
          {actionError && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{actionError}</p>}
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-white/10">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-white transition-colors">{t("common.cancel")}</button>
          <button onClick={() => { void onSave(); }} disabled={saving} className="px-4 py-2 rounded-xl bg-accent text-primary-bg font-bold text-xs hover:brightness-110 disabled:opacity-50 transition-all">
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
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const onSave = useCallback(async () => {
    if (!rejectionReason.trim()) {
      setActionError(t("def2.rejectionReason"));
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      await api.post(`/app/pms/deferrals/${deferralId}/reject`, {
        rejectionReason: rejectionReason.trim(),
      });
      onSuccess();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t("common.saveError"));
    } finally {
      setSaving(false);
    }
  }, [deferralId, onSuccess, rejectionReason, t]);

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-2xl bg-[#0D1B2A] border border-white/10 rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <h2 className="text-base font-bold text-white">{t("def2.reject")}</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-text-industrial/40 hover:text-white" /></button>
        </div>
        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">{t("def2.rejectionReason")}</label>
            <textarea rows={4} value={rejectionReason} onChange={e => setRejectionReason(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 disabled:opacity-60" />
          </div>
          {actionError && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{actionError}</p>}
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-white/10">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-white transition-colors">{t("common.cancel")}</button>
          <button onClick={() => { void onSave(); }} disabled={saving} className="px-4 py-2 rounded-xl bg-accent text-primary-bg font-bold text-xs hover:brightness-110 disabled:opacity-50 transition-all">
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

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-2xl bg-[#0D1B2A] border border-white/10 rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <h2 className="text-base font-bold text-white">{t("def2.close")}</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-text-industrial/40 hover:text-white" /></button>
        </div>
        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">{t("def.closeNotes")}</label>
            <textarea rows={4} value={closeNotes} onChange={e => setCloseNotes(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 disabled:opacity-60" />
          </div>
          {actionError && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{actionError}</p>}
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-white/10">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-white transition-colors">{t("common.cancel")}</button>
          <button onClick={() => { void onSave(); }} disabled={saving} className="px-4 py-2 rounded-xl bg-accent text-primary-bg font-bold text-xs hover:brightness-110 disabled:opacity-50 transition-all">
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
  const [showReview, setShowReview] = useState(false);
  const [showApprove, setShowApprove] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [showClose, setShowClose] = useState(false);
  const [activating, setActivating] = useState(false);
  const [resolvingReferences, setResolvingReferences] = useState(false);
  const [assetDisplayName, setAssetDisplayName] = useState(deferral.assetName ?? deferral.assetId);
  const [sourceDisplayName, setSourceDisplayName] = useState(deferral.sourceId);
  const [actionError, setActionError] = useState<string | null>(null);

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
  const { setRequestMessage } = useCopilotScreenContext();
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
        <div className="w-full max-w-2xl bg-[#0D1B2A] border border-white/10 rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
            <h2 className="text-base font-bold text-white">{t("page.deferrals")}</h2>
            <button onClick={onClose}><X className="w-5 h-5 text-text-industrial/40 hover:text-white" /></button>
          </div>
          <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t("col.code")}</p>
                <p className="text-sm font-mono font-bold text-white">{deferral.deferralCode}</p>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t("col.vessel")}</p>
                <p className="text-sm font-mono text-accent">{deferral.vesselCode}</p>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">Asset</p>
                <p className="text-sm text-white">{assetDisplayName}</p>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t("def2.sourceType")}</p>
                <p className="text-sm text-white">{deferral.sourceType}</p>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">Source</p>
                <p className="text-sm text-white">{sourceDisplayName}</p>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t("col.requested")}</p>
                <p className="text-sm text-white">{fmtDate(deferral.requestedAt)}</p>
              </div>
              {deferral.targetDate && (
                <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                  <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t("def2.targetDate")}</p>
                  <p className="text-sm text-white">{fmtDate(deferral.targetDate)}</p>
                </div>
              )}
              {deferral.justification && (
                <div className="bg-white/5 border border-white/10 rounded-xl p-3 sm:col-span-2">
                  <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t("def2.justification")}</p>
                  <p className="text-sm text-white whitespace-pre-wrap">{deferral.justification}</p>
                </div>
              )}
              {deferral.compensatoryMeasures && (
                <div className="bg-white/5 border border-white/10 rounded-xl p-3 sm:col-span-2">
                  <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t("def2.compensatory")}</p>
                  <p className="text-sm text-white whitespace-pre-wrap">{deferral.compensatoryMeasures}</p>
                </div>
              )}
              {deferral.reviewNotes && (
                <div className="bg-white/5 border border-white/10 rounded-xl p-3 sm:col-span-2">
                  <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t("def2.reviewNotes")}</p>
                  <p className="text-sm text-white whitespace-pre-wrap">{deferral.reviewNotes}</p>
                </div>
              )}
              {deferral.decisionAt && (
                <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                  <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">Decision At</p>
                  <p className="text-sm text-white">{fmtDate(deferral.decisionAt)}</p>
                </div>
              )}
              {deferral.activeSince && (
                <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                  <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t("def2.activeSince")}</p>
                  <p className="text-sm text-white">{fmtDate(deferral.activeSince)}</p>
                </div>
              )}
              {deferral.closedAt && (
                <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                  <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t("col.closed")}</p>
                  <p className="text-sm text-white">{fmtDate(deferral.closedAt)}</p>
                </div>
              )}
              {deferral.closeNotes && (
                <div className="bg-white/5 border border-white/10 rounded-xl p-3 sm:col-span-2">
                  <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t("def.closeNotes")}</p>
                  <p className="text-sm text-white whitespace-pre-wrap">{deferral.closeNotes}</p>
                </div>
              )}
              {deferral.rejectionReason && (
                <div className="bg-white/5 border border-white/10 rounded-xl p-3 sm:col-span-2">
                  <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t("def2.rejectionReason")}</p>
                  <p className="text-sm text-white whitespace-pre-wrap">{deferral.rejectionReason}</p>
                </div>
              )}
            </div>
            {resolvingReferences && (
              <div className="flex items-center gap-2 text-xs text-text-industrial/60">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
                Resolviendo nombres de referencias...
              </div>
            )}
            {!isTerminal && (
              <div className="flex items-center justify-between gap-2 rounded-xl border border-accent/20 bg-accent/5 px-3 py-2">
                <p className="text-xs text-text-industrial/80">La IA analiza la justificación técnica y las medidas compensatorias.</p>
                <button
                  type="button"
                  onClick={() => setRequestMessage(`Analizá este diferimiento y ayúdame a evaluar la solidez de la justificación técnica y las medidas compensatorias documentadas.`)}
                  className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-[11px] font-bold text-white hover:brightness-110 transition-all"
                >
                  Asistir con IA
                </button>
              </div>
            )}
            {actionError && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{actionError}</p>}
          </div>
          <div className="flex justify-end gap-2 px-6 py-4 border-t border-white/10">
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
                <button onClick={() => setShowReject(true)} className="px-4 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 font-bold text-xs hover:bg-red-500/20 transition-all">
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
            <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-white transition-colors">{t("common.cancel")}</button>
          </div>
        </div>
      </div>

      {showReview && <ReviewModal deferralId={deferral.id} onClose={() => setShowReview(false)} onSuccess={onSuccess} />}
      {showApprove && <ApproveModal deferralId={deferral.id} onClose={() => setShowApprove(false)} onSuccess={onSuccess} />}
      {showReject && <RejectModal deferralId={deferral.id} onClose={() => setShowReject(false)} onSuccess={onSuccess} />}
      {showClose && <CloseDeferralModal deferralId={deferral.id} onClose={() => setShowClose(false)} onSuccess={onSuccess} />}
    </>
  );
};

export const DeferralsPage: React.FC = () => {
  const t = useT();
  const [searchParams, setSearchParams] = useSearchParams();
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

  const openDetail = useCallback(async (row: Deferral) => {
    setDetailLoadingId(row.id);
    setDetailError(null);
    try {
      const detailed = await api.get<Deferral>(`/app/pms/deferrals/${row.id}`);
      setEditing(detailed);
    } catch (err) {
      setEditing(row);
      setDetailError(err instanceof ApiError ? err.message : "No se pudo cargar el detalle del aplazamiento.");
    } finally {
      setDetailLoadingId(null);
    }
  }, []);

  const columns: Column<Deferral>[] = useMemo(() => [
    {
      key: "deferralCode",
      header: t("col.code"),
      render: row => <span className="font-mono font-bold text-white text-xs">{row.deferralCode}</span>,
    },
    {
      key: "sourceType",
      header: t("def2.sourceType"),
      render: row => <SourceTypeBadge sourceType={row.sourceType} />,
    },
    {
      key: "vesselCode",
      header: t("col.vessel"),
      render: row => <span className="font-mono text-accent text-xs">{row.vesselCode}</span>,
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
        <select value={toFilterSelectValue(statusFilter)} onChange={e => updateFilters({ status: fromFilterSelectValue(e.target.value) })} className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-text-industrial focus:outline-none focus:border-accent/50">
          <option value={FILTER_ALL_VALUE}>{t("status.all")}</option>
          <option value="REQUESTED">REQUESTED</option>
          <option value="UNDER_REVIEW">UNDER_REVIEW</option>
          <option value="APPROVED">{t("status.approved")}</option>
          <option value="REJECTED">{t("status.rejected")}</option>
          <option value="ACTIVE">{t("status.active")}</option>
          <option value="CLOSED">{t("status.closed")}</option>
        </select>

        <select value={toFilterSelectValue(sourceTypeFilter)} onChange={e => updateFilters({ sourceType: fromFilterSelectValue(e.target.value) })} className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-text-industrial focus:outline-none focus:border-accent/50">
          <option value={FILTER_ALL_VALUE}>{t("status.all")}</option>
          <option value="DEFECT">DEFECT</option>
          <option value="WORK_ORDER">WORK_ORDER</option>
          <option value="MAINTENANCE_PLAN">MAINTENANCE_PLAN</option>
        </select>

        <div className="flex items-center gap-2">
          <input value={vesselInput} onChange={e => setVesselInput(e.target.value.toUpperCase())} onKeyDown={e => { if (e.key === "Enter") updateFilters({ vesselCode: vesselInput.trim() }); }} placeholder={t("common.filterByVessel")} className="w-44 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-text-industrial placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 disabled:opacity-60" />
          <button onClick={() => updateFilters({ vesselCode: vesselInput.trim() })} className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-text-industrial hover:border-accent/30 transition-all">{t("common.apply")}</button>
          {(statusFilter || sourceTypeFilter || vesselFilter) && (
            <button onClick={() => updateFilters({ status: "", sourceType: "", vesselCode: "" })} className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-text-industrial/80 hover:text-white hover:border-red-400/40 transition-all">{t("common.clear")}</button>
          )}
        </div>
      </PageHeader>

      {detailLoadingId && <div className="flex items-center gap-2 text-xs text-text-industrial/60"><Loader2 className="w-4 h-4 animate-spin text-accent" />Cargando detalle del aplazamiento...</div>}
      {detailError && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{detailError}</p>}

      <DataTable columns={columns} data={data?.items ?? null} loading={loading} error={error} keyFn={row => row.id} emptyText={t("empty.deferrals")} onRowClick={row => { void openDetail(row); }} />

      {editing && (
        <DeferralModal
          deferral={editing}
          onClose={() => setEditing(null)}
          onSuccess={() => {
            setEditing(null);
            void reload();
          }}
        />
      )}
    </div>
  );
};
