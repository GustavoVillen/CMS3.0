import React, { useEffect, useState } from "react";
import { Loader2, ShieldCheck, Sparkles } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { useCan } from "../lib/auth";
import { useT, type TranslationKey } from "../lib/i18n";
import { ModalCloseButton } from "./ModalCloseButton";
import { AlertDialog } from "./AlertDialog";
import { AutoTextArea } from "./AutoTextArea";
import { RequiredMark } from "./GuideKit";
import { subscribeWoPermitClose, type OpenWoPermit, type WoPermitCloseRequest } from "../lib/wo-permit-close";

const TYPE_KEY: Record<string, TranslationKey> = {
  HOT_WORK: "pm.type.hotWork",
  ENCLOSED_SPACE_ENTRY: "pm.type.enclosedSpace",
  WORKING_ALOFT: "pm.type.workingAloft",
  ELECTRICAL_ISOLATION: "pm.type.electricalIso",
  COLD_WORK: "pm.type.coldWork",
  UNDERWATER_WORK: "pm.type.underwater",
};
const STATUS_KEY: Record<string, TranslationKey> = {
  DRAFT: "pm.status.draft",
  REQUESTED: "pm.status.requested",
  APPROVED: "pm.status.approved",
  ACTIVE: "pm.status.active",
};

type Field = "hazardsIdentified" | "controlMeasures" | "ppeRequired";
const FIELDS: Array<{ key: Field; label: TranslationKey; ai: string }> = [
  { key: "hazardsIdentified", label: "pm.wiz.hazards", ai: "suggest-hazards" },
  { key: "controlMeasures", label: "pm.wiz.controls", ai: "suggest-controls" },
  { key: "ppeRequired", label: "pm.wiz.ppe", ai: "suggest-ppe" },
];

/** Lo que el permiso no trae del análisis de riesgo (lo pide el servidor para cerrarlo). */
const missingOf = (p: OpenWoPermit): Field[] => FIELDS.map(f => f.key).filter(k => !(p[k] ?? "").trim());

/**
 * Ventana "esta OT tiene permisos de trabajo abiertos: ¿cerrarlos?" (ver
 * lib/wo-permit-close). Se monta una vez; la abre el cierre de la OT.
 */
