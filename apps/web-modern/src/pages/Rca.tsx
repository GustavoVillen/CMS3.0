import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Loader2, Microscope, X } from "lucide-react";
import { useFetch } from "../lib/hooks";
import { api, ApiError } from "../lib/api";
import { DataTable, StatusBadge, type Column } from "../components/DataTable";
import { fmtDate, FILTER_ALL_VALUE, fromFilterSelectValue, toFilterSelectValue } from "../lib/utils";
import { PageHeader } from "../components/PageHeader";
import { useT } from "../lib/i18n";
import { useCopilotEmitter, useCopilotApplyFields, useCopilotScreenContext } from "../lib/copilot-context";

interface RcaRecord {
  id: string;
  tenantId: string;
  vesselCode: string;
  assetId: string;
  assetName: string | null;
  defectId: string | null;
  workOrderId: string | null;
  rcaCode: string;
  status: string;
  methodology: string;
  analysisSummary: string | null;
  immediateCause: string | null;
  contributingCause: string | null;
  rootCause: string | null;
  correctiveActions: string | null;
  preventiveActions: string | null;
  completedAt: string | null;
  approvedAt: string | null;
  approvedByUserId: string | null;
  closedAt: string | null;
  createdAt: string;
}

interface ListResponse {
  items: RcaRecord[];
  total: number;
}


function normalizeOptionalText(value: string): string | null {
  const text = value.trim();
  return text || null;
}

function getMethodologyLabel(methodology: string, t: (key: any) => string): string {
  switch (methodology) {
    case "FIVE_WHYS": return t("rca.method.fiveWhys");
    case "FISHBONE": return t("rca.method.fishbone");
    case "FTA": return t("rca.method.fta");
    case "BARRIER_ANALYSIS": return t("rca.method.barrierAnalysis");
    default: return methodology;
  }
}

interface CompleteRcaModalProps {
  rcaId: string;
  initialAnalysisSummary?: string | null;
  initialRootCause?: string | null;
  initialCorrectiveActions?: string | null;
  initialPreventiveActions?: string | null;
  onClose: () => void;
  onSuccess: () => void;
}

