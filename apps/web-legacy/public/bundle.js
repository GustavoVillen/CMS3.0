"use strict";
(() => {
  // src/api.ts
  var _baseUrl = "";
  var _tenantSlug = null;
  function setBaseUrl(url) {
    _baseUrl = url;
  }
  function setApiTenantSlug(slug) {
    _tenantSlug = slug;
  }
  function tenantToken() {
    return typeof window !== "undefined" ? localStorage.getItem("pms_tenant_token") : null;
  }
  function platformToken() {
    return typeof window !== "undefined" ? localStorage.getItem("pms_platform_token") : null;
  }
  async function request(endpoint, options = {}) {
    const token = tenantToken();
    const headers = {
      "Content-Type": "application/json",
      ...options.headers
    };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    if (_tenantSlug) headers["X-Tenant-Slug"] = _tenantSlug;
    const resp = await fetch(`${_baseUrl}${endpoint}`, { ...options, headers });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ message: "Request failed" }));
      throw new Error(err.message || `HTTP ${resp.status}`);
    }
    return resp.json();
  }
  async function platformRequest(endpoint, options = {}) {
    const token = platformToken();
    const headers = {
      "Content-Type": "application/json",
      ...options.headers
    };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const resp = await fetch(`${_baseUrl}${endpoint}`, { ...options, headers });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ message: "Request failed" }));
      throw new Error(err.message || `HTTP ${resp.status}`);
    }
    return resp.json();
  }
  var api = {
    // ── Auth ───────────────────────────────────────────────────────────────────
    auth: {
      loginTenant: (payload) => request("/app/auth/login", { method: "POST", body: JSON.stringify(payload) }),
      loginPlatform: (payload) => platformRequest("/platform/auth/login", { method: "POST", body: JSON.stringify(payload) })
    },
    // ── Public ─────────────────────────────────────────────────────────────────
    bootstrap: {
      get: (tenant) => request(`/public/bootstrap?tenant=${encodeURIComponent(tenant)}`, { method: "GET" })
    },
    // ── Tenant – current user ──────────────────────────────────────────────────
    me: {
      get: () => request("/app/me", { method: "GET" })
    },
    // ── Tenant – domain modules ────────────────────────────────────────────────
    vessels: {
      list: () => request("/app/vessels", { method: "GET" })
    },
    assets: {
      list: (vesselCode) => {
        const q = vesselCode ? `?vesselCode=${encodeURIComponent(vesselCode)}` : "";
        return request(`/app/assets${q}`, { method: "GET" });
      }
    },
    maintenancePlans: {
      list: (f = {}) => {
        const p = new URLSearchParams();
        if (f.vesselCode) p.set("vesselCode", f.vesselCode);
        if (f.status) p.set("status", f.status);
        if (f.triggerType) p.set("triggerType", f.triggerType);
        const q = p.toString();
        return request(`/app/maintenance-plans${q ? "?" + q : ""}`, { method: "GET" });
      }
    },
    workOrders: {
      list: (f = {}) => {
        const p = new URLSearchParams();
        if (f.vesselCode) p.set("vesselCode", f.vesselCode);
        if (f.status) p.set("status", f.status);
        if (f.type) p.set("type", f.type);
        const q = p.toString();
        return request(`/app/work-orders${q ? "?" + q : ""}`, { method: "GET" });
      }
    },
    defects: {
      list: (f = {}) => {
        const p = new URLSearchParams();
        if (f.vesselCode) p.set("vesselCode", f.vesselCode);
        if (f.status) p.set("status", f.status);
        if (f.severity) p.set("severity", f.severity);
        const q = p.toString();
        return request(`/app/defects${q ? "?" + q : ""}`, { method: "GET" });
      }
    },
    deferrals: {
      list: (f = {}) => {
        const p = new URLSearchParams();
        if (f.vesselCode) p.set("vesselCode", f.vesselCode);
        if (f.status) p.set("status", f.status);
        if (f.sourceType) p.set("sourceType", f.sourceType);
        const q = p.toString();
        return request(`/app/deferrals${q ? "?" + q : ""}`, { method: "GET" });
      }
    },
    rca: {
      list: (f = {}) => {
        const p = new URLSearchParams();
        if (f.vesselCode) p.set("vesselCode", f.vesselCode);
        if (f.status) p.set("status", f.status);
        const q = p.toString();
        return request(`/app/rca${q ? "?" + q : ""}`, { method: "GET" });
      }
    },
    capa: {
      list: (f = {}) => {
        const p = new URLSearchParams();
        if (f.vesselCode) p.set("vesselCode", f.vesselCode);
        if (f.status) p.set("status", f.status);
        const q = p.toString();
        return request(`/app/capa${q ? "?" + q : ""}`, { method: "GET" });
      }
    },
    inspections: {
      list: (f = {}) => {
        const p = new URLSearchParams();
        if (f.vesselCode) p.set("vesselCode", f.vesselCode);
        if (f.status) p.set("status", f.status);
        if (f.type) p.set("type", f.type);
        const q = p.toString();
        return request(`/app/inspections${q ? "?" + q : ""}`, { method: "GET" });
      }
    },
    inspectionLogs: {
      list: (f = {}) => {
        const p = new URLSearchParams();
        if (f.vesselCode) p.set("vesselCode", f.vesselCode);
        if (f.inspectionId) p.set("inspectionId", f.inspectionId);
        if (f.type) p.set("type", f.type);
        const q = p.toString();
        return request(`/app/inspection-logs${q ? "?" + q : ""}`, { method: "GET" });
      }
    },
    certificates: {
      list: (f = {}) => {
        const p = new URLSearchParams();
        if (f.vesselCode) p.set("vesselCode", f.vesselCode);
        if (f.status) p.set("status", f.status);
        if (f.type) p.set("type", f.type);
        const q = p.toString();
        return request(`/app/certificates${q ? "?" + q : ""}`, { method: "GET" });
      }
    },
    attachments: {
      list: (f = {}) => {
        const p = new URLSearchParams();
        if (f.vesselCode) p.set("vesselCode", f.vesselCode);
        if (f.entityType) p.set("entityType", f.entityType);
        if (f.entityId) p.set("entityId", f.entityId);
        const q = p.toString();
        return request(`/app/attachments${q ? "?" + q : ""}`, { method: "GET" });
      }
    },
    aiInsights: {
      list: (f = {}) => {
        const p = new URLSearchParams();
        if (f.vesselCode) p.set("vesselCode", f.vesselCode);
        if (f.status) p.set("status", f.status);
        if (f.insightType) p.set("insightType", f.insightType);
        const q = p.toString();
        return request(`/app/ai-insights${q ? "?" + q : ""}`, { method: "GET" });
      }
    },
    dailyReports: {
      list: (vesselCode) => {
        const q = vesselCode ? `?vesselCode=${encodeURIComponent(vesselCode)}` : "";
        return request(`/app/daily-reports${q}`, { method: "GET" });
      }
    },
    domainEvents: {
      list: (f = {}) => {
        const p = new URLSearchParams();
        if (f.vesselCode) p.set("vesselCode", f.vesselCode);
        if (f.eventType) p.set("eventType", f.eventType);
        if (f.entityType) p.set("entityType", f.entityType);
        const q = p.toString();
        return request(`/app/domain-events${q ? "?" + q : ""}`, { method: "GET" });
      }
    },
    // ── Tenant – additional modules (backward-compat for existing page files) ───
    providers: {
      list: (f = {}) => {
        const p = new URLSearchParams();
        if (f.vesselCode) p.set("vesselCode", f.vesselCode);
        if (f.status) p.set("status", f.status);
        if (f.category) p.set("category", f.category);
        const q = p.toString();
        return request(`/app/providers${q ? "?" + q : ""}`, { method: "GET" });
      }
    },
    spares: {
      list: (f = {}) => {
        const p = new URLSearchParams();
        if (f.vesselCode) p.set("vesselCode", f.vesselCode);
        if (f.category) p.set("category", f.category);
        if (f.status) p.set("status", f.status);
        if (f.criticality) p.set("criticality", f.criticality);
        const q = p.toString();
        return request(`/app/spares${q ? "?" + q : ""}`, { method: "GET" });
      }
    },
    spareOrders: {
      list: (f = {}) => {
        const p = new URLSearchParams();
        if (f.vesselCode) p.set("vesselCode", f.vesselCode);
        if (f.status) p.set("status", f.status);
        if (f.type) p.set("type", f.type);
        const q = p.toString();
        return request(`/app/spare-orders${q ? "?" + q : ""}`, { method: "GET" });
      }
    },
    stockMovements: {
      list: (f = {}) => {
        const p = new URLSearchParams();
        if (f.vesselCode) p.set("vesselCode", f.vesselCode);
        if (f.movementType) p.set("movementType", f.movementType);
        if (f.spareId) p.set("spareId", f.spareId);
        const q = p.toString();
        return request(`/app/stock-movements${q ? "?" + q : ""}`, { method: "GET" });
      }
    },
    providerEvaluations: {
      list: (f = {}) => {
        const p = new URLSearchParams();
        if (f.vesselCode) p.set("vesselCode", f.vesselCode);
        if (f.providerId) p.set("providerId", f.providerId);
        if (f.status) p.set("status", f.status);
        const q = p.toString();
        return request(`/app/provider-evaluations${q ? "?" + q : ""}`, { method: "GET" });
      }
    },
    providerNonconformities: {
      list: (f = {}) => {
        const p = new URLSearchParams();
        if (f.vesselCode) p.set("vesselCode", f.vesselCode);
        if (f.providerId) p.set("providerId", f.providerId);
        if (f.status) p.set("status", f.status);
        if (f.severity) p.set("severity", f.severity);
        const q = p.toString();
        return request(`/app/provider-nonconformities${q ? "?" + q : ""}`, { method: "GET" });
      }
    },
    // ── Platform control plane ─────────────────────────────────────────────────
    platform: {
      tenants: {
        list: (f = {}) => {
          const p = new URLSearchParams();
          if (f.status) p.set("status", f.status);
          if (f.slug) p.set("slug", f.slug);
          const q = p.toString();
          return platformRequest(`/platform/tenants${q ? "?" + q : ""}`, { method: "GET" });
        },
        get: (slug) => platformRequest(`/platform/tenants/${encodeURIComponent(slug)}`, { method: "GET" }),
        create: (body) => platformRequest("/platform/tenants", { method: "POST", body: JSON.stringify(body) }),
        update: (slug, body) => platformRequest(`/platform/tenants/${encodeURIComponent(slug)}`, { method: "PATCH", body: JSON.stringify(body) })
      },
      users: {
        list: (f = {}) => {
          const p = new URLSearchParams();
          if (f.status) p.set("status", f.status);
          const q = p.toString();
          return platformRequest(`/platform/users${q ? "?" + q : ""}`, { method: "GET" });
        },
        get: (id) => platformRequest(`/platform/users/${encodeURIComponent(id)}`, { method: "GET" }),
        create: (body) => platformRequest("/platform/users", { method: "POST", body: JSON.stringify(body) }),
        update: (id, body) => platformRequest(`/platform/users/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) })
      },
      auditEvents: {
        list: (f = {}) => {
          const p = new URLSearchParams();
          if (f.tenantSlug) p.set("tenantSlug", f.tenantSlug);
          if (f.actorId) p.set("actorId", f.actorId);
          if (f.action) p.set("action", f.action);
          const q = p.toString();
          return platformRequest(`/platform/audit-events${q ? "?" + q : ""}`, { method: "GET" });
        }
      },
      prompts: {
        list: (f = {}) => {
          const p = new URLSearchParams();
          if (f.capability) p.set("capability", f.capability);
          if (f.locale) p.set("locale", f.locale);
          const q = p.toString();
          return platformRequest(`/platform/prompts${q ? "?" + q : ""}`, { method: "GET" });
        },
        get: (id) => platformRequest(`/platform/prompts/${id}`, { method: "GET" }),
        create: (body) => platformRequest("/platform/prompts", { method: "POST", body: JSON.stringify(body) }),
        update: (id, body) => platformRequest(`/platform/prompts/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
        publish: (id) => platformRequest(`/platform/prompts/${id}/publish`, { method: "POST" }),
        rollback: (id) => platformRequest(`/platform/prompts/${id}/rollback`, { method: "POST" })
      },
      tenantDomains: {
        list: (tenantSlug) => platformRequest(`/platform/tenants/${tenantSlug}/domains`, { method: "GET" }),
        create: (tenantSlug, body) => platformRequest(`/platform/tenants/${tenantSlug}/domains`, { method: "POST", body: JSON.stringify(body) }),
        delete: (tenantSlug, id) => platformRequest(`/platform/tenants/${tenantSlug}/domains/${id}`, { method: "DELETE" }),
        update: (tenantSlug, id, body) => platformRequest(`/platform/tenants/${tenantSlug}/domains/${id}`, { method: "PATCH", body: JSON.stringify(body) })
      },
      tenantInvitations: {
        list: (tenantSlug) => platformRequest(`/platform/tenants/${tenantSlug}/invitations`, { method: "GET" }),
        create: (tenantSlug, body) => platformRequest(`/platform/tenants/${tenantSlug}/invitations`, { method: "POST", body: JSON.stringify(body) }),
        delete: (tenantSlug, id) => platformRequest(`/platform/tenants/${tenantSlug}/invitations/${id}`, { method: "DELETE" })
      },
      tenantUsers: {
        list: (tenantSlug, f = {}) => {
          const p = new URLSearchParams();
          if (f.role) p.set("role", f.role);
          if (f.status) p.set("status", f.status);
          const q = p.toString();
          return platformRequest(`/platform/tenants/${tenantSlug}/users${q ? "?" + q : ""}`, { method: "GET" });
        },
        get: (tenantSlug, userId) => platformRequest(`/platform/tenants/${tenantSlug}/users/${userId}`, { method: "GET" }),
        create: (tenantSlug, body) => platformRequest(`/platform/tenants/${tenantSlug}/users`, { method: "POST", body: JSON.stringify(body) }),
        update: (tenantSlug, userId, body) => platformRequest(`/platform/tenants/${tenantSlug}/users/${userId}`, { method: "PATCH", body: JSON.stringify(body) })
      }
    }
  };

  // src/i18n.ts
  var dictionary = {
    en: {
      // App
      "app.title": "PMS SaaS",
      // Tenant nav
      "nav.dashboard": "Dashboard",
      "nav.vessels": "Vessels",
      "nav.assets": "Assets",
      "nav.maintenance": "Maintenance Plans",
      "nav.workOrders": "Work Orders",
      "nav.dailyReports": "Daily Reports",
      "nav.defects": "Defects",
      "nav.deferrals": "Deferrals",
      "nav.rca": "RCA",
      "nav.capa": "CAPA",
      "nav.inspections": "Inspections",
      "nav.inspectionLogs": "Inspection Logs",
      "nav.certificates": "Certificates",
      "nav.attachments": "Attachments",
      "nav.aiInsights": "AI Insights",
      "nav.domainEvents": "Domain Events",
      "nav.spares": "Spares",
      "nav.stockMovements": "Stock Movements",
      "nav.providers": "Providers",
      "nav.spareOrders": "Spare Orders",
      "nav.providerEvals": "Provider Evaluations",
      "nav.providerNC": "Non-Conformities",
      "nav.logout": "Sign out",
      // Common
      "common.loading": "Loading\u2026",
      "common.noData": "No data available",
      "common.error": "An error occurred",
      "common.actions": "Actions",
      "common.edit": "Edit",
      "common.save": "Save",
      "common.cancel": "Cancel",
      "common.delete": "Delete",
      "common.send": "Send",
      "common.status": "Status",
      "common.code": "Code",
      "common.name": "Name",
      "common.title": "Title",
      "common.vessel": "Vessel",
      "common.priority": "Priority",
      "common.type": "Type",
      "common.date": "Date",
      "common.description": "Description",
      "common.createdAt": "Created",
      "common.updatedAt": "Updated",
      "common.slug": "Slug",
      "common.email": "Email",
      "common.role": "Role",
      "common.locale": "Locale",
      "common.currency": "Currency",
      "common.timezone": "Timezone",
      "common.allVessels": "All Vessels",
      "common.allCategories": "All Categories",
      "common.allStatus": "All Status",
      "common.allTypes": "All Types",
      "common.allSeverity": "All Severity",
      "common.allActions": "All Actions",
      "common.allCapabilities": "All Capabilities",
      "common.yes": "Yes",
      // Dashboard
      "dashboard.title": "Dashboard",
      "dashboard.aiInsights": "AI Insights",
      "dashboard.noInsights": "No insights available",
      // Login
      "login.tenant.title": "Tenant Sign In",
      "login.tenant.sub": "Enter your credentials",
      "login.tenant.field": "Tenant",
      "login.user.field": "Email or User ID",
      "login.password.field": "Password",
      "login.submit": "Sign in",
      "login.platform.link": "Platform admin?",
      "login.platform.title": "Platform Sign In",
      "login.platform.sub": "Superadmin access",
      "login.back.tenant": "Back to tenant sign in",
      // Platform
      "platform.label": "Control Plane",
      "platform.nav.section": "Administration",
      "platform.nav.tenants": "Tenants",
      "platform.nav.users": "Platform Users",
      "platform.nav.prompts": "AI Prompts",
      "platform.nav.audit": "Audit Events",
      "platform.role.SUPERADMIN": "Superadmin",
      "platform.role.SUPPORT": "Support",
      "platform.tenants.title": "Tenants",
      "platform.tenants.empty": "No tenants found",
      "platform.tenants.slug": "Slug",
      "platform.tenants.display": "Display Name",
      "platform.tenants.status": "Status",
      "platform.tenants.locale": "Default Locale",
      "platform.tenants.created": "Created",
      "platform.tenants.plan": "Plan",
      "platform.tenants.new": "New Tenant",
      "platform.tenants.details": "Tenant Details",
      "platform.tenants.manage": "Manage Tenant",
      "platform.tenants.noTenant": "Tenant not found",
      "platform.domains.title": "Domains",
      "platform.domains.add": "Add Domain",
      "platform.domains.host": "Domain",
      "platform.domains.primary": "Primary",
      "platform.domains.empty": "No domains",
      "platform.domains.noTenant": "Select a tenant first",
      "platform.domains.confirmDelete": "Delete domain?",
      "platform.invitations.title": "Invitations",
      "platform.invitations.send": "Send Invitation",
      "platform.invitations.expires": "Expires",
      "platform.invitations.empty": "No invitations",
      "platform.invitations.noTenant": "Select a tenant first",
      "platform.invitations.confirmDelete": "Delete invitation?",
      "platform.tenantUsers.title": "Tenant Users",
      "platform.tenantUsers.new": "Add User",
      "platform.tenantUsers.empty": "No users",
      "platform.tenantUsers.noTenant": "Select a tenant first",
      "platform.tenantUsers.lastLogin": "Last Login",
      "platform.users.title": "Platform Users",
      "platform.users.new": "New User",
      "platform.users.empty": "No users",
      "platform.users.password": "Password",
      "platform.prompts.title": "Prompts",
      "platform.prompts.new": "New Prompt",
      "platform.prompts.empty": "No prompts",
      "platform.prompts.capability": "Capability",
      "platform.prompts.version": "Version",
      "platform.prompts.published": "Published",
      "platform.prompts.content": "Content",
      "platform.prompts.confirmRollback": "Rollback to previous version?",
      "platform.prompts.publishedStatus": "Published",
      "platform.prompts.draftStatus": "Draft",
      "platform.audit.title": "Audit Events",
      "platform.audit.empty": "No events",
      "platform.audit.tenant": "Tenant",
      "platform.audit.user": "User",
      "platform.audit.action": "Action",
      "platform.audit.entity": "Entity",
      "platform.audit.details": "Details",
      "platform.audit.tenantPlaceholder": "Search tenant...",
      "platform.audit.userPlaceholder": "Search user...",
      "platform.common.back": "Back",
      "spares.number": "Spare #",
      "spares.category": "Category",
      "spares.location": "Location",
      "spares.stock": "Stock",
      "spares.minStock": "Min Stock",
      "spares.unit": "Unit",
      "stockMovements.number": "Movement #",
      "stockMovements.spare": "Spare",
      "stockMovements.quantity": "Quantity",
      "stockMovements.reference": "Reference",
      "stockMovements.performedBy": "Performed By",
      "stockMovements.spareSearch": "Spare Search",
      "stockMovements.spareSearchPlaceholder": "Search spare...",
      "providers.number": "Provider #",
      "providers.category": "Category",
      "providers.contact": "Contact",
      "providers.phone": "Phone",
      "spareOrders.number": "Order #",
      "spareOrders.provider": "Provider",
      "spareOrders.orderDate": "Order Date",
      "spareOrders.expectedDate": "Expected Date",
      "spareOrders.total": "Total",
      "providerEvaluations.number": "Evaluation #",
      "providerEvaluations.provider": "Provider",
      "providerEvaluations.period": "Period",
      "providerEvaluations.score": "Score",
      "providerEvaluations.quality": "Quality",
      "providerEvaluations.delivery": "Delivery",
      "providerEvaluations.communication": "Communication",
      "providerEvaluations.evaluatedBy": "Evaluated By",
      "providerEvaluations.date": "Date",
      "providerEvaluations.providerSearch": "Provider Search",
      "providerEvaluations.providerSearchPlaceholder": "Search provider...",
      "providerNC.number": "NC #",
      "providerNC.provider": "Provider",
      "providerNC.type": "Type",
      "providerNC.severity": "Severity",
      "providerNC.description": "Description",
      "providerNC.reportedDate": "Reported Date",
      "providerNC.responseDue": "Response Due",
      "providerNC.responseDate": "Response Date",
      "providerNC.providerSearch": "Provider Search",
      "providerNC.providerSearchPlaceholder": "Search provider..."
    },
    es: {
      "app.title": "PMS SaaS",
      "nav.dashboard": "Panel",
      "nav.vessels": "Embarcaciones",
      "nav.assets": "Activos",
      "nav.maintenance": "Planes de Mantenimiento",
      "nav.workOrders": "\xD3rdenes de Trabajo",
      "nav.dailyReports": "Reportes Diarios",
      "nav.defects": "Defectos",
      "nav.deferrals": "Aplazamientos",
      "nav.rca": "RCA",
      "nav.capa": "CAPA",
      "nav.inspections": "Inspecciones",
      "nav.inspectionLogs": "Registros de Inspecci\xF3n",
      "nav.certificates": "Certificados",
      "nav.attachments": "Adjuntos",
      "nav.aiInsights": "Insights de IA",
      "nav.domainEvents": "Eventos de Dominio",
      "nav.providers": "Proveedores",
      "nav.spareOrders": "Pedidos de Repuestos",
      "nav.logout": "Cerrar sesi\xF3n",
      "common.loading": "Cargando\u2026",
      "common.noData": "No hay datos disponibles",
      "common.error": "Ocurri\xF3 un error",
      "common.actions": "Acciones",
      "common.status": "Estado",
      "common.code": "C\xF3digo",
      "common.name": "Nombre",
      "common.vessel": "Embarcaci\xF3n",
      "common.priority": "Prioridad",
      "common.type": "Tipo",
      "common.date": "Fecha",
      "common.description": "Descripci\xF3n",
      "common.createdAt": "Creado",
      "common.slug": "Slug",
      "common.email": "Email",
      "common.role": "Rol",
      "common.locale": "Idioma",
      "common.currency": "Moneda",
      "common.timezone": "Zona horaria",
      "dashboard.title": "Panel",
      "dashboard.aiInsights": "Insights de IA",
      "dashboard.noInsights": "No hay insights disponibles",
      "login.tenant.title": "Acceso Tenant",
      "login.tenant.sub": "Ingrese sus credenciales",
      "login.tenant.field": "Tenant",
      "login.user.field": "Email o ID de usuario",
      "login.password.field": "Contrase\xF1a",
      "login.submit": "Ingresar",
      "login.platform.link": "\xBFAdmin de plataforma?",
      "login.platform.title": "Acceso Plataforma",
      "login.platform.sub": "Acceso superadmin",
      "login.back.tenant": "Volver al acceso tenant",
      "platform.label": "Plano de Control",
      "platform.nav.section": "Administraci\xF3n",
      "platform.nav.tenants": "Tenants",
      "platform.nav.users": "Usuarios Plataforma",
      "platform.nav.prompts": "Prompts de IA",
      "platform.role.SUPERADMIN": "Superadmin",
      "platform.role.SUPPORT": "Soporte",
      "platform.tenants.title": "Tenants",
      "platform.tenants.empty": "No hay tenants",
      "platform.tenants.slug": "Slug",
      "platform.tenants.display": "Nombre",
      "platform.tenants.status": "Estado",
      "platform.tenants.locale": "Idioma por defecto",
      "platform.tenants.created": "Creado",
      "nav.spares": "Repuestos",
      "nav.stockMovements": "Movimientos de Stock",
      "nav.providerEvals": "Evaluaciones de Proveedores",
      "nav.providerNC": "No Conformidades",
      "common.edit": "Editar",
      "common.save": "Guardar",
      "common.cancel": "Cancelar",
      "common.delete": "Eliminar",
      "common.send": "Enviar",
      "common.title": "T\xEDtulo",
      "common.updatedAt": "Actualizado",
      "common.allVessels": "Todas las Embarcaciones",
      "common.allCategories": "Todas las Categor\xEDas",
      "common.allStatus": "Todos los Estados",
      "common.allTypes": "Todos los Tipos",
      "common.allSeverity": "Todas las Severidades",
      "common.allActions": "Todas las Acciones",
      "common.allCapabilities": "Todas las Capacidades",
      "common.yes": "S\xED",
      "platform.nav.audit": "Eventos de Auditor\xEDa",
      "platform.tenants.plan": "Plan",
      "platform.tenants.new": "Nuevo Tenant",
      "platform.tenants.details": "Detalle del Tenant",
      "platform.tenants.manage": "Gestionar Tenant",
      "platform.tenants.noTenant": "Tenant no encontrado",
      "platform.domains.title": "Dominios",
      "platform.domains.add": "Agregar Dominio",
      "platform.domains.host": "Dominio",
      "platform.domains.primary": "Principal",
      "platform.domains.empty": "Sin dominios",
      "platform.domains.noTenant": "Seleccione un tenant",
      "platform.domains.confirmDelete": "\xBFEliminar dominio?",
      "platform.invitations.title": "Invitaciones",
      "platform.invitations.send": "Enviar Invitaci\xF3n",
      "platform.invitations.expires": "Expira",
      "platform.invitations.empty": "Sin invitaciones",
      "platform.invitations.noTenant": "Seleccione un tenant",
      "platform.invitations.confirmDelete": "\xBFEliminar invitaci\xF3n?",
      "platform.tenantUsers.title": "Usuarios del Tenant",
      "platform.tenantUsers.new": "Agregar Usuario",
      "platform.tenantUsers.empty": "Sin usuarios",
      "platform.tenantUsers.noTenant": "Seleccione un tenant",
      "platform.tenantUsers.lastLogin": "\xDAltimo acceso",
      "platform.users.title": "Usuarios Plataforma",
      "platform.users.new": "Nuevo Usuario",
      "platform.users.empty": "Sin usuarios",
      "platform.users.password": "Contrase\xF1a",
      "platform.prompts.title": "Prompts",
      "platform.prompts.new": "Nuevo Prompt",
      "platform.prompts.empty": "Sin prompts",
      "platform.prompts.capability": "Capacidad",
      "platform.prompts.version": "Versi\xF3n",
      "platform.prompts.published": "Publicado",
      "platform.prompts.content": "Contenido",
      "platform.prompts.confirmRollback": "\xBFRollback a versi\xF3n anterior?",
      "platform.prompts.publishedStatus": "Publicado",
      "platform.prompts.draftStatus": "Borrador",
      "platform.audit.title": "Eventos de Auditor\xEDa",
      "platform.audit.empty": "Sin eventos",
      "platform.audit.tenant": "Tenant",
      "platform.audit.user": "Usuario",
      "platform.audit.action": "Acci\xF3n",
      "platform.audit.entity": "Entidad",
      "platform.audit.details": "Detalles",
      "platform.audit.tenantPlaceholder": "Buscar tenant...",
      "platform.audit.userPlaceholder": "Buscar usuario...",
      "platform.common.back": "Volver",
      "spares.number": "Repuesto #",
      "spares.category": "Categor\xEDa",
      "spares.location": "Ubicaci\xF3n",
      "spares.stock": "Stock",
      "spares.minStock": "Stock m\xEDnimo",
      "spares.unit": "Unidad",
      "stockMovements.number": "Movimiento #",
      "stockMovements.spare": "Repuesto",
      "stockMovements.quantity": "Cantidad",
      "stockMovements.reference": "Referencia",
      "stockMovements.performedBy": "Realizado por",
      "stockMovements.spareSearch": "Buscar repuesto",
      "stockMovements.spareSearchPlaceholder": "Buscar repuesto...",
      "providers.number": "Proveedor #",
      "providers.category": "Categor\xEDa",
      "providers.contact": "Contacto",
      "providers.phone": "Tel\xE9fono",
      "spareOrders.number": "Pedido #",
      "spareOrders.provider": "Proveedor",
      "spareOrders.orderDate": "Fecha de pedido",
      "spareOrders.expectedDate": "Fecha esperada",
      "spareOrders.total": "Total",
      "providerEvaluations.number": "Evaluaci\xF3n #",
      "providerEvaluations.provider": "Proveedor",
      "providerEvaluations.period": "Periodo",
      "providerEvaluations.score": "Puntaje",
      "providerEvaluations.quality": "Calidad",
      "providerEvaluations.delivery": "Entrega",
      "providerEvaluations.communication": "Comunicaci\xF3n",
      "providerEvaluations.evaluatedBy": "Evaluado por",
      "providerEvaluations.date": "Fecha",
      "providerEvaluations.providerSearch": "Buscar proveedor",
      "providerEvaluations.providerSearchPlaceholder": "Buscar proveedor...",
      "providerNC.number": "NC #",
      "providerNC.provider": "Proveedor",
      "providerNC.type": "Tipo",
      "providerNC.severity": "Severidad",
      "providerNC.description": "Descripci\xF3n",
      "providerNC.reportedDate": "Fecha reportada",
      "providerNC.responseDue": "Vence respuesta",
      "providerNC.responseDate": "Fecha respuesta",
      "providerNC.providerSearch": "Buscar proveedor",
      "providerNC.providerSearchPlaceholder": "Buscar proveedor..."
    },
    pt: {
      "app.title": "PMS SaaS",
      "nav.dashboard": "Painel",
      "nav.vessels": "Embarca\xE7\xF5es",
      "nav.assets": "Ativos",
      "nav.maintenance": "Planos de Manuten\xE7\xE3o",
      "nav.workOrders": "Ordens de Trabalho",
      "nav.dailyReports": "Relat\xF3rios Di\xE1rios",
      "nav.defects": "Defeitos",
      "nav.deferrals": "Adiamentos",
      "nav.rca": "RCA",
      "nav.capa": "CAPA",
      "nav.inspections": "Inspe\xE7\xF5es",
      "nav.inspectionLogs": "Logs de Inspe\xE7\xE3o",
      "nav.certificates": "Certificados",
      "nav.attachments": "Anexos",
      "nav.aiInsights": "Insights de IA",
      "nav.domainEvents": "Eventos de Dom\xEDnio",
      "nav.providers": "Fornecedores",
      "nav.spareOrders": "Pedidos de Pe\xE7as",
      "nav.logout": "Sair",
      "common.loading": "Carregando\u2026",
      "common.noData": "Sem dados dispon\xEDveis",
      "common.error": "Ocorreu um erro",
      "common.actions": "A\xE7\xF5es",
      "common.status": "Status",
      "common.code": "C\xF3digo",
      "common.name": "Nome",
      "common.vessel": "Embarca\xE7\xE3o",
      "common.priority": "Prioridade",
      "common.type": "Tipo",
      "common.date": "Data",
      "common.description": "Descri\xE7\xE3o",
      "common.createdAt": "Criado em",
      "common.slug": "Slug",
      "common.email": "Email",
      "common.role": "Papel",
      "common.locale": "Idioma",
      "common.currency": "Moeda",
      "common.timezone": "Fuso hor\xE1rio",
      "dashboard.title": "Painel",
      "dashboard.aiInsights": "Insights de IA",
      "dashboard.noInsights": "Sem insights dispon\xEDveis",
      "login.tenant.title": "Acesso Tenant",
      "login.tenant.sub": "Digite suas credenciais",
      "login.tenant.field": "Tenant",
      "login.user.field": "Email ou ID de usu\xE1rio",
      "login.password.field": "Senha",
      "login.submit": "Entrar",
      "login.platform.link": "Admin de plataforma?",
      "login.platform.title": "Acesso Plataforma",
      "login.platform.sub": "Acesso superadmin",
      "login.back.tenant": "Voltar ao acesso tenant",
      "platform.label": "Plano de Controle",
      "platform.nav.section": "Administra\xE7\xE3o",
      "platform.nav.tenants": "Tenants",
      "platform.nav.users": "Usu\xE1rios Plataforma",
      "platform.nav.prompts": "Prompts de IA",
      "platform.role.SUPERADMIN": "Superadmin",
      "platform.role.SUPPORT": "Suporte",
      "platform.tenants.title": "Tenants",
      "platform.tenants.empty": "Nenhum tenant encontrado",
      "platform.tenants.slug": "Slug",
      "platform.tenants.display": "Nome",
      "platform.tenants.status": "Status",
      "platform.tenants.locale": "Idioma padr\xE3o",
      "platform.tenants.created": "Criado",
      "nav.spares": "Pe\xE7as",
      "nav.stockMovements": "Movimentos de Estoque",
      "nav.providerEvals": "Avalia\xE7\xF5es de Fornecedores",
      "nav.providerNC": "N\xE3o Conformidades",
      "common.edit": "Editar",
      "common.save": "Salvar",
      "common.cancel": "Cancelar",
      "common.delete": "Excluir",
      "common.send": "Enviar",
      "common.title": "T\xEDtulo",
      "common.updatedAt": "Atualizado",
      "common.allVessels": "Todas as Embarca\xE7\xF5es",
      "common.allCategories": "Todas as Categorias",
      "common.allStatus": "Todos os Status",
      "common.allTypes": "Todos os Tipos",
      "common.allSeverity": "Todas as Severidades",
      "common.allActions": "Todas as A\xE7\xF5es",
      "common.allCapabilities": "Todas as Capacidades",
      "common.yes": "Sim",
      "platform.nav.audit": "Eventos de Auditoria",
      "platform.tenants.plan": "Plano",
      "platform.tenants.new": "Novo Tenant",
      "platform.tenants.details": "Detalhe do Tenant",
      "platform.tenants.manage": "Gerenciar Tenant",
      "platform.tenants.noTenant": "Tenant n\xE3o encontrado",
      "platform.domains.title": "Dom\xEDnios",
      "platform.domains.add": "Adicionar Dom\xEDnio",
      "platform.domains.host": "Dom\xEDnio",
      "platform.domains.primary": "Principal",
      "platform.domains.empty": "Sem dom\xEDnios",
      "platform.domains.noTenant": "Selecione um tenant",
      "platform.domains.confirmDelete": "Excluir dom\xEDnio?",
      "platform.invitations.title": "Convites",
      "platform.invitations.send": "Enviar Convite",
      "platform.invitations.expires": "Expira",
      "platform.invitations.empty": "Sem convites",
      "platform.invitations.noTenant": "Selecione um tenant",
      "platform.invitations.confirmDelete": "Excluir convite?",
      "platform.tenantUsers.title": "Usu\xE1rios do Tenant",
      "platform.tenantUsers.new": "Adicionar Usu\xE1rio",
      "platform.tenantUsers.empty": "Sem usu\xE1rios",
      "platform.tenantUsers.noTenant": "Selecione um tenant",
      "platform.tenantUsers.lastLogin": "\xDAltimo acesso",
      "platform.users.title": "Usu\xE1rios Plataforma",
      "platform.users.new": "Novo Usu\xE1rio",
      "platform.users.empty": "Sem usu\xE1rios",
      "platform.users.password": "Senha",
      "platform.prompts.title": "Prompts",
      "platform.prompts.new": "Novo Prompt",
      "platform.prompts.empty": "Sem prompts",
      "platform.prompts.capability": "Capacidade",
      "platform.prompts.version": "Vers\xE3o",
      "platform.prompts.published": "Publicado",
      "platform.prompts.content": "Conte\xFAdo",
      "platform.prompts.confirmRollback": "Rollback para vers\xE3o anterior?",
      "platform.prompts.publishedStatus": "Publicado",
      "platform.prompts.draftStatus": "Rascunho",
      "platform.audit.title": "Eventos de Auditoria",
      "platform.audit.empty": "Sem eventos",
      "platform.audit.tenant": "Tenant",
      "platform.audit.user": "Usu\xE1rio",
      "platform.audit.action": "A\xE7\xE3o",
      "platform.audit.entity": "Entidade",
      "platform.audit.details": "Detalhes",
      "platform.audit.tenantPlaceholder": "Buscar tenant...",
      "platform.audit.userPlaceholder": "Buscar usu\xE1rio...",
      "platform.common.back": "Voltar",
      "spares.number": "Pe\xE7a #",
      "spares.category": "Categoria",
      "spares.location": "Localiza\xE7\xE3o",
      "spares.stock": "Estoque",
      "spares.minStock": "Estoque m\xEDnimo",
      "spares.unit": "Unidade",
      "stockMovements.number": "Movimento #",
      "stockMovements.spare": "Pe\xE7a",
      "stockMovements.quantity": "Quantidade",
      "stockMovements.reference": "Refer\xEAncia",
      "stockMovements.performedBy": "Realizado por",
      "stockMovements.spareSearch": "Buscar pe\xE7a",
      "stockMovements.spareSearchPlaceholder": "Buscar pe\xE7a...",
      "providers.number": "Fornecedor #",
      "providers.category": "Categoria",
      "providers.contact": "Contato",
      "providers.phone": "Telefone",
      "spareOrders.number": "Pedido #",
      "spareOrders.provider": "Fornecedor",
      "spareOrders.orderDate": "Data do pedido",
      "spareOrders.expectedDate": "Data esperada",
      "spareOrders.total": "Total",
      "providerEvaluations.number": "Avalia\xE7\xE3o #",
      "providerEvaluations.provider": "Fornecedor",
      "providerEvaluations.period": "Per\xEDodo",
      "providerEvaluations.score": "Pontua\xE7\xE3o",
      "providerEvaluations.quality": "Qualidade",
      "providerEvaluations.delivery": "Entrega",
      "providerEvaluations.communication": "Comunica\xE7\xE3o",
      "providerEvaluations.evaluatedBy": "Avaliado por",
      "providerEvaluations.date": "Data",
      "providerEvaluations.providerSearch": "Buscar fornecedor",
      "providerEvaluations.providerSearchPlaceholder": "Buscar fornecedor...",
      "providerNC.number": "NC #",
      "providerNC.provider": "Fornecedor",
      "providerNC.type": "Tipo",
      "providerNC.severity": "Severidade",
      "providerNC.description": "Descri\xE7\xE3o",
      "providerNC.reportedDate": "Data reportada",
      "providerNC.responseDue": "Resposta vence",
      "providerNC.responseDate": "Data resposta",
      "providerNC.providerSearch": "Buscar fornecedor",
      "providerNC.providerSearchPlaceholder": "Buscar fornecedor..."
    }
  };
  var _locale = "es";
  function setLocale(locale) {
    if (dictionary[locale]) _locale = locale;
  }
  function t(key) {
    return dictionary[_locale]?.[key] ?? dictionary["es"]?.[key] ?? key;
  }
  function formatDate(value) {
    if (!value) return "\u2014";
    return new Date(value).toLocaleDateString(_locale === "pt" ? "pt-BR" : _locale);
  }
  function formatDateTime(value) {
    if (!value) return "\u2014";
    return new Date(value).toLocaleString(_locale === "pt" ? "pt-BR" : _locale);
  }

  // src/session.ts
  var TENANT_SESSION_KEY = "pms_tenant_session";
  var TENANT_TOKEN_KEY = "pms_tenant_token";
  function getTenantSession() {
    if (typeof window === "undefined") return null;
    const raw = localStorage.getItem(TENANT_SESSION_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  function setTenantSession(session) {
    if (typeof window === "undefined") return;
    localStorage.setItem(TENANT_SESSION_KEY, JSON.stringify(session));
    localStorage.setItem(TENANT_TOKEN_KEY, session.accessToken);
  }
  function isTenantAuthenticated() {
    return !!getTenantSession();
  }
  var PLATFORM_SESSION_KEY = "pms_platform_session";
  var PLATFORM_TOKEN_KEY = "pms_platform_token";
  function getPlatformSession() {
    if (typeof window === "undefined") return null;
    const raw = localStorage.getItem(PLATFORM_SESSION_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  function setPlatformSession(session) {
    if (typeof window === "undefined") return;
    localStorage.setItem(PLATFORM_SESSION_KEY, JSON.stringify(session));
    localStorage.setItem(PLATFORM_TOKEN_KEY, session.accessToken);
  }
  function isPlatformAuthenticated() {
    return !!getPlatformSession();
  }

  // src/router.ts
  var SPA_MOUNT = "/ui";
  var _routes = [];
  function getLogicalPath() {
    const full = window.location.pathname;
    if (full === SPA_MOUNT || full === SPA_MOUNT + "/") return "/";
    if (full.startsWith(SPA_MOUNT + "/")) return full.slice(SPA_MOUNT.length);
    return full;
  }
  function navigate(logicalPath) {
    const url = SPA_MOUNT + (logicalPath === "/" ? "" : logicalPath);
    window.history.pushState({}, "", url);
    dispatch();
  }
  function registerRoute(pattern, handler) {
    _routes.push({ pattern, handler });
  }
  function dispatch() {
    const path = getLogicalPath();
    for (const { pattern, handler } of _routes) {
      if (matchesPattern(pattern, path)) {
        void handler();
        return;
      }
    }
    navigate("/app/login");
  }
  function matchesPattern(pattern, path) {
    if (pattern === path) return true;
    if (pattern.endsWith("/*")) {
      const prefix = pattern.slice(0, -2);
      return path === prefix || path.startsWith(prefix + "/");
    }
    return false;
  }
  function initRouter() {
    window.addEventListener("popstate", () => dispatch());
    dispatch();
  }
  function href(logicalPath) {
    return SPA_MOUNT + logicalPath;
  }

  // src/shell.ts
  function parseCellValue(rawText) {
    const text = rawText.trim();
    if (!text) return "";
    const ddmmyyyy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (ddmmyyyy) {
      const [, dd, mm, yyyy] = ddmmyyyy;
      const asDate = Date.parse(`${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`);
      if (!Number.isNaN(asDate)) return asDate;
    }
    const numeric = Number(text.replace(/\./g, "").replace(",", "."));
    if (!Number.isNaN(numeric) && Number.isFinite(numeric)) return numeric;
    return text.toLocaleLowerCase();
  }
  function applyTableSorting(root) {
    const tables = Array.from(root.querySelectorAll("table"));
    for (const table of tables) {
      const thead = table.querySelector("thead");
      const tbody = table.querySelector("tbody");
      const headerRow = thead?.querySelector("tr");
      if (!thead || !tbody || !headerRow) continue;
      const headers = Array.from(headerRow.querySelectorAll("th"));
      headers.forEach((th, index) => {
        const title = (th.textContent ?? "").trim();
        if (!title) return;
        th.style.cursor = "pointer";
        th.style.userSelect = "none";
        th.setAttribute("data-sort-direction", "none");
        const baseLabel = title;
        const renderHeader = (dir) => {
          const suffix = dir === "none" ? " \u2195" : dir === "asc" ? " \u2191" : " \u2193";
          th.textContent = `${baseLabel}${suffix}`;
        };
        renderHeader("none");
        th.addEventListener("click", () => {
          const current = th.getAttribute("data-sort-direction") ?? "none";
          const next = current === "asc" ? "desc" : "asc";
          headers.forEach((other) => {
            if (other !== th) {
              other.setAttribute("data-sort-direction", "none");
              const otherLabel = (other.textContent ?? "").replace(/[\s]*(↕|↑|↓)$/, "").trim();
              if (otherLabel) other.textContent = `${otherLabel} \u2195`;
            }
          });
          th.setAttribute("data-sort-direction", next);
          renderHeader(next);
          const rows = Array.from(tbody.querySelectorAll("tr"));
          const sorted = rows.map((row, rowIndex) => {
            const cellText = row.children.item(index)?.innerText ?? "";
            return { row, rowIndex, value: parseCellValue(cellText) };
          }).sort((a, b) => {
            if (typeof a.value === "number" && typeof b.value === "number") {
              if (a.value < b.value) return next === "asc" ? -1 : 1;
              if (a.value > b.value) return next === "asc" ? 1 : -1;
              return a.rowIndex - b.rowIndex;
            }
            const cmp = String(a.value).localeCompare(String(b.value), void 0, { numeric: true, sensitivity: "base" });
            if (cmp !== 0) return next === "asc" ? cmp : -cmp;
            return a.rowIndex - b.rowIndex;
          });
          for (const item of sorted) tbody.appendChild(item.row);
        });
      });
    }
  }
  function installGlobals() {
    window.__pms = {
      tenantLogout: () => {
        localStorage.removeItem("pms_tenant_session");
        localStorage.removeItem("pms_tenant_token");
        navigate("/app/login");
      },
      platformLogout: () => {
        localStorage.removeItem("pms_platform_session");
        localStorage.removeItem("pms_platform_token");
        navigate("/platform/login");
      },
      navigate
    };
  }
  installGlobals();
  var TENANT_NAV = [
    { path: "/app/dashboard", key: "nav.dashboard" },
    { path: "/app/vessels", key: "nav.vessels" },
    { path: "/app/assets", key: "nav.assets" },
    { path: "/app/maintenance-plans", key: "nav.maintenance" },
    { path: "/app/work-orders", key: "nav.workOrders" },
    { path: "/app/daily-reports", key: "nav.dailyReports" },
    { path: "/app/defects", key: "nav.defects" },
    { path: "/app/deferrals", key: "nav.deferrals" },
    { path: "/app/rca", key: "nav.rca" },
    { path: "/app/capa", key: "nav.capa" },
    { path: "/app/inspections", key: "nav.inspections" },
    { path: "/app/certificates", key: "nav.certificates" },
    { path: "/app/spares", key: "nav.spares" },
    { path: "/app/stock-movements", key: "nav.stockMovements" },
    { path: "/app/providers", key: "nav.providers" },
    { path: "/app/spare-orders", key: "nav.spareOrders" },
    { path: "/app/provider-evaluations", key: "nav.providerEvals" },
    { path: "/app/provider-nonconformities", key: "nav.providerNC" },
    { path: "/app/ai-insights", key: "nav.aiInsights" }
  ];
  function renderTenantShell(pageTitle, activeNav, content) {
    const session = getTenantSession();
    const app = document.getElementById("app");
    if (!app) return;
    if (!session) {
      navigate("/app/login");
      return;
    }
    const navHtml = TENANT_NAV.map(({ path, key }) => {
      const isActive = activeNav === path || path !== "/app/dashboard" && activeNav.startsWith(path);
      const cls = isActive ? " active" : "";
      return `<a href="${href(path)}" class="nav-item${cls}"
      onclick="event.preventDefault();window.__pms.navigate('${path}')">${t(key)}</a>`;
    }).join("");
    const displayName = [session.user.firstName, session.user.lastName].filter(Boolean).join(" ") || session.user.email;
    app.innerHTML = `
<div class="layout">
  <aside class="sidebar">
    <div class="sidebar-header">
      <div class="sidebar-logo">${t("app.title")}</div>
      <div class="sidebar-sub">${session.tenantDisplayName}</div>
    </div>
    <nav>${navHtml}</nav>
  </aside>
  <main class="main">
    <header class="header">
      <div class="header-title">${pageTitle}</div>
      <div class="header-actions">
        <span class="header-badge">${session.tenantLocale.toUpperCase()}</span>
        <span class="header-user">${displayName}</span>
        <button class="btn btn-ghost btn-sm" onclick="window.__pms.tenantLogout()">${t("nav.logout")}</button>
      </div>
    </header>
    <div class="content" id="page-content">${content}</div>
  </main>
</div>`;
    applyTableSorting(app);
  }
  var PLATFORM_NAV = [
    { path: "/platform/tenants", key: "platform.nav.tenants" },
    { path: "/platform/users", key: "platform.nav.users" },
    { path: "/platform/prompts", key: "platform.nav.prompts" },
    { path: "/platform/audit-events", key: "platform.nav.audit" }
  ];
  function renderPlatformShell(pageTitle, activeNav, content) {
    const session = getPlatformSession();
    const app = document.getElementById("app");
    if (!app) return;
    if (!session) {
      navigate("/platform/login");
      return;
    }
    const navHtml = PLATFORM_NAV.map(({ path, key }) => {
      const isActive = activeNav === path || activeNav.startsWith(path + "/");
      const cls = isActive ? " active" : "";
      return `<a href="${href(path)}" class="nav-item${cls}"
      onclick="event.preventDefault();window.__pms.navigate('${path}')">${t(key)}</a>`;
    }).join("");
    const roleKey = "platform.role." + session.user.role;
    app.innerHTML = `
<div class="layout">
  <aside class="sidebar sidebar-platform">
    <div class="sidebar-header">
      <div class="sidebar-logo">${t("app.title")}</div>
      <div class="sidebar-sub">${t("platform.label")}</div>
    </div>
    <nav>
      <div class="sidebar-section">${t("platform.nav.section")}</div>
      ${navHtml}
    </nav>
  </aside>
  <main class="main">
    <header class="header">
      <div class="header-title">${pageTitle}</div>
      <div class="header-actions">
        <span class="header-badge">${t(roleKey)}</span>
        <span class="header-user">${session.user.email}</span>
        <button class="btn btn-ghost btn-sm" onclick="window.__pms.platformLogout()">${t("nav.logout")}</button>
      </div>
    </header>
    <div class="content" id="page-content">${content}</div>
  </main>
</div>`;
    applyTableSorting(app);
  }

  // src/pages/dashboard.ts
  async function pageDashboard() {
    renderTenantShell(
      t("dashboard.title"),
      "/app/dashboard",
      `<div class="loading-state">${t("common.loading")}</div>`
    );
    try {
      const [vesselsRes, assetsRes, workOrdersRes, insightsRes] = await Promise.all([
        api.vessels.list(),
        api.assets.list(),
        api.workOrders.list({}),
        api.aiInsights.list({ status: "NEW" })
      ]);
      const vessels = vesselsRes.items;
      const assets = assetsRes.items;
      const workOrders = workOrdersRes.items;
      const insights = insightsRes.items;
      const pendingWO = workOrders.filter(
        (wo) => wo.status === "PENDING" || wo.status === "ASSIGNED"
      ).length;
      const statsHtml = `
<div class="stats-grid">
  <div class="stat-card">
    <div class="stat-value">${vessels.length}</div>
    <div class="stat-label">${t("nav.vessels")}</div>
  </div>
  <div class="stat-card">
    <div class="stat-value">${assets.length}</div>
    <div class="stat-label">${t("nav.assets")}</div>
  </div>
  <div class="stat-card">
    <div class="stat-value">${workOrders.length}</div>
    <div class="stat-label">${t("nav.workOrders")}</div>
  </div>
  <div class="stat-card">
    <div class="stat-value">${pendingWO}</div>
    <div class="stat-label">Pendientes</div>
  </div>
</div>`;
      let insightsHtml = "";
      if (insights.length > 0) {
        const cards = insights.slice(0, 5).map((ins) => `
<div class="insight-card">
  <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:4px">
    <div class="insight-title">${ins.title}</div>
    <span class="badge badge-${priorityColor(ins.priority)}">${ins.priority}</span>
  </div>
  <div class="insight-desc">${ins.description}</div>
  <div class="insight-meta">${ins.vesselCode ?? ""} \xB7 ${formatDate(ins.createdAt)}</div>
</div>`).join("");
        insightsHtml = `
<div class="card">
  <div class="card-header">
    <div class="card-title">${t("dashboard.aiInsights")}</div>
  </div>
  ${cards}
</div>`;
      }
      renderTenantShell(t("dashboard.title"), "/app/dashboard", statsHtml + insightsHtml);
    } catch {
      renderTenantShell(
        t("dashboard.title"),
        "/app/dashboard",
        `<div class="error-state">${t("common.error")}</div>`
      );
    }
  }
  function priorityColor(priority) {
    const map = {
      CRITICAL: "red",
      HIGH: "orange",
      MEDIUM: "yellow",
      LOW: "green"
    };
    return map[priority] ?? "neutral";
  }

  // src/pages/spares.ts
  var filters = { vesselCode: "", category: "", status: "" };
  var vesselsList = [];
  async function pageSpares() {
    renderTenantShell(t("nav.spares"), "/app/spares", renderLoadingState());
    syncFiltersFromQuery();
    try {
      const [vesselsRes, sparesRes] = await Promise.all([
        api.vessels.list(),
        api.spares.list(filters)
      ]);
      vesselsList = vesselsRes.items;
      const spares = sparesRes.items;
      const content = await renderContent(spares);
      renderTenantShell(t("nav.spares"), "/app/spares", content);
      installFilterHandler();
    } catch (error) {
      renderTenantShell(t("nav.spares"), "/app/spares", renderErrorState());
    }
  }
  async function renderContent(spares) {
    const filtersHtml = renderFilters();
    if (spares.length === 0) {
      return filtersHtml + renderEmptyState();
    }
    let html = filtersHtml + '<div class="table-wrap"><table><thead><tr><th>' + t("spares.number") + "</th><th>" + t("common.name") + "</th><th>" + t("common.vessel") + "</th><th>" + t("spares.category") + "</th><th>" + t("spares.location") + "</th><th>" + t("spares.stock") + "</th><th>" + t("spares.minStock") + "</th><th>" + t("spares.unit") + "</th><th>" + t("common.status") + "</th></tr></thead><tbody>";
    spares.forEach((spare) => {
      html += "<tr><td>" + spare.spareNumber + "</td><td>" + spare.name + "</td><td>" + (spare.vesselCode || "-") + "</td><td>" + (spare.category || "-") + "</td><td>" + (spare.location || "-") + "</td><td>" + (spare.currentStock ?? "-") + "</td><td>" + (spare.minStock ?? "-") + "</td><td>" + (spare.unit || "-") + "</td><td>" + statusBadge(spare.status || "IN_STOCK") + "</td></tr>";
    });
    html += "</tbody></table></div>";
    return html;
  }
  function renderFilters() {
    const vesselOptions = '<option value="">' + t("common.allVessels") + "</option>" + vesselsList.map((v) => '<option value="' + v.code + '"' + (v.code === filters.vesselCode ? " selected" : "") + ">" + v.code + "</option>").join("");
    const categoryOptions = '<option value="">' + t("common.allCategories") + '</option><option value="MECHANICAL"' + (filters.category === "MECHANICAL" ? " selected" : "") + '>MECHANICAL</option><option value="ELECTRICAL"' + (filters.category === "ELECTRICAL" ? " selected" : "") + '>ELECTRICAL</option><option value="ELECTRONIC"' + (filters.category === "ELECTRONIC" ? " selected" : "") + '>ELECTRONIC</option><option value="HYDRAULIC"' + (filters.category === "HYDRAULIC" ? " selected" : "") + '>HYDRAULIC</option><option value="SAFETY"' + (filters.category === "SAFETY" ? " selected" : "") + '>SAFETY</option><option value="CONSUMABLE"' + (filters.category === "CONSUMABLE" ? " selected" : "") + '>CONSUMABLE</option><option value="OTHER"' + (filters.category === "OTHER" ? " selected" : "") + ">OTHER</option>";
    const statusOptions = '<option value="">' + t("common.allStatus") + '</option><option value="IN_STOCK"' + (filters.status === "IN_STOCK" ? " selected" : "") + '>IN_STOCK</option><option value="LOW_STOCK"' + (filters.status === "LOW_STOCK" ? " selected" : "") + '>LOW_STOCK</option><option value="OUT_OF_STOCK"' + (filters.status === "OUT_OF_STOCK" ? " selected" : "") + '>OUT_OF_STOCK</option><option value="ON_ORDER"' + (filters.status === "ON_ORDER" ? " selected" : "") + ">ON_ORDER</option>";
    return '<div class="filters"><div class="filter-group"><label class="filter-label">' + t("common.vessel") + '</label><select class="filter-select" id="vesselFilter" onchange="window.__pms.updateFilters()">' + vesselOptions + '</select></div><div class="filter-group"><label class="filter-label">' + t("spares.category") + '</label><select class="filter-select" id="categoryFilter" onchange="window.__pms.updateFilters()">' + categoryOptions + '</select></div><div class="filter-group"><label class="filter-label">' + t("common.status") + '</label><select class="filter-select" id="statusFilter" onchange="window.__pms.updateFilters()">' + statusOptions + "</select></div></div>";
  }
  function syncFiltersFromQuery() {
    const params = new URLSearchParams(window.location.search);
    filters = {
      vesselCode: params.get("vesselCode") || "",
      category: params.get("category") || "",
      status: params.get("status") || ""
    };
  }
  function installFilterHandler() {
    window.__pms.updateFilters = () => {
      const vessel = document.getElementById("vesselFilter")?.value || "";
      const category = document.getElementById("categoryFilter")?.value || "";
      const status = document.getElementById("statusFilter")?.value || "";
      const params = new URLSearchParams();
      if (vessel) params.set("vesselCode", vessel);
      if (category) params.set("category", category);
      if (status) params.set("status", status);
      const query = params.toString();
      window.__pms.navigate("/app/spares" + (query ? "?" + query : ""));
    };
  }
  function renderLoadingState() {
    return '<div class="loading-state">' + t("common.loading") + "</div>";
  }
  function renderEmptyState() {
    return '<div class="empty-state"><div class="empty-state-icon">\u{1F529}</div><div>' + t("common.noData") + "</div></div>";
  }
  function renderErrorState() {
    return '<div class="error-state">' + t("common.error") + "</div>";
  }
  function statusBadge(status) {
    const map = {
      IN_STOCK: "badge-green",
      LOW_STOCK: "badge-yellow",
      OUT_OF_STOCK: "badge-red",
      ON_ORDER: "badge-neutral"
    };
    const cls = map[status] ?? "badge-neutral";
    return '<span class="badge ' + cls + '">' + status + "</span>";
  }

  // src/pages/stock-movements.ts
  var filters2 = { vesselCode: "", spareId: "", movementType: "" };
  var vesselsList2 = [];
  async function pageStockMovements() {
    renderTenantShell(t("nav.stockMovements"), "/app/stock-movements", renderLoadingState2());
    syncFiltersFromQuery2();
    try {
      const [vesselsRes, movementsRes] = await Promise.all([
        api.vessels.list(),
        api.stockMovements.list(filters2)
      ]);
      vesselsList2 = vesselsRes.items;
      const movements = movementsRes.items;
      const content = await renderContent2(movements);
      renderTenantShell(t("nav.stockMovements"), "/app/stock-movements", content);
      installFilterHandler2();
    } catch (error) {
      renderTenantShell(t("nav.stockMovements"), "/app/stock-movements", renderErrorState2());
    }
  }
  async function renderContent2(movements) {
    const filtersHtml = renderFilters2();
    if (movements.length === 0) {
      return filtersHtml + renderEmptyState2();
    }
    let html = filtersHtml + '<div class="table-wrap"><table><thead><tr><th>' + t("stockMovements.number") + "</th><th>" + t("common.date") + "</th><th>" + t("common.type") + "</th><th>" + t("stockMovements.spare") + "</th><th>" + t("common.vessel") + "</th><th>" + t("stockMovements.quantity") + "</th><th>" + t("stockMovements.reference") + "</th><th>" + t("stockMovements.performedBy") + "</th></tr></thead><tbody>";
    movements.forEach((movement) => {
      const typeClass = getTypeClass(movement.movementType);
      html += "<tr><td>" + (movement.movementNumber || "-") + "</td><td>" + formatDateTime(movement.movementDate) + '</td><td><span class="badge ' + typeClass + '">' + movement.movementType + "</span></td><td>" + (movement.spareName || movement.spareId || "-") + "</td><td>" + (movement.vesselCode || "-") + "</td><td>" + (movement.quantity ?? "-") + "</td><td>" + (movement.reference || "-") + "</td><td>" + (movement.performedBy || "-") + "</td></tr>";
    });
    html += "</tbody></table></div>";
    return html;
  }
  function getTypeClass(type) {
    switch (type) {
      case "RECEIPT":
        return "badge-green";
      case "ISSUE":
        return "badge-yellow";
      case "ADJUSTMENT":
        return "badge-orange";
      case "TRANSFER":
        return "badge-neutral";
      default:
        return "";
    }
  }
  function renderFilters2() {
    const vesselOptions = '<option value="">' + t("common.allVessels") + "</option>" + vesselsList2.map((v) => '<option value="' + v.code + '"' + (v.code === filters2.vesselCode ? " selected" : "") + ">" + v.code + "</option>").join("");
    const typeOptions = '<option value="">' + t("common.allTypes") + '</option><option value="RECEIPT"' + (filters2.movementType === "RECEIPT" ? " selected" : "") + '>RECEIPT</option><option value="ISSUE"' + (filters2.movementType === "ISSUE" ? " selected" : "") + '>ISSUE</option><option value="ADJUSTMENT"' + (filters2.movementType === "ADJUSTMENT" ? " selected" : "") + '>ADJUSTMENT</option><option value="TRANSFER"' + (filters2.movementType === "TRANSFER" ? " selected" : "") + ">TRANSFER</option>";
    return '<div class="filters"><div class="filter-group"><label class="filter-label">' + t("common.vessel") + '</label><select class="filter-select" id="vesselFilter" onchange="window.__pms.updateFilters()">' + vesselOptions + '</select></div><div class="filter-group"><label class="filter-label">' + t("common.type") + '</label><select class="filter-select" id="typeFilter" onchange="window.__pms.updateFilters()">' + typeOptions + '</select></div><div class="filter-group"><label class="filter-label">' + t("stockMovements.spareSearch") + '</label><input type="text" class="filter-select" id="spareFilter" value="' + (filters2.spareId || "") + '" placeholder="' + t("stockMovements.spareSearchPlaceholder") + `" onkeyup="if(event.key==='Enter')window.__pms.updateFilters()" onchange="window.__pms.updateFilters()" /></div></div>`;
  }
  function syncFiltersFromQuery2() {
    const params = new URLSearchParams(window.location.search);
    filters2 = {
      vesselCode: params.get("vesselCode") || "",
      spareId: params.get("spareId") || "",
      movementType: params.get("movementType") || ""
    };
  }
  function installFilterHandler2() {
    window.__pms.updateFilters = () => {
      const vessel = document.getElementById("vesselFilter")?.value || "";
      const type = document.getElementById("typeFilter")?.value || "";
      const spare = document.getElementById("spareFilter")?.value || "";
      const params = new URLSearchParams();
      if (vessel) params.set("vesselCode", vessel);
      if (type) params.set("movementType", type);
      if (spare) params.set("spareId", spare);
      const query = params.toString();
      window.__pms.navigate("/app/stock-movements" + (query ? "?" + query : ""));
    };
  }
  function renderLoadingState2() {
    return '<div class="loading-state">' + t("common.loading") + "</div>";
  }
  function renderEmptyState2() {
    return '<div class="empty-state"><div class="empty-state-icon">\u{1F4E6}</div><div>' + t("common.noData") + "</div></div>";
  }
  function renderErrorState2() {
    return '<div class="error-state">' + t("common.error") + "</div>";
  }

  // src/pages/providers.ts
  var filters3 = { status: "", category: "" };
  async function pageProviders() {
    renderTenantShell(t("nav.providers"), "/app/providers", renderLoadingState3());
    syncFiltersFromQuery3();
    try {
      const providersRes = await api.providers.list(filters3);
      const providers = providersRes.items;
      const content = await renderContent3(providers);
      renderTenantShell(t("nav.providers"), "/app/providers", content);
      installFilterHandler3();
    } catch (error) {
      renderTenantShell(t("nav.providers"), "/app/providers", renderErrorState3());
    }
  }
  async function renderContent3(providers) {
    const filtersHtml = renderFilters3();
    if (providers.length === 0) {
      return filtersHtml + renderEmptyState3();
    }
    let html = filtersHtml + '<div class="table-wrap"><table><thead><tr><th>' + t("providers.number") + "</th><th>" + t("common.name") + "</th><th>" + t("common.code") + "</th><th>" + t("providers.category") + "</th><th>" + t("providers.contact") + "</th><th>" + t("common.email") + "</th><th>" + t("providers.phone") + "</th><th>" + t("common.status") + "</th></tr></thead><tbody>";
    providers.forEach((provider) => {
      html += "<tr><td>" + provider.providerNumber + "</td><td>" + provider.name + "</td><td>" + (provider.code || "-") + "</td><td>" + (provider.category || "-") + "</td><td>" + (provider.contactName || "-") + "</td><td>" + (provider.email || "-") + "</td><td>" + (provider.phone || "-") + "</td><td>" + statusBadge2(provider.status || "ACTIVE") + "</td></tr>";
    });
    html += "</tbody></table></div>";
    return html;
  }
  function renderFilters3() {
    const statusOptions = '<option value="">' + t("common.allStatus") + '</option><option value="ACTIVE"' + (filters3.status === "ACTIVE" ? " selected" : "") + '>ACTIVE</option><option value="INACTIVE"' + (filters3.status === "INACTIVE" ? " selected" : "") + '>INACTIVE</option><option value="PENDING"' + (filters3.status === "PENDING" ? " selected" : "") + '>PENDING</option><option value="SUSPENDED"' + (filters3.status === "SUSPENDED" ? " selected" : "") + ">SUSPENDED</option>";
    const categoryOptions = '<option value="">' + t("common.allCategories") + '</option><option value="MECHANICAL"' + (filters3.category === "MECHANICAL" ? " selected" : "") + '>MECHANICAL</option><option value="ELECTRICAL"' + (filters3.category === "ELECTRICAL" ? " selected" : "") + '>ELECTRICAL</option><option value="ELECTRONIC"' + (filters3.category === "ELECTRONIC" ? " selected" : "") + '>ELECTRONIC</option><option value="HYDRAULIC"' + (filters3.category === "HYDRAULIC" ? " selected" : "") + '>HYDRAULIC</option><option value="SAFETY"' + (filters3.category === "SAFETY" ? " selected" : "") + '>SAFETY</option><option value="CONSUMABLE"' + (filters3.category === "CONSUMABLE" ? " selected" : "") + '>CONSUMABLE</option><option value="OTHER"' + (filters3.category === "OTHER" ? " selected" : "") + ">OTHER</option>";
    return '<div class="filters"><div class="filter-group"><label class="filter-label">' + t("common.status") + '</label><select class="filter-select" id="statusFilter" onchange="window.__pms.updateFilters()">' + statusOptions + '</select></div><div class="filter-group"><label class="filter-label">' + t("providers.category") + '</label><select class="filter-select" id="categoryFilter" onchange="window.__pms.updateFilters()">' + categoryOptions + "</select></div></div>";
  }
  function syncFiltersFromQuery3() {
    const params = new URLSearchParams(window.location.search);
    filters3 = {
      status: params.get("status") || "",
      category: params.get("category") || ""
    };
  }
  function installFilterHandler3() {
    window.__pms.updateFilters = () => {
      const status = document.getElementById("statusFilter")?.value || "";
      const category = document.getElementById("categoryFilter")?.value || "";
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (category) params.set("category", category);
      const query = params.toString();
      window.__pms.navigate("/app/providers" + (query ? "?" + query : ""));
    };
  }
  function renderLoadingState3() {
    return '<div class="loading-state">' + t("common.loading") + "</div>";
  }
  function renderEmptyState3() {
    return '<div class="empty-state"><div class="empty-state-icon">\u{1F3ED}</div><div>' + t("common.noData") + "</div></div>";
  }
  function renderErrorState3() {
    return '<div class="error-state">' + t("common.error") + "</div>";
  }
  function statusBadge2(status) {
    const map = {
      ACTIVE: "badge-green",
      INACTIVE: "badge-neutral",
      PENDING: "badge-yellow",
      SUSPENDED: "badge-orange"
    };
    const cls = map[status] ?? "badge-neutral";
    return '<span class="badge ' + cls + '">' + status + "</span>";
  }

  // src/pages/spare-orders.ts
  var filters4 = { vesselCode: "", status: "", type: "" };
  var vesselsList3 = [];
  async function pageSpareOrders() {
    renderTenantShell(t("nav.spareOrders"), "/app/spare-orders", renderLoadingState4());
    syncFiltersFromQuery4();
    try {
      const [vesselsRes, ordersRes] = await Promise.all([
        api.vessels.list(),
        api.spareOrders.list(filters4)
      ]);
      vesselsList3 = vesselsRes.items;
      const orders = ordersRes.items;
      const content = await renderContent4(orders);
      renderTenantShell(t("nav.spareOrders"), "/app/spare-orders", content);
      installFilterHandler4();
    } catch (error) {
      renderTenantShell(t("nav.spareOrders"), "/app/spare-orders", renderErrorState4());
    }
  }
  async function renderContent4(orders) {
    const filtersHtml = renderFilters4();
    if (orders.length === 0) {
      return filtersHtml + renderEmptyState4();
    }
    let html = filtersHtml + '<div class="table-wrap"><table><thead><tr><th>' + t("spareOrders.number") + "</th><th>" + t("spareOrders.provider") + "</th><th>" + t("common.vessel") + "</th><th>" + t("common.type") + "</th><th>" + t("spareOrders.orderDate") + "</th><th>" + t("spareOrders.expectedDate") + "</th><th>" + t("spareOrders.total") + "</th><th>" + t("common.status") + "</th></tr></thead><tbody>";
    orders.forEach((order) => {
      html += "<tr><td>" + order.orderNumber + "</td><td>" + (order.providerName || "-") + "</td><td>" + (order.vesselCode || "-") + "</td><td>" + (order.type || "-") + "</td><td>" + formatDate(order.orderDate) + "</td><td>" + formatDate(order.expectedDate) + "</td><td>" + (order.totalAmount ? order.currency + " " + order.totalAmount : "-") + "</td><td>" + statusBadge3(order.status || "PENDING") + "</td></tr>";
    });
    html += "</tbody></table></div>";
    return html;
  }
  function renderFilters4() {
    const vesselOptions = '<option value="">' + t("common.allVessels") + "</option>" + vesselsList3.map((v) => '<option value="' + v.code + '"' + (v.code === filters4.vesselCode ? " selected" : "") + ">" + v.code + "</option>").join("");
    const statusOptions = '<option value="">' + t("common.allStatus") + '</option><option value="PENDING"' + (filters4.status === "PENDING" ? " selected" : "") + '>PENDING</option><option value="APPROVED"' + (filters4.status === "APPROVED" ? " selected" : "") + '>APPROVED</option><option value="ORDERED"' + (filters4.status === "ORDERED" ? " selected" : "") + '>ORDERED</option><option value="RECEIVED"' + (filters4.status === "RECEIVED" ? " selected" : "") + '>RECEIVED</option><option value="CANCELLED"' + (filters4.status === "CANCELLED" ? " selected" : "") + ">CANCELLED</option>";
    const typeOptions = '<option value="">' + t("common.allTypes") + '</option><option value="STOCK"' + (filters4.type === "STOCK" ? " selected" : "") + '>STOCK</option><option value="EMERGENCY"' + (filters4.type === "EMERGENCY" ? " selected" : "") + '>EMERGENCY</option><option value="PROJECT"' + (filters4.type === "PROJECT" ? " selected" : "") + ">PROJECT</option>";
    return '<div class="filters"><div class="filter-group"><label class="filter-label">' + t("common.vessel") + '</label><select class="filter-select" id="vesselFilter" onchange="window.__pms.updateFilters()">' + vesselOptions + '</select></div><div class="filter-group"><label class="filter-label">' + t("common.status") + '</label><select class="filter-select" id="statusFilter" onchange="window.__pms.updateFilters()">' + statusOptions + '</select></div><div class="filter-group"><label class="filter-label">' + t("common.type") + '</label><select class="filter-select" id="typeFilter" onchange="window.__pms.updateFilters()">' + typeOptions + "</select></div></div>";
  }
  function syncFiltersFromQuery4() {
    const params = new URLSearchParams(window.location.search);
    filters4 = {
      vesselCode: params.get("vesselCode") || "",
      status: params.get("status") || "",
      type: params.get("type") || ""
    };
  }
  function installFilterHandler4() {
    window.__pms.updateFilters = () => {
      const vessel = document.getElementById("vesselFilter")?.value || "";
      const status = document.getElementById("statusFilter")?.value || "";
      const type = document.getElementById("typeFilter")?.value || "";
      const params = new URLSearchParams();
      if (vessel) params.set("vesselCode", vessel);
      if (status) params.set("status", status);
      if (type) params.set("type", type);
      const query = params.toString();
      window.__pms.navigate("/app/spare-orders" + (query ? "?" + query : ""));
    };
  }
  function renderLoadingState4() {
    return '<div class="loading-state">' + t("common.loading") + "</div>";
  }
  function renderEmptyState4() {
    return '<div class="empty-state"><div class="empty-state-icon">\u{1F6D2}</div><div>' + t("common.noData") + "</div></div>";
  }
  function renderErrorState4() {
    return '<div class="error-state">' + t("common.error") + "</div>";
  }
  function statusBadge3(status) {
    const map = {
      PENDING: "badge-yellow",
      APPROVED: "badge-green",
      ORDERED: "badge-neutral",
      RECEIVED: "badge-green",
      CANCELLED: "badge-red"
    };
    const cls = map[status] ?? "badge-neutral";
    return '<span class="badge ' + cls + '">' + status + "</span>";
  }

  // src/pages/provider-evaluations.ts
  var filters5 = { providerId: "", status: "" };
  async function pageProviderEvaluations() {
    renderTenantShell(t("nav.providerEvals"), "/app/provider-evaluations", renderLoadingState5());
    syncFiltersFromQuery5();
    try {
      const evaluationsRes = await api.providerEvaluations.list(filters5);
      const evaluations = evaluationsRes.items;
      const content = await renderContent5(evaluations);
      renderTenantShell(t("nav.providerEvals"), "/app/provider-evaluations", content);
      installFilterHandler5();
    } catch (error) {
      renderTenantShell(t("nav.providerEvals"), "/app/provider-evaluations", renderErrorState5());
    }
  }
  async function renderContent5(evaluations) {
    const filtersHtml = renderFilters5();
    if (evaluations.length === 0) {
      return filtersHtml + renderEmptyState5();
    }
    let html = filtersHtml + '<div class="table-wrap"><table><thead><tr><th>' + t("providerEvaluations.number") + "</th><th>" + t("providerEvaluations.provider") + "</th><th>" + t("providerEvaluations.period") + "</th><th>" + t("providerEvaluations.score") + "</th><th>" + t("providerEvaluations.quality") + "</th><th>" + t("providerEvaluations.delivery") + "</th><th>" + t("providerEvaluations.communication") + "</th><th>" + t("providerEvaluations.evaluatedBy") + "</th><th>" + t("providerEvaluations.date") + "</th><th>" + t("common.status") + "</th></tr></thead><tbody>";
    evaluations.forEach((e) => {
      const statusClass = statusBadgeClass(e.status || "COMPLETED");
      html += "<tr><td>" + e.evaluationNumber + "</td><td>" + (e.providerName || "-") + "</td><td>" + (e.period || "-") + '</td><td><span class="badge ' + getScoreClass(e.overallScore) + '">' + (e.overallScore ?? "-") + "</span></td><td>" + (e.qualityScore ?? "-") + "</td><td>" + (e.deliveryScore ?? "-") + "</td><td>" + (e.communicationScore ?? "-") + "</td><td>" + (e.evaluatedBy || "-") + "</td><td>" + formatDate(e.evaluationDate) + '</td><td><span class="badge ' + statusClass + '">' + (e.status || "COMPLETED") + "</span></td></tr>";
    });
    html += "</tbody></table></div>";
    return html;
  }
  function getScoreClass(score) {
    if (!score) return "badge-neutral";
    if (score >= 4.5) return "badge-green";
    if (score >= 3.5) return "badge-yellow";
    if (score >= 2.5) return "badge-orange";
    return "badge-red";
  }
  function statusBadgeClass(status) {
    const map = {
      PENDING: "badge-yellow",
      COMPLETED: "badge-green",
      CANCELLED: "badge-neutral"
    };
    return map[status] ?? "badge-neutral";
  }
  function renderFilters5() {
    const statusOptions = '<option value="">' + t("common.allStatus") + '</option><option value="PENDING"' + (filters5.status === "PENDING" ? " selected" : "") + '>PENDING</option><option value="COMPLETED"' + (filters5.status === "COMPLETED" ? " selected" : "") + '>COMPLETED</option><option value="CANCELLED"' + (filters5.status === "CANCELLED" ? " selected" : "") + ">CANCELLED</option>";
    return '<div class="filters"><div class="filter-group"><label class="filter-label">' + t("providerEvaluations.providerSearch") + '</label><input type="text" class="filter-select" id="providerFilter" value="' + (filters5.providerId || "") + '" placeholder="' + t("providerEvaluations.providerSearchPlaceholder") + `" onkeyup="if(event.key==='Enter')window.__pms.updateFilters()" onchange="window.__pms.updateFilters()" /></div><div class="filter-group"><label class="filter-label">` + t("common.status") + '</label><select class="filter-select" id="statusFilter" onchange="window.__pms.updateFilters()">' + statusOptions + "</select></div></div>";
  }
  function syncFiltersFromQuery5() {
    const params = new URLSearchParams(window.location.search);
    filters5 = {
      providerId: params.get("providerId") || "",
      status: params.get("status") || ""
    };
  }
  function installFilterHandler5() {
    window.__pms.updateFilters = () => {
      const provider = document.getElementById("providerFilter")?.value || "";
      const status = document.getElementById("statusFilter")?.value || "";
      const params = new URLSearchParams();
      if (provider) params.set("providerId", provider);
      if (status) params.set("status", status);
      const query = params.toString();
      window.__pms.navigate("/app/provider-evaluations" + (query ? "?" + query : ""));
    };
  }
  function renderLoadingState5() {
    return '<div class="loading-state">' + t("common.loading") + "</div>";
  }
  function renderEmptyState5() {
    return '<div class="empty-state"><div class="empty-state-icon">\u{1F4CA}</div><div>' + t("common.noData") + "</div></div>";
  }
  function renderErrorState5() {
    return '<div class="error-state">' + t("common.error") + "</div>";
  }

  // src/pages/provider-nonconformities.ts
  var filters6 = { providerId: "", status: "", severity: "" };
  async function pageProviderNonconformities() {
    renderTenantShell(t("nav.providerNC"), "/app/provider-nonconformities", renderLoadingState6());
    syncFiltersFromQuery6();
    try {
      const ncRes = await api.providerNonconformities.list(filters6);
      const nonconformities = ncRes.items;
      const content = await renderContent6(nonconformities);
      renderTenantShell(t("nav.providerNC"), "/app/provider-nonconformities", content);
      installFilterHandler6();
    } catch (error) {
      renderTenantShell(t("nav.providerNC"), "/app/provider-nonconformities", renderErrorState6());
    }
  }
  async function renderContent6(nonconformities) {
    const filtersHtml = renderFilters6();
    if (nonconformities.length === 0) {
      return filtersHtml + renderEmptyState6();
    }
    let html = filtersHtml + '<div class="table-wrap"><table><thead><tr><th>' + t("providerNC.number") + "</th><th>" + t("providerNC.provider") + "</th><th>" + t("providerNC.type") + "</th><th>" + t("providerNC.severity") + "</th><th>" + t("providerNC.description") + "</th><th>" + t("providerNC.reportedDate") + "</th><th>" + t("providerNC.responseDue") + "</th><th>" + t("providerNC.responseDate") + "</th><th>" + t("common.status") + "</th></tr></thead><tbody>";
    nonconformities.forEach((nc) => {
      const severityClass = severityBadgeClass(nc.severity || "MEDIUM");
      html += "<tr><td>" + nc.ncNumber + "</td><td>" + (nc.providerName || "-") + "</td><td>" + (nc.type || "-") + '</td><td><span class="badge ' + severityClass + '">' + (nc.severity || "MEDIUM") + "</span></td><td>" + truncate(nc.description, 50) + "</td><td>" + formatDate(nc.reportedDate) + "</td><td>" + formatDate(nc.responseDueDate) + "</td><td>" + (nc.responseDate ? formatDate(nc.responseDate) : "-") + "</td><td>" + statusBadge4(nc.status || "OPEN") + "</td></tr>";
    });
    html += "</tbody></table></div>";
    return html;
  }
  function truncate(text, maxLen = 50) {
    if (!text) return "-";
    return text.length > maxLen ? text.substring(0, maxLen) + "..." : text;
  }
  function renderFilters6() {
    const statusOptions = '<option value="">' + t("common.allStatus") + '</option><option value="OPEN"' + (filters6.status === "OPEN" ? " selected" : "") + '>OPEN</option><option value="IN_PROGRESS"' + (filters6.status === "IN_PROGRESS" ? " selected" : "") + '>IN_PROGRESS</option><option value="CLOSED"' + (filters6.status === "CLOSED" ? " selected" : "") + ">CLOSED</option>";
    const severityOptions = '<option value="">' + t("common.allSeverity") + '</option><option value="LOW"' + (filters6.severity === "LOW" ? " selected" : "") + '>LOW</option><option value="MEDIUM"' + (filters6.severity === "MEDIUM" ? " selected" : "") + '>MEDIUM</option><option value="HIGH"' + (filters6.severity === "HIGH" ? " selected" : "") + '>HIGH</option><option value="CRITICAL"' + (filters6.severity === "CRITICAL" ? " selected" : "") + ">CRITICAL</option>";
    return '<div class="filters"><div class="filter-group"><label class="filter-label">' + t("providerNC.providerSearch") + '</label><input type="text" class="filter-select" id="providerFilter" value="' + (filters6.providerId || "") + '" placeholder="' + t("providerNC.providerSearchPlaceholder") + `" onkeyup="if(event.key==='Enter')window.__pms.updateFilters()" onchange="window.__pms.updateFilters()" /></div><div class="filter-group"><label class="filter-label">` + t("common.status") + '</label><select class="filter-select" id="statusFilter" onchange="window.__pms.updateFilters()">' + statusOptions + '</select></div><div class="filter-group"><label class="filter-label">' + t("providerNC.severity") + '</label><select class="filter-select" id="severityFilter" onchange="window.__pms.updateFilters()">' + severityOptions + "</select></div></div>";
  }
  function syncFiltersFromQuery6() {
    const params = new URLSearchParams(window.location.search);
    filters6 = {
      providerId: params.get("providerId") || "",
      status: params.get("status") || "",
      severity: params.get("severity") || ""
    };
  }
  function installFilterHandler6() {
    window.__pms.updateFilters = () => {
      const provider = document.getElementById("providerFilter")?.value || "";
      const status = document.getElementById("statusFilter")?.value || "";
      const severity = document.getElementById("severityFilter")?.value || "";
      const params = new URLSearchParams();
      if (provider) params.set("providerId", provider);
      if (status) params.set("status", status);
      if (severity) params.set("severity", severity);
      const query = params.toString();
      window.__pms.navigate("/app/provider-nonconformities" + (query ? "?" + query : ""));
    };
  }
  function renderLoadingState6() {
    return '<div class="loading-state">' + t("common.loading") + "</div>";
  }
  function renderEmptyState6() {
    return '<div class="empty-state"><div class="empty-state-icon">\u26A0\uFE0F</div><div>' + t("common.noData") + "</div></div>";
  }
  function renderErrorState6() {
    return '<div class="error-state">' + t("common.error") + "</div>";
  }
  function severityBadgeClass(severity) {
    switch (severity) {
      case "CRITICAL":
        return "badge-red";
      case "HIGH":
        return "badge-orange";
      case "MEDIUM":
        return "badge-yellow";
      case "LOW":
        return "badge-green";
      default:
        return "badge-neutral";
    }
  }
  function statusBadge4(status) {
    const map = {
      OPEN: "badge-red",
      IN_PROGRESS: "badge-yellow",
      CLOSED: "badge-green"
    };
    const cls = map[status] ?? "badge-neutral";
    return '<span class="badge ' + cls + '">' + status + "</span>";
  }

  // src/pages/platform-tenants.ts
  async function pagePlatformTenants() {
    renderPlatformShell(
      t("platform.tenants.title"),
      "/platform/tenants",
      `<div class="loading-state">${t("common.loading")}</div>`
    );
    try {
      const result = await api.platform.tenants.list();
      const tenants = result.items;
      const content = renderContent7(tenants);
      renderPlatformShell(t("platform.tenants.title"), "/platform/tenants", content);
      installActions();
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("common.error");
      renderPlatformShell(
        t("platform.tenants.title"),
        "/platform/tenants",
        `<div class="error-state">${msg}</div>`
      );
    }
  }
  function renderContent7(tenants) {
    const header = `
<div class="page-header">
  <div class="page-title">${t("platform.tenants.title")}</div>
  <button class="btn" onclick="window.__pms.platformTenants.showForm()">${t("platform.tenants.new")}</button>
</div>`;
    if (tenants.length === 0) {
      return header + `<div class="empty-state">${t("platform.tenants.empty")}</div>` + renderModal();
    }
    const rows = tenants.map((ten) => `
    <tr>
      <td><a href="#" onclick="event.preventDefault();window.__pms.navigate('/platform/tenants/${ten.slug}')">${ten.slug}</a></td>
      <td>${ten.displayName ?? "\u2014"}</td>
      <td>${statusBadge5(ten.status)}</td>
      <td>${ten.defaultLocale ?? "\u2014"}</td>
      <td>${ten.currency ?? "\u2014"}</td>
      <td>${ten.planCode ?? "\u2014"}</td>
      <td>${formatDate(ten.createdAt)}</td>
      <td><button class="btn btn-sm" onclick="window.__pms.platformTenants.edit('${ten.slug}')">${t("common.edit")}</button></td>
    </tr>`).join("");
    return header + `
<div class="card">
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>${t("platform.tenants.slug")}</th>
          <th>${t("platform.tenants.display")}</th>
          <th>${t("platform.tenants.status")}</th>
          <th>${t("platform.tenants.locale")}</th>
          <th>${t("common.currency")}</th>
          <th>${t("platform.tenants.plan")}</th>
          <th>${t("platform.tenants.created")}</th>
          <th>${t("common.actions")}</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
</div>
${renderModal()}`;
  }
  function renderModal() {
    return `
<div class="modal" id="tenant-modal" style="display:none">
  <div class="modal-content">
    <div class="modal-title">${t("platform.tenants.title")}</div>
    <form id="tenant-form">
      <div class="form-group">
        <label class="form-label">${t("platform.tenants.slug")}</label>
        <input class="form-input" id="tenant-slug" required />
      </div>
      <div class="form-group">
        <label class="form-label">${t("platform.tenants.display")}</label>
        <input class="form-input" id="tenant-name" required />
      </div>
      <div class="form-group">
        <label class="form-label">${t("platform.tenants.status")}</label>
        <select class="form-input" id="tenant-status">
          <option value="ACTIVE">ACTIVE</option>
          <option value="SUSPENDED">SUSPENDED</option>
          <option value="DISABLED">DISABLED</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">${t("platform.tenants.locale")}</label>
        <select class="form-input" id="tenant-locale">
          <option value="es">es</option>
          <option value="en">en</option>
          <option value="pt">pt</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">${t("common.timezone")}</label>
        <input class="form-input" id="tenant-timezone" placeholder="America/Argentina/Buenos_Aires" />
      </div>
      <div class="form-group">
        <label class="form-label">${t("common.currency")}</label>
        <input class="form-input" id="tenant-currency" placeholder="USD" />
      </div>
      <div class="form-group">
        <label class="form-label">${t("platform.tenants.plan")}</label>
        <select class="form-input" id="tenant-plan">
          <option value="START">START</option>
          <option value="GROWTH">GROWTH</option>
          <option value="ENTERPRISE">ENTERPRISE</option>
        </select>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" onclick="window.__pms.platformTenants.close()">${t("common.cancel")}</button>
        <button type="submit" class="btn">${t("common.save")}</button>
      </div>
    </form>
  </div>
</div>`;
  }
  function installActions() {
    const store = { currentSlug: null };
    const modal = document.getElementById("tenant-modal");
    const form = document.getElementById("tenant-form");
    const setField2 = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.value = value;
    };
    const setDisabled = (id, disabled) => {
      const el = document.getElementById(id);
      if (el) el.disabled = disabled;
    };
    window.__pms.platformTenants = {
      showForm: () => {
        store.currentSlug = null;
        if (modal) modal.style.display = "flex";
        setDisabled("tenant-slug", false);
        setField2("tenant-slug", "");
        setField2("tenant-name", "");
        setField2("tenant-status", "ACTIVE");
        setField2("tenant-locale", "es");
        setField2("tenant-timezone", "");
        setField2("tenant-currency", "");
        setField2("tenant-plan", "START");
      },
      edit: async (slug) => {
        store.currentSlug = slug;
        if (modal) modal.style.display = "flex";
        setDisabled("tenant-slug", true);
        try {
          const tenant = await api.platform.tenants.get(slug);
          setField2("tenant-slug", tenant.slug || slug);
          setField2("tenant-name", tenant.displayName || "");
          setField2("tenant-status", tenant.status || "ACTIVE");
          setField2("tenant-locale", tenant.defaultLocale || "es");
          setField2("tenant-timezone", tenant.timezone || "");
          setField2("tenant-currency", tenant.currency || "");
          setField2("tenant-plan", tenant.planCode || "START");
        } catch (err) {
          alert(err.message || t("common.error"));
        }
      },
      close: () => {
        if (modal) modal.style.display = "none";
      }
    };
    if (form) {
      form.onsubmit = async (e) => {
        e.preventDefault();
        const slug = document.getElementById("tenant-slug")?.value.trim() || "";
        const data = {
          slug,
          displayName: document.getElementById("tenant-name")?.value.trim(),
          status: document.getElementById("tenant-status")?.value,
          defaultLocale: document.getElementById("tenant-locale")?.value,
          timezone: document.getElementById("tenant-timezone")?.value.trim(),
          currency: document.getElementById("tenant-currency")?.value.trim(),
          planCode: document.getElementById("tenant-plan")?.value
        };
        try {
          if (store.currentSlug) {
            await api.platform.tenants.update(store.currentSlug, data);
          } else {
            await api.platform.tenants.create(data);
          }
          if (modal) modal.style.display = "none";
          window.__pms.navigate("/platform/tenants");
        } catch (err) {
          alert(err.message || t("common.error"));
        }
      };
    }
  }
  function statusBadge5(status) {
    const map = {
      ACTIVE: "badge-green",
      SUSPENDED: "badge-orange",
      DISABLED: "badge-neutral"
    };
    const cls = map[status] ?? "badge-neutral";
    return `<span class="badge ${cls}">${status}</span>`;
  }

  // src/pages/platform-tenant-detail.ts
  async function pagePlatformTenantDetail() {
    const slug = getTenantSlug();
    if (!slug) {
      renderPlatformShell(
        t("platform.tenants.title"),
        "/platform/tenants",
        `<div class="error-state">${t("platform.tenants.noTenant")}</div>`
      );
      return;
    }
    renderPlatformShell(
      t("platform.tenants.title"),
      "/platform/tenants",
      `<div class="loading-state">${t("common.loading")}</div>`
    );
    try {
      const tenant = await api.platform.tenants.get(slug);
      const content = renderContent8(slug, tenant);
      renderPlatformShell(t("platform.tenants.title"), "/platform/tenants", content);
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("common.error");
      renderPlatformShell(
        t("platform.tenants.title"),
        "/platform/tenants",
        `<div class="error-state">${msg}</div>`
      );
    }
  }
  function renderContent8(slug, tenant) {
    return `
<div class="page-header">
  <div>
    <a href="#" onclick="event.preventDefault();window.__pms.navigate('/platform/tenants')">\u2190 ${t("platform.common.back")}</a>
  </div>
</div>
<div class="page-header">
  <div class="page-title">${t("platform.tenants.details")} \xB7 ${slug}</div>
</div>
<div class="card">
  <div class="table-wrap">
    <table>
      <tbody>
        <tr><th>${t("platform.tenants.slug")}</th><td>${tenant.slug}</td></tr>
        <tr><th>${t("platform.tenants.display")}</th><td>${tenant.displayName ?? "\u2014"}</td></tr>
        <tr><th>${t("platform.tenants.status")}</th><td>${tenant.status ?? "\u2014"}</td></tr>
        <tr><th>${t("platform.tenants.locale")}</th><td>${tenant.defaultLocale ?? "\u2014"}</td></tr>
        <tr><th>${t("common.timezone")}</th><td>${tenant.timezone ?? "\u2014"}</td></tr>
        <tr><th>${t("common.currency")}</th><td>${tenant.currency ?? "\u2014"}</td></tr>
        <tr><th>${t("platform.tenants.plan")}</th><td>${tenant.planCode ?? "\u2014"}</td></tr>
        <tr><th>${t("platform.tenants.created")}</th><td>${formatDate(tenant.createdAt)}</td></tr>
      </tbody>
    </table>
  </div>
</div>
<div class="card">
  <div class="page-header">
    <div class="card-title">${t("platform.tenants.manage")}</div>
  </div>
  <div style="display:flex;gap:12px;flex-wrap:wrap">
    <button class="btn" onclick="window.__pms.navigate('/platform/tenants/${slug}/domains')">${t("platform.domains.title")}</button>
    <button class="btn" onclick="window.__pms.navigate('/platform/tenants/${slug}/invitations')">${t("platform.invitations.title")}</button>
    <button class="btn" onclick="window.__pms.navigate('/platform/tenants/${slug}/users')">${t("platform.tenantUsers.title")}</button>
  </div>
</div>`;
  }
  function getTenantSlug() {
    const path = getLogicalPath();
    const match = path.match(/^\/platform\/tenants\/([^/]+)$/);
    return match ? match[1] : "";
  }

  // src/pages/platform-domains.ts
  async function pagePlatformDomains() {
    const tenantSlug = getTenantSlug2();
    if (!tenantSlug) {
      renderPlatformShell(
        t("platform.domains.title"),
        "/platform/tenants",
        `<div class="error-state">${t("platform.domains.noTenant")}</div>`
      );
      return;
    }
    renderPlatformShell(
      t("platform.domains.title"),
      "/platform/tenants",
      `<div class="loading-state">${t("common.loading")}</div>`
    );
    try {
      const res = await api.platform.tenantDomains.list(tenantSlug);
      const content = renderContent9(tenantSlug, res.items);
      renderPlatformShell(t("platform.domains.title"), "/platform/tenants", content);
      installActions2(tenantSlug);
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("common.error");
      renderPlatformShell(
        t("platform.domains.title"),
        "/platform/tenants",
        `<div class="error-state">${msg}</div>`
      );
    }
  }
  function renderContent9(tenantSlug, domains) {
    const header = `
<div class="page-header">
  <div>
    <a href="#" onclick="event.preventDefault();window.__pms.navigate('/platform/tenants/${tenantSlug}')">\u2190 ${t("platform.common.back")}</a>
  </div>
</div>
<div class="page-header">
  <div class="page-title">${t("platform.domains.title")} \xB7 ${tenantSlug}</div>
  <button class="btn" onclick="window.__pms.platformDomains.showForm()">${t("platform.domains.add")}</button>
</div>`;
    if (domains.length === 0) {
      return header + `<div class="empty-state">${t("platform.domains.empty")}</div>` + renderModal2();
    }
    const rows = domains.map((d) => `
    <tr>
      <td>${d.host}</td>
      <td>${d.isPrimary ? t("common.yes") : "\u2014"}</td>
      <td>${formatDate(d.createdAt)}</td>
      <td>
        <button class="btn btn-sm" onclick="window.__pms.platformDomains.edit('${d.id}','${d.host}',${d.isPrimary ? "true" : "false"})">${t("common.edit")}</button>
        <button class="btn btn-sm btn-danger" onclick="window.__pms.platformDomains.delete('${d.id}')">${t("common.delete")}</button>
      </td>
    </tr>`).join("");
    return header + `
<div class="card">
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>${t("platform.domains.host")}</th>
          <th>${t("platform.domains.primary")}</th>
          <th>${t("common.createdAt")}</th>
          <th>${t("common.actions")}</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
</div>
${renderModal2()}`;
  }
  function renderModal2() {
    return `
<div class="modal" id="domain-modal" style="display:none">
  <div class="modal-content">
    <div class="modal-title">${t("platform.domains.add")}</div>
    <form id="domain-form">
      <div class="form-group">
        <label class="form-label">${t("platform.domains.host")}</label>
        <input class="form-input" id="domain-host" placeholder="example.com" required />
      </div>
      <div class="form-group">
        <label class="form-label"><input type="checkbox" id="domain-primary" /> ${t("platform.domains.primary")}</label>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" onclick="window.__pms.platformDomains.close()">${t("common.cancel")}</button>
        <button type="submit" class="btn">${t("common.save")}</button>
      </div>
    </form>
  </div>
</div>`;
  }
  function installActions2(tenantSlug) {
    const modal = document.getElementById("domain-modal");
    const form = document.getElementById("domain-form");
    const store = { currentId: null };
    window.__pms.platformDomains = {
      showForm: () => {
        store.currentId = null;
        if (modal) modal.style.display = "flex";
        const host = document.getElementById("domain-host");
        const primary = document.getElementById("domain-primary");
        if (host) host.value = "";
        if (primary) primary.checked = false;
      },
      edit: (id, hostValue, isPrimary) => {
        store.currentId = id;
        if (modal) modal.style.display = "flex";
        const host = document.getElementById("domain-host");
        const primary = document.getElementById("domain-primary");
        if (host) host.value = hostValue || "";
        if (primary) primary.checked = !!isPrimary;
      },
      close: () => {
        if (modal) modal.style.display = "none";
      },
      delete: async (id) => {
        if (!confirm(t("platform.domains.confirmDelete"))) return;
        try {
          await api.platform.tenantDomains.delete(tenantSlug, id);
          window.__pms.navigate(`/platform/tenants/${tenantSlug}/domains`);
        } catch (err) {
          alert(err.message || t("common.error"));
        }
      }
    };
    if (form) {
      form.onsubmit = async (e) => {
        e.preventDefault();
        const host = document.getElementById("domain-host")?.value.trim() || "";
        const isPrimary = document.getElementById("domain-primary")?.checked || false;
        try {
          if (store.currentId) {
            await api.platform.tenantDomains.update(tenantSlug, store.currentId, { host, isPrimary });
          } else {
            await api.platform.tenantDomains.create(tenantSlug, { host, isPrimary });
          }
          if (modal) modal.style.display = "none";
          window.__pms.navigate(`/platform/tenants/${tenantSlug}/domains`);
        } catch (err) {
          alert(err.message || t("common.error"));
        }
      };
    }
  }
  function getTenantSlug2() {
    const path = getLogicalPath();
    const match = path.match(/^\/platform\/tenants\/([^/]+)\/domains/);
    return match ? match[1] : "";
  }

  // src/pages/platform-invitations.ts
  async function pagePlatformInvitations() {
    const tenantSlug = getTenantSlug3();
    if (!tenantSlug) {
      renderPlatformShell(
        t("platform.invitations.title"),
        "/platform/tenants",
        `<div class="error-state">${t("platform.invitations.noTenant")}</div>`
      );
      return;
    }
    renderPlatformShell(
      t("platform.invitations.title"),
      "/platform/tenants",
      `<div class="loading-state">${t("common.loading")}</div>`
    );
    try {
      const res = await api.platform.tenantInvitations.list(tenantSlug);
      const content = renderContent10(tenantSlug, res.items);
      renderPlatformShell(t("platform.invitations.title"), "/platform/tenants", content);
      installActions3(tenantSlug);
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("common.error");
      renderPlatformShell(
        t("platform.invitations.title"),
        "/platform/tenants",
        `<div class="error-state">${msg}</div>`
      );
    }
  }
  function renderContent10(tenantSlug, invitations) {
    const header = `
<div class="page-header">
  <div>
    <a href="#" onclick="event.preventDefault();window.__pms.navigate('/platform/tenants/${tenantSlug}')">\u2190 ${t("platform.common.back")}</a>
  </div>
</div>
<div class="page-header">
  <div class="page-title">${t("platform.invitations.title")} \xB7 ${tenantSlug}</div>
  <button class="btn" onclick="window.__pms.platformInvitations.showForm()">${t("platform.invitations.send")}</button>
</div>`;
    if (invitations.length === 0) {
      return header + `<div class="empty-state">${t("platform.invitations.empty")}</div>` + renderModal3();
    }
    const rows = invitations.map((inv) => `
    <tr>
      <td>${inv.email}</td>
      <td>${inv.role ?? "user"}</td>
      <td>${statusBadge6(inv.status)}</td>
      <td>${formatDate(inv.createdAt)}</td>
      <td>${formatDate(inv.expiresAt)}</td>
      <td><button class="btn btn-sm btn-danger" onclick="window.__pms.platformInvitations.delete('${inv.id}')">${t("common.delete")}</button></td>
    </tr>`).join("");
    return header + `
<div class="card">
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>${t("common.email")}</th>
          <th>${t("common.role")}</th>
          <th>${t("common.status")}</th>
          <th>${t("common.createdAt")}</th>
          <th>${t("platform.invitations.expires")}</th>
          <th>${t("common.actions")}</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
</div>
${renderModal3()}`;
  }
  function renderModal3() {
    return `
<div class="modal" id="invitation-modal" style="display:none">
  <div class="modal-content">
    <div class="modal-title">${t("platform.invitations.send")}</div>
    <form id="invitation-form">
      <div class="form-group">
        <label class="form-label">${t("common.email")}</label>
        <input class="form-input" type="email" id="invitation-email" required />
      </div>
      <div class="form-group">
        <label class="form-label">${t("common.role")}</label>
        <select class="form-input" id="invitation-role">
          <option value="user">user</option>
          <option value="admin">admin</option>
        </select>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" onclick="window.__pms.platformInvitations.close()">${t("common.cancel")}</button>
        <button type="submit" class="btn">${t("common.send")}</button>
      </div>
    </form>
  </div>
</div>`;
  }
  function installActions3(tenantSlug) {
    const modal = document.getElementById("invitation-modal");
    const form = document.getElementById("invitation-form");
    window.__pms.platformInvitations = {
      showForm: () => {
        if (modal) modal.style.display = "flex";
        const email = document.getElementById("invitation-email");
        if (email) email.value = "";
      },
      close: () => {
        if (modal) modal.style.display = "none";
      },
      delete: async (id) => {
        if (!confirm(t("platform.invitations.confirmDelete"))) return;
        try {
          await api.platform.tenantInvitations.delete(tenantSlug, id);
          window.__pms.navigate(`/platform/tenants/${tenantSlug}/invitations`);
        } catch (err) {
          alert(err.message || t("common.error"));
        }
      }
    };
    if (form) {
      form.onsubmit = async (e) => {
        e.preventDefault();
        const email = document.getElementById("invitation-email")?.value.trim() || "";
        const role = document.getElementById("invitation-role")?.value || "user";
        try {
          await api.platform.tenantInvitations.create(tenantSlug, { email, role });
          if (modal) modal.style.display = "none";
          window.__pms.navigate(`/platform/tenants/${tenantSlug}/invitations`);
        } catch (err) {
          alert(err.message || t("common.error"));
        }
      };
    }
  }
  function statusBadge6(status) {
    const map = {
      PENDING: "badge-yellow",
      ACCEPTED: "badge-green",
      EXPIRED: "badge-neutral"
    };
    const cls = map[status] ?? "badge-neutral";
    return `<span class="badge ${cls}">${status}</span>`;
  }
  function getTenantSlug3() {
    const path = getLogicalPath();
    const match = path.match(/^\/platform\/tenants\/([^/]+)\/invitations/);
    return match ? match[1] : "";
  }

  // src/pages/platform-tenant-users.ts
  async function pagePlatformTenantUsers() {
    const tenantSlug = getTenantSlug4();
    if (!tenantSlug) {
      renderPlatformShell(
        t("platform.tenantUsers.title"),
        "/platform/tenants",
        `<div class="error-state">${t("platform.tenantUsers.noTenant")}</div>`
      );
      return;
    }
    renderPlatformShell(
      t("platform.tenantUsers.title"),
      "/platform/tenants",
      `<div class="loading-state">${t("common.loading")}</div>`
    );
    try {
      const res = await api.platform.tenantUsers.list(tenantSlug);
      const content = renderContent11(tenantSlug, res.items);
      renderPlatformShell(t("platform.tenantUsers.title"), "/platform/tenants", content);
      installActions4(tenantSlug);
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("common.error");
      renderPlatformShell(
        t("platform.tenantUsers.title"),
        "/platform/tenants",
        `<div class="error-state">${msg}</div>`
      );
    }
  }
  function renderContent11(tenantSlug, users) {
    const header = `
<div class="page-header">
  <div>
    <a href="#" onclick="event.preventDefault();window.__pms.navigate('/platform/tenants/${tenantSlug}')">\u2190 ${t("platform.common.back")}</a>
  </div>
</div>
<div class="page-header">
  <div class="page-title">${t("platform.tenantUsers.title")} \xB7 ${tenantSlug}</div>
  <button class="btn" onclick="window.__pms.platformTenantUsers.showForm()">${t("platform.tenantUsers.new")}</button>
</div>`;
    if (users.length === 0) {
      return header + `<div class="empty-state">${t("platform.tenantUsers.empty")}</div>` + renderModal4();
    }
    const rows = users.map((u) => `
    <tr>
      <td>${u.email}</td>
      <td>${u.name ?? "\u2014"}</td>
      <td>${u.role ?? "user"}</td>
      <td>${statusBadge7(u.status)}</td>
      <td>${formatDate(u.lastLoginAt)}</td>
      <td><button class="btn btn-sm" onclick="window.__pms.platformTenantUsers.edit('${u.id}')">${t("common.edit")}</button></td>
    </tr>`).join("");
    return header + `
<div class="card">
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>${t("common.email")}</th>
          <th>${t("common.name")}</th>
          <th>${t("common.role")}</th>
          <th>${t("common.status")}</th>
          <th>${t("platform.tenantUsers.lastLogin")}</th>
          <th>${t("common.actions")}</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
</div>
${renderModal4()}`;
  }
  function renderModal4() {
    return `
<div class="modal" id="tenant-user-modal" style="display:none">
  <div class="modal-content">
    <div class="modal-title">${t("platform.tenantUsers.title")}</div>
    <form id="tenant-user-form">
      <div class="form-group">
        <label class="form-label">${t("common.email")}</label>
        <input class="form-input" id="tenant-user-email" type="email" required />
      </div>
      <div class="form-group">
        <label class="form-label">${t("common.name")}</label>
        <input class="form-input" id="tenant-user-name" />
      </div>
      <div class="form-group">
        <label class="form-label">${t("common.role")}</label>
        <select class="form-input" id="tenant-user-role">
          <option value="user">user</option>
          <option value="admin">admin</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">${t("common.status")}</label>
        <select class="form-input" id="tenant-user-status">
          <option value="ACTIVE">ACTIVE</option>
          <option value="SUSPENDED">SUSPENDED</option>
        </select>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" onclick="window.__pms.platformTenantUsers.close()">${t("common.cancel")}</button>
        <button type="submit" class="btn">${t("common.save")}</button>
      </div>
    </form>
  </div>
</div>`;
  }
  function installActions4(tenantSlug) {
    const modal = document.getElementById("tenant-user-modal");
    const form = document.getElementById("tenant-user-form");
    const store = { currentId: null };
    const setField2 = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.value = value;
    };
    window.__pms.platformTenantUsers = {
      showForm: () => {
        store.currentId = null;
        if (modal) modal.style.display = "flex";
        setField2("tenant-user-email", "");
        setField2("tenant-user-name", "");
        setField2("tenant-user-role", "user");
        setField2("tenant-user-status", "ACTIVE");
      },
      edit: async (id) => {
        store.currentId = id;
        if (modal) modal.style.display = "flex";
        try {
          const user = await api.platform.tenantUsers.get(tenantSlug, id);
          setField2("tenant-user-email", user.email || "");
          setField2("tenant-user-name", user.name || "");
          setField2("tenant-user-role", user.role || "user");
          setField2("tenant-user-status", user.status || "ACTIVE");
        } catch (err) {
          alert(err.message || t("common.error"));
        }
      },
      close: () => {
        if (modal) modal.style.display = "none";
      }
    };
    if (form) {
      form.onsubmit = async (e) => {
        e.preventDefault();
        const data = {
          email: document.getElementById("tenant-user-email")?.value.trim(),
          name: document.getElementById("tenant-user-name")?.value.trim(),
          role: document.getElementById("tenant-user-role")?.value,
          status: document.getElementById("tenant-user-status")?.value
        };
        try {
          if (store.currentId) {
            await api.platform.tenantUsers.update(tenantSlug, store.currentId, data);
          } else {
            await api.platform.tenantUsers.create(tenantSlug, data);
          }
          if (modal) modal.style.display = "none";
          window.__pms.navigate(`/platform/tenants/${tenantSlug}/users`);
        } catch (err) {
          alert(err.message || t("common.error"));
        }
      };
    }
  }
  function statusBadge7(status) {
    const map = {
      ACTIVE: "badge-green",
      SUSPENDED: "badge-orange"
    };
    const cls = map[status] ?? "badge-neutral";
    return `<span class="badge ${cls}">${status}</span>`;
  }
  function getTenantSlug4() {
    const path = getLogicalPath();
    const match = path.match(/^\/platform\/tenants\/([^/]+)\/users/);
    return match ? match[1] : "";
  }

  // src/pages/platform-users.ts
  async function pagePlatformUsers() {
    renderPlatformShell(
      t("platform.users.title"),
      "/platform/users",
      `<div class="loading-state">${t("common.loading")}</div>`
    );
    try {
      const res = await api.platform.users.list();
      const content = renderContent12(res.items);
      renderPlatformShell(t("platform.users.title"), "/platform/users", content);
      installActions5();
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("common.error");
      renderPlatformShell(
        t("platform.users.title"),
        "/platform/users",
        `<div class="error-state">${msg}</div>`
      );
    }
  }
  function renderContent12(users) {
    const header = `
<div class="page-header">
  <div class="page-title">${t("platform.users.title")}</div>
  <button class="btn" onclick="window.__pms.platformUsers.showForm()">${t("platform.users.new")}</button>
</div>`;
    if (users.length === 0) {
      return header + `<div class="empty-state">${t("platform.users.empty")}</div>` + renderModal5();
    }
    const rows = users.map((u) => `
    <tr>
      <td>${u.id}</td>
      <td>${u.email}</td>
      <td>${u.name ?? "\u2014"}</td>
      <td>${u.role ?? "user"}</td>
      <td>${statusBadge8(u.status)}</td>
      <td>${formatDate(u.createdAt)}</td>
      <td><button class="btn btn-sm" onclick="window.__pms.platformUsers.edit('${u.id}')">${t("common.edit")}</button></td>
    </tr>`).join("");
    return header + `
<div class="card">
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>ID</th>
          <th>${t("common.email")}</th>
          <th>${t("common.name")}</th>
          <th>${t("common.role")}</th>
          <th>${t("common.status")}</th>
          <th>${t("common.createdAt")}</th>
          <th>${t("common.actions")}</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
</div>
${renderModal5()}`;
  }
  function renderModal5() {
    return `
<div class="modal" id="platform-user-modal" style="display:none">
  <div class="modal-content">
    <div class="modal-title">${t("platform.users.title")}</div>
    <form id="platform-user-form">
      <div class="form-group">
        <label class="form-label">${t("common.email")}</label>
        <input class="form-input" id="platform-user-email" type="email" required />
      </div>
      <div class="form-group">
        <label class="form-label">${t("common.name")}</label>
        <input class="form-input" id="platform-user-name" />
      </div>
      <div class="form-group">
        <label class="form-label">${t("common.role")}</label>
        <select class="form-input" id="platform-user-role">
          <option value="SUPERADMIN">SUPERADMIN</option>
          <option value="SUPPORT">SUPPORT</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">${t("common.status")}</label>
        <select class="form-input" id="platform-user-status">
          <option value="ACTIVE">ACTIVE</option>
          <option value="SUSPENDED">SUSPENDED</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">${t("platform.users.password")}</label>
        <input class="form-input" id="platform-user-password" type="password" />
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" onclick="window.__pms.platformUsers.close()">${t("common.cancel")}</button>
        <button type="submit" class="btn">${t("common.save")}</button>
      </div>
    </form>
  </div>
</div>`;
  }
  function installActions5() {
    const modal = document.getElementById("platform-user-modal");
    const form = document.getElementById("platform-user-form");
    const store = { currentId: null };
    const setField2 = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.value = value;
    };
    window.__pms.platformUsers = {
      showForm: () => {
        store.currentId = null;
        if (modal) modal.style.display = "flex";
        setField2("platform-user-email", "");
        setField2("platform-user-name", "");
        setField2("platform-user-role", "SUPERADMIN");
        setField2("platform-user-status", "ACTIVE");
        setField2("platform-user-password", "");
      },
      edit: async (id) => {
        store.currentId = id;
        if (modal) modal.style.display = "flex";
        try {
          const user = await api.platform.users.get(id);
          setField2("platform-user-email", user.email || "");
          setField2("platform-user-name", user.name || "");
          setField2("platform-user-role", user.role || "SUPERADMIN");
          setField2("platform-user-status", user.status || "ACTIVE");
          setField2("platform-user-password", "");
        } catch (err) {
          alert(err.message || t("common.error"));
        }
      },
      close: () => {
        if (modal) modal.style.display = "none";
      }
    };
    if (form) {
      form.onsubmit = async (e) => {
        e.preventDefault();
        const data = {
          email: document.getElementById("platform-user-email")?.value.trim(),
          name: document.getElementById("platform-user-name")?.value.trim(),
          role: document.getElementById("platform-user-role")?.value,
          status: document.getElementById("platform-user-status")?.value
        };
        const password = document.getElementById("platform-user-password")?.value;
        if (password) data.password = password;
        try {
          if (store.currentId) {
            await api.platform.users.update(store.currentId, data);
          } else {
            await api.platform.users.create(data);
          }
          if (modal) modal.style.display = "none";
          window.__pms.navigate("/platform/users");
        } catch (err) {
          alert(err.message || t("common.error"));
        }
      };
    }
  }
  function statusBadge8(status) {
    const map = {
      ACTIVE: "badge-green",
      SUSPENDED: "badge-orange"
    };
    const cls = map[status] ?? "badge-neutral";
    return `<span class="badge ${cls}">${status}</span>`;
  }

  // src/pages/platform-prompts.ts
  var filters7 = { capability: "" };
  async function pagePlatformPrompts() {
    renderPlatformShell(
      t("platform.prompts.title"),
      "/platform/prompts",
      `<div class="loading-state">${t("common.loading")}</div>`
    );
    syncFiltersFromQuery7();
    try {
      const res = await api.platform.prompts.list(filters7);
      const content = renderContent13(res.items);
      renderPlatformShell(t("platform.prompts.title"), "/platform/prompts", content);
      installActions6();
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("common.error");
      renderPlatformShell(
        t("platform.prompts.title"),
        "/platform/prompts",
        `<div class="error-state">${msg}</div>`
      );
    }
  }
  function renderContent13(prompts) {
    const header = `
<div class="page-header">
  <div class="page-title">${t("platform.prompts.title")}</div>
  <button class="btn" onclick="window.__pms.platformPrompts.showForm()">${t("platform.prompts.new")}</button>
</div>`;
    const filtersHtml = renderFilters7();
    if (prompts.length === 0) {
      return filtersHtml + header + `<div class="empty-state">${t("platform.prompts.empty")}</div>` + renderModal6();
    }
    const rows = prompts.map((p) => `
    <tr>
      <td>${p.capability}</td>
      <td>${p.title}</td>
      <td>v${p.version ?? 1}</td>
      <td>${p.isPublished ? statusBadge9("PUBLISHED") : statusBadge9("DRAFT")}</td>
      <td>${p.publishedAt ? formatDate(p.publishedAt) : "\u2014"}</td>
      <td>${formatDate(p.updatedAt)}</td>
      <td>
        <button class="btn btn-sm" onclick="window.__pms.platformPrompts.edit('${p.id}')">${t("common.edit")}</button>
        ${p.isPublished ? `<button class="btn btn-sm" onclick="window.__pms.platformPrompts.rollback('${p.id}')">${t("platform.prompts.rollback")}</button>` : `<button class="btn btn-sm" onclick="window.__pms.platformPrompts.publish('${p.id}')">${t("platform.prompts.publish")}</button>`}
      </td>
    </tr>`).join("");
    return filtersHtml + header + `
<div class="card">
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>${t("platform.prompts.capability")}</th>
          <th>${t("common.title")}</th>
          <th>${t("platform.prompts.version")}</th>
          <th>${t("common.status")}</th>
          <th>${t("platform.prompts.published")}</th>
          <th>${t("common.updatedAt")}</th>
          <th>${t("common.actions")}</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
</div>
${renderModal6()}`;
  }
  function renderFilters7() {
    const capabilityOptions = '<option value="">' + t("common.allCapabilities") + '</option><option value="defect_analysis"' + (filters7.capability === "defect_analysis" ? " selected" : "") + '>defect_analysis</option><option value="maintenance_forecast"' + (filters7.capability === "maintenance_forecast" ? " selected" : "") + '>maintenance_forecast</option><option value="safety_inspection"' + (filters7.capability === "safety_inspection" ? " selected" : "") + '>safety_inspection</option><option value="barrier_assessment"' + (filters7.capability === "barrier_assessment" ? " selected" : "") + ">barrier_assessment</option>";
    return '<div class="filters"><div class="filter-group"><label class="filter-label">' + t("platform.prompts.capability") + '</label><select class="filter-select" id="capabilityFilter" onchange="window.__pms.updateFilters()">' + capabilityOptions + "</select></div></div>";
  }
  function renderModal6() {
    return `
<div class="modal" id="prompt-modal" style="display:none">
  <div class="modal-content" style="max-width:600px">
    <div class="modal-title">${t("platform.prompts.title")}</div>
    <form id="prompt-form">
      <div class="form-group">
        <label class="form-label">${t("platform.prompts.capability")}</label>
        <select class="form-input" id="prompt-capability">
          <option value="defect_analysis">defect_analysis</option>
          <option value="maintenance_forecast">maintenance_forecast</option>
          <option value="safety_inspection">safety_inspection</option>
          <option value="barrier_assessment">barrier_assessment</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">${t("common.title")}</label>
        <input class="form-input" id="prompt-title" required />
      </div>
      <div class="form-group">
        <label class="form-label">${t("platform.prompts.content")}</label>
        <textarea class="form-input" id="prompt-content" rows="10" required></textarea>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" onclick="window.__pms.platformPrompts.close()">${t("common.cancel")}</button>
        <button type="submit" class="btn">${t("common.save")}</button>
      </div>
    </form>
  </div>
</div>`;
  }
  function installActions6() {
    const modal = document.getElementById("prompt-modal");
    const form = document.getElementById("prompt-form");
    const store = { currentId: null };
    window.__pms.platformPrompts = {
      showForm: () => {
        store.currentId = null;
        if (modal) modal.style.display = "flex";
        setField("prompt-capability", "defect_analysis");
        setField("prompt-title", "");
        setField("prompt-content", "");
      },
      edit: async (id) => {
        store.currentId = id;
        if (modal) modal.style.display = "flex";
        try {
          const p = await api.platform.prompts.get(id);
          setField("prompt-capability", p.capability || "defect_analysis");
          setField("prompt-title", p.title || "");
          setField("prompt-content", p.content || "");
        } catch (err) {
          alert(err.message || t("common.error"));
        }
      },
      close: () => {
        if (modal) modal.style.display = "none";
      },
      publish: async (id) => {
        try {
          await api.platform.prompts.publish(id);
          window.__pms.navigate("/platform/prompts" + window.location.search);
        } catch (err) {
          alert(err.message || t("common.error"));
        }
      },
      rollback: async (id) => {
        if (!confirm(t("platform.prompts.confirmRollback"))) return;
        try {
          await api.platform.prompts.rollback(id);
          window.__pms.navigate("/platform/prompts" + window.location.search);
        } catch (err) {
          alert(err.message || t("common.error"));
        }
      }
    };
    window.__pms.updateFilters = () => {
      const capability = document.getElementById("capabilityFilter")?.value || "";
      const params = new URLSearchParams();
      if (capability) params.set("capability", capability);
      const query = params.toString();
      window.__pms.navigate("/platform/prompts" + (query ? "?" + query : ""));
    };
    if (form) {
      form.onsubmit = async (e) => {
        e.preventDefault();
        const data = {
          capability: document.getElementById("prompt-capability")?.value,
          locale: "es",
          title: document.getElementById("prompt-title")?.value.trim(),
          content: document.getElementById("prompt-content")?.value.trim()
        };
        try {
          if (store.currentId) {
            await api.platform.prompts.update(store.currentId, data);
          } else {
            await api.platform.prompts.create(data);
          }
          if (modal) modal.style.display = "none";
          window.__pms.navigate("/platform/prompts" + window.location.search);
        } catch (err) {
          alert(err.message || t("common.error"));
        }
      };
    }
  }
  function setField(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value;
  }
  function statusBadge9(status) {
    return status === "PUBLISHED" ? `<span class="badge badge-green">${t("platform.prompts.publishedStatus")}</span>` : `<span class="badge badge-neutral">${t("platform.prompts.draftStatus")}</span>`;
  }
  function syncFiltersFromQuery7() {
    const params = new URLSearchParams(window.location.search);
    filters7 = {
      capability: params.get("capability") || ""
    };
  }

  // src/pages/platform-audit-events.ts
  var filters8 = { tenantSlug: "", actorId: "", action: "" };
  async function pagePlatformAuditEvents() {
    renderPlatformShell(
      t("platform.audit.title"),
      "/platform/audit-events",
      `<div class="loading-state">${t("common.loading")}</div>`
    );
    syncFiltersFromQuery8();
    try {
      const res = await api.platform.auditEvents.list(filters8);
      const content = renderContent14(res.items);
      renderPlatformShell(t("platform.audit.title"), "/platform/audit-events", content);
      installFilterHandler7();
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("common.error");
      renderPlatformShell(
        t("platform.audit.title"),
        "/platform/audit-events",
        `<div class="error-state">${msg}</div>`
      );
    }
  }
  function renderContent14(events) {
    const filtersHtml = renderFilters8();
    if (events.length === 0) {
      return filtersHtml + `<div class="empty-state">${t("platform.audit.empty")}</div>`;
    }
    const rows = events.map((ev) => `
    <tr>
      <td>${formatDateTime(ev.timestamp)}</td>
      <td>${ev.tenantSlug ?? "\u2014"}</td>
      <td>${ev.userEmail ?? ev.actorId ?? "\u2014"}</td>
      <td>${ev.action ?? "\u2014"}</td>
      <td>${ev.entityType ? ev.entityType + ":" + ev.entityId : "\u2014"}</td>
      <td>${renderDetails(ev.details)}</td>
    </tr>`).join("");
    return filtersHtml + `
<div class="card">
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>${t("common.date")}</th>
          <th>${t("platform.audit.tenant")}</th>
          <th>${t("platform.audit.user")}</th>
          <th>${t("platform.audit.action")}</th>
          <th>${t("platform.audit.entity")}</th>
          <th>${t("platform.audit.details")}</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
</div>`;
  }
  function renderDetails(details) {
    if (!details) return "\u2014";
    if (typeof details === "string") return truncate2(details, 60);
    if (typeof details === "object") {
      const parts = [];
      for (const [k, v] of Object.entries(details)) {
        if (v) parts.push(k + ": " + truncate2(String(v), 20));
      }
      return parts.slice(0, 2).join(", ");
    }
    return "\u2014";
  }
  function truncate2(text, maxLen) {
    return text.length > maxLen ? text.slice(0, maxLen) + "..." : text;
  }
  function renderFilters8() {
    const actionOptions = '<option value="">' + t("common.allActions") + '</option><option value="LOGIN"' + (filters8.action === "LOGIN" ? " selected" : "") + '>LOGIN</option><option value="LOGOUT"' + (filters8.action === "LOGOUT" ? " selected" : "") + '>LOGOUT</option><option value="CREATE"' + (filters8.action === "CREATE" ? " selected" : "") + '>CREATE</option><option value="UPDATE"' + (filters8.action === "UPDATE" ? " selected" : "") + '>UPDATE</option><option value="DELETE"' + (filters8.action === "DELETE" ? " selected" : "") + ">DELETE</option>";
    return '<div class="filters"><div class="filter-group"><label class="filter-label">' + t("platform.audit.tenant") + '</label><input type="text" class="filter-select" id="tenantFilter" value="' + (filters8.tenantSlug || "") + '" placeholder="' + t("platform.audit.tenantPlaceholder") + `" onkeyup="if(event.key==='Enter')window.__pms.updateFilters()" onchange="window.__pms.updateFilters()" /></div><div class="filter-group"><label class="filter-label">` + t("platform.audit.user") + '</label><input type="text" class="filter-select" id="userFilter" value="' + (filters8.actorId || "") + '" placeholder="' + t("platform.audit.userPlaceholder") + `" onkeyup="if(event.key==='Enter')window.__pms.updateFilters()" onchange="window.__pms.updateFilters()" /></div><div class="filter-group"><label class="filter-label">` + t("platform.audit.action") + '</label><select class="filter-select" id="actionFilter" onchange="window.__pms.updateFilters()">' + actionOptions + "</select></div></div>";
  }
  function syncFiltersFromQuery8() {
    const params = new URLSearchParams(window.location.search);
    filters8 = {
      tenantSlug: params.get("tenantSlug") || "",
      actorId: params.get("actorId") || "",
      action: params.get("action") || ""
    };
  }
  function installFilterHandler7() {
    window.__pms.updateFilters = () => {
      const tenant = document.getElementById("tenantFilter")?.value || "";
      const actor = document.getElementById("userFilter")?.value || "";
      const action = document.getElementById("actionFilter")?.value || "";
      const params = new URLSearchParams();
      if (tenant) params.set("tenantSlug", tenant);
      if (actor) params.set("actorId", actor);
      if (action) params.set("action", action);
      const query = params.toString();
      window.__pms.navigate("/platform/audit-events" + (query ? "?" + query : ""));
    };
  }

  // src/pages/vessels.ts
  async function renderVesselsPage() {
    try {
      const response = await api.vessels.list();
      const vessels = response.items;
      if (vessels.length === 0) {
        return renderEmptyState7();
      }
      let html = '<div class="table-container"><table><thead><tr><th>' + t("common.code") + "</th><th>" + t("common.name") + "</th><th>" + t("common.status") + "</th><th>" + t("common.createdAt") + "</th></tr></thead><tbody>";
      vessels.forEach((vessel) => {
        const statusClass = vessel.status === "ACTIVE" ? "status-active" : "status-inactive";
        html += "<tr><td>" + vessel.code + "</td><td>" + vessel.name + '</td><td><span class="status-badge ' + statusClass + '">' + vessel.status + "</span></td><td>" + formatDate(vessel.createdAt) + "</td></tr>";
      });
      html += "</tbody></table></div>";
      return html;
    } catch (error) {
      return renderErrorState7();
    }
  }
  function renderEmptyState7() {
    return '<div class="empty-state"><div class="empty-state-icon">\u{1F6A2}</div><div>' + t("common.noData") + "</div></div>";
  }
  function renderErrorState7() {
    return '<div class="error-state">' + t("common.error") + "</div>";
  }

  // src/pages/assets.ts
  var currentVesselCode = "";
  var vesselsList4 = [];
  async function renderAssetsPage() {
    try {
      const [vesselsRes, assetsRes] = await Promise.all([
        api.vessels.list(),
        api.assets.list(currentVesselCode || void 0)
      ]);
      vesselsList4 = vesselsRes.items;
      const assets = assetsRes.items;
      return renderContent15(assets);
    } catch (error) {
      return renderErrorState8();
    }
  }
  async function renderContent15(assets) {
    const filtersHtml = renderFilters9();
    if (assets.length === 0) {
      return filtersHtml + renderEmptyState8();
    }
    let html = filtersHtml + '<div class="table-container"><table><thead><tr><th>' + t("common.code") + "</th><th>" + t("common.name") + "</th><th>" + t("common.vessel") + "</th><th>Criticality</th><th>" + t("common.status") + "</th></tr></thead><tbody>";
    assets.forEach((asset) => {
      const statusClass = "status-" + asset.status.toLowerCase().replace(/_/g, "-");
      html += "<tr><td>" + asset.assetCode + "</td><td>" + asset.name + "</td><td>" + asset.vesselCode + '</td><td><span class="priority-badge priority-' + asset.criticality.toLowerCase() + '">' + asset.criticality + '</span></td><td><span class="status-badge ' + statusClass + '">' + asset.status + "</span></td></tr>";
    });
    html += "</tbody></table></div>";
    return html;
  }
  function renderFilters9() {
    const vesselOptions = '<option value="">All Vessels</option>' + vesselsList4.map((v) => '<option value="' + v.code + '"' + (v.code === currentVesselCode ? " selected" : "") + ">" + v.code + " - " + v.name + "</option>").join("");
    return '<div class="filters"><div class="filter-group"><label class="filter-label">' + t("common.vessel") + '</label><select class="filter-select" id="vesselFilter" onchange="filterAssets(this.value)">' + vesselOptions + '</select></div></div><script>function filterAssets(vesselCode){currentVesselCode=vesselCode;loadPage("/assets",vesselCode?"?vesselCode="+vesselCode:"")}<\/script>';
  }
  function renderEmptyState8() {
    return '<div class="empty-state"><div class="empty-state-icon">\u{1F3D7}\uFE0F</div><div>' + t("common.noData") + "</div></div>";
  }
  function renderErrorState8() {
    return '<div class="error-state">' + t("common.error") + "</div>";
  }

  // src/pages/maintenance-plans.ts
  var filters9 = { vesselCode: "", status: "", triggerType: "" };
  var vesselsList5 = [];
  async function renderMaintenancePlansPage() {
    try {
      const [vesselsRes, plansRes] = await Promise.all([
        api.vessels.list(),
        api.maintenancePlans.list(filters9)
      ]);
      vesselsList5 = vesselsRes.items;
      const plans = plansRes.items;
      return renderContent16(plans);
    } catch (error) {
      return renderErrorState9();
    }
  }
  async function renderContent16(plans) {
    const filtersHtml = renderFilters10();
    if (plans.length === 0) {
      return filtersHtml + renderEmptyState9();
    }
    let html = filtersHtml + '<div class="table-container"><table><thead><tr><th>Task</th><th>Title</th><th>' + t("common.vessel") + "</th><th>Trigger</th><th>Next Due</th><th>" + t("common.status") + "</th></tr></thead><tbody>";
    plans.forEach((plan) => {
      const statusClass = "status-" + plan.status.toLowerCase().replace(/_/g, "-");
      html += "<tr><td>" + plan.taskCode + "</td><td>" + plan.title + "</td><td>" + plan.vesselCode + "</td><td>" + plan.triggerType + "</td><td>" + formatDate(plan.nextDueDate) + '</td><td><span class="status-badge ' + statusClass + '">' + plan.status + "</span></td></tr>";
    });
    html += "</tbody></table></div>";
    return html;
  }
  function renderFilters10() {
    const vesselOptions = '<option value="">All Vessels</option>' + vesselsList5.map((v) => '<option value="' + v.code + '"' + (v.code === filters9.vesselCode ? " selected" : "") + ">" + v.code + "</option>").join("");
    const statusOptions = '<option value="">All Status</option><option value="ACTIVE"' + (filters9.status === "ACTIVE" ? " selected" : "") + '>ACTIVE</option><option value="DUE_SOON"' + (filters9.status === "DUE_SOON" ? " selected" : "") + '>DUE_SOON</option><option value="OVERDUE"' + (filters9.status === "OVERDUE" ? " selected" : "") + ">OVERDUE</option>";
    const triggerOptions = '<option value="">All Triggers</option><option value="HOURS"' + (filters9.triggerType === "HOURS" ? " selected" : "") + '>HOURS</option><option value="MONTHS"' + (filters9.triggerType === "MONTHS" ? " selected" : "") + '>MONTHS</option><option value="CONDITION"' + (filters9.triggerType === "CONDITION" ? " selected" : "") + ">CONDITION</option>";
    return '<div class="filters"><div class="filter-group"><label class="filter-label">' + t("common.vessel") + '</label><select class="filter-select" id="vesselFilter" onchange="updateFilters()"><option value="">All Vessels</option>' + vesselOptions + '</select></div><div class="filter-group"><label class="filter-label">' + t("common.status") + '</label><select class="filter-select" id="statusFilter" onchange="updateFilters()">' + statusOptions + '</select></div><div class="filter-group"><label class="filter-label">Trigger</label><select class="filter-select" id="triggerFilter" onchange="updateFilters()">' + triggerOptions + '</select></div></div><script>function updateFilters(){var v=document.getElementById("vesselFilter").value;var s=document.getElementById("statusFilter").value;var t=document.getElementById("triggerFilter").value;var q=[];if(v)q.push("vesselCode="+v);if(s)q.push("status="+s);if(t)q.push("triggerType="+t);window.history.pushState({},"","/maintenance-plans"+(q.length?"?"+q.join("&"):""));loadPage("/maintenance-plans",q.length?"?"+q.join("&"):"")}<\/script>';
  }
  function renderEmptyState9() {
    return '<div class="empty-state"><div class="empty-state-icon">\u{1F4CB}</div><div>' + t("common.noData") + "</div></div>";
  }
  function renderErrorState9() {
    return '<div class="error-state">' + t("common.error") + "</div>";
  }

  // src/pages/work-orders.ts
  var filters10 = { vesselCode: "", status: "", type: "" };
  var vesselsList6 = [];
  async function renderWorkOrdersPage() {
    try {
      const [vesselsRes, wosRes] = await Promise.all([
        api.vessels.list(),
        api.workOrders.list(filters10)
      ]);
      vesselsList6 = vesselsRes.items;
      const workOrders = wosRes.items;
      return renderContent17(workOrders);
    } catch (error) {
      return renderErrorState10();
    }
  }
  async function renderContent17(workOrders) {
    const filtersHtml = renderFilters11();
    if (workOrders.length === 0) {
      return filtersHtml + renderEmptyState10();
    }
    let html = filtersHtml + '<div class="table-container"><table><thead><tr><th>WO #</th><th>' + t("common.title") + "</th><th>" + t("common.vessel") + "</th><th>" + t("common.type") + "</th><th>" + t("common.priority") + "</th><th>" + t("common.status") + "</th><th>" + t("common.date") + "</th></tr></thead><tbody>";
    workOrders.forEach((wo) => {
      const statusClass = "status-" + wo.status.toLowerCase().replace(/_/g, "-");
      const priorityClass = "priority-" + wo.priority.toLowerCase();
      html += "<tr><td>" + wo.woNumber + "</td><td>" + wo.title + "</td><td>" + wo.vesselCode + "</td><td>" + wo.type + '</td><td><span class="priority-badge ' + priorityClass + '">' + wo.priority + '</span></td><td><span class="status-badge ' + statusClass + '">' + wo.status + "</span></td><td>" + formatDate(wo.scheduledDate) + "</td></tr>";
    });
    html += "</tbody></table></div>";
    return html;
  }
  function renderFilters11() {
    const vesselOptions = '<option value="">All Vessels</option>' + vesselsList6.map((v) => '<option value="' + v.code + '"' + (v.code === filters10.vesselCode ? " selected" : "") + ">" + v.code + "</option>").join("");
    const statusOptions = '<option value="">All Status</option><option value="PENDING"' + (filters10.status === "PENDING" ? " selected" : "") + '>PENDING</option><option value="ASSIGNED"' + (filters10.status === "ASSIGNED" ? " selected" : "") + '>ASSIGNED</option><option value="IN_PROGRESS"' + (filters10.status === "IN_PROGRESS" ? " selected" : "") + '>IN_PROGRESS</option><option value="COMPLETED"' + (filters10.status === "COMPLETED" ? " selected" : "") + '>COMPLETED</option><option value="CANCELLED"' + (filters10.status === "CANCELLED" ? " selected" : "") + ">CANCELLED</option>";
    const typeOptions = '<option value="">All Types</option><option value="PREVENTIVE"' + (filters10.type === "PREVENTIVE" ? " selected" : "") + '>PREVENTIVE</option><option value="CORRECTIVE"' + (filters10.type === "CORRECTIVE" ? " selected" : "") + '>CORRECTIVE</option><option value="IMPROVEMENT"' + (filters10.type === "IMPROVEMENT" ? " selected" : "") + '>IMPROVEMENT</option><option value="INSPECTION"' + (filters10.type === "INSPECTION" ? " selected" : "") + ">INSPECTION</option>";
    return '<div class="filters"><div class="filter-group"><label class="filter-label">' + t("common.vessel") + '</label><select class="filter-select" id="vesselFilter" onchange="updateFilters()">' + vesselOptions + '</select></div><div class="filter-group"><label class="filter-label">' + t("common.status") + '</label><select class="filter-select" id="statusFilter" onchange="updateFilters()">' + statusOptions + '</select></div><div class="filter-group"><label class="filter-label">' + t("common.type") + '</label><select class="filter-select" id="typeFilter" onchange="updateFilters()">' + typeOptions + '</select></div></div><script>function updateFilters(){var v=document.getElementById("vesselFilter").value;var s=document.getElementById("statusFilter").value;var t=document.getElementById("typeFilter").value;var q=[];if(v)q.push("vesselCode="+v);if(s)q.push("status="+s);if(t)q.push("type="+t);window.history.pushState({},"","/work-orders"+(q.length?"?"+q.join("&"):""));loadPage("/work-orders",q.length?"?"+q.join("&"):"")}<\/script>';
  }
  function renderEmptyState10() {
    return '<div class="empty-state"><div class="empty-state-icon">\u{1F527}</div><div>' + t("common.noData") + "</div></div>";
  }
  function renderErrorState10() {
    return '<div class="error-state">' + t("common.error") + "</div>";
  }

  // src/pages/daily-reports.ts
  var currentVesselCode2 = "";
  var vesselsList7 = [];
  async function renderDailyReportsPage() {
    try {
      const [vesselsRes, reportsRes] = await Promise.all([
        api.vessels.list(),
        api.dailyReports.list(currentVesselCode2 || void 0)
      ]);
      vesselsList7 = vesselsRes.items;
      const reports = reportsRes.items;
      return renderContent18(reports);
    } catch (error) {
      return renderErrorState11();
    }
  }
  async function renderContent18(reports) {
    const filtersHtml = renderFilters12();
    if (reports.length === 0) {
      return filtersHtml + renderEmptyState11();
    }
    let html = filtersHtml + '<div class="table-container"><table><thead><tr><th>Report #</th><th>' + t("common.date") + "</th><th>" + t("common.vessel") + "</th><th>Weather</th><th>Activities</th></tr></thead><tbody>";
    reports.forEach((report) => {
      const activities = Array.isArray(report.activities) ? report.activities.join(", ") : "-";
      html += "<tr><td>" + report.reportNumber + "</td><td>" + formatDate(report.reportDate) + "</td><td>" + report.vesselCode + "</td><td>" + (report.weather || "-") + "</td><td>" + activities.substring(0, 100) + (activities.length > 100 ? "..." : "") + "</td></tr>";
    });
    html += "</tbody></table></div>";
    return html;
  }
  function renderFilters12() {
    const vesselOptions = '<option value="">All Vessels</option>' + vesselsList7.map((v) => '<option value="' + v.code + '"' + (v.code === currentVesselCode2 ? " selected" : "") + ">" + v.code + " - " + v.name + "</option>").join("");
    return '<div class="filters"><div class="filter-group"><label class="filter-label">' + t("common.vessel") + '</label><select class="filter-select" id="vesselFilter" onchange="filterReports(this.value)">' + vesselOptions + '</select></div></div><script>function filterReports(vesselCode){currentVesselCode=vesselCode;window.history.pushState({},"","/daily-reports"+(vesselCode?"?vesselCode="+vesselCode:""));loadPage("/daily-reports",vesselCode?"?vesselCode="+vesselCode:"")}<\/script>';
  }
  function renderEmptyState11() {
    return '<div class="empty-state"><div class="empty-state-icon">\u{1F4DD}</div><div>' + t("common.noData") + "</div></div>";
  }
  function renderErrorState11() {
    return '<div class="error-state">' + t("common.error") + "</div>";
  }

  // src/pages/defects.ts
  var filters11 = { vesselCode: "", status: "", severity: "" };
  var vesselsList8 = [];
  async function renderDefectsPage() {
    try {
      const [vesselsRes, defectsRes] = await Promise.all([
        api.vessels.list(),
        api.defects.list(filters11)
      ]);
      vesselsList8 = vesselsRes.items;
      const defects = defectsRes.items;
      return renderContent19(defects);
    } catch (error) {
      return renderErrorState12();
    }
  }
  async function renderContent19(defects) {
    const filtersHtml = renderFilters13();
    if (defects.length === 0) {
      return filtersHtml + renderEmptyState12();
    }
    let html = filtersHtml + '<div class="table-container"><table><thead><tr><th>Defect #</th><th>' + t("common.title") + "</th><th>" + t("common.vessel") + "</th><th>Severity</th><th>" + t("common.status") + "</th><th>Reported</th></tr></thead><tbody>";
    defects.forEach((defect) => {
      const statusClass = "status-" + defect.status.toLowerCase().replace(/_/g, "-");
      const severityClass = "priority-" + defect.severity.toLowerCase();
      html += "<tr><td>" + defect.defectNumber + "</td><td>" + defect.title + "</td><td>" + defect.vesselCode + '</td><td><span class="priority-badge ' + severityClass + '">' + defect.severity + '</span></td><td><span class="status-badge ' + statusClass + '">' + defect.status + "</span></td><td>" + formatDate(defect.reportedDate) + "</td></tr>";
    });
    html += "</tbody></table></div>";
    return html;
  }
  function renderFilters13() {
    const vesselOptions = '<option value="">All Vessels</option>' + vesselsList8.map((v) => '<option value="' + v.code + '"' + (v.code === filters11.vesselCode ? " selected" : "") + ">" + v.code + "</option>").join("");
    const statusOptions = '<option value="">All Status</option><option value="OPEN"' + (filters11.status === "OPEN" ? " selected" : "") + '>OPEN</option><option value="IN_PROGRESS"' + (filters11.status === "IN_PROGRESS" ? " selected" : "") + '>IN_PROGRESS</option><option value="PENDING_PARTS"' + (filters11.status === "PENDING_PARTS" ? " selected" : "") + '>PENDING_PARTS</option><option value="CLOSED"' + (filters11.status === "CLOSED" ? " selected" : "") + ">CLOSED</option>";
    const severityOptions = '<option value="">All Severity</option><option value="LOW"' + (filters11.severity === "LOW" ? " selected" : "") + '>LOW</option><option value="MEDIUM"' + (filters11.severity === "MEDIUM" ? " selected" : "") + '>MEDIUM</option><option value="HIGH"' + (filters11.severity === "HIGH" ? " selected" : "") + '>HIGH</option><option value="CRITICAL"' + (filters11.severity === "CRITICAL" ? " selected" : "") + ">CRITICAL</option>";
    return '<div class="filters"><div class="filter-group"><label class="filter-label">' + t("common.vessel") + '</label><select class="filter-select" id="vesselFilter" onchange="updateFilters()">' + vesselOptions + '</select></div><div class="filter-group"><label class="filter-label">' + t("common.status") + '</label><select class="filter-select" id="statusFilter" onchange="updateFilters()">' + statusOptions + '</select></div><div class="filter-group"><label class="filter-label">Severity</label><select class="filter-select" id="severityFilter" onchange="updateFilters()">' + severityOptions + '</select></div></div><script>function updateFilters(){var v=document.getElementById("vesselFilter").value;var s=document.getElementById("statusFilter").value;var sev=document.getElementById("severityFilter").value;var q=[];if(v)q.push("vesselCode="+v);if(s)q.push("status="+s);if(sev)q.push("severity="+sev);window.history.pushState({},"","/defects"+(q.length?"?"+q.join("&"):""));loadPage("/defects",q.length?"?"+q.join("&"):"")}<\/script>';
  }
  function renderEmptyState12() {
    return '<div class="empty-state"><div class="empty-state-icon">\u26A0\uFE0F</div><div>' + t("common.noData") + "</div></div>";
  }
  function renderErrorState12() {
    return '<div class="error-state">' + t("common.error") + "</div>";
  }

  // src/pages/deferrals.ts
  var filters12 = { vesselCode: "", status: "", sourceType: "" };
  var vesselsList9 = [];
  async function renderDeferralsPage() {
    try {
      const [vesselsRes, deferralsRes] = await Promise.all([
        api.vessels.list(),
        api.deferrals.list(filters12)
      ]);
      vesselsList9 = vesselsRes.items;
      const deferrals = deferralsRes.items;
      return renderContent20(deferrals);
    } catch (error) {
      return renderErrorState13();
    }
  }
  async function renderContent20(deferrals) {
    const filtersHtml = renderFilters14();
    if (deferrals.length === 0) {
      return filtersHtml + renderEmptyState13();
    }
    let html = filtersHtml + '<div class="table-container"><table><thead><tr><th>Deferral #</th><th>' + t("common.title") + "</th><th>" + t("common.vessel") + "</th><th>Source</th><th>Target Date</th><th>" + t("common.status") + "</th></tr></thead><tbody>";
    deferrals.forEach((deferral) => {
      const statusClass = "status-" + deferral.status.toLowerCase().replace(/_/g, "-");
      html += "<tr><td>" + deferral.deferralNumber + "</td><td>" + deferral.title + "</td><td>" + deferral.vesselCode + "</td><td>" + deferral.sourceType + "</td><td>" + formatDate(deferral.targetDate) + '</td><td><span class="status-badge ' + statusClass + '">' + deferral.status + "</span></td></tr>";
    });
    html += "</tbody></table></div>";
    return html;
  }
  function renderFilters14() {
    const vesselOptions = '<option value="">All Vessels</option>' + vesselsList9.map((v) => '<option value="' + v.code + '"' + (v.code === filters12.vesselCode ? " selected" : "") + ">" + v.code + "</option>").join("");
    const statusOptions = '<option value="">All Status</option><option value="ACTIVE"' + (filters12.status === "ACTIVE" ? " selected" : "") + '>ACTIVE</option><option value="PENDING_REVIEW"' + (filters12.status === "PENDING_REVIEW" ? " selected" : "") + '>PENDING_REVIEW</option><option value="CLOSED"' + (filters12.status === "CLOSED" ? " selected" : "") + ">CLOSED</option>";
    const sourceOptions = '<option value="">All Sources</option><option value="DEFECT"' + (filters12.sourceType === "DEFECT" ? " selected" : "") + '>DEFECT</option><option value="INSPECTION"' + (filters12.sourceType === "INSPECTION" ? " selected" : "") + '>INSPECTION</option><option value="CERTIFICATE"' + (filters12.sourceType === "CERTIFICATE" ? " selected" : "") + '>CERTIFICATE</option><option value="OTHER"' + (filters12.sourceType === "OTHER" ? " selected" : "") + ">OTHER</option>";
    return '<div class="filters"><div class="filter-group"><label class="filter-label">' + t("common.vessel") + '</label><select class="filter-select" id="vesselFilter" onchange="updateFilters()">' + vesselOptions + '</select></div><div class="filter-group"><label class="filter-label">' + t("common.status") + '</label><select class="filter-select" id="statusFilter" onchange="updateFilters()">' + statusOptions + '</select></div><div class="filter-group"><label class="filter-label">Source</label><select class="filter-select" id="sourceFilter" onchange="updateFilters()">' + sourceOptions + '</select></div></div><script>function updateFilters(){var v=document.getElementById("vesselFilter").value;var s=document.getElementById("statusFilter").value;var src=document.getElementById("sourceFilter").value;var q=[];if(v)q.push("vesselCode="+v);if(s)q.push("status="+s);if(src)q.push("sourceType="+src);window.history.pushState({},"","/deferrals"+(q.length?"?"+q.join("&"):""));loadPage("/deferrals",q.length?"?"+q.join("&"):"")}<\/script>';
  }
  function renderEmptyState13() {
    return '<div class="empty-state"><div class="empty-state-icon">\u23F3</div><div>' + t("common.noData") + "</div></div>";
  }
  function renderErrorState13() {
    return '<div class="error-state">' + t("common.error") + "</div>";
  }

  // src/pages/rca.ts
  var filters13 = { vesselCode: "", status: "" };
  var vesselsList10 = [];
  async function renderRCAPage() {
    try {
      const [vesselsRes, rcaRes] = await Promise.all([
        api.vessels.list(),
        api.rca.list(filters13)
      ]);
      vesselsList10 = vesselsRes.items;
      const rcaRecords = rcaRes.items;
      return renderContent21(rcaRecords);
    } catch (error) {
      return renderErrorState14();
    }
  }
  async function renderContent21(rcaRecords) {
    const filtersHtml = renderFilters15();
    if (rcaRecords.length === 0) {
      return filtersHtml + renderEmptyState14();
    }
    let html = filtersHtml + '<div class="table-container"><table><thead><tr><th>RCA #</th><th>' + t("common.title") + "</th><th>" + t("common.vessel") + "</th><th>Related Defect</th><th>Root Cause</th><th>" + t("common.status") + "</th><th>Created</th></tr></thead><tbody>";
    rcaRecords.forEach((rca) => {
      const statusClass = "status-" + rca.status.toLowerCase().replace(/_/g, "-");
      html += "<tr><td>" + rca.rcaNumber + "</td><td>" + rca.title + "</td><td>" + rca.vesselCode + "</td><td>" + (rca.relatedDefectNumber || "-") + "</td><td>" + (rca.rootCause || "-") + '</td><td><span class="status-badge ' + statusClass + '">' + rca.status + "</span></td><td>" + formatDate(rca.createdAt) + "</td></tr>";
    });
    html += "</tbody></table></div>";
    return html;
  }
  function renderFilters15() {
    const vesselOptions = '<option value="">All Vessels</option>' + vesselsList10.map((v) => '<option value="' + v.code + '"' + (v.code === filters13.vesselCode ? " selected" : "") + ">" + v.code + "</option>").join("");
    const statusOptions = '<option value="">All Status</option><option value="DRAFT"' + (filters13.status === "DRAFT" ? " selected" : "") + '>DRAFT</option><option value="IN_PROGRESS"' + (filters13.status === "IN_PROGRESS" ? " selected" : "") + '>IN_PROGRESS</option><option value="COMPLETED"' + (filters13.status === "COMPLETED" ? " selected" : "") + '>COMPLETED</option><option value="CLOSED"' + (filters13.status === "CLOSED" ? " selected" : "") + ">CLOSED</option>";
    return '<div class="filters"><div class="filter-group"><label class="filter-label">' + t("common.vessel") + '</label><select class="filter-select" id="vesselFilter" onchange="updateFilters()">' + vesselOptions + '</select></div><div class="filter-group"><label class="filter-label">' + t("common.status") + '</label><select class="filter-select" id="statusFilter" onchange="updateFilters()">' + statusOptions + '</select></div></div><script>function updateFilters(){var v=document.getElementById("vesselFilter").value;var s=document.getElementById("statusFilter").value;var q=[];if(v)q.push("vesselCode="+v);if(s)q.push("status="+s);window.history.pushState({},"","/rca"+(q.length?"?"+q.join("&"):""));loadPage("/rca",q.length?"?"+q.join("&"):"")}<\/script>';
  }
  function renderEmptyState14() {
    return '<div class="empty-state"><div class="empty-state-icon">\u{1F50D}</div><div>' + t("common.noData") + "</div></div>";
  }
  function renderErrorState14() {
    return '<div class="error-state">' + t("common.error") + "</div>";
  }

  // src/pages/capa.ts
  var filters14 = { vesselCode: "", status: "" };
  var vesselsList11 = [];
  async function renderCAPAPage() {
    try {
      const [vesselsRes, capaRes] = await Promise.all([
        api.vessels.list(),
        api.capa.list(filters14)
      ]);
      vesselsList11 = vesselsRes.items;
      const capaRecords = capaRes.items;
      return renderContent22(capaRecords);
    } catch (error) {
      return renderErrorState15();
    }
  }
  async function renderContent22(capaRecords) {
    const filtersHtml = renderFilters16();
    if (capaRecords.length === 0) {
      return filtersHtml + renderEmptyState15();
    }
    let html = filtersHtml + '<div class="table-container"><table><thead><tr><th>CAPA #</th><th>' + t("common.title") + "</th><th>" + t("common.vessel") + "</th><th>Source</th><th>Type</th><th>Due Date</th><th>" + t("common.status") + "</th></tr></thead><tbody>";
    capaRecords.forEach((capa) => {
      const statusClass = "status-" + capa.status.toLowerCase().replace(/_/g, "-");
      html += "<tr><td>" + capa.capaNumber + "</td><td>" + capa.title + "</td><td>" + capa.vesselCode + "</td><td>" + (capa.source || "-") + "</td><td>" + (capa.capaType || "-") + "</td><td>" + formatDate(capa.dueDate) + '</td><td><span class="status-badge ' + statusClass + '">' + capa.status + "</span></td></tr>";
    });
    html += "</tbody></table></div>";
    return html;
  }
  function renderFilters16() {
    const vesselOptions = '<option value="">All Vessels</option>' + vesselsList11.map((v) => '<option value="' + v.code + '"' + (v.code === filters14.vesselCode ? " selected" : "") + ">" + v.code + "</option>").join("");
    const statusOptions = '<option value="">All Status</option><option value="OPEN"' + (filters14.status === "OPEN" ? " selected" : "") + '>OPEN</option><option value="IN_PROGRESS"' + (filters14.status === "IN_PROGRESS" ? " selected" : "") + '>IN_PROGRESS</option><option value="VERIFIED"' + (filters14.status === "VERIFIED" ? " selected" : "") + '>VERIFIED</option><option value="CLOSED"' + (filters14.status === "CLOSED" ? " selected" : "") + ">CLOSED</option>";
    return '<div class="filters"><div class="filter-group"><label class="filter-label">' + t("common.vessel") + '</label><select class="filter-select" id="vesselFilter" onchange="updateFilters()">' + vesselOptions + '</select></div><div class="filter-group"><label class="filter-label">' + t("common.status") + '</label><select class="filter-select" id="statusFilter" onchange="updateFilters()">' + statusOptions + '</select></div></div><script>function updateFilters(){var v=document.getElementById("vesselFilter").value;var s=document.getElementById("statusFilter").value;var q=[];if(v)q.push("vesselCode="+v);if(s)q.push("status="+s);window.history.pushState({},"","/capa"+(q.length?"?"+q.join("&"):""));loadPage("/capa",q.length?"?"+q.join("&"):"")}<\/script>';
  }
  function renderEmptyState15() {
    return '<div class="empty-state"><div class="empty-state-icon">\u2705</div><div>' + t("common.noData") + "</div></div>";
  }
  function renderErrorState15() {
    return '<div class="error-state">' + t("common.error") + "</div>";
  }

  // src/pages/inspections.ts
  var filters15 = { vesselCode: "", status: "", type: "" };
  var vesselsList12 = [];
  async function renderInspectionsPage() {
    try {
      const [vesselsRes, inspectionsRes] = await Promise.all([
        api.vessels.list(),
        api.inspections.list(filters15)
      ]);
      vesselsList12 = vesselsRes.items;
      const inspections = inspectionsRes.items;
      return renderContent23(inspections);
    } catch (error) {
      return renderErrorState16();
    }
  }
  async function renderContent23(inspections) {
    const filtersHtml = renderFilters17();
    if (inspections.length === 0) {
      return filtersHtml + renderEmptyState16();
    }
    let html = filtersHtml + '<div class="table-container"><table><thead><tr><th>Inspection #</th><th>' + t("common.title") + "</th><th>" + t("common.vessel") + "</th><th>Type</th><th>Category</th><th>Inspector</th><th>Due Date</th><th>" + t("common.status") + "</th></tr></thead><tbody>";
    inspections.forEach((inspection) => {
      const statusClass = "status-" + inspection.status.toLowerCase().replace(/_/g, "-");
      html += "<tr><td>" + inspection.inspectionNumber + "</td><td>" + inspection.title + "</td><td>" + inspection.vesselCode + "</td><td>" + (inspection.type || "-") + "</td><td>" + (inspection.category || "-") + "</td><td>" + (inspection.inspectorName || "-") + "</td><td>" + formatDate(inspection.dueDate) + '</td><td><span class="status-badge ' + statusClass + '">' + inspection.status + "</span></td></tr>";
    });
    html += "</tbody></table></div>";
    return html;
  }
  function renderFilters17() {
    const vesselOptions = '<option value="">All Vessels</option>' + vesselsList12.map((v) => '<option value="' + v.code + '"' + (v.code === filters15.vesselCode ? " selected" : "") + ">" + v.code + "</option>").join("");
    const statusOptions = '<option value="">All Status</option><option value="PENDING"' + (filters15.status === "PENDING" ? " selected" : "") + '>PENDING</option><option value="SCHEDULED"' + (filters15.status === "SCHEDULED" ? " selected" : "") + '>SCHEDULED</option><option value="IN_PROGRESS"' + (filters15.status === "IN_PROGRESS" ? " selected" : "") + '>IN_PROGRESS</option><option value="COMPLETED"' + (filters15.status === "COMPLETED" ? " selected" : "") + '>COMPLETED</option><option value="OVERDUE"' + (filters15.status === "OVERDUE" ? " selected" : "") + '>OVERDUE</option><option value="CANCELLED"' + (filters15.status === "CANCELLED" ? " selected" : "") + ">CANCELLED</option>";
    const typeOptions = '<option value="">All Types</option><option value="STATUTORY"' + (filters15.type === "STATUTORY" ? " selected" : "") + '>STATUTORY</option><option value="CLASS"' + (filters15.type === "CLASS" ? " selected" : "") + '>CLASS</option><option value="PORT_STATE"' + (filters15.type === "PORT_STATE" ? " selected" : "") + '>PORT_STATE</option><option value="INTERNAL"' + (filters15.type === "INTERNAL" ? " selected" : "") + '>INTERNAL</option><option value="SAFETY"' + (filters15.type === "SAFETY" ? " selected" : "") + ">SAFETY</option>";
    return '<div class="filters"><div class="filter-group"><label class="filter-label">' + t("common.vessel") + '</label><select class="filter-select" id="vesselFilter" onchange="updateFilters()">' + vesselOptions + '</select></div><div class="filter-group"><label class="filter-label">' + t("common.status") + '</label><select class="filter-select" id="statusFilter" onchange="updateFilters()">' + statusOptions + '</select></div><div class="filter-group"><label class="filter-label">Type</label><select class="filter-select" id="typeFilter" onchange="updateFilters()">' + typeOptions + '</select></div></div><script>function updateFilters(){var v=document.getElementById("vesselFilter").value;var s=document.getElementById("statusFilter").value;var t=document.getElementById("typeFilter").value;var q=[];if(v)q.push("vesselCode="+v);if(s)q.push("status="+s);if(t)q.push("type="+t);window.history.pushState({},"","/inspections"+(q.length?"?"+q.join("&"):""));loadPage("/inspections",q.length?"?"+q.join("&"):"")}<\/script>';
  }
  function renderEmptyState16() {
    return '<div class="empty-state"><div class="empty-state-icon">\u{1F4CB}</div><div>' + t("common.noData") + "</div></div>";
  }
  function renderErrorState16() {
    return '<div class="error-state">' + t("common.error") + "</div>";
  }

  // src/pages/certificates.ts
  var filters16 = { vesselCode: "", status: "", type: "" };
  var vesselsList13 = [];
  async function renderCertificatesPage() {
    try {
      const [vesselsRes, certsRes] = await Promise.all([
        api.vessels.list(),
        api.certificates.list(filters16)
      ]);
      vesselsList13 = vesselsRes.items;
      const certificates = certsRes.items;
      return renderContent24(certificates);
    } catch (error) {
      return renderErrorState17();
    }
  }
  async function renderContent24(certificates) {
    const filtersHtml = renderFilters18();
    if (certificates.length === 0) {
      return filtersHtml + renderEmptyState17();
    }
    let html = filtersHtml + '<div class="table-container"><table><thead><tr><th>Certificate #</th><th>' + t("common.title") + "</th><th>" + t("common.vessel") + "</th><th>Type</th><th>Issuing Authority</th><th>Issue Date</th><th>Expiry Date</th><th>" + t("common.status") + "</th></tr></thead><tbody>";
    certificates.forEach((cert) => {
      const statusClass = "status-" + getStatusClass(cert.status, cert.expiryDate);
      html += "<tr><td>" + cert.certificateNumber + "</td><td>" + cert.title + "</td><td>" + cert.vesselCode + "</td><td>" + (cert.certificateType || "-") + "</td><td>" + (cert.issuingAuthority || "-") + "</td><td>" + formatDate(cert.issueDate) + "</td><td>" + formatDate(cert.expiryDate) + '</td><td><span class="status-badge ' + statusClass + '">' + cert.status + "</span></td></tr>";
    });
    html += "</tbody></table></div>";
    return html;
  }
  function getStatusClass(status, expiryDate) {
    if (status === "EXPIRED") return "expired";
    if (status === "ACTIVE" && expiryDate) {
      const expiry = new Date(expiryDate);
      const now = /* @__PURE__ */ new Date();
      const thirtyDays = 30 * 24 * 60 * 60 * 1e3;
      if (expiry.getTime() - now.getTime() < thirtyDays) {
        return "pending";
      }
    }
    return status.toLowerCase().replace(/_/g, "-");
  }
  function renderFilters18() {
    const vesselOptions = '<option value="">All Vessels</option>' + vesselsList13.map((v) => '<option value="' + v.code + '"' + (v.code === filters16.vesselCode ? " selected" : "") + ">" + v.code + "</option>").join("");
    const statusOptions = '<option value="">All Status</option><option value="ACTIVE"' + (filters16.status === "ACTIVE" ? " selected" : "") + '>ACTIVE</option><option value="EXPIRED"' + (filters16.status === "EXPIRED" ? " selected" : "") + '>EXPIRED</option><option value="PENDING"' + (filters16.status === "PENDING" ? " selected" : "") + '>PENDING</option><option value="REVOKED"' + (filters16.status === "REVOKED" ? " selected" : "") + ">REVOKED</option>";
    const typeOptions = '<option value="">All Types</option><option value="SAFETY"' + (filters16.type === "SAFETY" ? " selected" : "") + '>SAFETY</option><option value="POLLUTION"' + (filters16.type === "POLLUTION" ? " selected" : "") + '>POLLUTION</option><option value="DOCUMENT"' + (filters16.type === "DOCUMENT" ? " selected" : "") + '>DOCUMENT</option><option value="CREW"' + (filters16.type === "CREW" ? " selected" : "") + '>CREW</option><option value="LOADLINE"' + (filters16.type === "LOADLINE" ? " selected" : "") + '>LOADLINE</option><option value="MISC"' + (filters16.type === "MISC" ? " selected" : "") + ">MISC</option>";
    return '<div class="filters"><div class="filter-group"><label class="filter-label">' + t("common.vessel") + '</label><select class="filter-select" id="vesselFilter" onchange="updateFilters()">' + vesselOptions + '</select></div><div class="filter-group"><label class="filter-label">' + t("common.status") + '</label><select class="filter-select" id="statusFilter" onchange="updateFilters()">' + statusOptions + '</select></div><div class="filter-group"><label class="filter-label">Type</label><select class="filter-select" id="typeFilter" onchange="updateFilters()">' + typeOptions + '</select></div></div><script>function updateFilters(){var v=document.getElementById("vesselFilter").value;var s=document.getElementById("statusFilter").value;var t=document.getElementById("typeFilter").value;var q=[];if(v)q.push("vesselCode="+v);if(s)q.push("status="+s);if(t)q.push("type="+t);window.history.pushState({},"","/certificates"+(q.length?"?"+q.join("&"):""));loadPage("/certificates",q.length?"?"+q.join("&"):"")}<\/script>';
  }
  function renderEmptyState17() {
    return '<div class="empty-state"><div class="empty-state-icon">\u{1F4DC}</div><div>' + t("common.noData") + "</div></div>";
  }
  function renderErrorState17() {
    return '<div class="error-state">' + t("common.error") + "</div>";
  }

  // src/pages/ai-insights.ts
  var filters17 = { vesselCode: "", status: "", insightType: "", crossVessel: false };
  var vesselsList14 = [];
  var canViewCrossVessel = false;
  function canUserViewCrossVessel() {
    const session = getTenantSession();
    if (!session || !session.user) return false;
    const role = session.user.role || "";
    return role === "TENANT_ADMIN";
  }
  async function renderAIInsightsPage() {
    try {
      canViewCrossVessel = canUserViewCrossVessel();
      const [vesselsRes, insightsRes] = await Promise.all([
        api.vessels.list(),
        api.aiInsights.list(filters17)
      ]);
      vesselsList14 = vesselsRes.items;
      const insights = insightsRes.items;
      return renderContent25(insights);
    } catch (error) {
      return renderErrorState18();
    }
  }
  async function renderContent25(insights) {
    const filtersHtml = renderFilters19();
    if (insights.length === 0) {
      return filtersHtml + renderEmptyState18();
    }
    let html = filtersHtml + '<div class="insights-list">';
    insights.forEach((insight) => {
      const severityClass = getSeverityClass(insight.severity);
      const isCrossVessel = insight.crossVessel === true;
      html += '<div class="insight-card"><div class="insight-header"><div class="insight-title">' + insight.title + '</div><span class="priority-badge ' + severityClass + '">' + insight.severity + '</span></div><div class="insight-desc">' + insight.description + '</div><div class="insight-meta">' + (isCrossVessel ? '<span class="meta-badge meta-cross-vessel">Cross-Vessel</span>' : '<span class="meta-badge">' + insight.vesselCode + "</span>") + "<span>" + insight.category + "</span><span>" + formatDate(insight.createdAt) + "</span></div></div>";
    });
    html += "</div>";
    return html;
  }
  function getSeverityClass(severity) {
    switch (severity?.toUpperCase()) {
      case "CRITICAL":
        return "priority-critical";
      case "HIGH":
        return "priority-high";
      case "MEDIUM":
        return "priority-medium";
      case "LOW":
        return "priority-low";
      default:
        return "priority-medium";
    }
  }
  function renderFilters19() {
    const vesselOptions = '<option value="">All Vessels</option>' + vesselsList14.map((v) => '<option value="' + v.code + '"' + (v.code === filters17.vesselCode ? " selected" : "") + ">" + v.code + "</option>").join("");
    const statusOptions = '<option value="">All Status</option><option value="NEW"' + (filters17.status === "NEW" ? " selected" : "") + '>NEW</option><option value="REVIEWED"' + (filters17.status === "REVIEWED" ? " selected" : "") + '>REVIEWED</option><option value="DISMISSED"' + (filters17.status === "DISMISSED" ? " selected" : "") + '>DISMISSED</option><option value="ACTIONED"' + (filters17.status === "ACTIONED" ? " selected" : "") + ">ACTIONED</option>";
    const typeOptions = '<option value="">All Types</option><option value="ANOMALY_DETECTION"' + (filters17.insightType === "ANOMALY_DETECTION" ? " selected" : "") + '>ANOMALY_DETECTION</option><option value="RISK_ALERT"' + (filters17.insightType === "RISK_ALERT" ? " selected" : "") + '>RISK_ALERT</option><option value="MAINTENANCE_FORECAST"' + (filters17.insightType === "MAINTENANCE_FORECAST" ? " selected" : "") + '>MAINTENANCE_FORECAST</option><option value="COMPLIANCE_WARNING"' + (filters17.insightType === "COMPLIANCE_WARNING" ? " selected" : "") + '>COMPLIANCE_WARNING</option><option value="PATTERN_INSIGHT"' + (filters17.insightType === "PATTERN_INSIGHT" ? " selected" : "") + ">PATTERN_INSIGHT</option>";
    const crossVesselOptions = !canViewCrossVessel ? "" : '<div class="filter-group"><label class="filter-label">Cross-Vessel</label><label class="checkbox-label"><input type="checkbox" id="crossVesselFilter" onchange="updateFilters()" ' + (filters17.crossVessel ? "checked" : "") + " /> Show all vessels</label></div>";
    return '<div class="filters"><div class="filter-group"><label class="filter-label">' + t("common.vessel") + '</label><select class="filter-select" id="vesselFilter" onchange="updateFilters()">' + vesselOptions + '</select></div><div class="filter-group"><label class="filter-label">' + t("common.status") + '</label><select class="filter-select" id="statusFilter" onchange="updateFilters()">' + statusOptions + '</select></div><div class="filter-group"><label class="filter-label">Type</label><select class="filter-select" id="typeFilter" onchange="updateFilters()">' + typeOptions + "</select></div>" + crossVesselOptions + '</div><script>function updateFilters(){var v=document.getElementById("vesselFilter").value;var s=document.getElementById("statusFilter").value;var t=document.getElementById("typeFilter").value;var c=document.getElementById("crossVesselFilter")?document.getElementById("crossVesselFilter").checked:false;var q=[];if(v)q.push("vesselCode="+v);if(s)q.push("status="+s);if(t)q.push("insightType="+t);if(c)q.push("crossVessel=true");window.history.pushState({},"","/ai-insights"+(q.length?"?"+q.join("&"):""));loadPage("/ai-insights",q.length?"?"+q.join("&"):"")}<\/script>';
  }
  function renderEmptyState18() {
    return '<div class="empty-state"><div class="empty-state-icon">\u{1F916}</div><div>' + t("common.noData") + "</div></div>";
  }
  function renderErrorState18() {
    return '<div class="error-state">' + t("common.error") + "</div>";
  }

  // src/index.ts
  setBaseUrl("");
  var existingTenant = getTenantSession();
  if (existingTenant) {
    setApiTenantSlug(existingTenant.tenantSlug);
    setLocale(existingTenant.tenantLocale);
  }
  function requireTenant(handler) {
    return async () => {
      if (!isTenantAuthenticated()) {
        navigate("/app/login");
        return;
      }
      await handler();
    };
  }
  function requirePlatform(handler) {
    return async () => {
      if (!isPlatformAuthenticated()) {
        navigate("/platform/login");
        return;
      }
      await handler();
    };
  }
  function renderTenantLogin(errorMsg = "") {
    const app = document.getElementById("app");
    if (!app) return;
    app.innerHTML = `
<div class="login-wrap">
  <div class="login-card">
    <div class="login-logo">PMS SaaS</div>
    <div class="login-sub">Tenant Sign In</div>
    <p class="login-error" id="login-err">${errorMsg}</p>
    <form id="tenant-login-form">
      <div class="form-group">
        <label class="form-label">Tenant</label>
        <input class="form-input" type="text" id="f-tenant" value="demo" autocomplete="off" required>
      </div>
      <div class="form-group">
        <label class="form-label">Email / Usuario</label>
        <input class="form-input" type="text" id="f-identifier" value="admin@demo.local" required>
      </div>
      <div class="form-group">
        <label class="form-label">Contrase\xF1a</label>
        <input class="form-input" type="password" id="f-password" value="demo123" required>
      </div>
      <button type="submit" class="btn-primary">Ingresar</button>
    </form>
    <p class="platform-notice"><a id="go-platform">Platform admin \u2192</a></p>
  </div>
</div>`;
    document.getElementById("tenant-login-form").addEventListener("submit", handleTenantLogin);
    document.getElementById("go-platform").addEventListener("click", () => navigate("/platform/login"));
  }
  async function handleTenantLogin(e) {
    e.preventDefault();
    const tenant = document.getElementById("f-tenant").value.trim();
    const identifier = document.getElementById("f-identifier").value.trim();
    const password = document.getElementById("f-password").value;
    const errEl = document.getElementById("login-err");
    setApiTenantSlug(tenant);
    try {
      const result = await api.auth.loginTenant({ identifier, password });
      const bootstrap = result.bootstrap;
      setTenantSession({
        user: result.user,
        tenantSlug: tenant,
        tenantDisplayName: bootstrap?.tenant?.displayName ?? tenant,
        tenantPrimaryColor: bootstrap?.tenant?.primaryColor ?? "#EAB308",
        tenantLocale: result.user.locale ?? bootstrap?.tenant?.defaultLocale ?? "es",
        accessToken: result.session.accessToken,
        refreshToken: result.session.refreshToken
      });
      setLocale(result.user.locale ?? "es");
      navigate("/app/dashboard");
    } catch (err) {
      errEl.textContent = err instanceof Error ? err.message : "Error de conexi\xF3n";
    }
  }
  function renderPlatformLogin(errorMsg = "") {
    const app = document.getElementById("app");
    if (!app) return;
    app.innerHTML = `
<div class="login-wrap">
  <div class="login-card">
    <div class="login-logo" style="color:#93c5fd">PMS SaaS</div>
    <div class="login-sub">Platform Sign In</div>
    <p class="login-error" id="login-err">${errorMsg}</p>
    <form id="platform-login-form">
      <div class="form-group">
        <label class="form-label">Email</label>
        <input class="form-input" type="email" id="f-email" value="admin@localhost" required>
      </div>
      <div class="form-group">
        <label class="form-label">Contrase\xF1a</label>
        <input class="form-input" type="password" id="f-password" value="admin123" required>
      </div>
      <button type="submit" class="btn-primary" style="background:#3b82f6">Ingresar</button>
    </form>
    <p class="platform-notice"><a id="go-tenant">\u2190 Tenant login</a></p>
  </div>
</div>`;
    document.getElementById("platform-login-form").addEventListener("submit", handlePlatformLogin);
    document.getElementById("go-tenant").addEventListener("click", () => navigate("/app/login"));
  }
  async function handlePlatformLogin(e) {
    e.preventDefault();
    const email = document.getElementById("f-email").value.trim();
    const password = document.getElementById("f-password").value;
    const errEl = document.getElementById("login-err");
    try {
      const result = await api.auth.loginPlatform({ email, password });
      setPlatformSession({
        user: result.user,
        accessToken: result.session.accessToken,
        refreshToken: result.session.refreshToken
      });
      navigate("/platform/tenants");
    } catch (err) {
      errEl.textContent = err instanceof Error ? err.message : "Error de conexi\xF3n";
    }
  }
  async function pageVessels() {
    const content = await renderVesselsPage();
    renderTenantShell(t("nav.vessels"), "/app/vessels", content);
  }
  async function pageAssets() {
    const content = await renderAssetsPage();
    renderTenantShell(t("nav.assets"), "/app/assets", content);
  }
  async function pageMaintenancePlans() {
    const content = await renderMaintenancePlansPage();
    renderTenantShell(t("nav.maintenance"), "/app/maintenance-plans", content);
  }
  async function pageWorkOrders() {
    const content = await renderWorkOrdersPage();
    renderTenantShell(t("nav.workOrders"), "/app/work-orders", content);
  }
  async function pageDailyReports() {
    const content = await renderDailyReportsPage();
    renderTenantShell(t("nav.dailyReports"), "/app/daily-reports", content);
  }
  async function pageDefects() {
    const content = await renderDefectsPage();
    renderTenantShell(t("nav.defects"), "/app/defects", content);
  }
  async function pageDeferrals() {
    const content = await renderDeferralsPage();
    renderTenantShell(t("nav.deferrals"), "/app/deferrals", content);
  }
  async function pageRca() {
    const content = await renderRCAPage();
    renderTenantShell(t("nav.rca"), "/app/rca", content);
  }
  async function pageCapa() {
    const content = await renderCAPAPage();
    renderTenantShell(t("nav.capa"), "/app/capa", content);
  }
  async function pageInspections() {
    const content = await renderInspectionsPage();
    renderTenantShell(t("nav.inspections"), "/app/inspections", content);
  }
  async function pageCertificates() {
    const content = await renderCertificatesPage();
    renderTenantShell(t("nav.certificates"), "/app/certificates", content);
  }
  async function pageAiInsights() {
    const content = await renderAIInsightsPage();
    renderTenantShell(t("nav.aiInsights"), "/app/ai-insights", content);
  }
  async function pagePlatformTenantRoutes() {
    const path = getLogicalPath();
    if (/^\/platform\/tenants\/[^/]+\/domains/.test(path)) {
      await pagePlatformDomains();
      return;
    }
    if (/^\/platform\/tenants\/[^/]+\/invitations/.test(path)) {
      await pagePlatformInvitations();
      return;
    }
    if (/^\/platform\/tenants\/[^/]+\/users/.test(path)) {
      await pagePlatformTenantUsers();
      return;
    }
    if (/^\/platform\/tenants\/[^/]+$/.test(path)) {
      await pagePlatformTenantDetail();
      return;
    }
    await pagePlatformTenants();
  }
  registerRoute("/", async () => {
    if (isPlatformAuthenticated()) navigate("/platform/tenants");
    else if (isTenantAuthenticated()) navigate("/app/dashboard");
    else navigate("/app/login");
  });
  registerRoute("/app/login", async () => {
    if (isTenantAuthenticated()) {
      navigate("/app/dashboard");
      return;
    }
    renderTenantLogin();
  });
  registerRoute("/platform/login", async () => {
    if (isPlatformAuthenticated()) {
      navigate("/platform/tenants");
      return;
    }
    renderPlatformLogin();
  });
  registerRoute("/app/dashboard", requireTenant(pageDashboard));
  registerRoute("/app/vessels", requireTenant(pageVessels));
  registerRoute("/app/assets", requireTenant(pageAssets));
  registerRoute("/app/maintenance-plans", requireTenant(pageMaintenancePlans));
  registerRoute("/app/work-orders", requireTenant(pageWorkOrders));
  registerRoute("/app/daily-reports", requireTenant(pageDailyReports));
  registerRoute("/app/defects", requireTenant(pageDefects));
  registerRoute("/app/deferrals", requireTenant(pageDeferrals));
  registerRoute("/app/rca", requireTenant(pageRca));
  registerRoute("/app/capa", requireTenant(pageCapa));
  registerRoute("/app/inspections", requireTenant(pageInspections));
  registerRoute("/app/certificates", requireTenant(pageCertificates));
  registerRoute("/app/ai-insights", requireTenant(pageAiInsights));
  registerRoute("/app/spares", requireTenant(pageSpares));
  registerRoute("/app/stock-movements", requireTenant(pageStockMovements));
  registerRoute("/app/providers", requireTenant(pageProviders));
  registerRoute("/app/spare-orders", requireTenant(pageSpareOrders));
  registerRoute("/app/provider-evaluations", requireTenant(pageProviderEvaluations));
  registerRoute("/app/provider-nonconformities", requireTenant(pageProviderNonconformities));
  registerRoute("/platform/tenants", requirePlatform(pagePlatformTenants));
  registerRoute("/platform/tenants/*", requirePlatform(pagePlatformTenantRoutes));
  registerRoute("/platform/users", requirePlatform(pagePlatformUsers));
  registerRoute("/platform/prompts", requirePlatform(pagePlatformPrompts));
  registerRoute("/platform/audit-events", requirePlatform(pagePlatformAuditEvents));
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => initRouter());
  } else {
    initRouter();
  }
})();
//# sourceMappingURL=bundle.js.map
