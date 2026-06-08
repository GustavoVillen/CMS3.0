import React, { useMemo, useState } from "react";
import { Activity, AlertTriangle, Info } from "lucide-react";
import { useFetch } from "../lib/hooks";
import { PageHeader } from "../components/PageHeader";
import { DataTable, type Column } from "../components/DataTable";
import { VesselLabel } from "../components/EntityLabels";
import { useT } from "../lib/i18n";

// ─── Types (espejo de reliability-service.ts) ──────────────────────────────────

type GroupBy = "asset" | "sfi" | "vessel" | "criticality";

interface ReliabilityRow {
  key: string;
  label: string;
  sublabel?: string | null;
  vesselCode?: string | null;
  failures: number;
  opHours: number | null;
  hoursBasis: "operating" | "calendar";
  hoursForMtbf: number;
  mtbf: number | null;
  mttr: number | null;
  availability: number | null;
  repairs: number;
}

interface ReliabilityResponse {
  rows: ReliabilityRow[];
  meta: {
    from: string;
    to: string;
    groupBy: GroupBy;
    minSeverity: string;
    assetsTotal: number;
    assetsWithoutHours: number;
  };
}

const DAY_MS = 86_400_000;

const MONTH_OPTIONS: { value: number; labelKey: "rel.months6" | "rel.months12" | "rel.months24" }[] = [
  { value: 6,  labelKey: "rel.months6" },
  { value: 12, labelKey: "rel.months12" },
  { value: 24, labelKey: "rel.months24" },
];

const GROUP_OPTIONS: { value: GroupBy; labelKey: "rel.group.asset" | "rel.group.sfi" | "rel.group.vessel" | "rel.group.criticality" }[] = [
  { value: "asset",       labelKey: "rel.group.asset" },
  { value: "sfi",         labelKey: "rel.group.sfi" },
  { value: "vessel",      labelKey: "rel.group.vessel" },
  { value: "criticality", labelKey: "rel.group.criticality" },
];

const SEVERITY_OPTIONS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

// ─── Helpers de formato ────────────────────────────────────────────────────────

