import React, { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  CheckCircle, ClipboardCopy, Droplets, FileText, Loader2, Locate, Plus, Printer, Send, Trash2, X,
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
  oilConsumedLiters?: number | null;
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
  fuelConsumptionLiters: string;
  oilConsumptionLiters: string;
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
  defectCode?: string | null;
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

interface DeferralEntry {
  id: string;
  deferralCode: string;
  status: string;
  deferralType: string | null;
  sourceType: string;
  targetDate: string | null;
  justification: string | null;
  sourceCode?: string | null;
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
  const rowsRef = useRef(rows);
  const isDirtyRef = useRef(false);
  useEffect(() => { rowsRef.current = rows; }, [rows]);

  useEffect(() => {
    if (!data || !assetsData) return;
    const assets = assetsData.items ?? [];
    const saved = data.equipmentHours ?? [];
    if (assets.length === 0) {
      setRows(saved.map(e => ({
        ...e,
        runningHoursTotal: String((e as any).runningHoursTotal ?? ""),
        fuelConsumptionLiters: String((e as any).fuelConsumptionLiters ?? ""),
        oilConsumptionLiters: String((e as any).oilConsumptionLiters ?? ""),
      })));
      return;
    }
    const savedMap = new Map(saved.map(e => [e.equipmentLabel, e]));
    setRows(assets.map(a => {
      const s = savedMap.get(a.name);
      return {
        assetId: a.id,
        equipmentLabel: a.name,
        runningHoursTotal: String((s as any)?.runningHoursTotal ?? ""),
        fuelConsumptionLiters: String((s as any)?.fuelConsumptionLiters ?? ""),
        oilConsumptionLiters: String((s as any)?.oilConsumptionLiters ?? ""),
        inService: (s as any)?.inService ?? true,
        standby: (s as any)?.standby ?? false,
      };
    }));
  }, [data, assetsData]);

  // Auto-save on unmount only if user made changes (guards against StrictMode double-invoke)
  useEffect(() => {
    return () => {
      if (disabled || !isDirtyRef.current || rowsRef.current.length === 0) return;
      const entries = rowsRef.current.map(r => ({
        assetId: r.assetId ?? null,
        equipmentLabel: r.equipmentLabel,
        runningHoursTotal: r.runningHoursTotal !== "" ? Number(r.runningHoursTotal) : null,
        fuelConsumptionLiters: r.fuelConsumptionLiters ? Number(r.fuelConsumptionLiters) : null,
        oilConsumptionLiters: r.oilConsumptionLiters ? Number(r.oilConsumptionLiters) : null,
        inService: r.inService,
        standby: r.standby,
      }));
      void api.put(`/app/daily-reports/${reportId}/equipment-hours`, { entries });
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId, disabled]);

  const addRow = () => { isDirtyRef.current = true; setRows(r => [...r, { equipmentLabel: "", runningHoursTotal: "", fuelConsumptionLiters: "", oilConsumptionLiters: "", inService: true, standby: false }]); };
  const removeRow = (i: number) => { isDirtyRef.current = true; setRows(r => r.filter((_, idx) => idx !== i)); };
  const updateRow = (i: number, key: keyof EquipmentHourEntry, value: unknown) => {
    isDirtyRef.current = true;
    setRows(r => r.map((row, idx) => idx === i ? { ...row, [key]: value } : row));
  };

  const save = async () => {
    setSaving(true); setErr(null);
    try {
      await api.put(`/app/daily-reports/${reportId}/equipment-hours`, {
        entries: rows.map(r => ({
          assetId: r.assetId ?? null,
          equipmentLabel: r.equipmentLabel,
          runningHoursTotal: r.runningHoursTotal !== "" ? Number(r.runningHoursTotal) : null,
          fuelConsumptionLiters: r.fuelConsumptionLiters ? Number(r.fuelConsumptionLiters) : null,
          oilConsumptionLiters: r.oilConsumptionLiters ? Number(r.oilConsumptionLiters) : null,
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
            <input value={row.equipmentLabel} readOnly tabIndex={-1} placeholder="Motor principal #1" className={`${inputCls} cursor-default select-none opacity-70 pointer-events-none`} />
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

// ─── Consumos Tab ─────────────────────────────────────────────────────────────

const ConsumosTab: React.FC<{ reportId: string; disabled: boolean }> = ({ reportId, disabled }) => {
  const t = useT();
  const { data, loading } = useFetch<{ fuelConsumedLiters?: number | null; oilConsumedLiters?: number | null }>(
    `/app/daily-reports/${reportId}`,
    [reportId],
  );
  const [fuelLiters, setFuelLiters] = useState("");
  const [oilLiters, setOilLiters] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!data) return;
    setFuelLiters(data.fuelConsumedLiters != null ? String(data.fuelConsumedLiters) : "");
    setOilLiters(data.oilConsumedLiters != null ? String(data.oilConsumedLiters) : "");
  }, [data]);

  const save = async () => {
    setSaving(true); setErr(null); setSaved(false);
    try {
      await api.patch(`/app/daily-reports/${reportId}`, {
        fuelConsumedLiters: fuelLiters !== "" ? Number(fuelLiters) : null,
        oilConsumedLiters: oilLiters !== "" ? Number(oilLiters) : null,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t("common.saveError"));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-accent" /></div>;

  return (
    <div className="space-y-4 max-w-md">
      <div className="flex items-center gap-2 mb-2">
        <Droplets className="w-4 h-4 text-accent" />
        <h3 className="text-xs font-bold text-white uppercase tracking-wider">Consumos del día</h3>
      </div>
      <div className="bg-white/3 border border-white/8 rounded-xl p-4 space-y-4">
        <div className="space-y-1.5">
          <label className={labelCls}>Combustible consumido (Litros)</label>
          <input
            type="number"
            min="0"
            step="0.1"
            value={fuelLiters}
            onChange={e => setFuelLiters(e.target.value)}
            disabled={disabled}
            placeholder="0"
            className={inputCls}
          />
        </div>
        <div className="space-y-1.5">
          <label className={labelCls}>Aceite consumido (Litros)</label>
          <input
            type="number"
            min="0"
            step="0.1"
            value={oilLiters}
            onChange={e => setOilLiters(e.target.value)}
            disabled={disabled}
            placeholder="0"
            className={inputCls}
          />
        </div>
      </div>
      {err && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{err}</p>}
      {!disabled && (
        <div className="flex justify-end">
          <button
            onClick={() => { void save(); }}
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-accent text-primary-bg font-bold text-xs hover:brightness-110 disabled:opacity-50 flex items-center gap-1.5"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : saved ? <CheckCircle className="w-3.5 h-3.5" /> : null}
            {saved ? "Guardado" : t("common.save")}
          </button>
        </div>
      )}
    </div>
  );
};

// ─── Maintenance Entries Tab ──────────────────────────────────────────────────

const MaintenanceTab: React.FC<{ reportId: string; disabled: boolean; prefillEntries?: MaintenanceEntry[]; suggestions?: any[]; suggestionPeriod?: { from: string | null; to: string } }> = ({ reportId, disabled, prefillEntries, suggestions, suggestionPeriod }) => {
  const t = useT();
  const { data, loading, reload } = useFetch<{ maintenanceEntries: MaintenanceEntry[] }>(
    `/app/daily-reports/${reportId}/full`,
    [reportId],
  );
  const [rows, setRows] = useState<MaintenanceEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [autoSource, setAutoSource] = useState<"period" | "previous" | null>(null);
  const didPrefill = useRef(false);
  const rowsRef = useRef(rows);
  const isDirtyRef = useRef(false);
  useEffect(() => { rowsRef.current = rows; }, [rows]);

  useEffect(() => {
    if (!data) return;
    if (data.maintenanceEntries.length > 0) {
      setRows(data.maintenanceEntries);
      return;
    }
    if (didPrefill.current) return;
    // Wait for suggestions fetch to settle before falling back to prefillEntries.
    // suggestions is `undefined` while loading, array (possibly empty) once loaded.
    if (suggestions === undefined) return;
    // Priority 1: auto-populate from period suggestions (WOs completed since last report).
    if (suggestions.length > 0) {
      didPrefill.current = true;
      isDirtyRef.current = true;
      setRows(suggestions.map((s: any) => ({
        taskTitle: s.taskTitle ?? "", taskType: s.taskType ?? "MAINTENANCE",
        resultStatus: s.resultStatus ?? "COMPLETED", performedBy: s.performedBy ?? "",
        followUpRequired: false,
        maintenancePlanId: s.maintenancePlanId ?? "", workOrderId: s.workOrderId ?? "",
      })));
      setAutoSource("period");
      return;
    }
    // Priority 2: fallback to copy from previous report (template).
    if (prefillEntries && prefillEntries.length > 0) {
      didPrefill.current = true;
      isDirtyRef.current = true;
      setRows(prefillEntries.map(({ id: _id, ...rest }) => rest));
      setAutoSource("previous");
    }
  }, [data, prefillEntries, suggestions]);

  // Auto-save on unmount only if user made changes
  useEffect(() => {
    return () => {
      if (disabled || !isDirtyRef.current || rowsRef.current.length === 0) return;
      const entries = rowsRef.current.map(r => ({
        equipmentLabel: "",
        taskTitle: r.taskTitle, taskType: r.taskType, resultStatus: r.resultStatus,
        performedBy: r.performedBy, followUpRequired: r.followUpRequired,
        maintenancePlanId: r.maintenancePlanId || null, workOrderId: r.workOrderId || null,
      }));
      void api.put(`/app/daily-reports/${reportId}/maintenance-entries`, { entries });
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId, disabled]);

  const addRow = () => { isDirtyRef.current = true; setRows(r => [...r, { taskTitle: "", taskType: "PREVENTIVE", resultStatus: "COMPLETED", performedBy: "", followUpRequired: false, maintenancePlanId: "", workOrderId: "" }]); };
  const removeRow = (i: number) => { isDirtyRef.current = true; setRows(r => r.filter((_, idx) => idx !== i)); };
  const updateRow = (i: number, key: keyof MaintenanceEntry, value: unknown) =>
    setRows(r => r.map((row, idx) => idx === i ? { ...row, [key]: value } : row));

  const save = async () => {
    setSaving(true); setErr(null);
    try {
      await api.put(`/app/daily-reports/${reportId}/maintenance-entries`, {
        entries: rows.map(r => ({
          equipmentLabel: "",
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

  const periodLabel = suggestionPeriod
    ? suggestionPeriod.from ? `${fmtDate(suggestionPeriod.from)} → ${fmtDate(suggestionPeriod.to)}` : `hasta ${fmtDate(suggestionPeriod.to)}`
    : "";

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-accent" /></div>;

  return (
    <div className="space-y-3">
      {autoSource === "period" && (
        <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-accent/5 border border-accent/20">
          <div className="flex items-center gap-2 text-[11px] text-accent/80">
            <ClipboardCopy className="w-3.5 h-3.5 shrink-0" />
            <span><strong>{rows.length}</strong> OT{rows.length !== 1 ? "s" : ""} cargadas automáticamente del período {periodLabel}. Revisá y guardá para confirmar.</span>
          </div>
          <button onClick={() => { setRows([]); setAutoSource(null); }} className="text-[10px] text-white/30 hover:text-white transition-colors shrink-0">Limpiar</button>
        </div>
      )}
      {autoSource === "previous" && (
        <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-accent/5 border border-accent/20">
          <div className="flex items-center gap-2 text-[11px] text-accent/80">
            <ClipboardCopy className="w-3.5 h-3.5 shrink-0" />
            Pre-cargado del reporte anterior. Revisá y guardá para confirmar.
          </div>
          <button onClick={() => { setRows([]); setAutoSource(null); }} className="text-[10px] text-white/30 hover:text-white transition-colors shrink-0">Limpiar</button>
        </div>
      )}
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

const SpareUsageTab: React.FC<{ reportId: string; disabled: boolean; prefillEntries?: SpareUsageEntry[]; suggestions?: any[]; suggestionPeriod?: { from: string | null; to: string } }> = ({ reportId, disabled, prefillEntries, suggestions, suggestionPeriod }) => {
  const t = useT();
  const { data, loading, reload } = useFetch<{ spareUsages: SpareUsageEntry[] }>(
    `/app/daily-reports/${reportId}/full`,
    [reportId],
  );
  const [rows, setRows] = useState<SpareUsageEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [autoSource, setAutoSource] = useState<"period" | "previous" | null>(null);
  const didPrefill = useRef(false);
  const rowsRef = useRef(rows);
  const isDirtyRef = useRef(false);
  useEffect(() => { rowsRef.current = rows; }, [rows]);

  // Auto-save on unmount only if user made changes
  useEffect(() => {
    return () => {
      if (disabled || !isDirtyRef.current || rowsRef.current.length === 0) return;
      const entries = rowsRef.current.map(r => ({
        spareName: r.spareName, quantity: r.quantity ? Number(r.quantity) : 0,
        unit: r.unit, spareId: r.spareId || null,
      }));
      void api.put(`/app/daily-reports/${reportId}/spare-usages`, { entries });
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId, disabled]);

  useEffect(() => {
    if (!data) return;
    if (data.spareUsages.length > 0) {
      setRows(data.spareUsages.map(e => ({ ...e, quantity: String(e.quantity ?? "") })));
      return;
    }
    if (didPrefill.current) return;
    if (suggestions === undefined) return;
    if (suggestions.length > 0) {
      didPrefill.current = true;
      isDirtyRef.current = true;
      setRows(suggestions.map((s: any) => ({
        spareName: s.spareName ?? "", quantity: String(s.quantity ?? ""), unit: s.unit ?? "UN", spareId: s.spareId ?? "",
      })));
      setAutoSource("period");
      return;
    }
    if (prefillEntries && prefillEntries.length > 0) {
      didPrefill.current = true;
      isDirtyRef.current = true;
      setRows(prefillEntries.map(({ id: _id, ...rest }) => ({ ...rest, quantity: String(rest.quantity ?? "") })));
      setAutoSource("previous");
    }
  }, [data, prefillEntries, suggestions]);

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

  const periodLabelS = suggestionPeriod
    ? suggestionPeriod.from ? `${fmtDate(suggestionPeriod.from)} → ${fmtDate(suggestionPeriod.to)}` : `hasta ${fmtDate(suggestionPeriod.to)}`
    : "";

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-accent" /></div>;

  return (
    <div className="space-y-3">
      {autoSource === "period" && (
        <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-accent/5 border border-accent/20">
          <div className="flex items-center gap-2 text-[11px] text-accent/80">
            <ClipboardCopy className="w-3.5 h-3.5 shrink-0" />
            <span><strong>{rows.length}</strong> repuesto{rows.length !== 1 ? "s" : ""} recibido{rows.length !== 1 ? "s" : ""} en el período {periodLabelS}. Revisá y guardá para confirmar.</span>
          </div>
          <button onClick={() => { setRows([]); setAutoSource(null); }} className="text-[10px] text-white/30 hover:text-white transition-colors shrink-0">Limpiar</button>
        </div>
      )}
      {autoSource === "previous" && (
        <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-accent/5 border border-accent/20">
          <div className="flex items-center gap-2 text-[11px] text-accent/80">
            <ClipboardCopy className="w-3.5 h-3.5 shrink-0" />
            Pre-cargado del reporte anterior. Revisá y guardá para confirmar.
          </div>
          <button onClick={() => { setRows([]); setAutoSource(null); }} className="text-[10px] text-white/30 hover:text-white transition-colors shrink-0">Limpiar</button>
        </div>
      )}
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

const DefectEntriesTab: React.FC<{ reportId: string; disabled: boolean; prefillEntries?: DefectEntry[]; suggestions?: any[]; suggestionPeriod?: { from: string | null; to: string } }> = ({ reportId, disabled, prefillEntries, suggestions, suggestionPeriod }) => {
  const t = useT();
  const { data, loading, reload } = useFetch<{ defectEntries: DefectEntry[] }>(
    `/app/daily-reports/${reportId}/full`,
    [reportId],
  );
  const [rows, setRows] = useState<DefectEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [autoSource, setAutoSource] = useState<"period" | "previous" | null>(null);
  const didPrefill = useRef(false);
  const rowsRef = useRef(rows);
  const isDirtyRef = useRef(false);
  useEffect(() => { rowsRef.current = rows; }, [rows]);

  // Auto-save when unmounting (only if user made changes)
  useEffect(() => {
    return () => {
      if (disabled || !isDirtyRef.current || rowsRef.current.length === 0) return;
      const entries = rowsRef.current.map(r => ({
        description: r.description, severitySuggested: r.severitySuggested || null,
        immediateActionTaken: r.immediateActionTaken, followUpRequired: r.followUpRequired,
      }));
      void api.put(`/app/daily-reports/${reportId}/defect-entries`, { entries });
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId, disabled]);

  useEffect(() => {
    if (!data) return;
    if (data.defectEntries.length > 0) {
      setRows(data.defectEntries);
      return;
    }
    if (didPrefill.current) return;
    if (suggestions === undefined) return;
    if (suggestions.length > 0) {
      didPrefill.current = true;
      isDirtyRef.current = true;
      setRows(suggestions.map((s: any) => ({
        description: s.description ?? "", severitySuggested: s.severitySuggested ?? "MEDIUM",
        immediateActionTaken: s.immediateActionTaken ?? "", followUpRequired: s.followUpRequired ?? true,
      })));
      setAutoSource("period");
      return;
    }
    if (prefillEntries && prefillEntries.length > 0) {
      didPrefill.current = true;
      isDirtyRef.current = true;
      setRows(prefillEntries.map(({ id: _id, ...rest }) => rest));
      setAutoSource("previous");
    }
  }, [data, prefillEntries, suggestions]);

  const addRow = () => { isDirtyRef.current = true; setRows(r => [...r, { description: "", severitySuggested: "MEDIUM", immediateActionTaken: "", followUpRequired: true }]); };
  const removeRow = (i: number) => { isDirtyRef.current = true; setRows(r => r.filter((_, idx) => idx !== i)); };
  const updateRow = (i: number, key: keyof DefectEntry, value: unknown) => {
    isDirtyRef.current = true;
    setRows(r => r.map((row, idx) => idx === i ? { ...row, [key]: value } : row));
  };

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

  const periodLabelD = suggestionPeriod
    ? suggestionPeriod.from ? `${fmtDate(suggestionPeriod.from)} → ${fmtDate(suggestionPeriod.to)}` : `hasta ${fmtDate(suggestionPeriod.to)}`
    : "";

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-accent" /></div>;

  return (
    <div className="space-y-3">
      {autoSource === "period" && (
        <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-accent/5 border border-accent/20">
          <div className="flex items-center gap-2 text-[11px] text-accent/80">
            <ClipboardCopy className="w-3.5 h-3.5 shrink-0" />
            <span><strong>{rows.length}</strong> defecto{rows.length !== 1 ? "s" : ""} reportado{rows.length !== 1 ? "s" : ""} en el período {periodLabelD}. Revisá y guardá para confirmar.</span>
          </div>
          <button onClick={() => { setRows([]); setAutoSource(null); }} className="text-[10px] text-white/30 hover:text-white transition-colors shrink-0">Limpiar</button>
        </div>
      )}
      {autoSource === "previous" && (
        <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-accent/5 border border-accent/20">
          <div className="flex items-center gap-2 text-[11px] text-accent/80">
            <ClipboardCopy className="w-3.5 h-3.5 shrink-0" />
            Pre-cargado del reporte anterior. Revisá y guardá para confirmar.
          </div>
          <button onClick={() => { setRows([]); setAutoSource(null); }} className="text-[10px] text-white/30 hover:text-white transition-colors shrink-0">Limpiar</button>
        </div>
      )}
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

// ─── Deferrals Tab ───────────────────────────────────────────────────────────

const DeferralsTab: React.FC<{ vesselCode: string }> = ({ vesselCode }) => {
  const { data, loading, error } = useFetch<{ items: DeferralEntry[] }>(
    `/app/pms/deferrals?vesselCode=${vesselCode}`,
    [vesselCode],
  );

  const active = (data?.items ?? []).filter(d => ACTIVE_DEFERRAL_STATUSES.has(d.status));

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-accent" /></div>;
  if (error)   return <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>;

  return (
    <div className="space-y-3">
      <p className="text-[10px] text-text-industrial/30 pb-1">
        Diferimientos activos del buque al momento del reporte · Gestionados en el módulo Diferimientos
      </p>

      {active.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-text-industrial/20">
          <CheckCircle className="w-6 h-6" />
          <p className="text-xs">Sin diferimientos activos para este buque</p>
        </div>
      ) : (
        <div className="border border-white/10 rounded-xl overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/10 text-[10px] text-white/30 uppercase tracking-wider">
                <th className="px-3 py-2 text-left">Código</th>
                <th className="px-3 py-2 text-left">Estado</th>
                <th className="px-3 py-2 text-left">Tipo origen</th>
                <th className="px-3 py-2 text-left">Referencia</th>
                <th className="px-3 py-2 text-left">Fecha límite</th>
                <th className="px-3 py-2 text-left">Justificación</th>
              </tr>
            </thead>
            <tbody>
              {active.map(d => (
                <tr key={d.id} className="border-b border-white/5 last:border-0 hover:bg-white/2 transition-colors">
                  <td className="px-3 py-2 font-mono text-accent font-bold">{d.deferralCode}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-bold ${DEFERRAL_STATUS_CLS[d.status] ?? "bg-white/5 text-white/40 border-white/10"}`}>
                      {DEFERRAL_STATUS_LABEL[d.status] ?? d.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-white/50">{d.sourceType.replace(/_/g, " ")}</td>
                  <td className="px-3 py-2 font-mono text-white/60">{d.sourceCode ?? "—"}</td>
                  <td className="px-3 py-2 text-white/50">
                    {d.targetDate ? new Date(d.targetDate).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—"}
                  </td>
                  <td className="px-3 py-2 text-white/40 max-w-[180px] truncate">{d.justification ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
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

const ACTIVE_DEFERRAL_STATUSES = new Set(["REQUESTED", "UNDER_REVIEW", "APPROVED", "ACTIVE"]);

const DEFERRAL_STATUS_CLS: Record<string, string> = {
  REQUESTED:    "bg-blue-500/10 text-blue-400 border-blue-500/20",
  UNDER_REVIEW: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  APPROVED:     "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  ACTIVE:       "bg-purple-500/10 text-purple-400 border-purple-500/20",
};

const DEFERRAL_STATUS_LABEL: Record<string, string> = {
  REQUESTED: "Solicitado", UNDER_REVIEW: "En revisión", APPROVED: "Aprobado", ACTIVE: "Activo",
};

const DETAIL_TABS = [
  { key: "info",        label: "Info" },
  { key: "equipment",   label: "Horas equipo" },
  { key: "consumos",    label: "Consumos" },
  { key: "maintenance", label: "Mantenimiento" },
  { key: "spares",      label: "Repuestos" },
  { key: "defects",     label: "Defectos" },
  { key: "deferrals",   label: "Diferimientos" },
];

interface PeriodSuggestions {
  period: { from: string | null; to: string };
  maintenance: unknown[];
  defects: unknown[];
  spares: unknown[];
}

const DailyReportDetailDrawer: React.FC<DetailDrawerProps> = ({ report, onClose, onSaved }) => {
  const t = useT();
  const { tenant } = useAuth();
  const [liveReport, setLiveReport] = useState<DailyReport | null>(report);
  const isNew = liveReport === null;
  const [activeTab, setActiveTab] = useState("info");
  const [prevData, setPrevData] = useState<Pick<FullReport, "maintenanceEntries" | "spareUsages" | "defectEntries"> | null>(null);
  const [suggestions, setSuggestions] = useState<PeriodSuggestions | null>(null);

  const loadPreviousReport = async (vesselCode: string, currentId: string) => {
    try {
      const list = await api.get<{ items: DailyReport[] }>(`/app/daily-reports?vesselCode=${vesselCode}`);
      const prev = list.items.find(r => r.id !== currentId);
      if (!prev) return;
      const full = await api.get<FullReport>(`/app/daily-reports/${prev.id}/full`);
      setPrevData({
        maintenanceEntries: full.maintenanceEntries ?? [],
        spareUsages: full.spareUsages ?? [],
        defectEntries: full.defectEntries ?? [],
      });
    } catch { /* silently ignore */ }
  };

  const loadSuggestions = async (reportId: string) => {
    try {
      const s = await api.get<PeriodSuggestions>(`/app/daily-reports/${reportId}/period-suggestions`);
      setSuggestions(s);
    } catch (e) {
      console.error("[period-suggestions]", e);
      // Settle state to empty so tabs stop waiting and can fall back to previous-report prefill.
      setSuggestions({ period: { from: null, to: "" }, maintenance: [], defects: [], spares: [], deferrals: [] });
    }
  };
  // New-mode fields
  const [newVesselCode, setNewVesselCode] = useState("");
  const [newReportDate, setNewReportDate] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  });
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
  const [posLat, setPosLat]           = useState(report?.positionLat != null ? String(report.positionLat) : "");
  const [posLon, setPosLon]           = useState(report?.positionLon != null ? String(report.positionLon) : "");
  const [geolocating, setGeolocating] = useState(false);
  const [geoError, setGeoError]       = useState<string | null>(null);
  const [mapCoords, setMapCoords]     = useState<{ lat: number; lon: number } | null>(
    report?.positionLat != null && report?.positionLon != null
      ? { lat: report.positionLat, lon: report.positionLon }
      : null,
  );
  const [saving, setSaving]           = useState(false);
  const [saveError, setSaveError]     = useState<string | null>(null);

  const fetchGeoPosition = () => {
    if (!navigator.geolocation) { setGeoError("Geolocalización no disponible."); return; }
    setGeolocating(true); setGeoError(null);
    navigator.geolocation.getCurrentPosition(
      pos => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        setPosLat(lat.toFixed(6));
        setPosLon(lon.toFixed(6));
        setMapCoords({ lat, lon });
        setGeolocating(false);
      },
      err => {
        if (err.code !== 1) setGeoError("No se pudo obtener la ubicación.");
        setGeolocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  useEffect(() => {
    if (isNew && !posLat && !posLon) fetchGeoPosition();
    if (!isNew && liveReport) {
      void loadPreviousReport(liveReport.vesselCode, liveReport.id);
      void loadSuggestions(liveReport.id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isClosed = !isNew && (liveReport!.status === "CLOSED" || !!liveReport!.integratedAt);

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
        positionLat: posLat !== "" ? parseFloat(posLat) : null,
        positionLon: posLon !== "" ? parseFloat(posLon) : null,
      };
      if (isNew) {
        if (!newVesselCode) { setSaveError("Seleccionar embarcación."); setSaving(false); return; }
        const created = await api.post<DailyReport>("/app/daily-reports", {
          vesselCode: newVesselCode.trim().toUpperCase(),
          reportDate: newReportDate,
          ...payload,
        });
        setLiveReport(created);
        setActiveTab("equipment");
        void loadPreviousReport(newVesselCode.trim().toUpperCase(), created.id);
        void loadSuggestions(created.id);
      } else {
        await api.patch(`/app/daily-reports/${liveReport!.id}`, payload);
        onSaved();
      }
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : t("common.saveError"));
    } finally {
      setSaving(false);
    }
  };

  const [submitting, setSubmitting]       = useState(false);
  const [submitResult, setSubmitResult]   = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!liveReport) return;
    setSubmitting(true); setSaveError(null); setSubmitResult(null);
    try {
      await api.patch(`/app/daily-reports/${liveReport.id}`, {
        status: "SUBMITTED",
        summary: summary.trim() || null,
        currentPort: currentPort.trim() || null,
        nextPort: nextPort.trim() || null,
        etaNextPort: etaNextPort || null,
        maintenanceOpportunity: maintOpp,
        sparesReceiptPossible: spares,
        operationalRemarks: opRemarks.trim() || null,
        positionLat: posLat !== "" ? parseFloat(posLat) : null,
        positionLon: posLon !== "" ? parseFloat(posLon) : null,
      });
      setStatus("SUBMITTED");
      const result = await api.post<{
        updatedRunningHoursCount: number;
        recalculatedPlansCount: number;
        closedDueItemsCount: number;
      }>(`/app/daily-reports/${liveReport.id}/confirm-and-integrate`);
      const parts: string[] = [];
      if (result.updatedRunningHoursCount > 0) parts.push(`${result.updatedRunningHoursCount} plan(es) de horas actualizados`);
      if (result.recalculatedPlansCount > 0)   parts.push(`${result.recalculatedPlansCount} planes recalculados`);
      if (result.closedDueItemsCount > 0)       parts.push(`${result.closedDueItemsCount} tarea(s) cerradas`);
      setSubmitResult(parts.length > 0 ? parts.join(" · ") : "Integrado correctamente.");
      const fresh = await api.get<DailyReport>(`/app/daily-reports/${liveReport.id}`);
      setLiveReport(fresh);
      onSaved();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Error al enviar el reporte.");
    } finally {
      setSubmitting(false);
    }
  };

  const [generatingPdf, setGeneratingPdf] = useState(false);

  const generatePdf = async () => {
    if (!liveReport) return;
    setGeneratingPdf(true);
    // Wait for auto-save on tab unmount to complete before fetching
    await new Promise(r => setTimeout(r, 800));
    try {
      const [full, deferralsRes] = await Promise.all([
        api.get<FullReport & { oilConsumedLiters?: number | null }>(`/app/daily-reports/${liveReport.id}/full`),
        api.get<{ items: DeferralEntry[] }>(`/app/pms/deferrals?vesselCode=${encodeURIComponent(liveReport.vesselCode)}`).catch(() => ({ items: [] as DeferralEntry[] })),
      ]);
      const gen = new Date().toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

      const lat = (full as any).positionLat as number | null | undefined;
      const lon = (full as any).positionLon as number | null | undefined;
      const hasPos = lat != null && lon != null;

      const rawLogoUrl = tenant?.logoUrlLight || tenant?.logoUrl || null;
      let tenantLogoUrl: string | null = rawLogoUrl;
      if (rawLogoUrl) {
        try {
          const res = await fetch(rawLogoUrl);
          const blob = await res.blob();
          tenantLogoUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        } catch {
          tenantLogoUrl = rawLogoUrl;
        }
      }

      const esc = (v: unknown) =>
        String(v ?? "—").replace(/ð/g, "").replace(/[☐☑☒□■✓✔✘]/g, "☐");

      const rows = {
        equipment: (full.equipmentHours ?? []).map(e => `
          <tr>
            <td>${esc(e.equipmentLabel)}</td>
            <td>${esc(e.runningHoursTotal)}</td>
            <td>${esc((e as any).fuelConsumptionLiters)}</td>
            <td>${esc((e as any).oilConsumptionLiters)}</td>
            <td>${e.inService ? "Sí" : "No"}</td>
          </tr>`).join(""),
        maintenance: (full.maintenanceEntries ?? []).map(m => `
          <tr>
            <td>${esc((m as any).taskCode ?? (m as any).maintenancePlanId ?? (m as any).workOrderId)}</td>
            <td>${esc(m.taskTitle)}</td>
            <td>${esc(m.taskType)}</td>
            <td>${esc(m.resultStatus)}</td>
            <td>${esc(m.performedBy)}</td>
          </tr>`).join(""),
        spares: (full.spareUsages ?? []).map(s => `
          <tr>
            <td>${esc(s.spareName)}</td>
            <td>${esc(s.quantity)}</td>
            <td>${esc(s.unit)}</td>
          </tr>`).join(""),
        defects: (full.defectEntries ?? []).map(d => `
          <tr>
            <td style="white-space:nowrap;font-family:monospace;font-weight:bold;color:#111">${esc(d.defectCode)}</td>
            <td>${esc(d.description)}</td>
            <td>${esc(d.severitySuggested)}</td>
            <td>${esc(d.immediateActionTaken)}</td>
          </tr>`).join(""),
        deferrals: (deferralsRes.items ?? []).map(d => {
          const statusMap: Record<string, string> = {
            REQUESTED: "Solicitado", UNDER_REVIEW: "En revisión", APPROVED: "Aprobado",
            ACTIVE: "Activo", CLOSED: "Cerrado", EXPIRED: "Vencido", REJECTED: "Rechazado",
          };
          return `<tr>
            <td>${esc(d.deferralCode)}</td>
            <td>${esc(d.sourceCode ?? d.sourceType)}</td>
            <td>${esc(statusMap[d.status] ?? d.status)}</td>
            <td>${d.targetDate ? new Date(d.targetDate).toLocaleDateString("es-AR") : "—"}</td>
            <td>${esc(d.justification)}</td>
          </tr>`;
        }).join(""),
      };

      const cmsLogoUrl = `${window.location.origin}/logo.png`;
      const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Reporte Diario — ${liveReport.vesselCode}</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,sans-serif;font-size:10pt;color:#111;padding:20mm 18mm}
  .meta{display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;margin-bottom:14px;font-size:9pt}
  .meta span{color:#555}
  .meta strong{color:#111}
  h2{font-size:10pt;font-weight:bold;margin:14px 0 4px;border-bottom:1px solid #ccc;padding-bottom:2px}
  table{width:100%;border-collapse:collapse;margin-bottom:8px;font-size:8.5pt}
  th{background:#f0f0f0;text-align:left;padding:3px 6px;border:1px solid #ccc;font-size:8pt}
  td{padding:3px 6px;border:1px solid #e0e0e0}
  .consumos{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px}
  .consumos-card{border:1px solid #ddd;border-radius:4px;padding:8px 12px}
  .consumos-card .label{font-size:8pt;color:#555;margin-bottom:2px}
  .consumos-card .value{font-size:14pt;font-weight:bold}
  .pos-block{display:flex;gap:16px;align-items:flex-start;margin-bottom:12px}
  .pos-coords{font-size:9pt;color:#333;min-width:160px}
  .pos-coords .label{font-size:7.5pt;color:#888;margin-bottom:2px}
  .pos-coords .val{font-size:11pt;font-weight:bold;font-family:monospace}
  .footer{margin-top:16px;padding-top:6px;border-top:1px solid #ddd;font-size:7.5pt;color:#888;display:flex;align-items:center;gap:8px}
  @media print{body{padding:12mm 14mm}}
</style></head><body>
<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:16px;padding-bottom:12px;border-bottom:2px solid #cbd5e1">
  <div style="display:flex;align-items:flex-start;gap:10px">
    <div style="width:4px;background:#1e40af;border-radius:2px;min-height:60px;flex-shrink:0"></div>
    <div>
      <div style="font-size:18pt;font-weight:bold;color:#0f2744;line-height:1.1">REPORTE DIARIO</div>
      <div style="font-size:13pt;font-weight:bold;color:#0f2744;margin-top:3px">${liveReport.vesselCode} · ${fmtDate(liveReport.reportDate)}</div>
      <div style="font-size:8pt;color:#64748b;margin-top:4px">Generado: ${gen} · Estado: ${liveReport.status}${liveReport.integratedAt ? " · INTEGRADO" : ""}</div>
    </div>
  </div>
  ${tenantLogoUrl ? `<img src="${tenantLogoUrl}" style="max-height:60px;max-width:130px;object-fit:contain;flex-shrink:0" />` : ""}
</div>
<div class="meta">
  <div><span>Puerto actual: </span><strong>${liveReport.currentPort ?? "—"}</strong></div>
  <div><span>Próximo puerto: </span><strong>${liveReport.nextPort ?? "—"}</strong></div>
  <div><span>ETA: </span><strong>${liveReport.etaNextPort ? fmtDate(liveReport.etaNextPort) : "—"}</strong></div>
  <div><span>Tipo de escala: </span><strong>${liveReport.portCallType ?? "—"}</strong></div>
  <div><span>Oportunidad mantenimiento: </span><strong>${liveReport.maintenanceOpportunity ?? "—"}</strong></div>
  <div><span>Recepción repuestos: </span><strong>${liveReport.sparesReceiptPossible ?? "—"}</strong></div>
</div>
${liveReport.summary ? `<p style="font-size:9pt;margin-bottom:12px;color:#333">${liveReport.summary}</p>` : ""}

${hasPos ? `
<h2>Posición</h2>
<div class="pos-block">
  <div style="display:flex;gap:16px;margin-bottom:8px">
    <div class="pos-coords"><div class="label">LATITUD</div><div class="val">${lat!.toFixed(5)}°</div></div>
    <div class="pos-coords"><div class="label">LONGITUD</div><div class="val">${lon!.toFixed(5)}°</div></div>
  </div>
  <div id="map" style="width:100%;height:200px;border:1px solid #ddd;border-radius:4px;margin-bottom:12px"></div>
</div>` : ""}

<h2>Consumos del día</h2>
<div class="consumos">
  <div class="consumos-card"><div class="label">Combustible</div><div class="value">${full.fuelConsumedLiters != null ? `${full.fuelConsumedLiters} L` : "—"}</div></div>
  <div class="consumos-card"><div class="label">Aceite</div><div class="value">${(full as any).oilConsumedLiters != null ? `${(full as any).oilConsumedLiters} L` : "—"}</div></div>
</div>

<h2>Horas de equipo</h2>
${rows.equipment ? `<table><thead><tr><th>Equipo</th><th>Hs. Acumuladas</th><th>Comb. (L)</th><th>Aceite (L)</th><th>En servicio</th></tr></thead><tbody>${rows.equipment}</tbody></table>` : "<p style='font-size:8.5pt;color:#999;margin-bottom:8px'>Sin registros.</p>"}

<h2>Mantenimiento</h2>
${rows.maintenance ? `<table><thead><tr><th>ID Tarea</th><th>Tarea</th><th>Tipo</th><th>Resultado</th><th>Realizado por</th></tr></thead><tbody>${rows.maintenance}</tbody></table>` : "<p style='font-size:8.5pt;color:#999;margin-bottom:8px'>Sin registros.</p>"}

<h2>Repuestos utilizados</h2>
${rows.spares ? `<table><thead><tr><th>Repuesto</th><th>Cantidad</th><th>Unidad</th></tr></thead><tbody>${rows.spares}</tbody></table>` : "<p style='font-size:8.5pt;color:#999;margin-bottom:8px'>Sin registros.</p>"}

<h2>Defectos</h2>
${rows.defects ? `<table><thead><tr><th>Código</th><th>Descripción</th><th>Severidad</th><th>Acción inmediata</th></tr></thead><tbody>${rows.defects}</tbody></table>` : "<p style='font-size:8.5pt;color:#999;margin-bottom:8px'>Sin registros.</p>"}

<h2>Diferimientos activos</h2>
${rows.deferrals ? `<table><thead><tr><th>Código</th><th>Referencia</th><th>Estado</th><th>Fecha objetivo</th><th>Justificación</th></tr></thead><tbody>${rows.deferrals}</tbody></table>` : "<p style='font-size:8.5pt;color:#999;margin-bottom:8px'>Sin diferimientos activos.</p>"}

<div class="footer"><img src="${cmsLogoUrl}" style="height:16px;width:16px;object-fit:contain;opacity:0.6" /><span>Copilot Management System — Reporte generado automáticamente · ${gen}</span></div>
${hasPos ? `
<script>
(function() {
  function initMap() {
    if (typeof L === "undefined") { setTimeout(initMap, 100); return; }
    var map = L.map("map", { zoomControl: false, attributionControl: false }).setView([${lat}, ${lon}], 7);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18 }).addTo(map);
    L.marker([${lat}, ${lon}]).addTo(map);
    map.once("idle", function() { setTimeout(function() { window.print(); }, 600); });
    setTimeout(function() { window.print(); }, 3000);
  }
  window.addEventListener("load", initMap);
})();
<\/script>` : ""}
</body></html>`;

      const w = window.open("", "_blank", "width=900,height=700");
      if (!w) return;
      w.document.write(html);
      w.document.close();
      w.focus();
      // When there's a map, the Leaflet script triggers print after tiles load.
      // Without map, print immediately.
      if (!hasPos) setTimeout(() => { w.print(); }, 400);
    } catch (e) {
      setSaveError(e instanceof ApiError ? e.message : "Error al generar PDF.");
    } finally {
      setGeneratingPdf(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        className="w-full h-full bg-[#0D1B2A] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0">
          <div>
            {isNew ? (
              <h2 className="text-base font-bold text-white">Nuevo Reporte Diario</h2>
            ) : (
              <>
                <h2 className="text-base font-bold text-white">Reporte Diario — {liveReport!.vesselCode}</h2>
                <p className="text-[10px] text-text-industrial/40">{fmtDate(liveReport!.reportDate)} · {liveReport!.status}{liveReport!.integratedAt ? " · INTEGRADO" : ""}</p>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => { if (report === null && liveReport !== null) onSaved(); else onClose(); }} className="text-text-industrial/40 hover:text-white transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>



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
              {/* Posición geográfica */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className={labelCls}>Posición geográfica</label>
                  {!isClosed && (
                    <button type="button" onClick={fetchGeoPosition} disabled={geolocating}
                      className="flex items-center gap-1 text-[10px] text-accent hover:text-accent/80 disabled:opacity-40 transition-colors font-semibold">
                      {geolocating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Locate className="w-3 h-3" />}
                      {geolocating ? "Obteniendo…" : "Obtener GPS"}
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[9px] text-text-industrial/30 mb-1">Latitud</p>
                    <input
                      value={posLat}
                      onChange={e => setPosLat(e.target.value)}
                      onBlur={() => {
                        const lat = parseFloat(posLat); const lon = parseFloat(posLon);
                        if (Number.isFinite(lat) && Number.isFinite(lon)) setMapCoords({ lat, lon });
                      }}
                      disabled={isClosed}
                      placeholder="−34.603722"
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <p className="text-[9px] text-text-industrial/30 mb-1">Longitud</p>
                    <input
                      value={posLon}
                      onChange={e => setPosLon(e.target.value)}
                      onBlur={() => {
                        const lat = parseFloat(posLat); const lon = parseFloat(posLon);
                        if (Number.isFinite(lat) && Number.isFinite(lon)) setMapCoords({ lat, lon });
                      }}
                      disabled={isClosed}
                      placeholder="−58.381592"
                      className={inputCls}
                    />
                  </div>
                </div>
                {geoError && <p className="text-[10px] text-red-400">{geoError}</p>}

                {/* Mini mapa */}
                {mapCoords ? (
                  <div className="relative rounded-xl overflow-hidden border border-white/10" style={{ height: 180 }}>
                    <iframe
                      key={`${mapCoords.lat},${mapCoords.lon}`}
                      title="Posición actual"
                      src={`https://www.openstreetmap.org/export/embed.html?bbox=${mapCoords.lon - 0.025},${mapCoords.lat - 0.018},${mapCoords.lon + 0.025},${mapCoords.lat + 0.018}&layer=mapnik&marker=${mapCoords.lat},${mapCoords.lon}`}
                      className="w-full h-full"
                      style={{ border: 0, filter: "invert(0.88) hue-rotate(180deg) saturate(0.6)" }}
                      loading="lazy"
                    />
                    <div className="absolute bottom-1.5 left-1.5 flex items-center gap-1 bg-black/60 backdrop-blur-sm rounded-md px-2 py-0.5 pointer-events-none">
                      <span className="font-mono text-[10px] text-white/80">
                        {mapCoords.lat.toFixed(5)}, {mapCoords.lon.toFixed(5)}
                      </span>
                    </div>
                  </div>
                ) : geolocating ? (
                  <div className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/3 text-text-industrial/30" style={{ height: 180 }}>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-xs">Obteniendo ubicación…</span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-white/8 bg-white/2 text-text-industrial/20" style={{ height: 180 }}>
                    <Locate className="w-5 h-5" />
                    <span className="text-[10px]">Sin posición registrada</span>
                  </div>
                )}
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
              {submitResult && <p className="text-xs text-green-400 bg-green-500/10 border border-green-500/20 rounded-xl px-3 py-2 flex items-center gap-1.5"><CheckCircle className="w-3.5 h-3.5 shrink-0" />{submitResult}</p>}
              <div className="flex justify-end gap-2">
                {!isClosed && (
                  <>
                    {liveReport && !liveReport.integratedAt && (
                      <button
                        onClick={() => { void handleSubmit(); }}
                        disabled={submitting || saving}
                        className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-bold text-xs hover:bg-emerald-500 disabled:opacity-50 flex items-center gap-1.5"
                      >
                        {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                        Submit
                      </button>
                    )}
                    <button onClick={() => { void saveInfo(); }} disabled={saving || submitting} className="px-4 py-2 rounded-lg bg-accent text-primary-bg font-bold text-xs hover:brightness-110 disabled:opacity-50 flex items-center gap-1.5">
                      {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t("common.save")}
                    </button>
                  </>
                )}
                {liveReport && (
                  <button
                    onClick={() => { void generatePdf(); }}
                    disabled={generatingPdf || saving || submitting}
                    className="px-4 py-2 rounded-lg bg-white/10 border border-white/15 text-white font-bold text-xs hover:bg-white/15 disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {generatingPdf ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Printer className="w-3.5 h-3.5" />}
                    Generar PDF
                  </button>
                )}
              </div>
            </div>
          )}
          {activeTab !== "info" && isNew && (
            <p className="text-xs text-text-industrial/40 text-center py-8">Guardá la información básica primero para habilitar esta sección.</p>
          )}
          {!isNew && activeTab === "equipment"   && <EquipmentHoursTab reportId={liveReport!.id} vesselCode={liveReport!.vesselCode} disabled={isClosed} />}
          {!isNew && activeTab === "consumos"    && <ConsumosTab       reportId={liveReport!.id} disabled={isClosed} />}
          {!isNew && activeTab === "maintenance" && <MaintenanceTab    reportId={liveReport!.id} disabled={isClosed} prefillEntries={prevData?.maintenanceEntries} suggestions={suggestions?.maintenance as any[]} suggestionPeriod={suggestions?.period} />}
          {!isNew && activeTab === "spares"      && <SpareUsageTab     reportId={liveReport!.id} disabled={isClosed} prefillEntries={prevData?.spareUsages}        suggestions={suggestions?.spares as any[]}      suggestionPeriod={suggestions?.period} />}
          {!isNew && activeTab === "defects"     && <DefectEntriesTab  reportId={liveReport!.id} disabled={isClosed} prefillEntries={prevData?.defectEntries}       suggestions={suggestions?.defects as any[]}     suggestionPeriod={suggestions?.period} />}
          {!isNew && activeTab === "deferrals"  && <DeferralsTab vesselCode={liveReport!.vesselCode} />}
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
    || user?.role === "FLEET_SUPERINTENDENT"
    || user?.role === "TECHNICIAN_OPERATOR";

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
