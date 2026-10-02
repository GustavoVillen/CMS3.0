// APROBACIONES — la bandeja de firmas con el formato de la Planilla a Bordo.
//
// Existe porque firmar de a una, abriendo la ficha de cada OT, es el cuello de
// botella de la superintendencia: la tanda semanal son decenas de registros y
// todos se resuelven con el mismo gesto. Acá cada fila trae los dos botones
// (Aprobar / Autorizar) y se firma sin salir de la lista.
//
// Las OT autorizadas se quedan en la bandeja hasta cerrarse (Preview V2): a la
// derecha van AVANCES, REPUESTOS y CERRAR OT, que abren las mismas ventanas del
// resto del sistema — la lista de avances de la ficha, el consumo de repuestos
// del Tablero y la ficha completa de la OT parada en el cierre.
//
// Las SS autorizadas se quedan hasta recibirse: su "avance" es la HOJA DE RUTA
// del pedido, su paso siguiente es ENVIAR AL PROVEEDOR, por el mismo camino que
// la ficha de la SS (correo con el PDF; sin casilla, envío a mano), y al volver
// el trabajo, CERRAR SS: la ficha de la SS parada en la recepción.
//
// Reglas del sistema que la pantalla respeta y NO reimplementa:
//   · el orden lo impone el backend — enviada → aprobada → autorizada;
//   · aprobar y autorizar son permisos distintos (y las SS tienen los suyos):
//     `can` viene del servidor y sólo decide qué botón se muestra encendido;
//   · no existe "des-aprobar". Una vez verde el botón queda fijo; revertir es
//     RECHAZAR, que borra las tres firmas, y eso se sigue haciendo desde la
//     ficha de la OT donde hay que escribir el motivo.
//
// Todo lo que decide lo resuelve el backend en
// `POST /app/pms/work-orders/:id/approval` y en los approve/authorize de la SS.
// Acá no hay reglas de negocio propias y no debería agregarse ninguna.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AlertTriangle, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, ClipboardCheck, Hammer, Handshake, ListTree, Loader2, Pause, Pencil, Search, X } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { AlertDialog } from "../components/AlertDialog";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ModalCloseButton } from "../components/ModalCloseButton";
import { SpareConsumptionModal } from "../components/work-orders/SpareConsumptionFlow";
import { HojaRutaBox } from "../components/service-requests/HojaRutaBox";
import { api, ApiError } from "../lib/api";
import { downloadDocx } from "../lib/download-docx";
import { useFetch } from "../lib/hooks";
import { useAuth } from "../lib/auth";
import { useT, type TranslationKey } from "../lib/i18n";
import { textMatches } from "../lib/text-search";

// La ficha de la OT y la lista de avances viven en la página de OT, que es
// pesada: se bajan recién cuando se toca el botón.
const WorkOrderPopup = React.lazy(() => import("./WorkOrders").then(m => ({ default: m.WorkOrderPopup })));
const WorkOrderProgressModal = React.lazy(() => import("./WorkOrders").then(m => ({ default: m.WorkOrderProgressModal })));
const WorkOrderPermitsModal = React.lazy(() => import("./WorkOrders").then(m => ({ default: m.WorkOrderPermitsModal })));
const ServiceRequestPopup = React.lazy(() => import("./ServiceRequests").then(m => ({ default: m.ServiceRequestPopup })));

// ─── Espejo de approvals-service.ts ──────────────────────────────────────────

interface PendingItem {
  kind: "WO" | "SR";
  id: string;
  code: string;
  vesselCode: string;
  vesselName: string | null;
  assetName: string | null;
  assetId?: string | null;
  title: string | null;
  task: string | null;
  priority: string | null;
  department: string | null;
  status: string;
  dueDate: string | null;
  providers: string[];
  requestedByName: string | null;
  requestedAt: string | null;
  serviceRequestCount: number;
  workOrderCode: string | null;
  /** Sólo las OT autorizadas (woExecute). */
  authorizedByName?: string | null;
  authorizedAt?: string | null;
  progressNoteCount?: number;
  spareUsageCount?: number;
  /** Sólo las SS autorizadas (srExecute): cuándo se mandó al proveedor. */
  sentAt?: string | null;
  /** SS ya recibida (cerrada) cuya OT sigue abierta: sigue en la lista, en gris. */
  receivedAt?: string | null;
  receptionConform?: boolean | null;
  /** Sólo las SS autorizadas: novedades asentadas en su hoja de ruta. */
  routeEntryCount?: number;
  /** Sólo las OT autorizadas: permisos de trabajo vinculados. */
  permitCount?: number;
  /** Grupo SFI (filtro G0…G9). La SS trae el de su OT. */
  sfiGroupNumber?: number | null;
}

interface PendingApprovals {
  can: {
    woApprove: boolean; woAuthorize: boolean; srApprove: boolean; srAuthorize: boolean;
    woOperate: boolean; woManage: boolean; srManage: boolean;
  };
  woApprove: PendingItem[];
  woAuthorize: PendingItem[];
  srApprove: PendingItem[];
  srAuthorize: PendingItem[];
  woExecute: PendingItem[];
  srExecute: PendingItem[];
}

/** Firma hecha en esta pantalla, para dejar la fila en verde sin recargar. */
interface Signed { by: string; at: string }

/** Una fila de la planilla: el registro + en qué paso está. */
interface Row extends PendingItem {
  /** De qué bandeja vino: `approve` = falta aprobar, `authorize` = ya aprobada,
   *  `execute` = autorizada y todavía abierta (OT) o sin recibir (SS). */
  stage: "approve" | "authorize" | "execute";
}

/** La ventana abierta desde las columnas de ejecución. */
type ExecWindow = { kind: "progress" | "permits" | "spares" | "close" | "route" | "closeSr" | "record" | "recordSr"; row: Row };

/** Tarjeta de arriba que filtra la planilla. */
type CardKey = "overdue" | "mine" | "woInProgress" | "srInProgress" | "postponed";

/** Respuesta de POST /service-requests/:id/send-to-provider. */
interface SendResult { sent: boolean; to: string[]; reason?: string; error?: string }

const rowKey = (r: { kind: string; id: string }) => `${r.kind}:${r.id}`;

/** Clave del grupo de equipo (buque + equipo) para plegarlo. */
const assetKey = (r: { vesselName: string | null; vesselCode: string; assetName: string | null }) =>
  `${r.vesselName ?? r.vesselCode}|${r.assetName ?? ""}`;

/** Botones G0…G9: primer dígito del grupo SFI (G6 = 6 o 600-699), como en Planes. */
const SFI_DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
function sfiDigit(n: number | null | undefined): number | null {
  if (n == null) return null;
  const d = n < 10 ? n : Math.floor(n / 100);
  return d >= 0 && d <= 9 ? d : null;
}

const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
};

/**
 * La descripción de la OT viene con los corchetes de los ítems de checklist
 * (`[ ] Tomar muestras · [ ] Verificar...`). En el globito eso es ruido: se
 * limpian y se separa con puntos, para que la línea se lea de corrido.
 */
/**
 * Lo que dice la fila. En la SS manda la DESCRIPCIÓN del servicio, igual que en
 * la ficha de la SS y en la OT: el título se copia al crearla y queda fijo, así
 * que una corrección posterior no se veía acá. En la OT, su título.
 */
function headlineOf(r: { kind: "WO" | "SR"; title: string | null; task: string | null }): string {
  return r.kind === "SR"
    ? (cleanDetail(r.task) || r.title || "—")
    : (r.title ?? (cleanDetail(r.task) || "—"));
}

function cleanDetail(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .replace(/\[\s*\]/g, " · ")
    .replace(/\s*·\s*(·\s*)+/g, " · ")
    .replace(/\s+/g, " ")
    .replace(/^\s*·\s*/, "")
    .trim();
}

