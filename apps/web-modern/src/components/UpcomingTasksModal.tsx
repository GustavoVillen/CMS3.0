// "Tareas de la próxima semana" (acceso grande del Dashboard): en UNA lista, los
// planes de mantenimiento que vencen y las órdenes de trabajo abiertas, desde lo
// atrasado hasta el domingo de la semana que viene. Los datos salen de
// /app/dashboard/upcoming-tasks (ver upcoming-tasks-service.ts en la API), que ya
// saca los planes con OT abierta para que nada aparezca dos veces.
import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, CalendarClock, ClipboardList, Download, Loader2, Wrench } from "lucide-react";
import { ModalCloseButton } from "./ModalCloseButton";
import { AssetLabel, VesselLabel } from "./EntityLabels";
import { downloadAuthedFile } from "../lib/authed-media";
import { useVesselContext } from "../lib/vessel-context";
import { fmtDate } from "../lib/utils";
import { useT, useWoTerms } from "../lib/i18n";

export interface UpcomingTaskItem {
  kind: "PLAN" | "WO";
  id: string;
  code: string;
  title: string;
  vesselCode: string;
  assetId: string;
  dueDate: string | null;
  dueHours: number | null;
  currentHours: number | null;
  status: string;
  bucket: "OVERDUE" | "THIS_WEEK" | "NEXT_WEEK";
}

export interface UpcomingTasksResponse {
  nextWeekStart: string;
  windowEnd: string;
  items: UpcomingTaskItem[];
  totals: { overdue: number; thisWeek: number; nextWeek: number; total: number };
}

interface Props {
  data: UpcomingTasksResponse | null;
  loading: boolean;
  onClose: () => void;
}

const BUCKETS = [
  { key: "OVERDUE"   as const, labelKey: "dashboard.upcoming.overdue"  as const, cls: "text-red-700 dark:text-red-400 border-red-500/30 bg-red-500/10" },
  { key: "THIS_WEEK" as const, labelKey: "dashboard.upcoming.thisWeek" as const, cls: "text-accent border-accent/30 bg-accent/10" },
  { key: "NEXT_WEEK" as const, labelKey: "dashboard.upcoming.nextWeek" as const, cls: "text-text-industrial border-fg/15 bg-fg/5" },
];

/** El backlog de vencidos puede tener cientos de filas y tapar lo de la semana:
 *  arranca recortado y se despliega con un click. */
const OVERDUE_PREVIEW = 15;

