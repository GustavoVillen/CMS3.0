import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { FileDown, FileSpreadsheet, LayoutGrid, List, Loader2, Maximize2, Minimize2, Plus, Search, Settings, ShieldAlert, Sparkles, Trash2, X } from "lucide-react";
import { useFetch } from "../lib/hooks";
import { api, ApiError } from "../lib/api";
import { DataTable, StatusBadge, type Column } from "../components/DataTable";
import { FILTER_ALL_VALUE, fromFilterSelectValue, toFilterSelectValue } from "../lib/utils";
import { PageHeader } from "../components/PageHeader";
import { ModalCloseButton } from "../components/ModalCloseButton";
import { VesselLabel } from "../components/EntityLabels";
import { ExcelPanel } from "../components/ExcelPanel";
import { useT } from "../lib/i18n";
import { useAuth, useCan } from "../lib/auth";
import { useCopilotEmitter } from "../lib/copilot-context";
import { useEscapeGuard, useDirtyTracker } from "../lib/escape-guard";
import { useVesselContext } from "../lib/vessel-context";
import { useTmsaFilter, applyTmsaFilter, TmsaFilterBanner } from "../lib/tmsa-filter";
import { MaintenancePlanModal, type MaintenancePlan } from "./MaintenancePlans";
import { AutoTextArea } from "../components/AutoTextArea";

interface Asset {
  id: string;
  tenantId: string;
  vesselCode: string;
  assetCode: string;
  sfiCode: string | null;
  name: string;
  criticality: string;
  criticalityRationale: string | null;
  planNotRequired?: boolean;
  planNotRequiredReason?: string | null;
  status: string;
  manufacturer: string | null;
  model: string | null;
  serialNumber: string | null;
  installationDate: string | null;
  lastOverhaulDate: string | null;
  replacementDate: string | null;
  trackDailyReport: boolean;
  isSafetyCritical: boolean;
  currentHours: number | null;
  /** Fecha (YYYY-MM-DD) y origen de la última lectura de horómetro. */
  currentHoursDate?: string | null;
  currentHoursSource?: string | null;
  equipmentClassId: string | null;
  parentAssetId: string | null;
  createdAt: string;
}

interface ListResponse {
  items: Asset[];
  total: number;
}

interface Vessel {
  code: string;
  name: string;
  status: string;
}

// SFI: solo grupo (0-9). Nombres desde i18n `sfi.g.<n>`.
const SFI_GROUP_NUMBERS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

// El tablero arranca en G1: el grupo 0 se sacó por pedido del armador (jul 2026)
// para ganar ancho de pantalla. Sus equipos siguen existiendo y se ven en la
// vista de lista y en el chip G0 — sólo no tienen columna acá.
const BOARD_GROUP_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

type SfiTab = "ALL" | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | "NONE" | "ISM";
const SFI_TABS: { key: SfiTab; label: string }[] = [
  { key: "ALL",  label: "TODOS" },
  { key: 0,      label: "G0" },
  { key: 1,      label: "G1" },
  { key: 2,      label: "G2" },
  { key: 3,      label: "G3" },
  { key: 4,      label: "G4" },
  { key: 5,      label: "G5" },
  { key: 6,      label: "G6" },
  { key: 7,      label: "G7" },
  { key: 8,      label: "G8" },
  { key: 9,      label: "G9" },
];

function sfiTabOfCode(sfiCode: string | null | undefined): SfiTab {
  if (!sfiCode) return "NONE";
  const digit = parseInt(sfiCode.trim()[0] ?? "", 10);
  return Number.isNaN(digit) ? "NONE" : digit as SfiTab;
}

/**
 * Criticidad como letra dentro de un círculo, del mismo tamaño que el
 * ShieldAlert de ISM 10.3 para que los dos íconos de una tarjeta se lean como
 * un par. A/B/C usan la misma escala de color que el resto del sistema
 * (rojo → amarillo → neutro).
 */
const CRITICALITY_DOT_CLS: Record<string, string> = {
  A: "border-red-500/40 text-red-700 dark:text-red-400 bg-red-500/10",
  B: "border-yellow-500/40 text-yellow-700 dark:text-yellow-400 bg-yellow-500/10",
  C: "border-fg/15 text-text-industrial/50 bg-fg/5",
};

const CriticalityDot: React.FC<{ value: string | null | undefined; title?: string }> = ({ value, title }) => {
  const letter = (value ?? "").trim().toUpperCase();
  if (!letter) return null;
  return (
    <span
      title={title}
      className={`inline-flex items-center justify-center w-4 h-4 shrink-0 rounded-full border text-[9px] font-bold leading-none ${CRITICALITY_DOT_CLS[letter] ?? CRITICALITY_DOT_CLS.C}`}
    >
      {letter}
    </span>
  );
};

/** Tarjeta de equipo del tablero. Al hacer clic abre el mismo modal que la lista. */
function AssetBoardCard({ asset, onOpen, safetyTitle, critTitle }: {
  asset: Asset;
  onOpen: (a: Asset) => void;
  safetyTitle: string;
  critTitle: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(asset)}
      className="w-full text-left bg-surface border border-fg/10 rounded-lg px-2 py-1.5
        hover:border-accent/40 hover:bg-fg/[0.03] transition-colors cursor-pointer"
    >
      {/* El buque no se muestra: ya va como prefijo del código del asset
          (M01-CR-BR). Repetirlo gastaba un renglón por tarjeta. */}
      <div className="flex items-center gap-1.5">
        <span className="font-mono font-bold text-fg text-[10px] truncate">{asset.assetCode}</span>
        <span className="ml-auto flex items-center gap-1 shrink-0">
          {asset.isSafetyCritical && (
            <span title={`${safetyTitle} (ISM 10.3)`} className="inline-flex items-center text-amber-700 dark:text-amber-400">
              <ShieldAlert className="w-3.5 h-3.5" />
            </span>
          )}
          <CriticalityDot value={asset.criticality} title={`${critTitle} ${asset.criticality}`} />
        </span>
      </div>
      <p className="text-xs text-fg font-medium line-clamp-2 leading-snug" title={asset.name}>{asset.name}</p>
      {asset.status !== "OPERATIONAL" && (
        <span className={`block text-[9px] font-bold ${asset.status === "OUT_OF_SERVICE" ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"}`}>
          {asset.status === "OUT_OF_SERVICE" ? "FUERA DE SERVICIO" : asset.status}
        </span>
      )}
    </button>
  );
}

/**
 * Inventario por sistema: una columna por grupo SFI (0-9). Es una lectura del
 * mismo listado que ya trae la página — respeta los filtros de arriba y no
 * agrega ninguna consulta. Columnas de ancho fijo con scroll horizontal: con 10
 * grupos, repartir el ancho en partes iguales deja las tarjetas ilegibles.
 */
