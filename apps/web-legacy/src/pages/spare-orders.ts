import { t, formatDate } from "../i18n";
import { api } from "../api";
import { renderTenantShell } from "../shell";

let filters = { vesselCode: "", status: "", type: "" };
let vesselsList: any[] = [];

export async function pageSpareOrders(): Promise<void> {
  renderTenantShell(t("nav.spareOrders"), "/app/spare-orders", renderLoadingState());
  syncFiltersFromQuery();
  try {
    const [vesselsRes, ordersRes] = await Promise.all([
      api.vessels.list(),
      api.spareOrders.list(filters),
    ]);

    vesselsList = vesselsRes.items;
    const orders = ordersRes.items;
    const content = await renderContent(orders);
    renderTenantShell(t("nav.spareOrders"), "/app/spare-orders", content);
    installFilterHandler();
  } catch (error) {
    renderTenantShell(t("nav.spareOrders"), "/app/spare-orders", renderErrorState());
  }
}

async function renderContent(orders: any[]): Promise<string> {
  const filtersHtml = renderFilters();
  
  if (orders.length === 0) {
    return filtersHtml + renderEmptyState();
  }

  let html = filtersHtml + '<div class="table-wrap"><table><thead><tr>' +
    '<th>' + t("spareOrders.number") + '</th>' +
    '<th>' + t("spareOrders.provider") + '</th>' +
    '<th>' + t("common.vessel") + '</th>' +
    '<th>' + t("common.type") + '</th>' +
    '<th>' + t("spareOrders.orderDate") + '</th>' +
    '<th>' + t("spareOrders.expectedDate") + '</th>' +
    '<th>' + t("spareOrders.total") + '</th>' +
    '<th>' + t("common.status") + '</th>' +
    '</tr></thead><tbody>';

  orders.forEach((order: any) => {
    html += '<tr>' +
      '<td>' + order.orderNumber + '</td>' +
      '<td>' + (order.providerName || "-") + '</td>' +
      '<td>' + (order.vesselCode || "-") + '</td>' +
      '<td>' + (order.type || "-") + '</td>' +
      '<td>' + formatDate(order.orderDate) + '</td>' +
      '<td>' + formatDate(order.expectedDate) + '</td>' +
      '<td>' + (order.totalAmount ? order.currency + " " + order.totalAmount : "-") + '</td>' +
      '<td>' + statusBadge(order.status || "PENDING") + '</td>' +
      '</tr>';
  });

  html += '</tbody></table></div>';
  return html;
}

function renderFilters(): string {
  const vesselOptions = '<option value="">' + t("common.allVessels") + '</option>' + 
    vesselsList.map((v: any) => '<option value="' + v.code + '"' + (v.code === filters.vesselCode ? ' selected' : '') + '>' + v.code + '</option>').join("");

  const statusOptions = '<option value="">' + t("common.allStatus") + '</option>' +
    '<option value="PENDING"' + (filters.status === "PENDING" ? ' selected' : '') + '>PENDING</option>' +
    '<option value="APPROVED"' + (filters.status === "APPROVED" ? ' selected' : '') + '>APPROVED</option>' +
    '<option value="ORDERED"' + (filters.status === "ORDERED" ? ' selected' : '') + '>ORDERED</option>' +
    '<option value="RECEIVED"' + (filters.status === "RECEIVED" ? ' selected' : '') + '>RECEIVED</option>' +
    '<option value="CANCELLED"' + (filters.status === "CANCELLED" ? ' selected' : '') + '>CANCELLED</option>';

  const typeOptions = '<option value="">' + t("common.allTypes") + '</option>' +
    '<option value="STOCK"' + (filters.type === "STOCK" ? ' selected' : '') + '>STOCK</option>' +
    '<option value="EMERGENCY"' + (filters.type === "EMERGENCY" ? ' selected' : '') + '>EMERGENCY</option>' +
    '<option value="PROJECT"' + (filters.type === "PROJECT" ? ' selected' : '') + '>PROJECT</option>';

  return '<div class="filters">' +
    '<div class="filter-group"><label class="filter-label">' + t("common.vessel") + '</label><select class="filter-select" id="vesselFilter" onchange="window.__pms.updateFilters()">' + vesselOptions + '</select></div>' +
    '<div class="filter-group"><label class="filter-label">' + t("common.status") + '</label><select class="filter-select" id="statusFilter" onchange="window.__pms.updateFilters()">' + statusOptions + '</select></div>' +
    '<div class="filter-group"><label class="filter-label">' + t("common.type") + '</label><select class="filter-select" id="typeFilter" onchange="window.__pms.updateFilters()">' + typeOptions + '</select></div>' +
    '</div>';
}

function syncFiltersFromQuery(): void {
  const params = new URLSearchParams(window.location.search);
  filters = {
    vesselCode: params.get("vesselCode") || "",
    status: params.get("status") || "",
    type: params.get("type") || "",
  };
}

function installFilterHandler(): void {
  (window as any).__pms.updateFilters = () => {
    const vessel = (document.getElementById("vesselFilter") as HTMLSelectElement | null)?.value || "";
    const status = (document.getElementById("statusFilter") as HTMLSelectElement | null)?.value || "";
    const type = (document.getElementById("typeFilter") as HTMLSelectElement | null)?.value || "";
    const params = new URLSearchParams();
    if (vessel) params.set("vesselCode", vessel);
    if (status) params.set("status", status);
    if (type) params.set("type", type);
    const query = params.toString();
    (window as any).__pms.navigate("/app/spare-orders" + (query ? "?" + query : ""));
  };
}

function renderLoadingState(): string {
  return '<div class="loading-state">' + t("common.loading") + '</div>';
}

function renderEmptyState(): string {
  return '<div class="empty-state"><div class="empty-state-icon">🛒</div><div>' + t("common.noData") + '</div></div>';
}

function renderErrorState(): string {
  return '<div class="error-state">' + t("common.error") + '</div>';
}

function statusBadge(status: string): string {
  const map: Record<string, string> = {
    PENDING: "badge-yellow",
    APPROVED: "badge-green",
    ORDERED: "badge-neutral",
    RECEIVED: "badge-green",
    CANCELLED: "badge-red",
  };
  const cls = map[status] ?? "badge-neutral";
  return '<span class="badge ' + cls + '">' + status + '</span>';
}
