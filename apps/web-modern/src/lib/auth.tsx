import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { api, ApiError, setUnauthorizedHandler } from "./api";
import { clearFetchCache } from "./fetch-cache";

export interface AuthUser {
  id: string;
  name: string;
  email?: string;
  identifier?: string;
  role: string;
  assignedVesselCodes: string[];
  /**
   * Autorizaciones efectivas del rol (Equipo → Permisos por rol). Vienen del
   * login y se refrescan al montar la app, así un cambio del admin llega sin
   * que el usuario tenga que volver a entrar. El servidor valida igual: esto
   * sólo decide qué botones se muestran.
   */
  permissions?: string[];
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
  workOrderPdfTemplate?: string | null;
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

// Limpia toda la localStorage relacionada al login. Importante incluir las
// claves de vessel scope (gpms_vessel_scope_<slug>) para que al cambiar de
// usuario en la misma máquina no se herede la selección de buque del anterior.
function clearAuthLocalStorage() {
  localStorage.removeItem("gpms_auth");
  localStorage.removeItem("gpms_token");
  localStorage.removeItem("gpms_tenant_slug");
  localStorage.removeItem("gpms_refresh_token");
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && key.startsWith("gpms_vessel_scope_")) {
        localStorage.removeItem(key);
      }
    }
  } catch { /* ignore */ }
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
        user: { id: string; firstName?: string; lastName?: string; email?: string; role: string; assignedVesselCodes: string[]; permissions?: string[] };
        bootstrap: { tenant: { slug: string; displayName: string; timezone: string; currency: string; locale: string; defaultLocale?: string; logoUrl?: string | null; logoUrlLight?: string | null; workOrderPdfTemplate?: string | null } };
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
          permissions: u.permissions ?? [],
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
          workOrderPdfTemplate: t?.workOrderPdfTemplate ?? null,
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
    // Revoca el refresh token en el server antes de limpiar localStorage.
    // Fire-and-forget: si falla la red, igual seguimos cerrando sesión local.
    const refreshToken = localStorage.getItem("gpms_refresh_token");
    const accessToken  = localStorage.getItem("gpms_token");
    if (refreshToken || accessToken) {
      api.post("/app/auth/logout", { refreshToken, accessToken }).catch(() => { /* ignore */ });
    }
    setState({ token: null, user: null, tenant: null, isAuthenticated: false });
    clearAuthLocalStorage();
    clearFetchCache(); // evita exponer datos cacheados al siguiente login
  }, []);

  // Refresca las autorizaciones del rol al abrir la app: si el admin cambió la
  // matriz mientras el usuario estaba logueado, el menú y los botones se ponen
  // al día sin obligarlo a volver a entrar. Silencioso: si falla, se sigue
  // usando lo que vino del login (y el servidor valida igual).
  useEffect(() => {
    if (!state.token) return;
    let cancelled = false;
    api.get<{ mine?: string[] }>("/app/tenant/role-permissions")
      .then(res => {
        if (cancelled || !Array.isArray(res?.mine)) return;
        setState(prev => {
          if (!prev.user) return prev;
          const mine = res.mine as string[];
          const current = prev.user.permissions ?? [];
          if (current.length === mine.length && current.every(p => mine.includes(p))) return prev;
          const next = { ...prev, user: { ...prev.user, permissions: mine } };
          localStorage.setItem("gpms_auth", JSON.stringify(next));
          return next;
        });
      })
      .catch(() => { /* ignore */ });
    return () => { cancelled = true; };
  }, [state.token]);

  // Auto-logout on 401 only after refresh attempt has failed (api.ts handles refresh)
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setState({ token: null, user: null, tenant: null, isAuthenticated: false });
      clearAuthLocalStorage();
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

/**
 * ¿El usuario tiene esta autorización? Se usa para mostrar/ocultar botones de
 * acción (aprobar, autorizar, eliminar). La regla real la aplica el servidor.
 *
 *   const can = useCan();
 *   {can("permit.authorize") && <button>Aprobar</button>}
 */
export function useCan(): (permission: string) => boolean {
  const { user } = useAuth();
  const permissions = user?.permissions;
  return useCallback(
    (permission: string) => !!permissions?.includes(permission),
    [permissions],
  );
}
