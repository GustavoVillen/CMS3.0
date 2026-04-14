import { t, formatDate } from "../i18n";
import { api } from "../api";
import { renderPlatformShell } from "../shell";
import { getLogicalPath } from "../router";

export async function pagePlatformDomains(): Promise<void> {
  const tenantSlug = getTenantSlug();
  if (!tenantSlug) {
    renderPlatformShell(t("platform.domains.title"), "/platform/tenants",
      `<div class="error-state">${t("platform.domains.noTenant")}</div>`);
    return;
  }

  renderPlatformShell(t("platform.domains.title"), "/platform/tenants",
    `<div class="loading-state">${t("common.loading")}</div>`);

  try {
    const res = await api.platform.tenantDomains.list(tenantSlug);
    const content = renderContent(tenantSlug, res.items);
    renderPlatformShell(t("platform.domains.title"), "/platform/tenants", content);
    installActions(tenantSlug);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : t("common.error");
    renderPlatformShell(t("platform.domains.title"), "/platform/tenants",
      `<div class="error-state">${msg}</div>`);
  }
}

function renderContent(tenantSlug: string, domains: any[]): string {
  const header = `
<div class="page-header">
  <div>
    <a href="#" onclick="event.preventDefault();window.__pms.navigate('/platform/tenants/${tenantSlug}')">← ${t("platform.common.back")}</a>
  </div>
</div>
<div class="page-header">
  <div class="page-title">${t("platform.domains.title")} · ${tenantSlug}</div>
  <button class="btn" onclick="window.__pms.platformDomains.showForm()">${t("platform.domains.add")}</button>
</div>`;

  if (domains.length === 0) {
    return header + `<div class="empty-state">${t("platform.domains.empty")}</div>` + renderModal();
  }

  const rows = domains.map((d) => `
    <tr>
      <td>${d.host}</td>
      <td>${d.isPrimary ? t("common.yes") : "—"}</td>
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
${renderModal()}`;
}

function renderModal(): string {
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

function installActions(tenantSlug: string): void {
  const modal = document.getElementById("domain-modal") as HTMLDivElement | null;
  const form = document.getElementById("domain-form") as HTMLFormElement | null;
  const store: { currentId: string | null } = { currentId: null };

  (window as any).__pms.platformDomains = {
    showForm: () => {
      store.currentId = null;
      if (modal) modal.style.display = "flex";
      const host = document.getElementById("domain-host") as HTMLInputElement | null;
      const primary = document.getElementById("domain-primary") as HTMLInputElement | null;
      if (host) host.value = "";
      if (primary) primary.checked = false;
    },
    edit: (id: string, hostValue: string, isPrimary: boolean) => {
      store.currentId = id;
      if (modal) modal.style.display = "flex";
      const host = document.getElementById("domain-host") as HTMLInputElement | null;
      const primary = document.getElementById("domain-primary") as HTMLInputElement | null;
      if (host) host.value = hostValue || "";
      if (primary) primary.checked = !!isPrimary;
    },
    close: () => {
      if (modal) modal.style.display = "none";
    },
    delete: async (id: string) => {
      if (!confirm(t("platform.domains.confirmDelete"))) return;
      try {
        await api.platform.tenantDomains.delete(tenantSlug, id);
        (window as any).__pms.navigate(`/platform/tenants/${tenantSlug}/domains`);
      } catch (err: any) {
        alert(err.message || t("common.error"));
      }
    },
  };

  if (form) {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const host = (document.getElementById("domain-host") as HTMLInputElement | null)?.value.trim() || "";
      const isPrimary = (document.getElementById("domain-primary") as HTMLInputElement | null)?.checked || false;
      try {
        if (store.currentId) {
          await api.platform.tenantDomains.update(tenantSlug, store.currentId, { host, isPrimary });
        } else {
          await api.platform.tenantDomains.create(tenantSlug, { host, isPrimary });
        }
        if (modal) modal.style.display = "none";
        (window as any).__pms.navigate(`/platform/tenants/${tenantSlug}/domains`);
      } catch (err: any) {
        alert(err.message || t("common.error"));
      }
    };
  }
}

function getTenantSlug(): string {
  const path = getLogicalPath();
  const match = path.match(/^\/platform\/tenants\/([^/]+)\/domains/);
  return match ? match[1] : "";
}
