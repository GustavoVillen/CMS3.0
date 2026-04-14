import { t, formatDate } from "../i18n";
import { api } from "../api";
import { renderTenantShell } from "../shell";

let filters = { providerId: "", status: "", severity: "" };

export async function pageProviderNonconformities(): Promise<void> {
  renderTenantShell(t("nav.providerNC"), "/app/provider-nonconformities", renderLoadingState());
  syncFiltersFromQuery();
  try {
    const ncRes = await api.providerNonconformities.list(filters);
    const nonconformities = ncRes.items;
    const content = await renderContent(nonconformities);
    renderTenantShell(t("nav.providerNC"), "/app/provider-nonconformities", content);
    installFilterHandler();
  } catch (error) {
    renderTenantShell(t("nav.providerNC"), "/app/provider-nonconformities", renderErrorState());
  }
}

async function renderContent(nonconformities: any[]): Promise<string> {
  const filtersHtml = renderFilters();
  
  if (nonconformities.length === 0) {
    return filtersHtml + renderEmptyState();
  }

  let html = filtersHtml + '<div class="table-wrap"><table><thead><tr>' +
    '<th>' + t("providerNC.number") + '</th>' +
    '<th>' + t("providerNC.provider") + '</th>' +
    '<th>' + t("providerNC.type") + '</th>' +
    '<th>' + t("providerNC.severity") + '</th>' +
    '<th>' + t("providerNC.description") + '</th>' +
    '<th>' + t("providerNC.reportedDate") + '</th>' +
    '<th>' + t("providerNC.responseDue") + '</th>' +
    '<th>' + t("providerNC.responseDate") + '</th>' +
    '<th>' + t("common.status") + '</th>' +
    '</tr></thead><tbody>';

  nonconformities.forEach((nc: any) => {
    const severityClass = severityBadgeClass(nc.severity || "MEDIUM");
    html += '<tr>' +
      '<td>' + nc.ncNumber + '</td>' +
      '<td>' + (nc.providerName || "-") + '</td>' +
      '<td>' + (nc.type || "-") + '</td>' +
      '<td><span class="badge ' + severityClass + '">' + (nc.severity || "MEDIUM") + '</span></td>' +
      '<td>' + truncate(nc.description, 50) + '</td>' +
      '<td>' + formatDate(nc.reportedDate) + '</td>' +
      '<td>' + formatDate(nc.responseDueDate) + '</td>' +
      '<td>' + (nc.responseDate ? formatDate(nc.responseDate) : "-") + '</td>' +
      '<td>' + statusBadge(nc.status || "OPEN") + '</td>' +
      '</tr>';
  });

  html += '</tbody></table></div>';
  return html;
}

function truncate(text?: string, maxLen = 50): string {
  if (!text) return "-";
  return text.length > maxLen ? text.substring(0, maxLen) + "..." : text;
}

function renderFilters(): string {
  const statusOptions = '<option value="">' + t("common.allStatus") + '</option>' +
    '<option value="OPEN"' + (filters.status === "OPEN" ? ' selected' : '') + '>OPEN</option>' +
    '<option value="IN_PROGRESS"' + (filters.status === "IN_PROGRESS" ? ' selected' : '') + '>IN_PROGRESS</option>' +
    '<option value="CLOSED"' + (filters.status === "CLOSED" ? ' selected' : '') + '>CLOSED</option>';

  const severityOptions = '<option value="">' + t("common.allSeverity") + '</option>' +
    '<option value="LOW"' + (filters.severity === "LOW" ? ' selected' : '') + '>LOW</option>' +
    '<option value="MEDIUM"' + (filters.severity === "MEDIUM" ? ' selected' : '') + '>MEDIUM</option>' +
    '<option value="HIGH"' + (filters.severity === "HIGH" ? ' selected' : '') + '>HIGH</option>' +
    '<option value="CRITICAL"' + (filters.severity === "CRITICAL" ? ' selected' : '') + '>CRITICAL</option>';

  return '<div class="filters">' +
    '<div class="filter-group"><label class="filter-label">' + t("providerNC.providerSearch") + '</label><input type="text" class="filter-select" id="providerFilter" value="' + (filters.providerId || "") + '" placeholder="' + t("providerNC.providerSearchPlaceholder") + '" onkeyup="if(event.key===\'Enter\')window.__pms.updateFilters()" onchange="window.__pms.updateFilters()" /></div>' +
    '<div class="filter-group"><label class="filter-label">' + t("common.status") + '</label><select class="filter-select" id="statusFilter" onchange="window.__pms.updateFilters()">' + statusOptions + '</select></div>' +
    '<div class="filter-group"><label class="filter-label">' + t("providerNC.severity") + '</label><select class="filter-select" id="severityFilter" onchange="window.__pms.updateFilters()">' + severityOptions + '</select></div>' +
    '</div>';
}

function syncFiltersFromQuery(): void {
  const params = new URLSearchParams(window.location.search);
  filters = {
    providerId: params.get("providerId") || "",
    status: params.get("status") || "",
    severity: params.get("severity") || "",
  };
}

function installFilterHandler(): void {
  (window as any).__pms.updateFilters = () => {
    const provider = (document.getElementById("providerFilter") as HTMLInputElement | null)?.value || "";
    const status = (document.getElementById("statusFilter") as HTMLSelectElement | null)?.value || "";
    const severity = (document.getElementById("severityFilter") as HTMLSelectElement | null)?.value || "";
    const params = new URLSearchParams();
    if (provider) params.set("providerId", provider);
    if (status) params.set("status", status);
    if (severity) params.set("severity", severity);
    const query = params.toString();
    (window as any).__pms.navigate("/app/provider-nonconformities" + (query ? "?" + query : ""));
  };
}

function renderLoadingState(): string {
  return '<div class="loading-state">' + t("common.loading") + '</div>';
}

function renderEmptyState(): string {
  return '<div class="empty-state"><div class="empty-state-icon">⚠️</div><div>' + t("common.noData") + '</div></div>';
}

function renderErrorState(): string {
  return '<div class="error-state">' + t("common.error") + '</div>';
}

function severityBadgeClass(severity: string): string {
  switch (severity) {
    case "CRITICAL": return "badge-red";
    case "HIGH": return "badge-orange";
    case "MEDIUM": return "badge-yellow";
    case "LOW": return "badge-green";
    default: return "badge-neutral";
  }
}

function statusBadge(status: string): string {
  const map: Record<string, string> = {
    OPEN: "badge-red",
    IN_PROGRESS: "badge-yellow",
    CLOSED: "badge-green",
  };
  const cls = map[status] ?? "badge-neutral";
  return '<span class="badge ' + cls + '">' + status + '</span>';
}
