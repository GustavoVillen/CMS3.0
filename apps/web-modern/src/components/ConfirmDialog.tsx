import React, { useEffect } from "react";
import { useT } from "../lib/i18n";

/** Aviso con dos salidas: seguir o cancelar. Mismo formato visual que AlertDialog. */
export const ConfirmDialog: React.FC<{
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({ message, confirmLabel, cancelLabel, onConfirm, onCancel }) => {
  const t = useT();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div
        role="alertdialog"
        aria-modal="true"
        className="bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-bold text-fg">{t("common.attention")}</h2>
        <p className="text-sm text-text-industrial/80 leading-relaxed whitespace-pre-line">{message}</p>
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2.5 rounded-xl bg-fg/5 border border-fg/10 text-sm font-semibold text-fg hover:bg-fg/10 transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            autoFocus
            onClick={onConfirm}
            className="px-5 py-2.5 rounded-xl bg-accent text-accent-fg text-sm font-bold hover:bg-accent/80 transition-colors"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