function AssetsBoard({ assets, loading, onOpen, t }: {
  assets: Asset[] | null;
  loading: boolean;
  onOpen: (a: Asset) => void;
  t: ReturnType<typeof useT>;
}) {
  const byGroup = useMemo(() => {
    const map = new Map<number | "NONE", Asset[]>();
    for (const g of SFI_GROUP_NUMBERS) map.set(g, []);
    map.set("NONE", []);
    for (const a of assets ?? []) {
      const tab = sfiTabOfCode(a.sfiCode);
      const key = tab === "NONE" ? "NONE" : (tab as number);
      map.get(key)?.push(a);
    }
    for (const list of map.values()) list.sort((x, y) => x.name.localeCompare(y.name, "es", { numeric: true }));
    return map;
  }, [assets]);

  if (loading && !assets) {
    return <div className="flex items-center gap-2 text-xs text-text-industrial/60"><Loader2 className="w-4 h-4 animate-spin text-accent" />Cargando equipos...</div>;
  }

  // Sólo se muestran los grupos que tienen equipos: una columna vacía no aporta
  // nada y gasta ancho de pantalla, que es justo lo escaso acá. Como el buque
  // seleccionado cambia qué grupos tienen equipos, el tablero se reacomoda solo.
  // (Incluye "sin grupo SFI", que además es un caso de datos incompletos.)
  const cols = [
    ...BOARD_GROUP_NUMBERS.map(g => ({ key: g as number | "NONE", label: `G${g}`, name: t(`sfi.g.${g}` as Parameters<typeof t>[0]) })),
    { key: "NONE" as const, label: "—", name: "Sin grupo SFI" },
  ].filter(col => (byGroup.get(col.key)?.length ?? 0) > 0);

  if (cols.length === 0) {
    return <p className="text-xs text-text-industrial/50 py-8 text-center">{t("empty.assets")}</p>;
  }

  return (
    <div className="overflow-x-auto pb-4">
      <div className="flex gap-3 min-w-max">
        {cols.map(col => {
          const items = byGroup.get(col.key) ?? [];
          return (
            <div key={String(col.key)} className="w-[210px] shrink-0 flex flex-col border-t-2 border-accent/30 pt-2">
              <div className="flex items-start gap-2 px-1 mb-2">
                <div className="min-w-0">
                  <span className="text-[11px] font-bold uppercase tracking-widest text-accent">{col.label}</span>
                  <p className="text-[10px] text-text-industrial/60 leading-tight" title={col.name}>{col.name}</p>
                </div>
                <span className="ml-auto shrink-0 text-[10px] font-bold text-text-industrial/50 bg-fg/5 rounded-full px-1.5 py-0.5">
                  {items.length}
                </span>
              </div>
              <div className="flex flex-col gap-1.5 overflow-y-auto pr-0.5" style={{ maxHeight: "calc(100vh - 300px)" }}>
                {items.map(a => (
                  <AssetBoardCard
                    key={a.id}
                    asset={a}
                    onOpen={onOpen}
                    safetyTitle={t("asset.safetyCritical")}
                    critTitle={t("asset.criticalityOf")}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function toDateInputValue(value: string | null): string {
  if (!value) return "";
  return value.includes("T") ? value.slice(0, 10) : value;
}

function normalizeOptionalText(value: string): string | null {
  const text = value.trim();
  return text || null;
}

function toAssetCodeToken(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildNamePrefix(name: string): string {
  const tokens = toAssetCodeToken(name).split("-").filter(Boolean);
  if (tokens.length === 0) return "AS";
  const ignored = new Set(["SYSTEM", "SYSTEMS", "EQUIPMENT", "UNIT", "GENERAL"]);
  const meaningful = tokens.filter(token => !ignored.has(token));
  if (meaningful.length >= 2) return `${meaningful[0][0]}${meaningful[1][0]}`.slice(0, 4);
  if (meaningful.length === 1) return meaningful[0].slice(0, 4);
  return tokens[0].slice(0, 4) || "AS";
}

function codePrefixFromExisting(assetCode: string): string {
  const normalized = toAssetCodeToken(assetCode);
  const match = normalized.match(/^([A-Z0-9]{2,8})-(\d{3,4})$/);
  if (match?.[1]) return match[1];
  const firstChunk = normalized.split("-").find(Boolean);
  return (firstChunk ?? "AS").slice(0, 8);
}

function nextSequentialAssetCode(prefix: string, existingCodes: Set<string>): string {
  const normalizedPrefix = toAssetCodeToken(prefix).slice(0, 8) || "AS";
  const matcher = new RegExp(`^${escapeRegExp(normalizedPrefix)}-(\\d{3,4})$`);
  let maxSeq = 0;

  for (const code of existingCodes) {
    const match = code.match(matcher);
    if (!match) continue;
    const seq = Number(match[1]);
    if (Number.isFinite(seq) && seq > maxSeq) maxSeq = seq;
  }

  const next = maxSeq + 1;
  const width = next >= 1000 ? 4 : 3;
  return `${normalizedPrefix}-${String(next).padStart(width, "0")}`;
}

function suggestFromExistingCode(assetCode: string, existingCodes: Set<string>): string {
  return nextSequentialAssetCode(codePrefixFromExisting(assetCode), existingCodes);
}

function buildSuggestedAssetCode(name: string, existingCodes: Set<string>): string {
  return nextSequentialAssetCode(buildNamePrefix(name), existingCodes);
}

function buildFormattedAssetCode(
  vesselCode: string,
  groupNumber: string,
  name: string,
  existingCodes: Set<string>,
): string {
  const vc = toAssetCodeToken(vesselCode);
  const gn = groupNumber.trim();
  const namePrefix = buildNamePrefix(name);
  const prefix = vc && gn ? `${vc}-${gn}-${namePrefix}` : namePrefix;
  return nextSequentialAssetCode(prefix, existingCodes);
}

async function downloadAssetPdf(asset: { id: string; assetCode: string; vesselCode: string }): Promise<void> {
  const token = localStorage.getItem("gpms_token") ?? "";
  const slug  = localStorage.getItem("gpms_tenant_slug") ?? "";
  const res = await fetch(`/app/pms/assets/${asset.id}/pdf`, {
    headers: { Authorization: `Bearer ${token}`, "X-Tenant-Slug": slug },
  });
  if (!res.ok) throw new ApiError(res.status, "PDF_ERROR", "No se pudo generar el PDF.");
  const blob = await res.blob();
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `${asset.assetCode}-${asset.vesselCode}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}

interface AssetWorkOrder {
  id: string;
  workOrderCode: string;
  type: string;
  status: string;
  title: string | null;
  openDate: string;
  completedDate: string | null;
}

// Registro de ejecución directa de un plan (sin OT). Los planes de inspección y
// los mantenimientos cerrados con "Registrar Ejecución" quedan como WorkLog.
interface AssetWorkLog {
  id: string;
  logCode: string;
  taskType: string;
  result: string;
  startedAt: string | null;
  completedAt: string | null;
  notes: string | null;
  workOrderId: string | null;
  maintenancePlanId: string | null;
  maintenancePlan: { taskCode: string; title: string } | null;
}

// Fila normalizada del historial unificado (OTs + ejecuciones de planes).
interface AssetHistoryRow {
  key: string;
  code: string;
  type: string;
  title: string | null;
  openDate: string | null;
  completedDate: string | null;
  statusText: string;
  statusNode: React.ReactNode;
  isInspection: boolean;
  onClick?: () => void;
}

type AssetHistoryFilter = "ALL" | "MAINTENANCE" | "INSPECTION";
type AssetHistorySortKey = "code" | "type" | "title" | "openDate" | "completedDate" | "status";

function fmtHistoryDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  // Las fechas de ejecución/OT se guardan como medianoche UTC (date-only). Hay
  // que formatearlas en UTC para no retroceder un día en husos negativos
  // (ej. ART UTC-3: 2025-12-17T00:00Z se vería como 16/12 en hora local).
  return date.toLocaleDateString(undefined, { timeZone: "UTC" });
}

const WoTypeBadge: React.FC<{ type: string }> = ({ type }) => {
  const t = useT();
  if (type === "INSPECTION")
    return <span className="inline-block text-[10px] px-2 py-0.5 rounded-full border font-bold bg-teal-500/10 text-teal-700 dark:text-teal-400 border-teal-500/20">{t("wo.type.inspection")}</span>;
  if (type === "CORRECTIVE")
    return <span className="inline-block text-[10px] px-2 py-0.5 rounded-full border font-bold bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20">{t("wo.type.corrective")}</span>;
  return <span className="inline-block text-[10px] px-2 py-0.5 rounded-full border font-bold bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20">{t("wo.type.preventive")}</span>;
};

// Estado de un registro de ejecución de plan (WorkLogResult).
const WorkLogResultBadge: React.FC<{ result: string }> = ({ result }) => {
  const t = useT();
  const cls =
    result === "COMPLETED" ? "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20"
    : result === "COMPLETED_WITH_OBSERVATIONS" ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20"
    : result === "FOLLOW_UP_REQUIRED" ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20"
    : "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20";
  const label = t(`worklog.result.${result}` as Parameters<typeof t>[0]);
  return <span className={`inline-block text-[10px] px-2 py-0.5 rounded-full border font-bold ${cls}`}>{label}</span>;
};

// Historial de mantenimientos/inspecciones (órdenes de trabajo) del asset.
// Solo lectura, se muestra al final del formulario en modo edición. Exportado:
// también lo reusa el panel de "Estado de mantenimiento" del Dashboard.
// Sólo necesita el id, así que el prop no exige el Asset completo.
export const AssetHistory: React.FC<{ asset: { id: string } }> = ({ asset }) => {
  const t = useT();
  const navigate = useNavigate();
  const assetId = asset.id;
  const woFetch = useFetch<{ items: AssetWorkOrder[] }>(
    `/app/pms/work-orders?assetId=${encodeURIComponent(assetId)}`,
    [assetId],
  );
  const logFetch = useFetch<{ items: AssetWorkLog[] }>(
    `/app/pms/work-logs?assetId=${encodeURIComponent(assetId)}`,
    [assetId],
  );

  const loading = woFetch.loading || logFetch.loading;
  const error = woFetch.error || logFetch.error;

  // Historial unificado: OTs + ejecuciones directas de planes (WorkLog sin OT,
  // para no duplicar con OTs ya listadas). Ordenado por fecha descendente.
  const rows = useMemo<AssetHistoryRow[]>(() => {
    const woRows: AssetHistoryRow[] = (woFetch.data?.items ?? []).map(wo => ({
      key: `wo-${wo.id}`,
      code: wo.workOrderCode,
      type: wo.type,
      title: wo.title,
      openDate: wo.openDate,
      completedDate: wo.completedDate,
      statusText: wo.status,
      statusNode: <StatusBadge status={wo.status} />,
      isInspection: wo.type === "INSPECTION",
      onClick: () => navigate(`/work-orders?autoCode=${encodeURIComponent(wo.workOrderCode)}`),
    }));
    const logRows: AssetHistoryRow[] = (logFetch.data?.items ?? [])
      .filter(log => !log.workOrderId)
      .map(log => ({
        key: `log-${log.id}`,
        code: log.maintenancePlan?.taskCode ?? log.logCode,
        type: log.taskType,
        title: log.maintenancePlan?.title ?? log.notes,
        openDate: log.startedAt,
        completedDate: log.completedAt,
        statusText: log.result,
        statusNode: <WorkLogResultBadge result={log.result} />,
        isInspection: log.taskType === "INSPECTION",
      }));
    const ref = (r: AssetHistoryRow): number => {
      const d = r.completedDate ?? r.openDate;
      const t2 = d ? new Date(d).getTime() : NaN;
      return Number.isNaN(t2) ? 0 : t2;
    };
    return [...woRows, ...logRows].sort((a, b) => ref(b) - ref(a));
  }, [woFetch.data, logFetch.data, navigate]);

  const [filter, setFilter] = useState<AssetHistoryFilter>("ALL");
  const filteredRows = useMemo(() => {
    if (filter === "ALL") return rows;
    if (filter === "INSPECTION") return rows.filter(r => r.isInspection);
    return rows.filter(r => !r.isInspection);
  }, [rows, filter]);

  // Orden por columna (clic en encabezado) — mismo patrón que MaintenancePlansGrid.
  const [sortKey, setSortKey] = useState<AssetHistorySortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const toggleSort = (key: AssetHistorySortKey) => {
    if (sortKey !== key) { setSortKey(key); setSortDir("asc"); }
    else setSortDir(d => (d === "asc" ? "desc" : "asc"));
  };
  const sortVal = (row: AssetHistoryRow, key: AssetHistorySortKey): string | number | null => {
    switch (key) {
      case "code": return row.code;
      case "type": return row.type;
      case "title": return (row.title ?? "").toLowerCase();
      case "openDate": return row.openDate ? new Date(row.openDate).getTime() : null;
      case "completedDate": return row.completedDate ? new Date(row.completedDate).getTime() : null;
      case "status": return row.statusText;
      default: return null;
    }
  };
  const visibleRows = useMemo(() => {
    if (!sortKey) return filteredRows;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filteredRows].sort((a, b) => {
      const av = sortVal(a, sortKey);
      const bv = sortVal(b, sortKey);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: "base" }) * dir;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredRows, sortKey, sortDir]);

  const historyTh = (key: AssetHistorySortKey, label: string, extraCls = "") => {
    const active = sortKey === key;
    return (
      <th className={`text-left font-semibold px-3 py-2 whitespace-nowrap ${extraCls}`}>
        <button
          type="button"
          onClick={() => toggleSort(key)}
          className="inline-flex items-center gap-1 hover:text-fg transition-colors select-none"
        >
          <span>{label}</span>
          <span className={active ? "text-accent" : "opacity-40"}>{active ? (sortDir === "asc" ? "↑" : "↓") : "↕"}</span>
        </button>
      </th>
    );
  };

  const filterBtnCls = (active: boolean) =>
    `px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all ${
      active
        ? "bg-accent/15 border-accent/30 text-accent"
        : "bg-fg/3 border-fg/10 text-text-industrial/60 hover:bg-fg/8"
    }`;

  return (
    <div className="space-y-2 pt-2 border-t border-fg/10">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">{t("asset.history.title")}</h3>
        {!loading && !error && rows.length > 0 && (
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => setFilter("ALL")} className={filterBtnCls(filter === "ALL")}>{t("asset.history.filter.all")}</button>
            <button type="button" onClick={() => setFilter("MAINTENANCE")} className={filterBtnCls(filter === "MAINTENANCE")}>{t("asset.history.filter.maintenance")}</button>
            <button type="button" onClick={() => setFilter("INSPECTION")} className={filterBtnCls(filter === "INSPECTION")}>{t("asset.history.filter.inspection")}</button>
          </div>
        )}
      </div>
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-text-industrial/60"><Loader2 className="w-4 h-4 animate-spin text-accent" /></div>
      ) : error ? (
        <p className="text-xs text-red-700 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{t("asset.history.loadError")}</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-text-industrial/50 bg-fg/3 border border-fg/8 rounded-xl px-3 py-3">{t("asset.history.empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-fg/10">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-fg/5 text-text-industrial/50">
                {historyTh("code", t("asset.history.col.code"))}
                {historyTh("type", t("asset.history.col.type"))}
                {historyTh("title", t("asset.history.col.title"))}
                {historyTh("openDate", t("asset.history.col.openDate"))}
                {historyTh("completedDate", t("asset.history.col.completedDate"))}
                {historyTh("status", t("asset.history.col.status"))}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map(row => (
                <tr
                  key={row.key}
                  onClick={row.onClick}
                  className={`border-t border-fg/5 transition-colors ${row.onClick ? "cursor-pointer hover:bg-fg/5" : ""}`}
                  title={row.onClick ? t("asset.history.openWo") : undefined}
                >
                  <td className="px-3 py-2 font-mono font-bold text-accent whitespace-nowrap">{row.code}</td>
                  <td className="px-3 py-2 whitespace-nowrap"><WoTypeBadge type={row.type} /></td>
                  <td className="px-3 py-2 text-text-industrial/80"><span className="line-clamp-1">{row.title ?? "—"}</span></td>
                  <td className="px-3 py-2 text-text-industrial/60 whitespace-nowrap">{fmtHistoryDate(row.openDate)}</td>
                  <td className="px-3 py-2 text-text-industrial/60 whitespace-nowrap">{fmtHistoryDate(row.completedDate)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{row.statusNode}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// Tareas del plan de mantenimiento del asset. Son los MISMOS registros que el
// módulo "Plan de Mantenimiento" (fuente de verdad única): al hacer click se
// abre el editor real reutilizado, por lo que cualquier cambio acá se refleja
// en el plan y viceversa, sin duplicar datos.
function fmtPlanFreq(plan: MaintenancePlan): string {
  const tt = plan.triggerType;
  if ((tt === "HOURS" || tt === "RUNNING_HOURS") && plan.frequencyHours) return `${plan.frequencyHours.toLocaleString()} h`;
  if ((tt === "MONTHS" || tt === "CALENDAR") && plan.frequencyMonths) return `${plan.frequencyMonths} m`;
  if (tt === "DAY" && plan.frequencyMonths) return `${plan.frequencyMonths} d`;
  if (tt === "WEEK" && plan.frequencyMonths) return `${plan.frequencyMonths} sem`;
  return tt;
}

function fmtPlanNextDue(plan: MaintenancePlan): string {
  if (plan.nextDueHours != null) return `${plan.nextDueHours.toLocaleString()} h`;
  if (plan.nextDueDate) return fmtHistoryDate(plan.nextDueDate);
  return "—";
}

const PlanTaskTypeBadge: React.FC<{ type: string }> = ({ type }) => {
  const t = useT();
  const isInsp = type === "INSPECTION";
  return (
    <span className={`inline-block text-[10px] px-2 py-0.5 rounded-full border font-bold ${isInsp ? "bg-teal-500/10 text-teal-700 dark:text-teal-400 border-teal-500/20" : "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20"}`}>
      {t(`mp.taskType.${isInsp ? "INSPECTION" : "MAINTENANCE"}` as Parameters<typeof t>[0])}
    </span>
  );
};

const AssetMaintenancePlans: React.FC<{ asset: Asset }> = ({ asset }) => {
  const t = useT();
  const { user } = useAuth();
  const can = useCan();
  const role = user?.role;
  const canManage = can("asset.manage");

  const { data, loading, error, reload } = useFetch<{ items: MaintenancePlan[] }>(
    `/app/pms/maintenance-plans?assetId=${encodeURIComponent(asset.id)}`,
    [asset.id],
  );
  const items = useMemo(() => {
    const raw = data?.items ?? [];
    const freqKey = (p: MaintenancePlan): number => {
      const tt = p.triggerType;
      if ((tt === "HOURS" || tt === "RUNNING_HOURS") && p.frequencyHours) return p.frequencyHours;
      if ((tt === "MONTHS" || tt === "CALENDAR") && p.frequencyMonths) return p.frequencyMonths * 730;
      if (tt === "DAY" && p.frequencyMonths) return p.frequencyMonths * 24;
      if (tt === "WEEK" && p.frequencyMonths) return p.frequencyMonths * 168;
      return Infinity;
    };
    return [...raw].sort((a, b) => freqKey(a) - freqKey(b));
  }, [data]);

  // undefined = cerrado | null = nueva tarea | objeto = edición
  const [editingPlan, setEditingPlan] = useState<MaintenancePlan | null | undefined>(undefined);
  const [loadingDetailId, setLoadingDetailId] = useState<string | null>(null);

  const sfiGroupNumber = useMemo(() => {
    const first = asset.sfiCode?.trim()?.[0];
    const n = first ? parseInt(first, 10) : NaN;
    return Number.isNaN(n) ? null : n;
  }, [asset.sfiCode]);

  const openPlan = useCallback(async (row: MaintenancePlan) => {
    setLoadingDetailId(row.id);
    try {
      const detail = await api.get<MaintenancePlan>(`/app/pms/maintenance-plans/${row.id}`);
      setEditingPlan(detail);
    } catch {
      setEditingPlan(row);
    } finally {
      setLoadingDetailId(null);
    }
  }, []);

  return (
    <div className="space-y-2 pt-2 border-t border-fg/10">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">{t("asset.plans.title")}</h3>
        {canManage && (
          <button
            type="button"
            onClick={() => setEditingPlan(null)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-accent/10 border border-accent/20 text-[11px] font-bold text-accent hover:bg-accent/20 transition-all"
          >
            <Plus className="w-3 h-3" /> {t("asset.plans.new")}
          </button>
        )}
      </div>
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-text-industrial/60"><Loader2 className="w-4 h-4 animate-spin text-accent" /></div>
      ) : error ? (
        <p className="text-xs text-red-700 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{t("asset.plans.loadError")}</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-text-industrial/50 bg-fg/3 border border-fg/8 rounded-xl px-3 py-3">{t("asset.plans.empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-fg/10">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-fg/5 text-text-industrial/50">
                <th className="text-left font-semibold px-3 py-2 whitespace-nowrap">{t("mp.taskCode")}</th>
                <th className="text-left font-semibold px-3 py-2 whitespace-nowrap">{t("mp.taskType")}</th>
                <th className="text-left font-semibold px-3 py-2">{t("col.name")}</th>
                <th className="text-left font-semibold px-3 py-2 whitespace-nowrap">{t("asset.plans.col.freq")}</th>
                <th className="text-left font-semibold px-3 py-2 whitespace-nowrap">{t("asset.plans.col.nextDue")}</th>
                <th className="text-left font-semibold px-3 py-2 whitespace-nowrap">{t("col.status")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map(plan => (
                <tr
                  key={plan.id}
                  onClick={() => { void openPlan(plan); }}
                  className="border-t border-fg/5 cursor-pointer hover:bg-fg/5 transition-colors"
                  title={t("asset.plans.openTask")}
                >
                  <td className="px-3 py-2 font-mono font-bold text-accent whitespace-nowrap">
                    {loadingDetailId === plan.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : plan.taskCode}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap"><PlanTaskTypeBadge type={plan.taskType} /></td>
                  <td className="px-3 py-2 text-text-industrial/80"><span className="line-clamp-1">{plan.title}</span></td>
                  <td className="px-3 py-2 text-text-industrial/60 whitespace-nowrap">{fmtPlanFreq(plan)}</td>
                  <td className="px-3 py-2 text-text-industrial/60 whitespace-nowrap">{fmtPlanNextDue(plan)}</td>
                  <td className="px-3 py-2 whitespace-nowrap"><StatusBadge status={plan.executionStatus} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editingPlan !== undefined && (
        <MaintenancePlanModal
          plan={editingPlan}
          userId={user?.id ?? null}
          userName={user?.name ?? user?.email ?? ""}
          isAdmin={canManage}
          canEditNextDue={role === "TENANT_ADMIN"}
          overlayZClass="z-[60]"
          defaultVesselCode={asset.vesselCode}
          defaultAssetId={asset.id}
          defaultSfiGroupNumber={sfiGroupNumber}
          lockAsset
          onClose={() => setEditingPlan(undefined)}
          onSaved={async () => { await reload(); }}
        />
      )}
    </div>
  );
};

interface AssetModalProps {
  initial: Asset | null;
  defaultVesselCode?: string | null;
  vessels: Vessel[];
  tenantAssets: Asset[];
  isAdmin: boolean;
  onClose: () => void;
  onSaved: () => void;
}

interface AssetNameOption {
  name: string;
  suggestedAssetCode: string;
}

const AssetModal: React.FC<AssetModalProps> = ({
  initial,
  defaultVesselCode,
  vessels,
  tenantAssets,
  isAdmin,
  onClose,
  onSaved,
}) => {
  const t = useT();
  const isEdit = Boolean(initial);

  const { data: assetDetail } = useFetch<Asset>(
    initial?.id ? `/app/pms/assets/${initial.id}` : null,
    [initial?.id ?? ""],
  );
  const currentHours = assetDetail?.currentHours ?? initial?.currentHours ?? null;
  // Fecha y origen de esa lectura: sin la fecha, un horómetro viejo se lee como si
  // fuera de hoy. Las lecturas se cargan en la pantalla "Horas de Equipos" o llegan
  // solas desde el M2.
  const currentHoursDate = assetDetail?.currentHoursDate ?? initial?.currentHoursDate ?? null;
  const currentHoursSource = assetDetail?.currentHoursSource ?? initial?.currentHoursSource ?? null;

  const [vesselCode, setVesselCode] = useState(initial?.vesselCode ?? defaultVesselCode ?? "");
  const [assetCode, setAssetCode] = useState(initial?.assetCode ?? "");
  // Arranca con el grupo del asset, no vacío: el efecto de más abajo lo vuelve
  // a calcular igual, pero corre después del primer render y useDirtyTracker
  // saca su foto EN el primer render. Si acá quedaba "", el equipo nacía
  // "sucio" y cerrarlo preguntaba por cambios que nadie hizo.
  const [selectedGroup, setSelectedGroup] = useState(() => {
    const firstDigit = (initial?.sfiCode?.trim() ?? "")[0] ?? "";
    return /^[0-9]$/.test(firstDigit) ? firstDigit : "";
  });
  const [name, setName] = useState(initial?.name ?? "");
  const [criticality, setCriticality] = useState(initial?.criticality ?? "B");
  const [criticalityRationale, setCriticalityRationale] = useState(initial?.criticalityRationale ?? "");
  const [suggestingCriticality, setSuggestingCriticality] = useState(false);
  const [status, setStatus] = useState(initial?.status ?? "OPERATIONAL");
  const [manufacturer, setManufacturer] = useState(initial?.manufacturer ?? "");
  const [model, setModel] = useState(initial?.model ?? "");
  const [serialNumber, setSerialNumber] = useState(initial?.serialNumber ?? "");
  const [trackDailyReport, setTrackDailyReport] = useState(initial?.trackDailyReport ?? false);
  const [isSafetyCritical, setIsSafetyCritical] = useState(initial?.isSafetyCritical ?? false);
  const [planNotRequired, setPlanNotRequired] = useState(initial?.planNotRequired ?? false);
  const [planNotRequiredReason, setPlanNotRequiredReason] = useState(initial?.planNotRequiredReason ?? "");
  const [installationDate, setInstallationDate] = useState(toDateInputValue(initial?.installationDate ?? null));
  const [lastOverhaulDate, setLastOverhaulDate] = useState(toDateInputValue(initial?.lastOverhaulDate ?? null));
  const [replacementDate, setReplacementDate] = useState(toDateInputValue(initial?.replacementDate ?? null));
  const [assetCodeTouched, setAssetCodeTouched] = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [expanded,    setExpanded]    = useState(true);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  // La excepción "no requiere plan" sólo tiene sentido en un equipo de criticidad
  // C que además no sea crítico para la seguridad. En un equipo A o B la decisión
  // de no hacerle preventivo no es defendible ante una auditoría, y en uno ISM
  // 10.3 el Código directamente no la admite (el backend la rechaza).
  const puedeEximirse = criticality === "C" && !isSafetyCritical;

  // Si el equipo deja de ser exceptuable (lo reclasifican a A/B o lo marcan ISM
  // 10.3), la excepción se cae con su motivo. Si no, quedaría marcada sin verse
  // en el formulario y el equipo seguiría fuera del cálculo de cobertura.
  useEffect(() => {
    if (!puedeEximirse && planNotRequired) {
      setPlanNotRequired(false);
      setPlanNotRequiredReason("");
    }
  }, [puedeEximirse, planNotRequired]);

  useCopilotEmitter({
    module: "ASSETS",
    screen: isEdit ? "ASSET_EDIT" : "ASSET_CREATE",
    entityId: initial?.id,
    entityCode: initial?.assetCode,
    vesselCode: vesselCode || initial?.vesselCode,
    canEdit: true,
    fieldValues: {
      assetCode:    assetCode    || null,
      name:         name         || null,
      criticality:  criticality  || null,
      status:       status       || null,
      manufacturer: manufacturer || null,
      model:        model        || null,
      serialNumber: serialNumber || null,
    },
  });

  const nameOptions = useMemo<AssetNameOption[]>(() => {
    if (!selectedGroup) return [];

    const grouped = new Map<string, Map<string, number>>();
    for (const asset of tenantAssets) {
      if ((asset.sfiCode?.trim()?.[0] ?? "") !== selectedGroup) continue;
      const normalizedName = asset.name.trim();
      const normalizedCode = asset.assetCode.trim().toUpperCase();
      if (!normalizedName || !normalizedCode) continue;
      const codes = grouped.get(normalizedName) ?? new Map<string, number>();
      codes.set(normalizedCode, (codes.get(normalizedCode) ?? 0) + 1);
      grouped.set(normalizedName, codes);
    }

    const options = [...grouped.entries()].map(([normalizedName, codes]) => {
      const sortedCodes = [...codes.entries()].sort((a, b) => {
        if (a[1] !== b[1]) return b[1] - a[1];
        return a[0].localeCompare(b[0]);
      });
      return {
        name: normalizedName,
        suggestedAssetCode: sortedCodes[0]?.[0] ?? "",
      };
    });

    if (initial?.name?.trim() && initial?.assetCode?.trim()) {
      const existing = options.find(option => option.name === initial.name.trim());
      if (!existing) {
        options.push({
          name: initial.name.trim(),
          suggestedAssetCode: initial.assetCode.trim().toUpperCase(),
        });
      }
    }

    return options.sort((a, b) => a.name.localeCompare(b.name));
  }, [initial?.assetCode, initial?.name, selectedGroup, tenantAssets]);

  const selectedNameOption = useMemo(() => {
    const normalized = name.trim().toLocaleLowerCase();
    if (!normalized) return null;
    return (
      nameOptions.find(option => option.name.trim().toLocaleLowerCase() === normalized) ?? null
    );
  }, [name, nameOptions]);

  const existingCodesForSelectedVessel = useMemo(() => {
    const vessel = vesselCode.trim().toUpperCase();
    const set = new Set<string>();
    if (!vessel) return set;
    for (const asset of tenantAssets) {
      if (asset.vesselCode.trim().toUpperCase() !== vessel) continue;
      if (isEdit && initial?.id && asset.id === initial.id) continue;
      const normalized = toAssetCodeToken(asset.assetCode);
      if (normalized) set.add(normalized);
    }
    return set;
  }, [initial?.id, isEdit, tenantAssets, vesselCode]);

  useEffect(() => {
    setVesselCode(initial?.vesselCode ?? defaultVesselCode ?? "");
    setAssetCode(initial?.assetCode ?? "");
    setName(initial?.name ?? "");
    setCriticality(initial?.criticality ?? "B");
    setCriticalityRationale(initial?.criticalityRationale ?? "");
    setStatus(initial?.status ?? "OPERATIONAL");
    setTrackDailyReport(initial?.trackDailyReport ?? false);
    setIsSafetyCritical(initial?.isSafetyCritical ?? false);
    setPlanNotRequired(initial?.planNotRequired ?? false);
    setPlanNotRequiredReason(initial?.planNotRequiredReason ?? "");
    setManufacturer(initial?.manufacturer ?? "");
    setModel(initial?.model ?? "");
    setSerialNumber(initial?.serialNumber ?? "");
    setInstallationDate(toDateInputValue(initial?.installationDate ?? null));
    setLastOverhaulDate(toDateInputValue(initial?.lastOverhaulDate ?? null));
    setReplacementDate(toDateInputValue(initial?.replacementDate ?? null));
    setAssetCodeTouched(false);
    setActionError(null);

    const existingSfi = initial?.sfiCode?.trim() ?? "";
    const firstDigit = existingSfi[0] ?? "";
    setSelectedGroup(/^[0-9]$/.test(firstDigit) ? firstDigit : "");
  }, [initial, defaultVesselCode]);

  const onGroupChanged = useCallback((groupValue: string) => {
    setSelectedGroup(groupValue);
    if (!isEdit) {
      setName("");
      setAssetCode("");
      setAssetCodeTouched(false);
    }
  }, [isEdit]);

  const onNameChanged = useCallback((nextName: string) => {
    setName(nextName);
    if (isEdit) return;
    const normalized = nextName.trim().toLocaleLowerCase();
    if (!normalized) {
      setAssetCode("");
      setAssetCodeTouched(false);
      return;
    }

    const suggested = buildFormattedAssetCode(vesselCode, selectedGroup, nextName, existingCodesForSelectedVessel);
    setAssetCode(suggested);
    setAssetCodeTouched(false);
  }, [existingCodesForSelectedVessel, isEdit, selectedGroup, vesselCode]);

  useEffect(() => {
    if (isEdit) return;
    if (!selectedGroup) return;
    if (!name.trim()) return;
    if (assetCodeTouched && assetCode.trim()) return;

    setAssetCode(buildFormattedAssetCode(vesselCode, selectedGroup, name, existingCodesForSelectedVessel));
  }, [
    assetCode,
    assetCodeTouched,
    existingCodesForSelectedVessel,
    isEdit,
    name,
    nameOptions,
    selectedGroup,
    vesselCode,
  ]);

  const onSave = useCallback(async () => {
    if (!vesselCode.trim() && !isEdit) {
      setActionError("Vessel es requerido.");
      return;
    }
    if (!assetCode.trim() && !isEdit) {
      setActionError("Asset Code es requerido.");
      return;
    }
    if (!selectedGroup) {
      setActionError(t("mp.selectSfiGroupRequired"));
      return;
    }
    if (!name.trim()) {
      setActionError("Debe seleccionar o indicar el nombre del asset.");
      return;
    }
    // Un equipo sin plan tiene que decir por qué: la excepción sin motivo es
    // exactamente lo que un auditor lee como olvido.
    if (puedeEximirse && planNotRequired && !planNotRequiredReason.trim()) {
      setActionError(t("asset.planNotRequiredReasonRequired"));
      return;
    }
    // ISM 10.3 no admite excepción: si es crítico para la seguridad, lleva plan.
    if (planNotRequired && isSafetyCritical) {
      setActionError(t("asset.planNotRequiredSafetyConflict"));
      return;
    }

    setSaving(true);
    setActionError(null);
    try {
      const vesselUpper = vesselCode.trim().toUpperCase();
      const codeUpper = assetCode.trim().toUpperCase();
      if (!isEdit) {
        const duplicated = tenantAssets.some(asset =>
          asset.vesselCode.trim().toUpperCase() === vesselUpper &&
          asset.assetCode.trim().toUpperCase() === codeUpper,
        );
        if (duplicated) {
          setActionError("Asset Code ya existe para este vessel. Se requiere uno único.");
          setSaving(false);
          return;
        }
      }

      const payload = {
        name: name.trim(),
        sfiCode: `${selectedGroup}00`,
        criticality,
        criticalityRationale: normalizeOptionalText(criticalityRationale),
        status,
        trackDailyReport,
        isSafetyCritical,
        // `puedeEximirse` de nuevo acá: si el equipo dejó de ser exceptuable en el
        // mismo guardado, no se manda la excepción aunque el estado no se haya
        // limpiado todavía.
        planNotRequired: puedeEximirse && planNotRequired,
        planNotRequiredReason: puedeEximirse && planNotRequired ? normalizeOptionalText(planNotRequiredReason) : null,
        manufacturer: normalizeOptionalText(manufacturer),
        model: normalizeOptionalText(model),
        serialNumber: normalizeOptionalText(serialNumber),
        installationDate: installationDate || null,
        lastOverhaulDate: lastOverhaulDate || null,
        replacementDate: replacementDate || null,
      };

      if (isEdit && initial) {
        await api.patch(`/app/pms/assets/${initial.id}`, {
          ...payload,
          ...(isAdmin ? { vesselCode: vesselUpper, assetCode: codeUpper } : {}),
        });
      } else {
        await api.post("/app/pms/assets", {
          vesselCode: vesselUpper,
          assetCode: codeUpper,
          ...payload,
        });
      }
      onSaved();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t("common.saveError"));
    } finally {
      setSaving(false);
    }
  }, [
    assetCode,
    criticality,
    criticalityRationale,
    initial,
    isAdmin,
    installationDate,
    isEdit,
    lastOverhaulDate,
    manufacturer,
    model,
    name,
    onSaved,
    replacementDate,
    selectedGroup,
    serialNumber,
    status,
    t,
    tenantAssets,
    trackDailyReport,
    isSafetyCritical,
    planNotRequired,
    planNotRequiredReason,
    vesselCode,
  ]);

  // Pedir sugerencia de criticidad + ISM a la IA (un solo análisis combinado)
  const requestCriticalitySuggestion = useCallback(async () => {
    if (!name.trim() || suggestingCriticality) return;
    setSuggestingCriticality(true);
    setActionError(null);
    try {
      const result = await api.post<{ criticality: "A" | "B" | "C"; isSafetyCritical: boolean; requiresMaintenancePlan?: boolean; rationale: string }>(
        "/app/pms/assets/suggest-criticality",
        {
          name: name.trim(),
          vesselCode: vesselCode || null,
          sfiCode: selectedGroup ? `${selectedGroup}00` : null,
          manufacturer: manufacturer || null,
          model: model || null,
          serialNumber: serialNumber || null,
        },
      );
      setCriticality(result.criticality);
      setIsSafetyCritical(result.isSafetyCritical);
      setCriticalityRationale(result.rationale);
      // La IA también dice si el equipo debe estar en el plan. Se propone la
      // excepción, con el fundamento como motivo; el usuario la puede destildar.
      const noLlevaPlan = result.requiresMaintenancePlan === false && !result.isSafetyCritical;
      setPlanNotRequired(noLlevaPlan);
      setPlanNotRequiredReason(noLlevaPlan ? result.rationale : "");
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "No se pudo obtener sugerencia.");
    } finally {
      setSuggestingCriticality(false);
    }
  }, [name, vesselCode, selectedGroup, manufacturer, model, serialNumber, suggestingCriticality]);

  // ESC guard
  const isDirty = useDirtyTracker({
    vesselCode, assetCode, selectedGroup, name, criticality, criticalityRationale, status,
    planNotRequired, planNotRequiredReason,
    manufacturer, model, serialNumber, trackDailyReport,
    installationDate, lastOverhaulDate, replacementDate,
  });
  const requestClose = useEscapeGuard({ isDirty, onSave: onSave, onClose });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className={`w-full bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl flex flex-col transition-all duration-200 ${expanded ? "w-full h-full" : "max-w-2xl max-h-[90vh]"}`} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-fg/10 shrink-0">
          <h2 className="text-base font-bold text-fg">{isEdit ? t("asset.editTitle") : t("asset.newTitle")}</h2>
          <div className="flex items-center gap-1">
            <button onClick={() => setExpanded(v => !v)} className="p-1.5 rounded-lg text-fg/30 hover:text-fg hover:bg-fg/5 transition-colors" title={expanded ? t("asset.collapse") : t("asset.expand")}>
              {expanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
            <ModalCloseButton onClose={requestClose} />
          </div>
        </div>
        <div className="p-6 space-y-4 flex-1 overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">{t("col.vessel")}</label>
              <select
                value={vesselCode}
                onChange={e => setVesselCode(e.target.value)}
                disabled={isEdit && !isAdmin}
                className="w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg focus:outline-none focus:border-accent/50 disabled:opacity-60"
              >
                <option value="">{t("asset.selectVessel")}</option>
                {vessels.map(vessel => (
                  <option key={vessel.code} value={vessel.code}>
                    {vessel.code} - {vessel.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">{t("asset.code")}</label>
              <input
                value={assetCode}
                onChange={e => {
                  setAssetCode(e.target.value.toUpperCase());
                  setAssetCodeTouched(true);
                }}
                disabled={(isEdit && !isAdmin) || (!isEdit && Boolean(selectedNameOption))}
                className="w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 disabled:opacity-60"
              />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">{t("mp.sfiGroup")}</label>
              <select
                value={selectedGroup}
                onChange={e => onGroupChanged(e.target.value)}
                className="w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg focus:outline-none focus:border-accent/50"
              >
                <option value="">{t("mp.selectSfiGroup")}</option>
                {SFI_GROUP_NUMBERS.map(g => (
                  <option key={g} value={String(g)}>
                    {g} - {t(`sfi.g.${g}` as Parameters<typeof t>[0])}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">
                {t("col.name")}
              </label>
              {nameOptions.length > 0 && (
                <select
                  value={selectedNameOption?.name ?? ""}
                  onChange={e => onNameChanged(e.target.value)}
                  disabled={!selectedGroup}
                  className="w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg focus:outline-none focus:border-accent/50 disabled:opacity-60"
                >
                  <option value="">{t("asset.selectExistingName")}</option>
                  {nameOptions.map(option => (
                    <option key={`${option.name}-${option.suggestedAssetCode}`} value={option.name}>
                      {option.name}
                    </option>
                  ))}
                </select>
              )}
              <input
                value={name}
                onChange={e => onNameChanged(e.target.value)}
                disabled={!selectedGroup}
                placeholder={nameOptions.length > 0 ? t("asset.namePlaceholderEdit") : t("asset.namePlaceholderNew")}
                className="w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 disabled:opacity-60"
              />
            </div>

            <div className="space-y-1.5">
              <button
                type="button"
                onClick={() => { void requestCriticalitySuggestion(); }}
                disabled={!name.trim() || suggestingCriticality}
                title={!name.trim() ? t("asset.suggestCritNeedsName") : t("asset.suggestCritTitle")}
                className="flex items-center gap-1.5 text-xs font-semibold text-accent uppercase tracking-wider hover:text-fg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {suggestingCriticality
                  ? <Loader2 className="w-3 h-3 animate-spin" />
                  : <Sparkles className="w-3 h-3" />}
                {t("col.criticality")}
              </button>
              <select
                value={criticality}
                onChange={e => setCriticality(e.target.value)}
                className="w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg focus:outline-none focus:border-accent/50"
              >
                <option value="A">A</option>
                <option value="B">B</option>
                <option value="C">C</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">{t("col.status")}</label>
              <select
                value={status}
                onChange={e => setStatus(e.target.value)}
                className="w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg focus:outline-none focus:border-accent/50"
              >
                <option value="OPERATIONAL">OPERATIONAL</option>
                <option value="DEGRADED">DEGRADED</option>
                <option value="OUT_OF_SERVICE">OUT_OF_SERVICE</option>
              </select>
            </div>
            {/* ISM safety-critical (ISM Code 10.3) — el flag se sugiere desde el botón "Criticidad (IA)" */}
            <div className="space-y-1.5 col-span-2 bg-fg/3 border border-fg/8 rounded-xl px-4 py-3">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isSafetyCritical}
                  onChange={e => setIsSafetyCritical(e.target.checked)}
                  className="w-4 h-4 accent-accent"
                />
                <span className="text-sm text-fg">
                  {t("asset.safetyCritical")} <span className="text-text-industrial/60">(ISM 10.3)</span>
                </span>
              </label>
            </div>

            {/* Excepción declarada: equipo que no lleva plan de mantenimiento. Sin
                esta marca, un equipo sin plan se cuenta como brecha de cobertura
                (TMSA 4.1.1 / ISM 10.1) aunque la decisión esté tomada.
                Sólo se ofrece en equipos de criticidad C que no sean ISM 10.3:
                en el resto no corresponde y sólo ensucia el formulario. */}
            {puedeEximirse && (
              <div className="space-y-1.5 col-span-2 bg-fg/3 border border-fg/8 rounded-xl px-4 py-3">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={planNotRequired}
                    onChange={e => setPlanNotRequired(e.target.checked)}
                    className="w-4 h-4 accent-accent"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-fg">{t("asset.planNotRequired")}</p>
                    <p className="text-xs text-text-industrial/50">{t("asset.planNotRequiredHint")}</p>
                  </div>
                </label>
                {planNotRequired && (
                  <AutoTextArea
                    value={planNotRequiredReason}
                    onChange={e => setPlanNotRequiredReason(e.target.value)}
                    rows={2}
                    placeholder={t("asset.planNotRequiredReasonPh")}
                    className="w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 resize-y"
                  />
                )}
              </div>
            )}

            <div className="space-y-1.5 col-span-2">
              <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">{t("asset.critRationale")}</label>
              <AutoTextArea
                value={criticalityRationale}
                onChange={e => setCriticalityRationale(e.target.value)}
                rows={3}
                placeholder={t("asset.critRationalePh")}
                className="w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 resize-y"
              />
            </div>
            <label className="flex items-center gap-3 bg-fg/3 border border-fg/8 rounded-xl px-4 py-3 cursor-pointer hover:bg-fg/5 transition-colors">
              <input
                type="checkbox"
                checked={trackDailyReport}
                onChange={e => setTrackDailyReport(e.target.checked)}
                className="w-4 h-4 rounded accent-accent shrink-0"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-fg font-medium">{t("asset.hoursTracking")}</p>
                <p className="text-xs text-text-industrial/50">{t("asset.hoursTrackingHint")}</p>
              </div>
              {currentHours != null && (
                <div className="shrink-0 text-right">
                  <p className="text-[10px] text-text-industrial/40 uppercase tracking-wider">{t("asset.accumulatedHours")}</p>
                  <p className="font-mono text-base font-bold text-accent leading-tight">{Number(currentHours).toLocaleString()}h</p>
                  {currentHoursDate && (
                    <p className="text-[10px] text-text-industrial/40 leading-tight">
                      {currentHoursDate}
                      {currentHoursSource === "MANUAL" ? ` · ${t("assetHours.source.manual")}`
                        : currentHoursSource === "VOYAGE_TANK_REPORT" ? ` · ${t("assetHours.source.voyage")}`
                        : currentHoursSource === "DAILY_REPORT" ? ` · ${t("assetHours.source.daily")}` : ""}
                    </p>
                  )}
                </div>
              )}
            </label>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">{t("col.manufacturer")}</label>
              <input
                value={manufacturer}
                onChange={e => setManufacturer(e.target.value)}
                className="w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">{t("col.model")}</label>
              <input
                value={model}
                onChange={e => setModel(e.target.value)}
                className="w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">Serial</label>
              <input
                value={serialNumber}
                onChange={e => setSerialNumber(e.target.value)}
                className="w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">Installation</label>
              <input
                type="date"
                value={installationDate}
                onChange={e => setInstallationDate(e.target.value)}
                className="w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">Last Overhaul</label>
              <input
                type="date"
                value={lastOverhaulDate}
                onChange={e => setLastOverhaulDate(e.target.value)}
                className="w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">Replacement</label>
              <input
                type="date"
                value={replacementDate}
                onChange={e => setReplacementDate(e.target.value)}
                className="w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50"
              />
            </div>
          </div>
          {isEdit && initial?.id && <AssetMaintenancePlans asset={initial} />}
          {isEdit && initial?.id && <AssetHistory asset={initial} />}
          {actionError && <p className="text-xs text-red-700 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{actionError}</p>}
        </div>
        <div className="flex items-center justify-between gap-2 px-6 py-4 border-t border-fg/10">
          <div>
            {isEdit && initial && (
              <button
                onClick={async () => {
                  setDownloadingPdf(true);
                  setActionError(null);
                  try {
                    await downloadAssetPdf(initial);
                  } catch (err) {
                    setActionError(err instanceof ApiError ? err.message : t("asset.pdfError"));
                  } finally {
                    setDownloadingPdf(false);
                  }
                }}
                disabled={downloadingPdf}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-fg/5 border border-fg/10 text-xs text-text-industrial hover:border-accent/30 hover:text-fg disabled:opacity-50 transition-all"
              >
                {downloadingPdf ? <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" /> : <FileDown className="w-3.5 h-3.5 text-accent" />}
                {t("asset.downloadPdf")}
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-fg transition-colors">{t("common.cancel")}</button>
            <button onClick={() => { void onSave(); }} disabled={saving} className="px-4 py-2 rounded-xl bg-accent text-accent-fg font-bold text-xs hover:brightness-110 disabled:opacity-50 transition-all">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : t("common.save")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

interface DeleteAssetModalProps {
  asset: Asset;
  onClose: () => void;
  onDeleted: () => void;
}

const DeleteAssetModal: React.FC<DeleteAssetModalProps> = ({ asset, onClose, onDeleted }) => {
  const t = useT();
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const onDelete = useCallback(async () => {
    setDeleting(true);
    setActionError(null);
    try {
      await api.delete(`/app/pms/assets/${asset.id}`);
      onDeleted();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t("common.deleteError"));
      setDeleting(false);
    }
  }, [asset.id, onDeleted, t]);

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-fg/10">
          <h2 className="text-base font-bold text-fg">{t("common.delete")}</h2>
          <ModalCloseButton onClose={onClose} />
        </div>
        <div className="p-6 space-y-4">
          <p className="text-sm text-text-industrial/70">
            ¿Eliminar asset <span className="text-fg font-semibold">{asset.assetCode}</span> ({asset.name})?
          </p>
          {actionError && <p className="text-xs text-red-700 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{actionError}</p>}
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-fg/10">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-fg transition-colors">{t("common.cancel")}</button>
          <button onClick={() => { void onDelete(); }} disabled={deleting} className="px-4 py-2 rounded-xl bg-red-500/80 text-fg font-bold text-xs hover:bg-red-500 disabled:opacity-50 transition-all">
            {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : t("common.delete")}
          </button>
        </div>
      </div>
    </div>
  );
};

export const AssetsPage: React.FC = () => {
  const t = useT();
  const { user } = useAuth();
  const { selectedVesselCode } = useVesselContext();
  const isAdmin = user?.role === "TENANT_ADMIN";
  const [searchParams, setSearchParams] = useSearchParams();
  const [showExcel, setShowExcel] = useState(false);
  const [editing, setEditing] = useState<Asset | null | undefined>(undefined);

  useCopilotEmitter(editing === undefined ? { module: "ASSETS", screen: "ASSET_LIST" } : null);
  const [deleteTarget, setDeleteTarget] = useState<Asset | null>(null);
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [sfiTab, setSfiTab] = useState<"ALL" | number | "NONE" | "ISM">("ALL");
  const [viewMode, setViewMode] = useState<"list" | "board">("list");

  const statusFilter = (searchParams.get("status") ?? "").trim();
  const criticalityFilter = (searchParams.get("criticality") ?? "").trim();
  const vesselFilter = (searchParams.get("vesselCode") ?? "").trim();
  const openAssetId = (searchParams.get("open") ?? "").trim();
  const tmsaFilter = useTmsaFilter();
  const [searchText, setSearchText] = useState("");

  const updateFilters = useCallback((next: { status?: string; criticality?: string; vesselCode?: string }) => {
    const params = new URLSearchParams(searchParams);
    const nextStatus = next.status !== undefined ? next.status : statusFilter;
    const nextCriticality = next.criticality !== undefined ? next.criticality : criticalityFilter;
    const nextVessel = next.vesselCode !== undefined ? next.vesselCode : vesselFilter;
    if (nextStatus) params.set("status", nextStatus); else params.delete("status");
    if (nextCriticality) params.set("criticality", nextCriticality); else params.delete("criticality");
    if (nextVessel) params.set("vesselCode", nextVessel); else params.delete("vesselCode");
    setSearchParams(params, { replace: true });
  }, [criticalityFilter, searchParams, setSearchParams, statusFilter, vesselFilter]);

  const path = useMemo(() => {
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    if (criticalityFilter) params.set("criticality", criticalityFilter);
    if (vesselFilter) params.set("vesselCode", vesselFilter);
    const query = params.toString();
    return `/app/pms/assets${query ? `?${query}` : ""}`;
  }, [criticalityFilter, statusFilter, vesselFilter]);

  const { data, loading, error, reload } = useFetch<ListResponse>(path, [path]);
  // Reuse VesselContext instead of re-fetching /app/vessels.
  const { vessels: contextVessels } = useVesselContext();
  const { data: tenantAssetsData, reload: reloadTenantAssets } = useFetch<ListResponse>("/app/pms/assets", ["/app/pms/assets"]);

  const openEdit = useCallback(async (row: Asset) => {
    setDetailLoadingId(row.id);
    try {
      const detailed = await api.get<Asset>(`/app/pms/assets/${row.id}`);
      setEditing(detailed);
    } catch {
      setEditing(row);
    } finally {
      setDetailLoadingId(null);
    }
  }, []);

  // Auto-open asset modal when arriving from an "ACTIVO" click (e.g. plan modal)
  useEffect(() => {
    if (!openAssetId) return;
    setDetailLoadingId(openAssetId);
    api.get<Asset>(`/app/pms/assets/${openAssetId}`)
      .then(detailed => setEditing(detailed))
      .catch(() => {})
      .finally(() => setDetailLoadingId(null));
    const params = new URLSearchParams(searchParams);
    params.delete("open");
    setSearchParams(params, { replace: true });
  }, [openAssetId, searchParams, setSearchParams]);

  const onDeleteRequested = useCallback((row: Asset) => {
    setDeleteTarget(row);
  }, []);

  const onDeleted = useCallback(() => {
    setDeleteTarget(null);
    void reload();
    void reloadTenantAssets();
  }, [reload, reloadTenantAssets]);

  const filteredAssets = useMemo(() => {
    let items = data?.items ?? null;
    if (!items) return items;
    // Cuando se llega desde una métrica del panel TMSA, la planilla muestra
    // exactamente los activos que contó esa tarjeta.
    items = applyTmsaFilter(items, tmsaFilter, a => a.id);
    if (!items) return items;
    if (sfiTab === "ISM") items = items.filter(a => a.isSafetyCritical);
    else if (sfiTab !== "ALL") items = items.filter(a => sfiTabOfCode(a.sfiCode) === sfiTab);
    if (searchText.trim()) {
      const q = searchText.trim().toLowerCase();
      items = items.filter(a =>
        a.assetCode?.toLowerCase().includes(q) ||
        a.name?.toLowerCase().includes(q) ||
        a.vesselCode?.toLowerCase().includes(q) ||
        a.sfiCode?.toLowerCase().includes(q) ||
        (a as any).description?.toLowerCase().includes(q) ||
        (a as any).manufacturer?.toLowerCase().includes(q) ||
        (a as any).model?.toLowerCase().includes(q) ||
        (a as any).serialNumber?.toLowerCase().includes(q)
      );
    }
    return items;
  }, [data, sfiTab, searchText, tmsaFilter]);

  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const a of data?.items ?? []) {
      const k = String(sfiTabOfCode(a.sfiCode));
      counts[k] = (counts[k] ?? 0) + 1;
    }
    return counts;
  }, [data]);

  const columns: Column<Asset>[] = useMemo(() => [
    { key: "assetCode", header: t("col.code"), render: row => <span className="font-mono font-bold text-fg text-xs">{row.assetCode}</span> },
    {
      key: "name",
      header: t("col.name"),
      render: row => (
        <div className="flex items-center gap-2">
          <span className="font-medium text-fg line-clamp-1">{row.name}</span>
          {row.isSafetyCritical && (
            <span title={`${t("asset.safetyCritical")} (ISM 10.3)`} className="inline-flex items-center text-amber-700 dark:text-amber-400">
              <ShieldAlert className="w-3.5 h-3.5" />
            </span>
          )}
        </div>
      ),
    },
    { key: "vesselCode", header: t("col.vessel"), render: row => <VesselLabel code={row.vesselCode} className="text-xs" showCode /> },
    { key: "sfiCode", header: t("col.sfiCode"), render: row => row.sfiCode ?? "—" },
    { key: "criticality", header: t("col.criticality"), render: row => row.criticality },
    { key: "status", header: t("col.status"), render: row => <StatusBadge status={row.status} /> },
    {
      key: "actions",
      header: "",
      sortable: false,
      render: row => (
        <button
          onClick={e => {
            e.stopPropagation();
            onDeleteRequested(row);
          }}
          className="p-1.5 rounded-lg text-text-industrial/30 hover:text-red-400 hover:bg-red-500/10 transition-all"
          title={t("common.delete")}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      ),
    },
  ], [onDeleteRequested, t]);

  return (
    <div className="space-y-5">
      {showExcel && <ExcelPanel module="assets" onClose={() => { setShowExcel(false); reload(); }} />}
      {editing !== undefined && (
        <AssetModal
          initial={editing}
          defaultVesselCode={selectedVesselCode}
          vessels={contextVessels}
          tenantAssets={tenantAssetsData?.items ?? []}
          isAdmin={isAdmin}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            void reload();
            void reloadTenantAssets();
          }}
        />
      )}
      {deleteTarget && <DeleteAssetModal asset={deleteTarget} onClose={() => setDeleteTarget(null)} onDeleted={onDeleted} />}
      <PageHeader icon={Settings} title={t("page.assets")} total={filteredAssets?.length ?? data?.total} onReload={reload}>
        <div className="flex items-center gap-0.5 border border-fg/10 rounded-lg p-0.5">
          <button
            type="button"
            onClick={() => setViewMode("list")}
            title={t("asset.viewList")}
            className={`p-1.5 rounded-md transition-colors ${viewMode === "list" ? "bg-fg/10 text-fg" : "text-text-industrial/40 hover:text-fg"}`}
          >
            <List className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => { setViewMode("board"); if (sfiTab !== "ALL" && sfiTab !== "ISM") setSfiTab("ALL"); }}
            title={t("asset.viewBoard")}
            className={`p-1.5 rounded-md transition-colors ${viewMode === "board" ? "bg-fg/10 text-fg" : "text-text-industrial/40 hover:text-fg"}`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
          </button>
        </div>
        <button onClick={() => setEditing(null)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-accent-fg font-bold text-xs hover:brightness-110 transition-all">
          <Plus className="w-3.5 h-3.5" /> {t("common.new")}
        </button>
        <button onClick={() => setShowExcel(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-fg/5 border border-fg/10 text-xs text-text-industrial hover:border-accent/30 transition-all">
          <FileSpreadsheet className="w-3.5 h-3.5 text-accent" /> Excel
        </button>
        <select value={toFilterSelectValue(statusFilter)} onChange={e => updateFilters({ status: fromFilterSelectValue(e.target.value) })} className="bg-fg/5 border border-fg/10 rounded-lg px-3 py-1.5 text-xs text-text-industrial focus:outline-none focus:border-accent/50">
          <option value={FILTER_ALL_VALUE}>{t("status.all")}</option>
          <option value="OPERATIONAL">OPERATIONAL</option>
          <option value="DEGRADED">DEGRADED</option>
          <option value="OUT_OF_SERVICE">OUT_OF_SERVICE</option>
        </select>
        <select value={toFilterSelectValue(criticalityFilter)} onChange={e => updateFilters({ criticality: fromFilterSelectValue(e.target.value) })} className="bg-fg/5 border border-fg/10 rounded-lg px-3 py-1.5 text-xs text-text-industrial focus:outline-none focus:border-accent/50">
          <option value={FILTER_ALL_VALUE}>{t("status.all")}</option>
          <option value="A">A</option>
          <option value="B">B</option>
          <option value="C">C</option>
        </select>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-text-industrial/40 pointer-events-none" />
            <input
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              placeholder="Buscar por código, nombre, buque, SFI..."
              className="w-64 pl-7 bg-fg/5 border border-fg/10 rounded-lg px-3 py-1.5 text-xs text-text-industrial placeholder-text-industrial/30 focus:outline-none focus:border-accent/50"
            />
          </div>
          {(statusFilter || criticalityFilter || vesselFilter || searchText) && (
            <button onClick={() => { updateFilters({ status: "", criticality: "", vesselCode: "" }); setSearchText(""); }} className="px-3 py-1.5 rounded-lg bg-fg/5 border border-fg/10 text-xs text-text-industrial/80 hover:text-fg hover:border-red-400/40 transition-all">{t("common.clear")}</button>
          )}
        </div>
      </PageHeader>

      {/* SFI group tab bar — en el tablero los chips de grupo sobran (cada grupo
          ya es una columna) y elegir uno dejaría nueve columnas vacías. El chip
          ISM 10.3 sí se mantiene: filtra a lo ancho de todas las columnas. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {viewMode === "list" && SFI_TABS.map(tab => {
          const count = tab.key === "ALL"
            ? (data?.items.length ?? 0)
            : (tabCounts[String(tab.key)] ?? 0);
          const isActive = sfiTab === tab.key;
          if (tab.key !== "ALL" && count === 0 && !isActive) return null;
          return (
            <button
              key={String(tab.key)}
              onClick={() => setSfiTab(tab.key)}
              className={[
                "px-3 py-1 rounded-lg text-xs font-semibold border transition-all whitespace-nowrap",
                isActive
                  ? "bg-accent text-accent-fg border-accent"
                  : "bg-fg/5 border-fg/10 text-text-industrial/60 hover:text-fg hover:border-fg/20",
              ].join(" ")}
            >
              {/* Nombre completo del grupo, igual que en Planes de Mantenimiento:
                  "G7" solo no dice nada si no te sabés la numeración SFI. */}
              {tab.key === "ALL"
                ? tab.label
                : <>{tab.label} <span className="font-semibold">{t(`sfi.g.${tab.key}` as Parameters<typeof t>[0])}</span></>}
              {count > 0 && <span className="ml-1.5 opacity-70">({count})</span>}
            </button>
          );
        })}
        {/* ISM 10.3 — equipos críticos para seguridad */}
        {(() => {
          const ismCount = (data?.items ?? []).filter(a => a.isSafetyCritical).length;
          if (ismCount === 0) return null;
          const isActive = sfiTab === "ISM";
          return (
            <button
              onClick={() => setSfiTab("ISM")}
              title="Equipos críticos para seguridad (ISM Code 10.3)"
              className={[
                "flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold border transition-all whitespace-nowrap",
                isActive
                  ? "bg-amber-500 text-accent-fg border-amber-500"
                  : "bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-400 hover:bg-amber-500/20 hover:border-amber-500/50",
              ].join(" ")}
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              ISM 10.3 <span className="opacity-70">({ismCount})</span>
            </button>
          );
        })()}
      </div>

      <TmsaFilterBanner filter={tmsaFilter} shown={filteredAssets?.length ?? 0} total={data?.items?.length ?? 0} />
      {detailLoadingId && <div className="flex items-center gap-2 text-xs text-text-industrial/60"><Loader2 className="w-4 h-4 animate-spin text-accent" />Cargando detalle del asset...</div>}
      {viewMode === "list"
        ? <DataTable columns={columns} data={filteredAssets} loading={loading} error={error} keyFn={row => row.id} emptyText={t("empty.assets")} onRowClick={row => { void openEdit(row); }} />
        : <AssetsBoard assets={filteredAssets} loading={loading} onOpen={row => { void openEdit(row); }} t={t} />}
    </div>
  );
};
