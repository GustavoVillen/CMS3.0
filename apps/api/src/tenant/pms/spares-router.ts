import type { IncomingMessage, ServerResponse } from "node:http";
import type { AppEnv } from "../../config/env";
import { sendJson } from "../../http/json-response";
import { readJsonBody } from "../../http/read-json-body";
import { RouteError } from "../../http/route-error";
import { resolveTenantSlugFromRequest } from "../bootstrap/public-bootstrap-route";
import { requireTenantAccessSession } from "../auth/tenant-route-auth";
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
  createSpareOrder,
  deleteSpareOrder,
  getTenantSpareOrder,
  listTenantSpareOrders,
  updateSpareOrder,
} from "../spare-orders/spare-orders-service";
import {
  addOrderLine,
  deleteOrderLine,
  listOrderLines,
  updateOrderLine,
} from "../spare-orders/spare-order-lines-service";

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
  if (!url.pathname.startsWith("/app/pms/spares") && !url.pathname.startsWith("/app/pms/stock-movements") && !url.pathname.startsWith("/app/pms/spare-orders")) {
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

  if (method === "GET" && url.pathname === "/app/pms/spare-orders") {
    const items = await listTenantSpareOrders(session, {
      vesselCode: url.searchParams.get("vesselCode"),
      status: url.searchParams.get("status"),
      priority: url.searchParams.get("priority"),
    });
    sendJson(response, 200, { items, total: items.length });
    return true;
  }

  if (method === "POST" && url.pathname === "/app/pms/spare-orders") {
    const body = await readJsonBody(request) as Parameters<typeof createSpareOrder>[1];
    sendJson(response, 201, await createSpareOrder(session, body));
    return true;
  }

  if (/^\/app\/pms\/spare-orders\/[^/]+$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    if (method === "GET") {
      sendJson(response, 200, await getTenantSpareOrder(session, id));
      return true;
    }
    if (method === "PATCH") {
      const body = await readJsonBody(request) as Parameters<typeof updateSpareOrder>[2];
      sendJson(response, 200, await updateSpareOrder(session, id, body));
      return true;
    }
    if (method === "DELETE") {
      await deleteSpareOrder(session, id);
      sendJson(response, 200, { ok: true });
      return true;
    }
  }

  if (/^\/app\/pms\/spare-orders\/[^/]+\/lines$/.test(url.pathname)) {
    const orderId = url.pathname.split("/")[4]!;
    if (method === "GET") {
      const items = await listOrderLines(session, orderId);
      sendJson(response, 200, { items, total: items.length });
      return true;
    }
    if (method === "POST") {
      const body = await readJsonBody(request) as Parameters<typeof addOrderLine>[2];
      sendJson(response, 201, await addOrderLine(session, orderId, body));
      return true;
    }
  }

  if (/^\/app\/pms\/spare-orders\/[^/]+\/lines\/[^/]+$/.test(url.pathname)) {
    const parts = url.pathname.split("/");
    const orderId = parts[4]!;
    const lineId  = parts[6]!;
    if (method === "PATCH") {
      const body = await readJsonBody(request) as Parameters<typeof updateOrderLine>[3];
      sendJson(response, 200, await updateOrderLine(session, orderId, lineId, body));
      return true;
    }
    if (method === "DELETE") {
      sendJson(response, 200, await deleteOrderLine(session, orderId, lineId));
      return true;
    }
  }

  return false;
}
