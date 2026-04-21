import React, { useState } from "react";
import { Sparkles, Loader2, AlertCircle, CheckCircle2, XCircle } from "lucide-react";
import { useFetch } from "../lib/hooks";
import { PriorityBadge, fmtDate } from "../components/DataTable";
import { PageHeader } from "../components/PageHeader";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useT } from "../lib/i18n";
import { FILTER_ALL_VALUE, fromFilterSelectValue, toFilterSelectValue } from "../lib/utils";

interface AiInsight {
  id: string; insightCode: string; insightType: string; priority: string;
  status: string; targetType: string; targetId?: string; vesselCode?: string;
  title: string; summary: string; recommendation: string; detectedAt: string;
}

const PRIORITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];

export const AiInsightsPage: React.FC = () => {
  const t = useT();
  const { user } = useAuth();
  const isAdmin = user?.role === "TENANT_ADMIN";
  const [statusFilter, setStatusFilter] = useState("OPEN");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);

  const path = `/app/ai-insights${statusFilter ? `?status=${statusFilter}` : ""}`;
  const { data, loading, error, reload } = useFetch<{ items: AiInsight[]; total: number }>(path, [statusFilter]);

  const sorted = [...(data?.items ?? [])].sort((a, b) => PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority));

  const handleRefresh = async () => {
    setRefreshing(true); setRefreshMsg(null);
    try {
      const res = await api.post<{ generated: number }>("/app/ai-insights/refresh", {});
      setRefreshMsg(`${res.generated} insight${res.generated !== 1 ? "s" : ""} generado${res.generated !== 1 ? "s" : ""}`);
      reload();
    } catch (err) {
      setRefreshMsg(err instanceof ApiError ? err.message : t("common.error"));
    } finally { setRefreshing(false); }
  };

  return (
    <div className="space-y-5">
      <PageHeader icon={Sparkles} title={t("page.aiInsights")} total={sorted.length} onReload={reload}>
        <select value={toFilterSelectValue(statusFilter)} onChange={e => setStatusFilter(fromFilterSelectValue(e.target.value))} className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-text-industrial focus:outline-none focus:border-accent/50">
          <option value="OPEN">{t("aiInsights.active")}</option>
          <option value="DISMISSED">{t("aiInsights.dismissed")}</option>
          <option value="RESOLVED">{t("aiInsights.resolved")}</option>
          <option value={FILTER_ALL_VALUE}>{t("aiInsights.all")}</option>
        </select>
        {isAdmin && (
          <button onClick={handleRefresh} disabled={refreshing} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-accent/10 border border-accent/20 text-accent text-xs font-bold hover:bg-accent/20 disabled:opacity-50 transition-all">
            {refreshing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            {t("aiInsights.regenerate")}
          </button>
        )}
      </PageHeader>

      {refreshMsg && (
        <div className="flex items-center gap-2 text-xs px-4 py-3 rounded-xl bg-success-sea/10 border border-success-sea/20 text-success-sea">
          <CheckCircle2 className="w-4 h-4 shrink-0" />{refreshMsg}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 text-accent animate-spin" /></div>
      ) : error ? (
        <div className="flex items-center gap-3 text-red-400 text-sm p-4 bg-red-500/10 rounded-xl border border-red-500/20"><AlertCircle className="w-5 h-5 shrink-0" />{error}</div>
      ) : sorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-text-industrial/20 gap-3">
          <CheckCircle2 className="w-8 h-8" />
          <p className="text-sm">{t("aiInsights.noResults")}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {sorted.map(ins => <InsightCard key={ins.id} insight={ins} onStatusChange={reload} />)}
        </div>
      )}
    </div>
  );
};

function InsightCard({ insight, onStatusChange }: { insight: AiInsight; onStatusChange: () => void }) {
  const t = useT();
  const [acting, setActing] = useState(false);
  const targetLabel = insight.vesselCode
    ? <span className="font-mono text-accent text-xs">{insight.vesselCode}</span>
    : <span className="text-text-industrial/30 text-xs">—</span>;

  const handleStatus = async (status: "DISMISSED" | "RESOLVED") => {
    setActing(true);
    try { await api.patch(`/app/ai-insights/${insight.id}`, { status }); onStatusChange(); }
    catch { /* ignore */ }
    finally { setActing(false); }
  };

  return (
    <div className="bento-card space-y-3 hover:scale-[1.005]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] uppercase tracking-widest text-text-industrial/30 font-bold mb-1">
            {insight.insightType.replace(/_/g, " ")} · {insight.targetType}
          </p>
          <h3 className="text-sm font-bold text-white leading-snug">{insight.title}</h3>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <PriorityBadge priority={insight.priority} />
          <StatusDot status={insight.status} />
        </div>
      </div>
      <p className="text-xs text-text-industrial/60 leading-relaxed">{insight.summary}</p>
      <div className="p-3 rounded-xl bg-accent/5 border border-accent/10">
        <p className="text-[10px] uppercase tracking-wider text-accent font-bold mb-1">{t("aiInsights.recommendation")}</p>
        <p className="text-xs text-text-industrial/70">{insight.recommendation}</p>
      </div>
      <div className="flex items-center justify-between text-[10px] text-text-industrial/30 pt-1 border-t border-white/5">
        <span>{t("aiInsights.vessel")} {targetLabel}</span>
        <span>{t("aiInsights.detected")} {fmtDate(insight.detectedAt)}</span>
      </div>
      {insight.status === "OPEN" && (
        <div className="flex gap-2 pt-1">
          <button onClick={() => handleStatus("RESOLVED")} disabled={acting} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-success-sea/10 border border-success-sea/20 text-success-sea text-xs font-bold hover:bg-success-sea/20 disabled:opacity-40 transition-all">
            <CheckCircle2 className="w-3 h-3" /> {t("aiInsights.resolve")}
          </button>
          <button onClick={() => handleStatus("DISMISSED")} disabled={acting} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-text-industrial/40 text-xs font-bold hover:bg-white/10 disabled:opacity-40 transition-all">
            <XCircle className="w-3 h-3" /> {t("aiInsights.dismiss")}
          </button>
        </div>
      )}
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const map: Record<string, string> = { OPEN: "text-accent", RESOLVED: "text-success-sea", DISMISSED: "text-text-industrial/30" };
  const Icon = status === "RESOLVED" ? CheckCircle2 : status === "DISMISSED" ? XCircle : Sparkles;
  return <Icon className={`w-3 h-3 ${map[status] ?? "text-text-industrial/30"}`} />;
}
