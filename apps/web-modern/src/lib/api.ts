// ---------------------------------------------------------------------------
// API client — thin fetch wrapper
// Base URL is empty (Vite proxy handles /auth and /app in dev)
// ---------------------------------------------------------------------------

const BASE = "";

// Called only after both the access token AND refresh token have failed.
// Auth provider sets this to clear localStorage and redirect to /login.
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

/**
 * Try to refresh the tenant access token using the stored refresh token.
 * Returns the new access token on success, null on failure.
 * Concurrent refresh attempts are deduplicated via the in-flight promise.
 */
let refreshInflight: Promise<string | null> | null = null;
async function refreshTenantToken(): Promise<string | null> {
  if (refreshInflight) return refreshInflight;
  refreshInflight = (async () => {
    const refreshToken = localStorage.getItem("gpms_refresh_token");
    const slug = localStorage.getItem("gpms_tenant_slug");
    if (!refreshToken || !slug) return null;
    try {
      const res = await fetch(`${BASE}/app/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Tenant-Slug": slug },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) return null;
      const data = await res.json() as { accessToken: string; refreshToken: string };
      localStorage.setItem("gpms_token", data.accessToken);
      localStorage.setItem("gpms_refresh_token", data.refreshToken);
      try {
        const raw = localStorage.getItem("gpms_auth");
        if (raw) {
          const parsed = JSON.parse(raw);
          parsed.token = data.accessToken;
          localStorage.setItem("gpms_auth", JSON.stringify(parsed));
        }
      } catch {/* ignore */}
      return data.accessToken;
    } catch {
      return null;
    }
  })();
  try {
    return await refreshInflight;
  } finally {
    refreshInflight = null;
  }
}

async function rawFetch(method: string, path: string, body?: unknown, retried = false): Promise<Response> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: getHeaders(),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // 401 on a non-auth endpoint → try refresh once, then retry
  if (res.status === 401 && !retried && !path.startsWith("/app/auth/")) {
    const newToken = await refreshTenantToken();
    if (newToken) return rawFetch(method, path, body, true);
  }
  return res;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await rawFetch(method, path, body);

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
    const buildHeaders = (): Record<string, string> => {
      const headers: Record<string, string> = {
        "Content-Type": "application/octet-stream",
        "X-Filename": encodeURIComponent(file.name),
      };
      const token = localStorage.getItem("gpms_token");
      const slug  = localStorage.getItem("gpms_tenant_slug");
      if (token) headers["Authorization"] = `Bearer ${token}`;
      if (slug)  headers["X-Tenant-Slug"] = slug;
      return headers;
    };

    let res = await fetch(`${BASE}${path}`, { method: "POST", headers: buildHeaders(), body: file });
    if (res.status === 401) {
      const newToken = await refreshTenantToken();
      if (newToken) {
        res = await fetch(`${BASE}${path}`, { method: "POST", headers: buildHeaders(), body: file });
      }
    }
    if (!res.ok) {
      let code = "ERROR"; let message = res.statusText;
      try { const j = await res.json(); code = j?.error?.code ?? code; message = j?.error?.message ?? message; } catch {/* ignore */}
      if (res.status === 401) onUnauthorized?.();
      throw new ApiError(res.status, code, message);
    }
    return res.json();
  },

  /** Opens an SSE stream for POST endpoints. Returns a ReadableStreamDefaultReader<string>. */
  async stream(path: string, body: unknown): Promise<ReadableStreamDefaultReader<string>> {
    let res = await fetch(`${BASE}${path}`, { method: "POST", headers: getHeaders(), body: JSON.stringify(body) });
    if (res.status === 401) {
      const newToken = await refreshTenantToken();
      if (newToken) {
        res = await fetch(`${BASE}${path}`, { method: "POST", headers: getHeaders(), body: JSON.stringify(body) });
      }
    }
    if (!res.ok || !res.body) {
      throw new ApiError(res.status, "STREAM_ERROR", "Streaming request failed.");
    }
    return res.body.pipeThrough(new TextDecoderStream()).getReader();
  },
};
