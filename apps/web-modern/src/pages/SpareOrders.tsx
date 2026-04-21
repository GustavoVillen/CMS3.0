import React, { useCallback, useEffect, useState } from "react";
import { Package, Plus, ShoppingCart, Trash2, X } from "lucide-react";
import { api } from "../lib/api";
import { useFetch } from "../lib/hooks";
import { DataTable, PriorityBadge, fmtDate, type Column } from "../components/DataTable";
import { PageHeader } from "../components/PageHeader";
import { useT } from "../lib/i18n";
import { useCopilotEmitter } from "../lib/copilot-context";
import { FILTER_ALL_VALUE, fromFilterSelectValue, toFilterSelectValue } from "../lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SpareOrder {
  id: string; orderCode: string; vesselCode: string;
  status: string; priority: string;
  providerId: string | null; providerName: string | null;
  requestedAt: string;
  expectedDeliveryDate: string | null;
  totalLines: number; totalCost: number | null; currency: string | null;
  notes: string | null; createdAt: string;
}

interface SpareOrderLine {
  id: string; spareOrderId: string;
  spareId: string | null; spareSku: string | null; spareName: string | null;
  description: string; partNumber: string | null;
  quantity: number; unit: string | null;
  unitPrice: number | null; currency: string | null; notes: string | null;
}

interface Spare    { id: string; sku: string; name: string; unit: string; }
interface Provider { id: string; providerCode: string; name: string; }
interface ListResponse<T> { items: T[]; total: number; }

// ---------------------------------------------------------------------------
// Status metadata
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<string, string> = {
  DRAFT:              "Borrador",
  REQUESTED:          "Solicitado",
  APPROVED:           "Aprobado",
  ORDERED:            "Ordenado",
  PARTIALLY_RECEIVED: "Recep. Parcial",
  RECEIVED:           "Recibido",
  CANCELLED:          "Cancelado",
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT:              "bg-white/10 text-white/50 border-white/20",
  REQUESTED:          "bg-blue-500/10 text-blue-400 border-blue-500/20",
  APPROVED:           "bg-green-500/10 text-green-400 border-green-500/20",
  ORDERED:            "bg-purple-500/10 text-purple-400 border-purple-500/20",
  PARTIALLY_RECEIVED: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  RECEIVED:           "bg-teal-500/10 text-teal-400 border-teal-500/20",
  CANCELLED:          "bg-red-500/10 text-red-400 border-red-500/20",
};

const WORKFLOW: Record<string, { label: string; next: string; cls: string }[]> = {
  DRAFT:     [{ label: "Enviar a revisión", next: "REQUESTED",         cls: "bg-blue-500/10 border-blue-500/20 text-blue-300 hover:bg-blue-500/20" }],
  REQUESTED: [{ label: "Aprobar",           next: "APPROVED",          cls: "bg-green-500/10 border-green-500/20 text-green-300 hover:bg-green-500/20" }],
  APPROVED:  [{ label: "Ordenar",           next: "ORDERED",           cls: "bg-purple-500/10 border-purple-500/20 text-purple-300 hover:bg-purple-500/20" }],
  ORDERED:   [
    { label: "Recepción parcial", next: "PARTIALLY_RECEIVED", cls: "bg-yellow-500/10 border-yellow-500/20 text-yellow-300 hover:bg-yellow-500/20" },
    { label: "Recibir completo",  next: "RECEIVED",           cls: "bg-teal-500/10 border-teal-500/20 text-teal-300 hover:bg-teal-500/20" },
  ],
  PARTIALLY_RECEIVED: [
    { label: "Recibir completo", next: "RECEIVED", cls: "bg-teal-500/10 border-teal-500/20 text-teal-300 hover:bg-teal-500/20" },
  ],
};
const CANCELLABLE = new Set(["DRAFT", "REQUESTED", "APPROVED", "ORDERED", "PARTIALLY_RECEIVED"]);
const TERMINAL    = new Set(["RECEIVED", "CANCELLED"]);

function SoStatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[10px] font-semibold ${STATUS_COLORS[status] ?? "bg-white/5 text-white/50 border-white/10"}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Input / select shared styles
// ---------------------------------------------------------------------------
const inputCls = "w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder-white/20 focus:outline-none focus:border-accent/50";
const labelCls = "block text-[10px] font-semibold text-white/50 uppercase tracking-wider mb-1";

// ---------------------------------------------------------------------------
// SpareOrderModal
// ---------------------------------------------------------------------------

