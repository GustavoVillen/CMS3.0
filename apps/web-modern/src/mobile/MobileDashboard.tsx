import React from "react";
import { Loader2 } from "lucide-react";
import { useFetch } from "../lib/hooks";

interface WO { status: string; dueDate: string | null; }
interface Defect { status: string; }
interface Spare { currentStock: number; minStock: number; reorderPoint: number; }
interface Insight { id: string; title: string; summary: string; priority: string; }

const PRIORITY_BG: Record<string, string> = {
  CRITICAL: "border-red-500/40 bg-red-500/5",
  HIGH:     "border-orange-500/40 bg-orange-500/5",
  MEDIUM:   "border-yellow-500/40 bg-yellow-500/5",
};

function KpiCard({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-4">
      <div className="text-[10px] font-bold uppercase tracking-wider text-text-industrial/40 mb-1">{label}</div>
      <div className={`text-3xl font-bold tabular-nums ${warn ? "text-amber-400" : "text-white"}`}>{value}</div>
    </div>
  );
}

export const MobileDashboard: React.FC = () => {
  const { data: woData,  loading: woLoading  } = useFetch<{ items: WO[]      }>("/app/pms/work-orders");
  const { data: defData, loading: defLoading } = useFetch<{ items: Defect[]  }>("/app/pms/defects");
  const { data: spData                        } = useFetch<{ items: Spare[]   }>("/app/pms/spares");
  const { data: aiData                        } = useFetch<{ items: Insight[] }>("/app/ai-insights");

  const today = new Date(); today.setHours(0, 0, 0, 0);

  const openWOs    = (woData?.items  ?? []).filter(w => w.status === "PLANNED" || w.status === "IN_PROGRESS");
  const overdueWOs = openWOs.filter(w => w.dueDate && new Date(w.dueDate) < today);
  const openDefs   = (defData?.items ?? []).filter(d => d.status === "OPEN");
  const lowSpares  = (spData?.items  ?? []).filter(s => s.currentStock <= s.reorderPoint);
  const insights   = (aiData?.items  ?? []).slice(0, 6);
  const loading    = woLoading || defLoading;

  return (
    <div className="p-4 space-y-5 pb-6">
      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="w-6 h-6 animate-spin text-accent" />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <KpiCard label="OTs abiertas"      value={openWOs.length} />
          <KpiCard label="OTs vencidas"      value={overdueWOs.length} warn={overdueWOs.length > 0} />
          <KpiCard label="Defectos abiertos" value={openDefs.length}   warn={openDefs.length > 0} />
          <KpiCard label="Bajo reorden"      value={lowSpares.length}  warn={lowSpares.length > 0} />
        </div>
      )}

      {insights.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-text-industrial/40">Alertas IA</p>
          {insights.map(ins => (
            <div
              key={ins.id}
              className={`rounded-xl border p-3 ${PRIORITY_BG[ins.priority] ?? "border-white/10 bg-white/5"}`}
            >
              <p className="text-xs font-bold text-white leading-snug">{ins.title}</p>
              <p className="text-xs text-text-industrial/50 mt-0.5 line-clamp-2">{ins.summary}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
