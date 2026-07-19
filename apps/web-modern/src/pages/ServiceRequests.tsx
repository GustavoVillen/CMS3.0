// Solicitudes de Servicio (SS) — pedidos de servicio externo (un taller).
//
// Una SS SÓLO se abre desde una OT abierta, así que esta pantalla NO tiene botón
// "Nueva SS": es una vista de seguimiento (compras / superintendencia). Para
// crear una, hay que entrar a la OT correspondiente.
//
// Flujo: Borrador → Solicitada → Aprobada → Autorizada → En ejecución → Completada.
// Autorizar está restringido a tierra (Superintendente técnico / DPA): es el
// momento en que se compromete el gasto con el tercero, y no lo habilita el
// mismo que lo pidió a bordo.

import React, { useState } from "react";
import { useSearchParams, useNavigate, useLocation, Link } from "react-router-dom";
import { Handshake, CheckCheck, XCircle, Send, ShieldCheck, Play, FileDown, PackageCheck, ExternalLink, Save, Plus, Trash2, List, LayoutGrid, Search, X, Loader2, Undo2 } from "lucide-react";
import { api } from "../lib/api";
import { useFetch } from "../lib/hooks";
import { DataTable, fmtDate, type Column } from "../components/DataTable";
import { PageHeader } from "../components/PageHeader";
import { ModalCloseButton } from "../components/ModalCloseButton";
import { FormModal } from "../components/FormModal";
import { useAuth } from "../lib/auth";
import { printServiceRequest } from "../lib/print-work-order";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ServiceRequest {
  id: string;
  serviceRequestCode: string;
  status: string;
  priority: string;
  vesselCode: string;
  workOrderId: string;
  openDate: string;
  title: string | null;
  description: string | null;
  causes: string | null;
  providerId: string | null;
  /** Nombre del taller resuelto del catálogo (providerId). El campo muestra esto o tallerNotes. */
  providerName?: string | null;
  tallerNotes: string | null;
  /** NORMAL / AFECTA SEGURIDAD / AFECTA SERVICIO — el papel admite varias. */
  purchaseRequestKinds: string[];
  /** Nombre de quien solicita, editable por el admin (gana sobre el creador). */
  solicitaByName: string | null;
  createdByUserId: string | null;
  aprobadoByName: string | null;
  aprobadoAt: string | null;
  aprobadoByUserId: string | null;
  autorizadoByName: string | null;
  autorizadoAt: string | null;
  autorizadoByUserId: string | null;
  rechazoReason: string | null;
  closeNotes: string | null;
  // ENTREGA / RECEPCION
  receptionItem: string | null;
  receivedByName: string | null;
  receptionConform: boolean | null;
  // Pie del formulario
  capitanName: string | null;
  jefeMaquinasName: string | null;
  workOrder?: { id: string; workOrderCode: string; title: string | null; status: string; assetName?: string | null } | null;
}
interface ListResponse { items: ServiceRequest[]; total: number }

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Borrador", SOLICITADA: "Solicitada", APROBADA: "Aprobada",
  AUTORIZADA: "Autorizada", IN_PROGRESS: "En ejecución", COMPLETED: "Completada",
  REJECTED: "Rechazada", CANCELLED: "Cancelada",
};
const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-fg/5 text-fg/50 border-fg/10",
  SOLICITADA: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20",
  APROBADA: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20",
  AUTORIZADA: "bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/20",
  IN_PROGRESS: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
  COMPLETED: "bg-success-sea/10 text-success-sea border-success-sea/20",
  REJECTED: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20",
  CANCELLED: "bg-fg/5 text-fg/30 border-fg/10",
};
const PRIORITY_LABELS: Record<string, string> = {
  LOW: "Baja", MEDIUM: "Media", HIGH: "Alta", CRITICAL: "Crítica",
};

// Deben coincidir con el backend (canApprove / canAuthorize).
/** Autorizar: sólo tierra. El Jefe de Máquinas aprueba a bordo pero no autoriza. */
const CAN_AUTHORIZE_ROLES = ["TENANT_ADMIN", "FLEET_SUPERINTENDENT"];
const CAN_APPROVE_ROLES = ["TENANT_ADMIN", "FLEET_SUPERINTENDENT", "MAINTENANCE_MANAGER"];

/** Estados terminales: la SS ya no se edita (mismo criterio que record-lock). */
const LOCKED_STATUSES = ["COMPLETED", "CANCELLED", "REJECTED"];

/** SOLICITUD DE COMPRAS del formulario — se pueden marcar varias. */
const PURCHASE_KINDS = ["NORMAL", "AFECTA SEGURIDAD", "AFECTA SERVICIO"];

interface TeamMember {
  userId: string;
  firstName: string | null;
  lastName: string | null;
  formName: string | null;
  role: string;
  hasSignature: boolean;
  /** Para ofrecer sólo a los que están a cargo del buque de la SS. */
  assignedVesselCodes?: string[];
}

/**
 * Fila de la HOJA DE RUTA DEL PEDIDO, tal como se imprime. Con `logId` = novedad
 * asentada a mano (editable); sin él = hito que el sistema deriva de la SS.
 */
interface HojaRutaRow {
  fecha: string;
  novedad: string;
  asienta: string;
  logId?: string;
}

/** Nombre a estampar en el formulario: el configurado para documentos, si tiene. */
const memberLabel = (m: TeamMember) =>
  m.formName?.trim() || `${m.firstName ?? ""} ${m.lastName ?? ""}`.trim() || "(sin nombre)";


const inputCls = "w-full bg-fg/5 border border-fg/10 rounded-lg px-2.5 py-1.5 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 disabled:opacity-60";
const labelCls = "block text-[10px] font-bold text-text-industrial/40 uppercase tracking-widest mb-1";
// Igual que inputCls pero SIN `w-full`: en las filas de la tramitación el ancho
// lo decide el flex. Con `w-full` todos los campos piden el 100% y el nombre
// queda aplastado a unos pocos píxeles.
const cellCls = "bg-fg/5 border border-fg/10 rounded-lg px-2.5 py-1.5 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 disabled:opacity-60";

// ---------------------------------------------------------------------------
// Tablero Kanban — mismo formato que el de la OT
// ---------------------------------------------------------------------------

/**
 * A diferencia de la OT — donde la etapa se DERIVA de las fechas de firma — acá
 * la columna ES el estado de la SS, así que cada arrastre se traduce directo a
 * una transición que el backend ya expone.
 *
 * Los estados terminales (Completada / Rechazada / Cancelada) no van al tablero,
 * igual que las OT cerradas: se ven con los chips, que en ese caso pasan solos a
 * vista lista. La recepción del servicio (En ejecución → Completada) sigue
 * haciéndose desde el modal porque exige quién recibe y si hubo conformidad —
 * datos que un arrastre no puede aportar.
 */

const PRIORITY_LEFT_CLS: Record<string, string> = {
  CRITICAL: "border-l-2 border-l-red-500",
  HIGH:     "border-l-2 border-l-orange-500",
  MEDIUM:   "border-l-2 border-l-yellow-400",
  LOW:      "border-l-2 border-l-blue-400/60",
};

type SsStage = "DRAFT" | "SOLICITADA" | "APROBADA" | "AUTORIZADA" | "IN_PROGRESS" | "HIDDEN";

