import React, { useEffect, useState } from "react";
import { Handshake } from "lucide-react";
import { useT, type TranslationKey } from "../lib/i18n";
import { ModalCloseButton } from "./ModalCloseButton";
import { AlertDialog } from "./AlertDialog";
import { RequiredMark } from "./GuideKit";
import { subscribeWoSsClose, type WoSsCloseRequest } from "../lib/wo-ss-close";

const STATUS_KEY: Record<string, TranslationKey> = {
  DRAFT: "woSs.st.DRAFT",
  SOLICITADA: "woSs.st.SOLICITADA",
  APROBADA: "woSs.st.APROBADA",
  AUTORIZADA: "woSs.st.AUTORIZADA",
  IN_PROGRESS: "woSs.st.IN_PROGRESS",
};

/**
 * Ventana "esta OT tiene SS abiertas: ¿cerrarlas también?" (ver lib/wo-ss-close).
 * Se monta una vez; la abre el cierre de la OT, en escritorio y en el celular.
 */
export const WoSsCloseHost: React.FC = () => {
  const t = useT();
  const [req, setReq] = useState<WoSsCloseRequest | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [receiver, setReceiver] = useState("");
  const [conform, setConform] = useState<boolean | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Error al cerrar la SS después de cerrada la OT (la ventana de la OT ya no está).
  const [closeErr, setCloseErr] = useState<string | null>(null);

  useEffect(() => subscribeWoSsClose(r => {
    setReq(r);
    setPicked(new Set(r.items.map(i => i.id)));
    setReceiver(r.defaultReceiver);
    setConform(null);
    setErr(null);
  }, errors => setCloseErr(`${t("woSs.closeFailed")}\n${errors.join("\n")}`)), [t]);
  if (!req) return closeErr ? <AlertDialog message={closeErr} onClose={() => setCloseErr(null)} /> : null;

  const done = (plan: Parameters<WoSsCloseRequest["resolve"]>[0]) => { req.resolve(plan); setReq(null); };
  const closeBoth = () => {
    if (picked.size === 0) { done({ ids: [], receivedByName: "", receptionConform: true }); return; }
    if (!receiver.trim()) { setErr(t("woSs.needReceiver")); return; }
    if (conform === null) { setErr(t("woSs.needConform")); return; }
    done({ ids: [...picked], receivedByName: receiver.trim(), receptionConform: conform });
  };
  const toggle = (id: string) => setPicked(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const seg = (on: boolean) => `rounded-lg border px-3 py-1.5 text-[12px] font-bold transition-colors ${on ? "border-accent bg-accent text-accent-fg" : "border-fg/10 bg-surface text-fg hover:border-fg/25"}`;
  const one = req.items.length === 1;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-2xl border border-fg/10 bg-surface dark:bg-[#0D1B2A] shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-fg/10 px-4 py-3">
          <Handshake className="w-4 h-4 shrink-0 text-cyan-700 dark:text-cyan-400" />
          <span className="text-[15px] font-black text-fg">{t(one ? "woSs.titleOne" : "woSs.titleMany")}</span>
          <ModalCloseButton onClose={() => done(null)} className="ml-auto" />
        </div>

        <div className="space-y-3 p-4">
          <p className="text-sm text-text-industrial">{t(one ? "woSs.bodyOne" : "woSs.bodyMany")}</p>
          <ul className="space-y-1.5">
            {req.items.map(sr => (
              <li key={sr.id}>
                <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-fg/10 bg-fg/[0.03] px-3 py-2">
                  <input type="checkbox" checked={picked.has(sr.id)} onChange={() => toggle(sr.id)} className="mt-1" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-mono text-[13px] font-bold text-fg">{sr.serviceRequestCode}</span>
                    <span className="block text-[11px] text-text-industrial/60">
                      {[sr.providerName, STATUS_KEY[sr.status] ? t(STATUS_KEY[sr.status]!) : sr.status].filter(Boolean).join(" · ")}
                    </span>
                    {sr.status !== "IN_PROGRESS" && (
                      <span className="mt-0.5 block text-[11px] font-semibold text-amber-700 dark:text-amber-400">{t("woSs.notSent")}</span>
                    )}
                  </span>
                </label>
              </li>
            ))}
          </ul>

          {picked.size > 0 && (
            <div className="space-y-2.5 rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3">
              <div>
                <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-text-industrial/70">{t("ss.guide.field.recibe")}<RequiredMark /></p>
                <input value={receiver} onChange={e => setReceiver(e.target.value)} placeholder={t("ss.guide.field.recibePh")}
                  className="w-full rounded-lg border border-fg/10 bg-fg/5 px-3 py-1.5 text-sm text-fg focus:border-accent/50 focus:outline-none" />
              </div>
              <div>
                <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-text-industrial/70">{t("ss.guide.field.conforme")}<RequiredMark /></p>
                <div className="flex flex-wrap gap-1.5">
                  <button type="button" onClick={() => setConform(true)} className={seg(conform === true)}>{t("ss.guide.field.conformeYes")}</button>
                  <button type="button" onClick={() => setConform(false)} className={seg(conform === false)}>{t("ss.guide.field.conformeNo")}</button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-fg/10 px-4 py-3">
          <button type="button" onClick={() => done(null)}
            className="rounded-lg px-3 py-1.5 text-[12px] font-bold text-text-industrial/70 hover:bg-fg/5">
            {t("common.cancel")}
          </button>
          <button type="button" onClick={() => done({ ids: [], receivedByName: "", receptionConform: true })}
            className="rounded-lg border border-fg/10 bg-fg/5 px-3 py-1.5 text-[12px] font-bold text-fg hover:bg-fg/10">
            {t("woSs.onlyWo")}
          </button>
          <button type="button" onClick={closeBoth} disabled={picked.size === 0}
            className="rounded-lg bg-accent px-3 py-1.5 text-[12px] font-bold text-accent-fg hover:brightness-110 disabled:opacity-50">
            {t(one ? "woSs.closeBothOne" : "woSs.closeBothMany")}
          </button>
        </div>
      </div>
      {err && <AlertDialog message={err} onClose={() => setErr(null)} />}
    </div>
  );
};
