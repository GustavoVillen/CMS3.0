import React, { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ClipboardList, Plus, X, Trash2, CheckCheck, XCircle, Send, Maximize2, Minimize2, FileDown, PackageCheck } from "lucide-react";
import { api } from "../lib/api";
import { useFetch } from "../lib/hooks";
import { DataTable, StatusBadge, fmtDate, type Column } from "../components/DataTable";
import { FILTER_ALL_VALUE, fromFilterSelectValue, toFilterSelectValue } from "../lib/utils";
import { PageHeader } from "../components/PageHeader";
import { ExportExcelButton } from "../components/ExportExcelButton";
import { useT } from "../lib/i18n";
import { useAuth } from "../lib/auth";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RequestItem {
  id: string; spareRequestId: string;
  spareId: string | null; spareSku: string | null; spareName: string | null;
  description: string; quantity: number; unit: string;
  quantityReserved: number; quantityFulfilled: number;
  status: string; notes: string | null;
}

interface SpareRequest {
  id: string; requestCode: string; status: string; priority: string;
  requestedByUserId: string; requestedAt: string;
  approvedByUserId: string | null; approvedAt: string | null;
  rejectionReason: string | null; notes: string | null;
  requestedForVesselCode: string | null; requestedForAssetId: string | null;
  requestedForLocationId: string | null; createdAt: string;
  items: { id: string; status: string; quantity: number; quantityFulfilled: number }[];
}
interface ListResponse { items: SpareRequest[]; total: number; }

interface SpareOption { id: string; sku: string; name: string; unit: string; vesselCode: string; criticality: string; available: number; }

function CritBadge({ crit }: { crit: string }) {
  const cls =
    crit === "A" ? "bg-red-500/10 text-red-400 border-red-500/20"
    : crit === "B" ? "bg-yellow-500/10 text-yellow-400 border-yellow-500/20"
    : "bg-white/5 text-white/40 border-white/10";
  return (
    <span className={`inline-flex items-center justify-center w-4 h-4 rounded text-[9px] font-bold border shrink-0 ${cls}`}>
      {crit || "?"}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Borrador", SUBMITTED: "Enviada", APPROVED: "Aprobada",
  REJECTED: "Rechazada", PARTIALLY_FULFILLED: "Parcialmente atendida",
  FULFILLED: "Atendida", CANCELLED: "Cancelada",
};
const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-white/5 text-white/50 border-white/10",
  SUBMITTED: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  APPROVED: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  REJECTED: "bg-red-500/10 text-red-400 border-red-500/20",
  PARTIALLY_FULFILLED: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  FULFILLED: "bg-white/5 text-white/40 border-white/10",
  CANCELLED: "bg-white/5 text-white/30 border-white/10",
};
const PRIORITY_COLORS: Record<string, string> = {
  LOW: "text-white/40", MEDIUM: "text-blue-400", HIGH: "text-yellow-400", CRITICAL: "text-red-400",
};

function ReqStatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-bold ${STATUS_COLORS[status] ?? STATUS_COLORS.DRAFT}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const inputCls = "w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder-white/20 focus:outline-none focus:border-accent/50";
const labelCls = "block text-[10px] font-semibold text-white/50 uppercase tracking-wider mb-1";

// ---------------------------------------------------------------------------
// ItemsTab
// ---------------------------------------------------------------------------

interface ItemsTabProps {
  request: SpareRequest;
  items: RequestItem[];
  loadingItems: boolean;
  onItemsChange: () => void;
  vesselCode: string;
}

