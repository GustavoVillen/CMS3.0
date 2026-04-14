import { t, formatDate } from "../i18n";
import { api } from "../api";
import { renderPlatformShell } from "../shell";
import { getLogicalPath } from "../router";

export async function pagePlatformTenantDetail(): Promise<void> {
  const slug = getTenantSlug();
  if (!slug) {
    renderPlatformShell(t("platform.tenants.title"), "/platform/tenants",
      `<div class="error-state">${t("platform.tenants.noTenant")}</div>`);
    return;
  }

  renderPlatformShell(t("platform.tenants.title"), "/platform/tenants",
    `<div class="loading-state">${t("common.loading")}</div>`);

  try {
    const tenant = await api.platform.tenants.get(slug);
    const content = renderContent(slug, tenant);
    renderPlatformShell(t("platform.tenants.title"), "/platform/tenants", content);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : t("common.error");
    renderPlatformShell(t("platform.tenants.title"), "/platform/tenants",
      `<div class="error-state">${msg}</div>`);
  }
}

function renderContent(slug: string, tenant: any): string {
  return `
<div class="page-header">
  <div>
    <a href="#" onclick="event.preventDefault();window.__pms.navigate('/platform/tenants')">← ${t("platform.common.back")}</a>
  </div>
</div>
<div class="page-header">
  <div class="page-title">${t("platform.tenants.details")} · ${slug}</div>
</div>
<div class="card">
  <div class="table-wrap">
    <table>
      <tbody>
        <tr><th>${t("platform.tenants.slug")}</th><td>${tenant.slug}</td></tr>
        <tr><th>${t("platform.tenants.display")}</th><td>${tenant.displayName ?? "—"}</td></tr>
        <tr><th>${t("platform.tenants.status")}</th><td>${tenant.status ?? "—"}</td></tr>
        <tr><th>${t("platform.tenants.locale")}</th><td>${tenant.defaultLocale ?? "—"}</td></tr>
        <tr><th>${t("common.timezone")}</th><td>${tenant.timezone ?? "—"}</td></tr>
        <tr><th>${t("common.currency")}</th><td>${tenant.currency ?? "—"}</td></tr>
        <tr><th>${t("platform.tenants.plan")}</th><td>${tenant.planCode ?? "—"}</td></tr>
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

function getTenantSlug(): string {
  const path = getLogicalPath();
  const match = path.match(/^\/platform\/tenants\/([^/]+)$/);
  return match ? match[1] : "";
}
