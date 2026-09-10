// "Registro de Avance" (acceso único del Dashboard).
//
// Antes había dos botones — avance de OT y avance de SS — y a bordo la duda era
// siempre la misma: sobre qué se estaba por escribir. Ahora es un solo botón y
// una sola lista, ordenada como se piensa a bordo: POR EQUIPO. Cada equipo se
// despliega y adentro está todo lo que tiene abierto — sus Órdenes de Trabajo y
// sus Solicitudes de Servicio en ejecución — y según lo elegido se abre la hoja
// que corresponde:
//
//   OT  → ProgressNoteSheet: texto, foto, video, audio o documento.
//   SS  → HOJA DE RUTA DEL PEDIDO (FECHA | NOVEDAD | ASIENTA).
//
// Ninguna de las dos hojas es nueva: son las mismas que viven dentro del
// formulario de la OT y de la SS. Acá sólo cambia la puerta de entrada, para
// que la tripulación registre lo que hizo sin recorrer el formulario entero.
//
// Sólo se listan las SS en ejecución: antes de mandarse al taller el pedido
// todavía se está tramitando, y una vez recibido dejó de moverse (el backend
// rechaza novedades sobre una SS cerrada). El equipo de la SS es el de su OT de
// origen: la solicitud no guarda equipo propio.

import React from "react";
import { ChevronDown, Handshake, Wrench, Loader2, ChevronLeft } from "lucide-react";
import { useFetch } from "../lib/hooks";
import { useT } from "../lib/i18n";
import { useAuth } from "../lib/auth";
import { useVesselContext } from "../lib/vessel-context";
import { ModalCloseButton } from "./ModalCloseButton";
import { fmtDate } from "../lib/utils";
import {
  WO_OPEN_STATUSES,
  WoStatusChip,
  type PickerWorkOrder,
} from "./service-requests/OpenWorkOrdersPicker";
import { HojaRutaBox } from "./service-requests/HojaRutaBox";
import { ProgressNoteSheet } from "../mobile/ProgressNoteSheet";

/** Sólo lo que la lista necesita mostrar. */
interface ProgressSr {
  id: string;
  serviceRequestCode: string;
  title: string | null;
  description: string | null;
  vesselCode: string;
  openDate: string | null;
  providerName: string | null;
  tallerNotes: string | null;
  workOrder: { workOrderCode: string; assetId: string | null; assetName: string | null } | null;
}

/** Mismo criterio que la pantalla de SS: manda la DESCRIPCIÓN DEL SERVICIO. */
const srServicio = (sr: ProgressSr) => sr.description || sr.title || "";

/** El taller que concurre: el del catálogo si vino elegido, si no el texto libre. */
const srTaller = (sr: ProgressSr) => sr.providerName || sr.tallerNotes || "";

/** Un equipo con todo lo que tiene abierto. */
interface AssetGroup {
  key: string;
  label: string;
  vesselCode: string;
  wos: PickerWorkOrder[];
  srs: ProgressSr[];
}

/**
 * Agrupa OT y SS por equipo. La clave es el assetId (único por buque, así que
 * dos buques con un equipo del mismo nombre no se mezclan); el nombre es sólo
 * la etiqueta. Lo que no tiene equipo cae en un grupo aparte al final.
 */
function groupByAsset(wos: PickerWorkOrder[], srs: ProgressSr[], sinEquipo: string): AssetGroup[] {
  const map = new Map<string, AssetGroup>();
  const grupo = (assetId: string | null, assetName: string | null, vesselCode: string) => {
    const key = assetId ?? assetName ?? "—";
    let g = map.get(key);
    if (!g) {
      g = { key, label: assetName ?? sinEquipo, vesselCode, wos: [], srs: [] };
      map.set(key, g);
    }
    return g;
  };
  for (const w of wos) grupo(w.assetId, w.assetName, w.vesselCode).wos.push(w);
  for (const sr of srs) {
    grupo(sr.workOrder?.assetId ?? null, sr.workOrder?.assetName ?? null, sr.vesselCode).srs.push(sr);
  }
  return [...map.values()].sort((a, b) => {
    // El grupo sin equipo va último: es la excepción, no la puerta de entrada.
    if ((a.label === sinEquipo) !== (b.label === sinEquipo)) return a.label === sinEquipo ? 1 : -1;
    // Con la flota entera a la vista, primero se ordena por buque: si no, el
    // mismo equipo de tres barcazas aparece tres veces seguidas y sin diferencia.
    if (a.vesselCode !== b.vesselCode) return a.vesselCode.localeCompare(b.vesselCode);
    return a.label.localeCompare(b.label);
  });
}

