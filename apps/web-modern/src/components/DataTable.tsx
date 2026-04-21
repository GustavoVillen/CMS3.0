import React, { useMemo, useState } from "react";
import { Loader2, AlertCircle, SearchX, ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { useSearchParams } from "react-router-dom";

export { fmtDate } from "../lib/utils";

export interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => React.ReactNode;
  className?: string;
  sortable?: boolean;
  sortValue?: (row: T) => string | number | Date | null | undefined;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[] | null;
  loading: boolean;
  error: string | null;
  keyFn: (row: T) => string;
  emptyText?: string;
  onRowClick?: (row: T) => void;
}

export function DataTable<T>({ columns, data, loading, error, keyFn, emptyText = "Sin registros", onRowClick }: DataTableProps<T>) {
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

  const onHeaderClick = (column: Column<T>) => {
    if (column.sortable === false || !column.header.trim()) return;

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
    <div className="flex items-center gap-3 text-red-400 text-sm p-4 bg-red-500/10 rounded-xl border border-red-500/20">
      <AlertCircle className="w-5 h-5 shrink-0" />
      {error}
    </div>
  );

  if (!sortedData || sortedData.length === 0) return (
    <div className="flex flex-col items-center justify-center py-20 text-text-industrial/20 gap-3">
      <SearchX className="w-8 h-8" />
      <p className="text-sm">{emptyText}</p>
    </div>
  );

  return (
    <div className="overflow-x-auto rounded-xl border border-white/10">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/10 bg-white/2">
            {columns.map(col => (
              <th
                key={col.key}
                className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider ${col.sortable === false || !col.header.trim() ? "text-text-industrial/50" : "text-text-industrial/60 hover:text-white cursor-pointer select-none"} ${col.className ?? ""}`}
                onClick={() => onHeaderClick(col)}
                aria-sort={sortKey === col.key ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
              >
                <span className="inline-flex items-center gap-1">
                  {col.header}
                  {col.sortable !== false && col.header.trim() && sortKey !== col.key && <ChevronsUpDown className="w-3 h-3 opacity-50" />}
                  {col.sortable !== false && col.header.trim() && sortKey === col.key && sortDirection === "asc" && <ChevronUp className="w-3 h-3 text-accent" />}
                  {col.sortable !== false && col.header.trim() && sortKey === col.key && sortDirection === "desc" && <ChevronDown className="w-3 h-3 text-accent" />}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {sortedData.map(row => (
            <tr
              key={keyFn(row)}
              className={`hover:bg-white/2 transition-colors group ${onRowClick ? "cursor-pointer" : ""}`}
              onClick={() => onRowClick?.(row)}
            >
              {columns.map(col => (
                <td key={col.key} className={`px-4 py-3 text-text-industrial/80 ${col.className ?? ""}`}>
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

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    ACTIVE:      "bg-success-sea/10 text-success-sea border-success-sea/20",
    INACTIVE:    "bg-white/5 text-text-industrial/40 border-white/10",
    PLANNED:     "bg-blue-500/10 text-blue-400 border-blue-500/20",
    SCHEDULED:   "bg-blue-500/10 text-blue-400 border-blue-500/20",
    IN_PROGRESS: "bg-accent/10 text-accent border-accent/20",
    ON_HOLD:     "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
    COMPLETED:   "bg-success-sea/10 text-success-sea border-success-sea/20",
    CANCELLED:   "bg-red-500/10 text-red-400 border-red-500/20",
    OPEN:        "bg-accent/10 text-accent border-accent/20",
    REQUESTED:   "bg-blue-500/10 text-blue-400 border-blue-500/20",
    UNDER_REVIEW:"bg-blue-500/10 text-blue-400 border-blue-500/20",
    APPROVED:    "bg-success-sea/10 text-success-sea border-success-sea/20",
    RESOLVED:    "bg-success-sea/10 text-success-sea border-success-sea/20",
    REJECTED:    "bg-red-500/10 text-red-400 border-red-500/20",
    DEFERRED:    "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
    UNDER_ANALYSIS: "bg-accent/10 text-accent border-accent/20",
    PENDING_VERIFICATION: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
    CLOSED:      "bg-white/5 text-text-industrial/30 border-white/10",
    DISMISSED:   "bg-white/5 text-text-industrial/30 border-white/10",
    VALID:       "bg-success-sea/10 text-success-sea border-success-sea/20",
    EXPIRED:     "bg-red-500/10 text-red-400 border-red-500/20",
    EXPIRING:      "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
    EXPIRING_SOON: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
    SUSPENDED:     "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
    PASS:        "bg-success-sea/10 text-success-sea border-success-sea/20",
    FAIL:        "bg-red-500/10 text-red-400 border-red-500/20",
    CONDITIONAL: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
    PENDING:     "bg-white/5 text-text-industrial/40 border-white/10",
    DRAFT:       "bg-white/5 text-text-industrial/40 border-white/10",
  };
  const cls = map[status] ?? "bg-white/5 text-text-industrial/40 border-white/10";
  return (
    <span className={`inline-block text-[10px] px-2 py-0.5 rounded-full border font-bold ${cls}`}>
      {status}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: string }) {
  const map: Record<string, string> = {
    CRITICAL: "bg-red-500/10 text-red-400 border-red-500/20",
    HIGH:     "bg-accent/10 text-accent border-accent/20",
    MEDIUM:   "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
    LOW:      "bg-white/5 text-text-industrial/40 border-white/10",
  };
  const cls = map[priority] ?? "bg-white/5 text-text-industrial/40 border-white/10";
  return (
    <span className={`inline-block text-[10px] px-2 py-0.5 rounded-full border font-bold ${cls}`}>
      {priority}
    </span>
  );
}
