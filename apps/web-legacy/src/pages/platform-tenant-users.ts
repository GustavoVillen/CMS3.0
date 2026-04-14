import { t, formatDate } from "../i18n";
import { api } from "../api";
import { renderPlatformShell } from "../shell";
import { getLogicalPath } from "../router";

export async function pagePlatformTenantUsers(): Promise<void> {
  const tenantSlug = getTenantSlug();
  if (!tenantSlug) {
    renderPlatformShell(t("platform.tenantUsers.title"), "/platform/tenants",
      `<div class="error-state">${t("platform.tenantUsers.noTenant")}</div>`);
    return;
  }

  renderPlatformShell(t("platform.tenantUsers.title"), "/platform/tenants",
    `<div class="loading-state">${t("common.loading")}</div>`);

  try {
    const res = await api.platform.tenantUsers.list(tenantSlug);
    const content = renderContent(tenantSlug, res.items);
    renderPlatformShell(t("platform.tenantUsers.title"), "/platform/tenants", content);
    installActions(tenantSlug);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : t("common.error");
    renderPlatformShell(t("platform.tenantUsers.title"), "/platform/tenants",
      `<div class="error-state">${msg}</div>`);
  }
}

function renderContent(tenantSlug: string, users: any[]): string {
  const header = `
<div class="page-header">
  <div>
    <a href="#" onclick="event.preventDefault();window.__pms.navigate('/platform/tenants/${tenantSlug}')">← ${t("platform.common.back")}</a>
  </div>
</div>
<div class="page-header">
  <div class="page-title">${t("platform.tenantUsers.title")} · ${tenantSlug}</div>
  <button class="btn" onclick="window.__pms.platformTenantUsers.showForm()">${t("platform.tenantUsers.new")}</button>
</div>`;

  if (users.length === 0) {
    return header + `<div class="empty-state">${t("platform.tenantUsers.empty")}</div>` + renderModal();
  }

  const rows = users.map((u) => `
    <tr>
      <td>${u.email}</td>
      <td>${u.name ?? "—"}</td>
      <td>${u.role ?? "user"}</td>
      <td>${statusBadge(u.status)}</td>
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
${renderModal()}`;
}

function renderModal(): string {
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

function installActions(tenantSlug: string): void {
  const modal = document.getElementById("tenant-user-modal") as HTMLDivElement | null;
  const form = document.getElementById("tenant-user-form") as HTMLFormElement | null;
  const store: { currentId: string | null } = { currentId: null };

  const setField = (id: string, value: string) => {
    const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
    if (el) el.value = value;
  };

  (window as any).__pms.platformTenantUsers = {
    showForm: () => {
      store.currentId = null;
      if (modal) modal.style.display = "flex";
      setField("tenant-user-email", "");
      setField("tenant-user-name", "");
      setField("tenant-user-role", "user");
      setField("tenant-user-status", "ACTIVE");
    },
    edit: async (id: string) => {
      store.currentId = id;
      if (modal) modal.style.display = "flex";
      try {
        const user = await api.platform.tenantUsers.get(tenantSlug, id);
        setField("tenant-user-email", user.email || "");
        setField("tenant-user-name", user.name || "");
        setField("tenant-user-role", user.role || "user");
        setField("tenant-user-status", user.status || "ACTIVE");
      } catch (err: any) {
        alert(err.message || t("common.error"));
      }
    },
    close: () => {
      if (modal) modal.style.display = "none";
    },
  };

  if (form) {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const data = {
        email: (document.getElementById("tenant-user-email") as HTMLInputElement | null)?.value.trim(),
        name: (document.getElementById("tenant-user-name") as HTMLInputElement | null)?.value.trim(),
        role: (document.getElementById("tenant-user-role") as HTMLSelectElement | null)?.value,
        status: (document.getElementById("tenant-user-status") as HTMLSelectElement | null)?.value,
      };

      try {
        if (store.currentId) {
          await api.platform.tenantUsers.update(tenantSlug, store.currentId, data);
        } else {
          await api.platform.tenantUsers.create(tenantSlug, data);
        }
        if (modal) modal.style.display = "none";
        (window as any).__pms.navigate(`/platform/tenants/${tenantSlug}/users`);
      } catch (err: any) {
        alert(err.message || t("common.error"));
      }
    };
  }
}

function statusBadge(status: string): string {
  const map: Record<string, string> = {
    ACTIVE: "badge-green",
    SUSPENDED: "badge-orange",
  };
  const cls = map[status] ?? "badge-neutral";
  return `<span class="badge ${cls}">${status}</span>`;
}

function getTenantSlug(): string {
  const path = getLogicalPath();
  const match = path.match(/^\/platform\/tenants\/([^/]+)\/users/);
  return match ? match[1] : "";
}
