// "Falta la Solicitud de Servicio": la OT está tercerizada o lleva una muestra
// de aceite al laboratorio, y no tiene la SS con la que se pide el trabajo
// (regla en wo-ss-required.ts de la API). Sale cuando el backend frena el envío
// a aprobar (ApprovalModal) y desde la marca "Falta SS" de Seguimiento. Dos
// salidas: abrir la SS, o dejar escrito por qué esta OT no la lleva.
//
// Acá no hay reglas: se muestra lo que devuelve GET /work-orders/:id/ss-required
// y se llama a los endpoints de siempre, que validan permisos y alcance.

import React, { useEffect, useState } from "react";
import { FlaskConical, Loader2 } from "lucide-react";
import { api, ApiError } from "../../lib/api";
import { useT } from "../../lib/i18n";
import { ModalCloseButton } from "../ModalCloseButton";
import { AlertDialog } from "../AlertDialog";
import { AutoTextArea } from "../AutoTextArea";

/** Respuesta de GET /app/pms/work-orders/:id/ss-required. */
interface SsRequired {
  required: boolean;
  reason: "LAB_DEFECT" | "LAB_PLAN" | "OUTSOURCED" | null;
  hasServiceRequest: boolean;
  notRequiredReason: string | null;
  missing: boolean;
  provider: { id: string; name: string } | null;
  originSampleCode: string | null;
}

interface Props {
  workOrder: { id: string; workOrderCode: string; title?: string | null; priority?: string | null };
  /** Se abrió la SS o quedó el motivo: quien abrió la ventana sigue (reintenta el envío, recarga). */
  onResolved: () => void;
  onClose: () => void;
}

const labelCls = "text-xs font-semibold uppercase tracking-wider text-text-industrial/60";
const inputCls = "w-full px-3 py-2 rounded-lg bg-fg/5 border border-fg/10 text-fg text-sm focus:outline-none focus:ring-1 focus:ring-accent/40";

