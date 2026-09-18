// Solicitudes de Servicio (SS) — pedidos de servicio externo (un taller).
//
// Una SS siempre cuelga de una OT. "+ Nueva SS" abre el mismo asistente que el
// Tablero (NewServiceRequestWizard), que pide o crea esa OT antes del taller.
//
// Flujo: Borrador → Solicitada → Aprobada → Autorizada → En ejecución → Completada.
// Autorizar está restringido a tierra (Superintendente técnico / DPA): es el
// momento en que se compromete el gasto con el tercero, y no lo habilita el
// mismo que lo pidió a bordo.

import React, { useState } from "react";
import { useSearchParams, useNavigate, useLocation, Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, Check, CircleDashed, FileText, Flag, Hourglass, ListChecks, MoreHorizontal, Ship, Handshake, CheckCheck, Send, ShieldCheck, Play, FileDown, PackageCheck, ExternalLink, Save, Plus, Trash2, List, LayoutGrid, Layers, Pencil, Search, Truck, X, Loader2, Undo2, Ban, ChevronDown, Wrench } from "lucide-react";
import { api } from "../lib/api";
import { useFetch } from "../lib/hooks";
import { DataTable, fmtDate, type Column } from "../components/DataTable";
import { PageHeader } from "../components/PageHeader";
import { ModalCloseButton } from "../components/ModalCloseButton";
import { useEscapeGuard } from "../lib/escape-guard";
import { FormModal } from "../components/FormModal";
import { AlertDialog } from "../components/AlertDialog";
import { useAuth, useCan } from "../lib/auth";
import { useRoleHasPermission } from "../lib/role-permissions";
import { useVesselContext } from "../lib/vessel-context";
import { useCopilotEmitter, useCopilotApplyFields, useCopilotDataRefresh, useCopilotFlowKey, CopilotFlowProvider, useCopilotScreenContext } from "../lib/copilot-context";
import { printServiceRequest } from "../lib/print-work-order";
import { useTheme } from "../lib/theme";
import {
  SsPaperForm, SsSignColumn, SsCheckRow, SS_FORM_FALLBACK, OTRO_TALLER, ssDepartmentLabel,
  type SsFormDoc, type SsPaperValues,
} from "../components/service-requests/SsPaperForm";
import { downloadDocx } from "../lib/download-docx";
import { HojaRutaBox } from "../components/service-requests/HojaRutaBox";
import { GuideSection, GuideField, GuideNeedTag, GuidePill, GuideStageLabel, RequiredMark } from "../components/GuideKit";
import { WizardStepper } from "../components/NewWorkOrderWizard";
import { NewServiceRequestWizard } from "../components/NewServiceRequestWizard";
import { isJustCreated, clearJustCreated } from "../lib/just-created";
import { LabSamplesPanel, countUnnumbered, type LabSamplesData } from "../components/service-requests/LabSamplesPanel";
import { RECORD_IDENTITY, recordHeaderClass } from "../lib/record-identity";
import { AutoTextArea } from "../components/AutoTextArea";
import { PersonSelect } from "../components/PersonSelect";
import { useT, type TranslationKey } from "../lib/i18n";
import { textMatches } from "../lib/text-search";

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
  /** Usuario de quien solicita: de ahí sale la firma del PDF. */
  solicitaByUserId: string | null;
  createdByUserId: string | null;
  /** Nombre de quien la creó: es el que figura en SOLICITA hasta que se corrija. */
  createdByName?: string | null;
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
  // Recuadros del papel que hasta ahora sólo se imprimian
  /** DEPARTAMENTO + ASIGNADO A: es el mismo campo, mostrado dos veces. */
  department: string | null;
  /** COMENTARIOS ADICIONALES */
  observations: string | null;
  /** MEDIO DE COMUNICACION UTILIZADO */
  communicationMethod: string[];
  /** DISTRIBUCION (copia a) */
  distribution: string[];
  // Pie del formulario
  capitanName: string | null;
  jefeMaquinasName: string | null;
  workOrder?: { id: string; workOrderCode: string; title: string | null; status: string; assetId?: string | null; assetName?: string | null } | null;
}
interface ListResponse { items: ServiceRequest[]; total: number }

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Los valores del enum en la base no cambian (DRAFT/SOLICITADA/...): acá se
// nombran por lo que falta hacer, igual que las etapas de la OT, que es como lo
// lee la tripulación. "En ejecución" queda aparte de "Autorizada": autorizada
// es que se aprobó el gasto, en ejecución es que ya se le mandó al taller.
const STATUS_LABELS: Record<string, string> = {
  DRAFT: "En preparación", SOLICITADA: "Pendiente de aprobación", APROBADA: "Aprobada. Pendiente de autorización",
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

// Deben coincidir con el backend (canApprove / canAuthorize).
/** Autorizar: sólo tierra. El Jefe de Máquinas aprueba a bordo pero no autoriza. */

/** Estados terminales: la SS ya no se edita (mismo criterio que record-lock). */
const LOCKED_STATUSES = ["COMPLETED", "CANCELLED", "REJECTED"];

/**
 * Cómo se nombra una SS en pantalla: SIEMPRE la DESCRIPCIÓN DEL SERVICIO, que es
 * el único campo que el usuario edita.
 *
 * `title` se copia de la OT al crear la SS y después queda congelado: si se
 * edita la descripción (o se renombra la OT), la pantalla mostraba el texto
 * viejo mientras el formulario y el PDF mostraban el nuevo. El PDF ya usaba este
 * mismo orden (`description ?? title`); la pantalla no.
 *
 * `title` queda de reserva para las SS antiguas que puedan tener la descripción
 * vacía.
 */
const srServicio = (sr: { title: string | null; description: string | null }) =>
  sr.description || sr.title || "";


/** Los tres pasos del recuadro TRAMITACION DE LA SOLICITUD, en el orden del papel. */
const TRAMITA_STEPS = ["SOLICITA", "APRUEBA", "AUTORIZA"] as const;

interface TeamMember {
  userId: string;
  firstName: string | null;
  lastName: string | null;
  formName: string | null;
  role: string;
  /** Cargo cargado en Equipo (se muestra al lado del nombre; si no hay, el rol). */
  jobTitle?: string | null;
  hasSignature: boolean;
  /** Para ofrecer sólo a los que están a cargo del buque de la SS. */
  assignedVesselCodes?: string[];
}


/** Nombre a estampar en el formulario: el configurado para documentos, si tiene. */
const memberLabel = (m: TeamMember) =>
  m.formName?.trim() || `${m.firstName ?? ""} ${m.lastName ?? ""}`.trim() || "(sin nombre)";

/**
 * Quién puede figurar en cada paso de la tramitación. Un ADMIN siempre; el
 * SUPERINTENDENTE sólo si está a cargo del buque de la SS; el JEFE DE MÁQUINAS
 * sólo para APROBAR — autorizar es atribución de tierra. Solicitar no es una
 * firma: el pedido lo puede originar cualquiera del buque.
 *
 * Misma regla que valida el backend en resolveSigner. Se comparte entre el modal
 * de firma y la corrección de nombres del admin: dos copias divergiendo serían
 * un desplegable ofreciendo gente que el backend después rechaza.
 */
function eligibleSigners(
  members: TeamMember[],
  step: "SOLICITA" | "APRUEBA" | "AUTORIZA",
  vesselCode: string,
  /** Matriz de Equipo → Permisos ("Aprobar SS" / "Autorizar SS"), la misma que valida el backend. */
  roleHas: (role: string, key: string) => boolean,
): TeamMember[] {
  return members.filter(m => {
    if (m.role === "AUDITOR_READONLY") return false; // solo-lectura: no pide ni firma
    if (m.role === "TENANT_ADMIN") return true;
    const enElBuque = (m.assignedVesselCodes ?? []).includes(vesselCode);
    if (step === "SOLICITA") return enElBuque;
    return enElBuque && roleHas(m.role, step === "APRUEBA" ? "sr.approve" : "sr.authorize");
  });
}


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
  CRITICAL: "border-l-4 border-l-red-600",
  HIGH:     "border-l-4 border-l-orange-500",
  MEDIUM:   "border-l-4 border-l-yellow-500",
  LOW:      "border-l-4 border-l-emerald-500",
};

const SS_PRIO_CHIP_CLS: Record<string, string> = {
  CRITICAL: "bg-red-700 text-white",
  HIGH: "bg-orange-500/15 text-orange-700 dark:text-orange-300",
  MEDIUM: "bg-yellow-500/15 text-yellow-800 dark:text-yellow-300",
  LOW: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
};

type SsStage = "DRAFT" | "SOLICITADA" | "APROBADA" | "AUTORIZADA" | "IN_PROGRESS" | "HIDDEN";

/** Colores alineados con STATUS_COLORS para que la tarjeta y el badge no se contradigan. */
const SS_KANBAN_COLS: Array<{ colId: Exclude<SsStage, "HIDDEN">; headerCls: string; borderCls: string }> = [
  { colId: "DRAFT",       headerCls: "text-text-industrial/60",              borderCls: "border-t-2 border-fg/20" },
  { colId: "SOLICITADA",  headerCls: "text-yellow-700 dark:text-yellow-400", borderCls: "border-t-2 border-yellow-500/40" },
  { colId: "APROBADA",    headerCls: "text-blue-700 dark:text-blue-400",     borderCls: "border-t-2 border-blue-500/40" },
  { colId: "AUTORIZADA",  headerCls: "text-violet-700 dark:text-violet-400", borderCls: "border-t-2 border-violet-500/40" },
  { colId: "IN_PROGRESS", headerCls: "text-amber-700 dark:text-amber-400",   borderCls: "border-t-2 border-amber-500/40" },
];

const SS_OPEN_STATUSES = ["DRAFT", "SOLICITADA", "APROBADA", "AUTORIZADA", "IN_PROGRESS"];
const SS_TERMINAL_STATUSES = ["COMPLETED", "REJECTED", "CANCELLED"];

/**
 * Días en el taller a partir de los cuales la SS se marca en rojo. La SS no
 * guarda cuándo se mandó al taller, así que se cuenta desde la fecha de apertura.
 */
const SS_LONG_IN_SHOP_DAYS = 15;

function ssStage(sr: ServiceRequest): SsStage {
  return SS_KANBAN_COLS.some(c => c.colId === sr.status) ? (sr.status as SsStage) : "HIDDEN";
}

/** Días desde la apertura (0 = hoy). */
function ssAgeDays(sr: ServiceRequest): number {
  const d = new Date(sr.openDate);
  if (Number.isNaN(d.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000));
}

const isLongInShop = (sr: ServiceRequest) => sr.status === "IN_PROGRESS" && ssAgeDays(sr) > SS_LONG_IN_SHOP_DAYS;

/** El taller tal como se muestra: el del catálogo o el "otro taller" escrito a mano. */
const ssShopName = (sr: ServiceRequest) => sr.providerName?.trim() || sr.tallerNotes?.trim() || "";

/** Acción visible de una tarjeta/fila: el próximo paso de la SS (si el usuario puede darlo). */
type SsCardAction = { label: string; icon: typeof Send; tone: "accent" | "green"; run: () => void } | null;

function SsPriorityChip({ priority }: { priority: string }) {
  const t = useT();
  return (
    <span className={`shrink-0 rounded-full px-1.5 py-px text-[9px] font-extrabold uppercase whitespace-nowrap ${SS_PRIO_CHIP_CLS[priority] ?? "bg-fg/10 text-text-industrial/60"}`}>
      {t(`wo.prioShort.${priority}` as TranslationKey)}
    </span>
  );
}

function SsActionButton({ action }: { action: SsCardAction }) {
  if (!action) return null;
  const Icon = action.icon;
  return (
    <button type="button" onClick={e => { e.stopPropagation(); action.run(); }}
      className={`flex w-full items-center justify-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-bold transition-colors ${
        action.tone === "green"
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/20"
          : "border-accent/35 bg-accent/5 text-accent hover:bg-accent/15"
      }`}>
      <Icon className="w-3 h-3" /> {action.label}
    </button>
  );
}

/** "Abierta hace N d", o en rojo "En el taller hace N d" cuando lleva mucho. */
function SsAgeLabel({ sr }: { sr: ServiceRequest }) {
  const t = useT();
  const days = ssAgeDays(sr);
  if (isLongInShop(sr)) {
    return <span className="inline-flex items-center gap-1 text-[11px] font-bold text-red-700 dark:text-red-400" title={fmtDate(sr.openDate)}>
      <AlertTriangle className="w-3 h-3" />{t("ss.card.inShopLong").replace("{n}", String(days))}
    </span>;
  }
  return <span className="text-[11px] text-text-industrial/60" title={fmtDate(sr.openDate)}>{t("ss.card.age").replace("{n}", String(days))}</span>;
}

function SsKanbanCard({ sr, busy, draggingId, onOpen, onDragStart, showAsset, action }: {
  sr: ServiceRequest;
  busy: boolean;
  draggingId: string | null;
  onOpen: (sr: ServiceRequest) => void;
  onDragStart: (sr: ServiceRequest | null) => void;
  /** Sin agrupar por equipo, el equipo va en la tarjeta. */
  showAsset: boolean;
  action: SsCardAction;
}) {
  const t = useT();
  const isDragging = draggingId === sr.id;
  const prioLeft   = PRIORITY_LEFT_CLS[sr.priority] ?? "border-l-4 border-l-fg/10";
  const shop       = ssShopName(sr);
  const long       = isLongInShop(sr);

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
      className={`w-full border rounded-xl px-2.5 py-2 space-y-1.5 select-none flex flex-col cursor-grab
        ${long ? "border-fg/10 bg-red-500/[0.05]" : "border-fg/10 bg-surface"}
        ${prioLeft}
        ${isDragging ? "opacity-30" : "hover:shadow-md"}
        ${busy ? "opacity-60 pointer-events-none" : ""}
        transition-all`}
    >
      <div className="flex items-center gap-1.5">
        {/* El código nunca se parte: es lo que se busca a simple vista. */}
        <span className="font-mono font-bold text-fg text-xs whitespace-nowrap">{sr.serviceRequestCode}</span>
        <span className="ml-auto"><SsPriorityChip priority={sr.priority} /></span>
      </div>
      {srServicio(sr) && <p className="text-[13px] text-fg font-semibold leading-snug line-clamp-2">{srServicio(sr)}</p>}
      {showAsset && sr.workOrder?.assetName && (
        <span className="flex items-center gap-1 text-[11px] text-text-industrial/60 truncate"><Wrench className="w-3 h-3 shrink-0" />{sr.workOrder.assetName}</span>
      )}
      <span className={`flex items-center gap-1 text-[11px] truncate ${shop ? "font-semibold text-fg" : "font-bold text-amber-700 dark:text-amber-400"}`}>
        <Handshake className="w-3 h-3 shrink-0" />{shop || t("ss.card.noShop")}
      </span>
      <div className="flex flex-wrap items-center gap-1.5">
        <SsAgeLabel sr={sr} />
        {sr.workOrder && (
          <span className="ml-auto rounded-md border border-accent/25 bg-accent/5 px-1.5 py-px font-mono text-[10px] font-bold text-accent" title={t("ss.col.wo")}>
            {sr.workOrder.workOrderCode}
          </span>
        )}
      </div>
      <SsActionButton action={action} />
    </div>
  );
}

/**
 * Agrupa las SS de una columna por equipo, igual que el kanban de OT. El equipo
 * lo aporta la OT de origen (la SS no guarda assetId propio); la clave es el
 * assetId para no fusionar equipos homónimos de distintos buques, y las SS sin
 * OT (o sin equipo resuelto) caen en un grupo aparte.
 */
