// AVANCES DE UNA OT, en la ventana de Seguimiento (prototipo avances-ot-v1,
// aprobado el 21-10-2026). Mismo esquema que la hoja de ruta de la SS: arriba
// en qué etapa está la OT y cuándo vence, en el medio lo que se hizo por día (con
// las fotos a la vista) y abajo la caja para registrar un avance sin abrir otra
// ventana. Registrar usa la misma lógica que la hoja del celular
// (useProgressComposer): dictado, adjuntos, sin señal y la pregunta de repuestos.
//
// La lista de Avances dentro del formulario de la OT (ProgressNotesPanel) no
// cambia.

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight, ArrowUp, Camera, Check, CheckCircle2, ChevronDown, Clock, CloudOff, FileText, Flag, LayoutGrid, List,
  Loader2, Lock, Mic, MoreHorizontal, Paperclip, Pencil, PenLine, Plus, Sparkles, Square, Trash2, Video as VideoIcon, X,
} from "lucide-react";
import { api, ApiError } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useFetch } from "../../lib/hooks";
import { useLocale, useT, useWoTerms, type TranslationKey } from "../../lib/i18n";
import { fmtDate, fmtTime } from "../../lib/utils";
import { usePendingProgress } from "../../lib/progress-outbox";
import { AuthedAudio, AuthedDocLink, AuthedImage, AuthedVideo } from "../../lib/authed-media";
import { QUICK_PHRASES, toLocalInput, useProgressComposer, type FollowUp, type When } from "../../mobile/ProgressNoteSheet";
import { ModalCloseButton } from "../ModalCloseButton";
import { ConfirmDialog } from "../ConfirmDialog";
import { AlertDialog } from "../AlertDialog";
import { AutoTextArea } from "../AutoTextArea";
import { AssigneeSelect } from "../AssigneeSelect";
import { DateInput, DateTimeInput } from "../DateField";
import { useVesselName } from "../EntityLabels";

interface ProgressNote {
  id: string;
  kind: "TEXT" | "PHOTO" | "VIDEO" | "AUDIO" | "DOCUMENT";
  text: string | null;
  fileUrl: string | null;
  createdAt: string;
  createdByUserId?: string | null;
  createdByName?: string | null;
}

/** Novedad de la hoja de ruta de una SS de la OT (se carga y se borra en la SS). */
interface SsLogEntry {
  fecha: string;
  novedad: string;
  asienta: string;
  logId?: string;
  serviceRequestId: string;
  serviceRequestCode: string;
}

/** Lo que la ventana usa de la OT. */
interface WoLite {
  workOrderCode: string;
  title: string | null;
  status: string;
  vesselCode: string;
  assetName: string | null;
  assetNames?: string[] | null;
  assignedToUserName: string | null;
  dueDate: string | null;
  openDate: string;
  aprobadoAt: string | null;
  autorizadoAt: string | null;
  startDate: string | null;
  completedDate: string | null;
}

/**
 * Un avance tal como lo cargó la persona. Con varias fotos el servidor guarda
 * una nota por archivo, con la misma fecha y autor, y el texto en la primera:
 * acá se vuelven a juntar en un solo avance.
 */
interface Avance { key: string; at: string; notes: ProgressNote[] }
type Item = { kind: "av"; at: number; av: Avance } | { kind: "ss"; at: number; ss: SsLogEntry };

function agrupar(notes: ProgressNote[]): Avance[] {
  const orden = [...notes].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const out: Avance[] = [];
  for (const n of orden) {
    const ultimo = out[out.length - 1];
    const primero = ultimo?.notes[0];
    if (ultimo && primero && primero.createdAt === n.createdAt
      && (primero.createdByUserId ?? "") === (n.createdByUserId ?? "") && !n.text?.trim() && !!n.fileUrl) {
      ultimo.notes.push(n);
    } else {
      out.push({ key: n.id, at: n.createdAt, notes: [n] });
    }
  }
  return out;
}

const esVisual = (n: ProgressNote) => (n.kind === "PHOTO" || n.kind === "VIDEO") && !!n.fileUrl;

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
const CERRADAS = ["CLOSED", "CANCELLED"];

/** DD/MM/AAAA → Date local (medianoche). */
function diaLocal(dmy: string): Date {
  const [d, m, y] = dmy.split("/").map(Number);
  return new Date(y!, m! - 1, d!);
}
/** Días de calendario entre hoy y una fecha DD/MM/AAAA (positivo = ya pasó). */
function diasDesde(dmy: string): number {
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  return Math.round((hoy.getTime() - diaLocal(dmy).getTime()) / 86_400_000);
}

