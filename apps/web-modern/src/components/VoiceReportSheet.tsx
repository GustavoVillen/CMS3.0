// Reporte verbal: grabación de audio + transcripción + parseo IA + loop de
// preguntas si falta info. Al terminar, llama a onComplete(type, prefill)
// para que el padre abra el modal correspondiente con los campos llenados.

import React, { useEffect, useRef, useState } from "react";
import { Mic, X, Loader2, Send, MicOff, Square, Sparkles } from "lucide-react";
import { useSpeechToText } from "../lib/use-speech-to-text";
import { useVesselContext } from "../lib/vessel-context";
import { api, ApiError } from "../lib/api";

interface VoiceReportFields {
  assetId?: string | null;
  description?: string;
  classification?: string;
  severity?: string;
  operationalState?: string;
  immediateAction?: string | null;
  category?: string;
  location?: string | null;
}

interface VoiceReportOutput {
  type: "defect" | "near_miss" | "unknown";
  confidence: "high" | "medium" | "low";
  fields: VoiceReportFields;
  missingFields: string[];
  nextQuestion: string | null;
  reasoning?: string;
  assetSnapshot?: Array<{ id: string; name: string | null; sfiCode?: string | null }>;
}

interface VoiceReportSheetProps {
  /** Cierra sin completar (X o cancel). */
  onClose: () => void;
  /** Reporte completo y validado. Padre decide qué hacer con el prefill. */
  onComplete: (result: { type: "defect" | "near_miss"; fields: VoiceReportFields; reasoning?: string }) => void;
  /** Si está, fuerza el tipo y la IA no clasifica (la UI muestra el tipo elegido). */
  forcedType?: "defect" | "near_miss";
}

type Stage =
  | "recording-initial"
  | "processing"
  | "awaiting-answer"
  | "recording-answer"
  | "error";

