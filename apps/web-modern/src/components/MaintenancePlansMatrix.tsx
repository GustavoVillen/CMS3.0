import React, { useMemo, useState } from "react";
import { CalendarClock } from "lucide-react";
import { useT } from "../lib/i18n";
import { fmtDate } from "../lib/utils";
import { ModalCloseButton } from "./ModalCloseButton";
import type { MaintenancePlan } from "../pages/MaintenancePlans";

// Matriz de vencimientos por equipo (solo lectura).
// Pivote: filas = equipo/sistema (assetName), columnas = periodicidad
// (Mensual, 3M, 6M, Anual, 5A, 500 h…), celdas = fecha de vencimiento o de
// última ejecución según el toggle. Las columnas se derivan de las
// periodicidades realmente presentes en los planes visibles, así que respeta
// los filtros de la página (buque / SFI / búsqueda) y no inventa columnas
// vacías. No toca backend ni schema: usa los datos ya cargados en la lista.

type FreqKind = "date" | "hours";

interface FreqBucket {
  key: string;    // identidad de la columna (ej. "m3", "h500")
  order: number;  // orden de columnas (equivalente en días → corto a largo)
  label: string;  // etiqueta visible
  kind: FreqKind; // date → la celda muestra una fecha; hours → muestra horas
}

interface MatrixRow {
  key: string;
  label: string;
  vesselCode: string;
}

type Mode = "due" | "last";

interface Props {
  /** Planes ya filtrados que se muestran en la página (data.items). */
  plans: MaintenancePlan[];
  vesselNameMap: Map<string, string>;
  /** computeStatus de la página — colorea los vencimientos por urgencia. */
  getStatus: (plan: MaintenancePlan) => string;
  onClose: () => void;
  /** Abrir el detalle del plan al clickear una celda (deep-link por taskCode). */
  onOpenPlan?: (taskCode: string) => void;
}

const isHoursTT = (tt: string) => tt === "HOURS" || tt === "RUNNING_HOURS";

// Valor numérico comparable de una celda (para elegir el plan representativo).
function cellVal(p: MaintenancePlan, mode: Mode, kind: FreqKind): number | null {
  if (mode === "due") {
    if (kind === "hours") return p.nextDueHours ?? null;
    return p.nextDueDate ? Date.parse(p.nextDueDate.slice(0, 10)) : null;
  }
  if (kind === "hours") return p.lastExecutionHours ?? null;
  return p.lastExecutionDate ? Date.parse(p.lastExecutionDate.slice(0, 10)) : null;
}

// Color de la celda según urgencia (solo en modo "vencimiento").
function toneForStatus(status: string): string {
  switch (status) {
    case "OVERDUE":   return "text-red-600 dark:text-red-400 font-bold";
    case "DUE":       return "text-orange-600 dark:text-orange-400 font-semibold";
    case "UPCOMING":  return "text-yellow-600 dark:text-yellow-500";
    case "IN_WINDOW": return "text-sky-600 dark:text-sky-400 font-semibold";
    default:          return "text-fg/80";
  }
}

const HEADER_ROW1_H = 30; // px — alto de la fila superior (VENCIMIENTO), para el offset sticky de la fila 2

