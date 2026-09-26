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
import { useNavigate } from "react-router-dom";
import { AlertTriangle, ClipboardCheck, Hammer, Loader2, Pause, Pencil, Search } from "lucide-react";
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
const ServiceRequestPopup = React.lazy(() => import("./ServiceRequests").then(m => ({ default: m.ServiceRequestPopup })));

// ─── Espejo de approvals-service.ts ──────────────────────────────────────────

interface PendingItem {
  kind: "WO" | "SR";
  id: string;
  code: string;
  vesselCode: string;
  vesselName: string | null;
  assetName: string | null;
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
type ExecWindow = { kind: "progress" | "spares" | "close" | "route" | "closeSr"; row: Row };

/** Tarjeta de arriba que filtra la planilla. */
type CardKey = "overdue" | "mine" | "inProgress" | "postponed";

/** Respuesta de POST /service-requests/:id/send-to-provider. */
interface SendResult { sent: boolean; to: string[]; reason?: string; error?: string }

const rowKey = (r: { kind: string; id: string }) => `${r.kind}:${r.id}`;

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
const BTN_BASE = "w-full min-h-[29px] px-1.5 py-0.5 rounded-lg border-[1.5px] text-[10.5px] font-extrabold leading-tight flex flex-col items-center justify-center transition-all";
const BTN_ON   = `${BTN_BASE} bg-surface border-accent text-accent hover:bg-accent hover:text-accent-fg disabled:opacity-50`;
const BTN_DONE = `${BTN_BASE} bg-success/90 border-success text-white`;
const BTN_WAIT = `${BTN_BASE} border-dashed border-fg/20 text-fg/35`;
const BTN_OFF  = `${BTN_BASE} border-fg/15 text-fg/30`;

export const ApprovalsPage: React.FC = () => {
  const t = useT();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data, loading, error, reload } = useFetch<PendingApprovals>("/app/pms/approvals/pending");

