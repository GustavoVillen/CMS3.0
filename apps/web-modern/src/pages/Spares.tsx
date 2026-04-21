import React, { useState } from "react";
import { AlertTriangle, FileSpreadsheet, Package, Plus, X } from "lucide-react";
import { api } from "../lib/api";
import { useFetch } from "../lib/hooks";
import { DataTable, StatusBadge, fmtDate, type Column } from "../components/DataTable";
import { FILTER_ALL_VALUE, fromFilterSelectValue, toFilterSelectValue } from "../lib/utils";
import { PageHeader } from "../components/PageHeader";
import { ExcelPanel } from "../components/ExcelPanel";
import { useT } from "../lib/i18n";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Spare {
  id: string; sku: string; name: string; vesselCode: string;
  category: string | null; criticality: string; status: string;
  manufacturer: string | null; model: string | null;
  unit: string; currentStock: number; minStock: number; reorderPoint: number;
  location: string | null; createdAt: string;
}
interface ListResponse { items: Spare[]; total: number; }

// ---------------------------------------------------------------------------
// Stock level indicator
// ---------------------------------------------------------------------------

function StockCell({ spare }: { spare: Spare }) {
  const critical = spare.currentStock < spare.minStock;
  const warning  = !critical && spare.currentStock <= spare.reorderPoint;
  return (
    <div className="flex items-center gap-1.5">
      {critical && <AlertTriangle className="w-3 h-3 text-red-400 shrink-0" />}
      <span className={`font-bold text-xs ${critical ? "text-red-400" : warning ? "text-yellow-400" : "text-emerald-400"}`}>
        {spare.currentStock}
      </span>
      <span className="text-white/20 text-[10px]">{spare.unit}</span>
    </div>
  );
}

