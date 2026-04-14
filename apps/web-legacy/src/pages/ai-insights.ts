import { t, formatDate } from "../i18n";
import { api } from "../api";
import { getSession } from "../session";

let filters = { vesselCode: "", status: "", insightType: "", crossVessel: false };
let vesselsList: any[] = [];
let canViewCrossVessel = false;

function canUserViewCrossVessel(): boolean {
  const session = getSession();
  if (!session || !session.user) return false;
  const role = session.user.role || "";
  return role === "TENANT_ADMIN";
}

export async function renderAIInsightsPage(): Promise<string> {
  try {
    canViewCrossVessel = canUserViewCrossVessel();
    
    const [vesselsRes, insightsRes] = await Promise.all([
      api.vessels.list(),
      api.aiInsights.list(filters),
    ]);

    vesselsList = vesselsRes.items;
    const insights = insightsRes.items;

    return renderContent(insights);
  } catch (error) {
    return renderErrorState();
  }
}

async function renderContent(insights: any[]): Promise<string> {
  const filtersHtml = renderFilters();
  
  if (insights.length === 0) {
    return filtersHtml + renderEmptyState();
  }

  let html = filtersHtml + '<div class="insights-list">';

  insights.forEach((insight: any) => {
    const severityClass = getSeverityClass(insight.severity);
    const isCrossVessel = insight.crossVessel === true;
    
    html += '<div class="insight-card">' +
      '<div class="insight-header">' +
      '<div class="insight-title">' + insight.title + '</div>' +
      '<span class="priority-badge ' + severityClass + '">' + insight.severity + '</span>' +
      '</div>' +
      '<div class="insight-desc">' + insight.description + '</div>' +
      '<div class="insight-meta">' +
      (isCrossVessel ? '<span class="meta-badge meta-cross-vessel">Cross-Vessel</span>' : '<span class="meta-badge">' + insight.vesselCode + '</span>') +
      '<span>' + insight.category + '</span>' +
      '<span>' + formatDate(insight.createdAt) + '</span>' +
      '</div>' +
      '</div>';
  });

  html += '</div>';
  return html;
}

function getSeverityClass(severity: string): string {
  switch (severity?.toUpperCase()) {
    case "CRITICAL": return "priority-critical";
    case "HIGH": return "priority-high";
    case "MEDIUM": return "priority-medium";
    case "LOW": return "priority-low";
    default: return "priority-medium";
  }
}

function renderFilters(): string {
  const vesselOptions = '<option value="">All Vessels</option>' + 
    vesselsList.map((v: any) => '<option value="' + v.code + '"' + (v.code === filters.vesselCode ? ' selected' : '') + '>' + v.code + '</option>').join("");

  const statusOptions = '<option value="">All Status</option>' +
    '<option value="NEW"' + (filters.status === "NEW" ? ' selected' : '') + '>NEW</option>' +
    '<option value="REVIEWED"' + (filters.status === "REVIEWED" ? ' selected' : '') + '>REVIEWED</option>' +
    '<option value="DISMISSED"' + (filters.status === "DISMISSED" ? ' selected' : '') + '>DISMISSED</option>' +
    '<option value="ACTIONED"' + (filters.status === "ACTIONED" ? ' selected' : '') + '>ACTIONED</option>';

  const typeOptions = '<option value="">All Types</option>' +
    '<option value="ANOMALY_DETECTION"' + (filters.insightType === "ANOMALY_DETECTION" ? ' selected' : '') + '>ANOMALY_DETECTION</option>' +
    '<option value="RISK_ALERT"' + (filters.insightType === "RISK_ALERT" ? ' selected' : '') + '>RISK_ALERT</option>' +
    '<option value="MAINTENANCE_FORECAST"' + (filters.insightType === "MAINTENANCE_FORECAST" ? ' selected' : '') + '>MAINTENANCE_FORECAST</option>' +
    '<option value="COMPLIANCE_WARNING"' + (filters.insightType === "COMPLIANCE_WARNING" ? ' selected' : '') + '>COMPLIANCE_WARNING</option>' +
    '<option value="PATTERN_INSIGHT"' + (filters.insightType === "PATTERN_INSIGHT" ? ' selected' : '') + '>PATTERN_INSIGHT</option>';

  const crossVesselOptions = !canViewCrossVessel ? '' :
    '<div class="filter-group"><label class="filter-label">Cross-Vessel</label>' +
    '<label class="checkbox-label">' +
    '<input type="checkbox" id="crossVesselFilter" onchange="updateFilters()" ' + (filters.crossVessel ? 'checked' : '') + ' />' +
    ' Show all vessels' +
    '</label></div>';

  return '<div class="filters">' +
    '<div class="filter-group"><label class="filter-label">' + t("common.vessel") + '</label><select class="filter-select" id="vesselFilter" onchange="updateFilters()">' + vesselOptions + '</select></div>' +
    '<div class="filter-group"><label class="filter-label">' + t("common.status") + '</label><select class="filter-select" id="statusFilter" onchange="updateFilters()">' + statusOptions + '</select></div>' +
    '<div class="filter-group"><label class="filter-label">Type</label><select class="filter-select" id="typeFilter" onchange="updateFilters()">' + typeOptions + '</select></div>' +
    crossVesselOptions +
    '</div>' +
    '<script>function updateFilters(){var v=document.getElementById("vesselFilter").value;var s=document.getElementById("statusFilter").value;var t=document.getElementById("typeFilter").value;var c=document.getElementById("crossVesselFilter")?document.getElementById("crossVesselFilter").checked:false;var q=[];if(v)q.push("vesselCode="+v);if(s)q.push("status="+s);if(t)q.push("insightType="+t);if(c)q.push("crossVessel=true");window.history.pushState({},"","/ai-insights"+(q.length?"?"+q.join("&"):""));loadPage("/ai-insights",q.length?"?"+q.join("&"):"")}</script>';
}

function renderLoadingState(): string {
  return '<div class="loading">' + t("common.loading") + '</div>';
}

function renderEmptyState(): string {
  return '<div class="empty-state"><div class="empty-state-icon">🤖</div><div>' + t("common.noData") + '</div></div>';
}

function renderErrorState(): string {
  return '<div class="error-state">' + t("common.error") + '</div>';
}

export { renderLoadingState, renderEmptyState, renderErrorState };