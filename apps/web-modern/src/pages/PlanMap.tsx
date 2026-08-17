import React, { useMemo, useState } from "react";
import {
  Map as MapIcon, Ship, Fan, Zap, Compass, Droplets, LifeBuoy, Cog,
  Package, Cpu, ClipboardCheck, Loader2, AlertTriangle,
} from "lucide-react";
import { useFetch } from "../lib/hooks";
import { useVesselContext } from "../lib/vessel-context";
import { PageHeader } from "../components/PageHeader";
import { useT, type TranslationKey } from "../lib/i18n";

// ─── Mapa del Plan ────────────────────────────────────────────────────────────
// Vista estructural del plan de mantenimiento de UN buque: qué sistemas concentran
// el trabajo, qué familias de equipos hay adentro, en qué frecuencias caen las
// tareas y cuánta carga anual implica. Complementa —no reemplaza— la lista de
// planes: acá se ve cómo está armado el plan, no el detalle tarea por tarea.
//
// Todo el agregado viene resuelto del backend (/app/dashboard/plan-map). Lo único
// que se calcula acá es el supuesto de horas de marcha al año, que el usuario
// cambia con los botones y no justifica volver a pedir datos.

// ─── Types (espejo de plan-map-service.ts) ────────────────────────────────────

type DueState = "overdue" | "dueSoon" | "inWindow" | "onSchedule" | "unscheduled";

interface PlanMapTask {
  title: string;
  freqHours: number | null;
  freqMonths: number | null;
  trigger: string;
  riskLevel: string | null;
  dueState: DueState;
}
interface PlanMapAsset {
  id: string;
  assetCode: string;
  name: string;
  criticality: string;
  safetyCritical: boolean;
  tasks: number;
  dueState: DueState;
  items: PlanMapTask[];
}
interface PlanMapFamily { family: string; assets: PlanMapAsset[]; tasks: number }
interface PlanMapSystem {
  group: number;
  tasks: number;
  assetCount: number;
  riskHigh: number;
  riskMedium: number;
  riskLow: number;
  riskNone: number;
  families: PlanMapFamily[];
}
interface PlanMapWorkload {
  group: number;
  calendarHours: number;
  hoursPerRunHour: number;
  calendarOccurrences: number;
  occurrencesPerRunHour: number;
}
interface PlanMapResponse {
  vessel: { code: string; name: string; vesselType: string | null } | null;
  systems: PlanMapSystem[];
  calendarLadder: { key: string; count: number }[];
  hoursLadder: { hours: number; count: number }[];
  eventCount: number;
  workload: PlanMapWorkload[];
  state: {
    total: number; inspections: number;
    overdue: number; dueSoon: number; inWindow: number; onSchedule: number; unscheduled: number;
    noRisk: number; riskHigh: number; riskMedium: number; riskLow: number;
    assetsWithPlan: number; assetsTotal: number; criticalityA: number; safetyCritical: number;
  };
  upcoming: { taskCode: string; title: string; assetName: string; nextDueDate: string; dueState: DueState }[];
}

// ─── Mapas de claves (tipados: una clave inexistente rompe el typecheck) ──────

const SFI_KEYS: TranslationKey[] = [
  "sfi.g.0", "sfi.g.1", "sfi.g.2", "sfi.g.3", "sfi.g.4",
  "sfi.g.5", "sfi.g.6", "sfi.g.7", "sfi.g.8", "sfi.g.9",
];

const SFI_ICONS = [
  ClipboardCheck, // 0 Inspecciones y Pruebas
  Ship,           // 1 Casco y Estructuras
  Package,        // 2 Sistemas de Carga
  LifeBuoy,       // 3 LCI y Salvamento
  Compass,        // 4 Navegación
  Droplets,       // 5 Habitabilidad
  Fan,            // 6 Propulsión y Generación
  Cog,            // 7 Auxiliares
  Zap,            // 8 Eléctricos
  Cpu,            // 9 Automatización y Control
];

