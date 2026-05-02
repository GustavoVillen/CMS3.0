import type { IncomingMessage, ServerResponse } from "node:http";
import type { AppEnv } from "../../config/env";
import { sendJson } from "../../http/json-response";
import { readJsonBody } from "../../http/read-json-body";
import { RouteError } from "../../http/route-error";
import { resolveTenantSlugFromRequest } from "../bootstrap/public-bootstrap-route";
import { requireTenantAccessSession } from "../auth/tenant-route-auth";
import { enforceRateLimit } from "../../http/rate-limiter";
import {
  createTenantSpare,
  deleteTenantSpare,
  getTenantSpare,
  listReorderAlerts,
  listTenantSpares,
  parseBelowReorderQuery,
  updateTenantSpare,
} from "../spares/spares-service";
import { createStockMovement, listTenantStockMovements } from "../stock-movements/stock-movements-service";
import {
  createStockLocation,
  deleteStockLocation,
  getStockLocation,
  listStockLocations,
  updateStockLocation,
} from "./stock-locations-service";
import {
  approveSpareRequest,
  cancelSpareRequest,
  createSpareRequest,
  deleteSpareRequest,
  getSpareRequest,
  listSpareRequests,
  rejectSpareRequest,
  submitSpareRequest,
  updateSpareRequest,
} from "../spare-requests/spare-requests-service";
import {
  addRequestItem,
  deleteRequestItem,
  fulfillItem,
  listRequestItems,
  updateRequestItem,
} from "../spare-requests/spare-request-items-service";
import {
  consumeReservation,
  createReservationsForRequest,
  listReservationsForRequest,
  releaseReservation,
} from "../spare-requests/stock-reservations-service";

function requireTenantSlug(request: IncomingMessage, env: AppEnv): string {
  const slug = resolveTenantSlugFromRequest(request, env);
  if (!slug) throw new RouteError(400, "TENANT_UNRESOLVED", "Unable to resolve tenant.");
  return slug;
}

