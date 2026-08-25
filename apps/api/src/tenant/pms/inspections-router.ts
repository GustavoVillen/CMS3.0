import type { IncomingMessage, ServerResponse } from "node:http";
import type { AppEnv } from "../../config/env";
import { sendJson } from "../../http/json-response";
import { readJsonBody } from "../../http/read-json-body";
import { RouteError } from "../../http/route-error";
import { resolveTenantSlugFromRequest } from "../bootstrap/public-bootstrap-route";
import { requireTenantAccessSession } from "../auth/tenant-route-auth";
import {
  createInspectionTemplate,
  getInspectionTemplate,
  listInspectionTemplates,
  updateInspectionTemplate,
} from "./inspection-templates-service";
import {
  cancelInspectionExecution,
  completeInspectionExecution,
  createInspectionExecution,
  getInspectionExecution,
  listInspectionExecutions,
  startInspectionExecution,
  submitInspectionResults,
} from "./inspection-executions-service";
import { buildInspectionExecutionPdf } from "./inspection-execution-pdf-service";

function requireTenantSlug(request: IncomingMessage, env: AppEnv): string {
  const slug = resolveTenantSlugFromRequest(request, env);
  if (!slug) throw new RouteError(400, "TENANT_UNRESOLVED", "Unable to resolve tenant.");
  return slug;
}

export async function handleInspectionsRoutes(
  method: string,
  url: URL,
  request: IncomingMessage,
  response: ServerResponse,
  env: AppEnv,
): Promise<boolean> {
  const isTemplatePath = url.pathname.startsWith("/app/pms/inspection-templates");
  const isExecutionPath = url.pathname.startsWith("/app/pms/inspections");
  if (!isTemplatePath && !isExecutionPath) return false;

  const tenantSlug = requireTenantSlug(request, env);
  const session = requireTenantAccessSession(request, tenantSlug);

  if (method === "GET" && url.pathname === "/app/pms/inspection-templates") {
    const items = await listInspectionTemplates(session, {
      equipmentClassId: url.searchParams.get("equipmentClassId"),
      sfiCode: url.searchParams.get("sfiCode"),
      triggerType: url.searchParams.get("triggerType"),
      status: url.searchParams.get("status"),
    });
    sendJson(response, 200, { items, total: items.length });
    return true;
  }

  if (method === "POST" && url.pathname === "/app/pms/inspection-templates") {
    const body = await readJsonBody(request) as Parameters<typeof createInspectionTemplate>[1];
    const created = await createInspectionTemplate(session, body);
    sendJson(response, 201, created);
    return true;
  }

  if (/^\/app\/pms\/inspection-templates\/[^/]+$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    if (method === "GET") {
      sendJson(response, 200, await getInspectionTemplate(session, id));
      return true;
    }
    if (method === "PATCH") {
      const body = await readJsonBody(request) as Parameters<typeof updateInspectionTemplate>[2];
      sendJson(response, 200, await updateInspectionTemplate(session, id, body));
      return true;
    }
  }

  if (method === "GET" && url.pathname === "/app/pms/inspections") {
    const items = await listInspectionExecutions(session, {
      vesselCode: url.searchParams.get("vesselCode"),
      status: url.searchParams.get("status"),
      result: url.searchParams.get("result"),
      templateId: url.searchParams.get("templateId"),
    });
    sendJson(response, 200, { items, total: items.length });
    return true;
  }

  if (method === "POST" && url.pathname === "/app/pms/inspections") {
    const body = await readJsonBody(request) as Parameters<typeof createInspectionExecution>[1];
    sendJson(response, 201, await createInspectionExecution(session, body));
    return true;
  }

  if (method === "POST" && /^\/app\/pms\/inspections\/[^/]+\/start$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    sendJson(response, 200, await startInspectionExecution(session, id));
    return true;
  }

  if (method === "POST" && /^\/app\/pms\/inspections\/[^/]+\/results$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    const body = await readJsonBody(request) as Parameters<typeof submitInspectionResults>[2];
    sendJson(response, 200, await submitInspectionResults(session, id, body));
    return true;
  }

  if (method === "POST" && /^\/app\/pms\/inspections\/[^/]+\/complete$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    const body = await readJsonBody(request) as Parameters<typeof completeInspectionExecution>[2];
    sendJson(response, 200, await completeInspectionExecution(session, id, body));
    return true;
  }

  if (method === "POST" && /^\/app\/pms\/inspections\/[^/]+\/cancel$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    sendJson(response, 200, await cancelInspectionExecution(session, id));
    return true;
  }

  if (method === "GET" && /^\/app\/pms\/inspections\/[^/]+\/pdf$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    const exec = await getInspectionExecution(session, id) as unknown as { executionCode: string; vesselCode: string };
    const buffer = await buildInspectionExecutionPdf(session, id);
    response.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${exec.executionCode}-${exec.vesselCode}.pdf"`,
      "Content-Length": buffer.length,
    });
    response.end(buffer);
    return true;
  }

  if (method === "GET" && /^\/app\/pms\/inspections\/[^/]+$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    sendJson(response, 200, await getInspectionExecution(session, id));
    return true;
  }

  return false;
}
