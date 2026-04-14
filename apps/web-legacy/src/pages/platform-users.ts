import { t, formatDate } from "../i18n";
import { api } from "../api";
import { renderPlatformShell } from "../shell";

export async function pagePlatformUsers(): Promise<void> {
  renderPlatformShell(t("platform.users.title"), "/platform/users",
    `<div class="loading-state">${t("common.loading")}</div>`);

  try {
    const res = await api.platform.users.list();
    const content = renderContent(res.items);
    renderPlatformShell(t("platform.users.title"), "/platform/users", content);
    installActions();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : t("common.error");
    renderPlatformShell(t("platform.users.title"), "/platform/users",
      `<div class="error-state">${msg}</div>`);
  }
}

function renderContent(users: any[]): string {
  const header = `
<div class="page-header">
  <div class="page-title">${t("platform.users.title")}</div>
  <button class="btn" onclick="window.__pms.platformUsers.showForm()">${t("platform.users.new")}</button>
</div>`;

  if (users.length === 0) {
    return header + `<div class="empty-state">${t("platform.users.empty")}</div>` + renderModal();
  }

  const rows = users.map((u) => `
    <tr>
      <td>${u.id}</td>
      <td>${u.email}</td>
      <td>${u.name ?? "—"}</td>
      <td>${u.role ?? "user"}</td>
      <td>${statusBadge(u.status)}</td>
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
${renderModal()}`;
}

function renderModal(): string {
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

function installActions(): void {
  const modal = document.getElementById("platform-user-modal") as HTMLDivElement | null;
  const form = document.getElementById("platform-user-form") as HTMLFormElement | null;
  const store: { currentId: string | null } = { currentId: null };

  const setField = (id: string, value: string) => {
    const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
    if (el) el.value = value;
  };

  (window as any).__pms.platformUsers = {
    showForm: () => {
      store.currentId = null;
      if (modal) modal.style.display = "flex";
      setField("platform-user-email", "");
      setField("platform-user-name", "");
      setField("platform-user-role", "SUPERADMIN");
      setField("platform-user-status", "ACTIVE");
      setField("platform-user-password", "");
    },
    edit: async (id: string) => {
      store.currentId = id;
      if (modal) modal.style.display = "flex";
      try {
        const user = await api.platform.users.get(id);
        setField("platform-user-email", user.email || "");
        setField("platform-user-name", user.name || "");
        setField("platform-user-role", user.role || "SUPERADMIN");
        setField("platform-user-status", user.status || "ACTIVE");
        setField("platform-user-password", "");
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
      const data: any = {
        email: (document.getElementById("platform-user-email") as HTMLInputElement | null)?.value.trim(),
        name: (document.getElementById("platform-user-name") as HTMLInputElement | null)?.value.trim(),
        role: (document.getElementById("platform-user-role") as HTMLSelectElement | null)?.value,
        status: (document.getElementById("platform-user-status") as HTMLSelectElement | null)?.value,
      };
      const password = (document.getElementById("platform-user-password") as HTMLInputElement | null)?.value;
      if (password) data.password = password;

      try {
        if (store.currentId) {
          await api.platform.users.update(store.currentId, data);
        } else {
          await api.platform.users.create(data);
        }
        if (modal) modal.style.display = "none";
        (window as any).__pms.navigate("/platform/users");
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
