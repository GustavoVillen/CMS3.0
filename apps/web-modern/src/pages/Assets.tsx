import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { FileDown, FileSpreadsheet, Loader2, Maximize2, Minimize2, Plus, Search, Settings, ShieldAlert, Sparkles, Trash2, X } from "lucide-react";
import { useFetch } from "../lib/hooks";
import { api, ApiError } from "../lib/api";
import { DataTable, StatusBadge, type Column } from "../components/DataTable";
import { FILTER_ALL_VALUE, fromFilterSelectValue, toFilterSelectValue } from "../lib/utils";
import { PageHeader } from "../components/PageHeader";
import { VesselLabel } from "../components/EntityLabels";
import { ExcelPanel } from "../components/ExcelPanel";
import { useT } from "../lib/i18n";
import { useAuth } from "../lib/auth";
import { useCopilotEmitter } from "../lib/copilot-context";
import { useEscapeGuard, useDirtyTracker } from "../lib/escape-guard";
import { useVesselContext } from "../lib/vessel-context";
import { MaintenancePlanModal, type MaintenancePlan } from "./MaintenancePlans";

interface Asset {
  id: string;
  tenantId: string;
  vesselCode: string;
  assetCode: string;
  sfiCode: string | null;
  name: string;
  criticality: string;
  criticalityRationale: string | null;
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
  statusNode: React.ReactNode;
  onClick?: () => void;
}

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
// Solo lectura, se muestra al final del formulario en modo edición.
const AssetHistory: React.FC<{ assetId: string }> = ({ assetId }) => {
  const t = useT();
  const navigate = useNavigate();
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
      statusNode: <StatusBadge status={wo.status} />,
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
        statusNode: <WorkLogResultBadge result={log.result} />,
      }));
    const ref = (r: AssetHistoryRow): number => {
      const d = r.completedDate ?? r.openDate;
      const t2 = d ? new Date(d).getTime() : NaN;
      return Number.isNaN(t2) ? 0 : t2;
    };
    return [...woRows, ...logRows].sort((a, b) => ref(b) - ref(a));
  }, [woFetch.data, logFetch.data, navigate]);

  return (
    <div className="space-y-2 pt-2 border-t border-fg/10">
      <h3 className="text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">{t("asset.history.title")}</h3>
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
                <th className="text-left font-semibold px-3 py-2 whitespace-nowrap">{t("asset.history.col.code")}</th>
                <th className="text-left font-semibold px-3 py-2 whitespace-nowrap">{t("asset.history.col.type")}</th>
                <th className="text-left font-semibold px-3 py-2">{t("asset.history.col.title")}</th>
                <th className="text-left font-semibold px-3 py-2 whitespace-nowrap">{t("asset.history.col.openDate")}</th>
                <th className="text-left font-semibold px-3 py-2 whitespace-nowrap">{t("asset.history.col.completedDate")}</th>
                <th className="text-left font-semibold px-3 py-2 whitespace-nowrap">{t("asset.history.col.status")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
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
  const role = user?.role;
  const canManage = role === "TENANT_ADMIN" || role === "FLEET_SUPERINTENDENT" || role === "MAINTENANCE_MANAGER";
  const canDelete = role === "TENANT_ADMIN" || role === "FLEET_SUPERINTENDENT";

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
          canDelete={canDelete}
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

  const [vesselCode, setVesselCode] = useState(initial?.vesselCode ?? defaultVesselCode ?? "");
  const [assetCode, setAssetCode] = useState(initial?.assetCode ?? "");
  const [selectedGroup, setSelectedGroup] = useState("");
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
  const [installationDate, setInstallationDate] = useState(toDateInputValue(initial?.installationDate ?? null));
  const [lastOverhaulDate, setLastOverhaulDate] = useState(toDateInputValue(initial?.lastOverhaulDate ?? null));
  const [replacementDate, setReplacementDate] = useState(toDateInputValue(initial?.replacementDate ?? null));
  const [assetCodeTouched, setAssetCodeTouched] = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [expanded,    setExpanded]    = useState(true);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

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
    vesselCode,
  ]);

  // Pedir sugerencia de criticidad + ISM a la IA (un solo análisis combinado)
  const requestCriticalitySuggestion = useCallback(async () => {
    if (!name.trim() || suggestingCriticality) return;
    setSuggestingCriticality(true);
    setActionError(null);
    try {
      const result = await api.post<{ criticality: "A" | "B" | "C"; isSafetyCritical: boolean; rationale: string }>(
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
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "No se pudo obtener sugerencia.");
    } finally {
      setSuggestingCriticality(false);
    }
  }, [name, vesselCode, selectedGroup, manufacturer, model, serialNumber, suggestingCriticality]);

  // ESC guard
  const isDirty = useDirtyTracker({
    vesselCode, assetCode, selectedGroup, name, criticality, criticalityRationale, status,
    manufacturer, model, serialNumber, trackDailyReport,
    installationDate, lastOverhaulDate, replacementDate,
  });
  useEscapeGuard({ isDirty, onSave: onSave, onClose });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className={`w-full bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl flex flex-col transition-all duration-200 ${expanded ? "w-full h-full" : "max-w-2xl max-h-[90vh]"}`} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-fg/10 shrink-0">
          <h2 className="text-base font-bold text-fg">{isEdit ? t("asset.editTitle") : t("asset.newTitle")}</h2>
          <div className="flex items-center gap-1">
            <button onClick={() => setExpanded(v => !v)} className="p-1.5 rounded-lg text-fg/30 hover:text-fg hover:bg-fg/5 transition-colors" title={expanded ? t("asset.collapse") : t("asset.expand")}>
              {expanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
            <button onClick={onClose}><X className="w-5 h-5 text-text-industrial/40 hover:text-fg transition-colors" /></button>
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

            <div className="space-y-1.5 col-span-2">
              <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">{t("asset.critRationale")}</label>
              <textarea
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
                <p className="text-sm text-fg font-medium">Reporte diario</p>
                <p className="text-xs text-text-industrial/50">Incluir en horas de equipo del reporte diario</p>
              </div>
              {currentHours != null && (
                <div className="shrink-0 text-right">
                  <p className="text-[10px] text-text-industrial/40 uppercase tracking-wider">Hs. acumuladas</p>
                  <p className="font-mono text-base font-bold text-accent leading-tight">{Number(currentHours).toLocaleString()}h</p>
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
          {isEdit && initial?.id && <AssetHistory assetId={initial.id} />}
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
          <button onClick={onClose}><X className="w-5 h-5 text-text-industrial/40 hover:text-fg transition-colors" /></button>
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

  const statusFilter = (searchParams.get("status") ?? "").trim();
  const criticalityFilter = (searchParams.get("criticality") ?? "").trim();
  const vesselFilter = (searchParams.get("vesselCode") ?? "").trim();
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
  }, [data, sfiTab, searchText]);

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

      {/* SFI group tab bar */}
      <div className="flex flex-wrap items-center gap-1.5">
        {SFI_TABS.map(tab => {
          const count = tab.key === "ALL"
            ? (data?.items.length ?? 0)
            : (tabCounts[String(tab.key)] ?? 0);
          const isActive = sfiTab === tab.key;
          if (tab.key !== "ALL" && count === 0) return null;
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
              {tab.label}{count > 0 && <span className="ml-1.5 opacity-70">({count})</span>}
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

      {detailLoadingId && <div className="flex items-center gap-2 text-xs text-text-industrial/60"><Loader2 className="w-4 h-4 animate-spin text-accent" />Cargando detalle del asset...</div>}
      <DataTable columns={columns} data={filteredAssets} loading={loading} error={error} keyFn={row => row.id} emptyText={t("empty.assets")} onRowClick={row => { void openEdit(row); }} />
    </div>
  );
};
