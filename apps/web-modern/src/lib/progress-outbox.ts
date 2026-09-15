// Avances guardados en el teléfono cuando no hay señal (preview V29).
//
// A bordo la conexión se corta seguido. Si el envío de un avance falla por red
// (no por un error del servidor), el avance —texto, fecha y fotos— queda en el
// almacenamiento del navegador (IndexedDB) y se reenvía solo cuando vuelve la
// conexión o cuando se abre la app. Lo mismo si la sesión venció o el servidor está
// reiniciando. Un rechazo del servidor (400, 403, OT cerrada…) NO se encola:
// reintentarlo daría el mismo error, así que se muestra.

import { useEffect, useState } from "react";
import { api, ApiError } from "./api";

export interface OutboxFile { name: string; mime: string; kind: "PHOTO" | "DOCUMENT"; blob: Blob }
export interface OutboxEntry {
  id: string;
  workOrderId: string;
  workOrderLabel: string | null;
  text: string;
  occurredAt: string;
  files: OutboxFile[];
  createdAt: string;
}

const DB_NAME = "cms3-outbox";
const STORE = "progress-notes";
const listeners = new Set<(n: number) => void>();
let flushing = false;
let started = false;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: "id" }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

export async function listOutbox(): Promise<OutboxEntry[]> {
  try { return await withStore<OutboxEntry[]>("readonly", s => s.getAll() as IDBRequest<OutboxEntry[]>); }
  catch { return []; }
}

async function notify() {
  const n = (await listOutbox()).length;
  listeners.forEach(fn => fn(n));
}

export function subscribeOutbox(fn: (n: number) => void): () => void {
  listeners.add(fn);
  void listOutbox().then(items => fn(items.length));
  return () => { listeners.delete(fn); };
}

/** Avances de esta OT que esperan señal. Avisa también cuando se envían. */
export function usePendingProgress(workOrderId: string, onSent?: () => void): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    let prev = -1;
    return subscribeOutbox(() => {
      void listOutbox().then(items => {
        const mine = items.filter(e => e.workOrderId === workOrderId).length;
        if (prev > mine && onSent) onSent();
        prev = mine;
        setN(mine);
      });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workOrderId]);
  return n;
}

/** ¿El error fue de red (sin señal) y no una respuesta del servidor? */
export function isNetworkError(e: unknown): boolean {
  if (e instanceof ApiError) return false;
  return e instanceof TypeError || (typeof navigator !== "undefined" && navigator.onLine === false);
}

/**
 * ¿Conviene guardarlo y reintentar? Sin señal, sesión vencida o sin empresa
 * (401 / TENANT_UNRESOLVED), demasiados pedidos (408/429) o servidor caído o
 * reiniciando (5xx). Lo demás (OT cerrada, sin permiso…) daría el mismo error.
 */
export function isRetryableError(e: unknown): boolean {
  if (isNetworkError(e)) return true;
  return e instanceof ApiError && (e.status === 401 || e.status === 408 || e.status === 429 || e.status >= 500 || e.code === "TENANT_UNRESOLVED");
}

export async function enqueueProgress(entry: Omit<OutboxEntry, "id" | "createdAt">): Promise<void> {
  const full: OutboxEntry = { ...entry, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, createdAt: new Date().toISOString() };
  await withStore("readwrite", s => s.put(full));
  await notify();
}

/** Lo que queda por enviar de un avance. */
export type ProgressPayload = Pick<OutboxEntry, "workOrderId" | "text" | "occurredAt" | "files">;

/**
 * Envía un avance: el texto va en la primera parte (nota de texto o leyenda del
 * primer archivo) y cada archivo es una nota más con la misma fecha.
 * `onProgress` recibe lo que FALTA después de cada parte enviada: si se corta la
 * señal a mitad de camino, se encola sólo eso y no se duplica lo ya enviado.
 */
export async function sendProgress(entry: ProgressPayload, onProgress?: (remaining: ProgressPayload) => Promise<void> | void): Promise<void> {
  const base = `/app/pms/work-orders/${entry.workOrderId}/progress-notes`;
  let text = entry.text.trim();
  const files = [...entry.files];
  if (files.length === 0) {
    await api.post(`${base}?kind=TEXT`, { text, occurredAt: entry.occurredAt });
    return;
  }
  while (files.length > 0) {
    const f = files[0]!;
    const headers: Record<string, string> = {
      "x-filename": encodeURIComponent(f.name),
      "x-mime-type": f.mime || "application/octet-stream",
      "x-occurred-at": entry.occurredAt,
    };
    // El texto acompaña al primer archivo: así no se repite en cada foto.
    if (text) headers["x-caption"] = encodeURIComponent(text);
    await api.uploadRaw(`${base}?kind=${f.kind}`, f.blob, headers);
    files.shift();
    text = "";
    if (onProgress) await onProgress({ ...entry, text, files: [...files] });
  }
}

/** Reenvía lo pendiente. Lo que falla por red queda; lo que el servidor rechaza se descarta. */
export async function flushOutbox(): Promise<{ sent: number; dropped: number }> {
  if (flushing || (typeof navigator !== "undefined" && navigator.onLine === false)) return { sent: 0, dropped: 0 };
  // Sin sesión iniciada no se intenta: queda guardado hasta que vuelva a entrar.
  try { if (!localStorage.getItem("gpms_token")) return { sent: 0, dropped: 0 }; } catch { return { sent: 0, dropped: 0 }; }
  flushing = true;
  let sent = 0, dropped = 0;
  try {
    for (const entry of await listOutbox()) {
      try {
        // Cada parte enviada se descuenta del pendiente guardado.
        await sendProgress(entry, async remaining => {
          await withStore("readwrite", s => s.put({ ...entry, ...remaining }));
        });
        await withStore("readwrite", s => s.delete(entry.id));
        sent += 1;
      } catch (e) {
        if (isRetryableError(e)) break; // se reintenta más tarde
        await withStore("readwrite", s => s.delete(entry.id));
        dropped += 1;
      }
    }
  } finally {
    flushing = false;
    await notify();
  }
  return { sent, dropped };
}

/** Reintento automático: al volver la conexión y cada minuto mientras haya pendientes. */
export function startProgressOutbox(): void {
  if (started || typeof window === "undefined" || typeof indexedDB === "undefined") return;
  started = true;
  window.addEventListener("online", () => { void flushOutbox(); });
  window.setInterval(() => { void listOutbox().then(items => { if (items.length) void flushOutbox(); }); }, 60_000);
  void flushOutbox();
}