const FAMILY_KEYS: Record<string, TranslationKey> = {
  mainEngines: "pmap.fam.mainEngines", auxEngines: "pmap.fam.auxEngines",
  gearboxes: "pmap.fam.gearboxes", propellers: "pmap.fam.propellers",
  shafts: "pmap.fam.shafts", alternators: "pmap.fam.alternators",
  radars: "pmap.fam.radars", vhf: "pmap.fam.vhf", winches: "pmap.fam.winches",
  pumps: "pmap.fam.pumps", compressors: "pmap.fam.compressors",
  airReceivers: "pmap.fam.airReceivers", filters: "pmap.fam.filters",
  switchboards: "pmap.fam.switchboards", firefighting: "pmap.fam.firefighting",
  mooring: "pmap.fam.mooring", steering: "pmap.fam.steering",
  fuel: "pmap.fam.fuel", other: "pmap.fam.other",
};

const FREQ_KEYS: Record<string, TranslationKey> = {
  WEEK: "pmap.freq.WEEK", M1: "pmap.freq.M1", M3: "pmap.freq.M3", M6: "pmap.freq.M6",
  M12: "pmap.freq.M12", M18: "pmap.freq.M18", M24: "pmap.freq.M24", M36: "pmap.freq.M36",
  M60: "pmap.freq.M60", M120: "pmap.freq.M120", MX: "pmap.freq.MX",
};

// Criticidad A/B/C como rampa de un solo tono: A es el paso más fuerte.
const CRIT_DOT: Record<string, string> = {
  A: "bg-accent",
  B: "bg-accent/60",
  C: "bg-accent/30",
};

const RUN_HOUR_OPTIONS = [2000, 3000, 5000];

// Semáforo de vencimiento. Colores de estado, separados del acento de la app:
// el borde izquierdo pinta la ficha del equipo y el punto acompaña en la leyenda,
// siempre junto a su texto (el color nunca queda solo cargando el significado).
const DUE_STYLE: Record<DueState, { bar: string; dot: string; label: TranslationKey; help: TranslationKey }> = {
  overdue:     { bar: "border-l-red-500",     dot: "bg-red-500",     label: "pmap.due.overdue",     help: "pmap.due.overdueHelp" },
  dueSoon:     { bar: "border-l-orange-500",  dot: "bg-orange-500",  label: "pmap.due.dueSoon",     help: "pmap.due.dueSoonHelp" },
  inWindow:    { bar: "border-l-yellow-500",  dot: "bg-yellow-500",  label: "pmap.due.inWindow",    help: "pmap.due.inWindowHelp" },
  onSchedule:  { bar: "border-l-emerald-500", dot: "bg-emerald-500", label: "pmap.due.onSchedule",  help: "pmap.due.onScheduleHelp" },
  unscheduled: { bar: "border-l-fg/25",       dot: "bg-fg/25",       label: "pmap.due.unscheduled", help: "pmap.due.unscheduledHelp" },
};
const DUE_ORDER: DueState[] = ["overdue", "dueSoon", "inWindow", "onSchedule", "unscheduled"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number): string => Math.round(n).toLocaleString();
const fill = (s: string, vars: Record<string, string | number>): string =>
  Object.entries(vars).reduce((acc, [k, v]) => acc.replace(`{${k}}`, String(v)), s);

// ─── Tooltip de ayuda (CSS puro: sin posicionamiento en JS) ───────────────────

// Las explicaciones de una línea van en el aviso nativo del navegador: no ocupan
// lugar en la página. Un globo dibujado con posición absoluta sí lo ocupa aunque
// esté invisible, y eso metía una barra de desplazamiento horizontal permanente.
// El globo dibujado queda sólo para las fichas de equipo, que muestran una lista.
const Help: React.FC<{ text: string; className?: string; children: React.ReactNode }> =
  ({ text, className, children }) => (
    <span className={`inline-flex items-center gap-1.5 cursor-help ${className ?? ""}`} title={text} tabIndex={0}>
      {children}
    </span>
  );

// ─── Piezas ───────────────────────────────────────────────────────────────────

const StatCard: React.FC<{ label: string; help: string; value: React.ReactNode; hint?: string }> =
  ({ label, help, value, hint }) => (
    <div className="bento-card p-3!">
      <Help text={help}>
        <span className="text-[10px] text-text-industrial/50 uppercase tracking-widest underline decoration-dotted underline-offset-4">
          {label}
        </span>
      </Help>
      <p className="text-2xl font-bold text-fg mt-1">{value}</p>
      {hint && <p className="text-[10px] text-text-industrial/40 mt-0.5">{hint}</p>}
    </div>
  );

