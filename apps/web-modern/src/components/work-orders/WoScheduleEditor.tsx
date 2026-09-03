// PROGRAMACION DE TRABAJO de la OT (recuadro del formulario REGI-MAN-02.3):
// una fila por jornada — fecha, técnico, lugar, empresa y horario.
//
// Antes esta tabla del papel salía siempre vacía: se derivaba de los registros
// de trabajo, que sólo nacen del cierre de un plan y del parte diario. Acá se
// carga a mano, que es como se completa a bordo.

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { api, ApiError } from "../../lib/api";

export interface WoScheduleEntry {
  id: string;
  workDate: string | null;
  technician: string | null;
  place: string | null;
  company: string | null;
  timeFrom: string | null;
  timeTo: string | null;
  sortOrder: number;
}

type Field = "workDate" | "technician" | "place" | "company" | "timeFrom" | "timeTo";

// Filas comprimidas a propósito: una OT de astillero lleva muchas jornadas y
// con el alto por defecto no entraban en pantalla.
const cellCls =
  "w-full bg-transparent border border-fg/10 rounded-md px-1.5 py-0.5 text-[11px] leading-tight text-fg " +
  "placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 disabled:opacity-60";

function toDateInput(value: string | null): string {
  if (!value) return "";
  return value.includes("T") ? value.slice(0, 10) : value;
}

export function WoScheduleEditor({ workOrderId, canEdit, defaultPlace, defaultCompany }: {
  workOrderId: string;
  canEdit: boolean;
  /** Se proponen al agregar una fila: es el caso normal (no hay que retipear). */
  defaultPlace: string | null;
  defaultCompany: string | null;
}) {
  const [rows, setRows] = useState<WoScheduleEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.get<{ items: WoScheduleEntry[] }>(`/app/pms/work-orders/${workOrderId}/schedule`)
      .then(r => { if (!cancelled) setRows(r.items ?? []); })
      .catch(() => { if (!cancelled) setRows([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [workOrderId]);

  const add = async () => {
    setErr(null);
    try {
      const created = await api.post<WoScheduleEntry>(`/app/pms/work-orders/${workOrderId}/schedule`, {
        place: defaultPlace || null,
        company: defaultCompany || null,
      });
      setRows(prev => [...prev, created]);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "No se pudo agregar la fila.");
    }
  };

  const remove = async (id: string) => {
    setBusyId(id); setErr(null);
    try {
      await api.delete(`/app/pms/work-orders/${workOrderId}/schedule/${id}`);
      setRows(prev => prev.filter(r => r.id !== id));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "No se pudo borrar la fila.");
    } finally {
      setBusyId(null);
    }
  };

  // Guardado al salir del campo (no en cada tecla): la fila es un borrador
  // mientras se escribe y se persiste cuando el foco se va.
  const savingRef = useRef<Record<string, boolean>>({});
  const save = useCallback(async (row: WoScheduleEntry, field: Field, value: string) => {
    const key = `${row.id}:${field}`;
    if (savingRef.current[key]) return;
    savingRef.current[key] = true;
    setErr(null);
    try {
      await api.patch(`/app/pms/work-orders/${workOrderId}/schedule/${row.id}`, { [field]: value || null });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "No se pudo guardar el cambio.");
    } finally {
      savingRef.current[key] = false;
    }
  }, [workOrderId]);

  const patchLocal = (id: string, field: Field, value: string) => {
    setRows(prev => prev.map(r => (r.id === id ? { ...r, [field]: value } : r)));
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-text-industrial/50">
        <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" /> Cargando programación…
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {rows.length === 0 ? (
        <p className="text-[11px] text-text-industrial/40 italic">
          Sin jornadas cargadas. Agregá una por cada día trabajado.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-separate border-spacing-y-0.5">
            <thead>
              <tr className="text-[9px] uppercase tracking-widest text-text-industrial/50">
                <th className="text-left font-semibold px-1 w-[110px]">Fecha</th>
                <th className="text-left font-semibold px-1">Técnico asignado</th>
                <th className="text-left font-semibold px-1">Lugar</th>
                <th className="text-left font-semibold px-1">Empresa</th>
                <th className="text-left font-semibold px-1 w-[80px]">Desde</th>
                <th className="text-left font-semibold px-1 w-[80px]">Hasta</th>
                <th className="w-[28px]" />
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td className="px-1">
                    <input type="date" disabled={!canEdit} className={cellCls}
                      value={toDateInput(r.workDate)}
                      onChange={e => patchLocal(r.id, "workDate", e.target.value)}
                      onBlur={e => { void save(r, "workDate", e.target.value); }} />
                  </td>
                  <td className="px-1">
                    <input disabled={!canEdit} className={cellCls} placeholder="Nombre"
                      value={r.technician ?? ""}
                      onChange={e => patchLocal(r.id, "technician", e.target.value)}
                      onBlur={e => { void save(r, "technician", e.target.value); }} />
                  </td>
                  <td className="px-1">
                    <input disabled={!canEdit} className={cellCls} placeholder="Lugar"
                      value={r.place ?? ""}
                      onChange={e => patchLocal(r.id, "place", e.target.value)}
                      onBlur={e => { void save(r, "place", e.target.value); }} />
                  </td>
                  <td className="px-1">
                    <input disabled={!canEdit} className={cellCls} placeholder="Empresa"
                      value={r.company ?? ""}
                      onChange={e => patchLocal(r.id, "company", e.target.value)}
                      onBlur={e => { void save(r, "company", e.target.value); }} />
                  </td>
                  <td className="px-1">
                    <input type="time" disabled={!canEdit} className={cellCls}
                      value={r.timeFrom ?? ""}
                      onChange={e => patchLocal(r.id, "timeFrom", e.target.value)}
                      onBlur={e => { void save(r, "timeFrom", e.target.value); }} />
                  </td>
                  <td className="px-1">
                    <input type="time" disabled={!canEdit} className={cellCls}
                      value={r.timeTo ?? ""}
                      onChange={e => patchLocal(r.id, "timeTo", e.target.value)}
                      onBlur={e => { void save(r, "timeTo", e.target.value); }} />
                  </td>
                  <td className="px-0.5 text-center">
                    {canEdit && (
                      <button type="button" onClick={() => { void remove(r.id); }} disabled={busyId === r.id}
                        title="Borrar esta jornada"
                        className="text-text-industrial/40 hover:text-red-600 disabled:opacity-40">
                        {busyId === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canEdit && (
        <button type="button" onClick={() => { void add(); }}
          className="inline-flex items-center gap-1 text-[11px] font-bold text-accent hover:underline">
          <Plus className="w-3 h-3" /> Agregar jornada
        </button>
      )}

      {err && <p className="text-[11px] text-red-700 dark:text-red-400">{err}</p>}
    </div>
  );
}