function fmtHours(v: number | null): string {
  if (v == null) return "—";
  return `${Math.round(v).toLocaleString()} h`;
}
function fmtAvailability(v: number | null): { text: string; cls: string } {
  if (v == null) return { text: "—", cls: "text-text-industrial/40" };
  const pct = v * 100;
  const cls = pct >= 99 ? "text-emerald-600 dark:text-emerald-400"
    : pct >= 95 ? "text-yellow-700 dark:text-yellow-400"
    : "text-red-700 dark:text-red-400 font-bold";
  return { text: `${pct.toFixed(1)}%`, cls };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export const ReliabilityPage: React.FC = () => {
  const t = useT();
  const [months, setMonths] = useState(12);
  const [groupBy, setGroupBy] = useState<GroupBy>("asset");
  const [minSeverity, setMinSeverity] = useState<typeof SEVERITY_OPTIONS[number]>("MEDIUM");

  const from = useMemo(() => new Date(Date.now() - months * 30 * DAY_MS).toISOString().slice(0, 10), [months]);
  const path = `/app/dashboard/reliability?from=${from}&groupBy=${groupBy}&minSeverity=${minSeverity}`;
  const { data, loading, error, reload } = useFetch<ReliabilityResponse>(path, [path]);

  const columns: Column<ReliabilityRow>[] = useMemo(() => [
    {
      key: "label",
      header: t("rel.col.equipment"),
      sortable: true,
      sortValue: row => row.label,
      render: row => (
        <div className="flex flex-col">
          {groupBy === "vessel"
            ? <VesselLabel code={row.label} showCode />
            : <span className="text-sm font-semibold text-fg">{row.label}</span>}
          {row.sublabel && <span className="text-[10px] font-mono text-text-industrial/40">{row.sublabel}</span>}
        </div>
      ),
    },
    {
      key: "failures",
      header: t("rel.col.failures"),
      sortable: true,
      sortValue: row => row.failures,
      render: row => <span className="font-mono text-sm text-fg">{row.failures}</span>,
    },
    {
      key: "mtbf",
      header: t("rel.col.mtbf"),
      sortable: true,
      sortValue: row => row.mtbf ?? null,
      render: row => (
        <span className="font-mono text-xs text-fg whitespace-nowrap">
          {row.mtbf == null ? <span className="text-emerald-600 dark:text-emerald-400">{t("rel.noFailures")}</span> : fmtHours(row.mtbf)}
        </span>
      ),
    },
    {
      key: "mttr",
      header: t("rel.col.mttr"),
      sortable: true,
      sortValue: row => row.mttr ?? null,
      render: row => <span className="font-mono text-xs text-fg whitespace-nowrap">{fmtHours(row.mttr)}</span>,
    },
    {
      key: "availability",
      header: t("rel.col.availability"),
      sortable: true,
      sortValue: row => row.availability ?? null,
      render: row => {
        const a = fmtAvailability(row.availability);
        return <span className={`font-mono text-sm ${a.cls}`}>{a.text}</span>;
      },
    },
    {
      key: "hoursBasis",
      header: t("rel.col.basis"),
      sortable: true,
      sortValue: row => row.hoursBasis,
      render: row => (
        <span className={`inline-flex items-center text-[10px] px-2 py-0.5 rounded-full border font-bold whitespace-nowrap ${
          row.hoursBasis === "operating"
            ? "bg-accent/10 text-accent border-accent/20"
            : "bg-fg/5 text-text-industrial/50 border-fg/10"
        }`}>
          {t(row.hoursBasis === "operating" ? "rel.basis.operating" : "rel.basis.calendar")}
        </span>
      ),
    },
  ], [t, groupBy]);

  const selectCls = "bg-primary-bg/60 border border-fg/10 rounded-lg px-2 py-1 text-xs text-fg focus:outline-none focus:ring-1 focus:ring-accent";

  return (
    <div className="space-y-4">
      <PageHeader
        icon={Activity}
        title={t("rel.title")}
        total={data?.meta.assetsTotal}
        onReload={reload}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-xs text-text-industrial/60">{t("rel.period")}</label>
          <select value={months} onChange={e => setMonths(parseInt(e.target.value, 10))} className={selectCls}>
            {MONTH_OPTIONS.map(o => <option key={o.value} value={o.value}>{t(o.labelKey)}</option>)}
          </select>
          <label className="text-xs text-text-industrial/60">{t("rel.groupBy")}</label>
          <select value={groupBy} onChange={e => setGroupBy(e.target.value as GroupBy)} className={selectCls}>
            {GROUP_OPTIONS.map(o => <option key={o.value} value={o.value}>{t(o.labelKey)}</option>)}
          </select>
          <label className="text-xs text-text-industrial/60">{t("rel.minSeverity")}</label>
          <select value={minSeverity} onChange={e => setMinSeverity(e.target.value as typeof SEVERITY_OPTIONS[number])} className={selectCls}>
            {SEVERITY_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </PageHeader>

      {/* Definiciones + caveat */}
      <div className="bento-card p-3! flex items-start gap-3">
        <Info className="w-4 h-4 text-accent shrink-0 mt-0.5" />
        <div className="text-[11px] text-text-industrial/70 space-y-0.5">
          <p><span className="font-bold text-fg">MTBF</span> — {t("rel.defMtbf")}</p>
          <p><span className="font-bold text-fg">MTTR</span> — {t("rel.defMttr")}</p>
          <p><span className="font-bold text-fg">{t("rel.col.availability")}</span> — {t("rel.defAvail")}</p>
          <p className="text-text-industrial/40 pt-1">{t("rel.caveat")}</p>
        </div>
      </div>

      {/* Aviso de cobertura de horas */}
      {data && data.meta.assetsWithoutHours > 0 && (
        <div className="bento-card p-3! flex items-start gap-3 border-yellow-500/30 bg-yellow-500/5">
          <AlertTriangle className="w-4 h-4 text-yellow-700 dark:text-yellow-400 shrink-0 mt-0.5" />
          <div className="text-xs text-text-industrial/70">
            <span className="font-bold text-yellow-700 dark:text-yellow-300">{data.meta.assetsWithoutHours}</span>{" "}
            {t("rel.assetsWithoutHours")}
          </div>
        </div>
      )}

      <DataTable
        columns={columns}
        data={data?.rows ?? null}
        loading={loading}
        error={error}
        keyFn={row => row.key}
        emptyText={t("rel.empty")}
      />
    </div>
  );
};
