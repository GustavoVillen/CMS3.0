// Grilla de embarcaciones con tildes, en dos columnas.
//
// Nació en Equipo → "Asignación de Flota" (a qué buques alcanza un usuario) y
// se sacó acá cuando el asistente de Nueva OT necesitó la misma selección: con
// una flota de 30+ barcazas, una lista desplegable obliga a recorrerla entera,
// y ver los buques todos juntos es lo que permite elegir un convoy de un vistazo.
//
// Muestra CÓDIGO y NOMBRE: el código es lo que el usuario tipea y busca, el
// nombre es lo que reconoce. Los dos, no uno.

import React from "react";
import { Anchor, Check } from "lucide-react";
import { useVesselContext } from "../lib/vessel-context";

export interface VesselPickerOption {
  code: string;
  name: string;
}

interface Props {
  selected: Set<string>;
  onToggle: (code: string) => void;
  /** Encabezado del recuadro. */
  title: string;
  /** Por defecto, los buques del alcance del usuario (VesselContext). */
  vessels?: VesselPickerOption[];
  /**
   * Embarcaciones que no se pueden tildar en este momento, por código.
   * Siguen a la vista —esconderlas dejaría al usuario preguntándose dónde está
   * su buque— pero apagadas: `note` se lee en la tarjeta misma y `title` da el
   * motivo completo al pasar el mouse. Los motivos son varios (un remolcador no
   * se abre en grupo; una embarcación sin equipos no puede recibir una OT), así
   * que cada una trae el suyo.
   */
  disabled?: Map<string, { title: string; note?: string }>;
  /** Se marca aparte: es la embarcación de la que salen equipo y tarea. */
  primaryCode?: string | null;
  primaryLabel?: string;
  /** Qué decir cuando el tenant todavía no tiene buques cargados. */
  emptyMessage?: React.ReactNode;
}

const labelCls = "block text-[10px] font-semibold text-text-industrial/60 uppercase tracking-wider";

export const VesselPickerGrid: React.FC<Props> = ({
  selected, onToggle, title, vessels, disabled,
  primaryCode, primaryLabel, emptyMessage,
}) => {
  const ctx = useVesselContext();
  const items = vessels ?? ctx.vessels;

  return (
    <div className="space-y-3">
      <p className={labelCls + " flex items-center gap-1.5"}>
        <Anchor className="w-3 h-3 text-accent" />{title}
      </p>
      {items.length === 0 ? (
        <p className="text-xs text-text-industrial/30">{emptyMessage}</p>
      ) : (
        <div className="grid grid-cols-2 gap-1.5">
          {items.map(v => {
            const active = selected.has(v.code);
            const block = active ? undefined : disabled?.get(v.code);
            const isPrimary = primaryCode === v.code;
            return (
              <button
                key={v.code}
                type="button"
                disabled={!!block}
                title={block ? block.title : `${v.code} — ${v.name}`}
                onClick={() => onToggle(v.code)}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-left transition-all ${
                  active
                    ? "bg-accent/15 border-accent/40 text-accent"
                    : block
                      ? "bg-fg/3 border-fg/10 text-text-industrial/25 opacity-50 cursor-not-allowed"
                      : "bg-fg/3 border-fg/10 text-text-industrial/50 hover:bg-fg/8 hover:text-fg"
                }`}
              >
                <div className={`w-3.5 h-3.5 rounded border-2 flex items-center justify-center shrink-0 transition-all ${active ? "bg-accent border-accent" : "border-fg/20"}`}>
                  {active && <Check className="w-2.5 h-2.5 text-accent-fg" />}
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-mono font-bold leading-none">{v.code}</p>
                  <p className="text-[10px] text-text-industrial/40 leading-tight truncate max-w-[80px]">{v.name}</p>
                  {isPrimary && primaryLabel && (
                    <p className="text-[9px] text-accent/80 leading-tight truncate max-w-[90px]">{primaryLabel}</p>
                  )}
                  {block?.note && (
                    <p className="text-[9px] text-text-industrial/40 leading-tight truncate max-w-[90px]">{block.note}</p>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