/** Días hasta el vencimiento, contra el inicio del día de hoy (mismo criterio
 *  que la Planilla: una tarea que vence hoy no está vencida). */
function daysToDue(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  const t0 = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const d0 = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.round((d0 - t0) / 86_400_000);
}

/** Molde común de todos los botones de la fila. */
const BTN_BASE = "w-full min-h-[34px] px-1.5 py-0.5 rounded-lg border-[1.5px] text-[10.5px] font-extrabold leading-tight flex flex-col items-center justify-center transition-all";
const BTN_ON   = `${BTN_BASE} bg-surface border-accent text-accent hover:bg-accent hover:text-accent-fg disabled:opacity-50`;
const BTN_DONE = `${BTN_BASE} bg-success/90 border-success text-white`;
/** Paso firmado de una OT / SS ya cerrada: gris, se ve pero ya no se toca. */
const BTN_LOCKED = `${BTN_BASE} bg-fg/10 border-fg/20 text-fg/55`;
const BTN_WAIT = `${BTN_BASE} border-dashed border-fg/20 text-fg/35`;
const BTN_OFF  = `${BTN_BASE} border-fg/15 text-fg/30`;

export const ApprovalsPage: React.FC = () => {
  const t = useT();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data, loading, error, reload } = useFetch<PendingApprovals>("/app/pms/approvals/pending?all=1");

  /** El nombre del equipo lleva a Planes, ya filtrado por ese equipo (igual que la Planilla). */
  const openAssetPlans = (r: { vesselCode: string; assetId?: string | null }) => {
    if (!r.assetId) return;
    navigate(`/maintenance-plans?vesselCode=${encodeURIComponent(r.vesselCode)}&assetId=${encodeURIComponent(r.assetId)}`);
  };

  const [query, setQuery]     = useState("");
  const [cardFilter, setCardFilter] = useState<CardKey | "">("");
  // Barra de filtros (Preview V1, oct 2026): la misma de Planes de Mantenimiento.
  const [sfiGroup, setSfiGroup] = useState<number | "ALL">("ALL");
  // Encendido = la planilla de siempre (por equipo, con celda combinada) y cada
  // equipo se puede plegar. Apagado = dentro del buque, por vencimiento.
  const [groupByAsset, setGroupByAsset] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [alert, setAlert]     = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  // El error de carga viene de useFetch y no se puede "apagar": sin esta marca,
  // cerrar el aviso lo volvía a abrir en el render siguiente.
  const [errorSeen, setErrorSeen] = useState(false);
  useEffect(() => { setErrorSeen(false); }, [error]);
  // Lo firmado en esta tanda: la fila se queda en verde en vez de desaparecer,
  // así queda el comprobante de lo que se acaba de firmar.
  const [signed, setSigned]   = useState<Record<string, { approved?: Signed; authorized?: Signed }>>({});
  // Lo cerrado en esta tanda: queda en gris con "✓ Cerrada" hasta recargar.
  const [closed, setClosed]   = useState<Record<string, string>>({});
  const [exec, setExec]       = useState<ExecWindow | null>(null);
  // Se tocaron avances en la ventana abierta: al cerrarla se recarga el contador.
  const [progressDirty, setProgressDirty] = useState(false);
  // SS mandadas al proveedor en esta tanda (fecha + a quién), hasta recargar.
  const [sent, setSent]       = useState<Record<string, { at: string; to: string }>>({});
  const [sendAsk, setSendAsk] = useState<Row | null>(null);
  const [samplesAsk, setSamplesAsk] = useState<{ row: Row; message: string } | null>(null);

  // El nombre que se imprime en el PDF como la firma. Es el del usuario
  // conectado: el backend lo exige y un botón de un toque no puede inventarlo.
  const signerName = user?.name ?? user?.email ?? "";

  const can = data?.can;

  /** Las cinco bandejas, en una sola lista de filas. */
  const rows = useMemo<Row[]>(() => {
    if (!data) return [];
    return [
      ...data.woApprove.map(i => ({ ...i, stage: "approve" as const })),
      ...data.srApprove.map(i => ({ ...i, stage: "approve" as const })),
      ...data.woAuthorize.map(i => ({ ...i, stage: "authorize" as const })),
      ...data.srAuthorize.map(i => ({ ...i, stage: "authorize" as const })),
      ...(data.woExecute ?? []).map(i => ({ ...i, stage: "execute" as const })),
      ...(data.srExecute ?? []).map(i => ({ ...i, stage: "execute" as const })),
    ];
  }, [data]);

  /** Fecha de cierre de la fila: cerrada en esta tanda, o SS ya recibida (su OT sigue abierta). */
  const closedAtOf = useCallback((r: Row): string | undefined =>
    closed[rowKey(r)] ?? (r.kind === "SR" && r.status === "COMPLETED" ? fmtDate(r.receivedAt ?? null) : undefined),
  [closed]);

  /** Quién aprobó: si vino de las bandejas de autorizar o de ejecución, el paso
   *  ya está firmado y el servicio manda ese nombre en `requestedByName`. */
  const approvedOf = useCallback((r: Row): Signed | null => {
    const local = signed[rowKey(r)]?.approved;
    if (local) return local;
    if (r.stage !== "approve") return { by: r.requestedByName ?? "—", at: fmtDate(r.requestedAt) };
    return null;
  }, [signed]);
  const authorizedOf = useCallback((r: Row): Signed | null => {
    const local = signed[rowKey(r)]?.authorized;
    if (local) return local;
    if (r.stage === "execute") return { by: r.authorizedByName ?? "—", at: fmtDate(r.authorizedAt) };
    return null;
  }, [signed]);

  /** Todo lo que la celda de la tarea ya no muestra, para el globito. */
  const tooltipOf = useCallback((r: Row): string => {
    const head = headlineOf(r);
    const lines: string[] = [head];
    const detail = cleanDetail(r.task);
    if (detail && detail !== head.trim()) lines.push(detail);
    if (r.dueDate) lines.push(`${t("approvals.due")}: ${fmtDate(r.dueDate)}`);
    if (r.kind === "SR" && r.workOrderCode) lines.push(t("approvals.hangsFrom").replace("{code}", r.workOrderCode));
    if (r.kind === "WO" && r.serviceRequestCount > 0) lines.push(`${t("approvals.linkedSr")}: ${r.serviceRequestCount}`);
    return lines.filter(Boolean).join("\n");
  }, [t]);

  const canApprove   = (r: Row) => (r.kind === "WO" ? !!can?.woApprove   : !!can?.srApprove);
  const canAuthorize = (r: Row) => (r.kind === "WO" ? !!can?.woAuthorize : !!can?.srAuthorize);

  // ─── Tarjetas de arriba: filtran las filas de ESTA planilla ────────────────
  // Mismos nombres y colores que las de Órdenes de Trabajo, pero cuentan las
  // filas de acá (OT y SS). "Sin enviar a aprobar" no va: lo que está en
  // preparación no llega a esta bandeja (decisión del usuario).
  const cardMatch = useCallback((r: Row, key: CardKey): boolean => {
    if (closedAtOf(r)) return false;   // cerrada (en esta tanda o ya recibida): ya no cuenta
    const deferred = r.status === "ON_HOLD" || r.status === "DEFERRED";
    switch (key) {
      case "overdue":    return !deferred && (daysToDue(r.dueDate) ?? 0) < 0;
      // La próxima firma de la fila es mía: aprobar si falta, si no autorizar.
      case "mine":
        return approvedOf(r)
          ? !authorizedOf(r) && (r.kind === "WO" ? !!can?.woAuthorize : !!can?.srAuthorize)
          : (r.kind === "WO" ? !!can?.woApprove : !!can?.srApprove);
      // Trabajo iniciado: la OT en proceso; la SS, ya mandada al taller.
      case "woInProgress": return r.kind === "WO" && r.status === "IN_PROGRESS";
      case "srInProgress": return r.kind === "SR" && (r.status === "IN_PROGRESS" || !!sent[rowKey(r)]);
      case "postponed":  return deferred;
    }
  }, [closedAtOf, sent, approvedOf, authorizedOf, can]);

  const cards = useMemo(() => {
    const n = (key: CardKey) => (data ? rows.filter(r => cardMatch(r, key)).length : null);
    return [
      { key: "overdue"    as const, n: n("overdue"),    label: t("wo.sum.overdue"),    hint: t("wo.sum.overdueHint"),    icon: AlertTriangle, cls: "border-l-red-600",     num: "text-red-700 dark:text-red-400" },
      { key: "mine"       as const, n: n("mine"),       label: t("wo.sum.mySign"),     hint: t("wo.sum.mySignHint"),     icon: Pencil,        cls: "border-l-blue-600",    num: "text-blue-700 dark:text-blue-400" },
      { key: "woInProgress" as const, n: n("woInProgress"), label: t("approvals.card.woInProgress"), hint: t("wo.sum.inProgressHint"),         icon: Hammer,    cls: "border-l-emerald-600", num: "text-emerald-700 dark:text-emerald-400" },
      { key: "srInProgress" as const, n: n("srInProgress"), label: t("approvals.card.srInProgress"), hint: t("approvals.card.srInProgressHint"), icon: Handshake, cls: "border-l-cyan-600",    num: "text-cyan-700 dark:text-cyan-400" },
      { key: "postponed"  as const, n: n("postponed"),  label: t("wo.sum.deferred"),   hint: t("wo.sum.deferredHint"),   icon: Pause,         cls: "border-l-yellow-600",  num: "text-yellow-700 dark:text-yellow-400" },
    ];
  }, [data, rows, cardMatch, t]);

  // Tarjeta + búsqueda. El grupo SFI se aplica aparte para saber qué botones
  // G0…G9 tienen filas con los otros filtros puestos (los vacíos salen apagados).
  const preGroup = useMemo(() => {
    const q = query.trim();
    const byCard = cardFilter ? rows.filter(r => cardMatch(r, cardFilter)) : rows;
    return q
      ? byCard.filter(r => textMatches(
          [r.code, r.vesselName, r.assetName, r.title, r.task, r.workOrderCode, ...r.providers].filter(Boolean).join(" "),
          q,
        ))
      : byCard;
  }, [rows, query, cardFilter, cardMatch]);
  const groupsWithRows = useMemo(() => new Set(preGroup.map(r => sfiDigit(r.sfiGroupNumber))), [preGroup]);

  const visible = useMemo(() => {
    const list = sfiGroup === "ALL" ? preGroup : preGroup.filter(r => sfiDigit(r.sfiGroupNumber) === sfiGroup);
    // Ordenadas por buque y equipo: así las celdas combinadas de la planilla
    // agrupan de verdad, y dentro de cada equipo primero lo más urgente. Sin
    // agrupar por equipo, dentro del buque va primero lo más urgente.
    const sorted = [...list].sort((a, b) =>
      (a.vesselName ?? a.vesselCode).localeCompare(b.vesselName ?? b.vesselCode)
      || (groupByAsset ? (a.assetName ?? "").localeCompare(b.assetName ?? "") : 0)
      || ((daysToDue(a.dueDate) ?? 9e9) - (daysToDue(b.dueDate) ?? 9e9)));
    // Cada SS va justo debajo de la OT de la que cuelga, si esa OT está en la
    // lista (el equipo de la SS es el de su OT, así que no rompe el grupo). Si
    // la OT no está —cerrada, filtrada—, la SS queda suelta en su lugar.
    const woCodes = new Set(sorted.filter(r => r.kind === "WO").map(r => r.code));
    const childrenOf = new Map<string, Row[]>();
    const roots: Row[] = [];
    for (const r of sorted) {
      if (r.kind === "SR" && r.workOrderCode && woCodes.has(r.workOrderCode)) {
        const kids = childrenOf.get(r.workOrderCode) ?? [];
        kids.push(r);
        childrenOf.set(r.workOrderCode, kids);
      } else roots.push(r);
    }
    return roots.flatMap(r => (r.kind === "WO" ? [r, ...(childrenOf.get(r.code) ?? [])] : [r]));
  }, [preGroup, sfiGroup, groupByAsset]);

  // ─── Plegar equipos (sólo agrupado por equipo) ─────────────────────────────
  const visibleAssetKeys = useMemo(() => [...new Set(visible.map(assetKey))], [visible]);
  const allCollapsed = visibleAssetKeys.length > 0 && visibleAssetKeys.every(k => collapsed.has(k));
  const toggleAsset = (key: string) => setCollapsed(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const toggleAllAssets = () => setCollapsed(allCollapsed ? new Set() : new Set(visibleAssetKeys));
  const clearBarFilters = () => { setSfiGroup("ALL"); setQuery(""); };

  /** Lugar de cada fila en el árbol OT → SS: la OT con hijas, la SS del medio
   *  y la última (la que cierra la línea). Las sueltas no están. */
  const treeOf = useMemo(() => {
    const m = new Map<string, "parent" | "child" | "last">();
    visible.forEach((r, i) => {
      const p = visible[i - 1];
      if (r.kind !== "SR" || !r.workOrderCode || !p) return;
      const underParent = p.kind === "WO"
        ? p.code === r.workOrderCode
        : p.workOrderCode === r.workOrderCode && m.has(rowKey(p));
      if (!underParent) return;
      m.set(rowKey(p), p.kind === "WO" ? "parent" : "child");
      m.set(rowKey(r), "last");
    });
    return m;
  }, [visible]);

  const pendingCount = useMemo(
    () => rows.filter(r => !authorizedOf(r)).length,
    [rows, authorizedOf],
  );

  // ─── OT recién abierta (?highlight=<código>) ───────────────────────────────
  // Se llega acá al cerrar la OT creada desde la Planilla a Bordo: su fila se
  // marca y se centra UNA sola vez (pedido de Gustavo, sep 2026). El parámetro
  // se borra de la URL al usarlo, así "atrás" o recargar no la vuelven a marcar.
  const [searchParams, setSearchParams] = useSearchParams();
  const [highlightCode, setHighlightCode] = useState<string | null>(null);
  // Código a buscar, recién cuando llegó la lista fresca.
  const [lookFor, setLookFor] = useState<string | null>(null);
  useEffect(() => {
    const code = searchParams.get("highlight");
    if (!code) return;
    setSearchParams(p => { p.delete("highlight"); return p; }, { replace: true });
    // La lista que se ve al entrar sale del cache de la visita anterior, de
    // antes de crear o enviar esta OT: buscarla ahí daba "no aparece" aunque ya
    // estuviera enviada. Se pide fresca y recién ahí se busca.
    void reload().then(() => setLookFor(code));
  }, [searchParams, setSearchParams, reload]);
  useEffect(() => {
    if (!lookFor || !data) return;
    const code = lookFor;
    setLookFor(null);
    const row = rows.find(r => r.kind === "WO" && r.code === code);
    if (!row) {
      // En preparación (sin enviar a aprobar) no llega a esta bandeja: sólo
      // en ese caso se avisa. Si no está por otro motivo (otro buque elegido
      // arriba, por ejemplo) el aviso diría algo falso: no se muestra nada.
      void api.get<{ enviadoAprobacionAt?: string | null }>(`/app/pms/work-orders/${encodeURIComponent(code)}`)
        .then(wo => { if (!wo.enviadoAprobacionAt) setAlert(t("approvals.justOpened.notListed").replace("{code}", code)); })
        .catch(() => { /* sin aviso */ });
      return;
    }
    setHighlightCode(code);
    window.setTimeout(() => {
      document.querySelector(`[data-row-code="${CSS.escape(code)}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
  }, [lookFor, data, rows, t]);

  // ─── Firmar ────────────────────────────────────────────────────────────────
  const sign = useCallback(async (r: Row, step: "APRUEBA" | "AUTORIZA") => {
    if (!signerName) { setAlert(t("approvals.signerRequired")); return; }
    const key = rowKey(r);
    setBusyKey(key);
    // Firmar la OT firma también sus SS colgadas (el backend las arrastra y
    // devuelve cuáles): se pintan en el momento, igual que la OT.
    let cascaded: string[] = [];
    try {
      if (r.kind === "WO") {
        const res = await api.post<{ cascadedServiceRequestIds?: string[] }>(
          `/app/pms/work-orders/${r.id}/approval`, { step, name: signerName },
        );
        cascaded = res?.cascadedServiceRequestIds ?? [];
      } else {
        await api.post(
          `/app/pms/service-requests/${r.id}/${step === "AUTORIZA" ? "authorize" : "approve"}`,
          { name: signerName },
        );
      }
      const stamp: Signed = { by: signerName, at: fmtDate(new Date().toISOString()) };
      setSigned(s => {
        const next = {
          ...s,
          [key]: step === "APRUEBA"
            ? { ...s[key], approved: stamp }
            : { ...s[key], authorized: stamp },
        };
        for (const srId of cascaded) {
          const k = rowKey({ kind: "SR", id: srId });
          const srRow = rows.find(x => x.kind === "SR" && x.id === srId);
          // Autorizar una SS que no pasó por aprobada completa también la
          // aprobación (mismo criterio que el arrastre del backend).
          next[k] = step === "APRUEBA"
            ? { ...next[k], approved: next[k]?.approved ?? stamp }
            : {
                ...next[k],
                authorized: stamp,
                approved: next[k]?.approved ?? (srRow?.stage === "approve" ? stamp : undefined),
              };
        }
        return next;
      });
    } catch (err) {
      // El servidor manda el motivo real (403 sin atribución, 409 si otro firmó
      // primero). Se muestra tal cual: es lo que el usuario necesita saber.
      setAlert(err instanceof ApiError && err.message ? err.message : t("approvals.actionError"));
    } finally {
      setBusyKey(null);
    }
  }, [signerName, t, rows]);

  // ─── Después de la ficha de la OT o de la SS ───────────────────────────────
  // La ficha pudo cerrar el registro o sólo guardarlo: se pregunta al servidor
  // en qué quedó. Cerrada (OT) o recibida (SS) → la fila queda en gris con
  // "✓ Cerrada"; si no, se recarga la bandeja (una OT retenida o cancelada
  // cambia de lugar o se va).
  const afterRecord = useCallback(async (r: Row) => {
    setExec(null);
    try {
      const url = r.kind === "WO" ? `/app/pms/work-orders/${r.id}` : `/app/pms/service-requests/${r.id}`;
      const rec = await api.get<{ status: string }>(url);
      if (rec.status === (r.kind === "WO" ? "CLOSED" : "COMPLETED")) {
        setClosed(c => ({ ...c, [rowKey(r)]: fmtDate(new Date().toISOString()) }));
        // Al cerrar la OT se pudieron cerrar también sus SS (aviso del cierre):
        // sin esto la SS seguía con "Cerrar SS" hasta recargar la página.
        if (r.kind === "WO") {
          try {
            const srs = await api.get<{ items: Array<{ id: string; status: string; receivedAt?: string | null }> }>(
              `/app/pms/work-orders/${r.id}/service-requests`,
            );
            const done = (srs.items ?? []).filter(s => s.status === "COMPLETED");
            if (done.length > 0) {
              setClosed(c => ({
                ...c,
                ...Object.fromEntries(done.map(s => [rowKey({ kind: "SR", id: s.id }), fmtDate(s.receivedAt ?? new Date().toISOString())])),
              }));
            }
          } catch { /* la fila de la SS se corrige al recargar */ }
        }
        return;
      }
    } catch { /* si no se pudo leer, la recarga lo resuelve */ }
    void reload();
  }, [reload]);

  // ─── Enviar la SS al proveedor ─────────────────────────────────────────────
  // Mismo camino que el botón de la ficha de la SS: el backend manda el correo
  // con el PDF y recién ahí la pasa a EN EJECUCIÓN. Si faltan números de
  // muestra, avisa y se puede mandar igual. Sin casilla configurada, envío a
  // mano: se baja el formulario, se abre el correo armado y se marca enviada.
  const sendToProvider = useCallback(async (r: Row, ack: boolean) => {
    const key = rowKey(r);
    const stamp = (to: string) => setSent(s => ({ ...s, [key]: { at: fmtDate(new Date().toISOString()), to } }));
    setBusyKey(key);
    try {
      const body = { acknowledgeMissingSampleNumbers: ack };
      const res = await api.post<SendResult>(`/app/pms/service-requests/${r.id}/send-to-provider`, body);
      if (res.sent) { stamp(res.to.join(", ")); return; }
      if (res.reason === "SEND_FAILED") {
        setAlert(t("approvals.exec.sendFailed").replace("{error}", res.error ?? ""));
        return;
      }
      const full = await api.get<Parameters<typeof import("./ServiceRequests").openProviderEmailDraft>[0]>(
        `/app/pms/service-requests/${r.id}`,
      );
      if (!await downloadDocx(`/app/pms/service-requests/${r.id}/docx`, r.code)) {
        setAlert(t("approvals.exec.docxFailed"));
        return;
      }
      const { openProviderEmailDraft } = await import("./ServiceRequests");
      openProviderEmailDraft(full, r.vesselName ?? r.vesselCode);
      await api.post(`/app/pms/service-requests/${r.id}/start`, body);
      stamp("");
      setAlert(t("approvals.exec.manualSent"));
    } catch (err) {
      if (err instanceof ApiError && err.code === "SAMPLE_NUMBERS_MISSING") {
        setSamplesAsk({ row: r, message: err.message });
        return;
      }
      setAlert(err instanceof ApiError && err.message ? err.message : t("approvals.exec.sendFailed").replace("{error}", ""));
    } finally {
      setBusyKey(null);
    }
  }, [t]);

  /** Ir a la ficha del registro (el número de OT o SS es un enlace). */
  // La ficha se abre encima de Seguimiento, sin pasar por la pantalla de OT o
  // de SS (pedido del usuario): es la misma ventana de "Cerrar OT / SS", pero
  // parada al principio.
  const openRecord = (r: Row) => setExec({ kind: r.kind === "WO" ? "record" : "recordSr", row: r });

  // ─── Estilos de la planilla de papel ───────────────────────────────────────
  // Encabezado sólido a propósito: es sticky y con fondo translúcido las filas
  // rojas se transparentan por debajo.
  const th = "px-2 py-1.5 text-[10px] font-bold text-[#1F3864] border border-border bg-[#D9E2E3] text-center";
  const td = "px-2 py-0.5 text-[11px] leading-tight border border-border align-middle";
  const COLS = 11;

  /** Uno de los dos botones de firma de la fila. */
  const SignButton: React.FC<{ row: Row; step: "APRUEBA" | "AUTORIZA" }> = ({ row, step }) => {
    const isAuth = step === "AUTORIZA";
    const done   = isAuth ? authorizedOf(row) : approvedOf(row);
    const allowed = isAuth ? canAuthorize(row) : canApprove(row);
    const word   = t(isAuth ? "approvals.action.authorize" : "approvals.action.approve");
    const past   = t(isAuth ? "approvals.signed.authorized" : "approvals.signed.approved");

    // Firmado: verde y FIJO. No existe des-aprobar (se revierte rechazando).
    // Con la OT / SS ya cerrada, en gris: el registro no se puede actualizar.
    if (done) {
      const locked = !!closedAtOf(row);
      return (
        <span className={locked ? BTN_LOCKED : BTN_DONE}
          title={`${past} — ${done.by} · ${done.at}${locked ? ` · ${t("approvals.signed.closed")}` : ""}`}>
          ✓ {past}
          <span className="text-[9px] font-semibold opacity-90 truncate max-w-full">{done.by}</span>
        </span>
      );
    }
    // Autorizar antes de aprobar: el backend lo rechaza, así que se avisa antes.
    if (isAuth && !approvedOf(row)) {
      return (
        <span className={BTN_WAIT} title={t("approvals.needsApprovalFirst")}>
          {word}
          <span className="text-[9px] font-semibold">{t("approvals.pendingApproval")}</span>
        </span>
      );
    }
    if (!allowed) {
      return (
        <span className={BTN_OFF} title={t("approvals.noPermission")}>
          {word}
          <span className="text-[9px] font-semibold">{t("approvals.noPermission")}</span>
        </span>
      );
    }
    const busy = busyKey === rowKey(row);
    return (
      <button
        type="button"
        disabled={busy}
        onClick={() => { void sign(row, step); }}
        title={`${word} — ${t("approvals.signsAs").replace("{name}", signerName)}`}
        className={BTN_ON}
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : btnBody(word, t("approvals.exec.yourSign"))}
      </button>
    );
  };

  /** Contenido de todo botón encendido: el nombre arriba y un dato chico abajo,
   *  el formato de "Avances" (pedido del usuario: todos iguales). */
  const btnBody = (word: string, detail: string) => (
    <>
      <span className="uppercase">{word}</span>
      <span className="text-[9px] font-semibold opacity-85 truncate max-w-full">{detail}</span>
    </>
  );

  /** Botón apagado de las columnas de ejecución, con el motivo abajo. */
  const execOff = (word: string, why: string, dashed: boolean) => (
    <span className={dashed ? BTN_WAIT : BTN_OFF} title={why}>
      <span className="uppercase">{word}</span>
      <span className="text-[9px] font-semibold">{why}</span>
    </span>
  );

  /** Celda de una columna que a la fila no le aplica (el envío en la OT, los
   *  repuestos en la SS): vacía y sombreada, para que no parezca pendiente. */
  const naCell = <td className={`${td} bg-fg/[0.04]`} />;

  /** Las celdas de la derecha: ENVIAR AL PROVEEDOR · AVANCES · REPUESTOS ·
   *  CERRAR OT / SS. La OT no se manda al proveedor (lo hacen sus SS). */
  const execCells = (r: Row) => {
    const cell = `${td} p-1 bg-surface`;
    // La SS: se manda al proveedor, su avance es la HOJA DE RUTA, Repuestos no
    // le aplica y al volver el trabajo se cierra.
    if (r.kind === "SR") {
      const wRoute = t("approvals.exec.hojaRuta");
      const wSend  = t("approvals.exec.sendProvider");
      const wClose = t("approvals.exec.closeSr");
      const authorized = !!authorizedOf(r);
      const sentInfo = sent[rowKey(r)] ?? (r.sentAt ? { at: fmtDate(r.sentAt), to: "" } : null);
      const closedAt = closedAtOf(r);
      const waitWhy = t("approvals.pendingAuthorization");
      const sendLabel = r.providers[0] ? t("ss.guide.sendProviderTo").replace("{provider}", r.providers[0]) : wSend;
      const routeCount = r.routeEntryCount ?? 0;
      return (
        <>
          <td className={cell}>
            {sentInfo ? (
              // Enviada: verde y fijo, como las firmas; en gris con la SS cerrada.
              <span className={closedAt ? BTN_LOCKED : BTN_DONE} title={sentInfo.to ? t("approvals.exec.sentTo").replace("{to}", sentInfo.to) : undefined}>
                <span className="uppercase">✓ {t("approvals.signed.sent")}</span>
                <span className="text-[9px] font-semibold opacity-90">{sentInfo.at}</span>
              </span>
            ) : !authorized ? execOff(wSend, waitWhy, true)
              : !can?.srManage ? execOff(wSend, t("approvals.noPermission"), false)
              : (
                <button type="button" className={BTN_ON} title={sendLabel} disabled={busyKey === rowKey(r)} onClick={() => setSendAsk(r)}>
                  {busyKey === rowKey(r)
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : btnBody(t("approvals.exec.send"), r.providers[0] ?? t("approvals.exec.noProvider"))}
                </button>
              )}
          </td>
          <td className={cell}>
            {authorized ? (
              // Con la SS cerrada, en gris: se abre para consultar pero no se le agregan novedades.
              <button type="button" className={closedAt ? `${BTN_LOCKED} hover:bg-fg/15` : BTN_ON} onClick={() => { setProgressDirty(false); setExec({ kind: "route", row: r }); }}>
                {btnBody(wRoute, routeCount === 0 ? t("approvals.exec.noneF")
                  : routeCount === 1 ? t("approvals.exec.routeOne")
                  : t("approvals.exec.routeMany").replace("{n}", String(routeCount)))}
              </button>
            ) : execOff(wRoute, waitWhy, true)}
          </td>
          {naCell}
          {naCell}
          {/* Cerrar = la recepción de la ficha de la SS (quién recibe y si hay
              conformidad), con su auditoría de IA. Sólo después de enviada. */}
          <td className={cell}>
            {closedAt ? (
              <span className={BTN_DONE} title={`${t("approvals.signed.closed")} · ${closedAt}`}>
                ✓ {t("approvals.signed.closed")}
                <span className="text-[9px] font-semibold opacity-90">{closedAt}</span>
              </span>
            ) : !authorized ? execOff(wClose, waitWhy, true)
              : !sentInfo ? execOff(wClose, t("approvals.exec.sendFirst"), true)
              : !can?.srManage ? execOff(wClose, t("approvals.noPermission"), false)
              : (
                <button type="button" className={BTN_ON} onClick={() => setExec({ kind: "closeSr", row: r })}>
                  {btnBody(wClose, t("approvals.exec.needsReception"))}
                </button>
              )}
          </td>
        </>
      );
    }
    const wProgress = t("approvals.col.progress");
    const wPermits  = t("approvals.col.permits");
    const wSpares   = t("approvals.col.spares");
    const wClose    = t("wo.modal.closeWO");
    const closedAt  = closedAtOf(r);
    if (closedAt) {
      const why = t("approvals.exec.woClosed");
      return (
        <>
          <td className={cell}>{execOff(wProgress, why, true)}</td>
          <td className={cell}>{execOff(wPermits, why, true)}</td>
          <td className={cell}>{execOff(wSpares, why, true)}</td>
          <td className={cell}>
            <span className={BTN_DONE} title={`${t("approvals.signed.closed")} · ${closedAt}`}>
              ✓ {t("approvals.signed.closed")}
              <span className="text-[9px] font-semibold opacity-90">{closedAt}</span>
            </span>
          </td>
        </>
      );
    }
    // Hasta la autorización no se ejecuta: el orden lo pone el circuito de firmas.
    if (!authorizedOf(r)) {
      const why = t("approvals.pendingAuthorization");
      return (
        <>
          <td className={cell}>{execOff(wProgress, why, true)}</td>
          <td className={cell}>{execOff(wPermits, why, true)}</td>
          <td className={cell}>{execOff(wSpares, why, true)}</td>
          <td className={cell}>{execOff(wClose, why, true)}</td>
        </>
      );
    }
    const notes  = r.progressNoteCount ?? 0;
    const spares = r.spareUsageCount ?? 0;
    const permits = r.permitCount ?? 0;
    const noPerm = t("approvals.noPermission");
    return (
      <>
        {/* Avances se abre siempre: sin permiso de operar, la lista es de sólo lectura. */}
        <td className={cell}>
          <button type="button" className={BTN_ON} onClick={() => { setProgressDirty(false); setExec({ kind: "progress", row: r }); }}>
            {btnBody(wProgress, notes === 0 ? t("approvals.exec.none")
              : notes === 1 ? t("approvals.exec.notesOne")
              : t("approvals.exec.notesMany").replace("{n}", String(notes)))}
          </button>
        </td>
        {/* Permisos se abre siempre: crear uno pide permit.manage (lo resuelve la ventana). */}
        <td className={cell}>
          <button type="button" className={BTN_ON} onClick={() => { setProgressDirty(false); setExec({ kind: "permits", row: r }); }}>
            {btnBody(wPermits, permits === 0 ? t("approvals.exec.none")
              : permits === 1 ? t("approvals.exec.permitsOne")
              : t("approvals.exec.permitsMany").replace("{n}", String(permits)))}
          </button>
        </td>
        <td className={cell}>
          {can?.woManage ? (
            <button type="button" className={BTN_ON} onClick={() => setExec({ kind: "spares", row: r })}>
              {btnBody(wSpares, spares === 0 ? t("approvals.exec.none")
                : spares === 1 ? t("approvals.exec.sparesOne")
                : t("approvals.exec.sparesMany").replace("{n}", String(spares)))}
            </button>
          ) : execOff(wSpares, noPerm, false)}
        </td>
        <td className={cell}>
          {can?.woOperate ? (
            <button type="button" className={BTN_ON} onClick={() => setExec({ kind: "close", row: r })}>
              {btnBody(wClose, t("approvals.exec.needsClose"))}
            </button>
          ) : execOff(wClose, noPerm, false)}
        </td>
      </>
    );
  };

  return (
    <div className="space-y-4">
      <PageHeader
        icon={ClipboardCheck}
        title={t("nav.approvals")}
        total={visible.length}
        onReload={reload}
      />

      {/* Las tarjetas de Órdenes de Trabajo en versión finita (pedido del
          usuario). Filtran las filas de la planilla; tocar la activa la saca.
          La explicación queda en el globito. */}
      <div className="flex flex-wrap gap-2">
        {cards.map(c => {
          const on = cardFilter === c.key;
          return (
            <button key={c.key} type="button" title={c.hint} aria-pressed={on}
              onClick={() => setCardFilter(on ? "" : c.key)}
              className={`flex items-center gap-2 rounded-xl border-[1.5px] border-l-4 bg-surface px-3 py-1 text-left transition-all ${c.cls} ${
                on ? "border-accent ring-2 ring-accent/20" : "border-fg/10 hover:border-fg/25"
              }`}>
              <span className={`min-w-[1.25rem] text-lg font-extrabold leading-tight ${c.num}`}>{c.n ?? "–"}</span>
              <span className="flex items-center gap-1 text-xs font-semibold text-text-industrial/70 whitespace-nowrap">
                <c.icon className="w-3.5 h-3.5" />{c.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Filtros en UNA fila, el molde de Planes de Mantenimiento: grupo SFI,
          agrupar por equipo, plegar todo y el buscador a la derecha. Se suman
          a la tarjeta elegida arriba. */}
      <div className="rounded-2xl border border-fg/10 bg-surface px-3 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] font-bold uppercase tracking-wider text-text-industrial/50">{t("wo.fl.group")}</span>
          <button type="button" aria-pressed={sfiGroup === "ALL"} onClick={() => setSfiGroup("ALL")}
            className={`rounded-full border-[1.5px] px-3 py-1 text-xs font-bold transition-colors ${
              sfiGroup === "ALL" ? "border-accent bg-accent text-accent-fg" : "border-fg/10 bg-surface text-text-industrial/60 hover:text-fg"
            }`}>
            {t("wo.fl.groupAll")}
          </button>
          {SFI_DIGITS.map(g => {
            const on = sfiGroup === g;
            const has = groupsWithRows.has(g);
            const name = `G${g} · ${t(`sfi.g.${g}` as TranslationKey)}`;
            return (
              <button key={g} type="button" title={name} aria-label={name} aria-pressed={on}
                disabled={!has && !on}
                onClick={() => setSfiGroup(on ? "ALL" : g)}
                className={`min-w-[2.4rem] rounded-full border-[1.5px] px-2.5 py-1 text-xs font-bold transition-colors ${
                  on ? "border-accent bg-accent text-accent-fg"
                    : has ? "border-fg/10 bg-surface text-text-industrial/60 hover:text-fg"
                    : "border-fg/10 bg-surface text-text-industrial/60 opacity-35 cursor-default"
                }`}>
                G{g}
              </button>
            );
          })}
          <button type="button" onClick={() => setGroupByAsset(v => !v)} aria-pressed={groupByAsset}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-bold transition-all ${groupByAsset ? "border-accent/40 bg-accent/10 text-accent" : "border-fg/10 bg-fg/5 text-text-industrial hover:border-accent/30"}`}>
            <ListTree className="w-3.5 h-3.5" /> {t("mp.page.groupByEquipment")}
          </button>
          {groupByAsset && (
            <button type="button" onClick={toggleAllAssets} title={allCollapsed ? t("mp.page.expandAll") : t("mp.page.collapseAll")}
              className="flex items-center justify-center p-1.5 rounded-lg border bg-fg/5 border-fg/10 text-text-industrial/60 hover:border-accent/30 transition-all">
              {allCollapsed ? <ChevronsUpDown className="w-4 h-4" /> : <ChevronsDownUp className="w-4 h-4" />}
            </button>
          )}
          {(sfiGroup !== "ALL" || query) && (
            <button type="button" onClick={clearBarFilters} className="rounded-lg border border-fg/10 bg-fg/5 px-2.5 py-1.5 text-xs text-text-industrial/80 hover:text-fg">{t("common.clear")}</button>
          )}
          <div className="flex items-center gap-1.5 rounded-lg border border-fg/10 bg-fg/5 px-2.5 py-1.5 w-full sm:w-auto sm:ml-auto">
            <Search className="w-3.5 h-3.5 text-text-industrial/40 shrink-0" />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder={t("approvals.searchPlaceholder")}
              className="w-full sm:w-64 bg-transparent text-xs text-fg placeholder-text-industrial/30 focus:outline-none" />
            {query && <button type="button" onClick={() => setQuery("")} aria-label={t("common.clear")} className="text-text-industrial/40 hover:text-fg"><X className="w-3 h-3" /></button>}
          </div>
        </div>
      </div>

      <div className="glass rounded-2xl overflow-hidden">
        <div className="overflow-auto max-h-[calc(100vh-17rem)] [scrollbar-gutter:stable]">
          {/* Tarea con un cuarto del ancho (pedido del usuario: más corta) y
              las siete columnas de botones se reparten el resto en partes
              iguales. Por debajo de 1250 px aparece la barra horizontal en vez
              de aplastar los botones. */}
          <table className="w-full min-w-[1250px] table-fixed border-collapse">
            <colgroup>
              <col className="w-[40px]" /><col className="w-[130px]" /><col className="w-[110px]" />
              <col className="w-[25%]" />
              <col /><col /><col /><col /><col /><col /><col />
            </colgroup>
            <thead>
              <tr>
                <th className={th}>{t("approvals.col.item")}</th>
                <th className={th}>{t("approvals.equipment")}</th>
                <th className={th}>{t("approvals.col.record")}</th>
                <th className={th}>{t("approvals.task")}</th>
                <th className={th}>{t("approvals.action.approve")}</th>
                <th className={th}>{t("approvals.action.authorize")}</th>
                <th className={th}>{t("approvals.exec.sendProvider")}</th>
                <th className={th}>{t("approvals.col.progress")}</th>
                <th className={th}>{t("approvals.col.permits")}</th>
                <th className={th}>{t("approvals.col.spares")}</th>
                <th className={th}>{t("approvals.col.close")}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r, n) => {
                const prev = visible[n - 1];
                const vesselLabel = r.vesselName ?? r.vesselCode;
                const newVessel = !prev || (prev.vesselName ?? prev.vesselCode) !== vesselLabel;
                // Agrupado: celda del equipo combinada entre sus tareas, como en
                // el papel. Sin agrupar: cada fila lleva su equipo y el ítem es el
                // número de fila dentro del buque.
                const key = assetKey(r);
                const firstOfAsset = !groupByAsset || newVessel || prev!.assetName !== r.assetName;
                const isCollapsed = groupByAsset && collapsed.has(key);
                if (isCollapsed && !firstOfAsset) return null;
                let span = 0;
                let itemNumber = 0;
                if (firstOfAsset) {
                  span = 1;
                  if (groupByAsset) {
                    for (let m = n + 1; m < visible.length; m++) {
                      const x = visible[m]!;
                      if ((x.vesselName ?? x.vesselCode) !== vesselLabel || x.assetName !== r.assetName) break;
                      span++;
                    }
                  }
                  // Número de ítem: cuántos equipos (o filas, sin agrupar) van en este buque.
                  for (let m = 0; m <= n; m++) {
                    const x = visible[m]!;
                    if ((x.vesselName ?? x.vesselCode) !== vesselLabel) continue;
                    const p = visible[m - 1];
                    if (!groupByAsset || !p || (p.vesselName ?? p.vesselCode) !== vesselLabel || p.assetName !== x.assetName) itemNumber++;
                  }
                }
                const vesselRow = newVessel && (
                  <tr>
                    <td colSpan={COLS} className="px-3 py-1 text-[11px] font-bold text-white bg-[#1F3864] border border-[#1F3864]">
                      {vesselLabel}
                    </td>
                  </tr>
                );
                // El nombre del equipo pliega y despliega sus filas.
                // El nombre lleva a los planes del equipo; la flecha pliega sus filas.
                const assetName = r.assetId ? (
                  <button type="button" onClick={() => openAssetPlans(r)} title={t("msheet.openAssetPlans")}
                    className="font-bold hover:underline">
                    {r.assetName ?? "—"}
                  </button>
                ) : (r.assetName ?? "—");
                const assetCell = groupByAsset ? (
                  <span className="inline-flex w-full items-center justify-center gap-1">
                    <button type="button" onClick={() => toggleAsset(key)}
                      title={t(isCollapsed ? "approvals.fold.expand" : "approvals.fold.collapse")}
                      aria-label={t(isCollapsed ? "approvals.fold.expand" : "approvals.fold.collapse")}
                      className="shrink-0 rounded p-0.5 hover:bg-black/10">
                      {isCollapsed
                        ? <ChevronRight className="w-3 h-3 opacity-60" />
                        : <ChevronDown className="w-3 h-3 opacity-60" />}
                    </button>
                    <span className="font-bold">{assetName}</span>
                  </span>
                ) : assetName;

                // Equipo plegado: una sola línea con cuántos registros tiene y
                // cuántos están vencidos (mismo criterio que la tarjeta).
                if (isCollapsed) {
                  const group = visible.slice(n, n + span);
                  const late = group.filter(x => cardMatch(x, "overdue")).length;
                  return (
                    <React.Fragment key={`fold:${key}`}>
                      {vesselRow}
                      <tr>
                        <td className={`${td} text-center font-bold bg-surface text-fg`}>{itemNumber}</td>
                        <td className={`${td} text-center font-bold bg-[#F8CBAD] text-[#1F3864]`}>{assetCell}</td>
                        <td colSpan={COLS - 2} className={`${td} py-1.5 font-semibold text-text-industrial/70 bg-fg/[0.03]`}>
                          {group.length === 1 ? t("approvals.fold.recordOne") : t("approvals.fold.records").replace("{n}", String(group.length))}
                          {late > 0 && (
                            <> · <span className="font-extrabold text-red-700 dark:text-red-400">
                              {late === 1 ? t("approvals.fold.overdueOne") : t("approvals.fold.overdue").replace("{n}", String(late))}
                            </span></>
                          )}
                          <span className="opacity-60"> · {t("approvals.fold.hint")}</span>
                        </td>
                      </tr>
                    </React.Fragment>
                  );
                }
                const dd = daysToDue(r.dueDate);
                const isClosed = !!closedAtOf(r);
                const isDone = !!authorizedOf(r);
                // Mismo semáforo que la Planilla: rojo vencida, amarillo por
                // vencer, verde cuando la firma está completa, gris ya cerrada.
                // La columna "Vence" se sacó a pedido: la fecha queda en el
                // globito y el color de la fila sigue avisando. PERO el color va
                // sólo en las celdas de texto: pintar también las de los botones
                // dejaba "AUTORIZAR" rojo sobre rojo, ilegible.
                const tone = isClosed
                  ? "bg-fg/5 text-fg/50"
                  : isDone
                  ? "bg-success/10"
                  : dd !== null && dd < 0 ? "bg-red-600 text-white border-white/35!"
                  : dd !== null && dd <= 7 ? "bg-yellow-300 text-yellow-950 border-yellow-900/25!"
                  : "text-fg/90";
                const provider = r.kind === "SR" ? r.providers[0] : undefined;
                const treePos = treeOf.get(rowKey(r));

                return (
                  <React.Fragment key={rowKey(r)}>
                    {vesselRow}
                    <tr className="hover:brightness-[0.98]" data-row-code={r.kind === "WO" ? r.code : undefined}
                      // La OT recién abierta: recuadro de color de acento (sobre
                      // el semáforo de la fila, que sigue a la vista).
                      style={r.kind === "WO" && r.code === highlightCode
                        ? { outline: "3px solid var(--color-accent)", outlineOffset: "-2px" } : undefined}>
                      {firstOfAsset && (
                        <td rowSpan={span} className={`${td} text-center font-bold bg-surface text-fg`}>{itemNumber}</td>
                      )}
                      {firstOfAsset && (
                        <td rowSpan={span} className={`${td} text-center font-bold bg-[#F8CBAD] text-[#1F3864]`}>
                          {assetCell}
                        </td>
                      )}
                      {/* Registro antes que la tarea (pedido del usuario). */}
                      <td className={`${td} ${tone} text-center align-top py-1 px-1!`}>
                        <span className={`inline-block text-[8.5px] px-1.5 py-px rounded-full font-extrabold ${
                          r.kind === "WO" ? "bg-accent/20 text-accent" : "bg-warning/25 text-warning"
                        }`}>
                          {t(r.kind === "WO" ? "approvals.kind.wo" : "approvals.kind.sr")}
                        </span>
                        {/* El número lleva a la ficha de la OT o de la SS. */}
                        <button
                          type="button"
                          onClick={() => openRecord(r)}
                          title={t("approvals.openRecord").replace("{code}", r.code)}
                          className="block mx-auto mt-0.5 font-mono font-bold text-[10.5px] whitespace-nowrap underline decoration-dotted underline-offset-2 hover:decoration-solid hover:text-accent"
                        >
                          {r.code}
                        </button>
                      </td>
                      {/* Sólo el título, hasta dos renglones (pedido del usuario).
                          La descripción, el vencimiento y los vínculos quedan en
                          el globito. En la SS, además, el proveedor. */}
                      <td className={`${td} ${tone} align-top py-1 relative ${
                        treePos === "parent" ? "overflow-hidden" : treePos ? "pl-8!" : ""
                      }`} title={tooltipOf(r)}>
                        {/* Árbol OT → SS (pedido del usuario): la línea baja
                            desde abajo del título de la OT y entra en cada SS
                            con un └. Toma el color del texto de la celda. */}
                        {(treePos === "child" || treePos === "last") && (
                          <span aria-hidden className="pointer-events-none absolute left-3.5 top-0 h-[0.7rem] w-3.5 border-l border-b border-current opacity-40" />
                        )}
                        {treePos === "child" && (
                          <span aria-hidden className="pointer-events-none absolute left-3.5 top-0 bottom-0 border-l border-current opacity-40" />
                        )}
                        {/* La tarea abre la ficha de su OT o SS, igual que el
                            número (pedido del usuario). Sin color de hover:
                            sobre la fila roja no se leería. */}
                        <button
                          type="button"
                          onClick={() => openRecord(r)}
                          className="w-full text-left font-bold line-clamp-2 cursor-pointer hover:underline underline-offset-2"
                        >
                          {headlineOf(r)}
                        </button>
                        {/* Arranca donde termina el título (uno o dos
                            renglones) y la celda recorta lo que sobra. */}
                        {treePos === "parent" && (
                          <span aria-hidden className="relative block h-0">
                            <span className="pointer-events-none absolute left-1.5 top-0.5 h-40 border-l border-current opacity-40" />
                          </span>
                        )}
                        {provider && (
                          <span className="block text-[10px] font-semibold opacity-80 truncate">
                            {t("approvals.provider").replace("{name}", provider)}
                          </span>
                        )}
                        {r.kind === "SR" && r.status === "COMPLETED" && (
                          <span className="mt-0.5 inline-block rounded-full border border-fg/20 bg-fg/5 px-1.5 py-px text-[9.5px] font-extrabold text-fg/70">
                            {t(r.receptionConform === false ? "approvals.srClosedNc" : "approvals.srClosed")
                              .replace("{date}", fmtDate(r.receivedAt ?? null))}
                          </span>
                        )}
                      </td>
                      <td className={`${td} p-1 bg-surface`}><SignButton row={r} step="APRUEBA" /></td>
                      <td className={`${td} p-1 bg-surface`}><SignButton row={r} step="AUTORIZA" /></td>
                      {r.kind === "WO" && naCell}
                      {execCells(r)}
                    </tr>
                  </React.Fragment>
                );
              })}

              {visible.length === 0 && (
                <tr>
                  <td colSpan={COLS} className="px-4 py-12 text-center">
                    {loading ? (
                      <Loader2 className="w-5 h-5 animate-spin text-accent mx-auto" />
                    ) : rows.length > 0 ? (
                      // Hay filas, pero el filtro o la búsqueda las esconde:
                      // "Todo firmado" sería falso.
                      <>
                        <p className="text-sm font-bold text-fg">{t("approvals.filterEmpty")}</p>
                        <button type="button" onClick={() => { setCardFilter(""); clearBarFilters(); }}
                          className="mt-2 text-xs font-bold text-accent hover:underline">
                          {t("approvals.filterClear")}
                        </button>
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-bold text-fg">{t("approvals.allClear")}</p>
                        <p className="text-xs text-fg/40 mt-1">{t("approvals.emptyHint")}</p>
                      </>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {(alert ?? (error && !errorSeen ? t("approvals.loadError") : null)) && (
        <AlertDialog
          message={alert ?? t("approvals.loadError")}
          onClose={() => { setAlert(null); setErrorSeen(true); }}
        />
      )}

      {/* Lo firmado queda a la vista hasta recargar; el contador dice qué falta. */}
      {pendingCount === 0 && rows.length > 0 && (
        <p className="text-center text-xs text-fg/40">{t("approvals.allClear")}</p>
      )}

      {/* ─── Ventanas de las columnas de ejecución ─── */}
      {exec?.kind === "spares" && (
        <SpareConsumptionModal
          woId={exec.row.id}
          onClose={() => setExec(null)}
          onSaved={() => { void reload(); }}
        />
      )}
      <React.Suspense fallback={null}>
        {exec?.kind === "progress" && (
          <WorkOrderProgressModal
            workOrderId={exec.row.id}
            title={`${exec.row.code} — ${exec.row.title ?? ""}`}
            subtitle={exec.row.assetName}
            canOperate={!!can?.woOperate}
            onChanged={() => setProgressDirty(true)}
            onClose={() => { setExec(null); if (progressDirty) void reload(); }}
          />
        )}
        {exec?.kind === "permits" && (
          <WorkOrderPermitsModal
            workOrderId={exec.row.id}
            title={`${exec.row.code} — ${exec.row.title ?? ""}`}
            subtitle={exec.row.assetName}
            onChanged={() => setProgressDirty(true)}
            onClose={() => { setExec(null); if (progressDirty) void reload(); }}
          />
        )}
        {(exec?.kind === "close" || exec?.kind === "record") && (
          <WorkOrderPopup
            workOrderId={exec.row.id}
            focusClose={exec.kind === "close"}
            onClose={() => { void afterRecord(exec.row); }}
          />
        )}
        {(exec?.kind === "closeSr" || exec?.kind === "recordSr") && (
          <ServiceRequestPopup
            serviceRequestId={exec.row.id}
            focusReception={exec.kind === "closeSr"}
            onClose={() => { void afterRecord(exec.row); }}
          />
        )}
      </React.Suspense>

      {/* La hoja de ruta de la SS, la misma del formulario. Sin cierre por clic
          afuera: se sale por la X. */}
      {exec?.kind === "route" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-3xl bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl p-6 space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between gap-3 shrink-0">
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-fg truncate">{exec.row.code} — {exec.row.title ?? ""}</h2>
                <p className="text-xs text-text-industrial/50 mt-0.5 truncate">
                  {t("approvals.exec.hojaRuta")}{exec.row.providers[0] ? ` · ${exec.row.providers[0]}` : ""}
                </p>
              </div>
              <ModalCloseButton onClose={() => { setExec(null); if (progressDirty) void reload(); }} />
            </div>
            <div className="flex-1 min-h-[min(18rem,50vh)] overflow-y-auto">
              <HojaRutaBox srId={exec.row.id} editable={!!can?.srManage && !closedAtOf(exec.row)} isAdmin={user?.role === "TENANT_ADMIN"}
                variant="list" onChanged={() => setProgressDirty(true)} />
            </div>
          </div>
        </div>
      )}

      {/* Mandar al proveedor sale de la empresa: se confirma antes. */}
      {sendAsk && (
        <ConfirmDialog
          message={t("approvals.exec.sendConfirm")
            .replace("{code}", sendAsk.code)
            .replace("{provider}", sendAsk.providers[0] ?? "—")}
          confirmLabel={sendAsk.providers[0]
            ? t("ss.guide.sendProviderTo").replace("{provider}", sendAsk.providers[0])
            : t("approvals.exec.sendProvider")}
          cancelLabel={t("approvals.cancel")}
          onCancel={() => setSendAsk(null)}
          onConfirm={() => { const r = sendAsk; setSendAsk(null); void sendToProvider(r, false); }}
        />
      )}
      {samplesAsk && (
        <ConfirmDialog
          message={`${samplesAsk.message}\n\n${t("approvals.exec.sendAnywayQ")}`}
          confirmLabel={t("approvals.exec.sendAnyway")}
          cancelLabel={t("approvals.cancel")}
          onCancel={() => setSamplesAsk(null)}
          onConfirm={() => { const r = samplesAsk.row; setSamplesAsk(null); void sendToProvider(r, true); }}
        />
      )}
    </div>
  );
};