/** Paso 1 — todo lo abierto, equipo por equipo. */
function Picker({ onClose, onPickWo, onPickSr }: {
  onClose: () => void;
  onPickWo: (wo: { id: string; workOrderCode: string }) => void;
  onPickSr: (sr: ProgressSr) => void;
}) {
  const t = useT();
  const { vessels } = useVesselContext();
  // useFetch inyecta el buque del contexto y el backend aplica el scope del
  // usuario: nunca se ve una OT ni una SS de un buque ajeno.
  const wo = useFetch<{ items: PickerWorkOrder[] }>("/app/work-orders");
  const sr = useFetch<{ items: ProgressSr[] }>("/app/pms/service-requests?status=IN_PROGRESS");
  const cargando = wo.loading || sr.loading;

  const abiertas = (wo.data?.items ?? []).filter(w => WO_OPEN_STATUSES.includes(w.status));
  const solicitudes = sr.data?.items ?? [];
  const grupos = groupByAsset(abiertas, solicitudes, t("dashboard.progress.noAsset"));
  // El buque se nombra en el equipo sólo cuando hay más de uno a la vista (el
  // selector en "Todos los buques"): con un buque elegido sería repetirlo en
  // cada renglón.
  const variosBuques = new Set(grupos.map(g => g.vesselCode)).size > 1;

  // Arrancan plegados, como el tablero de OT. Con un solo equipo no tiene
  // sentido esconderlo: se abre solo.
  const [expandidos, setExpandidos] = React.useState<Set<string>>(new Set());
  React.useEffect(() => {
    if (grupos.length === 1) setExpandidos(new Set([grupos[0].key]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grupos.length]);
  const toggle = (key: string) =>
    setExpandidos(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  // Con nombre, nunca con código (el código no le dice nada a nadie a bordo).
  const vesselName = (code: string) => vessels.find(v => v.code === code)?.name ?? code;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-2xl bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl p-6 space-y-4 max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-fg">{t("dashboard.progress.title")}</h2>
            <p className="text-xs text-text-industrial/50 mt-0.5">{t("dashboard.progress.subtitle")}</p>
          </div>
          <ModalCloseButton onClose={onClose} />
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2">
          {cargando && grupos.length === 0 && (
            <p className="flex items-center gap-2 text-xs text-text-industrial/50 py-6 justify-center">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> {t("common.loading")}
            </p>
          )}

          {!cargando && grupos.length === 0 && (
            <p className="text-xs text-text-industrial/50 text-center py-8">{t("dashboard.progress.empty")}</p>
          )}

          {grupos.map(group => {
            const plegado = !expandidos.has(group.key);
            return (
              <div key={group.key} className="rounded-lg border border-fg/10 bg-fg/[0.02]">
                <button
                  type="button"
                  onClick={() => toggle(group.key)}
                  className="w-full flex items-center gap-1.5 px-2 py-2 text-left rounded-lg hover:bg-fg/[0.05] transition-colors"
                  title={group.label}
                >
                  <ChevronDown className={`w-3.5 h-3.5 text-text-industrial/40 shrink-0 transition-transform duration-150 ${plegado ? "-rotate-90" : ""}`} />
                  <Wrench className="w-3 h-3 text-accent/70 shrink-0" />
                  <span className="text-[12px] font-bold text-fg truncate flex-1">{group.label}</span>
                  {variosBuques && (
                    <span className="shrink-0 max-w-[10rem] truncate text-[10px] text-text-industrial/50">
                      {vesselName(group.vesselCode)}
                    </span>
                  )}
                  <span className="text-[10px] font-bold text-text-industrial/50 bg-fg/10 rounded-full px-1.5 py-0.5 shrink-0">
                    {group.wos.length + group.srs.length}
                  </span>
                </button>

                {!plegado && (
                  <div className="flex flex-col gap-1.5 p-2 pt-0">
                    {/* Primero las órdenes de trabajo del equipo… */}
                    {group.wos.map(w => (
                      <button
                        key={w.id}
                        type="button"
                        onClick={() => onPickWo({ id: w.id, workOrderCode: w.workOrderCode })}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-fg/[0.03] border border-fg/10 hover:border-accent/40 hover:bg-fg/[0.07] transition-all text-left"
                      >
                        <Wrench className="w-3.5 h-3.5 text-accent/70 shrink-0" />
                        <span className="font-mono text-[11px] font-bold text-accent shrink-0">{w.workOrderCode}</span>
                        <span className="flex-1 min-w-0 truncate text-xs text-fg">{w.title || "—"}</span>
                        {w.dueDate && (
                          <span className="shrink-0 text-[10px] text-text-industrial/40 tabular-nums">{fmtDate(w.dueDate)}</span>
                        )}
                        <WoStatusChip wo={w} />
                      </button>
                    ))}

                    {/* …y después sus pedidos al taller. */}
                    {group.srs.map(s => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => onPickSr(s)}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-fg/[0.03] border border-fg/10 hover:border-accent/40 hover:bg-fg/[0.07] transition-all text-left"
                      >
                        <Handshake className="w-3.5 h-3.5 text-accent/70 shrink-0" />
                        <span className="font-mono text-[11px] font-bold text-accent shrink-0">{s.serviceRequestCode}</span>
                        <span className="flex-1 min-w-0 truncate text-xs text-fg">{srServicio(s) || "—"}</span>
                        {s.openDate && (
                          <span className="shrink-0 text-[10px] text-text-industrial/40 tabular-nums">{fmtDate(s.openDate)}</span>
                        )}
                        <span className="shrink-0 inline-block text-[10px] px-2 py-0.5 rounded-full border font-bold bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20">
                          {t("dashboard.progress.ssChip")}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Paso 2 (SS) — la hoja de ruta del pedido elegido, editable. */
function SsHojaRuta({ sr, onBack, onClose }: {
  sr: ProgressSr;
  onBack: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const { user } = useAuth();
  const { vessels } = useVesselContext();
  // Sólo para gatear el borrado de novedades, igual que en el formulario de la SS.
  const isAdmin = user?.role === "TENANT_ADMIN";
  const vesselName = vessels.find(v => v.code === sr.vesselCode)?.name ?? sr.vesselCode;

  return (
    // El clic afuera NO cierra: perder la novedad a medio escribir por un clic al costado
    // es un mal negocio (mismo criterio que FormModal). Se sale por la X.
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div
        className="w-full max-w-3xl bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl p-6 space-y-4 max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-fg truncate">
              {`${sr.serviceRequestCode} — ${srServicio(sr) || "—"}`}
            </h2>
            <p className="text-xs text-text-industrial/50 mt-0.5 truncate">
              {`${vesselName}${srTaller(sr) ? ` · ${srTaller(sr)}` : ""}`}
            </p>
          </div>
          <ModalCloseButton onClose={onClose} />
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="border border-fg/25 rounded-lg overflow-hidden">
            <div className="px-2 py-1 bg-fg/10 text-[10px] font-bold tracking-widest text-text-industrial uppercase">
              {t("dashboard.ssProgress.hojaRuta")}
            </div>
            {/* La SS está EN EJECUCIÓN: siempre admite novedades nuevas. */}
            <HojaRutaBox srId={sr.id} editable isAdmin={!!isAdmin} />
          </div>
        </div>

        <button
          type="button"
          onClick={onBack}
          className="shrink-0 self-start flex items-center gap-1 text-[11px] font-bold text-text-industrial/60 hover:text-accent"
        >
          <ChevronLeft className="w-3.5 h-3.5" /> {t("dashboard.progress.back")}
        </button>
      </div>
    </div>
  );
}

export function ProgressFlow({ onClose }: { onClose: () => void }) {
  const [wo, setWo] = React.useState<{ id: string; workOrderCode: string } | null>(null);
  const [sr, setSr] = React.useState<ProgressSr | null>(null);
  // La hoja de la OT avisa `onSaved` y enseguida `onClose`. Con el avance ya
  // guardado el flujo entero se cierra (igual que el consumo de repuestos); si
  // se salió sin guardar, se vuelve a la lista para elegir otra cosa.
  const guardado = React.useRef(false);

  if (wo) {
    return (
      <ProgressNoteSheet
        workOrderId={wo.id}
        onSaved={() => { guardado.current = true; }}
        onClose={() => { if (guardado.current) onClose(); else setWo(null); }}
      />
    );
  }

  if (sr) {
    return <SsHojaRuta sr={sr} onBack={() => setSr(null)} onClose={onClose} />;
  }

  return (
    <Picker
      onClose={onClose}
      onPickWo={(picked) => { guardado.current = false; setWo(picked); }}
      onPickSr={setSr}
    />
  );
}
