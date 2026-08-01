// Ventanita de aviso con un único botón "OK".
//
// Para mensajes que el usuario TIENE que ver antes de seguir (validaciones que
// impiden guardar, errores de una acción). Antes estos avisos se pintaban como
// un recuadro rojo al pie del formulario: en formularios largos quedaban fuera
// de la vista y parecía que el botón no había hecho nada.
//
// Se monta por encima de cualquier modal (z-[210], arriba del diálogo de
// cambios sin guardar) y no se cierra al clickear afuera: el aviso se descarta
// a propósito, con OK, Esc o la X.
//
// Uso:
//   {error && <AlertDialog message={error} onClose={() => setError(null)} />}

import React, { useEffect, useRef } from "react";
import { AlertTriangle } from "lucide-react";
import { ModalCloseButton } from "./ModalCloseButton";
import { useT } from "../lib/i18n";

interface Props {
  /** Texto del aviso. */
  message: string;
  /** Título del recuadro. Default: "Atención". */
  title?: string;
  /** Descarta el aviso (normalmente limpia el estado de error). */
  onClose: () => void;
}

export const AlertDialog: React.FC<Props> = ({ message, title, onClose }) => {
  const t = useT();
  const okRef = useRef<HTMLButtonElement>(null);

  // Foco en OK: se descarta con Enter o con la barra espaciadora, sin usar el mouse.
  useEffect(() => { okRef.current?.focus(); }, []);

  // Esc cierra sólo este aviso. Se captura para que no llegue al modal de atrás
  // (si no, descartar el aviso cerraría también el formulario).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div
        role="alertdialog"
        aria-modal="true"
        className="bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="flex items-center gap-2 text-base font-bold text-fg">
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
            {title ?? t("common.attention")}
          </h2>
          <ModalCloseButton onClose={onClose} />
        </div>

        <p className="text-sm text-text-industrial/80 leading-relaxed whitespace-pre-line">{message}</p>

        <div className="flex justify-end pt-1">
          <button
            ref={okRef}
            type="button"
            onClick={onClose}
            className="px-6 py-2.5 rounded-xl bg-accent text-accent-fg text-sm font-bold hover:bg-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
};
