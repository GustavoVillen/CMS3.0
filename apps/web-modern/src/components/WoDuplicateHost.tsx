import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, ExternalLink, Handshake } from "lucide-react";
import { useT, type TranslationKey } from "../lib/i18n";
import { fmtDate } from "../lib/utils";
import { ModalCloseButton } from "./ModalCloseButton";
import { subscribeWoDupGuard, type WoDupDecision, type WoDupGuardRequest } from "../lib/wo-dup-guard";

const STATUS_KEY: Record<string, TranslationKey> = {
  PLANNED: "wo.status.planned",
  IN_PROGRESS: "wo.status.inProgress",
  ON_HOLD: "wo.status.onHold",
  DEFERRED: "wo.status.postponed",
};

/**
 * Ventana "este equipo ya tiene una OT abierta que se parece" (ver lib/wo-dup-guard).
 * Se monta una vez; la abre cualquier pantalla que vaya a crear una OT a mano.
 */
export const WoDuplicateHost: React.FC = () => {
  const t = useT();
  const navigate = useNavigate();
  const [req, setReq] = useState<WoDupGuardRequest | null>(null);

  useEffect(() => subscribeWoDupGuard(setReq), []);
  if (!req) return null;

  const close = (decision: WoDupDecision) => { req.resolve(decision); setReq(null); };
  const goTo = (code: string) => {
    close({ kind: "cancel", navigated: true });
    navigate(`/work-orders?autoCode=${encodeURIComponent(code)}`);
  };

  return (
    <div className="fixed inset-0 z-[260] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" role="dialog" aria-modal="true"
      onClick={() => close({ kind: "cancel" })}>
      <div className="w-full max-w-md rounded-2xl border border-fg/10 bg-surface dark:bg-[#0D1B2A] shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-fg/10 px-4 py-3">
          <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
          <span className="text-[15px] font-black text-fg">{t("woDup.title")}</span>
          <ModalCloseButton onClose={() => close({ kind: "cancel" })} className="ml-auto" />
        </div>
        <div className="space-y-3 p-4">
          <p className="text-sm text-text-industrial">{t(req.offerUse ? "woDup.bodySs" : "woDup.body")}</p>
          <ul className="space-y-1.5">
            {req.items.map(o => (
              <li key={o.id} className="rounded-lg border border-fg/10 bg-fg/[0.03] px-3 py-2 space-y-1.5">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-[13px] font-bold text-fg">{o.workOrderCode}</p>
                    {o.title && <p className="text-xs text-fg/80 truncate" title={o.title}>{o.title}</p>}
                    <p className="text-[11px] text-text-industrial/60">
                      {t("woDup.openedOn").replace("{date}", fmtDate(o.openDate))}
                      {o.createdByName && <> {t("woDup.openedBy").replace("{name}", o.createdByName)}</>}
                      {" · "}{STATUS_KEY[o.status] ? t(STATUS_KEY[o.status]!) : o.status}
                      {" · "}{t(`woDup.reason.${o.reason}` as TranslationKey)}
                    </p>
                    {o.serviceRequests.length > 0 && (
                      <p className="text-[11px] text-text-industrial/60">
                        {t("woDup.ss").replace("{codes}", o.serviceRequests.map(s => s.providerName ? `${s.serviceRequestCode} (${s.providerName})` : s.serviceRequestCode).join(", "))}
                      </p>
                    )}
                  </div>
                  <button type="button" onClick={() => goTo(o.workOrderCode)}
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-accent/10 border border-accent/20 px-2.5 py-1.5 text-[11px] font-bold text-accent hover:bg-accent/20">
                    <ExternalLink className="w-3.5 h-3.5" /> {t("woDup.goTo")}
                  </button>
                </div>
                {req.offerUse && (
                  <button type="button" onClick={() => close({ kind: "use", workOrder: { id: o.id, workOrderCode: o.workOrderCode } })}
                    className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-bold text-accent-fg hover:brightness-110">
                    <Handshake className="w-3.5 h-3.5" /> {t("woDup.useForSs")}
                  </button>
                )}
              </li>
            ))}
          </ul>
          <p className="text-sm font-semibold text-fg">{t("woDup.question")}</p>
        </div>
        <div className="flex justify-end gap-2 border-t border-fg/10 px-4 py-3">
          <button type="button" onClick={() => close({ kind: "cancel" })}
            className="rounded-lg bg-fg/5 border border-fg/10 px-3 py-1.5 text-[12px] font-bold text-text-industrial/70 hover:bg-fg/10">
            {t("common.cancel")}
          </button>
          <button type="button" onClick={() => close({ kind: "new" })}
            className="rounded-lg bg-amber-600 px-3 py-1.5 text-[12px] font-bold text-white hover:brightness-110">
            {t("woDup.openAnother")}
          </button>
        </div>
      </div>
    </div>
  );
};
