/**
 * Tenant dashboard page — /app/dashboard
 *
 * Pattern for other read-only tenant pages:
 *   1. Import renderTenantShell from "../shell".
 *   2. Call api.* to load data.
 *   3. Build an HTML string and pass it to renderTenantShell.
 *   4. Export an async page function and register it in src/index.ts.
 */

import { t, formatDate } from "../i18n";
import { api } from "../api";
import { renderTenantShell } from "../shell";

export async function pageDashboard(): Promise<void> {
  // Show loading state immediately
  renderTenantShell(t("dashboard.title"), "/app/dashboard",
    `<div class="loading-state">${t("common.loading")}</div>`);

  try {
    const [vesselsRes, assetsRes, workOrdersRes, insightsRes] = await Promise.all([
      api.vessels.list(),
      api.assets.list(),
      api.workOrders.list({}),
      api.aiInsights.list({ status: "NEW" }),
    ]);

    const vessels    = vesselsRes.items;
    const assets     = assetsRes.items;
    const workOrders = workOrdersRes.items;
    const insights   = insightsRes.items;

    const pendingWO = workOrders.filter(
      (wo: any) => wo.status === "PENDING" || wo.status === "ASSIGNED"
    ).length;

    const statsHtml = `
<div class="stats-grid">
  <div class="stat-card">
    <div class="stat-value">${vessels.length}</div>
    <div class="stat-label">${t("nav.vessels")}</div>
  </div>
  <div class="stat-card">
    <div class="stat-value">${assets.length}</div>
    <div class="stat-label">${t("nav.assets")}</div>
  </div>
  <div class="stat-card">
    <div class="stat-value">${workOrders.length}</div>
    <div class="stat-label">${t("nav.workOrders")}</div>
  </div>
  <div class="stat-card">
    <div class="stat-value">${pendingWO}</div>
    <div class="stat-label">Pendientes</div>
  </div>
</div>`;

    let insightsHtml = "";
    if (insights.length > 0) {
      const cards = insights.slice(0, 5).map((ins: any) => `
<div class="insight-card">
  <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:4px">
    <div class="insight-title">${ins.title}</div>
    <span class="badge badge-${priorityColor(ins.priority)}">${ins.priority}</span>
  </div>
  <div class="insight-desc">${ins.description}</div>
  <div class="insight-meta">${ins.vesselCode ?? ""} · ${formatDate(ins.createdAt)}</div>
</div>`).join("");

      insightsHtml = `
<div class="card">
  <div class="card-header">
    <div class="card-title">${t("dashboard.aiInsights")}</div>
  </div>
  ${cards}
</div>`;
    }

    renderTenantShell(t("dashboard.title"), "/app/dashboard", statsHtml + insightsHtml);
  } catch {
    renderTenantShell(t("dashboard.title"), "/app/dashboard",
      `<div class="error-state">${t("common.error")}</div>`);
  }
}

function priorityColor(priority: string): string {
  const map: Record<string, string> = {
    CRITICAL: "red",
    HIGH:     "orange",
    MEDIUM:   "yellow",
    LOW:      "green",
  };
  return map[priority] ?? "neutral";
}
