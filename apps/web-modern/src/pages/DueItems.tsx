import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertCircle, Bell, CalendarCheck, CalendarClock, Clock, Loader2, X } from "lucide-react";
import { useFetch } from "../lib/hooks";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { DataTable, type Column } from "../components/DataTable";
import { FILTER_ALL_VALUE, fmtDate, fromFilterSelectValue, toFilterSelectValue } from "../lib/utils";
import { PageHeader } from "../components/PageHeader";
import { useT } from "../lib/i18n";

interface DueItem {
  id: string;
  taskCode: string;
  title: string;
  vesselCode: string;
  assetId: string;
  triggerType: string;
  executionStatus: string;
  nextDueDate: string | null;
  frequencyMonths: number | null;
  frequencyHours: number | null;
  triggerResultMode: string;
}

interface DueItemsListResponse {
  items: DueItem[];
  total: number;
}

interface DueItemsSummary {
  overdue: number;
  due: number;
  inWindow: number;
  upcoming: number;
}

const EXEC_STATUS_STYLES: Record<string, string> = {
  FUTURE: "bg-white/5 text-text-industrial/40 border-white/10",
  UPCOMING: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  IN_WINDOW: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  DUE: "bg-accent/10 text-accent border-accent/20",
  OVERDUE: "bg-red-500/10 text-red-400 border-red-500/20",
  COMPLETED: "bg-success-sea/10 text-success-sea border-success-sea/20",
};

function ExecutionStatusBadge({ status }: { status: string }) {
  const cls = EXEC_STATUS_STYLES[status] ?? "bg-white/5 text-text-industrial/40 border-white/10";
  return (
    <span className={`inline-block text-[10px] px-2 py-0.5 rounded-full border font-bold ${cls}`}>
      {status}
    </span>
  );
}

function normalizeOptionalText(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed || undefined;
}

interface QuickCloseModalProps {
  planId: string;
  userId: string | null;
  onClose: () => void;
  onSuccess: () => void;
}