function groupSrsByAsset(items: ServiceRequest[]): { key: string; label: string; items: ServiceRequest[] }[] {
  const map = new Map<string, { label: string; items: ServiceRequest[] }>();
  for (const sr of items) {
    const key = sr.workOrder?.assetId ?? sr.workOrder?.assetName ?? "—";
    const label = sr.workOrder?.assetName ?? "—";
    const g = map.get(key);
    if (g) g.items.push(sr); else map.set(key, { label, items: [sr] });
  }
  return [...map.entries()]
    .map(([key, g]) => ({ key, label: g.label, items: g.items }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function SsKanbanBoard({ items, loading, onOpen, onReload, onApproval, grouped, onlyStage, cardAction }: {
  items: ServiceRequest[];
  loading: boolean;
  onOpen: (sr: ServiceRequest) => void;
  onReload: () => void;
  /** Arrastre que pide firma: abre el modal de tramitación (lo tiene la página). */
  onApproval: (sr: ServiceRequest, step: "SOLICITA" | "APRUEBA" | "AUTORIZA") => void;
  /** Agrupar las tarjetas por equipo (opcional: por defecto se ven todas). */
  grouped: boolean;
  /** Con un filtro de etapa, sólo esa columna. */
  onlyStage?: Exclude<SsStage, "HIDDEN">;
  cardAction: (sr: ServiceRequest) => SsCardAction;
}) {
  const t = useT();
  const [draggingSr, setDraggingSr] = useState<ServiceRequest | null>(null);
  const [overCol, setOverCol]       = useState<string | null>(null);
  const [busyId, setBusyId]         = useState<string | null>(null);
  const [dropError, setDropError]   = useState<string | null>(null);
  // Grupos por equipo plegados (clave `${colId}::${assetKey}`). Default: abiertos,
  // así las SS se ven apenas se agrupa (antes arrancaban cerrados y escondían todo).
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const toggleGroup = React.useCallback((k: string) => {
    setCollapsedGroups(prev => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  }, []);

  // Mismo criterio que el backend: se chequea acá sólo para explicar el porqué
  // en vez de dejar que el arrastre termine en un 403 sin mensaje.
  const can = useCan();
  const canApprove   = can("sr.approve");
  const canAuthorize = can("sr.authorize");

  const run = React.useCallback(async (sr: ServiceRequest, action: "unsubmit" | "start") => {
    setBusyId(sr.id);
    try {
      await api.post(`/app/pms/service-requests/${sr.id}/${action}`, {});
      onReload();
    } catch (e) {
      setDropError(e instanceof Error ? e.message : t("ss.list.moveError"));
    } finally {
      setBusyId(null);
    }
  }, [onReload, t]);

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
    if (stage === "DRAFT" && targetCol === "SOLICITADA") { onApproval(sr, "SOLICITA"); return; }
    // Volver a borrador para corregir. Sólo desde Solicitada: más adelante ya
    // hay firmas asentadas y deshacerlas sin registro sería perder la traza.
    if (stage === "SOLICITADA" && targetCol === "DRAFT") { void run(sr, "unsubmit"); return; }
    // Aprobar (Solicitada → Aprobada): a bordo, pide quién firma.
    if (stage === "SOLICITADA" && targetCol === "APROBADA") {
      if (!canApprove) { setDropError(t("ss.list.noApprovePerm")); return; }
      onApproval(sr, "APRUEBA");
      return;
    }
    // Autorizar (Aprobada → Autorizada): acá se compromete el gasto, es de tierra.
    if (stage === "APROBADA" && targetCol === "AUTORIZADA") {
      if (!canAuthorize) { setDropError(t("wo.guide.authorizeNoPerm")); return; }
      onApproval(sr, "AUTORIZA");
      return;
    }
    // Mandar al taller (Autorizada → En ejecución).
    if (stage === "AUTORIZADA" && targetCol === "IN_PROGRESS") { void run(sr, "start"); return; }
    // Cualquier otro movimiento (saltos de etapa o retrocesos) se ignora.
  }, [items, canApprove, canAuthorize, run, onApproval, t]);

  if (loading) return <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-accent" /></div>;

  const renderCard = (sr: ServiceRequest, showAsset: boolean) => (
    <SsKanbanCard
      key={sr.id}
      sr={sr}
      busy={busyId === sr.id}
      draggingId={draggingSr?.id ?? null}
      onOpen={onOpen}
      onDragStart={setDraggingSr}
      showAsset={showAsset}
      action={cardAction(sr)}
    />
  );

  return (
    <>
      {dropError && <AlertDialog message={dropError} onClose={() => setDropError(null)} />}
      {/* Columnas de ancho mínimo: en el celular se deslizan de costado en vez de apretarse. */}
      <div className={`grid grid-flow-col gap-3 pb-4 overflow-x-auto snap-x ${onlyStage ? "auto-cols-[minmax(16rem,28rem)]" : "auto-cols-[minmax(15rem,1fr)]"}`}>
        {SS_KANBAN_COLS.filter(col => !onlyStage || col.colId === onlyStage).map(col => {
          const colItems = items.filter(sr => ssStage(sr) === col.colId);
          const isOver   = overCol === col.colId;
          return (
            <div
              key={col.colId}
              onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setOverCol(col.colId); }}
              onDragLeave={() => setOverCol(null)}
              onDrop={e => { e.preventDefault(); handleDrop(e, col.colId); }}
              className={`snap-start min-w-0 flex flex-col ${col.borderCls} pt-3 px-1.5 rounded-b-xl bg-fg/[0.02] transition-colors duration-100 ${isOver ? "bg-fg/[0.05] ring-1 ring-accent/30" : ""}`}
            >
              <div className="flex items-center gap-2 px-1 mb-3">
                <span className={`text-[11px] font-bold uppercase tracking-widest ${col.headerCls}`}>{t(`ss.col.${col.colId}` as TranslationKey)}</span>
                <span className="ml-auto text-[10px] font-bold text-text-industrial/40 bg-fg/5 rounded-full px-1.5 py-0.5">{colItems.length}</span>
              </div>
              <div className="flex flex-col gap-2 overflow-y-auto" style={{ maxHeight: "calc(100vh - 280px)" }}>
                {colItems.length === 0 && <p className="text-[11px] text-text-industrial/30 text-center py-6">{t("wo.fl.nothing")}</p>}
                {!grouped && colItems.map(sr => renderCard(sr, true))}
                {grouped && groupSrsByAsset(colItems).map(group => {
                  const gkey = `${col.colId}::${group.key}`;
                  const collapsed = collapsedGroups.has(gkey);
                  return (
                    <div key={gkey} className="rounded-lg border border-fg/10 bg-fg/[0.02]">
                      <button
                        type="button"
                        onClick={() => toggleGroup(gkey)}
                        className="w-full flex items-center gap-1.5 px-2 py-1.5 text-left rounded-lg hover:bg-fg/[0.05] transition-colors"
                        title={group.label}
                      >
                        <ChevronDown className={`w-3.5 h-3.5 text-text-industrial/40 shrink-0 transition-transform duration-150 ${collapsed ? "-rotate-90" : ""}`} />
                        <Wrench className="w-3 h-3 text-accent/70 shrink-0" />
                        <span className="text-[11px] font-bold text-fg truncate flex-1">{group.label}</span>
                        <span className="text-[10px] font-bold text-text-industrial/50 bg-fg/10 rounded-full px-1.5 py-0.5 shrink-0">{group.items.length}</span>
                      </button>
                      {!collapsed && (
                        <div className="flex flex-col gap-2 p-2 pt-0">
                          {group.items.map(sr => renderCard(sr, false))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type SsStageKey = "" | "DRAFT" | "SOLICITADA" | "APROBADA" | "AUTORIZADA" | "IN_PROGRESS" | "COMPLETED" | "REJECTED" | "CANCELLED";
type SsCardKey = "sign" | "notSent" | "ready" | "long" | "rejected";

/**
 * Los chips viejos (?view=open, completed…) pueden venir en enlaces guardados:
 * se traducen a su botón de etapa.
 */
const LEGACY_VIEW_TO_STAGE: Record<string, SsStageKey> = {
  open: "", inProgress: "IN_PROGRESS", completed: "COMPLETED", rejected: "REJECTED", cancelled: "CANCELLED",
};
const SS_CARD_KEYS: SsCardKey[] = ["sign", "notSent", "ready", "long", "rejected"];

export function ServiceRequestsPage() {
  const t = useT();
  const { user } = useAuth();
  const can = useCan();
  const canApprove = can("sr.approve");
  const canAuthorize = can("sr.authorize");
  // Pedir, mandar al taller y recibir: cualquiera menos el rol de sólo lectura
  // (mismo criterio que canManage del backend de SS).
  const canManage = !!user && user.role !== "AUDITOR_READONLY";
  const { vessels } = useVesselContext();
  // SS recién enviada a aprobar: se confirma acá porque el modal ya se cerró.
  const [sentSsCode, setSentSsCode] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const locationKey = location.key;
  const [selected, setSelected] = useState<ServiceRequest | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "kanban">("kanban");
  const [search, setSearch] = useState("");
  // ── Filtros (preview V13): una sola barra para el tablero y la lista ──
  const viewParam = searchParams.get("view") ?? "";
  const cardSel: SsCardKey | "" = (SS_CARD_KEYS as string[]).includes(viewParam) ? (viewParam as SsCardKey) : "";
  const [stageSel, setStageSel] = useState<SsStageKey>(() => LEGACY_VIEW_TO_STAGE[viewParam] ?? "");
  const [shopSel, setShopSel] = useState("");
  const [assetSel, setAssetSel] = useState("");
  const [prioSel, setPrioSel] = useState("");
  const [groupByAsset, setGroupByAsset] = useState(false);
  const [showNewSs, setShowNewSs] = useState(false);
  // SS recién creada desde "+ Nueva SS": se abre cuando llega en la lista recargada.
  const [pendingOpenId, setPendingOpenId] = useState<string | null>(null);
  const [listApproval, setListApproval] = useState<{ sr: ServiceRequest; step: "SOLICITA" | "APRUEBA" | "AUTORIZA" } | null>(null);
  // Deep-link del donut del Dashboard: ?status=IN_PROGRESS (o varios separados
  // por coma, como REJECTED,CANCELLED). Se muestra como filtro activo.
  const statusParam = searchParams.get("status");
  const statusSet = React.useMemo(
    () => (statusParam ? new Set(statusParam.split(",").map(s => s.trim()).filter(Boolean)) : null),
    [statusParam],
  );

  // Se trae todo y se filtra en cliente: el backend no pagina y los filtros
  // cruzan estados, así que un filtro por estado en la query obligaría a
  // refetchear en cada clic. Mismo criterio que el tablero de OT.
  const { data, loading, error, reload } = useFetch<ListResponse>("/app/pms/service-requests", []);
  // El copiloto escribe desde el chat: si esta pantalla está abierta mostrando
  // lo que acaba de cambiar, se recarga sola.
  useCopilotDataRefresh(reload);
  const items = React.useMemo(() => data?.items ?? [], [data]);

  // Un ?view= viejo ya se pasó a su botón de etapa: se saca de la URL.
  React.useEffect(() => {
    if (!(viewParam in LEGACY_VIEW_TO_STAGE)) return;
    const params = new URLSearchParams(searchParams);
    params.delete("view");
    setSearchParams(params, { replace: true });
  }, [viewParam, searchParams, setSearchParams]);

  const setViewParam = (key: string) => {
    const params = new URLSearchParams(searchParams);
    if (key) params.set("view", key); else params.delete("view");
    // Una tarjeta es una vista completa: no se suma al ?status= del Dashboard.
    // Si no, "Autorizada" + "En el taller +15 días" no dejaba ninguna SS y el
    // tablero quedaba vacío aunque la tarjeta dijera que había.
    if (key) params.delete("status");
    setSearchParams(params, { replace: true });
    if (key) setStageSel("");
  };
  /** Elegir una etapa también reemplaza el filtro de estado y la tarjeta. */
  const pickStage = (key: SsStageKey) => {
    setStageSel(key);
    if (!statusParam && !cardSel) return;
    const params = new URLSearchParams(searchParams);
    params.delete("status");
    params.delete("view");
    setSearchParams(params, { replace: true });
  };
  const clearStatusParam = () => {
    const params = new URLSearchParams(searchParams);
    params.delete("status");
    setSearchParams(params, { replace: true });
  };

  /** Criterio de cada tarjeta de resumen. */
  const matchCard = React.useCallback((sr: ServiceRequest, key: SsCardKey): boolean => {
    switch (key) {
      case "sign":
        return canApprove || canAuthorize
          ? (canApprove && sr.status === "SOLICITADA") || (canAuthorize && sr.status === "APROBADA")
          : sr.status === "SOLICITADA" || sr.status === "APROBADA";
      case "notSent":  return sr.status === "DRAFT";
      case "ready":    return sr.status === "AUTORIZADA";
      case "long":     return isLongInShop(sr);
      case "rejected": return sr.status === "REJECTED";
    }
  }, [canApprove, canAuthorize]);

  /** Todo menos la etapa: base de los contadores de los botones de etapa. */
  const beforeStage = React.useMemo(() => {
    let list = items;
    if (statusSet) list = list.filter(sr => statusSet.has(sr.status));
    if (cardSel) list = list.filter(sr => matchCard(sr, cardSel));
    if (shopSel) list = list.filter(sr => (shopSel === "__none__" ? !ssShopName(sr) : ssShopName(sr) === shopSel));
    if (assetSel) list = list.filter(sr => sr.workOrder?.assetName === assetSel);
    if (prioSel) list = list.filter(sr => sr.priority === prioSel);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(sr =>
        textMatches(sr.serviceRequestCode, q) ||
        textMatches(sr.title ?? "", q) ||
        textMatches(sr.description ?? "", q) ||
        textMatches(sr.workOrder?.assetName ?? "", q) ||
        textMatches(ssShopName(sr), q) ||
        textMatches(sr.workOrder?.workOrderCode ?? "", q),
      );
    }
    return list;
  }, [items, statusSet, cardSel, matchCard, shopSel, assetSel, prioSel, search]);

  /**
   * "En trámite" deja afuera completadas, rechazadas y canceladas, salvo que se
   * esté buscando o que otro filtro las pida (Rechazadas, el donut del Dashboard).
   */
  const stageFilter = React.useCallback((list: ServiceRequest[], key: SsStageKey): ServiceRequest[] => {
    if (key) return list.filter(sr => sr.status === key);
    if (search.trim() || statusSet || cardSel === "rejected") return list;
    return list.filter(sr => SS_OPEN_STATUSES.includes(sr.status));
  }, [search, statusSet, cardSel]);

  const displayItems = React.useMemo(() => stageFilter(beforeStage, stageSel), [beforeStage, stageFilter, stageSel]);

  // Completadas, rechazadas y canceladas no tienen columna en el tablero: ahí va la lista.
  const statusOnlyTerminal = !!statusSet && ![...statusSet].some(s => SS_OPEN_STATUSES.includes(s));
  const showBoard = viewMode === "kanban" && !SS_TERMINAL_STATUSES.includes(stageSel) && cardSel !== "rejected" && !statusOnlyTerminal;

  /** Cuántas solicitudes se están viendo, para el contador del encabezado. */
  const shownCount = showBoard ? displayItems.filter(sr => ssStage(sr) !== "HIDDEN").length : displayItems.length;

  // ── Tarjetas de resumen (sobre todas las SS, sin filtros) ──
  const summary = React.useMemo(() => {
    const n = (key: SsCardKey) => items.filter(sr => matchCard(sr, key)).length;
    return { sign: n("sign"), notSent: n("notSent"), ready: n("ready"), long: n("long"), rejected: n("rejected") };
  }, [items, matchCard]);

  // Opciones de los desplegables: salen de lo que hay cargado.
  const shopOptions = React.useMemo(() => [...new Set(items.map(ssShopName).filter(Boolean))].sort(), [items]);
  const assetOptions = React.useMemo(
    () => [...new Set(items.map(sr => sr.workOrder?.assetName).filter((n): n is string => !!n))].sort(),
    [items],
  );
  const prioLabel = (p: string) => t(`wo.prioShort.${p}` as TranslationKey);
  const vesselName = (code: string) => vessels.find(v => v.code === code)?.name ?? code;

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
  // Flujo guiado por el copiloto que venía de otra pantalla (Nueva SS). Se lee una vez.
  const [copilotFlow] = React.useState<string | null>(() => (location.state as { copilotFlow?: string } | null)?.copilotFlow ?? null);
  React.useEffect(() => {
    if (!openId || !items.length) return;
    const hit = items.find(i => i.id === openId);
    if (hit) setSelected(hit);
  }, [openId, items]);
  React.useEffect(() => {
    if (!pendingOpenId) return;
    const hit = items.find(i => i.id === pendingOpenId);
    if (hit) { setSelected(hit); setPendingOpenId(null); }
  }, [pendingOpenId, items]);

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

  // ── Acción visible de cada SS (mismo paso que el arrastre del tablero) ──
  // Mandar al taller y dar el servicio por recibido abren la SS: allá están el
  // aviso de muestras sin numerar, el correo al proveedor y los datos de la
  // recepción, que un botón suelto no puede pedir.
  const cardAction = React.useCallback((sr: ServiceRequest): SsCardAction => {
    if (sr.status === "DRAFT" && canManage) return { label: t("wo.guide.send"), icon: Send, tone: "accent", run: () => setListApproval({ sr, step: "SOLICITA" }) };
    if (sr.status === "SOLICITADA" && canApprove) return { label: t("wo.guide.approve"), icon: Check, tone: "green", run: () => setListApproval({ sr, step: "APRUEBA" }) };
    if (sr.status === "APROBADA" && canAuthorize) return { label: t("wo.guide.authorize"), icon: ShieldCheck, tone: "green", run: () => setListApproval({ sr, step: "AUTORIZA" }) };
    if (sr.status === "AUTORIZADA" && canManage) return { label: t("ss.guide.sendProvider"), icon: Truck, tone: "accent", run: () => setSelected(sr) };
    if (sr.status === "IN_PROGRESS" && canManage) return { label: t("ss.guide.received"), icon: PackageCheck, tone: "green", run: () => setSelected(sr) };
    return null;
  }, [canManage, canApprove, canAuthorize, t]);

  const columns: Column<ServiceRequest>[] = [
    {
      key: "serviceRequestCode", header: t("ss.col.code"), sortable: true,
      render: r => (
        <div>
          <div className="font-mono text-xs font-bold text-accent whitespace-nowrap">{r.serviceRequestCode}</div>
          {/* Nombre del buque, no el código. */}
          <div className="text-[10px] text-text-industrial/50">{vesselName(r.vesselCode)}</div>
        </div>
      ),
    },
    {
      key: "title", header: t("ss.col.service"), sortable: true,
      sortValue: r => srServicio(r),
      /* El EQUIPO junto al servicio: sin esto, seis "TOMA DE MUESTRA de Aceite
         Lubricante" seguidas se leen iguales y hay que abrir cada SS para saber
         de qué máquina es. El nombre viene resuelto de la OT de origen
         (workOrder.assetName), la SS no guarda assetId propio. */
      render: r => (
        <div className="space-y-0.5">
          <span className="text-xs font-semibold text-fg">{srServicio(r) || "—"}</span>
          {r.workOrder?.assetName && (
            <div className="text-[11px] text-text-industrial/60 truncate">{r.workOrder.assetName}</div>
          )}
        </div>
      ),
    },
    {
      key: "shop", header: t("ss.col.shop"), sortable: true,
      sortValue: r => ssShopName(r),
      render: r => ssShopName(r)
        ? <span className="text-xs text-fg">{ssShopName(r)}</span>
        : <span className="text-xs font-bold text-amber-700 dark:text-amber-400">{t("ss.card.noShopShort")}</span>,
    },
    {
      key: "workOrder", header: t("ss.col.wo"), sortable: true,
      sortValue: r => r.workOrder?.workOrderCode ?? "",
      render: r => r.workOrder
        ? <span className="font-mono text-[11px] text-accent">{r.workOrder.workOrderCode}</span>
        : <span className="text-fg/30">—</span>,
    },
    {
      key: "priority", header: t("wo.col.priority"), sortable: true,
      sortValue: r => ({ CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 } as Record<string, number>)[r.priority] ?? 9,
      render: r => <SsPriorityChip priority={r.priority} />,
    },
    {
      key: "status", header: t("ss.col.stage"), sortable: true,
      render: r => (
        <div className="flex flex-col items-start gap-1">
          <span className={`px-2 py-0.5 rounded-lg border text-[10px] font-bold whitespace-nowrap ${STATUS_COLORS[r.status] ?? STATUS_COLORS.DRAFT}`}>
            {t(`ss.stage.${r.status}` as TranslationKey)}
          </span>
          {r.status === "REJECTED" && r.rechazoReason && (
            <span className="text-[10px] text-red-700 dark:text-red-400 line-clamp-2">{r.rechazoReason}</span>
          )}
        </div>
      ),
    },
    { key: "openDate", header: t("ss.col.opened"), sortable: true, render: r => <SsAgeLabel sr={r} /> },
    { key: "action", header: "", render: r => <div className="w-36"><SsActionButton action={cardAction(r)} /></div> },
  ];

  const summaryCards: { key: SsCardKey; n: number; label: string; hint: string; icon: typeof Send; cls: string; num: string }[] = [
    canApprove || canAuthorize
      ? { key: "sign", n: summary.sign, label: t("wo.sum.mySign"), hint: t("wo.sum.mySignHint"), icon: Pencil, cls: "border-l-blue-600", num: "text-blue-700 dark:text-blue-400" }
      : { key: "sign", n: summary.sign, label: t("ss.sum.waitSign"), hint: t("ss.sum.waitSignHint"), icon: Hourglass, cls: "border-l-blue-600", num: "text-blue-700 dark:text-blue-400" },
    { key: "notSent", n: summary.notSent, label: t("wo.sum.notSent"), hint: t("wo.sum.notSentHint"), icon: Send, cls: "border-l-amber-500", num: "text-amber-700 dark:text-amber-400" },
    { key: "ready", n: summary.ready, label: t("ss.sum.ready"), hint: t("ss.sum.readyHint"), icon: Truck, cls: "border-l-emerald-600", num: "text-emerald-700 dark:text-emerald-400" },
    { key: "long", n: summary.long, label: t("ss.sum.long").replace("{n}", String(SS_LONG_IN_SHOP_DAYS)), hint: t("ss.sum.longHint"), icon: AlertTriangle, cls: "border-l-red-600", num: "text-red-700 dark:text-red-400" },
    { key: "rejected", n: summary.rejected, label: t("ss.sum.rejected"), hint: t("ss.sum.rejectedHint"), icon: Ban, cls: "border-l-yellow-600", num: "text-yellow-700 dark:text-yellow-400" },
  ];
  const STAGE_BUTTONS: { key: SsStageKey; label: string }[] = [
    { key: "", label: t("ss.stageF.open") },
    { key: "DRAFT", label: t("wo.filter.inPreparation") },
    { key: "SOLICITADA", label: t("wo.stageF.toApprove") },
    { key: "APROBADA", label: t("wo.stageF.toAuthorize") },
    { key: "AUTORIZADA", label: t("wo.filter.authorized") },
    { key: "IN_PROGRESS", label: t("ss.stageF.inShop") },
    { key: "COMPLETED", label: t("ss.stageF.completed") },
    { key: "REJECTED", label: t("ss.sum.rejected") },
    { key: "CANCELLED", label: t("ss.stageF.cancelled") },
  ];
  const activeFilters: { key: string; label: string; clear: () => void }[] = [
    ...(statusSet ? [{ key: "status", label: [...statusSet].map(s => t(`ss.stage.${s}` as TranslationKey)).join(" · "), clear: clearStatusParam }] : []),
    ...(cardSel ? [{ key: "card", label: summaryCards.find(c => c.key === cardSel)!.label, clear: () => setViewParam("") }] : []),
    ...(stageSel ? [{ key: "stage", label: STAGE_BUTTONS.find(b => b.key === stageSel)!.label, clear: () => setStageSel("") }] : []),
    ...(shopSel ? [{ key: "shop", label: shopSel === "__none__" ? t("ss.fl.noShop") : shopSel, clear: () => setShopSel("") }] : []),
    ...(assetSel ? [{ key: "asset", label: assetSel, clear: () => setAssetSel("") }] : []),
    ...(prioSel ? [{ key: "prio", label: t("wo.fl.prio").replace("{p}", prioLabel(prioSel)), clear: () => setPrioSel("") }] : []),
  ];
  const clearAllFilters = () => {
    setStageSel(""); setShopSel(""); setAssetSel(""); setPrioSel(""); setSearch("");
    const params = new URLSearchParams(searchParams);
    params.delete("view"); params.delete("status");
    setSearchParams(params, { replace: true });
  };
  const selCls = (on: boolean) => `rounded-lg border px-2 py-1.5 text-xs focus:outline-none focus:border-accent/50 ${
    on ? "border-accent bg-accent/5 font-bold text-accent" : "border-fg/10 bg-fg/5 text-fg"
  }`;

  return (
    <div className="space-y-4">
      <PageHeader kind="serviceRequest" icon={Handshake} title={t("page.serviceRequests")} total={shownCount} onReload={reload}>
        <div className="flex items-center gap-0.5 rounded-lg border border-fg/10 bg-fg/5 p-0.5">
          {([["kanban", t("wo.list.board"), LayoutGrid], ["list", t("wo.list.list"), List]] as const).map(([mode, label, Icon]) => (
            <button key={mode} type="button" onClick={() => setViewMode(mode)}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-bold transition-colors ${viewMode === mode ? "bg-surface text-fg shadow-sm" : "text-text-industrial/50 hover:text-fg"}`}>
              <Icon className="w-3.5 h-3.5" /> {label}
            </button>
          ))}
        </div>
        {canManage && (
          <button type="button" onClick={() => setShowNewSs(true)} className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-accent text-accent-fg font-bold text-xs hover:brightness-110 transition-all">
            <Plus className="w-3.5 h-3.5" /> {t("ss.list.new")}
          </button>
        )}
      </PageHeader>

      {/* Resumen: lo que necesita atención. Tocar una tarjeta filtra. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
        {summaryCards.map(c => {
          const on = cardSel === c.key;
          return (
            <button key={c.key} type="button" onClick={() => setViewParam(on ? "" : c.key)}
              className={`flex flex-col items-start gap-0.5 rounded-2xl border-[1.5px] border-l-4 bg-surface px-3 py-2.5 text-left transition-all ${c.cls} ${
                on ? "border-accent ring-2 ring-accent/20" : "border-fg/10 hover:border-fg/25"
              }`}>
              <span className={`text-2xl font-extrabold leading-tight ${c.num}`}>{c.n}</span>
              <span className="flex items-center gap-1 text-xs font-semibold text-text-industrial/70"><c.icon className="w-3.5 h-3.5" />{c.label}</span>
              <span className="text-[10px] text-text-industrial/40">{c.hint}</span>
            </button>
          );
        })}
      </div>

      {/* Filtros: sirven igual para el tablero y la lista. */}
      <div className="rounded-2xl border border-fg/10 bg-surface p-3 space-y-2.5">
        <div className="flex flex-wrap gap-1.5">
          {STAGE_BUTTONS.map(b => {
            const on = stageSel === b.key;
            const count = stageFilter(beforeStage, b.key).length;
            return (
              <button key={b.key || "open"} type="button" onClick={() => pickStage(b.key)}
                className={`inline-flex items-center gap-1.5 rounded-full border-[1.5px] px-3 py-1 text-xs font-bold transition-colors ${
                  on ? "border-accent bg-accent text-accent-fg" : "border-fg/10 bg-surface text-text-industrial/60 hover:text-fg"
                }`}>
                {b.label}
                <span className={`rounded-full px-1.5 text-[10px] ${on ? "bg-white/25" : "bg-fg/10"}`}>{count}</span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={shopSel} onChange={e => setShopSel(e.target.value)} className={`${selCls(!!shopSel)} max-w-[14rem]`}>
            <option value="">{t("ss.fl.shopAll")}</option>
            <option value="__none__">{t("ss.fl.noShop")}</option>
            {shopOptions.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <select value={assetSel} onChange={e => setAssetSel(e.target.value)} className={`${selCls(!!assetSel)} max-w-[14rem]`}>
            <option value="">{t("wo.fl.assetAll")}</option>
            {assetOptions.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <select value={prioSel} onChange={e => setPrioSel(e.target.value)} className={selCls(!!prioSel)}>
            <option value="">{t("wo.fl.prioAll")}</option>
            {["CRITICAL", "HIGH", "MEDIUM", "LOW"].map(p => <option key={p} value={p}>{prioLabel(p)}</option>)}
          </select>
          {showBoard && (
            <button type="button" onClick={() => setGroupByAsset(v => !v)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                groupByAsset ? "border-accent bg-accent/5 text-accent" : "border-fg/10 bg-surface text-fg"
              }`}>
              <Layers className="w-3.5 h-3.5" /> {t("wo.fl.groupByAsset")}
            </button>
          )}
          <div className="flex items-center gap-1.5 rounded-lg border border-fg/10 bg-fg/5 px-2.5 py-1.5 w-full sm:w-auto sm:ml-auto">
            <Search className="w-3.5 h-3.5 text-text-industrial/40 shrink-0" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t("ss.list.search")}
              className="w-full sm:w-64 bg-transparent text-xs text-fg placeholder-text-industrial/30 focus:outline-none" />
            {search && (
              <button type="button" onClick={() => setSearch("")} className="text-text-industrial/40 hover:text-fg transition-colors">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
        {activeFilters.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-text-industrial/60">
            {t("wo.fl.filtering")}
            {activeFilters.map(f => (
              <span key={f.key} className="inline-flex items-center gap-1 rounded-full border border-accent/25 bg-accent/5 py-0.5 pl-2.5 pr-1 font-bold text-accent"
                title={f.key === "status" ? t("ss.list.dashboardStatus") : undefined}>
                {f.label}
                <button type="button" onClick={f.clear} className="flex h-4 w-4 items-center justify-center rounded-full bg-accent/15 hover:bg-accent/25">
                  <X className="w-2.5 h-2.5" />
                </button>
              </span>
            ))}
            <button type="button" onClick={clearAllFilters} className="underline hover:text-fg">{t("wo.fl.clear")}</button>
          </div>
        )}
      </div>

      {!showBoard ? (
        <DataTable
          columns={columns}
          data={displayItems}
          loading={loading}
          error={error}
          keyFn={r => r.id}
          emptyText={t("ss.list.empty")}
          onRowClick={(row: ServiceRequest) => setSelected(row)}
          rowClassName={r => (isLongInShop(r) ? "bg-red-500/[0.06] shadow-[inset_4px_0_0_rgb(220,38,38)]" : "")}
        />
      ) : (
        <SsKanbanBoard
          items={displayItems}
          loading={loading}
          onOpen={setSelected}
          onReload={reload}
          onApproval={(sr, step) => setListApproval({ sr, step })}
          grouped={groupByAsset}
          onlyStage={stageSel && !SS_TERMINAL_STATUSES.includes(stageSel) ? (stageSel as Exclude<SsStage, "HIDDEN">) : undefined}
          cardAction={cardAction}
        />
      )}

      {/* Firmas pedidas desde una tarjeta, una fila o un arrastre: mismo modal que dentro de la SS. */}
      {listApproval && (
        <SsApprovalModal
          sr={listApproval.sr}
          step={listApproval.step}
          role={user?.role ?? ""}
          onClose={() => setListApproval(null)}
          onDone={() => {
            if (listApproval.step === "SOLICITA") setSentSsCode(listApproval.sr.serviceRequestCode);
            setListApproval(null);
            reload();
          }}
        />
      )}

      {showNewSs && (
        <NewServiceRequestWizard
          onClose={() => setShowNewSs(false)}
          onFinished={serviceRequestId => {
            setShowNewSs(false);
            // Una sola SS: se abre para completarla. Varias (un taller cada una): quedan en la lista.
            if (serviceRequestId) setPendingOpenId(serviceRequestId);
            reload();
          }}
        />
      )}

      {selected && (() => {
        const modal = (
          <ServiceRequestModal
            sr={selected}
            role={user?.role ?? ""}
            onClose={closeModal}
            onChanged={() => { reload(); closeModal(); }}
            // Merge, no reemplazo: el PATCH devuelve el registro pelado (sin la
            // relación `workOrder` que sí trae la lista) y pisarlo entero borraría
            // el bloque "OT de origen" del modal abierto.
            onSaved={updated => { reload(); setSelected(prev => (prev ? { ...prev, ...updated } : updated)); }}
            onSentToApprove={setSentSsCode}
          />
        );
        // Sólo la SS que llegó dentro de un flujo guiado queda "en asistencia".
        return copilotFlow && selected.id === openId
          ? <CopilotFlowProvider name="ss" flowKey={copilotFlow}>{modal}</CopilotFlowProvider>
          : modal;
      })()}

      {/* Confirmación de "Enviar a aprobar": el modal de la SS ya se cerró. */}
      {sentSsCode && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-sm bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl p-5 space-y-3" role="dialog" aria-modal="true">
            <h2 className="flex items-center gap-2 text-sm font-bold text-fg">
              <CheckCheck className="w-5 h-5 text-success-sea" /> {t("ss.guide.sent.title")}
            </h2>
            <p className="text-sm text-text-industrial/80">{t("ss.guide.sent.body").replace("{code}", sentSsCode)}</p>
            <div className="flex justify-end">
              <button type="button" autoFocus onClick={() => setSentSsCode(null)}
                className="px-4 py-2 rounded-xl bg-accent text-accent-fg text-xs font-bold hover:brightness-110">OK</button>
            </div>
          </div>
        </div>
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
  const t = useT();
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
  const roleHas = useRoleHasPermission(adminPicker);
  // El backend valida igual (resolveSigner); esto es para no ofrecer un 403.
  const eligibles = step === "RECHAZA"
    ? []
    : eligibleSigners(Array.isArray(teamData) ? teamData : [], step, sr.vesselCode, roleHas);

  const title = step === "SOLICITA" ? "Enviar SS a aprobar"
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
          // Va el USUARIO además del nombre: de ahí sale la firma del PDF. Sin
          // esto el documento estampaba la firma de quien creó el registro
          // debajo del nombre del solicitante.
          onBehalfUserId: adminPicker ? (onBehalfUserId || undefined) : undefined,
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
      subtitle={`${sr.serviceRequestCode} · ${srServicio(sr)}`}
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
        <GuideField id="sr-approval-name" missing={!name.trim()}>
          <label className={labelCls}>Nombre de quien {verbo}<RequiredMark />{!name.trim() && <GuideNeedTag label={t("mp.guide.missing")} />}</label>
          {adminPicker ? (
            <PersonSelect
              autoFocus
              className={inputCls}
              value={onBehalfUserId}
              onChange={uid => {
                setOnBehalfUserId(uid);
                const m = eligibles.find(x => x.userId === uid);
                setName(m ? memberLabel(m) : (user?.name ?? ""));
              }}
              options={eligibles.length === 0
                ? [{ value: user?.id ?? "", name: user?.name ?? "—", role: user?.role ?? null }]
                : eligibles.map(m => ({
                    value: m.userId, name: memberLabel(m), role: m.role, jobTitle: m.jobTitle,
                    // La firma sólo importa donde se estampa: solicitar no firma.
                    note: !isSolicita && !m.hasSignature ? t("person.noSignature") : null,
                  }))}
            />
          ) : (
            <input autoFocus className={inputCls} value={name}
              onChange={e => setName(e.target.value)} placeholder="Nombre y apellido" />
          )}
        </GuideField>
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
        <GuideField id="sr-approval-reason" missing={!reason.trim()}>
          <label className={labelCls}>Motivo del rechazo<RequiredMark />{!reason.trim() && <GuideNeedTag label={t("mp.guide.missing")} />}</label>
          <AutoTextArea autoFocus className={inputCls + " min-h-[72px] resize-y"} value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Ej. El presupuesto del taller excede lo autorizado" />
        </GuideField>
      )}
    </FormModal>
  );
}


/**
 * ENTREGA / RECEPCION del formulario: al recibir el trabajo del taller hay que
 * dejar asentado quién lo recibió y si hubo conformidad — el backend lo exige.
 * La conformidad es una decisión explícita (no hay default): "no conforme" es
 * la evidencia de que el trabajo del tercero no se aceptó.
 */
function ReceiveServiceModal({ onClose, onConfirm, busy, initial }: {
  onClose: () => void;
  onConfirm: (v: { receivedByName: string; receptionItem: string; receptionConform: boolean; closeNotes: string }) => Promise<void>;
  busy: boolean;
  /** Lo que ya se escribió en el recuadro ENTREGA / RECEPCION del formulario. */
  initial?: { recibe: string; item: string; conforme: boolean | null };
}) {
  const t = useT();
  const [recibe, setRecibe] = useState(initial?.recibe ?? "");
  const [item, setItem] = useState(initial?.item ?? "");
  const [conforme, setConforme] = useState<boolean | null>(initial?.conforme ?? null);
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
      <GuideField id="sr-receive-name" missing={!recibe.trim()}>
        <label className={labelCls}>¿Quién recibe el servicio?<RequiredMark />{!recibe.trim() && <GuideNeedTag label={t("mp.guide.missing")} />}</label>
        <input className={inputCls} value={recibe} autoFocus
          onChange={e => setRecibe(e.target.value)} placeholder="Ej. J.M. CRISTHIAN VERON" />
      </GuideField>
      <div>
        <label className={labelCls}>Ítem recibido (opcional)</label>
        <input className={inputCls} value={item}
          onChange={e => setItem(e.target.value)} placeholder="Ej. Servo timón Br" />
      </div>
      <GuideField id="sr-receive-conform" missing={conforme === null}>
        <label className={labelCls}>¿Hay conformidad con el trabajo realizado?<RequiredMark />{conforme === null && <GuideNeedTag label={t("mp.guide.missing")} />}</label>
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
      </GuideField>
      <div>
        <label className={labelCls}>Comentarios adicionales (opcional)</label>
        <AutoTextArea className={inputCls + " min-h-[56px] resize-y"} value={notas}
          onChange={e => setNotas(e.target.value)} />
      </div>
    </FormModal>
  );
}

/**
 * CANCELAR una SS. El pedido se da de baja pero el registro queda con su motivo:
 * es lo contrario de Eliminar. Sirve en cualquier estado vivo —incluso ya
 * autorizada o en el taller—, porque un servicio se cae también después de
 * firmado (el buque zarpó, el taller no vino, se resolvió a bordo).
 *
 * "Cancelar" y no "anular": es la palabra que ya usa el estado CANCELLED en los
 * chips y en la etiqueta de la SS. Dos palabras para lo mismo confunden.
 *
 * El motivo se exige acá aunque el backend lo acepte vacío: una SS cancelada sin
 * explicación no le sirve a nadie en una auditoría.
 */
function CancelServiceRequestModal({ code, busy, onClose, onConfirm }: {
  code: string;
  busy: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [motivo, setMotivo] = useState("");
  const [alerta, setAlerta] = useState<string | null>(null);

  const confirmar = async () => {
    if (!motivo.trim()) { setAlerta("Indicá el motivo de la cancelación."); return; }
    try {
      await onConfirm(motivo.trim());
    } catch (e) {
      setAlerta(e instanceof Error ? e.message : "No se pudo cancelar la solicitud.");
    }
  };

  return (
    <>
      <FormModal
        title="Cancelar solicitud"
        subtitle={code}
        onClose={onClose}
        footer={
          <>
            <button type="button" onClick={onClose}
              className="px-3 py-1.5 rounded-lg bg-fg/5 border border-fg/10 text-[11px] text-text-industrial/60">
              Volver
            </button>
            <button type="button" onClick={() => { void confirmar(); }} disabled={busy}
              className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-[11px] font-bold disabled:opacity-50">
              {busy ? "Cancelando…" : "Cancelar solicitud"}
            </button>
          </>
        }
      >
        <p className="text-[11px] text-text-industrial/60">
          La solicitud queda cancelada y deja de tramitarse. El registro no se borra: sigue
          visible con el motivo, para que quede el antecedente.
        </p>
        <div>
          <label className={labelCls}>Motivo de la cancelación</label>
          <AutoTextArea className={inputCls + " min-h-[64px] resize-y"} value={motivo} autoFocus
            onChange={e => setMotivo(e.target.value)}
            placeholder="Ej. El trabajo se resolvió a bordo, no hace falta el taller" />
        </div>
      </FormModal>
      {alerta && <AlertDialog message={alerta} onClose={() => setAlerta(null)} />}
    </>
  );
}

/**
 * ELIMINAR una SS. Sólo en borrador: es deshacer una carga equivocada, no un
 * paso del flujo. Una vez solicitada hay firmas de por medio y lo que
 * corresponde es cancelarla (queda el antecedente).
 */
function DeleteServiceRequestModal({ code, busy, onClose, onConfirm }: {
  code: string;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [alerta, setAlerta] = useState<string | null>(null);

  const confirmar = async () => {
    try {
      await onConfirm();
    } catch (e) {
      setAlerta(e instanceof Error ? e.message : "No se pudo eliminar la solicitud.");
    }
  };

  return (
    <>
      <FormModal
        title="Eliminar solicitud"
        subtitle={code}
        onClose={onClose}
        footer={
          <>
            <button type="button" onClick={onClose}
              className="px-3 py-1.5 rounded-lg bg-fg/5 border border-fg/10 text-[11px] text-text-industrial/60">
              Volver
            </button>
            <button type="button" onClick={() => { void confirmar(); }} disabled={busy}
              className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-[11px] font-bold disabled:opacity-50">
              {busy ? "Eliminando…" : "Eliminar"}
            </button>
          </>
        }
      >
        <p className="text-sm text-text-industrial/80">
          Se elimina el borrador <span className="font-mono font-bold">{code}</span> y deja de
          aparecer en la lista. No se puede deshacer.
        </p>
        <p className="text-[11px] text-text-industrial/50">
          Si la solicitud ya se tramitó, en vez de eliminarla cancelala: así queda el antecedente.
        </p>
      </FormModal>
      {alerta && <AlertDialog message={alerta} onClose={() => setAlerta(null)} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Envío al proveedor por mail
// ---------------------------------------------------------------------------

// Casilla fija a la que se manda toda SS lista para el proveedor. El .docx no
// se puede adjuntar solo (ningún navegador deja adjuntar un archivo a un mailto:
// por seguridad): se descarga aparte y la persona lo adjunta a mano en el
// correo que se abre ya completo, desde su propia cuenta.
const PROVIDER_EMAIL = "jbael@mercuriogroup.com.py";

function buildProviderEmailDraft(sr: ServiceRequest, vesselName: string): { subject: string; body: string } {
  const equipo = sr.workOrder?.assetName ? ` — ${sr.workOrder.assetName}` : "";
  const taller = sr.providerName || sr.tallerNotes || "";
  const servicio = sr.title || sr.description || "";
  const subject = `Solicitud de Servicio ${sr.serviceRequestCode} — ${vesselName}`;
  const body = [
    "Estimados,",
    "",
    `Adjunto la Solicitud de Servicio ${sr.serviceRequestCode} del buque ${vesselName}${equipo}.`,
    taller ? `Taller: ${taller}` : null,
    servicio ? `Servicio solicitado: ${servicio}` : null,
    "",
    "Quedamos a la espera de confirmación.",
    "",
    "Saludos.",
  ].filter((line): line is string => line !== null).join("\n");
  return { subject, body };
}

/** Abre el cliente de correo del usuario con el mail ya armado. No adjunta el
 *  archivo (ver PROVIDER_EMAIL): eso lo hace la persona a mano. */
function openProviderEmailDraft(sr: ServiceRequest, vesselName: string) {
  const { subject, body } = buildProviderEmailDraft(sr, vesselName);
  window.location.href = `mailto:${PROVIDER_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

function ServiceRequestModal({ sr, role, onClose, onChanged, onSaved, onSentToApprove }: {
  sr: ServiceRequest;
  role: string;
  onClose: () => void;
  /** Se envió a aprobar: la página muestra la confirmación (este modal se cierra). */
  onSentToApprove?: (serviceRequestCode: string) => void;
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
  // Aviso posterior a "Enviar al Proveedor". `mailedTo` = casilla a la que lo
  // mandó el sistema; null = no hay casilla configurada y el correo se manda a
  // mano (se descargó el .docx y se abrió el borrador).
  const [sentNotice, setSentNotice] = useState<{ mailedTo: string | null; cc?: string[]; fellBack?: boolean } | null>(null);
  // Nombre del buque para el asunto/cuerpo del mail: nunca el código (ver
  // CLAUDE.md "Nombres, no códigos").
  const { vessels } = useVesselContext();
  const vesselName = vessels.find(v => v.code === sr.vesselCode)?.name ?? sr.vesselCode;
  // Bajas: anular (queda el registro) o eliminar el borrador (no queda nada).
  const [cancelling, setCancelling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Paso de tramitación abierto: cada uno pide quién firma y con qué fecha.
  const [tramita, setTramita] = useState<"SOLICITA" | "APRUEBA" | "AUTORIZA" | "RECHAZA" | null>(null);
  const t = useT();
  const can = useCan();
  const canApprove = can("sr.approve");
  const canAuthorize = can("sr.authorize");
  // Una SS cerrada (completada/cancelada/rechazada) no se edita — el backend
  // lo bloquea igual (record lock), esto sólo evita ofrecerlo.
  const editable = !LOCKED_STATUSES.includes(sr.status);

  // ── Muestras que viajan con el pedido ──
  // Las que la OT dejó abiertas al autorizarse (una por rutina de muestreo).
  // `reload()` y no un contador en las deps: useFetch cachea 30 s y el número
  // recién anotado tiene que aparecer en el acto (mismo criterio que HojaRutaBox).
  const { data: labSamples, reload: reloadLabSamples } =
    useFetch<LabSamplesData>(`/app/pms/service-requests/${sr.id}/lab-samples`, [sr.id]);
  // Aviso "faltan números": guarda cuántas faltan según el servidor, para que el
  // texto no salga con un número viejo.
  const [numbersWarning, setNumbersWarning] = useState<number | null>(null);

  // ── Recuadros editables del formulario ──
  // Van todos juntos porque la hoja los edita como un solo bloque (ver
  // SsPaperForm): el papel es un formulario, no una lista de campos sueltos.
  const [form, setForm] = useState<SsPaperValues>({
    department: sr.department ?? "",
    description: sr.description ?? "",
    causes: sr.causes ?? "",
    compras: sr.purchaseRequestKinds ?? [],
    providerId: sr.providerId ?? "",
    tallerNotes: sr.tallerNotes ?? "",
    observations: sr.observations ?? "",
    comunicacion: sr.communicationMethod ?? [],
    distribucion: sr.distribution ?? [],
    capitan: sr.capitanName ?? "",
    jefeMaq: sr.jefeMaquinasName ?? "",
    recepcionItem: sr.receptionItem ?? "",
    recibe: sr.receivedByName ?? "",
    conforme: sr.receptionConform ?? null,
  });
  const patchForm = (patch: Partial<SsPaperValues>) => setForm(f => ({ ...f, ...patch }));
  const [saving, setSaving] = useState(false);

  // Definicion del formulario controlado del tenant: la pantalla dibuja las
  // MISMAS secciones que imprime el PDF (ver SsPaperForm). Si el endpoint no
  // responde, se usa el default Mercurio y la hoja se dibuja igual.
  const { data: formDoc } = useFetch<SsFormDoc>("/app/pms/service-requests/form", []);
  // Firmas de la tramitación: van por endpoint aparte porque son imágenes en
  // base64 (no tienen por qué viajar en el listado). Se recargan cuando la SS
  // avanza de estado: cada paso agrega la suya.
  const { data: firmas } = useFetch<{ solicita: string | null; aprueba: string | null; autoriza: string | null }>(
    `/app/pms/service-requests/${sr.id}/signatures`, [sr.id, sr.status, sr.aprobadoAt, sr.autorizadoAt]);
  const doc = formDoc ?? SS_FORM_FALLBACK;

  // ── Lo que el copiloto ve y puede completar de esta SS ────────────────────
  // Mismo trato que la OT: ve los recuadros del formulario, sabe cuáles son de
  // lista cerrada y puede cargarlos preguntando de a uno. No guarda: el usuario
  // revisa la hoja y aprieta Guardar.
  const copilotFlow = useCopilotFlowKey();
  useCopilotEmitter({
    module: "SERVICE_REQUESTS",
    screen: "SR_EDIT",
    entityId: sr.id,
    entityCode: sr.serviceRequestCode,
    vesselCode: sr.vesselCode,
    workflowStage: sr.status,
    canEdit: editable,
    fieldValues: {
      department:    form.department      || null,
      description:   form.description     || null,
      causes:        form.causes          || null,
      purchaseKinds: form.compras.length > 0 ? form.compras.join(", ") : null,
      tallerNotes:   form.tallerNotes     || null,
      observations:  form.observations    || null,
      communication: form.comunicacion.length > 0 ? form.comunicacion.join(", ") : null,
      distribution:  form.distribucion.length > 0 ? form.distribucion.join(", ") : null,
      capitan:       form.capitan         || null,
      jefeMaq:       form.jefeMaq         || null,
    },
    // Las opciones salen del formulario controlado del tenant (el mismo que
    // dibuja la hoja y estampa el PDF), no de una copia acá: si el tenant cambia
    // su formulario, el copiloto propone las opciones nuevas sin tocar código.
    fieldOptions: {
      department:    doc.config.departments.map(v => ({ value: v, label: v })),
      purchaseKinds: doc.config.purchaseRequest.map(v => ({ value: v, label: v })),
      communication: doc.config.communicationMethods.map(v => ({ value: v, label: v })),
      distribution:  doc.config.distribution.map(v => ({ value: v, label: v })),
    },
    // Abierta dentro de un flujo que el copiloto venía guiando (Nueva SS del Tablero).
    ...(copilotFlow && editable ? { assist: { flow: copilotFlow, title: sr.serviceRequestCode } } : {}),
  });

  useCopilotApplyFields(editable ? (fields) => {
    /** Lista cerrada de una sola opción: sólo entra un valor que exista. */
    const pickOne = (options: string[], value: string | undefined): string | null =>
      value !== undefined && options.includes(value) ? value : null;
    /** Recuadros de tildar varios: se acepta "A, B" y se descartan los inventados. */
    const pickMany = (options: string[], value: string | undefined): string[] | null => {
      if (value === undefined) return null;
      const picked = value.split(",").map(v => v.trim()).filter(v => options.includes(v));
      return picked.length > 0 ? picked : null;
    };

    const patch: Partial<SsPaperValues> = {};
    if (fields.description  !== undefined) patch.description  = fields.description;
    if (fields.causes       !== undefined) patch.causes       = fields.causes;
    if (fields.tallerNotes  !== undefined) patch.tallerNotes  = fields.tallerNotes;
    if (fields.observations !== undefined) patch.observations = fields.observations;
    if (fields.capitan      !== undefined) patch.capitan      = fields.capitan;
    if (fields.jefeMaq      !== undefined) patch.jefeMaq      = fields.jefeMaq;

    const dept = pickOne(doc.config.departments, fields.department);
    if (dept) patch.department = dept;
    const compras = pickMany(doc.config.purchaseRequest, fields.purchaseKinds);
    if (compras) patch.compras = compras;
    const comunicacion = pickMany(doc.config.communicationMethods, fields.communication);
    if (comunicacion) patch.comunicacion = comunicacion;
    const distribucion = pickMany(doc.config.distribution, fields.distribution);
    if (distribucion) patch.distribucion = distribucion;

    if (Object.keys(patch).length > 0) patchForm(patch);
  } : null);
  // Logo de la cabecera: el propio del formulario (el que estampa el PDF) y, si
  // no hay, el del tenant. En modo oscuro gana el logo claro del tenant — el del
  // papel es oscuro y sobre fondo oscuro no se ve.
  const { tenant } = useAuth();
  const { theme } = useTheme();
  const formLogo = theme === "dark"
    ? (tenant?.logoUrlLight || doc.logoUrl || tenant?.logoUrl || null)
    : (doc.logoUrl || tenant?.logoUrl || tenant?.logoUrlLight || null);

  // Descarga de la copia editable en Word (.docx).
  const [bajandoWord, setBajandoWord] = useState(false);
  const descargarWord = async () => {
    setBajandoWord(true);
    try {
      const ok = await downloadDocx(`/app/pms/service-requests/${sr.id}/docx`, sr.serviceRequestCode);
      if (!ok) setActionError("No se pudo generar el documento Word. Intentá de nuevo.");
    } finally {
      setBajandoWord(false);
    }
  };

  // Nombres de la TRAMITACION. Sólo el admin los edita (el backend lo vuelve a
  // verificar): son la firma de quién pidió, aprobó y autorizó el gasto. Se
  // corrigen para que el registro coincida con el formulario de papel; cambiar
  // el nombre NO avanza el estado ni pone la fecha.
  const [firmaSolicita, setFirmaSolicita] = useState(
    { name: sr.solicitaByName ?? "", userId: sr.solicitaByUserId ?? "" });
  const [firmaAprueba, setFirmaAprueba] = useState(
    { name: sr.aprobadoByName ?? "", userId: sr.aprobadoByUserId ?? "" });
  const [firmaAutoriza, setFirmaAutoriza] = useState(
    { name: sr.autorizadoByName ?? "", userId: sr.autorizadoByUserId ?? "" });
  // Un paso sólo se corrige si YA PASÓ. No se puede escribir quién aprueba una
  // SS que nadie aprobó: eso no sería una corrección, sería inventar una firma.
  // Solicitar se da por cumplido cuando la SS salió de borrador; los otros dos,
  // cuando quedó su fecha.
  const solicitaDone = sr.status !== "DRAFT";
  const apruebaDone = !!sr.aprobadoAt;
  const autorizaDone = !!sr.autorizadoAt;
  // `role` alcanza para decidir si mostrar los desplegables; `isAdmin` se define
  // más abajo y este bloque necesita el valor antes, para el fetch del equipo.
  const puedeCorregirFirmas = role === "TENANT_ADMIN" && editable
    && (solicitaDone || apruebaDone || autorizaDone);
  // Tripulación elegible por paso. /app/team/members es de administración: sólo
  // se pide cuando hay algo que corregir.
  const { data: teamData } = useFetch<TeamMember[]>(
    puedeCorregirFirmas ? "/app/team/members" : null, [puedeCorregirFirmas]);
  const team = Array.isArray(teamData) ? teamData : [];
  const roleHas = useRoleHasPermission(puedeCorregirFirmas);

  // TALLER QUE CONCURRE — se elige del catálogo de proveedores (mismo patrón que
  // el "Tercerizado" del formulario REGI-MAN-02.3 en la OT). Escribirlo a mano
  // dejaba el dato suelto: no se podía filtrar por taller ni evaluar al
  // proveedor. El texto libre sigue existiendo para el taller que todavía no
  // está en el catálogo, pero ahora es la excepción y no la única opción.
  const [providers, setProviders] = useState<Array<{ id: string; name: string; providerCode: string }>>([]);
  // Arranca en "otra empresa" si la SS ya se guardó con un nombre escrito a mano.
  const [otroTaller, setOtroTaller] = useState(!sr.providerId && !!sr.tallerNotes);
  React.useEffect(() => {
    let cancelled = false;
    api.get<{ items: Array<{ id: string; name: string; providerCode: string }> }>(`/app/providers?status=ACTIVE`)
      .then(r => { if (!cancelled) setProviders(r.items ?? []); })
      .catch(() => { if (!cancelled) setProviders([]); });
    return () => { cancelled = true; };
  }, []);

  // Al abrir, refrescar el ESTADO real de la SS. La lista se carga una sola vez;
  // una cascada (autorizar la OT arrastra sus SS a AUTORIZADA) pudo haber avanzado
  // esta SS sin que la lista se enterara. Sin esto, el modal mostraba "Aprobada"
  // y ofrecía "Autorizar" sobre una SS que la base ya tenía AUTORIZADA → al hacer
  // clic saltaba "sólo se puede autorizar una solicitud aprobada". Solo refresca
  // si el estado cambió, para no recargar la lista de más.
  React.useEffect(() => {
    let cancelled = false;
    api.get<ServiceRequest>(`/app/pms/service-requests/${sr.id}`)
      .then(fresh => { if (!cancelled && fresh.status !== sr.status) onSaved(fresh); })
      .catch(() => { /* si falla, se queda con lo que trajo la lista */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sr.id]);

  // Sólo para gatear el borrado de novedades de la hoja de ruta.
  const isAdmin = role === "TENANT_ADMIN";

  // Si la SS se rechazó, el paso que la frenó: el que seguía sin fecha (mismo
  // criterio que el PDF, para que papel y pantalla marquen la misma columna).
  const rechazadaEn = sr.status === "REJECTED" ? (sr.aprobadoAt ? "AUTORIZA" : "APRUEBA") : null;

  const dirty =
    form.description !== (sr.description ?? "") ||
    form.causes !== (sr.causes ?? "") ||
    form.tallerNotes !== (sr.tallerNotes ?? "") ||
    form.providerId !== (sr.providerId ?? "") ||
    form.capitan !== (sr.capitanName ?? "") ||
    form.jefeMaq !== (sr.jefeMaquinasName ?? "") ||
    form.department !== (sr.department ?? "") ||
    form.observations !== (sr.observations ?? "") ||
    form.recepcionItem !== (sr.receptionItem ?? "") ||
    form.recibe !== (sr.receivedByName ?? "") ||
    form.conforme !== (sr.receptionConform ?? null) ||
    form.compras.join("|") !== (sr.purchaseRequestKinds ?? []).join("|") ||
    form.comunicacion.join("|") !== (sr.communicationMethod ?? []).join("|") ||
    form.distribucion.join("|") !== (sr.distribution ?? []).join("|") ||
    // Sólo cuentan los desplegables que de verdad se muestran (admin + paso ya
    // cumplido). Si no, un dirty fantasma dejaría Guardar siempre encendido.
    (puedeCorregirFirmas && (
      (solicitaDone && firmaSolicita.userId !== (sr.solicitaByUserId ?? "")) ||
      (apruebaDone && firmaAprueba.userId !== (sr.aprobadoByUserId ?? "")) ||
      (autorizaDone && firmaAutoriza.userId !== (sr.autorizadoByUserId ?? ""))
    ));

  // providerId y tallerNotes son excluyentes: el taller sale del catálogo o se
  // escribe a mano, nunca las dos cosas. Se manda el par completo (uno con
  // valor, el otro vacío) para que cambiar de opción borre la anterior.
  const patchPayload = () => ({
    description: form.description,
    causes: form.causes,
    tallerNotes: otroTaller ? form.tallerNotes : "",
    providerId: otroTaller ? "" : form.providerId,
    purchaseRequestKinds: form.compras,
    department: form.department,
    communicationMethod: form.comunicacion,
    distribution: form.distribucion,
    observations: form.observations,
    capitanName: form.capitan,
    jefeMaquinasName: form.jefeMaq,
    receptionItem: form.recepcionItem,
    receivedByName: form.recibe,
    receptionConform: form.conforme,
    // Las firmas viajan sólo si el que edita es admin Y el paso ya se cumplió:
    // mandarlas de más haría que el backend devuelva 403/409 y se pierda todo el
    // resto del guardado.
    ...(puedeCorregirFirmas && solicitaDone
      ? { solicitaByName: firmaSolicita.name, solicitaByUserId: firmaSolicita.userId } : {}),
    ...(puedeCorregirFirmas && apruebaDone
      ? { aprobadoByName: firmaAprueba.name, aprobadoByUserId: firmaAprueba.userId } : {}),
    ...(puedeCorregirFirmas && autorizaDone
      ? { autorizadoByName: firmaAutoriza.name, autorizadoByUserId: firmaAutoriza.userId } : {}),
  });

  // Guardar NO cierra el modal: el formulario es largo y se carga por partes —
  // cerrarlo obligaba a volver a abrir la SS para seguir completándola.
  const save = async (): Promise<ServiceRequest | null> => {
    setSaving(true);
    setActionError(null);
    try {
      const updated = await api.patch<ServiceRequest>(`/app/pms/service-requests/${sr.id}`, patchPayload());
      onSaved(updated);
      return updated;
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "No se pudieron guardar los cambios.");
      return null;
    } finally {
      setSaving(false);
    }
  };

  // Guardó con el botón "Guardar": el copiloto pregunta si se genera el PDF de
  // la SS (con lo recién guardado). La respuesta no pasa por la IA.
  const { pushCopilotOffer } = useCopilotScreenContext();
  // Después del PDF (se conteste sí o no), si la SS sigue en borrador el
  // copiloto pregunta si se envía a aprobar. El "sí" abre la MISMA ventana que
  // el botón "Enviar a aprobar", donde se confirma quién la solicita.
  const openTramitaRef = React.useRef<(step: "SOLICITA") => void>(() => {});
  const offerSendToApprove = (code: string) => {
    pushCopilotOffer({
      key: `send-ss:${sr.id}:${Date.now()}`,
      text: `${t("copilot.sendOffer.ss")} **${code}**?`,
      choices: [{ value: "yes", label: t("copilot.sendOffer.yes") }, { value: "no", label: t("copilot.pdfOffer.no") }],
      onChoice: (v) => {
        if (v !== "yes") return null;
        openTramitaRef.current("SOLICITA");
        return t("copilot.sendOffer.opened");
      },
    });
  };
  const offerPdfAfterSave = (saved: ServiceRequest) => {
    const doc = { ...sr, ...saved };
    const canSend = doc.status === "DRAFT";
    pushCopilotOffer({
      key: `pdf-ss:${sr.id}:${Date.now()}`,
      text: `${t("copilot.pdfOffer.ss")} **${doc.serviceRequestCode}**?`,
      choices: [{ value: "yes", label: t("copilot.pdfOffer.yes") }, { value: "no", label: t("copilot.pdfOffer.no") }],
      onChoice: async (v) => {
        let reply: string | null = null;
        if (v === "yes") {
          const ok = await printServiceRequest(doc);
          reply = ok ? t("copilot.pdfOffer.done") : null;
        }
        if (canSend) offerSendToApprove(doc.serviceRequestCode);
        return reply;
      },
    });
  };

  // Este modal es largo y se completa por partes; salir sin querer costaba
  // rehacer la carga. `dirty` ya existía para gatear el botón Guardar, así que
  // el guardián reusa esa misma señal: sin cambios, cerrar no pregunta nada.
  // Va después de `save` porque lo recibe como handler del botón "Guardar" del
  // diálogo.
  const requestClose = useEscapeGuard({ isDirty: dirty, onSave: async () => { await save(); }, onClose });

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
  openTramitaRef.current = (step) => openTramita(step);

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
   * "Enviar al Proveedor": el sistema manda la SS por correo con el formulario
   * en PDF adjunto y recién entonces la pasa a EN EJECUCIÓN (el backend hace las
   * dos cosas en ese orden: una SS no puede figurar enviada si el correo no
   * salió).
   *
   * Guarda primero: el documento tiene que salir con lo último cargado.
   *
   * Si todavía no hay casilla de correo configurada, el backend devuelve
   * `sent:false` sin tocar el estado y se cae al camino manual de siempre: se
   * baja el .docx y se abre el correo del usuario con destinatario, asunto y
   * cuerpo ya armados, para que lo adjunte y lo mande desde su cuenta (un
   * mailto: no puede adjuntar archivos solo).
   */
  const sendToProvider = async (opts?: { acknowledgeMissingSampleNumbers?: boolean }) => {
    setActionError(null);
    // Si el envío lleva muestras sin numerar, primero se avisa: sin el número,
    // el análisis que vuelva del laboratorio hay que cotejarlo a mano. El
    // usuario puede seguir igual, y eso queda asentado en la hoja de ruta.
    //
    // Se relee del servidor en vez de mirar el estado de la pantalla: el número
    // se guarda al salir del campo, y tipear + clickear "Enviar" de corrido deja
    // el guardado en vuelo. Con el estado viejo el aviso salía de más.
    if (!opts?.acknowledgeMissingSampleNumbers) {
      try {
        const fresh = await api.get<LabSamplesData>(`/app/pms/service-requests/${sr.id}/lab-samples`);
        const faltan = countUnnumbered(fresh);
        if (faltan > 0) { setNumbersWarning(faltan); return; }
      } catch {
        // Si no se pudo consultar, manda el gate del backend: el envío se
        // intenta igual y allá se rechaza si faltan números.
      }
    }
    const fresh = await saveIfDirty();
    if (!fresh) return;

    const ack = { acknowledgeMissingSampleNumbers: !!opts?.acknowledgeMissingSampleNumbers };
    setBusy(true);
    try {
      const r = await api.post<{ sent: boolean; to: string[]; cc?: string[]; fellBackToMailbox?: boolean; reason?: string; error?: string }>(
        `/app/pms/service-requests/${fresh.id}/send-to-provider`, ack);
      if (r.sent) {
        setSentNotice({ mailedTo: r.to.join(", "), cc: r.cc ?? [], fellBack: !!r.fellBackToMailbox });
        return;
      }
      if (r.reason === "SEND_FAILED") {
        setActionError(`No se pudo enviar el correo. ${r.error ?? ""}`.trim());
        return;
      }
      // Sin casilla configurada: se manda a mano, como antes.
      const docxOk = await downloadDocx(`/app/pms/service-requests/${fresh.id}/docx`, fresh.serviceRequestCode);
      if (!docxOk) {
        setActionError("No se pudo generar el documento Word. Intentá de nuevo.");
        return;
      }
      openProviderEmailDraft(fresh, vesselName);
      await act("start", ack, { keepOpen: true });
      setSentNotice({ mailedTo: null });
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "No se pudo completar la acción.");
    } finally {
      setBusy(false);
    }
  };

  /**
   * Eliminar el borrador. No pasa por `act`: es un DELETE y no hay nada que
   * guardar antes — lo que esté a medio tipear se va con el registro.
   */
  const removeDraft = async () => {
    setBusy(true);
    setActionError(null);
    try {
      await api.delete(`/app/pms/service-requests/${sr.id}`);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  /** Los botones del modal muestran el error acá; los de paso, en su propio modal. */
  const runAct = (path: string, body?: unknown) => {
    void act(path, body).catch(e =>
      setActionError(e instanceof Error ? e.message : "No se pudo completar la acción."));
  };

  // ═══ Vista guiada ══════════════════════════════════════════════════════════
  // Misma SS, mismos campos y mismo guardado que la hoja REGI-LOG-01.3: cambia
  // el orden (por etapa: preparar → aprobación → autorización → envío al taller
  // → recepción) y se marca en naranja todo lo que falta para avanzar. La hoja
  // sigue disponible, editable, en la otra vista. Pedido del usuario, sep 2026
  // (preview V8).
  const [ssView, setSsView] = useState<"guided" | "paper">("guided");
  const [openSecs, setOpenSecs] = useState<Record<string, boolean>>({});
  const [flashKey, setFlashKey] = useState<string | null>(null);
  const [sendAsk, setSendAsk] = useState(false);
  const [leaveAsk, setLeaveAsk] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [showCreatedIntro, setShowCreatedIntro] = useState(() => editable && sr.status === "DRAFT" && isJustCreated("ss", sr.id));
  React.useEffect(() => { if (showCreatedIntro) clearJustCreated("ss"); }, [showCreatedIntro]);

  /** 0 preparar · 1 aprobación · 2 autorización · 3 envío · 4 recepción · 5 completada. */
  const ssStep = ({ DRAFT: 0, SOLICITADA: 1, APROBADA: 2, AUTORIZADA: 3, IN_PROGRESS: 4, COMPLETED: 5 } as Record<string, number>)[sr.status]
    ?? (sr.status === "REJECTED" ? (sr.aprobadoAt ? 2 : 1) : 0);

  // Todo lo que hay que tener antes de enviarla a aprobar (guía, no bloqueo:
  // se puede "Enviar igual", como antes).
  const tallerOk = otroTaller ? !!form.tallerNotes.trim() : !!form.providerId;
  const prepChecks = [
    { key: "description", label: t("ss.guide.chip.description"), ok: !!form.description.trim() },
    { key: "causes",      label: t("ss.guide.chip.causes"),      ok: !!form.causes.trim() },
    { key: "provider",    label: t("ss.guide.chip.provider"),    ok: tallerOk },
    { key: "department",  label: t("ss.guide.chip.dept"),        ok: !!form.department },
    { key: "capitan",     label: t("ss.guide.field.capitan"),    ok: !!form.capitan.trim() },
    { key: "jefeMaq",     label: t("ss.guide.field.jefeMaq"),    ok: !!form.jefeMaq.trim() },
  ];
  const prepMissing = prepChecks.filter(c => !c.ok);
  const recvChecks = [
    { key: "item",     label: t("ss.guide.field.item"),     ok: !!form.recepcionItem.trim() },
    { key: "recibe",   label: t("ss.guide.field.recibe"),   ok: !!form.recibe.trim() },
    { key: "conforme", label: t("ss.guide.chip.conforme"),  ok: form.conforme !== null },
  ];
  const recvMissing = recvChecks.filter(c => !c.ok);
  const missingKeys = new Set(
    (editable && ssStep === 0 ? prepMissing : editable && ssStep === 4 ? recvMissing : []).map(c => c.key),
  );
  const FIELD_SECTION: Record<string, string> = {
    description: "what", causes: "what", provider: "shop", department: "shop",
    capitan: "signs", jefeMaq: "signs", item: "recv", recibe: "recv", conforme: "recv",
  };
  // Abiertos por defecto los bloques de la etapa en curso (y los del pedido
  // mientras se aprueba/autoriza: quien firma tiene que poder leerlo).
  const secOpen = (id: string) => openSecs[id] ?? (
    ["what", "shop", "signs"].includes(id) ? ssStep <= 2
    : id === "route" ? ssStep >= 3
    : ssStep >= 4
  );
  const toggleSec = (id: string) => setOpenSecs(prev => ({ ...prev, [id]: !secOpen(id) }));
  const goField = (key: string) => {
    setSsView("guided");
    const sec = FIELD_SECTION[key];
    if (sec) setOpenSecs(prev => ({ ...prev, [sec]: true }));
    window.setTimeout(() => {
      document.getElementById(`ss-field-${key}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      setFlashKey(key);
      window.setTimeout(() => setFlashKey(null), 1600);
    }, 80);
  };
  const field = (key: string, children: React.ReactNode) => (
    <GuideField id={`ss-field-${key}`} missing={missingKeys.has(key)} flash={flashKey === key}>{children}</GuideField>
  );
  const fieldLabel = (text: React.ReactNode, key?: string) => (
    <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">{text}{key && missingKeys.has(key) && <GuideNeedTag label={t("wo.guide.needTag")} />}</label>
  );
  const pill = (keys: string[]) => (
    <GuidePill missing={keys.filter(k => missingKeys.has(k)).length} completeLabel={t("wo.guide.complete")}
      missingOne={t("wo.guide.missingOne")} missingMany={t("wo.guide.missingMany")} />
  );
  const chip = (c: { key: string; label: string; ok: boolean }) => (
    <button key={c.key} type="button" onClick={() => goField(c.key)}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
        c.ok ? "border-success-sea/30 bg-success-sea/10 text-success-sea"
             : "border-amber-500 bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200 hover:bg-amber-200"
      }`}>
      {c.ok ? <Check className="w-3.5 h-3.5" /> : <CircleDashed className="w-3.5 h-3.5" />}
      {c.label}
    </button>
  );
  const segMany = (options: string[], selected: string[], onToggle: (v: string) => void) => (
    <div className="flex flex-wrap gap-1.5">
      {options.map(o => {
        const on = selected.includes(o);
        return (
          <button key={o} type="button" disabled={!editable} onClick={() => onToggle(o)}
            className={`px-3 py-1.5 rounded-lg border-[1.5px] text-xs font-semibold transition-colors disabled:opacity-60 ${
              on ? "bg-accent border-accent text-accent-fg" : "bg-surface border-fg/15 text-fg hover:border-accent/40"
            }`}>
            {o}
          </button>
        );
      })}
    </div>
  );
  const toggleIn = (list: string[], v: string) => list.includes(v) ? list.filter(x => x !== v) : [...list, v];

  const canSendToApprove = editable && sr.status === "DRAFT";
  const sendToApprove = () => {
    setLeaveAsk(false);
    if (prepMissing.length > 0) { setSendAsk(true); return; }
    openTramita("SOLICITA");
  };
  const handleCloseClick = () => {
    if (canSendToApprove) { setLeaveAsk(true); return; }
    requestClose();
  };

  const providerLabel = otroTaller
    ? form.tallerNotes
    : providers.find(p => p.id === form.providerId)?.name ?? "";
  const prepDone = prepChecks.length - prepMissing.length;
  const btnPrimary = "flex items-center gap-2 px-4 py-2.5 rounded-xl bg-accent text-accent-fg text-sm font-bold hover:brightness-110 disabled:opacity-50 transition-all";
  const btnSoft = "flex items-center gap-1.5 px-3 py-2 rounded-xl bg-fg/5 border border-fg/10 text-xs font-semibold text-fg hover:border-accent/30 disabled:opacity-40 transition-all";
  const btnGreen = "flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold bg-success-sea text-white hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition-all";
  const btnRed = "px-4 py-2.5 rounded-xl border text-sm font-bold bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30 hover:bg-red-500/20 disabled:opacity-40 transition-colors";
  const kicker = (icon: React.ReactNode, text: string, cls = "text-accent") => (
    <p className={`flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-widest ${cls}`}>{icon}{text}</p>
  );
  const cardCls = (ok: boolean) => `rounded-2xl border-[1.5px] p-4 space-y-2.5 ${ok ? "border-success-sea/40 bg-success-sea/5" : "border-accent/35 bg-accent/[0.05]"}`;

  const nextStepCard = sr.status === "DRAFT" ? (
    <div className={cardCls(prepMissing.length === 0)}>
      <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
        <span className="flex items-center gap-1.5 text-accent">
          <span className="w-5 h-5 rounded-full border-[1.5px] border-accent bg-accent/10 flex items-center justify-center text-[10px]">1</span>
          {t("ss.guide.flow.complete")}
        </span>
        <ArrowRight className="w-3.5 h-3.5 text-text-industrial/40" />
        <span className={`flex items-center gap-1.5 ${prepMissing.length === 0 ? "text-success-sea" : "text-text-industrial/50"}`}>
          <span className={`w-5 h-5 rounded-full border-[1.5px] flex items-center justify-center text-[10px] ${prepMissing.length === 0 ? "border-success-sea bg-success-sea text-white" : "border-fg/25"}`}>2</span>
          {t("wo.guide.flow.send")}
        </span>
      </div>
      <p className="text-[15px] font-extrabold text-fg">
        {prepMissing.length > 0 ? t("wo.guide.prep.titleMissing") : t("wo.guide.prep.titleReady")}
      </p>
      <div className="h-1.5 rounded-full bg-fg/10 overflow-hidden">
        <div className={`h-full rounded-full transition-all ${prepMissing.length === 0 ? "bg-success-sea" : "bg-accent"}`}
          style={{ width: `${(prepDone / prepChecks.length) * 100}%` }} />
      </div>
      <p className="text-xs text-text-industrial/60">
        {t("wo.guide.prep.progress").replace("{done}", String(prepDone)).replace("{total}", String(prepChecks.length))}
        {prepMissing.length > 0 && t("wo.guide.prep.progressHint")}
      </p>
      <div className="flex flex-wrap gap-1.5">{[...prepMissing, ...prepChecks.filter(c => c.ok)].map(chip)}</div>
      {canSendToApprove && (
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button type="button" onClick={sendToApprove} disabled={busy || saving} className={btnPrimary}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} {t("wo.guide.send")}
          </button>
          <span className="text-xs text-text-industrial/60">{t("wo.guide.sendHint")}</span>
        </div>
      )}
    </div>
  ) : sr.status === "SOLICITADA" ? (
    <div className={cardCls(false)}>
      {kicker(<Hourglass className="w-3 h-3" />, STATUS_LABELS.SOLICITADA)}
      <p className="text-[15px] font-extrabold text-fg">
        {t("wo.guide.approval.sentBy").replace("{name}", sr.solicitaByName ?? sr.createdByName ?? "—")}
      </p>
      <p className="text-xs text-text-industrial/60">{t("ss.guide.approval.who")}</p>
      <div className="flex flex-wrap gap-2 pt-1">
        {canApprove && (
          <button type="button" onClick={() => openTramita("APRUEBA")} disabled={busy} className={btnGreen}>
            <CheckCheck className="w-4 h-4" /> {t("wo.guide.approve")}
          </button>
        )}
        {(canApprove || canAuthorize) && (
          <button type="button" onClick={() => openTramita("RECHAZA")} disabled={busy} className={btnRed}>{t("ss.guide.reject")}</button>
        )}
        <button type="button" onClick={() => { runAct("unsubmit"); }} disabled={busy} className={btnSoft}>
          <Undo2 className="w-3.5 h-3.5" /> {t("ss.guide.backToDraft")}
        </button>
      </div>
    </div>
  ) : sr.status === "APROBADA" ? (
    <div className={cardCls(false)}>
      {kicker(<ShieldCheck className="w-3 h-3" />, t("ss.guide.auth.title"))}
      <p className="text-[15px] font-extrabold text-fg">
        {t("wo.guide.exec.approvedBy").replace("{name}", sr.aprobadoByName ?? "—")}
        {sr.aprobadoAt ? ` · ${fmtDate(sr.aprobadoAt)}` : ""}
      </p>
      <p className="text-xs text-text-industrial/60">{t("ss.guide.auth.who")}</p>
      <div className="flex flex-wrap gap-2 pt-1">
        {canAuthorize && (
          <button type="button" onClick={() => openTramita("AUTORIZA")} disabled={busy} className={btnGreen}>
            <ShieldCheck className="w-4 h-4" /> {t("wo.guide.authorize")}
          </button>
        )}
        {(canApprove || canAuthorize) && (
          <button type="button" onClick={() => openTramita("RECHAZA")} disabled={busy} className={btnRed}>{t("ss.guide.reject")}</button>
        )}
      </div>
    </div>
  ) : sr.status === "AUTORIZADA" ? (
    <div className={cardCls(!!providerLabel)}>
      {kicker(<Flag className="w-3 h-3" />, STATUS_LABELS.AUTORIZADA, providerLabel ? "text-success-sea" : "text-accent")}
      <p className="text-[15px] font-extrabold text-fg">{t("ss.guide.send.title")}</p>
      <p className="text-xs text-text-industrial/60">
        {providerLabel ? t("ss.guide.send.body").replace("{provider}", providerLabel) : t("ss.guide.send.noProvider")}
      </p>
      {!providerLabel && <div className="flex flex-wrap gap-1.5">{chip({ key: "provider", label: t("ss.guide.chip.provider"), ok: false })}</div>}
      <button type="button" onClick={() => { void sendToProvider({}); }} disabled={busy} className={btnPrimary}>
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} {t("ss.guide.sendProvider")}
      </button>
    </div>
  ) : sr.status === "IN_PROGRESS" ? (
    <div className={cardCls(recvMissing.length === 0)}>
      {kicker(<PackageCheck className="w-3 h-3" />, t("ss.guide.shop.kicker"), recvMissing.length === 0 ? "text-success-sea" : "text-accent")}
      <p className="text-[15px] font-extrabold text-fg">
        {recvMissing.length > 0 ? t("ss.guide.shop.titleMissing") : t("ss.guide.shop.titleReady")}
      </p>
      <p className="text-xs text-text-industrial/60">
        {recvMissing.length > 0 ? t("ss.guide.shop.missing").replace("{n}", String(recvMissing.length)) : t("ss.guide.shop.ready")}
      </p>
      {recvMissing.length > 0 && <div className="flex flex-wrap gap-1.5">{recvMissing.map(chip)}</div>}
      <button type="button" onClick={() => setReceiving(true)} disabled={busy || recvMissing.length > 0} className={btnGreen}>
        <PackageCheck className="w-4 h-4" /> {t("ss.guide.received")}
      </button>
    </div>
  ) : (
    <div className={`rounded-2xl border-[1.5px] p-4 space-y-1 ${sr.status === "REJECTED" ? "border-red-500/40 bg-red-500/[0.06]" : "border-fg/15 bg-fg/[0.03]"}`}>
      {kicker(<CheckCheck className="w-3 h-3" />,
        sr.status === "COMPLETED" ? t("ss.guide.done.title") : sr.status === "REJECTED" ? t("ss.guide.rejected.title") : t("ss.guide.cancelled.title"),
        sr.status === "COMPLETED" ? "text-success-sea" : sr.status === "REJECTED" ? "text-red-700 dark:text-red-400" : "text-text-industrial/60")}
      {sr.status === "REJECTED" && sr.rechazoReason && <p className="text-xs text-red-700 dark:text-red-300">{t("wo.guide.reason")}: {sr.rechazoReason}</p>}
      <p className="text-xs text-text-industrial/60">{t("wo.guide.closed.hint")}</p>
    </div>
  );

  const guidedBody = (
    <>
      {nextStepCard}

      <GuideStageLabel text={t("ss.guide.stage.prepare")} />

      <GuideSection n={1} title={t("ss.guide.sec.what")} subtitle={t("ss.guide.sec.whatSub")}
        pill={pill(["description", "causes"])} open={secOpen("what")} onToggle={() => toggleSec("what")}>
        {field("description", <>
          {fieldLabel(<>{t("ss.guide.field.description")} *</>, "description")}
          <AutoTextArea rows={2} value={form.description} disabled={!editable}
            onChange={e => patchForm({ description: e.target.value })}
            className={`${inputCls} resize-y`} placeholder={t("ss.guide.field.descriptionPh")} />
        </>)}
        {field("causes", <>
          {fieldLabel(<>{t("ss.guide.field.causes")} *</>, "causes")}
          <AutoTextArea rows={3} value={form.causes} disabled={!editable}
            onChange={e => patchForm({ causes: e.target.value })}
            className={`${inputCls} resize-y`} placeholder={t("ss.guide.field.causesPh")} />
        </>)}
        {sr.workOrder && (
          <div className="space-y-1.5">
            {fieldLabel(t("ss.guide.field.wo"))}
            <Link to={`/work-orders?autoCode=${sr.workOrder.workOrderCode}`}
              className="flex items-center gap-2 rounded-xl border border-fg/10 bg-fg/5 px-3 py-2 text-xs hover:border-accent/40 transition-colors">
              <span className="font-mono font-bold text-accent shrink-0">{sr.workOrder.workOrderCode}</span>
              <span className="flex-1 min-w-0 truncate text-fg">{sr.workOrder.title}{sr.workOrder.assetName ? ` · ${sr.workOrder.assetName}` : ""}</span>
              <ExternalLink className="w-3.5 h-3.5 text-accent shrink-0" />
            </Link>
          </div>
        )}
      </GuideSection>

      <GuideSection n={2} title={t("ss.guide.sec.shop")} subtitle={t("ss.guide.sec.shopSub")}
        pill={pill(["provider", "department"])} open={secOpen("shop")} onToggle={() => toggleSec("shop")}>
        {field("provider", <>
          {fieldLabel(<>{t("ss.guide.field.provider")} *</>, "provider")}
          <select className={inputCls} disabled={!editable}
            value={otroTaller ? OTRO_TALLER : form.providerId}
            onChange={e => {
              if (e.target.value === OTRO_TALLER) { setOtroTaller(true); patchForm({ providerId: "" }); return; }
              setOtroTaller(false);
              patchForm({ providerId: e.target.value, tallerNotes: "" });
            }}>
            <option value="">{t("ss.guide.field.providerPh")}</option>
            {providers.map(p => (
              <option key={p.id} value={p.id}>{p.name}{p.providerCode ? ` (${p.providerCode})` : ""}</option>
            ))}
            <option value={OTRO_TALLER}>{t("ss.guide.field.otherProvider")}</option>
          </select>
          {otroTaller && (
            <input className={inputCls} value={form.tallerNotes} disabled={!editable} autoFocus
              onChange={e => patchForm({ tallerNotes: e.target.value })} placeholder={t("ss.guide.field.otherProviderPh")} />
          )}
        </>)}
        {field("department", <>
          {fieldLabel(<>{t("ss.guide.field.dept")} *</>, "department")}
          <div className="flex flex-wrap gap-1.5">
            {doc.config.departments.map(d => {
              const on = form.department === d;
              return (
                <button key={d} type="button" disabled={!editable}
                  onClick={() => patchForm({ department: on ? "" : d })}
                  className={`px-3 py-1.5 rounded-lg border-[1.5px] text-xs font-semibold transition-colors disabled:opacity-60 ${
                    on ? "bg-accent border-accent text-accent-fg" : "bg-surface border-fg/15 text-fg hover:border-accent/40"
                  }`}>
                  {ssDepartmentLabel(d)}
                </button>
              );
            })}
          </div>
        </>)}
        <div className="space-y-1.5">
          {fieldLabel(t("ss.guide.field.purchase"))}
          {segMany(doc.config.purchaseRequest, form.compras, v => patchForm({ compras: toggleIn(form.compras, v) }))}
        </div>
        {labSamples && labSamples.items.length > 0 && (
          <LabSamplesPanel srId={sr.id} data={labSamples} editable={editable} vesselCode={sr.vesselCode} onChanged={reloadLabSamples} />
        )}
      </GuideSection>

      <GuideSection n={3} title={t("ss.guide.sec.signs")} subtitle={t("ss.guide.sec.signsSub")}
        pill={pill(["capitan", "jefeMaq"])} open={secOpen("signs")} onToggle={() => toggleSec("signs")}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
          {field("capitan", <>
            {fieldLabel(<>{t("ss.guide.field.capitan")} *</>, "capitan")}
            <input className={inputCls} value={form.capitan} disabled={!editable}
              onChange={e => patchForm({ capitan: e.target.value })} placeholder="Ej. CAP. WILLIAM RIQUELME" />
          </>)}
          {field("jefeMaq", <>
            {fieldLabel(<>{t("ss.guide.field.jefeMaq")} *</>, "jefeMaq")}
            <input className={inputCls} value={form.jefeMaq} disabled={!editable}
              onChange={e => patchForm({ jefeMaq: e.target.value })} placeholder="Ej. J.M. CRISTHIAN VERON" />
          </>)}
        </div>
        <p className="text-[11px] text-text-industrial/50">{t("ss.guide.field.signHint")}</p>
        <div className="space-y-1.5">
          {fieldLabel(t("ss.guide.field.comm"))}
          {segMany(doc.config.communicationMethods, form.comunicacion, v => patchForm({ comunicacion: toggleIn(form.comunicacion, v) }))}
        </div>
        <div className="space-y-1.5">
          {fieldLabel(t("ss.guide.field.distribution"))}
          {segMany(doc.config.distribution, form.distribucion, v => patchForm({ distribucion: toggleIn(form.distribucion, v) }))}
        </div>
        <div className="space-y-1.5">
          {fieldLabel(t("ss.guide.field.comments"))}
          <AutoTextArea rows={2} value={form.observations} disabled={!editable}
            onChange={e => patchForm({ observations: e.target.value })}
            className={`${inputCls} resize-y`} placeholder={t("ss.guide.field.commentsPh")} />
        </div>
      </GuideSection>

      <GuideStageLabel text={t("ss.guide.step.send")} lockedHint={ssStep < 3 ? t("ss.guide.stage.lockedShop") : null} />

      <GuideSection n={4} title={t("ss.guide.sec.route")} subtitle={t("ss.guide.sec.routeSub")}
        open={secOpen("route")} onToggle={() => toggleSec("route")}
        locked={ssStep < 3} lockedLabel={t("wo.guide.locked")} lockedText={t("ss.guide.lockedShop")}>
        <HojaRutaBox srId={sr.id} editable={editable} isAdmin={isAdmin} />
      </GuideSection>

      <GuideStageLabel text={t("ss.guide.step.reception")} lockedHint={ssStep < 4 ? t("ss.guide.stage.lockedRecv") : null} />

      <GuideSection n={5} title={t("ss.guide.sec.recv")} subtitle={t("ss.guide.sec.recvSub")}
        pill={editable && ssStep === 4 ? pill(["item", "recibe", "conforme"]) : undefined}
        open={secOpen("recv")} onToggle={() => toggleSec("recv")}
        locked={ssStep < 4} lockedLabel={t("wo.guide.locked")} lockedText={t("ss.guide.lockedRecv")}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
          {field("item", <>
            {fieldLabel(<>{t("ss.guide.field.item")} *</>, "item")}
            <input className={inputCls} value={form.recepcionItem} disabled={!editable}
              onChange={e => patchForm({ recepcionItem: e.target.value })} placeholder={t("ss.guide.field.itemPh")} />
          </>)}
          {field("recibe", <>
            {fieldLabel(<>{t("ss.guide.field.recibe")} *</>, "recibe")}
            <input className={inputCls} value={form.recibe} disabled={!editable}
              onChange={e => patchForm({ recibe: e.target.value })} placeholder={t("ss.guide.field.recibePh")} />
          </>)}
        </div>
        {field("conforme", <>
          {fieldLabel(<>{t("ss.guide.field.conforme")} *</>, "conforme")}
          <div className="flex gap-2">
            {([[true, t("ss.guide.field.conformeYes"), "bg-success-sea/10 text-success-sea border-success-sea/40"],
               [false, t("ss.guide.field.conformeNo"), "bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/40"]] as const).map(([val, label, cls]) => (
              <button key={String(val)} type="button" disabled={!editable}
                onClick={() => patchForm({ conforme: form.conforme === val ? null : val })}
                className={`flex-1 py-2.5 rounded-xl border-[1.5px] text-sm font-bold transition-all disabled:opacity-50 ${form.conforme === val ? cls : "bg-surface text-text-industrial/60 border-fg/15 hover:border-fg/30"}`}>
                {label}
              </button>
            ))}
          </div>
        </>)}
      </GuideSection>
    </>
  );

  // El clic fuera de la ventana NO cierra: el formulario es largo y se completa
  // por partes, cerrarlo sin querer costaba rehacer la carga. Se cierra solo con
  // la X o Escape (que sí avisan si hay cambios sin guardar). Por eso el div de
  // fondo no tiene onClick.
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden rounded-2xl bg-bg border border-fg/10" onClick={e => e.stopPropagation()}>
        <div className={`shrink-0 px-6 pt-4 pb-3 bg-bg border-b border-fg/10 ${recordHeaderClass("serviceRequest")}`}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              {/* Identidad del registro: la OT y la SS son la misma hoja de
                  documento controlado. Ver lib/record-identity.tsx. */}
              <Handshake className={`w-4 h-4 shrink-0 ${RECORD_IDENTITY.serviceRequest.text}`} />
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t("ss.entityLabel")}</p>
                <p className="flex items-baseline gap-1.5 min-w-0">
                  <span className={`font-mono text-sm font-bold shrink-0 ${RECORD_IDENTITY.serviceRequest.text}`}>{sr.serviceRequestCode}</span>
                  {sr.workOrder?.assetName && <span className="text-sm text-text-industrial/70 truncate">· {sr.workOrder.assetName}</span>}
                </p>
                {/* Sigue al campo mientras se tipea: el encabezado y la DESCRIPCIÓN
                    DEL SERVICIO son el mismo dato. */}
                <p className="text-xs text-text-industrial/60 truncate">{form.description || sr.title || "—"}</p>
              </div>
              <span className={`shrink-0 px-2 py-0.5 rounded-lg border text-[10px] font-bold ${STATUS_COLORS[sr.status] ?? STATUS_COLORS.DRAFT}`}>
                {STATUS_LABELS[sr.status] ?? sr.status}
              </span>
            </div>
            <ModalCloseButton onClose={handleCloseClick} />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="inline-flex items-center gap-1.5 mt-2.5 rounded-full border border-accent/25 bg-accent/5 px-2.5 py-1 text-[11px] text-fg">
              <Ship className="w-3 h-3" /><b className="font-bold">{vesselName}</b>
            </span>
            <WizardStepper
              labels={[t("ss.guide.step.prepare"), t("ss.guide.step.approval"), t("ss.guide.step.authorization"), t("ss.guide.step.send"), t("ss.guide.step.reception")]}
              current={ssStep}
            />
            <div className="ml-auto mt-2.5 flex rounded-lg border border-fg/10 bg-fg/5 p-0.5">
              {([["guided", t("wo.guide.view.guided"), ListChecks], ["paper", `${t("wo.guide.view.paper")} ${doc.meta.formCode}`, FileText]] as const).map(([v, label, Icon]) => (
                <button key={v} type="button" onClick={() => setSsView(v)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold transition-colors ${ssView === v ? "bg-surface text-fg shadow-sm" : "text-text-industrial/60 hover:text-fg"}`}>
                  <Icon className="w-3.5 h-3.5" /> {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3.5">
          {ssView === "guided" ? guidedBody : (
            <>
              <p className="text-xs text-text-industrial/60 text-center">{t("ss.guide.paperNote")}</p>
          <SsPaperForm
            meta={doc.meta}
            config={doc.config}
            logoUrl={formLogo}
            tenantName={tenant?.name ?? ""}
            code={sr.serviceRequestCode}
            vesselName={vesselName}
            openDate={sr.openDate}
            assetName={sr.workOrder?.assetName ?? null}
            workOrder={sr.workOrder ? { workOrderCode: sr.workOrder.workOrderCode, title: sr.workOrder.title } : null}
            workOrderLink={sr.workOrder ? (
              <Link
                to={`/work-orders?autoCode=${sr.workOrder.workOrderCode}`}
                className="flex items-center gap-2 min-w-0 hover:underline"
                title="Abrir la OT de origen"
              >
                <span className="font-mono text-[12px] font-bold text-accent shrink-0">{sr.workOrder.workOrderCode}</span>
                <span className="truncate text-text-industrial">{sr.workOrder.title}</span>
                <ExternalLink className="w-3 h-3 text-accent shrink-0" />
              </Link>
            ) : undefined}
            values={form}
            onChange={patchForm}
            editable={editable}
            providers={providers}
            otroTaller={otroTaller}
            onOtroTaller={setOtroTaller}
            hojaRuta={<HojaRutaBox srId={sr.id} editable={editable} isAdmin={isAdmin} />}
            tramitacion={
              /* Una columna por paso, como el bloque de firmas del papel. La
                 fecha la estampa el paso real; el admin sólo corrige QUIÉN firmó
                 (y sólo sobre un paso ya cumplido). El rechazo se marca en rojo
                 sobre la columna que lo frenó. */
              TRAMITA_STEPS.map(step => {
                const c = {
                  // Mismo criterio que el PDF: el nombre corregido gana; si no,
                  // el de quien la creó.
                  SOLICITA: { name: sr.solicitaByName ?? sr.createdByName ?? null, at: sr.openDate, done: solicitaDone, value: firmaSolicita, set: setFirmaSolicita },
                  APRUEBA:  { name: sr.aprobadoByName, at: sr.aprobadoAt, done: apruebaDone, value: firmaAprueba, set: setFirmaAprueba },
                  AUTORIZA: { name: sr.autorizadoByName, at: sr.autorizadoAt, done: autorizaDone, value: firmaAutoriza, set: setFirmaAutoriza },
                }[step];
                // Sólo SOLICITA lleva firma estampada. APRUEBA y AUTORIZA van en
                // blanco por decisión del cliente (ago 2026): esas dos se firman
                // a mano sobre el impreso, y la pantalla muestra lo mismo que el
                // papel. Quién aprobó y autorizó igual queda registrado en el
                // nombre, la fecha y la hoja de ruta.
                const firma = step === "SOLICITA" ? firmas?.solicita : null;
                return (
                  <SsSignColumn key={step} rol={step} at={c.at} rejected={rechazadaEn === step} signatureUrl={firma}>
                    {puedeCorregirFirmas && c.done ? (
                      <SignerSelect value={c.value} onChange={c.set}
                        options={eligibleSigners(team, step, sr.vesselCode, roleHas)} />
                    ) : (
                      <p className="text-[11px] text-fg text-center truncate">{c.name || ""}</p>
                    )}
                  </SsSignColumn>
                );
              })
            }
          />

          {/* Muestras que viajan con el pedido. Va fuera del formulario de papel
              a propósito: REGI-MAN-02.4 no tiene este bloque, y es información
              de seguimiento del envío, no parte del documento que se firma. */}
          {labSamples && labSamples.items.length > 0 && (
            <div className="mt-3">
              <LabSamplesPanel
                srId={sr.id}
                data={labSamples}
                editable={editable}
                vesselCode={sr.vesselCode}
                onChanged={reloadLabSamples}
              />
            </div>
          )}

          {puedeCorregirFirmas && (
            <p className="mt-2 text-[10px] text-text-industrial/40 italic">
              Corrección administrativa: cambiar el nombre de la tramitación no aprueba ni autoriza la
              solicitud, sólo deja asentado quién firmó el formulario. Los pasos que todavía no se
              cumplieron no se editan.
            </p>
          )}

          {sr.status === "REJECTED" && sr.rechazoReason && (
            <p className="mt-2 text-[11px] text-red-600 dark:text-red-400">Rechazada: {sr.rechazoReason}</p>
          )}

          {!canAuthorize && sr.status === "APROBADA" && (
            <p className="mt-2 text-[11px] text-text-industrial/50 italic">
              Sólo el DPA / Director de Operaciones puede autorizar esta solicitud.
            </p>
          )}
            </>
          )}
        </div>

        <div className="shrink-0 flex flex-wrap items-center gap-2 px-6 py-3.5 border-t border-fg/10">
          <button onClick={() => { void printServiceRequest(sr); }} className={btnSoft}>
            <FileDown className="w-3.5 h-3.5" /> PDF
          </button>
          {/* Copia editable en Word. El PDF sigue siendo el documento oficial:
              esto es para retocar el pedido antes de mandárselo al taller. */}
          <button onClick={() => { void descargarWord(); }} disabled={bajandoWord} className={btnSoft}>
            {bajandoWord ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />} Word
          </button>
          {(sr.status === "DRAFT" || editable) && (
            <div className="relative">
              <button type="button" onClick={() => setMoreOpen(v => !v)} className={btnSoft}>
                <MoreHorizontal className="w-3.5 h-3.5" /> {t("wo.guide.more")}
              </button>
              {moreOpen && (
                <div className="absolute bottom-full left-0 mb-2 min-w-[13rem] rounded-xl border border-fg/10 bg-surface dark:bg-[#0D1B2A] shadow-xl p-1.5 z-10">
                  {/* Eliminar sólo existe en borrador; después, lo que corresponde
                      es cancelar (deja el antecedente con su motivo). */}
                  {sr.status === "DRAFT" && (
                    <button type="button" onClick={() => { setMoreOpen(false); setDeleting(true); }} disabled={busy}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-red-700 dark:text-red-400 hover:bg-fg/5 disabled:opacity-40">
                      <Trash2 className="w-3.5 h-3.5" /> {t("ss.guide.deleteDraft")}
                    </button>
                  )}
                  {editable && (
                    <button type="button" onClick={() => { setMoreOpen(false); setCancelling(true); }} disabled={busy}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-red-700 dark:text-red-400 hover:bg-fg/5 disabled:opacity-40">
                      <Ban className="w-3.5 h-3.5" /> {t("ss.guide.cancelSs")}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          <span className="flex-1" />
          {editable && (
            <span className="text-[11px] font-bold" aria-live="polite">
              {dirty
                ? <span className="text-amber-700 dark:text-amber-400">{t("ss.guide.unsaved")}</span>
                : <span className="flex items-center gap-1 text-success-sea"><CheckCheck className="w-3.5 h-3.5" />{t("wo.guide.saved")}</span>}
            </span>
          )}
          {editable && (
            <button onClick={() => { void save().then(saved => { if (saved) offerPdfAfterSave(saved); }); }} disabled={saving || !dirty}
              className={canSendToApprove ? btnSoft : "flex items-center gap-1.5 px-4 py-2 rounded-xl bg-accent text-accent-fg text-xs font-bold hover:brightness-110 disabled:opacity-40"}>
              <Save className="w-3.5 h-3.5" /> {saving ? t("wo.guide.saving") : t("common.save")}
            </button>
          )}
          {canSendToApprove && (
            <button type="button" onClick={sendToApprove} disabled={busy || saving} className={btnPrimary}>
              <Send className="w-4 h-4" /> {t("wo.guide.send")}
              {prepMissing.length > 0 && <span className="text-[10px] font-semibold opacity-85">({prepDone}/{prepChecks.length})</span>}
            </button>
          )}
        </div>
      </div>

      {/* ── Vista guiada: avisos ── */}
      {actionError && <AlertDialog message={actionError} onClose={() => setActionError(null)} />}

      {showCreatedIntro && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl p-6 space-y-4" role="dialog" aria-modal="true">
            <div className="flex items-center gap-3">
              <span className="w-12 h-12 rounded-full bg-success-sea/15 flex items-center justify-center shrink-0">
                <Check className="w-6 h-6 text-success-sea" strokeWidth={3} />
              </span>
              <div className="min-w-0">
                <h2 className="text-base font-extrabold text-fg">{t("ss.guide.created.title")}</h2>
                <p className="text-xs text-text-industrial/60 mt-0.5 truncate">
                  <span className="font-mono font-bold text-accent">{sr.serviceRequestCode}</span>
                  {providerLabel ? ` · ${providerLabel}` : ""}
                  {sr.workOrder ? ` · ${sr.workOrder.workOrderCode}` : ""}
                </p>
              </div>
            </div>
            <p className="text-sm text-fg">{t("wo.guide.created.lead")}</p>
            <ol className="space-y-3">
              {([
                [1, t("ss.guide.created.step1"), t("ss.guide.created.step1Hint"), "border-accent bg-accent/10 text-accent"],
                [2, t("wo.guide.created.step2"), t("wo.guide.created.step2Hint"), "border-fg/25 text-text-industrial/70"],
              ] as const).map(([n, head, hint, dotCls]) => (
                <li key={n} className="flex items-start gap-2.5 text-sm">
                  <span className={`w-6 h-6 rounded-full border-[1.5px] flex items-center justify-center text-[11px] font-extrabold shrink-0 ${dotCls}`}>{n}</span>
                  <span><b className="text-fg">{head}</b><span className="block text-xs text-text-industrial/60">{hint}</span></span>
                </li>
              ))}
              <li className="flex items-start gap-2.5 text-sm text-text-industrial/50">
                <span className="w-6 h-6 rounded-full border-[1.5px] border-dashed border-fg/25 flex items-center justify-center text-[11px] font-extrabold shrink-0">3</span>
                <span>{t("ss.guide.created.step3")}</span>
              </li>
            </ol>
            <div className="flex justify-end">
              <button type="button" autoFocus onClick={() => setShowCreatedIntro(false)} className={btnPrimary}>
                {t("ss.guide.created.go")} <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {sendAsk && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl p-5 space-y-3" role="alertdialog" aria-modal="true">
            <h2 className="flex items-center gap-2 text-sm font-bold text-fg">
              <AlertTriangle className="w-4 h-4 text-amber-600" /> {t("wo.guide.sendAsk.title")}
            </h2>
            <p className="text-sm text-text-industrial/80">
              {t("wo.guide.sendAsk.body").replace("{list}", prepMissing.map(c => c.label).join(", "))}
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => { setSendAsk(false); openTramita("SOLICITA"); }}
                className="px-3.5 py-2 rounded-xl text-xs text-fg hover:bg-fg/5">
                {t("wo.guide.sendAnyway")}
              </button>
              <button type="button" autoFocus onClick={() => { setSendAsk(false); if (prepMissing[0]) goField(prepMissing[0].key); }} className={btnPrimary}>
                {t("wo.guide.completeMissing")}
              </button>
            </div>
          </div>
        </div>
      )}

      {leaveAsk && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl p-5 space-y-3" role="alertdialog" aria-modal="true">
            <h2 className="flex items-center gap-2 text-sm font-bold text-fg">
              <AlertTriangle className="w-4 h-4 text-amber-600" /> {t("wo.guide.leave.title")}
            </h2>
            <p className="text-sm text-text-industrial/80">{t("ss.guide.leave.body")}</p>
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => { setLeaveAsk(false); requestClose(); }}
                className="px-3.5 py-2 rounded-xl text-xs text-fg hover:bg-fg/5">
                {t("wo.guide.leave.exit")}
              </button>
              <button type="button" autoFocus onClick={sendToApprove} className={btnPrimary}>
                <Send className="w-4 h-4" /> {t("wo.guide.leave.send")}
              </button>
            </div>
          </div>
        </div>
      )}

      {receiving && (
        <ReceiveServiceModal
          busy={busy}
          initial={{ recibe: form.recibe, item: form.recepcionItem, conforme: form.conforme }}
          onClose={() => setReceiving(false)}
          onConfirm={async v => { await act("complete", v); setReceiving(false); }}
        />
      )}
      {cancelling && (
        <CancelServiceRequestModal
          code={sr.serviceRequestCode}
          busy={busy}
          onClose={() => setCancelling(false)}
          onConfirm={async reason => { await act("cancel", { reason }); setCancelling(false); }}
        />
      )}
      {deleting && (
        <DeleteServiceRequestModal
          code={sr.serviceRequestCode}
          busy={busy}
          onClose={() => setDeleting(false)}
          onConfirm={async () => { await removeDraft(); setDeleting(false); }}
        />
      )}
      {tramita && (
        <SsApprovalModal
          sr={sr}
          step={tramita}
          role={role}
          onClose={() => setTramita(null)}
          onDone={() => {
            if (tramita === "SOLICITA") onSentToApprove?.(sr.serviceRequestCode);
            setTramita(null);
            onChanged();
          }}
        />
      )}
      {/* Faltan números de muestra: se avisa antes de despachar el envío. No es
          un bloqueo sin salida — el laboratorio a veces numera al recibir — pero
          seguir sin los números queda asentado en la hoja de ruta. */}
      {numbersWarning !== null && (
        <FormModal
          title={t("ss.labSamples.blockTitle")}
          subtitle={sr.serviceRequestCode}
          onClose={() => setNumbersWarning(null)}
          footer={
            <>
              <button type="button" onClick={() => setNumbersWarning(null)}
                className="px-3 py-1.5 rounded-lg bg-accent text-accent-fg text-[11px] font-bold">
                {t("ss.labSamples.blockComplete")}
              </button>
              <button type="button" disabled={busy}
                onClick={() => {
                  setNumbersWarning(null);
                  void sendToProvider({ acknowledgeMissingSampleNumbers: true });
                }}
                className="px-3 py-1.5 rounded-lg bg-fg/5 border border-fg/10 text-[11px] font-bold text-text-industrial/70 hover:border-amber-500/40 disabled:opacity-50">
                {t("ss.labSamples.blockSend")}
              </button>
            </>
          }
        >
          <p className="text-sm text-text-industrial">
            {t("ss.labSamples.blockBody").replace("{n}", String(numbersWarning))}
          </p>
        </FormModal>
      )}
      {sentNotice && (
        <FormModal
          title="Solicitud enviada a proveedor"
          subtitle={sr.serviceRequestCode}
          onClose={() => { setSentNotice(null); onChanged(); }}
          footer={
            <button type="button" onClick={() => { setSentNotice(null); onChanged(); }}
              className="px-3 py-1.5 rounded-lg bg-accent text-accent-fg text-[11px] font-bold">
              Entendido
            </button>
          }
        >
          {sentNotice.mailedTo ? (
            <>
              <p className="text-sm text-text-industrial">
                El correo salió a <span className="font-semibold">{sentNotice.mailedTo}</span> con el
                formulario en PDF adjunto. La solicitud quedó en ejecución.
              </p>
              {(sentNotice.cc?.length ?? 0) > 0 && (
                <p className="text-[11px] text-text-industrial/60">
                  Con copia a <span className="font-semibold">{sentNotice.cc!.join(", ")}</span>.
                </p>
              )}
              {sentNotice.fellBack && (
                <p className="text-[11px] text-amber-700 dark:text-amber-400">
                  El proveedor no tiene correo cargado en su ficha: salió a la casilla interna.
                </p>
              )}
              <p className="text-[11px] text-text-industrial/50">
                Queda asentado en la hoja de ruta del pedido.
              </p>
            </>
          ) : (
            <>
              <p className="text-sm text-text-industrial">
                El documento Word (.docx) ya se descargó y se abrió un correo a{" "}
                <span className="font-semibold">{PROVIDER_EMAIL}</span> con el asunto y el mensaje completos.
              </p>
              <p className="text-[11px] text-text-industrial/50">
                Adjuntá el .docx descargado antes de enviarlo — el correo se abre sin el archivo adjunto.
                (El sistema todavía no tiene casilla de correo propia configurada.)
              </p>
            </>
          )}
        </FormModal>
      )}
    </div>
  );
}

/**
 * Nombre de un paso de la tramitacion, dentro de su columna de firma del papel.
 * Sólo lo ve el admin y sólo sobre un paso YA CUMPLIDO (ver `done` en el modal).
 *
 * Es un desplegable, no texto libre: el que figura firmando tiene que ser
 * alguien del equipo habilitado para ese paso. Si el nombre guardado no está
 * entre los elegibles (cargó una SS de papel, o esa persona ya no está en la
 * empresa) se conserva como opción propia para no borrarlo sin querer.
 *
 * La FECHA no se edita a propósito: la estampa el paso real
 * (Solicitar / Aprobar / Autorizar), no se escribe a mano acá.
 */
function SignerSelect({ value, onChange, options }: {
  /** Nombre y usuario van juntos: el usuario es el que le da la firma al PDF. */
  value: { name: string; userId: string };
  onChange: (v: { name: string; userId: string }) => void;
  options: TeamMember[];
}) {
  // El select se maneja por userId, no por nombre: dos personas pueden llamarse
  // igual, y el nombre suelto no alcanza para saber de quién es la firma.
  const HUERFANO = "__HUERFANO__";
  const t = useT();
  const enLista = options.some(m => m.userId === value.userId);
  const huerfano = !enLista && value.name ? value.name : null;
  return (
    <PersonSelect
      className="w-full bg-transparent text-[11px] text-fg outline-none"
      value={enLista ? value.userId : (huerfano ? HUERFANO : "")}
      onChange={uid => {
        if (uid === HUERFANO) return; // no se re-elige: es el nombre que ya estaba
        const m = options.find(x => x.userId === uid);
        onChange(m ? { name: memberLabel(m), userId: m.userId } : { name: "", userId: "" });
      }}
      emptyLabel={t("person.unassigned")}
      options={[
        // Nombre viejo sin usuario (SS de papel, o alguien que ya no está en la
        // empresa). Se ofrece para no borrarlo sin querer, pero el PDF no le
        // pone firma: no hay a quién buscársela.
        ...(huerfano ? [{ value: HUERFANO, name: huerfano, note: t("person.noSignature") }] : []),
        ...options.map(m => ({
          value: m.userId, name: memberLabel(m), role: m.role, jobTitle: m.jobTitle,
          note: m.hasSignature ? null : t("person.noSignature"),
        })),
      ]}
    />
  );
}