export async function handleSparesRoutes(
  method: string,
  url: URL,
  request: IncomingMessage,
  response: ServerResponse,
  env: AppEnv,
): Promise<boolean> {
  if (
    !url.pathname.startsWith("/app/pms/spares") &&
    !url.pathname.startsWith("/app/pms/stock-movements") &&
    !url.pathname.startsWith("/app/pms/stock-locations") &&
    !url.pathname.startsWith("/app/pms/spare-requests") &&
    !url.pathname.startsWith("/app/pms/stock-reservations") &&
    !url.pathname.startsWith("/app/pms/reports/") &&
    !url.pathname.startsWith("/app/pms/monthly-reports")
  ) {
    return false;
  }

  const tenantSlug = requireTenantSlug(request, env);
  const session = requireTenantAccessSession(request, tenantSlug);

  if (method === "GET" && url.pathname === "/app/pms/spares") {
    const items = await listTenantSpares(session, {
      vesselCode: url.searchParams.get("vesselCode"),
      status: url.searchParams.get("status"),
      criticality: url.searchParams.get("criticality"),
      belowReorder: parseBelowReorderQuery(url.searchParams.get("belowReorder")),
    });
    sendJson(response, 200, { items, total: items.length });
    return true;
  }

  if (method === "POST" && url.pathname === "/app/pms/spares") {
    const body = await readJsonBody(request) as Parameters<typeof createTenantSpare>[1];
    sendJson(response, 201, await createTenantSpare(session, body));
    return true;
  }

  if (method === "GET" && url.pathname === "/app/pms/spares/reorder-alerts") {
    const items = await listReorderAlerts(session, url.searchParams.get("vesselCode"));
    sendJson(response, 200, { items, total: items.length });
    return true;
  }

  // ── Reportes (Inventario / Consumo Mensual) ──────────────────────────────────

  if (method === "GET" && url.pathname === "/app/pms/reports/spare-inventory") {
    const { getSpareInventoryReport } = await import("./spare-reports-service");
    const dept = url.searchParams.get("department");
    const report = await getSpareInventoryReport(session, {
      vesselCode: url.searchParams.get("vesselCode") ?? "",
      department: dept as "CUBIERTA" | "MAQUINAS" | "COCINA" | "BARCAZA" | null,
      asOfDate: url.searchParams.get("asOfDate"),
    });
    sendJson(response, 200, report);
    return true;
  }

  if (method === "GET" && url.pathname === "/app/pms/reports/spare-inventory/pdf") {
    enforceRateLimit(request, `pdf:${session.user.id}`, { maxRequests: 10, windowMs: 60_000 });
    const { buildSpareInventoryPdf } = await import("./spare-inventory-pdf-service");
    const { recordMonthlyReportGenerated } = await import("./monthly-reports-history-service");
    const dept = url.searchParams.get("department");
    const vesselCode = url.searchParams.get("vesselCode") ?? "";
    const asOfDate   = url.searchParams.get("asOfDate");
    const buffer = await buildSpareInventoryPdf(session, {
      vesselCode,
      department: dept as "CUBIERTA" | "MAQUINAS" | "COCINA" | "BARCAZA" | null,
      asOfDate,
    });
    const filename = `inventario-${vesselCode}-${new Date().toISOString().slice(0, 10)}.pdf`;
    await recordMonthlyReportGenerated(session, {
      type: "INVENTORY",
      vesselCode,
      fileName: filename,
      asOfDate,
      department: dept,
    });
    response.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": buffer.length,
    });
    response.end(buffer);
    return true;
  }

  if (method === "GET" && url.pathname === "/app/pms/reports/spare-consumption") {
    const { getSpareConsumptionReport } = await import("./spare-reports-service");
    const report = await getSpareConsumptionReport(session, {
      vesselCode: url.searchParams.get("vesselCode") ?? "",
      year:  Number(url.searchParams.get("year")  ?? new Date().getFullYear()),
      month: Number(url.searchParams.get("month") ?? new Date().getMonth() + 1),
    });
    sendJson(response, 200, report);
    return true;
  }

  if (method === "GET" && url.pathname === "/app/pms/reports/spare-consumption/pdf") {
    enforceRateLimit(request, `pdf:${session.user.id}`, { maxRequests: 10, windowMs: 60_000 });
    const { buildSpareConsumptionPdf } = await import("./spare-consumption-pdf-service");
    const { recordMonthlyReportGenerated } = await import("./monthly-reports-history-service");
    const vesselCode = url.searchParams.get("vesselCode") ?? "";
    const year  = Number(url.searchParams.get("year")  ?? new Date().getFullYear());
    const month = Number(url.searchParams.get("month") ?? new Date().getMonth() + 1);
    const buffer = await buildSpareConsumptionPdf(session, { vesselCode, year, month });
    const filename = `consumo-${vesselCode}-${year}-${String(month).padStart(2, "0")}.pdf`;
    await recordMonthlyReportGenerated(session, {
      type: "CONSUMPTION",
      vesselCode,
      fileName: filename,
      year,
      month,
    });
    response.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": buffer.length,
    });
    response.end(buffer);
    return true;
  }

  if (method === "GET" && url.pathname === "/app/pms/reports/history") {
    const { listMonthlyReportHistory } = await import("./monthly-reports-history-service");
    const vesselCode = url.searchParams.get("vesselCode");
    const typeParam  = url.searchParams.get("type");
    const limit      = Number(url.searchParams.get("limit") ?? "100");
    const items = await listMonthlyReportHistory(session, {
      vesselCode,
      type: typeParam === "INVENTORY" || typeParam === "CONSUMPTION" ? typeParam : null,
      limit: Number.isFinite(limit) ? limit : 100,
    });
    sendJson(response, 200, { items, total: items.length });
    return true;
  }

  // ── Monthly Reports (formal) ───────────────────────────────────────────────
  if (url.pathname === "/app/pms/monthly-reports") {
    const {
      listTenantMonthlyReports, createTenantMonthlyReport,
    } = await import("./monthly-reports-service");
    if (method === "GET") {
      const items = await listTenantMonthlyReports(session, {
        vesselCode: url.searchParams.get("vesselCode"),
        status:     url.searchParams.get("status"),
        year:  url.searchParams.get("year")  ? Number(url.searchParams.get("year"))  : null,
        month: url.searchParams.get("month") ? Number(url.searchParams.get("month")) : null,
      });
      sendJson(response, 200, { items, total: items.length });
      return true;
    }
    if (method === "POST") {
      const body = await readJsonBody(request) as Parameters<typeof createTenantMonthlyReport>[1];
      sendJson(response, 201, await createTenantMonthlyReport(session, body));
      return true;
    }
  }

  const monthlyMatch = url.pathname.match(/^\/app\/pms\/monthly-reports\/([^/]+)(\/submit)?$/);
  if (monthlyMatch) {
    const id     = monthlyMatch[1]!;
    const isSubmit = !!monthlyMatch[2];
    const {
      getTenantMonthlyReport, updateTenantMonthlyReport, submitTenantMonthlyReport,
    } = await import("./monthly-reports-service");
    if (isSubmit && method === "POST") {
      sendJson(response, 200, await submitTenantMonthlyReport(session, id));
      return true;
    }
    if (!isSubmit) {
      if (method === "GET") {
        sendJson(response, 200, await getTenantMonthlyReport(session, id));
        return true;
      }
      if (method === "PATCH") {
        const body = await readJsonBody(request) as Parameters<typeof updateTenantMonthlyReport>[2];
        sendJson(response, 200, await updateTenantMonthlyReport(session, id, body));
        return true;
      }
    }
  }

  if (/^\/app\/pms\/spares\/[^/]+$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    if (method === "GET") {
      sendJson(response, 200, await getTenantSpare(session, id));
      return true;
    }
    if (method === "PATCH") {
      const body = await readJsonBody(request) as Parameters<typeof updateTenantSpare>[2];
      sendJson(response, 200, await updateTenantSpare(session, id, body));
      return true;
    }
    if (method === "DELETE") {
      await deleteTenantSpare(session, id);
      sendJson(response, 200, { ok: true });
      return true;
    }
  }

  if (method === "GET" && url.pathname === "/app/pms/stock-movements") {
    const items = await listTenantStockMovements(session, {
      vesselCode: url.searchParams.get("vesselCode"),
      movementType: url.searchParams.get("movementType"),
      spareId: url.searchParams.get("spareId"),
    });
    sendJson(response, 200, { items, total: items.length });
    return true;
  }

  if (method === "POST" && url.pathname === "/app/pms/stock-movements") {
    const body = await readJsonBody(request) as Parameters<typeof createStockMovement>[1];
    sendJson(response, 201, await createStockMovement(session, body));
    return true;
  }

  // ── Spare Requests ───────────────────────────────────────────────────────────

  if (method === "GET" && /^\/app\/pms\/spare-requests\/[^/]+\/pdf$/.test(url.pathname)) {
    enforceRateLimit(request, `pdf:${session.user.id}`, { maxRequests: 10, windowMs: 60_000 });
    const id = url.pathname.split("/")[4]!;
    const { buildSpareRequestPdf } = await import("./spare-request-pdf-service");
    const sr = await import("../spare-requests/spare-requests-service").then(m => m.getSpareRequest(session, id));
    const filename = `${sr!.requestCode}.pdf`;
    const buffer = await buildSpareRequestPdf(session, id);
    response.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": buffer.length,
    });
    response.end(buffer);
    return true;
  }

  if (method === "GET" && url.pathname === "/app/pms/spare-requests") {
    const items = await listSpareRequests(session, {
      status:     url.searchParams.get("status"),
      priority:   url.searchParams.get("priority"),
      vesselCode: url.searchParams.get("vesselCode"),
    });
    sendJson(response, 200, { items, total: items.length });
    return true;
  }

  if (method === "POST" && url.pathname === "/app/pms/spare-requests") {
    const body = await readJsonBody(request) as Parameters<typeof createSpareRequest>[1];
    sendJson(response, 201, await createSpareRequest(session, body));
    return true;
  }

  if (/^\/app\/pms\/spare-requests\/[^/]+$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    if (method === "GET")    { sendJson(response, 200, await getSpareRequest(session, id));    return true; }
    if (method === "PATCH")  { const body = await readJsonBody(request) as Parameters<typeof updateSpareRequest>[2]; sendJson(response, 200, await updateSpareRequest(session, id, body)); return true; }
    if (method === "DELETE") { await deleteSpareRequest(session, id); sendJson(response, 200, { ok: true }); return true; }
  }

  if (/^\/app\/pms\/spare-requests\/[^/]+\/submit$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    if (method === "POST") { sendJson(response, 200, await submitSpareRequest(session, id)); return true; }
  }

  if (/^\/app\/pms\/spare-requests\/[^/]+\/approve$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    if (method === "POST") { sendJson(response, 200, await approveSpareRequest(session, id)); return true; }
  }

  if (/^\/app\/pms\/spare-requests\/[^/]+\/reject$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    if (method === "POST") {
      const body = await readJsonBody(request) as { reason?: string };
      sendJson(response, 200, await rejectSpareRequest(session, id, body.reason ?? ""));
      return true;
    }
  }

  if (/^\/app\/pms\/spare-requests\/[^/]+\/cancel$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    if (method === "POST") { sendJson(response, 200, await cancelSpareRequest(session, id)); return true; }
  }

  if (/^\/app\/pms\/spare-requests\/[^/]+\/items$/.test(url.pathname)) {
    const requestId = url.pathname.split("/")[4]!;
    if (method === "GET")  { sendJson(response, 200, { items: await listRequestItems(session, requestId) }); return true; }
    if (method === "POST") { const body = await readJsonBody(request) as Parameters<typeof addRequestItem>[2]; sendJson(response, 201, await addRequestItem(session, requestId, body)); return true; }
  }

  if (/^\/app\/pms\/spare-requests\/[^/]+\/items\/[^/]+\/fulfill$/.test(url.pathname)) {
    const parts = url.pathname.split("/");
    const requestId = parts[4]!;
    const itemId    = parts[6]!;
    if (method === "POST") {
      const body = await readJsonBody(request) as { receivedAt?: string; receiptNotes?: string };
      sendJson(response, 200, await fulfillItem(session, requestId, itemId, body));
      return true;
    }
  }

  if (/^\/app\/pms\/spare-requests\/[^/]+\/items\/[^/]+$/.test(url.pathname)) {
    const parts = url.pathname.split("/");
    const requestId = parts[4]!;
    const itemId    = parts[6]!;
    if (method === "PATCH")  { const body = await readJsonBody(request) as Parameters<typeof updateRequestItem>[3]; sendJson(response, 200, await updateRequestItem(session, requestId, itemId, body)); return true; }
    if (method === "DELETE") { sendJson(response, 200, await deleteRequestItem(session, requestId, itemId)); return true; }
  }

  if (/^\/app\/pms\/spare-requests\/[^/]+\/reservations$/.test(url.pathname)) {
    const requestId = url.pathname.split("/")[4]!;
    if (method === "GET")  { sendJson(response, 200, { items: await listReservationsForRequest(session, requestId) }); return true; }
    if (method === "POST") { sendJson(response, 201, await createReservationsForRequest(session, requestId)); return true; }
  }

  if (/^\/app\/pms\/stock-reservations\/[^/]+\/release$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    if (method === "POST") { sendJson(response, 200, await releaseReservation(session, id)); return true; }
  }

  if (/^\/app\/pms\/stock-reservations\/[^/]+\/consume$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    if (method === "POST") { sendJson(response, 200, await consumeReservation(session, id)); return true; }
  }

  // ── Stock Locations ──────────────────────────────────────────────────────────

  if (method === "GET" && url.pathname === "/app/pms/stock-locations") {
    const isActiveParam = url.searchParams.get("isActive");
    const items = await listStockLocations(session, {
      vesselCode: url.searchParams.get("vesselCode"),
      isActive: isActiveParam !== null ? isActiveParam === "true" : undefined,
    });
    sendJson(response, 200, { items, total: items.length });
    return true;
  }

  if (method === "POST" && url.pathname === "/app/pms/stock-locations") {
    const body = await readJsonBody(request) as Parameters<typeof createStockLocation>[1];
    sendJson(response, 201, await createStockLocation(session, body));
    return true;
  }

  if (/^\/app\/pms\/stock-locations\/[^/]+$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    if (method === "GET") {
      sendJson(response, 200, await getStockLocation(session, id));
      return true;
    }
    if (method === "PATCH") {
      const body = await readJsonBody(request) as Parameters<typeof updateStockLocation>[2];
      sendJson(response, 200, await updateStockLocation(session, id, body));
      return true;
    }
    if (method === "DELETE") {
      await deleteStockLocation(session, id);
      sendJson(response, 200, { ok: true });
      return true;
    }
  }

  return false;
}
