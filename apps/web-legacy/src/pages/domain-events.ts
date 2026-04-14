import { t, formatDate } from "../i18n";
import { api } from "../api";

let filters = { vesselCode: "", eventType: "", entityType: "" };
let vesselsList: any[] = [];

export async function renderDomainEventsPage(): Promise<string> {
  try {
    const [vesselsRes, eventsRes] = await Promise.all([
      api.vessels.list(),
      api.domainEvents.list(filters),
    ]);

    vesselsList = vesselsRes.items;
    const events = eventsRes.items;

    return renderContent(events);
  } catch (error) {
    return renderErrorState();
  }
}

async function renderContent(events: any[]): Promise<string> {
  const filtersHtml = renderFilters();
  
  if (events.length === 0) {
    return filtersHtml + renderEmptyState();
  }

  let html = filtersHtml + '<div class="table-container"><table><thead><tr>' +
    '<th>Event ID</th>' +
    '<th>Timestamp</th>' +
    '<th>Event Type</th>' +
    '<th>Entity Type</th>' +
    '<th>Entity ID</th>' +
    '<th>User</th>' +
    '<th>Details</th>' +
    '</tr></thead><tbody>';

  events.forEach((event: any) => {
    html += '<tr>' +
      '<td>' + (event.eventId || "-") + '</td>' +
      '<td>' + formatDate(event.timestamp) + '</td>' +
      '<td><span class="event-type-badge">' + event.eventType + '</span></td>' +
      '<td>' + (event.entityType || "-") + '</td>' +
      '<td>' + (event.entityId || "-") + '</td>' +
      '<td>' + (event.userEmail || event.userId || "-") + '</td>' +
      '<td>' + renderEventDetails(event) + '</td>' +
      '</tr>';
  });

  html += '</tbody></table></div>';
  return html;
}

function renderEventDetails(event: any): string {
  if (!event.details && !event.changes) return "-";
  
  const changes = event.changes || event.details;
  if (typeof changes === "string") return changes;
  
  if (typeof changes === "object") {
    const parts: string[] = [];
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === undefined) continue;
      parts.push(key + ": " + JSON.stringify(value));
    }
    return parts.slice(0, 3).join(", ") + (parts.length > 3 ? " ..." : "");
  }
  
  return String(changes);
}

function renderFilters(): string {
  const vesselOptions = '<option value="">All Vessels</option>' + 
    vesselsList.map((v: any) => '<option value="' + v.code + '"' + (v.code === filters.vesselCode ? ' selected' : '') + '>' + v.code + '</option>').join("");

  const eventTypeOptions = '<option value="">All Event Types</option>' +
    '<option value="CREATED"' + (filters.eventType === "CREATED" ? ' selected' : '') + '>CREATED</option>' +
    '<option value="UPDATED"' + (filters.eventType === "UPDATED" ? ' selected' : '') + '>UPDATED</option>' +
    '<option value="DELETED"' + (filters.eventType === "DELETED" ? ' selected' : '') + '>DELETED</option>' +
    '<option value="STATUS_CHANGED"' + (filters.eventType === "STATUS_CHANGED" ? ' selected' : '') + '>STATUS_CHANGED</option>' +
    '<option value="ASSIGNED"' + (filters.eventType === "ASSIGNED" ? ' selected' : '') + '>ASSIGNED</option>' +
    '<option value="COMPLETED"' + (filters.eventType === "COMPLETED" ? ' selected' : '') + '>COMPLETED</option>' +
    '<option value="OVERDUE"' + (filters.eventType === "OVERDUE" ? ' selected' : '') + '>OVERDUE</option>' +
    '<option value="EXPIRED"' + (filters.eventType === "EXPIRED" ? ' selected' : '') + '>EXPIRED</option>';

  const entityTypeOptions = '<option value="">All Entity Types</option>' +
    '<option value="DEFECT"' + (filters.entityType === "DEFECT" ? ' selected' : '') + '>DEFECT</option>' +
    '<option value="DEFERRAL"' + (filters.entityType === "DEFERRAL" ? ' selected' : '') + '>DEFERRAL</option>' +
    '<option value="WORK_ORDER"' + (filters.entityType === "WORK_ORDER" ? ' selected' : '') + '>WORK_ORDER</option>' +
    '<option value="INSPECTION"' + (filters.entityType === "INSPECTION" ? ' selected' : '') + '>INSPECTION</option>' +
    '<option value="CERTIFICATE"' + (filters.entityType === "CERTIFICATE" ? ' selected' : '') + '>CERTIFICATE</option>' +
    '<option value="MAINTENANCE_PLAN"' + (filters.entityType === "MAINTENANCE_PLAN" ? ' selected' : '') + '>MAINTENANCE_PLAN</option>' +
    '<option value="RCA"' + (filters.entityType === "RCA" ? ' selected' : '') + '>RCA</option>' +
    '<option value="CAPA"' + (filters.entityType === "CAPA" ? ' selected' : '') + '>CAPA</option>';

  return '<div class="filters">' +
    '<div class="filter-group"><label class="filter-label">' + t("common.vessel") + '</label><select class="filter-select" id="vesselFilter" onchange="updateFilters()">' + vesselOptions + '</select></div>' +
    '<div class="filter-group"><label class="filter-label">Event Type</label><select class="filter-select" id="eventTypeFilter" onchange="updateFilters()">' + eventTypeOptions + '</select></div>' +
    '<div class="filter-group"><label class="filter-label">Entity Type</label><select class="filter-select" id="entityTypeFilter" onchange="updateFilters()">' + entityTypeOptions + '</select></div>' +
    '</div>' +
    '<script>function updateFilters(){var v=document.getElementById("vesselFilter").value;var e=document.getElementById("eventTypeFilter").value;var t=document.getElementById("entityTypeFilter").value;var q=[];if(v)q.push("vesselCode="+v);if(e)q.push("eventType="+e);if(t)q.push("entityType="+t);window.history.pushState({},"","/domain-events"+(q.length?"?"+q.join("&"):""));loadPage("/domain-events",q.length?"?"+q.join("&"):"")}</script>';
}

function renderLoadingState(): string {
  return '<div class="loading">' + t("common.loading") + '</div>';
}

function renderEmptyState(): string {
  return '<div class="empty-state"><div class="empty-state-icon">📊</div><div>' + t("common.noData") + '</div></div>';
}

function renderErrorState(): string {
  return '<div class="error-state">' + t("common.error") + '</div>';
}

export { renderLoadingState, renderEmptyState, renderErrorState };