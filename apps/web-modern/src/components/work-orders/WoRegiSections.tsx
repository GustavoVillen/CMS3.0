// Secciones del formulario controlado de Orden de Trabajo (REGI-OPE-26.3).
// Se montan dentro del modal de OT (WorkOrders.tsx), sólo para los tenants que
// usan el formulario de Mercurio.
//
// Sólo los recuadros que el papel pide y el sistema no tenía: quién solicita,
// a qué área se asigna, tipo de mantenimiento (5 opciones), sistema, nro de
// viaje, pendientes y los repuestos/materiales planificados. El resto (equipo,
// fechas, prioridad, riesgo, firmas) ya vive en el modal.

import React from "react";
import { Check, Plus, Trash2 } from "lucide-react";
import {
  WO_REQUESTED_BY, WO_ASSIGNED_TO, WO_SYSTEM_AREAS, WO_MAINTENANCE_KINDS,
  WO_PRIORITY_OPTIONS, type FormOption,
} from "../../lib/wo-form-catalog";

const inputCls = "w-full bg-fg/5 border border-fg/10 rounded-lg px-2.5 py-1.5 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 disabled:opacity-60";
const labelCls = "block text-[10px] font-bold text-text-industrial/40 uppercase tracking-widest mb-1";
// Igual que inputCls pero SIN `w-full`: en las filas de repuestos/materiales el
// ancho lo decide el flex. Con `w-full` los tres campos piden el 100% y el de
// descripción queda aplastado a unos pocos píxeles.
const cellCls = "bg-fg/5 border border-fg/10 rounded-lg px-2.5 py-1.5 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 disabled:opacity-60";

export interface WoPlannedItem {
  id?: string;
  kind: "SPARE" | "MATERIAL";
  description: string;
  quantity: number;
  unit: string;
}

export interface WoRegiForm {
  voyageNumber: string;
  requestedByArea: string;
  assignedToArea: string;
  systemArea: string;
  maintenanceKind: string;
  pendingDetail: string;
  taskCompleted: "" | "YES" | "NO";
}

export const EMPTY_WO_REGI: WoRegiForm = {
  voyageNumber: "", requestedByArea: "", assignedToArea: "",
  systemArea: "", maintenanceKind: "", pendingDetail: "", taskCompleted: "",
};

const PRIORITY_HINT = "La prioridad se elige arriba, en Información. Acá se muestra como plazo, que es como la expresa el formulario.";

/**
 * Recuadro del formulario: cabecera + opciones en vertical con su casilla,
 * igual que en el papel (PRIORIDAD / TIPO DE MANTENIMIENTO / SISTEMA van así,
 * uno al lado del otro). Volver a tocar la opción activa la limpia.
 */