/** Colores alineados con STATUS_COLORS para que la tarjeta y el badge no se contradigan. */
const SS_KANBAN_COLS: Array<{ colId: Exclude<SsStage, "HIDDEN">; label: string; headerCls: string; borderCls: string }> = [
  { colId: "DRAFT",       label: "Borrador",     headerCls: "text-text-industrial/60",              borderCls: "border-t-2 border-fg/20" },
  { colId: "SOLICITADA",  label: "Solicitada",   headerCls: "text-yellow-700 dark:text-yellow-400", borderCls: "border-t-2 border-yellow-500/40" },
  { colId: "APROBADA",    label: "Aprobada",     headerCls: "text-blue-700 dark:text-blue-400",     borderCls: "border-t-2 border-blue-500/40" },
  { colId: "AUTORIZADA",  label: "Autorizada",   headerCls: "text-violet-700 dark:text-violet-400", borderCls: "border-t-2 border-violet-500/40" },
  { colId: "IN_PROGRESS", label: "En ejecución", headerCls: "text-amber-700 dark:text-amber-400",   borderCls: "border-t-2 border-amber-500/40" },
];

function ssStage(sr: ServiceRequest): SsStage {
  return SS_KANBAN_COLS.some(c => c.colId === sr.status) ? (sr.status as SsStage) : "HIDDEN";
}

function SsKanbanCard({ sr, busy, draggingId, onOpen, onDragStart }: {
  sr: ServiceRequest;
  busy: boolean;
  draggingId: string | null;
  onOpen: (sr: ServiceRequest) => void;
  onDragStart: (sr: ServiceRequest | null) => void;
}) {
  const isDragging = draggingId === sr.id;
  const prioLeft   = PRIORITY_LEFT_CLS[sr.priority] ?? "border-l-2 border-l-fg/10";

  return (
    <div
      draggable={!busy}
      onDragStart={e => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", JSON.stringify({ id: sr.id, stage: ssStage(sr) }));
        onDragStart(sr);
      }}
      onDragEnd={() => onDragStart(null)}
      onClick={() => !isDragging && !busy && onOpen(sr)}
      className={`w-full bg-fg/[0.03] border border-fg/10 rounded-xl p-3 space-y-2 select-none cursor-grab
        ${prioLeft}
        ${isDragging ? "opacity-30" : "hover:bg-fg/[0.07]"}
        ${busy ? "opacity-60 pointer-events-none" : ""}
        transition-colors`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-mono font-bold text-fg text-[10px]">{sr.serviceRequestCode}</span>
        <span className="text-[9px] font-bold text-text-industrial/40 shrink-0">{sr.vesselCode}</span>
      </div>
      {(sr.title || sr.description) && (
        <p className="text-xs text-fg font-medium line-clamp-2">{sr.title || sr.description}</p>
      )}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-text-industrial/50">{fmtDate(sr.openDate)}</span>
        {sr.workOrder && (
          <span className="font-mono text-[9px] text-text-industrial/40 truncate" title="OT de origen">
            {sr.workOrder.workOrderCode}
          </span>
        )}
      </div>
    </div>
  );
}

