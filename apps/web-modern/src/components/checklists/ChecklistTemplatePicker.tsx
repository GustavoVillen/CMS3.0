// Elegir el checklist a completar (acceso "Completar Check List" del Dashboard).
//
// Muestra los templates activos del tenant como botones. Al elegir uno lleva a
// /checklists?new=<templateId>, que abre el alta con ese template ya puesto: el
// usuario completa buque, fecha y puerto, y al crearlo la pantalla abre el
// checklist para ir tildando los ítems.

import React from "react";
import { Loader2, ListChecks } from "lucide-react";
import { useFetch } from "../../lib/hooks";
import { useT, type TranslationKey } from "../../lib/i18n";
import { ModalCloseButton } from "../ModalCloseButton";

/** Mismos nombres de tipo que la pantalla de Checklists. */
const TYPE_TKEY: Record<string, TranslationKey> = {
  PRE_ARRIVAL: "cl.type.preArrival",
  PRE_DEPARTURE: "cl.type.preDeparture",
  PRE_BUNKERING: "cl.type.preBunkering",
  PRE_CARGO_TRANSFER: "cl.type.preCargoTransfer",
  ENCLOSED_SPACE_ENTRY: "cl.type.enclosedSpaceEntry",
  HOT_WORK: "cl.type.hotWork",
  PILOT_BOARDING: "cl.type.pilotBoarding",
  ANCHOR: "cl.type.anchor",
  MOORING: "cl.type.mooring",
  OTHER: "cl.type.other",
};

interface PickerTemplate {
  id: string;
  type: string;
  name: string;
  description: string | null;
  isActive: boolean;
  itemsJson?: Array<unknown>;
}

export function ChecklistTemplatePicker({ onClose, onPick }: {
  onClose: () => void;
  onPick: (templateId: string) => void;
}) {
  const t = useT();
  const { data, loading } = useFetch<{ items: PickerTemplate[] }>("/app/checklist-templates");
  // Un template dado de baja ya no se usa a bordo: no se ofrece.
  const templates = (data?.items ?? []).filter(tpl => tpl.isActive);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-2xl bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl p-6 space-y-4 max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-sm font-bold text-fg">{t("dashboard.checklist.title")}</h2>
            <p className="text-xs text-text-industrial/50 mt-0.5">{t("dashboard.checklist.subtitle")}</p>
          </div>
          <ModalCloseButton onClose={onClose} />
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1.5">
          {loading && templates.length === 0 && (
            <p className="flex items-center gap-2 text-xs text-text-industrial/50 py-6 justify-center">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> {t("common.loading")}
            </p>
          )}

          {!loading && templates.length === 0 && (
            <p className="text-xs text-text-industrial/50 text-center py-8">{t("dashboard.checklist.empty")}</p>
          )}

          {templates.map(tpl => (
            <button
              key={tpl.id}
              type="button"
              onClick={() => onPick(tpl.id)}
              className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg bg-fg/[0.03] border border-fg/10 hover:border-success-sea/50 hover:bg-success-sea/10 transition-all text-left"
            >
              <ListChecks className="w-4 h-4 text-success-sea shrink-0" />
              <span className="flex-1 min-w-0">
                <span className="block text-xs font-bold text-fg truncate">{tpl.name}</span>
                <span className="block text-[10px] text-text-industrial/50 truncate">
                  {TYPE_TKEY[tpl.type] ? t(TYPE_TKEY[tpl.type]) : tpl.type}
                  {tpl.description ? ` · ${tpl.description}` : ""}
                </span>
              </span>
              {tpl.itemsJson && (
                <span className="shrink-0 text-[10px] font-bold text-text-industrial/50 bg-fg/10 rounded-full px-1.5 py-0.5">
                  {tpl.itemsJson.length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
