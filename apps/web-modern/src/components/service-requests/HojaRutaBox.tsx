// HOJA DE RUTA DEL PEDIDO (REGI-LOG-01.3): FECHA | NOVEDAD | ASIENTA.
//
// Vive acá y no en pages/ServiceRequests.tsx porque hay dos entradas al mismo
// recuadro: el formulario de la SS y el "Registro de Avance" del Dashboard
// (ProgressFlow). Una sola implementación = una sola forma de asentar novedades.
//
// `variant="list"` (Seguimiento, prototipo hoja-de-ruta-v1 aprobado el
// 21-10-2026): las etapas de la solicitud arriba, el historial por día y la
// caja para registrar una novedad abajo, en la misma ventana. La del
// formulario sigue siendo la réplica del papel.

import React, { useEffect, useRef, useState } from "react";
import { DateInput } from "../DateField";
import { ArrowUp, Check, Loader2, Lock, MessageSquareText, MoreHorizontal, Pencil, Plus, Trash2, X } from "lucide-react";
import { useFetch } from "../../lib/hooks";
import { api } from "../../lib/api";
import { fmtDate } from "../../lib/utils";
import { useAuth } from "../../lib/auth";
import { useLocale, useT, type TranslationKey } from "../../lib/i18n";
import { SsTableHead } from "./SsPaperForm";
import { FormModal } from "../FormModal";
import { ConfirmDialog } from "../ConfirmDialog";
import { AlertDialog } from "../AlertDialog";
import { AutoTextArea } from "../AutoTextArea";
import { RequiredMark } from "../GuideKit";
import { CrewNameSelect } from "../CrewNameSelect";
import { useRoleHasPermission } from "../../lib/role-permissions";
import { eligibleSigners, SignerSelect, type TeamMember } from "./signers";

/** Campos de la ventana de corrección. */
const modalInputCls = "w-full bg-fg/5 border border-fg/10 rounded-lg px-3 py-2 text-sm text-fg focus:outline-none focus:border-accent/50";

/**
 * Fila de la HOJA DE RUTA DEL PEDIDO, tal como se imprime. Con `logId` = novedad
 * asentada a mano; con `hito` = paso que el sistema deriva de la SS. El admin
 * corrige las dos (ver buildHojaRuta en el backend).
 */
export interface HojaRutaRow {
  fecha: string;
  novedad: string;
  asienta: string;
  logId?: string;
  hito?: string;
  /** Texto del sistema sin el detalle ("Aprobada"). */
  hitoTexto?: string;
  detalle?: string | null;
  /** "firma" = firmante de la tramitación (lista del personal); "texto" = nombre suelto; sin valor = fijo. */
  asientaModo?: "firma" | "texto";
  firma?: "SOLICITA" | "APRUEBA" | "AUTORIZA";
  asientaUserId?: string | null;
}

/** La fecha tal como se ve en la fila (DD/MM/AAAA), en el formato del calendario. */
function fechaDeLaFila(fecha: string): string {
  const [d, m, y] = fmtDate(fecha).split("/");
  return y && m && d ? `${y}-${m}-${d}` : "";
}

/**
 * HOJA DE RUTA DEL PEDIDO — cómo se fue moviendo la solicitud.
 *
 * Muestra la hoja tal como se imprime: los hitos que el sistema asienta solo
 * (creada, aprobada, autorizada, enviada al taller, recibida) mezclados por
 * fecha con las novedades que carga la gente. El admin corrige las dos. En un
 * hito corrige la fecha y quién asienta en la propia SS (en Solicita, Aprueba y
 * Autoriza es el firmante, elegido de la lista del personal), y le puede sumar
 * un detalle al texto del sistema.
 */
