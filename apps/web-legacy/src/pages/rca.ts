import { t, formatDate } from "../i18n";
import { api } from "../api";

let filters = { vesselCode: "", status: "" };
let vesselsList: any[] = [];

export async function renderRCAPage(): Promise<string> {
  try {
    const [vesselsRes, rcaRes] = await Promise.all([
      api.vessels.list(),
      api.rca.list(filters),
    ]);

    vesselsList = vesselsRes.items;
    const rcaRecords = rcaRes.items;

    return renderContent(rcaRecords);
  } catch (error) {
    return renderErrorState();
  }
}

async function renderContent(rcaRecords: any[]): Promise<string> {
  const filtersHtml = renderFilters();
  
  if (rcaRecords.length === 0) {
    return filtersHtml + renderEmptyState();
  }

  let html = filtersHtml + '<div class="table-container"><table><thead><tr>' +
    '<th>RCA #</th>' +
    '<th>' + t("common.title") + '</th>' +
    '<th>' + t("common.vessel") + '</th>' +
    '<th>Related Defect</th>' +
    '<th>Root Cause</th>' +
    '<th>' + t("common.status") + '</th>' +
    '<th>Created</th>' +
    '</tr></thead><tbody>';

  rcaRecords.forEach((rca: any) => {
    const statusClass = "status-" + rca.status.toLowerCase().replace(/_/g, "-");
    html += '<tr>' +
      '<td>' + rca.rcaNumber + '</td>' +
      '<td>' + rca.title + '</td>' +
      '<td>' + rca.vesselCode + '</td>' +
      '<td>' + (rca.relatedDefectNumber || "-") + '</td>' +
      '<td>' + (rca.rootCause || "-") + '</td>' +
      '<td><span class="status-badge ' + statusClass + '">' + rca.status + '</span></td>' +
      '<td>' + formatDate(rca.createdAt) + '</td>' +
      '</tr>';
  });

  html += '</tbody></table></div>';
  return html;
}

function renderFilters(): string {
  const vesselOptions = '<option value="">All Vessels</option>' + 
    vesselsList.map((v: any) => '<option value="' + v.code + '"' + (v.code === filters.vesselCode ? ' selected' : '') + '>' + v.code + '</option>').join("");

  const statusOptions = '<option value="">All Status</option>' +
    '<option value="DRAFT"' + (filters.status === "DRAFT" ? ' selected' : '') + '>DRAFT</option>' +
    '<option value="IN_PROGRESS"' + (filters.status === "IN_PROGRESS" ? ' selected' : '') + '>IN_PROGRESS</option>' +
    '<option value="COMPLETED"' + (filters.status === "COMPLETED" ? ' selected' : '') + '>COMPLETED</option>' +
    '<option value="CLOSED"' + (filters.status === "CLOSED" ? ' selected' : '') + '>CLOSED</option>';

  return '<div class="filters">' +
    '<div class="filter-group"><label class="filter-label">' + t("common.vessel") + '</label><select class="filter-select" id="vesselFilter" onchange="updateFilters()">' + vesselOptions + '</select></div>' +
    '<div class="filter-group"><label class="filter-label">' + t("common.status") + '</label><select class="filter-select" id="statusFilter" onchange="updateFilters()">' + statusOptions + '</select></div>' +
    '</div>' +
    '<script>function updateFilters(){var v=document.getElementById("vesselFilter").value;var s=document.getElementById("statusFilter").value;var q=[];if(v)q.push("vesselCode="+v);if(s)q.push("status="+s);window.history.pushState({},"","/rca"+(q.length?"?"+q.join("&"):""));loadPage("/rca",q.length?"?"+q.join("&"):"")}</script>';
}

function renderLoadingState(): string {
  return '<div class="loading">' + t("common.loading") + '</div>';
}

function renderEmptyState(): string {
  return '<div class="empty-state"><div class="empty-state-icon">🔍</div><div>' + t("common.noData") + '</div></div>';
}

function renderErrorState(): string {
  return '<div class="error-state">' + t("common.error") + '</div>';
}

export { renderLoadingState, renderEmptyState, renderErrorState };