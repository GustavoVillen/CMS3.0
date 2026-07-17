// Cáscara de los modales chicos que reemplazan a prompt()/confirm() del
// navegador. Los diálogos nativos trancan la pestaña, no se pueden estilar, no
// admiten más de un campo y en el PMS aparecían justo en los pasos que exigen
// varios datos (ej. ENTREGA / RECEPCION: quién recibe + conformidad + notas).
//
// Se apila sobre un modal ya abierto (z-[60] > z-50).
//
// OJO — el ESC se maneja acá con un listener propio, NO con useEscapeGuard.
// Ese hook está pensado para modales de pantalla completa / con ruta propia:
// cada `register` hace history.pushState y cada `unregister` un history.back()
// para que el botón Atrás de Android cierre el modal. Anidar un guard adentro de
// otro genera backs programáticos superpuestos, y el provider los distingue con
// un único booleano (programmaticBackRef) → uno se lee como "back del usuario",
// dispara el onClose del guard de abajo y cierra el modal padre. Eso rompía
// "Nueva SS" desde la OT: navegaba a /work-orders apenas abría.
// Un diálogo de confirmación anidado no necesita entrada de historial propia.
//
// Uso:
//   <FormModal title="Servicio recibido" onClose={...} error={err}
//     footer={<><button>Cancelar</button><button>Confirmar</button></>}>
//     …campos…
//   </FormModal>

import React, { useEffect } from "react";
import { ModalCloseButton } from "./ModalCloseButton";

interface Props {
  title: string;
  subtitle?: string;
  onClose: () => void;
  /** Botones del pie, de izquierda a derecha (Cancelar, Confirmar). */
  footer: React.ReactNode;
  /** Error de la última acción. Se muestra dentro del modal, no en un alert(). */
  error?: string | null;
  children: React.ReactNode;
}

export const FormModal: React.FC<Props> = ({ title, subtitle, onClose, footer, error, children }) => {
  // ESC cierra sólo este diálogo. En captura + stopPropagation para ganarle al
  // listener global de EscapeGuardProvider (document, en burbuja): si no, el ESC
  // cerraría también el modal de abajo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      e.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    // El clic afuera NO cierra: son formularios con datos tipeados y perderlos
    // por un clic al costado es un mal negocio. Se sale por la X o por Cancelar.
    // stopPropagation además frena el clic acá: este diálogo se monta DENTRO del
    // overlay del modal de abajo (ej. el de la SS), que sí cierra al clic afuera
    // — sin esto, un clic en el fondo del diálogo cerraría el modal padre.
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      onClick={e => e.stopPropagation()}
    >
      <div
        className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl bg-bg border border-fg/10 shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-fg/10">
          <div className="min-w-0">
            <p className="text-sm font-bold text-text-industrial truncate">{title}</p>
            {subtitle && <p className="text-[11px] text-text-industrial/50 truncate">{subtitle}</p>}
          </div>
          <ModalCloseButton onClose={onClose} />
        </div>

        <div className="px-5 py-4 space-y-3">{children}</div>

        {error && (
          <p className="mx-5 mb-3 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-[11px] text-red-700 dark:text-red-400">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-fg/10">{footer}</div>
      </div>
    </div>
  );
};
