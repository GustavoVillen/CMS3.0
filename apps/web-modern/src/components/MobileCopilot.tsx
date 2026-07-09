import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Send, Loader2, Bot, Mic, VolumeX, AudioLines } from "lucide-react";
import { api } from "../lib/api";
import { useCopilotScreenContext } from "../lib/copilot-context";
import { useVesselContext } from "../lib/vessel-context";
import { MarkdownText } from "./MarkdownText";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  fromVoice?: boolean;
}

// Remueve solo el bloque [CAMPOS]...[/CAMPOS] (instrucciones internas del copiloto
// que no debe ver el usuario). El resto del markdown (**bold**, headings, listas)
// se renderiza con <MarkdownText>.
function cleanCampos(text: string): string {
  return text.replace(/\[CAMPOS\][\s\S]*?\[\/CAMPOS\]/g, "");
}

function buildVoiceSummary(text: string): string {
  return text
    .replace(/\[CAMPOS\][\s\S]*?\[\/CAMPOS\]/g, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/^#{1,3}\s+/gm, "")
    .replace(/^[-*•]\s+/gm, "")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function getSpanishVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  for (const lang of ["es-AR", "es-MX", "es-ES", "es"]) {
    const v = voices.find(v => v.lang === lang || v.lang.startsWith(lang));
    if (v) return v;
  }
  return null;
}

function formatDuration(seconds: number): string {
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const MIN_HOLD_MS = 400;

// Voice mode prompt lives server-side. We just signal mode: "voice" in the request
// body and the backend appends the appropriate system prompt instruction.

export const MobileCopilot: React.FC = () => {
  const { screenContext } = useCopilotScreenContext();
  const { selectedVesselCode, selectedVessel } = useVesselContext();
  // Construye un contexto efectivo que SIEMPRE incluya el buque seleccionado
  // en mobile (que es el contexto principal del técnico). Si una pantalla ya
  // emitió un screenContext específico (ej. abrir una OT), lo respetamos y
  // mergeamos el vesselCode encima si no estaba.
  const effectiveContext = useMemo(() => {
    if (screenContext) {
      return {
        ...screenContext,
        vesselCode: screenContext.vesselCode ?? selectedVesselCode ?? undefined,
      };
    }
    if (selectedVesselCode) {
      return {
        module: "MOBILE_COPILOT",
        screen: "MOBILE_CHAT",
        vesselCode: selectedVesselCode,
        ...(selectedVessel?.name ? { entityCode: selectedVessel.name } : {}),
      };
    }
    return null;
  }, [screenContext, selectedVesselCode, selectedVessel]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [speaking, setSpeaking] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const pressStartRef = useRef<number>(0);
  const recordTimerRef = useRef<number | null>(null);
  const cancelledRef = useRef<boolean>(false);
  const micBtnRef = useRef<HTMLButtonElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sendMessageRef = useRef<(text: string, fromVoice: boolean) => Promise<void>>(undefined);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => () => {
    window.speechSynthesis.cancel();
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    recognitionRef.current?.abort();
    if (recordTimerRef.current) clearInterval(recordTimerRef.current);
  }, []);

  const stopSpeaking = useCallback(() => {
    window.speechSynthesis.cancel();
    if (audioRef.current) {
      audioRef.current.pause();
      if (audioRef.current.src.startsWith("blob:")) URL.revokeObjectURL(audioRef.current.src);
      audioRef.current.src = "";
      audioRef.current = null;
    }
    setSpeaking(false);
  }, []);

  // Fallback: voz del navegador (Web Speech API) si ElevenLabs no está disponible.
  const speakWithBrowser = useCallback((summary: string) => {
    const utter = new SpeechSynthesisUtterance(summary);
    const voice = getSpanishVoice();
    if (voice) utter.voice = voice;
    utter.lang = voice?.lang ?? "es-AR";
    utter.rate = 1.05;
    utter.onstart = () => setSpeaking(true);
    utter.onend = () => setSpeaking(false);
    utter.onerror = () => setSpeaking(false);

    if (window.speechSynthesis.getVoices().length === 0) {
      window.speechSynthesis.addEventListener("voiceschanged", () => {
        const v = getSpanishVoice();
        if (v) { utter.voice = v; utter.lang = v.lang; }
        window.speechSynthesis.speak(utter);
      }, { once: true });
    } else {
      window.speechSynthesis.speak(utter);
    }
  }, []);

  const speakText = useCallback((content: string) => {
    const summary = buildVoiceSummary(content);
    if (!summary) return;
    window.speechSynthesis.cancel();
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    setSpeaking(true);

    // Voz principal: ElevenLabs (backend). Fallback a la voz del navegador.
    (async () => {
      try {
        const { audioBase64, mime } = await api.post<{ audioBase64: string; mime: string }>(
          "/app/copiloto/tts",
          { text: summary },
        );
        // CSP permite media-src blob: (no data:), así que usamos un Blob URL.
        const bytes = Uint8Array.from(atob(audioBase64), c => c.charCodeAt(0));
        const objectUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
        const audio = new Audio(objectUrl);
        audioRef.current = audio;
        audio.onended = () => { URL.revokeObjectURL(objectUrl); audioRef.current = null; setSpeaking(false); };
        audio.onerror = () => { URL.revokeObjectURL(objectUrl); audioRef.current = null; speakWithBrowser(summary); };
        await audio.play();
      } catch {
        speakWithBrowser(summary);
      }
    })();
  }, [speakWithBrowser]);

  const sendMessage = useCallback(async (text: string, fromVoice: boolean) => {
    if (!text.trim() || streaming) return;
    setError(null);
    stopSpeaking();

    const userMsg: ChatMessage = { role: "user", content: text.trim(), fromVoice };
    const next = [...messages, userMsg];
    setMessages(next);
    setStreaming(true);
    setMessages(prev => [...prev, { role: "assistant", content: "" }]);

    try {
      const apiMessages = next.map((m) => ({ role: m.role, content: m.content }));

      const reader = await api.stream("/app/copiloto/chat", {
        capability: "knowledge_assistant",
        locale: navigator.language?.split("-")[0] ?? "es",
        messages: apiMessages,
        screenContext: effectiveContext ?? undefined,
        mode: "voice",
      });

      let assistantContent = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const line of value.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") break;
          try {
            const parsed = JSON.parse(data) as { text?: string; error?: string };
            if (parsed.error) { setError(parsed.error); break; }
            if (parsed.text) {
              assistantContent += parsed.text;
              setMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = { role: "assistant", content: assistantContent };
                return updated;
              });
            }
          } catch { /* partial SSE chunk */ }
        }
      }

      if (assistantContent && fromVoice) {
        speakText(assistantContent);
      }
    } catch (e: any) {
      setError(e?.message ?? "Error al conectar con el copiloto");
      setMessages(prev => {
        const updated = [...prev];
        if (updated[updated.length - 1]?.content === "") updated.pop();
        return updated;
      });
    } finally {
      setStreaming(false);
    }
  }, [messages, streaming, effectiveContext, speakText, stopSpeaking]);

  sendMessageRef.current = sendMessage;

  const handleTextSend = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    void sendMessage(text, false);
  }, [input, sendMessage]);

  const startRecording = useCallback(() => {
    if (streaming || recording) return;

    const SR = (window as unknown as {
      SpeechRecognition?: typeof SpeechRecognition;
      webkitSpeechRecognition?: typeof SpeechRecognition;
    }).SpeechRecognition
      ?? (window as unknown as { webkitSpeechRecognition?: typeof SpeechRecognition }).webkitSpeechRecognition;

    if (!SR) {
      setError("Tu navegador no soporta reconocimiento de voz.");
      return;
    }
    if (!window.isSecureContext) {
      setError("El micrófono requiere HTTPS. Accedé vía ngrok o localhost.");
      return;
    }

    stopSpeaking();
    cancelledRef.current = false;
    pressStartRef.current = Date.now();

    try {
      const recognition = new SR();
      recognition.lang = "es-AR";
      recognition.interimResults = false;
      recognition.continuous = true;
      recognition.maxAlternatives = 1;

      let finalTranscript = "";

      recognition.onstart = () => {
        setError(null);
        setRecording(true);
        setRecordSeconds(0);
        const startedAt = Date.now();
        recordTimerRef.current = window.setInterval(() => {
          setRecordSeconds((Date.now() - startedAt) / 1000);
        }, 100);
      };
      recognition.onend = () => {
        setRecording(false);
        recognitionRef.current = null;
        if (recordTimerRef.current) {
          clearInterval(recordTimerRef.current);
          recordTimerRef.current = null;
        }
        if (cancelledRef.current) {
          cancelledRef.current = false;
          return;
        }
        const text = finalTranscript.trim();
        if (text) {
          void sendMessageRef.current?.(text, true);
        }
      };
      recognition.onerror = (e: SpeechRecognitionErrorEvent) => {
        setRecording(false);
        if (recordTimerRef.current) {
          clearInterval(recordTimerRef.current);
          recordTimerRef.current = null;
        }
        const map: Record<string, string> = {
          "not-allowed": "Permiso de micrófono denegado.",
          "no-speech": "No detecté audio.",
          "audio-capture": "No se pudo acceder al micrófono.",
          "network": "Error de red en el reconocimiento.",
          "service-not-allowed": "Servicio de voz bloqueado.",
        };
        if (e.error !== "aborted" && e.error !== "no-speech") {
          setError(map[e.error] ?? `Error de voz: ${e.error}`);
        }
      };
      recognition.onresult = (e: SpeechRecognitionEvent) => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal) {
            finalTranscript += e.results[i][0]?.transcript ?? "";
          }
        }
      };
      recognitionRef.current = recognition;
      recognition.start();
    } catch (e: any) {
      setError(`No se pudo iniciar el micrófono: ${e?.message ?? "error"}`);
      setRecording(false);
    }
  }, [streaming, recording, stopSpeaking]);

  const stopRecording = useCallback(() => {
    const rec = recognitionRef.current;
    if (!rec) return;
    const heldFor = Date.now() - pressStartRef.current;
    if (heldFor < MIN_HOLD_MS) {
      cancelledRef.current = true;
      rec.abort();
      setError("Mantené presionado el micrófono para grabar");
      return;
    }
    rec.stop();
  }, []);

  const cancelRecording = useCallback(() => {
    cancelledRef.current = true;
    recognitionRef.current?.abort();
  }, []);

  const showSendButton = input.trim().length > 0;

  return (
    <div className="flex flex-col h-full bg-surface dark:bg-[#0A1A2A] select-none">
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 select-text">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-text-industrial/40 gap-3 text-center px-6">
            <Bot className="w-12 h-12" />
            <div className="text-sm font-bold text-fg/60">Copiloto IA</div>
            <div className="text-xs">
              Escribí o mantené presionado el micrófono para hablar.<br />
              El copiloto te responderá con voz.
            </div>
          </div>
        )}
        {messages.map((m, i) => {
          const isLastAssistant = m.role === "assistant" && i === messages.length - 1;
          const showLoader = streaming && isLastAssistant && !m.content;
          return (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[82%] px-3 py-2 rounded-2xl text-sm break-words ${
                  m.role === "user"
                    ? "bg-accent text-accent-fg rounded-br-sm"
                    : "bg-fg/5 text-fg rounded-bl-sm border border-fg/10"
                }`}
              >
                {showLoader ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <div className="flex items-start gap-2">
                    {m.fromVoice && (
                      <AudioLines className="w-3.5 h-3.5 mt-0.5 shrink-0 opacity-70" />
                    )}
                    <MarkdownText text={cleanCampos(m.content)} className="flex-1" />
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {error && (
          <div className="text-center text-xs text-red-700 dark:text-red-400 px-4">{error}</div>
        )}
      </div>

      {speaking && (
        <button
          type="button"
          onClick={stopSpeaking}
          className="mx-3 mb-2 flex items-center justify-center gap-2 py-2 rounded-xl bg-accent/15 text-accent text-xs font-bold border border-accent/30"
        >
          <VolumeX className="w-4 h-4" />
          Silenciar respuesta
        </button>
      )}

      <div className="shrink-0 border-t border-fg/10 p-3 bg-surface dark:bg-[#0D1B2A]">
        <div className="flex gap-2 items-end">
          {recording ? (
            <div className="flex-1 flex items-center gap-3 h-10 px-3 rounded-xl bg-red-500/15 border border-red-500/40">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
              <span className="text-sm font-mono text-fg tabular-nums w-12">{formatDuration(recordSeconds)}</span>
              <span className="flex-1 text-xs text-red-200 truncate">Soltá para enviar</span>
              <button
                type="button"
                onClick={cancelRecording}
                className="text-xs font-bold text-red-700 dark:text-red-300 hover:text-fg px-2"
              >
                Cancelar
              </button>
            </div>
          ) : (
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleTextSend();
                }
              }}
              disabled={streaming}
              placeholder="Escribí o mantené el micrófono…"
              rows={1}
              className="flex-1 bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 resize-none max-h-32"
            />
          )}
          {showSendButton && !recording ? (
            <button
              type="button"
              onClick={handleTextSend}
              disabled={streaming}
              className="w-10 h-10 shrink-0 rounded-xl bg-accent text-accent-fg flex items-center justify-center disabled:opacity-30"
              aria-label="Enviar"
            >
              {streaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          ) : (
            <button
              ref={micBtnRef}
              type="button"
              disabled={streaming}
              onPointerDown={e => {
                e.preventDefault();
                try { micBtnRef.current?.setPointerCapture(e.pointerId); } catch { /* noop */ }
                startRecording();
              }}
              onPointerUp={e => {
                e.preventDefault();
                try { micBtnRef.current?.releasePointerCapture(e.pointerId); } catch { /* noop */ }
                stopRecording();
              }}
              onPointerCancel={() => { if (recording) cancelRecording(); }}
              onContextMenu={e => e.preventDefault()}
              className={`w-10 h-10 shrink-0 rounded-xl flex items-center justify-center disabled:opacity-30 touch-none transition-colors ${
                recording ? "bg-red-500 text-fg" : "bg-accent text-accent-fg"
              }`}
              aria-label="Mantené presionado para hablar"
            >
              <Mic className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
