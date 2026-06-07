import React, { useState, useMemo } from "react";
import { ChevronLeft, Loader2, CalendarCheck, CheckCircle } from "lucide-react";
import { useFetch } from "../lib/hooks";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useVesselContext } from "../lib/vessel-context";
import { useEscapeGuard } from "../lib/escape-guard";

interface DrillRequirement { title: string; solasRegulation: string | null; intervalLabel: string | null; }
interface Drill {
  id: string;
  drillCode: string;
  vesselCode: string;
  status: string;
  scheduledDate: string;
  completedDate: string | null;
  scenario: string | null;
  observations: string | null;
  lessonsLearned: string | null;
  requirement?: DrillRequirement | null;
}

/** "overdue" = SCHEDULED con fecha pasada; "scheduled" = SCHEDULED futuro; "completed". */
export type DrillsFilter = "overdue" | "scheduled" | "completed";

// Roles que pueden gestionar simulacros (espejo de canManage en drills-service).
const DRILL_MANAGE_ROLES = new Set(["TENANT_ADMIN", "FLEET_SUPERINTENDENT", "MAINTENANCE_MANAGER"]);

type View = "list" | "detail" | "complete";

interface MobileDrillsProps {
  /** Filtro inicial al montar — el dashboard entra en "overdue" (simulacros vencidos). */
  initialFilter?: DrillsFilter;
  /** Vuelve al Panel — esta pantalla se abre desde el dashboard, sin tab en la barra. */
  onBack?: () => void;
}

