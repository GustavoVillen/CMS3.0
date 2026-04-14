import { t, formatDate } from "../i18n";
import { api } from "../api";

let filters = { vesselCode: "", status: "", triggerType: "" };
let vesselsList: any[] = [];

export async function renderMaintenancePlansPage(): Promise<string> {
  try {
    const [vesselsRes, plansRes] = await Promise.all([
      api.vessels.list(),
      api.maintenancePlans.list(filters),
    ]);

    vesselsList = vesselsRes.items;
    const plans = plansRes.items;

    return renderContent(plans);
  } catch (error) {
    return renderErrorState();
  }
}

async function renderContent(plans: any[]): Promise<string> {
  const filtersHtml = renderFilters();
  
  if (plans.length === 0) {
    return filtersHtml + renderEmptyState();
  }

  let html = filtersHtml + '<div class="table-container"><table><thead><tr>' +
    '<th>Task</th>' +
    '<th>Title</th>' +
    '<th>' + t("common.vessel") + '</th>' +
    '<th>Trigger</th>' +
    '<th>Next Due</th>' +
    '<th>' + t("common.status") + '</th>' +
    '</tr></thead><tbody>';

  plans.forEach((plan: any) => {
    const statusClass = "status-" + plan.status.toLowerCase().replace(/_/g, "-");
    html += '<tr>' +
      '<td>' + plan.taskCode + '</td>' +
      '<td>' + plan.title + '</td>' +
      '<td>' + plan.vesselCode + '</td>' +
      '<td>' + plan.triggerType + '</td>' +
      '<td>' + formatDate(plan.nextDueDate) + '</td>' +
      '<td><span class="status-badge ' + statusClass + '">' + plan.status + '</span></td>' +
      '</tr>';
  });

  html += '</tbody></table></div>';
  return html;
}

function renderFilters(): string {
  const vesselOptions = '<option value="">All Vessels</option>' + 
    vesselsList.map((v: any) => '<option value="' + v.code + '"' + (v.code === filters.vesselCode ? ' selected' : '') + '>' + v.code + '</option>').join("");

  const statusOptions = '<option value="">All Status</option>' +
    '<option value="ACTIVE"' + (filters.status === "ACTIVE" ? ' selected' : '') + '>ACTIVE</option>' +
    '<option value="DUE_SOON"' + (filters.status === "DUE_SOON" ? ' selected' : '') + '>DUE_SOON</option>' +
    '<option value="OVERDUE"' + (filters.status === "OVERDUE" ? ' selected' : '') + '>OVERDUE</option>';

  const triggerOptions = '<option value="">All Triggers</option>' +
    '<option value="HOURS"' + (filters.triggerType === "HOURS" ? ' selected' : '') + '>HOURS</option>' +
    '<option value="MONTHS"' + (filters.triggerType === "MONTHS" ? ' selected' : '') + '>MONTHS</option>' +
    '<option value="CONDITION"' + (filters.triggerType === "CONDITION" ? ' selected' : '') + '>CONDITION</option>';

  return '<div class="filters">' +
    '<div class="filter-group"><label class="filter-label">' + t("common.vessel") + '</label><select class="filter-select" id="vesselFilter" onchange="updateFilters()"><option value="">All Vessels</option>' + vesselOptions + '</select></div>' +
    '<div class="filter-group"><label class="filter-label">' + t("common.status") + '</label><select class="filter-select" id="statusFilter" onchange="updateFilters()">' + statusOptions + '</select></div>' +
    '<div class="filter-group"><label class="filter-label">Trigger</label><select class="filter-select" id="triggerFilter" onchange="updateFilters()">' + triggerOptions + '</select></div>' +
    '</div>' +
    '<script>function updateFilters(){var v=document.getElementById("vesselFilter").value;var s=document.getElementById("statusFilter").value;var t=document.getElementById("triggerFilter").value;var q=[];if(v)q.push("vesselCode="+v);if(s)q.push("status="+s);if(t)q.push("triggerType="+t);window.history.pushState({},"","/maintenance-plans"+(q.length?"?"+q.join("&"):""));loadPage("/maintenance-plans",q.length?"?"+q.join("&"):"")}</script>';
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