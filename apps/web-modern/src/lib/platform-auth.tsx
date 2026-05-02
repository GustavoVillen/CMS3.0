import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { ApiError, setUnauthorizedHandler } from "./api";
import { useIdleTimeout } from "./idle-timeout";

const SUSPEND_GAP_MS = 5 * 60 * 1000; // 5 minutes — timer-drift threshold

export interface PlatformUser {
  id: string;
  email: string;
  role: string;
}

interface PlatformAuthState {
  token: string | null;
  user: PlatformUser | null;
  isAuthenticated: boolean;
}

interface PlatformAuthContextValue extends PlatformAuthState {
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  error: string | null;
  loading: boolean;
}

const PlatformAuthContext = createContext<PlatformAuthContextValue | null>(null);

const STORAGE_KEY = "gpms_platform_auth";
const TOKEN_KEY   = "gpms_platform_token";
const REFRESH_KEY = "gpms_platform_refresh_token";

function loadStored(): PlatformAuthState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return { ...p, isAuthenticated: !!p.token };
    }
  } catch {/* ignore */}
  return { token: null, user: null, isAuthenticated: false };
}

export function PlatformAuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState]   = useState<PlatformAuthState>(loadStored);
  const [error, setError]   = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (state.token) localStorage.setItem(TOKEN_KEY, state.token);
    else localStorage.removeItem(TOKEN_KEY);
  }, [state.token]);

  const logout = useCallback(() => {
    setState({ token: null, user: null, isAuthenticated: false });
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(logout);
  }, [logout]);

  // Cierra sesión solo si la PC se suspendió o el screensaver bloqueó los
  // timers del browser por más de 5 min (detectado por timer drift).
  useIdleTimeout(SUSPEND_GAP_MS, logout, state.isAuthenticated);

  const login = useCallback(async (email: string, password: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/platform/auth/login", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        const code = (json as any).error?.code ?? "ERROR";
        setError(code === "AUTH_INVALID_CREDENTIALS" ? "Credenciales inválidas" : "Error de autenticación");
        return;
      }
      const data = await res.json() as { session: { accessToken: string; refreshToken: string }; user: PlatformUser };
      const next: PlatformAuthState = {
        token: data.session.accessToken,
        user: data.user,
        isAuthenticated: true,
      };
      setState(next);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      localStorage.setItem(REFRESH_KEY, data.session.refreshToken);
    } catch {
      setError("Error de conexión");
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <PlatformAuthContext.Provider value={{ ...state, login, logout, error, loading }}>
      {children}
    </PlatformAuthContext.Provider>
  );
}

export function usePlatformAuth() {
  const ctx = useContext(PlatformAuthContext);
  if (!ctx) throw new Error("usePlatformAuth must be used within PlatformAuthProvider");
  return ctx;
}

/**
 * Try to refresh the platform access token using the stored refresh token.
 * Returns the new access token on success, null on failure.
 * Concurrent refresh attempts are deduplicated via the in-flight promise.
 */
let refreshInflight: Promise<string | null> | null = null;
async function refreshPlatformToken(): Promise<string | null> {
  if (refreshInflight) return refreshInflight;
  refreshInflight = (async () => {
    const refreshToken = localStorage.getItem(REFRESH_KEY);
    if (!refreshToken) return null;
    try {
      const res = await fetch("/platform/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) return null;
      const data = await res.json() as { accessToken: string; refreshToken: string };
      localStorage.setItem(TOKEN_KEY, data.accessToken);
      localStorage.setItem(REFRESH_KEY, data.refreshToken);
      // Sync into the auth state blob too so reload preserves the new token
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          parsed.token = data.accessToken;
          localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
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

/** One-shot fetch with automatic refresh-and-retry on 401. */
export async function platformAuthedFetch(path: string, init: RequestInit): Promise<Response> {
  const token = localStorage.getItem(TOKEN_KEY) ?? "";
  const headers = { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` };
  let res = await fetch(path, { ...init, headers });
  if (res.status !== 401) return res;

  const newToken = await refreshPlatformToken();
  if (!newToken) return res; // refresh failed → return original 401

  const retryHeaders = { ...(init.headers as Record<string, string>), Authorization: `Bearer ${newToken}` };
  res = await fetch(path, { ...init, headers: retryHeaders });
  return res;
}

function buildJsonInit(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  };
}

/** Fetch helper for platform API calls (uses platform token, auto-refreshes on 401) */
export async function platformFetch<T>(path: string): Promise<T> {
  const res = await platformAuthedFetch(path, buildJsonInit("GET"));
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new ApiError(res.status, (json as any).error?.code ?? "ERROR", (json as any).error?.message ?? res.statusText);
  }
  return res.json();
}

export async function platformPost<T>(path: string, body: unknown): Promise<T> {
  const res = await platformAuthedFetch(path, buildJsonInit("POST", body));
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new ApiError(res.status, (json as any).error?.code ?? "ERROR", (json as any).error?.message ?? res.statusText);
  }
  return res.json();
}

export async function platformPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await platformAuthedFetch(path, buildJsonInit("PATCH", body));
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new ApiError(res.status, (json as any).error?.code ?? "ERROR", (json as any).error?.message ?? res.statusText);
  }
  return res.json();
}
