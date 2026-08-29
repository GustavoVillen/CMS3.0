// Piezas de los formularios controlados dibujados como el papel.
//
// Las usan la Solicitud de Servicio (REGI-LOG-01.3) y la Orden de Trabajo
// (REGI-OPE-26.3): los dos documentos comparten el mismo lenguaje visual —
// franja azul marino de seccion, celda-etiqueta blanca sobre azul, casillero
// cuadrado, tablas de borde fino y bloques de firma. Si el impreso cambia de
// estilo, se cambia aca y cambian los dos.

import React from "react";
import { Check } from "lucide-react";
import { AutoTextArea } from "../AutoTextArea";
import { fmtDate } from "../../lib/utils";

/** Azul marino del documento controlado (mismo que MaintenancePlans). */
export const PAPER_NAVY = "#0f172a";

/** Campo escrito dentro de una celda: sin caja propia, como sobre el papel. */
export const paperFieldCls =
  "w-full bg-transparent text-[13px] text-fg placeholder-text-industrial/30 outline-none disabled:opacity-70";

/** Casillero cuadrado del formulario. */
export function PaperBox({ on }: { on: boolean }) {
  return (
    <span className={`shrink-0 w-3.5 h-3.5 border flex items-center justify-center ${
      on ? "bg-fg border-fg" : "border-fg/50 bg-transparent"
    }`}>
      {on && <Check className="w-2.5 h-2.5 text-surface" strokeWidth={3.5} />}
    </span>
  );
}

/** Franja azul de seccion, texto blanco a la izquierda (igual que el impreso). */
export function PaperBar({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <div
      className="px-2 py-1 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-white"
      style={{ backgroundColor: PAPER_NAVY }}
    >
      <span className="flex-1 min-w-0">{title}</span>
      {/* Herramientas de la app que no estan en el papel (sugerir con IA, ver
          historial…): chiquitas y a la derecha, para no romper la franja. */}
      {right && <span className="shrink-0 flex items-center gap-1">{right}</span>}
    </div>
  );
}

/** Celda-etiqueta azul (REMOLCADOR, FECHA, ORDEN DE TRABAJO…). */
export function PaperLabelCell({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`px-2 py-1.5 flex items-center text-[9px] font-bold uppercase tracking-wide text-white leading-tight ${className}`}
      style={{ backgroundColor: PAPER_NAVY }}
    >
      {children}
    </div>
  );
}

/** Celda de dato: fondo del papel, texto normal. */
export function PaperValueCell({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`px-2 py-1.5 flex items-center text-[13px] text-fg min-w-0 ${className}`}>{children}</div>;
}

/** Fila de celdas con las lineas verticales del formulario. */
export function PaperRow({ children }: { children: React.ReactNode }) {
  return <div className="flex divide-x divide-fg/25 border-b border-fg/25">{children}</div>;
}

/** Renglones de texto libre (DESCRIPCION / TAREA / PENDIENTES…). */
export function PaperTextArea({ value, onChange, disabled, placeholder, rows = 3 }: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  rows?: number;
}) {
  // `rows` es sólo el piso: un recuadro vacío no se ve como una raya. El alto
  // real lo pone AutoTextArea, que abre el campo estirado hasta su última línea
  // (con alto fijo la hoja escondía media TAREA detrás de un scroll interno).
  return (
    <AutoTextArea
      className={`${paperFieldCls} block px-2 py-1.5 resize-y border-b border-fg/25`}
      style={{ minHeight: `${rows * 20 + 12}px` }}
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      onChange={e => onChange(e.target.value)}
    />
  );
}

/**
 * Fila de casilleros del papel: el rotulo arriba y el cuadradito abajo, cada
 * opcion en su columna. Con `single`, volver a tocar la marcada la limpia; si
 * no, se pueden marcar varias.
 */
export function PaperCheckRow({ options, selected, onToggle, disabled }: {
  options: Array<{ value: string; label: string }>;
  selected: string[];
  onToggle: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex divide-x divide-fg/25 border-b border-fg/25">
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          disabled={disabled}
          onClick={() => onToggle(o.value)}
          className="flex-1 min-w-0 flex flex-col items-center gap-1 px-1 py-1.5 transition-colors hover:bg-fg/5 disabled:opacity-70 disabled:hover:bg-transparent"
        >
          <span className="text-[9px] font-bold uppercase tracking-wide text-text-industrial/60 text-center leading-tight">
            {o.label}
          </span>
          <PaperBox on={selected.includes(o.value)} />
        </button>
      ))}
    </div>
  );
}

/**
 * Recuadro de opciones en vertical, con su titulo arriba — los del papel que van
 * uno al lado del otro (PRIORIDAD / TIPO DE MANTENIMIENTO / SISTEMA).
 */
