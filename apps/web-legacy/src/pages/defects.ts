import { t, formatDate } from "../i18n";
import { api } from "../api";

let filters = { vesselCode: "", status: "", severity: "" };
let vesselsList: any[] = [];

export async function renderDefectsPage(): Promise<string> {
  try {
    const [vesselsRes, defectsRes] = await Promise.all([
      api.vessels.list(),
      api.defects.list(filters),
    ]);

    vesselsList = vesselsRes.items;
    const defects = defectsRes.items;

    return renderContent(defects);
  } catch (error) {
    return renderErrorState();
  }
}

async function renderContent(defects: any[]): Promise<string> {
  const filtersHtml = renderFilters();
  
  if (defects.length === 0) {
    return filtersHtml + renderEmptyState();
  }

  let html = filtersHtml + '<div class="table-container"><table><thead><tr>' +
    '<th>Defect #</th>' +
    '<th>' + t("common.title") + '</th>' +
    '<th>' + t("common.vessel") + '</th>' +
    '<th>Severity</th>' +
    '<th>' + t("common.status") + '</th>' +
    '<th>Reported</th>' +
    '</tr></thead><tbody>';

  defects.forEach((defect: any) => {
    const statusClass = "status-" + defect.status.toLowerCase().replace(/_/g, "-");
    const severityClass = "priority-" + defect.severity.toLowerCase();
    html += '<tr>' +
      '<td>' + defect.defectNumber + '</td>' +
      '<td>' + defect.title + '</td>' +
      '<td>' + defect.vesselCode + '</td>' +
      '<td><span class="priority-badge ' + severityClass + '">' + defect.severity + '</span></td>' +
      '<td><span class="status-badge ' + statusClass + '">' + defect.status + '</span></td>' +
      '<td>' + formatDate(defect.reportedDate) + '</td>' +
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
    '<option value="PENDING_PARTS"' + (filters.status === "PENDING_PARTS" ? ' selected' : '') + '>PENDING_PARTS</option>' +
    '<option value="CLOSED"' + (filters.status === "CLOSED" ? ' selected' : '') + '>CLOSED</option>';

  const severityOptions = '<option value="">All Severity</option>' +
    '<option value="LOW"' + (filters.severity === "LOW" ? ' selected' : '') + '>LOW</option>' +
    '<option value="MEDIUM"' + (filters.severity === "MEDIUM" ? ' selected' : '') + '>MEDIUM</option>' +
    '<option value="HIGH"' + (filters.severity === "HIGH" ? ' selected' : '') + '>HIGH</option>' +
    '<option value="CRITICAL"' + (filters.severity === "CRITICAL" ? ' selected' : '') + '>CRITICAL</option>';

  return '<div class="filters">' +
    '<div class="filter-group"><label class="filter-label">' + t("common.vessel") + '</label><select class="filter-select" id="vesselFilter" onchange="updateFilters()">' + vesselOptions + '</select></div>' +
    '<div class="filter-group"><label class="filter-label">' + t("common.status") + '</label><select class="filter-select" id="statusFilter" onchange="updateFilters()">' + statusOptions + '</select></div>' +
    '<div class="filter-group"><label class="filter-label">Severity</label><select class="filter-select" id="severityFilter" onchange="updateFilters()">' + severityOptions + '</select></div>' +
    '</div>' +
    '<script>function updateFilters(){var v=document.getElementById("vesselFilter").value;var s=document.getElementById("statusFilter").value;var sev=document.getElementById("severityFilter").value;var q=[];if(v)q.push("vesselCode="+v);if(s)q.push("status="+s);if(sev)q.push("severity="+sev);window.history.pushState({},"","/defects"+(q.length?"?"+q.join("&"):""));loadPage("/defects",q.length?"?"+q.join("&"):"")}</script>';
}

function renderLoadingState(): string {
  return '<div class="loading">' + t("common.loading") + '</div>';
}

function renderEmptyState(): string {
  return '<div class="empty-state"><div class="empty-state-icon">⚠️</div><div>' + t("common.noData") + '</div></div>';
}

function renderErrorState(): string {
  return '<div class="error-state">' + t("common.error") + '</div>';
}

export { renderLoadingState, renderEmptyState, renderErrorState };