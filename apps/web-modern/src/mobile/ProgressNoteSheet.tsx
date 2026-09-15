import React, { useState, useRef, useCallback, useEffect } from "react";
import { Camera, Check, CheckCircle2, CloudOff, FileText, Loader2, Mic, Paperclip, Plus, Sparkles, Square, X } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { useCan } from "../lib/auth";
import { useT, type TranslationKey } from "../lib/i18n";
import { ModalCloseButton } from "../components/ModalCloseButton";
import { AlertDialog } from "../components/AlertDialog";
import { AutoTextArea } from "../components/AutoTextArea";
import { enqueueProgress, isRetryableError, sendProgress, startProgressOutbox, subscribeOutbox, type OutboxFile, type ProgressPayload } from "../lib/progress-outbox";

interface Props {
  workOrderId: string;
  onClose: () => void;
  onSaved: (noteText?: string) => void;
}

interface DetectedSpare { spareId: string; sku: string; name: string; quantity: number; unit: string }

// Comprime una imagen usando Canvas a máx 1280px y calidad JPEG 0.75.
// Devuelve el archivo original si algo falla.
async function compressImage(f: File): Promise<File> {
  return new Promise(resolve => {
    const img = new Image();
    const url = URL.createObjectURL(f);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width: w, height: h } = img;
      const MAX = 1280;
      if (w > MAX || h > MAX) {
        if (w >= h) { h = Math.round(h * MAX / w); w = MAX; }
        else { w = Math.round(w * MAX / h); h = MAX; }
      }
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
      canvas.toBlob(blob => {
        if (!blob) { resolve(f); return; }
        const name = f.name.replace(/\.[^.]+$/, ".jpg");
        resolve(new File([blob], name, { type: "image/jpeg" }));
      }, "image/jpeg", 0.75);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(f); };
    img.src = url;
  });
}

/** `YYYY-MM-DDThh:mm` en hora local, para <input type="datetime-local">. */
function toLocalInput(d: Date): string {
  const x = new Date(d);
  x.setMinutes(x.getMinutes() - x.getTimezoneOffset());
  return x.toISOString().slice(0, 16);
}

type When = "now" | "morning" | "yesterday" | "other";
type FollowUp = "" | "going" | "waitSpare" | "ready";
const QUICK_PHRASES: TranslationKey[] = ["pn.q.disassembled", "pn.q.replaced", "pn.q.tested", "pn.q.missingSpare", "pn.q.waitShop", "pn.q.done"];

interface Attachment { key: string; file: File; kind: "PHOTO" | "DOCUMENT"; preview: string | null }

/**
 * Registrar un avance (preview V29). Un solo formulario para celular y
 * escritorio: se escribe o se dicta, se suman varias fotos o documentos, y se
 * elige cuándo fue. Sin señal, queda guardado en el teléfono y se envía solo.
 * Después de guardar, si la IA ve repuestos en el texto, pregunta antes de
 * descontarlos del stock; si no, se cierra como antes.
 */