const CompleteRcaModal: React.FC<CompleteRcaModalProps> = ({
  rcaId,
  initialAnalysisSummary,
  initialRootCause,
  initialCorrectiveActions,
  initialPreventiveActions,
  onClose,
  onSuccess,
}) => {
  const t = useT();
  const [analysisSummary, setAnalysisSummary] = useState(initialAnalysisSummary ?? "");
  const [rootCause, setRootCause] = useState(initialRootCause ?? "");
  const [correctiveActions, setCorrectiveActions] = useState(initialCorrectiveActions ?? "");
  const [preventiveActions, setPreventiveActions] = useState(initialPreventiveActions ?? "");
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const onSave = useCallback(async () => {
    if (!rootCause.trim()) {
      setActionError(t("rca.rootCause"));
      return;
    }
    if (!correctiveActions.trim()) {
      setActionError(t("rca.correctiveActions"));
      return;
    }
    if (!preventiveActions.trim()) {
      setActionError(t("rca.preventiveActions"));
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      await api.post(`/app/pms/rca/${rcaId}/complete`, {
        rootCause: rootCause.trim(),
        correctiveActions: correctiveActions.trim(),
        preventiveActions: preventiveActions.trim(),
        analysisSummary: normalizeOptionalText(analysisSummary) ?? undefined,
      });
      onSuccess();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t("common.saveError"));
    } finally {
      setSaving(false);
    }
  }, [analysisSummary, correctiveActions, onSuccess, preventiveActions, rcaId, rootCause, t]);

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-2xl bg-[#0D1B2A] border border-white/10 rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <h2 className="text-base font-bold text-white">{t("rca.complete")}</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-text-industrial/40 hover:text-white" /></button>
        </div>
        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">{t("rca.analysisSummary")}</label>
            <textarea rows={3} value={analysisSummary} onChange={e => setAnalysisSummary(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 disabled:opacity-60" />
          </div>
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">{t("rca.rootCause")}</label>
            <textarea rows={3} value={rootCause} onChange={e => setRootCause(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 disabled:opacity-60" />
          </div>
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">{t("rca.correctiveActions")}</label>
            <textarea rows={3} value={correctiveActions} onChange={e => setCorrectiveActions(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 disabled:opacity-60" />
          </div>
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">{t("rca.preventiveActions")}</label>
            <textarea rows={3} value={preventiveActions} onChange={e => setPreventiveActions(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 disabled:opacity-60" />
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

interface RcaModalProps {
  record: RcaRecord;
  onClose: () => void;
  onSuccess: () => void;
}

const RcaModal: React.FC<RcaModalProps> = ({ record, onClose, onSuccess }) => {
  const t = useT();
  const [methodology, setMethodology] = useState(record.methodology ?? "FIVE_WHYS");
  const [analysisSummary, setAnalysisSummary] = useState(record.analysisSummary ?? "");
  const [immediateCause, setImmediateCause] = useState(record.immediateCause ?? "");
  const [contributingCause, setContributingCause] = useState(record.contributingCause ?? "");
  const [rootCause, setRootCause] = useState(record.rootCause ?? "");
  const [correctiveActions, setCorrectiveActions] = useState(record.correctiveActions ?? "");
  const [preventiveActions, setPreventiveActions] = useState(record.preventiveActions ?? "");
  const [saving, setSaving] = useState(false);
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [approving, setApproving] = useState(false);
  const [closing, setClosing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const { setRequestMessage } = useCopilotScreenContext();

  useEffect(() => {
    setMethodology(record.methodology ?? "FIVE_WHYS");
    setAnalysisSummary(record.analysisSummary ?? "");
    setImmediateCause(record.immediateCause ?? "");
    setContributingCause(record.contributingCause ?? "");
    setRootCause(record.rootCause ?? "");
    setCorrectiveActions(record.correctiveActions ?? "");
    setPreventiveActions(record.preventiveActions ?? "");
    setShowCompleteModal(false);
    setActionError(null);
  }, [record]);

  const isClosed = record.status === "CLOSED";

  // Emit live context to the Copilot panel. Updates whenever the user edits any field.
  useCopilotEmitter({
    module: "RCA",
    screen: "RCA_EDIT",
    entityId: record.id,
    entityCode: record.rcaCode,
    vesselCode: record.vesselCode,
    workflowStage: record.status,
    canEdit: !isClosed,
    fieldValues: {
      analysisSummary:   analysisSummary   || null,
      immediateCause:    immediateCause    || null,
      contributingCause: contributingCause || null,
      rootCause:         rootCause         || null,
      correctiveActions: correctiveActions || null,
      preventiveActions: preventiveActions || null,
    },
    relatedEntities: {
      defectId:    record.defectId,
      workOrderId: record.workOrderId,
    },
  });

  // Register apply-fields callback so the copilot can fill RCA fields directly.
  useCopilotApplyFields(!isClosed ? (fields) => {
    if (fields.analysisSummary   !== undefined) setAnalysisSummary(fields.analysisSummary);
    if (fields.immediateCause    !== undefined) setImmediateCause(fields.immediateCause);
    if (fields.contributingCause !== undefined) setContributingCause(fields.contributingCause);
    if (fields.rootCause         !== undefined) setRootCause(fields.rootCause);
    if (fields.correctiveActions !== undefined) setCorrectiveActions(fields.correctiveActions);
    if (fields.preventiveActions !== undefined) setPreventiveActions(fields.preventiveActions);
  } : null);

  const onSave = useCallback(async () => {
    setSaving(true);
    setActionError(null);
    try {
      await api.patch(`/app/pms/rca/${record.id}`, {
        methodology,
        analysisSummary: normalizeOptionalText(analysisSummary),
        immediateCause: normalizeOptionalText(immediateCause),
        contributingCause: normalizeOptionalText(contributingCause),
        rootCause: normalizeOptionalText(rootCause),
        correctiveActions: normalizeOptionalText(correctiveActions),
        preventiveActions: normalizeOptionalText(preventiveActions),
      });
      onSuccess();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t("common.saveError"));
    } finally {
      setSaving(false);
    }
  }, [analysisSummary, contributingCause, correctiveActions, immediateCause, methodology, onSuccess, preventiveActions, record.id, rootCause, t]);

  const onApprove = useCallback(async () => {
    setApproving(true);
    setActionError(null);
    try {
      await api.post(`/app/pms/rca/${record.id}/approve`, {});
      onSuccess();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t("common.saveError"));
    } finally {
      setApproving(false);
    }
  }, [onSuccess, record.id, t]);

  const onCloseRca = useCallback(async () => {
    setClosing(true);
    setActionError(null);
    try {
      await api.post(`/app/pms/rca/${record.id}/close`, {});
      onSuccess();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t("common.saveError"));
    } finally {
      setClosing(false);
    }
  }, [onSuccess, record.id, t]);


  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
        <div className="w-full max-w-2xl bg-[#0D1B2A] border border-white/10 rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
            <h2 className="text-base font-bold text-white">{t("page.rca")}</h2>
            <button onClick={onClose}><X className="w-5 h-5 text-text-industrial/40 hover:text-white" /></button>
          </div>
          <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t("col.code")}</p>
                <p className="text-sm font-mono font-bold text-white">{record.rcaCode}</p>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t("col.vessel")}</p>
                <p className="text-sm font-mono text-accent">{record.vesselCode}</p>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">Asset ID</p>
                <p className="text-sm text-white">{record.assetName ?? record.assetId}</p>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t("rca.methodology")}</p>
                <p className="text-sm text-white">{getMethodologyLabel(record.methodology, t)}</p>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">Defect ID</p>
                <p className="text-sm text-white">{record.defectId ?? "—"}</p>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">Work Order ID</p>
                <p className="text-sm text-white">{record.workOrderId ?? "—"}</p>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t("status.completed")}</p>
                <p className="text-sm text-white">{fmtDate(record.completedAt)}</p>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t("status.approved")}</p>
                <p className="text-sm text-white">{fmtDate(record.approvedAt)}</p>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-xl p-3 sm:col-span-2">
                <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t("status.closed")}</p>
                <p className="text-sm text-white">{fmtDate(record.closedAt)}</p>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">{t("rca.methodology")}</label>
              <select value={methodology} onChange={e => setMethodology(e.target.value)} disabled={isClosed} className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-accent/50 disabled:opacity-60">
                <option value="FIVE_WHYS">{t("rca.method.fiveWhys")}</option>
                <option value="FISHBONE">{t("rca.method.fishbone")}</option>
                <option value="FTA">{t("rca.method.fta")}</option>
                <option value="BARRIER_ANALYSIS">{t("rca.method.barrierAnalysis")}</option>
              </select>
            </div>
            {!isClosed && (
              <div className="flex items-center justify-between gap-2 rounded-xl border border-accent/20 bg-accent/5 px-3 py-2">
                <p className="text-xs text-text-industrial/80">{t("rca.aiHint")}</p>
                <button
                  type="button"
                  onClick={() => setRequestMessage(
                    `Analizá este RCA y ayúdame a completar los campos faltantes basándote en lo que ya tengo documentado.`
                  )}
                  className="px-3 py-1.5 rounded-lg bg-accent text-primary-bg font-bold text-xs hover:brightness-110 transition-all"
                >
                  {t("rca.aiAssist")}
                </button>
              </div>
            )}
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">{t("rca.analysisSummary")}</label>
              <textarea rows={3} value={analysisSummary} onChange={e => setAnalysisSummary(e.target.value)} disabled={isClosed} className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 disabled:opacity-60" />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">{t("rca.immediateCause")}</label>
              <textarea rows={3} value={immediateCause} onChange={e => setImmediateCause(e.target.value)} disabled={isClosed} className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 disabled:opacity-60" />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">{t("rca.contributingCause")}</label>
              <textarea rows={3} value={contributingCause} onChange={e => setContributingCause(e.target.value)} disabled={isClosed} className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 disabled:opacity-60" />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">{t("rca.rootCause")}</label>
              <textarea rows={3} value={rootCause} onChange={e => setRootCause(e.target.value)} disabled={isClosed} className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 disabled:opacity-60" />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">{t("rca.correctiveActions")}</label>
              <textarea rows={3} value={correctiveActions} onChange={e => setCorrectiveActions(e.target.value)} disabled={isClosed} className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 disabled:opacity-60" />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">{t("rca.preventiveActions")}</label>
              <textarea rows={3} value={preventiveActions} onChange={e => setPreventiveActions(e.target.value)} disabled={isClosed} className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 disabled:opacity-60" />
            </div>

            {actionError && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{actionError}</p>}
          </div>
          <div className="flex justify-end gap-2 px-6 py-4 border-t border-white/10">
            {record.status === "UNDER_ANALYSIS" && (
              <button onClick={() => setShowCompleteModal(true)} className="px-4 py-2 rounded-xl bg-accent/10 border border-accent/20 text-accent font-bold text-xs hover:brightness-110 transition-all">
                {t("rca.complete")}
              </button>
            )}
            {record.status === "COMPLETED" && (
              <button onClick={() => { void onApprove(); }} disabled={approving} className="px-4 py-2 rounded-xl bg-success-sea/10 border border-success-sea/20 text-success-sea font-bold text-xs hover:brightness-110 disabled:opacity-50 transition-all">
                {approving ? <Loader2 className="w-4 h-4 animate-spin" /> : t("rca.approve")}
              </button>
            )}
            {record.status === "APPROVED" && (
              <button onClick={() => { void onCloseRca(); }} disabled={closing} className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-text-industrial font-bold text-xs hover:text-white hover:border-white/20 disabled:opacity-50 transition-all">
                {closing ? <Loader2 className="w-4 h-4 animate-spin" /> : t("rca.close")}
              </button>
            )}
            <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-white transition-colors">{t("common.cancel")}</button>
            {!isClosed && (
              <button onClick={() => { void onSave(); }} disabled={saving} className="px-4 py-2 rounded-xl bg-accent text-primary-bg font-bold text-xs hover:brightness-110 disabled:opacity-50 transition-all">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : t("common.save")}
              </button>
            )}
          </div>
        </div>
      </div>

      {showCompleteModal && (
        <CompleteRcaModal
          rcaId={record.id}
          initialAnalysisSummary={analysisSummary}
          initialRootCause={rootCause}
          initialCorrectiveActions={correctiveActions}
          initialPreventiveActions={preventiveActions}
          onClose={() => setShowCompleteModal(false)}
          onSuccess={onSuccess}
        />
      )}
    </>
  );
};