const QuickCloseModal: React.FC<QuickCloseModalProps> = ({ planId, userId, onClose, onSuccess }) => {
  const t = useT();
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const onSave = async () => {
    if (!userId) {
      setActionError("No se pudo resolver el usuario autenticado.");
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      await api.post(`/app/pms/maintenance-plans/${planId}/quick-close`, {
        closedByUserId: userId,
        notes: normalizeOptionalText(notes),
      });
      onSuccess();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t("common.saveError"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-[#0D1B2A] border border-white/10 rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <h2 className="text-base font-bold text-white">{t("mp.quickClose")}</h2>
          <button onClick={onClose} className="text-text-industrial/40 hover:text-white transition-colors"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">Notes</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={4}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-text-industrial/30 focus:outline-none focus:border-accent/50"
              placeholder="Observaciones del cierre rapido"
            />
          </div>
          {actionError && (
            <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">
              {actionError}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-white/10">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-white transition-colors">Cancelar</button>
          <button onClick={() => { void onSave(); }} disabled={saving} className="px-4 py-2 rounded-xl bg-accent text-primary-bg font-bold text-xs hover:brightness-110 disabled:opacity-50 transition-all">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
};

export const DueItemsPage: React.FC = () => {
  const t = useT();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const vesselFilter = (searchParams.get("vesselCode") ?? "").trim();
  const executionStatusFilter = (searchParams.get("executionStatus") ?? "").trim();
  const [vesselInput, setVesselInput] = useState(vesselFilter);
  const [quickCloseTarget, setQuickCloseTarget] = useState<DueItem | null>(null);
  const [openWoLoadingId, setOpenWoLoadingId] = useState<string | null>(null);
  const [inlineActionError, setInlineActionError] = useState<string | null>(null);

  useEffect(() => {
    setVesselInput(vesselFilter);
  }, [vesselFilter]);

  const updateFilters = (next: { vesselCode?: string; executionStatus?: string }) => {
    const params = new URLSearchParams(searchParams);
    const nextVessel = next.vesselCode !== undefined ? next.vesselCode : vesselFilter;
    const nextStatus = next.executionStatus !== undefined ? next.executionStatus : executionStatusFilter;
    if (nextVessel) params.set("vesselCode", nextVessel); else params.delete("vesselCode");
    if (nextStatus) params.set("executionStatus", nextStatus); else params.delete("executionStatus");
    setSearchParams(params, { replace: true });
  };

  const listPath = useMemo(() => {
    const params = new URLSearchParams();
    if (vesselFilter) params.set("vesselCode", vesselFilter);
    if (executionStatusFilter) params.set("executionStatus", executionStatusFilter);
    const query = params.toString();
    return `/app/pms/due-items${query ? `?${query}` : ""}`;
  }, [executionStatusFilter, vesselFilter]);

  const { data, loading, error, reload } = useFetch<DueItemsListResponse>(listPath, [listPath]);
  const { data: summary, loading: summaryLoading, error: summaryError, reload: reloadSummary } =
    useFetch<DueItemsSummary>("/app/pms/due-items/summary", []);

  const handleOpenWorkOrder = useCallback(async (item: DueItem) => {
    setOpenWoLoadingId(item.id);
    setInlineActionError(null);
    try {
      await api.post(`/app/pms/maintenance-plans/${item.id}/open-work-order`, {
        title: item.title,
        priority: "HIGH",
      });
      await Promise.all([reload(), reloadSummary()]);
    } catch (err) {
      setInlineActionError(err instanceof ApiError ? err.message : t("common.saveError"));
    } finally {
      setOpenWoLoadingId(null);
    }
  }, [reload, reloadSummary, t]);

  const columns: Column<DueItem>[] = useMemo(() => [
    {
      key: "taskCode",
      header: t("mp.taskCode"),
      render: row => <span className="font-mono font-bold text-white text-xs">{row.taskCode}</span>,
    },
    {
      key: "title",
      header: t("col.title"),
      render: row => <span className="font-medium text-white line-clamp-1">{row.title}</span>,
    },
    {
      key: "vesselCode",
      header: t("col.vessel"),
      render: row => <span className="font-mono text-accent text-xs">{row.vesselCode}</span>,
    },
    {
      key: "executionStatus",
      header: t("mp.executionStatus"),
      render: row => <ExecutionStatusBadge status={row.executionStatus} />,
    },
    {
      key: "triggerType",
      header: t("mp.triggerType"),
      render: row => row.triggerType || "\u2014",
    },
    {
      key: "nextDueDate",
      header: t("mp.nextDue"),
      render: row => fmtDate(row.nextDueDate),
    },
    {
      key: "actions",
      header: t("common.actions"),
      sortable: false,
      render: row => {
        const canOpenWo = row.triggerResultMode === "AUTO_WO" || row.triggerResultMode === "APPROVAL_WO";
        const canQuickClose = row.executionStatus === "DUE" || row.executionStatus === "OVERDUE";
        const isOpeningWo = openWoLoadingId === row.id;

        return (
          <div className="flex items-center gap-2">
            {canOpenWo && (
              <button
                onClick={e => {
                  e.stopPropagation();
                  void handleOpenWorkOrder(row);
                }}
                disabled={isOpeningWo}
                className="px-2 py-1 rounded-lg bg-accent/10 border border-accent/20 text-accent text-[10px] font-bold hover:brightness-110 disabled:opacity-60 transition-all"
              >
                {isOpeningWo ? <Loader2 className="w-3 h-3 animate-spin" /> : t("mp.openWorkOrder")}
              </button>
            )}
            {canQuickClose && (
              <button
                onClick={e => {
                  e.stopPropagation();
                  setQuickCloseTarget(row);
                }}
                className="px-2 py-1 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-[10px] font-bold hover:bg-red-500/15 transition-all"
              >
                {t("mp.quickClose")}
              </button>
            )}
            {!canOpenWo && !canQuickClose && <span className="text-text-industrial/30">\u2014</span>}
          </div>
        );
      },
    },
  ], [handleOpenWorkOrder, openWoLoadingId, t]);

  return (
    <div className="space-y-5">
      <PageHeader icon={Bell} title={t("page.dueItems")} total={data?.total} onReload={() => { void Promise.all([reload(), reloadSummary()]); }}>
        <select
          value={toFilterSelectValue(executionStatusFilter)}
          onChange={e => updateFilters({ executionStatus: fromFilterSelectValue(e.target.value) })}
          className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-text-industrial focus:outline-none focus:border-accent/50"
        >
          <option value={FILTER_ALL_VALUE}>{t("status.all")}</option>
          <option value="OVERDUE">OVERDUE</option>
          <option value="DUE">DUE</option>
          <option value="IN_WINDOW">IN_WINDOW</option>
          <option value="UPCOMING">UPCOMING</option>
        </select>
        <div className="flex items-center gap-2">
          <input
            value={vesselInput}
            onChange={e => setVesselInput(e.target.value.toUpperCase())}
            onKeyDown={e => {
              if (e.key === "Enter") updateFilters({ vesselCode: vesselInput.trim() });
            }}
            placeholder={t("common.filterByVessel")}
            className="w-44 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-text-industrial placeholder-text-industrial/30 focus:outline-none focus:border-accent/50"
          />
          <button
            onClick={() => updateFilters({ vesselCode: vesselInput.trim() })}
            className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-text-industrial hover:border-accent/30 transition-all"
          >
            {t("common.apply")}
          </button>
          {(vesselFilter || executionStatusFilter) && (
            <button
              onClick={() => updateFilters({ vesselCode: "", executionStatus: "" })}
              className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-text-industrial/80 hover:text-white hover:border-red-400/40 transition-all"
            >
              {t("common.clear")}
            </button>
          )}
        </div>
      </PageHeader>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <button
          onClick={() => updateFilters({ executionStatus: executionStatusFilter === "OVERDUE" ? "" : "OVERDUE" })}
          className={`bento-card text-left ${executionStatusFilter === "OVERDUE" ? "ring-1 ring-red-500/50" : ""}`}
        >
          <div className="flex items-center justify-between mb-2">
            <AlertCircle className="w-4 h-4 text-red-400" />
            {summaryLoading && <Loader2 className="w-3 h-3 text-red-400 animate-spin" />}
          </div>
          <p className="text-xs text-text-industrial/40 font-medium mb-1">{t("di.overdue")}</p>
          <p className="text-2xl font-bold tracking-tight text-red-400">{summary?.overdue ?? 0}</p>
        </button>

        <button
          onClick={() => updateFilters({ executionStatus: executionStatusFilter === "DUE" ? "" : "DUE" })}
          className={`bento-card text-left ${executionStatusFilter === "DUE" ? "ring-1 ring-accent/60" : ""}`}
        >
          <div className="flex items-center justify-between mb-2">
            <Clock className="w-4 h-4 text-accent" />
            {summaryLoading && <Loader2 className="w-3 h-3 text-accent animate-spin" />}
          </div>
          <p className="text-xs text-text-industrial/40 font-medium mb-1">{t("di.due")}</p>
          <p className="text-2xl font-bold tracking-tight text-accent">{summary?.due ?? 0}</p>
        </button>

        <button
          onClick={() => updateFilters({ executionStatus: executionStatusFilter === "IN_WINDOW" ? "" : "IN_WINDOW" })}
          className={`bento-card text-left ${executionStatusFilter === "IN_WINDOW" ? "ring-1 ring-yellow-400/50" : ""}`}
        >
          <div className="flex items-center justify-between mb-2">
            <CalendarClock className="w-4 h-4 text-yellow-400" />
            {summaryLoading && <Loader2 className="w-3 h-3 text-yellow-400 animate-spin" />}
          </div>
          <p className="text-xs text-text-industrial/40 font-medium mb-1">{t("di.inWindow")}</p>
          <p className="text-2xl font-bold tracking-tight text-yellow-400">{summary?.inWindow ?? 0}</p>
        </button>

        <button
          onClick={() => updateFilters({ executionStatus: executionStatusFilter === "UPCOMING" ? "" : "UPCOMING" })}
          className={`bento-card text-left ${executionStatusFilter === "UPCOMING" ? "ring-1 ring-blue-400/50" : ""}`}
        >
          <div className="flex items-center justify-between mb-2">
            <CalendarCheck className="w-4 h-4 text-blue-400" />
            {summaryLoading && <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />}
          </div>
          <p className="text-xs text-text-industrial/40 font-medium mb-1">{t("di.upcoming")}</p>
          <p className="text-2xl font-bold tracking-tight text-blue-400">{summary?.upcoming ?? 0}</p>
        </button>
      </div>

      {(inlineActionError || summaryError) && (
        <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          {inlineActionError ?? summaryError}
        </p>
      )}

      <DataTable
        columns={columns}
        data={data?.items ?? null}
        loading={loading}
        error={error}
        keyFn={row => row.id}
        emptyText={t("empty.dueItems")}
      />

      {quickCloseTarget && (
        <QuickCloseModal
          planId={quickCloseTarget.id}
          userId={user?.id ?? null}
          onClose={() => setQuickCloseTarget(null)}
          onSuccess={() => {
            setQuickCloseTarget(null);
            void Promise.all([reload(), reloadSummary()]);
          }}
        />
      )}
    </div>
  );
};
