/**
 * web-legacy SPA entry point.
 *
 * Boot order:
 *   1. Restore i18n locale from session (if any).
 *   2. Restore tenant slug into API client (if tenant session exists).
 *   3. Register all routes.
 *   4. initRouter() → dispatches to the current logical path.
 *
 * Adding a new read-only TENANT page (no changes to auth/shell/router needed):
 *   a. Create src/pages/my-page.ts:
 *        export async function pageMyPage(): Promise<void> {
 *          renderTenantShell(t("nav.myPage"), "/app/my-page", "<div>…</div>");
 *        }
 *   b. Import it here.
 *   c. registerRoute("/app/my-page", requireTenant(pageMyPage));
 *   Done.
 *
 * Adding a new read-only PLATFORM page:
 *   a. Create src/pages/platform-my-page.ts with renderPlatformShell pattern.
 *   b. registerRoute("/platform/my-page", requirePlatform(pagePlatformMyPage));
 *   Done.
 */

import { setBaseUrl, setApiTenantSlug } from "./api";
import { setLocale, t }                 from "./i18n";
import { api }                          from "./api";
import {
  getTenantSession, setTenantSession, isTenantAuthenticated,
  setPlatformSession, isPlatformAuthenticated,
} from "./session";
import { navigate, registerRoute, initRouter } from "./router";
import { renderTenantShell, renderPlatformShell } from "./shell";
import { getLogicalPath } from "./router";

// Page modules
import { pageDashboard }       from "./pages/dashboard";
import { pageSpares } from "./pages/spares";
import { pageStockMovements } from "./pages/stock-movements";
import { pageProviders } from "./pages/providers";
import { pageSpareOrders } from "./pages/spare-orders";
import { pageProviderEvaluations } from "./pages/provider-evaluations";
import { pageProviderNonconformities } from "./pages/provider-nonconformities";
import { pagePlatformTenants } from "./pages/platform-tenants";
import { pagePlatformTenantDetail } from "./pages/platform-tenant-detail";
import { pagePlatformDomains } from "./pages/platform-domains";
import { pagePlatformInvitations } from "./pages/platform-invitations";
import { pagePlatformTenantUsers } from "./pages/platform-tenant-users";
import { pagePlatformUsers } from "./pages/platform-users";
import { pagePlatformPrompts } from "./pages/platform-prompts";
import { pagePlatformAuditEvents } from "./pages/platform-audit-events";
import { renderVesselsPage } from "./pages/vessels";
import { renderAssetsPage } from "./pages/assets";
import { renderMaintenancePlansPage } from "./pages/maintenance-plans";
import { renderWorkOrdersPage } from "./pages/work-orders";
import { renderDailyReportsPage } from "./pages/daily-reports";
import { renderDefectsPage } from "./pages/defects";
import { renderDeferralsPage } from "./pages/deferrals";
import { renderRCAPage } from "./pages/rca";
import { renderCAPAPage } from "./pages/capa";
import { renderInspectionsPage } from "./pages/inspections";
import { renderCertificatesPage } from "./pages/certificates";
import { renderAIInsightsPage } from "./pages/ai-insights";

// ─── Configuration ────────────────────────────────────────────────────────────

setBaseUrl(""); // same origin — backend handles both API + static frontend

const existingTenant = getTenantSession();
if (existingTenant) {
  setApiTenantSlug(existingTenant.tenantSlug);
  setLocale(existingTenant.tenantLocale);
}

// ─── Route guards ─────────────────────────────────────────────────────────────

type PageFn = () => Promise<void>;

function requireTenant(handler: PageFn): PageFn {
  return async () => {
    if (!isTenantAuthenticated()) { navigate("/app/login"); return; }
    await handler();
  };
}

function requirePlatform(handler: PageFn): PageFn {
  return async () => {
    if (!isPlatformAuthenticated()) { navigate("/platform/login"); return; }
    await handler();
  };
}

// ─── Tenant login ─────────────────────────────────────────────────────────────

