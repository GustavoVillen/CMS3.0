// ---------------------------------------------------------------------------
// API client — thin fetch wrapper
// Base URL is empty (Vite proxy handles /auth and /app in dev)
// ---------------------------------------------------------------------------

const BASE = "";

// Called on 401 to clear stale session (set by AuthProvider)
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) { onUnauthorized = fn; }

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = localStorage.getItem("gpms_token");
  const slug  = localStorage.getItem("gpms_tenant_slug");
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (slug)  headers["X-Tenant-Slug"] = slug;
  return headers;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: getHeaders(),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    let code = "ERROR";
    let message = res.statusText;
    try {
      const json = await res.json();
      code = json?.error?.code ?? json?.error ?? code;
      message = json?.error?.message ?? json?.message ?? message;
    } catch {/* ignore */}
    if (res.status === 401) onUnauthorized?.();
    throw new ApiError(res.status, code, message);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  get:    <T>(path: string)               => request<T>("GET",    path),
  post:   <T>(path: string, body: unknown) => request<T>("POST",   path, body),
  put:    <T>(path: string, body: unknown) => request<T>("PUT",    path, body),
  patch:  <T>(path: string, body: unknown) => request<T>("PATCH",  path, body),
  delete: <T>(path: string)               => request<T>("DELETE",  path),

  /** Upload a raw file (binary body). Sends X-Filename header with the original name. */
  async upload<T>(path: string, file: File): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/octet-stream",
      "X-Filename": encodeURIComponent(file.name),
    };
    const token = localStorage.getItem("gpms_token");
    const slug  = localStorage.getItem("gpms_tenant_slug");
    if (token) headers["Authorization"] = `Bearer ${token}`;
    if (slug)  headers["X-Tenant-Slug"] = slug;
    const res = await fetch(`${BASE}${path}`, { method: "POST", headers, body: file });
    if (!res.ok) {
      let code = "ERROR"; let message = res.statusText;
      try { const j = await res.json(); code = j?.error?.code ?? code; message = j?.error?.message ?? message; } catch {/* ignore */}
      if (res.status === 401) onUnauthorized?.();
      throw new ApiError(res.status, code, message);
    }
    return res.json();
  },

  /** Opens an SSE stream for POST endpoints. Returns a ReadableStreamDefaultReader<string>. */
  stream(path: string, body: unknown): Promise<ReadableStreamDefaultReader<string>> {
    return fetch(`${BASE}${path}`, {
      method:  "POST",
      headers: getHeaders(),
      body:    JSON.stringify(body),
    }).then(res => {
      if (!res.ok || !res.body) {
        throw new ApiError(res.status, "STREAM_ERROR", "Streaming request failed.");
      }
      return res.body.pipeThrough(new TextDecoderStream()).getReader();
    });
  },
};