export const UpcomingTasksModal: React.FC<Props> = ({ data, loading, onClose }) => {
  const t = useT();
  const woTerms = useWoTerms();
  const navigate = useNavigate();
  const { selectedVesselCode } = useVesselContext();
  const [showAllOverdue, setShowAllOverdue] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const byBucket = useMemo(() => {
    const map = new Map<string, UpcomingTaskItem[]>();
    for (const item of data?.items ?? []) {
      const list = map.get(item.bucket) ?? [];
      list.push(item);
      map.set(item.bucket, list);
    }
    return map;
  }, [data]);

  const onPrint = async () => {
    setDownloading(true);
    try {
      const qs = selectedVesselCode ? `?vesselCode=${encodeURIComponent(selectedVesselCode)}` : "";
      const today = new Date().toISOString().slice(0, 10);
      const filename = selectedVesselCode
        ? `Tareas-Pendientes-${selectedVesselCode}-${today}.pdf`
        : `Tareas-Pendientes-${today}.pdf`;
      await downloadAuthedFile(`/app/dashboard/upcoming-tasks.pdf${qs}`, filename);
    } finally {
      setDownloading(false);
    }
  };

  const openItem = (item: UpcomingTaskItem) => {
    onClose();
    navigate(item.kind === "PLAN"
      ? `/maintenance-plans/${encodeURIComponent(item.code)}`
      : `/work-orders/${encodeURIComponent(item.code)}`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-4xl bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl p-6 space-y-4 max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-fg flex items-center gap-2">
              <CalendarClock className="w-4 h-4 text-accent shrink-0" />
              {t("dashboard.upcoming.title").replace("{date}", data ? (fmtDate(data.windowEnd) ?? data.windowEnd) : "…")}
            </h2>
            <p className="text-[11px] text-text-industrial/60 mt-1">{t("dashboard.upcoming.subtitle")}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => { void onPrint(); }}
              disabled={downloading || !data || data.items.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-fg/5 border border-fg/10 text-[11px] font-bold text-text-industrial hover:border-accent/40 hover:text-accent disabled:opacity-40 transition-all"
              title={t("dashboard.upcoming.print")}
            >
              {downloading
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <Download className="w-3.5 h-3.5" />}
              {t("dashboard.upcoming.print")}
            </button>
            <ModalCloseButton onClose={onClose} />
          </div>
        </div>

        {loading && !data ? (
          <div className="flex items-center gap-2 text-xs text-text-industrial/40">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> {t("common.loading")}
          </div>
        ) : (data?.items.length ?? 0) === 0 ? (
          <p className="text-xs text-text-industrial/50 py-6 text-center">{t("dashboard.upcoming.empty")}</p>
        ) : (
          <div className="overflow-y-auto flex-1 min-h-0 space-y-4 pr-1">
            {BUCKETS.map(bucket => {
              const all = byBucket.get(bucket.key) ?? [];
              if (all.length === 0) return null;
              const trimmed = bucket.key === "OVERDUE" && !showAllOverdue && all.length > OVERDUE_PREVIEW;
              const items = trimmed ? all.slice(0, OVERDUE_PREVIEW) : all;
              return (
                <div key={bucket.key} className="space-y-1.5">
                  <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-lg border text-[11px] font-bold uppercase tracking-wider ${bucket.cls}`}>
                    {bucket.key === "OVERDUE" && <AlertTriangle className="w-3.5 h-3.5" />}
                    {t(bucket.labelKey)}
                    <span className="opacity-60">({all.length})</span>
                  </div>
                  {items.map(item => (
                    <button
                      key={`${item.kind}:${item.id}`}
                      onClick={() => openItem(item)}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-xl border border-fg/10 bg-fg/[0.03] hover:border-accent/40 hover:bg-fg/10 transition-all text-left"
                    >
                      {/* Plan u OT: la etiqueta dice de dónde sale la tarea, para
                          saber si hay que abrir la orden o reportar el plan. */}
                      <span
                        title={item.kind === "PLAN" ? t("dashboard.upcoming.plan") : woTerms.full}
                        className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-fg/10 bg-fg/5 text-[10px] font-bold text-text-industrial/70 uppercase"
                      >
                        {item.kind === "PLAN"
                          ? <ClipboardList className="w-3 h-3" />
                          : <Wrench className="w-3 h-3" />}
                        {item.kind === "PLAN" ? t("dashboard.upcoming.plan") : woTerms.abbr}
                      </span>
                      <span className="flex flex-col min-w-0 flex-1">
                        <span className="text-[12px] font-bold text-fg leading-tight line-clamp-1">{item.title}</span>
                        <span className="text-[11px] text-text-industrial/60 leading-tight line-clamp-1 flex items-center gap-1.5">
                          <VesselLabel code={item.vesselCode} className="text-[11px]" />
                          <span className="opacity-40">·</span>
                          <AssetLabel id={item.assetId} className="text-[11px]" />
                        </span>
                      </span>
                      <span className="shrink-0 flex flex-col items-end">
                        <span className={`font-mono text-[11px] whitespace-nowrap ${item.bucket === "OVERDUE" ? "text-red-700 dark:text-red-400 font-bold" : "text-fg"}`}>
                          {item.dueDate
                            ? fmtDate(item.dueDate)
                            : item.dueHours != null
                              ? `${item.dueHours.toLocaleString()} hs`
                              : "—"}
                        </span>
                        <span className="text-[10px] font-mono text-text-industrial/40 whitespace-nowrap">
                          {item.code}
                        </span>
                      </span>
                    </button>
                  ))}
                  {bucket.key === "OVERDUE" && all.length > OVERDUE_PREVIEW && (
                    <button
                      type="button"
                      onClick={() => setShowAllOverdue(v => !v)}
                      className="text-[11px] font-bold text-accent hover:underline px-1 py-1"
                    >
                      {trimmed
                        ? t("dashboard.upcoming.showAll").replace("{n}", String(all.length))
                        : t("dashboard.upcoming.showLess")}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
