import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { ApiError, setUnauthorizedHandler } from "./api";

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
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(logout);
  }, [logout]);

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
      const data = await res.json() as { session: { accessToken: string }; user: PlatformUser };
      const next: PlatformAuthState = {
        token: data.session.accessToken,
        user: data.user,
        isAuthenticated: true,
      };
      setState(next);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
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

/** Fetch helper for platform API calls (uses platform token) */
export async function platformFetch<T>(path: string): Promise<T> {
  const token = localStorage.getItem(TOKEN_KEY) ?? "";
  const res = await fetch(path, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new ApiError(res.status, (json as any).error?.code ?? "ERROR", (json as any).error?.message ?? res.statusText);
  }
  return res.json();
}

export async function platformPost<T>(path: string, body: unknown): Promise<T> {
  const token = localStorage.getItem(TOKEN_KEY) ?? "";
  const res = await fetch(path, {
    method:  "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new ApiError(res.status, (json as any).error?.code ?? "ERROR", (json as any).error?.message ?? res.statusText);
  }
  return res.json();
}

export async function platformPatch<T>(path: string, body: unknown): Promise<T> {
  const token = localStorage.getItem(TOKEN_KEY) ?? "";
  const res = await fetch(path, {
    method:  "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new ApiError(res.status, (json as any).error?.code ?? "ERROR", (json as any).error?.message ?? res.statusText);
  }
  return res.json();
}