  const [query, setQuery]     = useState("");
  const [cardFilter, setCardFilter] = useState<CardKey | "">("");
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
    const lines: string[] = [r.title ?? ""];
    const detail = cleanDetail(r.task);
    if (detail && detail !== (r.title ?? "").trim()) lines.push(detail);
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
    if (closed[rowKey(r)]) return false;   // cerrada en esta tanda: ya no cuenta
    const deferred = r.status === "ON_HOLD" || r.status === "DEFERRED";
    switch (key) {
      case "overdue":    return !deferred && (daysToDue(r.dueDate) ?? 0) < 0;
      // La próxima firma de la fila es mía: aprobar si falta, si no autorizar.
      case "mine":
        return approvedOf(r)
          ? !authorizedOf(r) && (r.kind === "WO" ? !!can?.woAuthorize : !!can?.srAuthorize)
          : (r.kind === "WO" ? !!can?.woApprove : !!can?.srApprove);
      // Trabajo iniciado: la OT en proceso, la SS ya mandada al taller.
      case "inProgress": return r.status === "IN_PROGRESS" || !!sent[rowKey(r)];
      case "postponed":  return deferred;
    }
  }, [closed, sent, approvedOf, authorizedOf, can]);

  const cards = useMemo(() => {
    const n = (key: CardKey) => (data ? rows.filter(r => cardMatch(r, key)).length : null);
    return [
      { key: "overdue"    as const, n: n("overdue"),    label: t("wo.sum.overdue"),    hint: t("wo.sum.overdueHint"),    icon: AlertTriangle, cls: "border-l-red-600",     num: "text-red-700 dark:text-red-400" },
      { key: "mine"       as const, n: n("mine"),       label: t("wo.sum.mySign"),     hint: t("wo.sum.mySignHint"),     icon: Pencil,        cls: "border-l-blue-600",    num: "text-blue-700 dark:text-blue-400" },
      { key: "inProgress" as const, n: n("inProgress"), label: t("wo.sum.inProgress"), hint: t("wo.sum.inProgressHint"), icon: Hammer,        cls: "border-l-emerald-600", num: "text-emerald-700 dark:text-emerald-400" },
      { key: "postponed"  as const, n: n("postponed"),  label: t("wo.sum.deferred"),   hint: t("wo.sum.deferredHint"),   icon: Pause,         cls: "border-l-yellow-600",  num: "text-yellow-700 dark:text-yellow-400" },
    ];
  }, [data, rows, cardMatch, t]);

  const visible = useMemo(() => {
    const q = query.trim();
    const byCard = cardFilter ? rows.filter(r => cardMatch(r, cardFilter)) : rows;
    const list = q
      ? byCard.filter(r => textMatches(
          [r.code, r.vesselName, r.assetName, r.title, r.task, r.workOrderCode, ...r.providers].filter(Boolean).join(" "),
          q,
        ))
      : byCard;
    // Ordenadas por buque y equipo: así las celdas combinadas de la planilla
    // agrupan de verdad, y dentro de cada equipo primero lo más urgente.
    return [...list].sort((a, b) =>
      (a.vesselName ?? a.vesselCode).localeCompare(b.vesselName ?? b.vesselCode)
      || (a.assetName ?? "").localeCompare(b.assetName ?? "")
      || ((daysToDue(a.dueDate) ?? 9e9) - (daysToDue(b.dueDate) ?? 9e9)));
  }, [rows, query, cardFilter, cardMatch]);

  const pendingCount = useMemo(
    () => rows.filter(r => !authorizedOf(r)).length,
    [rows, authorizedOf],
  );

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
  const openRecord = (r: Row) => {
    if (r.kind === "WO") navigate(`/work-orders/${encodeURIComponent(r.code)}`);
    else navigate(`/service-requests?openId=${encodeURIComponent(r.id)}`);
  };

  // ─── Estilos de la planilla de papel ───────────────────────────────────────
  // Encabezado sólido a propósito: es sticky y con fondo translúcido las filas
  // rojas se transparentan por debajo.
  const th = "px-2 py-1.5 text-[10px] font-bold text-[#1F3864] border border-border bg-[#D9E2E3] text-center";
  const td = "px-2 py-0.5 text-[11px] leading-tight border border-border align-middle";
  const COLS = 9;

  /** Uno de los dos botones de firma de la fila. */
  const SignButton: React.FC<{ row: Row; step: "APRUEBA" | "AUTORIZA" }> = ({ row, step }) => {
    const isAuth = step === "AUTORIZA";
    const done   = isAuth ? authorizedOf(row) : approvedOf(row);
    const allowed = isAuth ? canAuthorize(row) : canApprove(row);
    const word   = t(isAuth ? "approvals.action.authorize" : "approvals.action.approve");
    const past   = t(isAuth ? "approvals.signed.authorized" : "approvals.signed.approved");

    // Firmado: verde y FIJO. No existe des-aprobar (se revierte rechazando).
    if (done) {
      return (
        <span className={BTN_DONE} title={`${past} — ${done.by} · ${done.at}`}>
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
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : word}
      </button>
    );
  };

  /** Botón apagado de las columnas de ejecución, con el motivo abajo. */
  const execOff = (word: string, why: string, dashed: boolean) => (
    <span className={dashed ? BTN_WAIT : BTN_OFF} title={why}>
      <span className="uppercase">{word}</span>
      <span className="text-[9px] font-semibold">{why}</span>
    </span>
  );

  /** Las tres celdas de la derecha: AVANCES · REPUESTOS · CERRAR OT / SS. */
  const execCells = (r: Row) => {
    const cell = `${td} p-1 bg-surface`;
    // La SS: su avance es la HOJA DE RUTA, después se manda al proveedor (en la
    // columna de Repuestos, que no le aplica) y al volver el trabajo se cierra.
    if (r.kind === "SR") {
      const wRoute = t("approvals.exec.hojaRuta");
      const wSend  = t("approvals.exec.sendProvider");
      const wClose = t("approvals.exec.closeSr");
      const authorized = !!authorizedOf(r);
      const sentInfo = sent[rowKey(r)] ?? (r.sentAt ? { at: fmtDate(r.sentAt), to: "" } : null);
      const closedAt = closed[rowKey(r)];
      const waitWhy = t("approvals.pendingAuthorization");
      const sendLabel = r.providers[0] ? t("ss.guide.sendProviderTo").replace("{provider}", r.providers[0]) : wSend;
      return (
        <>
          <td className={cell}>
            {authorized ? (
              <button type="button" className={BTN_ON} onClick={() => setExec({ kind: "route", row: r })}>
                <span className="uppercase">{wRoute}</span>
              </button>
            ) : execOff(wRoute, waitWhy, true)}
          </td>
          <td className={cell}>
            {sentInfo ? (
              // Enviada: verde y fijo, como las firmas.
              <span className={BTN_DONE} title={sentInfo.to ? t("approvals.exec.sentTo").replace("{to}", sentInfo.to) : undefined}>
                <span className="uppercase">✓ {t("approvals.signed.sent")}</span>
                <span className="text-[9px] font-semibold opacity-90">{sentInfo.at}</span>
              </span>
            ) : !authorized ? execOff(wSend, waitWhy, true)
              : !can?.srManage ? execOff(wSend, t("approvals.noPermission"), false)
              : (
                <button type="button" className={BTN_ON} title={sendLabel} disabled={busyKey === rowKey(r)} onClick={() => setSendAsk(r)}>
                  {busyKey === rowKey(r)
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <span className="uppercase line-clamp-2">{sendLabel}</span>}
                </button>
              )}
          </td>
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
                  <span className="uppercase">{wClose}</span>
                </button>
              )}
          </td>
        </>
      );
    }
    const wProgress = t("approvals.col.progress");
    const wSpares   = t("approvals.col.spares");
    const wClose    = t("wo.modal.closeWO");
    const closedAt  = closed[rowKey(r)];
    if (closedAt) {
      const why = t("approvals.exec.woClosed");
      return (
        <>
          <td className={cell}>{execOff(wProgress, why, true)}</td>
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
          <td className={cell}>{execOff(wSpares, why, true)}</td>
          <td className={cell}>{execOff(wClose, why, true)}</td>
        </>
      );
    }
    const notes  = r.progressNoteCount ?? 0;
    const spares = r.spareUsageCount ?? 0;
    const noPerm = t("approvals.noPermission");
    return (
      <>
        {/* Avances se abre siempre: sin permiso de operar, la lista es de sólo lectura. */}
        <td className={cell}>
          <button type="button" className={BTN_ON} onClick={() => { setProgressDirty(false); setExec({ kind: "progress", row: r }); }}>
            <span className="uppercase">{wProgress}</span>
            <span className="text-[9px] font-semibold opacity-85">
              {notes === 0 ? t("approvals.exec.none")
                : notes === 1 ? t("approvals.exec.notesOne")
                : t("approvals.exec.notesMany").replace("{n}", String(notes))}
            </span>
          </button>
        </td>
        <td className={cell}>
          {can?.woManage ? (
            <button type="button" className={BTN_ON} onClick={() => setExec({ kind: "spares", row: r })}>
              <span className="uppercase">{wSpares}</span>
              <span className="text-[9px] font-semibold opacity-85">
                {spares === 0 ? t("approvals.exec.none")
                  : spares === 1 ? t("approvals.exec.sparesOne")
                  : t("approvals.exec.sparesMany").replace("{n}", String(spares))}
              </span>
            </button>
          ) : execOff(wSpares, noPerm, false)}
        </td>
        <td className={cell}>
          {can?.woOperate ? (
            <button type="button" className={BTN_ON} onClick={() => setExec({ kind: "close", row: r })}>
              <span className="uppercase">{wClose}</span>
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
      >
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-fg/30" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t("common.search")}
            className="pl-8 pr-2 py-1.5 w-48 rounded-lg bg-fg/5 border border-fg/10 text-xs text-fg focus:border-accent/40 focus:outline-none"
          />
        </div>
      </PageHeader>

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

      {/* Con qué nombre se firma. Va a la vista porque es el que se imprime en
          el PDF de la OT: el usuario tiene que saberlo ANTES de tocar el botón. */}
      <p className="flex items-center gap-2 px-3 py-2 rounded-xl bg-accent/8 border border-accent/25 text-xs text-fg/80">
        <ClipboardCheck className="w-3.5 h-3.5 text-accent shrink-0" />
        <span>{t("approvals.signsAsNotice").replace("{name}", signerName || "—")}</span>
      </p>

      <div className="glass rounded-2xl overflow-hidden">
        <div className="overflow-auto max-h-[calc(100vh-21rem)] [scrollbar-gutter:stable]">
          <table className="w-full table-fixed border-collapse">
            <colgroup>
              <col className="w-[40px]" /><col className="w-[130px]" /><col />
              <col className="w-[120px]" />
              <col className="w-[100px]" /><col className="w-[100px]" />
              <col className="w-[92px]" /><col className="w-[92px]" /><col className="w-[92px]" />
            </colgroup>
            <thead>
              <tr>
                <th className={th}>{t("approvals.col.item")}</th>
                <th className={th}>{t("approvals.equipment")}</th>
                <th className={th}>{t("approvals.task")}</th>
                <th className={th}>{t("approvals.col.record")}</th>
                <th className={th}>{t("approvals.action.approve")}</th>
                <th className={th}>{t("approvals.action.authorize")}</th>
                <th className={th}>{t("approvals.col.progress")}</th>
                <th className={th}>{t("approvals.col.spares")}</th>
                <th className={th}>{t("approvals.col.close")}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r, n) => {
                const prev = visible[n - 1];
                const vesselLabel = r.vesselName ?? r.vesselCode;
                const newVessel = !prev || (prev.vesselName ?? prev.vesselCode) !== vesselLabel;
                // Celda del equipo combinada entre sus tareas, como en el papel.
                const firstOfAsset = newVessel || prev!.assetName !== r.assetName;
                let span = 0;
                let itemNumber = 0;
                if (firstOfAsset) {
                  span = 1;
                  for (let m = n + 1; m < visible.length; m++) {
                    const x = visible[m]!;
                    if ((x.vesselName ?? x.vesselCode) !== vesselLabel || x.assetName !== r.assetName) break;
                    span++;
                  }
                  // Número de ítem: cuántos equipos van en este buque.
                  for (let m = 0; m <= n; m++) {
                    const x = visible[m]!;
                    if ((x.vesselName ?? x.vesselCode) !== vesselLabel) continue;
                    const p = visible[m - 1];
                    if (!p || (p.vesselName ?? p.vesselCode) !== vesselLabel || p.assetName !== x.assetName) itemNumber++;
                  }
                }
                const dd = daysToDue(r.dueDate);
                const isClosed = !!closed[rowKey(r)];
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

                return (
                  <React.Fragment key={rowKey(r)}>
                    {newVessel && (
                      <tr>
                        <td colSpan={COLS} className="px-3 py-1 text-[11px] font-bold text-white bg-[#1F3864] border border-[#1F3864]">
                          {vesselLabel}
                        </td>
                      </tr>
                    )}
                    <tr className="hover:brightness-[0.98]">
                      {firstOfAsset && (
                        <td rowSpan={span} className={`${td} text-center font-bold bg-surface text-fg`}>{itemNumber}</td>
                      )}
                      {firstOfAsset && (
                        <td rowSpan={span} className={`${td} text-center font-bold bg-[#F8CBAD] text-[#1F3864]`}>
                          {r.assetName ?? "—"}
                        </td>
                      )}
                      {/* Sólo el título, hasta dos renglones (pedido del usuario).
                          La descripción, el vencimiento y los vínculos quedan en
                          el globito. En la SS, además, el proveedor. */}
                      <td className={`${td} ${tone} align-top py-1`} title={tooltipOf(r)}>
                        <span className="font-bold line-clamp-2">{r.title ?? (cleanDetail(r.task) || "—")}</span>
                        {provider && (
                          <span className="block text-[10px] font-semibold opacity-80 truncate">
                            {t("approvals.provider").replace("{name}", provider)}
                          </span>
                        )}
                      </td>
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
                      <td className={`${td} p-1 bg-surface`}><SignButton row={r} step="APRUEBA" /></td>
                      <td className={`${td} p-1 bg-surface`}><SignButton row={r} step="AUTORIZA" /></td>
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
                        <button type="button" onClick={() => { setCardFilter(""); setQuery(""); }}
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

      {/* Qué significa cada botón: el estado no puede depender sólo del color. */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 glass rounded-2xl text-[11px] font-semibold text-fg/50">
        <span className="text-fg font-bold">{t("approvals.legend.title")}</span>
        {([
          ["bg-surface border-accent text-accent",   "approvals.action.approve",   "approvals.legend.canSign"],
          ["bg-success/90 border-success text-white", "approvals.signed.approved", "approvals.legend.done"],
          ["border-dashed border-fg/20 text-fg/35",  "approvals.action.authorize", "approvals.legend.waiting"],
          ["border-fg/15 text-fg/30",                "approvals.action.authorize", "approvals.legend.noPerm"],
        ] as const).map(([cls, sample, key]) => (
          <span key={key} className="flex items-center gap-1.5">
            <span className={`px-2 py-0.5 rounded-md border-[1.5px] text-[9.5px] font-extrabold ${cls}`}>
              {t(sample as TranslationKey)}
            </span>
            {t(key as TranslationKey)}
          </span>
        ))}
        <span className="ml-auto">{t("approvals.legend.rows")}</span>
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
        {exec?.kind === "close" && (
          <WorkOrderPopup
            workOrderId={exec.row.id}
            focusClose
            onClose={() => { void afterRecord(exec.row); }}
          />
        )}
        {exec?.kind === "closeSr" && (
          <ServiceRequestPopup
            serviceRequestId={exec.row.id}
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
              <ModalCloseButton onClose={() => setExec(null)} />
            </div>
            <div className="flex-1 overflow-y-auto">
              <HojaRutaBox srId={exec.row.id} editable={!!can?.srManage} isAdmin={user?.role === "TENANT_ADMIN"} />
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
