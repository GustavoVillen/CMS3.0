// Secciones del formulario controlado de Orden de Trabajo (REGI-OPE-26.3).
// Se montan dentro del modal de OT (WorkOrders.tsx), sólo para los tenants que
// usan el formulario de Mercurio.
//
// Sólo los recuadros que el papel pide y el sistema no tenía: quién solicita,
// a qué área se asigna, tipo de mantenimiento (5 opciones), sistema, nro de
// viaje, pendientes y los repuestos/materiales planificados. El resto (equipo,
// fechas, prioridad, riesgo, firmas) ya vive en el modal.

import React from "react";
import { Check } from "lucide-react";
import {
  WO_REQUESTED_BY, WO_ASSIGNED_TO, WO_SYSTEM_AREAS, WO_MAINTENANCE_KINDS_OR_INSPECTION,
  WO_PRIORITY_OPTIONS, type FormOption,
} from "../../lib/wo-form-catalog";
import type { WoPlannedItem, WoSpareOption } from "./PlannedItemsEditor";

const inputCls = "w-full bg-fg/5 border border-fg/10 rounded-lg px-2.5 py-1.5 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 disabled:opacity-60";
const labelCls = "block text-[10px] font-bold text-text-industrial/40 uppercase tracking-widest mb-1";

// Los recuadros de repuestos/materiales viven en PlannedItemsEditor (compartido
// con el modal de Plan). Se re-exportan los tipos para no romper importadores.
export type { WoPlannedItem, WoSpareOption } from "./PlannedItemsEditor";

export interface WoRegiForm {
  voyageNumber: string;
  /** Condición del buque al hacer el trabajo (evidencia TMSA de navegación). */
  operatingCondition: string;
  requestedByArea: string;
  assignedToArea: string;
  systemArea: string;
  maintenanceKind: string;
  pendingDetail: string;
  taskCompleted: "" | "YES" | "NO";
}

export const EMPTY_WO_REGI: WoRegiForm = {
  voyageNumber: "", operatingCondition: "", requestedByArea: "", assignedToArea: "",
  systemArea: "", maintenanceKind: "", pendingDetail: "", taskCompleted: "",
};

const PRIORITY_HINT = "La prioridad se elige arriba, en Información. Acá se muestra como plazo, que es como la expresa el formulario.";

/** Casilla cuadrada como la del papel — se reusa en FormBox y OptionRow. */
function PaperCheckbox({ on }: { on: boolean }) {
  return (
    <span className={`shrink-0 w-3.5 h-3.5 border flex items-center justify-center ${
      on ? "bg-fg border-fg" : "border-fg/50"
    }`}>
      {on && <Check className="w-2.5 h-2.5 text-surface" strokeWidth={3.5} />}
    </span>
  );
}

/**
 * Barra de sección del papel — fondo azul marino, texto blanco centrado en
 * mayúsculas (SOLICITADO POR / ASIGNADO A / AUTORIZACION DE TRABAJO / etc).
 * Mismo color que ya usa MaintenancePlans.tsx para sus separadores (#0f172a).
 */
export function PaperSectionBar({ title }: { title: string }) {
  return (
    <div
      className="text-[11px] font-bold uppercase tracking-wider text-center py-1.5 px-2"
      style={{ backgroundColor: "#0f172a", color: "white" }}
    >
      {title}
    </div>
  );
}

/**
 * Recuadro del formulario: cabecera de texto simple + opciones en vertical con
 * su casilla, igual que en el papel (PRIORIDAD / TIPO DE MANTENIMIENTO /
 * SISTEMA van así, uno al lado del otro, bordes rectos como una tabla).
 * Volver a tocar la opción activa la limpia.
 */
