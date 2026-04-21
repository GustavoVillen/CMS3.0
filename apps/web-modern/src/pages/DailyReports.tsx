import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  CheckCircle, FileText, Loader2, Plus, Trash2, X,
} from "lucide-react";
import { useFetch } from "../lib/hooks";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { DataTable, StatusBadge, type Column } from "../components/DataTable";
import { PageHeader } from "../components/PageHeader";
import { FILTER_ALL_VALUE, fmtDate, fromFilterSelectValue, toFilterSelectValue } from "../lib/utils";
import { useT } from "../lib/i18n";
import { useCopilotEmitter } from "../lib/copilot-context";

// ─── Base Types ───────────────────────────────────────────────────────────────

interface DailyReport {
  id: string;
  vesselCode: string;
  reportDate: string;
  status: string;
  summary?: string | null;
  engineHoursMain?: number | null;
  generatorHours?: number | null;
  fuelConsumedLiters?: number | null;
  positionLat?: number | null;
  positionLon?: number | null;
  notes?: string | null;
  nextPort?: string | null;
  etaNextPort?: string | null;
  etdNextPort?: string | null;
  portCallType?: string | null;
  estimatedStayHours?: number | null;
  maintenanceOpportunity?: string | null;
  sparesReceiptPossible?: string | null;
  operationalRemarks?: string | null;
  currentPort?: string | null;
  operationalStatus?: string | null;
  reportType?: string | null;
  integratedAt?: string | null;
  createdAt: string;
}

interface ListResponse { items: DailyReport[]; total: number; }

// ─── Sub-entity Types ─────────────────────────────────────────────────────────

interface EquipmentHourEntry {
  id?: string;
  assetId?: string;
  equipmentLabel: string;
  runningHoursTotal: string;
  inService: boolean;
  standby: boolean;
}

interface MaintenanceEntry {
  id?: string;
  taskTitle: string;
  taskType: string;
  resultStatus: string;
  performedBy: string;
  followUpRequired: boolean;
  maintenancePlanId: string;
  workOrderId: string;
}

interface SpareUsageEntry {
  id?: string;
  spareName: string;
  quantity: string;
  unit: string;
  spareId: string;
}

interface DefectEntry {
  id?: string;
  description: string;
  severitySuggested: string;
  immediateActionTaken: string;
  followUpRequired: boolean;
}

interface FullReport extends DailyReport {
  equipmentHours: EquipmentHourEntry[];
  maintenanceEntries: MaintenanceEntry[];
  spareUsages: SpareUsageEntry[];
  defectEntries: DefectEntry[];
}

// ─── Enums ────────────────────────────────────────────────────────────────────

const STATUSES = ["DRAFT", "SUBMITTED", "REVIEWED", "CLOSED"] as const;
const PORT_CALL_TYPES = ["LOADING", "DISCHARGING", "BUNKERING", "ANCHORAGE", "WAITING", "REPAIR", "OTHER"] as const;
const MAINT_OPPORTUNITIES = ["YES", "LIMITED", "NO", "UNKNOWN"] as const;
const SPARES_OPTIONS = ["YES", "NO", "UNKNOWN"] as const;
const TASK_TYPES = ["PREVENTIVE", "CORRECTIVE", "INSPECTION", "CLASS", "CONDITION_BASED"] as const;
const RESULT_STATUSES = ["COMPLETED", "COMPLETED_WITH_OBSERVATIONS", "NOT_COMPLETED"] as const;
const DEFECT_SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

// ─── Shared Styles ────────────────────────────────────────────────────────────

const inputCls  = "w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white placeholder-text-industrial/30 focus:outline-none focus:border-accent/50";
const selectCls = "w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-accent/50";
const labelCls  = "block text-[10px] font-semibold text-text-industrial/60 uppercase tracking-wider";

// ─── Equipment Hours Tab ──────────────────────────────────────────────────────

