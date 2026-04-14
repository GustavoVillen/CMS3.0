import { t, formatDate } from "../i18n";
import { api } from "../api";
import { renderPlatformShell } from "../shell";
import { getLogicalPath } from "../router";

export async function pagePlatformInvitations(): Promise<void> {
  const tenantSlug = getTenantSlug();
  if (!tenantSlug) {
    renderPlatformShell(t("platform.invitations.title"), "/platform/tenants",
      `<div class="error-state">${t("platform.invitations.noTenant")}</div>`);
    return;
  }

  renderPlatformShell(t("platform.invitations.title"), "/platform/tenants",
    `<div class="loading-state">${t("common.loading")}</div>`);

  try {
    const res = await api.platform.tenantInvitations.list(tenantSlug);
    const content = renderContent(tenantSlug, res.items);
    renderPlatformShell(t("platform.invitations.title"), "/platform/tenants", content);
    installActions(tenantSlug);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : t("common.error");
    renderPlatformShell(t("platform.invitations.title"), "/platform/tenants",
      `<div class="error-state">${msg}</div>`);
  }
}

function renderContent(tenantSlug: string, invitations: any[]): string {
  const header = `
<div class="page-header">
  <div>
    <a href="#" onclick="event.preventDefault();window.__pms.navigate('/platform/tenants/${tenantSlug}')">← ${t("platform.common.back")}</a>
  </div>
</div>
<div class="page-header">
  <div class="page-title">${t("platform.invitations.title")} · ${tenantSlug}</div>
  <button class="btn" onclick="window.__pms.platformInvitations.showForm()">${t("platform.invitations.send")}</button>
</div>`;

  if (invitations.length === 0) {
    return header + `<div class="empty-state">${t("platform.invitations.empty")}</div>` + renderModal();
  }

  const rows = invitations.map((inv) => `
    <tr>
      <td>${inv.email}</td>
      <td>${inv.role ?? "user"}</td>
      <td>${statusBadge(inv.status)}</td>
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
${renderModal()}`;
}

function renderModal(): string {
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

function installActions(tenantSlug: string): void {
  const modal = document.getElementById("invitation-modal") as HTMLDivElement | null;
  const form = document.getElementById("invitation-form") as HTMLFormElement | null;

  (window as any).__pms.platformInvitations = {
    showForm: () => {
      if (modal) modal.style.display = "flex";
      const email = document.getElementById("invitation-email") as HTMLInputElement | null;
      if (email) email.value = "";
    },
    close: () => {
      if (modal) modal.style.display = "none";
    },
    delete: async (id: string) => {
      if (!confirm(t("platform.invitations.confirmDelete"))) return;
      try {
        await api.platform.tenantInvitations.delete(tenantSlug, id);
        (window as any).__pms.navigate(`/platform/tenants/${tenantSlug}/invitations`);
      } catch (err: any) {
        alert(err.message || t("common.error"));
      }
    },
  };

  if (form) {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const email = (document.getElementById("invitation-email") as HTMLInputElement | null)?.value.trim() || "";
      const role = (document.getElementById("invitation-role") as HTMLSelectElement | null)?.value || "user";
      try {
        await api.platform.tenantInvitations.create(tenantSlug, { email, role });
        if (modal) modal.style.display = "none";
        (window as any).__pms.navigate(`/platform/tenants/${tenantSlug}/invitations`);
      } catch (err: any) {
        alert(err.message || t("common.error"));
      }
    };
  }
}

function statusBadge(status: string): string {
  const map: Record<string, string> = {
    PENDING: "badge-yellow",
    ACCEPTED: "badge-green",
    EXPIRED: "badge-neutral",
  };
  const cls = map[status] ?? "badge-neutral";
  return `<span class="badge ${cls}">${status}</span>`;
}

function getTenantSlug(): string {
  const path = getLogicalPath();
  const match = path.match(/^\/platform\/tenants\/([^/]+)\/invitations/);
  return match ? match[1] : "";
}
