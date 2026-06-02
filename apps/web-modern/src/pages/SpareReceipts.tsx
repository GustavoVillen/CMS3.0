import React, { useState } from "react";
import { PackagePlus, Plus, X, Truck, ClipboardList, ChevronRight } from "lucide-react";
import { api } from "../lib/api";
import { useFetch } from "../lib/hooks";
import { PageHeader } from "../components/PageHeader";
import { fmtDate } from "../components/DataTable";

interface Spare { id: string; sku: string; name: string; unit: string; }
interface StockMovement {
  id: string; movementCode: string; movementType: string;
  quantity: number; unit: string; occurredAt: string; notes: string | null;
  spare: { sku: string; name: string } | null;
  vesselCode: string;
}
interface SpareRequestItem {
  id: string; spareId: string | null; spareSku: string | null; spareName: string | null;
  description: string; quantity: number; unit: string; status: string;
}
interface SpareRequest {
  id: string; requestCode: string; status: string; priority: string;
  requestedForVesselCode: string | null; notes: string | null;
  items: { id: string; status: string; quantity: number; quantityFulfilled: number }[];
}

interface ReceiptLine { spareId: string; spareName: string; unit: string; qty: number; notes: string; }

const inputCls = "w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 disabled:opacity-60";
const labelCls = "block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider mb-1";

const PRIORITY_COLOR: Record<string, string> = {
  LOW: "text-fg/40", MEDIUM: "text-blue-700 dark:text-blue-400", HIGH: "text-yellow-700 dark:text-yellow-400", CRITICAL: "text-red-700 dark:text-red-400",
};

// ── PendingRequestsPanel ──────────────────────────────────────────────────────

interface PendingRequestsPanelProps {
  onSelect: (req: SpareRequest) => void;
}