export const MobileDrills: React.FC<MobileDrillsProps> = ({ initialFilter, onBack }) => {
  const { user } = useAuth();
  const { vessels } = useVesselContext();
  const { data, loading, reload } = useFetch<{ items: Drill[] }>("/app/drills");

  const [filter, setFilter] = useState<DrillsFilter>(initialFilter ?? "overdue");
  React.useEffect(() => {
    if (initialFilter && initialFilter !== filter) setFilter(initialFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFilter]);
  const [view, setView]         = useState<View>("list");
  const [selected, setSelected] = useState<Drill | null>(null);
  const [completedDate, setCompletedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [observations, setObs]  = useState("");
  const [lessons, setLessons]   = useState("");
  const [saving, setSaving]     = useState(false);
  const [err, setErr]           = useState<string | null>(null);

  const canManage = !!user && DRILL_MANAGE_ROLES.has(user.role);
  const vesselName = (code: string) => vessels.find(v => v.code === code)?.name ?? code;

  const now = new Date();
  const isOverdue = (d: Drill) => d.status === "SCHEDULED" && new Date(d.scheduledDate) < now;

  const groups = useMemo(() => {
    const items = data?.items ?? [];
    return {
      overdue:   items.filter(isOverdue),
      scheduled: items.filter(d => d.status === "SCHEDULED" && new Date(d.scheduledDate) >= now),
      completed: items.filter(d => d.status === "COMPLETED"),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const visible = groups[filter];

  const openDetail = (d: Drill) => { setSelected(d); setView("detail"); setErr(null); };
  const backToList = () => { setView("list"); setSelected(null); setErr(null); };

  const handleComplete = async () => {
    if (!selected) return;
    setSaving(true); setErr(null);
    try {
      await api.post(`/app/drills/${selected.id}/complete`, {
        completedDate: completedDate || undefined,
        observations: observations.trim() || null,
        lessonsLearned: lessons.trim() || null,
      });
      await reload();
      backToList();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Error al completar el simulacro");
    } finally {
      setSaving(false);
    }
  };

  useEscapeGuard({ enabled: view === "detail", isDirty: false, onClose: backToList });
  useEscapeGuard({
    enabled: view === "complete",
    isDirty: observations.trim() !== "" || lessons.trim() !== "",
    onSave: handleComplete,
    onClose: () => setView("detail"),
  });

  // ── Complete form ─────────────────────────────────────────────────────────────
  if (view === "complete" && selected) {
    return (
      <div className="flex flex-col h-full">
        <div className="shrink-0 flex items-center gap-3 p-4 border-b border-fg/10">
          <button type="button" onClick={() => setView("detail")} className="p-2 -ml-2 text-text-industrial/40 hover:text-fg">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="font-bold text-sm text-fg truncate">Completar {selected.drillCode}</span>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-text-industrial/40">Fecha de ejecución</label>
            <input
              type="date"
              value={completedDate}
              onChange={e => setCompletedDate(e.target.value)}
              className="w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg focus:outline-none focus:border-accent/50"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-text-industrial/40">Observaciones (opcional)</label>
            <textarea
              value={observations}
              onChange={e => setObs(e.target.value)}
              rows={3}
              placeholder="Cómo se desarrolló…"
              className="w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 resize-none"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-text-industrial/40">Lecciones aprendidas (opcional)</label>
            <textarea
              value={lessons}
              onChange={e => setLessons(e.target.value)}
              rows={3}
              placeholder="Qué mejorar la próxima vez…"
              className="w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 resize-none"
            />
          </div>
          {err && <p className="text-xs text-red-700 dark:text-red-400">{err}</p>}
          <button
            type="button"
            onClick={handleComplete}
            disabled={saving}
            className="w-full py-3 rounded-xl bg-success-sea text-fg text-sm font-bold disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <><CheckCircle className="w-4 h-4" /> Marcar completado</>}
          </button>
        </div>
      </div>
    );
  }

  // ── Detail ──────────────────────────────────────────────────────────────────
  if (view === "detail" && selected) {
    const overdue = isOverdue(selected);
    return (
      <div className="flex flex-col h-full">
        <div className="shrink-0 flex items-center gap-3 p-4 border-b border-fg/10">
          <button type="button" onClick={backToList} className="p-2 -ml-2 text-text-industrial/40 hover:text-fg">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="font-bold text-sm text-fg truncate flex-1">{selected.requirement?.title ?? selected.drillCode}</span>
          <span className={`text-[9px] px-2 py-0.5 rounded-full border font-bold shrink-0 ${
            selected.status === "COMPLETED" ? "bg-success-sea/10 text-success-sea border-success-sea/30"
            : overdue ? "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30"
            : "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30"
          }`}>
            {selected.status === "COMPLETED" ? "Completado" : overdue ? "Vencido" : "Programado"}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div>
            <p className="text-[11px] font-mono text-text-industrial/40">{selected.drillCode}</p>
            <p className="text-xs text-text-industrial/50 mt-0.5">{vesselName(selected.vesselCode)}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-fg/5 border border-fg/10 rounded-xl p-3">
              <p className="text-[10px] uppercase tracking-wider text-text-industrial/40 mb-0.5">Programado</p>
              <p className="text-sm font-bold text-fg">{String(selected.scheduledDate).slice(0, 10)}</p>
            </div>
            {selected.completedDate && (
              <div className="bg-fg/5 border border-fg/10 rounded-xl p-3">
                <p className="text-[10px] uppercase tracking-wider text-text-industrial/40 mb-0.5">Ejecutado</p>
                <p className="text-sm font-bold text-fg">{String(selected.completedDate).slice(0, 10)}</p>
              </div>
            )}
          </div>
          {selected.requirement?.solasRegulation && (
            <div className="bg-fg/5 border border-fg/10 rounded-xl p-3">
              <p className="text-[10px] uppercase tracking-wider text-text-industrial/40 mb-0.5">Regulación</p>
              <p className="text-sm text-fg">{selected.requirement.solasRegulation}</p>
            </div>
          )}
          {selected.scenario && (
            <div className="bg-fg/5 border border-fg/10 rounded-xl p-3">
              <p className="text-[10px] uppercase tracking-wider text-text-industrial/40 mb-1">Escenario</p>
              <p className="text-sm text-fg/80 leading-relaxed whitespace-pre-line">{selected.scenario}</p>
            </div>
          )}
          {selected.observations && (
            <div className="bg-fg/5 border border-fg/10 rounded-xl p-3">
              <p className="text-[10px] uppercase tracking-wider text-text-industrial/40 mb-1">Observaciones</p>
              <p className="text-sm text-fg/80 leading-relaxed whitespace-pre-line">{selected.observations}</p>
            </div>
          )}
          {err && <p className="text-xs text-red-700 dark:text-red-400">{err}</p>}
          {canManage && selected.status === "SCHEDULED" && (
            <button
              type="button"
              onClick={() => { setObs(""); setLessons(""); setCompletedDate(new Date().toISOString().slice(0, 10)); setView("complete"); }}
              className="w-full py-3 rounded-xl bg-success-sea text-fg text-sm font-bold flex items-center justify-center gap-2"
            >
              <CheckCircle className="w-4 h-4" /> Marcar completado
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── List ────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">
      {/* Filter chips */}
      <div className="shrink-0 px-3 py-2.5 border-b border-fg/10 flex items-center gap-1.5 overflow-x-auto">
        {onBack && (
          <button type="button" onClick={onBack} className="shrink-0 p-1 -ml-1 text-text-industrial/40 hover:text-fg" aria-label="Volver al panel">
            <ChevronLeft className="w-5 h-5" />
          </button>
        )}
        {([
          ["overdue",   "Vencidos",    groups.overdue.length,   "text-red-700 dark:text-red-400"],
          ["scheduled", "Programados", groups.scheduled.length, "text-blue-700 dark:text-blue-400"],
          ["completed", "Completados", groups.completed.length, "text-success-sea"],
        ] as [DrillsFilter, string, number, string][]).map(([f, label, count, color]) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`shrink-0 px-3 py-1.5 rounded-lg border text-xs font-bold transition-colors flex items-center gap-1.5 ${
              filter === f
                ? "bg-accent/15 text-accent border-accent/40"
                : "bg-fg/5 text-text-industrial/60 border-fg/10"
            }`}
          >
            {label}
            <span className={`text-[10px] tabular-nums ${filter === f ? "text-accent" : color}`}>({count})</span>
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto divide-y divide-fg/5">
        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="w-5 h-5 animate-spin text-accent" />
          </div>
        ) : visible.length === 0 ? (
          <div className="text-center py-10 text-text-industrial/30 text-sm flex flex-col items-center gap-2">
            <CalendarCheck className="w-6 h-6 text-text-industrial/20" />
            <span>Sin simulacros en esta categoría</span>
          </div>
        ) : (
          visible.map(d => {
            const overdue = isOverdue(d);
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => openDetail(d)}
                className="w-full text-left px-4 py-3.5 hover:bg-fg/5 active:bg-fg/10 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-fg truncate">{d.requirement?.title ?? d.drillCode}</p>
                    <p className="text-xs text-text-industrial/40 truncate mt-0.5">{vesselName(d.vesselCode)}</p>
                  </div>
                  <div className={`text-[10px] font-mono shrink-0 mt-0.5 ${overdue ? "text-red-700 dark:text-red-400 font-bold" : "text-text-industrial/30"}`}>
                    {String(d.completedDate ?? d.scheduledDate).slice(5, 10)}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
};
