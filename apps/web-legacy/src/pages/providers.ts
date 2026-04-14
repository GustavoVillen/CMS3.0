import { t } from "../i18n";
import { api } from "../api";
import { renderTenantShell } from "../shell";

let filters = { status: "", category: "" };

export async function pageProviders(): Promise<void> {
  renderTenantShell(t("nav.providers"), "/app/providers", renderLoadingState());
  syncFiltersFromQuery();
  try {
    const providersRes = await api.providers.list(filters);
    const providers = providersRes.items;
    const content = await renderContent(providers);
    renderTenantShell(t("nav.providers"), "/app/providers", content);
    installFilterHandler();
  } catch (error) {
    renderTenantShell(t("nav.providers"), "/app/providers", renderErrorState());
  }
}

async function renderContent(providers: any[]): Promise<string> {
  const filtersHtml = renderFilters();
  
  if (providers.length === 0) {
    return filtersHtml + renderEmptyState();
  }

  let html = filtersHtml + '<div class="table-wrap"><table><thead><tr>' +
    '<th>' + t("providers.number") + '</th>' +
    '<th>' + t("common.name") + '</th>' +
    '<th>' + t("common.code") + '</th>' +
    '<th>' + t("providers.category") + '</th>' +
    '<th>' + t("providers.contact") + '</th>' +
    '<th>' + t("common.email") + '</th>' +
    '<th>' + t("providers.phone") + '</th>' +
    '<th>' + t("common.status") + '</th>' +
    '</tr></thead><tbody>';

  providers.forEach((provider: any) => {
    html += '<tr>' +
      '<td>' + provider.providerNumber + '</td>' +
      '<td>' + provider.name + '</td>' +
      '<td>' + (provider.code || "-") + '</td>' +
      '<td>' + (provider.category || "-") + '</td>' +
      '<td>' + (provider.contactName || "-") + '</td>' +
      '<td>' + (provider.email || "-") + '</td>' +
      '<td>' + (provider.phone || "-") + '</td>' +
      '<td>' + statusBadge(provider.status || "ACTIVE") + '</td>' +
      '</tr>';
  });

  html += '</tbody></table></div>';
  return html;
}

function renderFilters(): string {
  const statusOptions = '<option value="">' + t("common.allStatus") + '</option>' +
    '<option value="ACTIVE"' + (filters.status === "ACTIVE" ? ' selected' : '') + '>ACTIVE</option>' +
    '<option value="INACTIVE"' + (filters.status === "INACTIVE" ? ' selected' : '') + '>INACTIVE</option>' +
    '<option value="PENDING"' + (filters.status === "PENDING" ? ' selected' : '') + '>PENDING</option>' +
    '<option value="SUSPENDED"' + (filters.status === "SUSPENDED" ? ' selected' : '') + '>SUSPENDED</option>';

  const categoryOptions = '<option value="">' + t("common.allCategories") + '</option>' +
    '<option value="MECHANICAL"' + (filters.category === "MECHANICAL" ? ' selected' : '') + '>MECHANICAL</option>' +
    '<option value="ELECTRICAL"' + (filters.category === "ELECTRICAL" ? ' selected' : '') + '>ELECTRICAL</option>' +
    '<option value="ELECTRONIC"' + (filters.category === "ELECTRONIC" ? ' selected' : '') + '>ELECTRONIC</option>' +
    '<option value="HYDRAULIC"' + (filters.category === "HYDRAULIC" ? ' selected' : '') + '>HYDRAULIC</option>' +
    '<option value="SAFETY"' + (filters.category === "SAFETY" ? ' selected' : '') + '>SAFETY</option>' +
    '<option value="CONSUMABLE"' + (filters.category === "CONSUMABLE" ? ' selected' : '') + '>CONSUMABLE</option>' +
    '<option value="OTHER"' + (filters.category === "OTHER" ? ' selected' : '') + '>OTHER</option>';

  return '<div class="filters">' +
    '<div class="filter-group"><label class="filter-label">' + t("common.status") + '</label><select class="filter-select" id="statusFilter" onchange="window.__pms.updateFilters()">' + statusOptions + '</select></div>' +
    '<div class="filter-group"><label class="filter-label">' + t("providers.category") + '</label><select class="filter-select" id="categoryFilter" onchange="window.__pms.updateFilters()">' + categoryOptions + '</select></div>' +
    '</div>';
}

function syncFiltersFromQuery(): void {
  const params = new URLSearchParams(window.location.search);
  filters = {
    status: params.get("status") || "",
    category: params.get("category") || "",
  };
}

function installFilterHandler(): void {
  (window as any).__pms.updateFilters = () => {
    const status = (document.getElementById("statusFilter") as HTMLSelectElement | null)?.value || "";
    const category = (document.getElementById("categoryFilter") as HTMLSelectElement | null)?.value || "";
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (category) params.set("category", category);
    const query = params.toString();
    (window as any).__pms.navigate("/app/providers" + (query ? "?" + query : ""));
  };
}

function renderLoadingState(): string {
  return '<div class="loading-state">' + t("common.loading") + '</div>';
}

function renderEmptyState(): string {
  return '<div class="empty-state"><div class="empty-state-icon">🏭</div><div>' + t("common.noData") + '</div></div>';
}

function renderErrorState(): string {
  return '<div class="error-state">' + t("common.error") + '</div>';
}

function statusBadge(status: string): string {
  const map: Record<string, string> = {
    ACTIVE: "badge-green",
    INACTIVE: "badge-neutral",
    PENDING: "badge-yellow",
    SUSPENDED: "badge-orange",
  };
  const cls = map[status] ?? "badge-neutral";
  return '<span class="badge ' + cls + '">' + status + '</span>';
}