export const VoiceReportSheet: React.FC<VoiceReportSheetProps> = ({ onClose, onComplete, forcedType }) => {
  const { selectedVesselCode } = useVesselContext();
  const [stage, setStage]         = useState<Stage>("recording-initial");
  const [transcript, setTranscript] = useState("");
  const [parsed, setParsed]       = useState<VoiceReportOutput | null>(null);
  const [answerText, setAnswerText] = useState("");
  const [error, setError]         = useState<string | null>(null);
  const transcriptRef = useRef("");
  transcriptRef.current = transcript;

  // Hook de Web Speech API
  const { supported, listening, interim, start, stop } = useSpeechToText({
    onTranscript: (chunk) => setTranscript(prev => (prev.trim() ? prev + " " : "") + chunk),
  });

  // Arrancar la grabación automáticamente al montar
  useEffect(() => {
    if (supported && stage === "recording-initial") start();
    return () => stop();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported]);

  // ─── Submit del reporte inicial al backend ─────────────────────────────
  const submitInitial = async () => {
    if (listening) stop();
    const text = transcriptRef.current.trim();
    if (!text) { setError("No se detectó voz. Tocá el micrófono y volvé a intentar."); return; }
    if (!selectedVesselCode) { setError("Seleccioná un buque en el header antes de reportar."); return; }
    setStage("processing");
    setError(null);
    try {
      const r = await api.post<VoiceReportOutput>("/app/pms/defects/voice-report-parse", {
        transcript: text,
        vesselCode: selectedVesselCode,
        forcedType,
      });
      setParsed(r);
      handleParsedResult(r);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Error procesando el reporte.");
      setStage("error");
    }
  };

  // ─── Submit de la respuesta a una pregunta ────────────────────────────
  const submitAnswer = async (answer: string) => {
    const ans = answer.trim();
    if (!ans) return;
    if (listening) stop();
    setStage("processing");
    setError(null);
    try {
      const r = await api.post<VoiceReportOutput>("/app/pms/defects/voice-report-parse", {
        transcript: transcriptRef.current.trim(),
        vesselCode: selectedVesselCode,
        userAnswer: ans,
        previousState: parsed,
        forcedType,
      });
      setParsed(r);
      setAnswerText("");
      handleParsedResult(r);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Error procesando la respuesta.");
      setStage("error");
    }
  };

  function handleParsedResult(r: VoiceReportOutput) {
    if (r.type === "unknown") {
      // Pedir más info
      setStage("awaiting-answer");
      return;
    }
    if (r.nextQuestion) {
      // Hay una pregunta pendiente — esperamos respuesta del usuario
      setStage("awaiting-answer");
      return;
    }
    // Reporte completo: cerrar y devolver al padre
    onComplete({ type: r.type, fields: r.fields, reasoning: r.reasoning });
  }

  // Re-grabar la respuesta usando voz
  const { listening: ansListening, start: ansStart, stop: ansStop } = useSpeechToText({
    onTranscript: (chunk) => setAnswerText(prev => (prev.trim() ? prev + " " : "") + chunk),
  });

  const close = () => { stop(); ansStop(); onClose(); };

  if (!supported) {
    return (
      <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/70 backdrop-blur-sm" onClick={close}>
        <div className="w-full max-w-md bg-[#0D1B2A] border-t border-white/10 rounded-t-3xl p-5 pb-8 space-y-3" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-white">Reporte por voz</h2>
            <button onClick={close}><X className="w-5 h-5 text-text-industrial/40" /></button>
          </div>
          <div className="flex flex-col items-center gap-3 py-6">
            <MicOff className="w-10 h-10 text-text-industrial/40" />
            <p className="text-xs text-text-industrial/60 text-center">Tu navegador no soporta dictado por voz. Usá Chrome o Edge.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/70 backdrop-blur-sm" onClick={close}>
      <div className="w-full max-w-md bg-[#0D1B2A] border-t border-white/10 rounded-t-3xl p-5 pb-8 space-y-4 animate-in slide-in-from-bottom duration-200 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-accent" />
            <div>
              <p className="text-[10px] uppercase tracking-widest text-accent font-bold">
                {forcedType === "defect"    ? "Defecto · por voz"
                 : forcedType === "near_miss" ? "Near miss · por voz"
                 : "Reporte por voz"}
              </p>
              <h2 className="text-sm font-bold text-white">
                {stage === "recording-initial" && "Contame qué pasó"}
                {stage === "processing"        && "Procesando…"}
                {stage === "awaiting-answer"   && (parsed?.nextQuestion ? "Pregunta de la IA" : "Detalles adicionales")}
                {stage === "recording-answer"  && "Respondiendo"}
                {stage === "error"             && "Error"}
              </h2>
            </div>
          </div>
          <button onClick={close} aria-label="Cerrar"><X className="w-5 h-5 text-text-industrial/40 hover:text-white" /></button>
        </div>

        {/* ── ETAPA 1: grabación inicial ─────────────────────────────── */}
        {(stage === "recording-initial" || (stage === "error" && !parsed)) && (
          <>
            <div className="flex flex-col items-center gap-3 py-4">
              <button
                type="button"
                onClick={() => listening ? stop() : start()}
                className={`w-24 h-24 rounded-full flex items-center justify-center shadow-2xl transition-all ${
                  listening
                    ? "bg-red-500 text-white animate-pulse"
                    : "bg-accent text-primary-bg"
                }`}
              >
                {listening ? <Square className="w-10 h-10" /> : <Mic className="w-10 h-10" />}
              </button>
              <p className="text-xs text-text-industrial/60 text-center">
                {listening ? "Hablá ahora. Tocá para detener." : "Tocá el micrófono y describí el defecto o near miss."}
              </p>
            </div>

            {transcript && (
              <div className="rounded-xl bg-white/[0.04] border border-white/10 p-3">
                <p className="text-[10px] uppercase tracking-wider text-text-industrial/40 mb-1">Transcripción</p>
                <p className="text-xs text-white whitespace-pre-wrap">{transcript}
                  {interim && <span className="text-text-industrial/40 italic"> {interim}</span>}
                </p>
              </div>
            )}

            {error && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{error}</p>}

            <div className="flex gap-2">
              <button onClick={close} className="flex-1 px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-xs text-text-industrial">Cancelar</button>
              <button
                onClick={() => { void submitInitial(); }}
                disabled={!transcript.trim() || listening}
                className="flex-1 px-4 py-3 rounded-xl bg-accent text-primary-bg font-bold text-xs flex items-center justify-center gap-1.5 disabled:opacity-40"
              >
                <Send className="w-3.5 h-3.5" /> Procesar con IA
              </button>
            </div>
          </>
        )}

        {/* ── ETAPA 2: procesando ────────────────────────────────────── */}
        {stage === "processing" && (
          <div className="flex flex-col items-center gap-3 py-8">
            <Loader2 className="w-10 h-10 animate-spin text-accent" />
            <p className="text-xs text-text-industrial/60">Analizando con IA…</p>
          </div>
        )}

        {/* ── ETAPA 3: pregunta pendiente ─────────────────────────────── */}
        {(stage === "awaiting-answer" || stage === "recording-answer") && parsed && (
          <>
            {/* Reporte parcial */}
            <div className="rounded-xl bg-accent/[0.06] border border-accent/30 p-3 space-y-1.5">
              <p className="text-[10px] uppercase tracking-wider text-accent font-bold">Detectado hasta ahora</p>
              <div className="flex flex-wrap gap-1.5 text-[10px]">
                <span className="px-2 py-0.5 rounded bg-white/10 text-white font-bold uppercase">{parsed.type === "near_miss" ? "Near miss" : parsed.type === "defect" ? "Defecto" : "?"}</span>
                {parsed.fields.classification && <span className="px-2 py-0.5 rounded bg-white/10 text-white">{parsed.fields.classification}</span>}
                {parsed.fields.severity && <span className="px-2 py-0.5 rounded bg-white/10 text-white">{parsed.fields.severity}</span>}
                {parsed.fields.assetId && parsed.assetSnapshot && (
                  <span className="px-2 py-0.5 rounded bg-white/10 text-white">
                    📍 {parsed.assetSnapshot.find(a => a.id === parsed.fields.assetId)?.name ?? "asset"}
                  </span>
                )}
              </div>
              {parsed.fields.description && (
                <p className="text-xs text-text-industrial/80 italic">"{parsed.fields.description}"</p>
              )}
            </div>

            {/* Pregunta de la IA */}
            {parsed.nextQuestion && (
              <div className="rounded-xl bg-white/[0.04] border border-white/10 p-3">
                <p className="text-[10px] uppercase tracking-wider text-text-industrial/40 mb-1">IA pregunta</p>
                <p className="text-sm text-white">{parsed.nextQuestion}</p>
              </div>
            )}

            {/* Input de respuesta */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input
                  value={answerText}
                  onChange={e => setAnswerText(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") void submitAnswer(answerText); }}
                  placeholder="Respondé acá…"
                  className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-text-industrial/30 focus:outline-none focus:border-accent/50"
                />
                <button
                  type="button"
                  onClick={() => ansListening ? ansStop() : ansStart()}
                  className={`shrink-0 w-12 h-12 rounded-xl flex items-center justify-center ${
                    ansListening ? "bg-red-500/20 text-red-300 border border-red-500/40 animate-pulse" : "bg-white/5 border border-white/10 text-accent"
                  }`}
                >
                  {ansListening ? <Square className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                </button>
              </div>
              {error && <p className="text-xs text-red-400">{error}</p>}
              <div className="flex gap-2">
                <button
                  onClick={() => onComplete({ type: parsed.type === "near_miss" ? "near_miss" : "defect", fields: parsed.fields, reasoning: parsed.reasoning })}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-xs text-text-industrial"
                >
                  Saltar y editar manualmente
                </button>
                <button
                  onClick={() => { void submitAnswer(answerText); }}
                  disabled={!answerText.trim()}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-accent text-primary-bg font-bold text-xs flex items-center justify-center gap-1.5 disabled:opacity-40"
                >
                  <Send className="w-3.5 h-3.5" /> Enviar
                </button>
              </div>
            </div>
          </>
        )}

        {/* ── ETAPA error sin parsed (e.g. backend tiró 503 en el primer call) ─ */}
        {stage === "error" && parsed && (
          <div className="space-y-2">
            <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{error}</p>
            <div className="flex gap-2">
              <button onClick={close} className="flex-1 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-xs text-text-industrial">Cancelar</button>
              <button onClick={() => setStage("awaiting-answer")} className="flex-1 px-4 py-2.5 rounded-xl bg-accent text-primary-bg font-bold text-xs">Reintentar</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
