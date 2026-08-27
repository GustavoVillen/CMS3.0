// Popup con el que la IA ofrece vincular la OT recién creada a uno o más ítems
// del plan de mantenimiento periódico del mismo equipo. Nunca decide sola: el
// vínculo (WorkOrderMaintenancePlan) sólo se crea si el usuario confirma acá.
//
// Dos modos, según cuántos candidatos y con qué confianza devolvió la IA
// (ver criterio en suggestPlanLinks, work-orders-ai-suggestions.ts):
//   - "confirm": un único candidato de confianza alta → pregunta Sí/No.
//   - "choose": varios candidatos, o uno de confianza media/baja → checklist.
import React, { useState } from "react";
import { Sparkles } from "lucide-react";
import { FormModal } from "./FormModal";
import { useT } from "../lib/i18n";

export interface PlanLinkCandidate {
  id: string;
  taskCode: string;
  title: string;
  nextDueDate?: string | null;
  nextDueHours?: number | null;
  confidence: "high" | "medium" | "low";
}

interface Texts {
  confirmTitle: string;
  confirmQuestion: string;
  chooseTitle: string;
  chooseQuestion: string;
  yesLabel: string;
  linkSelectedLabel: string;
}

interface Props {
  candidates: PlanLinkCandidate[];
  mode: "confirm" | "choose";
  onConfirm: (planIds: string[]) => void;
  onDismiss: () => void;
  /** Override de copy — por defecto usa el texto de "vincular a una OT" (caso OT). Otros
   * flujos que reusan este mismo diálogo para una acción distinta (ej. "abrir la OT" desde
   * un análisis escaneado) pasan sus propias claves acá en vez de bifurcar el componente. */
  texts?: Partial<Texts>;
}

export const PlanLinkSuggestionDialog: React.FC<Props> = ({ candidates, mode, onConfirm, onDismiss, texts }) => {
  const t = useT();
  const tx: Texts = {
    confirmTitle:      texts?.confirmTitle      ?? t("wo.ai.planLink.confirmTitle"),
    confirmQuestion:   texts?.confirmQuestion   ?? t("wo.ai.planLink.confirmQuestion"),
    chooseTitle:       texts?.chooseTitle       ?? t("wo.ai.planLink.chooseTitle"),
    chooseQuestion:    texts?.chooseQuestion    ?? t("wo.ai.planLink.chooseQuestion"),
    yesLabel:          texts?.yesLabel          ?? t("wo.ai.planLink.yes"),
    linkSelectedLabel: texts?.linkSelectedLabel ?? t("wo.ai.planLink.linkSelected"),
  };
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(mode === "choose" ? candidates.filter(c => c.confidence === "high").map(c => c.id) : []),
  );

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  if (mode === "confirm") {
    const only = candidates[0]!;
    return (
      <FormModal
        title={tx.confirmTitle}
        onClose={onDismiss}
        footer={<>
          <button onClick={onDismiss} className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-fg">
            {t("wo.ai.planLink.no")}
          </button>
          <button onClick={() => onConfirm([only.id])}
            className="px-4 py-2 rounded-xl bg-accent text-accent-fg font-bold text-xs hover:brightness-110">
            {tx.yesLabel}
          </button>
        </>}
      >
        <p className="text-xs text-text-industrial/70 leading-relaxed">{tx.confirmQuestion}</p>
        <div className="rounded-xl border border-accent/25 bg-accent/[0.06] p-3 space-y-1">
          <p className="text-[11px] text-fg">
            <span className="font-mono font-bold">{only.taskCode}</span>
            <span className="text-fg font-semibold"> · {only.title}</span>
          </p>
          {(only.nextDueDate || only.nextDueHours != null) && (
            <p className="text-[10px] text-text-industrial/50">
              {t("wo.ai.planLink.dueDate")}: {only.nextDueDate ? only.nextDueDate.slice(0, 10) : `${only.nextDueHours} h`}
            </p>
          )}
        </div>
      </FormModal>
    );
  }

  return (
    <FormModal
      title={tx.chooseTitle}
      onClose={onDismiss}
      footer={<>
        <button onClick={onDismiss} className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-fg">
          {t("wo.ai.planLink.none")}
        </button>
        <button onClick={() => onConfirm([...selected])}
          className="px-4 py-2 rounded-xl bg-accent text-accent-fg font-bold text-xs hover:brightness-110">
          {tx.linkSelectedLabel}
        </button>
      </>}
    >
      <p className="text-xs text-text-industrial/70 leading-relaxed">{tx.chooseQuestion}</p>
      <div className="space-y-1.5">
        {candidates.map(c => (
          <label key={c.id}
            className="flex items-start gap-2.5 rounded-xl border border-fg/10 bg-fg/5 p-2.5 cursor-pointer hover:bg-fg/10">
            <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)}
              className="mt-0.5 accent-accent" />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] text-fg">
                <span className="font-mono font-bold">{c.taskCode}</span>
                <span className="text-fg font-semibold"> · {c.title}</span>
              </p>
              {(c.nextDueDate || c.nextDueHours != null) && (
                <p className="text-[10px] text-text-industrial/50">
                  {t("wo.ai.planLink.dueDate")}: {c.nextDueDate ? c.nextDueDate.slice(0, 10) : `${c.nextDueHours} h`}
                </p>
              )}
            </div>
            {c.confidence === "high" && <Sparkles className="w-3.5 h-3.5 text-accent shrink-0 mt-0.5" />}
          </label>
        ))}
      </div>
    </FormModal>
  );
};