const EquipmentHoursTab: React.FC<{ reportId: string; vesselCode: string; disabled: boolean }> = ({ reportId, vesselCode, disabled }) => {
  const t = useT();
  const { data, loading, reload } = useFetch<{ equipmentHours: EquipmentHourEntry[] }>(
    `/app/daily-reports/${reportId}/full`,
    [reportId],
  );
  const { data: assetsData } = useFetch<{ items: Array<{ id: string; name: string }> }>(
    `/app/pms/assets?vesselCode=${vesselCode}&trackDailyReport=true`,
    [vesselCode],
  );
  const [rows, setRows] = useState<EquipmentHourEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!data || !assetsData) return;
    const assets = assetsData.items ?? [];
    if (assets.length === 0) {
      // Sin assets configurados: mostrar lo guardado tal cual
      setRows((data.equipmentHours ?? []).map(e => ({ ...e, runningHoursTotal: String(e.runningHoursTotal ?? "") })));
      return;
    }
    // Assets como fuente de verdad: merge con horas guardadas por nombre
    const savedMap = new Map((data.equipmentHours ?? []).map(e => [e.equipmentLabel, e]));
    setRows(assets.map(a => {
      const saved = savedMap.get(a.name);
      return {
        assetId: a.id,
        equipmentLabel: a.name,
        runningHoursTotal: String(saved?.runningHoursTotal ?? ""),
        inService: saved?.inService ?? true,
        standby: saved?.standby ?? false,
      };
    }));
  }, [data, assetsData]);

  const addRow = () => setRows(r => [...r, { equipmentLabel: "", runningHoursTotal: "", inService: true, standby: false }]);
  const removeRow = (i: number) => setRows(r => r.filter((_, idx) => idx !== i));
  const updateRow = (i: number, key: keyof EquipmentHourEntry, value: unknown) =>
    setRows(r => r.map((row, idx) => idx === i ? { ...row, [key]: value } : row));

  const save = async () => {
    setSaving(true); setErr(null);
    try {
      await api.put(`/app/daily-reports/${reportId}/equipment-hours`, {
        entries: rows.map(r => ({
          assetId: r.assetId ?? null,
          equipmentLabel: r.equipmentLabel,
          runningHoursTotal: r.runningHoursTotal ? Number(r.runningHoursTotal) : 0,
          inService: r.inService,
          standby: r.standby,
        })),
      });
      await reload();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t("common.saveError"));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-accent" /></div>;

  return (
    <div className="space-y-3">
      {rows.map((row, i) => (
        <div key={i} className="grid grid-cols-4 gap-2 items-end bg-white/3 border border-white/8 rounded-xl p-3">
          <div className="col-span-2 space-y-1">
            <label className={labelCls}>Equipo</label>
            <input value={row.equipmentLabel} onChange={e => updateRow(i, "equipmentLabel", e.target.value)} disabled={disabled} placeholder="Motor principal #1" className={inputCls} />
          </div>
          <div className="space-y-1">
            <label className={labelCls}>Hs. Acumuladas</label>
            <input type="number" value={row.runningHoursTotal} onChange={e => updateRow(i, "runningHoursTotal", e.target.value)} disabled={disabled} placeholder="0" className={inputCls} />
          </div>
          <div className="flex items-end justify-center">
            <label className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${row.inService ? "bg-green-500/20 border-green-500/40 text-green-400" : "bg-white/5 border-white/10 text-text-industrial/40"} ${disabled ? "cursor-default" : "hover:brightness-110"}`}>
              <input type="checkbox" checked={row.inService} onChange={e => updateRow(i, "inService", e.target.checked)} disabled={disabled} className="hidden" />
              <span className={`w-3.5 h-3.5 rounded border-2 flex items-center justify-center shrink-0 ${row.inService ? "bg-green-500 border-green-500" : "border-white/30"}`}>
                {row.inService && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 12 12"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
              </span>
              <span className="text-xs font-semibold whitespace-nowrap">En servicio</span>
            </label>
          </div>
        </div>
      ))}
      {rows.length === 0 && <p className="text-xs text-text-industrial/30 text-center py-4">{t("common.noData")}</p>}
      {err && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{err}</p>}
      {!disabled && (
        <div className="flex justify-end pt-1">
          <button onClick={() => { void save(); }} disabled={saving} className="px-3 py-1.5 rounded-lg bg-accent text-primary-bg font-bold text-xs hover:brightness-110 disabled:opacity-50 flex items-center gap-1.5">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t("common.save")}
          </button>
        </div>
      )}
    </div>
  );
};

// ─── Maintenance Entries Tab ──────────────────────────────────────────────────

const MaintenanceTab: React.FC<{ reportId: string; disabled: boolean }> = ({ reportId, disabled }) => {
  const t = useT();
  const { data, loading, reload } = useFetch<{ maintenanceEntries: MaintenanceEntry[] }>(
    `/app/daily-reports/${reportId}/full`,
    [reportId],
  );
  const [rows, setRows] = useState<MaintenanceEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (data?.maintenanceEntries) setRows(data.maintenanceEntries);
  }, [data]);

  const addRow = () => setRows(r => [...r, { taskTitle: "", taskType: "PREVENTIVE", resultStatus: "COMPLETED", performedBy: "", followUpRequired: false, maintenancePlanId: "", workOrderId: "" }]);
  const removeRow = (i: number) => setRows(r => r.filter((_, idx) => idx !== i));
  const updateRow = (i: number, key: keyof MaintenanceEntry, value: unknown) =>
    setRows(r => r.map((row, idx) => idx === i ? { ...row, [key]: value } : row));

  const save = async () => {
    setSaving(true); setErr(null);
    try {
      await api.put(`/app/daily-reports/${reportId}/maintenance-entries`, {
        entries: rows.map(r => ({
          taskTitle: r.taskTitle,
          taskType: r.taskType,
          resultStatus: r.resultStatus,
          performedBy: r.performedBy,
          followUpRequired: r.followUpRequired,
          maintenancePlanId: r.maintenancePlanId || null,
          workOrderId: r.workOrderId || null,
        })),
      });
      await reload();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t("common.saveError"));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-accent" /></div>;

  return (
    <div className="space-y-3">
      {rows.map((row, i) => (
        <div key={i} className="bg-white/3 border border-white/8 rounded-xl p-3 space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2 space-y-1">
              <label className={labelCls}>Tarea realizada</label>
              <input value={row.taskTitle} onChange={e => updateRow(i, "taskTitle", e.target.value)} disabled={disabled} placeholder="Descripción de la tarea..." className={inputCls} />
            </div>
            <div className="space-y-1">
              <label className={labelCls}>Tipo</label>
              <select value={row.taskType} onChange={e => updateRow(i, "taskType", e.target.value)} disabled={disabled} className={selectCls}>
                {TASK_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <label className={labelCls}>Resultado</label>
              <select value={row.resultStatus} onChange={e => updateRow(i, "resultStatus", e.target.value)} disabled={disabled} className={selectCls}>
                {RESULT_STATUSES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className={labelCls}>Ejecutado por</label>
              <input value={row.performedBy} onChange={e => updateRow(i, "performedBy", e.target.value)} disabled={disabled} placeholder="Nombre del técnico" className={inputCls} />
            </div>
            <div className="flex items-end justify-between gap-2 pb-0.5">
              <label className="flex items-center gap-1.5 text-[10px] text-text-industrial/60 cursor-pointer">
                <input type="checkbox" checked={row.followUpRequired} onChange={e => updateRow(i, "followUpRequired", e.target.checked)} disabled={disabled} className="rounded" />
                Requiere seguimiento
              </label>
              {!disabled && (
                <button onClick={() => removeRow(i)} className="text-red-400 hover:text-red-300 transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      ))}
      {rows.length === 0 && <p className="text-xs text-text-industrial/30 text-center py-4">{t("common.noData")}</p>}
      {err && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{err}</p>}
      {!disabled && (
        <div className="flex items-center gap-2 pt-1">
          <button onClick={addRow} className="flex items-center gap-1.5 text-xs text-accent hover:text-accent/80 transition-colors">
            <Plus className="w-3.5 h-3.5" /> Agregar tarea
          </button>
          <button onClick={() => { void save(); }} disabled={saving} className="ml-auto px-3 py-1.5 rounded-lg bg-accent text-primary-bg font-bold text-xs hover:brightness-110 disabled:opacity-50 flex items-center gap-1.5">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t("common.save")}
          </button>
        </div>
      )}
    </div>
  );
};

// ─── Spare Usages Tab ─────────────────────────────────────────────────────────

const SpareUsageTab: React.FC<{ reportId: string; disabled: boolean }> = ({ reportId, disabled }) => {
  const t = useT();
  const { data, loading, reload } = useFetch<{ spareUsages: SpareUsageEntry[] }>(
    `/app/daily-reports/${reportId}/full`,
    [reportId],
  );
  const [rows, setRows] = useState<SpareUsageEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (data?.spareUsages) setRows(data.spareUsages.map(e => ({ ...e, quantity: String(e.quantity ?? "") })));
  }, [data]);

  const addRow = () => setRows(r => [...r, { spareName: "", quantity: "", unit: "UN", spareId: "" }]);
  const removeRow = (i: number) => setRows(r => r.filter((_, idx) => idx !== i));
  const updateRow = (i: number, key: keyof SpareUsageEntry, value: unknown) =>
    setRows(r => r.map((row, idx) => idx === i ? { ...row, [key]: value } : row));

  const save = async () => {
    setSaving(true); setErr(null);
    try {
      await api.put(`/app/daily-reports/${reportId}/spare-usages`, {
        entries: rows.map(r => ({
          spareName: r.spareName,
          quantity: r.quantity ? Number(r.quantity) : 0,
          unit: r.unit,
          spareId: r.spareId || null,
        })),
      });
      await reload();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t("common.saveError"));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-accent" /></div>;

  return (
    <div className="space-y-3">
      {rows.map((row, i) => (
        <div key={i} className="grid grid-cols-4 gap-2 items-end bg-white/3 border border-white/8 rounded-xl p-3">
          <div className="col-span-2 space-y-1">
            <label className={labelCls}>Repuesto</label>
            <input value={row.spareName} onChange={e => updateRow(i, "spareName", e.target.value)} disabled={disabled} placeholder="Nombre del repuesto" className={inputCls} />
          </div>
          <div className="space-y-1">
            <label className={labelCls}>Cantidad</label>
            <input type="number" value={row.quantity} onChange={e => updateRow(i, "quantity", e.target.value)} disabled={disabled} placeholder="0" className={inputCls} />
          </div>
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1">
              <label className={labelCls}>Unidad</label>
              <input value={row.unit} onChange={e => updateRow(i, "unit", e.target.value)} disabled={disabled} placeholder="UN" className={inputCls} />
            </div>
            {!disabled && (
              <button onClick={() => removeRow(i)} className="text-red-400 hover:text-red-300 transition-colors pb-1.5">
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      ))}
      {rows.length === 0 && <p className="text-xs text-text-industrial/30 text-center py-4">{t("common.noData")}</p>}
      {err && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{err}</p>}
      {!disabled && (
        <div className="flex items-center gap-2 pt-1">
          <button onClick={addRow} className="flex items-center gap-1.5 text-xs text-accent hover:text-accent/80 transition-colors">
            <Plus className="w-3.5 h-3.5" /> Agregar repuesto
          </button>
          <button onClick={() => { void save(); }} disabled={saving} className="ml-auto px-3 py-1.5 rounded-lg bg-accent text-primary-bg font-bold text-xs hover:brightness-110 disabled:opacity-50 flex items-center gap-1.5">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t("common.save")}
          </button>
        </div>
      )}
    </div>
  );
};

// ─── Defect Entries Tab ───────────────────────────────────────────────────────

const DefectEntriesTab: React.FC<{ reportId: string; disabled: boolean }> = ({ reportId, disabled }) => {
  const t = useT();
  const { data, loading, reload } = useFetch<{ defectEntries: DefectEntry[] }>(
    `/app/daily-reports/${reportId}/full`,
    [reportId],
  );
  const [rows, setRows] = useState<DefectEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (data?.defectEntries) setRows(data.defectEntries);
  }, [data]);

  const addRow = () => setRows(r => [...r, { description: "", severitySuggested: "MEDIUM", immediateActionTaken: "", followUpRequired: true }]);
  const removeRow = (i: number) => setRows(r => r.filter((_, idx) => idx !== i));
  const updateRow = (i: number, key: keyof DefectEntry, value: unknown) =>
    setRows(r => r.map((row, idx) => idx === i ? { ...row, [key]: value } : row));

  const save = async () => {
    setSaving(true); setErr(null);
    try {
      await api.put(`/app/daily-reports/${reportId}/defect-entries`, {
        entries: rows.map(r => ({
          description: r.description,
          severitySuggested: r.severitySuggested || null,
          immediateActionTaken: r.immediateActionTaken,
          followUpRequired: r.followUpRequired,
        })),
      });
      await reload();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t("common.saveError"));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-accent" /></div>;

  return (
    <div className="space-y-3">
      {rows.map((row, i) => (
        <div key={i} className="bg-white/3 border border-white/8 rounded-xl p-3 space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2 space-y-1">
              <label className={labelCls}>Descripción del defecto</label>
              <input value={row.description} onChange={e => updateRow(i, "description", e.target.value)} disabled={disabled} placeholder="Descripción..." className={inputCls} />
            </div>
            <div className="space-y-1">
              <label className={labelCls}>Severidad</label>
              <select value={row.severitySuggested} onChange={e => updateRow(i, "severitySuggested", e.target.value)} disabled={disabled} className={selectCls}>
                {DEFECT_SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2 space-y-1">
              <label className={labelCls}>Acción inmediata tomada</label>
              <input value={row.immediateActionTaken} onChange={e => updateRow(i, "immediateActionTaken", e.target.value)} disabled={disabled} placeholder="Acción tomada..." className={inputCls} />
            </div>
            <div className="flex items-end justify-between gap-2 pb-0.5">
              <label className="flex items-center gap-1.5 text-[10px] text-text-industrial/60 cursor-pointer">
                <input type="checkbox" checked={row.followUpRequired} onChange={e => updateRow(i, "followUpRequired", e.target.checked)} disabled={disabled} className="rounded" />
                Requiere seguimiento
              </label>
              {!disabled && (
                <button onClick={() => removeRow(i)} className="text-red-400 hover:text-red-300 transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      ))}
      {rows.length === 0 && <p className="text-xs text-text-industrial/30 text-center py-4">{t("common.noData")}</p>}
      {err && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{err}</p>}
      {!disabled && (
        <div className="flex items-center gap-2 pt-1">
          <button onClick={addRow} className="flex items-center gap-1.5 text-xs text-accent hover:text-accent/80 transition-colors">
            <Plus className="w-3.5 h-3.5" /> Agregar defecto
          </button>
          <button onClick={() => { void save(); }} disabled={saving} className="ml-auto px-3 py-1.5 rounded-lg bg-accent text-primary-bg font-bold text-xs hover:brightness-110 disabled:opacity-50 flex items-center gap-1.5">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t("common.save")}
          </button>
        </div>
      )}
    </div>
  );
};

// ─── Detail Drawer ────────────────────────────────────────────────────────────

interface DetailDrawerProps {
  report: DailyReport | null;
  onClose: () => void;
  onSaved: () => void;
}

const DETAIL_TABS = [
  { key: "info",        label: "Info" },
  { key: "equipment",   label: "Horas equipo" },
  { key: "maintenance", label: "Mantenimiento" },
  { key: "spares",      label: "Repuestos" },
  { key: "defects",     label: "Defectos" },
];

const DailyReportDetailDrawer: React.FC<DetailDrawerProps> = ({ report, onClose, onSaved }) => {
  const t = useT();
  const isNew = report === null;
  const [activeTab, setActiveTab] = useState("info");
  const [integrating, setIntegrating] = useState(false);
  const [integrateResult, setIntegrateResult] = useState<{ suggestions?: unknown[] } | null>(null);
  const [integrateError, setIntegrateError] = useState<string | null>(null);

  // New-mode fields
  const [newVesselCode, setNewVesselCode] = useState("");
  const [newReportDate, setNewReportDate] = useState(new Date().toISOString().slice(0, 10));
  const [vessels, setVessels]             = useState<{ code: string; name: string }[]>([]);
  useEffect(() => {
    if (!isNew) return;
    api.get<{ items: { code: string; name: string }[] }>("/app/vessels")
      .then(r => setVessels(r.items ?? []))
      .catch(() => {});
  }, [isNew]);

  // Info tab local state
  const [status, setStatus]           = useState(report?.status ?? "DRAFT");
  const [summary, setSummary]         = useState(report?.summary ?? "");
  const [currentPort, setCurrentPort] = useState(report?.currentPort ?? "");
  const [nextPort, setNextPort]       = useState(report?.nextPort ?? "");
  const [etaNextPort, setEtaNextPort] = useState(report?.etaNextPort ? report.etaNextPort.slice(0, 10) : "");
  const [maintOpp, setMaintOpp]       = useState(report?.maintenanceOpportunity ?? "UNKNOWN");
  const [spares, setSpares]           = useState(report?.sparesReceiptPossible ?? "UNKNOWN");
  const [opRemarks, setOpRemarks]     = useState(report?.operationalRemarks ?? "");
  const [saving, setSaving]           = useState(false);
  const [saveError, setSaveError]     = useState<string | null>(null);

  const isClosed = !isNew && (report!.status === "CLOSED" || !!report!.integratedAt);
  const canIntegrate = !isNew && report!.status === "SUBMITTED" && !report!.integratedAt;

  const saveInfo = async () => {
    setSaving(true); setSaveError(null);
    try {
      const payload = {
        status,
        summary: summary.trim() || null,
        currentPort: currentPort.trim() || null,
        nextPort: nextPort.trim() || null,
        etaNextPort: etaNextPort || null,
        maintenanceOpportunity: maintOpp,
        sparesReceiptPossible: spares,
        operationalRemarks: opRemarks.trim() || null,
      };
      if (isNew) {
        if (!newVesselCode) { setSaveError("Seleccionar embarcación."); setSaving(false); return; }
        await api.post("/app/daily-reports", {
          vesselCode: newVesselCode.trim().toUpperCase(),
          reportDate: newReportDate,
          ...payload,
        });
      } else {
        await api.patch(`/app/daily-reports/${report!.id}`, payload);
      }
      onSaved();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : t("common.saveError"));
    } finally {
      setSaving(false);
    }
  };

  const handleIntegrate = async () => {
    setIntegrating(true); setIntegrateError(null);
    try {
      const result = await api.post<{ suggestions: unknown[] }>(`/app/daily-reports/${report.id}/confirm-and-integrate`, {});
      setIntegrateResult(result);
      onSaved();
    } catch (err) {
      setIntegrateError(err instanceof ApiError ? err.message : t("common.saveError"));
    } finally {
      setIntegrating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm">
      <div
        className="w-full sm:max-w-3xl bg-[#0D1B2A] border border-white/10 sm:rounded-2xl shadow-2xl flex flex-col max-h-[95vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0">
          <div>
            {isNew ? (
              <h2 className="text-base font-bold text-white">Nuevo Reporte Diario</h2>
            ) : (
              <>
                <h2 className="text-base font-bold text-white">Reporte Diario — {report!.vesselCode}</h2>
                <p className="text-[10px] text-text-industrial/40">{fmtDate(report!.reportDate)} · {report!.status}{report!.integratedAt ? " · INTEGRADO" : ""}</p>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            {canIntegrate && (
              <button
                onClick={() => { void handleIntegrate(); }}
                disabled={integrating}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-success-sea text-primary-bg font-bold text-xs hover:brightness-110 disabled:opacity-50 transition-all"
              >
                {integrating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                Confirmar e Integrar
              </button>
            )}
            <button onClick={onClose} className="text-text-industrial/40 hover:text-white transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {integrateError && (
          <div className="px-6 py-2 bg-red-500/10 border-b border-red-500/20">
            <p className="text-xs text-red-400">{integrateError}</p>
          </div>
        )}
        {integrateResult && (
          <div className="px-6 py-2 bg-success-sea/10 border-b border-success-sea/20">
            <p className="text-xs text-success-sea">
              Reporte integrado. {(integrateResult.suggestions as unknown[])?.length ?? 0} sugerencias generadas.
            </p>
          </div>
        )}

        {/* Tabs */}
        <div className="flex items-center gap-1 px-6 border-b border-white/10 shrink-0">
          {DETAIL_TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-3 py-2.5 text-xs font-semibold border-b-2 transition-all ${
                activeTab === tab.key
                  ? "border-accent text-white"
                  : "border-transparent text-text-industrial/50 hover:text-white"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === "info" && (
            <div className="space-y-4">
              {isNew && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className={labelCls}>Embarcación *</label>
                    <select value={newVesselCode} onChange={e => setNewVesselCode(e.target.value)} className={selectCls}>
                      <option value="">— Seleccionar —</option>
                      {vessels.map(v => <option key={v.code} value={v.code}>{v.code} — {v.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className={labelCls}>Fecha *</label>
                    <input type="date" value={newReportDate} onChange={e => setNewReportDate(e.target.value)} className={inputCls} />
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className={labelCls}>Estado</label>
                  <select value={status} onChange={e => setStatus(e.target.value)} disabled={isClosed} className={selectCls}>
                    {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className={labelCls}>Puerto actual</label>
                  <input value={currentPort} onChange={e => setCurrentPort(e.target.value)} disabled={isClosed} placeholder="Buenos Aires" className={inputCls} />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className={labelCls}>Resumen</label>
                <textarea value={summary} onChange={e => setSummary(e.target.value)} disabled={isClosed} rows={3} className={inputCls} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className={labelCls}>Próximo puerto</label>
                  <input value={nextPort} onChange={e => setNextPort(e.target.value)} disabled={isClosed} placeholder="Puerto destino" className={inputCls} />
                </div>
                <div className="space-y-1.5">
                  <label className={labelCls}>ETA próximo puerto</label>
                  <input type="date" value={etaNextPort} onChange={e => setEtaNextPort(e.target.value)} disabled={isClosed} className={inputCls} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className={labelCls}>Oportunidad de mantenimiento</label>
                  <select value={maintOpp} onChange={e => setMaintOpp(e.target.value)} disabled={isClosed} className={selectCls}>
                    {MAINT_OPPORTUNITIES.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className={labelCls}>Recepción de repuestos</label>
                  <select value={spares} onChange={e => setSpares(e.target.value)} disabled={isClosed} className={selectCls}>
                    {SPARES_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
              </div>
              <div className="space-y-1.5">
                <label className={labelCls}>Comentarios operativos</label>
                <input value={opRemarks} onChange={e => setOpRemarks(e.target.value)} disabled={isClosed} className={inputCls} />
              </div>
              {saveError && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{saveError}</p>}
              {!isClosed && (
                <div className="flex justify-end">
                  <button onClick={() => { void saveInfo(); }} disabled={saving} className="px-4 py-2 rounded-lg bg-accent text-primary-bg font-bold text-xs hover:brightness-110 disabled:opacity-50 flex items-center gap-1.5">
                    {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t("common.save")}
                  </button>
                </div>
              )}
            </div>
          )}
          {activeTab !== "info" && isNew && (
            <p className="text-xs text-text-industrial/40 text-center py-8">Guardá la información básica primero para habilitar esta sección.</p>
          )}
          {!isNew && activeTab === "equipment"   && <EquipmentHoursTab reportId={report!.id} vesselCode={report!.vesselCode} disabled={isClosed} />}
          {!isNew && activeTab === "maintenance" && <MaintenanceTab    reportId={report!.id} disabled={isClosed} />}
          {!isNew && activeTab === "spares"      && <SpareUsageTab     reportId={report!.id} disabled={isClosed} />}
          {!isNew && activeTab === "defects"     && <DefectEntriesTab  reportId={report!.id} disabled={isClosed} />}
        </div>
      </div>
    </div>
  );
};

// ─── Page ─────────────────────────────────────────────────────────────────────

const STATUS_OPTIONS = ["DRAFT", "SUBMITTED", "REVIEWED", "CLOSED"];

export const DailyReportsPage: React.FC = () => {
  const t = useT();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const vesselFilter = searchParams.get("vesselCode") ?? "";
  const statusFilter = searchParams.get("status") ?? "";

  const setFilter = (key: string, value: string) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value); else next.delete(key);
      return next;
    });
  };

  const params = new URLSearchParams();
  if (vesselFilter) params.set("vesselCode", vesselFilter);
  if (statusFilter) params.set("status", statusFilter);
  const path = `/app/daily-reports${params.size ? `?${params}` : ""}`;

  const { data, loading, error, reload } = useFetch<ListResponse>(path, [vesselFilter, statusFilter]);
  const [detailReport, setDetailReport] = useState<DailyReport | null | "new">(null);

  useCopilotEmitter(!detailReport ? { module: "DAILY_REPORTS", screen: "DAILY_REPORT_LIST" } : {
    module: "DAILY_REPORTS",
    screen: detailReport === "new" ? "DAILY_REPORT_CREATE" : "DAILY_REPORT_EDIT",
    entityId: detailReport !== "new" ? detailReport.id : undefined,
    entityCode: detailReport !== "new" ? detailReport.reportDate : undefined,
    vesselCode: detailReport !== "new" ? detailReport.vesselCode : undefined,
    workflowStage: detailReport !== "new" ? detailReport.status : undefined,
  });

  const canManage = user?.role === "TENANT_ADMIN"
    || user?.role === "MAINTENANCE_MANAGER"
    || user?.role === "FLEET_SUPERINTENDENT";

  const COLUMNS: Column<DailyReport>[] = [
    {
      key: "reportDate",
      header: t("common.date"),
      render: r => <span className="font-mono font-bold text-white text-xs">{fmtDate(r.reportDate)}</span>,
    },
    {
      key: "vesselCode",
      header: t("col.vessel"),
      render: r => <span className="font-mono text-accent text-xs">{r.vesselCode}</span>,
    },
    {
      key: "status",
      header: t("col.status"),
      render: r => <StatusBadge status={r.status} />,
    },
    {
      key: "currentPort",
      header: "Puerto actual",
      render: r => <span className="text-xs text-text-industrial/60">{r.currentPort ?? r.nextPort ?? "—"}</span>,
    },
    {
      key: "summary",
      header: "Resumen",
      render: r => <span className="text-xs text-text-industrial/60 line-clamp-1">{r.summary ?? "—"}</span>,
    },
    {
      key: "integratedAt",
      header: "Integrado",
      render: r => r.integratedAt
        ? <span className="text-[10px] text-success-sea font-bold">{fmtDate(r.integratedAt)}</span>
        : <span className="text-text-industrial/20 text-xs">—</span>,
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader icon={FileText} title={t("page.dailyReports")} total={data?.total} onReload={reload}>
        <input
          type="text"
          value={vesselFilter}
          onChange={e => setFilter("vesselCode", e.target.value)}
          placeholder={t("common.filterVesselShort")}
          className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-text-industrial placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 w-36"
        />
        <select
          value={toFilterSelectValue(statusFilter)}
          onChange={e => setFilter("status", fromFilterSelectValue(e.target.value))}
          className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-text-industrial focus:outline-none focus:border-accent/50"
        >
          <option value={FILTER_ALL_VALUE}>Todos los estados</option>
          {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        {canManage && (
          <button
            onClick={() => setDetailReport("new")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-primary-bg text-xs font-bold hover:brightness-110 transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            Nuevo reporte
          </button>
        )}
      </PageHeader>

      <DataTable
        columns={COLUMNS}
        data={data?.items ?? null}
        loading={loading}
        error={error}
        keyFn={r => r.id}
        emptyText={t("empty.dailyReports")}
        onRowClick={r => setDetailReport(r)}
      />

      {detailReport !== null && (
        <DailyReportDetailDrawer
          report={detailReport === "new" ? null : detailReport}
          onClose={() => setDetailReport(null)}
          onSaved={() => { setDetailReport(null); reload(); }}
        />
      )}
    </div>
  );
};
