import React, { useState, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, ChevronDown, FileSpreadsheet, Loader2, Maximize2, Minimize2, Package, Plus, Save, Search, X } from "lucide-react";
import { api } from "../lib/api";
import { useFetch } from "../lib/hooks";
import { DataTable, StatusBadge, fmtDate, type Column } from "../components/DataTable";
import { FILTER_ALL_VALUE, fromFilterSelectValue, toFilterSelectValue } from "../lib/utils";
import { PageHeader } from "../components/PageHeader";
import { ExcelPanel } from "../components/ExcelPanel";
import { useT } from "../lib/i18n";
import { useAuth } from "../lib/auth";
import { useEscapeGuard, useDirtyTracker } from "../lib/escape-guard";
import { useVesselContext } from "../lib/vessel-context";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Spare {
  id: string; sku: string; name: string; vesselCode: string;
  category: string | null; criticality: string; status: string;
  manufacturer: string | null; model: string | null;
  unit: string; minStock: number; reorderPoint: number; targetStock: number | null;
  location: string | null; createdAt: string;
  // Calculated stock (from stock-calc-service, never from Spare.currentStock)
  onHand: number; available: number;
  // Extended fields (Fase 2)
  internalPartNumber: string | null; manufacturerPartNumber: string | null;
  longDescription: string | null; sfiCode: string | null; leadTimeDays: number | null;
}
interface ListResponse { items: Spare[]; total: number; }
interface SfiNode { id: string; code: string; description: string; groupNumber: number; groupName: string; }

// ---------------------------------------------------------------------------
// Stock level indicator (uses onHand from calculation service)
// ---------------------------------------------------------------------------

function StockCell({ spare }: { spare: Spare }) {
  const critical = spare.onHand < spare.minStock;
  const warning  = !critical && spare.onHand <= spare.reorderPoint;
  return (
    <div className="flex items-center gap-1.5">
      {critical && <AlertTriangle className="w-3 h-3 text-red-400 shrink-0" />}
      <span className={`font-bold text-xs ${critical ? "text-red-400" : warning ? "text-yellow-400" : "text-emerald-400"}`}>
        {spare.onHand}
      </span>
      <span className="text-white/20 text-[10px]">{spare.unit}</span>
    </div>
  );
}

function CriticalityBadge({ value }: { value: string }) {
  const colors: Record<string, string> = {
    A: "bg-red-500/10 text-red-400 border-red-500/20",
    B: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
    C: "bg-white/5 text-white/40 border-white/10",
  };
  return <span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-bold ${colors[value] ?? colors.C}`}>{value}</span>;
}

// ---------------------------------------------------------------------------
// Stock movement history panel
// ---------------------------------------------------------------------------

interface StockMovement {
  id: string; movementCode: string; movementType: string;
  quantity: number; unit: string; occurredAt: string; vesselCode: string;
  referenceType: string | null; referenceId: string | null; referenceCode: string | null;
  notes: string | null;
}

const MOV_LABEL: Record<string, string> = {
  RECEIPT: "Ingreso", ISSUE: "Egreso", ADJUSTMENT: "Ajuste",
  TRANSFER_IN: "Transfer +", TRANSFER_OUT: "Transfer −",
  RETURN_IN: "Devolución", ADJUSTMENT_PLUS: "Ajuste +", ADJUSTMENT_MINUS: "Ajuste −",
};
const NEGATIVE_TYPES = new Set(["ISSUE", "TRANSFER_OUT", "ADJUSTMENT_MINUS"]);

function MovBadge({ type }: { type: string }) {
  const neg = NEGATIVE_TYPES.has(type);
  const cls = neg
    ? "bg-red-500/10 text-red-400 border-red-500/20"
    : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
  return <span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-semibold ${cls}`}>{MOV_LABEL[type] ?? type}</span>;
}

