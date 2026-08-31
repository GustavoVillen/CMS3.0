// "Nuevo registro de Avance de SS" (acceso del Dashboard).
//
// Dos pasos: elegir una Solicitud de Servicio EN EJECUCIÓN y, sobre ella,
// asentar novedades en la HOJA DE RUTA DEL PEDIDO. Es el mismo recuadro que vive
// dentro del formulario de la SS (HojaRutaBox): acá sólo se le cambia la puerta
// de entrada, para que la tripulación registre el avance sin recorrer el
// formulario entero.
//
// Sólo se listan las SS en ejecución: antes de mandarse al taller el pedido
// todavía se está tramitando, y una vez recibido el pedido dejó de moverse (el
// backend rechaza novedades sobre una SS cerrada).

import React from "react";
import { Handshake, Loader2, ChevronLeft } from "lucide-react";
import { useFetch } from "../../lib/hooks";
import { useT } from "../../lib/i18n";
import { useAuth } from "../../lib/auth";
import { useVesselContext } from "../../lib/vessel-context";
import { ModalCloseButton } from "../ModalCloseButton";
import { fmtDate } from "../../lib/utils";
import { HojaRutaBox } from "./HojaRutaBox";

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
  workOrder: { workOrderCode: string; assetName: string | null } | null;
}

/** Mismo criterio que la pantalla de SS: manda la DESCRIPCIÓN DEL SERVICIO. */
const srServicio = (sr: ProgressSr) => sr.description || sr.title || "";

/** El taller que concurre: el del catálogo si vino elegido, si no el texto libre. */
const srTaller = (sr: ProgressSr) => sr.providerName || sr.tallerNotes || "";

export function SsProgressFlow({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { user } = useAuth();
  const { vessels } = useVesselContext();
  // useFetch inyecta el buque del contexto y el backend aplica el scope del
  // usuario: nunca se ve una SS de un buque ajeno.
  const { data, loading } = useFetch<{ items: ProgressSr[] }>(
    "/app/pms/service-requests?status=IN_PROGRESS",
  );
  const items = data?.items ?? [];
  const [elegida, setElegida] = React.useState<ProgressSr | null>(null);

  // Sólo para gatear el borrado de novedades, igual que en el formulario de la SS.
  const isAdmin = user?.role === "TENANT_ADMIN";
  // Con nombre, nunca con código (el código no le dice nada a nadie a bordo).
  const vesselName = (code: string) => vessels.find(v => v.code === code)?.name ?? code;

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
              {elegida
                ? `${elegida.serviceRequestCode} — ${srServicio(elegida) || "—"}`
                : t("dashboard.ssProgress.title")}
            </h2>
            <p className="text-xs text-text-industrial/50 mt-0.5 truncate">
              {elegida
                ? `${vesselName(elegida.vesselCode)}${srTaller(elegida) ? ` · ${srTaller(elegida)}` : ""}`
                : t("dashboard.ssProgress.subtitle")}
            </p>
          </div>
          <ModalCloseButton onClose={onClose} />
        </div>

        {/* Paso 1 — las SS en ejecución */}
        {!elegida && (
          <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1.5">
            {loading && items.length === 0 && (
              <p className="flex items-center gap-2 text-xs text-text-industrial/50 py-6 justify-center">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> {t("common.loading")}
              </p>
            )}

            {!loading && items.length === 0 && (
              <p className="text-xs text-text-industrial/50 text-center py-8">{t("dashboard.ssProgress.empty")}</p>
            )}

            {items.map(sr => (
              <button
                key={sr.id}
                type="button"
                onClick={() => setElegida(sr)}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-fg/[0.03] border border-fg/10 hover:border-accent/40 hover:bg-fg/[0.07] transition-all text-left"
              >
                <Handshake className="w-3.5 h-3.5 text-accent/70 shrink-0" />
                <span className="font-mono text-[11px] font-bold text-accent shrink-0">{sr.serviceRequestCode}</span>
                <span className="flex-1 min-w-0 truncate text-xs text-fg">{srServicio(sr) || "—"}</span>
                {sr.workOrder?.assetName && (
                  <span className="hidden sm:block shrink-0 max-w-[10rem] truncate text-[10px] text-text-industrial/50">
                    {sr.workOrder.assetName}
                  </span>
                )}
                <span className="hidden sm:block shrink-0 max-w-[10rem] truncate text-[10px] text-text-industrial/40">
                  {vesselName(sr.vesselCode)}
                </span>
                {sr.openDate && (
                  <span className="shrink-0 text-[10px] text-text-industrial/40 tabular-nums">{fmtDate(sr.openDate)}</span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Paso 2 — la hoja de ruta de la SS elegida, editable */}
        {elegida && (
          <>
            <div className="flex-1 min-h-0 overflow-y-auto">
              <div className="border border-fg/25 rounded-lg overflow-hidden">
                <div className="px-2 py-1 bg-fg/10 text-[10px] font-bold tracking-widest text-text-industrial uppercase">
                  {t("dashboard.ssProgress.hojaRuta")}
                </div>
                {/* La SS está EN EJECUCIÓN: siempre admite novedades nuevas. */}
                <HojaRutaBox srId={elegida.id} editable isAdmin={!!isAdmin} />
              </div>
            </div>
            <button
              type="button"
              onClick={() => setElegida(null)}
              className="shrink-0 self-start flex items-center gap-1 text-[11px] font-bold text-text-industrial/60 hover:text-accent"
            >
              <ChevronLeft className="w-3.5 h-3.5" /> {t("dashboard.ssProgress.back")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