export const WoProgressWindow: React.FC<{
  workOrderId: string;
  /** Lo que se muestra mientras llega la OT. */
  title: string;
  /** Operar la OT: registrar, corregir y borrar avances. Sin esto, sólo se ven. */
  canOperate: boolean;
  onClose: () => void;
  /** Se agregó, corrigió o borró un avance. */
  onChanged: () => void;
}> = ({ workOrderId, title, canOperate, onClose, onChanged }) => {
  const t = useT();
  const locale = useLocale();
  const woTerms = useWoTerms();
  const vesselName = useVesselName();
  const { user } = useAuth();
  // El admin corrige fecha, autor y texto de cualquier avance, y las novedades de las SS.
  const isAdmin = user?.role === "TENANT_ADMIN";
  const canEdit = canOperate || isAdmin;

  const { data: wo } = useFetch<WoLite>(`/app/pms/work-orders/${workOrderId}`, [workOrderId]);
  const { data, loading, reload } = useFetch<{ items: ProgressNote[]; serviceRequestLog?: SsLogEntry[] }>(
    `/app/pms/work-orders/${workOrderId}/progress-notes`, [workOrderId]);
  // Siempre fresca al abrir: los avances cambian desde el celular y la caché tiene 30 s.
  const fresca = useRef(false);
  useEffect(() => { if (!fresca.current) { fresca.current = true; void reload(); } }, [reload]);

  const notes = useMemo(() => data?.items ?? [], [data]);
  const avances = useMemo(() => agrupar(notes), [notes]);
  const items = useMemo<Item[]>(() => [
    ...avances.map(av => ({ kind: "av" as const, at: new Date(av.at).getTime(), av })),
    ...(data?.serviceRequestLog ?? []).map(ss => ({ kind: "ss" as const, at: new Date(ss.fecha).getTime(), ss })),
  ].sort((a, b) => a.at - b.at), [avances, data]);
  const visuales = notes.filter(esVisual);

  const cerrada = !!wo && CERRADAS.includes(wo.status);
  const puedeRegistrar = canOperate && !cerrada;

  const [vista, setVista] = useState<"list" | "grid">("list");
  const [menu, setMenu] = useState<string | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [borrar, setBorrar] = useState<Avance | null>(null);
  const [lightbox, setLightbox] = useState<ProgressNote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pop, setPop] = useState<"when" | "follow" | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const conocidas = useRef<Set<string> | null>(null);
  const esperandoNuevo = useRef(false);
  const abierta = useRef(false);

  const cambio = async () => { await reload(); onChanged(); };
  const pending = usePendingProgress(workOrderId, () => { void cambio(); });

  // ── Registrar (misma lógica que la hoja del celular) ──
  const alTerminar = useRef<() => void>(() => {});
  const c = useProgressComposer(
    workOrderId,
    () => { esperandoNuevo.current = true; void cambio(); },
    () => alTerminar.current(),
  );
  alTerminar.current = () => { c.resetForAnother(); setSaved(true); setPop(null); textRef.current?.focus(); };

  // Al abrir se ve lo último, junto a la caja para registrar.
  useEffect(() => {
    if (abierta.current || items.length === 0) return;
    abierta.current = true;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items.length]);

  // El avance recién registrado se marca un momento y se trae a la vista.
  useEffect(() => {
    const ids = new Set(avances.map(a => a.key));
    const antes = conocidas.current;
    conocidas.current = ids;
    if (!antes || !esperandoNuevo.current) return;
    const nuevo = [...ids].find(id => !antes.has(id));
    if (!nuevo) return;
    esperandoNuevo.current = false;
    setVista("list");
    setFlash(nuevo);
    requestAnimationFrame(() => document.getElementById(`av-${nuevo}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  }, [avances]);
  useEffect(() => { if (!flash) return; const tm = setTimeout(() => setFlash(null), 1600); return () => clearTimeout(tm); }, [flash]);
  useEffect(() => { if (!saved) return; const tm = setTimeout(() => setSaved(false), 2200); return () => clearTimeout(tm); }, [saved]);

  // Menús y desplegables se cierran al hacer clic afuera o con Escape.
  useEffect(() => {
    if (!menu && !pop) return;
    const afuera = (e: MouseEvent) => {
      const el = e.target as Element;
      if (menu && !el.closest?.("[data-av-menu]")) setMenu(null);
      if (pop && !el.closest?.("[data-av-pop]")) setPop(null);
    };
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") { setMenu(null); setPop(null); } };
    document.addEventListener("mousedown", afuera);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", afuera); document.removeEventListener("keydown", escape); };
  }, [menu, pop]);

  // La caja crece con el texto (hasta 10 renglones).
  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [c.text]);

  const desde = (dmy: string) => {
    const n = Math.max(0, diasDesde(dmy));
    return n === 0 ? t("hr.since.today") : n === 1 ? t("hr.since.one") : t("hr.since.n").replace("{n}", String(n));
  };

  // ── Etapas ──
  const etapas = useMemo(() => {
    if (!wo) return [];
    const primerAvance = avances[0]?.at ?? null;
    const inicio = wo.startDate ?? primerAvance;
    const enEjecucion = !!inicio || wo.status === "IN_PROGRESS" || wo.status === "ON_HOLD";
    const pasos: Array<{ label: string; fecha: string | null; llego: boolean }> = [
      { label: t("av.steps.created"), fecha: wo.openDate, llego: true },
      { label: t("av.steps.approved"), fecha: wo.aprobadoAt, llego: !!wo.aprobadoAt },
      { label: t("av.steps.authorized"), fecha: wo.autorizadoAt, llego: !!wo.autorizadoAt },
      { label: t(wo.status === "ON_HOLD" ? "av.steps.onHold" : "av.steps.running"), fecha: inicio, llego: enEjecucion },
      { label: t(wo.status === "CANCELLED" ? "av.steps.cancelled" : "av.steps.closed"), fecha: wo.completedDate, llego: cerrada },
    ];
    let siguiente = true;
    return pasos.map((p, i) => {
      const dmy = p.fecha ? fmtDate(p.fecha) : "";
      if (p.llego) {
        if (i === 4 && wo.status === "CANCELLED") return { label: p.label, estado: "bad" as EtapaEstado, sub: dmy || "—" };
        const ahora = i === 3 && !cerrada;
        return { label: p.label, estado: (ahora ? "now" : "done") as EtapaEstado, sub: ahora && dmy ? `${dmy} · ${desde(dmy)}` : dmy || "—" };
      }
      const sub = siguiente ? t("hr.steps.pending") : "—";
      siguiente = false;
      return { label: p.label, estado: "todo" as EtapaEstado, sub };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wo, avances, cerrada, t]);

  // ── Vencimiento ──
  const vence = (() => {
    if (!wo?.dueDate || cerrada) return null;
    const dmy = fmtDate(wo.dueDate);
    const n = diasDesde(dmy);
    if (n > 0) return { cls: "border-danger/35 bg-danger/10 text-danger", txt: t("av.due.overdue").replace("{d}", dmy).replace("{since}", desde(dmy)) };
    if (n === 0) return { cls: "border-warning/40 bg-warning/10 text-warning", txt: t("av.due.today") };
    const faltan = -n;
    if (faltan <= 3) return { cls: "border-warning/40 bg-warning/10 text-warning", txt: t(faltan === 1 ? "av.due.leftOne" : "av.due.left").replace("{d}", dmy).replace("{n}", String(faltan)) };
    return { cls: "border-fg/15 text-text-industrial/70", txt: t("av.due.on").replace("{d}", dmy) };
  })();

  // ── Historial por día ──
  const hoyDmy = fmtDate(new Date());
  const diaSemana = (dmy: string) => diaLocal(dmy).toLocaleDateString(LOCALE_TAG[locale] ?? "es-AR", { weekday: "long" });
  const dias: Array<{ dia: string; items: Item[] }> = [];
  for (const it of items) {
    // Como texto ISO, igual que llega del servidor: las fechas solas de la hoja
    // de ruta (medianoche UTC) no se corren al día anterior.
    const dia = fmtDate(new Date(it.at).toISOString());
    const ultimo = dias[dias.length - 1];
    if (ultimo && ultimo.dia === dia) ultimo.items.push(it); else dias.push({ dia, items: [it] });
  }

  // "Cómo sigue" viaja al final del texto ("Cómo sigue: Espera repuesto."): se muestra como etiqueta.
  const SEGUIMIENTO: Array<{ k: Exclude<FollowUp, "">; cls: string }> = [
    { k: "going", cls: "bg-accent/10 text-accent" },
    { k: "waitSpare", cls: "bg-warning/10 text-warning" },
    { k: "ready", cls: "bg-success/10 text-success" },
  ];
  const separarSeguimiento = (texto: string): { cuerpo: string; seg: { label: string; cls: string } | null } => {
    const lineas = texto.split("\n");
    const ultima = lineas[lineas.length - 1]?.trim() ?? "";
    const pref = t("pn.followPrefix");
    for (const s of SEGUIMIENTO) {
      const label = t(`pn.follow.${s.k}` as TranslationKey);
      if (ultima === `${pref} ${label}.`) return { cuerpo: lineas.slice(0, -1).join("\n").trim(), seg: { label, cls: s.cls } };
    }
    return { cuerpo: texto, seg: null };
  };

  const borrarAvance = async (av: Avance) => {
    setBorrar(null);
    try {
      for (const n of av.notes) await api.delete(`/app/pms/work-orders/${workOrderId}/progress-notes/${n.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("error.deleteProgress"));
    } finally {
      await cambio();
    }
  };

  const registrar = () => { if (c.canSave) void c.handleSave(); };
  const chipCls = (on: boolean) => `shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 text-[12.5px] font-semibold transition-colors ${
    on ? "border-fg bg-fg text-surface" : "border-fg/10 bg-surface text-fg hover:border-fg/25"}`;
  const toolCls = "inline-flex items-center gap-1.5 rounded-full border border-fg/15 bg-surface px-2.5 py-1 text-[12.5px] text-text-industrial/70 hover:border-accent/40 hover:text-fg";
  const abbr = woTerms.abbr;
  const assets = (wo?.assetNames ?? []).filter(Boolean);

  return (
    // Sin cierre por clic afuera, como el resto de las ventanas de carga.
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-3xl bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Qué OT es, en qué anda y cuándo vence. */}
        <div className="flex items-start gap-3 shrink-0 px-6 pt-5 pb-3">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-widest text-text-industrial/45">{t("av.title")}</p>
            <h2 className="mt-0.5 text-[17px] font-extrabold leading-snug text-fg line-clamp-2">{wo?.title || title}</h2>
            {wo && (<>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="rounded-full border border-fg/15 px-2 py-px font-mono text-[11.5px] text-fg">{wo.workOrderCode}</span>
                {etapas.length > 0 && (() => {
                  const actual = [...etapas].reverse().find(e => e.estado !== "todo") ?? etapas[0]!;
                  const cls = actual.estado === "bad" ? "border-danger/35 bg-danger/10 text-danger"
                    : actual.estado === "done" && cerrada ? "border-success/35 bg-success/10 text-success"
                    : "border-accent/30 bg-accent/10 text-accent";
                  return <span className={`rounded-full border px-2 py-px text-[12px] font-bold ${cls}`}>{actual.label}</span>;
                })()}
                {vence && (
                  <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-px text-[12px] font-semibold ${vence.cls}`}>
                    <Clock className="h-3.5 w-3.5" /> {vence.txt}
                  </span>
                )}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[12.5px] text-text-industrial/60">
                <span>{t("hr.head.vessel")} <b className="font-semibold text-fg">{vesselName(wo.vesselCode)}</b></span>
                {(assets.length > 1 || wo.assetName) && (
                  <span title={assets.length > 1 ? assets.join(", ") : undefined}>{t("hr.head.asset")} <b className="font-semibold text-fg">
                    {assets.length > 1 ? t("wo.multiAsset").replace("{n}", String(assets.length)) : wo.assetName}</b></span>
                )}
                {wo.assignedToUserName && <span>{t("av.head.assignee")} <b className="font-semibold text-fg">{wo.assignedToUserName}</b></span>}
              </div>
            </>)}
          </div>
          <ModalCloseButton onClose={() => { c.stopDictation(); onClose(); }} />
        </div>

        {etapas.length > 0 && (
          <ol aria-label={t("av.steps.aria").replace("{abbr}", abbr)}
            className="grid shrink-0 grid-cols-5 border-b border-fg/10 px-6 pb-4 pt-1">
            {etapas.map((e, i) => (
              <li key={i} aria-current={e.estado === "now" ? "step" : undefined}
                className="relative flex flex-col items-center gap-1 text-center">
                {i < etapas.length - 1 && (
                  <span aria-hidden className={`absolute left-[calc(50%+13px)] right-[calc(-50%+13px)] top-[10px] h-0.5 sm:left-[calc(50%+17px)] sm:right-[calc(-50%+17px)] sm:top-[13px] ${
                    e.estado === "done" ? "bg-success" : "bg-fg/10"}`} />
                )}
                <span className={`relative z-[1] grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full border-2 sm:h-7 sm:w-7 ${DOT_CLS[e.estado]}`}>
                  {e.estado === "done" ? <Check className="h-3 w-3 sm:h-4 sm:w-4" strokeWidth={3} />
                    : e.estado === "bad" ? <X className="h-3 w-3 sm:h-4 sm:w-4" strokeWidth={3} />
                    : e.estado === "now" ? <span className="h-2 w-2 rounded-full bg-accent" /> : null}
                </span>
                {/* En el celular sólo la etapa actual lleva nombre: los puntos dicen el resto. */}
                <span className={`text-[11px] font-bold leading-tight whitespace-nowrap sm:text-[12.5px] sm:whitespace-normal ${
                  e.estado === "now" ? "" : "hidden sm:block"} ${LABEL_CLS[e.estado]}`}>{e.label}</span>
                <span className={`hidden text-[11.5px] tabular-nums sm:block ${e.estado === "todo" ? "text-text-industrial/40" : "text-text-industrial/60"}`}>{e.sub}</span>
              </li>
            ))}
          </ol>
        )}

        <div className="flex shrink-0 items-center justify-between gap-2 px-6 pt-2">
          <span className="text-xs font-bold text-text-industrial/60">
            {avances.length === 1 ? t("av.count.one") : t("av.count.n").replace("{n}", String(avances.length))}
          </span>
          {visuales.length > 0 && (
            <div className="flex items-center gap-0.5 rounded-lg border border-fg/10 p-0.5" role="group">
              <button type="button" aria-pressed={vista === "list"} onClick={() => setVista("list")}
                className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold ${vista === "list" ? "bg-fg/10 text-fg" : "text-text-industrial/50 hover:text-fg"}`}>
                <List className="h-3.5 w-3.5" /> {t("av.view.history")}
              </button>
              <button type="button" aria-pressed={vista === "grid"} onClick={() => setVista("grid")}
                className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold ${vista === "grid" ? "bg-fg/10 text-fg" : "text-text-industrial/50 hover:text-fg"}`}>
                <LayoutGrid className="h-3.5 w-3.5" /> {t("av.view.photos").replace("{n}", String(visuales.length))}
              </button>
            </div>
          )}
        </div>

        <div ref={scrollRef} className="min-h-[8rem] flex-1 overflow-y-auto px-6 pb-2">
          {loading && items.length === 0 ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-accent" /></div>
          ) : vista === "grid" && visuales.length > 0 ? (
            <div className="grid grid-cols-2 gap-2 py-3 sm:grid-cols-3 md:grid-cols-4">
              {visuales.map(n => (
                <button key={n.id} type="button" onClick={() => setLightbox(n)}
                  className="group relative aspect-square overflow-hidden rounded-lg border border-fg/10 bg-fg/5 hover:border-accent/40">
                  {n.kind === "PHOTO"
                    ? <AuthedImage src={n.fileUrl!} alt="" className="h-full w-full object-cover" />
                    : <><AuthedVideo src={n.fileUrl!} className="h-full w-full object-cover" muted />
                        <span className="absolute inset-0 flex items-center justify-center bg-black/30"><VideoIcon className="h-6 w-6 text-white drop-shadow" /></span></>}
                  <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-2 pb-1 pt-3 text-left text-[10.5px] text-white">
                    {fmtDate(n.createdAt)} {fmtTime(n.createdAt)}
                  </span>
                </button>
              ))}
            </div>
          ) : (<>
            {dias.map(d => (
              <section key={d.dia}>
                <h3 className="sticky top-0 z-[2] flex items-center gap-2.5 bg-surface pb-1.5 pt-3 text-xs font-bold tabular-nums text-text-industrial/60 after:h-px after:flex-1 after:bg-fg/10 after:content-[''] dark:bg-[#0D1B2A]">
                  {d.dia === hoyDmy ? t("hr.today") : diaSemana(d.dia)} {d.dia}
                </h3>
                {d.items.map(it => it.kind === "ss"
                  ? <SsLinea key={`ss-${it.ss.serviceRequestId}-${it.ss.logId ?? it.at}`} entry={it.ss} canEdit={isAdmin}
                      menu={menu} setMenu={setMenu} onSaved={cambio} />
                  : editando === it.av.key
                    ? <AvanceEditor key={it.av.key} av={it.av} canEditAuthor={isAdmin} workOrderId={workOrderId}
                        onCancel={() => setEditando(null)} onSaved={async () => { setEditando(null); await cambio(); }} />
                    : <AvanceItem key={it.av.key} av={it.av} flash={flash === it.av.key}
                        separar={separarSeguimiento} onOpenMedia={setLightbox}
                        menu={menu} setMenu={setMenu}
                        onEdit={canEdit && !cerrada ? () => { setMenu(null); setEditando(it.av.key); } : undefined}
                        onDelete={canOperate && !cerrada ? () => { setMenu(null); setBorrar(it.av); } : undefined} />)}
              </section>
            ))}
            {avances.length === 0 && (
              <div className="px-4 py-8 text-center">
                <p className="text-[15px] font-bold text-fg">{t("av.empty.title")}</p>
                {puedeRegistrar && <p className="mt-1 text-[13px] text-text-industrial/60">{t("av.empty.hint")}</p>}
              </div>
            )}
          </>)}
        </div>

        {/* ── Registrar avance ── */}
        {puedeRegistrar ? (
          <div className="shrink-0 border-t border-fg/10 px-6 pb-4 pt-3">
            {pending > 0 && (
              <p className="mb-2 flex items-center gap-1.5 rounded-lg bg-warning/10 px-2.5 py-1.5 text-[12px] font-semibold text-warning">
                <CloudOff className="h-3.5 w-3.5" /> {t("pn.pendingThisWo").replace("{n}", String(pending))}
              </p>
            )}
            {c.stage === "spares" ? (
              <div className="space-y-2 rounded-xl border border-violet-500/35 bg-violet-500/[0.06] p-3">
                <p className="flex items-center gap-1.5 text-sm font-extrabold text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="h-4 w-4" /> {t("pn.savedTitle")}</p>
                <p className="flex items-center gap-1.5 text-sm font-extrabold text-violet-700 dark:text-violet-300"><Sparkles className="h-4 w-4" /> {t("pn.sparesTitle")}</p>
                <p className="text-xs text-text-industrial/70">{t("pn.sparesDesc")}</p>
                {c.detected.map(d => (
                  <label key={d.spareId} className="flex cursor-pointer items-center gap-2 rounded-lg border border-fg/10 bg-surface px-2.5 py-2 text-sm">
                    <input type="checkbox" checked={c.picked.has(d.spareId)} className="h-4 w-4 accent-violet-600"
                      onChange={() => c.setPicked(prev => { const n = new Set(prev); if (n.has(d.spareId)) n.delete(d.spareId); else n.add(d.spareId); return n; })} />
                    <b className="text-fg">{d.quantity} {d.unit}</b>
                    <span className="min-w-0 flex-1 truncate text-fg">{d.name}</span>
                    <span className="font-mono text-[10.5px] text-text-industrial/50">{d.sku}</span>
                  </label>
                ))}
                <div className="flex justify-end gap-2 pt-1">
                  <button type="button" disabled={c.confirming} onClick={() => { void c.confirmSpares(false); }}
                    className="rounded-lg border border-fg/15 bg-surface px-3.5 py-2 text-[13px] font-bold text-fg">{t("pn.sparesNo")}</button>
                  <button type="button" disabled={c.confirming || c.picked.size === 0} onClick={() => { void c.confirmSpares(true); }}
                    className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3.5 py-2 text-[13px] font-bold text-white disabled:opacity-45">
                    {c.confirming && <Loader2 className="h-4 w-4 animate-spin" />} {t("pn.sparesYes")}
                  </button>
                </div>
              </div>
            ) : c.stage === "queued" ? (
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-warning/35 bg-warning/10 p-3">
                <CloudOff className="h-5 w-5 shrink-0 text-warning" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-fg">{t("pn.queuedTitle")}</p>
                  <p className="text-xs text-text-industrial/70">{t("pn.queuedDesc")}</p>
                </div>
                <button type="button" onClick={c.resetForAnother}
                  className="flex items-center gap-1.5 rounded-lg border border-fg/15 bg-surface px-3 py-1.5 text-[13px] font-bold text-fg">
                  <Plus className="h-4 w-4" /> {t("pn.another")}
                </button>
              </div>
            ) : (<>
              <div className="mb-1.5 flex justify-between gap-2 text-xs font-bold text-text-industrial/60">
                <label htmlFor="av-composer">{t("pn.title")}</label>
                {user?.name && <span className="truncate font-medium text-text-industrial/45">{t("av.by").replace("{name}", user.name)}</span>}
              </div>
              <div className="flex gap-1.5 overflow-x-auto pb-1.5" role="group" aria-label={t("pn.quick")}>
                {QUICK_PHRASES.map(k => { const label = t(k); return (
                  <button key={k} type="button" aria-pressed={c.phrases.includes(label)} onClick={() => { c.togglePhrase(label); textRef.current?.focus(); }}
                    className={chipCls(c.phrases.includes(label))}>{label}</button>
                ); })}
              </div>
              <div className="rounded-xl border border-fg/15 transition focus-within:border-accent focus-within:ring-[3px] focus-within:ring-accent/10">
                <textarea id="av-composer" ref={textRef} rows={1} value={c.text}
                  onChange={e => c.setText(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); registrar(); } }}
                  placeholder={t("av.placeholder")}
                  className="block max-h-40 w-full resize-none bg-transparent px-3 pb-1 pt-2.5 text-sm text-fg placeholder-text-industrial/35 focus:outline-none" />
                {c.interim && <p className="px-3 text-xs italic text-text-industrial/50">{c.interim}…</p>}
                {c.files.length > 0 && (
                  <div className="flex flex-wrap gap-2 px-3 pb-1 pt-1.5">
                    {c.files.map(f => (
                      <div key={f.key} className="relative flex h-[52px] min-w-[52px] items-center justify-center overflow-hidden rounded-lg border border-fg/10 bg-fg/5">
                        {f.preview ? <img src={f.preview} alt="" className="h-[52px] w-[52px] object-cover" />
                          : <span className="flex max-w-[9rem] items-center gap-1 px-2 text-[11px] text-fg"><FileText className="h-4 w-4 shrink-0 text-accent" /><span className="truncate">{f.file.name}</span></span>}
                        <button type="button" onClick={() => c.removeFile(f.key)} aria-label={t("av.removeAttachment")}
                          className="absolute right-0.5 top-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-rose-600 text-white">
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-1.5 px-2 pb-2 pt-1">
                  {c.SR_AVAILABLE && (
                    <button type="button" onClick={c.dictating ? c.stopDictation : c.startDictation} title={t("pn.dictate")}
                      className={c.dictating ? `${toolCls} !border-red-500 !bg-red-500/10 !text-red-600 animate-pulse` : toolCls}>
                      {c.dictating ? <Square className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
                      <span className="hidden sm:inline">{c.dictating ? t("pn.dictating") : t("pn.dictate")}</span>
                    </button>
                  )}
                  <label className={`${toolCls} cursor-pointer`} title={t("pn.photo")}>
                    {c.compressing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
                    <span className="hidden sm:inline">{t("pn.photo")}</span>
                    <input type="file" accept="image/*" capture="environment" multiple className="hidden"
                      onChange={e => { void c.addFiles(e.target.files, "photo"); e.target.value = ""; }} />
                  </label>
                  <label className={`${toolCls} cursor-pointer`} title={t("pn.file")}>
                    <Paperclip className="h-3.5 w-3.5" /> <span className="hidden sm:inline">{t("pn.file")}</span>
                    {/* ZIP: un informe con sus anexos en un solo archivo. */}
                    <input type="file" accept="application/pdf,image/*,.zip,application/zip,application/x-zip-compressed" multiple className="hidden"
                      onChange={e => { void c.addFiles(e.target.files, "file"); e.target.value = ""; }} />
                  </label>
                  <span className="relative" data-av-pop>
                    <button type="button" className={toolCls} aria-haspopup="menu" aria-expanded={pop === "when"} title={t("pn.when")}
                      onClick={() => setPop(p => (p === "when" ? null : "when"))}>
                      <Clock className="h-3.5 w-3.5" />
                      {c.when === "other" && c.otherWhen ? `${fmtDate(new Date(c.otherWhen))} ${fmtTime(new Date(c.otherWhen))}` : t(`pn.when.${c.when}` as TranslationKey)}
                      <ChevronDown className="h-3 w-3" />
                    </button>
                    {pop === "when" && (
                      <div role="menu" className="absolute bottom-9 left-0 z-10 min-w-[13rem] rounded-xl border border-fg/10 bg-surface p-1 shadow-xl dark:bg-[#0D1B2A]">
                        {(["now", "morning", "yesterday", "other"] as When[]).map(k => (
                          <button key={k} type="button" role="menuitemradio" aria-checked={c.when === k}
                            onClick={() => { c.setWhen(k); if (k !== "other") setPop(null); }}
                            className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-fg/5 ${c.when === k ? "font-bold text-accent" : "text-fg"}`}>
                            {t(`pn.when.${k}` as TranslationKey)}
                          </button>
                        ))}
                        {c.when === "other" && (
                          <DateTimeInput value={c.otherWhen} max={toLocalInput(new Date())} onChange={e => c.setOtherWhen(e.target.value)}
                            className="m-1 w-[calc(100%-0.5rem)] rounded-lg border border-fg/15 bg-surface px-2.5 py-1.5 text-[13px] text-fg focus:border-accent/50 focus:outline-none" />
                        )}
                      </div>
                    )}
                  </span>
                  <span className="relative" data-av-pop>
                    <button type="button" className={toolCls} aria-haspopup="menu" aria-expanded={pop === "follow"} title={t("pn.follow")}
                      onClick={() => setPop(p => (p === "follow" ? null : "follow"))}>
                      <Flag className="h-3.5 w-3.5" />
                      {c.followUp ? t(`pn.follow.${c.followUp}` as TranslationKey) : t("av.followAsk")}
                      <ChevronDown className="h-3 w-3" />
                    </button>
                    {pop === "follow" && (
                      <div role="menu" className="absolute bottom-9 left-0 z-10 min-w-[12rem] rounded-xl border border-fg/10 bg-surface p-1 shadow-xl dark:bg-[#0D1B2A]">
                        {(["", "going", "waitSpare", "ready"] as FollowUp[]).map(k => (
                          <button key={k || "none"} type="button" role="menuitemradio" aria-checked={c.followUp === k}
                            onClick={() => { c.setFollowUp(k); setPop(null); }}
                            className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-fg/5 ${c.followUp === k ? "font-bold text-accent" : "text-fg"}`}>
                            {k ? t(`pn.follow.${k}` as TranslationKey) : t("av.followNone")}
                          </button>
                        ))}
                      </div>
                    )}
                  </span>
                  <span className="flex-1" />
                  <button type="button" onClick={registrar} disabled={!c.canSave}
                    className="flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-[13px] font-bold text-accent-fg hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40">
                    {c.saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
                    {t("hr.composer.send")}{c.files.length > 0 ? ` · ${t(c.files.length === 1 ? "pn.oneAttachment" : "pn.nAttachments").replace("{n}", String(c.files.length))}` : ""}
                  </button>
                </div>
              </div>
              <p className="pt-1.5 text-[11.5px]" aria-live="polite">
                {saved
                  ? <span className="inline-flex items-center gap-1 font-semibold text-success"><Check className="h-3.5 w-3.5" /> {t("av.saved")}</span>
                  : <span className="hidden text-text-industrial/40 sm:inline">{t("hr.composer.hint")}</span>}
              </p>
            </>)}
          </div>
        ) : cerrada ? (
          <p className="flex shrink-0 items-center justify-center gap-2 border-t border-fg/10 px-6 py-3 text-[12.5px] text-text-industrial/60">
            <Lock className="h-4 w-4" /> {t("av.closed").replace("{abbr}", abbr)}
          </p>
        ) : null}
      </div>

      {borrar && (
        <ConfirmDialog
          message={borrar.notes.length > 1 ? t("av.confirmDeleteN").replace("{n}", String(borrar.notes.filter(n => n.fileUrl).length)) : t("pn.confirmDelete")}
          confirmLabel={t("common.delete")}
          cancelLabel={t("common.cancel")}
          onCancel={() => setBorrar(null)}
          onConfirm={() => { void borrarAvance(borrar); }}
        />
      )}
      {error && <AlertDialog message={error} onClose={() => setError(null)} />}
      {c.err && <AlertDialog message={c.err} onClose={() => c.setErr(null)} />}

      {/* La foto o el video, en grande (el mismo visor de la ficha). */}
      {lightbox && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm" onClick={() => setLightbox(null)}>
          <ModalCloseButton onClose={() => setLightbox(null)} className="absolute right-4 top-4 z-10" />
          <div className="flex max-h-full max-w-5xl flex-col items-center gap-2" onClick={e => e.stopPropagation()}>
            {lightbox.kind === "PHOTO"
              ? <AuthedImage src={lightbox.fileUrl!} alt="" className="max-h-[85vh] rounded-lg object-contain" />
              : <AuthedVideo src={lightbox.fileUrl!} controls autoPlay className="max-h-[85vh] rounded-lg" />}
            {lightbox.text && <p className="max-w-2xl whitespace-pre-line text-center text-sm text-white/90">{lightbox.text}</p>}
            <p className="text-[11px] text-white/50">{fmtDate(lightbox.createdAt)} {fmtTime(lightbox.createdAt)}</p>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Un avance en el historial ────────────────────────────────────────────────

const AvanceItem: React.FC<{
  av: Avance;
  flash: boolean;
  separar: (texto: string) => { cuerpo: string; seg: { label: string; cls: string } | null };
  onOpenMedia: (n: ProgressNote) => void;
  menu: string | null;
  setMenu: React.Dispatch<React.SetStateAction<string | null>>;
  onEdit?: () => void;
  onDelete?: () => void;
}> = ({ av, flash, separar, onOpenMedia, menu, setMenu, onEdit, onDelete }) => {
  const t = useT();
  const texto = av.notes.map(n => n.text?.trim()).filter(Boolean).join("\n");
  const { cuerpo, seg } = separar(texto);
  const conFoto = av.notes.some(esVisual);
  const autor = av.notes[0]?.createdByName;
  const key = `av:${av.key}`;
  return (
    <div id={`av-${av.key}`}
      className={`group relative grid grid-cols-[1.75rem_1fr_auto] items-start gap-2.5 rounded-lg px-1.5 py-2 transition-colors duration-700 hover:bg-fg/[0.04] ${flash ? "bg-accent/10" : ""}`}>
      <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent/10 text-accent">
        {conFoto ? <Camera className="h-4 w-4" /> : <PenLine className="h-4 w-4" />}
      </span>
      <div className="min-w-0">
        {cuerpo && <p className="whitespace-pre-line text-sm leading-snug text-fg [overflow-wrap:anywhere]">{cuerpo}</p>}
        {av.notes.some(n => n.fileUrl) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {av.notes.filter(n => n.fileUrl).map(n => esVisual(n) ? (
              <button key={n.id} type="button" onClick={() => onOpenMedia(n)} title={t("av.openMedia")}
                className="relative h-16 w-16 overflow-hidden rounded-lg border border-fg/10 bg-fg/5 hover:border-accent/40">
                {n.kind === "PHOTO"
                  ? <AuthedImage src={n.fileUrl!} alt="" className="h-full w-full object-cover" />
                  : <><AuthedVideo src={n.fileUrl!} className="h-full w-full object-cover" muted />
                      <span className="absolute inset-0 flex items-center justify-center bg-black/30"><VideoIcon className="h-5 w-5 text-white drop-shadow" /></span></>}
              </button>
            ) : n.kind === "AUDIO" ? (
              <AuthedAudio key={n.id} src={n.fileUrl!} controls className="h-8 max-w-[240px]" />
            ) : (
              <AuthedDocLink key={n.id} src={n.fileUrl!} />
            ))}
          </div>
        )}
        {seg && <span className={`mt-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-px text-[11.5px] font-bold ${seg.cls}`}><Flag className="h-3 w-3" /> {seg.label}</span>}
        <p className="mt-1 text-xs tabular-nums text-text-industrial/55">{fmtTime(av.at)}{autor ? ` · ${autor}` : ""}</p>
      </div>
      {onEdit || onDelete ? (
        <div className="relative" data-av-menu>
          <button type="button" aria-label={t("hr.more")} title={t("hr.more")} aria-haspopup="menu" aria-expanded={menu === key}
            onClick={() => setMenu(m => (m === key ? null : key))}
            className={`grid h-7 w-7 place-items-center rounded-md text-text-industrial/45 hover:bg-fg/5 hover:text-fg [@media(hover:hover)]:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 ${menu === key ? "!opacity-100" : ""}`}>
            <MoreHorizontal className="h-4 w-4" />
          </button>
          {menu === key && (
            <div role="menu" className="absolute right-0 top-8 z-10 min-w-[11rem] rounded-xl border border-fg/10 bg-surface p-1 shadow-xl dark:bg-[#0D1B2A]">
              {onEdit && (
                <button type="button" role="menuitem" onClick={onEdit}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-fg hover:bg-fg/5">
                  <Pencil className="h-3.5 w-3.5" /> {t("av.edit")}
                </button>
              )}
              {onDelete && (
                <button type="button" role="menuitem" onClick={onDelete}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-red-700 hover:bg-red-500/10 dark:text-red-400">
                  <Trash2 className="h-3.5 w-3.5" /> {t("av.delete")}
                </button>
              )}
            </div>
          )}
        </div>
      ) : <span />}
    </div>
  );
};

// ── Corregir un avance (texto, cuándo, autor y adjuntos) ─────────────────────

const AvanceEditor: React.FC<{
  av: Avance;
  canEditAuthor: boolean;
  workOrderId: string;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}> = ({ av, canEditAuthor, workOrderId, onCancel, onSaved }) => {
  const t = useT();
  const primera = av.notes[0]!;
  const original = toLocalInput(new Date(av.at));
  const [texto, setTexto] = useState(av.notes.map(n => n.text?.trim()).filter(Boolean).join("\n"));
  const [cuando, setCuando] = useState(original);
  const [autor, setAutor] = useState(primera.createdByUserId ?? "");
  const [quitar, setQuitar] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const guardar = async () => {
    const quedan = av.notes.filter(n => !quitar.has(n.id));
    const fechaCambio = cuando !== original;
    const fecha = new Date(cuando);
    if (fechaCambio && (Number.isNaN(fecha.getTime()) || fecha.getTime() > Date.now())) { setErr(t("pn.futureDate")); return; }
    if (!texto.trim() && !quedan.some(n => n.fileUrl)) { setErr(t("pn.needSomething")); return; }
    const autorCambio = canEditAuthor && !!autor && autor !== (primera.createdByUserId ?? "");
    setSaving(true);
    try {
      // El texto va en la primera nota que queda; las demás, sin texto. Fecha y
      // autor van en todas, así el avance sigue junto.
      for (const [i, n] of quedan.entries()) {
        const nuevoTexto = i === 0 ? texto.trim() : "";
        if (i > 0 && !fechaCambio && !autorCambio && !(n.text ?? "").trim()) continue;
        await api.patch(`/app/pms/work-orders/${workOrderId}/progress-notes/${n.id}`, {
          text: nuevoTexto,
          occurredAt: fechaCambio ? fecha.toISOString() : null,
          createdByUserId: autorCambio ? autor : null,
        });
      }
      for (const id of quitar) await api.delete(`/app/pms/work-orders/${workOrderId}/progress-notes/${id}`);
      await onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t("pn.saveError"));
    } finally {
      setSaving(false);
    }
  };

  const inCls = "rounded-lg border border-fg/15 bg-surface px-2.5 py-1.5 text-[13px] text-fg focus:border-accent/50 focus:outline-none disabled:opacity-60";
  return (
    <div className="my-1 grid grid-cols-[1.75rem_1fr] gap-2.5 px-1.5">
      <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent/10 text-accent"><Pencil className="h-4 w-4" /></span>
      <div className="space-y-2 rounded-xl border border-accent/30 p-2.5">
        <AutoTextArea rows={3} value={texto} onChange={e => setTexto(e.target.value)} disabled={saving} autoFocus
          className={`${inCls} w-full resize-y text-sm`} />
        {av.notes.some(n => n.fileUrl) && (
          <div className="flex flex-wrap gap-2">
            {av.notes.filter(n => n.fileUrl).map(n => {
              const fuera = quitar.has(n.id);
              return (
                <div key={n.id} className={`relative ${fuera ? "opacity-30" : ""}`}>
                  {esVisual(n)
                    ? <span className="block h-14 w-14 overflow-hidden rounded-lg border border-fg/10 bg-fg/5">
                        {n.kind === "PHOTO" ? <AuthedImage src={n.fileUrl!} alt="" className="h-full w-full object-cover" />
                          : <AuthedVideo src={n.fileUrl!} className="h-full w-full object-cover" muted />}
                      </span>
                    : <span className="flex h-14 items-center gap-1 rounded-lg border border-fg/10 bg-fg/5 px-2 text-[11px] text-fg"><FileText className="h-4 w-4 text-accent" />{n.kind === "AUDIO" ? "Audio" : t("pn.file")}</span>}
                  <button type="button" disabled={saving} aria-label={t("av.removeAttachment")} title={t("av.removeAttachment")}
                    onClick={() => setQuitar(prev => { const s = new Set(prev); if (s.has(n.id)) s.delete(n.id); else s.add(n.id); return s; })}
                    className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-rose-600 text-white">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <DateTimeInput value={cuando} max={toLocalInput(new Date())} disabled={saving} onChange={e => setCuando(e.target.value)}
            aria-label={t("pn.when")} className={`${inCls} w-[11.5rem]`} />
          {canEditAuthor && <AssigneeSelect value={autor} onChange={setAutor} disabled={saving} className={`${inCls} w-[12rem]`} />}
          <span className="flex-1" />
          <button type="button" onClick={onCancel} disabled={saving}
            className="rounded-lg border border-fg/15 px-3 py-1.5 text-[13px] font-bold text-text-industrial hover:border-accent/30">{t("common.cancel")}</button>
          <button type="button" onClick={() => { void guardar(); }} disabled={saving}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[13px] font-bold text-accent-fg hover:brightness-110 disabled:opacity-50">
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {t("common.save")}
          </button>
        </div>
      </div>
      {err && <AlertDialog message={err} onClose={() => setErr(null)} />}
    </div>
  );
};

// ── Novedad de la hoja de ruta de una SS de la OT ────────────────────────────

const SsLinea: React.FC<{
  entry: SsLogEntry;
  canEdit: boolean;
  menu: string | null;
  setMenu: React.Dispatch<React.SetStateAction<string | null>>;
  onSaved: () => Promise<void>;
}> = ({ entry, canEdit, menu, setMenu, onSaved }) => {
  const t = useT();
  const key = `ss:${entry.serviceRequestId}:${entry.logId ?? entry.fecha}`;
  const editable = canEdit && !!entry.logId;
  const [editando, setEditando] = useState(false);
  const [fecha, setFecha] = useState("");
  const [asienta, setAsienta] = useState("");
  const [novedad, setNovedad] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const empezar = () => {
    const d = new Date(entry.fecha);
    setFecha(Number.isNaN(d.getTime()) ? "" : toLocalInput(d).slice(0, 10));
    setAsienta(entry.asienta === "—" ? "" : entry.asienta);
    setNovedad(entry.novedad);
    setMenu(null);
    setEditando(true);
  };
  const guardar = async () => {
    if (!novedad.trim() || !asienta.trim() || !fecha) { setErr(t("wo.ssLog.required")); return; }
    setSaving(true);
    try {
      await api.patch(`/app/pms/service-requests/${entry.serviceRequestId}/hoja-ruta/${entry.logId}`, {
        entryDate: fecha, asientaByName: asienta.trim(), novedad: novedad.trim(),
      });
      setEditando(false);
      await onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t("pn.saveError"));
    } finally {
      setSaving(false);
    }
  };
  const chip = (
    <span className="mr-1.5 rounded-md bg-violet-500/10 px-1.5 py-px font-mono text-[11px] font-bold text-violet-700 dark:text-violet-300" title={t("wo.ssLog.hint")}>
      {entry.serviceRequestCode}
    </span>
  );
  const inCls = "rounded-lg border border-fg/15 bg-surface px-2.5 py-1.5 text-[13px] text-fg focus:border-accent/50 focus:outline-none disabled:opacity-60";
  if (editando) {
    return (
      <div className="my-1 grid grid-cols-[1.75rem_1fr] gap-2.5 px-1.5">
        <span className="ml-0.5 grid h-[22px] w-[22px] place-items-center rounded-full bg-violet-500/10 text-violet-700 dark:text-violet-300"><Pencil className="h-3 w-3" /></span>
        <div className="space-y-2 rounded-xl border border-accent/30 p-2.5">
          <p className="text-xs text-text-industrial/60">{chip}{t("wo.ssLog.hint")}</p>
          <AutoTextArea rows={2} value={novedad} onChange={e => setNovedad(e.target.value)} disabled={saving} className={`${inCls} w-full resize-y text-sm`} />
          <div className="flex flex-wrap items-center gap-2">
            <DateInput value={fecha} onChange={e => setFecha(e.target.value)} disabled={saving} aria-label={t("hr.col.date")} className={`${inCls} w-[10rem]`} />
            <input value={asienta} onChange={e => setAsienta(e.target.value)} disabled={saving} aria-label={t("hr.col.by")} placeholder={t("hr.col.by")} className={`${inCls} w-[12rem]`} />
            <span className="flex-1" />
            <button type="button" onClick={() => setEditando(false)} disabled={saving}
              className="rounded-lg border border-fg/15 px-3 py-1.5 text-[13px] font-bold text-text-industrial">{t("common.cancel")}</button>
            <button type="button" onClick={() => { void guardar(); }} disabled={saving}
              className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[13px] font-bold text-accent-fg disabled:opacity-50">
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {t("common.save")}
            </button>
          </div>
        </div>
        {err && <AlertDialog message={err} onClose={() => setErr(null)} />}
      </div>
    );
  }
  return (
    <div className="group relative grid grid-cols-[1.75rem_1fr_auto] items-center gap-2.5 rounded-lg px-1.5 py-1 hover:bg-fg/[0.04]">
      <span className="ml-0.5 grid h-[22px] w-[22px] place-items-center rounded-full bg-violet-500/10 text-violet-700 dark:text-violet-300" title={t("wo.ssLog.hint")}>
        <ArrowRight className="h-3 w-3" strokeWidth={3} />
      </span>
      <p className="min-w-0 text-[13px] font-semibold text-text-industrial/70 [overflow-wrap:anywhere]">
        {chip}{entry.novedad}{" "}
        <span className="font-normal text-text-industrial/45">
          {/* Los pasos de la SS son fechas sin hora (medianoche UTC): no se inventa una hora. */}
          {/T00:00:00(\.000)?Z$/.test(entry.fecha) ? "" : `· ${fmtTime(entry.fecha)} `}
          {entry.asienta && entry.asienta !== "—" ? `· ${entry.asienta}` : ""}
        </span>
      </p>
      {editable ? (
        <div className="relative" data-av-menu>
          <button type="button" aria-label={t("hr.more")} title={t("hr.more")} aria-haspopup="menu" aria-expanded={menu === key}
            onClick={() => setMenu(m => (m === key ? null : key))}
            className={`grid h-7 w-7 place-items-center rounded-md text-text-industrial/45 hover:bg-fg/5 hover:text-fg [@media(hover:hover)]:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 ${menu === key ? "!opacity-100" : ""}`}>
            <MoreHorizontal className="h-4 w-4" />
          </button>
          {menu === key && (
            <div role="menu" className="absolute right-0 top-8 z-10 min-w-[11rem] rounded-xl border border-fg/10 bg-surface p-1 shadow-xl dark:bg-[#0D1B2A]">
              <button type="button" role="menuitem" onClick={empezar}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-fg hover:bg-fg/5">
                <Pencil className="h-3.5 w-3.5" /> {t("wo.ssLog.edit")}
              </button>
            </div>
          )}
        </div>
      ) : <span />}
    </div>
  );
};
