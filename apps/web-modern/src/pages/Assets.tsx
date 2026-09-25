import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertOctagon, AlertTriangle, CalendarCheck, CalendarPlus, CalendarX, ChevronRight, Clock, FileDown, FileMinus, FileSpreadsheet, FlaskConical, Gauge, LayoutGrid, List, ListTree,
  Loader2, Package, Plus, PowerOff, Save, Search, Settings, ShieldAlert, Ship, Sparkles, Trash2, X,
} from "lucide-react";
import { useFetch } from "../lib/hooks";
import { api, ApiError } from "../lib/api";
import { DataTable, StatusBadge, type Column } from "../components/DataTable";
import { PageHeader } from "../components/PageHeader";
import { ModalCloseButton } from "../components/ModalCloseButton";
import { ExcelPanel } from "../components/ExcelPanel";
import { useT, type TranslationKey } from "../lib/i18n";
import { useAuth, useCan } from "../lib/auth";
import { useCopilotEmitter } from "../lib/copilot-context";
import { useEscapeGuard, useDirtyTracker } from "../lib/escape-guard";
import { useVesselContext } from "../lib/vessel-context";
import { useTmsaFilter, applyTmsaFilter, TmsaFilterBanner } from "../lib/tmsa-filter";
import { MaintenancePlanModal, type MaintenancePlan } from "./MaintenancePlans";
import { AutoTextArea } from "../components/AutoTextArea";
import { textMatches } from "../lib/text-search";
import { AlertDialog } from "../components/AlertDialog";
import { GuideSection, GuideField, GuideNeedTag, GuidePill, RequiredMark } from "../components/GuideKit";
import type { FluidSample } from "../components/fluid-analyses/shared";
import { AssetHealthReportModal, HEALTH_STATE_STYLE, type HealthReportSummary } from "../components/assets/AssetHealthReportModal";
import { fmtDate } from "../lib/utils";

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
  /** ISM 10.3 — el equipo no está en uso continuo: está de reserva. */
  isStandby?: boolean;
  /** Cuál de sus planes es la prueba periódica de ese equipo de reserva. */
  standbyTestPlanId?: string | null;
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

/** Defecto y muestra de fluidos, lo justo para los nexos del equipo. */
interface AssetDefectLite { id: string; defectCode: string; assetId: string | null; status: string; severity: string; description: string; reportedAt: string }
type AssetFluidLite = Pick<FluidSample, "id" | "sampleCode" | "sampledAt" | "status" | "result">;

