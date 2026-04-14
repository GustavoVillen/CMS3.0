import type { ApiResponse } from "./types";

// ─── Config ───────────────────────────────────────────────────────────────────

let _baseUrl    = "";
let _tenantSlug: string | null = null;

export function setBaseUrl(url: string): void {
  _baseUrl = url;
}

/** Called after tenant login to stamp every tenant API request. */
export function setApiTenantSlug(slug: string | null): void {
  _tenantSlug = slug;
}

// ─── Internal request helpers ─────────────────────────────────────────────────

function tenantToken(): string | null {
  return typeof window !== "undefined" ? localStorage.getItem("pms_tenant_token") : null;
}

function platformToken(): string | null {
  return typeof window !== "undefined" ? localStorage.getItem("pms_platform_token") : null;
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = tenantToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token)       headers["Authorization"]  = `Bearer ${token}`;
  if (_tenantSlug) headers["X-Tenant-Slug"]  = _tenantSlug;

  const resp = await fetch(`${_baseUrl}${endpoint}`, { ...options, headers });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ message: "Request failed" }));
    throw new Error((err as any).message || `HTTP ${resp.status}`);
  }
  return resp.json() as Promise<T>;
}

async function platformRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = platformToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const resp = await fetch(`${_baseUrl}${endpoint}`, { ...options, headers });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ message: "Request failed" }));
    throw new Error((err as any).message || `HTTP ${resp.status}`);
  }
  return resp.json() as Promise<T>;
}

// ─── API surface ──────────────────────────────────────────────────────────────

