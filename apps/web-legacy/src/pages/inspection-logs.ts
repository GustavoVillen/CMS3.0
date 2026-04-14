import { t, formatDate } from "../i18n";
import { api } from "../api";

let filters = { vesselCode: "", type: "" };
let vesselsList: any[] = [];

function renderTargetReference(log: any): string {
  if (log.inspectionNumber) {
    return '<span class="ref-badge ref-inspection">' + log.inspectionNumber + '</span>';
  }
  if (log.targetType && log.targetId) {
    return '<span class="ref-badge ref-generic">' + log.targetType + ': ' + log.targetId + '</span>';
  }
  return "-";
}

export async function renderInspectionLogsPage(): Promise<string> {
  try {
    const [vesselsRes, logsRes] = await Promise.all([
      api.vessels.list(),
      api.inspectionLogs.list(filters),
    ]);

    vesselsList = vesselsRes.items;
    const logs = logsRes.items;

    return renderContent(logs);
  } catch (error) {
    return renderErrorState();
  }
}

async function renderContent(logs: any[]): Promise<string> {
  const filtersHtml = renderFilters();
  
  if (logs.length === 0) {
    return filtersHtml + renderEmptyState();
  }

  let html = filtersHtml + '<div class="table-container"><table><thead><tr>' +
    '<th>Log #</th>' +
    '<th>Date</th>' +
    '<th>Type</th>' +
    '<th>Finding</th>' +
    '<th>Target/Reference</th>' +
    '<th>Action</th>' +
    '<th>' + t("common.status") + '</th>' +
    '</tr></thead><tbody>';

  logs.forEach((log: any) => {
    const statusClass = "status-" + (log.status || "PENDING").toLowerCase().replace(/_/g, "-");
    html += '<tr>' +
      '<td>' + (log.logNumber || "-") + '</td>' +
      '<td>' + formatDate(log.logDate) + '</td>' +
      '<td>' + (log.type || "-") + '</td>' +
      '<td>' + (log.finding || "-") + '</td>' +
      '<td>' + renderTargetReference(log) + '</td>' +
      '<td>' + (log.actionTaken || "-") + '</td>' +
      '<td><span class="status-badge ' + statusClass + '">' + (log.status || "PENDING") + '</span></td>' +
      '</tr>';
  });

  html += '</tbody></table></div>';
  return html;
}

function renderFilters(): string {
  const vesselOptions = '<option value="">All Vessels</option>' + 
    vesselsList.map((v: any) => '<option value="' + v.code + '"' + (v.code === filters.vesselCode ? ' selected' : '') + '>' + v.code + '</option>').join("");

  const typeOptions = '<option value="">All Types</option>' +
    '<option value="OBSERVATION"' + (filters.type === "OBSERVATION" ? ' selected' : '') + '>OBSERVATION</option>' +
    '<option value="NON_CONFORMITY"' + (filters.type === "NON_CONFORMITY" ? ' selected' : '') + '>NON_CONFORMITY</option>' +
    '<option value="DEFICIENCY"' + (filters.type === "DEFICIENCY" ? ' selected' : '') + '>DEFICIENCY</option>' +
    '<option value="FINDING"' + (filters.type === "FINDING" ? ' selected' : '') + '>FINDING</option>';

  return '<div class="filters">' +
    '<div class="filter-group"><label class="filter-label">' + t("common.vessel") + '</label><select class="filter-select" id="vesselFilter" onchange="updateFilters()">' + vesselOptions + '</select></div>' +
    '<div class="filter-group"><label class="filter-label">Type</label><select class="filter-select" id="typeFilter" onchange="updateFilters()">' + typeOptions + '</select></div>' +
    '</div>' +
    '<script>function updateFilters(){var v=document.getElementById("vesselFilter").value;var t=document.getElementById("typeFilter").value;var q=[];if(v)q.push("vesselCode="+v);if(t)q.push("type="+t);window.history.pushState({},"","/inspection-logs"+(q.length?"?"+q.join("&"):""));loadPage("/inspection-logs",q.length?"?"+q.join("&"):"")}</script>';
}

function renderLoadingState(): string {
  return '<div class="loading">' + t("common.loading") + '</div>';
}

function renderEmptyState(): string {
  return '<div class="empty-state"><div class="empty-state-icon">📝</div><div>' + t("common.noData") + '</div></div>';
}

function renderErrorState(): string {
  return '<div class="error-state">' + t("common.error") + '</div>';
}

export { renderLoadingState, renderEmptyState, renderErrorState };