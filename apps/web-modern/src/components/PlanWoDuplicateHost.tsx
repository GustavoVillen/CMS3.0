import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, ExternalLink } from "lucide-react";
import { useT, type TranslationKey } from "../lib/i18n";
import { ModalCloseButton } from "./ModalCloseButton";
import { subscribePlanWoGuard, type PlanWoGuardRequest } from "../lib/plan-wo-guard";

const STATUS_KEY: Record<string, TranslationKey> = {
  PLANNED: "wo.status.planned",
  IN_PROGRESS: "wo.status.inProgress",
  ON_HOLD: "wo.status.onHold",
};

/**
 * Ventana "este ítem del plan ya tiene una OT abierta" (ver lib/plan-wo-guard).
 * Se monta una vez; la abre cualquier pantalla que vaya a abrir una OT desde el plan.
 */
export const PlanWoDuplicateHost: React.FC = () => {
  const t = useT();
  const navigate = useNavigate();
  const [req, setReq] = useState<PlanWoGuardRequest | null>(null);

  useEffect(() => subscribePlanWoGuard(setReq), []);
  if (!req) return null;

  const close = (decision: "duplicate" | "cancel") => { req.resolve(decision); setReq(null); };
  const goTo = (code: string) => {
    close("cancel");
    navigate(`/work-orders?autoCode=${encodeURIComponent(code)}`);
  };

  return (
    <div className="fixed inset-0 z-[260] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" role="dialog" aria-modal="true"
      onClick={() => close("cancel")}>
      <div className="w-full max-w-md rounded-2xl border border-fg/10 bg-surface dark:bg-[#0D1B2A] shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-fg/10 px-4 py-3">
          <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
          <span className="text-[15px] font-black text-fg">{t("planWoDup.title")}</span>
          <ModalCloseButton onClose={() => close("cancel")} className="ml-auto" />
        </div>
        <div className="space-y-3 p-4">
          <p className="text-sm text-text-industrial">{t("planWoDup.body")}</p>
          <ul className="space-y-1.5">
            {req.items.map(o => (
              <li key={`${o.planId}-${o.workOrderId}`} className="flex items-center gap-2 rounded-lg border border-fg/10 bg-fg/[0.03] px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-[13px] font-bold text-fg">{o.workOrderCode}</p>
                  <p className="text-[11px] text-text-industrial/60">
                    {t("planWoDup.item").replace("{code}", o.taskCode)} · {STATUS_KEY[o.status] ? t(STATUS_KEY[o.status]!) : o.status}
                  </p>
                </div>
                <button type="button" onClick={() => goTo(o.workOrderCode)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-accent/10 border border-accent/20 px-2.5 py-1.5 text-[11px] font-bold text-accent hover:bg-accent/20">
                  <ExternalLink className="w-3.5 h-3.5" /> {t("planWoDup.goTo")}
                </button>
              </li>
            ))}
          </ul>
          <p className="text-sm font-semibold text-fg">{t("planWoDup.question")}</p>
        </div>
        <div className="flex justify-end gap-2 border-t border-fg/10 px-4 py-3">
          <button type="button" onClick={() => close("cancel")}
            className="rounded-lg bg-fg/5 border border-fg/10 px-3 py-1.5 text-[12px] font-bold text-text-industrial/70 hover:bg-fg/10">
            {t("common.cancel")}
          </button>
          <button type="button" onClick={() => close("duplicate")}
            className="rounded-lg bg-amber-600 px-3 py-1.5 text-[12px] font-bold text-white hover:brightness-110">
            {t("planWoDup.openAnother")}
          </button>
        </div>
      </div>
    </div>
  );
};