export const api = {

  // ── Auth ───────────────────────────────────────────────────────────────────
  auth: {
    loginTenant: (payload: { identifier: string; password: string; locale?: string }) =>
      request<{
        session:   { accessToken: string; refreshToken: string; accessTokenExpiresAt: string };
        user:      any;
        bootstrap: any;
      }>("/app/auth/login", { method: "POST", body: JSON.stringify(payload) }),

    loginPlatform: (payload: { email: string; password: string }) =>
      platformRequest<{
        session: { accessToken: string; refreshToken: string; accessTokenExpiresAt: string };
        user:    any;
        context: { kind: string };
      }>("/platform/auth/login", { method: "POST", body: JSON.stringify(payload) }),
  },

  // ── Public ─────────────────────────────────────────────────────────────────
  bootstrap: {
    get: (tenant: string) =>
      request<any>(`/public/bootstrap?tenant=${encodeURIComponent(tenant)}`, { method: "GET" }),
  },

  // ── Tenant – current user ──────────────────────────────────────────────────
  me: {
    get: () => request<any>("/app/me", { method: "GET" }),
  },

  // ── Tenant – domain modules ────────────────────────────────────────────────
  vessels: {
    list: () => request<ApiResponse<any>>("/app/vessels", { method: "GET" }),
  },

  assets: {
    list: (vesselCode?: string) => {
      const q = vesselCode ? `?vesselCode=${encodeURIComponent(vesselCode)}` : "";
      return request<ApiResponse<any>>(`/app/assets${q}`, { method: "GET" });
    },
  },

  maintenancePlans: {
    list: (f: { vesselCode?: string; status?: string; triggerType?: string } = {}) => {
      const p = new URLSearchParams();
      if (f.vesselCode)  p.set("vesselCode",  f.vesselCode);
      if (f.status)      p.set("status",      f.status);
      if (f.triggerType) p.set("triggerType", f.triggerType);
      const q = p.toString();
      return request<ApiResponse<any>>(`/app/maintenance-plans${q ? "?" + q : ""}`, { method: "GET" });
    },
  },

  workOrders: {
    list: (f: { vesselCode?: string; status?: string; type?: string } = {}) => {
      const p = new URLSearchParams();
      if (f.vesselCode) p.set("vesselCode", f.vesselCode);
      if (f.status)     p.set("status",     f.status);
      if (f.type)       p.set("type",       f.type);
      const q = p.toString();
      return request<ApiResponse<any>>(`/app/work-orders${q ? "?" + q : ""}`, { method: "GET" });
    },
  },

  defects: {
    list: (f: { vesselCode?: string; status?: string; severity?: string } = {}) => {
      const p = new URLSearchParams();
      if (f.vesselCode) p.set("vesselCode", f.vesselCode);
      if (f.status)     p.set("status",     f.status);
      if (f.severity)   p.set("severity",   f.severity);
      const q = p.toString();
      return request<ApiResponse<any>>(`/app/defects${q ? "?" + q : ""}`, { method: "GET" });
    },
  },

  deferrals: {
    list: (f: { vesselCode?: string; status?: string; sourceType?: string } = {}) => {
      const p = new URLSearchParams();
      if (f.vesselCode) p.set("vesselCode",  f.vesselCode);
      if (f.status)     p.set("status",      f.status);
      if (f.sourceType) p.set("sourceType",  f.sourceType);
      const q = p.toString();
      return request<ApiResponse<any>>(`/app/deferrals${q ? "?" + q : ""}`, { method: "GET" });
    },
  },

  rca: {
    list: (f: { vesselCode?: string; status?: string } = {}) => {
      const p = new URLSearchParams();
      if (f.vesselCode) p.set("vesselCode", f.vesselCode);
      if (f.status)     p.set("status",     f.status);
      const q = p.toString();
      return request<ApiResponse<any>>(`/app/rca${q ? "?" + q : ""}`, { method: "GET" });
    },
  },

  capa: {
    list: (f: { vesselCode?: string; status?: string } = {}) => {
      const p = new URLSearchParams();
      if (f.vesselCode) p.set("vesselCode", f.vesselCode);
      if (f.status)     p.set("status",     f.status);
      const q = p.toString();
      return request<ApiResponse<any>>(`/app/capa${q ? "?" + q : ""}`, { method: "GET" });
    },
  },

  inspections: {
    list: (f: { vesselCode?: string; status?: string; type?: string } = {}) => {
      const p = new URLSearchParams();
      if (f.vesselCode) p.set("vesselCode", f.vesselCode);
      if (f.status)     p.set("status",     f.status);
      if (f.type)       p.set("type",       f.type);
      const q = p.toString();
      return request<ApiResponse<any>>(`/app/inspections${q ? "?" + q : ""}`, { method: "GET" });
    },
  },

  inspectionLogs: {
    list: (f: { vesselCode?: string; inspectionId?: string; type?: string } = {}) => {
      const p = new URLSearchParams();
      if (f.vesselCode)   p.set("vesselCode",   f.vesselCode);
      if (f.inspectionId) p.set("inspectionId", f.inspectionId);
      if (f.type)         p.set("type",          f.type);
      const q = p.toString();
      return request<ApiResponse<any>>(`/app/inspection-logs${q ? "?" + q : ""}`, { method: "GET" });
    },
  },

  certificates: {
    list: (f: { vesselCode?: string; status?: string; type?: string } = {}) => {
      const p = new URLSearchParams();
      if (f.vesselCode) p.set("vesselCode", f.vesselCode);
      if (f.status)     p.set("status",     f.status);
      if (f.type)       p.set("type",       f.type);
      const q = p.toString();
      return request<ApiResponse<any>>(`/app/certificates${q ? "?" + q : ""}`, { method: "GET" });
    },
  },

  attachments: {
    list: (f: { vesselCode?: string; entityType?: string; entityId?: string } = {}) => {
      const p = new URLSearchParams();
      if (f.vesselCode) p.set("vesselCode", f.vesselCode);
      if (f.entityType) p.set("entityType", f.entityType);
      if (f.entityId)   p.set("entityId",   f.entityId);
      const q = p.toString();
      return request<ApiResponse<any>>(`/app/attachments${q ? "?" + q : ""}`, { method: "GET" });
    },
  },

  aiInsights: {
    list: (f: { vesselCode?: string; status?: string; insightType?: string } = {}) => {
      const p = new URLSearchParams();
      if (f.vesselCode)  p.set("vesselCode",  f.vesselCode);
      if (f.status)      p.set("status",      f.status);
      if (f.insightType) p.set("insightType", f.insightType);
      const q = p.toString();
      return request<ApiResponse<any>>(`/app/ai-insights${q ? "?" + q : ""}`, { method: "GET" });
    },
  },

  dailyReports: {
    list: (vesselCode?: string) => {
      const q = vesselCode ? `?vesselCode=${encodeURIComponent(vesselCode)}` : "";
      return request<ApiResponse<any>>(`/app/daily-reports${q}`, { method: "GET" });
    },
  },

  domainEvents: {
    list: (f: { vesselCode?: string; eventType?: string; entityType?: string } = {}) => {
      const p = new URLSearchParams();
      if (f.vesselCode) p.set("vesselCode", f.vesselCode);
      if (f.eventType)  p.set("eventType",  f.eventType);
      if (f.entityType) p.set("entityType", f.entityType);
      const q = p.toString();
      return request<ApiResponse<any>>(`/app/domain-events${q ? "?" + q : ""}`, { method: "GET" });
    },
  },

  // ── Tenant – additional modules (backward-compat for existing page files) ───
  providers: {
    list: (f: { vesselCode?: string; status?: string; category?: string } = {}) => {
      const p = new URLSearchParams();
      if (f.vesselCode) p.set("vesselCode", f.vesselCode);
      if (f.status)     p.set("status",     f.status);
      if (f.category)   p.set("category",   f.category);
      const q = p.toString();
      return request<ApiResponse<any>>(`/app/providers${q ? "?" + q : ""}`, { method: "GET" });
    },
  },

  spares: {
    list: (f: { vesselCode?: string; category?: string; status?: string; criticality?: string } = {}) => {
      const p = new URLSearchParams();
      if (f.vesselCode)  p.set("vesselCode",  f.vesselCode);
      if (f.category)    p.set("category",    f.category);
      if (f.status)      p.set("status",      f.status);
      if (f.criticality) p.set("criticality", f.criticality);
      const q = p.toString();
      return request<ApiResponse<any>>(`/app/spares${q ? "?" + q : ""}`, { method: "GET" });
    },
  },

  spareOrders: {
    list: (f: { vesselCode?: string; status?: string; type?: string } = {}) => {
      const p = new URLSearchParams();
      if (f.vesselCode) p.set("vesselCode", f.vesselCode);
      if (f.status)     p.set("status",     f.status);
      if (f.type)       p.set("type",       f.type);
      const q = p.toString();
      return request<ApiResponse<any>>(`/app/spare-orders${q ? "?" + q : ""}`, { method: "GET" });
    },
  },

  stockMovements: {
    list: (f: { vesselCode?: string; movementType?: string; spareId?: string } = {}) => {
      const p = new URLSearchParams();
      if (f.vesselCode)    p.set("vesselCode",    f.vesselCode);
      if (f.movementType)  p.set("movementType",  f.movementType);
      if (f.spareId)       p.set("spareId",       f.spareId);
      const q = p.toString();
      return request<ApiResponse<any>>(`/app/stock-movements${q ? "?" + q : ""}`, { method: "GET" });
    },
  },

  providerEvaluations: {
    list: (f: { vesselCode?: string; providerId?: string; status?: string } = {}) => {
      const p = new URLSearchParams();
      if (f.vesselCode) p.set("vesselCode", f.vesselCode);
      if (f.providerId) p.set("providerId", f.providerId);
      if (f.status)     p.set("status",     f.status);
      const q = p.toString();
      return request<ApiResponse<any>>(`/app/provider-evaluations${q ? "?" + q : ""}`, { method: "GET" });
    },
  },

  providerNonconformities: {
    list: (f: { vesselCode?: string; providerId?: string; status?: string; severity?: string } = {}) => {
      const p = new URLSearchParams();
      if (f.vesselCode) p.set("vesselCode", f.vesselCode);
      if (f.providerId) p.set("providerId", f.providerId);
      if (f.status)     p.set("status",     f.status);
      if (f.severity)   p.set("severity",   f.severity);
      const q = p.toString();
      return request<ApiResponse<any>>(`/app/provider-nonconformities${q ? "?" + q : ""}`, { method: "GET" });
    },
  },

  // ── Platform control plane ─────────────────────────────────────────────────
    platform: {
      tenants: {
      list: (f: { status?: string; slug?: string } = {}) => {
        const p = new URLSearchParams();
        if (f.status) p.set("status", f.status);
        if (f.slug)   p.set("slug",   f.slug);
        const q = p.toString();
        return platformRequest<ApiResponse<any>>(`/platform/tenants${q ? "?" + q : ""}`, { method: "GET" });
      },
      get: (slug: string) =>
        platformRequest<any>(`/platform/tenants/${encodeURIComponent(slug)}`, { method: "GET" }),
      create: (body: any) =>
        platformRequest<any>("/platform/tenants", { method: "POST", body: JSON.stringify(body) }),
      update: (slug: string, body: any) =>
        platformRequest<any>(`/platform/tenants/${encodeURIComponent(slug)}`, { method: "PATCH", body: JSON.stringify(body) }),
    },

    users: {
      list: (f: { status?: string } = {}) => {
        const p = new URLSearchParams();
        if (f.status) p.set("status", f.status);
        const q = p.toString();
        return platformRequest<ApiResponse<any>>(`/platform/users${q ? "?" + q : ""}`, { method: "GET" });
      },
      get: (id: string) => platformRequest<any>(`/platform/users/${encodeURIComponent(id)}`, { method: "GET" }),
      create: (body: any) => platformRequest<any>("/platform/users", { method: "POST", body: JSON.stringify(body) }),
      update: (id: string, body: any) => platformRequest<any>(`/platform/users/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) }),
    },

    auditEvents: {
      list: (f: { tenantSlug?: string; actorId?: string; action?: string } = {}) => {
        const p = new URLSearchParams();
        if (f.tenantSlug) p.set("tenantSlug", f.tenantSlug);
        if (f.actorId)    p.set("actorId",    f.actorId);
        if (f.action)     p.set("action",     f.action);
        const q = p.toString();
        return platformRequest<ApiResponse<any>>(`/platform/audit-events${q ? "?" + q : ""}`, { method: "GET" });
      },
    },

    prompts: {
      list: (f: { capability?: string; locale?: string } = {}) => {
        const p = new URLSearchParams();
        if (f.capability) p.set("capability", f.capability);
        if (f.locale)     p.set("locale",     f.locale);
        const q = p.toString();
        return platformRequest<ApiResponse<any>>(`/platform/prompts${q ? "?" + q : ""}`, { method: "GET" });
      },
      get:      (id: string) => platformRequest<any>(`/platform/prompts/${id}`, { method: "GET" }),
      create:   (body: any)  => platformRequest<any>("/platform/prompts", { method: "POST", body: JSON.stringify(body) }),
      update:   (id: string, body: any) => platformRequest<any>(`/platform/prompts/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
      publish:  (id: string) => platformRequest<any>(`/platform/prompts/${id}/publish`, { method: "POST" }),
      rollback: (id: string) => platformRequest<any>(`/platform/prompts/${id}/rollback`, { method: "POST" }),
    },

    tenantDomains: {
      list:   (tenantSlug: string) => platformRequest<ApiResponse<any>>(`/platform/tenants/${tenantSlug}/domains`, { method: "GET" }),
      create: (tenantSlug: string, body: any) => platformRequest<any>(`/platform/tenants/${tenantSlug}/domains`, { method: "POST", body: JSON.stringify(body) }),
      delete: (tenantSlug: string, id: string) => platformRequest<any>(`/platform/tenants/${tenantSlug}/domains/${id}`, { method: "DELETE" }),
      update: (tenantSlug: string, id: string, body: any) => platformRequest<any>(`/platform/tenants/${tenantSlug}/domains/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    },

    tenantInvitations: {
      list:   (tenantSlug: string) => platformRequest<ApiResponse<any>>(`/platform/tenants/${tenantSlug}/invitations`, { method: "GET" }),
      create: (tenantSlug: string, body: any) => platformRequest<any>(`/platform/tenants/${tenantSlug}/invitations`, { method: "POST", body: JSON.stringify(body) }),
      delete: (tenantSlug: string, id: string) => platformRequest<any>(`/platform/tenants/${tenantSlug}/invitations/${id}`, { method: "DELETE" }),
    },

    tenantUsers: {
      list: (tenantSlug: string, f: { role?: string; status?: string } = {}) => {
        const p = new URLSearchParams();
        if (f.role)   p.set("role",   f.role);
        if (f.status) p.set("status", f.status);
        const q = p.toString();
        return platformRequest<ApiResponse<any>>(`/platform/tenants/${tenantSlug}/users${q ? "?" + q : ""}`, { method: "GET" });
      },
      get: (tenantSlug: string, userId: string) =>
        platformRequest<any>(`/platform/tenants/${tenantSlug}/users/${userId}`, { method: "GET" }),
      create: (tenantSlug: string, body: any) =>
        platformRequest<any>(`/platform/tenants/${tenantSlug}/users`, { method: "POST", body: JSON.stringify(body) }),
      update: (tenantSlug: string, userId: string, body: any) =>
        platformRequest<any>(`/platform/tenants/${tenantSlug}/users/${userId}`, { method: "PATCH", body: JSON.stringify(body) }),
    },
  },
};
