// useSpeechToText — hook que envuelve la Web Speech API (SpeechRecognition).
// Devuelve helpers para usar dictado por voz en cualquier <textarea>:
//
//   const { supported, listening, start, stop, toggle } = useSpeechToText({
//     onTranscript: (text) => setDescription(prev => prev + " " + text),
//   });
//
// Comportamiento:
//   - Continuous: la API sigue escuchando hasta que se llame stop()
//   - Interim: los resultados intermedios se ven en `interim` para preview
//   - Cuando un resultado se marca como final, se invoca onTranscript()
//   - Locale auto-detectado desde navigator.language (default es-AR)
//   - supported = false si el browser no implementa la API (Firefox, Safari iOS)

import { useCallback, useEffect, useRef, useState } from "react";

interface UseSpeechToTextOptions {
  /** Callback que recibe cada chunk de texto FINAL (no interim). */
  onTranscript: (text: string) => void;
  /** Idioma BCP-47. Default: navigator.language o "es-AR". */
  lang?: string;
}

export function useSpeechToText({ onTranscript, lang }: UseSpeechToTextOptions) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim]     = useState("");
  const recRef                    = useRef<unknown>(null);

  // Capability detection — corre solo en cliente
  const supported = typeof window !== "undefined" && (
    !!(window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition ||
    !!(window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition
  );

  const stop = useCallback(() => {
    const rec = recRef.current as { stop?: () => void; abort?: () => void } | null;
    if (rec?.stop) {
      try { rec.stop(); } catch { /* noop */ }
    }
    setListening(false);
    setInterim("");
  }, []);

  const start = useCallback(() => {
    if (!supported || listening) return;
    const w = window as unknown as {
      SpeechRecognition?: new () => unknown;
      webkitSpeechRecognition?: new () => unknown;
    };
    const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR() as {
      continuous: boolean;
      interimResults: boolean;
      lang: string;
      start: () => void;
      stop: () => void;
      onresult: ((e: { resultIndex: number; results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean; length: number }> }) => void) | null;
      onend: (() => void) | null;
      onerror: ((e: unknown) => void) | null;
    };
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = lang ?? (navigator.language || "es-AR");

    rec.onresult = (ev) => {
      let interimText = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const result = ev.results[i];
        const text = result[0].transcript;
        if (result.isFinal) {
          // Despachar el chunk final al consumidor (lo agrega al state padre).
          if (text.trim()) onTranscript(text.trim());
        } else {
          interimText += text;
        }
      }
      setInterim(interimText);
    };

    rec.onend = () => {
      setListening(false);
      setInterim("");
    };

    rec.onerror = (e) => {
      // Permission denied, no-speech, network: stop silencioso.
      // Logueamos a consola para debugging pero no rompemos el flujo.
      // eslint-disable-next-line no-console
      console.warn("[SpeechRecognition] error", e);
      setListening(false);
      setInterim("");
    };

    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch (err) {
      // Si ya está corriendo, la API tira "InvalidStateError".
      // eslint-disable-next-line no-console
      console.warn("[SpeechRecognition] start failed", err);
      setListening(false);
    }
  }, [supported, listening, lang, onTranscript]);

  const toggle = useCallback(() => {
    if (listening) stop();
    else start();
  }, [listening, start, stop]);

  // Limpieza al desmontar el componente
  useEffect(() => () => stop(), [stop]);

  return { supported, listening, interim, start, stop, toggle };
}
