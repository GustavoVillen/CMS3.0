import { t, formatDate } from "../i18n";
import { api } from "../api";

let filters = { vesselCode: "", status: "", type: "" };
let vesselsList: any[] = [];

export async function renderCertificatesPage(): Promise<string> {
  try {
    const [vesselsRes, certsRes] = await Promise.all([
      api.vessels.list(),
      api.certificates.list(filters),
    ]);

    vesselsList = vesselsRes.items;
    const certificates = certsRes.items;

    return renderContent(certificates);
  } catch (error) {
    return renderErrorState();
  }
}

async function renderContent(certificates: any[]): Promise<string> {
  const filtersHtml = renderFilters();
  
  if (certificates.length === 0) {
    return filtersHtml + renderEmptyState();
  }

  let html = filtersHtml + '<div class="table-container"><table><thead><tr>' +
    '<th>Certificate #</th>' +
    '<th>' + t("common.title") + '</th>' +
    '<th>' + t("common.vessel") + '</th>' +
    '<th>Type</th>' +
    '<th>Issuing Authority</th>' +
    '<th>Issue Date</th>' +
    '<th>Expiry Date</th>' +
    '<th>' + t("common.status") + '</th>' +
    '</tr></thead><tbody>';

  certificates.forEach((cert: any) => {
    const statusClass = "status-" + getStatusClass(cert.status, cert.expiryDate);
    html += '<tr>' +
      '<td>' + cert.certificateNumber + '</td>' +
      '<td>' + cert.title + '</td>' +
      '<td>' + cert.vesselCode + '</td>' +
      '<td>' + (cert.certificateType || "-") + '</td>' +
      '<td>' + (cert.issuingAuthority || "-") + '</td>' +
      '<td>' + formatDate(cert.issueDate) + '</td>' +
      '<td>' + formatDate(cert.expiryDate) + '</td>' +
      '<td><span class="status-badge ' + statusClass + '">' + cert.status + '</span></td>' +
      '</tr>';
  });

  html += '</tbody></table></div>';
  return html;
}

function getStatusClass(status: string, expiryDate?: string): string {
  if (status === "EXPIRED") return "expired";
  if (status === "ACTIVE" && expiryDate) {
    const expiry = new Date(expiryDate);
    const now = new Date();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    if (expiry.getTime() - now.getTime() < thirtyDays) {
      return "pending";
    }
  }
  return status.toLowerCase().replace(/_/g, "-");
}

function renderFilters(): string {
  const vesselOptions = '<option value="">All Vessels</option>' + 
    vesselsList.map((v: any) => '<option value="' + v.code + '"' + (v.code === filters.vesselCode ? ' selected' : '') + '>' + v.code + '</option>').join("");

  const statusOptions = '<option value="">All Status</option>' +
    '<option value="ACTIVE"' + (filters.status === "ACTIVE" ? ' selected' : '') + '>ACTIVE</option>' +
    '<option value="EXPIRED"' + (filters.status === "EXPIRED" ? ' selected' : '') + '>EXPIRED</option>' +
    '<option value="PENDING"' + (filters.status === "PENDING" ? ' selected' : '') + '>PENDING</option>' +
    '<option value="REVOKED"' + (filters.status === "REVOKED" ? ' selected' : '') + '>REVOKED</option>';

  const typeOptions = '<option value="">All Types</option>' +
    '<option value="SAFETY"' + (filters.type === "SAFETY" ? ' selected' : '') + '>SAFETY</option>' +
    '<option value="POLLUTION"' + (filters.type === "POLLUTION" ? ' selected' : '') + '>POLLUTION</option>' +
    '<option value="DOCUMENT"' + (filters.type === "DOCUMENT" ? ' selected' : '') + '>DOCUMENT</option>' +
    '<option value="CREW"' + (filters.type === "CREW" ? ' selected' : '') + '>CREW</option>' +
    '<option value="LOADLINE"' + (filters.type === "LOADLINE" ? ' selected' : '') + '>LOADLINE</option>' +
    '<option value="MISC"' + (filters.type === "MISC" ? ' selected' : '') + '>MISC</option>';

  return '<div class="filters">' +
    '<div class="filter-group"><label class="filter-label">' + t("common.vessel") + '</label><select class="filter-select" id="vesselFilter" onchange="updateFilters()">' + vesselOptions + '</select></div>' +
    '<div class="filter-group"><label class="filter-label">' + t("common.status") + '</label><select class="filter-select" id="statusFilter" onchange="updateFilters()">' + statusOptions + '</select></div>' +
    '<div class="filter-group"><label class="filter-label">Type</label><select class="filter-select" id="typeFilter" onchange="updateFilters()">' + typeOptions + '</select></div>' +
    '</div>' +
    '<script>function updateFilters(){var v=document.getElementById("vesselFilter").value;var s=document.getElementById("statusFilter").value;var t=document.getElementById("typeFilter").value;var q=[];if(v)q.push("vesselCode="+v);if(s)q.push("status="+s);if(t)q.push("type="+t);window.history.pushState({},"","/certificates"+(q.length?"?"+q.join("&"):""));loadPage("/certificates",q.length?"?"+q.join("&"):"")}</script>';
}

function renderLoadingState(): string {
  return '<div class="loading">' + t("common.loading") + '</div>';
}

function renderEmptyState(): string {
  return '<div class="empty-state"><div class="empty-state-icon">📜</div><div>' + t("common.noData") + '</div></div>';
}

function renderErrorState(): string {
  return '<div class="error-state">' + t("common.error") + '</div>';
}

export { renderLoadingState, renderEmptyState, renderErrorState };