// HOJA DE RUTA DEL PEDIDO (REGI-LOG-01.3): FECHA | NOVEDAD | ASIENTA.
//
// Vive acá y no en pages/ServiceRequests.tsx porque hay dos entradas al mismo
// recuadro: el formulario de la SS y el "Registro de Avance" del Dashboard
// (ProgressFlow). Una sola implementación = una sola forma de asentar novedades.
//
// `variant="list"` (Seguimiento, pedido del usuario): el mismo contenido con el
// formato de "Avances" de la OT — título con la cantidad, botón "Registrar
// novedad" que abre una ventanita, y la lista en tabla. La del formulario sigue
// siendo la réplica del papel.

import { useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useFetch } from "../../lib/hooks";
import { api } from "../../lib/api";
import { fmtDate } from "../../lib/utils";
import { useT } from "../../lib/i18n";
import { SsTableHead } from "./SsPaperForm";
import { FormModal } from "../FormModal";
import { ConfirmDialog } from "../ConfirmDialog";
import { AlertDialog } from "../AlertDialog";
import { AutoTextArea } from "../AutoTextArea";
import { RequiredMark } from "../GuideKit";

/** Recuadro de cada celda, igual que las filas de Avances. */
const cellCls = "w-full bg-transparent border border-fg/10 rounded-md px-1.5 py-0.5 text-[11px] leading-tight text-fg";

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
export function HojaRutaBox({ srId, editable, isAdmin, variant = "paper", onChanged }: {
  srId: string;
  editable: boolean;
  isAdmin: boolean;
  /** "paper" = réplica del formulario impreso; "list" = formato de Avances. */
  variant?: "paper" | "list";
  /** Se asentó o borró una novedad (para refrescar contadores de afuera). */
  onChanged?: () => void;
}) {
  const t = useT();
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
  // Ventanita de "Registrar novedad" (variante lista).
  const [adding, setAdding] = useState(false);

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
    const asentadas = filas.filter(f => f.logId).length;
    const guardarVentana = async () => {
      // Validación en ventanita con OK (patrón del sistema), no en rojo al pie.
      if (!novedad.trim()) { setError(t("hr.add.required")); return; }
      if (await agregar()) setAdding(false);
    };
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-text-industrial/40">
            {t("hr.list.title")} {asentadas > 0 && `(${asentadas})`}
          </p>
          {editable && (
            <button type="button" onClick={() => { setFecha(""); setNovedad(""); setAdding(true); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-accent-fg text-xs font-bold hover:brightness-110">
              <Plus className="w-3.5 h-3.5" /> {t("hr.list.add")}
            </button>
          )}
        </div>

        {loading && filas.length === 0 ? (
          <div className="flex justify-center py-3"><Loader2 className="w-4 h-4 animate-spin text-accent" /></div>
        ) : filas.length === 0 ? (
          <p className="text-[11px] text-text-industrial/40 italic text-center py-2">{t("hr.list.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-separate border-spacing-y-0.5">
              <thead>
                <tr className="text-[9px] uppercase tracking-widest text-text-industrial/50">
                  <th className="text-left font-semibold px-1 w-[104px]">{t("hr.col.date")}</th>
                  <th className="text-left font-semibold px-1">{t("hr.col.entry")}</th>
                  <th className="text-left font-semibold px-1 w-[160px]">{t("hr.col.by")}</th>
                  <th className="w-[32px]" />
                </tr>
              </thead>
              <tbody>
                {filas.map((f, i) => (
                  <tr key={f.logId ?? `hito-${i}`} className="align-top">
                    <td className="px-1">
                      <div className={`${cellCls} text-text-industrial/70 whitespace-nowrap tabular-nums`}>{fmtDate(f.fecha)}</div>
                    </td>
                    {/* En gris e itálica, los hitos que el sistema asienta solo. */}
                    <td className="px-1">
                      <div className={`${cellCls} whitespace-pre-line ${f.logId ? "" : "italic text-text-industrial/60"}`}
                        title={f.logId ? undefined : t("hr.systemHint")}>
                        {f.novedad}
                      </div>
                    </td>
                    <td className="px-1">
                      <div className={`${cellCls} truncate text-text-industrial/70`} title={f.asienta}>{f.asienta}</div>
                    </td>
                    <td className="px-1 whitespace-nowrap text-right">
                      {f.logId && isAdmin && (
                        <button type="button" onClick={() => setConfirmando(f.logId!)} title={t("hr.delete")}
                          className="p-0.5 text-text-industrial/40 hover:text-red-700 dark:hover:text-red-400 transition-colors">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {adding && (
          <FormModal title={t("hr.list.add")} onClose={() => setAdding(false)}
            footer={<>
              <button type="button" onClick={() => setAdding(false)}
                className="px-4 py-2 rounded-xl border border-fg/10 text-xs font-bold text-text-industrial hover:border-accent/30">
                {t("common.cancel")}
              </button>
              <button type="button" onClick={() => { void guardarVentana(); }} disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-accent text-accent-fg text-xs font-bold hover:brightness-110 disabled:opacity-50">
                {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} {t("common.save")}
              </button>
            </>}>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">{t("hr.col.date")}</label>
                <input type="date" value={fecha} onChange={e => setFecha(e.target.value)}
                  className="w-full bg-fg/5 border border-fg/10 rounded-lg px-3 py-2 text-sm text-fg focus:outline-none focus:border-accent/50" />
                <p className="text-[10px] text-text-industrial/40">{t("hr.add.dateHint")}</p>
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">{t("hr.col.entry")}<RequiredMark /></label>
                <AutoTextArea rows={3} value={novedad} onChange={e => setNovedad(e.target.value)} autoFocus
                  placeholder={t("hr.add.placeholder")}
                  className="w-full bg-fg/5 border border-fg/10 rounded-lg px-3 py-2 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 resize-y" />
              </div>
            </div>
          </FormModal>
        )}
        {confirmando && (
          <ConfirmDialog
            message={t("hr.confirmDelete")}
            confirmLabel={t("common.delete")}
            cancelLabel={t("common.cancel")}
            onCancel={() => setConfirmando(null)}
            onConfirm={() => { void borrar(confirmando); }}
          />
        )}
        {error && <AlertDialog message={error} onClose={() => setError(null)} />}
      </div>
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
