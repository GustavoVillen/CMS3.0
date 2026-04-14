import { t } from "../i18n";
import { api } from "../api";
import { renderTenantShell } from "../shell";

let filters = { vesselCode: "", category: "", status: "" };
let vesselsList: any[] = [];

export async function pageSpares(): Promise<void> {
  renderTenantShell(t("nav.spares"), "/app/spares", renderLoadingState());
  syncFiltersFromQuery();
  try {
    const [vesselsRes, sparesRes] = await Promise.all([
      api.vessels.list(),
      api.spares.list(filters),
    ]);

    vesselsList = vesselsRes.items;
    const spares = sparesRes.items;
    const content = await renderContent(spares);
    renderTenantShell(t("nav.spares"), "/app/spares", content);
    installFilterHandler();
  } catch (error) {
    renderTenantShell(t("nav.spares"), "/app/spares", renderErrorState());
  }
}

async function renderContent(spares: any[]): Promise<string> {
  const filtersHtml = renderFilters();
  
  if (spares.length === 0) {
    return filtersHtml + renderEmptyState();
  }

  let html = filtersHtml + '<div class="table-wrap"><table><thead><tr>' +
    '<th>' + t("spares.number") + '</th>' +
    '<th>' + t("common.name") + '</th>' +
    '<th>' + t("common.vessel") + '</th>' +
    '<th>' + t("spares.category") + '</th>' +
    '<th>' + t("spares.location") + '</th>' +
    '<th>' + t("spares.stock") + '</th>' +
    '<th>' + t("spares.minStock") + '</th>' +
    '<th>' + t("spares.unit") + '</th>' +
    '<th>' + t("common.status") + '</th>' +
    '</tr></thead><tbody>';

  spares.forEach((spare: any) => {
    html += '<tr>' +
      '<td>' + spare.spareNumber + '</td>' +
      '<td>' + spare.name + '</td>' +
      '<td>' + (spare.vesselCode || "-") + '</td>' +
      '<td>' + (spare.category || "-") + '</td>' +
      '<td>' + (spare.location || "-") + '</td>' +
      '<td>' + (spare.currentStock ?? "-") + '</td>' +
      '<td>' + (spare.minStock ?? "-") + '</td>' +
      '<td>' + (spare.unit || "-") + '</td>' +
      '<td>' + statusBadge(spare.status || "IN_STOCK") + '</td>' +
      '</tr>';
  });

  html += '</tbody></table></div>';
  return html;
}

function renderFilters(): string {
  const vesselOptions = '<option value="">' + t("common.allVessels") + '</option>' + 
    vesselsList.map((v: any) => '<option value="' + v.code + '"' + (v.code === filters.vesselCode ? ' selected' : '') + '>' + v.code + '</option>').join("");

  const categoryOptions = '<option value="">' + t("common.allCategories") + '</option>' +
    '<option value="MECHANICAL"' + (filters.category === "MECHANICAL" ? ' selected' : '') + '>MECHANICAL</option>' +
    '<option value="ELECTRICAL"' + (filters.category === "ELECTRICAL" ? ' selected' : '') + '>ELECTRICAL</option>' +
    '<option value="ELECTRONIC"' + (filters.category === "ELECTRONIC" ? ' selected' : '') + '>ELECTRONIC</option>' +
    '<option value="HYDRAULIC"' + (filters.category === "HYDRAULIC" ? ' selected' : '') + '>HYDRAULIC</option>' +
    '<option value="SAFETY"' + (filters.category === "SAFETY" ? ' selected' : '') + '>SAFETY</option>' +
    '<option value="CONSUMABLE"' + (filters.category === "CONSUMABLE" ? ' selected' : '') + '>CONSUMABLE</option>' +
    '<option value="OTHER"' + (filters.category === "OTHER" ? ' selected' : '') + '>OTHER</option>';

  const statusOptions = '<option value="">' + t("common.allStatus") + '</option>' +
    '<option value="IN_STOCK"' + (filters.status === "IN_STOCK" ? ' selected' : '') + '>IN_STOCK</option>' +
    '<option value="LOW_STOCK"' + (filters.status === "LOW_STOCK" ? ' selected' : '') + '>LOW_STOCK</option>' +
    '<option value="OUT_OF_STOCK"' + (filters.status === "OUT_OF_STOCK" ? ' selected' : '') + '>OUT_OF_STOCK</option>' +
    '<option value="ON_ORDER"' + (filters.status === "ON_ORDER" ? ' selected' : '') + '>ON_ORDER</option>';

  return '<div class="filters">' +
    '<div class="filter-group"><label class="filter-label">' + t("common.vessel") + '</label><select class="filter-select" id="vesselFilter" onchange="window.__pms.updateFilters()">' + vesselOptions + '</select></div>' +
    '<div class="filter-group"><label class="filter-label">' + t("spares.category") + '</label><select class="filter-select" id="categoryFilter" onchange="window.__pms.updateFilters()">' + categoryOptions + '</select></div>' +
    '<div class="filter-group"><label class="filter-label">' + t("common.status") + '</label><select class="filter-select" id="statusFilter" onchange="window.__pms.updateFilters()">' + statusOptions + '</select></div>' +
    '</div>';
}

function syncFiltersFromQuery(): void {
  const params = new URLSearchParams(window.location.search);
  filters = {
    vesselCode: params.get("vesselCode") || "",
    category: params.get("category") || "",
    status: params.get("status") || "",
  };
}

function installFilterHandler(): void {
  (window as any).__pms.updateFilters = () => {
    const vessel = (document.getElementById("vesselFilter") as HTMLSelectElement | null)?.value || "";
    const category = (document.getElementById("categoryFilter") as HTMLSelectElement | null)?.value || "";
    const status = (document.getElementById("statusFilter") as HTMLSelectElement | null)?.value || "";
    const params = new URLSearchParams();
    if (vessel) params.set("vesselCode", vessel);
    if (category) params.set("category", category);
    if (status) params.set("status", status);
    const query = params.toString();
    (window as any).__pms.navigate("/app/spares" + (query ? "?" + query : ""));
  };
}

function renderLoadingState(): string {
  return '<div class="loading-state">' + t("common.loading") + '</div>';
}

function renderEmptyState(): string {
  return '<div class="empty-state"><div class="empty-state-icon">🔩</div><div>' + t("common.noData") + '</div></div>';
}

function renderErrorState(): string {
  return '<div class="error-state">' + t("common.error") + '</div>';
}

function statusBadge(status: string): string {
  const map: Record<string, string> = {
    IN_STOCK: "badge-green",
    LOW_STOCK: "badge-yellow",
    OUT_OF_STOCK: "badge-red",
    ON_ORDER: "badge-neutral",
  };
  const cls = map[status] ?? "badge-neutral";
  return '<span class="badge ' + cls + '">' + status + '</span>';
}
