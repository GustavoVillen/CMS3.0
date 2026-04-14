import { t, formatDate } from "../i18n";
import { api } from "../api";

let filters = { vesselCode: "", status: "" };
let vesselsList: any[] = [];

export async function renderCAPAPage(): Promise<string> {
  try {
    const [vesselsRes, capaRes] = await Promise.all([
      api.vessels.list(),
      api.capa.list(filters),
    ]);

    vesselsList = vesselsRes.items;
    const capaRecords = capaRes.items;

    return renderContent(capaRecords);
  } catch (error) {
    return renderErrorState();
  }
}

async function renderContent(capaRecords: any[]): Promise<string> {
  const filtersHtml = renderFilters();
  
  if (capaRecords.length === 0) {
    return filtersHtml + renderEmptyState();
  }

  let html = filtersHtml + '<div class="table-container"><table><thead><tr>' +
    '<th>CAPA #</th>' +
    '<th>' + t("common.title") + '</th>' +
    '<th>' + t("common.vessel") + '</th>' +
    '<th>Source</th>' +
    '<th>Type</th>' +
    '<th>Due Date</th>' +
    '<th>' + t("common.status") + '</th>' +
    '</tr></thead><tbody>';

  capaRecords.forEach((capa: any) => {
    const statusClass = "status-" + capa.status.toLowerCase().replace(/_/g, "-");
    html += '<tr>' +
      '<td>' + capa.capaNumber + '</td>' +
      '<td>' + capa.title + '</td>' +
      '<td>' + capa.vesselCode + '</td>' +
      '<td>' + (capa.source || "-") + '</td>' +
      '<td>' + (capa.capaType || "-") + '</td>' +
      '<td>' + formatDate(capa.dueDate) + '</td>' +
      '<td><span class="status-badge ' + statusClass + '">' + capa.status + '</span></td>' +
      '</tr>';
  });

  html += '</tbody></table></div>';
  return html;
}

function renderFilters(): string {
  const vesselOptions = '<option value="">All Vessels</option>' + 
    vesselsList.map((v: any) => '<option value="' + v.code + '"' + (v.code === filters.vesselCode ? ' selected' : '') + '>' + v.code + '</option>').join("");

  const statusOptions = '<option value="">All Status</option>' +
    '<option value="OPEN"' + (filters.status === "OPEN" ? ' selected' : '') + '>OPEN</option>' +
    '<option value="IN_PROGRESS"' + (filters.status === "IN_PROGRESS" ? ' selected' : '') + '>IN_PROGRESS</option>' +
    '<option value="VERIFIED"' + (filters.status === "VERIFIED" ? ' selected' : '') + '>VERIFIED</option>' +
    '<option value="CLOSED"' + (filters.status === "CLOSED" ? ' selected' : '') + '>CLOSED</option>';

  return '<div class="filters">' +
    '<div class="filter-group"><label class="filter-label">' + t("common.vessel") + '</label><select class="filter-select" id="vesselFilter" onchange="updateFilters()">' + vesselOptions + '</select></div>' +
    '<div class="filter-group"><label class="filter-label">' + t("common.status") + '</label><select class="filter-select" id="statusFilter" onchange="updateFilters()">' + statusOptions + '</select></div>' +
    '</div>' +
    '<script>function updateFilters(){var v=document.getElementById("vesselFilter").value;var s=document.getElementById("statusFilter").value;var q=[];if(v)q.push("vesselCode="+v);if(s)q.push("status="+s);window.history.pushState({},"","/capa"+(q.length?"?"+q.join("&"):""));loadPage("/capa",q.length?"?"+q.join("&"):"")}</script>';
}

function renderLoadingState(): string {
  return '<div class="loading">' + t("common.loading") + '</div>';
}

function renderEmptyState(): string {
  return '<div class="empty-state"><div class="empty-state-icon">✅</div><div>' + t("common.noData") + '</div></div>';
}

function renderErrorState(): string {
  return '<div class="error-state">' + t("common.error") + '</div>';
}

export { renderLoadingState, renderEmptyState, renderErrorState };