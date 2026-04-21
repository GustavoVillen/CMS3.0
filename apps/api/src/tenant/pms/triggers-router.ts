import type { IncomingMessage, ServerResponse } from "node:http";
import type { AppEnv } from "../../config/env";
import { sendJson } from "../../http/json-response";
import { readJsonBody } from "../../http/read-json-body";
import { RouteError } from "../../http/route-error";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { resolveTenantSlugFromRequest } from "../bootstrap/public-bootstrap-route";
import { requireTenantAccessSession } from "../auth/tenant-route-auth";
import { createTaskMaster, getTaskMaster, listTaskMasters, updateTaskMaster } from "./task-masters-service";
import { openExecutionWindow, refreshExecutionStatuses } from "./execution-windows-service";
import { getDueItemsSummary, listDueItems } from "./due-items-service";

function requireTenantSlug(request: IncomingMessage, env: AppEnv): string {
  const slug = resolveTenantSlugFromRequest(request, env);
  if (!slug) throw new RouteError(400, "TENANT_UNRESOLVED", "Unable to resolve tenant.");
  return slug;
}

function enforceAuditorReadOnly(method: string, role: string) {
  if (role === "AUDITOR_READONLY" && method !== "GET") {
    throw new RouteError(403, "FORBIDDEN", "AUDITOR_READONLY solo puede realizar lecturas.");
  }
}

function parseOptionalNumber(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new RouteError(400, "VALIDATION_ERROR", `${field} debe ser numérico.`);
}

async function requireTenantId(tenantSlug: string): Promise<string> {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");
  return tenant.id;
}

export async function handleTriggersRoutes(
  method: string,
  url: URL,
  request: IncomingMessage,
  response: ServerResponse,
  env: AppEnv,
): Promise<boolean> {
  const isTaskMastersPath = url.pathname.startsWith("/app/pms/task-masters");
  const isExecutionWindowsPath = url.pathname.startsWith("/app/pms/execution-windows");
  const isDueItemsPath = url.pathname.startsWith("/app/pms/due-items");
  if (!isTaskMastersPath && !isExecutionWindowsPath && !isDueItemsPath) return false;

  const tenantSlug = requireTenantSlug(request, env);
  const session = requireTenantAccessSession(request, tenantSlug);
  enforceAuditorReadOnly(method, session.user.role);

  if (method === "GET" && url.pathname === "/app/pms/task-masters") {
    const items = await listTaskMasters(session, {
      taskType: url.searchParams.get("taskType"),
      triggerType: url.searchParams.get("triggerType"),
      status: url.searchParams.get("status"),
    });
    sendJson(response, 200, { items, total: items.length });
    return true;
  }

  if (method === "POST" && url.pathname === "/app/pms/task-masters") {
    const body = await readJsonBody(request) as Parameters<typeof createTaskMaster>[1];
    const created = await createTaskMaster(session, body);
    sendJson(response, 201, created);
    return true;
  }

  if (/^\/app\/pms\/task-masters\/[^/]+$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    if (method === "GET") {
      sendJson(response, 200, await getTaskMaster(id));
      return true;
    }
    if (method === "PATCH") {
      const body = await readJsonBody(request) as Parameters<typeof updateTaskMaster>[2];
      sendJson(response, 200, await updateTaskMaster(session, id, body));
      return true;
    }
  }

  if (method === "POST" && url.pathname === "/app/pms/execution-windows/refresh") {
    const body = await readJsonBody(request) as { currentHours?: unknown };
    const tenantId = await requireTenantId(tenantSlug);
    const updated = await refreshExecutionStatuses(tenantId, parseOptionalNumber(body.currentHours, "currentHours"));
    sendJson(response, 200, { updated });
    return true;
  }

  if (method === "POST" && /^\/app\/pms\/execution-windows\/[^/]+\/open$/.test(url.pathname)) {
    const planId = url.pathname.split("/")[4]!;
    const body = await readJsonBody(request) as { windowOpenDate?: string | Date | null; windowOpenHours?: number | null };
    const updated = await openExecutionWindow(session, planId, body);
    sendJson(response, 200, updated);
    return true;
  }

  if (method === "GET" && url.pathname === "/app/pms/due-items/summary") {
    const summary = await getDueItemsSummary(session, url.searchParams.get("vesselCode"));
    sendJson(response, 200, summary);
    return true;
  }

  if (method === "GET" && url.pathname === "/app/pms/due-items") {
    const items = await listDueItems(session, {
      vesselCode: url.searchParams.get("vesselCode"),
      triggerType: url.searchParams.get("triggerType"),
      executionStatus: url.searchParams.get("executionStatus"),
      assetId: url.searchParams.get("assetId"),
    });
    sendJson(response, 200, { items, total: items.length });
    return true;
  }

  return false;
}
