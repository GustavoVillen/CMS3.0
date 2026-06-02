import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Loader2, ShieldCheck, X } from "lucide-react";
import { useFetch } from "../lib/hooks";
import { api, ApiError } from "../lib/api";
import { DataTable, StatusBadge, type Column } from "../components/DataTable";
import { FILTER_ALL_VALUE, fmtDate, fromFilterSelectValue, toFilterSelectValue } from "../lib/utils";
import { PageHeader } from "../components/PageHeader";
import { VesselLabel } from "../components/EntityLabels";
import { useT } from "../lib/i18n";
import { useEscapeGuard, useDirtyTracker } from "../lib/escape-guard";

interface InspectionTemplateSummary {
  id: string;
  code: string;
  title: string;
}

interface InspectionChecklistItem {
  id: string;
  templateId: string;
  sortOrder: number;
  description: string;
  itemType: string;
  acceptanceCriteria: string | null;
  nominalValue: number | null;
  minValue: number | null;
  maxValue: number | null;
  unit: string | null;
  requiresInstrument: boolean;
  requiredInstrumentType: string | null;
  evidenceRequired: boolean;
  deficiencySeverity: string | null;
  isOptional: boolean;
}

interface InspectionItemResult {
  id: string;
  executionId: string;
  checklistItemId: string;
  resultValue: string | null;
  numericValue: number | null;
  isConforming: boolean | null;
  deficiencySeverity: string | null;
  instrumentId: string | null;
  notes: string | null;
}

interface InspectionExecution {
  id: string;
  tenantId: string;
  vesselCode: string;
  assetId: string | null;
  templateId: string;
  executionCode: string;
  status: string;
  result: string | null;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  inspectorUserId: string | null;
  inspectorName: string | null;
  generalObservations: string | null;
  nextScheduledDate: string | null;
  createdAt: string;
  template?: InspectionTemplateSummary | null;
  itemResults?: InspectionItemResult[];
}

interface ExecutionListResponse {
  items: InspectionExecution[];
  total: number;
}

interface InspectionTemplate {
  id: string;
  tenantId: string | null;
  code: string;
  title: string;
  description: string | null;
  equipmentClassId: string | null;
  sfiCode: string | null;
  triggerType: string;
  triggerResultMode: string;
  frequencyDays: number | null;
  windowMode: string;
  windowLeadDays: number | null;
  evidenceRequired: boolean;
  isGlobal: boolean;
  status: string;
  checklistItems?: InspectionChecklistItem[];
}

interface TemplateListResponse {
  items: InspectionTemplate[];
  total: number;
}

interface EditingExecution {
  execution: InspectionExecution;
  templateItems: InspectionChecklistItem[];
}

type ChecklistItemFormState = {
  resultValue: string;
  numericValue: string;
  notes: string;
};

const RESULT_STYLES: Record<string, string> = {
  SATISFACTORY: "bg-success-sea/10 text-success-sea border-success-sea/20",
  SATISFACTORY_WITH_OBSERVATIONS: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  UNSATISFACTORY_FOLLOW_UP_REQUIRED: "bg-red-500/10 text-red-400 border-red-500/20",
  CRITICAL_DEFICIENCY_IMMEDIATE_ACTION: "bg-red-500/10 text-red-400 border-red-500/20",
};

function ResultBadge({ result }: { result: string | null }) {
  if (!result) return <span className="text-text-industrial/30 text-xs">—</span>;
  const cls = RESULT_STYLES[result] ?? "bg-fg/5 text-text-industrial/40 border-fg/10";
  const short: Record<string, string> = {
    SATISFACTORY: "OK",
    SATISFACTORY_WITH_OBSERVATIONS: "OK+OBS",
    UNSATISFACTORY_FOLLOW_UP_REQUIRED: "NO CONF",
    CRITICAL_DEFICIENCY_IMMEDIATE_ACTION: "CRÍTICO",
  };
  return (
    <span className={`inline-block text-[10px] px-2 py-0.5 rounded-full border font-bold ${cls}`}>
      {short[result] ?? result}
    </span>
  );
}

interface ChecklistItemRowProps {
  item: InspectionChecklistItem;
  state: ChecklistItemFormState;
  onChange: (id: string, update: Partial<ChecklistItemFormState>) => void;
}