const ASSET_CRIT_CHIP: Record<string, string> = { A: "bg-red-700 text-white", B: "bg-amber-500/15 text-amber-800 dark:text-amber-300", C: "bg-fg/5 text-text-industrial/60" };

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
function AssetBoardCard({ asset, onOpen, safetyTitle, critTitle, statusLabel }: {
  asset: Asset;
  onOpen: (a: Asset) => void;
  safetyTitle: string;
  critTitle: string;
  statusLabel: string;
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
          {statusLabel}
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
    return <div className="flex items-center gap-2 text-xs text-text-industrial/60"><Loader2 className="w-4 h-4 animate-spin text-accent" />{t("common.loading")}</div>;
  }

  // Sólo se muestran los grupos que tienen equipos: una columna vacía no aporta
  // nada y gasta ancho de pantalla, que es justo lo escaso acá. Como el buque
  // seleccionado cambia qué grupos tienen equipos, el tablero se reacomoda solo.
  // (Incluye "sin grupo SFI", que además es un caso de datos incompletos.)
  const cols = [
    ...BOARD_GROUP_NUMBERS.map(g => ({ key: g as number | "NONE", label: `G${g}`, name: t(`sfi.g.${g}` as Parameters<typeof t>[0]) })),
    { key: "NONE" as const, label: "—", name: t("gantt.noSfiGroup") },
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
                    statusLabel={t(`asset.v23.st.${a.status}` as TranslationKey)}
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

const AssetMaintenancePlans: React.FC<{ asset: Asset; newRequestKey?: number; onChanged?: () => void }> = ({ asset, newRequestKey = 0, onChanged }) => {
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
  // "Armar plan" del aviso de arriba abre la tarea nueva acá.
  useEffect(() => { if (newRequestKey > 0) setEditingPlan(null); }, [newRequestKey]);

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
          canEditMilestones={role === "TENANT_ADMIN"}
          overlayZClass="z-[60]"
          defaultVesselCode={asset.vesselCode}
          defaultAssetId={asset.id}
          defaultSfiGroupNumber={sfiGroupNumber}
          lockAsset
          onClose={() => setEditingPlan(undefined)}
          onSaved={async () => { await reload(); onChanged?.(); }}
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
  /** Pide la baja (abre la confirmación en la página). */
  onDeleteRequest?: (a: Asset) => void;
  /** Llega desde el asesor técnico (?salud=1): abre el informe de salud del equipo. */
  openHealth?: boolean;
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
  onDeleteRequest,
  openHealth,
}) => {
  const t = useT();
  const can = useCan();
  const navigate = useNavigate();
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

  // Informe de salud (Preview V43): generan DPA y Superintendente; lo ven además
  // Capitán / Jefe de Máquinas. El historial se pide sólo si el rol puede verlo.
  const canGenerateHealth = can("assetHealth.generate");
  const canViewHealth = canGenerateHealth || can("assetHealth.view");
  const [healthItems, setHealthItems] = useState<HealthReportSummary[]>([]);
  const [healthOpen, setHealthOpen] = useState(!!openHealth);
  useEffect(() => {
    if (!initial?.id || !canViewHealth) return;
    let alive = true;
    api.get<{ items: HealthReportSummary[] }>(`/app/pms/assets/${initial.id}/health-reports`)
      .then(res => { if (alive) setHealthItems(res.items ?? []); })
      .catch(() => { /* sin historial: el botón queda en "generar" o no aparece */ });
    return () => { alive = false; };
  }, [initial?.id, canViewHealth]);

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
  const [isStandby, setIsStandby] = useState(initial?.isStandby ?? false);
  const [standbyTestPlanId, setStandbyTestPlanId] = useState(initial?.standbyTestPlanId ?? "");
  const [installationDate, setInstallationDate] = useState(toDateInputValue(initial?.installationDate ?? null));
  const [lastOverhaulDate, setLastOverhaulDate] = useState(toDateInputValue(initial?.lastOverhaulDate ?? null));
  const [replacementDate, setReplacementDate] = useState(toDateInputValue(initial?.replacementDate ?? null));
  const [assetCodeTouched, setAssetCodeTouched] = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
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

  // ISM 10.3 — "de reserva" y su prueba periódica sólo existen dentro del
  // universo de equipos críticos para la seguridad. Si se destilda ese flag, las
  // dos marcas se caen (el backend hace lo mismo, esto es para que el formulario
  // muestre lo que se va a guardar).
  useEffect(() => {
    if (!isSafetyCritical && isStandby) {
      setIsStandby(false);
      setStandbyTestPlanId("");
    }
  }, [isSafetyCritical, isStandby]);

  // Tareas del equipo, para elegir cuál es la prueba periódica. Sólo se piden
  // cuando hacen falta: equipo ya existente marcado como de reserva.
  const standbyPlansFetch = useFetch<{ items: MaintenancePlan[] }>(
    isEdit && initial?.id && isSafetyCritical && isStandby
      ? `/app/pms/maintenance-plans?assetId=${encodeURIComponent(initial.id)}`
      : null,
    [initial?.id, isEdit, isSafetyCritical, isStandby],
  );
  const standbyPlanOptions = useMemo(
    () => (standbyPlansFetch.data?.items ?? []).filter(pl => pl.status === "ACTIVE"),
    [standbyPlansFetch.data],
  );

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
    setIsStandby(initial?.isStandby ?? false);
    setStandbyTestPlanId(initial?.standbyTestPlanId ?? "");
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
      setActionError(t("error.vesselRequired"));
      return;
    }
    if (!assetCode.trim() && !isEdit) {
      setActionError(t("asset.v23.codeRequired"));
      return;
    }
    if (!selectedGroup) {
      setActionError(t("mp.selectSfiGroupRequired"));
      return;
    }
    if (!name.trim()) {
      setActionError(t("asset.v23.nameRequired"));
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
          setActionError(t("asset.v23.codeDuplicated"));
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
        isStandby: isSafetyCritical && isStandby,
        standbyTestPlanId: isSafetyCritical && isStandby ? (standbyTestPlanId || null) : null,
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
    isStandby,
    planNotRequired,
    planNotRequiredReason,
    standbyTestPlanId,
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
      setActionError(err instanceof ApiError ? err.message : t("asset.v23.suggestError"));
    } finally {
      setSuggestingCriticality(false);
    }
  }, [name, vesselCode, selectedGroup, manufacturer, model, serialNumber, suggestingCriticality, t]);

  // ESC guard
  const isDirty = useDirtyTracker({
    vesselCode, assetCode, selectedGroup, name, criticality, criticalityRationale, status,
    planNotRequired, planNotRequiredReason,
    manufacturer, model, serialNumber, trackDailyReport,
    installationDate, lastOverhaulDate, replacementDate,
  });
  const requestClose = useEscapeGuard({ isDirty, onSave: onSave, onClose });

  // ── Ventana del equipo (preview V23) ─────────────────────────────────────────
  // Nexos del equipo: tareas (para el aviso de "sin plan" y los repuestos),
  // defectos abiertos y la última muestra de fluidos. Sólo en edición.
  const [plansNewKey, setPlansNewKey] = useState(0);
  const relPlans = useFetch<{ items: MaintenancePlan[] }>(initial?.id ? `/app/pms/maintenance-plans?assetId=${encodeURIComponent(initial.id)}` : null, [initial?.id]);
  const relDefects = useFetch<{ items: AssetDefectLite[] }>(initial?.id ? `/app/pms/defects?assetId=${encodeURIComponent(initial.id)}` : null, [initial?.id]);
  const relFluids = useFetch<{ items: AssetFluidLite[] }>(initial?.id ? `/app/fluid-analyses?assetId=${encodeURIComponent(initial.id)}` : null, [initial?.id]);
  const activePlans = useMemo(() => (relPlans.data?.items ?? []).filter(p => p.status !== "INACTIVE"), [relPlans.data]);
  const overduePlans = activePlans.filter(p => p.status === "OVERDUE").length;
  const openDefects = (relDefects.data?.items ?? []).filter(d => d.status !== "RESOLVED" && d.status !== "CLOSED");
  const lastSample = [...(relFluids.data?.items ?? [])].sort((a, b) => b.sampledAt.localeCompare(a.sampledAt))[0] ?? null;
  const planSpares = useMemo(() => {
    const m = new Map<string, { label: string; qty: number; unit: string; tasks: number }>();
    for (const p of activePlans) {
      const lines = (p as unknown as { spares?: { spareId?: string | null; description?: string; quantity?: number; unit?: string }[] | null }).spares;
      if (!Array.isArray(lines)) continue;
      for (const l of lines) {
        const key = l?.spareId || l?.description || "";
        if (!key) continue;
        const cur = m.get(key) ?? { label: l.description || key, qty: 0, unit: l.unit ?? "", tasks: 0 };
        cur.qty += Number(l.quantity) || 0; cur.tasks += 1;
        m.set(key, cur);
      }
    }
    return [...m.values()];
  }, [activePlans]);
  const noPlanGap = isEdit && !relPlans.loading && relPlans.data != null && activePlans.length === 0 && criticality !== "C" && !planNotRequired;
  const canManageAsset = can("asset.manage");
  // Obligatorios (preview V24): lo mismo que valida onSave.
  const missReq = {
    vessel: !isEdit && !vesselCode.trim(),
    code: !isEdit && !assetCode.trim(),
    group: !selectedGroup,
    name: !name.trim(),
    exemptReason: puedeEximirse && planNotRequired && !planNotRequiredReason.trim(),
  };
  const missSec1 = Number(missReq.vessel) + Number(missReq.code) + Number(missReq.group) + Number(missReq.name);
  const missTotal = missSec1 + Number(missReq.exemptReason);
  const needTag = (on: boolean) => on ? <GuideNeedTag label={t("mp.guide.missing")} /> : null;

  const fl = "flex items-center gap-1.5 text-xs font-semibold text-text-industrial/70 mb-1.5";
  const inp = "w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 disabled:opacity-60";
  const box = (icon: React.ReactNode, title: string, right: React.ReactNode, body: React.ReactNode) => (
    <div className="rounded-2xl border border-fg/10 overflow-hidden">
      <h3 className="flex items-center gap-1.5 px-3 py-2.5 border-b border-fg/10 text-[13.5px] font-extrabold text-fg">{icon} {title}<span className="ml-auto text-[11px] font-semibold">{right}</span></h3>
      <div className="p-3 space-y-2">{body}</div>
    </div>
  );
  const rel = "w-full flex items-center gap-2 rounded-xl border border-fg/10 px-2.5 py-2 text-left text-xs hover:border-accent/40 transition-colors";
  const empty = (txt: string) => <p className="text-xs text-text-industrial/45">{txt}</p>;
  const vesselName = (code: string) => vessels.find(v => v.code === code)?.name || code;
  const statusTone: Record<string, string> = {
    OPERATIONAL: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    DEGRADED: "border-amber-500/35 bg-amber-500/10 text-amber-800 dark:text-amber-300",
    OUT_OF_SERVICE: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400",
  };
  const SEV_CLS: Record<string, string> = { CRITICAL: "bg-red-700 text-white", HIGH: "bg-orange-500/15 text-orange-700 dark:text-orange-300", MEDIUM: "bg-yellow-500/15 text-yellow-800 dark:text-yellow-300", LOW: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" };
  const SEV_KEY: Record<string, TranslationKey> = { LOW: "priority.low", MEDIUM: "priority.medium", HIGH: "priority.high", CRITICAL: "priority.critical" };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-6xl max-h-[92vh] bg-surface dark:bg-[#0D1B2A] border border-fg/10 border-t-4 border-t-sky-600 rounded-2xl shadow-2xl flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Encabezado */}
        <div className="flex items-start gap-3 px-4 sm:px-6 py-3 border-b border-fg/10 shrink-0">
          <span className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 bg-sky-500/15 text-sky-700 dark:text-sky-300"><Settings className="w-6 h-6" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-[10.5px] font-extrabold uppercase tracking-wider text-sky-700 dark:text-sky-400">
              {t("asset.v23.kicker")}{selectedGroup ? ` · ${selectedGroup} ${t(`sfi.g.${selectedGroup}` as TranslationKey)}` : ""}
            </p>
            <h2 className="text-lg font-black text-fg leading-tight truncate">{name.trim() || (isEdit ? t("asset.editTitle") : t("asset.newTitle"))}</h2>
            {(manufacturer.trim() || model.trim() || serialNumber.trim()) && (
              <p className="text-xs text-text-industrial/60 truncate">{[[manufacturer.trim(), model.trim()].filter(Boolean).join(" "), serialNumber.trim() && t("asset.v23.serialN").replace("{n}", serialNumber.trim())].filter(Boolean).join(" · ")}</p>
            )}
            {isEdit && initial && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className="rounded-full border border-fg/10 bg-fg/5 px-2 py-0.5 font-mono text-[11px] font-bold text-fg">{initial.assetCode}</span>
                {/* Nombre del buque, no el código. */}
                <span className="inline-flex items-center gap-1 rounded-full border border-fg/10 bg-fg/5 px-2 py-0.5 text-[11px] font-bold text-text-industrial/70"><Ship className="w-3 h-3" />{vesselName(initial.vesselCode)}</span>
                <span className={`rounded-md px-2 py-0.5 text-[10.5px] font-black ${ASSET_CRIT_CHIP[criticality] ?? ASSET_CRIT_CHIP.C}`}>{t("asset.v23.critN").replace("{c}", criticality)}</span>
                {isSafetyCritical && <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/15 px-2 py-0.5 text-[10.5px] font-extrabold text-violet-700 dark:text-violet-300"><ShieldAlert className="w-3 h-3" />ISM 10.3</span>}
                <span className={`rounded-full border px-2 py-0.5 text-[11px] font-extrabold ${statusTone[status] ?? statusTone.OPERATIONAL}`}>{t(`asset.v23.st.${status}` as TranslationKey)}</span>
              </div>
            )}
          </div>
          {/* Informe de salud: botón grande a la derecha del encabezado. */}
          {isEdit && initial && (canGenerateHealth || (canViewHealth && healthItems.length > 0)) && (() => {
            const last = healthItems[0];
            const generateStyle = canGenerateHealth;
            return (
              <button type="button" onClick={() => setHealthOpen(true)}
                className={`flex items-center gap-2.5 rounded-2xl px-3 sm:px-4 py-2 text-left shrink-0 transition-all ${
                  generateStyle
                    ? "bg-gradient-to-br from-violet-600 to-indigo-600 text-white shadow-lg shadow-indigo-500/25 hover:brightness-110"
                    : "border-[1.5px] border-violet-300 dark:border-violet-500/40 bg-surface text-fg hover:bg-violet-500/5"
                }`}>
                <span className={`w-9 h-9 rounded-xl flex items-center justify-center ${generateStyle ? "bg-white/20" : "bg-violet-500/15 text-violet-700 dark:text-violet-300"}`}>
                  <Sparkles className="w-5 h-5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-black leading-tight">
                    {!generateStyle ? t("asset.health.btnView") : last ? t("asset.health.btn") : t("asset.health.btnGenerate")}
                  </span>
                  <span className={`flex items-center gap-1 text-[11px] ${generateStyle ? "text-white/85" : "text-text-industrial/60"}`}>
                    {last && <span className={`inline-block w-2 h-2 rounded-full ${HEALTH_STATE_STYLE[last.healthState]?.dot ?? "bg-slate-400"}`} />}
                    {!last
                      ? t("asset.health.btnGenerateSub")
                      : generateStyle
                        ? t("asset.health.btnLast").replace("{date}", fmtDate(last.createdAt)).replace("{state}", t(`asset.health.state.${last.healthState}` as TranslationKey))
                        : t("asset.health.btnViewSub").replace("{date}", fmtDate(last.createdAt)).replace("{name}", last.createdByName ?? "—")}
                  </span>
                </span>
              </button>
            );
          })()}
          <ModalCloseButton onClose={requestClose} />
        </div>
        {healthOpen && initial && (
          <AssetHealthReportModal
            asset={{ id: initial.id, assetCode: initial.assetCode, name: initial.name ?? null }}
            vesselName={vesselName(initial.vesselCode)}
            canGenerate={canGenerateHealth}
            initialItems={healthItems}
            generateOnOpen={healthItems.length === 0}
            onClose={() => setHealthOpen(false)}
            onChanged={setHealthItems}
          />
        )}

        <div className="flex-1 min-h-0 overflow-y-auto">
          {/* Qué hacer ahora */}
          {noPlanGap ? (
            <div className="mx-4 sm:mx-6 mt-4 flex flex-wrap items-center gap-3 rounded-2xl border-[1.5px] border-red-400/60 bg-red-500/[0.07] px-3.5 py-3">
              <span className="w-10 h-10 rounded-xl flex items-center justify-center text-white shrink-0 bg-red-600"><CalendarX className="w-5 h-5" /></span>
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-black text-fg">{t("asset.v23.noPlanTitle")}</p>
                <p className="text-[12.5px] text-text-industrial/70">{t("asset.v23.noPlanDesc").replace("{c}", criticality)}</p>
              </div>
              {canManageAsset && (
                <button type="button" onClick={() => { setPlansNewKey(k => k + 1); document.getElementById("asset-plans")?.scrollIntoView({ behavior: "smooth" }); }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-orange-600 text-white text-xs font-bold hover:brightness-110">
                  <CalendarPlus className="w-3.5 h-3.5" /> {t("asset.v23.buildPlan")}
                </button>
              )}
            </div>
          ) : isEdit && openDefects.length > 0 ? (
            <div className="mx-4 sm:mx-6 mt-4 flex flex-wrap items-center gap-3 rounded-2xl border-[1.5px] border-amber-400/60 bg-amber-500/[0.07] px-3.5 py-3">
              <span className="w-10 h-10 rounded-xl flex items-center justify-center text-white shrink-0 bg-amber-600"><AlertOctagon className="w-5 h-5" /></span>
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-black text-fg">{t("asset.v23.defectsTitle").replace("{n}", String(openDefects.length))}</p>
                <p className="text-[12.5px] text-text-industrial/70">{t("asset.v23.defectsDesc")}</p>
              </div>
            </div>
          ) : null}

          <div className={`grid grid-cols-1 ${isEdit ? "lg:grid-cols-[1.3fr_1fr]" : ""} gap-4 px-4 sm:px-6 py-4`}>
            <div className="space-y-3 min-w-0">
              {/* 1 · Identificación */}
              <GuideSection n={1} title={t("asset.v23.sec1")} subtitle={t("asset.v23.sec1Sub")} open onToggle={() => { /* siempre abierto */ }}
                pill={<GuidePill missing={missSec1} completeLabel={t("mp.guide.complete")} missingOne={t("mp.guide.missingOne")} missingMany={t("mp.guide.missingMany")} />}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <GuideField id="as-f-vessel" missing={missReq.vessel}>
                    <label className={fl}>{t("col.vessel")}{!isEdit && <RequiredMark />}{needTag(missReq.vessel)}</label>
                    <select value={vesselCode} onChange={e => setVesselCode(e.target.value)} disabled={isEdit && !isAdmin} className={inp}>
                      <option value="">{t("asset.selectVessel")}</option>
                      {vessels.map(vessel => <option key={vessel.code} value={vessel.code}>{vessel.name || vessel.code}</option>)}
                    </select>
                  </GuideField>
                  <GuideField id="as-f-code" missing={missReq.code}>
                    <label className={fl}>{t("asset.code")}{!isEdit && <RequiredMark />}{needTag(missReq.code)}</label>
                    <input value={assetCode} onChange={e => { setAssetCode(e.target.value.toUpperCase()); setAssetCodeTouched(true); }}
                      disabled={(isEdit && !isAdmin) || (!isEdit && Boolean(selectedNameOption))} className={inp} />
                  </GuideField>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <GuideField id="as-f-group" missing={missReq.group}>
                    <label className={fl}>{t("mp.sfiGroup")}<RequiredMark />{needTag(missReq.group)}</label>
                    <select value={selectedGroup} onChange={e => onGroupChanged(e.target.value)} className={inp}>
                      <option value="">{t("mp.selectSfiGroup")}</option>
                      {SFI_GROUP_NUMBERS.map(g => <option key={g} value={String(g)}>{g} - {t(`sfi.g.${g}` as TranslationKey)}</option>)}
                    </select>
                  </GuideField>
                  <div>
                    <label className={fl}>{t("col.status")}</label>
                    <select value={status} onChange={e => setStatus(e.target.value)} className={inp}>
                      {(["OPERATIONAL", "DEGRADED", "OUT_OF_SERVICE"] as const).map(s => <option key={s} value={s}>{t(`asset.v23.st.${s}` as TranslationKey)}</option>)}
                    </select>
                  </div>
                </div>
                <GuideField id="as-f-name" missing={missReq.name}>
                  <label className={fl}>{t("col.name")}<RequiredMark />{needTag(missReq.name)}</label>
                  {nameOptions.length > 0 && (
                    <select value={selectedNameOption?.name ?? ""} onChange={e => onNameChanged(e.target.value)} disabled={!selectedGroup} className={inp}>
                      <option value="">{t("asset.selectExistingName")}</option>
                      {nameOptions.map(option => <option key={`${option.name}-${option.suggestedAssetCode}`} value={option.name}>{option.name}</option>)}
                    </select>
                  )}
                  <input value={name} onChange={e => onNameChanged(e.target.value)} disabled={!selectedGroup}
                    placeholder={nameOptions.length > 0 ? t("asset.namePlaceholderEdit") : t("asset.namePlaceholderNew")} className={inp} />
                </GuideField>
              </GuideSection>

              {/* 2 · Criticidad y seguridad */}
              <GuideSection n={2} title={t("asset.v23.sec2")} subtitle={t("asset.v23.sec2Sub")} open onToggle={() => { /* siempre abierto */ }}>
                <div>
                  <div className="flex items-center gap-1">
                    <label className={`${fl} mb-0`}>{t("col.criticality")}</label>
                    <button type="button" onClick={() => { void requestCriticalitySuggestion(); }} disabled={!name.trim() || suggestingCriticality}
                      title={!name.trim() ? t("asset.suggestCritNeedsName") : t("asset.suggestCritTitle")}
                      className="ml-auto inline-flex items-center gap-1 rounded-full border border-violet-500/35 bg-violet-500/[0.07] px-2 py-0.5 text-[10.5px] font-extrabold text-violet-700 dark:text-violet-300 hover:bg-violet-500/15 disabled:opacity-50 disabled:cursor-not-allowed">
                      {suggestingCriticality ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />} {t("mp.guide.suggestAi")}
                    </button>
                  </div>
                  <select value={criticality} onChange={e => setCriticality(e.target.value)} className={`${inp} mt-1.5`}>
                    <option value="A">{t("asset.v23.critA")}</option>
                    <option value="B">{t("asset.v23.critB")}</option>
                    <option value="C">{t("asset.v23.critC")}</option>
                  </select>
                </div>
                <div>
                  <label className={fl}>{t("asset.critRationale")}</label>
                  <AutoTextArea value={criticalityRationale} onChange={e => setCriticalityRationale(e.target.value)} rows={3} placeholder={t("asset.critRationalePh")} className={`${inp} resize-y`} />
                </div>
                {/* ISM safety-critical (ISM Code 10.3) — el flag se sugiere desde el botón de IA de la criticidad */}
                <div className="rounded-xl border-[1.5px] border-violet-500/30 bg-violet-500/[0.05] px-3 py-2.5">
                  <label className="flex items-center gap-2.5 cursor-pointer">
                    <input type="checkbox" checked={isSafetyCritical} onChange={e => setIsSafetyCritical(e.target.checked)} className="w-4 h-4 accent-violet-600" />
                    <span className="text-[13px] font-extrabold text-fg">{t("asset.safetyCritical")} <span className="font-semibold text-text-industrial/60">(ISM 10.3)</span></span>
                  </label>
                  {/* Segunda mitad del 10.3: el Código exige probar periódicamente lo
                      que NO está en uso continuo. Sólo aparece si el equipo es crítico. */}
                  {isSafetyCritical && (
                    <div className="mt-3 pt-3 border-t border-fg/10 space-y-2">
                      <p className="text-xs font-semibold text-text-industrial/70">{t("asset.dutyMode")}</p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {([false, true] as const).map(standbyOption => (
                          <label key={String(standbyOption)}
                            className={`flex items-start gap-2.5 rounded-xl border px-3 py-2 cursor-pointer transition-colors ${isStandby === standbyOption ? "bg-accent/10 border-accent/40" : "bg-surface border-fg/10 hover:bg-fg/5"}`}>
                            <input type="radio" name="assetDutyMode" checked={isStandby === standbyOption}
                              onChange={() => { setIsStandby(standbyOption); if (!standbyOption) setStandbyTestPlanId(""); }}
                              className="w-4 h-4 mt-0.5 accent-accent shrink-0" />
                            <div className="min-w-0">
                              <p className="text-sm text-fg">{t(standbyOption ? "asset.dutyMode.standby" : "asset.dutyMode.continuous")}</p>
                              <p className="text-[11px] text-text-industrial/50 leading-snug">{t(standbyOption ? "asset.dutyMode.standbyHint" : "asset.dutyMode.continuousHint")}</p>
                            </div>
                          </label>
                        ))}
                      </div>
                      {/* La prueba periódica es una de las tareas del propio equipo. */}
                      {isStandby && (
                        <div className="space-y-1.5 pt-1">
                          <label className={fl}>{t("asset.standbyTestPlan")}</label>
                          {!isEdit || !initial?.id ? (
                            <p className="text-xs text-text-industrial/50">{t("asset.standbyTestPlanOnSave")}</p>
                          ) : standbyPlansFetch.loading ? (
                            <Loader2 className="w-4 h-4 animate-spin text-accent" />
                          ) : standbyPlanOptions.length === 0 ? (
                            <p className="text-xs text-text-industrial/50">{t("asset.standbyTestPlanEmpty")}</p>
                          ) : (
                            <>
                              <select value={standbyTestPlanId} onChange={e => setStandbyTestPlanId(e.target.value)} className={inp}>
                                <option value="">{t("asset.standbyTestPlanNone")}</option>
                                {standbyPlanOptions.map(pl => <option key={pl.id} value={pl.id}>{pl.taskCode} · {pl.title}{fmtPlanFreq(pl) ? ` · ${fmtPlanFreq(pl)}` : ""}</option>)}
                              </select>
                              <p className="text-[11px] text-text-industrial/50 leading-snug">{t("asset.standbyTestPlanHint")}</p>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {/* Excepción declarada: equipo C (no ISM 10.3) que no lleva plan. Sin esta
                    marca, un equipo sin plan se cuenta como brecha de cobertura (TMSA 4.1.1 / ISM 10.1). */}
                {puedeEximirse && (
                  <div className="rounded-xl border border-fg/10 bg-fg/[0.03] px-3 py-2.5 space-y-2">
                    <label className="flex items-center gap-2.5 cursor-pointer">
                      <input type="checkbox" checked={planNotRequired} onChange={e => setPlanNotRequired(e.target.checked)} className="w-4 h-4 accent-accent" />
                      <div className="min-w-0">
                        <p className="text-sm text-fg">{t("asset.planNotRequired")}</p>
                        <p className="text-xs text-text-industrial/50">{t("asset.planNotRequiredHint")}</p>
                      </div>
                    </label>
                    {planNotRequired && (
                      <GuideField id="as-f-exempt" missing={missReq.exemptReason}>
                        <span className={fl}><RequiredMark />{needTag(missReq.exemptReason)}</span>
                        <AutoTextArea value={planNotRequiredReason} onChange={e => setPlanNotRequiredReason(e.target.value)} rows={2} placeholder={t("asset.planNotRequiredReasonPh")} className={`${inp} resize-y`} />
                      </GuideField>
                    )}
                  </div>
                )}
              </GuideSection>

              {/* 3 · Datos técnicos */}
              <GuideSection n={3} title={t("asset.v23.sec3")} subtitle={t("asset.v23.sec3Sub")} open onToggle={() => { /* siempre abierto */ }}>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div><label className={fl}>{t("col.manufacturer")}</label><input value={manufacturer} onChange={e => setManufacturer(e.target.value)} className={inp} /></div>
                  <div><label className={fl}>{t("col.model")}</label><input value={model} onChange={e => setModel(e.target.value)} className={inp} /></div>
                  <div><label className={fl}>{t("asset.v23.serial")}</label><input value={serialNumber} onChange={e => setSerialNumber(e.target.value)} className={inp} /></div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div><label className={fl}>{t("asset.v23.installed")}</label><input type="date" value={installationDate} onChange={e => setInstallationDate(e.target.value)} className={inp} /></div>
                  <div><label className={fl}>{t("asset.v23.lastOverhaul")}</label><input type="date" value={lastOverhaulDate} onChange={e => setLastOverhaulDate(e.target.value)} className={inp} /></div>
                  <div><label className={fl}>{t("asset.v23.replacement")}</label><input type="date" value={replacementDate} onChange={e => setReplacementDate(e.target.value)} className={inp} /></div>
                </div>
                <label className="flex items-center gap-2.5 rounded-xl border border-fg/10 bg-fg/[0.03] px-3 py-2.5 cursor-pointer hover:bg-fg/5">
                  <input type="checkbox" checked={trackDailyReport} onChange={e => setTrackDailyReport(e.target.checked)} className="w-4 h-4 rounded accent-accent shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm text-fg font-medium">{t("asset.hoursTracking")}</p>
                    <p className="text-xs text-text-industrial/50">{t("asset.hoursTrackingHint")}</p>
                  </div>
                </label>
              </GuideSection>
            </div>

            {/* Derecha: lo que está conectado al equipo */}
            {isEdit && initial && (
              <div className="space-y-3 min-w-0">
                {box(<CalendarCheck className="w-4 h-4" />, t("asset.plans.title"),
                  relPlans.loading ? <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" /> : null,
                  planNotRequired && activePlans.length === 0 ? empty(t("asset.v23.planExempt"))
                    : activePlans.length === 0 ? empty(t("asset.plans.empty"))
                    : (
                      <button type="button" className={rel} onClick={() => document.getElementById("asset-plans")?.scrollIntoView({ behavior: "smooth" })}>
                        <b className="text-fg">{t("asset.v23.tasksN").replace("{n}", String(activePlans.length))}</b>
                        {overduePlans > 0 && <span className="font-bold text-red-700 dark:text-red-400">{t("asset.v23.overdueN").replace("{n}", String(overduePlans))}</span>}
                        <ChevronRight className="ml-auto w-3.5 h-3.5 text-text-industrial/40" />
                      </button>
                    ))}
                {box(<AlertOctagon className="w-4 h-4" />, t("asset.v23.openDefects"),
                  <button type="button" onClick={() => navigate("/defects", { state: { createDefectFromWo: { vesselCode: initial.vesselCode, assetId: initial.id, assetName: initial.name } } })}
                    className="inline-flex items-center gap-1 text-accent font-bold hover:underline"><Plus className="w-3 h-3" />{t("asset.v23.report")}</button>,
                  openDefects.length === 0 ? empty(relDefects.loading ? t("common.loading") : t("asset.v23.noDefects")) : openDefects.slice(0, 6).map(d => (
                    <button key={d.id} type="button" className={rel} onClick={() => navigate(`/defects/${encodeURIComponent(d.defectCode)}`)}>
                      <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-extrabold ${SEV_CLS[d.severity] ?? "bg-fg/10"}`}>{SEV_KEY[d.severity] ? t(SEV_KEY[d.severity]) : d.severity}</span>
                      <span className="truncate text-fg">{d.description}</span>
                      <span className="ml-auto flex items-center gap-1 shrink-0 text-[11px] text-text-industrial/50">{fmtHistoryDate(d.reportedAt)}<ChevronRight className="w-3.5 h-3.5" /></span>
                    </button>
                  )))}
                {box(<Gauge className="w-4 h-4" />, t("asset.v23.hoursAndLab"), null,
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-xl border border-fg/10 px-2.5 py-2">
                        <p className="text-[10.5px] font-bold text-text-industrial/50">{t("asset.accumulatedHours")}</p>
                        <p className="text-lg font-black text-fg">{currentHours != null ? `${Number(currentHours).toLocaleString()} h` : "—"}</p>
                        {currentHoursDate && (
                          <p className="text-[10px] text-text-industrial/45">
                            {currentHoursDate}
                            {currentHoursSource === "MANUAL" ? ` · ${t("assetHours.source.manual")}`
                              : currentHoursSource === "VOYAGE_TANK_REPORT" ? ` · ${t("assetHours.source.voyage")}`
                              : currentHoursSource === "DAILY_REPORT" ? ` · ${t("assetHours.source.daily")}` : ""}
                          </p>
                        )}
                      </div>
                      <div className="rounded-xl border border-fg/10 px-2.5 py-2">
                        <p className="text-[10.5px] font-bold text-text-industrial/50">{t("asset.v23.lastSample")}</p>
                        {lastSample ? (
                          <>
                            <p className={`text-sm font-black ${lastSample.result?.verdict === "CRITICAL" || lastSample.result?.verdict === "ACTION_REQUIRED" ? "text-red-700 dark:text-red-400" : lastSample.result?.verdict === "CAUTION" ? "text-amber-700 dark:text-amber-400" : "text-fg"}`}>
                              {lastSample.result?.verdict ? t(`fa.vd.${lastSample.result.verdict}` as TranslationKey) : t(`fa.st.${lastSample.status}` as TranslationKey)}
                            </p>
                            <p className="text-[10px] text-text-industrial/45">{fmtHistoryDate(lastSample.sampledAt)}</p>
                          </>
                        ) : <p className="text-sm font-black text-text-industrial/40">—</p>}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-3 text-xs">
                      {trackDailyReport && <button type="button" onClick={() => navigate(`/asset-hours?vesselCode=${encodeURIComponent(initial.vesselCode)}`)} className="inline-flex items-center gap-1 font-bold text-accent hover:underline"><Clock className="w-3 h-3" />{t("asset.v23.loadHours")}</button>}
                      {lastSample && <button type="button" onClick={() => navigate(`/fluid-analyses?code=${encodeURIComponent(lastSample.sampleCode)}`)} className="inline-flex items-center gap-1 font-bold text-accent hover:underline"><FlaskConical className="w-3 h-3" />{t("asset.v23.seeSample")}</button>}
                    </div>
                  </>)}
                {box(<Package className="w-4 h-4" />, t("asset.v23.planSpares"), planSpares.length ? String(planSpares.length) : null,
                  planSpares.length === 0 ? empty(t("asset.v23.planSparesEmpty")) : planSpares.slice(0, 8).map(s => (
                    <div key={s.label} className={`${rel} hover:border-fg/10`}>
                      <span className="truncate text-fg">{s.label}</span>
                      <span className="ml-auto shrink-0 text-[11px] text-text-industrial/55">{s.qty ? `${s.qty} ${s.unit}` : ""} · {t("asset.v23.tasksN").replace("{n}", String(s.tasks))}</span>
                    </div>
                  )))}
              </div>
            )}
          </div>

          {/* Tareas del plan e historial: tablas completas, a lo ancho. */}
          {isEdit && initial?.id && (
            <div id="asset-plans" className="px-4 sm:px-6 pb-4 space-y-4">
              <AssetMaintenancePlans asset={initial} newRequestKey={plansNewKey} onChanged={() => { void relPlans.reload(); }} />
              <AssetHistory asset={initial} />
            </div>
          )}
        </div>

        {/* Pie */}
        <div className="flex flex-wrap items-center gap-2 px-4 sm:px-6 py-3 border-t border-fg/10 shrink-0">
          {isEdit && initial && canManageAsset && onDeleteRequest && (
            <button type="button" onClick={() => onDeleteRequest(initial)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-red-500/30 text-xs font-bold text-red-700 dark:text-red-400 hover:bg-red-500/10">
              <Trash2 className="w-3.5 h-3.5" /> {t("common.delete")}
            </button>
          )}
          {isEdit && initial && (
            <button type="button"
              onClick={async () => {
                setDownloadingPdf(true);
                try { await downloadAssetPdf(initial); }
                catch (err) { setActionError(err instanceof ApiError ? err.message : t("asset.pdfError")); }
                finally { setDownloadingPdf(false); }
              }}
              disabled={downloadingPdf}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-fg/10 text-xs font-bold text-fg hover:border-accent/30 disabled:opacity-50">
              {downloadingPdf ? <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" /> : <FileDown className="w-3.5 h-3.5 text-accent" />} {t("asset.downloadPdf")}
            </button>
          )}
          <span className="flex-1" />
          {isDirty && <span className="inline-flex items-center gap-1 text-[11.5px] font-bold text-amber-700 dark:text-amber-400"><AlertTriangle className="w-3 h-3" /> {t("mp.guide.dirty")}</span>}
          <button type="button" onClick={requestClose} className="px-3 py-2 rounded-xl text-xs text-text-industrial hover:text-fg">{t("common.close")}</button>
          <button type="button" onClick={() => { void onSave(); }} disabled={saving}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-sky-600 text-white font-bold text-xs hover:brightness-110 disabled:opacity-50">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} {t("common.save")}
            {!saving && missTotal > 0 && <span className="text-[10px] font-semibold opacity-85">{t("mp.guide.saveMissing").replace("{n}", String(missTotal))}</span>}
          </button>
        </div>
      </div>

      {/* Avisos y errores en ventanita. */}
      {actionError && <AlertDialog message={actionError} onClose={() => setActionError(null)} />}
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
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-fg/10">
          <h2 className="text-base font-bold text-fg">{t("common.delete")}</h2>
          <ModalCloseButton onClose={onClose} />
        </div>
        <div className="p-6 space-y-4">
          <p className="text-sm text-text-industrial/70">
            {t("asset.v23.deleteConfirm").replace("{code}", asset.assetCode).replace("{name}", asset.name)}
          </p>
        </div>
        {actionError && <AlertDialog message={actionError} onClose={() => setActionError(null)} />}
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
  const can = useCan();
  const { selectedVesselCode } = useVesselContext();
  const isAdmin = user?.role === "TENANT_ADMIN";
  const canManageAsset = can("asset.manage");
  const [searchParams, setSearchParams] = useSearchParams();
  const [showExcel, setShowExcel] = useState(false);
  const [editing, setEditing] = useState<Asset | null | undefined>(undefined);

  useCopilotEmitter(editing === undefined ? { module: "ASSETS", screen: "ASSET_LIST" } : null);
  const [deleteTarget, setDeleteTarget] = useState<Asset | null>(null);
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [sfiTab, setSfiTab] = useState<"ALL" | number | "NONE">("ALL");
  const [viewMode, setViewMode] = useState<"list" | "board">("list");

  const statusFilter = (searchParams.get("status") ?? "").trim();
  const criticalityFilter = (searchParams.get("criticality") ?? "").trim();
  const vesselFilter = (searchParams.get("vesselCode") ?? "").trim();
  const openAssetId = (searchParams.get("open") ?? "").trim();
  // El asesor técnico manda acá con ?salud=1 para abrir el informe del equipo.
  const [openHealthFor, setOpenHealthFor] = useState<string | null>(null);
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
  // ── Listado (preview V23) ──────────────────────────────────────────────────
  // Plan y defectos por equipo: se cargan aparte y no frenan la lista.
  const plansFetch = useFetch<{ items: { id: string; assetId: string | null; status: string }[] }>("/app/pms/maintenance-plans", []);
  const defectsFetch = useFetch<{ items: AssetDefectLite[] }>("/app/pms/defects", []);
  const linksLoading = plansFetch.loading || defectsFetch.loading;
  const planStats = useMemo(() => {
    const m = new Map<string, { active: number; overdue: number }>();
    for (const p of plansFetch.data?.items ?? []) {
      if (!p.assetId || p.status === "INACTIVE") continue;
      const cur = m.get(p.assetId) ?? { active: 0, overdue: 0 };
      cur.active += 1; if (p.status === "OVERDUE") cur.overdue += 1;
      m.set(p.assetId, cur);
    }
    return m;
  }, [plansFetch.data]);
  const openDefectCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of defectsFetch.data?.items ?? []) {
      if (!d.assetId || d.status === "RESOLVED" || d.status === "CLOSED") continue;
      m.set(d.assetId, (m.get(d.assetId) ?? 0) + 1);
    }
    return m;
  }, [defectsFetch.data]);

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
    if (searchParams.get("salud") === "1") setOpenHealthFor(openAssetId);
    const params = new URLSearchParams(searchParams);
    params.delete("open");
    params.delete("salud");
    setSearchParams(params, { replace: true });
  }, [openAssetId, searchParams, setSearchParams]);

  const onDeleted = useCallback(() => {
    setDeleteTarget(null);
    setEditing(undefined);
    void reload();
    void reloadTenantAssets();
  }, [reload, reloadTenantAssets]);

  /** Crítico (A/B) sin tareas activas y sin la exención escrita: brecha de cobertura. */
  const isNoPlan = useCallback((a: Asset) => a.criticality !== "C" && !a.planNotRequired && !(planStats.get(a.id)?.active), [planStats]);

  const tmsaItems = useMemo(() => applyTmsaFilter(data?.items ?? null, tmsaFilter, a => a.id), [data, tmsaFilter]);
  const filteredAssets = useMemo(() => {
    let items = tmsaItems;
    if (!items) return items;
    if (sfiTab !== "ALL") items = items.filter(a => sfiTabOfCode(a.sfiCode) === sfiTab);
    if (searchText.trim()) {
      const q = searchText.trim().toLowerCase();
      items = items.filter(a =>
        textMatches(a.assetCode, q) || textMatches(a.name, q) || textMatches(a.sfiCode, q) ||
        textMatches(a.manufacturer, q) || textMatches(a.model, q) || textMatches(a.serialNumber, q));
    }
    return items;
  }, [tmsaItems, sfiTab, searchText]);

  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const a of data?.items ?? []) {
      const k = String(sfiTabOfCode(a.sfiCode));
      counts[k] = (counts[k] ?? 0) + 1;
    }
    return counts;
  }, [data]);

  // ── Agrupado por grupo SFI ───────────────────────────────────────────────
  // El inventario se lee por sistema (propulsión, eléctrico, LCI…), no por
  // orden alfabético de código. Arranca agrupado salvo que se llegue con un
  // orden por columna en la URL, que manda sobre la agrupación.
  const [groupBySfi, setGroupBySfi] = useState(() => !searchParams.get("sort"));
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const toggleGroup = useCallback((key: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);
  const sfiGroupLabel = useCallback((tab: SfiTab) => {
    if (tab === "NONE" || tab === "ALL" || tab === "ISM") return t("gantt.noSfiGroup");
    return `${tab} · ${t(`sfi.g.${tab}` as TranslationKey)}`;
  }, [t]);
  const assetGroupBy = useMemo(
    () => groupBySfi
      ? {
          keyFn: (a: Asset) => String(sfiTabOfCode(a.sfiCode)),
          labelFn: (a: Asset) => sfiGroupLabel(sfiTabOfCode(a.sfiCode)),
          sortRows: (a: Asset, b: Asset) =>
            (a.sfiCode ?? "").localeCompare(b.sfiCode ?? "", "es", { numeric: true })
            || (a.name ?? "").localeCompare(b.name ?? "", "es", { numeric: true }),
          // "NONE" (equipos sin código SFI) va al final; el resto por número.
          sortGroups: (x: { key: string }, y: { key: string }) => {
            const rank = (k: string) => (k === "NONE" ? 99 : Number(k));
            return rank(x.key) - rank(y.key);
          },
        }
      : undefined,
    [groupBySfi, sfiGroupLabel],
  );

  const vesselName = useCallback((code: string) => contextVessels.find(v => v.code === code)?.name || code, [contextVessels]);
  const statusTone: Record<string, string> = {
    OPERATIONAL: "border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-700 dark:text-emerald-400",
    DEGRADED: "border-amber-500/35 bg-amber-500/10 text-amber-800 dark:text-amber-300",
    OUT_OF_SERVICE: "border-red-500/30 bg-red-500/[0.06] text-red-700 dark:text-red-400",
  };

  const planCell = useCallback((a: Asset) => {
    if (linksLoading) return <Loader2 className="w-3.5 h-3.5 animate-spin text-text-industrial/30" />;
    const s = planStats.get(a.id);
    if (s?.active) {
      return (
        <div className="whitespace-nowrap">
          <span className="inline-flex items-center gap-1 text-[11.5px] font-bold text-emerald-700 dark:text-emerald-400"><CalendarCheck className="w-3 h-3" />{t("asset.v23.tasksN").replace("{n}", String(s.active))}</span>
          {s.overdue > 0 && <div className="text-[10.5px] font-bold text-red-700 dark:text-red-400">{t("asset.v23.overdueN").replace("{n}", String(s.overdue))}</div>}
        </div>
      );
    }
    if (a.planNotRequired) return <span className="inline-flex items-center gap-1 whitespace-nowrap text-[11.5px] text-text-industrial/55"><FileMinus className="w-3 h-3" />{t("asset.v23.exempt")}</span>;
    if (a.criticality === "C") return <span className="text-[11.5px] text-text-industrial/40">{t("asset.v23.noPlanC")}</span>;
    return <span className="inline-flex items-center gap-1 whitespace-nowrap text-[11.5px] font-bold text-red-700 dark:text-red-400"><AlertTriangle className="w-3 h-3" />{t("asset.v23.noPlan")}</span>;
  }, [linksLoading, planStats, t]);

  const rowAction = useCallback((a: Asset) => {
    const base = "inline-flex items-center gap-1 whitespace-nowrap rounded-lg border px-2 py-1 text-[11px] font-bold transition-colors";
    if (!linksLoading && isNoPlan(a) && canManageAsset) {
      return <button type="button" onClick={e => { e.stopPropagation(); void openEdit(a); }} className={`${base} border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-300 hover:bg-orange-500/20`}><CalendarPlus className="w-3 h-3" /> {t("asset.v23.buildPlan")}</button>;
    }
    if ((openDefectCount.get(a.id) ?? 0) > 0) {
      return <button type="button" onClick={e => { e.stopPropagation(); void openEdit(a); }} className={`${base} border-red-500/40 bg-red-500/[0.06] text-red-700 dark:text-red-400 hover:bg-red-500/15`}><AlertOctagon className="w-3 h-3" /> {t("asset.v23.seeDefects")}</button>;
    }
    return null;
  }, [linksLoading, isNoPlan, canManageAsset, openDefectCount, openEdit, t]);

  const columns: Column<Asset>[] = useMemo(() => [
    {
      key: "name", header: t("asset.v23.col.asset"), sortValue: (r: Asset) => r.name,
      render: (row: Asset) => (
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-bold text-fg line-clamp-1">{row.name}</span>
            {row.isSafetyCritical && <span title={`${t("asset.safetyCritical")} (ISM 10.3)`} className="inline-flex items-center gap-0.5 rounded-full bg-violet-500/15 px-1.5 text-[9.5px] font-extrabold text-violet-700 dark:text-violet-300"><ShieldAlert className="w-2.5 h-2.5" />ISM</span>}
          </div>
          {/* Nombre del buque, no el código. */}
          <div className="text-[10.5px] text-text-industrial/50"><span className="font-mono">{row.assetCode}</span> · {vesselName(row.vesselCode)}</div>
        </div>
      ),
    },
    {
      key: "sfiCode", header: t("asset.v23.col.system"), sortValue: (r: Asset) => r.sfiCode ?? "",
      filterValue: (r: Asset) => { const tab = sfiTabOfCode(r.sfiCode); return tab === "NONE" ? "" : `${tab} · ${t(`sfi.g.${tab}` as TranslationKey)}`; },
      render: (row: Asset) => { const tab = sfiTabOfCode(row.sfiCode); return <span className="text-xs text-text-industrial/70 whitespace-nowrap">{tab === "NONE" ? "—" : `${tab} · ${t(`sfi.g.${tab}` as TranslationKey)}`}</span>; },
    },
    { key: "criticality", header: t("col.criticality"), sortValue: (r: Asset) => r.criticality, filterValue: (r: Asset) => r.criticality, render: (row: Asset) => <span className={`inline-block rounded-md px-1.5 py-0.5 text-[10.5px] font-black ${ASSET_CRIT_CHIP[row.criticality] ?? ASSET_CRIT_CHIP.C}`}>{row.criticality}</span> },
    { key: "plan", header: t("asset.plans.title"), sortValue: (r: Asset) => planStats.get(r.id)?.active ?? 0, render: planCell },
    { key: "currentHours", header: t("asset.v23.col.hours"), sortValue: (r: Asset) => r.currentHours ?? -1, render: (row: Asset) => row.currentHours != null ? <span className="text-xs whitespace-nowrap">{Number(row.currentHours).toLocaleString()} h</span> : <span className="text-text-industrial/30">—</span> },
    {
      key: "defects", header: t("asset.v23.col.defects"), sortValue: (r: Asset) => openDefectCount.get(r.id) ?? 0,
      render: (row: Asset) => (openDefectCount.get(row.id) ?? 0) > 0
        ? <span className="inline-flex items-center gap-1 whitespace-nowrap text-[11.5px] font-bold text-red-700 dark:text-red-400"><AlertOctagon className="w-3 h-3" />{t("asset.v23.openN").replace("{n}", String(openDefectCount.get(row.id)))}</span>
        : <span className="text-text-industrial/30">—</span>,
    },
    { key: "status", header: t("col.status"), filterValue: (r: Asset) => t(`asset.v23.st.${r.status}` as TranslationKey), render: (row: Asset) => <span className={`inline-block whitespace-nowrap rounded-lg border px-2 py-0.5 text-[10.5px] font-extrabold ${statusTone[row.status] ?? statusTone.OPERATIONAL}`}>{t(`asset.v23.st.${row.status}` as TranslationKey)}</span> },
    { key: "actions", header: "", sortable: false, render: rowAction },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [t, vesselName, planStats, planCell, openDefectCount, rowAction]);

  const selCls = (on: boolean) => `rounded-lg border px-2 py-1.5 text-xs focus:outline-none focus:border-accent/50 ${on ? "border-accent bg-accent/5 font-bold text-accent" : "border-fg/10 bg-fg/5 text-fg"}`;
  const vesselOptions = useMemo(() => [...new Set((tenantAssetsData?.items ?? []).map(a => a.vesselCode))], [tenantAssetsData]);

  return (
    <div className="space-y-4">
      {showExcel && <ExcelPanel module="assets" onClose={() => { setShowExcel(false); reload(); }} />}
      {editing !== undefined && (
        <AssetModal
          initial={editing}
          defaultVesselCode={selectedVesselCode}
          vessels={contextVessels}
          tenantAssets={tenantAssetsData?.items ?? []}
          isAdmin={isAdmin}
          onClose={() => { setEditing(undefined); void defectsFetch.reload(); void plansFetch.reload(); }}
          onSaved={() => {
            setEditing(undefined);
            void reload();
            void reloadTenantAssets();
            void plansFetch.reload();
          }}
          openHealth={!!editing && openHealthFor === editing.id}
          onDeleteRequest={a => setDeleteTarget(a)}
        />
      )}
      {deleteTarget && <DeleteAssetModal asset={deleteTarget} onClose={() => setDeleteTarget(null)} onDeleted={onDeleted} />}
      <PageHeader icon={Settings} title={t("page.assets")} total={filteredAssets?.length ?? data?.total} onReload={reload}>
        <div className="flex items-center gap-0.5 border border-fg/10 rounded-lg p-0.5">
          <button type="button" onClick={() => setViewMode("list")} title={t("asset.viewList")}
            className={`p-1.5 rounded-md transition-colors ${viewMode === "list" ? "bg-fg/10 text-fg" : "text-text-industrial/40 hover:text-fg"}`}>
            <List className="w-3.5 h-3.5" />
          </button>
          <button type="button" onClick={() => { setViewMode("board"); setSfiTab("ALL"); }} title={t("asset.viewBoard")}
            className={`p-1.5 rounded-md transition-colors ${viewMode === "board" ? "bg-fg/10 text-fg" : "text-text-industrial/40 hover:text-fg"}`}>
            <LayoutGrid className="w-3.5 h-3.5" />
          </button>
        </div>
        {viewMode === "list" && (
          <button type="button" onClick={() => setGroupBySfi(v => !v)} title={t("asset.groupBySfi")} aria-pressed={groupBySfi}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold transition-all ${groupBySfi ? "bg-accent/20 border-accent/40 text-accent" : "bg-fg/5 border-fg/10 text-text-industrial hover:border-accent/30"}`}>
            <ListTree className="w-3.5 h-3.5" /> {t("asset.groupBySfi")}
          </button>
        )}
        <button onClick={() => setShowExcel(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-fg/5 border border-fg/10 text-xs text-text-industrial hover:border-accent/30 transition-all">
          <FileSpreadsheet className="w-3.5 h-3.5 text-accent" /> Excel
        </button>
        <button onClick={() => setEditing(null)} className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-sky-600 text-white font-bold text-xs hover:brightness-110 transition-all">
          <Plus className="w-3.5 h-3.5" /> {t("asset.v23.new")}
        </button>
      </PageHeader>

      {/* Filtros */}
      <div className="rounded-2xl border border-fg/10 bg-surface p-3 space-y-2.5">
        {/* Grupos SFI con su nombre: en el tablero sobran (cada grupo ya es una columna). */}
        {viewMode === "list" && (
          <div className="flex flex-wrap gap-1.5">
            {SFI_TABS.map(tab => {
              const count = tab.key === "ALL" ? (data?.items.length ?? 0) : (tabCounts[String(tab.key)] ?? 0);
              const isActive = sfiTab === tab.key;
              if (tab.key !== "ALL" && count === 0 && !isActive) return null;
              return (
                <button key={String(tab.key)} type="button" onClick={() => setSfiTab(tab.key as typeof sfiTab)}
                  className={`inline-flex items-center gap-1.5 rounded-full border-[1.5px] px-3 py-1 text-xs font-bold transition-colors ${isActive ? "border-accent bg-accent text-accent-fg" : "border-fg/10 bg-surface text-text-industrial/60 hover:text-fg"}`}>
                  {tab.key === "ALL" ? t("common.all") : `${tab.key} · ${t(`sfi.g.${tab.key}` as TranslationKey)}`}
                  <span className={`rounded-full px-1.5 text-[10px] ${isActive ? "bg-white/25" : "bg-fg/10"}`}>{count}</span>
                </button>
              );
            })}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {vesselOptions.length > 1 && (
            <select value={vesselFilter} onChange={e => updateFilters({ vesselCode: e.target.value })} className={selCls(!!vesselFilter)}>
              <option value="">{t("asset.v23.vesselAll")}</option>
              {vesselOptions.map(v => <option key={v} value={v}>{vesselName(v)}</option>)}
            </select>
          )}
          <select value={criticalityFilter} onChange={e => updateFilters({ criticality: e.target.value })} className={selCls(!!criticalityFilter)}>
            <option value="">{t("asset.v23.critAll")}</option>
            <option value="A">{t("asset.v23.critA")}</option>
            <option value="B">{t("asset.v23.critB")}</option>
            <option value="C">{t("asset.v23.critC")}</option>
          </select>
          <select value={statusFilter} onChange={e => updateFilters({ status: e.target.value })} className={selCls(!!statusFilter)}>
            <option value="">{t("asset.v23.statusAll")}</option>
            {(["OPERATIONAL", "DEGRADED", "OUT_OF_SERVICE"] as const).map(s => <option key={s} value={s}>{t(`asset.v23.st.${s}` as TranslationKey)}</option>)}
          </select>
          {(statusFilter || criticalityFilter || vesselFilter || searchText) && (
            <button type="button" onClick={() => { updateFilters({ status: "", criticality: "", vesselCode: "" }); setSearchText(""); }}
              className="rounded-lg border border-fg/10 bg-fg/5 px-2.5 py-1.5 text-xs text-text-industrial/80 hover:text-fg">{t("common.clear")}</button>
          )}
          <div className="flex items-center gap-1.5 rounded-lg border border-fg/10 bg-fg/5 px-2.5 py-1.5 w-full sm:w-auto sm:ml-auto">
            <Search className="w-3.5 h-3.5 text-text-industrial/40 shrink-0" />
            <input value={searchText} onChange={e => setSearchText(e.target.value)} placeholder={t("asset.v23.search")}
              className="w-full sm:w-64 bg-transparent text-xs text-fg placeholder-text-industrial/30 focus:outline-none" />
            {searchText && <button type="button" onClick={() => setSearchText("")} className="text-text-industrial/40 hover:text-fg"><X className="w-3 h-3" /></button>}
          </div>
        </div>
      </div>

      <TmsaFilterBanner filter={tmsaFilter} shown={filteredAssets?.length ?? 0} total={data?.items?.length ?? 0} />
      {detailLoadingId && <div className="flex items-center gap-2 text-xs text-text-industrial/60"><Loader2 className="w-4 h-4 animate-spin text-accent" />{t("asset.v23.loadingDetail")}</div>}
      {viewMode === "list" ? (
        <>
          <div className="hidden md:block">
            <DataTable
              columns={columns}
              data={filteredAssets}
              loading={loading}
              error={error}
              keyFn={row => row.id}
              emptyText={t("empty.assets")}
              onRowClick={row => { void openEdit(row); }}
              rowClassName={row => (row.status === "OUT_OF_SERVICE" || (!linksLoading && row.criticality === "A" && isNoPlan(row)) ? "bg-red-500/[0.06] shadow-[inset_4px_0_0_rgb(220,38,38)]" : "")}
              groupBy={assetGroupBy}
              collapsedGroups={collapsedGroups}
              onToggleGroup={toggleGroup}
              // Ordenar por una columna y agrupar se pisan: al ordenar, la lista
              // pasa a verse de corrido (mismo criterio que Plan de Mantenimiento).
              onSortUngroup={() => setGroupBySfi(false)}
            />
          </div>
          <div className="md:hidden flex flex-col gap-2">
            {loading && <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-accent" /></div>}
            {!loading && (filteredAssets?.length ?? 0) === 0 && <p className="py-8 text-center text-sm text-text-industrial/40">{t("empty.assets")}</p>}
            {(filteredAssets ?? []).slice(0, 200).map(a => (
              <div key={a.id} onClick={() => { void openEdit(a); }}
                className={`rounded-xl border border-fg/10 border-l-4 px-3 py-2.5 space-y-1.5 cursor-pointer bg-surface ${a.status === "OUT_OF_SERVICE" ? "border-l-red-600" : a.status === "DEGRADED" ? "border-l-amber-500" : "border-l-fg/10"}`}>
                <div className="flex items-center gap-1.5">
                  <span className={`rounded-md px-1.5 py-0.5 text-[10.5px] font-black ${ASSET_CRIT_CHIP[a.criticality] ?? ASSET_CRIT_CHIP.C}`}>{a.criticality}</span>
                  <b className="text-[13px] text-fg truncate">{a.name}</b>
                  {a.isSafetyCritical && <ShieldAlert className="w-3.5 h-3.5 text-violet-600 shrink-0" />}
                </div>
                <p className="text-[11px] text-text-industrial/55"><span className="font-mono">{a.assetCode}</span> · {sfiGroupLabel(sfiTabOfCode(a.sfiCode))}</p>
                <div className="flex flex-wrap items-center gap-2">
                  {planCell(a)}
                  <span className={`rounded-lg border px-2 py-0.5 text-[10.5px] font-extrabold ${statusTone[a.status] ?? statusTone.OPERATIONAL}`}>{t(`asset.v23.st.${a.status}` as TranslationKey)}</span>
                </div>
                {rowAction(a)}
              </div>
            ))}
          </div>
        </>
      ) : <AssetsBoard assets={filteredAssets} loading={loading} onOpen={row => { void openEdit(row); }} t={t} />}
    </div>
  );
};