const PendingRequestsPanel: React.FC<PendingRequestsPanelProps> = ({ onSelect }) => {
  const { data } = useFetch<{ items: SpareRequest[] }>(
    "/app/pms/spare-requests?status=APPROVED",
  );
  const requests = data?.items ?? [];

  return (
    <div className="space-y-3">
      <p className="text-[10px] font-bold text-fg/40 uppercase tracking-wider">
        Solicitudes aprobadas pendientes de recepción
      </p>
      {requests.length === 0 ? (
        <p className="text-xs text-fg/20 py-4 text-center">Sin solicitudes aprobadas pendientes.</p>
      ) : (
        <div className="space-y-2">
          {requests.map(req => (
            <button
              key={req.id}
              onClick={() => onSelect(req)}
              className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-fg/10 bg-fg/2 hover:bg-fg/5 hover:border-accent/30 transition-all group text-left"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <ClipboardList className="w-3.5 h-3.5 text-accent shrink-0" />
                  <span className="font-mono text-sm font-bold text-accent">{req.requestCode}</span>
                  <span className={`text-[10px] font-bold ${PRIORITY_COLOR[req.priority] ?? ""}`}>
                    {req.priority}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs text-fg/40 pl-5">
                  {req.requestedForVesselCode && (
                    <span className="font-mono text-fg/60">{req.requestedForVesselCode}</span>
                  )}
                  <span>{req.items?.length ?? 0} ítem{(req.items?.length ?? 0) !== 1 ? "s" : ""}</span>
                  {req.notes && <span className="truncate max-w-[200px]">{req.notes}</span>}
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-fg/20 group-hover:text-accent transition-colors shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ── ReceiptForm ───────────────────────────────────────────────────────────────

interface ReceiptFormProps {
  onDone: () => void;
  prefillRequest?: SpareRequest | null;
  onClearPrefill?: () => void;
}

const ReceiptForm: React.FC<ReceiptFormProps> = ({ onDone, prefillRequest, onClearPrefill }) => {
  const [vesselCode,   setVesselCode]   = useState(prefillRequest?.requestedForVesselCode ?? "");
  const [receiptDate,  setReceiptDate]  = useState(new Date().toISOString().slice(0, 10));
  const [lines,        setLines]        = useState<ReceiptLine[]>([]);
  const [saving,       setSaving]       = useState(false);
  const [err,          setErr]          = useState<string | null>(null);
  const [success,      setSuccess]      = useState(false);

  // Line form state
  const [lineSpareId,  setLineSpareId]  = useState("");
  const [lineQty,      setLineQty]      = useState("1");
  const [lineNotes,    setLineNotes]    = useState("");
  const [showLineForm, setShowLineForm] = useState(false);

  // New spare registration
  const [showNewSpare,  setShowNewSpare]  = useState(false);
  const [newSku,        setNewSku]        = useState("");
  const [newName,       setNewName]       = useState("");
  const [newUnit,       setNewUnit]       = useState("");
  const [newCrit,       setNewCrit]       = useState("B");
  const [savingSpare,   setSavingSpare]   = useState(false);
  const [newSpareErr,   setNewSpareErr]   = useState<string | null>(null);

  // Load items from prefill request
  const { data: reqItemsData } = useFetch<{ items: SpareRequestItem[] }>(
    prefillRequest ? `/app/pms/spare-requests/${prefillRequest.id}/items` : null,
    [prefillRequest?.id],
  );
  const reqItems = reqItemsData?.items ?? [];

  const vc = vesselCode || prefillRequest?.requestedForVesselCode || "";

  const { data: sparesData, reload: reloadSpares } = useFetch<{ items: Spare[] }>(
    vc ? `/app/pms/spares?vesselCode=${vc}&status=ACTIVE` : null,
    [vc],
  );
  const spares = sparesData?.items ?? [];
  const selectedSpare = spares.find(s => s.id === lineSpareId);

  // Pre-fill lines from request items when they load
  React.useEffect(() => {
    if (!prefillRequest || reqItems.length === 0) return;
    setLines(
      reqItems
        .filter(i => i.status !== "FULFILLED" && i.status !== "CANCELLED")
        .map(i => ({
          spareId: i.spareId ?? "",
          spareName: i.spareId
            ? `${i.spareSku ?? ""} — ${i.spareName ?? i.description}`
            : i.description,
          unit: i.unit,
          qty: i.quantity,
          notes: `Recepción de ${prefillRequest.requestCode}`,
        }))
        .filter(l => l.spareId), // only lines with a linked spare can create movements
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reqItems.length, prefillRequest?.id]);

  const addLine = () => {
    if (!selectedSpare) return;
    const qty = parseFloat(lineQty);
    if (!qty || qty <= 0) return;
    setLines(prev => [...prev, {
      spareId: selectedSpare.id,
      spareName: `${selectedSpare.sku} — ${selectedSpare.name}`,
      unit: selectedSpare.unit,
      qty,
      notes: lineNotes.trim(),
    }]);
    setLineSpareId(""); setLineQty("1"); setLineNotes(""); setShowLineForm(false);
  };

  const removeLine = (i: number) => setLines(prev => prev.filter((_, idx) => idx !== i));

  const handleRegisterSpare = async () => {
    if (!newSku.trim() || !newName.trim() || !newUnit.trim()) { setNewSpareErr("SKU, nombre y unidad requeridos."); return; }
    if (!vc) { setNewSpareErr("Ingresa el código de vessel primero."); return; }
    setSavingSpare(true); setNewSpareErr(null);
    try {
      const created = await api.post<Spare>("/app/pms/spares", {
        vesselCode: vc.toUpperCase(), sku: newSku.trim().toUpperCase(), name: newName.trim(),
        unit: newUnit.trim(), criticality: newCrit, status: "ACTIVE",
      });
      reloadSpares();
      setLineSpareId(created.id);
      setShowNewSpare(false);
      setNewSku(""); setNewName(""); setNewUnit(""); setNewCrit("B");
    } catch (e: unknown) {
      setNewSpareErr(e instanceof Error ? e.message : "Error al crear el repuesto.");
    } finally { setSavingSpare(false); }
  };

  const handleSubmit = async () => {
    const effectiveVessel = vc.trim().toUpperCase();
    if (!effectiveVessel) { setErr("El código de vessel es requerido."); return; }
    if (lines.length === 0) { setErr("Agrega al menos un repuesto recibido."); return; }
    setSaving(true); setErr(null);
    try {
      for (const line of lines) {
        if (!line.spareId) continue;
        await api.post("/app/pms/stock-movements", {
          vesselCode: effectiveVessel,
          spareId: line.spareId,
          movementType: "RECEIPT",
          quantity: line.qty,
          unit: line.unit,
          occurredAt: receiptDate,
          referenceType: prefillRequest ? "SPARE_ORDER" : null,
          referenceId: prefillRequest?.id ?? null,
          notes: line.notes || `Recepción registrada el ${receiptDate}`,
        });
      }
      setSuccess(true);
      setLines([]);
      if (onClearPrefill) onClearPrefill();
      onDone();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Error al registrar la recepción.");
    } finally { setSaving(false); }
  };

  if (success) {
    return (
      <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-6 text-center space-y-3">
        <Truck className="w-8 h-8 text-emerald-700 dark:text-emerald-400 mx-auto" />
        <p className="text-sm font-bold text-emerald-700 dark:text-emerald-400">Recepción registrada correctamente</p>
        <p className="text-xs text-fg/40">El stock ha sido actualizado.</p>
        <button onClick={() => setSuccess(false)} className="px-4 py-2 text-xs font-semibold bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400 rounded-xl hover:bg-emerald-500/20">
          Registrar otra recepción
        </button>
      </div>
    );
  }

  return (
    <div className="bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl p-6 space-y-5">

      {/* Header: prefill badge or manual title */}
      {prefillRequest ? (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-accent" />
            <span className="text-sm font-bold text-fg">
              Recepción para <span className="text-accent font-mono">{prefillRequest.requestCode}</span>
            </span>
          </div>
          <button onClick={onClearPrefill} className="text-[10px] text-fg/30 hover:text-fg underline">
            Cambiar solicitud
          </button>
        </div>
      ) : (
        <p className="text-xs font-bold text-fg/60 uppercase tracking-wider">Nueva recepción manual</p>
      )}

      {/* Vessel + fecha */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Código de Vessel *</label>
          <input
            value={vesselCode || prefillRequest?.requestedForVesselCode || ""}
            onChange={e => setVesselCode(e.target.value.toUpperCase())}
            placeholder="Ej: VESSEL01"
            disabled={!!prefillRequest?.requestedForVesselCode}
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>Fecha de recepción *</label>
          <input type="date" value={receiptDate} onChange={e => setReceiptDate(e.target.value)} className={inputCls} />
        </div>
      </div>

      {/* Items de la solicitud sin spare vinculado */}
      {prefillRequest && reqItems.some(i => !i.spareId && i.status !== "FULFILLED") && (
        <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 px-4 py-3 space-y-1">
          <p className="text-[10px] font-bold text-yellow-700 dark:text-yellow-400 uppercase tracking-wider">Ítems sin repuesto vinculado</p>
          <p className="text-xs text-fg/40">Estos ítems de la solicitud no están vinculados a un repuesto del catálogo y no se incluirán en los movimientos de stock:</p>
          <ul className="text-xs text-yellow-700 dark:text-yellow-300/70 space-y-0.5 pt-1">
            {reqItems.filter(i => !i.spareId && i.status !== "FULFILLED").map(i => (
              <li key={i.id}>· {i.description} ({i.quantity} {i.unit})</li>
            ))}
          </ul>
        </div>
      )}

      {/* Lista de ítems */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-bold text-fg/40 uppercase tracking-wider">Repuestos a recibir</p>
          {vc && (
            <button onClick={() => { setShowLineForm(v => !v); setShowNewSpare(false); }}
              className="text-[10px] text-accent/70 hover:text-accent underline">
              {showLineForm ? "Cancelar" : "+ Agregar repuesto"}
            </button>
          )}
        </div>

        {lines.length > 0 && (
          <div className="border border-fg/10 rounded-xl overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] text-fg/30 border-b border-fg/10 uppercase tracking-wider">
                  <th className="px-3 py-2 text-left">Repuesto</th>
                  <th className="px-3 py-2 text-right">Cant.</th>
                  <th className="px-3 py-2 text-left">Ud.</th>
                  <th className="px-3 py-2 text-left">Notas</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} className="border-b border-fg/5 last:border-0">
                    <td className="px-3 py-2 text-fg">{l.spareName || <span className="text-fg/30 italic">Sin spare vinculado</span>}</td>
                    <td className="px-3 py-2 text-right text-emerald-700 dark:text-emerald-400 font-bold">+{l.qty}</td>
                    <td className="px-3 py-2 text-fg/40">{l.unit}</td>
                    <td className="px-3 py-2 text-fg/30 truncate max-w-[140px]">{l.notes || "—"}</td>
                    <td className="px-2 py-2">
                      <button onClick={() => removeLine(i)} className="text-fg/20 hover:text-red-400 transition-colors">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {lines.length === 0 && !showLineForm && (
          <p className="text-xs text-fg/20 py-2">
            {vc
              ? (prefillRequest ? "Cargando ítems de la solicitud…" : "Agrega los repuestos recibidos.")
              : "Ingresa el código de vessel para seleccionar repuestos."}
          </p>
        )}

        {/* Agregar línea manual */}
        {showLineForm && (
          <div className="border border-fg/10 rounded-xl p-3 space-y-3 bg-fg/2">
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-fg/40 uppercase tracking-wider">Agregar repuesto</p>
              <button onClick={() => setShowNewSpare(v => !v)} className="text-[10px] text-accent/60 hover:text-accent underline">
                {showNewSpare ? "Cancelar" : "+ Repuesto nuevo (stock 0)"}
              </button>
            </div>

            {showNewSpare && (
              <div className="border border-accent/20 rounded-xl p-3 space-y-2 bg-accent/5">
                <p className="text-[10px] font-bold text-accent/70 uppercase tracking-wider">Registrar repuesto nuevo</p>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className={labelCls}>SKU *</label>
                    <input value={newSku} onChange={e => setNewSku(e.target.value.toUpperCase())} placeholder="REP-001" className={inputCls} />
                  </div>
                  <div className="col-span-2">
                    <label className={labelCls}>Nombre *</label>
                    <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Descripción" className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Unidad *</label>
                    <input value={newUnit} onChange={e => setNewUnit(e.target.value)} placeholder="ud, kg…" className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Criticidad</label>
                    <select value={newCrit} onChange={e => setNewCrit(e.target.value)} className={inputCls}>
                      <option value="A">A — Crítico</option>
                      <option value="B">B — Importante</option>
                      <option value="C">C — Menor</option>
                    </select>
                  </div>
                </div>
                {newSpareErr && <p className="text-[10px] text-red-700 dark:text-red-400">{newSpareErr}</p>}
                <button onClick={() => void handleRegisterSpare()} disabled={savingSpare}
                  className="px-3 py-1.5 text-[10px] font-bold bg-accent/20 border border-accent/30 text-accent rounded-lg hover:bg-accent/30 disabled:opacity-40">
                  {savingSpare ? "Registrando…" : "Registrar y seleccionar"}
                </button>
              </div>
            )}

            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2">
                <label className={labelCls}>Repuesto</label>
                <select value={lineSpareId} onChange={e => setLineSpareId(e.target.value)} className={inputCls}>
                  <option value="">— Seleccionar —</option>
                  {spares.map(s => <option key={s.id} value={s.id}>{s.sku} — {s.name}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Cantidad</label>
                <input type="number" min="0.001" step="any" value={lineQty}
                  onChange={e => setLineQty(e.target.value)} className={inputCls} />
              </div>
              <div className="col-span-3">
                <label className={labelCls}>Notas (opcional)</label>
                <input value={lineNotes} onChange={e => setLineNotes(e.target.value)}
                  placeholder="N° remito, proveedor…" className={inputCls} />
              </div>
            </div>
            <button onClick={addLine} disabled={!lineSpareId}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400 rounded-xl hover:bg-emerald-500/20 disabled:opacity-40">
              <Plus className="w-3.5 h-3.5" /> Agregar
            </button>
          </div>
        )}
      </div>

      {err && <p className="text-xs text-red-700 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{err}</p>}

      <div className="flex justify-end pt-2 border-t border-fg/10">
        <button onClick={() => void handleSubmit()} disabled={saving || lines.filter(l => l.spareId).length === 0}
          className="flex items-center gap-2 px-5 py-2.5 text-sm font-bold bg-accent text-accent-fg rounded-xl hover:brightness-110 disabled:opacity-40 transition-all">
          <Truck className="w-4 h-4" />
          {saving ? "Registrando…" : `Confirmar recepción (${lines.filter(l => l.spareId).length} ítem${lines.filter(l => l.spareId).length !== 1 ? "s" : ""})`}
        </button>
      </div>
    </div>
  );
};

// ── HistoryPanel ──────────────────────────────────────────────────────────────

const HistoryPanel: React.FC<{ refresh: number }> = ({ refresh }) => {
  const { data } = useFetch<{ items: StockMovement[] }>(
    "/app/pms/stock-movements?movementType=RECEIPT",
    [refresh],
  );
  const movements = (data?.items ?? []).slice(0, 30);

  return (
    <div className="space-y-3">
      <p className="text-[10px] font-bold text-fg/40 uppercase tracking-wider">Recepciones recientes</p>
      {movements.length === 0
        ? <p className="text-xs text-fg/20 py-4 text-center">Sin recepciones registradas.</p>
        : (
          <div className="border border-fg/10 rounded-xl overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] text-fg/30 border-b border-fg/10 uppercase tracking-wider">
                  <th className="px-3 py-2 text-left">Código</th>
                  <th className="px-3 py-2 text-left">Vessel</th>
                  <th className="px-3 py-2 text-left">Repuesto</th>
                  <th className="px-3 py-2 text-right">Cantidad</th>
                  <th className="px-3 py-2 text-left">Fecha</th>
                </tr>
              </thead>
              <tbody>
                {movements.map(m => (
                  <tr key={m.id} className="border-b border-fg/5 last:border-0 hover:bg-fg/5">
                    <td className="px-3 py-2 font-mono text-accent text-[10px]">{m.movementCode}</td>
                    <td className="px-3 py-2 font-mono text-fg/60">{m.vesselCode}</td>
                    <td className="px-3 py-2 text-fg">
                      {m.spare ? `${m.spare.sku} — ${m.spare.name}` : "—"}
                    </td>
                    <td className="px-3 py-2 text-right text-emerald-700 dark:text-emerald-400 font-bold">+{m.quantity} {m.unit}</td>
                    <td className="px-3 py-2 text-fg/50">{fmtDate(m.occurredAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </div>
  );
};

// ── SpareReceiptsPage ─────────────────────────────────────────────────────────

export const SpareReceiptsPage: React.FC = () => {
  const [refresh, setRefresh] = useState(0);
  const [selectedRequest, setSelectedRequest] = useState<SpareRequest | null>(null);

  return (
    <div className="space-y-6">
      <PageHeader icon={PackagePlus} title="Recepción de Repuestos" />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
        {/* Left: pending requests + form */}
        <div className="space-y-4">
          {!selectedRequest && (
            <PendingRequestsPanel onSelect={req => setSelectedRequest(req)} />
          )}
          <ReceiptForm
            onDone={() => setRefresh(r => r + 1)}
            prefillRequest={selectedRequest}
            onClearPrefill={() => setSelectedRequest(null)}
          />
        </div>

        {/* Right: history */}
        <HistoryPanel refresh={refresh} />
      </div>
    </div>
  );
};
