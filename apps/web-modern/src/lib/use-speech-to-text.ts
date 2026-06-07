// useSpeechToText — hook que envuelve la Web Speech API (SpeechRecognition).
// Devuelve helpers para usar dictado por voz en cualquier <textarea>:
//
//   const { supported, listening, interim, start, stop, toggle } = useSpeechToText({
//     onTranscript: (sessionText) => setDescription(prev => prev + " " + sessionText),
//   });
//
// Comportamiento:
//   - Continuous: la API sigue escuchando hasta que se llame stop()
//   - Interim: `interim` contiene el texto EN VIVO de la sesión (finales + parcial)
//     para preview. No produce duplicados.
//   - onTranscript se invoca UNA sola vez por sesión, al detener (stop/onend),
//     con el texto final COMPLETO de la sesión. stop() además lo devuelve
//     sincrónicamente para quien necesite leerlo en el acto.
//   - Locale auto-detectado desde navigator.language (default es-AR)
//   - supported = false si el browser no implementa la API (Firefox, Safari iOS)
//
// Por qué por índice: en Android Chrome el modo continuous reemite resultados
// "final" como prefijos crecientes ("detecté" → "detecté que" → ...). Si se
// despacha cada uno y el padre concatena, se arma una cascada repetida. Acá
// guardamos el último valor final POR ÍNDICE de resultado (reemplazo) y recién
// al cerrar la sesión emitimos el texto completo una vez.

import { useCallback, useEffect, useRef, useState } from "react";

interface UseSpeechToTextOptions {
  /** Callback con el texto FINAL completo de la sesión (una vez, al detener). */
  onTranscript: (sessionText: string) => void;
  /** Idioma BCP-47. Default: navigator.language o "es-AR". */
  lang?: string;
}

const collapseSpaces = (s: string) => s.replace(/\s+/g, " ").trim();

export function useSpeechToText({ onTranscript, lang }: UseSpeechToTextOptions) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim]     = useState("");
  const recRef                    = useRef<unknown>(null);

  // Finales por índice de resultado (reemplazo, no acumulación) + parcial actual.
  const finalsRef   = useRef<string[]>([]);
  const interimRef  = useRef("");
  const flushedRef  = useRef(false);
  // Ref al callback para no recrear start/stop en cada render del padre.
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  // Capability detection — corre solo en cliente
  const supported = typeof window !== "undefined" && (
    !!(window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition ||
    !!(window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition
  );

  const sessionFinal = () => collapseSpaces(finalsRef.current.filter(Boolean).join(" "));

  // Emite el texto final de la sesión una sola vez. Devuelve el texto emitido.
  const flush = useCallback((): string => {
    const text = collapseSpaces([sessionFinal(), interimRef.current].filter(Boolean).join(" "));
    if (flushedRef.current) return text;
    flushedRef.current = true;
    if (text) onTranscriptRef.current(text);
    return text;
  }, []);

  const stop = useCallback((): string => {
    const text = flush();
    const rec = recRef.current as { stop?: () => void } | null;
    if (rec?.stop) {
      try { rec.stop(); } catch { /* noop */ }
    }
    setListening(false);
    setInterim("");
    return text;
  }, [flush]);

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

    // Reset del estado de la sesión.
    finalsRef.current  = [];
    interimRef.current = "";
    flushedRef.current = false;

    rec.onresult = (ev) => {
      // Guardar/actualizar el último valor FINAL por índice (reemplazo).
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const result = ev.results[i];
        if (result.isFinal) finalsRef.current[i] = result[0].transcript.trim();
      }
      // Reconstruir el parcial (lo no-final) recorriendo todos los resultados.
      let interimText = "";
      for (let i = 0; i < ev.results.length; i++) {
        if (!ev.results[i].isFinal) interimText += ev.results[i][0].transcript;
      }
      interimRef.current = collapseSpaces(interimText);
      // Preview en vivo: finales + parcial (sin cascada porque finales se reemplazan).
      setInterim(collapseSpaces([sessionFinal(), interimRef.current].filter(Boolean).join(" ")));
    };

    rec.onend = () => {
      // Fin natural (timeout / auto-stop de Android): emitir lo capturado.
      flush();
      setListening(false);
      setInterim("");
    };

    rec.onerror = (e) => {
      // Permission denied, no-speech, network: stop silencioso.
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
  }, [supported, listening, lang, flush]);

  const toggle = useCallback(() => {
    if (listening) stop();
    else start();
  }, [listening, start, stop]);

  // Limpieza al desmontar el componente
  useEffect(() => () => { stop(); }, [stop]);

  return { supported, listening, interim, start, stop, toggle };
}
