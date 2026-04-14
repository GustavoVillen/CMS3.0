import { t, formatDateTime } from "../i18n";
import { api } from "../api";
import { renderPlatformShell } from "../shell";

let filters = { tenantSlug: "", actorId: "", action: "" };

export async function pagePlatformAuditEvents(): Promise<void> {
  renderPlatformShell(t("platform.audit.title"), "/platform/audit-events",
    `<div class="loading-state">${t("common.loading")}</div>`);
  syncFiltersFromQuery();

  try {
    const res = await api.platform.auditEvents.list(filters);
    const content = renderContent(res.items);
    renderPlatformShell(t("platform.audit.title"), "/platform/audit-events", content);
    installFilterHandler();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : t("common.error");
    renderPlatformShell(t("platform.audit.title"), "/platform/audit-events",
      `<div class="error-state">${msg}</div>`);
  }
}

function renderContent(events: any[]): string {
  const filtersHtml = renderFilters();
  if (events.length === 0) {
    return filtersHtml + `<div class="empty-state">${t("platform.audit.empty")}</div>`;
  }

  const rows = events.map((ev) => `
    <tr>
      <td>${formatDateTime(ev.timestamp)}</td>
      <td>${ev.tenantSlug ?? "—"}</td>
      <td>${ev.userEmail ?? ev.actorId ?? "—"}</td>
      <td>${ev.action ?? "—"}</td>
      <td>${ev.entityType ? ev.entityType + ":" + ev.entityId : "—"}</td>
      <td>${renderDetails(ev.details)}</td>
    </tr>`).join("");

  return filtersHtml + `
<div class="card">
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>${t("common.date")}</th>
          <th>${t("platform.audit.tenant")}</th>
          <th>${t("platform.audit.user")}</th>
          <th>${t("platform.audit.action")}</th>
          <th>${t("platform.audit.entity")}</th>
          <th>${t("platform.audit.details")}</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
</div>`;
}

function renderDetails(details: any): string {
  if (!details) return "—";
  if (typeof details === "string") return truncate(details, 60);
  if (typeof details === "object") {
    const parts: string[] = [];
    for (const [k, v] of Object.entries(details)) {
      if (v) parts.push(k + ": " + truncate(String(v), 20));
    }
    return parts.slice(0, 2).join(", ");
  }
  return "—";
}

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? text.slice(0, maxLen) + "..." : text;
}

function renderFilters(): string {
  const actionOptions = '<option value="">' + t("common.allActions") + '</option>' +
    '<option value="LOGIN"' + (filters.action === "LOGIN" ? ' selected' : '') + '>LOGIN</option>' +
    '<option value="LOGOUT"' + (filters.action === "LOGOUT" ? ' selected' : '') + '>LOGOUT</option>' +
    '<option value="CREATE"' + (filters.action === "CREATE" ? ' selected' : '') + '>CREATE</option>' +
    '<option value="UPDATE"' + (filters.action === "UPDATE" ? ' selected' : '') + '>UPDATE</option>' +
    '<option value="DELETE"' + (filters.action === "DELETE" ? ' selected' : '') + '>DELETE</option>';

  return '<div class="filters">' +
    '<div class="filter-group"><label class="filter-label">' + t("platform.audit.tenant") + '</label><input type="text" class="filter-select" id="tenantFilter" value="' + (filters.tenantSlug || "") + '" placeholder="' + t("platform.audit.tenantPlaceholder") + '" onkeyup="if(event.key===\'Enter\')window.__pms.updateFilters()" onchange="window.__pms.updateFilters()" /></div>' +
    '<div class="filter-group"><label class="filter-label">' + t("platform.audit.user") + '</label><input type="text" class="filter-select" id="userFilter" value="' + (filters.actorId || "") + '" placeholder="' + t("platform.audit.userPlaceholder") + '" onkeyup="if(event.key===\'Enter\')window.__pms.updateFilters()" onchange="window.__pms.updateFilters()" /></div>' +
    '<div class="filter-group"><label class="filter-label">' + t("platform.audit.action") + '</label><select class="filter-select" id="actionFilter" onchange="window.__pms.updateFilters()">' + actionOptions + '</select></div>' +
    '</div>';
}

function syncFiltersFromQuery(): void {
  const params = new URLSearchParams(window.location.search);
  filters = {
    tenantSlug: params.get("tenantSlug") || "",
    actorId: params.get("actorId") || "",
    action: params.get("action") || "",
  };
}

function installFilterHandler(): void {
  (window as any).__pms.updateFilters = () => {
    const tenant = (document.getElementById("tenantFilter") as HTMLInputElement | null)?.value || "";
    const actor = (document.getElementById("userFilter") as HTMLInputElement | null)?.value || "";
    const action = (document.getElementById("actionFilter") as HTMLSelectElement | null)?.value || "";
    const params = new URLSearchParams();
    if (tenant) params.set("tenantSlug", tenant);
    if (actor) params.set("actorId", actor);
    if (action) params.set("action", action);
    const query = params.toString();
    (window as any).__pms.navigate("/platform/audit-events" + (query ? "?" + query : ""));
  };
}