export function HojaRutaBox({ srId, editable, isAdmin, variant = "paper", closed = false, onChanged }: {
  srId: string;
  editable: boolean;
  isAdmin: boolean;
  /** "paper" = réplica del formulario impreso; "list" = historial de Seguimiento. */
  variant?: "paper" | "list";
  /** Variante lista: la SS está cerrada (se avisa en vez de la caja para registrar). */
  closed?: boolean;
  /** Se asentó o borró una novedad (para refrescar contadores de afuera). */
  onChanged?: () => void;
}) {
  const t = useT();
  // `reload()` (no un contador en las deps): useFetch cachea por 30 s, así que
  // volver a pedir la misma URL devolvía la lista vieja y la novedad recién
  // asentada tardaba en aparecer. reload() siempre trae la del servidor.
  const { data, loading, reload } = useFetch<{ items: HojaRutaRow[]; vesselCode?: string }>(
    `/app/pms/service-requests/${srId}/hoja-ruta`,
    [srId],
  );
  const filas = data?.items ?? [];

  const [fecha, setFecha] = useState("");
  const [novedad, setNovedad] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Confirmación de borrado en la propia fila — sin ventana del navegador.
  const [confirmando, setConfirmando] = useState<string | null>(null);
  // Corrección de una fila (sólo admin). Novedad a mano: fecha, quién asienta y
  // texto. Paso del sistema: fecha, quién asienta (el firmante, si el paso lleva
  // firma) y un detalle que se suma al texto del sistema.
  const [editRow, setEditRow] = useState<HojaRutaRow | null>(null);
  const [eFecha, setEFecha] = useState("");
  const [eAsienta, setEAsienta] = useState("");
  const [eFirma, setEFirma] = useState({ name: "", userId: "" });
  const [eNovedad, setENovedad] = useState("");
  // Error de la corrección: en ventanita con OK, encima de la ventana abierta.
  const [editError, setEditError] = useState<string | null>(null);
  const asientaActual = (f: HojaRutaRow) => (f.asienta === "—" ? "" : f.asienta);
  const abrirEdicion = (f: HojaRutaRow) => {
    setEditRow(f);
    setEFecha(f.fecha ? fechaDeLaFila(f.fecha) : "");
    setEAsienta(asientaActual(f));
    setEFirma({ name: asientaActual(f), userId: f.asientaUserId ?? "" });
    setENovedad(f.hito ? f.detalle ?? "" : f.novedad);
  };
  const esHito = !!editRow?.hito;
  const modo = esHito ? editRow?.asientaModo : "texto";
  // Firmantes elegibles: sólo se piden al corregir un paso con firma.
  const conFirma = modo === "firma";
  const { data: teamData } = useFetch<TeamMember[]>(conFirma ? "/app/team/members" : null, [conFirma]);
  const roleHas = useRoleHasPermission(conFirma);
  const firmantes = conFirma && editRow?.firma
    ? eligibleSigners(Array.isArray(teamData) ? teamData : [], editRow.firma, data?.vesselCode ?? "", roleHas)
    : [];
  const guardarEdicion = async () => {
    if (!editRow?.logId && !editRow?.hito) return;
    if (esHito) {
      if (!eFecha) { setEditError(t("hr.step.dateRequired")); return; }
      if ((modo === "firma" && !eFirma.name) || (modo === "texto" && !eAsienta.trim())) {
        setEditError(t("hr.step.byRequired")); return;
      }
    } else if (!eFecha || !eAsienta.trim() || !eNovedad.trim()) {
      setEditError(t("wo.ssLog.required")); return;
    }
    setSaving(true);
    setEditError(null);
    try {
      if (editRow.hito) {
        // Quién asienta viaja sólo si cambió: en un paso con firma, cambiarlo es
        // cambiar el firmante de la SS.
        const asienta = modo === "firma" && eFirma.userId !== (editRow.asientaUserId ?? "")
          ? { asientaByName: eFirma.name, asientaUserId: eFirma.userId }
          : modo === "texto" && eAsienta.trim() !== asientaActual(editRow)
            ? { asientaByName: eAsienta.trim() }
            : {};
        await api.patch(`/app/pms/service-requests/${srId}/hoja-ruta/hito/${editRow.hito}`, {
          entryDate: eFecha, detalle: eNovedad.trim(), ...asienta,
        });
      } else {
        await api.patch(`/app/pms/service-requests/${srId}/hoja-ruta/${editRow.logId}`, {
          entryDate: eFecha, asientaByName: eAsienta.trim(), novedad: eNovedad.trim(),
        });
      }
      setEditRow(null);
      await reload();
      onChanged?.();
    } catch (e) {
      setEditError(e instanceof Error ? e.message : t("pn.saveError"));
    } finally {
      setSaving(false);
    }
  };
  const editModal = editRow && (
    <FormModal title={esHito ? t("hr.editStep") : t("hr.edit")} onClose={() => setEditRow(null)}
      footer={<>
        <button type="button" onClick={() => setEditRow(null)}
          className="px-4 py-2 rounded-xl border border-fg/10 text-xs font-bold text-text-industrial hover:border-accent/30">
          {t("common.cancel")}
        </button>
        <button type="button" onClick={() => { void guardarEdicion(); }} disabled={saving}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-accent text-accent-fg text-xs font-bold hover:brightness-110 disabled:opacity-50">
          {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} {t("common.save")}
        </button>
      </>}>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">{t("hr.col.date")}<RequiredMark /></label>
          <DateInput value={eFecha} onChange={e => setEFecha(e.target.value)}
            className="w-full bg-fg/5 border border-fg/10 rounded-lg px-3 py-2 text-sm text-fg focus:outline-none focus:border-accent/50" />
        </div>
        <div className="space-y-1.5">
          <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">{t("hr.col.by")}{modo && <RequiredMark />}</label>
          {modo === "firma" ? (<>
            <SignerSelect value={eFirma} onChange={setEFirma} options={firmantes} className={modalInputCls} />
            <p className="text-[10px] text-text-industrial/40">{t("hr.step.signerHint")}</p>
          </>) : modo === "texto" && esHito ? (
            <CrewNameSelect crew="any" value={eAsienta} onChange={setEAsienta} className={modalInputCls} />
          ) : modo === "texto" ? (
            <input value={eAsienta} onChange={e => setEAsienta(e.target.value)} className={modalInputCls} />
          ) : (<>
            <p className="w-full bg-fg/[0.03] border border-fg/10 rounded-lg px-3 py-2 text-sm text-text-industrial/70">{editRow.asienta}</p>
            <p className="text-[10px] text-text-industrial/40">{t("hr.step.byLocked")}</p>
          </>)}
        </div>
        <div className="space-y-1.5">
          <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">{t("hr.col.entry")}{!esHito && <RequiredMark />}</label>
          {esHito ? (<>
            {/* El texto del sistema queda; lo que se escribe se le suma detrás. */}
            <div className="flex items-start gap-2">
              <span className="shrink-0 py-2 text-sm italic text-text-industrial/70">{editRow.hitoTexto} —</span>
              <AutoTextArea rows={1} value={eNovedad} onChange={e => setENovedad(e.target.value)}
                placeholder={t("hr.step.detailPh")}
                className={`${modalInputCls} placeholder-text-industrial/30 resize-y`} />
            </div>
          </>) : (
            <AutoTextArea rows={3} value={eNovedad} onChange={e => setENovedad(e.target.value)}
              className="w-full bg-fg/5 border border-fg/10 rounded-lg px-3 py-2 text-sm text-fg focus:outline-none focus:border-accent/50 resize-y" />
          )}
        </div>
      </div>
      {editError && <AlertDialog message={editError} onClose={() => setEditError(null)} />}
    </FormModal>
  );

  const agregar = async (): Promise<boolean> => {
    if (!novedad.trim()) return false;
    setSaving(true);
    setError(null);
    try {
      // Sin fecha, el backend asienta la de hoy.
      await api.post(`/app/pms/service-requests/${srId}/hoja-ruta`, {
        entryDate: fecha || null,
        novedad: novedad.trim(),
      });
      setNovedad(""); setFecha("");
      await reload();
      onChanged?.();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo asentar la novedad.");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const borrar = async (logId: string) => {
    setError(null);
    try {
      await api.delete(`/app/pms/service-requests/${srId}/hoja-ruta/${logId}`);
      setConfirmando(null);
      await reload();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo borrar la novedad.");
    }
  };

  if (variant === "list") {
    return (
      <>
        <HojaRutaLista
          filas={filas} loading={loading} editable={editable} closed={closed} isAdmin={isAdmin}
          fecha={fecha} setFecha={setFecha} novedad={novedad} setNovedad={setNovedad}
          saving={saving} onAdd={agregar} onEdit={abrirEdicion} onDelete={setConfirmando} />
        {confirmando && (
          <ConfirmDialog
            message={t("hr.confirmDelete")}
            confirmLabel={t("common.delete")}
            cancelLabel={t("common.cancel")}
            onCancel={() => setConfirmando(null)}
            onConfirm={() => { void borrar(confirmando); }}
          />
        )}
        {editModal}
        {error && <AlertDialog message={error} onClose={() => setError(null)} />}
      </>
    );
  }

  // El papel nunca sale sin renglones: se completan hasta 3 para anotar a mano.
  const vacias = Math.max(0, 3 - filas.length);

  return (
    <>
      <SsTableHead cols={[
        { label: "FECHA", className: "w-28 shrink-0" },
        { label: "NOVEDAD", className: "flex-1" },
        { label: "ASIENTA", className: "w-44 shrink-0" },
      ]} />

      {loading && filas.length === 0 && (
        <div className="px-2 py-1.5 border-b border-fg/25 text-[11px] italic text-text-industrial/40">Cargando…</div>
      )}

      {filas.map((f, i) => (
        <div key={f.logId ?? `hito-${i}`} className="flex divide-x divide-fg/25 border-b border-fg/25">
          <div className="w-28 shrink-0 px-2 py-1 text-[12px] text-center tabular-nums text-text-industrial">{fmtDate(f.fecha)}</div>
          {/* En gris e italica, los hitos que el sistema asienta solo. */}
          <div className={`flex-1 min-w-0 px-2 py-1 text-[12px] ${f.logId ? "text-fg" : "text-text-industrial/60 italic"}`}>
            {f.novedad}
          </div>
          <div className="w-44 shrink-0 px-2 py-1 flex items-center gap-1">
            <span className="flex-1 min-w-0 truncate text-[12px] text-center text-text-industrial">{f.asienta}</span>
            {/* Los pasos no se borran: el hueco del tacho mantiene los nombres
                alineados con los de las novedades. */}
            {f.hito && isAdmin && (<>
              <button type="button" onClick={() => abrirEdicion(f)}
                className="shrink-0 text-text-industrial/30 hover:text-accent" title={t("hr.editStep")}>
                <Pencil className="w-3 h-3" />
              </button>
              <span className="w-3 shrink-0" aria-hidden />
            </>)}
            {f.logId && isAdmin && (
              confirmando === f.logId ? (
                <span className="shrink-0 flex items-center gap-1 text-[10px]">
                  <button type="button" onClick={() => { void borrar(f.logId!); }}
                    className="font-bold text-red-600 hover:underline">Borrar</button>
                  <span className="text-text-industrial/30">/</span>
                  <button type="button" onClick={() => setConfirmando(null)}
                    className="text-text-industrial/50 hover:underline">No</button>
                </span>
              ) : (
                <>
                  <button type="button" onClick={() => abrirEdicion(f)}
                    className="shrink-0 text-text-industrial/30 hover:text-accent" title={t("hr.edit")}>
                    <Pencil className="w-3 h-3" />
                  </button>
                  <button type="button" onClick={() => setConfirmando(f.logId!)}
                    className="shrink-0 text-text-industrial/30 hover:text-red-500" title="Borrar novedad">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </>
              )
            )}
          </div>
        </div>
      ))}

      {Array.from({ length: vacias }).map((_, i) => (
        <div key={`vacia-${i}`} className="flex divide-x divide-fg/25 border-b border-fg/25">
          <div className="w-28 shrink-0 px-2 py-1 text-[12px]">&nbsp;</div>
          <div className="flex-1 min-w-0 px-2 py-1" />
          <div className="w-44 shrink-0 px-2 py-1" />
        </div>
      ))}

      {editable && (
        <div className="flex divide-x divide-fg/25 border-b border-fg/25 bg-fg/5">
          <DateInput className="w-28 shrink-0 px-2 py-1 bg-transparent text-[12px] text-fg outline-none"
            value={fecha} onChange={e => setFecha(e.target.value)} title="Sin fecha = hoy" />
          <input className="flex-1 min-w-0 px-2 py-1 bg-transparent text-[12px] text-fg placeholder-text-industrial/30 outline-none"
            value={novedad}
            onChange={e => setNovedad(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void agregar(); } }}
            placeholder="Asentar una novedad del pedido (el taller reprogramó, falta un repuesto…)" />
          <button type="button" onClick={() => { void agregar(); }} disabled={saving || !novedad.trim()}
            className="w-44 shrink-0 flex items-center justify-center gap-1 px-2 py-1 text-[10px] font-bold text-accent hover:bg-accent/10 disabled:opacity-40">
            <Plus className="w-3 h-3" /> Asentar
          </button>
        </div>
      )}

      {error && (
        <p className="px-2 py-1.5 border-b border-fg/25 text-[10px] text-red-700 dark:text-red-400">{error}</p>
      )}
      {editModal}
    </>
  );
}

