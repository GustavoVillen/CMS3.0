import { t, formatDate } from "../i18n";
import { api } from "../api";

let filters = { vesselCode: "", status: "", sourceType: "" };
let vesselsList: any[] = [];

export async function renderDeferralsPage(): Promise<string> {
  try {
    const [vesselsRes, deferralsRes] = await Promise.all([
      api.vessels.list(),
      api.deferrals.list(filters),
    ]);

    vesselsList = vesselsRes.items;
    const deferrals = deferralsRes.items;

    return renderContent(deferrals);
  } catch (error) {
    return renderErrorState();
  }
}

async function renderContent(deferrals: any[]): Promise<string> {
  const filtersHtml = renderFilters();
  
  if (deferrals.length === 0) {
    return filtersHtml + renderEmptyState();
  }

  let html = filtersHtml + '<div class="table-container"><table><thead><tr>' +
    '<th>Deferral #</th>' +
    '<th>' + t("common.title") + '</th>' +
    '<th>' + t("common.vessel") + '</th>' +
    '<th>Source</th>' +
    '<th>Target Date</th>' +
    '<th>' + t("common.status") + '</th>' +
    '</tr></thead><tbody>';

  deferrals.forEach((deferral: any) => {
    const statusClass = "status-" + deferral.status.toLowerCase().replace(/_/g, "-");
    html += '<tr>' +
      '<td>' + deferral.deferralNumber + '</td>' +
      '<td>' + deferral.title + '</td>' +
      '<td>' + deferral.vesselCode + '</td>' +
      '<td>' + deferral.sourceType + '</td>' +
      '<td>' + formatDate(deferral.targetDate) + '</td>' +
      '<td><span class="status-badge ' + statusClass + '">' + deferral.status + '</span></td>' +
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
    '<option value="PENDING_REVIEW"' + (filters.status === "PENDING_REVIEW" ? ' selected' : '') + '>PENDING_REVIEW</option>' +
    '<option value="CLOSED"' + (filters.status === "CLOSED" ? ' selected' : '') + '>CLOSED</option>';

  const sourceOptions = '<option value="">All Sources</option>' +
    '<option value="DEFECT"' + (filters.sourceType === "DEFECT" ? ' selected' : '') + '>DEFECT</option>' +
    '<option value="INSPECTION"' + (filters.sourceType === "INSPECTION" ? ' selected' : '') + '>INSPECTION</option>' +
    '<option value="CERTIFICATE"' + (filters.sourceType === "CERTIFICATE" ? ' selected' : '') + '>CERTIFICATE</option>' +
    '<option value="OTHER"' + (filters.sourceType === "OTHER" ? ' selected' : '') + '>OTHER</option>';

  return '<div class="filters">' +
    '<div class="filter-group"><label class="filter-label">' + t("common.vessel") + '</label><select class="filter-select" id="vesselFilter" onchange="updateFilters()">' + vesselOptions + '</select></div>' +
    '<div class="filter-group"><label class="filter-label">' + t("common.status") + '</label><select class="filter-select" id="statusFilter" onchange="updateFilters()">' + statusOptions + '</select></div>' +
    '<div class="filter-group"><label class="filter-label">Source</label><select class="filter-select" id="sourceFilter" onchange="updateFilters()">' + sourceOptions + '</select></div>' +
    '</div>' +
    '<script>function updateFilters(){var v=document.getElementById("vesselFilter").value;var s=document.getElementById("statusFilter").value;var src=document.getElementById("sourceFilter").value;var q=[];if(v)q.push("vesselCode="+v);if(s)q.push("status="+s);if(src)q.push("sourceType="+src);window.history.pushState({},"","/deferrals"+(q.length?"?"+q.join("&"):""));loadPage("/deferrals",q.length?"?"+q.join("&"):"")}</script>';
}

function renderLoadingState(): string {
  return '<div class="loading">' + t("common.loading") + '</div>';
}

function renderEmptyState(): string {
  return '<div class="empty-state"><div class="empty-state-icon">⏳</div><div>' + t("common.noData") + '</div></div>';
}

function renderErrorState(): string {
  return '<div class="error-state">' + t("common.error") + '</div>';
}

export { renderLoadingState, renderEmptyState, renderErrorState };