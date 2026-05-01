import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { api, ApiError, setUnauthorizedHandler } from "./api";

export interface AuthUser {
  id: string;
  name: string;
  email?: string;
  identifier?: string;
  role: string;
  assignedVesselCodes: string[];
}

export interface AuthTenant {
  id: string;
  slug: string;
  name: string;
  locale: string;
  timezone: string;
  currency: string;
  logoUrl?: string | null;
  logoUrlLight?: string | null;
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  tenant: AuthTenant | null;
  isAuthenticated: boolean;
}

interface AuthContextValue extends AuthState {
  login: (tenantSlug: string, identifier: string, password: string) => Promise<void>;
  logout: () => void;
  error: string | null;
  loading: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function loadStoredAuth(): AuthState {
  try {
    const raw = localStorage.getItem("gpms_auth");
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...parsed, isAuthenticated: !!parsed.token };
    }
  } catch {/* ignore */}
  return { token: null, user: null, tenant: null, isAuthenticated: false };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>(loadStoredAuth);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Sync token/slug to localStorage for api.ts header injection
  useEffect(() => {
    if (state.token) {
      localStorage.setItem("gpms_token", state.token);
      localStorage.setItem("gpms_tenant_slug", state.tenant?.slug ?? "");
    } else {
      localStorage.removeItem("gpms_token");
      localStorage.removeItem("gpms_tenant_slug");
    }
  }, [state.token, state.tenant?.slug]);

  const login = useCallback(async (tenantSlug: string, identifier: string, password: string) => {
    setLoading(true);
    setError(null);
    try {
      // Set slug before the call so getHeaders() includes X-Tenant-Slug
      localStorage.setItem("gpms_tenant_slug", tenantSlug);

      const res = await api.post<{
        session: { accessToken: string; refreshToken: string };
        user: { id: string; firstName?: string; lastName?: string; email?: string; role: string; assignedVesselCodes: string[] };
        bootstrap: { tenant: { slug: string; displayName: string; timezone: string; currency: string; locale: string; defaultLocale?: string; logoUrl?: string | null; logoUrlLight?: string | null } };
      }>("/app/auth/login", { identifier, password });

      // Persist refresh token so api.ts can recover from 401 (access token expiry)
      localStorage.setItem("gpms_refresh_token", res.session.refreshToken);

      const u = res.user;
      const t = res.bootstrap?.tenant;
      const next: AuthState = {
        token: res.session.accessToken,
        user: {
          id: u.id,
          name: [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email || identifier,
          email: u.email,
          identifier,
          role: u.role,
          assignedVesselCodes: u.assignedVesselCodes ?? [],
        },
        tenant: {
          id: "",
          slug: t?.slug ?? tenantSlug,
          name: t?.displayName ?? tenantSlug,
          locale: t?.locale ?? t?.defaultLocale ?? "es",
          timezone: t?.timezone ?? "UTC",
          currency: t?.currency ?? "USD",
          logoUrl: t?.logoUrl ?? null,
          logoUrlLight: t?.logoUrlLight ?? null,
        },
        isAuthenticated: true,
      };
      setState(next);
      localStorage.setItem("gpms_auth", JSON.stringify(next));
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.code === "AUTH_INVALID_CREDENTIALS" ? "Credenciales inválidas" : err.message);
      } else {
        setError("Error de conexión");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    setState({ token: null, user: null, tenant: null, isAuthenticated: false });
    localStorage.removeItem("gpms_auth");
    localStorage.removeItem("gpms_token");
    localStorage.removeItem("gpms_tenant_slug");
    localStorage.removeItem("gpms_refresh_token");
  }, []);

  // Auto-logout on 401 only after refresh attempt has failed (api.ts handles refresh)
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setState({ token: null, user: null, tenant: null, isAuthenticated: false });
      localStorage.removeItem("gpms_auth");
      localStorage.removeItem("gpms_token");
      localStorage.removeItem("gpms_tenant_slug");
      localStorage.removeItem("gpms_refresh_token");
    });
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, logout, error, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
