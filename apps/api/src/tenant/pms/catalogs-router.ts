import type { IncomingMessage, ServerResponse } from "node:http";
import type { AppEnv } from "../../config/env";
import { sendJson } from "../../http/json-response";
import { readJsonBody } from "../../http/read-json-body";
import { RouteError } from "../../http/route-error";
import { resolveTenantSlugFromRequest } from "../bootstrap/public-bootstrap-route";
import { requireTenantAccessSession } from "../auth/tenant-route-auth";
import {
  createEquipmentClass,
  getEquipmentClass,
  listEquipmentClasses,
  updateEquipmentClass,
} from "./equipment-classes-service";
import {
  addClassTaskTemplate,
  instantiateClassPlans,
  listClassTaskTemplates,
  removeClassTaskTemplate,
} from "./class-plans-service";

function requireTenantSlug(request: IncomingMessage, env: AppEnv): string {
  const slug = resolveTenantSlugFromRequest(request, env);
  if (!slug) throw new RouteError(400, "TENANT_UNRESOLVED", "Unable to resolve tenant.");
  return slug;
}

function enforceAuditorMutations(method: string, role: string) {
  if (role === "AUDITOR_READONLY" && method !== "GET") {
    throw new RouteError(403, "FORBIDDEN", "AUDITOR_READONLY solo puede listar.");
  }
}

function readRequiredId(value: unknown, field: string): string {
  const text = String(value ?? "").trim();
  if (!text) throw new RouteError(400, "VALIDATION_ERROR", `El campo ${field} es requerido.`);
  return text;
}

export async function handleCatalogsRoutes(
  method: string,
  url: URL,
  request: IncomingMessage,
  response: ServerResponse,
  env: AppEnv,
): Promise<boolean> {
  const isEquipmentClassesPath = url.pathname.startsWith("/app/pms/equipment-classes");
  const isClassPlansPath = url.pathname.startsWith("/app/pms/class-plans");
  if (!isEquipmentClassesPath && !isClassPlansPath) return false;

  const tenantSlug = requireTenantSlug(request, env);
  const session = requireTenantAccessSession(request, tenantSlug);
  enforceAuditorMutations(method, session.user.role);

  if (method === "GET" && url.pathname === "/app/pms/equipment-classes") {
    const items = await listEquipmentClasses(session, {
      status: url.searchParams.get("status"),
    });
    sendJson(response, 200, { items, total: items.length });
    return true;
  }

  if (method === "POST" && url.pathname === "/app/pms/equipment-classes") {
    const body = await readJsonBody(request) as Parameters<typeof createEquipmentClass>[1];
    sendJson(response, 201, await createEquipmentClass(session, body));
    return true;
  }

  if (method === "GET" && /^\/app\/pms\/equipment-classes\/[^/]+\/task-templates$/.test(url.pathname)) {
    const equipmentClassId = url.pathname.split("/")[4]!;
    const items = await listClassTaskTemplates(session, equipmentClassId);
    sendJson(response, 200, { items, total: items.length });
    return true;
  }

  if (method === "POST" && /^\/app\/pms\/equipment-classes\/[^/]+\/task-templates$/.test(url.pathname)) {
    const equipmentClassId = url.pathname.split("/")[4]!;
    const body = await readJsonBody(request) as { taskMasterId?: unknown };
    const taskMasterId = readRequiredId(body.taskMasterId, "taskMasterId");
    sendJson(response, 201, await addClassTaskTemplate(session, equipmentClassId, taskMasterId));
    return true;
  }

  if (method === "DELETE" && /^\/app\/pms\/equipment-classes\/[^/]+\/task-templates\/[^/]+$/.test(url.pathname)) {
    const parts = url.pathname.split("/");
    const equipmentClassId = parts[4]!;
    const taskMasterId = parts[6]!;
    sendJson(response, 200, await removeClassTaskTemplate(session, equipmentClassId, taskMasterId));
    return true;
  }

  if (/^\/app\/pms\/equipment-classes\/[^/]+$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    if (method === "GET") {
      sendJson(response, 200, await getEquipmentClass(session, id));
      return true;
    }
    if (method === "PATCH") {
      const body = await readJsonBody(request) as Parameters<typeof updateEquipmentClass>[2];
      sendJson(response, 200, await updateEquipmentClass(session, id, body));
      return true;
    }
  }

  if (method === "POST" && url.pathname === "/app/pms/class-plans/instantiate") {
    const body = await readJsonBody(request) as { assetId?: unknown };
    const assetId = readRequiredId(body.assetId, "assetId");
    sendJson(response, 200, await instantiateClassPlans(session, assetId));
    return true;
  }

  return false;
}
