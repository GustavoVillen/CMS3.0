import { t, formatDate } from "../i18n";
import { api } from "../api";

let filters = { vesselCode: "", status: "", type: "" };
let vesselsList: any[] = [];

export async function renderWorkOrdersPage(): Promise<string> {
  try {
    const [vesselsRes, wosRes] = await Promise.all([
      api.vessels.list(),
      api.workOrders.list(filters),
    ]);

    vesselsList = vesselsRes.items;
    const workOrders = wosRes.items;

    return renderContent(workOrders);
  } catch (error) {
    return renderErrorState();
  }
}

async function renderContent(workOrders: any[]): Promise<string> {
  const filtersHtml = renderFilters();
  
  if (workOrders.length === 0) {
    return filtersHtml + renderEmptyState();
  }

  let html = filtersHtml + '<div class="table-container"><table><thead><tr>' +
    '<th>WO #</th>' +
    '<th>' + t("common.title") + '</th>' +
    '<th>' + t("common.vessel") + '</th>' +
    '<th>' + t("common.type") + '</th>' +
    '<th>' + t("common.priority") + '</th>' +
    '<th>' + t("common.status") + '</th>' +
    '<th>' + t("common.date") + '</th>' +
    '</tr></thead><tbody>';

  workOrders.forEach((wo: any) => {
    const statusClass = "status-" + wo.status.toLowerCase().replace(/_/g, "-");
    const priorityClass = "priority-" + wo.priority.toLowerCase();
    html += '<tr>' +
      '<td>' + wo.woNumber + '</td>' +
      '<td>' + wo.title + '</td>' +
      '<td>' + wo.vesselCode + '</td>' +
      '<td>' + wo.type + '</td>' +
      '<td><span class="priority-badge ' + priorityClass + '">' + wo.priority + '</span></td>' +
      '<td><span class="status-badge ' + statusClass + '">' + wo.status + '</span></td>' +
      '<td>' + formatDate(wo.scheduledDate) + '</td>' +
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
    '<option value="ASSIGNED"' + (filters.status === "ASSIGNED" ? ' selected' : '') + '>ASSIGNED</option>' +
    '<option value="IN_PROGRESS"' + (filters.status === "IN_PROGRESS" ? ' selected' : '') + '>IN_PROGRESS</option>' +
    '<option value="COMPLETED"' + (filters.status === "COMPLETED" ? ' selected' : '') + '>COMPLETED</option>' +
    '<option value="CANCELLED"' + (filters.status === "CANCELLED" ? ' selected' : '') + '>CANCELLED</option>';

  const typeOptions = '<option value="">All Types</option>' +
    '<option value="PREVENTIVE"' + (filters.type === "PREVENTIVE" ? ' selected' : '') + '>PREVENTIVE</option>' +
    '<option value="CORRECTIVE"' + (filters.type === "CORRECTIVE" ? ' selected' : '') + '>CORRECTIVE</option>' +
    '<option value="IMPROVEMENT"' + (filters.type === "IMPROVEMENT" ? ' selected' : '') + '>IMPROVEMENT</option>' +
    '<option value="INSPECTION"' + (filters.type === "INSPECTION" ? ' selected' : '') + '>INSPECTION</option>';

  return '<div class="filters">' +
    '<div class="filter-group"><label class="filter-label">' + t("common.vessel") + '</label><select class="filter-select" id="vesselFilter" onchange="updateFilters()">' + vesselOptions + '</select></div>' +
    '<div class="filter-group"><label class="filter-label">' + t("common.status") + '</label><select class="filter-select" id="statusFilter" onchange="updateFilters()">' + statusOptions + '</select></div>' +
    '<div class="filter-group"><label class="filter-label">' + t("common.type") + '</label><select class="filter-select" id="typeFilter" onchange="updateFilters()">' + typeOptions + '</select></div>' +
    '</div>' +
    '<script>function updateFilters(){var v=document.getElementById("vesselFilter").value;var s=document.getElementById("statusFilter").value;var t=document.getElementById("typeFilter").value;var q=[];if(v)q.push("vesselCode="+v);if(s)q.push("status="+s);if(t)q.push("type="+t);window.history.pushState({},"","/work-orders"+(q.length?"?"+q.join("&"):""));loadPage("/work-orders",q.length?"?"+q.join("&"):"")}</script>';
}

function renderLoadingState(): string {
  return '<div class="loading">' + t("common.loading") + '</div>';
}

function renderEmptyState(): string {
  return '<div class="empty-state"><div class="empty-state-icon">🔧</div><div>' + t("common.noData") + '</div></div>';
}

function renderErrorState(): string {
  return '<div class="error-state">' + t("common.error") + '</div>';
}

export { renderLoadingState, renderEmptyState, renderErrorState };