export function PaperOptionBox({ title, options, value, onChange, disabled }: {
  title: string;
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex-1 min-w-0 border-r border-fg/25 last:border-r-0">
      <div className="px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-text-industrial/70 text-center border-b border-fg/25 bg-fg/5">
        {title}
      </div>
      {options.map(o => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            disabled={disabled}
            // Volver a tocar la opcion activa la limpia: el papel admite recuadros vacios.
            onClick={() => onChange(on ? "" : o.value)}
            className={`w-full flex items-center gap-2 px-2 py-1 border-b border-fg/15 last:border-b-0 text-left transition-colors disabled:opacity-70 ${
              on ? "bg-fg/5" : "hover:bg-fg/5"
            }`}
          >
            <PaperBox on={on} />
            <span className={`flex-1 min-w-0 text-[10px] leading-tight ${on ? "font-bold text-fg" : "text-text-industrial/70"}`}>
              {o.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Encabezado de tabla del papel (REPUESTOS, PROGRAMACION, HOJA DE RUTA…). */
export function PaperTableHead({ cols }: { cols: Array<{ label: string; className: string }> }) {
  return (
    <div className="flex divide-x divide-fg/25 border-b border-fg/25 bg-fg/5">
      {cols.map(c => (
        <div key={c.label} className={`px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-text-industrial/60 text-center ${c.className}`}>
          {c.label}
        </div>
      ))}
    </div>
  );
}

/**
 * Bloque de firma: rotulo, espacio de firma (con la imagen si la persona la
 * tiene cargada), linea, nombre y fecha — igual que el impreso.
 */
export function PaperSignColumn({ rol, rejected, at, signatureUrl, children }: {
  rol: string;
  rejected?: boolean;
  at?: string | null;
  /** Firma digital de quien ejecuto el paso, si la tiene cargada. */
  signatureUrl?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="flex-1 min-w-0 bg-fg/[0.03] px-2 pt-1.5 pb-2 flex flex-col">
      <p className={`text-[9px] font-bold uppercase tracking-wide text-center leading-tight ${
        rejected ? "text-red-600 dark:text-red-400" : "text-text-industrial/60"
      }`}>
        {rejected ? `${rol} — NO APROBADA` : rol}
      </p>
      {/* En modo oscuro el trazo de la firma es oscuro sobre fondo oscuro: se
          invierte para que se vea, igual que un logo. */}
      <div className="h-14 flex items-end justify-center overflow-hidden">
        {signatureUrl && (
          <img
            src={signatureUrl}
            alt={`Firma de ${rol.toLowerCase()}`}
            className="max-h-14 max-w-full object-contain dark:invert dark:brightness-95"
          />
        )}
      </div>
      <div className="border-t border-fg/30 pt-1">{children}</div>
      <p className="text-[9px] text-text-industrial/40 text-center mt-0.5 h-3">{at ? fmtDate(at) : ""}</p>
    </div>
  );
}

/** Metadatos del documento controlado (los mismos que estampa el PDF). */
export interface PaperDocMeta {
  formCode: string;
  title: string;
  revision: number;
  effectiveFrom: string;
  preparedBy: string;
  reviewedBy: string;
  approvedBy: string;
}

/** Cabecera del documento controlado: logo, codigo + titulo, revision. */
export function PaperDocHeader({ meta, logoUrl, tenantName }: {
  meta: PaperDocMeta;
  logoUrl: string | null;
  tenantName: string;
}) {
  return (
    <div className="flex divide-x divide-fg/25 border-b border-fg/25">
      <div className="w-40 shrink-0 flex items-center justify-center p-2">
        {logoUrl
          ? <img src={logoUrl} alt={tenantName} className="max-h-10 max-w-full object-contain" />
          : <span className="text-[11px] font-bold text-text-industrial/60 text-center">{tenantName}</span>}
      </div>
      <div className="flex-1 min-w-0 flex flex-col items-center justify-center py-2">
        <p className="text-[13px] font-bold text-accent">{meta.formCode}</p>
        <p className="text-[13px] font-bold text-fg">{meta.title}</p>
      </div>
      <div className="w-52 shrink-0 text-[9px] divide-y divide-fg/25">
        <div className="flex divide-x divide-fg/25">
          <span className="flex-1 px-1.5 py-1 text-text-industrial/60">Revisión N°</span>
          <span className="w-16 px-1.5 py-1 font-bold text-fg text-center">{meta.revision}</span>
        </div>
        <div className="flex divide-x divide-fg/25">
          <span className="flex-1 px-1.5 py-1 text-text-industrial/60">Desde:</span>
          <span className="w-16 px-1.5 py-1 font-bold text-fg text-center">{meta.effectiveFrom}</span>
        </div>
        <div className="px-1.5 py-1 text-right font-bold text-accent">Documento Controlado</div>
      </div>
    </div>
  );
}

/** Pie del documento controlado (Elaborado / Revisado / Aprobado). */
export function PaperDocFooter({ meta }: { meta: PaperDocMeta }) {
  return (
    <div className="flex divide-x divide-fg/25 bg-fg/5 text-[9px] text-text-industrial/60">
      <span className="flex-1 px-2 py-1 text-center">Elaborado: {meta.preparedBy}</span>
      <span className="flex-1 px-2 py-1 text-center">Revisado: {meta.reviewedBy}</span>
      <span className="flex-1 px-2 py-1 text-center">Aprobado: {meta.approvedBy}</span>
    </div>
  );
}

/** La hoja: marco del formulario. */
export function PaperSheet({ children }: { children: React.ReactNode }) {
  return <div className="border border-fg/25 bg-surface">{children}</div>;
}