const SpareHistoryPanel: React.FC<{ spareId: string }> = ({ spareId }) => {
  const { data, loading } = useFetch<{ items: StockMovement[] }>(`/app/pms/stock-movements?spareId=${spareId}`);
  const movements = data?.items ?? [];

  if (loading) return (
    <div className="px-4 pb-4 flex items-center gap-2 text-xs text-white/30">
      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Cargando...
    </div>
  );
  if (movements.length === 0) return (
    <p className="px-4 pb-4 text-xs text-white/20">Sin movimientos registrados.</p>
  );
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-[10px] text-white/30 border-b border-white/10">
            <th className="text-left px-4 py-2">Fecha</th>
            <th className="text-left px-4 py-2">Tipo</th>
            <th className="text-right px-4 py-2">Cantidad</th>
            <th className="text-left px-4 py-2">Buque</th>
            <th className="text-left px-4 py-2">OT / Referencia</th>
            <th className="text-left px-4 py-2">Notas</th>
          </tr>
        </thead>
        <tbody>
          {movements.map(m => (
            <tr key={m.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.03]">
              <td className="px-4 py-2 text-white/50 whitespace-nowrap">{fmtDate(m.occurredAt)}</td>
              <td className="px-4 py-2"><MovBadge type={m.movementType} /></td>
              <td className="px-4 py-2 text-right font-mono">
                <span className={NEGATIVE_TYPES.has(m.movementType) ? "text-red-400" : "text-emerald-400"}>
                  {NEGATIVE_TYPES.has(m.movementType) ? "−" : "+"}{m.quantity} {m.unit}
                </span>
              </td>
              <td className="px-4 py-2 font-mono text-accent text-[10px]">{m.vesselCode}</td>
              <td className="px-4 py-2">
                {m.referenceCode
                  ? <span className="font-mono text-white/70">{m.referenceCode}</span>
                  : <span className="text-white/20">—</span>}
              </td>
              <td className="px-4 py-2 text-white/40 max-w-[160px] truncate" title={m.notes ?? undefined}>{m.notes ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

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
  const { user } = useAuth();
  const t = useT();
  const canAdjustStock = !isNew && (user?.role === "TENANT_ADMIN" || user?.role === "FLEET_SUPERINTENDENT");

  const [vesselCode,              setVesselCode]              = useState(spare?.vesselCode              ?? "");
  const [sku,                     setSku]                     = useState(spare?.sku                     ?? "");
  const [name,                    setName]                    = useState(spare?.name                    ?? "");
  const [category,                setCategory]                = useState(spare?.category                ?? "");
  const [criticality,             setCriticality]             = useState(spare?.criticality             ?? "B");
  const [manufacturer,            setManufacturer]            = useState(spare?.manufacturer            ?? "");
  const [model,                   setModel]                   = useState(spare?.model                   ?? "");
  const [unit,                    setUnit]                    = useState(spare?.unit                    ?? "");
  const [minStock,                setMinStock]                = useState(String(spare?.minStock         ?? 0));
  const [reorderPoint,            setReorderPoint]            = useState(String(spare?.reorderPoint     ?? 0));
  const [targetStock,             setTargetStock]             = useState(String(spare?.targetStock      ?? ""));
  const [location,                setLocation]                = useState(spare?.location                ?? "");
  const [status,                  setStatus]                  = useState(spare?.status                  ?? "ACTIVE");
  const [internalPartNumber,      setInternalPartNumber]      = useState(spare?.internalPartNumber      ?? "");
  const [manufacturerPartNumber,  setManufacturerPartNumber]  = useState(spare?.manufacturerPartNumber  ?? "");
  const [longDescription,         setLongDescription]         = useState(spare?.longDescription         ?? "");
  const [sfiCode,                 setSfiCode]                 = useState(spare?.sfiCode                 ?? "");
  const [leadTimeDays,            setLeadTimeDays]            = useState(String(spare?.leadTimeDays     ?? ""));

  // Reuse VesselContext instead of re-fetching /app/vessels.
  const { vessels } = useVesselContext();

  // SFI selectors — group is derived from the first digit of the existing code on edit
  const { data: sfiData } = useFetch<{ items: SfiNode[] }>("/app/pms/sfi");
  const sfiNodes = sfiData?.items ?? [];
  const [sfiGroup, setSfiGroup] = useState<string>(() => {
    if (!spare?.sfiCode) return "";
    const digits = String(spare.sfiCode).replace(/\D/g, "");
    return digits[0] ?? "";
  });
  const sfiGroups = useMemo(() => {
    const seen = new Map<number, string>();
    for (const n of sfiNodes) {
      if (!seen.has(n.groupNumber)) seen.set(n.groupNumber, n.groupName);
    }
    return Array.from(seen.entries()).sort((a, b) => a[0] - b[0]).map(([num, name]) => ({ num, name }));
  }, [sfiNodes]);
  const filteredCodes = useMemo(() => {
    if (!sfiGroup) return [];
    const gn = parseInt(sfiGroup, 10);
    return sfiNodes.filter(n => n.groupNumber === gn);
  }, [sfiNodes, sfiGroup]);
  const handleSfiGroupChange = (g: string) => { setSfiGroup(g); setSfiCode(""); };

  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [expanded,    setExpanded]    = useState(true);

  const [adjQty,     setAdjQty]     = useState(String(spare?.onHand ?? 0));
  const [adjNotes,   setAdjNotes]   = useState("");
  const [adjSaving,  setAdjSaving]  = useState(false);
  const [adjError,   setAdjError]   = useState<string | null>(null);
  const [adjSuccess, setAdjSuccess] = useState(false);

  const handleSave = async () => {
    setError(null);
    setSaving(true);
    try {
      const payload = {
        vesselCode:             vesselCode.trim().toUpperCase(),
        sku:                    sku.trim().toUpperCase(),
        name:                   name.trim(),
        category:               category.trim() || null,
        criticality:            criticality as "A" | "B" | "C",
        manufacturer:           manufacturer.trim() || null,
        model:                  model.trim() || null,
        unit:                   unit.trim(),
        minStock:               parseFloat(minStock) || 0,
        reorderPoint:           parseFloat(reorderPoint) || 0,
        targetStock:            targetStock.trim() ? parseFloat(targetStock) : null,
        location:               location.trim() || null,
        status:                 status as "ACTIVE" | "OBSOLETE",
        internalPartNumber:     internalPartNumber.trim() || null,
        manufacturerPartNumber: manufacturerPartNumber.trim() || null,
        longDescription:        longDescription.trim() || null,
        sfiCode:                sfiCode.trim() || null,
        leadTimeDays:           leadTimeDays.trim() ? parseInt(leadTimeDays, 10) : null,
      };
      if (!payload.vesselCode) { setError(t("error.vesselRequired")); setSaving(false); return; }
      if (!payload.sku)        { setError(t("error.skuRequired"));    setSaving(false); return; }
      if (!payload.name)       { setError(t("error.nameRequired"));   setSaving(false); return; }
      if (!payload.unit)       { setError(t("error.unitRequired"));   setSaving(false); return; }

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

  const isCriticalStock = !isNew && spare.onHand < spare.minStock;
  const isWarnStock     = !isNew && !isCriticalStock && spare.onHand <= spare.reorderPoint;

  // ESC guard: confirma cambios sin guardar
  const isDirty = useDirtyTracker({
    vesselCode, sku, name, category, criticality, manufacturer, model, unit,
    minStock, reorderPoint, targetStock, location, status,
    internalPartNumber, manufacturerPartNumber, longDescription, sfiCode, leadTimeDays,
  });
  useEscapeGuard({ isDirty, onSave: handleSave, onClose });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className={`w-full bg-[#0D1B2A] border border-white/10 rounded-2xl shadow-2xl flex flex-col transition-all duration-200 ${expanded ? "w-full h-full" : "max-w-2xl max-h-[90%]"}`} onClick={e => e.stopPropagation()}>

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
          <div className="flex items-center gap-1">
            <button onClick={() => setExpanded(v => !v)} className="p-1.5 rounded-lg text-white/30 hover:text-white hover:bg-white/5 transition-colors" title={expanded ? "Reducir" : "Ampliar"}>
              {expanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
            <button onClick={onClose}><X className="w-5 h-5 text-white/40 hover:text-white" /></button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 min-h-0">

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Vessel *</label>
              {isNew
                ? <select value={vesselCode} onChange={e => setVesselCode(e.target.value)} className={inputCls}>
                    <option value="">— Seleccionar vessel —</option>
                    {vessels.map(v => (
                      <option key={v.code} value={v.code}>{v.code} — {v.name}</option>
                    ))}
                  </select>
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

          {longDescription !== undefined && (
            <div>
              <label className={labelCls}>Descripción larga</label>
              <textarea value={longDescription} onChange={e => setLongDescription(e.target.value)} placeholder="Descripción técnica detallada…" rows={2} className={`${inputCls} resize-none`} />
            </div>
          )}

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

          <div className="grid grid-cols-4 gap-4">
            <div>
              <label className={labelCls}>Unidad *</label>
              <input value={unit} onChange={e => setUnit(e.target.value)} placeholder="ud, m, kg, L…" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Ubicación en bodega</label>
              <input value={location} onChange={e => setLocation(e.target.value)} placeholder="Rack A-3…" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>SFI Grupo</label>
              <select value={sfiGroup} onChange={e => handleSfiGroupChange(e.target.value)} className={inputCls}>
                <option value="">— Grupo —</option>
                {sfiGroups.map(g => (
                  <option key={g.num} value={String(g.num)}>{g.num} — {g.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Código SFI</label>
              <select value={sfiCode} onChange={e => setSfiCode(e.target.value)} className={inputCls} disabled={!sfiGroup || filteredCodes.length === 0}>
                <option value="">— Código —</option>
                {filteredCodes.map(n => (
                  <option key={n.code} value={n.code}>{n.code} — {n.description}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Part numbers */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Part Number interno</label>
              <input value={internalPartNumber} onChange={e => setInternalPartNumber(e.target.value)} placeholder="IPN-001" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Part Number fabricante</label>
              <input value={manufacturerPartNumber} onChange={e => setManufacturerPartNumber(e.target.value)} placeholder="OEM-12345" className={inputCls} />
            </div>
          </div>

          {/* Stock thresholds — no currentStock field, only policy levels */}
          <div className="border border-white/10 rounded-xl p-4 space-y-3">
            <p className="text-[10px] font-bold text-white/40 uppercase tracking-wider">Niveles de stock</p>
            {!isNew && (
              <div className="flex items-center gap-3 text-xs">
                <span className="text-white/40">Stock actual (calculado):</span>
                <span className={`font-bold ${isCriticalStock ? "text-red-400" : isWarnStock ? "text-yellow-400" : "text-emerald-400"}`}>
                  {spare.onHand} {spare.unit}
                </span>
                {spare.available !== spare.onHand && (
                  <span className="text-white/30 text-[10px]">Disponible: {spare.available}</span>
                )}
              </div>
            )}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={labelCls}>Stock mínimo</label>
                <input type="number" min="0" step="0.01" value={minStock} onChange={e => setMinStock(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Punto de reorden</label>
                <input type="number" min="0" step="0.01" value={reorderPoint} onChange={e => setReorderPoint(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Stock objetivo</label>
                <input type="number" min="0" step="0.01" value={targetStock} onChange={e => setTargetStock(e.target.value)} placeholder="Opcional" className={inputCls} />
              </div>
            </div>
          </div>

          {/* Manual stock adjustment — ADMIN / FLEET_SUPERINTENDENT only */}
          {canAdjustStock && (
            <div className="border border-yellow-500/20 rounded-xl p-4 space-y-3 bg-yellow-500/5">
              <p className="text-[10px] font-bold text-yellow-400/70 uppercase tracking-wider">Ajuste manual de stock</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Nueva cantidad</label>
                  <input
                    type="number" min="0" step="0.01"
                    value={adjQty}
                    onChange={e => { setAdjQty(e.target.value); setAdjSuccess(false); setAdjError(null); }}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Motivo (opcional)</label>
                  <input
                    type="text"
                    value={adjNotes}
                    onChange={e => setAdjNotes(e.target.value)}
                    placeholder="Ej: inventario físico, corrección…"
                    className={inputCls}
                  />
                </div>
              </div>
              {adjError   && <p className="text-xs text-red-400">{adjError}</p>}
              {adjSuccess  && <p className="text-xs text-emerald-400">Stock actualizado y registrado en bitácora.</p>}
              <button
                disabled={adjSaving}
                onClick={async () => {
                  const newQty = parseFloat(adjQty);
                  if (isNaN(newQty) || newQty < 0) { setAdjError(t("error.invalidQuantity")); return; }
                  setAdjSaving(true); setAdjError(null); setAdjSuccess(false);
                  try {
                    const currentOnHand = spare.onHand;
                    const delta = newQty - currentOnHand;
                    if (delta !== 0) {
                      const movementType = delta > 0 ? "ADJUSTMENT_PLUS" : "ADJUSTMENT_MINUS";
                      await api.post(`/app/pms/stock-movements`, {
                        vesselCode:    spare.vesselCode,
                        spareId:       spare.id,
                        movementType,
                        quantity:      Math.abs(delta),
                        unit:          spare.unit,
                        occurredAt:    new Date().toISOString(),
                        referenceType: "ADJUSTMENT",
                        notes:         adjNotes.trim() || `Ajuste manual de stock`,
                      });
                      setAdjSuccess(true);
                      setAdjNotes("");
                      onSaved({ ...spare, onHand: newQty, available: newQty });
                    } else {
                      setAdjError(t("error.sameQuantity"));
                    }
                  } catch (e) {
                    setAdjError(e instanceof Error ? e.message : "Error al ajustar stock.");
                  } finally { setAdjSaving(false); }
                }}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-yellow-500/15 border border-yellow-500/30 text-yellow-400 font-bold text-xs hover:bg-yellow-500/25 transition-all disabled:opacity-50"
              >
                {adjSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                Aplicar ajuste
              </button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Lead time (días)</label>
              <input type="number" min="0" step="1" value={leadTimeDays} onChange={e => setLeadTimeDays(e.target.value)} placeholder="Tiempo de entrega…" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Estado</label>
              <select value={status} onChange={e => setStatus(e.target.value)} className={inputCls}>
                <option value="ACTIVE">Activo</option>
                <option value="OBSOLETE">Obsoleto</option>
              </select>
            </div>
          </div>

          {!isNew && <p className="text-[10px] text-white/20">Alta: {fmtDate(spare.createdAt)}</p>}

          {!isNew && (
            <div className="border border-white/10 rounded-xl overflow-hidden">
              <button
                type="button"
                onClick={() => setShowHistory(v => !v)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors"
              >
                <span className="text-[10px] font-bold text-white/40 uppercase tracking-wider">Historial de movimientos</span>
                <ChevronDown className={`w-3.5 h-3.5 text-white/30 transition-transform ${showHistory ? "rotate-180" : ""}`} />
              </button>
              {showHistory && <SpareHistoryPanel spareId={spare.id} />}
            </div>
          )}
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
  const [searchParams] = useSearchParams();

  const [vesselInput,      setVesselInput]      = useState("");
  const [vesselFilter,     setVesselFilter]      = useState("");
  const [statusFilter,     setStatusFilter]      = useState("");
  const [criticalityFilter,setCriticalityFilter] = useState(() => searchParams.get("criticality") ?? "");
  const [belowReorder,     setBelowReorder]      = useState(false);
  const [stockStatusFilter,setStockStatusFilter] = useState<string>(() => searchParams.get("stockStatus") ?? "");
  const [searchText,       setSearchText]        = useState("");
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

  const filteredItems = (() => {
    let items = data?.items ?? null;
    if (!items) return items;
    if (stockStatusFilter) {
      items = items.filter(s => {
        if (stockStatusFilter === "sin_stock")    return s.available <= 0;
        if (stockStatusFilter === "bajo_reorden") return s.available > 0 && s.available < s.reorderPoint;
        if (stockStatusFilter === "ok")           return s.available >= s.reorderPoint;
        return true;
      });
    }
    if (searchText.trim()) {
      const q = searchText.trim().toLowerCase();
      items = items.filter(s =>
        s.sku.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        s.vesselCode.toLowerCase().includes(q) ||
        (s.sfiCode?.toLowerCase().includes(q) ?? false) ||
        (s.manufacturer?.toLowerCase().includes(q) ?? false) ||
        (s.manufacturerPartNumber?.toLowerCase().includes(q) ?? false) ||
        (s.internalPartNumber?.toLowerCase().includes(q) ?? false)
      );
    }
    return items;
  })();

  const handleSaved = (s: Spare) => { reload(); setSelected(s); };

  const COLUMNS: Column<Spare>[] = [
    { key: "sku",          header: "SKU",                  render: r => <span className="font-mono font-bold text-white text-xs">{r.sku}</span> },
    { key: "name",         header: t("col.name"),          render: r => <span className="font-medium text-white text-xs">{r.name}</span> },
    { key: "vesselCode",   header: t("col.vessel"),        render: r => <span className="font-mono text-accent text-xs">{r.vesselCode}</span> },
    { key: "category",     header: t("col.category"),      render: r => <span className="text-xs text-white/60">{r.category ?? "—"}</span> },
    { key: "criticality",  header: t("col.criticality"),   render: r => <CriticalityBadge value={r.criticality} /> },
    { key: "onHand",       header: t("col.stockCurrent"),  render: r => <StockCell spare={r} /> },
    { key: "minStock",     header: t("col.minimum"),       render: r => <span className="text-xs text-white/50">{r.minStock}</span> },
    { key: "reorderPoint", header: t("col.reorder"),       render: r => <span className="text-xs text-white/50">{r.reorderPoint}</span> },
    { key: "status",       header: t("col.status"),        render: r => <StatusBadge status={r.status} /> },
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
        {/* Search */}
        <div className="flex items-center gap-1.5 bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5">
          <Search className="w-3 h-3 text-text-industrial/40 shrink-0" />
          <input
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            placeholder={t("spares.page.searchPlaceholder")}
            className="w-56 bg-transparent text-xs text-text-industrial placeholder-text-industrial/30 focus:outline-none"
          />
          {searchText && (
            <button onClick={() => setSearchText("")} className="text-text-industrial/40 hover:text-white transition-colors">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Excel */}
        <button onClick={() => setShowExcel(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-text-industrial hover:border-accent/30 transition-all">
          <FileSpreadsheet className="w-3.5 h-3.5 text-accent" /> Excel
        </button>

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

        {/* Stock status filter chip (from Dashboard navigation) */}
        {stockStatusFilter && (
          <button onClick={() => setStockStatusFilter("")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs transition-all bg-accent/15 border-accent/30 text-accent">
            <AlertTriangle className="w-3.5 h-3.5" />
            {stockStatusFilter === "sin_stock" ? "Sin stock" : stockStatusFilter === "bajo_reorden" ? "Bajo reorden" : "Stock OK"}
            <X className="w-3 h-3 ml-0.5" />
          </button>
        )}

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
        data={filteredItems}
        loading={loading}
        error={error}
        keyFn={r => r.id}
        emptyText={t("empty.spares")}
        onRowClick={r => setSelected(r)}
      />
    </div>
  );
};
