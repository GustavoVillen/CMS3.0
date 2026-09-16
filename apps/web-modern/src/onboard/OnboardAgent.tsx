// EL AGENTE (Preview V34): el botón grande del inicio.
//
// Se mantiene apretado, se dice lo que se quiere hacer y se suelta. Atrás está
// el MISMO copiloto de la PC —con sus herramientas sobre todos los módulos y su
// regla dura: nada se guarda sin que el usuario confirme con un botón—, pero
// presentado como se usa a bordo: preguntas de a una y respuestas con botones
// grandes en vez de texto para escribir.
//
// Lo que aporta esta pantalla:
//   · grabar mientras el botón está apretado (dictado del navegador);
//   · las opciones numeradas de la respuesta, como botones (en la PC ya es así);
//   · las acciones sugeridas, con su botón de confirmar, que es lo único que
//     escribe en la base.
//
// En iPhone el navegador no tiene dictado: ahí el mismo botón abre el teclado.

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Bot, Mic, Square, Send, Loader2, Check, TriangleAlert, Keyboard, X } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { useT, useLocale } from "../lib/i18n";
import { useVesselContext } from "../lib/vessel-context";
import { extractNumberedOptions, stripAiBlocks } from "../lib/copilot-blocks";
import { MarkdownText } from "../components/MarkdownText";
import { ModalCloseButton } from "../components/ModalCloseButton";

interface AgentAction {
  type: string;
  target: string;
  label?: string;
  patch?: Record<string, unknown>;
  vesselCode?: string;
  state: "idle" | "applying" | "applied" | "failed";
  errorMsg?: string;
}

interface AgentMessage {
  role: "user" | "assistant" | "system";
  content: string;
  actions?: AgentAction[];
}

/** ¿El navegador dicta? (Chrome/Edge sí; Safari de iPhone no.) */
function speechAvailable(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  return !!(w.SpeechRecognition || w.webkitSpeechRecognition);
}

