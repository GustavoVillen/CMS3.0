import { t, formatDate } from "../i18n";
import { api } from "../api";

let currentVesselCode = "";
let vesselsList: any[] = [];

export async function renderDailyReportsPage(): Promise<string> {
  try {
    const [vesselsRes, reportsRes] = await Promise.all([
      api.vessels.list(),
      api.dailyReports.list(currentVesselCode || undefined),
    ]);

    vesselsList = vesselsRes.items;
    const reports = reportsRes.items;

    return renderContent(reports);
  } catch (error) {
    return renderErrorState();
  }
}

async function renderContent(reports: any[]): Promise<string> {
  const filtersHtml = renderFilters();
  
  if (reports.length === 0) {
    return filtersHtml + renderEmptyState();
  }

  let html = filtersHtml + '<div class="table-container"><table><thead><tr>' +
    '<th>Report #</th>' +
    '<th>' + t("common.date") + '</th>' +
    '<th>' + t("common.vessel") + '</th>' +
    '<th>Weather</th>' +
    '<th>Activities</th>' +
    '</tr></thead><tbody>';

  reports.forEach((report: any) => {
    const activities = Array.isArray(report.activities) ? report.activities.join(", ") : "-";
    html += '<tr>' +
      '<td>' + report.reportNumber + '</td>' +
      '<td>' + formatDate(report.reportDate) + '</td>' +
      '<td>' + report.vesselCode + '</td>' +
      '<td>' + (report.weather || "-") + '</td>' +
      '<td>' + activities.substring(0, 100) + (activities.length > 100 ? "..." : "") + '</td>' +
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
    '<select class="filter-select" id="vesselFilter" onchange="filterReports(this.value)">' +
    vesselOptions +
    '</select>' +
    '</div>' +
    '</div>' +
    '<script>function filterReports(vesselCode){currentVesselCode=vesselCode;window.history.pushState({},"","/daily-reports"+(vesselCode?"?vesselCode="+vesselCode:""));loadPage("/daily-reports",vesselCode?"?vesselCode="+vesselCode:"")}</script>';
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