export const WoPermitCloseHost: React.FC = () => {
  const t = useT();
  const can = useCan();
  const [req, setReq] = useState<WoPermitCloseRequest | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [fill, setFill] = useState<Record<string, Partial<Record<Field, string>>>>({});
  const [closeNotes, setCloseNotes] = useState("");
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => subscribeWoPermitClose(r => {
    setReq(r);
    setPicked(new Set(r.items.map(i => i.id)));
    setFill({});
    setCloseNotes("");
    setErr(null);
  }), []);
  if (!req) return null;

  const done = (plan: Parameters<WoPermitCloseRequest["resolve"]>[0]) => { req.resolve(plan); setReq(null); };
  const valueOf = (p: OpenWoPermit, k: Field) => fill[p.id]?.[k] ?? "";
  const setValue = (id: string, k: Field, v: string) => setFill(prev => ({ ...prev, [id]: { ...prev[id], [k]: v } }));
  const requiredOpen = req.items.some(p => p.required);
  const canApprove = can("permit.authorize");

  const toggle = (p: OpenWoPermit) => {
    if (p.required) return; // el plan lo exige: sin cerrarlo la OT no cierra
    setPicked(prev => {
      const next = new Set(prev);
      if (next.has(p.id)) next.delete(p.id); else next.add(p.id);
      return next;
    });
  };

  /** Completa con IA, en orden, lo que le falte al permiso (cada campo usa los anteriores). */
  const suggest = async (p: OpenWoPermit) => {
    setAiBusy(p.id);
    try {
      const acc: Partial<Record<Field, string>> = {};
      const current = (k: Field) => (p[k] ?? "").trim() || (fill[p.id]?.[k] ?? "").trim() || acc[k] || "";
      for (const f of FIELDS) {
        if (current(f.key)) continue;
        const res = await api.post<{ text: string }>(`/app/permits/${f.ai}`, {
          type: p.type, vesselCode: p.vesselCode, location: p.location, description: p.description,
          hazardsIdentified: current("hazardsIdentified") || null,
          controlMeasures: current("controlMeasures") || null,
        });
        acc[f.key] = (res.text ?? "").trim();
      }
      setFill(prev => ({ ...prev, [p.id]: { ...prev[p.id], ...acc } }));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t("woPtw.aiFailed"));
    } finally {
      setAiBusy(null);
    }
  };

  const closeBoth = () => {
    const chosen = req.items.filter(p => picked.has(p.id));
    for (const p of chosen) {
      const gaps = missingOf(p).filter(k => !valueOf(p, k).trim());
      if (gaps.length > 0) {
        setErr(t("woPtw.needFields").replace("{code}", p.permitCode)
          .replace("{fields}", gaps.map(k => t(FIELDS.find(f => f.key === k)!.label)).join(", ")));
        return;
      }
    }
    done({
      items: chosen.map(p => ({
        id: p.id, permitCode: p.permitCode,
        ...Object.fromEntries(missingOf(p).map(k => [k, valueOf(p, k).trim()])),
      })),
      closeNotes: closeNotes.trim(),
    });
  };

  const one = req.items.length === 1;
  const taCls = "w-full rounded-lg border border-fg/10 bg-fg/5 px-2.5 py-1.5 text-[12.5px] text-fg focus:border-accent/50 focus:outline-none resize-none";

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" role="dialog" aria-modal="true">
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col rounded-2xl border border-fg/10 bg-surface dark:bg-[#0D1B2A] shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-fg/10 px-4 py-3">
          <ShieldCheck className="w-4 h-4 shrink-0 text-orange-600" />
          <span className="text-[15px] font-black text-fg">{t(one ? "woPtw.titleOne" : "woPtw.titleMany")}</span>
          <ModalCloseButton onClose={() => done(null)} className="ml-auto" />
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          <p className="text-sm text-text-industrial">{t(one ? "woPtw.bodyOne" : "woPtw.bodyMany")}</p>
          {req.items.map(p => {
            const on = picked.has(p.id);
            const gaps = missingOf(p);
            const unapproved = p.status === "DRAFT" || p.status === "REQUESTED";
            return (
              <div key={p.id} className="space-y-2 rounded-xl border border-fg/10 bg-fg/[0.03] p-3">
                <label className={`flex items-start gap-2.5 ${p.required ? "" : "cursor-pointer"}`}>
                  <input type="checkbox" checked={on} disabled={p.required} onChange={() => toggle(p)} className="mt-1" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-mono text-[13px] font-bold text-fg">{p.permitCode}</span>
                    <span className="block text-[11px] text-text-industrial/60">
                      {[TYPE_KEY[p.type] ? t(TYPE_KEY[p.type]!) : p.type, STATUS_KEY[p.status] ? t(STATUS_KEY[p.status]!) : p.status].join(" · ")}
                    </span>
                    {p.required && <span className="mt-0.5 block text-[11px] font-semibold text-orange-700 dark:text-orange-400">{t("woPtw.required")}</span>}
                    {on && unapproved && (
                      <span className={`mt-0.5 block text-[11px] font-semibold ${canApprove ? "text-text-industrial/70" : "text-red-700 dark:text-red-400"}`}>
                        {t(canApprove ? "woPtw.approveByYou" : "woPtw.cannotApprove")}
                      </span>
                    )}
                  </span>
                </label>

                {on && gaps.length > 0 && (
                  <div className="space-y-2 border-t border-fg/10 pt-2">
                    <div className="flex items-center gap-2">
                      <p className="text-[11px] font-semibold text-text-industrial/70">{t("woPtw.complete")}</p>
                      <button type="button" onClick={() => { void suggest(p); }} disabled={aiBusy !== null}
                        className="ml-auto inline-flex items-center gap-1 rounded-full border border-violet-500/35 bg-violet-500/[0.07] px-2 py-0.5 text-[10.5px] font-extrabold text-violet-700 dark:text-violet-300 hover:bg-violet-500/15 disabled:opacity-60">
                        {aiBusy === p.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />} {t("mp.guide.suggestAi")}
                      </button>
                    </div>
                    {FIELDS.filter(f => gaps.includes(f.key)).map(f => (
                      <div key={f.key}>
                        <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-text-industrial/70">{t(f.label)}<RequiredMark /></p>
                        <AutoTextArea rows={2} value={valueOf(p, f.key)} onChange={e => setValue(p.id, f.key, e.target.value)} className={taCls} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {picked.size > 0 && (
            <div>
              <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-text-industrial/70">{t("woPtw.closeNotes")}</p>
              <AutoTextArea rows={2} value={closeNotes} onChange={e => setCloseNotes(e.target.value)}
                placeholder={t("woPtw.closeNotesPh")} className={taCls} />
            </div>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-fg/10 px-4 py-3">
          <button type="button" onClick={() => done(null)}
            className="rounded-lg px-3 py-1.5 text-[12px] font-bold text-text-industrial/70 hover:bg-fg/5">
            {t("common.cancel")}
          </button>
          <button type="button" onClick={() => done({ items: [], closeNotes: "" })} disabled={requiredOpen}
            title={requiredOpen ? t("woPtw.onlyWoBlocked") : undefined}
            className="rounded-lg border border-fg/10 bg-fg/5 px-3 py-1.5 text-[12px] font-bold text-fg hover:bg-fg/10 disabled:opacity-40">
            {t("woSs.onlyWo")}
          </button>
          <button type="button" onClick={closeBoth} disabled={picked.size === 0 || aiBusy !== null}
            className="rounded-lg bg-accent px-3 py-1.5 text-[12px] font-bold text-accent-fg hover:brightness-110 disabled:opacity-50">
            {t(one ? "woPtw.closeBothOne" : "woPtw.closeBothMany")}
          </button>
        </div>
      </div>
      {err && <AlertDialog message={err} onClose={() => setErr(null)} />}
    </div>
  );
};
