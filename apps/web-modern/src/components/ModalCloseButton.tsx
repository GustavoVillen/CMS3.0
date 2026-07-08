// Botón de cierre estándar para TODOS los modales/ventanas de la app.
//
// Objetivo: un cierre siempre visible y con color llamativo (círculo rojo con
// una X blanca), colocado en la fila del título del modal — sin agregar una
// fila nueva ni tapar contenido. Reemplaza las X grises tenues que cada modal
// definía por su cuenta y unifica el patrón en un solo lugar.
//
// Uso:
//   <div className="flex items-center justify-between ...">
//     <h2>Título</h2>
//     <ModalCloseButton onClose={onClose} />
//   </div>
//
// Nota: el manejo de la tecla Esc lo siguen haciendo los modales que ya lo
// implementan (useEscapeGuard); este componente es solo el botón.

import React from "react";
import { X } from "lucide-react";
import { useT } from "../lib/i18n";

interface Props {
  /** Handler que cierra el modal (onClose, closeLink, () => setEditing(null), etc.). */
  onClose: () => void;
  /** Etiqueta accesible / tooltip. Default: traducción de "common.close" ("Cerrar"). */
  label?: string;
  /** Clases extra opcionales (ej. para ajustar el margen en un header particular). */
  className?: string;
}

export const ModalCloseButton: React.FC<Props> = ({ onClose, label, className = "" }) => {
  const t = useT();
  const text = label ?? t("common.close");
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label={text}
      title={text}
      className={`shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-full bg-rose-600 text-white hover:bg-rose-500 active:scale-95 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface ${className}`}
    >
      <X className="w-[18px] h-[18px]" strokeWidth={2.4} />
    </button>
  );
};