function SsKanbanBoard({ items, role, loading, onOpen, onReload }: {
  items: ServiceRequest[];
  role: string;
  loading: boolean;
  onOpen: (sr: ServiceRequest) => void;
  onReload: () => void;
}) {
  const [draggingSr, setDraggingSr] = useState<ServiceRequest | null>(null);
  const [overCol, setOverCol]       = useState<string | null>(null);
  const [busyId, setBusyId]         = useState<string | null>(null);
  const [dropError, setDropError]   = useState<string | null>(null);
  const [pendingApproval, setPendingApproval] = useState<{ sr: ServiceRequest; step: "SOLICITA" | "APRUEBA" | "AUTORIZA" } | null>(null);

  // Mismo criterio que el backend: se chequea acá sólo para explicar el porqué
  // en vez de dejar que el arrastre termine en un 403 sin mensaje.
  const canApprove   = CAN_APPROVE_ROLES.includes(role);
  const canAuthorize = CAN_AUTHORIZE_ROLES.includes(role);

  const run = React.useCallback(async (sr: ServiceRequest, action: "unsubmit" | "start") => {
    setBusyId(sr.id);
    try {
      await api.post(`/app/pms/service-requests/${sr.id}/${action}`, {});
      onReload();
    } catch (e) {
      setDropError(e instanceof Error ? e.message : "No se pudo mover la solicitud.");
    } finally {
      setBusyId(null);
    }
  }, [onReload]);

  const handleDrop = React.useCallback((e: React.DragEvent, targetCol: Exclude<SsStage, "HIDDEN">) => {
    setOverCol(null);
    setDraggingSr(null);
    setDropError(null);

    let payload: { id: string; stage: SsStage } | null = null;
    try { payload = JSON.parse(e.dataTransfer.getData("text/plain")); } catch { /* noop */ }
    if (!payload?.id || !payload?.stage) return;

    const { id, stage } = payload;
    if (stage === targetCol) return;
    const sr = items.find(x => x.id === id);
    if (!sr) return;

    // Solicitar (Borrador → Solicitada): pide quién solicita y con qué fecha.
    if (stage === "DRAFT" && targetCol === "SOLICITADA") { setPendingApproval({ sr, step: "SOLICITA" }); return; }
    // Volver a borrador para corregir. Sólo desde Solicitada: más adelante ya
    // hay firmas asentadas y deshacerlas sin registro sería perder la traza.
    if (stage === "SOLICITADA" && targetCol === "DRAFT") { void run(sr, "unsubmit"); return; }
    // Aprobar (Solicitada → Aprobada): a bordo, pide quién firma.
    if (stage === "SOLICITADA" && targetCol === "APROBADA") {
      if (!canApprove) { setDropError("Tu rol no puede aprobar una solicitud de servicio."); return; }
      setPendingApproval({ sr, step: "APRUEBA" });
      return;
    }
    // Autorizar (Aprobada → Autorizada): acá se compromete el gasto, es de tierra.
    if (stage === "APROBADA" && targetCol === "AUTORIZADA") {
      if (!canAuthorize) { setDropError("Autorizar una solicitud es atribución de tierra (Superintendente / DPA)."); return; }
      setPendingApproval({ sr, step: "AUTORIZA" });
      return;
    }
    // Mandar al taller (Autorizada → En ejecución).
    if (stage === "AUTORIZADA" && targetCol === "IN_PROGRESS") { void run(sr, "start"); return; }
    // Cualquier otro movimiento (saltos de etapa o retrocesos) se ignora.
  }, [items, canApprove, canAuthorize, run]);

  if (loading) return <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-accent" /></div>;

  return (
    <>
      {dropError && (
        <p className="text-xs text-red-700 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 mb-3">
          {dropError}
        </p>
      )}
      <div className="flex gap-3 pb-4">
        {SS_KANBAN_COLS.map(col => {
          const colItems = items.filter(sr => ssStage(sr) === col.colId);
          const isOver   = overCol === col.colId;
          return (
            <div
              key={col.colId}
              onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setOverCol(col.colId); }}
              onDragLeave={() => setOverCol(null)}
              onDrop={e => { e.preventDefault(); handleDrop(e, col.colId); }}
              className={`flex-1 min-w-0 flex flex-col ${col.borderCls} pt-3 rounded-b-xl transition-colors duration-100 ${isOver ? "bg-fg/[0.05] ring-1 ring-accent/30" : ""}`}
            >
              <div className="flex items-center gap-2 px-1 mb-3">
                <span className={`text-[11px] font-bold uppercase tracking-widest ${col.headerCls}`}>{col.label}</span>
                <span className="ml-auto text-[10px] font-bold text-text-industrial/40 bg-fg/5 rounded-full px-1.5 py-0.5">{colItems.length}</span>
              </div>
              <div className="flex flex-col gap-2 overflow-y-auto" style={{ maxHeight: "calc(100vh - 280px)" }}>
                {colItems.length === 0 && <p className="text-[10px] text-text-industrial/25 text-center py-6">—</p>}
                {colItems.map(sr => (
                  <SsKanbanCard
                    key={sr.id}
                    sr={sr}
                    busy={busyId === sr.id}
                    draggingId={draggingSr?.id ?? null}
                    onOpen={onOpen}
                    onDragStart={setDraggingSr}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {pendingApproval && (
        <SsApprovalModal
          sr={pendingApproval.sr}
          step={pendingApproval.step}
          role={role}
          onClose={() => setPendingApproval(null)}
          onDone={() => { setPendingApproval(null); onReload(); }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

/**
 * Chips de situación. La SS no tiene vencimiento ni diferimiento (a diferencia
 * de la OT), así que en vez de "Vencidas / Diferidas" se filtra por lo único que
 * la SS sí tiene: en qué punto del trámite está. Los tres últimos son estados
 * terminales — no van al tablero, así que al elegirlos se pasa a vista lista.
 */
const SS_VIEW_FILTERS: Array<{ key: string; label: string; match: (sr: ServiceRequest) => boolean; terminal?: boolean }> = [
  { key: "",           label: "Todas",        match: () => true },
  { key: "open",       label: "En trámite",   match: sr => ["DRAFT", "SOLICITADA", "APROBADA", "AUTORIZADA"].includes(sr.status) },
  { key: "inProgress", label: "En ejecución", match: sr => sr.status === "IN_PROGRESS" },
  { key: "completed",  label: "Completadas",  match: sr => sr.status === "COMPLETED",  terminal: true },
  { key: "rejected",   label: "Rechazadas",   match: sr => sr.status === "REJECTED",   terminal: true },
  { key: "cancelled",  label: "Canceladas",   match: sr => sr.status === "CANCELLED",  terminal: true },
];

export function ServiceRequestsPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { key: locationKey } = useLocation();
  const [selected, setSelected] = useState<ServiceRequest | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "kanban">("kanban");
  const [search, setSearch] = useState("");
  const viewFilter = searchParams.get("view") ?? "";
  // Deep-link del donut del Dashboard: ?status=IN_PROGRESS (o varios separados
  // por coma, como REJECTED,CANCELLED). Manda por encima de los chips; tocar
  // cualquier chip lo limpia.
  const statusParam = searchParams.get("status");
  const statusSet = React.useMemo(
    () => (statusParam ? new Set(statusParam.split(",").map(s => s.trim()).filter(Boolean)) : null),
    [statusParam],
  );

  // Se trae todo y se filtra en cliente: el backend no pagina y los chips cruzan
  // estados, así que un filtro por estado en la query obligaría a refetchear en
  // cada clic. Mismo criterio que el tablero de OT.
  const { data, loading, error, reload } = useFetch<ListResponse>("/app/pms/service-requests", []);
  const items = data?.items ?? [];

  const visibleItems = React.useMemo(() => {
    if (statusSet) return items.filter(sr => statusSet.has(sr.status));
    const f = SS_VIEW_FILTERS.find(o => o.key === viewFilter) ?? SS_VIEW_FILTERS[0]!;
    return items.filter(f.match);
  }, [items, viewFilter, statusSet]);

  // Si el estado pedido no tiene columna en el tablero (Completada, Rechazada,
  // Cancelada), se pasa a lista: si no, el tablero se vería vacío.
  React.useEffect(() => {
    if (statusSet && ![...statusSet].some(s => SS_KANBAN_COLS.some(c => c.colId === s))) {
      setViewMode("list");
    }
  }, [statusSet]);

  // El buscador ignora el chip activo: busca en toda la flota y en cualquier
  // estado, incluidos los terminales.
  const displayItems = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return visibleItems;
    return items.filter(sr =>
      sr.serviceRequestCode.toLowerCase().includes(q) ||
      (sr.title ?? "").toLowerCase().includes(q) ||
      (sr.description ?? "").toLowerCase().includes(q) ||
      sr.vesselCode.toLowerCase().includes(q) ||
      (sr.workOrder?.workOrderCode ?? "").toLowerCase().includes(q),
    );
  }, [items, visibleItems, search]);

  // ?code=SS-3-M02-2026 — para links que sólo conocen el CÓDIGO y no el id
  // interno (típicamente el copiloto, que cita códigos en su respuesta).
  const codeParam = (searchParams.get("code") ?? "").trim().toUpperCase();
  React.useEffect(() => {
    if (!codeParam || !items.length) return;
    const hit = items.find(sr => sr.serviceRequestCode.toUpperCase() === codeParam);
    if (hit) setSelected(hit);
  }, [codeParam, items]);

  // Deep-link desde el panel de la OT: ?openId=<id>
  const openId = searchParams.get("openId");
  React.useEffect(() => {
    if (!openId || !items.length) return;
    const hit = items.find(i => i.id === openId);
    if (hit) setSelected(hit);
  }, [openId, items]);

  const closeModal = () => {
    setSelected(null);
    if (!openId) return; // se abrió clickeando en esta misma pantalla: nada que navegar
    // Vino por deep-link (típicamente desde el panel de una OT): cerrar debe
    // devolver a esa pantalla, no dejar al usuario en la lista de SS. Si la SS
    // fue la primera pantalla de la sesión no hay a dónde volver, así que sólo
    // se limpia el parámetro. Mismo criterio que useDeepLink.
    if (locationKey !== "default") { navigate(-1); return; }
    searchParams.delete("openId");
    setSearchParams(searchParams, { replace: true });
  };

  const columns: Column<ServiceRequest>[] = [
    {
      key: "serviceRequestCode", header: "Código", sortable: true,
      render: r => <span className="font-mono text-xs font-bold text-accent">{r.serviceRequestCode}</span>,
    },
    { key: "vesselCode", header: "Buque", sortable: true },
    {
      key: "workOrder", header: "OT de origen", sortable: true,
      sortValue: r => r.workOrder?.workOrderCode ?? "",
      render: r => r.workOrder
        ? <span className="font-mono text-[11px] text-text-industrial/70">{r.workOrder.workOrderCode}</span>
        : <span className="text-fg/30">—</span>,
    },
    {
      key: "title", header: "Servicio", sortable: true,
      render: r => <span className="text-xs">{r.title || r.description || "—"}</span>,
    },
    {
      key: "status", header: "Estado", sortable: true,
      render: r => (
        <span className={`px-2 py-0.5 rounded-lg border text-[10px] font-bold ${STATUS_COLORS[r.status] ?? STATUS_COLORS.DRAFT}`}>
          {STATUS_LABELS[r.status] ?? r.status}
        </span>
      ),
    },
    {
      key: "priority", header: "Prioridad", sortable: true,
      render: r => <span className="text-xs">{PRIORITY_LABELS[r.priority] ?? r.priority}</span>,
    },
    { key: "openDate", header: "Fecha", sortable: true, render: r => fmtDate(r.openDate) },
  ];

  return (
    <div className="space-y-4">
      <PageHeader icon={Handshake} title="Solicitudes de Servicio" total={data?.total} onReload={reload}>
        <div className="flex items-center gap-0.5 border border-fg/10 rounded-lg p-0.5">
          <button
            type="button"
            onClick={() => setViewMode("list")}
            title="Vista lista"
            className={`p-1.5 rounded-md transition-colors ${viewMode === "list" ? "bg-fg/10 text-fg" : "text-text-industrial/40 hover:text-fg"}`}
          >
            <List className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setViewMode("kanban")}
            title="Vista Kanban"
            className={`p-1.5 rounded-md transition-colors ${viewMode === "kanban" ? "bg-fg/10 text-fg" : "text-text-industrial/40 hover:text-fg"}`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
          </button>
        </div>
      </PageHeader>

      <p className="text-[11px] text-text-industrial/50">
        Una solicitud de servicio se abre desde una orden de trabajo abierta. Para crear una, entrá a la OT correspondiente.
      </p>

      <div className="flex flex-wrap items-center gap-1.5">
        {SS_VIEW_FILTERS.map(opt => {
          const active = !statusSet && viewFilter === opt.key;
          return (
            <button
              key={opt.key || "all"}
              type="button"
              onClick={() => {
                const params = new URLSearchParams(searchParams);
                params.delete("status"); // el chip manda sobre el deep-link del dashboard
                if (opt.key) params.set("view", opt.key); else params.delete("view");
                setSearchParams(params, { replace: true });
                // Los estados terminales no tienen columna en el tablero, así que
                // al filtrarlos se pasa solo a vista lista (si no, quedaría vacío).
                if (opt.terminal) setViewMode("list");
              }}
              className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border transition-colors ${
                active
                  ? "bg-accent/20 text-accent border-accent/40"
                  : "bg-fg/5 text-text-industrial/60 border-fg/10 hover:border-fg/20 hover:text-text-industrial"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
        <div className="flex items-center gap-1.5 bg-fg/5 border border-fg/10 rounded-lg px-2.5 py-1.5 ml-auto">
          <Search className="w-3 h-3 text-text-industrial/40 shrink-0" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar SS, servicio, buque u OT…"
            className="w-64 bg-transparent text-xs text-text-industrial placeholder-text-industrial/30 focus:outline-none"
          />
          {search && (
            <button onClick={() => setSearch("")} className="text-text-industrial/40 hover:text-fg transition-colors">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {viewMode === "list" ? (
        <DataTable
          columns={columns}
          data={displayItems}
          loading={loading}
          error={error}
          keyFn={r => r.id}
          emptyText="Sin solicitudes de servicio"
          onRowClick={(row: ServiceRequest) => setSelected(row)}
        />
      ) : (
        <SsKanbanBoard
          items={displayItems}
          role={user?.role ?? ""}
          loading={loading}
          onOpen={setSelected}
          onReload={reload}
        />
      )}

      {selected && (
        <ServiceRequestModal
          sr={selected}
          role={user?.role ?? ""}
          onClose={closeModal}
          onChanged={() => { reload(); closeModal(); }}
          // Merge, no reemplazo: el PATCH devuelve el registro pelado (sin la
          // relación `workOrder` que sí trae la lista) y pisarlo entero borraría
          // el bloque "OT de origen" del modal abierto.
          onSaved={updated => { reload(); setSelected(prev => (prev ? { ...prev, ...updated } : updated)); }}
        />
      )}
    </div>
  );
}

/**
 * Aprobar / Autorizar / Rechazar una SS. Calcado de ApprovalModal de la OT: el
 * paso se registra acá, con quién firma y en qué fecha — no hay edición
 * posterior de la tramitación.
 *
 * Sólo el TENANT_ADMIN elige a otra persona (de ahí sale la firma del PDF) y la
 * fecha; el resto firma con su propio nombre y la fecha de hoy. Al rechazar no
 * hay selector: rechaza quien está operando.
 */
function SsApprovalModal({ sr, step, role, onClose, onDone }: {
  sr: ServiceRequest;
  step: "SOLICITA" | "APRUEBA" | "AUTORIZA" | "RECHAZA";
  role: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { user } = useAuth();
  const isReject = step === "RECHAZA";
  const isSolicita = step === "SOLICITA";
  const isAdmin = role === "TENANT_ADMIN";
  // El desplegable sale de /app/team/members, que es sólo para administradores;
  // el resto escribe el nombre a mano (normalmente el propio).
  const adminPicker = isAdmin && !isReject;
  const showDate = isAdmin && !isReject;

  const [name, setName] = useState(user?.name ?? "");
  const [onBehalfUserId, setOnBehalfUserId] = useState(user?.id ?? "");
  const [actionDate, setActionDate] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: teamData } = useFetch<TeamMember[]>(adminPicker ? "/app/team/members" : null, [adminPicker]);
  // Quién puede firmar ESTE paso: un ADMIN siempre; el SUPERINTENDENTE a cargo
  // del buque; y el JEFE DE MÁQUINAS sólo para APROBAR — autorizar es tierra.
  // El backend valida igual (resolveSigner); esto es para no ofrecer un 403.
  const eligibles = (Array.isArray(teamData) ? teamData : []).filter(m => {
    if (m.role === "AUDITOR_READONLY") return false; // solo-lectura: no pide ni firma
    if (m.role === "TENANT_ADMIN") return true;
    const enElBuque = (m.assignedVesselCodes ?? []).includes(sr.vesselCode);
    // Solicitar NO es una firma: el pedido lo puede originar cualquiera del
    // buque (un técnico, el contramaestre), no sólo quienes aprueban.
    if (isSolicita) return enElBuque;
    if (m.role === "FLEET_SUPERINTENDENT") return enElBuque;
    if (m.role === "MAINTENANCE_MANAGER") return step === "APRUEBA" && enElBuque;
    return false;
  });

  const title = step === "SOLICITA" ? "Solicitar SS"
    : step === "APRUEBA" ? "Aprobar SS"
    : step === "AUTORIZA" ? "Autorizar SS"
    : "Rechazar SS";
  const verbo = step === "SOLICITA" ? "solicita"
    : step === "APRUEBA" ? "aprueba"
    : step === "AUTORIZA" ? "autoriza"
    : "rechaza";

  const submit = async () => {
    const nombre = name.trim();
    if (!isReject && !nombre) { setError("Indicá el nombre de quien " + verbo + "."); return; }
    if (isReject && !reason.trim()) { setError("Escribí el motivo del rechazo."); return; }
    setSaving(true); setError(null);
    try {
      if (isReject) {
        await api.post(`/app/pms/service-requests/${sr.id}/reject`, { reason: reason.trim() });
      } else if (isSolicita) {
        await api.post(`/app/pms/service-requests/${sr.id}/submit`, {
          name: nombre,
          actionDate: showDate ? actionDate : undefined,
        });
      } else {
        const path = step === "APRUEBA" ? "approve" : "authorize";
        await api.post(`/app/pms/service-requests/${sr.id}/${path}`, {
          name: nombre,
          onBehalfUserId: adminPicker ? (onBehalfUserId || undefined) : undefined,
          actionDate: adminPicker ? actionDate : undefined,
        });
      }
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo registrar. Intentá de nuevo.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormModal
      title={title}
      subtitle={`${sr.serviceRequestCode} · ${sr.title || sr.description || ""}`}
      onClose={onClose}
      error={error}
      footer={
        <>
          <button type="button" onClick={onClose}
            className="px-3 py-1.5 rounded-lg bg-fg/5 border border-fg/10 text-[11px] text-text-industrial/60">
            Cancelar
          </button>
          <button type="button" onClick={() => { void submit(); }} disabled={saving}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-bold disabled:opacity-50 ${
              isReject ? "bg-red-600 text-white" : "bg-accent text-accent-fg"}`}>
            {saving ? "Guardando…" : title}
          </button>
        </>
      }
    >
      {!isReject && (
        <div>
          <label className={labelCls}>Nombre de quien {verbo}</label>
          {adminPicker ? (
            <select
              autoFocus
              className={inputCls}
              value={onBehalfUserId}
              onChange={e => {
                const uid = e.target.value;
                setOnBehalfUserId(uid);
                const m = eligibles.find(x => x.userId === uid);
                setName(m ? memberLabel(m) : (user?.name ?? ""));
              }}
            >
              {eligibles.length === 0 && <option value={user?.id ?? ""}>{user?.name ?? "—"}</option>}
              {eligibles.map(m => (
                <option key={m.userId} value={m.userId}>
                  {/* La firma sólo importa donde se estampa: solicitar no firma. */}
                  {memberLabel(m)}{!isSolicita && !m.hasSignature ? "  ·  (sin firma)" : ""}
                </option>
              ))}
            </select>
          ) : (
            <input autoFocus className={inputCls} value={name}
              onChange={e => setName(e.target.value)} placeholder="Nombre y apellido" />
          )}
        </div>
      )}

      {showDate && (
        <div>
          <label className={labelCls}>
            {step === "SOLICITA" ? "Fecha de solicitud"
              : step === "APRUEBA" ? "Fecha de aprobación"
              : "Fecha de autorización"}
          </label>
          <input type="date" className={inputCls} value={actionDate}
            onChange={e => setActionDate(e.target.value)} />
        </div>
      )}

      {isReject && (
        <div>
          <label className={labelCls}>Motivo del rechazo</label>
          <textarea autoFocus className={inputCls + " min-h-[72px] resize-y"} value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Ej. El presupuesto del taller excede lo autorizado" />
        </div>
      )}
    </FormModal>
  );
}

/**
 * HOJA DE RUTA DEL PEDIDO — cómo se fue moviendo la solicitud.
 *
 * Muestra la hoja tal como se imprime: los hitos que el sistema asienta solo
 * (creada, aprobada, autorizada, enviada al taller, recibida) mezclados por
 * fecha con las novedades que carga la gente. Sólo estas últimas se editan: los
 * hitos salen de la tramitación y no se tocan desde acá.
 */
function HojaRutaBox({ srId, editable, isAdmin }: {
  srId: string;
  editable: boolean;
  isAdmin: boolean;
}) {
  const [reload, setReload] = useState(0);
  const { data, loading } = useFetch<{ items: HojaRutaRow[] }>(
    `/app/pms/service-requests/${srId}/hoja-ruta`,
    [srId, reload],
  );
  const filas = data?.items ?? [];

  const [fecha, setFecha] = useState("");
  const [novedad, setNovedad] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Confirmación de borrado en la propia fila — sin ventana del navegador.
  const [confirmando, setConfirmando] = useState<string | null>(null);

  const agregar = async () => {
    if (!novedad.trim()) return;
    setSaving(true);
    setError(null);
    try {
      // Sin fecha, el backend asienta la de hoy.
      await api.post(`/app/pms/service-requests/${srId}/hoja-ruta`, {
        entryDate: fecha || null,
        novedad: novedad.trim(),
      });
      setNovedad(""); setFecha("");
      setReload(n => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo asentar la novedad.");
    } finally {
      setSaving(false);
    }
  };

  const borrar = async (logId: string) => {
    setError(null);
    try {
      await api.delete(`/app/pms/service-requests/${srId}/hoja-ruta/${logId}`);
      setConfirmando(null);
      setReload(n => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo borrar la novedad.");
    }
  };

  return (
    <div className="rounded-xl border border-fg/10 p-3 space-y-2">
      <p className="text-[10px] uppercase tracking-widest text-text-industrial/40 font-bold">Hoja de ruta del pedido</p>

      {loading && filas.length === 0 ? (
        <p className="text-[11px] text-text-industrial/40 italic">Cargando…</p>
      ) : filas.length === 0 ? (
        <p className="text-[11px] text-text-industrial/40 italic">Sin movimientos todavía.</p>
      ) : (
        <div className="space-y-1">
          {filas.map((f, i) => (
            <div key={f.logId ?? `hito-${i}`} className="flex items-start gap-2 text-[11px]">
              <span className="w-20 shrink-0 text-text-industrial/40 tabular-nums">{fmtDate(f.fecha)}</span>
              <span className={`flex-1 min-w-0 ${f.logId ? "text-text-industrial" : "text-text-industrial/60 italic"}`}>
                {f.novedad}
              </span>
              <span className="w-32 shrink-0 truncate text-text-industrial/50">{f.asienta}</span>
              {f.logId && isAdmin ? (
                confirmando === f.logId ? (
                  <span className="shrink-0 flex items-center gap-1 text-[10px]">
                    <button type="button" onClick={() => { void borrar(f.logId!); }}
                      className="font-bold text-red-600 hover:underline">Borrar</button>
                    <span className="text-text-industrial/30">/</span>
                    <button type="button" onClick={() => setConfirmando(null)}
                      className="text-text-industrial/50 hover:underline">No</button>
                  </span>
                ) : (
                  <button type="button" onClick={() => setConfirmando(f.logId!)}
                    className="shrink-0 text-text-industrial/30 hover:text-red-500" title="Borrar novedad">
                    <Trash2 className="w-3 h-3" />
                  </button>
                )
              ) : (
                <span className="w-3 shrink-0" />
              )}
            </div>
          ))}
        </div>
      )}

      {editable && (
        <>
          <div className="flex gap-1.5 items-center pt-1">
            <input type="date" className={cellCls + " w-32 shrink-0"} value={fecha}
              onChange={e => setFecha(e.target.value)} title="Sin fecha = hoy" />
            <input className={cellCls + " flex-1 min-w-0"} value={novedad}
              onChange={e => setNovedad(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void agregar(); } }}
              placeholder="Ej. El taller confirma visita para el jueves" />
            <button type="button" onClick={() => { void agregar(); }} disabled={saving || !novedad.trim()}
              className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg bg-accent/10 border border-accent/20 text-accent text-[10px] font-bold disabled:opacity-40">
              <Plus className="w-3 h-3" /> Asentar
            </button>
          </div>
          <p className="text-[10px] text-text-industrial/40 italic">
            En gris, los movimientos que el sistema asienta solo. Acá se cargan las novedades del pedido
            (el taller reprogramó, falta un repuesto…). Sin fecha, se asienta con la de hoy.
          </p>
        </>
      )}

      {error && (
        <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-2 py-1.5 text-[10px] text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * ENTREGA / RECEPCION del formulario: al recibir el trabajo del taller hay que
 * dejar asentado quién lo recibió y si hubo conformidad — el backend lo exige.
 * La conformidad es una decisión explícita (no hay default): "no conforme" es
 * la evidencia de que el trabajo del tercero no se aceptó.
 */
function ReceiveServiceModal({ onClose, onConfirm, busy }: {
  onClose: () => void;
  onConfirm: (v: { receivedByName: string; receptionItem: string; receptionConform: boolean; closeNotes: string }) => Promise<void>;
  busy: boolean;
}) {
  const [recibe, setRecibe] = useState("");
  const [item, setItem] = useState("");
  const [conforme, setConforme] = useState<boolean | null>(null);
  const [notas, setNotas] = useState("");
  const [error, setError] = useState<string | null>(null);

  const confirmar = async () => {
    if (!recibe.trim()) { setError("Indicá quién recibe el servicio."); return; }
    if (conforme === null) { setError("Indicá si hay conformidad con el trabajo realizado."); return; }
    setError(null);
    try {
      await onConfirm({
        receivedByName: recibe.trim(), receptionItem: item.trim(),
        receptionConform: conforme, closeNotes: notas.trim(),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo registrar la recepción.");
    }
  };

  return (
    <FormModal
      title="Servicio recibido"
      subtitle="Entrega / Recepción"
      onClose={onClose}
      error={error}
      footer={
        <>
          <button type="button" onClick={onClose}
            className="px-3 py-1.5 rounded-lg bg-fg/5 border border-fg/10 text-[11px] text-text-industrial/60">
            Cancelar
          </button>
          <button type="button" onClick={() => { void confirmar(); }} disabled={busy}
            className="px-3 py-1.5 rounded-lg bg-accent text-accent-fg text-[11px] font-bold disabled:opacity-50">
            {busy ? "Guardando…" : "Registrar recepción"}
          </button>
        </>
      }
    >
      <div>
        <label className={labelCls}>¿Quién recibe el servicio?</label>
        <input className={inputCls} value={recibe} autoFocus
          onChange={e => setRecibe(e.target.value)} placeholder="Ej. J.M. CRISTHIAN VERON" />
      </div>
      <div>
        <label className={labelCls}>Ítem recibido (opcional)</label>
        <input className={inputCls} value={item}
          onChange={e => setItem(e.target.value)} placeholder="Ej. Servo timón Br" />
      </div>
      <div>
        <label className={labelCls}>¿Hay conformidad con el trabajo realizado?</label>
        <div className="flex gap-2">
          {[
            { v: true, txt: "Sí, conforme", on: "bg-success-sea text-white border-success-sea" },
            { v: false, txt: "No conforme", on: "bg-red-600 text-white border-red-600" },
          ].map(o => (
            <button key={String(o.v)} type="button" onClick={() => { setConforme(o.v); setError(null); }}
              className={`flex-1 px-3 py-2 rounded-lg border text-[11px] font-bold transition-colors ${
                conforme === o.v ? o.on : "bg-fg/5 border-fg/10 text-text-industrial/60 hover:border-accent/40"
              }`}>
              {o.txt}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className={labelCls}>Comentarios adicionales (opcional)</label>
        <textarea className={inputCls + " min-h-[56px] resize-y"} value={notas}
          onChange={e => setNotas(e.target.value)} />
      </div>
    </FormModal>
  );
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

function ServiceRequestModal({ sr, role, onClose, onChanged, onSaved }: {
  sr: ServiceRequest;
  role: string;
  onClose: () => void;
  /** Avanzó el estado: refresca la lista y cierra el modal. */
  onChanged: () => void;
  /** Se guardaron campos: refresca la lista y el registro, SIN cerrar el modal. */
  onSaved: (updated: ServiceRequest) => void;
}) {
  const [busy, setBusy] = useState(false);
  // Errores de acción: van dentro del modal, no en un alert() del navegador.
  const [actionError, setActionError] = useState<string | null>(null);
  // Pasos que piden datos (antes eran prompt()/confirm() nativos).
  const [receiving, setReceiving] = useState(false);
  // Aviso posterior a "Enviar a Proveedor" (PDF ya generado).
  const [sentNotice, setSentNotice] = useState(false);
  // Paso de tramitación abierto: cada uno pide quién firma y con qué fecha.
  const [tramita, setTramita] = useState<"SOLICITA" | "APRUEBA" | "AUTORIZA" | "RECHAZA" | null>(null);
  const canApprove = CAN_APPROVE_ROLES.includes(role);
  const canAuthorize = CAN_AUTHORIZE_ROLES.includes(role);
  // Una SS cerrada (completada/cancelada/rechazada) no se edita — el backend
  // lo bloquea igual (record lock), esto sólo evita ofrecerlo.
  const editable = !LOCKED_STATUSES.includes(sr.status);

  // ── Campos editables del formulario ──
  const [description, setDescription] = useState(sr.description ?? "");
  const [causes, setCauses] = useState(sr.causes ?? "");
  const [tallerNotes, setTallerNotes] = useState(sr.tallerNotes ?? "");
  const [compras, setCompras] = useState<string[]>(sr.purchaseRequestKinds ?? []);
  const [capitan, setCapitan] = useState(sr.capitanName ?? "");
  const [jefeMaq, setJefeMaq] = useState(sr.jefeMaquinasName ?? "");
  const [saving, setSaving] = useState(false);

  // Sólo para gatear el borrado de novedades de la hoja de ruta.
  const isAdmin = role === "TENANT_ADMIN";

  const dirty =
    description !== (sr.description ?? "") ||
    causes !== (sr.causes ?? "") ||
    tallerNotes !== (sr.tallerNotes ?? "") ||
    capitan !== (sr.capitanName ?? "") ||
    jefeMaq !== (sr.jefeMaquinasName ?? "") ||
    compras.join("|") !== (sr.purchaseRequestKinds ?? []).join("|");

  const toggleCompra = (v: string) =>
    setCompras(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]);

  const patchPayload = () => ({
    description, causes, tallerNotes,
    purchaseRequestKinds: compras,
    capitanName: capitan,
    jefeMaquinasName: jefeMaq,
  });

  // Guardar NO cierra el modal: el formulario es largo y se carga por partes —
  // cerrarlo obligaba a volver a abrir la SS para seguir completándola.
  const save = async () => {
    setSaving(true);
    setActionError(null);
    try {
      const updated = await api.patch<ServiceRequest>(`/app/pms/service-requests/${sr.id}`, patchPayload());
      onSaved(updated);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "No se pudieron guardar los cambios.");
    } finally {
      setSaving(false);
    }
  };

  /**
   * Guarda lo que esté pendiente ANTES de firmar o de mandar al taller.
   *
   * Devuelve la SS ya actualizada, o null si el guardado falló — en ese caso el
   * que llama NO debe avanzar: se estaría firmando (o imprimiendo) sobre datos
   * que no llegaron a la base.
   *
   * El PATCH devuelve el registro pelado, sin la relación `workOrder`; por eso
   * se mergea sobre `sr` en vez de reemplazarlo, o el PDF y el bloque "OT de
   * origen" se quedarían sin esos datos.
   */
  const saveIfDirty = async (): Promise<ServiceRequest | null> => {
    if (!dirty) return sr;
    setSaving(true);
    setActionError(null);
    try {
      const updated = await api.patch<ServiceRequest>(`/app/pms/service-requests/${sr.id}`, patchPayload());
      const merged = { ...sr, ...updated };
      onSaved(updated);
      return merged;
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "No se pudieron guardar los cambios.");
      return null;
    } finally {
      setSaving(false);
    }
  };

  /** Abre un paso de tramitación, guardando antes lo que esté sin guardar. */
  const openTramita = (step: "SOLICITA" | "APRUEBA" | "AUTORIZA" | "RECHAZA") => {
    void (async () => { if (await saveIfDirty()) setTramita(step); })();
  };

  /**
   * Avanza el estado. Propaga el error: los modales de paso muestran el suyo.
   * `keepOpen` deja el modal abierto para poder mostrar un aviso posterior
   * (lo usa "Enviar a Proveedor"); el cierre queda a cargo de quien llama.
   */
  const act = async (path: string, body?: unknown, opts?: { keepOpen?: boolean }) => {
    setBusy(true);
    setActionError(null);
    try {
      // Si hay cambios sin guardar, se guardan antes de avanzar el estado:
      // el paso siguiente (aprobar/autorizar) debe verlos.
      if (dirty) await api.patch(`/app/pms/service-requests/${sr.id}`, patchPayload());
      await api.post(`/app/pms/service-requests/${sr.id}/${path}`, body ?? {});
      if (!opts?.keepOpen) onChanged();
    } finally {
      setBusy(false);
    }
  };

  /**
   * "Enviar a Proveedor": primero sale el PDF (es el documento que se le manda
   * al taller), después se avanza el estado y recién ahí se avisa por dónde
   * mandarlo. Si el PDF falla no se avanza: no habría qué enviar.
   */
  const sendToProvider = async () => {
    setActionError(null);
    // Guardar PRIMERO: el PDF es el papel que se le manda al taller, así que
    // tiene que salir con lo último cargado. Antes se imprimía con `sr` tal
    // como estaba al abrir el modal y los cambios recién tipeados no salían.
    const fresh = await saveIfDirty();
    if (!fresh) return;
    const pdfOk = await printServiceRequest(fresh);
    if (!pdfOk) return;
    try {
      await act("start", undefined, { keepOpen: true });
      setSentNotice(true);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "No se pudo completar la acción.");
    }
  };

  /** Los botones del modal muestran el error acá; los de paso, en su propio modal. */
  const runAct = (path: string, body?: unknown) => {
    void act(path, body).catch(e =>
      setActionError(e instanceof Error ? e.message : "No se pudo completar la acción."));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-bg border border-fg/10" onClick={e => e.stopPropagation()}>
        {/* sticky: el formulario es largo — el código, el estado y la X tienen que
            seguir a la vista mientras se scrollea. El scroll lo hace la tarjeta. */}
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-6 py-4 bg-bg border-b border-fg/10">
          <div className="min-w-0">
            <p className="font-mono text-sm font-bold text-accent">{sr.serviceRequestCode}</p>
            {sr.workOrder?.assetName && (
              <p className="text-sm font-semibold text-fg truncate">{sr.workOrder.assetName}</p>
            )}
            <p className="text-xs text-text-industrial/60 truncate">{sr.title || sr.description || "—"}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={`px-2 py-0.5 rounded-lg border text-[10px] font-bold ${STATUS_COLORS[sr.status] ?? STATUS_COLORS.DRAFT}`}>
              {STATUS_LABELS[sr.status] ?? sr.status}
            </span>
            <ModalCloseButton onClose={onClose} />
          </div>
        </div>

        <div className="px-6 py-4 space-y-4">
          {sr.workOrder && (
            <Link
              to={`/work-orders?autoCode=${sr.workOrder.workOrderCode}`}
              className="flex items-center gap-2 rounded-xl border border-fg/10 bg-fg/5 px-3 py-2 hover:border-accent/30"
            >
              <ExternalLink className="w-3.5 h-3.5 text-accent shrink-0" />
              <span className="text-[10px] uppercase tracking-wider text-text-industrial/50 font-bold">OT de origen</span>
              <span className="font-mono text-xs font-bold text-accent">{sr.workOrder.workOrderCode}</span>
              <span className="flex-1 min-w-0 truncate text-xs text-text-industrial/70">{sr.workOrder.title}</span>
            </Link>
          )}

          <div>
            <label className={labelCls}>Descripción del servicio</label>
            <textarea
              className={inputCls + " min-h-[64px] resize-y"}
              value={description}
              disabled={!editable}
              onChange={e => setDescription(e.target.value)}
              placeholder="Qué se le pide al taller"
            />
          </div>

          <div>
            <label className={labelCls}>Detalle del servicio</label>
            <textarea
              className={inputCls + " min-h-[64px] resize-y"}
              value={causes}
              disabled={!editable}
              onChange={e => setCauses(e.target.value)}
              placeholder="Detalle del trabajo a realizar"
            />
          </div>

          <div>
            <label className={labelCls}>Taller que concurre</label>
            {/* El taller puede venir del catálogo (providerId → providerName) o
                como texto libre (tallerNotes). Cuando no hay texto libre se
                muestra el nombre del catálogo, para no dejar el campo vacío en
                las SS donde el taller se eligió de la lista. */}
            <input
              className={inputCls}
              value={tallerNotes || (sr.providerName ?? "")}
              disabled={!editable}
              onChange={e => setTallerNotes(e.target.value)}
              placeholder="Ej. Hidraulica Brasil"
            />
          </div>

          {/* SOLICITUD DE COMPRAS — admite varias marcadas a la vez, como el papel */}
          <div>
            <label className={labelCls}>Solicitud de compras</label>
            <div className="flex gap-2 flex-wrap">
              {PURCHASE_KINDS.map(k => {
                const on = compras.includes(k);
                return (
                  <button
                    key={k}
                    type="button"
                    disabled={!editable}
                    onClick={() => toggleCompra(k)}
                    className={`px-3 py-1 rounded text-xs font-bold border transition-colors disabled:opacity-60 ${
                      on ? "bg-accent text-accent-fg border-accent"
                        : "bg-fg/5 text-text-industrial/60 border-fg/10 hover:border-accent/40"
                    }`}
                  >
                    {k}
                  </button>
                );
              })}
            </div>
          </div>

          {/* TRAMITACION — sólo lectura, igual que en la OT: cada paso se registra
              al aprobar/autorizar, y ahí mismo el admin elige quién firma y con
              qué fecha (ver ApprovalModal). No hay edición posterior. */}
          <div className="rounded-xl border border-fg/10 p-3 space-y-2">
            <p className="text-[10px] uppercase tracking-widest text-text-industrial/40 font-bold">Tramitación</p>
            <Row label="Solicita" name={sr.solicitaByName ?? "—"} at={sr.openDate} />
            <Row label="Aprueba" name={sr.aprobadoByName} at={sr.aprobadoAt} />
            <Row label="Autoriza" name={sr.autorizadoByName} at={sr.autorizadoAt} />

            {sr.status === "REJECTED" && sr.rechazoReason && (
              <p className="text-[11px] text-red-600 dark:text-red-400">Rechazada: {sr.rechazoReason}</p>
            )}
          </div>

          {/* HOJA DE RUTA DEL PEDIDO — va después de la tramitación, igual que en el papel */}
          <HojaRutaBox srId={sr.id} editable={editable} isAdmin={isAdmin} />

          {/* ENTREGA / RECEPCION: la evidencia de que el trabajo del taller se aceptó */}
          {sr.receivedByName && (
            <div className="rounded-xl border border-fg/10 p-3 space-y-1.5">
              <p className="text-[10px] uppercase tracking-widest text-text-industrial/40 font-bold">Entrega / Recepción</p>
              <div className="flex items-center gap-2 text-[11px]">
                <span className="w-16 shrink-0 text-text-industrial/40 font-bold">Recibe</span>
                <span className="flex-1 min-w-0 truncate text-text-industrial">{sr.receivedByName}</span>
                <span className={`shrink-0 px-2 py-0.5 rounded-lg border text-[10px] font-bold ${
                  sr.receptionConform
                    ? "bg-success-sea/10 text-success-sea border-success-sea/20"
                    : "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20"
                }`}>
                  {sr.receptionConform ? "Conforme" : "No conforme"}
                </span>
              </div>
              {sr.receptionItem && <p className="text-[11px] text-text-industrial/70">{sr.receptionItem}</p>}
            </div>
          )}

          {/* Pie del papel: "Deben firmar y registrarse el Jefe de Máquinas y Capitán" */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Capitán</label>
              <input
                className={inputCls}
                value={capitan}
                disabled={!editable}
                onChange={e => setCapitan(e.target.value)}
                placeholder="Ej. CAP. WILLIAM RIQUELME"
              />
            </div>
            <div>
              <label className={labelCls}>Jefe de Máquinas</label>
              <input
                className={inputCls}
                value={jefeMaq}
                disabled={!editable}
                onChange={e => setJefeMaq(e.target.value)}
                placeholder="Ej. J.M. CRISTHIAN VERON"
              />
            </div>
          </div>

          {!canAuthorize && sr.status === "APROBADA" && (
            <p className="text-[11px] text-text-industrial/50 italic">
              Sólo el Superintendente técnico o el DPA / Director de Operaciones pueden autorizar esta solicitud.
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2 px-6 py-4 border-t border-fg/10">
          <button
            onClick={() => { void printServiceRequest(sr); }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-fg/5 border border-fg/10 text-xs text-text-industrial hover:border-accent/30"
          >
            <FileDown className="w-3.5 h-3.5" /> PDF
          </button>

          {editable && (
            <button onClick={() => { void save(); }} disabled={saving || !dirty}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-accent text-accent-fg text-xs font-bold hover:opacity-90 disabled:opacity-40">
              <Save className="w-3.5 h-3.5" /> {saving ? "Guardando…" : "Guardar"}
            </button>
          )}

          {sr.status === "DRAFT" && (
            <button onClick={() => openTramita("SOLICITA")} disabled={busy}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-accent/10 border border-accent/20 text-accent text-xs font-bold hover:bg-accent/20 disabled:opacity-50">
              <Send className="w-3.5 h-3.5" /> Solicitar
            </button>
          )}

          {/* Corregir antes de que la firme nadie. Después de aprobada ya no:
              habría que rechazar o cancelar, que sí quedan registrados. */}
          {sr.status === "SOLICITADA" && (
            <button onClick={() => { runAct("unsubmit"); }} disabled={busy}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-fg/5 border border-fg/10 text-xs text-text-industrial hover:border-accent/30 disabled:opacity-50">
              <Undo2 className="w-3.5 h-3.5" /> Volver a borrador
            </button>
          )}

          {sr.status === "SOLICITADA" && canApprove && (
            <button onClick={() => openTramita("APRUEBA")} disabled={busy}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-700 dark:text-blue-400 text-xs font-bold hover:bg-blue-500/20 disabled:opacity-50">
              <CheckCheck className="w-3.5 h-3.5" /> Aprobar
            </button>
          )}

          {/* Gate del gasto: habilita mandar el trabajo al taller */}
          {sr.status === "APROBADA" && canAuthorize && (
            <button onClick={() => openTramita("AUTORIZA")} disabled={busy}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-violet-500/10 border border-violet-500/20 text-violet-700 dark:text-violet-400 text-xs font-bold hover:bg-violet-500/20 disabled:opacity-50">
              <ShieldCheck className="w-3.5 h-3.5" /> Autorizar
            </button>
          )}

          {sr.status === "AUTORIZADA" && (
            <button onClick={() => { void sendToProvider(); }} disabled={busy}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 text-xs font-bold hover:bg-amber-500/20 disabled:opacity-50">
              <Play className="w-3.5 h-3.5" /> Enviar a Proveedor
            </button>
          )}

          {sr.status === "IN_PROGRESS" && (
            <button onClick={() => { setReceiving(true); }} disabled={busy}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-success-sea/10 border border-success-sea/20 text-success-sea text-xs font-bold hover:bg-success-sea/20 disabled:opacity-50">
              <PackageCheck className="w-3.5 h-3.5" /> Servicio recibido
            </button>
          )}

          {["SOLICITADA", "APROBADA"].includes(sr.status) && (canApprove || canAuthorize) && (
            <button onClick={() => openTramita("RECHAZA")} disabled={busy}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-700 dark:text-red-400 text-xs font-bold hover:bg-red-500/20 disabled:opacity-50">
              <XCircle className="w-3.5 h-3.5" /> Rechazar
            </button>
          )}
        </div>

        {actionError && (
          <p className="mx-6 mb-4 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-[11px] text-red-700 dark:text-red-400">
            {actionError}
          </p>
        )}
      </div>

      {receiving && (
        <ReceiveServiceModal
          busy={busy}
          onClose={() => setReceiving(false)}
          onConfirm={async v => { await act("complete", v); setReceiving(false); }}
        />
      )}
      {tramita && (
        <SsApprovalModal
          sr={sr}
          step={tramita}
          role={role}
          onClose={() => setTramita(null)}
          onDone={() => { setTramita(null); onChanged(); }}
        />
      )}
      {sentNotice && (
        <FormModal
          title="Solicitud enviada a proveedor"
          subtitle={sr.serviceRequestCode}
          onClose={() => { setSentNotice(false); onChanged(); }}
          footer={
            <button type="button" onClick={() => { setSentNotice(false); onChanged(); }}
              className="px-3 py-1.5 rounded-lg bg-accent text-accent-fg text-[11px] font-bold">
              Entendido
            </button>
          }
        >
          <p className="text-sm text-text-industrial">
            Enviar al proveedor a través de los canales predeterminados.
          </p>
          <p className="text-[11px] text-text-industrial/50">
            El PDF de la solicitud ya se descargó.
          </p>
        </FormModal>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest text-text-industrial/40 font-bold mb-1">{label}</p>
      <p className="text-xs text-text-industrial whitespace-pre-wrap">{value}</p>
    </div>
  );
}

function Row({ label, name, at }: { label: string; name: string | null; at: string | null }) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-16 shrink-0 text-text-industrial/40 font-bold">{label}</span>
      <span className="flex-1 min-w-0 truncate text-text-industrial">{name || "—"}</span>
      <span className="shrink-0 text-text-industrial/40">{at ? fmtDate(at) : ""}</span>
    </div>
  );
}