const ItemsTab: React.FC<ItemsTabProps> = ({ request, items, loadingItems, onItemsChange, vesselCode }) => {
  const t = useT();
  const [qty,      setQty]     = useState("1");
  const [notes,    setNotes]   = useState("");
  const [adding,   setAdding]  = useState(false);
  const [addErr,   setAddErr]  = useState<string | null>(null);

  // Search-dropdown state (same pattern as WorkOrders)
  const [search,      setSearch]      = useState("");
  const [dropdown,    setDropdown]    = useState(false);
  const [spareId,     setSpareId]     = useState("");
  const [spareName,   setSpareName]   = useState("");
  const [spareUnit,   setSpareUnit]   = useState("");

  // New spare registration
  const [showNewSpare,   setShowNewSpare]   = useState(false);
  const [newSpareSku,    setNewSpareSku]    = useState("");
  const [newSpareName,   setNewSpareName]   = useState("");
  const [newSpareUnit,   setNewSpareUnit]   = useState("");
  const [newSpareCrit,   setNewSpareCrit]   = useState("B");
  const [savingSpare,    setSavingSpare]    = useState(false);
  const [newSpareErr,    setNewSpareErr]    = useState<string | null>(null);

  const { data: sparesData, reload: reloadSpares } = useFetch<{ items: SpareOption[] }>(
    vesselCode ? `/app/pms/spares?vesselCode=${vesselCode}&status=ACTIVE` : null,
    [vesselCode],
  );
  const spares = sparesData?.items ?? [];

  const [receiving, setReceiving]       = useState<string | null>(null); // itemId being received
  const [receivedAt, setReceivedAt]     = useState(new Date().toISOString().slice(0, 10));
  const [receiptNotes, setReceiptNotes] = useState("");
  const [delivering, setDelivering]     = useState(false);
  const [deliverErr, setDeliverErr]     = useState<string | null>(null);

  const handleDeliver = async () => {
    if (!receiving) return;
    setDelivering(true); setDeliverErr(null);
    try {
      await api.post(`/app/pms/spare-requests/${request.id}/items/${receiving}/fulfill`, {
        receivedAt, receiptNotes: receiptNotes.trim() || null,
      });
      setReceiving(null); setReceiptNotes("");
      onItemsChange();
    } catch (e: unknown) {
      setDeliverErr(e instanceof Error ? e.message : "Error al registrar recepción.");
    } finally { setDelivering(false); }
  };

  const canEdit = request.status === "DRAFT";
  const canDeliver = ["APPROVED", "PARTIALLY_FULFILLED"].includes(request.status);

  const handleRegisterSpare = async () => {
    if (!newSpareSku.trim() || !newSpareName.trim() || !newSpareUnit.trim()) {
      setNewSpareErr(t("error.skuNameUnitRequired")); return;
    }
    if (!vesselCode) { setNewSpareErr(t("error.vesselAssignedRequired")); return; }
    setSavingSpare(true); setNewSpareErr(null);
    try {
      const created = await api.post<SpareOption>("/app/pms/spares", {
        vesselCode,
        sku: newSpareSku.trim().toUpperCase(),
        name: newSpareName.trim(),
        unit: newSpareUnit.trim(),
        criticality: newSpareCrit,
        status: "ACTIVE",
      });
      reloadSpares();
      setSpareId(created.id);
      setSearch(`${created.sku} — ${created.name}`);
      setSpareName(created.name);
      setSpareUnit(created.unit);
      setShowNewSpare(false);
      setNewSpareSku(""); setNewSpareName(""); setNewSpareUnit(""); setNewSpareCrit("B");
    } catch (e: unknown) {
      setNewSpareErr(e instanceof Error ? e.message : "Error al crear el repuesto.");
    } finally { setSavingSpare(false); }
  };

  const handleAdd = async () => {
    setAddErr(null);
    if (!spareId) { setAddErr(t("error.selectSpare")); return; }
    setAdding(true);
    try {
      await api.post(`/app/pms/spare-requests/${request.id}/items`, {
        spareId,
        description: spareName,
        quantity: parseFloat(qty) || 1,
        unit: spareUnit,
        notes: notes.trim() || null,
      });
      setSearch(""); setQty("1"); setSpareId(""); setSpareName(""); setSpareUnit(""); setNotes("");
      onItemsChange();
    } catch (e: unknown) {
      setAddErr(e instanceof Error ? e.message : "Error al agregar.");
    } finally { setAdding(false); }
  };

  const handleDelete = async (itemId: string) => {
    if (!window.confirm("¿Eliminar este ítem?")) return;
    try {
      await api.delete(`/app/pms/spare-requests/${request.id}/items/${itemId}`);
      onItemsChange();
    } catch { /* ignore */ }
  };

if (loadingItems) return <p className="text-xs text-white/30 py-4 text-center">Cargando ítems…</p>;

  return (
    <div className="space-y-4">
      {/* Item list */}
      {items.length === 0
        ? <p className="text-xs text-white/20 py-4 text-center">Sin ítems. Agrega repuestos a solicitar.</p>
        : (
          <div className="border border-white/10 rounded-xl overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/10 text-[10px] text-white/30 uppercase tracking-wider">
                  <th className="px-3 py-2 text-left">Descripción / SKU</th>
                  <th className="px-3 py-2 text-right">Cant.</th>
                  <th className="px-3 py-2 text-left">Ud.</th>
                  <th className="px-3 py-2 text-left">Estado</th>
                  <th className="px-3 py-2 text-right">Entregado</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {items.map(item => (
                  <tr key={item.id} className="border-b border-white/5 last:border-0">
                    <td className="px-3 py-2">
                      <span className="text-white">{item.description}</span>
                      {item.spareSku && <span className="ml-2 font-mono text-accent text-[10px]">{item.spareSku}</span>}
                    </td>
                    <td className="px-3 py-2 text-right text-white/70">{item.quantity}</td>
                    <td className="px-3 py-2 text-white/40">{item.unit}</td>
                    <td className="px-3 py-2"><StatusBadge status={item.status} /></td>
                    <td className="px-3 py-2 text-right text-emerald-400">{item.quantityFulfilled > 0 ? item.quantityFulfilled : "—"}</td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-1 justify-end">
                        {canDeliver && item.status !== "FULFILLED" && item.status !== "CANCELLED" && (
                          <button
                            onClick={() => { setReceiving(item.id); setReceivedAt(new Date().toISOString().slice(0,10)); setReceiptNotes(""); setDeliverErr(null); }}
                            className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 rounded-lg hover:bg-yellow-500/20 transition-all"
                          >
                            <PackageCheck className="w-3 h-3" /> {t("confirm.confirmReceipt")}
                          </button>
                        )}
                        {canEdit && (
                          <button onClick={() => void handleDelete(item.id)} className="text-white/20 hover:text-red-400 transition-colors">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}


      {/* Receipt form */}
      {receiving && (
        <div className="border border-emerald-500/20 rounded-xl p-4 space-y-3 bg-emerald-500/5">
          <p className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">Confirmar recepción</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Fecha de recepción *</label>
              <input type="date" value={receivedAt} onChange={e => setReceivedAt(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Comentarios</label>
              <input value={receiptNotes} onChange={e => setReceiptNotes(e.target.value)} placeholder="Estado del producto, observaciones…" className={inputCls} />
            </div>
          </div>
          {deliverErr && <p className="text-[10px] text-red-400">{deliverErr}</p>}
          <div className="flex gap-2">
            <button onClick={() => void handleDeliver()} disabled={delivering}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 rounded-lg hover:bg-emerald-500/30 disabled:opacity-40 transition-all">
              <PackageCheck className="w-3.5 h-3.5" />
              {delivering ? "Registrando…" : "Confirmar recepción"}
            </button>
            <button onClick={() => setReceiving(null)} className="px-3 py-1.5 text-xs text-white/30 hover:text-white border border-white/10 rounded-lg transition-colors">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Add form (DRAFT only) */}
      {canEdit && (
        <div className="border border-white/10 rounded-xl p-4 space-y-3 bg-white/[0.02]">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-bold text-white/40 uppercase tracking-wider">Agregar ítem</p>
            {vesselCode && (
              <button type="button" onClick={() => setShowNewSpare(v => !v)}
                className="text-[10px] text-accent/70 hover:text-accent underline">
                {showNewSpare ? "Cancelar" : "+ Registrar repuesto nuevo"}
              </button>
            )}
          </div>

          {/* Mini-form to register new spare */}
          {showNewSpare && (
            <div className="border border-accent/20 rounded-xl p-3 space-y-2 bg-accent/5">
              <p className="text-[10px] font-bold text-accent/70 uppercase tracking-wider">Registrar repuesto (stock 0)</p>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className={labelCls}>SKU *</label>
                  <input value={newSpareSku} onChange={e => setNewSpareSku(e.target.value.toUpperCase())} placeholder="REP-001" className={inputCls} />
                </div>
                <div className="col-span-2">
                  <label className={labelCls}>Nombre *</label>
                  <input value={newSpareName} onChange={e => setNewSpareName(e.target.value)} placeholder="Descripción del repuesto" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Unidad *</label>
                  <input value={newSpareUnit} onChange={e => setNewSpareUnit(e.target.value)} placeholder="ud, kg…" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Criticidad</label>
                  <select value={newSpareCrit} onChange={e => setNewSpareCrit(e.target.value)} className={inputCls}>
                    <option value="A">A — Crítico</option>
                    <option value="B">B — Importante</option>
                    <option value="C">C — Menor</option>
                  </select>
                </div>
              </div>
              {newSpareErr && <p className="text-[10px] text-red-400">{newSpareErr}</p>}
              <button onClick={() => void handleRegisterSpare()} disabled={savingSpare}
                className="px-3 py-1.5 text-[10px] font-bold bg-accent/20 border border-accent/30 text-accent rounded-lg hover:bg-accent/30 disabled:opacity-40">
                {savingSpare ? "Registrando…" : "Registrar y vincular"}
              </button>
            </div>
          )}

          {/* Search + qty row */}
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2 relative">
              <input
                type="text"
                value={search}
                onChange={e => { setSearch(e.target.value); setSpareId(""); setSpareName(""); setSpareUnit(""); setDropdown(true); }}
                onFocus={() => setDropdown(true)}
                onBlur={() => setTimeout(() => setDropdown(false), 150)}
                placeholder="Buscar por SKU o nombre…"
                className={inputCls}
              />
              {dropdown && (
                <div className="absolute z-20 w-full mt-1 bg-[#0D1B2A] border border-white/10 rounded-xl shadow-xl max-h-52 overflow-y-auto">
                  {(() => {
                    const q = search.toLowerCase();
                    const filtered = q
                      ? spares.filter(s => s.sku.toLowerCase().includes(q) || s.name.toLowerCase().includes(q))
                      : spares.slice(0, 30);
                    if (filtered.length === 0)
                      return <p className="px-3 py-2 text-xs text-white/30">Sin resultados{!vesselCode ? " — seleccioná un buque primero" : ""}</p>;
                    return filtered.map(s => (
                      <button key={s.id} type="button"
                        onMouseDown={() => {
                          setSpareId(s.id);
                          setSpareName(s.name);
                          setSpareUnit(s.unit);
                          setSearch(`${s.sku} — ${s.name}`);
                          setDropdown(false);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-white/5 text-left">
                        <CritBadge crit={s.criticality} />
                        <span className="flex-1 text-white">{s.sku} — {s.name}</span>
                        {s.available <= 0
                          ? <span className="text-red-400 text-[10px] font-semibold shrink-0">SIN STOCK</span>
                          : <span className="text-white/30 text-[10px] shrink-0">disp: {s.available} {s.unit}</span>
                        }
                      </button>
                    ));
                  })()}
                </div>
              )}
            </div>
            <div className="flex gap-1">
              <input type="number" min="0.01" step="0.01" value={qty} onChange={e => setQty(e.target.value)}
                placeholder="Cant." className={inputCls} />
              <button onClick={() => void handleAdd()} disabled={adding || !spareId}
                className="px-3 py-2 rounded-xl bg-accent/20 text-accent text-xs font-bold hover:bg-accent/30 disabled:opacity-40 shrink-0 transition-all">
                {adding ? "…" : "+"}
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className={labelCls}>Notas (opcional)</label>
            <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Observaciones sobre este ítem…" className={inputCls} />
          </div>

          {addErr && <p className="text-xs text-red-400">{addErr}</p>}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// SpareRequestModal
// ---------------------------------------------------------------------------

interface ModalProps {
  request: SpareRequest | null;
  onClose: () => void;
  onSaved: (r: SpareRequest) => void;
}

const SpareRequestModal: React.FC<ModalProps> = ({ request, onClose, onSaved }) => {
  const isNew = request === null;
  const { user } = useAuth();
  const t = useT();
  const canApprove = ["TENANT_ADMIN", "FLEET_SUPERINTENDENT"].includes(user?.role ?? "");
  const [tab, setTab] = useState<"data" | "items">("data");

  const [priority,    setPriority]    = useState(request?.priority    ?? "MEDIUM");
  const [notes,       setNotes]       = useState(request?.notes       ?? "");
  const [vesselCode,  setVesselCode]  = useState(request?.requestedForVesselCode ?? "");

  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const [rejecting,   setRejecting]   = useState(false);
  const [rejectReason,setRejectReason]= useState("");
  const [expanded,    setExpanded]    = useState(true);

  // Items state
  const { data: itemsData, reload: reloadItems } = useFetch<{ items: RequestItem[] }>(
    !isNew ? `/app/pms/spare-requests/${request.id}/items` : null, [request?.id],
  );
  const items = itemsData?.items ?? [];

  const handleSave = async () => {
    setError(null);
    setSaving(true);
    try {
      const payload = {
        priority: priority as "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
        notes: notes.trim() || null,
        requestedForVesselCode: vesselCode.trim().toUpperCase() || null,
      };
      const result = isNew
        ? await api.post<SpareRequest>("/app/pms/spare-requests", payload)
        : await api.patch<SpareRequest>(`/app/pms/spare-requests/${request.id}`, payload);
      onSaved(result);
      if (isNew) setTab("items");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error al guardar.");
    } finally { setSaving(false); }
  };

  const doAction = async (action: "submit" | "approve" | "cancel") => {
    setSaving(true);
    try {
      const result = await api.post<SpareRequest>(`/app/pms/spare-requests/${request!.id}/${action}`, {});
      onSaved(result);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error.");
    } finally { setSaving(false); }
  };

  const doReject = async () => {
    if (!rejectReason.trim()) { setError(t("error.rejectReasonRequired")); return; }
    setSaving(true);
    try {
      const result = await api.post<SpareRequest>(`/app/pms/spare-requests/${request!.id}/reject`, { reason: rejectReason.trim() });
      onSaved(result);
      setRejecting(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error.");
    } finally { setSaving(false); }
  };

  const status = request?.status ?? "DRAFT";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className={`w-full bg-[#0D1B2A] border border-white/10 rounded-2xl shadow-2xl flex flex-col transition-all duration-200 ${expanded ? "w-full h-full" : "max-w-2xl max-h-[90vh]"}`} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-3">
            <ClipboardList className="w-4 h-4 text-accent" />
            <div>
              <h2 className="text-sm font-bold text-white">{isNew ? "Nueva Solicitud" : request.requestCode}</h2>
              {!isNew && <p className="text-[10px] text-white/40 mt-0.5">{fmtDate(request.requestedAt)}{request.requestedForVesselCode ? ` · Vessel: ${request.requestedForVesselCode}` : ""}</p>}
            </div>
            {!isNew && <ReqStatusBadge status={status} />}
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setExpanded(v => !v)} className="p-1.5 rounded-lg text-white/30 hover:text-white hover:bg-white/5 transition-colors" title={expanded ? "Reducir" : "Ampliar"}>
              {expanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
            <button onClick={onClose}><X className="w-5 h-5 text-white/40 hover:text-white" /></button>
          </div>
        </div>

        {/* Tabs (only when editing) */}
        {!isNew && (
          <div className="flex border-b border-white/10 shrink-0">
            {(["data", "items"] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-5 py-2.5 text-xs font-semibold transition-colors ${tab === t ? "text-accent border-b-2 border-accent" : "text-white/40 hover:text-white/70"}`}>
                {t === "data" ? "Datos" : `Ítems (${items.length})`}
              </button>
            ))}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 min-h-0">
          {(isNew || tab === "data") && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Prioridad</label>
                  <select value={priority} onChange={e => setPriority(e.target.value)} disabled={status !== "DRAFT"} className={inputCls}>
                    <option value="LOW">Baja</option>
                    <option value="MEDIUM">Media</option>
                    <option value="HIGH">Alta</option>
                    <option value="CRITICAL">Crítica</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Vessel destino</label>
                  <input value={vesselCode} onChange={e => setVesselCode(e.target.value.toUpperCase())} placeholder="VESSEL (opcional)" disabled={status !== "DRAFT"} className={inputCls} />
                </div>
              </div>
              <div>
                <label className={labelCls}>Notas</label>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Contexto de la solicitud…" disabled={status !== "DRAFT"} className={`${inputCls} resize-none`} />
              </div>
              {request?.rejectionReason && (
                <div className="border border-red-500/20 rounded-xl p-3 bg-red-500/5">
                  <p className="text-[10px] font-bold text-red-400/70 uppercase mb-1">Motivo de rechazo</p>
                  <p className="text-xs text-red-300">{request.rejectionReason}</p>
                </div>
              )}
              {!isNew && request.approvedAt && (
                <p className="text-[10px] text-white/20">Aprobado: {fmtDate(request.approvedAt)}</p>
              )}
            </div>
          )}

          {!isNew && tab === "items" && (
            <ItemsTab
              request={request}
              items={items}
              loadingItems={false}
              onItemsChange={async () => {
                reloadItems();
                const updated = await api.get<SpareRequest>(`/app/pms/spare-requests/${request.id}`);
                onSaved(updated);
              }}
              vesselCode={request.requestedForVesselCode ?? ""}
            />
          )}

          {/* Reject dialog inline */}
          {rejecting && (
            <div className="mt-4 border border-red-500/20 rounded-xl p-4 space-y-2 bg-red-500/5">
              <p className="text-xs font-semibold text-red-400">Razón de rechazo</p>
              <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} rows={2} className={`${inputCls} resize-none`} placeholder="Motivo del rechazo…" />
              <div className="flex gap-2">
                <button onClick={() => void doReject()} disabled={saving} className="px-3 py-1.5 text-xs font-semibold bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg hover:bg-red-500/20 disabled:opacity-40">
                  {t("confirm.confirmRejection")}
                </button>
                <button onClick={() => setRejecting(false)} className="px-3 py-1.5 text-xs text-white/40 hover:text-white border border-white/10 rounded-lg">
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/10 shrink-0 space-y-2">
          {error && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}
          <div className="flex items-center justify-between gap-3">
            {/* Left — PDF */}
            <div className="flex gap-2">
              {!isNew && (
                <button
                  onClick={() => {
                    const token = localStorage.getItem("gpms_token") ?? "";
                    const slug  = localStorage.getItem("gpms_tenant_slug") ?? "";
                    void fetch(`/app/pms/spare-requests/${request.id}/pdf`, {
                      headers: { Authorization: `Bearer ${token}`, "X-Tenant-Slug": slug },
                    }).then(r => r.blob()).then(blob => {
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url; a.download = `${request.requestCode}.pdf`;
                      document.body.appendChild(a); a.click(); document.body.removeChild(a);
                      setTimeout(() => URL.revokeObjectURL(url), 60_000);
                    });
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white/5 border border-white/10 text-white/50 rounded-lg hover:bg-white/10 hover:text-white transition-all"
                >
                  <FileDown className="w-3.5 h-3.5" /> Generar PDF
                </button>
              )}
              {!isNew && ["DRAFT","SUBMITTED","APPROVED"].includes(status) && (
                <button onClick={() => void doAction("cancel")} disabled={saving} className="px-3 py-1.5 text-xs text-white/30 hover:text-white/60 border border-white/10 rounded-lg transition-colors disabled:opacity-40">
                  Cancelar solicitud
                </button>
              )}
            </div>

            {/* Right — workflow + save/close */}
            <div className="flex gap-2">
              <button onClick={onClose} className="px-4 py-1.5 text-xs text-white/50 hover:text-white rounded-lg border border-white/10 hover:border-white/20 transition-colors">Cerrar</button>
              {(isNew || status === "DRAFT") && (
                <button onClick={() => void handleSave()} disabled={saving} className="px-5 py-1.5 text-xs font-semibold bg-accent/20 border border-accent/30 text-accent rounded-lg hover:bg-accent/30 disabled:opacity-40 transition-all">
                  {saving ? "Guardando…" : (isNew ? "Crear solicitud" : "Guardar")}
                </button>
              )}
              {!isNew && status === "SUBMITTED" && canApprove && (
                <>
                  <button onClick={() => void doAction("approve")} disabled={saving} className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-lg hover:bg-emerald-500/20 disabled:opacity-40 transition-all">
                    <CheckCheck className="w-3 h-3" /> Aprobar
                  </button>
                  <button onClick={() => setRejecting(true)} disabled={saving} className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg hover:bg-red-500/20 disabled:opacity-40 transition-all">
                    <XCircle className="w-3 h-3" /> Rechazar
                  </button>
                </>
              )}
              {!isNew && status === "DRAFT" && (
                <button onClick={() => void doAction("submit")} disabled={saving} className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-blue-500/10 border border-blue-500/20 text-blue-400 rounded-lg hover:bg-blue-500/20 disabled:opacity-40 transition-all">
                  <Send className="w-3 h-3" /> Enviar
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
// SpareRequestsPage
// ---------------------------------------------------------------------------

export const SpareRequestsPage: React.FC = () => {
  const t = useT();

  const [searchParams] = useSearchParams();
  const [statusFilter,   setStatusFilter]   = useState(searchParams.get("status") ?? "");
  const [priorityFilter, setPriorityFilter] = useState(searchParams.get("priority") ?? "");
  const [selected,       setSelected]       = useState<SpareRequest | null | "new">(null);

  const buildPath = () => {
    const p = new URLSearchParams();
    if (statusFilter)   p.set("status",   statusFilter);
    if (priorityFilter) p.set("priority", priorityFilter);
    const qs = p.toString();
    return `/app/pms/spare-requests${qs ? `?${qs}` : ""}`;
  };

  const { data, loading, error, reload } = useFetch<ListResponse>(buildPath(), [statusFilter, priorityFilter]);

  const handleSaved = (r: SpareRequest) => { reload(); setSelected(r); };

  const COLUMNS: Column<SpareRequest>[] = [
    { key: "requestCode", header: t("col.code"), render: r => <span className="font-mono font-bold text-white text-xs">{r.requestCode}</span> },
    { key: "status",      header: t("col.status"), render: r => <ReqStatusBadge status={r.status} /> },
    { key: "priority",    header: t("col.priority"), render: r => <span className={`text-xs font-semibold ${PRIORITY_COLORS[r.priority] ?? ""}`}>{r.priority}</span> },
    { key: "requestedForVesselCode", header: t("col.vessel"), render: r => <span className="font-mono text-accent text-xs">{r.requestedForVesselCode ?? "—"}</span> },
    { key: "items",       header: "Ítems", render: r => <span className="text-xs text-white/50">{r.items?.length ?? 0}</span> },
    { key: "notes",       header: t("col.description"), render: r => <span className="text-xs text-white/40 truncate max-w-[180px] block">{r.notes ?? "—"}</span> },
    { key: "requestedAt", header: t("col.requested"), render: r => fmtDate(r.requestedAt) },
  ];

  return (
    <div className="space-y-5">
      {selected && (
        <SpareRequestModal
          request={selected === "new" ? null : selected}
          onClose={() => setSelected(null)}
          onSaved={handleSaved}
        />
      )}

      <PageHeader icon={ClipboardList} title="Solicitudes de Repuestos" total={data?.total} onReload={reload}>
        <ExportExcelButton module="spare_requests" />
        <select value={toFilterSelectValue(statusFilter)} onChange={e => setStatusFilter(fromFilterSelectValue(e.target.value))} className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-text-industrial focus:outline-none focus:border-accent/50">
          <option value={FILTER_ALL_VALUE}>{t("status.all")}</option>
          <option value="PENDING">Pendientes de recepción</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>

        <select value={toFilterSelectValue(priorityFilter)} onChange={e => setPriorityFilter(fromFilterSelectValue(e.target.value))} className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-text-industrial focus:outline-none focus:border-accent/50">
          <option value={FILTER_ALL_VALUE}>Toda prioridad</option>
          <option value="LOW">Baja</option>
          <option value="MEDIUM">Media</option>
          <option value="HIGH">Alta</option>
          <option value="CRITICAL">Crítica</option>
        </select>

        <button onClick={() => setSelected("new")} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent/10 border border-accent/20 text-xs text-accent hover:bg-accent/20 transition-all font-semibold">
          <Plus className="w-3.5 h-3.5" /> Nueva solicitud
        </button>
      </PageHeader>

      <DataTable
        columns={COLUMNS}
        data={data?.items ?? null}
        loading={loading}
        error={error}
        keyFn={r => r.id}
        emptyText="No hay solicitudes de repuestos."
        onRowClick={r => setSelected(r)}
      />
    </div>
  );
};
