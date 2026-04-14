/**
 * Shell renderers.
 * Renders into document.getElementById("app") — no doctype/head/style emitted.
 * CSS lives in public/index.html.
 *
 * Pattern for page authors (adding a read-only tenant page):
 *   1. Export an async function that calls renderTenantShell(title, activeNav, content).
 *   2. After calling renderTenantShell, attach any needed event listeners to
 *      elements inside #page-content.
 *   3. Register the route in src/index.ts.
 *
 * Global helpers exposed on window.__pms (used by onclick attributes):
 *   __pms.tenantLogout()
 *   __pms.platformLogout()
 *   __pms.navigate(logicalPath)
 */

import { t } from "./i18n";
import { getTenantSession, getPlatformSession } from "./session";
import { navigate, href } from "./router";

// ─── Global helpers ───────────────────────────────────────────────────────────

function installGlobals(): void {
  (window as any).__pms = {
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
    navigate,
  };
}

installGlobals();

// ─── Tenant shell ─────────────────────────────────────────────────────────────

const TENANT_NAV: { path: string; key: string }[] = [
  { path: "/app/dashboard",         key: "nav.dashboard" },
  { path: "/app/vessels",           key: "nav.vessels" },
  { path: "/app/assets",            key: "nav.assets" },
  { path: "/app/maintenance-plans", key: "nav.maintenance" },
  { path: "/app/work-orders",       key: "nav.workOrders" },
  { path: "/app/daily-reports",     key: "nav.dailyReports" },
  { path: "/app/defects",           key: "nav.defects" },
  { path: "/app/deferrals",         key: "nav.deferrals" },
  { path: "/app/rca",               key: "nav.rca" },
  { path: "/app/capa",              key: "nav.capa" },
  { path: "/app/inspections",       key: "nav.inspections" },
  { path: "/app/certificates",      key: "nav.certificates" },
  { path: "/app/spares",            key: "nav.spares" },
  { path: "/app/stock-movements",   key: "nav.stockMovements" },
  { path: "/app/providers",         key: "nav.providers" },
  { path: "/app/spare-orders",      key: "nav.spareOrders" },
  { path: "/app/provider-evaluations", key: "nav.providerEvals" },
  { path: "/app/provider-nonconformities", key: "nav.providerNC" },
  { path: "/app/ai-insights",       key: "nav.aiInsights" },
];

/**
 * Render the full tenant layout into #app.
 * @param pageTitle  Title shown in the header bar.
 * @param activeNav  Logical path identifying the active nav entry.
 * @param content    Inner HTML for the content area.
 */
export function renderTenantShell(pageTitle: string, activeNav: string, content: string): void {
  const session = getTenantSession();
  const app = document.getElementById("app");
  if (!app) return;

  if (!session) {
    navigate("/app/login");
    return;
  }

  const navHtml = TENANT_NAV.map(({ path, key }) => {
    const isActive = activeNav === path
      || (path !== "/app/dashboard" && activeNav.startsWith(path));
    const cls = isActive ? " active" : "";
    return `<a href="${href(path)}" class="nav-item${cls}"
      onclick="event.preventDefault();window.__pms.navigate('${path}')">${t(key)}</a>`;
  }).join("");

  const displayName = [session.user.firstName, session.user.lastName].filter(Boolean).join(" ")
    || session.user.email;

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
}

/** Swap only the content area — avoids full shell re-render. */
export function updateTenantContent(content: string): void {
  const el = document.getElementById("page-content");
  if (el) el.innerHTML = content;
}

// ─── Platform shell ───────────────────────────────────────────────────────────

const PLATFORM_NAV: { path: string; key: string }[] = [
  { path: "/platform/tenants", key: "platform.nav.tenants" },
  { path: "/platform/users",   key: "platform.nav.users" },
  { path: "/platform/prompts", key: "platform.nav.prompts" },
  { path: "/platform/audit-events", key: "platform.nav.audit" },
];

/**
 * Render the full platform (superadmin) layout into #app.
 */
export function renderPlatformShell(pageTitle: string, activeNav: string, content: string): void {
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
}

/** Swap only the content area in the platform shell. */
export function updatePlatformContent(content: string): void {
  const el = document.getElementById("page-content");
  if (el) el.innerHTML = content;
}