function renderTenantLogin(errorMsg = ""): void {
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
        <label class="form-label">Contraseña</label>
        <input class="form-input" type="password" id="f-password" value="demo123" required>
      </div>
      <button type="submit" class="btn-primary">Ingresar</button>
    </form>
    <p class="platform-notice"><a id="go-platform">Platform admin →</a></p>
  </div>
</div>`;
  document.getElementById("tenant-login-form")!
    .addEventListener("submit", handleTenantLogin);
  document.getElementById("go-platform")!
    .addEventListener("click", () => navigate("/platform/login"));
}

async function handleTenantLogin(e: Event): Promise<void> {
  e.preventDefault();
  const tenant     = (document.getElementById("f-tenant")     as HTMLInputElement).value.trim();
  const identifier = (document.getElementById("f-identifier") as HTMLInputElement).value.trim();
  const password   = (document.getElementById("f-password")   as HTMLInputElement).value;
  const errEl      = document.getElementById("login-err")!;

  setApiTenantSlug(tenant); // stamp header so backend resolves tenant

  try {
    const result    = await api.auth.loginTenant({ identifier, password });
    const bootstrap = result.bootstrap;
    setTenantSession({
      user:               result.user,
      tenantSlug:         tenant,
      tenantDisplayName:  bootstrap?.tenant?.displayName ?? tenant,
      tenantPrimaryColor: bootstrap?.tenant?.primaryColor ?? "#EAB308",
      tenantLocale:       result.user.locale ?? bootstrap?.tenant?.defaultLocale ?? "es",
      accessToken:        result.session.accessToken,
      refreshToken:       result.session.refreshToken,
    });
    setLocale(result.user.locale ?? "es");
    navigate("/app/dashboard");
  } catch (err: unknown) {
    errEl.textContent = err instanceof Error ? err.message : "Error de conexión";
  }
}

// ─── Platform login ───────────────────────────────────────────────────────────

function renderPlatformLogin(errorMsg = ""): void {
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
        <label class="form-label">Contraseña</label>
        <input class="form-input" type="password" id="f-password" value="admin123" required>
      </div>
      <button type="submit" class="btn-primary" style="background:#3b82f6">Ingresar</button>
    </form>
    <p class="platform-notice"><a id="go-tenant">← Tenant login</a></p>
  </div>
</div>`;
  document.getElementById("platform-login-form")!
    .addEventListener("submit", handlePlatformLogin);
  document.getElementById("go-tenant")!
    .addEventListener("click", () => navigate("/app/login"));
}

async function handlePlatformLogin(e: Event): Promise<void> {
  e.preventDefault();
  const email    = (document.getElementById("f-email")    as HTMLInputElement).value.trim();
  const password = (document.getElementById("f-password") as HTMLInputElement).value;
  const errEl    = document.getElementById("login-err")!;
  try {
    const result = await api.auth.loginPlatform({ email, password });
    setPlatformSession({
      user:         result.user,
      accessToken:  result.session.accessToken,
      refreshToken: result.session.refreshToken,
    });
    navigate("/platform/tenants");
  } catch (err: unknown) {
    errEl.textContent = err instanceof Error ? err.message : "Error de conexión";
  }
}

// ─── Stub renderers ───────────────────────────────────────────────────────────
// Replace these with real page imports as features are implemented.

async function tenantStub(labelKey: string, path: string): Promise<void> {
  renderTenantShell(t(labelKey), path, `
<div class="card">
  <div class="page-header"><div class="page-title">${t(labelKey)}</div></div>
  <div class="empty-state">
    <div style="font-size:2rem;margin-bottom:12px">🚧</div>
    <div>Página en construcción</div>
    <div style="font-size:0.8rem;margin-top:8px;color:#64748B">
      Crea <code>src/pages/${path.replace("/app/","")}.ts</code> y regístrala en index.ts.
    </div>
  </div>
</div>`);
}

async function platformStub(labelKey: string, path: string): Promise<void> {
  renderPlatformShell(t(labelKey), path, `
<div class="card">
  <div class="page-header"><div class="page-title">${t(labelKey)}</div></div>
  <div class="empty-state">
    <div style="font-size:2rem;margin-bottom:12px">🚧</div>
    <div>Página en construcción</div>
    <div style="font-size:0.8rem;margin-top:8px;color:#64748B">
      Crea <code>src/pages/platform-${path.replace("/platform/","")}.ts</code> y regístrala en index.ts.
    </div>
  </div>
  </div>`);
}

async function pageVessels(): Promise<void> {
  const content = await renderVesselsPage();
  renderTenantShell(t("nav.vessels"), "/app/vessels", content);
}

async function pageAssets(): Promise<void> {
  const content = await renderAssetsPage();
  renderTenantShell(t("nav.assets"), "/app/assets", content);
}

