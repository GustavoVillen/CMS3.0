import { t, formatDate } from "../i18n";
import { api } from "../api";
import type { AssetRecord } from "../types";

let currentVesselCode = "";
let vesselsList: any[] = [];

export async function renderAssetsPage(): Promise<string> {
  try {
    const [vesselsRes, assetsRes] = await Promise.all([
      api.vessels.list(),
      api.assets.list(currentVesselCode || undefined),
    ]);

    vesselsList = vesselsRes.items;
    const assets = assetsRes.items;

    return renderContent(assets);
  } catch (error) {
    return renderErrorState();
  }
}

async function renderContent(assets: any[]): Promise<string> {
  const filtersHtml = renderFilters();
  
  if (assets.length === 0) {
    return filtersHtml + renderEmptyState();
  }

  let html = filtersHtml + '<div class="table-container"><table><thead><tr>' +
    '<th>' + t("common.code") + '</th>' +
    '<th>' + t("common.name") + '</th>' +
    '<th>' + t("common.vessel") + '</th>' +
    '<th>Criticality</th>' +
    '<th>' + t("common.status") + '</th>' +
    '</tr></thead><tbody>';

  assets.forEach((asset: any) => {
    const statusClass = "status-" + asset.status.toLowerCase().replace(/_/g, "-");
    html += '<tr>' +
      '<td>' + asset.assetCode + '</td>' +
      '<td>' + asset.name + '</td>' +
      '<td>' + asset.vesselCode + '</td>' +
      '<td><span class="priority-badge priority-' + asset.criticality.toLowerCase() + '">' + asset.criticality + '</span></td>' +
      '<td><span class="status-badge ' + statusClass + '">' + asset.status + '</span></td>' +
      '</tr>';
  });

  html += '</tbody></table></div>';
  return html;
}

function renderFilters(): string {
  const vesselOptions = '<option value="">All Vessels</option>' + 
    vesselsList.map((v: any) => '<option value="' + v.code + '"' + (v.code === currentVesselCode ? ' selected' : '') + '>' + v.code + ' - ' + v.name + '</option>').join("");

  return '<div class="filters">' +
    '<div class="filter-group">' +
    '<label class="filter-label">' + t("common.vessel") + '</label>' +
    '<select class="filter-select" id="vesselFilter" onchange="filterAssets(this.value)">' +
    vesselOptions +
    '</select>' +
    '</div>' +
    '</div>' +
    '<script>function filterAssets(vesselCode){currentVesselCode=vesselCode;loadPage("/assets",vesselCode?"?vesselCode="+vesselCode:"")}</script>';
}

function renderLoadingState(): string {
  return '<div class="loading">' + t("common.loading") + '</div>';
}

function renderEmptyState(): string {
  return '<div class="empty-state"><div class="empty-state-icon">🏗️</div><div>' + t("common.noData") + '</div></div>';
}

function renderErrorState(): string {
  return '<div class="error-state">' + t("common.error") + '</div>';
}

export { renderLoadingState, renderEmptyState, renderErrorState };