export const ProgressNoteSheet: React.FC<Props> = ({ workOrderId, onClose, onSaved }) => {
  const t = useT();
  const can = useCan();
  const [text, setText] = useState("");
  const [phrases, setPhrases] = useState<string[]>([]);
  const [when, setWhen] = useState<When>("now");
  const [otherWhen, setOtherWhen] = useState(toLocalInput(new Date()));
  const [followUp, setFollowUp] = useState<FollowUp>("");
  const [files, setFiles] = useState<Attachment[]>([]);
  const [compressing, setCompressing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [stage, setStage] = useState<"form" | "queued" | "spares">("form");
  const [detected, setDetected] = useState<DetectedSpare[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(0);

  useEffect(() => { startProgressOutbox(); return subscribeOutbox(setPending); }, []);

  // ─── Dictado (reconocimiento de voz del navegador) ─────────────────────────
  const SR_AVAILABLE = typeof window !== "undefined" && (!!(window as any).SpeechRecognition || !!(window as any).webkitSpeechRecognition);
  const [dictating, setDictating] = useState(false);
  const [interim, setInterim] = useState("");
  const recogRef = useRef<any>(null);
  const baseTextRef = useRef("");

  const stopDictation = useCallback(() => {
    const r = recogRef.current;
    recogRef.current = null;
    if (r) { try { r.stop(); } catch { /* noop */ } }
    setDictating(false);
    setInterim("");
  }, []);

  const startDictation = useCallback(() => {
    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    setErr(null);
    try {
      const recog = new SR();
      recog.continuous = true;
      recog.interimResults = true;
      recog.lang = "es-AR";
      baseTextRef.current = text;
      let finals = "";
      recog.onresult = (ev: any) => {
        let inter = "";
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const chunk = ev.results[i][0].transcript;
          if (ev.results[i].isFinal) finals = `${finals} ${chunk}`.trim();
          else inter += chunk;
        }
        const base = baseTextRef.current.trim();
        setText([base, finals].filter(Boolean).join(base && finals ? " " : ""));
        setInterim(inter);
      };
      recog.onerror = (ev: any) => { if (ev?.error && ev.error !== "no-speech") { setErr(t("pn.dictationError")); stopDictation(); } };
      recog.onend = () => { if (recogRef.current === recog) { try { recog.start(); } catch { /* ya corre */ } } };
      recog.start();
      recogRef.current = recog;
      setDictating(true);
    } catch {
      setErr(t("pn.dictationError"));
    }
  }, [text, t, stopDictation]);

  useEffect(() => () => {
    stopDictation();
    files.forEach(f => { if (f.preview) URL.revokeObjectURL(f.preview); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Adjuntos ──────────────────────────────────────────────────────────────
  const addPhotos = useCallback(async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setCompressing(true);
    try {
      const added: Attachment[] = [];
      for (const f of Array.from(list)) {
        const c = f.type.startsWith("image/") ? await compressImage(f) : f;
        added.push({ key: `${Date.now()}-${Math.random()}`, file: c, kind: c.type.startsWith("image/") ? "PHOTO" : "DOCUMENT", preview: c.type.startsWith("image/") ? URL.createObjectURL(c) : null });
      }
      setFiles(prev => [...prev, ...added]);
    } finally {
      setCompressing(false);
    }
  }, []);
  const addDocs = useCallback((list: FileList | null) => {
    if (!list || list.length === 0) return;
    setFiles(prev => [...prev, ...Array.from(list).map(f => ({ key: `${Date.now()}-${Math.random()}`, file: f, kind: "DOCUMENT" as const, preview: null }))]);
  }, []);
  const removeFile = (key: string) => setFiles(prev => {
    const f = prev.find(x => x.key === key);
    if (f?.preview) URL.revokeObjectURL(f.preview);
    return prev.filter(x => x.key !== key);
  });

  const togglePhrase = (label: string) => {
    setPhrases(prev => {
      const next = prev.includes(label) ? prev.filter(p => p !== label) : [...prev, label];
      // Las frases van al principio del texto; lo escrito a mano se conserva.
      const manual = prev.reduce((acc, p) => acc.replace(`${p}.`, "").replace(p, ""), text).trim();
      setText([next.map(p => `${p}.`).join(" "), manual].filter(Boolean).join(" "));
      return next;
    });
  };

  const occurredAt = (): string => {
    const d = new Date();
    if (when === "morning") d.setHours(8, 0, 0, 0);
    if (when === "yesterday") { d.setDate(d.getDate() - 1); d.setHours(12, 0, 0, 0); }
    if (when === "other") return new Date(otherWhen).toISOString();
    return d.toISOString();
  };

  const finalText = (): string => {
    const follow = followUp ? t(`pn.follow.${followUp}` as TranslationKey) : "";
    return [text.trim(), follow ? `${t("pn.followPrefix")} ${follow}.` : ""].filter(Boolean).join("\n");
  };

  // ─── Guardar ───────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (dictating) stopDictation();
    const body = finalText();
    if (!body.trim() && files.length === 0) { setErr(t("pn.needSomething")); return; }
    if (when === "other" && new Date(otherWhen).getTime() > Date.now()) { setErr(t("pn.futureDate")); return; }
    setErr(null);
    setSaving(true);
    const payload: ProgressPayload = {
      workOrderId,
      text: body,
      occurredAt: occurredAt(),
      files: files.map<OutboxFile>(f => ({ name: f.file.name, mime: f.file.type, kind: f.kind, blob: f.file })),
    };
    let remaining: ProgressPayload = payload;
    try {
      await sendProgress(payload, r => { remaining = r; });
      onSaved(body.trim() || undefined);
      // ¿Se usaron repuestos? Sólo si hay texto y quien carga puede mover stock.
      if (body.trim() && can("stock.manage")) {
        try {
          const res = await api.post<{ items: DetectedSpare[] }>(`/app/pms/work-orders/${workOrderId}/progress-notes/detect-spares`, { text: body });
          if (res.items.length > 0) {
            setDetected(res.items);
            setPicked(new Set(res.items.map(i => i.spareId)));
            setStage("spares");
            return;
          }
        } catch { /* la detección es una ayuda: si falla, no molesta */ }
      }
      onClose();
    } catch (e) {
      if (isRetryableError(e)) {
        // Sin señal (o servidor caído): queda en el teléfono y se envía solo. Se guarda sólo lo que falta.
        await enqueueProgress({ ...remaining, workOrderLabel: null });
        onSaved(undefined);
        setStage("queued");
      } else {
        setErr(e instanceof ApiError ? e.message : t("pn.saveError"));
      }
    } finally {
      setSaving(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dictating, files, when, otherWhen, followUp, text, workOrderId, onSaved, can, t]);

  const confirmSpares = async (use: boolean) => {
    if (!use || picked.size === 0) { onClose(); return; }
    setConfirming(true);
    try {
      await api.post(`/app/pms/work-orders/${workOrderId}/progress-notes/confirm-spares`, {
        usages: detected.filter(d => picked.has(d.spareId)).map(d => ({ spareId: d.spareId, quantity: d.quantity })),
      });
      onClose();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t("pn.saveError"));
    } finally {
      setConfirming(false);
    }
  };

  const resetForAnother = () => {
    files.forEach(f => { if (f.preview) URL.revokeObjectURL(f.preview); });
    setText(""); setPhrases([]); setFiles([]); setFollowUp(""); setWhen("now"); setDetected([]); setStage("form");
  };

  const chip = (on: boolean) => `rounded-full border px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${on ? "border-fg bg-fg text-surface" : "border-fg/10 bg-surface text-fg hover:border-fg/25"}`;
  const lbl = "text-xs font-bold text-text-industrial/70 mb-1.5";
  const canSave = (text.trim() || followUp || files.length > 0) && !saving && !compressing;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center" onClick={stage === "form" ? undefined : onClose}>
      <div className="w-full max-w-md bg-surface dark:bg-[#0D1B2A] border-t sm:border border-fg/10 rounded-t-2xl sm:rounded-2xl flex flex-col max-h-[92vh]" onClick={e => e.stopPropagation()}>
        <div className="flex justify-center pt-2 sm:hidden"><div className="w-10 h-1 rounded-full bg-fg/20" /></div>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-fg/10">
          <span className="text-[15px] font-black text-fg">{t("pn.title")}</span>
          {pending > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10.5px] font-extrabold text-amber-800 dark:text-amber-300" title={t("pn.pendingHint")}>
              <CloudOff className="w-3 h-3" /> {t("pn.pendingN").replace("{n}", String(pending))}
            </span>
          )}
          <ModalCloseButton onClose={() => { stopDictation(); onClose(); }} className="ml-auto" />
        </div>

        {stage === "form" && (
          <>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div>
                <p className={lbl}>{t("pn.whatDone")}</p>
                <AutoTextArea value={text} onChange={e => setText(e.target.value)} rows={4} placeholder={t("pn.whatDonePh")}
                  className="w-full bg-fg/5 border-[1.5px] border-fg/10 rounded-xl px-3 py-2.5 text-[15px] text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 resize-none" />
                {interim && <p className="mt-1 text-xs italic text-text-industrial/50">{interim}…</p>}
                {SR_AVAILABLE ? (
                  <button type="button" onClick={dictating ? stopDictation : startDictation}
                    className={`mt-2 w-full flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-extrabold transition-colors ${dictating ? "bg-red-600 text-white animate-pulse" : "bg-red-500/10 text-red-700 dark:text-red-400 hover:bg-red-500/20"}`}>
                    {dictating ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />} {dictating ? t("pn.dictating") : t("pn.dictate")}
                  </button>
                ) : (
                  <p className="mt-1 text-[11px] text-text-industrial/45">{t("pn.noDictation")}</p>
                )}
              </div>

              <div>
                <p className={lbl}>{t("pn.quick")}</p>
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_PHRASES.map(k => { const label = t(k); return <button key={k} type="button" onClick={() => togglePhrase(label)} className={chip(phrases.includes(label))}>{label}</button>; })}
                </div>
              </div>

              <div>
                <p className={lbl}>{t("pn.attachments")}</p>
                <div className="flex flex-wrap gap-2">
                  {files.map(f => (
                    <div key={f.key} className="relative w-[72px] h-[72px] rounded-xl border border-fg/10 bg-fg/5 overflow-hidden flex items-center justify-center">
                      {f.preview ? <img src={f.preview} alt="" className="w-full h-full object-cover" /> : <span className="flex flex-col items-center px-1 text-center"><FileText className="w-5 h-5 text-accent" /><span className="text-[9px] text-text-industrial/60 truncate w-16">{f.file.name}</span></span>}
                      <button type="button" onClick={() => removeFile(f.key)} className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-rose-600 text-white flex items-center justify-center"><X className="w-3 h-3" /></button>
                    </div>
                  ))}
                  <label className="w-[72px] h-[72px] rounded-xl border-2 border-dashed border-fg/15 flex flex-col items-center justify-center gap-0.5 text-[10.5px] font-bold text-text-industrial/60 cursor-pointer hover:bg-fg/5">
                    {compressing ? <Loader2 className="w-5 h-5 animate-spin text-accent" /> : <Camera className="w-5 h-5" />} {t("pn.photo")}
                    <input type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={e => { void addPhotos(e.target.files); e.target.value = ""; }} />
                  </label>
                  <label className="w-[72px] h-[72px] rounded-xl border-2 border-dashed border-fg/15 flex flex-col items-center justify-center gap-0.5 text-[10.5px] font-bold text-text-industrial/60 cursor-pointer hover:bg-fg/5">
                    <Paperclip className="w-5 h-5" /> {t("pn.file")}
                    {/* ZIP: un informe con sus anexos en un solo archivo. Cada sistema reporta el .zip distinto. */}
                    <input type="file" accept="application/pdf,image/*,.zip,application/zip,application/x-zip-compressed" multiple className="hidden" onChange={e => { addDocs(e.target.files); e.target.value = ""; }} />
                  </label>
                </div>
              </div>

              <div>
                <p className={lbl}>{t("pn.when")}</p>
                <div className="flex flex-wrap gap-1.5">
                  {(["now", "morning", "yesterday", "other"] as When[]).map(k => (
                    <button key={k} type="button" onClick={() => setWhen(k)} className={chip(when === k)}>{t(`pn.when.${k}` as TranslationKey)}</button>
                  ))}
                </div>
                {when === "other" && (
                  <input type="datetime-local" value={otherWhen} max={toLocalInput(new Date())} onChange={e => setOtherWhen(e.target.value)}
                    className="mt-2 w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg focus:outline-none focus:border-accent/50" />
                )}
              </div>

              <div>
                <p className={lbl}>{t("pn.follow")}</p>
                <div className="flex flex-wrap gap-1.5">
                  {(["going", "waitSpare", "ready"] as const).map(k => (
                    <button key={k} type="button" onClick={() => setFollowUp(v => (v === k ? "" : k))} className={chip(followUp === k)}>{t(`pn.follow.${k}` as TranslationKey)}</button>
                  ))}
                </div>
              </div>
            </div>
            <div className="border-t border-fg/10 p-3 space-y-1.5">
              <button type="button" onClick={() => { void handleSave(); }} disabled={!canSave}
                className="w-full py-3 rounded-xl bg-accent text-accent-fg text-[15px] font-extrabold disabled:opacity-40 flex items-center justify-center gap-2">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                {t("pn.save")}{files.length > 0 ? ` · ${t(files.length === 1 ? "pn.oneAttachment" : "pn.nAttachments").replace("{n}", String(files.length))}` : ""}
              </button>
              <p className="text-center text-[11px] text-text-industrial/50">{canSave ? t("pn.offlineHint") : t("pn.needSomething")}</p>
            </div>
          </>
        )}

        {stage === "queued" && (
          <div className="p-6 flex flex-col items-center text-center gap-3">
            <span className="w-14 h-14 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300 flex items-center justify-center"><CloudOff className="w-7 h-7" /></span>
            <p className="text-lg font-black text-fg">{t("pn.queuedTitle")}</p>
            <p className="text-sm text-text-industrial/70">{t("pn.queuedDesc")}</p>
            <div className="flex w-full flex-col gap-2 pt-2">
              <button type="button" onClick={resetForAnother} className="w-full py-2.5 rounded-xl border border-fg/15 text-sm font-bold text-fg flex items-center justify-center gap-1.5"><Plus className="w-4 h-4" /> {t("pn.another")}</button>
              <button type="button" onClick={onClose} className="w-full py-2.5 rounded-xl bg-accent text-accent-fg text-sm font-bold">{t("common.close")}</button>
            </div>
          </div>
        )}

        {stage === "spares" && (
          <div className="p-5 flex flex-col gap-3">
            <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 font-extrabold"><CheckCircle2 className="w-5 h-5" /> {t("pn.savedTitle")}</div>
            <div className="rounded-2xl border border-violet-500/35 bg-violet-500/[0.06] p-3 space-y-2">
              <p className="flex items-center gap-1.5 text-sm font-extrabold text-violet-700 dark:text-violet-300"><Sparkles className="w-4 h-4" /> {t("pn.sparesTitle")}</p>
              <p className="text-xs text-text-industrial/70">{t("pn.sparesDesc")}</p>
              {detected.map(d => (
                <label key={d.spareId} className="flex items-center gap-2 rounded-xl border border-fg/10 bg-surface px-2.5 py-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={picked.has(d.spareId)} onChange={() => setPicked(prev => { const n = new Set(prev); if (n.has(d.spareId)) n.delete(d.spareId); else n.add(d.spareId); return n; })} className="w-4 h-4 accent-violet-600" />
                  <b className="text-fg">{d.quantity} {d.unit}</b>
                  <span className="min-w-0 flex-1 truncate text-fg">{d.name}</span>
                  <span className="font-mono text-[10.5px] text-text-industrial/50">{d.sku}</span>
                </label>
              ))}
              <div className="flex gap-2 pt-1">
                <button type="button" disabled={confirming} onClick={() => { void confirmSpares(false); }} className="flex-1 py-2.5 rounded-xl border border-fg/15 bg-surface text-sm font-bold text-fg">{t("pn.sparesNo")}</button>
                <button type="button" disabled={confirming || picked.size === 0} onClick={() => { void confirmSpares(true); }} className="flex-1 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-bold disabled:opacity-45 flex items-center justify-center gap-1.5">
                  {confirming && <Loader2 className="w-4 h-4 animate-spin" />} {t("pn.sparesYes")}
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
      {err && <AlertDialog message={err} onClose={() => setErr(null)} />}
    </div>
  );
};
