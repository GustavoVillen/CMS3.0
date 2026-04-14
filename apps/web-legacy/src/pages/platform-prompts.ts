import { t, formatDate } from "../i18n";
import { api } from "../api";
import { renderPlatformShell } from "../shell";

let filters = { capability: "" };

export async function pagePlatformPrompts(): Promise<void> {
  renderPlatformShell(t("platform.prompts.title"), "/platform/prompts",
    `<div class="loading-state">${t("common.loading")}</div>`);
  syncFiltersFromQuery();

  try {
    const res = await api.platform.prompts.list(filters);
    const content = renderContent(res.items);
    renderPlatformShell(t("platform.prompts.title"), "/platform/prompts", content);
    installActions();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : t("common.error");
    renderPlatformShell(t("platform.prompts.title"), "/platform/prompts",
      `<div class="error-state">${msg}</div>`);
  }
}

function renderContent(prompts: any[]): string {
  const header = `
<div class="page-header">
  <div class="page-title">${t("platform.prompts.title")}</div>
  <button class="btn" onclick="window.__pms.platformPrompts.showForm()">${t("platform.prompts.new")}</button>
</div>`;

  const filtersHtml = renderFilters();

  if (prompts.length === 0) {
    return filtersHtml + header + `<div class="empty-state">${t("platform.prompts.empty")}</div>` + renderModal();
  }

  const rows = prompts.map((p) => `
    <tr>
      <td>${p.capability}</td>
      <td>${p.title}</td>
      <td>v${p.version ?? 1}</td>
      <td>${p.isPublished ? statusBadge("PUBLISHED") : statusBadge("DRAFT")}</td>
      <td>${p.publishedAt ? formatDate(p.publishedAt) : "—"}</td>
      <td>${formatDate(p.updatedAt)}</td>
      <td>
        <button class="btn btn-sm" onclick="window.__pms.platformPrompts.edit('${p.id}')">${t("common.edit")}</button>
        ${p.isPublished
          ? `<button class="btn btn-sm" onclick="window.__pms.platformPrompts.rollback('${p.id}')">${t("platform.prompts.rollback")}</button>`
          : `<button class="btn btn-sm" onclick="window.__pms.platformPrompts.publish('${p.id}')">${t("platform.prompts.publish")}</button>`}
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
${renderModal()}`;
}

function renderFilters(): string {
  const capabilityOptions = '<option value="">' + t("common.allCapabilities") + '</option>' +
    '<option value="defect_analysis"' + (filters.capability === "defect_analysis" ? ' selected' : '') + '>defect_analysis</option>' +
    '<option value="maintenance_forecast"' + (filters.capability === "maintenance_forecast" ? ' selected' : '') + '>maintenance_forecast</option>' +
    '<option value="safety_inspection"' + (filters.capability === "safety_inspection" ? ' selected' : '') + '>safety_inspection</option>' +
    '<option value="barrier_assessment"' + (filters.capability === "barrier_assessment" ? ' selected' : '') + '>barrier_assessment</option>';

  return '<div class="filters">' +
    '<div class="filter-group"><label class="filter-label">' + t("platform.prompts.capability") + '</label><select class="filter-select" id="capabilityFilter" onchange="window.__pms.updateFilters()">' + capabilityOptions + '</select></div>' +
    '</div>';
}

function renderModal(): string {
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

function installActions(): void {
  const modal = document.getElementById("prompt-modal") as HTMLDivElement | null;
  const form = document.getElementById("prompt-form") as HTMLFormElement | null;
  const store: { currentId: string | null } = { currentId: null };

  (window as any).__pms.platformPrompts = {
    showForm: () => {
      store.currentId = null;
      if (modal) modal.style.display = "flex";
      setField("prompt-capability", "defect_analysis");
      setField("prompt-title", "");
      setField("prompt-content", "");
    },
    edit: async (id: string) => {
      store.currentId = id;
      if (modal) modal.style.display = "flex";
      try {
        const p = await api.platform.prompts.get(id);
        setField("prompt-capability", p.capability || "defect_analysis");
        setField("prompt-title", p.title || "");
        setField("prompt-content", p.content || "");
      } catch (err: any) {
        alert(err.message || t("common.error"));
      }
    },
    close: () => {
      if (modal) modal.style.display = "none";
    },
    publish: async (id: string) => {
      try {
        await api.platform.prompts.publish(id);
        (window as any).__pms.navigate("/platform/prompts" + window.location.search);
      } catch (err: any) {
        alert(err.message || t("common.error"));
      }
    },
    rollback: async (id: string) => {
      if (!confirm(t("platform.prompts.confirmRollback"))) return;
      try {
        await api.platform.prompts.rollback(id);
        (window as any).__pms.navigate("/platform/prompts" + window.location.search);
      } catch (err: any) {
        alert(err.message || t("common.error"));
      }
    },
  };

  (window as any).__pms.updateFilters = () => {
    const capability = (document.getElementById("capabilityFilter") as HTMLSelectElement | null)?.value || "";
    const params = new URLSearchParams();
    if (capability) params.set("capability", capability);
    const query = params.toString();
    (window as any).__pms.navigate("/platform/prompts" + (query ? "?" + query : ""));
  };

  if (form) {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const data = {
        capability: (document.getElementById("prompt-capability") as HTMLSelectElement | null)?.value,
        locale: "es",
        title: (document.getElementById("prompt-title") as HTMLInputElement | null)?.value.trim(),
        content: (document.getElementById("prompt-content") as HTMLTextAreaElement | null)?.value.trim(),
      };

      try {
        if (store.currentId) {
          await api.platform.prompts.update(store.currentId, data);
        } else {
          await api.platform.prompts.create(data);
        }
        if (modal) modal.style.display = "none";
        (window as any).__pms.navigate("/platform/prompts" + window.location.search);
      } catch (err: any) {
        alert(err.message || t("common.error"));
      }
    };
  }
}

function setField(id: string, value: string): void {
  const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
  if (el) el.value = value;
}

function statusBadge(status: string): string {
  return status === "PUBLISHED"
    ? `<span class="badge badge-green">${t("platform.prompts.publishedStatus")}</span>`
    : `<span class="badge badge-neutral">${t("platform.prompts.draftStatus")}</span>`;
}

function syncFiltersFromQuery(): void {
  const params = new URLSearchParams(window.location.search);
  filters = {
    capability: params.get("capability") || "",
  };
}