function FormBox({ title, options, value, onChange, disabled }: {
  title: string;
  options: FormOption[];
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="rounded-lg border border-fg/15 overflow-hidden">
      <div className="bg-accent text-accent-fg text-[10px] font-bold uppercase tracking-wider text-center py-1.5 px-2">
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
            className={`w-full flex items-center gap-2 px-2 py-1.5 border-t border-fg/10 text-left transition-colors disabled:opacity-60 ${
              on ? "bg-accent/10" : "hover:bg-fg/5"
            }`}
          >
            <span className={`flex-1 min-w-0 text-[11px] leading-tight ${on ? "font-bold text-fg" : "text-text-industrial/70"}`}>
              {o.label}
            </span>
            {/* Casilla, como la del papel */}
            <span className={`shrink-0 w-3.5 h-3.5 rounded-[3px] border flex items-center justify-center ${
              on ? "bg-accent border-accent" : "border-fg/30"
            }`}>
              {on && <Check className="w-2.5 h-2.5 text-accent-fg" strokeWidth={3} />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Botonera de opción única — para los recuadros horizontales del papel. */
function OptionRow({ options, value, onChange, disabled }: {
  options: FormOption[];
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex gap-2 flex-wrap">
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          disabled={disabled}
          // Volver a tocar la opción activa la limpia: el papel admite recuadros vacíos.
          onClick={() => onChange(value === o.value ? "" : o.value)}
          className={`px-3 py-1 rounded text-xs font-bold border transition-colors disabled:opacity-50 ${
            value === o.value
              ? "bg-accent text-accent-fg border-accent"
              : "bg-fg/5 text-text-industrial/60 border-fg/10 hover:border-accent/40"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Valor centinela del select: "la empresa no está en el catálogo". */
const OTRA = "__OTRA__";

export function WoRegiSections({
  form, onChange, items, onItemsChange, priority, disabled,
  providers, providerId, onProviderChange, location, onLocationChange, onPriorityChange,
  providerOther, onProviderOtherChange,
  saving, saved, error,
}: {
  form: WoRegiForm;
  onChange: (patch: Partial<WoRegiForm>) => void;
  /** Estado del auto-guardado del bloque (lo maneja el modal de la OT). */
  saving?: boolean;
  saved?: boolean;
  error?: string | null;
  items: WoPlannedItem[];
  onItemsChange: (items: WoPlannedItem[]) => void;
  /** Prioridad de la OT. El papel la nombra como plazo: es el mismo dato. */
  priority: string;
  onPriorityChange: (v: string) => void;
  disabled?: boolean;
  /** Talleres del buque — se ofrecen cuando el trabajo se terceriza. */
  providers: Array<{ id: string; name: string; providerCode: string }>;
  providerId: string;
  onProviderChange: (id: string) => void;
  /** Empresa tercerizada escrita a mano, cuando no está en el catálogo. */
  providerOther: string;
  onProviderOtherChange: (v: string) => void;
  /** UBICACION — va en la cabecera del papel, junto a Unidad y Equipo. */
  location: string;
  onLocationChange: (v: string) => void;
}) {
  // Arranca en "otra empresa" si la OT ya se guardó con un nombre escrito a mano.
  const [otraEmpresa, setOtraEmpresa] = React.useState(!providerId && !!providerOther);

  const addItem = (kind: "SPARE" | "MATERIAL") =>
    onItemsChange([...items, { kind, description: "", quantity: 1, unit: "ud" }]);
  const patchItem = (idx: number, patch: Partial<WoPlannedItem>) =>
    onItemsChange(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  const removeItem = (idx: number) => onItemsChange(items.filter((_, i) => i !== idx));

  const itemsTable = (kind: "SPARE" | "MATERIAL", title: string) => {
    const rows = items.map((it, i) => ({ it, i })).filter(r => r.it.kind === kind);
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className={labelCls + " mb-0"}>{title}</p>
          {!disabled && (
            <button
              type="button"
              onClick={() => addItem(kind)}
              className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-accent/10 border border-accent/20 text-accent text-[10px] font-bold uppercase tracking-wider hover:bg-accent/20"
            >
              <Plus className="w-3 h-3" /> Agregar
            </button>
          )}
        </div>
        {rows.length === 0 ? (
          <p className="text-[11px] text-text-industrial/40 italic">Sin {title.toLowerCase()}.</p>
        ) : (
          <div className="space-y-1.5">
            {rows.map(({ it, i }) => (
              <div key={it.id ?? i} className="flex gap-1.5 items-center">
                {/* min-w-0 para que el campo pueda encogerse sin empujar a los otros */}
                <input
                  className={cellCls + " flex-1 min-w-0"}
                  placeholder={kind === "SPARE" ? "Ej. Reten de eje 120x150" : "Ej. Grasa marina EP2"}
                  value={it.description}
                  disabled={disabled}
                  onChange={e => patchItem(i, { description: e.target.value })}
                />
                <input
                  type="number" min={0} step="any"
                  className={cellCls + " w-16 shrink-0 text-center"}
                  value={it.quantity}
                  disabled={disabled}
                  onChange={e => patchItem(i, { quantity: Number(e.target.value) })}
                />
                <input
                  className={cellCls + " w-14 shrink-0 text-center"}
                  placeholder="ud"
                  value={it.unit}
                  disabled={disabled}
                  onChange={e => patchItem(i, { unit: e.target.value })}
                />
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => removeItem(i)}
                    className="shrink-0 p-1.5 rounded-lg text-text-industrial/40 hover:text-red-500 hover:bg-red-500/10"
                    aria-label="Quitar ítem"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

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
        <label className={labelCls}>Solicitado por</label>
        <OptionRow options={WO_REQUESTED_BY} value={form.requestedByArea} disabled={disabled}
          onChange={v => onChange({ requestedByArea: v })} />
      </div>

      <div>
        <label className={labelCls}>Asignado a</label>
        <OptionRow options={WO_ASSIGNED_TO} value={form.assignedToArea} disabled={disabled}
          onChange={v => onChange({ assignedToArea: v })} />
        {/* Tercerizado = lo hace una empresa externa → acá se dice cuál. Puede no
            estar en el catálogo: en ese caso se escribe el nombre, y el resto del
            sistema (PDF incluido) lo trata igual que a uno de la lista. */}
        {form.assignedToArea === "TERCERIZADO" && (
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
        )}
      </div>

      {/* Los tres recuadros van uno al lado del otro, como en el papel.
          PRIORIDAD es la prioridad de la OT (arriba se ve como Crítica/Alta/…):
          mismo dato, nombrado como plazo para quien completa el formulario. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <FormBox title="Prioridad" options={WO_PRIORITY_OPTIONS} value={priority} disabled={disabled}
          onChange={v => { if (v) onPriorityChange(v); }} />
        <FormBox title="Tipo de mantenimiento" options={WO_MAINTENANCE_KINDS} value={form.maintenanceKind} disabled={disabled}
          onChange={v => onChange({ maintenanceKind: v })} />
        <FormBox title="Sistema" options={WO_SYSTEM_AREAS} value={form.systemArea} disabled={disabled}
          onChange={v => onChange({ systemArea: v })} />
      </div>

      <div className="grid grid-cols-2 gap-4 border-t border-fg/10 pt-4">
        {itemsTable("SPARE", "Repuestos")}
        {itemsTable("MATERIAL", "Materiales")}
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
