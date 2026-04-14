import { t, formatDate } from "../i18n";
import { api } from "../api";
import { renderTenantShell } from "../shell";

let filters = { providerId: "", status: "" };

export async function pageProviderEvaluations(): Promise<void> {
  renderTenantShell(t("nav.providerEvals"), "/app/provider-evaluations", renderLoadingState());
  syncFiltersFromQuery();
  try {
    const evaluationsRes = await api.providerEvaluations.list(filters);
    const evaluations = evaluationsRes.items;
    const content = await renderContent(evaluations);
    renderTenantShell(t("nav.providerEvals"), "/app/provider-evaluations", content);
    installFilterHandler();
  } catch (error) {
    renderTenantShell(t("nav.providerEvals"), "/app/provider-evaluations", renderErrorState());
  }
}

async function renderContent(evaluations: any[]): Promise<string> {
  const filtersHtml = renderFilters();
  
  if (evaluations.length === 0) {
    return filtersHtml + renderEmptyState();
  }

  let html = filtersHtml + '<div class="table-wrap"><table><thead><tr>' +
    '<th>' + t("providerEvaluations.number") + '</th>' +
    '<th>' + t("providerEvaluations.provider") + '</th>' +
    '<th>' + t("providerEvaluations.period") + '</th>' +
    '<th>' + t("providerEvaluations.score") + '</th>' +
    '<th>' + t("providerEvaluations.quality") + '</th>' +
    '<th>' + t("providerEvaluations.delivery") + '</th>' +
    '<th>' + t("providerEvaluations.communication") + '</th>' +
    '<th>' + t("providerEvaluations.evaluatedBy") + '</th>' +
    '<th>' + t("providerEvaluations.date") + '</th>' +
    '<th>' + t("common.status") + '</th>' +
    '</tr></thead><tbody>';

  evaluations.forEach((e: any) => {
    const statusClass = statusBadgeClass(e.status || "COMPLETED");
    html += '<tr>' +
      '<td>' + e.evaluationNumber + '</td>' +
      '<td>' + (e.providerName || "-") + '</td>' +
      '<td>' + (e.period || "-") + '</td>' +
      '<td><span class="badge ' + getScoreClass(e.overallScore) + '">' + (e.overallScore ?? "-") + '</span></td>' +
      '<td>' + (e.qualityScore ?? "-") + '</td>' +
      '<td>' + (e.deliveryScore ?? "-") + '</td>' +
      '<td>' + (e.communicationScore ?? "-") + '</td>' +
      '<td>' + (e.evaluatedBy || "-") + '</td>' +
      '<td>' + formatDate(e.evaluationDate) + '</td>' +
      '<td><span class="badge ' + statusClass + '">' + (e.status || "COMPLETED") + '</span></td>' +
      '</tr>';
  });

  html += '</tbody></table></div>';
  return html;
}

function getScoreClass(score?: number): string {
  if (!score) return "badge-neutral";
  if (score >= 4.5) return "badge-green";
  if (score >= 3.5) return "badge-yellow";
  if (score >= 2.5) return "badge-orange";
  return "badge-red";
}

function statusBadgeClass(status: string): string {
  const map: Record<string, string> = {
    PENDING: "badge-yellow",
    COMPLETED: "badge-green",
    CANCELLED: "badge-neutral",
  };
  return map[status] ?? "badge-neutral";
}

function renderFilters(): string {
  const statusOptions = '<option value="">' + t("common.allStatus") + '</option>' +
    '<option value="PENDING"' + (filters.status === "PENDING" ? ' selected' : '') + '>PENDING</option>' +
    '<option value="COMPLETED"' + (filters.status === "COMPLETED" ? ' selected' : '') + '>COMPLETED</option>' +
    '<option value="CANCELLED"' + (filters.status === "CANCELLED" ? ' selected' : '') + '>CANCELLED</option>';

  return '<div class="filters">' +
    '<div class="filter-group"><label class="filter-label">' + t("providerEvaluations.providerSearch") + '</label><input type="text" class="filter-select" id="providerFilter" value="' + (filters.providerId || "") + '" placeholder="' + t("providerEvaluations.providerSearchPlaceholder") + '" onkeyup="if(event.key===\'Enter\')window.__pms.updateFilters()" onchange="window.__pms.updateFilters()" /></div>' +
    '<div class="filter-group"><label class="filter-label">' + t("common.status") + '</label><select class="filter-select" id="statusFilter" onchange="window.__pms.updateFilters()">' + statusOptions + '</select></div>' +
    '</div>';
}

function syncFiltersFromQuery(): void {
  const params = new URLSearchParams(window.location.search);
  filters = {
    providerId: params.get("providerId") || "",
    status: params.get("status") || "",
  };
}

function installFilterHandler(): void {
  (window as any).__pms.updateFilters = () => {
    const provider = (document.getElementById("providerFilter") as HTMLInputElement | null)?.value || "";
    const status = (document.getElementById("statusFilter") as HTMLSelectElement | null)?.value || "";
    const params = new URLSearchParams();
    if (provider) params.set("providerId", provider);
    if (status) params.set("status", status);
    const query = params.toString();
    (window as any).__pms.navigate("/app/provider-evaluations" + (query ? "?" + query : ""));
  };
}

function renderLoadingState(): string {
  return '<div class="loading-state">' + t("common.loading") + '</div>';
}

function renderEmptyState(): string {
  return '<div class="empty-state"><div class="empty-state-icon">📊</div><div>' + t("common.noData") + '</div></div>';
}

function renderErrorState(): string {
  return '<div class="error-state">' + t("common.error") + '</div>';
}
