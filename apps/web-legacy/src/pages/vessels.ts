import { t, formatDate } from "../i18n";
import { api } from "../api";

export async function renderVesselsPage(): Promise<string> {
  try {
    const response = await api.vessels.list();
    const vessels = response.items;

    if (vessels.length === 0) {
      return renderEmptyState();
    }

    let html = '<div class="table-container"><table><thead><tr>' +
      '<th>' + t("common.code") + '</th>' +
      '<th>' + t("common.name") + '</th>' +
      '<th>' + t("common.status") + '</th>' +
      '<th>' + t("common.createdAt") + '</th>' +
      '</tr></thead><tbody>';

    vessels.forEach((vessel: any) => {
      const statusClass = vessel.status === "ACTIVE" ? "status-active" : "status-inactive";
      html += '<tr>' +
        '<td>' + vessel.code + '</td>' +
        '<td>' + vessel.name + '</td>' +
        '<td><span class="status-badge ' + statusClass + '">' + vessel.status + '</span></td>' +
        '<td>' + formatDate(vessel.createdAt) + '</td>' +
        '</tr>';
    });

    html += '</tbody></table></div>';
    return html;
  } catch (error) {
    return renderErrorState();
  }
}

function renderLoadingState(): string {
  return '<div class="loading">' + t("common.loading") + '</div>';
}

function renderEmptyState(): string {
  return '<div class="empty-state"><div class="empty-state-icon">🚢</div><div>' + t("common.noData") + '</div></div>';
}

function renderErrorState(): string {
  return '<div class="error-state">' + t("common.error") + '</div>';
}

export { renderLoadingState, renderEmptyState, renderErrorState };