import React from "react";

/**
 * Spinner para los límites de <Suspense> mientras baja el chunk de una página
 * cargada bajo demanda (code-splitting por ruta en App.tsx).
 *
 * - `full`  → ocupa toda la pantalla (carga inicial / layout mobile).
 * - default → ocupa el área de contenido (transición entre páginas del tenant,
 *             dejando visible el sidebar/header del Layout).
 */
export const PageLoader: React.FC<{ full?: boolean }> = ({ full }) => (
  <div
    className={`flex items-center justify-center bg-bg ${full ? "h-screen w-screen" : "h-full w-full py-20"}`}
    role="status"
    aria-live="polite"
  >
    <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />
  </div>
);
