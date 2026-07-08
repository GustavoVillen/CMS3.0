/**
 * Hook + componentes para los popups "¿este cambio necesita MOC?" que aparecen
 * tras un save en módulos que pueden disparar un Management of Change.
 *
 * Patrón (no bloqueante):
 *   1. El módulo (Spares, Crew, PTW, Checklists) ejecuta su save normal.
 *   2. Tras el éxito evalúa un detector → si dispara, llama moc.ask({ reason, prefill }).
 *   3. <MocTriggerHost controller={moc} /> renderiza el dialog.
 *   4. Usuario decide: "Ahora no" cierra todo, "Crear MOC" abre MocModal con prefill.
 *   5. El cambio ya quedó guardado en cualquier caso (no bloqueante).
 */

import React, { useCallback, useState } from "react";
import { GitBranch, Plus } from "lucide-react";
import { useT, type TranslationKey } from "./i18n";
import { MocModal, type MocPrefill } from "../pages/Moc";
import { ModalCloseButton } from "../components/ModalCloseButton";

export type MocTriggerReason =
  | "spareEquivalent"
  | "procedureChange"
  | "crewKeyRank"
  | "alarmOverride";

export interface MocTriggerEvent {
  reason: MocTriggerReason;
  prefill: MocPrefill;
}

type Stage = "ask" | "modal";

export interface MocTriggerController {
  event: MocTriggerEvent | null;
  stage: Stage;
  ask: (event: MocTriggerEvent) => void;
  proceed: () => void;
  dismiss: () => void;
}

export function useMocTrigger(): MocTriggerController {
  const [event, setEvent] = useState<MocTriggerEvent | null>(null);
  const [stage, setStage] = useState<Stage>("ask");

  const ask = useCallback((e: MocTriggerEvent) => {
    setEvent(e);
    setStage("ask");
  }, []);
  const proceed = useCallback(() => setStage("modal"), []);
  const dismiss = useCallback(() => {
    setEvent(null);
    setStage("ask");
  }, []);

  return { event, stage, ask, proceed, dismiss };
}

const MocTriggerDialog: React.FC<{
  event: MocTriggerEvent;
  onLater: () => void;
  onCreate: () => void;
}> = ({ event, onLater, onCreate }) => {
  const t = useT();
  const reasonKey = `moc.trigger.reason.${event.reason}` as TranslationKey;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-accent" />
            <h2 className="text-sm font-bold text-fg">{t("moc.trigger.title")}</h2>
          </div>
          <ModalCloseButton onClose={onLater} />
        </div>
        <p className="text-sm text-text-industrial leading-relaxed">{t("moc.trigger.askCreate")}</p>
        <div className="rounded-xl bg-accent/[0.06] border border-accent/20 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wider text-accent font-bold">Motivo</p>
          <p className="text-xs text-text-industrial mt-0.5">{t(reasonKey)}</p>
          {event.prefill.sourceLabel && (
            <p className="text-[11px] text-text-industrial/60 mt-1">{event.prefill.sourceLabel}</p>
          )}
        </div>
        <p className="text-[11px] text-text-industrial/60">{t("moc.trigger.note")}</p>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onLater} className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-fg">
            {t("moc.trigger.btnLater")}
          </button>
          <button onClick={onCreate} className="px-4 py-2 rounded-xl bg-accent text-accent-fg font-bold text-xs hover:brightness-110 flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5" /> {t("moc.trigger.btnCreate")}
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * Componente que monta el dialog o el MocModal según el stage del controller.
 * Se incluye una sola vez en la página y consume el controller del hook.
 */
export const MocTriggerHost: React.FC<{ controller: MocTriggerController }> = ({ controller }) => {
  const { event, stage, dismiss, proceed } = controller;
  if (!event) return null;
  if (stage === "ask") {
    return <MocTriggerDialog event={event} onLater={dismiss} onCreate={proceed} />;
  }
  return (
    <MocModal
      moc={null}
      prefill={event.prefill}
      onClose={dismiss}
      onSaved={dismiss}
    />
  );
};