async function pageMaintenancePlans(): Promise<void> {
  const content = await renderMaintenancePlansPage();
  renderTenantShell(t("nav.maintenance"), "/app/maintenance-plans", content);
}

async function pageWorkOrders(): Promise<void> {
  const content = await renderWorkOrdersPage();
  renderTenantShell(t("nav.workOrders"), "/app/work-orders", content);
}

async function pageDailyReports(): Promise<void> {
  const content = await renderDailyReportsPage();
  renderTenantShell(t("nav.dailyReports"), "/app/daily-reports", content);
}

async function pageDefects(): Promise<void> {
  const content = await renderDefectsPage();
  renderTenantShell(t("nav.defects"), "/app/defects", content);
}

async function pageDeferrals(): Promise<void> {
  const content = await renderDeferralsPage();
  renderTenantShell(t("nav.deferrals"), "/app/deferrals", content);
}

async function pageRca(): Promise<void> {
  const content = await renderRCAPage();
  renderTenantShell(t("nav.rca"), "/app/rca", content);
}

async function pageCapa(): Promise<void> {
  const content = await renderCAPAPage();
  renderTenantShell(t("nav.capa"), "/app/capa", content);
}

async function pageInspections(): Promise<void> {
  const content = await renderInspectionsPage();
  renderTenantShell(t("nav.inspections"), "/app/inspections", content);
}

async function pageCertificates(): Promise<void> {
  const content = await renderCertificatesPage();
  renderTenantShell(t("nav.certificates"), "/app/certificates", content);
}

async function pageAiInsights(): Promise<void> {
  const content = await renderAIInsightsPage();
  renderTenantShell(t("nav.aiInsights"), "/app/ai-insights", content);
}

async function pagePlatformTenantRoutes(): Promise<void> {
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

// ─── Route table ─────────────────────────────────────────────────────────────

// Root — smart redirect
registerRoute("/", async () => {
  if (isPlatformAuthenticated()) navigate("/platform/tenants");
  else if (isTenantAuthenticated()) navigate("/app/dashboard");
  else navigate("/app/login");
});

// Auth
registerRoute("/app/login", async () => {
  if (isTenantAuthenticated()) { navigate("/app/dashboard"); return; }
  renderTenantLogin();
});
registerRoute("/platform/login", async () => {
  if (isPlatformAuthenticated()) { navigate("/platform/tenants"); return; }
  renderPlatformLogin();
});

// ── Tenant pages ──────────────────────────────────────────────────────────────
registerRoute("/app/dashboard",         requireTenant(pageDashboard));
registerRoute("/app/vessels",           requireTenant(pageVessels));
registerRoute("/app/assets",            requireTenant(pageAssets));
registerRoute("/app/maintenance-plans", requireTenant(pageMaintenancePlans));
registerRoute("/app/work-orders",       requireTenant(pageWorkOrders));
registerRoute("/app/daily-reports",     requireTenant(pageDailyReports));
registerRoute("/app/defects",           requireTenant(pageDefects));
registerRoute("/app/deferrals",         requireTenant(pageDeferrals));
registerRoute("/app/rca",               requireTenant(pageRca));
registerRoute("/app/capa",              requireTenant(pageCapa));
registerRoute("/app/inspections",       requireTenant(pageInspections));
registerRoute("/app/certificates",      requireTenant(pageCertificates));
registerRoute("/app/ai-insights",       requireTenant(pageAiInsights));
registerRoute("/app/spares",            requireTenant(pageSpares));
registerRoute("/app/stock-movements",   requireTenant(pageStockMovements));
registerRoute("/app/providers",         requireTenant(pageProviders));
registerRoute("/app/spare-orders",      requireTenant(pageSpareOrders));
registerRoute("/app/provider-evaluations", requireTenant(pageProviderEvaluations));
registerRoute("/app/provider-nonconformities", requireTenant(pageProviderNonconformities));

// ── Platform pages ────────────────────────────────────────────────────────────
registerRoute("/platform/tenants",      requirePlatform(pagePlatformTenants));
registerRoute("/platform/tenants/*",    requirePlatform(pagePlatformTenantRoutes));
registerRoute("/platform/users",        requirePlatform(pagePlatformUsers));
registerRoute("/platform/prompts",      requirePlatform(pagePlatformPrompts));
registerRoute("/platform/audit-events", requirePlatform(pagePlatformAuditEvents));

// ─── Boot ─────────────────────────────────────────────────────────────────────

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => initRouter());
} else {
  initRouter();
}
