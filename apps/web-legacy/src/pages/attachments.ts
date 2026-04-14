import { t, formatDate } from "../i18n";
import { api } from "../api";

let filters = { vesselCode: "", entityType: "" };
let vesselsList: any[] = [];

function renderTargetReference(attachment: any): string {
  if (attachment.targetType && attachment.targetId) {
    return '<span class="ref-badge ref-' + attachment.targetType.toLowerCase() + '">' + attachment.targetType + ': ' + attachment.targetId + '</span>';
  }
  if (attachment.referenceType && attachment.referenceId) {
    return '<span class="ref-badge ref-generic">' + attachment.referenceType + ': ' + attachment.referenceId + '</span>';
  }
  return "-";
}

function formatFileSize(bytes?: number): string {
  if (!bytes) return "-";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

export async function renderAttachmentsPage(): Promise<string> {
  try {
    const [vesselsRes, attachmentsRes] = await Promise.all([
      api.vessels.list(),
      api.attachments.list(filters),
    ]);

    vesselsList = vesselsRes.items;
    const attachments = attachmentsRes.items;

    return renderContent(attachments);
  } catch (error) {
    return renderErrorState();
  }
}

async function renderContent(attachments: any[]): Promise<string> {
  const filtersHtml = renderFilters();
  
  if (attachments.length === 0) {
    return filtersHtml + renderEmptyState();
  }

  let html = filtersHtml + '<div class="table-container"><table><thead><tr>' +
    '<th>File Name</th>' +
    '<th>Type</th>' +
    '<th>Target/Reference</th>' +
    '<th>Size</th>' +
    '<th>' + t("common.vessel") + '</th>' +
    '<th>Uploaded</th>' +
    '<th>' + t("common.status") + '</th>' +
    '</tr></thead><tbody>';

  attachments.forEach((attachment: any) => {
    const statusClass = "status-" + (attachment.status || "ACTIVE").toLowerCase().replace(/_/g, "-");
    html += '<tr>' +
      '<td>' + attachment.fileName + '</td>' +
      '<td>' + (attachment.fileType || "-") + '</td>' +
      '<td>' + renderTargetReference(attachment) + '</td>' +
      '<td>' + formatFileSize(attachment.fileSize) + '</td>' +
      '<td>' + (attachment.vesselCode || "-") + '</td>' +
      '<td>' + formatDate(attachment.uploadedAt) + '</td>' +
      '<td><span class="status-badge ' + statusClass + '">' + (attachment.status || "ACTIVE") + '</span></td>' +
      '</tr>';
  });

  html += '</tbody></table></div>';
  return html;
}

function renderFilters(): string {
  const vesselOptions = '<option value="">All Vessels</option>' + 
    vesselsList.map((v: any) => '<option value="' + v.code + '"' + (v.code === filters.vesselCode ? ' selected' : '') + '>' + v.code + '</option>').join("");

  const entityOptions = '<option value="">All Entity Types</option>' +
    '<option value="DEFECT"' + (filters.entityType === "DEFECT" ? ' selected' : '') + '>DEFECT</option>' +
    '<option value="INSPECTION"' + (filters.entityType === "INSPECTION" ? ' selected' : '') + '>INSPECTION</option>' +
    '<option value="CERTIFICATE"' + (filters.entityType === "CERTIFICATE" ? ' selected' : '') + '>CERTIFICATE</option>' +
    '<option value="WORK_ORDER"' + (filters.entityType === "WORK_ORDER" ? ' selected' : '') + '>WORK_ORDER</option>' +
    '<option value="MAINTENANCE_PLAN"' + (filters.entityType === "MAINTENANCE_PLAN" ? ' selected' : '') + '>MAINTENANCE_PLAN</option>' +
    '<option value="DEFERRAL"' + (filters.entityType === "DEFERRAL" ? ' selected' : '') + '>DEFERRAL</option>' +
    '<option value="RCA"' + (filters.entityType === "RCA" ? ' selected' : '') + '>RCA</option>' +
    '<option value="CAPA"' + (filters.entityType === "CAPA" ? ' selected' : '') + '>CAPA</option>' +
    '<option value="DAILY_REPORT"' + (filters.entityType === "DAILY_REPORT" ? ' selected' : '') + '>DAILY_REPORT</option>' +
    '<option value="GENERAL"' + (filters.entityType === "GENERAL" ? ' selected' : '') + '>GENERAL</option>';

  return '<div class="filters">' +
    '<div class="filter-group"><label class="filter-label">' + t("common.vessel") + '</label><select class="filter-select" id="vesselFilter" onchange="updateFilters()">' + vesselOptions + '</select></div>' +
    '<div class="filter-group"><label class="filter-label">Entity Type</label><select class="filter-select" id="entityFilter" onchange="updateFilters()">' + entityOptions + '</select></div>' +
    '</div>' +
    '<script>function updateFilters(){var v=document.getElementById("vesselFilter").value;var e=document.getElementById("entityFilter").value;var q=[];if(v)q.push("vesselCode="+v);if(e)q.push("entityType="+e);window.history.pushState({},"","/attachments"+(q.length?"?"+q.join("&"):""));loadPage("/attachments",q.length?"?"+q.join("&"):"")}</script>';
}

function renderLoadingState(): string {
  return '<div class="loading">' + t("common.loading") + '</div>';
}

function renderEmptyState(): string {
  return '<div class="empty-state"><div class="empty-state-icon">📎</div><div>' + t("common.noData") + '</div></div>';
}

function renderErrorState(): string {
  return '<div class="error-state">' + t("common.error") + '</div>';
}

export { renderLoadingState, renderEmptyState, renderErrorState };