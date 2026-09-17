// Piezas de la "vista guiada" de los registros que se completan por etapas
// (Orden de Trabajo y Solicitud de Servicio): bloque plegable numerado, campo
// que falta completar (resaltado en naranja) y rótulo de etapa.
//
// La idea es la misma en los dos registros: se ve qué etapa toca, qué falta
// para avanzar, y cada dato pendiente se reconoce de lejos.

import React from "react";
import { ChevronDown, ChevronUp, Lock, Pencil } from "lucide-react";

/** Bloque plegable numerado. `locked` = etapa futura: se ve, pero no se abre. */
export const GuideSection: React.FC<{
  n: number;
  title: string;
  subtitle: string;
  pill?: React.ReactNode;
  /** Botón propio de la sección, a la izquierda del pill (ej. "Sugerir con IA"). */
  action?: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  locked?: boolean;
  lockedLabel?: string;
  lockedText?: string;
  children: React.ReactNode;
}> = ({ n, title, subtitle, pill, action, open, onToggle, locked, lockedLabel, lockedText, children }) => (
  <section className={`rounded-2xl border border-fg/10 ${locked ? "bg-fg/[0.03] opacity-75" : "bg-surface dark:bg-white/[0.02]"}`}>
    {/* El encabezado NO es un solo <button>: `action` trae botones propios (ej.
        "Sugerir con IA") y un botón dentro de otro es HTML inválido. Se abre y
        se cierra desde el título y desde la flecha. */}
    <div className="flex items-center gap-2.5 w-full px-4 py-3">
      <button type="button" onClick={locked ? undefined : onToggle} disabled={locked}
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left disabled:cursor-default">
        <span className="w-[22px] h-[22px] rounded-full bg-fg text-surface text-[11px] font-bold flex items-center justify-center shrink-0">{n}</span>
        <span className="min-w-0">
          <span className="block text-[13px] font-extrabold text-fg">{title}</span>
          <span className="block text-[11px] text-text-industrial/60">{locked ? lockedText : subtitle}</span>
        </span>
      </button>
      <span className="ml-auto flex items-center gap-2 shrink-0">
        {locked ? (
          <span className="flex items-center gap-1 rounded-full bg-fg/10 px-2 py-0.5 text-[10px] font-bold text-text-industrial/60">
            <Lock className="w-2.5 h-2.5" /> {lockedLabel}
          </span>
        ) : <>{action}{pill}</>}
        {!locked && (
          <button type="button" onClick={onToggle} aria-expanded={open} aria-label={title}
            className="flex items-center text-text-industrial/40 hover:text-fg transition-colors">
            {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        )}
      </span>
    </div>
    {open && !locked && <div className="px-4 pb-4 pt-1 space-y-3.5">{children}</div>}
  </section>
);

/**
 * Envoltorio de un campo. Si falta completarlo: franja y fondo naranja, para
 * que se vea de lejos. `flash` = se llegó tocando "lo que falta": se enciende.
 */
export const GuideField: React.FC<{
  id: string;
  missing: boolean;
  flash?: boolean;
  children: React.ReactNode;
}> = ({ id, missing, flash, children }) => (
  <div id={id} className={`space-y-1.5 rounded-xl transition-shadow ${missing
    ? "border-l-4 border-amber-500 bg-amber-50 dark:bg-amber-500/10 rounded-l-none px-3 py-2.5"
    : ""} ${flash ? "ring-2 ring-amber-500 ring-offset-2 ring-offset-surface" : ""}`}>
    {children}
  </div>
);

/** Etiqueta "✎ Completar" al lado del rótulo de un campo pendiente. */
export const GuideNeedTag: React.FC<{ label: string }> = ({ label }) => (
  <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-600 px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-white align-middle">
    <Pencil className="w-2.5 h-2.5" /> {label}
  </span>
);

/**
 * Asterisco rojo de campo obligatorio (estándar V50). Va SIEMPRE que el campo
 * sea obligatorio, esté lleno o vacío; el "Falta" (GuideNeedTag) sólo mientras
 * está vacío. `reason` = obligatorio por una regla ("por severidad Alta").
 */
export const RequiredMark: React.FC<{ reason?: string | null }> = ({ reason }) => (
  <>
    <span className="ml-0.5 font-black text-red-600 dark:text-red-400" aria-hidden="true">*</span>
    {reason && <span className="ml-1 text-[10.5px] font-semibold normal-case tracking-normal text-amber-700 dark:text-amber-400">{reason}</span>}
  </>
);

/** "Faltan N datos" (naranja) o "Completo" (verde) en el encabezado de un bloque. */
export const GuidePill: React.FC<{ missing: number; completeLabel: string; missingOne: string; missingMany: string }> =
  ({ missing, completeLabel, missingOne, missingMany }) => missing > 0 ? (
    <span className="rounded-full bg-amber-600 px-2.5 py-0.5 text-[11px] font-bold text-white whitespace-nowrap">
      {missing === 1 ? missingOne : missingMany.replace("{n}", String(missing))}
    </span>
  ) : (
    <span className="rounded-full bg-success-sea/15 px-2 py-0.5 text-[10px] font-bold text-success-sea whitespace-nowrap">{completeLabel}</span>
  );

/** Rótulo de etapa ("PREPARAR LA OT ———"), con candado si todavía no llegó. */
export const GuideStageLabel: React.FC<{ text: string; lockedHint?: string | null }> = ({ text, lockedHint }) => (
  <div className="flex items-center gap-2 pt-2 text-[11px] font-extrabold uppercase tracking-widest text-text-industrial/60 after:content-[''] after:flex-1 after:h-px after:bg-fg/10">
    {text}
    {lockedHint && (
      <span className="flex items-center gap-1 normal-case tracking-normal font-semibold text-text-industrial/40">
        <Lock className="w-3 h-3" /> {lockedHint}
      </span>
    )}
  </div>
);