function CriticalityBadge({ value }: { value: string }) {
  const colors: Record<string, string> = { A: "bg-red-500/10 text-red-400 border-red-500/20", B: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20", C: "bg-white/5 text-white/40 border-white/10" };
  return <span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-bold ${colors[value] ?? colors.C}`}>{value}</span>;
}

// ---------------------------------------------------------------------------
// Input style helpers
// ---------------------------------------------------------------------------

const inputCls = "w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder-white/20 focus:outline-none focus:border-accent/50";
const labelCls = "block text-[10px] font-semibold text-white/50 uppercase tracking-wider mb-1";

// ---------------------------------------------------------------------------
// SpareModal
// ---------------------------------------------------------------------------

interface SpareModalProps {
  spare: Spare | null;
  onClose: () => void;
  onSaved: (s: Spare) => void;
}

const SpareModal: React.FC<SpareModalProps> = ({ spare, onClose, onSaved }) => {
  const isNew = spare === null;

  const [vesselCode,    setVesselCode]    = useState(spare?.vesselCode    ?? "");
  const [sku,           setSku]           = useState(spare?.sku           ?? "");
  const [name,          setName]          = useState(spare?.name          ?? "");
  const [category,      setCategory]      = useState(spare?.category      ?? "");
  const [criticality,   setCriticality]   = useState(spare?.criticality   ?? "B");
  const [manufacturer,  setManufacturer]  = useState(spare?.manufacturer  ?? "");
  const [model,         setModel]         = useState(spare?.model         ?? "");
  const [unit,          setUnit]          = useState(spare?.unit          ?? "");
  const [currentStock,  setCurrentStock]  = useState(String(spare?.currentStock  ?? 0));
  const [minStock,      setMinStock]      = useState(String(spare?.minStock      ?? 0));
  const [reorderPoint,  setReorderPoint]  = useState(String(spare?.reorderPoint  ?? 0));
  const [location,      setLocation]      = useState(spare?.location      ?? "");
  const [status,        setStatus]        = useState(spare?.status        ?? "ACTIVE");

  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState<string | null>(null);

  const handleSave = async () => {
    setError(null);
    setSaving(true);
    try {
      const payload = {
        vesselCode:   vesselCode.trim().toUpperCase(),
        sku:          sku.trim().toUpperCase(),
        name:         name.trim(),
        category:     category.trim() || null,
        criticality:  criticality as "A" | "B" | "C",
        manufacturer: manufacturer.trim() || null,
        model:        model.trim() || null,
        unit:         unit.trim(),
        currentStock: parseFloat(currentStock) || 0,
        minStock:     parseFloat(minStock)     || 0,
        reorderPoint: parseFloat(reorderPoint) || 0,
        location:     location.trim() || null,
        status:       status as "ACTIVE" | "OBSOLETE",
      };
      if (!payload.vesselCode) { setError("Vessel es requerido."); setSaving(false); return; }
      if (!payload.sku)        { setError("SKU es requerido.");    setSaving(false); return; }
      if (!payload.name)       { setError("Nombre es requerido."); setSaving(false); return; }
      if (!payload.unit)       { setError("Unidad es requerida."); setSaving(false); return; }

      const result = isNew
        ? await api.post<Spare>("/app/pms/spares", payload)
        : await api.patch<Spare>(`/app/pms/spares/${spare.id}`, payload);
      onSaved(result);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error al guardar.");
    } finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!spare) return;
    if (!window.confirm(`¿Eliminar el repuesto ${spare.sku}? Esta acción no se puede deshacer.`)) return;
    setSaving(true);
    try {
      await api.delete(`/app/pms/spares/${spare.id}`);
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error al eliminar.");
      setSaving(false);
    }
  };

  const isCriticalStock = !isNew && spare.currentStock < spare.minStock;
  const isWarnStock     = !isNew && !isCriticalStock && spare.currentStock <= spare.reorderPoint;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-2xl bg-[#0D1B2A] border border-white/10 rounded-2xl shadow-2xl flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-3">
            <Package className="w-4 h-4 text-accent" />
            <div>
              <h2 className="text-sm font-bold text-white">{isNew ? "Nuevo Repuesto" : spare.sku}</h2>
              {!isNew && <p className="text-[10px] text-white/40 mt-0.5">{spare.name} · Vessel: {spare.vesselCode}</p>}
            </div>
            {!isNew && (
              <div className="flex items-center gap-2">
                <CriticalityBadge value={spare.criticality} />
                {isCriticalStock && <span className="text-[10px] font-semibold text-red-400 bg-red-500/10 border border-red-500/20 px-2 py-0.5 rounded-md">Stock crítico</span>}
                {isWarnStock     && <span className="text-[10px] font-semibold text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 px-2 py-0.5 rounded-md">Por debajo del punto de reorden</span>}
              </div>
            )}
          </div>
          <button onClick={onClose}><X className="w-5 h-5 text-white/40 hover:text-white" /></button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 min-h-0">

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Vessel *</label>
              {isNew
                ? <input value={vesselCode} onChange={e => setVesselCode(e.target.value.toUpperCase())} placeholder="VESSEL" className={inputCls} />
                : <p className="text-sm font-mono text-accent">{spare.vesselCode}</p>}
            </div>
            <div>
              <label className={labelCls}>SKU *</label>
              <input value={sku} onChange={e => setSku(e.target.value.toUpperCase())} placeholder="SKU-001" className={inputCls} />
            </div>
          </div>

          <div>
            <label className={labelCls}>Nombre *</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Nombre del repuesto" className={inputCls} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Categoría</label>
              <input value={category} onChange={e => setCategory(e.target.value)} placeholder="Ej. Filtros, Rodamientos…" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Criticidad</label>
              <select value={criticality} onChange={e => setCriticality(e.target.value)} className={inputCls}>
                <option value="A">A — Crítica</option>
                <option value="B">B — Importante</option>
                <option value="C">C — Rutinaria</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Fabricante</label>
              <input value={manufacturer} onChange={e => setManufacturer(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Modelo</label>
              <input value={model} onChange={e => setModel(e.target.value)} className={inputCls} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Unidad *</label>
              <input value={unit} onChange={e => setUnit(e.target.value)} placeholder="ud, m, kg, L…" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Ubicación en bodega</label>
              <input value={location} onChange={e => setLocation(e.target.value)} placeholder="Rack A-3…" className={inputCls} />
            </div>
          </div>

          {/* Stock levels */}
          <div className="border border-white/10 rounded-xl p-4 space-y-3">
            <p className="text-[10px] font-bold text-white/40 uppercase tracking-wider">Niveles de stock</p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={labelCls}>Stock actual</label>
                <input type="number" min="0" step="0.01" value={currentStock} onChange={e => setCurrentStock(e.target.value)} className={`${inputCls} ${parseFloat(currentStock) < parseFloat(minStock) ? "border-red-500/40 text-red-300" : parseFloat(currentStock) <= parseFloat(reorderPoint) ? "border-yellow-500/40 text-yellow-300" : ""}`} />
              </div>
              <div>
                <label className={labelCls}>Stock mínimo</label>
                <input type="number" min="0" step="0.01" value={minStock} onChange={e => setMinStock(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Punto de reorden</label>
                <input type="number" min="0" step="0.01" value={reorderPoint} onChange={e => setReorderPoint(e.target.value)} className={inputCls} />
              </div>
            </div>
          </div>

          <div>
            <label className={labelCls}>Estado</label>
            <select value={status} onChange={e => setStatus(e.target.value)} className={inputCls}>
              <option value="ACTIVE">Activo</option>
              <option value="OBSOLETE">Obsoleto</option>
            </select>
          </div>

          {!isNew && <p className="text-[10px] text-white/20">Alta: {fmtDate(spare.createdAt)}</p>}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/10 shrink-0 space-y-2">
          {error && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}
          <div className="flex items-center justify-between gap-3">
            <div>
              {!isNew && (
                <button onClick={() => void handleDelete()} disabled={saving} className="px-3 py-1.5 text-xs text-red-400/70 hover:text-red-400 border border-red-500/20 hover:border-red-500/40 rounded-lg transition-colors disabled:opacity-40">
                  Eliminar
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={onClose} className="px-4 py-1.5 text-xs text-white/50 hover:text-white rounded-lg border border-white/10 hover:border-white/20 transition-colors">Cerrar</button>
              <button onClick={() => void handleSave()} disabled={saving} className="px-5 py-1.5 text-xs font-semibold bg-accent/20 border border-accent/30 text-accent rounded-lg hover:bg-accent/30 disabled:opacity-40 transition-all">
                {saving ? "Guardando…" : (isNew ? "Crear repuesto" : "Guardar")}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// SparesPage
// ---------------------------------------------------------------------------

export const SparesPage: React.FC = () => {
  const t = useT();

  const [vesselInput,      setVesselInput]      = useState("");
  const [vesselFilter,     setVesselFilter]      = useState("");
  const [statusFilter,     setStatusFilter]      = useState("");
  const [criticalityFilter,setCriticalityFilter] = useState("");
  const [belowReorder,     setBelowReorder]      = useState(false);
  const [showExcel,        setShowExcel]         = useState(false);
  const [selected,         setSelected]          = useState<Spare | null | "new">(null);

  const buildPath = () => {
    const p = new URLSearchParams();
    if (vesselFilter)      p.set("vesselCode",   vesselFilter);
    if (statusFilter)      p.set("status",        statusFilter);
    if (criticalityFilter) p.set("criticality",   criticalityFilter);
    if (belowReorder)      p.set("belowReorder",  "true");
    const qs = p.toString();
    return `/app/pms/spares${qs ? `?${qs}` : ""}`;
  };

  const { data, loading, error, reload } = useFetch<ListResponse>(buildPath(), [vesselFilter, statusFilter, criticalityFilter, belowReorder]);

  const handleSaved = (s: Spare) => { reload(); setSelected(s); };

  const COLUMNS: Column<Spare>[] = [
    { key: "sku",          header: "SKU",                  render: r => <span className="font-mono font-bold text-white text-xs">{r.sku}</span> },
    { key: "name",         header: t("col.name"),          render: r => <span className="font-medium text-white text-xs">{r.name}</span> },
    { key: "vesselCode",   header: t("col.vessel"),        render: r => <span className="font-mono text-accent text-xs">{r.vesselCode}</span> },
    { key: "category",     header: t("col.category"),      render: r => <span className="text-xs text-white/60">{r.category ?? "—"}</span> },
    { key: "criticality",  header: t("col.criticality"),   render: r => <CriticalityBadge value={r.criticality} /> },
    { key: "currentStock", header: t("col.stockCurrent"),  render: r => <StockCell spare={r} /> },
    { key: "minStock",     header: t("col.minimum"),       render: r => <span className="text-xs text-white/50">{r.minStock}</span> },
    { key: "reorderPoint", header: t("col.reorder"),       render: r => <span className="text-xs text-white/50">{r.reorderPoint}</span> },
    { key: "status",       header: t("col.status"),        render: r => <StatusBadge status={r.status} /> },
    { key: "createdAt",    header: t("col.createdAt"),     render: r => fmtDate(r.createdAt) },
  ];

  return (
    <div className="space-y-5">
      {showExcel && <ExcelPanel module="spares" onClose={() => { setShowExcel(false); reload(); }} />}
      {selected && (
        <SpareModal
          spare={selected === "new" ? null : selected}
          onClose={() => setSelected(null)}
          onSaved={handleSaved}
        />
      )}

      <PageHeader icon={Package} title={t("page.spares")} total={data?.total} onReload={reload}>
        {/* Excel */}
        <button onClick={() => setShowExcel(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-text-industrial hover:border-accent/30 transition-all">
          <FileSpreadsheet className="w-3.5 h-3.5 text-accent" /> Excel
        </button>

        {/* Vessel filter */}
        <input
          value={vesselInput}
          onChange={e => setVesselInput(e.target.value.toUpperCase())}
          onKeyDown={e => { if (e.key === "Enter") setVesselFilter(vesselInput.trim()); }}
          onBlur={() => setVesselFilter(vesselInput.trim())}
          placeholder="Vessel…"
          className="w-28 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-text-industrial placeholder-text-industrial/30 focus:outline-none focus:border-accent/50"
        />

        {/* Criticality filter */}
        <select value={toFilterSelectValue(criticalityFilter)} onChange={e => setCriticalityFilter(fromFilterSelectValue(e.target.value))} className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-text-industrial focus:outline-none focus:border-accent/50">
          <option value={FILTER_ALL_VALUE}>Toda criticidad</option>
          <option value="A">A — Crítica</option>
          <option value="B">B — Importante</option>
          <option value="C">C — Rutinaria</option>
        </select>

        {/* Status filter */}
        <select value={toFilterSelectValue(statusFilter)} onChange={e => setStatusFilter(fromFilterSelectValue(e.target.value))} className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-text-industrial focus:outline-none focus:border-accent/50">
          <option value={FILTER_ALL_VALUE}>{t("status.all")}</option>
          <option value="ACTIVE">{t("status.active")}</option>
          <option value="OBSOLETE">Obsoleto</option>
        </select>

        {/* Below reorder toggle */}
        <button
          onClick={() => setBelowReorder(v => !v)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs transition-all ${belowReorder ? "bg-yellow-500/15 border-yellow-500/30 text-yellow-400" : "bg-white/5 border-white/10 text-text-industrial hover:border-yellow-500/20"}`}
        >
          <AlertTriangle className="w-3.5 h-3.5" />
          Alertas reorden
        </button>

        {/* Create */}
        <button onClick={() => setSelected("new")} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent/10 border border-accent/20 text-xs text-accent hover:bg-accent/20 transition-all font-semibold">
          <Plus className="w-3.5 h-3.5" /> Nuevo repuesto
        </button>
      </PageHeader>

      <DataTable
        columns={COLUMNS}
        data={data?.items ?? null}
        loading={loading}
        error={error}
        keyFn={r => r.id}
        emptyText={t("empty.spares")}
        onRowClick={r => setSelected(r)}
      />
    </div>
  );
};
