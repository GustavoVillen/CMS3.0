import React, { useMemo, useState } from "react";
import { Loader2, AlertCircle, SearchX, ChevronUp, ChevronDown, ChevronsUpDown, ChevronRight } from "lucide-react";
import { useSearchParams } from "react-router-dom";

export { fmtDate } from "../lib/utils";

export interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => React.ReactNode;
  className?: string;
  sortable?: boolean;
  sortValue?: (row: T) => string | number | Date | null | undefined;
  // Ancho fijo de la columna (ej. "180px", "20%"). Solo tiene efecto con
  // layoutFixed (table-fixed): evita que el ancho cambie según el contenido.
  width?: string;
}

// Agrupación opt-in. Cuando se pasa, las filas se agrupan por keyFn con un
// header colapsable por grupo (labelFn + contador) y se ordenan DENTRO de cada
// grupo con sortRows. El orden de los grupos sale de sortGroups (default:
// alfabético por label). Con groupBy activo se desactiva el orden por columna.
export interface GroupBy<T> {
  keyFn: (row: T) => string;
  labelFn: (row: T) => string;
  sortRows?: (a: T, b: T) => number;
  sortGroups?: (a: { key: string; label: string; count: number }, b: { key: string; label: string; count: number }) => number;
  /**
   * Columna bajo la cual se alinea el título del grupo. Por defecto el título
   * arranca en el borde izquierdo de la tabla, y cuando lo agrupado es el
   * contenido de una columna del medio (el equipo, sobre la columna de tareas)
   * queda lejos de aquello a lo que titula: se lee la tarea sin saber de qué
   * equipo es. Con esta clave el título se corre hasta esa columna y queda
   * justo encima de sus filas.
   */
  labelColumnKey?: string;
  /**
   * "band" (default) — el título va sobre una banda gris a todo el ancho.
   * "quiet" — sin fondo, con aire arriba y una barra de color al costado. La
   * banda ocupa el mismo alto, el mismo ancho y el mismo gris que una fila, así
   * que en una lista larga se lee como una fila más en vez de como un título.
   */
  headerStyle?: "band" | "quiet";
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[] | null;
  loading: boolean;
  error: string | null;
  keyFn: (row: T) => string;
  emptyText?: string;
  onRowClick?: (row: T) => void;
  // Fija el layout de la tabla (table-fixed) para que los anchos no dependan
  // del contenido de las filas visibles. Combinar con Column.width.
  layoutFixed?: boolean;
  // Agrupación (opt-in). Ver GroupBy. Requiere collapsedGroups + onToggleGroup
  // para el estado de colapsado (controlado por el padre).
  groupBy?: GroupBy<T>;
  collapsedGroups?: Set<string>;
  onToggleGroup?: (key: string) => void;
  // Orden por columna ESTANDO agrupado: la agrupación y el orden por columna se
  // pisan, así que cuando el padre pasa este callback los encabezados siguen
  // siendo clickeables y el primer clic apaga la agrupación (el padre baja su
  // flag) para ordenar la lista de corrido. Sin este callback, con groupBy el
  // orden por columna queda desactivado como antes.
  onSortUngroup?: () => void;
}