export const MissingSsDialog: React.FC<Props> = ({ workOrder, onResolved, onClose }) => {
  const t = useT();
  const [info, setInfo] = useState<SsRequired | null>(null);
  const [providers, setProviders] = useState<Array<{ id: string; name: string; providerCode?: string }>>([]);
  const [providerId, setProviderId] = useState("");
  const [showReason, setShowReason] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<"sr" | "reason" | null>(null);
  const [alert, setAlert] = useState<string | null>(null);
  // Sin el dato no hay nada que ofrecer: al descartar el aviso se cierra la ventana.
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    api.get<SsRequired>(`/app/pms/work-orders/${workOrder.id}/ss-required`)
      .then(res => {
        // Otro ya la resolvió mientras tanto (la marca de Seguimiento puede estar vieja).
        if (!res.missing) { onResolved(); return; }
        setInfo(res);
        if (res.provider) setProviderId(res.provider.id);
      })
      .catch(e => { setLoadFailed(true); setAlert(e instanceof ApiError ? e.message : t("wo.ssReq.loadError")); });
    api.get<{ items: Array<{ id: string; name: string; providerCode?: string }> }>("/app/providers?status=ACTIVE")
      .then(res => setProviders(res.items ?? []))
      .catch(() => setProviders([]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workOrder.id]);

  // Esc cierra sólo esta ventana, no la que está detrás.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || alert) return;
      e.preventDefault(); e.stopImmediatePropagation(); onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose, alert]);

  const openSr = async () => {
    if (!providerId) { setAlert(t("wo.ssReq.pickProvider")); return; }
    setBusy("sr");
    try {
      // Mismo criterio que el alta de la OT: la SS lleva el título de la orden.
      const title = workOrder.title?.trim() || undefined;
      await api.post(`/app/pms/work-orders/${workOrder.id}/service-requests`, {
        providerId, title, description: title, priority: workOrder.priority ?? undefined,
      });
      onResolved();
    } catch (e) {
      setBusy(null);
      setAlert(e instanceof ApiError ? e.message : t("common.saveError"));
    }
  };

  const saveReason = async () => {
    if (!reason.trim()) { setAlert(t("wo.ssReq.reasonRequired")); return; }
    setBusy("reason");
    try {
      await api.post(`/app/pms/work-orders/${workOrder.id}/ss-required`, { reason: reason.trim() });
      onResolved();
    } catch (e) {
      setBusy(null);
      setAlert(e instanceof ApiError ? e.message : t("common.saveError"));
    }
  };

  const lab = info?.reason === "LAB_DEFECT" || info?.reason === "LAB_PLAN";
  const message = (info?.reason === "LAB_DEFECT" ? t("wo.ssReq.msgLabDefect")
    : info?.reason === "LAB_PLAN" ? t("wo.ssReq.msgLabPlan")
    : t("wo.ssReq.msgOutsourced"))
    .replace("{code}", workOrder.workOrderCode).replace("{sample}", info?.originSampleCode ?? "—");
  const suggested = info?.provider && providerId === info.provider.id;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div role="dialog" aria-modal="true"
        className="w-full max-w-md bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl p-5 space-y-4"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-base font-bold text-fg">
              <FlaskConical className="w-4 h-4 text-amber-500 shrink-0" />
              {t("wo.ssReq.title")}
            </h2>
            <p className="text-xs text-text-industrial/60 mt-0.5 truncate">
              {workOrder.workOrderCode}{workOrder.title ? ` · ${workOrder.title}` : ""}
            </p>
          </div>
          <ModalCloseButton onClose={onClose} />
        </div>

        {!info ? (
          <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-accent" /></div>
        ) : (
          <>
            <p className="text-sm text-fg/80">{message}</p>

            <div className="space-y-1.5">
              <label className={labelCls}>{t(lab ? "wo.ssReq.lab" : "wo.ssReq.provider")}</label>
              <select value={providerId} onChange={e => setProviderId(e.target.value)} className={inputCls}>
                <option value="">{t("wo.modal.providerSelect")}</option>
                {info.provider && !providers.some(p => p.id === info.provider!.id) && (
                  <option value={info.provider.id}>{info.provider.name}</option>
                )}
                {providers.map(p => (
                  <option key={p.id} value={p.id}>{p.name}{p.providerCode ? ` (${p.providerCode})` : ""}</option>
                ))}
              </select>
              {suggested && (
                <p className="text-[11px] text-text-industrial/50">
                  {t(info.reason === "LAB_DEFECT" ? "wo.ssReq.hintLabDefect" : info.reason === "LAB_PLAN" ? "wo.ssReq.hintLabPlan" : "wo.ssReq.hintWo")}
                </p>
              )}
            </div>
            <div className="flex justify-end">
              <button type="button" onClick={() => void openSr()} disabled={!!busy}
                className="px-4 py-1.5 rounded-lg text-sm font-bold bg-accent text-accent-fg hover:brightness-110 disabled:opacity-50 flex items-center gap-1.5">
                {busy === "sr" && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {t("wo.ssReq.openSr")}
              </button>
            </div>

            <div className="border-t border-fg/10 pt-3 space-y-2">
              {!showReason ? (
                <button type="button" onClick={() => setShowReason(true)}
                  className="text-xs font-bold text-text-industrial/70 hover:text-fg underline">
                  {t(lab ? "wo.ssReq.orNotLab" : "wo.ssReq.orNot")}
                </button>
              ) : (
                <>
                  <label className={labelCls}>{t("wo.ssReq.reason")}</label>
                  <AutoTextArea autoFocus rows={2} value={reason} onChange={e => setReason(e.target.value)}
                    placeholder={t(lab ? "wo.ssReq.reasonPhLab" : "wo.ssReq.reasonPh")} className={`${inputCls} resize-none`} />
                  <div className="flex justify-end">
                    <button type="button" onClick={() => void saveReason()} disabled={!!busy}
                      className="px-4 py-1.5 rounded-lg text-sm font-bold border border-fg/15 text-fg hover:bg-fg/5 disabled:opacity-50 flex items-center gap-1.5">
                      {busy === "reason" && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      {t("wo.ssReq.saveReason")}
                    </button>
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>
      {alert && <AlertDialog message={alert} onClose={() => { setAlert(null); if (loadFailed) onClose(); }} />}
    </div>
  );
};