function ChecklistItemRow({ item, state, onChange }: ChecklistItemRowProps) {
  const isOptional = item.isOptional;
  const hasValue = state.resultValue.trim() || state.numericValue.trim();

  return (
    <div className={`rounded-xl border p-3 space-y-2 ${hasValue ? "border-accent/20 bg-accent/5" : "border-fg/10 bg-fg/2"}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-fg font-medium">{item.description}</p>
        <div className="flex items-center gap-1 shrink-0">
          {isOptional && <span className="text-[10px] text-text-industrial/40 border border-fg/10 px-1.5 py-0.5 rounded-full">OPT</span>}
          <span className="text-[10px] text-accent border border-accent/20 px-1.5 py-0.5 rounded-full">{item.itemType}</span>
        </div>
      </div>

      {item.acceptanceCriteria && (
        <p className="text-[11px] text-text-industrial/50 italic">{item.acceptanceCriteria}</p>
      )}

      {item.itemType === "BOOLEAN_OK_NOK" && (
        <select
          value={state.resultValue}
          onChange={e => onChange(item.id, { resultValue: e.target.value })}
          className="w-full bg-fg/5 border border-fg/10 rounded-lg px-3 py-2 text-sm text-fg focus:outline-none focus:border-accent/50"
        >
          <option value="">— Seleccionar —</option>
          <option value="OK">OK</option>
          <option value="NOK">NOK</option>
        </select>
      )}

      {item.itemType === "PASS_FAIL_NA" && (
        <select
          value={state.resultValue}
          onChange={e => onChange(item.id, { resultValue: e.target.value })}
          className="w-full bg-fg/5 border border-fg/10 rounded-lg px-3 py-2 text-sm text-fg focus:outline-none focus:border-accent/50"
        >
          <option value="">— Seleccionar —</option>
          <option value="PASS">PASS</option>
          <option value="FAIL">FAIL</option>
          <option value="NA">NA</option>
        </select>
      )}

      {item.itemType === "NUMERIC_READING" && (
        <div className="flex items-center gap-2">
          <input
            type="number"
            step="any"
            value={state.numericValue}
            onChange={e => onChange(item.id, { numericValue: e.target.value })}
            placeholder={item.nominalValue !== null ? `Nominal: ${item.nominalValue}` : "Lectura"}
            className="flex-1 bg-fg/5 border border-fg/10 rounded-lg px-3 py-2 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50"
          />
          {item.unit && <span className="text-xs text-text-industrial/50 shrink-0">{item.unit}</span>}
        </div>
      )}

      {(item.itemType === "SHORT_TEXT" || item.itemType === "PHOTO_REQUIRED") && (
        <input
          type="text"
          value={state.resultValue}
          onChange={e => onChange(item.id, { resultValue: e.target.value })}
          placeholder={item.itemType === "PHOTO_REQUIRED" ? "Ruta/descripción de evidencia" : ""}
          className="w-full bg-fg/5 border border-fg/10 rounded-lg px-3 py-2 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50"
        />
      )}

      {item.itemType === "TECHNICAL_NOTES" && (
        <textarea
          rows={2}
          value={state.resultValue}
          onChange={e => onChange(item.id, { resultValue: e.target.value })}
          className="w-full bg-fg/5 border border-fg/10 rounded-lg px-3 py-2 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 resize-none"
        />
      )}

      <input
        type="text"
        value={state.notes}
        onChange={e => onChange(item.id, { notes: e.target.value })}
        placeholder="Notas (opcional)"
        className="w-full bg-fg/5 border border-fg/10 rounded-lg px-3 py-1.5 text-xs text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50"
      />

      {item.itemType === "NUMERIC_READING" && (item.minValue !== null || item.maxValue !== null) && (
        <p className="text-[10px] text-text-industrial/40">
          Rango: {item.minValue ?? "—"} — {item.maxValue ?? "—"} {item.unit ?? ""}
        </p>
      )}
    </div>
  );
}

interface CompleteExecutionModalProps {
  executionId: string;
  onClose: () => void;
  onSuccess: () => void;
}

const CompleteExecutionModal: React.FC<CompleteExecutionModalProps> = ({ executionId, onClose, onSuccess }) => {
  const t = useT();
  const [result, setResult] = useState("");
  const [generalObservations, setGeneralObservations] = useState("");
  const [nextScheduledDate, setNextScheduledDate] = useState("");
  const [inspectorName, setInspectorName] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const shouldWarnDefect =
    result === "UNSATISFACTORY_FOLLOW_UP_REQUIRED" || result === "CRITICAL_DEFICIENCY_IMMEDIATE_ACTION";

  const onSave = useCallback(async () => {
    if (!result) {
      setActionError(t("insp.result"));
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      await api.post(`/app/pms/inspections/${executionId}/complete`, {
        result,
        generalObservations: generalObservations.trim() || undefined,
        nextScheduledDate: nextScheduledDate || undefined,
        inspectorName: inspectorName.trim() || undefined,
      });
      onSuccess();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t("common.saveError"));
    } finally {
      setSaving(false);
    }
  }, [executionId, generalObservations, inspectorName, nextScheduledDate, onSuccess, result, t]);

  // ESC guard
  const isDirty = useDirtyTracker({ result, generalObservations, nextScheduledDate, inspectorName });
  useEscapeGuard({ isDirty, onSave, onClose });

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-2xl bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-fg/10">
          <h2 className="text-base font-bold text-fg">{t("insp.complete")}</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-text-industrial/40 hover:text-fg" /></button>
        </div>
        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">{t("insp.result")}</label>
            <select value={result} onChange={e => setResult(e.target.value)} className="w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg focus:outline-none focus:border-accent/50">
              <option value="">— Seleccionar —</option>
              <option value="SATISFACTORY">SATISFACTORY</option>
              <option value="SATISFACTORY_WITH_OBSERVATIONS">SATISFACTORY_WITH_OBSERVATIONS</option>
              <option value="UNSATISFACTORY_FOLLOW_UP_REQUIRED">UNSATISFACTORY_FOLLOW_UP_REQUIRED</option>
              <option value="CRITICAL_DEFICIENCY_IMMEDIATE_ACTION">CRITICAL_DEFICIENCY_IMMEDIATE_ACTION</option>
            </select>
          </div>
          {shouldWarnDefect && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400">
              ⚠ Se creará automáticamente un Defecto en el sistema al completar esta inspección.
            </div>
          )}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">{t("insp.generalObservations")}</label>
            <textarea rows={3} value={generalObservations} onChange={e => setGeneralObservations(e.target.value)} className="w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50" />
          </div>
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">{t("insp.nextScheduledDate")}</label>
            <input type="date" value={nextScheduledDate} onChange={e => setNextScheduledDate(e.target.value)} className="w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50" />
          </div>
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">{t("insp.inspectorName")}</label>
            <input value={inspectorName} onChange={e => setInspectorName(e.target.value)} className="w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50" />
          </div>
          {actionError && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{actionError}</p>}
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-fg/10">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-fg transition-colors">{t("common.cancel")}</button>
          <button onClick={() => { void onSave(); }} disabled={saving} className="px-4 py-2 rounded-xl bg-accent text-primary-bg font-bold text-xs hover:brightness-110 disabled:opacity-50 transition-all">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
};

interface ExecutionModalProps {
  editing: EditingExecution;
  onClose: () => void;
  onSaved: () => void;
  onResultsSaved: (updated: InspectionExecution) => void;
}

const ExecutionModal: React.FC<ExecutionModalProps> = ({ editing, onClose, onSaved, onResultsSaved }) => {
  const t = useT();
  const [checklistFormState, setChecklistFormState] = useState<Record<string, ChecklistItemFormState>>({});
  const [savingResults, setSavingResults] = useState(false);
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const sortedTemplateItems = useMemo(
    () => [...editing.templateItems].sort((a, b) => a.sortOrder - b.sortOrder),
    [editing.templateItems],
  );

  useEffect(() => {
    const initial: Record<string, ChecklistItemFormState> = {};
    for (const item of sortedTemplateItems) {
      const existing = editing.execution.itemResults?.find(r => r.checklistItemId === item.id);
      initial[item.id] = {
        resultValue: existing?.resultValue ?? "",
        numericValue: existing?.numericValue?.toString() ?? "",
        notes: existing?.notes ?? "",
      };
    }
    setChecklistFormState(initial);
    setActionError(null);
    setShowCompleteModal(false);
  }, [editing, sortedTemplateItems]);

  const handleChecklistChange = useCallback((itemId: string, update: Partial<ChecklistItemFormState>) => {
    setChecklistFormState(prev => ({
      ...prev,
      [itemId]: { ...(prev[itemId] ?? { resultValue: "", numericValue: "", notes: "" }), ...update },
    }));
  }, []);

  const completedCount = useMemo(
    () =>
      sortedTemplateItems.filter(item => {
        const state = checklistFormState[item.id];
        return Boolean(state?.resultValue?.trim() || state?.numericValue?.trim());
      }).length,
    [checklistFormState, sortedTemplateItems],
  );

  const buildResultsPayload = useCallback(() => {
    return sortedTemplateItems.map(item => {
      const state = checklistFormState[item.id] ?? { resultValue: "", numericValue: "", notes: "" };
      const base = {
        checklistItemId: item.id,
        notes: state.notes.trim() || undefined,
      };
      if (item.itemType === "NUMERIC_READING") {
        const num = Number.parseFloat(state.numericValue);
        return { ...base, numericValue: Number.isFinite(num) ? num : undefined };
      }
      let isConforming: boolean | undefined;
      if (item.itemType === "BOOLEAN_OK_NOK") {
        isConforming = state.resultValue === "OK" ? true : state.resultValue === "NOK" ? false : undefined;
      } else if (item.itemType === "PASS_FAIL_NA") {
        isConforming = state.resultValue === "PASS" ? true : state.resultValue === "FAIL" ? false : undefined;
      }
      return {
        ...base,
        resultValue: state.resultValue.trim() || undefined,
        isConforming,
      };
    });
  }, [checklistFormState, sortedTemplateItems]);

  const onSaveResults = useCallback(async () => {
    setSavingResults(true);
    setActionError(null);
    try {
      const updated = await api.post<InspectionExecution>(
        `/app/pms/inspections/${editing.execution.id}/results`,
        { items: buildResultsPayload() },
      );
      onResultsSaved(updated);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t("common.saveError"));
    } finally {
      setSavingResults(false);
    }
  }, [buildResultsPayload, editing.execution.id, onResultsSaved, t]);

  // ESC guard — dirty si checklist se modificó
  const checklistDirty = useDirtyTracker(checklistFormState);
  useEscapeGuard({
    enabled: !showCompleteModal,
    isDirty: checklistDirty,
    onSave: onSaveResults,
    onClose,
  });

  const onStart = useCallback(async () => {
    setStarting(true);
    setActionError(null);
    try {
      await api.post(`/app/pms/inspections/${editing.execution.id}/start`, {});
      onSaved();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t("common.saveError"));
    } finally {
      setStarting(false);
    }
  }, [editing.execution.id, onSaved, t]);

  const onCancel = useCallback(async () => {
    setCancelling(true);
    setActionError(null);
    try {
      await api.post(`/app/pms/inspections/${editing.execution.id}/cancel`, {});
      onSaved();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t("common.saveError"));
    } finally {
      setCancelling(false);
    }
  }, [editing.execution.id, onSaved, t]);

  const status = editing.execution.status;
  const canStart = status === "SCHEDULED";
  const canInProgressActions = status === "IN_PROGRESS";
  const showChecklist = canInProgressActions && sortedTemplateItems.length > 0;

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
        <div className="w-full max-w-5xl bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between px-6 py-4 border-b border-fg/10">
            <h2 className="text-base font-bold text-fg">
              {editing.execution.executionCode} · {editing.execution.vesselCode}
            </h2>
            <button onClick={onClose}><X className="w-5 h-5 text-text-industrial/40 hover:text-fg" /></button>
          </div>
          <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <div className="bg-fg/5 border border-fg/10 rounded-xl p-3">
                <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t("col.code")}</p>
                <p className="text-sm font-mono text-fg">{editing.execution.executionCode}</p>
              </div>
              <div className="bg-fg/5 border border-fg/10 rounded-xl p-3">
                <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t("col.vessel")}</p>
                <p className="text-sm"><VesselLabel code={editing.execution.vesselCode} className="text-sm" showCode /></p>
              </div>
              <div className="bg-fg/5 border border-fg/10 rounded-xl p-3">
                <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t("col.title")}</p>
                <p className="text-sm text-fg">{editing.execution.template?.title ?? editing.execution.template?.code ?? "—"}</p>
              </div>
              <div className="bg-fg/5 border border-fg/10 rounded-xl p-3">
                <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t("insp.scheduledAt")}</p>
                <p className="text-sm text-fg">{fmtDate(editing.execution.scheduledAt)}</p>
              </div>
              <div className="bg-fg/5 border border-fg/10 rounded-xl p-3">
                <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t("insp.startedAt")}</p>
                <p className="text-sm text-fg">{fmtDate(editing.execution.startedAt)}</p>
              </div>
              <div className="bg-fg/5 border border-fg/10 rounded-xl p-3">
                <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t("col.completedAt")}</p>
                <p className="text-sm text-fg">{fmtDate(editing.execution.completedAt)}</p>
              </div>
              <div className="bg-fg/5 border border-fg/10 rounded-xl p-3">
                <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t("insp.inspectorName")}</p>
                <p className="text-sm text-fg">{editing.execution.inspectorName ?? "—"}</p>
              </div>
              <div className="bg-fg/5 border border-fg/10 rounded-xl p-3">
                <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t("insp.result")}</p>
                <div className="pt-1"><ResultBadge result={editing.execution.result} /></div>
              </div>
              <div className="bg-fg/5 border border-fg/10 rounded-xl p-3">
                <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t("insp.nextScheduledDate")}</p>
                <p className="text-sm text-fg">{fmtDate(editing.execution.nextScheduledDate)}</p>
              </div>
              {editing.execution.generalObservations && (
                <div className="bg-fg/5 border border-fg/10 rounded-xl p-3 sm:col-span-2 lg:col-span-3">
                  <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t("insp.generalObservations")}</p>
                  <p className="text-sm text-fg whitespace-pre-wrap">{editing.execution.generalObservations}</p>
                </div>
              )}
            </div>

            {showChecklist && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-fg">{t("insp.checklist")}</h3>
                  <span className="text-xs text-text-industrial/50">
                    {completedCount}/{sortedTemplateItems.length} ítems completados
                  </span>
                </div>
                <div className="space-y-2">
                  {sortedTemplateItems.map(item => (
                    <ChecklistItemRow
                      key={item.id}
                      item={item}
                      state={checklistFormState[item.id] ?? { resultValue: "", numericValue: "", notes: "" }}
                      onChange={handleChecklistChange}
                    />
                  ))}
                </div>
              </div>
            )}

            {actionError && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{actionError}</p>}
          </div>
          <div className="flex justify-end gap-2 px-6 py-4 border-t border-fg/10">
            {canStart && (
              <button onClick={() => { void onStart(); }} disabled={starting} className="px-4 py-2 rounded-xl bg-accent text-primary-bg font-bold text-xs hover:brightness-110 disabled:opacity-50 transition-all">
                {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : t("insp.start")}
              </button>
            )}
            {canInProgressActions && (
              <>
                <button onClick={() => { void onSaveResults(); }} disabled={savingResults} className="px-4 py-2 rounded-xl bg-fg/5 border border-fg/10 text-text-industrial font-bold text-xs hover:text-fg hover:border-fg/20 disabled:opacity-50 transition-all">
                  {savingResults ? <Loader2 className="w-4 h-4 animate-spin" /> : t("insp.saveResults")}
                </button>
                <button onClick={() => setShowCompleteModal(true)} className="px-4 py-2 rounded-xl bg-accent text-primary-bg font-bold text-xs hover:brightness-110 transition-all">
                  {t("insp.complete")}
                </button>
              </>
            )}
            {(canStart || canInProgressActions) && (
              <button onClick={() => { void onCancel(); }} disabled={cancelling} className="px-4 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 font-bold text-xs hover:bg-red-500/20 disabled:opacity-50 transition-all">
                {cancelling ? <Loader2 className="w-4 h-4 animate-spin" /> : t("insp.cancel")}
              </button>
            )}
            <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-fg transition-colors">
              {t("common.close")}
            </button>
          </div>
        </div>
      </div>

      {showCompleteModal && (
        <CompleteExecutionModal
          executionId={editing.execution.id}
          onClose={() => setShowCompleteModal(false)}
          onSuccess={onSaved}
        />
      )}
    </>
  );
};

interface TemplateModalProps {
  template: InspectionTemplate;
  onClose: () => void;
}

const TemplateModal: React.FC<TemplateModalProps> = ({ template, onClose }) => {
  const t = useT();
  const sortedItems = useMemo(
    () => [...(template.checklistItems ?? [])].sort((a, b) => a.sortOrder - b.sortOrder),
    [template.checklistItems],
  );

  // ESC guard (read-only modal — solo cierra)
  useEscapeGuard({ isDirty: false, onClose });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-4xl bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-fg/10">
          <h2 className="text-base font-bold text-fg">{t("insp.templates")}</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-text-industrial/40 hover:text-fg" /></button>
        </div>
        <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div className="bg-fg/5 border border-fg/10 rounded-xl p-3">
              <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t("col.code")}</p>
              <p className="text-sm font-mono text-fg">{template.code}</p>
            </div>
            <div className="bg-fg/5 border border-fg/10 rounded-xl p-3">
              <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t("col.title")}</p>
              <p className="text-sm text-fg">{template.title}</p>
            </div>
            <div className="bg-fg/5 border border-fg/10 rounded-xl p-3">
              <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t("insp.triggerType")}</p>
              <p className="text-sm text-fg">{template.triggerType}</p>
            </div>
            <div className="bg-fg/5 border border-fg/10 rounded-xl p-3">
              <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">Trigger Result Mode</p>
              <p className="text-sm text-fg">{template.triggerResultMode}</p>
            </div>
            <div className="bg-fg/5 border border-fg/10 rounded-xl p-3">
              <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t("insp.frequency")}</p>
              <p className="text-sm text-fg">{template.frequencyDays !== null ? `${template.frequencyDays} días` : "—"}</p>
            </div>
            <div className="bg-fg/5 border border-fg/10 rounded-xl p-3">
              <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">Window Mode</p>
              <p className="text-sm text-fg">{template.windowMode}</p>
            </div>
            <div className="bg-fg/5 border border-fg/10 rounded-xl p-3">
              <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">Window Lead Days</p>
              <p className="text-sm text-fg">{template.windowLeadDays ?? "—"}</p>
            </div>
            <div className="bg-fg/5 border border-fg/10 rounded-xl p-3">
              <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">Evidence Required</p>
              <p className="text-sm text-fg">{template.evidenceRequired ? "YES" : "NO"}</p>
            </div>
            <div className="bg-fg/5 border border-fg/10 rounded-xl p-3">
              <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t("insp.isGlobal")}</p>
              <p className="text-sm text-fg">{template.isGlobal ? "YES" : "NO"}</p>
            </div>
            <div className="bg-fg/5 border border-fg/10 rounded-xl p-3">
              <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t("col.status")}</p>
              <div className="pt-1"><StatusBadge status={template.status} /></div>
            </div>
            {template.description && (
              <div className="bg-fg/5 border border-fg/10 rounded-xl p-3 sm:col-span-2 lg:col-span-3">
                <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t("col.description")}</p>
                <p className="text-sm text-fg whitespace-pre-wrap">{template.description}</p>
              </div>
            )}
          </div>

          {sortedItems.length > 0 ? (
            <div className="space-y-2">
              {sortedItems.map(item => (
                <div key={item.id} className="bg-fg/2 border border-fg/5 rounded-lg p-2 flex items-start gap-2">
                  <span className="text-xs text-text-industrial/50 w-10 shrink-0">#{item.sortOrder}</span>
                  <div className="flex-1 space-y-1">
                    <p className="text-sm text-fg">{item.description}</p>
                    <span className="text-[10px] text-accent border border-accent/20 px-1.5 py-0.5 rounded-full">{item.itemType}</span>
                    {item.acceptanceCriteria && (
                      <p className="text-xs text-text-industrial/50 italic">{item.acceptanceCriteria}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-text-industrial/40">{t("empty.inspectionTemplates")}</p>
          )}
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-fg/10">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-fg transition-colors">
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
};

export const InspectionsPage: React.FC = () => {
  const t = useT();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<"executions" | "templates">("executions");
  const [editingExecution, setEditingExecution] = useState<EditingExecution | null>(null);
  const [editingTemplate, setEditingTemplate] = useState<InspectionTemplate | null>(null);
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  const executionStatusFilter = (searchParams.get("exe_status") ?? "").trim();
  const executionVesselFilter = (searchParams.get("exe_vessel") ?? "").trim();
  const templateStatusFilter = (searchParams.get("tmpl_status") ?? "").trim();
  const templateTriggerFilter = (searchParams.get("tmpl_trigger") ?? "").trim();
  const [executionVesselInput, setExecutionVesselInput] = useState(executionVesselFilter);

  useEffect(() => {
    setExecutionVesselInput(executionVesselFilter);
  }, [executionVesselFilter]);

  const updateExecutionFilters = useCallback((next: { status?: string; vessel?: string }) => {
    const params = new URLSearchParams(searchParams);
    const nextStatus = next.status !== undefined ? next.status : executionStatusFilter;
    const nextVessel = next.vessel !== undefined ? next.vessel : executionVesselFilter;
    if (nextStatus) params.set("exe_status", nextStatus); else params.delete("exe_status");
    if (nextVessel) params.set("exe_vessel", nextVessel); else params.delete("exe_vessel");
    setSearchParams(params, { replace: true });
  }, [executionStatusFilter, executionVesselFilter, searchParams, setSearchParams]);

  const updateTemplateFilters = useCallback((next: { status?: string; trigger?: string }) => {
    const params = new URLSearchParams(searchParams);
    const nextStatus = next.status !== undefined ? next.status : templateStatusFilter;
    const nextTrigger = next.trigger !== undefined ? next.trigger : templateTriggerFilter;
    if (nextStatus) params.set("tmpl_status", nextStatus); else params.delete("tmpl_status");
    if (nextTrigger) params.set("tmpl_trigger", nextTrigger); else params.delete("tmpl_trigger");
    setSearchParams(params, { replace: true });
  }, [searchParams, setSearchParams, templateStatusFilter, templateTriggerFilter]);

  const executionsPath = useMemo(() => {
    const params = new URLSearchParams();
    if (executionStatusFilter) params.set("status", executionStatusFilter);
    if (executionVesselFilter) params.set("vesselCode", executionVesselFilter);
    const query = params.toString();
    return `/app/pms/inspections${query ? `?${query}` : ""}`;
  }, [executionStatusFilter, executionVesselFilter]);

  const templatesPath = useMemo(() => {
    const params = new URLSearchParams();
    if (templateStatusFilter) params.set("status", templateStatusFilter);
    if (templateTriggerFilter) params.set("triggerType", templateTriggerFilter);
    const query = params.toString();
    return `/app/pms/inspection-templates${query ? `?${query}` : ""}`;
  }, [templateStatusFilter, templateTriggerFilter]);

  const {
    data: executionsData,
    loading: executionsLoading,
    error: executionsError,
    reload: reloadExecutions,
  } = useFetch<ExecutionListResponse>(executionsPath, [executionsPath]);

  const {
    data: templatesData,
    loading: templatesLoading,
    error: templatesError,
    reload: reloadTemplates,
  } = useFetch<TemplateListResponse>(templatesPath, [templatesPath]);

  const openExecutionDetail = useCallback(async (row: InspectionExecution) => {
    setDetailLoadingId(row.id);
    setDetailError(null);
    try {
      const execution = await api.get<InspectionExecution>(`/app/pms/inspections/${row.id}`);
      let templateItems: InspectionChecklistItem[] = [];
      if (execution.status === "IN_PROGRESS" && execution.template?.id) {
        try {
          const tmpl = await api.get<InspectionTemplate>(`/app/pms/inspection-templates/${execution.template.id}`);
          templateItems = tmpl.checklistItems ?? [];
        } catch {
          templateItems = [];
        }
      }
      setEditingExecution({ execution, templateItems });
    } catch (err) {
      setDetailError(err instanceof ApiError ? err.message : "No se pudo cargar el detalle.");
    } finally {
      setDetailLoadingId(null);
    }
  }, []);

  const openTemplateDetail = useCallback(async (row: InspectionTemplate) => {
    setDetailLoadingId(row.id);
    setDetailError(null);
    try {
      const template = await api.get<InspectionTemplate>(`/app/pms/inspection-templates/${row.id}`);
      setEditingTemplate(template);
    } catch (err) {
      setDetailError(err instanceof ApiError ? err.message : "No se pudo cargar el detalle.");
    } finally {
      setDetailLoadingId(null);
    }
  }, []);

  const executionColumns: Column<InspectionExecution>[] = useMemo(() => [
    {
      key: "executionCode",
      header: t("col.code"),
      render: row => <span className="font-mono font-bold text-fg text-xs">{row.executionCode}</span>,
    },
    {
      key: "template",
      header: t("col.title"),
      render: row => <span className="font-medium text-fg line-clamp-1">{row.template?.title ?? row.template?.code ?? "—"}</span>,
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
      key: "result",
      header: t("insp.result"),
      render: row => <ResultBadge result={row.result} />,
    },
    {
      key: "scheduledAt",
      header: t("insp.scheduledAt"),
      render: row => fmtDate(row.scheduledAt),
    },
  ], [t]);

  const templateColumns: Column<InspectionTemplate>[] = useMemo(() => [
    {
      key: "code",
      header: t("col.code"),
      render: row => <span className="font-mono font-bold text-fg text-xs">{row.code}</span>,
    },
    {
      key: "title",
      header: t("col.title"),
      render: row => <span className="font-medium text-fg line-clamp-1">{row.title}</span>,
    },
    {
      key: "triggerType",
      header: t("insp.triggerType"),
      render: row => row.triggerType,
    },
    {
      key: "frequencyDays",
      header: t("insp.frequency"),
      render: row => (row.frequencyDays !== null ? `${row.frequencyDays} días` : "—"),
    },
    {
      key: "status",
      header: t("col.status"),
      render: row => <StatusBadge status={row.status} />,
    },
    {
      key: "isGlobal",
      header: t("insp.isGlobal"),
      render: row => (row.isGlobal ? <span className="inline-block text-[10px] px-2 py-0.5 rounded-full border font-bold bg-blue-500/10 text-blue-400 border-blue-500/20">{t("insp.isGlobal")}</span> : <span className="text-text-industrial/30 text-xs">—</span>),
      sortValue: row => row.isGlobal ? 1 : 0,
    },
  ], [t]);

  const onExecutionSaved = useCallback(() => {
    setEditingExecution(null);
    void reloadExecutions();
  }, [reloadExecutions]);

  const onExecutionResultsSaved = useCallback((updated: InspectionExecution) => {
    setEditingExecution(prev => (prev ? { ...prev, execution: updated } : prev));
    void reloadExecutions();
  }, [reloadExecutions]);

  const onHeaderReload = useCallback(() => {
    if (activeTab === "executions") {
      void reloadExecutions();
    } else {
      void reloadTemplates();
    }
  }, [activeTab, reloadExecutions, reloadTemplates]);

  const total = activeTab === "executions" ? executionsData?.total : templatesData?.total;
  const loading = activeTab === "executions" ? executionsLoading : templatesLoading;
  const error = activeTab === "executions" ? executionsError : templatesError;

  return (
    <div className="space-y-5">
      <PageHeader icon={ShieldCheck} title={t("page.inspections")} total={total} onReload={onHeaderReload}>
        {activeTab === "executions" ? (
          <>
            <select value={toFilterSelectValue(executionStatusFilter)} onChange={e => updateExecutionFilters({ status: fromFilterSelectValue(e.target.value) })} className="bg-fg/5 border border-fg/10 rounded-lg px-3 py-1.5 text-xs text-text-industrial focus:outline-none focus:border-accent/50">
              <option value={FILTER_ALL_VALUE}>{t("status.all")}</option>
              <option value="SCHEDULED">SCHEDULED</option>
              <option value="IN_PROGRESS">{t("status.inProgress")}</option>
              <option value="COMPLETED">{t("status.completed")}</option>
              <option value="CANCELLED">{t("status.cancelled")}</option>
            </select>
            <div className="flex items-center gap-2">
              <input value={executionVesselInput} onChange={e => setExecutionVesselInput(e.target.value.toUpperCase())} onKeyDown={e => { if (e.key === "Enter") updateExecutionFilters({ vessel: executionVesselInput.trim() }); }} placeholder={t("common.filterByVessel")} className="w-44 bg-fg/5 border border-fg/10 rounded-lg px-3 py-1.5 text-xs text-text-industrial placeholder-text-industrial/30 focus:outline-none focus:border-accent/50" />
              <button onClick={() => updateExecutionFilters({ vessel: executionVesselInput.trim() })} className="px-3 py-1.5 rounded-lg bg-fg/5 border border-fg/10 text-xs text-text-industrial hover:border-accent/30 transition-all">{t("common.apply")}</button>
              {(executionStatusFilter || executionVesselFilter) && (
                <button onClick={() => updateExecutionFilters({ status: "", vessel: "" })} className="px-3 py-1.5 rounded-lg bg-fg/5 border border-fg/10 text-xs text-text-industrial/80 hover:text-fg hover:border-red-400/40 transition-all">{t("common.clear")}</button>
              )}
            </div>
          </>
        ) : (
          <>
            <select value={toFilterSelectValue(templateStatusFilter)} onChange={e => updateTemplateFilters({ status: fromFilterSelectValue(e.target.value) })} className="bg-fg/5 border border-fg/10 rounded-lg px-3 py-1.5 text-xs text-text-industrial focus:outline-none focus:border-accent/50">
              <option value={FILTER_ALL_VALUE}>{t("status.all")}</option>
              <option value="ACTIVE">{t("status.active")}</option>
              <option value="INACTIVE">{t("status.inactive")}</option>
            </select>
            <select value={toFilterSelectValue(templateTriggerFilter)} onChange={e => updateTemplateFilters({ trigger: fromFilterSelectValue(e.target.value) })} className="bg-fg/5 border border-fg/10 rounded-lg px-3 py-1.5 text-xs text-text-industrial focus:outline-none focus:border-accent/50">
              <option value={FILTER_ALL_VALUE}>{t("status.all")}</option>
              <option value="CALENDAR">CALENDAR</option>
              <option value="RUNNING_HOURS">RUNNING_HOURS</option>
              <option value="ON_CONDITION">ON_CONDITION</option>
              <option value="EVENT_BASED">EVENT_BASED</option>
            </select>
            {(templateStatusFilter || templateTriggerFilter) && (
              <button onClick={() => updateTemplateFilters({ status: "", trigger: "" })} className="px-3 py-1.5 rounded-lg bg-fg/5 border border-fg/10 text-xs text-text-industrial/80 hover:text-fg hover:border-red-400/40 transition-all">{t("common.clear")}</button>
            )}
          </>
        )}
      </PageHeader>

      <div className="flex gap-1 p-1 bg-fg/5 rounded-xl w-fit border border-fg/10">
        <button onClick={() => setActiveTab("executions")} className={activeTab === "executions" ? "px-4 py-1.5 rounded-lg bg-accent text-primary-bg text-xs font-bold" : "px-4 py-1.5 rounded-lg text-xs text-text-industrial hover:text-fg transition-colors"}>
          {t("insp.executions")}
        </button>
        <button onClick={() => setActiveTab("templates")} className={activeTab === "templates" ? "px-4 py-1.5 rounded-lg bg-accent text-primary-bg text-xs font-bold" : "px-4 py-1.5 rounded-lg text-xs text-text-industrial hover:text-fg transition-colors"}>
          {t("insp.templates")}
        </button>
      </div>

      {detailLoadingId && <div className="flex items-center gap-2 text-xs text-text-industrial/60"><Loader2 className="w-4 h-4 animate-spin text-accent" />Cargando detalle...</div>}
      {detailError && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{detailError}</p>}

      {activeTab === "executions" ? (
        <DataTable columns={executionColumns} data={executionsData?.items ?? null} loading={loading} error={error} keyFn={row => row.id} emptyText={t("empty.inspections")} onRowClick={row => { void openExecutionDetail(row); }} />
      ) : (
        <DataTable columns={templateColumns} data={templatesData?.items ?? null} loading={loading} error={error} keyFn={row => row.id} emptyText={t("empty.inspectionTemplates")} onRowClick={row => { void openTemplateDetail(row); }} />
      )}

      {editingExecution && (
        <ExecutionModal
          editing={editingExecution}
          onClose={() => setEditingExecution(null)}
          onSaved={onExecutionSaved}
          onResultsSaved={onExecutionResultsSaved}
        />
      )}

      {editingTemplate && (
        <TemplateModal
          template={editingTemplate}
          onClose={() => setEditingTemplate(null)}
        />
      )}
    </div>
  );
};
