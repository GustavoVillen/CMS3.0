import { t, formatDate } from "../i18n";
import { api } from "../api";

let filters = { vesselCode: "", status: "", type: "" };
let vesselsList: any[] = [];

export async function renderInspectionsPage(): Promise<string> {
  try {
    const [vesselsRes, inspectionsRes] = await Promise.all([
      api.vessels.list(),
      api.inspections.list(filters),
    ]);

    vesselsList = vesselsRes.items;
    const inspections = inspectionsRes.items;

    return renderContent(inspections);
  } catch (error) {
    return renderErrorState();
  }
}

async function renderContent(inspections: any[]): Promise<string> {
  const filtersHtml = renderFilters();
  
  if (inspections.length === 0) {
    return filtersHtml + renderEmptyState();
  }

  let html = filtersHtml + '<div class="table-container"><table><thead><tr>' +
    '<th>Inspection #</th>' +
    '<th>' + t("common.title") + '</th>' +
    '<th>' + t("common.vessel") + '</th>' +
    '<th>Type</th>' +
    '<th>Category</th>' +
    '<th>Inspector</th>' +
    '<th>Due Date</th>' +
    '<th>' + t("common.status") + '</th>' +
    '</tr></thead><tbody>';

  inspections.forEach((inspection: any) => {
    const statusClass = "status-" + inspection.status.toLowerCase().replace(/_/g, "-");
    html += '<tr>' +
      '<td>' + inspection.inspectionNumber + '</td>' +
      '<td>' + inspection.title + '</td>' +
      '<td>' + inspection.vesselCode + '</td>' +
      '<td>' + (inspection.type || "-") + '</td>' +
      '<td>' + (inspection.category || "-") + '</td>' +
      '<td>' + (inspection.inspectorName || "-") + '</td>' +
      '<td>' + formatDate(inspection.dueDate) + '</td>' +
      '<td><span class="status-badge ' + statusClass + '">' + inspection.status + '</span></td>' +
      '</tr>';
  });

  html += '</tbody></table></div>';
  return html;
}

function renderFilters(): string {
  const vesselOptions = '<option value="">All Vessels</option>' + 
    vesselsList.map((v: any) => '<option value="' + v.code + '"' + (v.code === filters.vesselCode ? ' selected' : '') + '>' + v.code + '</option>').join("");

  const statusOptions = '<option value="">All Status</option>' +
    '<option value="PENDING"' + (filters.status === "PENDING" ? ' selected' : '') + '>PENDING</option>' +
    '<option value="SCHEDULED"' + (filters.status === "SCHEDULED" ? ' selected' : '') + '>SCHEDULED</option>' +
    '<option value="IN_PROGRESS"' + (filters.status === "IN_PROGRESS" ? ' selected' : '') + '>IN_PROGRESS</option>' +
    '<option value="COMPLETED"' + (filters.status === "COMPLETED" ? ' selected' : '') + '>COMPLETED</option>' +
    '<option value="OVERDUE"' + (filters.status === "OVERDUE" ? ' selected' : '') + '>OVERDUE</option>' +
    '<option value="CANCELLED"' + (filters.status === "CANCELLED" ? ' selected' : '') + '>CANCELLED</option>';

  const typeOptions = '<option value="">All Types</option>' +
    '<option value="STATUTORY"' + (filters.type === "STATUTORY" ? ' selected' : '') + '>STATUTORY</option>' +
    '<option value="CLASS"' + (filters.type === "CLASS" ? ' selected' : '') + '>CLASS</option>' +
    '<option value="PORT_STATE"' + (filters.type === "PORT_STATE" ? ' selected' : '') + '>PORT_STATE</option>' +
    '<option value="INTERNAL"' + (filters.type === "INTERNAL" ? ' selected' : '') + '>INTERNAL</option>' +
    '<option value="SAFETY"' + (filters.type === "SAFETY" ? ' selected' : '') + '>SAFETY</option>';

  return '<div class="filters">' +
    '<div class="filter-group"><label class="filter-label">' + t("common.vessel") + '</label><select class="filter-select" id="vesselFilter" onchange="updateFilters()">' + vesselOptions + '</select></div>' +
    '<div class="filter-group"><label class="filter-label">' + t("common.status") + '</label><select class="filter-select" id="statusFilter" onchange="updateFilters()">' + statusOptions + '</select></div>' +
    '<div class="filter-group"><label class="filter-label">Type</label><select class="filter-select" id="typeFilter" onchange="updateFilters()">' + typeOptions + '</select></div>' +
    '</div>' +
    '<script>function updateFilters(){var v=document.getElementById("vesselFilter").value;var s=document.getElementById("statusFilter").value;var t=document.getElementById("typeFilter").value;var q=[];if(v)q.push("vesselCode="+v);if(s)q.push("status="+s);if(t)q.push("type="+t);window.history.pushState({},"","/inspections"+(q.length?"?"+q.join("&"):""));loadPage("/inspections",q.length?"?"+q.join("&"):"")}</script>';
}

function renderLoadingState(): string {
  return '<div class="loading">' + t("common.loading") + '</div>';
}

function renderEmptyState(): string {
  return '<div class="empty-state"><div class="empty-state-icon">📋</div><div>' + t("common.noData") + '</div></div>';
}

function renderErrorState(): string {
  return '<div class="error-state">' + t("common.error") + '</div>';
}

export { renderLoadingState, renderEmptyState, renderErrorState };