export const OnboardAgent: React.FC = () => {
  const t = useT();
  const locale = useLocale();
  const { selectedVesselCode, selectedVessel } = useVesselContext();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState("");
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);
  const finalRef = useRef("");
  const chatRef = useRef<HTMLDivElement>(null);
  const canSpeak = speechAvailable();

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, streaming]);

  // ── Hablar con el copiloto ────────────────────────────────────────────────
  const send = useCallback(async (text: string) => {
    const clean = text.trim();
    if (!clean || streaming) return;
    setError(null);
    setHeard("");
    const history = [...messages, { role: "user" as const, content: clean }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setStreaming(true);
    try {
      const reader = await api.stream("/app/copiloto/chat", {
        capability: "knowledge_assistant",
        locale,
        mode: "agent",
        messages: history.filter(m => m.role !== "system").map(m => ({ role: m.role, content: m.content })),
        screenContext: {
          module: "DASHBOARD",
          screen: "ONBOARD_AGENT",
          vesselCode: selectedVesselCode ?? undefined,
        },
      });
      let raw = "";
      let done = false;
      while (!done) {
        const { done: end, value } = await reader.read();
        if (end) break;
        for (const line of value.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") { done = true; break; }
          try {
            const parsed = JSON.parse(data) as {
              text?: string; error?: string;
              actions?: Array<{ type: string; target: string; label?: string; patch?: Record<string, unknown>; vesselCode?: string }>;
              stripText?: string;
            };
            if (parsed.error) { setError(parsed.error); done = true; break; }
            if (parsed.text) raw += parsed.text;
            if (parsed.stripText) raw = raw.replace(parsed.stripText, "");
            // Los links de la PC no sirven en el celular: queda el texto.
            const shown = stripAiBlocks(raw).replace(/\[([^\]]+)\]\((?:\/|https?:)[^)]*\)/g, "$1");
            const actions = parsed.actions?.map(a => ({ ...a, state: "idle" as const }));
            setMessages(prev => {
              const next = [...prev];
              const last = next[next.length - 1]!;
              next[next.length - 1] = { ...last, content: shown, actions: actions ?? last.actions };
              return next;
            });
          } catch { /* línea SSE partida */ }
        }
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("ob.agent.failed"));
      setMessages(prev => prev.slice(0, -1));
    } finally {
      setStreaming(false);
    }
  }, [messages, streaming, locale, selectedVesselCode, t]);

  // ── Dictado mientras el botón está apretado ───────────────────────────────
  //
  // Dos cosas que en el teléfono real fallaban y hay que cuidar:
  //  · El dictado del navegador CORTA solo en cuanto hay una pausa (onend), aunque
  //    el dedo siga apretando. Mientras `holdingRef` esté en true se vuelve a
  //    arrancar, así el que habla puede pensar en el medio de la frase.
  //  · Si la pantalla cambia debajo del dedo, el "soltar" se pierde. Por eso el
  //    botón captura el puntero y la conversación no se abre hasta soltar.
  const holdingRef = useRef(false);

  const startListening = useCallback(() => {
    if (!canSpeak || listening || streaming) return;
    const SR: any = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    try {
      const recognition = new SR();
      recognition.lang = locale === "en" ? "en-US" : locale === "pt" ? "pt-BR" : "es-AR";
      recognition.continuous = true;
      recognition.interimResults = true;
      finalRef.current = "";
      holdingRef.current = true;
      recognition.onresult = (ev: any) => {
        let interim = "";
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const chunk = ev.results[i][0].transcript;
          if (ev.results[i].isFinal) finalRef.current = `${finalRef.current} ${chunk}`.trim();
          else interim += chunk;
        }
        setHeard(`${finalRef.current} ${interim}`.trim());
      };
      recognition.onend = () => {
        // Cortó por una pausa pero el dedo sigue apretado: seguimos escuchando.
        if (holdingRef.current && recognitionRef.current === recognition) {
          try { recognition.start(); } catch { /* ya estaba arrancando */ }
        }
      };
      recognition.onerror = () => { /* al soltar se manda lo que haya */ };
      recognitionRef.current = recognition;
      recognition.start();
      setListening(true);
    } catch {
      setError(t("ob.agent.micFailed"));
    }
  }, [canSpeak, listening, streaming, locale, t]);

  const stopListening = useCallback(() => {
    if (!holdingRef.current) return;
    holdingRef.current = false;
    const r = recognitionRef.current;
    recognitionRef.current = null;
    setListening(false);
    try { r?.stop(); } catch { /* ya estaba detenido */ }
    // El último trozo llega con el evento de cierre: se da un respiro corto.
    setTimeout(() => {
      const text = finalRef.current.trim();
      finalRef.current = "";
      if (text) { setOpen(true); void send(text); }
      else setHeard("");
    }, 400);
  }, [send]);

  useEffect(() => () => { holdingRef.current = false; try { recognitionRef.current?.abort(); } catch { /* noop */ } }, []);

  // ── Confirmar una acción ──────────────────────────────────────────────────
  const applyAction = useCallback(async (msgIdx: number, actIdx: number) => {
    const action = messages[msgIdx]?.actions?.[actIdx];
    if (!action || action.state === "applying" || action.state === "applied") return;
    const setState = (state: AgentAction["state"], errorMsg?: string) => setMessages(prev => {
      const next = [...prev];
      const m = { ...next[msgIdx]! };
      m.actions = (m.actions ?? []).map((a, i) => i === actIdx ? { ...a, state, errorMsg } : a);
      next[msgIdx] = m;
      return next;
    });
    setState("applying");
    try {
      const res = await api.post<{ ok: boolean; applied?: { entityCode?: string } }>("/app/copiloto/apply-action", {
        type: action.type,
        target: action.target,
        patch: action.patch ?? {},
        vesselCode: action.vesselCode ?? selectedVesselCode ?? undefined,
      });
      setState("applied");
      // La frase en pasado la escribe el sistema, nunca la IA: sólo después de
      // que el servidor confirmó que la escritura ocurrió.
      const code = res?.applied?.entityCode;
      setMessages(prev => [...prev, {
        role: "system",
        content: code
          ? t("ob.agent.doneWithCode").replace("{label}", action.label ?? action.type).replace("{code}", code)
          : t("ob.agent.done").replace("{label}", action.label ?? action.type),
      }]);
    } catch (e) {
      setState("failed", e instanceof ApiError ? e.message : t("ob.agent.applyFailed"));
    }
  }, [messages, selectedVesselCode, t]);

  const reset = () => { setMessages([]); setHeard(""); setError(null); setDraft(""); setTyping(false); };

  // Opciones de la última respuesta: se tocan en vez de escribir.
  const lastIdx = messages.length - 1;
  const last = messages[lastIdx];
  const options = !streaming && last?.role === "assistant" ? extractNumberedOptions(last.content) : [];

  const bigButton = (
    <button
      type="button"
      onPointerDown={e => {
        e.preventDefault();
        // Capturar el dedo: aunque la pantalla cambie debajo, el "soltar" llega
        // igual a este botón (sin esto el dictado quedaba prendido).
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* sin captura, sigue igual */ }
        if (canSpeak) startListening(); else { setOpen(true); setTyping(true); }
      }}
      onPointerUp={() => { if (canSpeak) stopListening(); }}
      onPointerCancel={() => { if (canSpeak) stopListening(); }}
      onContextMenu={e => e.preventDefault()}
      className={`w-full min-h-[104px] rounded-[22px] p-4 flex gap-3.5 items-center text-left text-white select-none touch-none shadow-[0_14px_30px_-14px_rgba(124,58,237,0.75)] ${
        listening ? "bg-gradient-to-br from-danger to-red-700" : "bg-gradient-to-br from-violet-600 to-indigo-600"
      }`}
    >
      <span className="w-16 h-16 shrink-0 rounded-full bg-white/20 grid place-items-center relative">
        {listening ? <Square className="w-7 h-7" /> : <Mic className="w-8 h-8" />}
        {listening && <span className="absolute -inset-2 rounded-full border-[3px] border-white/40 animate-ping" />}
      </span>
      <span className="min-w-0">
        <b className="block text-lg font-extrabold leading-tight">
          {listening ? t("ob.agent.listening") : t("ob.agent.title")}
        </b>
        <small className="block text-[13px] opacity-90 mt-0.5">
          {listening ? t("ob.agent.release") : canSpeak ? t("ob.agent.holdToTalk") : t("ob.agent.typeInstead")}
        </small>
        {heard && <small className="block text-[13px] mt-1.5 opacity-95 line-clamp-2">“{heard}”</small>}
      </span>
    </button>
  );

  return (
    <>
      {bigButton}

      {open && (
        <div className="fixed inset-0 z-[120] bg-black/55 flex items-end" onClick={() => { if (!streaming && !listening) setOpen(false); }}>
          <div onClick={e => e.stopPropagation()}
            className="w-full max-h-[92%] bg-surface rounded-t-[24px] flex flex-col overflow-hidden">
            <div className="flex gap-2.5 items-center px-4 py-3.5 border-b border-fg/10">
              <span className="w-[38px] h-[38px] rounded-xl bg-violet-500/15 text-violet-600 dark:text-violet-300 grid place-items-center shrink-0">
                <Bot className="w-5 h-5" />
              </span>
              <span className="min-w-0 flex-1">
                <b className="block text-base font-extrabold">{t("ob.agent.name")}</b>
                <small className="block text-xs text-text-industrial/60 truncate">{selectedVessel?.name ?? ""}</small>
              </span>
              {messages.length > 0 && (
                <button type="button" onClick={reset} aria-label={t("ob.agent.restart")}
                  className="min-h-9 px-3 rounded-xl border border-fg/10 text-[13px] font-bold">{t("ob.agent.restart")}</button>
              )}
              <ModalCloseButton onClose={() => setOpen(false)} />
            </div>

            <div ref={chatRef} className="flex-1 overflow-y-auto px-4 py-3.5 flex flex-col gap-3">
              {messages.length === 0 && !listening && (
                <p className="text-sm text-text-industrial/60 text-center py-6">{t("ob.agent.empty")}</p>
              )}
              {listening && (
                <p className="self-end max-w-[85%] rounded-2xl rounded-br-sm bg-accent/15 px-3.5 py-2.5 text-[14.5px] text-fg">
                  {heard || t("ob.agent.listening")}
                </p>
              )}
              {messages.map((m, i) => (
                <React.Fragment key={i}>
                  {m.role === "user" && (
                    <p className="self-end max-w-[85%] rounded-2xl rounded-br-sm bg-accent/15 px-3.5 py-2.5 text-[14.5px] text-fg">{m.content}</p>
                  )}
                  {m.role === "system" && (
                    <p className="self-center max-w-[92%] rounded-2xl bg-success/15 text-success px-3.5 py-2 text-[13.5px] font-bold flex gap-2 items-start">
                      <Check className="w-4 h-4 shrink-0 mt-px" />{m.content}
                    </p>
                  )}
                  {m.role === "assistant" && (
                    <div className="self-start max-w-[92%] rounded-2xl rounded-bl-sm bg-fg/5 px-3.5 py-2.5 text-[14.5px] text-fg">
                      {m.content
                        ? <MarkdownText text={m.content} />
                        : streaming && i === lastIdx
                          ? <span className="flex gap-2 items-center text-text-industrial/60"><Loader2 className="w-4 h-4 animate-spin" />{t("ob.agent.thinking")}</span>
                          : null}
                      {(m.actions ?? []).map((a, ai) => (
                        <button key={ai} type="button" onClick={() => void applyAction(i, ai)}
                          disabled={a.state === "applying" || a.state === "applied"}
                          className={`mt-2.5 w-full min-h-[52px] rounded-2xl text-[15px] font-extrabold flex items-center justify-center gap-2 px-3 ${
                            a.state === "applied" ? "bg-success/15 text-success"
                              : a.state === "failed" ? "bg-danger/15 text-danger"
                              : "bg-violet-600 text-white"
                          }`}>
                          {a.state === "applying" ? <Loader2 className="w-[18px] h-[18px] animate-spin" />
                            : a.state === "applied" ? <Check className="w-[18px] h-[18px]" />
                            : a.state === "failed" ? <TriangleAlert className="w-[18px] h-[18px]" />
                            : <Check className="w-[18px] h-[18px]" />}
                          <span className="truncate">{a.state === "failed" ? (a.errorMsg ?? t("ob.agent.applyFailed")) : (a.label ?? a.type)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </React.Fragment>
              ))}
              {error && (
                <p className="self-start max-w-[92%] rounded-2xl bg-danger/15 text-danger px-3.5 py-2.5 text-[13.5px] font-semibold flex gap-2 items-start">
                  <TriangleAlert className="w-4 h-4 shrink-0 mt-px" />{error}
                </p>
              )}

              {/* Las opciones de la última respuesta, como botones grandes.
                  Van DENTRO de la conversación (no en el pie fijo): con cinco
                  equipos el pie se comía la pantalla y no se podía scrollear.
                  Se muestran siempre, también con el teclado abierto: en iPhone,
                  que no dicta, el teclado es el modo normal. */}
              {options.map(o => (
                <button key={o.n} type="button" onClick={() => void send(o.label)}
                  className="w-full min-h-[56px] rounded-2xl border-[1.5px] border-fg/10 bg-surface text-[15.5px] font-bold flex items-center gap-2.5 px-3.5 text-left shrink-0">
                  <span className="w-[26px] h-[26px] shrink-0 rounded-lg bg-violet-500/15 text-violet-600 dark:text-violet-300 grid place-items-center text-[12.5px] font-extrabold">{o.n}</span>
                  <span className="min-w-0">{o.label}</span>
                </button>
              ))}
            </div>

            <div className="border-t border-fg/10 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] flex flex-col gap-2 bg-surface shrink-0">
              {typing || !canSpeak ? (
                <div className="flex gap-2">
                  <input value={draft} onChange={e => setDraft(e.target.value)} autoFocus
                    onKeyDown={e => { if (e.key === "Enter" && draft.trim()) { void send(draft); setDraft(""); } }}
                    placeholder={t("ob.agent.typePh")}
                    className="flex-1 min-h-[52px] rounded-2xl border-[1.5px] border-fg/10 bg-surface text-fg text-base px-3.5 focus:outline-none focus:border-accent" />
                  <button type="button" disabled={!draft.trim() || streaming}
                    onClick={() => { void send(draft); setDraft(""); }}
                    className="min-h-[52px] px-4 rounded-2xl bg-accent text-accent-fg font-extrabold disabled:opacity-45">
                    <Send className="w-5 h-5" />
                  </button>
                  {canSpeak && (
                    <button type="button" onClick={() => setTyping(false)} aria-label={t("ob.agent.useVoice")}
                      className="min-h-[52px] px-3 rounded-2xl border-[1.5px] border-fg/10"><X className="w-5 h-5" /></button>
                  )}
                </div>
              ) : (
                <div className="flex gap-2">
                  <button type="button"
                    onPointerDown={e => {
                      e.preventDefault();
                      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* sin captura, sigue igual */ }
                      startListening();
                    }}
                    onPointerUp={stopListening}
                    onPointerCancel={stopListening}
                    onContextMenu={e => e.preventDefault()}
                    disabled={streaming}
                    className={`flex-1 min-h-[54px] rounded-2xl font-extrabold text-[15px] flex items-center justify-center gap-2 select-none touch-none disabled:opacity-45 ${
                      listening ? "bg-danger text-white" : "bg-violet-500/15 text-violet-700 dark:text-violet-300"
                    }`}>
                    {listening ? <Square className="w-[18px] h-[18px]" /> : <Mic className="w-[18px] h-[18px]" />}
                    {listening ? t("ob.agent.release") : t("ob.agent.holdToTalk")}
                  </button>
                  <button type="button" onClick={() => setTyping(true)} aria-label={t("ob.agent.typeInstead")}
                    className="min-h-[54px] px-4 rounded-2xl border-[1.5px] border-fg/10">
                    <Keyboard className="w-5 h-5" />
                  </button>
                </div>
              )}
              <p className="text-center text-[12px] text-text-industrial/50">{t("ob.agent.confirmNote")}</p>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
