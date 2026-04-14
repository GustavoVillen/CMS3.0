import { t, formatDateTime } from "../i18n";
import { api } from "../api";
import { renderTenantShell } from "../shell";

let filters = { vesselCode: "", spareId: "", movementType: "" };
let vesselsList: any[] = [];

export async function pageStockMovements(): Promise<void> {
  renderTenantShell(t("nav.stockMovements"), "/app/stock-movements", renderLoadingState());
  syncFiltersFromQuery();
  try {
    const [vesselsRes, movementsRes] = await Promise.all([
      api.vessels.list(),
      api.stockMovements.list(filters),
    ]);

    vesselsList = vesselsRes.items;
    const movements = movementsRes.items;
    const content = await renderContent(movements);
    renderTenantShell(t("nav.stockMovements"), "/app/stock-movements", content);
    installFilterHandler();
  } catch (error) {
    renderTenantShell(t("nav.stockMovements"), "/app/stock-movements", renderErrorState());
  }
}

async function renderContent(movements: any[]): Promise<string> {
  const filtersHtml = renderFilters();
  
  if (movements.length === 0) {
    return filtersHtml + renderEmptyState();
  }

  let html = filtersHtml + '<div class="table-wrap"><table><thead><tr>' +
    '<th>' + t("stockMovements.number") + '</th>' +
    '<th>' + t("common.date") + '</th>' +
    '<th>' + t("common.type") + '</th>' +
    '<th>' + t("stockMovements.spare") + '</th>' +
    '<th>' + t("common.vessel") + '</th>' +
    '<th>' + t("stockMovements.quantity") + '</th>' +
    '<th>' + t("stockMovements.reference") + '</th>' +
    '<th>' + t("stockMovements.performedBy") + '</th>' +
    '</tr></thead><tbody>';

  movements.forEach((movement: any) => {
    const typeClass = getTypeClass(movement.movementType);
    html += '<tr>' +
      '<td>' + (movement.movementNumber || "-") + '</td>' +
      '<td>' + formatDateTime(movement.movementDate) + '</td>' +
      '<td><span class="badge ' + typeClass + '">' + movement.movementType + '</span></td>' +
      '<td>' + (movement.spareName || movement.spareId || "-") + '</td>' +
      '<td>' + (movement.vesselCode || "-") + '</td>' +
      '<td>' + (movement.quantity ?? "-") + '</td>' +
      '<td>' + (movement.reference || "-") + '</td>' +
      '<td>' + (movement.performedBy || "-") + '</td>' +
      '</tr>';
  });

  html += '</tbody></table></div>';
  return html;
}

function getTypeClass(type: string): string {
  switch (type) {
    case "RECEIPT": return "badge-green";
    case "ISSUE": return "badge-yellow";
    case "ADJUSTMENT": return "badge-orange";
    case "TRANSFER": return "badge-neutral";
    default: return "";
  }
}

function renderFilters(): string {
  const vesselOptions = '<option value="">' + t("common.allVessels") + '</option>' + 
    vesselsList.map((v: any) => '<option value="' + v.code + '"' + (v.code === filters.vesselCode ? ' selected' : '') + '>' + v.code + '</option>').join("");

  const typeOptions = '<option value="">' + t("common.allTypes") + '</option>' +
    '<option value="RECEIPT"' + (filters.movementType === "RECEIPT" ? ' selected' : '') + '>RECEIPT</option>' +
    '<option value="ISSUE"' + (filters.movementType === "ISSUE" ? ' selected' : '') + '>ISSUE</option>' +
    '<option value="ADJUSTMENT"' + (filters.movementType === "ADJUSTMENT" ? ' selected' : '') + '>ADJUSTMENT</option>' +
    '<option value="TRANSFER"' + (filters.movementType === "TRANSFER" ? ' selected' : '') + '>TRANSFER</option>';

  return '<div class="filters">' +
    '<div class="filter-group"><label class="filter-label">' + t("common.vessel") + '</label><select class="filter-select" id="vesselFilter" onchange="window.__pms.updateFilters()">' + vesselOptions + '</select></div>' +
    '<div class="filter-group"><label class="filter-label">' + t("common.type") + '</label><select class="filter-select" id="typeFilter" onchange="window.__pms.updateFilters()">' + typeOptions + '</select></div>' +
    '<div class="filter-group"><label class="filter-label">' + t("stockMovements.spareSearch") + '</label><input type="text" class="filter-select" id="spareFilter" value="' + (filters.spareId || "") + '" placeholder="' + t("stockMovements.spareSearchPlaceholder") + '" onkeyup="if(event.key===\'Enter\')window.__pms.updateFilters()" onchange="window.__pms.updateFilters()" /></div>' +
    '</div>';
}

function syncFiltersFromQuery(): void {
  const params = new URLSearchParams(window.location.search);
  filters = {
    vesselCode: params.get("vesselCode") || "",
    spareId: params.get("spareId") || "",
    movementType: params.get("movementType") || "",
  };
}

function installFilterHandler(): void {
  (window as any).__pms.updateFilters = () => {
    const vessel = (document.getElementById("vesselFilter") as HTMLSelectElement | null)?.value || "";
    const type = (document.getElementById("typeFilter") as HTMLSelectElement | null)?.value || "";
    const spare = (document.getElementById("spareFilter") as HTMLInputElement | null)?.value || "";
    const params = new URLSearchParams();
    if (vessel) params.set("vesselCode", vessel);
    if (type) params.set("movementType", type);
    if (spare) params.set("spareId", spare);
    const query = params.toString();
    (window as any).__pms.navigate("/app/stock-movements" + (query ? "?" + query : ""));
  };
}

function renderLoadingState(): string {
  return '<div class="loading-state">' + t("common.loading") + '</div>';
}

function renderEmptyState(): string {
  return '<div class="empty-state"><div class="empty-state-icon">📦</div><div>' + t("common.noData") + '</div></div>';
}

function renderErrorState(): string {
  return '<div class="error-state">' + t("common.error") + '</div>';
}
