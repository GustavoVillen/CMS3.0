// Helper para renderizar uploads protegidos por sesión.
//
// Las rutas /uploads/* viejas se deprecaron (410 Gone) — todos los uploads
// pasan por /app/files/* con Bearer token. Como <img src> y <video src>
// del browser NO mandan Authorization header, hacemos fetch a mano,
// convertimos a blob URL y lo usamos como src local.
//
// Uso:
//   <AuthedImage src={note.fileUrl} alt="Foto" className="..." />
//   <AuthedVideo src={note.fileUrl} controls />
//   <AuthedAudio src={note.fileUrl} controls />
//
// O para casos custom (lightbox, descarga):
//   const blobUrl = useAuthedBlobUrl(rawUrl);

import React, { useEffect, useRef, useState } from "react";
import { FileText } from "lucide-react";

/**
 * Traduce un URL viejo `/uploads/...` al nuevo `/app/files/...`. Si ya
 * está en /app/files/* (porque el backend lo serializó), lo deja igual.
 * Si es URL absoluta (http://...) o data URL, también lo deja.
 */
export function toAuthedFilePath(url: string): string {
  if (url.startsWith("/uploads/"))   return "/app/files/" + url.slice("/uploads/".length);
  if (url.startsWith("/app/files/")) return url;
  return url; // absoluto o data URL — no tocamos
}

/**
 * Fetcha el archivo autenticado y devuelve un blob URL local. La URL se
 * revoca al desmontar para evitar memory leaks.
 */
export function useAuthedBlobUrl(src: string | null | undefined): string | null {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  // Guardamos el último blob URL para revocarlo al cambiar src o desmontar
  const lastBlobRef = useRef<string | null>(null);

  useEffect(() => {
    if (!src) {
      setBlobUrl(null);
      return;
    }
    // Si no es un upload protegido, lo usamos directo (data URL, absoluto, etc.)
    if (!src.startsWith("/uploads/") && !src.startsWith("/app/files/")) {
      setBlobUrl(src);
      return;
    }

    let cancelled = false;
    const path = toAuthedFilePath(src);
    const token = localStorage.getItem("gpms_token");
    const slug  = localStorage.getItem("gpms_tenant_slug");
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    if (slug)  headers["X-Tenant-Slug"] = slug;

    fetch(path, { headers })
      .then((res) => (res.ok ? res.blob() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((blob) => {
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        if (lastBlobRef.current) URL.revokeObjectURL(lastBlobRef.current);
        lastBlobRef.current = url;
        setBlobUrl(url);
      })
      .catch(() => {
        if (!cancelled) setBlobUrl(null);
      });

    return () => { cancelled = true; };
  }, [src]);

  // Revocar blob URL al desmontar
  useEffect(() => () => {
    if (lastBlobRef.current) {
      URL.revokeObjectURL(lastBlobRef.current);
      lastBlobRef.current = null;
    }
  }, []);

  return blobUrl;
}

interface AuthedMediaProps extends React.HTMLAttributes<HTMLElement> {
  src: string | null | undefined;
  className?: string;
  alt?: string;
  controls?: boolean;
  muted?: boolean;
  autoPlay?: boolean;
}

export const AuthedImage: React.FC<AuthedMediaProps> = ({ src, alt = "", ...rest }) => {
  const blobUrl = useAuthedBlobUrl(src);
  if (!blobUrl) return null;
  return <img src={blobUrl} alt={alt} {...rest} />;
};

export const AuthedVideo: React.FC<AuthedMediaProps> = ({ src, controls, muted, autoPlay, ...rest }) => {
  const blobUrl = useAuthedBlobUrl(src);
  if (!blobUrl) return null;
  return <video src={blobUrl} controls={controls} muted={muted} autoPlay={autoPlay} {...rest} />;
};

export const AuthedAudio: React.FC<AuthedMediaProps> = ({ src, controls, ...rest }) => {
  const blobUrl = useAuthedBlobUrl(src);
  if (!blobUrl) return null;
  return <audio src={blobUrl} controls={controls} {...rest} />;
};

/**
 * Link a un documento protegido (PDF/imagen) — lo abre en una pestaña nueva
 * vía blob URL autenticado. Mientras carga muestra un estado deshabilitado.
 */
export const AuthedDocLink: React.FC<{ src: string; label?: string; className?: string }> = ({ src, label, className }) => {
  const blobUrl = useAuthedBlobUrl(src);
  return (
    <a
      href={blobUrl ?? undefined}
      target="_blank"
      rel="noreferrer"
      className={className ?? `flex items-center gap-2 px-3 py-2 rounded-lg border border-fg/10 bg-fg/5 text-xs transition-colors ${blobUrl ? "text-accent hover:bg-fg/10" : "text-text-industrial/40 pointer-events-none"}`}
    >
      <FileText className="w-4 h-4 shrink-0" />
      <span className="truncate">{blobUrl ? (label ?? "Ver documento") : "Cargando documento…"}</span>
    </a>
  );
};

/**
 * Trigger una descarga del archivo protegido. Fetcha autenticado, crea
 * blob URL, dispara <a download>, revoca. Usar desde un onClick.
 */
export async function downloadAuthedFile(src: string, filename?: string, body?: unknown): Promise<void> {
  if (!src) return;
  const path = toAuthedFilePath(src);
  const token = localStorage.getItem("gpms_token");
  const slug  = localStorage.getItem("gpms_tenant_slug");
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (slug)  headers["X-Tenant-Slug"] = slug;

  // Con `body` se manda por POST: lo usan los PDF que dependen de lo que el
  // usuario está viendo (la lista filtrada en pantalla), demasiado largo para
  // meterlo en la URL.
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(path, body === undefined
    ? { headers }
    : { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename ?? src.split("/").pop() ?? "download";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Pequeño delay para que el browser inicie la descarga antes de revocar.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
