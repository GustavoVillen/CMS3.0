// Floating Action Button (FAB) para mobile — un solo botón persistente
// con 4 atajos a los reportes más comunes que la tripulación hace a bordo:
// defecto, near miss, foto rápida (avance), avance de OT.
//
// Al tocar abre un sheet con las 4 opciones; cada una invoca un callback
// que el padre (MobileLayout) traduce a cambio de tab + acción.

import React, { useEffect, useState } from "react";
import { Plus, AlertTriangle, AlertOctagon, Camera, Wrench, X, Mic } from "lucide-react";

export type QuickAction =
  | "defect" | "near-miss" | "photo" | "wo-progress"
  | "defect-voice" | "near-miss-voice";

interface QuickActionFabProps {
  onAction: (a: QuickAction) => void;
}

export const QuickActionFab: React.FC<QuickActionFabProps> = ({ onAction }) => {
  const [open, setOpen] = useState(false);

  // ESC cierra el sheet (mejora accesibilidad en pruebas con teclado).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const fire = (a: QuickAction) => { setOpen(false); onAction(a); };

  return (
    <>
      {/* Backdrop + sheet */}
      {open && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-150" onClick={() => setOpen(false)}>
          <div
            className="w-full max-w-md bg-[#0D1B2A] border-t border-white/10 rounded-t-3xl p-5 pb-8 space-y-3 animate-in slide-in-from-bottom duration-200"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-[10px] uppercase tracking-widest text-accent font-bold">Acción rápida</p>
                <h2 className="text-sm font-bold text-white">¿Qué necesitás reportar?</h2>
              </div>
              <button onClick={() => setOpen(false)} className="p-1.5 rounded-lg text-text-industrial/40 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <ActionTile
                Icon={AlertTriangle}
                label="Reportar defecto"
                hint="Algo está roto o degradado"
                color="text-orange-400 bg-orange-500/10 border-orange-500/30"
                onClick={() => fire("defect")}
                onMicClick={() => fire("defect-voice")}
                micAriaLabel="Reportar defecto por voz"
              />
              <ActionTile
                Icon={AlertOctagon}
                label="Near miss"
                hint="Casi pasa algo grave"
                color="text-yellow-400 bg-yellow-500/10 border-yellow-500/30"
                onClick={() => fire("near-miss")}
                onMicClick={() => fire("near-miss-voice")}
                micAriaLabel="Reportar near miss por voz"
              />
              <ActionTile
                Icon={Camera}
                label="Foto rápida"
                hint="Subir foto al avance de OT"
                color="text-accent bg-accent/10 border-accent/30"
                onClick={() => fire("photo")}
              />
              <ActionTile
                Icon={Wrench}
                label="Avance de OT"
                hint="Registrar progreso de trabajo"
                color="text-success-sea bg-success-sea/10 border-success-sea/30"
                onClick={() => fire("wo-progress")}
              />
            </div>
          </div>
        </div>
      )}

      {/* FAB — botón flotante encima del bottom nav */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Acción rápida"
        className="fixed bottom-20 right-4 z-[60] w-14 h-14 rounded-full bg-accent text-primary-bg shadow-2xl hover:brightness-110 active:scale-95 transition-all flex items-center justify-center"
      >
        <Plus className="w-7 h-7" strokeWidth={2.5} />
      </button>
    </>
  );
};

const ActionTile: React.FC<{
  Icon: React.FC<{ className?: string; strokeWidth?: number }>;
  label: string;
  hint: string;
  color: string;
  onClick: () => void;
  /** Si está, muestra un sub-botón mic en la esquina superior derecha. */
  onMicClick?: () => void;
  micAriaLabel?: string;
}> = ({ Icon, label, hint, color, onClick, onMicClick, micAriaLabel }) => (
  <div className={`relative p-4 rounded-2xl border text-left ${color}`}>
    <button
      type="button"
      onClick={onClick}
      className="block w-full text-left active:scale-95 transition-transform"
    >
      <Icon className="w-7 h-7 mb-2" strokeWidth={1.8} />
      <p className="text-xs font-bold text-white leading-tight">{label}</p>
      <p className="text-[10px] text-text-industrial/60 mt-0.5 leading-tight">{hint}</p>
    </button>
    {onMicClick && (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onMicClick(); }}
        aria-label={micAriaLabel ?? "Reportar por voz"}
        title={micAriaLabel ?? "Reportar por voz"}
        className="absolute top-2 right-2 w-9 h-9 rounded-full bg-black/40 border border-white/20 text-white flex items-center justify-center active:scale-90 hover:bg-black/60 transition-all"
      >
        <Mic className="w-4 h-4" />
      </button>
    )}
  </div>
);
