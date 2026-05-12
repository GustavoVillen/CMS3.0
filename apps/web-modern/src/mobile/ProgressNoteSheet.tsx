import React, { useState, useRef, useCallback, useEffect } from "react";
import { X, Type, Camera, Video as VideoIcon, Mic, Square, Loader2, Trash2 } from "lucide-react";
import { api, ApiError } from "../lib/api";

type Kind = "TEXT" | "PHOTO" | "VIDEO" | "AUDIO";

interface Props {
  workOrderId: string;
  onClose: () => void;
  onSaved: () => void;
}

// Bottom sheet para registrar un avance de trabajo en una OT.
// Permite 4 tipos: texto, foto, video, audio (grabación en navegador).
// Cada tipo opcionalmente acepta un caption descriptivo.
export const ProgressNoteSheet: React.FC<Props> = ({ workOrderId, onClose, onSaved }) => {
  const [kind, setKind]         = useState<Kind>("TEXT");
  const [text, setText]         = useState("");
  const [file, setFile]         = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [saving, setSaving]     = useState(false);
  const [err, setErr]           = useState<string | null>(null);

  // ─── Audio recording state ────────────────────────────────────────────────
  const [recording, setRecording] = useState(false);
  const [audioElapsed, setAudioElapsed] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // SpeechRecognition: transcribe audio en el navegador. Cuando termina la
  // grabación, el transcript se envía como `text` junto con el archivo,
  // y el backend lo usa directamente como processedText (sin OCR/AI extra).
  const speechRecognitionRef = useRef<any>(null);
  const transcriptRef = useRef<string>("");
  // Estado visual del SR: si el browser lo soporta, si está activo, y el
  // transcript que se va viendo en vivo (final + interim).
  const SR_AVAILABLE = typeof window !== "undefined" &&
    (!!(window as any).SpeechRecognition || !!(window as any).webkitSpeechRecognition);
  const [srStatus, setSrStatus] = useState<"idle" | "active" | "error" | "unavailable">(
    SR_AVAILABLE ? "idle" : "unavailable"
  );
  const [liveTranscript, setLiveTranscript] = useState("");

  // Limpiar URL de preview al desmontar
  useEffect(() => {
    return () => {
      if (filePreview) URL.revokeObjectURL(filePreview);
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
      // Si la grabación quedó activa al cerrar, parar el stream
      const mr = mediaRecorderRef.current;
      if (mr && mr.state !== "inactive") {
        try { mr.stop(); } catch { /* noop */ }
        mr.stream.getTracks().forEach(t => t.stop());
      }
      if (speechRecognitionRef.current) {
        try { speechRecognitionRef.current.stop(); } catch { /* noop */ }
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetMedia = () => {
    setFile(null);
    if (filePreview) URL.revokeObjectURL(filePreview);
    setFilePreview(null);
    setAudioElapsed(0);
  };

  const switchKind = (k: Kind) => {
    setKind(k);
    resetMedia();
    setErr(null);
  };

  const onFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    if (!f) return;
    setFile(f);
    if (filePreview) URL.revokeObjectURL(filePreview);
    setFilePreview(URL.createObjectURL(f));
  };

  // ─── Audio recording handlers ─────────────────────────────────────────────
  // Estrategia: grabar audio con MediaRecorder Y en paralelo correr Web Speech
  // Recognition. El transcript final se almacena en transcriptRef y se manda
  // como `text` junto con el blob. El usuario VE el transcript en vivo (final
  // + interim) durante la grabación; tras detenerla, puede editarlo en el
  // textarea antes de guardar.
  //
  // Si SR no está disponible (Firefox, iOS Safari pre-14.5), el audio igual
  // se sube — el supervisor puede escucharlo. Mensaje visual claro al usuario.
  const startRecording = useCallback(async () => {
    setErr(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setErr("Tu navegador no soporta grabación de audio.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      audioChunksRef.current = [];
      transcriptRef.current = "";
      setLiveTranscript("");

      mr.ondataavailable = (ev) => {
        if (ev.data.size > 0) audioChunksRef.current.push(ev.data);
      };
      mr.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: mr.mimeType || "audio/webm" });
        const audioFile = new File([blob], `nota-${Date.now()}.webm`, { type: blob.type });
        setFile(audioFile);
        if (filePreview) URL.revokeObjectURL(filePreview);
        setFilePreview(URL.createObjectURL(blob));
        // Si Speech Recognition produjo transcript, lo seteamos como caption
        // editable. Si el usuario ya tipeó algo, no lo sobreescribimos.
        const tx = transcriptRef.current.trim();
        if (tx && !text.trim()) setText(tx);
        // Liberar el micrófono
        stream.getTracks().forEach(t => t.stop());
      };
      mr.start();

      // Arrancar Speech Recognition en paralelo
      const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SR) {
        try {
          const recog = new SR();
          recog.continuous = true;
          recog.interimResults = true;
          recog.lang = "es-AR";
          recog.onresult = (ev: any) => {
            let finalAccum = transcriptRef.current;
            let interimText = "";
            for (let i = ev.resultIndex; i < ev.results.length; i++) {
              const transcript = ev.results[i][0].transcript;
              if (ev.results[i].isFinal) {
                finalAccum = (finalAccum + " " + transcript).trim();
              } else {
                interimText += transcript;
              }
            }
            transcriptRef.current = finalAccum;
            // El usuario ve final + interim (con interim en gris semi-transparente)
            setLiveTranscript(finalAccum + (interimText ? ` ${interimText}` : ""));
            setSrStatus("active");
          };
          recog.onerror = (ev: any) => {
            // Errores comunes: 'no-speech', 'audio-capture', 'not-allowed', 'network'
            // 'no-speech' es esperable si el usuario está en silencio
            if (ev?.error && ev.error !== "no-speech") {
              setSrStatus("error");
            }
          };
          recog.onend = () => {
            // Si el usuario sigue grabando pero SR terminó (típico cada 60s en
            // Android), reintentar automáticamente.
            if (mediaRecorderRef.current?.state === "recording") {
              try { recog.start(); } catch { /* ya está corriendo */ }
            }
          };
          recog.start();
          speechRecognitionRef.current = recog;
          setSrStatus("active");
        } catch (e) {
          setSrStatus("error");
          // SR rechazó el start — el audio se sube igual, sin transcript
        }
      }

      setRecording(true);
      setAudioElapsed(0);
      elapsedTimerRef.current = setInterval(() => {
        setAudioElapsed(e => e + 1);
      }, 1000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "No se pudo acceder al micrófono.";
      setErr(`Permiso de micrófono denegado: ${msg}`);
    }
  }, [filePreview, text]);

  const stopRecording = useCallback(() => {
    const mr = mediaRecorderRef.current;
    if (mr && mr.state !== "inactive") mr.stop();
    const sr = speechRecognitionRef.current;
    if (sr) {
      try { sr.stop(); } catch { /* noop */ }
      speechRecognitionRef.current = null;
    }
    setRecording(false);
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    elapsedTimerRef.current = null;
  }, []);

  // ─── Save ─────────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    setErr(null);
    if (kind === "TEXT") {
      if (!text.trim()) { setErr("Escribí el texto del avance."); return; }
    } else {
      if (!file) { setErr("Capturá o seleccioná un archivo."); return; }
    }

    setSaving(true);
    try {
      if (kind === "TEXT") {
        await api.post(`/app/pms/work-orders/${workOrderId}/progress-notes?kind=TEXT`, { text: text.trim() });
      } else {
        // Binary body + headers para nombre, mime y caption opcional
        const headers: Record<string, string> = {
          "x-filename":  encodeURIComponent(file!.name),
          "x-mime-type": file!.type || "application/octet-stream",
        };
        if (text.trim()) headers["x-caption"] = encodeURIComponent(text.trim());
        await api.uploadRaw(`/app/pms/work-orders/${workOrderId}/progress-notes?kind=${kind}`, file!, headers);
      }
      onSaved();
      onClose();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Error al guardar la nota.");
    } finally {
      setSaving(false);
    }
  }, [kind, text, file, workOrderId, onSaved, onClose]);

  const minSec = (s: number) => {
    const m = Math.floor(s / 60); const r = s % 60;
    return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end justify-center" onClick={onClose}>
      <div
        className="w-full max-w-md bg-[#0D1B2A] border-t border-white/10 rounded-t-2xl flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle */}
        <div className="flex justify-center pt-2">
          <div className="w-10 h-1 rounded-full bg-white/20" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <span className="text-sm font-bold text-white">Registrar avance</span>
          <button type="button" onClick={onClose} className="p-1.5 text-text-industrial/40 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tipo de avance */}
        <div className="grid grid-cols-4 gap-1.5 p-3 border-b border-white/10">
          {([
            { id: "TEXT" as Kind,  label: "Texto", Icon: Type },
            { id: "PHOTO" as Kind, label: "Foto",  Icon: Camera },
            { id: "VIDEO" as Kind, label: "Video", Icon: VideoIcon },
            { id: "AUDIO" as Kind, label: "Audio", Icon: Mic },
          ]).map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => switchKind(id)}
              className={`flex flex-col items-center gap-1 py-2.5 rounded-lg border transition-colors ${
                kind === id
                  ? "bg-accent/15 border-accent/40 text-accent"
                  : "bg-white/5 border-white/10 text-text-industrial/60"
              }`}
            >
              <Icon className="w-4 h-4" />
              <span className="text-[10px] font-bold uppercase tracking-wider">{label}</span>
            </button>
          ))}
        </div>

        {/* Body — cambia por kind */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {kind === "TEXT" && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-bold uppercase tracking-wider text-text-industrial/40">Descripción del avance</p>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={6}
                placeholder="¿Qué hiciste? ¿Qué notaste?"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 resize-none"
              />
            </div>
          )}

          {kind === "PHOTO" && (
            <>
              {filePreview ? (
                <div className="relative">
                  <img src={filePreview} alt="Foto" className="w-full rounded-xl border border-white/10 object-cover max-h-80" />
                  <button type="button" onClick={resetMedia} className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 hover:bg-black/80 text-white">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center gap-2 py-8 rounded-xl border border-dashed border-white/15 bg-white/5 text-text-industrial/60 cursor-pointer hover:bg-white/10 active:bg-white/15">
                  <Camera className="w-6 h-6" />
                  <span className="text-xs font-bold uppercase tracking-wider">Tomar foto</span>
                  <input type="file" accept="image/*" capture="environment" className="hidden" onChange={onFileSelect} />
                </label>
              )}
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={2}
                placeholder="Descripción opcional"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 resize-none"
              />
            </>
          )}

          {kind === "VIDEO" && (
            <>
              {filePreview ? (
                <div className="relative">
                  <video src={filePreview} controls className="w-full rounded-xl border border-white/10 max-h-80" />
                  <button type="button" onClick={resetMedia} className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 hover:bg-black/80 text-white">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center gap-2 py-8 rounded-xl border border-dashed border-white/15 bg-white/5 text-text-industrial/60 cursor-pointer hover:bg-white/10 active:bg-white/15">
                  <VideoIcon className="w-6 h-6" />
                  <span className="text-xs font-bold uppercase tracking-wider">Grabar video</span>
                  <input type="file" accept="video/*" capture="environment" className="hidden" onChange={onFileSelect} />
                </label>
              )}
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={2}
                placeholder="Descripción opcional"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 resize-none"
              />
            </>
          )}

          {kind === "AUDIO" && (
            <>
              {filePreview ? (
                <div className="space-y-2">
                  <audio src={filePreview} controls className="w-full" />
                  <button
                    type="button"
                    onClick={() => { resetMedia(); setLiveTranscript(""); }}
                    className="w-full py-2 text-xs text-text-industrial/60 hover:text-white flex items-center justify-center gap-1.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Descartar y grabar de nuevo
                  </button>
                </div>
              ) : recording ? (
                <div className="flex flex-col items-center justify-center gap-3 py-6 rounded-xl border border-red-500/30 bg-red-500/5">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
                    <p className="text-sm font-bold text-white tabular-nums">{minSec(audioElapsed)}</p>
                  </div>
                  {/* Indicador de estado de la transcripción */}
                  <div className="text-[10px] text-text-industrial/60 flex items-center gap-1.5">
                    {srStatus === "active" && <span className="text-success-sea">● Transcribiendo en vivo</span>}
                    {srStatus === "error" && <span className="text-orange-400">⚠ Transcripción falló — el audio se guarda igual</span>}
                    {srStatus === "unavailable" && <span className="text-text-industrial/40">Transcripción no soportada por el navegador</span>}
                    {srStatus === "idle" && <span>Iniciando transcripción...</span>}
                  </div>
                  {/* Transcripción en vivo (final + interim) */}
                  {liveTranscript && (
                    <div className="w-full max-h-32 overflow-y-auto bg-black/20 rounded-lg px-3 py-2 text-xs text-white/85 leading-relaxed">
                      {liveTranscript}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={stopRecording}
                    className="px-4 py-2 rounded-lg bg-white/10 border border-white/20 text-white text-xs font-bold flex items-center gap-1.5"
                  >
                    <Square className="w-3.5 h-3.5" />
                    Detener
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={startRecording}
                  className="w-full flex flex-col items-center justify-center gap-2 py-8 rounded-xl border border-dashed border-white/15 bg-white/5 text-text-industrial/60 hover:bg-white/10 active:bg-white/15"
                >
                  <Mic className="w-6 h-6" />
                  <span className="text-xs font-bold uppercase tracking-wider">Tocá para grabar</span>
                  {srStatus === "unavailable" && (
                    <span className="text-[10px] text-text-industrial/40 normal-case font-normal mt-1 text-center px-4">
                      Tu navegador no soporta transcripción automática.<br />Tras grabar, tipeá la descripción manualmente.
                    </span>
                  )}
                </button>
              )}
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={3}
                placeholder={filePreview ? "Transcripción editable" : "Descripción opcional"}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 resize-none"
              />
              {filePreview && !text.trim() && (
                <p className="text-[10px] text-orange-400/80">
                  ⚠ Sin texto, la nota se guarda pero no contribuye a las Observaciones.
                </p>
              )}
            </>
          )}

          {err && <p className="text-xs text-red-400">{err}</p>}
        </div>

        {/* Footer */}
        <div className="border-t border-white/10 p-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || recording}
            className="w-full py-3 rounded-xl bg-accent text-white text-sm font-bold disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Guardar avance"}
          </button>
        </div>
      </div>
    </div>
  );
};
