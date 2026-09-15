import React, { useEffect, useRef, useState } from "react";
import { Redo2, Undo2 } from "lucide-react";
import { useT } from "../lib/i18n";
import { redo, subscribeUndo, type UndoEvent } from "../lib/undo-manager";

/** Aviso de Ctrl+Z / Ctrl+Y: qué campo volvió atrás y botón para rehacer. */
export const UndoToastHost: React.FC = () => {
  const t = useT();
  const [ev, setEv] = useState<UndoEvent | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => subscribeUndo(e => {
    setEv(e);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setEv(null), 2800);
  }), []);

  if (!ev) return null;
  const text =
    ev.type === "undo" ? (ev.label ? t("undo.done").replace("{field}", ev.label) : t("undo.doneGeneric"))
    : ev.type === "redo" ? (ev.label ? t("undo.redone").replace("{field}", ev.label) : t("undo.redoneGeneric"))
    : ev.type === "nothing-undo" ? t("undo.nothing")
    : t("undo.nothingRedo");

  return (
    <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[300] flex items-center gap-2.5 rounded-xl bg-[#1A1D24] px-3.5 py-2 text-[13px] text-white shadow-2xl" role="status" aria-live="polite">
      {ev.type === "redo" ? <Redo2 className="w-4 h-4 shrink-0" /> : <Undo2 className="w-4 h-4 shrink-0" />}
      <span className="max-w-[60vw] truncate">{text}</span>
      {ev.type === "undo" && (
        <button type="button" onClick={() => redo()} className="rounded-lg bg-white/15 px-2 py-1 text-xs font-bold hover:bg-white/25">
          {t("undo.redoBtn")} <span className="opacity-60">Ctrl+Y</span>
        </button>
      )}
    </div>
  );
};