export function DataTable<T>({ columns, data, loading, error, keyFn, emptyText = "Sin registros", onRowClick, layoutFixed = false, groupBy, collapsedGroups, onToggleGroup, onSortUngroup }: DataTableProps<T>) {
  const [searchParams, setSearchParams] = useSearchParams();
  const validSortKeys = useMemo(() => columns.map(col => col.key), [columns]);

  const [sortKey, setSortKey] = useState<string | null>(() => {
    const fromUrl = searchParams.get("sort");
    if (!fromUrl) return null;
    return validSortKeys.includes(fromUrl) ? fromUrl : null;
  });
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">(() => {
    return searchParams.get("dir") === "desc" ? "desc" : "asc";
  });

  React.useEffect(() => {
    const fromUrl = searchParams.get("sort");
    const fromUrlDir = searchParams.get("dir") === "desc" ? "desc" : "asc";
    const nextSortKey = fromUrl && validSortKeys.includes(fromUrl) ? fromUrl : null;

    if (nextSortKey !== sortKey) setSortKey(nextSortKey);
    if (fromUrlDir !== sortDirection) setSortDirection(fromUrlDir);
  }, [searchParams, sortDirection, sortKey, validSortKeys]);

  const sortedData = useMemo(() => {
    if (!data) return null;
    if (!sortKey) return data;

    const selectedCol = columns.find(col => col.key === sortKey);
    if (!selectedCol) return data;

    const direction = sortDirection === "asc" ? 1 : -1;

    const toComparable = (value: unknown): number | string => {
      if (value === null || value === undefined) return Number.POSITIVE_INFINITY;
      if (value instanceof Date) return value.getTime();
      if (typeof value === "number") return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
      if (typeof value === "boolean") return value ? 1 : 0;
      const text = String(value).trim();
      if (!text) return Number.POSITIVE_INFINITY;

      const date = Date.parse(text);
      if (!Number.isNaN(date)) return date;

      const numericCandidate = text.replace(/\./g, "").replace(",", ".");
      const num = Number(numericCandidate);
      if (!Number.isNaN(num) && Number.isFinite(num)) return num;

      return text.toLocaleLowerCase();
    };

    return data
      .map((row, index) => ({
        row,
        index,
        value: toComparable(selectedCol.sortValue ? selectedCol.sortValue(row) : (row as Record<string, unknown>)[selectedCol.key]),
      }))
      .sort((a, b) => {
        if (typeof a.value === "number" && typeof b.value === "number") {
          if (a.value < b.value) return -1 * direction;
          if (a.value > b.value) return 1 * direction;
          return a.index - b.index;
        }
        const cmp = String(a.value).localeCompare(String(b.value), undefined, { numeric: true, sensitivity: "base" });
        if (cmp !== 0) return cmp * direction;
        return a.index - b.index;
      })
      .map(item => item.row);
  }, [columns, data, sortDirection, sortKey]);

  // Con groupBy activo, el orden lo define la agrupación (grupos + sortRows),
  // no el orden por columna. Partimos de `data` (sin ordenar por columna).
  const groups = useMemo(() => {
    if (!groupBy || !data) return null;
    const map = new Map<string, { key: string; label: string; rows: T[] }>();
    for (const row of data) {
      const gk = groupBy.keyFn(row);
      let g = map.get(gk);
      if (!g) { g = { key: gk, label: groupBy.labelFn(row), rows: [] }; map.set(gk, g); }
      g.rows.push(row);
    }
    const arr = [...map.values()];
    if (groupBy.sortRows) for (const g of arr) g.rows.sort(groupBy.sortRows);
    arr.sort((a, b) =>
      groupBy.sortGroups
        ? groupBy.sortGroups({ key: a.key, label: a.label, count: a.rows.length }, { key: b.key, label: b.label, count: b.rows.length })
        : a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" }),
    );
    return arr;
  }, [groupBy, data]);

  // sortingEnabled: si el orden por columna se APLICA (y se muestra la flecha
  // activa). Con groupBy manda la agrupación.
  const sortingEnabled = !groupBy;

  // Columna bajo la que se alinea el título del grupo. -1 (no encontrada) o sin
  // labelColumnKey ⇒ 0, o sea el borde izquierdo, como era antes.
  const labelColIndex = useMemo(() => {
    if (!groupBy?.labelColumnKey) return 0;
    const i = columns.findIndex(c => c.key === groupBy.labelColumnKey);
    return i > 0 ? i : 0;
  }, [groupBy, columns]);
  const quietHeader = groupBy?.headerStyle === "quiet";
  // headerSortable: si el encabezado responde al clic. Con onSortUngroup sigue
  // respondiendo aunque esté agrupado, porque el clic desagrupa.
  const headerSortable = (column: Column<T>) =>
    (sortingEnabled || !!onSortUngroup) && column.sortable !== false && !!column.header.trim();

  const onHeaderClick = (column: Column<T>) => {
    if (!headerSortable(column)) return;
    // Agrupado: el clic primero desagrupa (el padre apaga su flag) y recién
    // entonces el orden por columna tiene efecto sobre toda la lista.
    if (!sortingEnabled) onSortUngroup?.();

    const params = new URLSearchParams(searchParams);

    if (sortKey !== column.key) {
      setSortKey(column.key);
      setSortDirection("asc");
      params.set("sort", column.key);
      params.set("dir", "asc");
      setSearchParams(params, { replace: true });
      return;
    }

    const nextDir = sortDirection === "asc" ? "desc" : "asc";
    setSortDirection(nextDir);
    params.set("sort", column.key);
    params.set("dir", nextDir);
    setSearchParams(params, { replace: true });
  };

  if (loading) return (
    <div className="flex justify-center py-20">
      <Loader2 className="w-6 h-6 text-accent animate-spin" />
    </div>
  );

  if (error) return (
    <div className="flex items-center gap-3 text-danger text-sm p-4 bg-danger/10 rounded-xl border border-danger/25">
      <AlertCircle className="w-5 h-5 shrink-0" />
      {error}
    </div>
  );

  if (!sortedData || sortedData.length === 0) return (
    <div className="flex flex-col items-center justify-center py-20 text-fg/20 gap-3">
      <SearchX className="w-8 h-8" />
      <p className="text-sm">{emptyText}</p>
    </div>
  );

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className={`w-full text-sm ${layoutFixed ? "table-fixed" : ""}`}>
        {layoutFixed && (
          <colgroup>
            {columns.map(col => (
              <col key={col.key} style={col.width ? { width: col.width } : undefined} />
            ))}
          </colgroup>
        )}
        <thead>
          <tr className="border-b border-border bg-fg/[0.03]">
            {columns.map(col => (
              <th
                key={col.key}
                className={`px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider ${!headerSortable(col) ? "text-fg/50" : "text-fg/60 hover:text-fg cursor-pointer select-none"} ${col.className ?? ""}`}
                onClick={() => onHeaderClick(col)}
                aria-sort={sortingEnabled && sortKey === col.key ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
              >
                <span className="inline-flex items-center gap-1">
                  {col.header}
                  {headerSortable(col) && (!sortingEnabled || sortKey !== col.key) && <ChevronsUpDown className="w-3 h-3 opacity-50" />}
                  {headerSortable(col) && sortingEnabled && sortKey === col.key && sortDirection === "asc" && <ChevronUp className="w-3 h-3 text-accent" />}
                  {headerSortable(col) && sortingEnabled && sortKey === col.key && sortDirection === "desc" && <ChevronDown className="w-3 h-3 text-accent" />}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {groups
            ? groups.map(g => {
                const collapsed = collapsedGroups?.has(g.key) ?? false;
                return (
                  <React.Fragment key={g.key}>
                    <tr className={quietHeader ? "" : "bg-fg/[0.05] border-y border-border"}>
                      {/* Las celdas vacías corren el título hasta la columna que
                          agrupa (labelColumnKey); sin ella arranca a la izquierda. */}
                      {labelColIndex > 0 && Array.from({ length: labelColIndex }, (_, i) => (
                        <td key={columns[i].key} className={`px-4 ${quietHeader ? "pt-5 pb-1" : "py-1.5"} ${columns[i].className ?? ""}`} />
                      ))}
                      <td
                        colSpan={columns.length - labelColIndex}
                        className={`px-4 ${quietHeader ? "pt-5 pb-1" : "py-1.5"}`}
                      >
                        <button
                          type="button"
                          onClick={() => onToggleGroup?.(g.key)}
                          className={`flex items-center gap-1.5 text-left text-fg hover:text-accent transition-colors select-none ${
                            quietHeader ? "border-l-2 border-accent/60 pl-2.5" : ""
                          }`}
                        >
                          {collapsed ? <ChevronRight className="w-3.5 h-3.5 shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 shrink-0" />}
                          <span className={quietHeader ? "text-[13px] font-bold tracking-tight" : "text-xs font-bold"}>{g.label}</span>
                          <span className="text-[10px] text-text-industrial/50 font-semibold">({g.rows.length})</span>
                        </button>
                      </td>
                    </tr>
                    {!collapsed && g.rows.map(row => (
                      <tr
                        key={keyFn(row)}
                        className={`hover:bg-fg/[0.03] transition-colors group ${onRowClick ? "cursor-pointer" : ""}`}
                        onClick={() => onRowClick?.(row)}
                      >
                        {columns.map(col => (
                          <td key={col.key} className={`px-4 py-2 text-fg/80 ${col.className ?? ""}`}>
                            {col.render ? col.render(row) : (row as Record<string, unknown>)[col.key] as React.ReactNode}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </React.Fragment>
                );
              })
            : sortedData.map(row => (
                <tr
                  key={keyFn(row)}
                  className={`hover:bg-fg/[0.03] transition-colors group ${onRowClick ? "cursor-pointer" : ""}`}
                  onClick={() => onRowClick?.(row)}
                >
                  {columns.map(col => (
                    <td key={col.key} className={`px-4 py-2 text-fg/80 ${col.className ?? ""}`}>
                      {col.render ? col.render(row) : (row as Record<string, unknown>)[col.key] as React.ReactNode}
                    </td>
                  ))}
                </tr>
              ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared badge helpers
// ---------------------------------------------------------------------------

// Paletas semánticas theme-aware (legibles en claro y oscuro).
const BADGE_SUCCESS = "bg-success/10 text-success border-success/25";
const BADGE_INFO    = "bg-info/10 text-info border-info/25";
const BADGE_ACCENT  = "bg-accent/10 text-accent border-accent/25";
const BADGE_WARNING = "bg-warning/10 text-warning border-warning/25";
const BADGE_DANGER  = "bg-danger/10 text-danger border-danger/25";
const BADGE_NEUTRAL = "bg-fg/5 text-fg/40 border-border";

// `label` es opcional y sólo cambia el texto mostrado: el color se sigue
// eligiendo por `status`. Sirve para las pantallas que ya tienen los estados
// traducidos en el diccionario, sin tocar las que muestran el valor crudo.
export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const map: Record<string, string> = {
    ACTIVE:      BADGE_SUCCESS,
    INACTIVE:    BADGE_NEUTRAL,
    OPERATIONAL:    BADGE_SUCCESS,
    OUT_OF_SERVICE: BADGE_DANGER,
    PLANNED:     BADGE_INFO,
    SCHEDULED:   BADGE_INFO,
    IN_PROGRESS: BADGE_ACCENT,
    ON_HOLD:     BADGE_WARNING,
    COMPLETED:   BADGE_SUCCESS,
    CANCELLED:   BADGE_DANGER,
    OPEN:        BADGE_ACCENT,
    REQUESTED:   BADGE_INFO,
    UNDER_REVIEW:BADGE_INFO,
    APPROVED:    BADGE_SUCCESS,
    RESOLVED:    BADGE_SUCCESS,
    REJECTED:    BADGE_DANGER,
    DEFERRED:    BADGE_WARNING,
    UNDER_ANALYSIS: BADGE_ACCENT,
    PENDING_VERIFICATION: BADGE_WARNING,
    CLOSED:      BADGE_NEUTRAL,
    DISMISSED:   BADGE_NEUTRAL,
    VALID:       BADGE_SUCCESS,
    EXPIRED:     BADGE_DANGER,
    EXPIRING:      BADGE_WARNING,
    EXPIRING_SOON: BADGE_WARNING,
    SUSPENDED:     BADGE_WARNING,
    PASS:        BADGE_SUCCESS,
    FAIL:        BADGE_DANGER,
    CONDITIONAL: BADGE_WARNING,
    PENDING:     BADGE_NEUTRAL,
    DRAFT:       BADGE_WARNING,
    SUBMITTED:   BADGE_SUCCESS,
    REVIEWED:    BADGE_INFO,
  };
  const cls = map[status] ?? BADGE_NEUTRAL;
  return (
    <span className={`inline-block text-[10px] px-2 py-0.5 rounded-full border font-bold ${cls}`}>
      {label ?? status}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: string }) {
  const map: Record<string, string> = {
    CRITICAL: BADGE_DANGER,
    HIGH:     BADGE_ACCENT,
    MEDIUM:   BADGE_WARNING,
    LOW:      BADGE_NEUTRAL,
  };
  const cls = map[priority] ?? BADGE_NEUTRAL;
  return (
    <span className={`inline-block text-[10px] px-2 py-0.5 rounded-full border font-bold ${cls}`}>
      {priority}
    </span>
  );
}
