import React from "react";
import { RefreshCw, ArrowLeft, type LucideIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useT } from "../lib/i18n";
import { RECORD_IDENTITY, type RecordKind } from "../lib/record-identity";

interface PageHeaderProps {
  icon: LucideIcon;
  title: string;
  total?: number;
  onReload?: () => void;
  children?: React.ReactNode;
  /**
   * Oculta el botón "Volver" en esta pantalla. Sirve para las que son punto de
   * entrada y no tiene sentido salir hacia atrás.
   */
  hideBack?: boolean;
  /**
   * Entidad de la pantalla, cuando es una de las tres que se confunden entre sí
   * (Plan de Mantenimiento / OT / SS). Pinta el recuadro del ícono con su color,
   * el mismo que lleva la ventana del registro. Sin esto, las tres pantallas
   * tienen el encabezado idéntico y sólo cambia el ícono.
   */
  kind?: RecordKind;
}

/**
 * Botón "Volver" — vuelve a la pantalla anterior, como la flecha del navegador.
 *
 * Sólo aparece si hay a dónde volver. react-router numera cada entrada del
 * historial en `window.history.state.idx`; si vale 0 el usuario entró directo
 * por un link o recargó la página, y `navigate(-1)` lo sacaría del sistema
 * (a la pestaña anterior o a una página en blanco). Por eso se esconde en vez
 * de quedar puesto y romper.
 */
const BackButton: React.FC = () => {
  const navigate = useNavigate();
  const t = useT();
  const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
  if (idx <= 0) return null;
  return (
    <button
      type="button"
      onClick={() => navigate(-1)}
      title={t("common.back")}
      aria-label={t("common.back")}
      className="p-2 -ml-1 rounded-xl text-fg/40 hover:text-fg hover:bg-fg/5 transition-all shrink-0"
    >
      <ArrowLeft className="w-5 h-5" />
    </button>
  );
};

export const PageHeader: React.FC<PageHeaderProps> = ({
  icon: Icon, title, total, onReload, children, hideBack, kind,
}) => (
  <div className="flex items-center justify-between gap-4 flex-wrap">
    <div className="flex items-center gap-3">
      {!hideBack && <BackButton />}
      <div className={`p-2 rounded-xl border ${kind ? RECORD_IDENTITY[kind].box : "bg-accent/10 border-accent/20"}`}>
        <Icon className={`w-5 h-5 ${kind ? RECORD_IDENTITY[kind].text : "text-accent"}`} />
      </div>
      <div>
        <h2 className="text-lg font-bold text-fg">{title}</h2>
        {total !== undefined && (
          <p className="text-xs text-fg/40">{total} registro{total !== 1 ? "s" : ""}</p>
        )}
      </div>
    </div>
    <div className="flex items-center gap-2">
      {children}
      {onReload && (
        <button
          onClick={onReload}
          className="p-1.5 rounded-lg hover:bg-fg/5 text-fg/40 hover:text-fg transition-all"
          title="Actualizar"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      )}
    </div>
  </div>
);
