// Botón micrófono reusable. Asume que el padre maneja el state del textarea
// y le pasa el setter; el componente solo gestiona el flow de dictado.

import React from "react";
import { Mic, MicOff, Loader2 } from "lucide-react";
import { useSpeechToText } from "../lib/use-speech-to-text";

interface MicButtonProps {
  /** Setter del state del textarea. Recibe el texto nuevo y debe append/replace. */
  onAppend: (chunk: string) => void;
  /** Idioma BCP-47. Default: navigator.language. */
  lang?: string;
  /** Tamaño del icono. Default w-3.5 h-3.5. */
  className?: string;
  /** Tooltip personalizado cuando el browser no soporta. */
  unsupportedTitle?: string;
}

/**
 * Renderiza un mic toggle. Mientras escucha, muestra animación + interim
 * (resultados parciales) en el title. Si el browser no soporta Web Speech,
 * el botón aparece deshabilitado con tooltip explicativo.
 */
export const MicButton: React.FC<MicButtonProps> = ({ onAppend, lang, className, unsupportedTitle }) => {
  const { supported, listening, interim, toggle } = useSpeechToText({
    onTranscript: (text) => onAppend(text),
    lang,
  });

  if (!supported) {
    return (
      <button
        type="button"
        disabled
        title={unsupportedTitle ?? "Tu navegador no soporta dictado por voz. Usá Chrome o Edge."}
        className="p-1.5 rounded-md text-text-industrial/30 cursor-not-allowed"
      >
        <MicOff className={className ?? "w-3.5 h-3.5"} />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      title={listening ? (interim ? `Escuchando: "${interim}"` : "Tocá para detener") : "Dictar por voz"}
      className={`p-1.5 rounded-md transition-colors ${
        listening
          ? "bg-red-500/20 text-red-300 border border-red-500/40 animate-pulse"
          : "text-text-industrial/50 hover:text-accent hover:bg-fg/5 border border-transparent"
      }`}
    >
      {listening ? <Loader2 className={`${className ?? "w-3.5 h-3.5"} animate-spin`} /> : <Mic className={className ?? "w-3.5 h-3.5"} />}
    </button>
  );
};
