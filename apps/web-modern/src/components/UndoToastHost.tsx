import React, { useEffect, useRef, useState } from "react";
import { Loader2, Redo2, RotateCcw, Trash2, Undo2 } from "lucide-react";
import { useT, type TranslationKey } from "../lib/i18n";
import { redo, subscribeUndo, type UndoEvent } from "../lib/undo-manager";
import { subscribeDeleteUndo, undoLastDelete, type DeleteUndoEvent } from "../lib/delete-undo";

/** Nombre del tipo de registro, en singular, para "Plan borrado". */
const KIND_KEY: Record<string, TranslationKey> = {
  plan: "trash.kind.plan", asset: "trash.kind.asset", spare: "trash.kind.spare", defect: "trash.kind.defect",
  certificate: "trash.kind.certificate", provider: "trash.kind.provider", crew: "trash.kind.crew",
  drill: "trash.kind.drill", permit: "trash.kind.permit", moc: "trash.kind.moc", nearMiss: "trash.kind.nearMiss",
  externalAudit: "trash.kind.externalAudit", fluidSample: "trash.kind.fluidSample", checklist: "trash.kind.checklist",
  serviceRequest: "trash.kind.serviceRequest", spareRequest: "trash.kind.spareRequest", drydockSpec: "trash.kind.drydockSpec",
  stockLocation: "trash.kind.stockLocation", bitacora: "trash.kind.bitacora", vessel: "trash.kind.vessel",
};

const DELETE_UNDO_MS = 10_000;

/**
 * Aviso de Ctrl+Z / Ctrl+Y (qué campo volvió atrás y botón para rehacer) y de
 * un borrado recién hecho ("Plan borrado · Deshacer", con su cuenta regresiva).
 */
export const UndoToastHost: React.FC = () => {
  const t = useT();
  const [ev, setEv] = useState<UndoEvent | null>(null);
  const [del, setDel] = useState<DeleteUndoEvent | null>(null);
  const timer = useRef<number | null>(null);
  const delTimer = useRef<number | null>(null);

  useEffect(() => subscribeUndo(e => {
    setEv(e);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setEv(null), 2800);
  }), []);

  useEffect(() => subscribeDeleteUndo(e => {
    if (delTimer.current) { window.clearTimeout(delTimer.current); delTimer.current = null; }
    if (e.type === "expired") { setDel(prev => (prev?.type === "deleted" ? null : prev)); return; }
    setEv(null);
    setDel(e);
    if (e.type === "restored" || e.type === "failed") {
      delTimer.current = window.setTimeout(() => setDel(null), e.type === "failed" ? 6000 : 3000);
    }
  }), []);

  if (del) {
    let text: string;
    let icon: React.ReactNode;
    if (del.type === "deleted") {
      const kind = KIND_KEY[del.kind] ? t(KIND_KEY[del.kind]!) : t("trash.kind.record");
      text = del.count === 1 ? t("trash.undo.deletedOne").replace("{kind}", kind) : t("trash.undo.deletedMany").replace("{n}", String(del.count));
      icon = <Trash2 className="w-4 h-4 shrink-0" />;
    } else if (del.type === "restoring") {
      text = t("trash.undo.restoring");
      icon = <Loader2 className="w-4 h-4 shrink-0 animate-spin" />;
    } else if (del.type === "restored") {
      text = del.count === 1 ? t("trash.undo.restoredOne") : t("trash.undo.restoredMany").replace("{n}", String(del.count));
      icon = <RotateCcw className="w-4 h-4 shrink-0" />;
    } else {
      text = `${t("trash.undo.failed")}${del.type === "failed" && del.message ? ` ${del.message}` : ""}`;
      icon = <Trash2 className="w-4 h-4 shrink-0 text-red-300" />;
    }
    return (
      <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[300] flex items-center gap-2.5 overflow-hidden rounded-xl bg-[#1A1D24] px-3.5 py-2 text-[13px] text-white shadow-2xl max-w-[calc(100vw-32px)]" role="status" aria-live="polite">
        {icon}
        <span className="max-w-[60vw] truncate">{text}</span>
        {del.type === "deleted" && (
          <>
            <button type="button" onClick={() => void undoLastDelete()} className="rounded-lg bg-white/15 px-2 py-1 text-xs font-bold hover:bg-white/25 whitespace-nowrap">
              {t("trash.undo.btn")} <span className="opacity-60">Ctrl+Z</span>
            </button>
            {/* Cuenta regresiva: el key la reinicia con cada borrado nuevo. */}
            <span key={del.count} className="absolute left-0 bottom-0 h-[3px] w-full origin-left bg-sky-400"
              style={{ animation: `trash-undo-countdown ${DELETE_UNDO_MS}ms linear forwards` }} />
            <style>{`@keyframes trash-undo-countdown { from { transform: scaleX(1) } to { transform: scaleX(0) } }`}</style>
          </>
        )}
      </div>
    );
  }

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
