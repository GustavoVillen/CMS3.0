import React, { useState, useRef, useCallback, useEffect } from "react";
import { X, Type, Camera, Video as VideoIcon, Mic, Square, Loader2, Trash2, FileText } from "lucide-react";
import { api, ApiError } from "../lib/api";

type Kind = "TEXT" | "PHOTO" | "VIDEO" | "AUDIO" | "DOCUMENT";

interface Props {
  workOrderId: string;
  onClose: () => void;
  onSaved: () => void;
}

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

// Devuelve el momento actual en formato `YYYY-MM-DDThh:mm` (hora local) para
// un <input type="datetime-local">.
function nowLocalInput(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

// Bottom sheet para registrar un avance de trabajo en una OT.
// Permite 4 tipos: texto, foto (comprimida), video (getUserMedia baja res), audio.
export const ProgressNoteSheet: React.FC<Props> = ({ workOrderId, onClose, onSaved }) => {
  const [kind, setKind]         = useState<Kind>("TEXT");
  const [when, setWhen]         = useState<string>(nowLocalInput());
  const [text, setText]         = useState("");
  const [file, setFile]         = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [compressing, setCompressing] = useState(false);
  const [saving, setSaving]     = useState(false);
  const [err, setErr]           = useState<string | null>(null);

  // ─── Audio recording state ────────────────────────────────────────────────
  const [recording, setRecording] = useState(false);
  const [audioElapsed, setAudioElapsed] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const speechRecognitionRef = useRef<any>(null);
  const transcriptRef = useRef<string>("");
  const SR_AVAILABLE = typeof window !== "undefined" &&
    (!!(window as any).SpeechRecognition || !!(window as any).webkitSpeechRecognition);
  const [srStatus, setSrStatus] = useState<"idle" | "active" | "error" | "unavailable">(
    SR_AVAILABLE ? "idle" : "unavailable"
  );
  const [liveTranscript, setLiveTranscript] = useState("");

  // ─── Video recording state ────────────────────────────────────────────────
  const [videoRecording, setVideoRecording] = useState(false);
  const [videoElapsed, setVideoElapsed] = useState(0);
  const videoRecorderRef = useRef<MediaRecorder | null>(null);
  const videoChunksRef = useRef<Blob[]>([]);
  const videoElapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);

  // Limpiar URLs y streams al desmontar
  useEffect(() => {
    return () => {
      if (filePreview) URL.revokeObjectURL(filePreview);
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
      if (videoElapsedRef.current) clearInterval(videoElapsedRef.current);
      const mr = mediaRecorderRef.current;
      if (mr && mr.state !== "inactive") {
        try { mr.stop(); } catch { /* noop */ }
        mr.stream.getTracks().forEach(t => t.stop());
      }
      const vr = videoRecorderRef.current;
      if (vr && vr.state !== "inactive") {
        try { vr.stop(); } catch { /* noop */ }
        vr.stream.getTracks().forEach(t => t.stop());
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
    setVideoElapsed(0);
    // Parar grabación de video si estaba activa
    const vr = videoRecorderRef.current;
    if (vr && vr.state !== "inactive") {
      try { vr.stop(); } catch { /* noop */ }
      vr.stream.getTracks().forEach(t => t.stop());
    }
    setVideoRecording(false);
    if (videoElapsedRef.current) { clearInterval(videoElapsedRef.current); videoElapsedRef.current = null; }
  };

  const switchKind = (k: Kind) => {
    setKind(k);
    resetMedia();
    setErr(null);
  };

  // ─── Foto: selección + compresión ────────────────────────────────────────
  const onFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    if (!f) return;
    setCompressing(true);
    setErr(null);
    try {
      const compressed = await compressImage(f);
      setFile(compressed);
      if (filePreview) URL.revokeObjectURL(filePreview);
      setFilePreview(URL.createObjectURL(compressed));
    } catch {
      setFile(f);
      if (filePreview) URL.revokeObjectURL(filePreview);
      setFilePreview(URL.createObjectURL(f));
    } finally {
      setCompressing(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePreview]);

  // ─── Documento (PDF/imagen/gráfico): sin compresión, archivo original ─────
  const onDocSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    if (!f) return;
    setErr(null);
    setFile(f);
    if (filePreview) URL.revokeObjectURL(filePreview);
    setFilePreview(null);
  }, [filePreview]);

  // ─── Video: grabación con getUserMedia a baja resolución ─────────────────
  const startVideoRecording = useCallback(async () => {
    setErr(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setErr("Tu navegador no soporta grabación de video.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { max: 640 }, height: { max: 480 }, frameRate: { max: 15 } },
        audio: true,
      });

      // Preview en vivo mientras graba
      if (videoPreviewRef.current) {
        videoPreviewRef.current.srcObject = stream;
        videoPreviewRef.current.play().catch(() => {/* noop */});
      }

      const options: MediaRecorderOptions = {};
      if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported("video/webm;codecs=vp8")) {
        options.mimeType = "video/webm;codecs=vp8";
        options.videoBitsPerSecond = 500_000;
      } else if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported("video/webm")) {
        options.mimeType = "video/webm";
        options.videoBitsPerSecond = 500_000;
      }

      const mr = new MediaRecorder(stream, options);
      videoRecorderRef.current = mr;
      videoChunksRef.current = [];

      mr.ondataavailable = ev => { if (ev.data.size > 0) videoChunksRef.current.push(ev.data); };
      mr.onstop = () => {
        if (videoPreviewRef.current) videoPreviewRef.current.srcObject = null;
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(videoChunksRef.current, { type: mr.mimeType || "video/webm" });
        const ext = blob.type.includes("mp4") ? "mp4" : "webm";
        const videoFile = new File([blob], `video-${Date.now()}.${ext}`, { type: blob.type });
        setFile(videoFile);
        if (filePreview) URL.revokeObjectURL(filePreview);
        setFilePreview(URL.createObjectURL(blob));
      };

      mr.start();
      setVideoRecording(true);
      setVideoElapsed(0);
      videoElapsedRef.current = setInterval(() => setVideoElapsed(e => e + 1), 1000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "No se pudo acceder a la cámara.";
      setErr(`Permiso de cámara denegado: ${msg}`);
    }
  }, [filePreview]);

  const stopVideoRecording = useCallback(() => {
    const mr = videoRecorderRef.current;
    if (mr && mr.state !== "inactive") mr.stop();
    setVideoRecording(false);
    if (videoElapsedRef.current) { clearInterval(videoElapsedRef.current); videoElapsedRef.current = null; }
  }, []);

  // ─── Audio recording handlers ─────────────────────────────────────────────
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
        const tx = transcriptRef.current.trim();
        if (tx && !text.trim()) setText(tx);
        stream.getTracks().forEach(t => t.stop());
      };
      mr.start();

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
            setLiveTranscript(finalAccum + (interimText ? ` ${interimText}` : ""));
            setSrStatus("active");
          };
          recog.onerror = (ev: any) => {
            if (ev?.error && ev.error !== "no-speech") setSrStatus("error");
          };
          recog.onend = () => {
            if (mediaRecorderRef.current?.state === "recording") {
              try { recog.start(); } catch { /* ya está corriendo */ }
            }
          };
          recog.start();
          speechRecognitionRef.current = recog;
          setSrStatus("active");
        } catch {
          setSrStatus("error");
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

    const occurredAt = when ? new Date(when).toISOString() : undefined;

    setSaving(true);
    try {
      if (kind === "TEXT") {
        await api.post(`/app/pms/work-orders/${workOrderId}/progress-notes?kind=TEXT`, { text: text.trim(), occurredAt });
      } else {
        const headers: Record<string, string> = {
          "x-filename":  encodeURIComponent(file!.name),
          "x-mime-type": file!.type || "application/octet-stream",
        };
        if (text.trim()) headers["x-caption"] = encodeURIComponent(text.trim());
        if (occurredAt) headers["x-occurred-at"] = occurredAt;
        await api.uploadRaw(`/app/pms/work-orders/${workOrderId}/progress-notes?kind=${kind}`, file!, headers);
      }
      onSaved();
      onClose();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Error al guardar la nota.");
    } finally {
      setSaving(false);
    }
  }, [kind, text, file, when, workOrderId, onSaved, onClose]);

  const minSec = (s: number) => {
    const m = Math.floor(s / 60); const r = s % 60;
    return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end justify-center" onClick={onClose}>
      <div
        className="w-full max-w-md bg-surface dark:bg-[#0D1B2A] border-t border-fg/10 rounded-t-2xl flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle */}
        <div className="flex justify-center pt-2">
          <div className="w-10 h-1 rounded-full bg-fg/20" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-fg/10">
          <span className="text-sm font-bold text-fg">Registrar avance</span>
          <button type="button" onClick={onClose} className="p-1.5 text-text-industrial/40 hover:text-fg">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tipo de avance */}
        <div className="grid grid-cols-5 gap-1.5 p-3 border-b border-fg/10">
          {([
            { id: "TEXT" as Kind,     label: "Texto", Icon: Type },
            { id: "PHOTO" as Kind,    label: "Foto",  Icon: Camera },
            { id: "VIDEO" as Kind,    label: "Video", Icon: VideoIcon },
            { id: "AUDIO" as Kind,    label: "Audio", Icon: Mic },
            { id: "DOCUMENT" as Kind, label: "Doc",   Icon: FileText },
          ]).map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => switchKind(id)}
              className={`flex flex-col items-center gap-1 py-2.5 rounded-lg border transition-colors ${
                kind === id
                  ? "bg-accent/15 border-accent/40 text-accent"
                  : "bg-fg/5 border-fg/10 text-text-industrial/60"
              }`}
            >
              <Icon className="w-4 h-4" />
              <span className="text-[10px] font-bold uppercase tracking-wider">{label}</span>
            </button>
          ))}
        </div>

        {/* Fecha y hora del avance (editable; default = ahora) */}
        <div className="px-4 py-2.5 border-b border-fg/10 space-y-1.5">
          <label className="text-[10px] font-bold uppercase tracking-wider text-text-industrial/40">Fecha y hora del avance</label>
          <input
            type="datetime-local"
            value={when}
            max={nowLocalInput()}
            onChange={(e) => setWhen(e.target.value)}
            className="w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg focus:outline-none focus:border-accent/50"
          />
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">

          {/* ── TEXTO ── */}
          {kind === "TEXT" && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-bold uppercase tracking-wider text-text-industrial/40">Descripción del avance</p>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={6}
                placeholder="¿Qué hiciste? ¿Qué notaste?"
                className="w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2.5 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 resize-none"
              />
            </div>
          )}

          {/* ── FOTO ── */}
          {kind === "PHOTO" && (
            <>
              {compressing ? (
                <div className="flex flex-col items-center justify-center gap-2 py-8 text-text-industrial/60">
                  <Loader2 className="w-6 h-6 animate-spin text-accent" />
                  <span className="text-xs">Comprimiendo imagen...</span>
                </div>
              ) : filePreview ? (
                <div className="relative">
                  <img src={filePreview} alt="Foto" className="w-full rounded-xl border border-fg/10 object-cover max-h-80" />
                  <button type="button" onClick={resetMedia} className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 hover:bg-black/80 text-fg">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center gap-2 py-8 rounded-xl border border-dashed border-fg/15 bg-fg/5 text-text-industrial/60 cursor-pointer hover:bg-fg/10 active:bg-fg/15">
                  <Camera className="w-6 h-6" />
                  <span className="text-xs font-bold uppercase tracking-wider">Tomar foto</span>
                  <span className="text-[10px] text-text-industrial/40 normal-case font-normal">Se comprime automáticamente</span>
                  <input type="file" accept="image/*" capture="environment" className="hidden" onChange={onFileSelect} />
                </label>
              )}
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={2}
                placeholder="Descripción opcional"
                className="w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2.5 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 resize-none"
              />
            </>
          )}

          {/* ── VIDEO ── */}
          {kind === "VIDEO" && (
            <>
              {filePreview ? (
                <div className="relative">
                  <video src={filePreview} controls className="w-full rounded-xl border border-fg/10 max-h-80" />
                  <button type="button" onClick={() => { resetMedia(); }} className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 hover:bg-black/80 text-fg">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ) : videoRecording ? (
                <div className="flex flex-col items-center gap-3">
                  {/* Preview en vivo */}
                  <video
                    ref={videoPreviewRef}
                    muted
                    playsInline
                    className="w-full rounded-xl border border-red-500/30 max-h-64 object-cover bg-black"
                  />
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
                    <p className="text-sm font-bold text-fg tabular-nums">{minSec(videoElapsed)}</p>
                    <span className="text-[10px] text-text-industrial/50">640×480 · 15fps · 500 kbps</span>
                  </div>
                  <button
                    type="button"
                    onClick={stopVideoRecording}
                    className="px-4 py-2 rounded-lg bg-fg/10 border border-fg/20 text-fg text-xs font-bold flex items-center gap-1.5"
                  >
                    <Square className="w-3.5 h-3.5" />
                    Detener
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => { void startVideoRecording(); }}
                  className="w-full flex flex-col items-center justify-center gap-2 py-8 rounded-xl border border-dashed border-fg/15 bg-fg/5 text-text-industrial/60 hover:bg-fg/10 active:bg-fg/15"
                >
                  <VideoIcon className="w-6 h-6" />
                  <span className="text-xs font-bold uppercase tracking-wider">Grabar video</span>
                  <span className="text-[10px] text-text-industrial/40 normal-case font-normal">Baja resolución (640×480, 500 kbps)</span>
                </button>
              )}
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={2}
                placeholder="Descripción opcional"
                className="w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2.5 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 resize-none"
              />
            </>
          )}

          {/* ── AUDIO ── */}
          {kind === "AUDIO" && (
            <>
              {filePreview ? (
                <div className="space-y-2">
                  <audio src={filePreview} controls className="w-full" />
                  <button
                    type="button"
                    onClick={() => { resetMedia(); setLiveTranscript(""); }}
                    className="w-full py-2 text-xs text-text-industrial/60 hover:text-fg flex items-center justify-center gap-1.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Descartar y grabar de nuevo
                  </button>
                </div>
              ) : recording ? (
                <div className="flex flex-col items-center justify-center gap-3 py-6 rounded-xl border border-red-500/30 bg-red-500/5">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
                    <p className="text-sm font-bold text-fg tabular-nums">{minSec(audioElapsed)}</p>
                  </div>
                  <div className="text-[10px] text-text-industrial/60 flex items-center gap-1.5">
                    {srStatus === "active" && <span className="text-success-sea">● Transcribiendo en vivo</span>}
                    {srStatus === "error" && <span className="text-orange-700 dark:text-orange-400">⚠ Transcripción falló — el audio se guarda igual</span>}
                    {srStatus === "unavailable" && <span className="text-text-industrial/40">Transcripción no soportada por el navegador</span>}
                    {srStatus === "idle" && <span>Iniciando transcripción...</span>}
                  </div>
                  {liveTranscript && (
                    <div className="w-full max-h-32 overflow-y-auto bg-black/20 rounded-lg px-3 py-2 text-xs text-fg/85 leading-relaxed">
                      {liveTranscript}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={stopRecording}
                    className="px-4 py-2 rounded-lg bg-fg/10 border border-fg/20 text-fg text-xs font-bold flex items-center gap-1.5"
                  >
                    <Square className="w-3.5 h-3.5" />
                    Detener
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => { void startRecording(); }}
                  className="w-full flex flex-col items-center justify-center gap-2 py-8 rounded-xl border border-dashed border-fg/15 bg-fg/5 text-text-industrial/60 hover:bg-fg/10 active:bg-fg/15"
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
                className="w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2.5 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 resize-none"
              />
              {filePreview && !text.trim() && (
                <p className="text-[10px] text-orange-700 dark:text-orange-400/80">
                  ⚠ Sin texto, la nota se guarda pero no contribuye a las Observaciones.
                </p>
              )}
            </>
          )}

          {/* ── DOCUMENTO (PDF o imagen/gráfico) ── */}
          {kind === "DOCUMENT" && (
            <>
              {file ? (
                <div className="flex items-center gap-2 px-3 py-3 rounded-xl border border-fg/10 bg-fg/5">
                  <FileText className="w-5 h-5 text-accent shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-fg truncate">{file.name}</p>
                    <p className="text-[10px] text-text-industrial/40">{(file.size / 1024).toFixed(0)} KB · {file.type || "documento"}</p>
                  </div>
                  <button type="button" onClick={resetMedia} className="p-1.5 rounded-lg text-text-industrial/40 hover:text-red-700 dark:hover:text-red-400">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center gap-2 py-8 rounded-xl border border-dashed border-fg/15 bg-fg/5 text-text-industrial/60 cursor-pointer hover:bg-fg/10 active:bg-fg/15">
                  <FileText className="w-6 h-6" />
                  <span className="text-xs font-bold uppercase tracking-wider">Adjuntar documento</span>
                  <span className="text-[10px] text-text-industrial/40 normal-case font-normal">PDF, imagen o gráfico</span>
                  <input type="file" accept="application/pdf,image/*" className="hidden" onChange={onDocSelect} />
                </label>
              )}
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={2}
                placeholder="Descripción opcional"
                className="w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2.5 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 resize-none"
              />
            </>
          )}

          {err && <p className="text-xs text-red-700 dark:text-red-400">{err}</p>}
        </div>

        {/* Footer */}
        <div className="border-t border-fg/10 p-3">
          <button
            type="button"
            onClick={() => { void handleSave(); }}
            disabled={saving || recording || videoRecording || compressing}
            className="w-full py-3 rounded-xl bg-accent text-accent-fg text-sm font-bold disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Guardar avance"}
          </button>
        </div>
      </div>
    </div>
  );
};