export function FormBox({ title, options, value, onChange, disabled }: {
  title: string;
  options: FormOption[];
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="border border-fg/25 bg-surface">
      <div className="text-[11px] font-bold uppercase tracking-wide text-fg text-center py-1.5 px-2 border-b border-fg/25">
        {title}
      </div>
      {options.map(o => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(on ? "" : o.value)}
            className={`w-full flex items-center gap-2 px-2 py-1.5 border-t border-fg/15 text-left transition-colors disabled:opacity-60 ${
              on ? "bg-fg/5" : "hover:bg-fg/5"
            }`}
          >
            <PaperCheckbox on={on} />
            <span className={`flex-1 min-w-0 text-[11px] leading-tight ${on ? "font-bold text-fg" : "text-text-industrial/70"}`}>
              {o.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Fila horizontal con casillero — para los recuadros del papel que van en una
 * sola línea bajo la barra de sección (SOLICITADO POR / ASIGNADO A). Franja
 * bordeada, opciones separadas por líneas verticales, como una fila de tabla.
 */
export function OptionRow({ options, value, onChange, disabled }: {
  options: FormOption[];
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap border border-t-0 border-fg/25 bg-surface divide-x divide-fg/25">
      {options.map(o => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            disabled={disabled}
            // Volver a tocar la opción activa la limpia: el papel admite recuadros vacíos.
            onClick={() => onChange(on ? "" : o.value)}
            className={`flex-1 min-w-[7rem] flex items-center gap-2 px-3 py-2 text-left transition-colors disabled:opacity-60 ${
              on ? "bg-fg/5" : "hover:bg-fg/5"
            }`}
          >
            <PaperCheckbox on={on} />
            <span className={`text-[11px] leading-tight ${on ? "font-bold text-fg" : "text-text-industrial/70"}`}>
              {o.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Valor centinela del select: "la empresa no está en el catálogo". */
const OTRA = "__OTRA__";

// Los repuestos y materiales previstos ya NO viven acá: tienen sección propia
// numerada en el modal de la OT, entre "Programación de trabajo" y "Tarea
// concluida". Estaban al pie de este bloque, sin título, y no se encontraban.
export function WoRegiSections({
  form, onChange, priority, disabled,
  providers, providerId, onProviderChange, location, onLocationChange, onPriorityChange,
  serviceRequestProviders, onServiceRequestProviderChange,
  providerOther, onProviderOtherChange,
  type, onTypeChange,
  saving, saved, error,
}: {
  form: WoRegiForm;
  onChange: (patch: Partial<WoRegiForm>) => void;
  /** Estado del auto-guardado del bloque (lo maneja el modal de la OT). */
  saving?: boolean;
  saved?: boolean;
  error?: string | null;
  /** Prioridad de la OT. El papel la nombra como plazo: es el mismo dato. */
  priority: string;
  onPriorityChange: (v: string) => void;
  /**
   * Tipo grueso de la OT (PREVENTIVE/CORRECTIVE/INSPECTION). "Inspección" en
   * el recuadro "Tipo de mantenimiento" viaja acá, no en `form.maintenanceKind`
   * — no tiene equivalente fino, así que se le asigna directo (mismo criterio
   * que ya usa el alta rápida de OT).
   */
  type: string;
  onTypeChange: (v: string) => void;
  disabled?: boolean;
  /** Talleres del buque — se ofrecen cuando el trabajo se terceriza. */
  providers: Array<{ id: string; name: string; providerCode: string }>;
  providerId: string;
  onProviderChange: (id: string) => void;
  /** Solicitudes de Servicio ya abiertas para esta OT (una por taller cuando el
   *  plan trae varios, ej. Clase + Espesores). Cuando hay más de una, se
   *  muestra un selector por SS en vez del selector único de arriba: el
   *  recuadro del papel es de una sola línea, pero acá adentro puede haber
   *  más de un taller trabajando la misma orden. */
  serviceRequestProviders?: Array<{ id: string; providerId: string | null; label: string | null }>;
  onServiceRequestProviderChange?: (serviceRequestId: string, providerId: string) => void;
  /** Empresa tercerizada escrita a mano, cuando no está en el catálogo. */
  providerOther: string;
  onProviderOtherChange: (v: string) => void;
  /** UBICACION — va en la cabecera del papel, junto a Unidad y Equipo. */
  location: string;
  onLocationChange: (v: string) => void;
}) {
  // Arranca en "otra empresa" si la OT ya se guardó con un nombre escrito a mano.
  const [otraEmpresa, setOtraEmpresa] = React.useState(!providerId && !!providerOther);

  return (
    <div className="space-y-4 bg-fg/5 border border-fg/10 rounded-2xl p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] uppercase tracking-widest text-text-industrial/40 font-semibold">
          Formulario REGI-OPE-26.3
        </p>
        {/* Este bloque se guarda solo; el aviso es la única señal de que pasó. */}
        <span className="text-[10px] font-bold shrink-0" aria-live="polite">
          {error
            ? <span className="text-red-600 dark:text-red-400">{error}</span>
            : saving
              ? <span className="text-text-industrial/40">Guardando…</span>
              : saved
                ? <span className="text-green-600 dark:text-green-500">✓ Guardado</span>
                : null}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Nro de viaje</label>
          <input
            className={inputCls}
            value={form.voyageNumber}
            disabled={disabled}
            onChange={e => onChange({ voyageNumber: e.target.value })}
            placeholder="Ej. V-2026-014"
          />
        </div>
        <div>
          {/* Ubicación geográfica: dónde está el buque cuando se hace el trabajo
              (ciudad, km del río), no en qué parte del buque. */}
          <label className={labelCls}>Ubicación</label>
          <input
            className={inputCls}
            value={location}
            disabled={disabled}
            onChange={e => onLocationChange(e.target.value)}
            placeholder="Ciudad / Km…"
          />
        </div>
      </div>

      {/* Recuadros horizontales del papel */}
      <div>
        <PaperSectionBar title="Solicitado por" />
        <OptionRow options={WO_REQUESTED_BY} value={form.requestedByArea} disabled={disabled}
          onChange={v => onChange({ requestedByArea: v })} />
      </div>

      <div>
        <PaperSectionBar title="Asignado a" />
        <OptionRow options={WO_ASSIGNED_TO} value={form.assignedToArea} disabled={disabled}
          onChange={v => onChange({ assignedToArea: v })} />
        {/* Tercerizado = lo hace una empresa externa → acá se dice cuál. Puede no
            estar en el catálogo: en ese caso se escribe el nombre, y el resto del
            sistema (PDF incluido) lo trata igual que a uno de la lista. */}
        {form.assignedToArea === "TERCERIZADO" && (
          (serviceRequestProviders?.length ?? 0) > 1 ? (
            // El plan trae más de un taller (ej. Clase + Espesores): ya hay una
            // SS abierta por cada uno. El recuadro del papel es de una sola
            // línea, así que acá se listan todos con su propio selector en vez
            // de forzarlos en un único campo.
            <div className="mt-2 space-y-1.5">
              {serviceRequestProviders!.map(sr => (
                <div key={sr.id} className="flex items-center gap-2">
                  {sr.label && (
                    <span className="shrink-0 max-w-[40%] truncate text-[11px] text-text-industrial/50" title={sr.label}>
                      {sr.label}
                    </span>
                  )}
                  <select
                    value={sr.providerId ?? ""}
                    onChange={e => onServiceRequestProviderChange?.(sr.id, e.target.value)}
                    disabled={disabled}
                    className={inputCls}
                  >
                    <option value="">Seleccionar taller / proveedor…</option>
                    {providers.map(p => (
                      <option key={p.id} value={p.id}>{p.name}{p.providerCode ? ` (${p.providerCode})` : ""}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          ) : (
            <>
              <select
                value={otraEmpresa ? OTRA : providerId}
                onChange={e => {
                  if (e.target.value === OTRA) { setOtraEmpresa(true); onProviderChange(""); return; }
                  setOtraEmpresa(false);
                  onProviderOtherChange("");
                  onProviderChange(e.target.value);
                }}
                disabled={disabled}
                className={inputCls + " mt-2"}
              >
                <option value="">Seleccionar taller / proveedor…</option>
                {providers.map(p => (
                  <option key={p.id} value={p.id}>{p.name}{p.providerCode ? ` (${p.providerCode})` : ""}</option>
                ))}
                <option value={OTRA}>Otra empresa (no está en la lista)…</option>
              </select>
              {otraEmpresa && (
                <input
                  className={inputCls + " mt-2"}
                  value={providerOther}
                  disabled={disabled}
                  onChange={e => onProviderOtherChange(e.target.value)}
                  placeholder="Nombre de la empresa"
                  autoFocus
                />
              )}
            </>
          )
        )}
      </div>

      {/* Los tres recuadros van uno al lado del otro, como en el papel.
          PRIORIDAD es la prioridad de la OT (arriba se ve como Crítica/Alta/…):
          mismo dato, nombrado como plazo para quien completa el formulario. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <FormBox title="Prioridad" options={WO_PRIORITY_OPTIONS} value={priority} disabled={disabled}
          onChange={v => { if (v) onPriorityChange(v); }} />
        <FormBox
          title="Tipo de mantenimiento"
          options={WO_MAINTENANCE_KINDS_OR_INSPECTION}
          value={type === "INSPECTION" ? "INSPECTION" : form.maintenanceKind}
          disabled={disabled}
          onChange={v => {
            if (v === "INSPECTION") { onTypeChange("INSPECTION"); onChange({ maintenanceKind: null }); return; }
            // Mismo criterio que deriveTypeFromMaintenanceKind en el backend.
            onTypeChange(v === "PREVENTIVO" || v === "PREDICTIVO" ? "PREVENTIVE" : "CORRECTIVE");
            onChange({ maintenanceKind: v });
          }}
        />
        <FormBox title="Sistema" options={WO_SYSTEM_AREAS} value={form.systemArea} disabled={disabled}
          onChange={v => onChange({ systemArea: v })} />
      </div>

    </div>
  );
}

/**
 * Cierre del formulario: TAREA CONCLUIDA? + DETALLE DE PENDIENTES.
 * Va aparte porque se completa al terminar el trabajo, no al abrir la OT —
 * en el modal se monta entre Avances y Resultado.
 */
export function WoRegiClosure({ form, onChange, disabled }: {
  form: WoRegiForm;
  onChange: (patch: Partial<WoRegiForm>) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-4 bg-teal-500/5 border border-teal-500/20 rounded-2xl p-4">
      <div>
        <label className={labelCls}>¿Tarea concluida?</label>
        <OptionRow
          options={[{ value: "YES", label: "Sí" }, { value: "NO", label: "No" }]}
          value={form.taskCompleted}
          disabled={disabled}
          onChange={v => onChange({ taskCompleted: v as WoRegiForm["taskCompleted"] })}
        />
      </div>

      <div>
        <label className={labelCls}>Detalle de pendientes (materiales/tareas)</label>
        <textarea
          className={inputCls + " min-h-[64px] resize-y"}
          value={form.pendingDetail}
          disabled={disabled}
          onChange={e => onChange({ pendingDetail: e.target.value })}
          placeholder="Qué quedó pendiente y por qué"
        />
      </div>
    </div>
  );
}