// ── Variante lista (Seguimiento) ─────────────────────────────────────────────

/** Etapas de la solicitud, en el orden de la tramitación. */
const ETAPAS: Array<{ hito: string; label: TranslationKey }> = [
  { hito: "CREADA", label: "hr.steps.created" },
  { hito: "APROBADA", label: "hr.steps.approved" },
  { hito: "AUTORIZADA", label: "hr.steps.authorized" },
  { hito: "ENVIADA", label: "hr.steps.atShop" },
  { hito: "RECIBIDA", label: "hr.steps.received" },
];

type EtapaEstado = "done" | "now" | "todo" | "bad";
const DOT_CLS: Record<EtapaEstado, string> = {
  done: "border-success bg-success text-white",
  now: "border-accent bg-accent/10 text-accent ring-4 ring-accent/10",
  bad: "border-danger bg-danger text-white",
  todo: "border-fg/15 bg-surface text-text-industrial/40",
};
const LABEL_CLS: Record<EtapaEstado, string> = {
  done: "text-fg", now: "text-accent", bad: "text-danger", todo: "font-semibold text-text-industrial/45",
};
const LOCALE_TAG: Record<string, string> = { es: "es-AR", en: "en-GB", pt: "pt-BR" };

/** Hoy, como valor de calendario (AAAA-MM-DD) del navegador. */
function hoyIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** DD/MM/AAAA → Date local (medianoche). */
function diaLocal(dmy: string): Date {
  const [d, m, y] = dmy.split("/").map(Number);
  return new Date(y!, m! - 1, d!);
}

