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

function parseCellValue(rawText: string): string | number {
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

function applyTableSorting(root: ParentNode): void {
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
      const renderHeader = (dir: "asc" | "desc" | "none") => {
        const suffix = dir === "none" ? " ↕" : dir === "asc" ? " ↑" : " ↓";
        th.textContent = `${baseLabel}${suffix}`;
      };
      renderHeader("none");

      th.addEventListener("click", () => {
        const current = (th.getAttribute("data-sort-direction") as "asc" | "desc" | "none") ?? "none";
        const next: "asc" | "desc" = current === "asc" ? "desc" : "asc";

        headers.forEach(other => {
          if (other !== th) {
            other.setAttribute("data-sort-direction", "none");
            const otherLabel = (other.textContent ?? "").replace(/[\s]*(↕|↑|↓)$/, "").trim();
            if (otherLabel) other.textContent = `${otherLabel} ↕`;
          }
        });

        th.setAttribute("data-sort-direction", next);
        renderHeader(next);

        const rows = Array.from(tbody.querySelectorAll("tr"));
        const sorted = rows
          .map((row, rowIndex) => {
            const cellText = (row.children.item(index) as HTMLElement | null)?.innerText ?? "";
            return { row, rowIndex, value: parseCellValue(cellText) };
          })
          .sort((a, b) => {
            if (typeof a.value === "number" && typeof b.value === "number") {
              if (a.value < b.value) return next === "asc" ? -1 : 1;
              if (a.value > b.value) return next === "asc" ? 1 : -1;
              return a.rowIndex - b.rowIndex;
            }

            const cmp = String(a.value).localeCompare(String(b.value), undefined, { numeric: true, sensitivity: "base" });
            if (cmp !== 0) return next === "asc" ? cmp : -cmp;
            return a.rowIndex - b.rowIndex;
          });

        for (const item of sorted) tbody.appendChild(item.row);
      });
    });
  }
}

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

  applyTableSorting(app);
}

/** Swap only the content area — avoids full shell re-render. */
export function updateTenantContent(content: string): void {
  const el = document.getElementById("page-content");
  if (el) {
    el.innerHTML = content;
    applyTableSorting(el);
  }
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

  applyTableSorting(app);
}

/** Swap only the content area in the platform shell. */
export function updatePlatformContent(content: string): void {
  const el = document.getElementById("page-content");
  if (el) {
    el.innerHTML = content;
    applyTableSorting(el);
  }
}
