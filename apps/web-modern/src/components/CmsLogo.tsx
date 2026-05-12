import React from "react";

/**
 * Logo del CMS: mitad engranaje (lado izquierdo) + mitad circuito (lado derecho).
 *
 * - Engranaje: representa el mantenimiento mecánico tradicional
 * - Circuito: representa la asistencia digital / IA del copiloto
 *
 * Usa currentColor para que herede el color del parent.
 * Pasale className para ajustar el tamaño con Tailwind (ej. "w-5 h-5").
 */
export const CmsLogo: React.FC<{ className?: string; title?: string }> = ({
  className = "w-5 h-5",
  title = "CMS",
}) => (
  <svg
    viewBox="0 0 32 32"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    role="img"
    aria-label={title}
  >
    <title>{title}</title>

    {/* ── Mitad izquierda: engranaje ─────────────────────────────────────── */}
    {/* Cuerpo del engranaje (semicírculo) */}
    <path d="M 16 5.5 A 10.5 10.5 0 0 0 16 26.5" />
    {/* Centro */}
    <circle cx="11" cy="16" r="2.8" />
    {/* Dientes del engranaje (sobre el borde izquierdo del semicírculo) */}
    <line x1="16" y1="3" x2="16" y2="5.5" />
    <line x1="9.5" y1="4.7" x2="10.5" y2="7" />
    <line x1="4.7" y1="9.5" x2="7" y2="10.5" />
    <line x1="3" y1="16" x2="5.5" y2="16" />
    <line x1="4.7" y1="22.5" x2="7" y2="21.5" />
    <line x1="9.5" y1="27.3" x2="10.5" y2="25" />
    <line x1="16" y1="29" x2="16" y2="26.5" />

    {/* ── Línea divisoria vertical (sutil) ───────────────────────────────── */}
    <line x1="16" y1="6" x2="16" y2="26" strokeOpacity="0.25" strokeDasharray="1 2" />

    {/* ── Mitad derecha: circuito ────────────────────────────────────────── */}
    {/* Trazas horizontales */}
    <line x1="16" y1="10" x2="22" y2="10" />
    <line x1="22" y1="10" x2="24" y2="12" />
    <line x1="24" y1="12" x2="28" y2="12" />

    <line x1="16" y1="16" x2="20" y2="16" />
    <line x1="20" y1="16" x2="22" y2="18" />
    <line x1="22" y1="18" x2="28" y2="18" />

    <line x1="16" y1="22" x2="25" y2="22" />

    {/* Nodos (pads / pines) — rellenos para que se distingan */}
    <circle cx="22" cy="10" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="28" cy="12" r="1"   fill="currentColor" stroke="none" />
    <circle cx="20" cy="16" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="28" cy="18" r="1"   fill="currentColor" stroke="none" />
    <circle cx="25" cy="22" r="0.9" fill="currentColor" stroke="none" />
  </svg>
);