/**
 * La hoja de ruta como historial: arriba en qué etapa está la solicitud, en el
 * medio lo que pasó agrupado por día (los pasos que asienta el sistema en un
 * renglón chico; lo que escribe la gente, destacado) y abajo la caja para
 * registrar una novedad sin abrir otra ventana. Corregir y borrar quedan para el
 * admin, en el menú "⋯" de cada renglón.
 */
function HojaRutaLista({ filas, loading, editable, closed, isAdmin, fecha, setFecha, novedad, setNovedad, saving, onAdd, onEdit, onDelete }: {
  filas: HojaRutaRow[];
  loading: boolean;
  editable: boolean;
  closed: boolean;
  isAdmin: boolean;
  fecha: string;
  setFecha: React.Dispatch<React.SetStateAction<string>>;
  novedad: string;
  setNovedad: React.Dispatch<React.SetStateAction<string>>;
  saving: boolean;
  onAdd: () => Promise<boolean>;
  onEdit: (f: HojaRutaRow) => void;
  onDelete: (logId: string) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const { user } = useAuth();
  const scrollRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const conocidas = useRef<Set<string> | null>(null);
  const esperandoNueva = useRef(false);
  const abierta = useRef(false);

  // Al abrir se ve lo último, junto a la caja para registrar.
  useEffect(() => {
    if (abierta.current || filas.length === 0) return;
    abierta.current = true;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [filas.length]);

  // La novedad recién registrada se marca un momento y se trae a la vista.
  useEffect(() => {
    const ids = new Set(filas.filter(f => f.logId).map(f => f.logId!));
    const antes = conocidas.current;
    conocidas.current = ids;
    if (!antes || !esperandoNueva.current) return;
    const nueva = [...ids].find(id => !antes.has(id));
    if (!nueva) return;
    esperandoNueva.current = false;
    setFlash(nueva);
    requestAnimationFrame(() => document.getElementById(`hr-${nueva}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  }, [filas]);
  useEffect(() => {
    if (!flash) return;
    const tm = setTimeout(() => setFlash(null), 1600);
    return () => clearTimeout(tm);
  }, [flash]);
  useEffect(() => {
    if (!saved) return;
    const tm = setTimeout(() => setSaved(false), 2200);
    return () => clearTimeout(tm);
  }, [saved]);

  // El menú "⋯" se cierra al hacer clic afuera o con Escape.
  useEffect(() => {
    if (!menu) return;
    const afuera = (e: MouseEvent) => { if (!(e.target as Element).closest?.("[data-hr-menu]")) setMenu(null); };
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(null); };
    document.addEventListener("mousedown", afuera);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", afuera); document.removeEventListener("keydown", escape); };
  }, [menu]);

  // La caja crece con el texto (hasta 10 renglones, después scrollea).
  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [novedad]);

  // ── Etapas ──
  const hitos = new Map(filas.filter(f => f.hito).map(f => [f.hito!, f]));
  const rechazada = hitos.get("RECHAZADA");
  const desde = (dmy: string) => {
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const n = Math.max(0, Math.round((hoy.getTime() - diaLocal(dmy).getTime()) / 86_400_000));
    return n === 0 ? t("hr.since.today") : n === 1 ? t("hr.since.one") : t("hr.since.n").replace("{n}", String(n));
  };
  let siguiente = true;   // la primera etapa sin hacer dice "Pendiente"; las demás, "—"
  const etapas = ETAPAS.map(e => {
    const f = hitos.get(e.hito);
    if (f) {
      const dmy = fmtDate(f.fecha);
      const enCurso = e.hito === "ENVIADA" && !hitos.has("RECIBIDA");
      return { label: t(e.label), estado: (enCurso ? "now" : "done") as EtapaEstado, sub: enCurso ? `${dmy} · ${desde(dmy)}` : dmy };
    }
    // No aprobada: ocupa el lugar del primer paso que no llegó a darse.
    if (rechazada && siguiente) {
      siguiente = false;
      return { label: t("hr.steps.rejected"), estado: "bad" as EtapaEstado, sub: fmtDate(rechazada.fecha) };
    }
    const sub = siguiente ? t("hr.steps.pending") : "—";
    siguiente = false;
    return { label: t(e.label), estado: "todo" as EtapaEstado, sub };
  });

  // ── Historial por día ──
  const hoyDmy = fmtDate(hoyIso());
  const diaSemana = (dmy: string) => diaLocal(dmy).toLocaleDateString(LOCALE_TAG[locale] ?? "es-AR", { weekday: "long" });
  const dias: Array<{ dia: string; filas: HojaRutaRow[] }> = [];
  for (const f of filas) {
    const dia = fmtDate(f.fecha);
    const ultimo = dias[dias.length - 1];
    if (ultimo && ultimo.dia === dia) ultimo.filas.push(f); else dias.push({ dia, filas: [f] });
  }
  const hayNovedades = filas.some(f => f.logId);

  const registrar = async () => {
    if (!novedad.trim() || saving) return;
    esperandoNueva.current = true;
    if (await onAdd()) { setSaved(true); textRef.current?.focus(); }
    else esperandoNueva.current = false;
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ol aria-label={t("hr.steps.aria")}
        className="grid shrink-0 grid-cols-1 gap-1.5 border-b border-fg/10 px-6 pb-4 pt-1 sm:grid-cols-5 sm:gap-0">
        {etapas.map((e, i) => (
          <li key={i} aria-current={e.estado === "now" ? "step" : undefined}
            className="relative flex items-center gap-3 sm:flex-col sm:gap-1 sm:text-center">
            {i < etapas.length - 1 && (
              <span aria-hidden
                className={`absolute left-[calc(50%+17px)] right-[calc(-50%+17px)] top-[13px] hidden h-0.5 sm:block ${e.estado === "done" ? "bg-success" : "bg-fg/10"}`} />
            )}
            <span className={`relative z-[1] grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 ${DOT_CLS[e.estado]}`}>
              {e.estado === "done" ? <Check className="h-4 w-4" strokeWidth={3} />
                : e.estado === "bad" ? <X className="h-4 w-4" strokeWidth={3} />
                : e.estado === "now" ? <span className="h-2 w-2 rounded-full bg-accent" /> : null}
            </span>
            <span className={`min-w-[7rem] text-[12.5px] font-bold leading-tight sm:min-w-0 ${LABEL_CLS[e.estado]}`}>{e.label}</span>
            <span className={`text-[11.5px] tabular-nums ${e.estado === "todo" ? "text-text-industrial/40" : "text-text-industrial/60"}`}>{e.sub}</span>
          </li>
        ))}
      </ol>

      <div ref={scrollRef} className="min-h-[10rem] flex-1 overflow-y-auto px-6 pb-2">
        {loading && filas.length === 0 ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-accent" /></div>
        ) : (<>
          {dias.map(d => (
            <section key={d.dia}>
              <h3 className="sticky top-0 z-[2] flex items-center gap-2.5 bg-surface pb-1.5 pt-3 text-xs font-bold tabular-nums text-text-industrial/60 after:h-px after:flex-1 after:bg-fg/10 after:content-[''] dark:bg-[#0D1B2A]">
                {d.dia === hoyDmy ? t("hr.today") : diaSemana(d.dia)} {d.dia}
              </h3>
              {d.filas.map((f, i) => {
                const paso = !f.logId;
                const key = f.logId ?? `hito-${f.hito ?? i}`;
                const rechazo = f.hito === "RECHAZADA";
                const conMenu = isAdmin && !!(f.logId || f.hito);
                return (
                  <div key={key} id={f.logId ? `hr-${f.logId}` : undefined}
                    className={`group relative grid grid-cols-[1.75rem_1fr_auto] gap-2.5 rounded-lg px-1.5 transition-colors duration-700 hover:bg-fg/[0.04] ${
                      paso ? "items-center py-1" : "items-start py-2"} ${flash && flash === f.logId ? "bg-accent/10" : ""}`}>
                    <span title={paso ? t("hr.systemHint") : t("hr.kind.note")}
                      className={paso
                        ? `ml-0.5 grid h-[22px] w-[22px] place-items-center rounded-full ${rechazo ? "bg-danger/10 text-danger" : "bg-success/10 text-success"}`
                        : "grid h-7 w-7 place-items-center rounded-lg bg-accent/10 text-accent"}>
                      {paso
                        ? (rechazo ? <X className="h-3 w-3" strokeWidth={3} /> : <Check className="h-3 w-3" strokeWidth={3} />)
                        : <MessageSquareText className="h-4 w-4" />}
                    </span>
                    <div className="min-w-0">
                      {paso ? (
                        <p className="text-[13px] font-semibold text-text-industrial/70 [overflow-wrap:anywhere]">
                          {f.novedad} <span className="font-normal text-text-industrial/45">· {f.asienta}</span>
                        </p>
                      ) : (<>
                        <p className="whitespace-pre-line text-sm leading-snug text-fg [overflow-wrap:anywhere]">{f.novedad}</p>
                        <p className="mt-0.5 text-xs text-text-industrial/55">{f.asienta}</p>
                      </>)}
                    </div>
                    {conMenu ? (
                      <div className="relative" data-hr-menu>
                        <button type="button" aria-label={t("hr.more")} title={t("hr.more")} aria-haspopup="menu" aria-expanded={menu === key}
                          onClick={() => setMenu(m => (m === key ? null : key))}
                          className={`grid h-7 w-7 place-items-center rounded-md text-text-industrial/45 hover:bg-fg/5 hover:text-fg [@media(hover:hover)]:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 ${menu === key ? "!opacity-100" : ""}`}>
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                        {menu === key && (
                          <div role="menu" className="absolute right-0 top-8 z-10 min-w-[11rem] rounded-xl border border-fg/10 bg-surface p-1 shadow-xl dark:bg-[#0D1B2A]">
                            <button type="button" role="menuitem" onClick={() => { setMenu(null); onEdit(f); }}
                              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-fg hover:bg-fg/5">
                              <Pencil className="h-3.5 w-3.5" /> {f.hito ? t("hr.editStep") : t("hr.edit")}
                            </button>
                            {f.logId && (
                              <button type="button" role="menuitem" onClick={() => { setMenu(null); onDelete(f.logId!); }}
                                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-red-700 hover:bg-red-500/10 dark:text-red-400">
                                <Trash2 className="h-3.5 w-3.5" /> {t("hr.delete")}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    ) : <span />}
                  </div>
                );
              })}
            </section>
          ))}
          {!hayNovedades && (
            <div className="px-4 py-8 text-center">
              <p className="text-[15px] font-bold text-fg">{t("hr.empty.title")}</p>
              {editable && <p className="mt-1 text-[13px] text-text-industrial/60">{t("hr.empty.hint")}</p>}
            </div>
          )}
        </>)}
      </div>

      {editable ? (
        <div className="shrink-0 border-t border-fg/10 px-6 pb-4 pt-3">
          <div className="mb-1.5 flex justify-between gap-2 text-xs font-bold text-text-industrial/60">
            <label htmlFor="hr-nueva">{t("hr.composer.title")}</label>
            {user?.name && <span className="truncate font-medium text-text-industrial/45">{t("hr.composer.by").replace("{name}", user.name)}</span>}
          </div>
          <div className="rounded-xl border border-fg/15 transition focus-within:border-accent focus-within:ring-[3px] focus-within:ring-accent/10">
            <textarea id="hr-nueva" ref={textRef} rows={1} value={novedad}
              onChange={e => setNovedad(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void registrar(); } }}
              placeholder={t("hr.composer.placeholder")}
              className="block max-h-40 w-full resize-none bg-transparent px-3 pb-1 pt-2.5 text-sm text-fg placeholder-text-industrial/35 focus:outline-none" />
            <div className="flex items-center gap-2 px-2 pb-2 pl-2.5">
              <DateInput aria-label={t("hr.composer.date")} title={t("hr.composer.date")}
                value={fecha || hoyIso()} onChange={e => setFecha(e.target.value)}
                className="w-[9.5rem] rounded-full border border-fg/15 bg-transparent px-3 py-1 text-[12.5px] text-text-industrial focus:border-accent/50 focus:outline-none" />
              <span className="flex-1 text-right text-[11.5px]" aria-live="polite">
                {saved
                  ? <span className="inline-flex items-center gap-1 font-semibold text-success"><Check className="h-3.5 w-3.5" /> {t("hr.composer.saved")}</span>
                  : <span className="hidden text-text-industrial/40 sm:inline">{t("hr.composer.hint")}</span>}
              </span>
              <button type="button" onClick={() => { void registrar(); }} disabled={saving || !novedad.trim()}
                className="flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-[13px] font-bold text-accent-fg hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />} {t("hr.composer.send")}
              </button>
            </div>
          </div>
        </div>
      ) : closed ? (
        <p className="flex shrink-0 items-center justify-center gap-2 border-t border-fg/10 px-6 py-3 text-[12.5px] text-text-industrial/60">
          <Lock className="h-4 w-4" /> {t("hr.closed")}
        </p>
      ) : null}
    </div>
  );
}
