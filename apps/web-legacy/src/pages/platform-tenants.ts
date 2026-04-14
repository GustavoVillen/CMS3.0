import { t, formatDate } from "../i18n";
import { api } from "../api";
import { renderPlatformShell } from "../shell";

export async function pagePlatformTenants(): Promise<void> {
  renderPlatformShell(t("platform.tenants.title"), "/platform/tenants",
    `<div class="loading-state">${t("common.loading")}</div>`);

  try {
    const result = await api.platform.tenants.list();
    const tenants: any[] = result.items;
    const content = renderContent(tenants);
    renderPlatformShell(t("platform.tenants.title"), "/platform/tenants", content);
    installActions();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : t("common.error");
    renderPlatformShell(t("platform.tenants.title"), "/platform/tenants",
      `<div class="error-state">${msg}</div>`);
  }
}

function renderContent(tenants: any[]): string {
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
      <td>${ten.displayName ?? "—"}</td>
      <td>${statusBadge(ten.status)}</td>
      <td>${ten.defaultLocale ?? "—"}</td>
      <td>${ten.currency ?? "—"}</td>
      <td>${ten.planCode ?? "—"}</td>
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

function renderModal(): string {
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

function installActions(): void {
  const store: { currentSlug: string | null } = { currentSlug: null };
  const modal = document.getElementById("tenant-modal") as HTMLDivElement | null;
  const form = document.getElementById("tenant-form") as HTMLFormElement | null;

  const setField = (id: string, value: string) => {
    const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
    if (el) el.value = value;
  };

  const setDisabled = (id: string, disabled: boolean) => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (el) el.disabled = disabled;
  };

  (window as any).__pms.platformTenants = {
    showForm: () => {
      store.currentSlug = null;
      if (modal) modal.style.display = "flex";
      setDisabled("tenant-slug", false);
      setField("tenant-slug", "");
      setField("tenant-name", "");
      setField("tenant-status", "ACTIVE");
      setField("tenant-locale", "es");
      setField("tenant-timezone", "");
      setField("tenant-currency", "");
      setField("tenant-plan", "START");
    },
    edit: async (slug: string) => {
      store.currentSlug = slug;
      if (modal) modal.style.display = "flex";
      setDisabled("tenant-slug", true);
      try {
        const tenant = await api.platform.tenants.get(slug);
        setField("tenant-slug", tenant.slug || slug);
        setField("tenant-name", tenant.displayName || "");
        setField("tenant-status", tenant.status || "ACTIVE");
        setField("tenant-locale", tenant.defaultLocale || "es");
        setField("tenant-timezone", tenant.timezone || "");
        setField("tenant-currency", tenant.currency || "");
        setField("tenant-plan", tenant.planCode || "START");
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
      const slug = (document.getElementById("tenant-slug") as HTMLInputElement | null)?.value.trim() || "";
      const data = {
        slug,
        displayName: (document.getElementById("tenant-name") as HTMLInputElement | null)?.value.trim(),
        status: (document.getElementById("tenant-status") as HTMLSelectElement | null)?.value,
        defaultLocale: (document.getElementById("tenant-locale") as HTMLSelectElement | null)?.value,
        timezone: (document.getElementById("tenant-timezone") as HTMLInputElement | null)?.value.trim(),
        currency: (document.getElementById("tenant-currency") as HTMLInputElement | null)?.value.trim(),
        planCode: (document.getElementById("tenant-plan") as HTMLSelectElement | null)?.value,
      };

      try {
        if (store.currentSlug) {
          await api.platform.tenants.update(store.currentSlug, data);
        } else {
          await api.platform.tenants.create(data);
        }
        if (modal) modal.style.display = "none";
        (window as any).__pms.navigate("/platform/tenants");
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
    DISABLED: "badge-neutral",
  };
  const cls = map[status] ?? "badge-neutral";
  return `<span class="badge ${cls}">${status}</span>`;
}