/** Barra horizontal de una escalera de frecuencias. */
const LadderRow: React.FC<{ label: string; count: number; max: number; tone: string }> =
  ({ label, count, max, tone }) => (
    <>
      <span className="text-xs text-text-industrial/60 whitespace-nowrap">{label}</span>
      <span className="h-3 rounded-r bg-fg/5 block">
        <span
          className={`block h-full rounded-r ${tone}`}
          style={{ width: `${max > 0 ? (100 * count) / max : 0}%` }}
        />
      </span>
      <span className="text-xs text-fg tabular-nums text-right min-w-[2ch]">{count}</span>
    </>
  );

/** Ficha de un equipo, con su lista de tareas al pasar el puntero. */
const AssetChip: React.FC<{ asset: PlanMapAsset; t: ReturnType<typeof useT> }> = ({ asset, t }) => {
  const freqLabel = (item: PlanMapTask): string => {
    if (item.trigger === "HOURS" && item.freqHours) return `${item.freqHours.toLocaleString()} h`;
    if (item.trigger === "WEEK") return t("pmap.freq.WEEK");
    if (item.trigger === "EVENT") return t("pmap.freq.event");
    const m = item.freqMonths;
    if (m == null) return "—";
    const key = FREQ_KEYS[`M${m}`];
    return key ? t(key) : fill(t("pmap.freq.months"), { n: m });
  };

  return (
    <span
      className={`relative group inline-flex items-center gap-1.5 rounded-md border border-fg/10 border-l-4 ${DUE_STYLE[asset.dueState].bar} bg-surface pl-1.5 pr-1.5 py-1 text-xs cursor-help`}
      tabIndex={0}
    >
      <span className={`w-2 h-2 rounded-full shrink-0 ${CRIT_DOT[asset.criticality] ?? CRIT_DOT.C}`} />
      <span className="truncate max-w-[22ch] text-fg/90">{asset.name}</span>
      {asset.safetyCritical && (
        <span className="text-red-700 dark:text-red-400 font-bold text-[10px]" aria-hidden="true">▲</span>
      )}
      <span className="text-[10px] text-text-industrial/50 tabular-nums">{asset.tasks}</span>

      {/* hidden hasta el hover: un globo absoluto siempre presente agranda el
          ancho de la página y saca una barra de desplazamiento horizontal. */}
      <span
        role="tooltip"
        className="pointer-events-none hidden group-hover:block group-focus-within:block absolute left-0 top-full z-50 mt-1 w-64 rounded-lg border border-fg/15 bg-surface p-2.5 text-[11px] text-text-industrial/80 shadow-lg"
      >
        <span className="block font-bold text-fg text-xs">{asset.name}</span>
        <span className="block text-text-industrial/50 mb-1.5">
          {asset.assetCode} · {t("asset.criticalityOf")} {asset.criticality}
          {asset.safetyCritical && ` · ${t("pmap.legend.safety")}`}
        </span>
        {asset.items.slice(0, 12).map((item, i) => (
          <span key={i} className="flex items-center justify-between gap-2 border-t border-fg/10 py-0.5 first:border-t-0">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${DUE_STYLE[item.dueState].dot}`} />
            <span className="text-fg/80 flex-1">{item.title}</span>
            <span className="tabular-nums whitespace-nowrap text-text-industrial/60">{freqLabel(item)}</span>
          </span>
        ))}
        {asset.items.length > 12 && (
          <span className="block pt-1 text-text-industrial/50">
            {fill(t("pmap.map.moreTasks"), { n: asset.items.length - 12 })}
          </span>
        )}
      </span>
    </span>
  );
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export const PlanMapPage: React.FC = () => {
  const t = useT();
  const { vessels, selectedVesselCode } = useVesselContext();
  // Sin buque en el contexto (vista "toda la flota") el mapa no se puede armar:
  // mezclar la flota entera no se lee. Se pide elegir uno acá mismo.
  const [localVessel, setLocalVessel] = useState<string | null>(null);
  const vesselCode = selectedVesselCode ?? localVessel;
  const [runHours, setRunHours] = useState<number>(3000);

  const { data, loading, error, reload } = useFetch<PlanMapResponse>(
    vesselCode ? `/app/dashboard/plan-map?vesselCode=${encodeURIComponent(vesselCode)}` : null,
    [vesselCode],
  );

  const totals = useMemo(() => {
    if (!data) return { calHours: 0, runH: 0, jobs: 0 };
    let calHours = 0, runH = 0, jobs = 0;
    for (const w of data.workload) {
      calHours += w.calendarHours;
      runH += w.hoursPerRunHour * runHours;
      jobs += w.calendarOccurrences + w.occurrencesPerRunHour * runHours;
    }
    return { calHours, runH, jobs };
  }, [data, runHours]);

  const workloadRows = useMemo(() => {
    if (!data) return [];
    return data.workload
      .map(w => ({ ...w, runH: w.hoursPerRunHour * runHours, total: w.calendarHours + w.hoursPerRunHour * runHours }))
      .sort((a, b) => b.total - a.total);
  }, [data, runHours]);

  const header = (
    <PageHeader icon={MapIcon} title={t("pmap.title")} total={data?.state.total} onReload={reload}>
      {data?.vessel && (
        <span className="text-xs text-text-industrial/60">
          {data.vessel.name}
          {data.vessel.vesselType ? ` · ${data.vessel.vesselType}` : ""}
        </span>
      )}
    </PageHeader>
  );

  // Sin buque: selector y nada más.
  if (!vesselCode) {
    return (
      <div className="space-y-4">
        {header}
        <div className="bento-card p-4! flex flex-wrap items-center gap-3">
          <p className="text-sm text-text-industrial/70">{t("pmap.pickVessel")}</p>
          <select
            value=""
            onChange={e => setLocalVessel(e.target.value || null)}
            className="bg-primary-bg/60 border border-fg/10 rounded-lg px-2 py-1 text-xs text-fg focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <option value="">{t("pmap.vessel")}…</option>
            {vessels.map(v => <option key={v.code} value={v.code}>{v.name}</option>)}
          </select>
        </div>
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="space-y-4">
        {header}
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 text-accent animate-spin" />
        </div>
      </div>
    );
  }

  // Sin datos, sin buque visible o con el buque cargado pero sin ninguna tarea:
  // un aviso claro. Sin este corte la pantalla mostraba una pared de ceros, que
  // se lee como si el plan estuviera vacío por un error.
  if (error || !data || !data.vessel || data.state.total === 0) {
    return (
      <div className="space-y-4">
        {header}
        <div className="bento-card p-3! flex items-start gap-3 border-yellow-500/40 bg-yellow-500/5">
          <AlertTriangle className="w-4 h-4 text-yellow-700 dark:text-yellow-400 shrink-0 mt-0.5" />
          <p className="text-xs text-text-industrial/70">{error ?? t("pmap.empty")}</p>
        </div>
      </div>
    );
  }

  const s = data.state;
  const riskPct = s.total > 0 ? Math.round((100 * (s.total - s.noRisk)) / s.total) : 0;
  const calMax = Math.max(1, ...data.calendarLadder.map(r => r.count));
  const hrsMax = Math.max(1, ...data.hoursLadder.map(r => r.count));
  const loadMax = Math.max(1, ...workloadRows.map(r => r.total));

  return (
    <div className="space-y-4">
      {header}

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        <StatCard
          label={t("pmap.kpi.tasks")} help={t("pmap.kpi.tasksHelp")} value={fmt(s.total)}
          hint={fill(t("pmap.kpi.tasksNote"), { i: s.inspections, m: s.total - s.inspections })}
        />
        <StatCard
          label={t("pmap.kpi.assets")} help={t("pmap.kpi.assetsHelp")}
          value={<>{s.assetsWithPlan}<span className="text-sm font-medium text-text-industrial/60"> / {s.assetsTotal}</span></>}
          hint={fill(t("pmap.kpi.assetsNote"), { a: s.criticalityA, s: s.safetyCritical })}
        />
        <StatCard
          label={t("pmap.kpi.jobs")} help={t("pmap.kpi.jobsHelp")} value={fmt(totals.jobs)}
          hint={t("pmap.kpi.jobsNote")}
        />
        <StatCard
          label={t("pmap.kpi.manHours")} help={t("pmap.kpi.manHoursHelp")}
          value={`≈ ${fmt(totals.calHours + totals.runH)}`}
          hint={fill(t("pmap.kpi.manHoursNote"), { h: runHours.toLocaleString() })}
        />
        <StatCard
          label={t("pmap.kpi.risk")} help={t("pmap.kpi.riskHelp")}
          value={<>{riskPct}<span className="text-sm font-medium text-text-industrial/60">%</span></>}
          hint={fill(t("pmap.kpi.riskNote"), { h: s.riskHigh, n: s.noRisk })}
        />
      </div>

      {/* Mapa: sistemas → familias → equipos */}
      <div className="bento-card p-4!">
        <div className="flex items-baseline gap-3 flex-wrap mb-2">
          <h3 className="text-sm font-bold text-fg">{t("pmap.map.title")}</h3>
          <p className="text-xs text-text-industrial/50">{t("pmap.map.hint")}</p>
        </div>

        {/* Semáforo de vencimiento: es el color del borde izquierdo de cada ficha. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-industrial/60 mb-2">
          <span className="text-text-industrial/40">{t("pmap.due.legend")}</span>
          {DUE_ORDER.map(k => (
            <Help key={k} text={t(DUE_STYLE[k].help)}>
              <span className={`w-1 h-3.5 rounded-sm ${DUE_STYLE[k].dot}`} />{t(DUE_STYLE[k].label)}
            </Help>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-industrial/60 mb-3">
          <Help text={t("pmap.legend.critAHelp")}>
            <span className={`w-2.5 h-2.5 rounded-full ${CRIT_DOT.A}`} />{t("pmap.legend.critA")}
          </Help>
          <Help text={t("pmap.legend.critBHelp")}>
            <span className={`w-2.5 h-2.5 rounded-full ${CRIT_DOT.B}`} />{t("pmap.legend.critB")}
          </Help>
          <Help text={t("pmap.legend.critCHelp")}>
            <span className={`w-2.5 h-2.5 rounded-full ${CRIT_DOT.C}`} />{t("pmap.legend.critC")}
          </Help>
          <Help text={t("pmap.legend.safetyHelp")}>
            <span className="text-red-700 dark:text-red-400 font-bold">▲</span>{t("pmap.legend.safety")}
          </Help>
          <span className="ml-auto flex items-center gap-3">
            <span className="text-text-industrial/40">{t("pmap.legend.riskBar")}</span>
            <Help text={t("pmap.legend.riskHighHelp")}>
              <span className="w-2.5 h-2.5 rounded-sm bg-red-500" />{t("pmap.legend.riskHigh")}
            </Help>
            <Help text={t("pmap.legend.riskMedHelp")}>
              <span className="w-2.5 h-2.5 rounded-sm bg-yellow-500" />{t("pmap.legend.riskMed")}
            </Help>
            <Help text={t("pmap.legend.riskLowHelp")}>
              <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" />{t("pmap.legend.riskLow")}
            </Help>
            <Help text={t("pmap.legend.riskNoneHelp")}>
              <span className="w-2.5 h-2.5 rounded-sm bg-fg/20" />{t("pmap.legend.riskNone")}
            </Help>
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-start">
          {data.systems.map(sys => {
            const Icon = SFI_ICONS[sys.group] ?? Cog;
            const span = sys.assetCount >= 20 ? "lg:col-span-6" : sys.assetCount >= 10 ? "lg:col-span-4" : "lg:col-span-3";
            const single = sys.families.length === 1 && sys.families[0]!.family === "other";
            return (
              <div key={sys.group} className={`${span} rounded-lg border border-fg/10 bg-fg/[0.02] p-2.5 space-y-2`}>
                <div className="flex items-center gap-2">
                  <span className="w-7 h-7 rounded-lg bg-accent/10 border border-accent/20 grid place-items-center shrink-0">
                    <Icon className="w-4 h-4 text-accent" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-[10px] font-bold tracking-wider px-1.5 py-0.5 rounded bg-accent/10 text-accent shrink-0">
                        G{sys.group}
                      </span>
                      <span className="text-xs font-bold text-fg truncate">{t(SFI_KEYS[sys.group] ?? "sfi.g.0")}</span>
                    </div>
                    <p className="text-[10px] text-text-industrial/50 tabular-nums">
                      {fill(t("pmap.map.tasksAssets"), { t: sys.tasks, a: sys.assetCount })}
                    </p>
                  </div>
                </div>

                {/* Corte de riesgo del sistema */}
                <div className="flex h-1 gap-0.5 rounded-sm overflow-hidden bg-fg/10">
                  {sys.riskHigh > 0 && <span className="bg-red-500" style={{ flex: sys.riskHigh }} />}
                  {sys.riskMedium > 0 && <span className="bg-yellow-500" style={{ flex: sys.riskMedium }} />}
                  {sys.riskLow > 0 && <span className="bg-emerald-500" style={{ flex: sys.riskLow }} />}
                  {sys.riskNone > 0 && <span className="bg-fg/20" style={{ flex: sys.riskNone }} />}
                </div>

                {sys.families.map(fam => (
                  <div key={fam.family} className="space-y-1">
                    {!single && (
                      <div className="flex items-center gap-2 text-[9px] uppercase tracking-widest text-text-industrial/40">
                        <span className="whitespace-nowrap">{t(FAMILY_KEYS[fam.family] ?? "pmap.fam.other")}</span>
                        <span className="flex-1 h-px bg-fg/10" />
                        <span className="tabular-nums shrink-0">{fam.assets.length} {t("pmap.map.eqShort")}</span>
                      </div>
                    )}
                    <div className="flex flex-wrap gap-1">
                      {fam.assets.map(a => <AssetChip key={a.id} asset={a} t={t} />)}
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {/* Ritmo */}
      <div className="bento-card p-4!">
        <div className="flex items-baseline gap-3 flex-wrap mb-3">
          <h3 className="text-sm font-bold text-fg">{t("pmap.rhythm.title")}</h3>
          <p className="text-xs text-text-industrial/50">{t("pmap.rhythm.hint")}</p>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div>
            <p className="text-[11px] font-bold text-text-industrial/50 mb-2">
              {t("pmap.rhythm.calendar")}{" "}
              <span className="font-normal">— {t("pmap.rhythm.calendarSub")}</span>
            </p>
            <div className="grid grid-cols-[max-content_1fr_max-content] gap-x-2 gap-y-1 items-center">
              {data.calendarLadder.map(r => (
                <LadderRow
                  key={r.key} count={r.count} max={calMax} tone="bg-accent"
                  label={t(FREQ_KEYS[r.key] ?? "pmap.freq.MX")}
                />
              ))}
            </div>
          </div>
          <div>
            <p className="text-[11px] font-bold text-text-industrial/50 mb-2">
              {t("pmap.rhythm.hours")}{" "}
              <span className="font-normal">— {t("pmap.rhythm.hoursSub")}</span>
            </p>
            <div className="grid grid-cols-[max-content_1fr_max-content] gap-x-2 gap-y-1 items-center">
              {data.hoursLadder.map(r => (
                <LadderRow
                  key={r.hours} count={r.count} max={hrsMax} tone="bg-orange-500"
                  label={`${r.hours.toLocaleString()} h`}
                />
              ))}
            </div>
          </div>
        </div>
        {data.eventCount > 0 && (
          <p className="text-xs text-text-industrial/50 mt-4">
            {fill(t("pmap.rhythm.event"), { n: data.eventCount })}
          </p>
        )}
      </div>

      {/* Carga anual */}
      <div className="bento-card p-4!">
        <div className="flex items-baseline gap-3 flex-wrap mb-3">
          <h3 className="text-sm font-bold text-fg">{t("pmap.load.title")}</h3>
          <p className="text-xs text-text-industrial/50">{t("pmap.load.hint")}</p>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-text-industrial/60">{t("pmap.load.runHours")}</span>
            <div className="inline-flex rounded-lg border border-fg/10 bg-primary-bg/60 p-0.5">
              {RUN_HOUR_OPTIONS.map(h => (
                <button
                  key={h}
                  onClick={() => setRunHours(h)}
                  aria-pressed={runHours === h}
                  className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                    runHours === h ? "bg-accent text-accent-fg font-bold" : "text-text-industrial/70 hover:text-fg"
                  }`}
                >
                  {h.toLocaleString()}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-industrial/60 mb-2">
          <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-accent" />{t("pmap.load.byCalendar")}</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-orange-500" />{t("pmap.load.byRunHours")}</span>
        </div>

        <div className="grid grid-cols-[max-content_1fr_max-content] gap-x-2 gap-y-1.5 items-center">
          {workloadRows.map(r => (
            <React.Fragment key={r.group}>
              <span className="text-xs text-text-industrial/60 whitespace-nowrap">
                G{r.group} · {t(SFI_KEYS[r.group] ?? "sfi.g.0")}
              </span>
              <span className="h-3.5 rounded-r bg-fg/5 block">
                <span className="flex h-full gap-px rounded-r overflow-hidden" style={{ width: `${(100 * r.total) / loadMax}%` }}>
                  {r.calendarHours > 0 && <span className="bg-accent h-full" style={{ flex: r.calendarHours }} />}
                  {r.runH > 0 && <span className="bg-orange-500 h-full" style={{ flex: r.runH }} />}
                </span>
              </span>
              <span className="text-xs text-fg tabular-nums text-right whitespace-nowrap">{fmt(r.total)} h</span>
            </React.Fragment>
          ))}
        </div>

        <p className="text-xs text-text-industrial/50 mt-3">
          {fill(t("pmap.load.total"), {
            t: fmt(totals.calHours + totals.runH),
            c: fmt(totals.calHours),
            r: fmt(totals.runH),
            h: runHours.toLocaleString(),
          })}
        </p>
      </div>

      {/* Estado */}
      <div className="bento-card p-4!">
        <div className="flex items-baseline gap-3 flex-wrap mb-3">
          <h3 className="text-sm font-bold text-fg">{t("pmap.state.title")}</h3>
          <p className="text-xs text-text-industrial/50">{t("pmap.state.hint")}</p>
        </div>

        {/* Mismos cinco estados del semáforo del mapa, en números. */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
          {DUE_ORDER.map(k => {
            const v = { overdue: s.overdue, dueSoon: s.dueSoon, inWindow: s.inWindow,
                        onSchedule: s.onSchedule, unscheduled: s.unscheduled }[k];
            const alarming = (k === "overdue" || k === "unscheduled") && v > 0;
            return (
              <div
                key={k}
                className={`rounded-lg border border-l-4 p-2.5 ${DUE_STYLE[k].bar} ${alarming ? "border-y-red-500/30 border-r-red-500/30 bg-red-500/5" : "border-y-fg/10 border-r-fg/10 bg-fg/[0.02]"}`}
              >
                <Help text={t(DUE_STYLE[k].help)}>
                  <span className="text-xl font-bold tabular-nums text-fg">{fmt(v)}</span>
                </Help>
                <p className="text-xs text-text-industrial/60 mt-0.5">{t(DUE_STYLE[k].label)}</p>
              </div>
            );
          })}
        </div>

        <div className="mt-3 rounded-lg border border-fg/10 bg-fg/[0.02] p-2.5 flex items-baseline gap-2">
          <Help text={t("pmap.state.noRiskHelp")}>
            <span className="text-xl font-bold tabular-nums text-fg">{fmt(s.noRisk)}</span>
          </Help>
          <p className="text-xs text-text-industrial/60">{t("pmap.state.noRisk")}</p>
        </div>

        <p className="text-[11px] text-text-industrial/40 mt-4 mb-1">{t("pmap.state.upcoming")}</p>
        {data.upcoming.length === 0 ? (
          <p className="text-xs text-text-industrial/50">{t("pmap.state.noUpcoming")}</p>
        ) : (
          <div className="divide-y divide-fg/10">
            {data.upcoming.map(u => (
              <div key={u.taskCode} className="grid grid-cols-[max-content_7rem_1fr_max-content] gap-3 py-1.5 items-baseline">
                <span className={`w-1.5 h-1.5 rounded-full self-center ${DUE_STYLE[u.dueState].dot}`} />
                <span className="text-xs text-text-industrial/60 tabular-nums">
                  {new Date(u.nextDueDate).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })}
                </span>
                <span className="text-xs text-fg/90">
                  {u.title} <span className="text-text-industrial/40">— {u.assetName}</span>
                </span>
                <span className="text-[10px] text-text-industrial/50 whitespace-nowrap">
                  {t(DUE_STYLE[u.dueState].label)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