interface ModalProps {
  order: SpareOrder | null;
  onClose: () => void;
  onSaved: (updated: SpareOrder) => void;
}

const SpareOrderModal: React.FC<ModalProps> = ({ order, onClose, onSaved }) => {
  const isNew = order === null;

  // ── Form state ──
  const [vesselCode,           setVesselCode]           = useState(order?.vesselCode ?? "");
  const [priority,             setPriority]             = useState(order?.priority ?? "MEDIUM");
  const [providerId,           setProviderId]           = useState(order?.providerId ?? "");
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState(order?.expectedDeliveryDate?.split("T")[0] ?? "");
  const [totalCost,            setTotalCost]            = useState(order?.totalCost?.toString() ?? "");
  const [currency,             setCurrency]             = useState(order?.currency ?? "USD");
  const [notes,                setNotes]                = useState(order?.notes ?? "");

  const [tab,     setTab]     = useState<"data" | "lines">("data");
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  // ── Lines ──
  const [lines,        setLines]        = useState<SpareOrderLine[]>([]);
  const [linesLoading, setLinesLoading] = useState(false);
  const [addingLine,   setAddingLine]   = useState(false);
  const [lineForm,     setLineForm]     = useState({ spareId: "", description: "", partNumber: "", quantity: "1", unit: "", unitPrice: "", currency: "USD", notes: "" });
  const [lineSaving,   setLineSaving]   = useState(false);

  // ── Providers & Spares ──
  const vesselForFetch = order?.vesselCode ?? vesselCode.trim().toUpperCase();
  const { data: providersData } = useFetch<ListResponse<Provider>>(
    vesselForFetch ? `/app/providers?vesselCode=${vesselForFetch}&status=ACTIVE` : null,
    [vesselForFetch],
  );
  const { data: sparesData } = useFetch<ListResponse<Spare>>(
    tab === "lines" && vesselForFetch ? `/app/pms/spares?vesselCode=${vesselForFetch}` : null,
    [tab, vesselForFetch],
  );

  // ── Copilot ──
  useCopilotEmitter(order ? {
    module: "SPARE_ORDERS",
    screen: "SPARE_ORDER_EDIT",
    entityId: order.id,
    entityCode: order.orderCode,
    vesselCode: order.vesselCode,
    workflowStage: order.status,
    canEdit: !TERMINAL.has(order.status),
  } : { module: "SPARE_ORDERS", screen: "SPARE_ORDER_CREATE" });

  const loadLines = useCallback(async () => {
    if (!order) return;
    setLinesLoading(true);
    try {
      const res = await api.get<ListResponse<SpareOrderLine>>(`/app/pms/spare-orders/${order.id}/lines`);
      setLines(res.items);
    } catch { /* ignore */ }
    finally { setLinesLoading(false); }
  }, [order]);

  useEffect(() => {
    if (tab === "lines" && order) void loadLines();
  }, [tab, loadLines, order]);

  // ── Save order fields ──
  const handleSave = async () => {
    setError(null);
    setSaving(true);
    try {
      if (isNew) {
        const vessel = vesselCode.trim().toUpperCase();
        if (!vessel) { setError("Vessel es requerido."); setSaving(false); return; }
        const created = await api.post<SpareOrder>("/app/pms/spare-orders", {
          vesselCode: vessel,
          priority,
          providerId: providerId || null,
          requestedAt: new Date().toISOString(),
          expectedDeliveryDate: expectedDeliveryDate || null,
          totalCost: totalCost ? parseFloat(totalCost) : null,
          currency: currency || null,
          notes: notes || null,
        });
        onSaved(created);
      } else {
        const updated = await api.patch<SpareOrder>(`/app/pms/spare-orders/${order.id}`, {
          priority,
          providerId: providerId || null,
          expectedDeliveryDate: expectedDeliveryDate || null,
          totalCost: totalCost ? parseFloat(totalCost) : null,
          currency: currency || null,
          notes: notes || null,
        });
        onSaved(updated);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error al guardar.");
    } finally {
      setSaving(false);
    }
  };

  // ── Workflow transition ──
  const handleTransition = async (next: string) => {
    if (!order) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await api.patch<SpareOrder>(`/app/pms/spare-orders/${order.id}`, { status: next });
      onSaved(updated);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error al cambiar estado.");
    } finally { setSaving(false); }
  };

  // ── Cancel order ──
  const handleCancel = async () => {
    if (!order || !CANCELLABLE.has(order.status)) return;
    if (!window.confirm("¿Cancelar esta orden?")) return;
    await handleTransition("CANCELLED");
  };

  // ── Delete (DRAFT only) ──
  const handleDelete = async () => {
    if (!order || order.status !== "DRAFT") return;
    if (!window.confirm("¿Eliminar esta orden? Esta acción no se puede deshacer.")) return;
    setSaving(true);
    try {
      await api.delete(`/app/pms/spare-orders/${order.id}`);
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error al eliminar.");
      setSaving(false);
    }
  };

  // ── Add line ──
  const handleAddLine = async () => {
    if (!order) return;
    setLineSaving(true);
    try {
      await api.post(`/app/pms/spare-orders/${order.id}/lines`, {
        spareId:     lineForm.spareId || null,
        description: lineForm.description.trim() || (sparesData?.items.find(s => s.id === lineForm.spareId)?.name ?? ""),
        partNumber:  lineForm.partNumber || null,
        quantity:    parseFloat(lineForm.quantity) || 1,
        unit:        lineForm.unit || null,
        unitPrice:   lineForm.unitPrice ? parseFloat(lineForm.unitPrice) : null,
        currency:    lineForm.currency || null,
        notes:       lineForm.notes || null,
      });
      setLineForm({ spareId: "", description: "", partNumber: "", quantity: "1", unit: "", unitPrice: "", currency: "USD", notes: "" });
      setAddingLine(false);
      await loadLines();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error al agregar línea.");
    } finally { setLineSaving(false); }
  };

  // ── Delete line ──
  const handleDeleteLine = async (lineId: string) => {
    if (!order) return;
    try {
      await api.delete(`/app/pms/spare-orders/${order.id}/lines/${lineId}`);
      setLines(prev => prev.filter(l => l.id !== lineId));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error al eliminar línea.");
    }
  };

  const canEdit = isNew || !TERMINAL.has(order!.status);
  const workflowActions = order ? (WORKFLOW[order.status] ?? []) : [];

  // When spare is selected, auto-fill unit
  const onSpareSelect = (spareId: string) => {
    const spare = sparesData?.items.find(s => s.id === spareId);
    setLineForm(f => ({ ...f, spareId, description: spare?.name ?? f.description, unit: spare?.unit ?? f.unit }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-2xl bg-[#0D1B2A] border border-white/10 rounded-2xl shadow-2xl flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-3">
            <ShoppingCart className="w-4 h-4 text-accent" />
            <div>
              <h2 className="text-sm font-bold text-white">
                {isNew ? "Nueva Orden de Repuestos" : order.orderCode}
              </h2>
              {!isNew && (
                <p className="text-[10px] text-white/40 font-mono mt-0.5">Vessel: {order.vesselCode}</p>
              )}
            </div>
            {!isNew && <SoStatusBadge status={order.status} />}
          </div>
          <button onClick={onClose}><X className="w-5 h-5 text-white/40 hover:text-white" /></button>
        </div>

        {/* Tab bar (only for existing orders) */}
        {!isNew && (
          <div className="flex border-b border-white/10 shrink-0">
            {(["data", "lines"] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-5 py-2.5 text-xs font-semibold border-b-2 transition-colors ${tab === t ? "border-accent text-white" : "border-transparent text-white/40 hover:text-white/70"}`}
              >
                {t === "data" ? "Datos" : `Líneas${order.totalLines > 0 ? ` (${order.totalLines})` : ""}`}
              </button>
            ))}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 min-h-0">

          {/* ── Data tab ── */}
          {(isNew || tab === "data") && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                {/* Vessel — only editable when new */}
                <div>
                  <label className={labelCls}>Vessel *</label>
                  {isNew
                    ? <input value={vesselCode} onChange={e => setVesselCode(e.target.value.toUpperCase())} placeholder="e.g. VESSELCODE" className={inputCls} />
                    : <p className="text-sm font-mono text-accent">{order.vesselCode}</p>}
                </div>

                {/* Priority */}
                <div>
                  <label className={labelCls}>Prioridad</label>
                  <select value={priority} onChange={e => setPriority(e.target.value)} disabled={!canEdit} className={`${inputCls} disabled:opacity-50`}>
                    <option value="LOW">Baja</option>
                    <option value="MEDIUM">Media</option>
                    <option value="HIGH">Alta</option>
                    <option value="CRITICAL">Crítica</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* Provider */}
                <div>
                  <label className={labelCls}>Proveedor</label>
                  <select value={providerId} onChange={e => setProviderId(e.target.value)} disabled={!canEdit} className={`${inputCls} disabled:opacity-50`}>
                    <option value="">— Sin proveedor —</option>
                    {providersData?.items.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>

                {/* Expected delivery */}
                <div>
                  <label className={labelCls}>Fecha estimada entrega</label>
                  <input type="date" value={expectedDeliveryDate} onChange={e => setExpectedDeliveryDate(e.target.value)} disabled={!canEdit} className={`${inputCls} disabled:opacity-50`} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* Currency */}
                <div>
                  <label className={labelCls}>Moneda</label>
                  <input value={currency} onChange={e => setCurrency(e.target.value.toUpperCase())} disabled={!canEdit} maxLength={3} placeholder="USD" className={`${inputCls} disabled:opacity-50`} />
                </div>

                {/* Total cost */}
                <div>
                  <label className={labelCls}>Costo total estimado</label>
                  <input type="number" min="0" step="0.01" value={totalCost} onChange={e => setTotalCost(e.target.value)} disabled={!canEdit} placeholder="0.00" className={`${inputCls} disabled:opacity-50`} />
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className={labelCls}>Notas</label>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} disabled={!canEdit} rows={3} className={`${inputCls} resize-none disabled:opacity-50`} />
              </div>

              {/* Requested at (readonly, only for existing) */}
              {!isNew && (
                <p className="text-[10px] text-white/30">Solicitado: {fmtDate(order.requestedAt)}</p>
              )}
            </div>
          )}

          {/* ── Lines tab ── */}
          {!isNew && tab === "lines" && (
            <div className="space-y-3">
              {linesLoading && <p className="text-xs text-white/30 text-center py-4">Cargando líneas…</p>}

              {!linesLoading && lines.length === 0 && !addingLine && (
                <div className="text-center py-8 text-white/20">
                  <Package className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-xs">Sin líneas. Agregá ítems a esta orden.</p>
                </div>
              )}

              {/* Lines table */}
              {lines.length > 0 && (
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-white/30 border-b border-white/10">
                      <th className="text-left pb-2 font-semibold">Descripción</th>
                      <th className="text-left pb-2 font-semibold">N° Parte</th>
                      <th className="text-right pb-2 font-semibold">Cant.</th>
                      <th className="text-left pb-2 font-semibold pl-2">Unidad</th>
                      <th className="text-right pb-2 font-semibold">Precio U.</th>
                      {canEdit && <th className="w-8" />}
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map(l => (
                      <tr key={l.id} className="border-b border-white/5 hover:bg-white/3">
                        <td className="py-2 pr-3">
                          <p className="text-white font-medium">{l.description}</p>
                          {l.spareSku && <p className="text-white/30 font-mono text-[10px]">{l.spareSku}</p>}
                        </td>
                        <td className="py-2 pr-3 text-white/50 font-mono">{l.partNumber ?? "—"}</td>
                        <td className="py-2 text-right text-white font-bold">{l.quantity}</td>
                        <td className="py-2 pl-2 text-white/50">{l.unit ?? "—"}</td>
                        <td className="py-2 text-right text-white/70">
                          {l.unitPrice != null ? `${l.currency ?? ""} ${l.unitPrice.toLocaleString()}` : "—"}
                        </td>
                        {canEdit && (
                          <td className="py-2 pl-2">
                            <button onClick={() => void handleDeleteLine(l.id)} className="text-white/20 hover:text-red-400 transition-colors">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {/* Add line form */}
              {canEdit && addingLine && (
                <div className="border border-white/10 rounded-xl p-4 space-y-3 bg-white/3">
                  <p className="text-[10px] font-bold text-white/60 uppercase tracking-wider">Nueva línea</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2">
                      <label className={labelCls}>Repuesto (opcional)</label>
                      <select
                        value={lineForm.spareId}
                        onChange={e => onSpareSelect(e.target.value)}
                        className={inputCls}
                      >
                        <option value="">— Seleccionar repuesto —</option>
                        {sparesData?.items.map(s => (
                          <option key={s.id} value={s.id}>{s.sku} — {s.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="col-span-2">
                      <label className={labelCls}>Descripción *</label>
                      <input value={lineForm.description} onChange={e => setLineForm(f => ({ ...f, description: e.target.value }))} placeholder="Descripción del ítem" className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>N° Parte</label>
                      <input value={lineForm.partNumber} onChange={e => setLineForm(f => ({ ...f, partNumber: e.target.value }))} placeholder="Opcional" className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>Unidad</label>
                      <input value={lineForm.unit} onChange={e => setLineForm(f => ({ ...f, unit: e.target.value }))} placeholder="ud, m, kg…" className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>Cantidad *</label>
                      <input type="number" min="0.01" step="0.01" value={lineForm.quantity} onChange={e => setLineForm(f => ({ ...f, quantity: e.target.value }))} className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>Precio unitario</label>
                      <input type="number" min="0" step="0.01" value={lineForm.unitPrice} onChange={e => setLineForm(f => ({ ...f, unitPrice: e.target.value }))} placeholder="0.00" className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>Moneda</label>
                      <input value={lineForm.currency} onChange={e => setLineForm(f => ({ ...f, currency: e.target.value.toUpperCase() }))} maxLength={3} placeholder="USD" className={inputCls} />
                    </div>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setAddingLine(false)} className="px-3 py-1.5 text-xs text-white/40 hover:text-white rounded-lg border border-white/10 hover:border-white/20">Cancelar</button>
                    <button onClick={() => void handleAddLine()} disabled={lineSaving || !lineForm.description.trim()} className="px-4 py-1.5 text-xs font-semibold bg-accent/20 border border-accent/30 text-accent rounded-lg hover:bg-accent/30 disabled:opacity-40">
                      {lineSaving ? "Guardando…" : "Agregar"}
                    </button>
                  </div>
                </div>
              )}

              {/* Add line button */}
              {canEdit && !addingLine && (
                <button onClick={() => setAddingLine(true)} className="flex items-center gap-1.5 text-xs text-accent/70 hover:text-accent transition-colors py-1">
                  <Plus className="w-3.5 h-3.5" /> Agregar línea
                </button>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/10 shrink-0 space-y-2">
          {error && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}

          {/* Workflow actions */}
          {!isNew && workflowActions.length > 0 && (
            <div className="flex flex-wrap gap-2 pb-1">
              {workflowActions.map(a => (
                <button key={a.next} onClick={() => void handleTransition(a.next)} disabled={saving} className={`px-4 py-1.5 text-xs font-semibold rounded-lg border transition-all disabled:opacity-40 ${a.cls}`}>
                  {a.label}
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <div className="flex gap-2">
              {/* Delete (DRAFT only) */}
              {!isNew && order.status === "DRAFT" && (
                <button onClick={() => void handleDelete()} disabled={saving} className="px-3 py-1.5 text-xs text-red-400/70 hover:text-red-400 border border-red-500/20 hover:border-red-500/40 rounded-lg transition-colors disabled:opacity-40">
                  Eliminar
                </button>
              )}
              {/* Cancel */}
              {!isNew && CANCELLABLE.has(order.status) && (
                <button onClick={() => void handleCancel()} disabled={saving} className="px-3 py-1.5 text-xs text-orange-400/70 hover:text-orange-400 border border-orange-500/20 hover:border-orange-500/40 rounded-lg transition-colors disabled:opacity-40">
                  Cancelar orden
                </button>
              )}
            </div>
            <div className="flex gap-2 ml-auto">
              <button onClick={onClose} className="px-4 py-1.5 text-xs text-white/50 hover:text-white rounded-lg border border-white/10 hover:border-white/20 transition-colors">
                Cerrar
              </button>
              {canEdit && (
                <button onClick={() => void handleSave()} disabled={saving} className="px-5 py-1.5 text-xs font-semibold bg-accent/20 border border-accent/30 text-accent rounded-lg hover:bg-accent/30 disabled:opacity-40 transition-all">
                  {saving ? "Guardando…" : (isNew ? "Crear orden" : "Guardar")}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// SpareOrdersPage
// ---------------------------------------------------------------------------

export const SpareOrdersPage: React.FC = () => {
  const t = useT();

  // Filters
  const [vesselInput,    setVesselInput]    = useState("");
  const [vesselFilter,   setVesselFilter]   = useState("");
  const [statusFilter,   setStatusFilter]   = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");

  // Modal
  const [selected, setSelected] = useState<SpareOrder | null | "new">(null);

  useCopilotEmitter({ module: "SPARE_ORDERS", screen: "SPARE_ORDER_LIST" });

  const buildPath = () => {
    const params = new URLSearchParams();
    if (vesselFilter)   params.set("vesselCode", vesselFilter);
    if (statusFilter)   params.set("status",     statusFilter);
    if (priorityFilter) params.set("priority",   priorityFilter);
    const qs = params.toString();
    return `/app/pms/spare-orders${qs ? `?${qs}` : ""}`;
  };

  const { data, loading, error, reload } = useFetch<ListResponse<SpareOrder>>(
    buildPath(),
    [vesselFilter, statusFilter, priorityFilter],
  );

  const handleSaved = (updated: SpareOrder) => {
    reload();
    setSelected(updated);
  };

  const COLUMNS: Column<SpareOrder>[] = [
    { key: "orderCode",            header: t("col.code"),     render: r => <span className="font-mono font-bold text-white text-xs">{r.orderCode}</span> },
    { key: "vesselCode",           header: t("col.vessel"),   render: r => <span className="font-mono text-accent text-xs">{r.vesselCode}</span> },
    { key: "status",               header: t("col.status"),   render: r => <SoStatusBadge status={r.status} /> },
    { key: "priority",             header: t("col.priority"), render: r => <PriorityBadge priority={r.priority} /> },
    { key: "providerName",         header: "Proveedor",       render: r => r.providerName ? <span className="text-white/70 text-xs">{r.providerName}</span> : <span className="text-white/20">—</span> },
    { key: "expectedDeliveryDate", header: "Entrega estimada",render: r => fmtDate(r.expectedDeliveryDate) },
    { key: "totalLines",           header: "Líneas",          render: r => <span className={`font-bold text-xs ${r.totalLines > 0 ? "text-white" : "text-white/20"}`}>{r.totalLines}</span> },
    { key: "totalCost",            header: t("col.amount"),   render: r => r.totalCost != null ? <span className="text-white/70 text-xs">{r.currency ?? "USD"} {r.totalCost.toLocaleString()}</span> : <span className="text-white/20">—</span> },
  ];

  return (
    <div className="space-y-5">
      {selected && (
        <SpareOrderModal
          order={selected === "new" ? null : selected}
          onClose={() => setSelected(null)}
          onSaved={handleSaved}
        />
      )}

      <PageHeader icon={ShoppingCart} title={t("page.spareOrders")} total={data?.total} onReload={reload}>
        {/* Vessel filter */}
        <input
          value={vesselInput}
          onChange={e => setVesselInput(e.target.value.toUpperCase())}
          onKeyDown={e => { if (e.key === "Enter") setVesselFilter(vesselInput.trim()); }}
          onBlur={() => setVesselFilter(vesselInput.trim())}
          placeholder="Vessel…"
          className="w-28 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-text-industrial placeholder-text-industrial/30 focus:outline-none focus:border-accent/50"
        />

        {/* Status filter */}
        <select value={toFilterSelectValue(statusFilter)} onChange={e => setStatusFilter(fromFilterSelectValue(e.target.value))} className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-text-industrial focus:outline-none focus:border-accent/50">
          <option value={FILTER_ALL_VALUE}>{t("status.all")}</option>
          <option value="DRAFT">{STATUS_LABELS.DRAFT}</option>
          <option value="REQUESTED">{STATUS_LABELS.REQUESTED}</option>
          <option value="APPROVED">{STATUS_LABELS.APPROVED}</option>
          <option value="ORDERED">{STATUS_LABELS.ORDERED}</option>
          <option value="PARTIALLY_RECEIVED">{STATUS_LABELS.PARTIALLY_RECEIVED}</option>
          <option value="RECEIVED">{STATUS_LABELS.RECEIVED}</option>
          <option value="CANCELLED">{STATUS_LABELS.CANCELLED}</option>
        </select>

        {/* Priority filter */}
        <select value={toFilterSelectValue(priorityFilter)} onChange={e => setPriorityFilter(fromFilterSelectValue(e.target.value))} className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-text-industrial focus:outline-none focus:border-accent/50">
          <option value={FILTER_ALL_VALUE}>Todas las prioridades</option>
          <option value="LOW">Baja</option>
          <option value="MEDIUM">Media</option>
          <option value="HIGH">Alta</option>
          <option value="CRITICAL">Crítica</option>
        </select>

        {/* Create button */}
        <button onClick={() => setSelected("new")} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent/10 border border-accent/20 text-xs text-accent hover:bg-accent/20 transition-all font-semibold">
          <Plus className="w-3.5 h-3.5" /> Nueva orden
        </button>
      </PageHeader>

      <DataTable
        columns={COLUMNS}
        data={data?.items ?? null}
        loading={loading}
        error={error}
        keyFn={r => r.id}
        emptyText={t("empty.spareOrders")}
        onRowClick={r => setSelected(r)}
      />
    </div>
  );
};