export const RcaPage: React.FC = () => {
  const t = useT();
  const [searchParams, setSearchParams] = useSearchParams();
  const [editing, setEditing] = useState<RcaRecord | null>(null);
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  useCopilotEmitter(!editing ? { module: "RCA", screen: "RCA_LIST" } : null);

  const statusFilter = (searchParams.get("status") ?? "").trim();
  const methodologyFilter = (searchParams.get("methodology") ?? "").trim();
  const vesselFilter = (searchParams.get("vesselCode") ?? "").trim();
  const [vesselInput, setVesselInput] = useState(vesselFilter);

  useEffect(() => {
    setVesselInput(vesselFilter);
  }, [vesselFilter]);

  const updateFilters = useCallback((next: { status?: string; methodology?: string; vesselCode?: string }) => {
    const params = new URLSearchParams(searchParams);
    const nextStatus = next.status !== undefined ? next.status : statusFilter;
    const nextMethodology = next.methodology !== undefined ? next.methodology : methodologyFilter;
    const nextVessel = next.vesselCode !== undefined ? next.vesselCode : vesselFilter;
    if (nextStatus) params.set("status", nextStatus); else params.delete("status");
    if (nextMethodology) params.set("methodology", nextMethodology); else params.delete("methodology");
    if (nextVessel) params.set("vesselCode", nextVessel); else params.delete("vesselCode");
    setSearchParams(params, { replace: true });
  }, [methodologyFilter, searchParams, setSearchParams, statusFilter, vesselFilter]);

  const path = useMemo(() => {
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    if (methodologyFilter) params.set("methodology", methodologyFilter);
    if (vesselFilter) params.set("vesselCode", vesselFilter);
    const query = params.toString();
    return `/app/pms/rca${query ? `?${query}` : ""}`;
  }, [methodologyFilter, statusFilter, vesselFilter]);

  const { data, loading, error, reload } = useFetch<ListResponse>(path, [path]);

  const openDetail = useCallback(async (row: RcaRecord) => {
    setDetailLoadingId(row.id);
    setDetailError(null);
    try {
      const detailed = await api.get<RcaRecord>(`/app/pms/rca/${row.id}`);
      setEditing(detailed);
    } catch (err) {
      setEditing(row);
      setDetailError(err instanceof ApiError ? err.message : "No se pudo cargar el detalle del RCA.");
    } finally {
      setDetailLoadingId(null);
    }
  }, []);

  const columns: Column<RcaRecord>[] = useMemo(() => [
    {
      key: "rcaCode",
      header: t("col.code"),
      render: row => <span className="font-mono font-bold text-white text-xs">{row.rcaCode}</span>,
    },
    {
      key: "methodology",
      header: t("rca.methodology"),
      render: row => <span className="text-xs text-white">{getMethodologyLabel(row.methodology, t)}</span>,
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
      key: "defectId",
      header: "Defect",
      render: row => <span className="text-xs text-text-industrial/80">{row.defectId ?? "—"}</span>,
    },
    {
      key: "createdAt",
      header: t("col.createdAt"),
      render: row => fmtDate(row.createdAt),
    },
  ], [t]);

  return (
    <div className="space-y-5">
      <PageHeader icon={Microscope} title={t("page.rca")} total={data?.total} onReload={reload}>
        <select value={toFilterSelectValue(statusFilter)} onChange={e => updateFilters({ status: fromFilterSelectValue(e.target.value) })} className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-text-industrial focus:outline-none focus:border-accent/50">
          <option value={FILTER_ALL_VALUE}>{t("status.all")}</option>
          <option value="DRAFT">{t("status.draft")}</option>
          <option value="UNDER_ANALYSIS">UNDER_ANALYSIS</option>
          <option value="COMPLETED">{t("status.completed")}</option>
          <option value="APPROVED">{t("status.approved")}</option>
          <option value="CLOSED">{t("status.closed")}</option>
        </select>

        <select value={toFilterSelectValue(methodologyFilter)} onChange={e => updateFilters({ methodology: fromFilterSelectValue(e.target.value) })} className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-text-industrial focus:outline-none focus:border-accent/50">
          <option value={FILTER_ALL_VALUE}>{t("status.all")}</option>
          <option value="FIVE_WHYS">{t("rca.method.fiveWhys")}</option>
          <option value="FISHBONE">{t("rca.method.fishbone")}</option>
          <option value="FTA">{t("rca.method.fta")}</option>
          <option value="BARRIER_ANALYSIS">{t("rca.method.barrierAnalysis")}</option>
        </select>

        <div className="flex items-center gap-2">
          <input value={vesselInput} onChange={e => setVesselInput(e.target.value.toUpperCase())} onKeyDown={e => { if (e.key === "Enter") updateFilters({ vesselCode: vesselInput.trim() }); }} placeholder={t("common.filterByVessel")} className="w-44 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-text-industrial placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 disabled:opacity-60" />
          <button onClick={() => updateFilters({ vesselCode: vesselInput.trim() })} className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-text-industrial hover:border-accent/30 transition-all">{t("common.apply")}</button>
          {(statusFilter || methodologyFilter || vesselFilter) && (
            <button onClick={() => updateFilters({ status: "", methodology: "", vesselCode: "" })} className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-text-industrial/80 hover:text-white hover:border-red-400/40 transition-all">{t("common.clear")}</button>
          )}
        </div>
      </PageHeader>

      {detailLoadingId && <div className="flex items-center gap-2 text-xs text-text-industrial/60"><Loader2 className="w-4 h-4 animate-spin text-accent" />Cargando detalle del RCA...</div>}
      {detailError && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{detailError}</p>}

      <DataTable columns={columns} data={data?.items ?? null} loading={loading} error={error} keyFn={row => row.id} emptyText={t("empty.rca")} onRowClick={row => { void openDetail(row); }} />

      {editing && (
        <RcaModal
          record={editing}
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