export const MaintenancePlansMatrix: React.FC<Props> = ({
  plans, vesselNameMap, getStatus, onClose, onOpenPlan,
}) => {
  const t = useT();
  const [mode, setMode] = useState<Mode>("due");

  const multiVessel = useMemo(
    () => new Set(plans.map(p => p.vesselCode)).size > 1,
    [plans],
  );

  // Etiqueta de periodicidad para una cantidad de meses.
  const monthLabel = useMemo(() => {
    const uMonth = t("mp.matrix.unit.month");
    const uYear  = t("mp.matrix.unit.year");
    return (m: number): string => {
      if (m === 1)  return t("mp.matrix.freq.monthly");
      if (m === 12) return t("mp.matrix.freq.annual");
      if (m > 0 && m % 12 === 0) return `${m / 12}${uYear}`;
      return `${m}${uMonth}`;
    };
  }, [t]);

  const bucketOf = useMemo(() => {
    const uWeek = t("mp.matrix.unit.week");
    const uDay  = t("mp.matrix.unit.day");
    const uHour = t("mp.matrix.unit.hour");
    return (p: MaintenancePlan): FreqBucket => {
      const tt = (p.triggerType || "").toUpperCase();
      if (isHoursTT(tt) && p.frequencyHours != null && p.frequencyHours > 0) {
        const h = p.frequencyHours;
        return { key: `h${h}`, order: 10_000_000 + h, label: `${h.toLocaleString()} ${uHour}`, kind: "hours" };
      }
      // DAY / WEEK reutilizan el campo frequencyMonths para días / semanas.
      if (tt === "DAY" && p.frequencyMonths != null && p.frequencyMonths > 0) {
        const d = p.frequencyMonths;
        return { key: `d${d}`, order: d, label: d === 1 ? t("mp.matrix.freq.daily") : `${d}${uDay}`, kind: "date" };
      }
      if (tt === "WEEK" && p.frequencyMonths != null && p.frequencyMonths > 0) {
        const w = p.frequencyMonths;
        return { key: `w${w}`, order: w * 7, label: w === 1 ? t("mp.matrix.freq.weekly") : `${w} ${uWeek}`, kind: "date" };
      }
      if ((tt === "MONTHS" || tt === "CALENDAR") && p.frequencyMonths != null && p.frequencyMonths > 0) {
        const m = p.frequencyMonths;
        return { key: `m${m}`, order: Math.round(m * 30.44), label: monthLabel(m), kind: "date" };
      }
      // CONDITION / EVENT / sin frecuencia → columna "Otras".
      return { key: "other", order: 99_999_999, label: t("mp.matrix.freq.other"), kind: isHoursTT(tt) ? "hours" : "date" };
    };
  }, [t, monthLabel]);

  const { columns, rows, cellMap } = useMemo(() => {
    const bucketByKey = new Map<string, FreqBucket>();
    const rowByKey = new Map<string, MatrixRow>();
    const cells = new Map<string, MaintenancePlan[]>();

    for (const p of plans) {
      const b = bucketOf(p);
      if (!bucketByKey.has(b.key)) bucketByKey.set(b.key, b);

      const rowKey = p.assetId || p.assetName || "—";
      if (!rowByKey.has(rowKey)) {
        rowByKey.set(rowKey, { key: rowKey, label: p.assetName ?? p.assetId ?? "—", vesselCode: p.vesselCode });
      }
      const cellKey = `${rowKey}::${b.key}`;
      const arr = cells.get(cellKey);
      if (arr) arr.push(p); else cells.set(cellKey, [p]);
    }

    const columns = [...bucketByKey.values()].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
    const rows = [...rowByKey.values()].sort((a, b) => {
      if (multiVessel && a.vesselCode !== b.vesselCode) {
        const an = vesselNameMap.get(a.vesselCode) ?? a.vesselCode;
        const bn = vesselNameMap.get(b.vesselCode) ?? b.vesselCode;
        return an.localeCompare(bn, undefined, { sensitivity: "base" });
      }
      return a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" });
    });
    return { columns, rows, cellMap: cells };
  }, [plans, bucketOf, multiVessel, vesselNameMap]);

  const displayVal = (p: MaintenancePlan, kind: FreqKind): string => {
    if (mode === "due") {
      if (kind === "hours") return p.nextDueHours != null ? `${p.nextDueHours.toLocaleString()} ${t("mp.matrix.unit.hour")}` : "—";
      return fmtDate(p.nextDueDate) ?? "—";
    }
    if (kind === "hours") return p.lastExecutionHours != null ? `${p.lastExecutionHours.toLocaleString()} ${t("mp.matrix.unit.hour")}` : "—";
    return fmtDate(p.lastExecutionDate) ?? "—";
  };

  const renderCell = (plansInCell: MaintenancePlan[] | undefined, col: FreqBucket) => {
    if (!plansInCell || plansInCell.length === 0) {
      return <span className="text-text-industrial/20">·</span>;
    }
    const count = plansInCell.length;
    // Plan representativo: en "vencimiento" el más próximo (mín.); en "última
    // ejecución" el más reciente (máx.). Si ninguno tiene valor, el primero.
    const withVal = plansInCell
      .map(p => ({ p, v: cellVal(p, mode, col.kind) }))
      .filter((x): x is { p: MaintenancePlan; v: number } => x.v != null)
      .sort((a, b) => (mode === "due" ? a.v - b.v : b.v - a.v));
    const rep = withVal[0]?.p ?? plansInCell[0];

    const text = displayVal(rep, col.kind);
    const tone = mode === "due" ? toneForStatus(getStatus(rep)) : "text-fg/80";
    const title = count > 1
      ? `${rep.taskCode} · ${t("mp.matrix.multiTasks").replace("{n}", String(count))}`
      : `${rep.taskCode} — ${rep.title}`;

    return (
      <button
        type="button"
        onClick={onOpenPlan ? () => onOpenPlan(rep.taskCode) : undefined}
        disabled={!onOpenPlan}
        title={title}
        className="inline-flex items-center gap-1 font-mono text-xs enabled:hover:underline enabled:cursor-pointer disabled:cursor-default whitespace-nowrap"
      >
        <span className={tone}>{text}</span>
        {count > 1 && (
          <span className="text-[9px] px-1 rounded-full bg-fg/10 text-text-industrial/60 font-sans font-bold leading-tight">×{count}</span>
        )}
      </button>
    );
  };

  const modeBtn = (m: Mode, label: string) => (
    <button
      type="button"
      onClick={() => setMode(m)}
      aria-pressed={mode === m}
      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
        mode === m ? "bg-accent text-accent-fg shadow-sm" : "text-text-industrial/60 hover:text-fg"
      }`}
    >
      {label}
    </button>
  );

  const cornerBg = "bg-surface dark:bg-[#0D1B2A]";
  const thBase = "border border-fg/10 px-2 py-1.5 text-[11px] font-bold uppercase tracking-wider text-text-industrial/60";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div
        className={`w-full max-w-6xl max-h-[90vh] flex flex-col ${cornerBg} border border-fg/10 rounded-2xl shadow-2xl overflow-hidden`}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-fg/10">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-fg flex items-center gap-2">
              <CalendarClock className="w-4 h-4 text-accent shrink-0" />
              <span className="truncate">{t("mp.matrix.title")}</span>
            </h2>
            <p className="text-[11px] text-text-industrial/50">
              {t("mp.matrix.subtitle").replace("{eq}", String(rows.length)).replace("{cols}", String(columns.length))}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="inline-flex rounded-xl border border-fg/10 bg-fg/5 p-0.5">
              {modeBtn("due", t("mp.matrix.modeDue"))}
              {modeBtn("last", t("mp.matrix.modeLast"))}
            </div>
            <ModalCloseButton onClose={onClose} />
          </div>
        </div>

        {/* Cuerpo scrolleable */}
        <div className="flex-1 overflow-auto p-4">
          {rows.length === 0 ? (
            <p className="text-sm text-text-industrial/50 px-2 py-10 text-center">{t("mp.matrix.empty")}</p>
          ) : (
            <table className="border-collapse text-sm">
              <thead>
                <tr>
                  <th
                    rowSpan={2}
                    style={{ minWidth: 220 }}
                    className={`${thBase} ${cornerBg} sticky left-0 top-0 z-30 text-left align-bottom`}
                  >
                    {t("mp.matrix.equipmentCol")}
                  </th>
                  <th
                    colSpan={columns.length}
                    style={{ height: HEADER_ROW1_H }}
                    className={`${thBase} ${cornerBg} sticky top-0 z-20 text-center`}
                  >
                    {mode === "due" ? t("mp.matrix.headerDue") : t("mp.matrix.headerLast")}
                  </th>
                </tr>
                <tr>
                  {columns.map(c => (
                    <th
                      key={c.key}
                      style={{ top: HEADER_ROW1_H, minWidth: 70 }}
                      className={`${thBase} ${cornerBg} sticky z-20 text-center`}
                    >
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.key} className="hover:bg-fg/[0.03]">
                    <td className={`border border-fg/10 px-3 py-1.5 text-left ${cornerBg} sticky left-0 z-10`}>
                      <span className="block text-xs font-semibold text-fg leading-tight">{r.label}</span>
                      {multiVessel && (
                        <span className="block text-[10px] text-accent/70 leading-tight truncate">
                          {vesselNameMap.get(r.vesselCode) ?? r.vesselCode}
                        </span>
                      )}
                    </td>
                    {columns.map(c => (
                      <td key={c.key} className="border border-fg/10 px-2 py-1.5 text-center">
                        {renderCell(cellMap.get(`${r.key}::${c.key}`), c)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};
