// HOJA DE RUTA DEL PEDIDO (REGI-LOG-01.3): FECHA | NOVEDAD | ASIENTA.
//
// Vive acá y no en pages/ServiceRequests.tsx porque hay dos entradas al mismo
// recuadro: el formulario de la SS y el acceso "Nuevo registro de Avance de SS"
// del Dashboard. Una sola implementación = una sola forma de asentar novedades.

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useFetch } from "../../lib/hooks";
import { api } from "../../lib/api";
import { fmtDate } from "../../lib/utils";
import { SsTableHead } from "./SsPaperForm";

/**
 * Fila de la HOJA DE RUTA DEL PEDIDO, tal como se imprime. Con `logId` = novedad
 * asentada a mano (editable); sin él = hito que el sistema deriva de la SS.
 */
export interface HojaRutaRow {
  fecha: string;
  novedad: string;
  asienta: string;
  logId?: string;
}

/**
 * HOJA DE RUTA DEL PEDIDO — cómo se fue moviendo la solicitud.
 *
 * Muestra la hoja tal como se imprime: los hitos que el sistema asienta solo
 * (creada, aprobada, autorizada, enviada al taller, recibida) mezclados por
 * fecha con las novedades que carga la gente. Sólo estas últimas se editan: los
 * hitos salen de la tramitación y no se tocan desde acá.
 */
export function HojaRutaBox({ srId, editable, isAdmin }: {
  srId: string;
  editable: boolean;
  isAdmin: boolean;
}) {
  // `reload()` (no un contador en las deps): useFetch cachea por 30 s, así que
  // volver a pedir la misma URL devolvía la lista vieja y la novedad recién
  // asentada tardaba en aparecer. reload() siempre trae la del servidor.
  const { data, loading, reload } = useFetch<{ items: HojaRutaRow[] }>(
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
      await reload();
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
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo borrar la novedad.");
    }
  };

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
                <button type="button" onClick={() => setConfirmando(f.logId!)}
                  className="shrink-0 text-text-industrial/30 hover:text-red-500" title="Borrar novedad">
                  <Trash2 className="w-3 h-3" />
                </button>
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
          <input type="date" className="w-28 shrink-0 px-2 py-1 bg-transparent text-[12px] text-fg outline-none"
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
    </>
  );
}
