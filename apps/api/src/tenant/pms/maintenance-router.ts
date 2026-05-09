import type { IncomingMessage, ServerResponse } from "node:http";
import type { AppEnv } from "../../config/env";
import { sendJson } from "../../http/json-response";
import { readJsonBody } from "../../http/read-json-body";
import { RouteError } from "../../http/route-error";
import { resolveTenantSlugFromRequest } from "../bootstrap/public-bootstrap-route";
import { requireTenantAccessSession } from "../auth/tenant-route-auth";
import { enforceRateLimit } from "../../http/rate-limiter";
import { log } from "../../common/logger";
import {
  completeChecklistPlan,
  createTenantMaintenancePlan,
  deleteTenantMaintenancePlan,
  generateUniqueTaskCode,
  getTenantMaintenancePlan,
  getTenantMaintenancePlansSummary,
  listTenantMaintenancePlans,
  openFormalWorkOrder,
  postponePlan,
  quickClosePlan,
  reportExecution,
  updateTenantMaintenancePlan,
} from "../maintenance-plans/maintenance-plans-service";
import {
  cancelWorkOrder,
  closeWorkOrder,
  createTenantWorkOrder,
  getTenantWorkOrder,
  holdWorkOrder,
  listTenantWorkOrders,
  startWorkOrder,
  updateTenantWorkOrder,
} from "../work-orders/work-orders-service";
import { createWorkLog, listWorkLogs } from "./work-logs-service";
import {
  suggestAcceptanceCriteria,
  suggestLoto,
  suggestRisk,
} from "../work-orders/work-orders-ai-suggestions";
import {
  suggestPlanAcceptanceCriteria,
  suggestPlanLoto,
  suggestPlanRisk,
} from "../maintenance-plans/maintenance-plans-ai-suggestions";
import { suggestPlanConsequence } from "../maintenance-plans/maintenance-plans-rcm-ai";
import { rewriteDeficiencies } from "../work-orders/work-orders-rewrite-ai";
import { saveChecklistDocument } from "./checklist-uploads-service";
import { buildWorkOrderPdf } from "./work-order-pdf-service";
import { buildMaintenancePlanPdf } from "./maintenance-plan-pdf-service";
import { buildOpenWorkOrdersReportPdf } from "./work-orders-open-report-pdf-service";

function requireTenantSlug(request: IncomingMessage, env: AppEnv): string {
  const slug = resolveTenantSlugFromRequest(request, env);
  if (!slug) throw new RouteError(400, "TENANT_UNRESOLVED", "Unable to resolve tenant.");
  return slug;
}

function enforceAuditorListOnly(method: string, path: string, role: string): void {
  if (role !== "AUDITOR_READONLY") return;
  const canListOnly =
    method === "GET" &&
    (path === "/app/pms/maintenance-plans" || path === "/app/pms/work-orders" || path === "/app/pms/work-logs");
  if (!canListOnly) {
    throw new RouteError(403, "FORBIDDEN", "AUDITOR_READONLY solo puede listar.");
  }
}

export async function handleMaintenanceRoutes(
  method: string,
  url: URL,
  request: IncomingMessage,
  response: ServerResponse,
  env: AppEnv,
): Promise<boolean> {
  const isMaintenancePath = url.pathname.startsWith("/app/pms/maintenance-plans");
  const isWorkOrdersPath = url.pathname.startsWith("/app/pms/work-orders");
  const isWorkLogsPath = url.pathname.startsWith("/app/pms/work-logs");
  log.debug(`[maintenance-router] ${method} ${url.pathname} | maint=${isMaintenancePath}`);
  if (!isMaintenancePath && !isWorkOrdersPath && !isWorkLogsPath) return false;

  const tenantSlug = requireTenantSlug(request, env);
  const session = requireTenantAccessSession(request, tenantSlug);
  enforceAuditorListOnly(method, url.pathname, session.user.role);

  if (method === "GET" && url.pathname === "/app/pms/maintenance-plans") {
    const items = await listTenantMaintenancePlans(session, {
      vesselCode: url.searchParams.get("vesselCode"),
      status: url.searchParams.get("status"),
      triggerType: url.searchParams.get("triggerType"),
      executionStatus: url.searchParams.get("executionStatus"),
      taskMasterId: url.searchParams.get("taskMasterId"),
    });
    sendJson(response, 200, { items, total: items.length });
    return true;
  }

  if (method === "GET" && url.pathname === "/app/pms/maintenance-plans/suggest-code") {
    const vc = url.searchParams.get("vesselCode");
    if (!vc) throw new RouteError(400, "MISSING_VESSEL_CODE", "vesselCode es requerido.");
    const sfiRaw = url.searchParams.get("sfiGroupNumber");
    const sfiGroupNumber = sfiRaw ? parseInt(sfiRaw, 10) : null;
    const code = await generateUniqueTaskCode(session, vc.toUpperCase(), sfiGroupNumber);
    sendJson(response, 200, { code });
    return true;
  }

  if (method === "POST" && url.pathname === "/app/pms/maintenance-plans") {
    const body = await readJsonBody(request) as Parameters<typeof createTenantMaintenancePlan>[1];
    sendJson(response, 201, await createTenantMaintenancePlan(session, body));
    return true;
  }

  if (method === "POST" && url.pathname === "/app/pms/maintenance-plans/suggest-acceptance-criteria") {
    enforceRateLimit(request, `ai:${session.user.id}`, { maxRequests: 30, windowMs: 60_000 });
    const body = await readJsonBody<Parameters<typeof suggestPlanAcceptanceCriteria>[1]>(request);
    sendJson(response, 200, await suggestPlanAcceptanceCriteria(session, body));
    return true;
  }

  if (method === "POST" && url.pathname === "/app/pms/maintenance-plans/suggest-loto") {
    enforceRateLimit(request, `ai:${session.user.id}`, { maxRequests: 30, windowMs: 60_000 });
    const body = await readJsonBody<Parameters<typeof suggestPlanLoto>[1]>(request);
    sendJson(response, 200, await suggestPlanLoto(session, body));
    return true;
  }

  if (method === "POST" && url.pathname === "/app/pms/maintenance-plans/suggest-risk") {
    enforceRateLimit(request, `ai:${session.user.id}`, { maxRequests: 30, windowMs: 60_000 });
    const body = await readJsonBody<Parameters<typeof suggestPlanRisk>[1]>(request);
    sendJson(response, 200, await suggestPlanRisk(session, body));
    return true;
  }

  if (method === "POST" && url.pathname === "/app/pms/maintenance-plans/suggest-consequence") {
    enforceRateLimit(request, `ai:${session.user.id}`, { maxRequests: 30, windowMs: 60_000 });
    const body = await readJsonBody<Parameters<typeof suggestPlanConsequence>[1]>(request);
    sendJson(response, 200, await suggestPlanConsequence(session, body));
    return true;
  }

  if (method === "POST" && url.pathname === "/app/pms/work-orders/suggest-consequence") {
    enforceRateLimit(request, `ai:${session.user.id}`, { maxRequests: 30, windowMs: 60_000 });
    const body = await readJsonBody<Parameters<typeof suggestPlanConsequence>[1]>(request);
    sendJson(response, 200, await suggestPlanConsequence(session, body));
    return true;
  }

  if (method === "POST" && url.pathname === "/app/pms/work-orders/rewrite-deficiencies") {
    enforceRateLimit(request, `ai:${session.user.id}`, { maxRequests: 30, windowMs: 60_000 });
    const body = await readJsonBody<Parameters<typeof rewriteDeficiencies>[1]>(request);
    sendJson(response, 200, await rewriteDeficiencies(session, body));
    return true;
  }

  if (method === "POST" && /^\/app\/pms\/maintenance-plans\/[^/]+\/quick-close$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    const body = await readJsonBody(request) as Parameters<typeof quickClosePlan>[2];
    sendJson(response, 200, await quickClosePlan(session, id, body));
    return true;
  }

  if (method === "POST" && /^\/app\/pms\/maintenance-plans\/[^/]+\/report-execution$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    const body = await readJsonBody(request) as Parameters<typeof reportExecution>[2];
    sendJson(response, 200, await reportExecution(session, id, body));
    return true;
  }

  if (method === "POST" && /^\/app\/pms\/maintenance-plans\/[^/]+\/postpone$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    const body = await readJsonBody(request) as Parameters<typeof postponePlan>[2];
    sendJson(response, 200, await postponePlan(session, id, body));
    return true;
  }

  if (method === "POST" && /^\/app\/pms\/maintenance-plans\/[^/]+\/complete-checklist$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    const body = await readJsonBody(request) as Parameters<typeof completeChecklistPlan>[2];
    sendJson(response, 200, await completeChecklistPlan(session, id, body));
    return true;
  }

  if (method === "POST" && /^\/app\/pms\/maintenance-plans\/[^/]+\/upload-checklist$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    const rawName = request.headers["x-filename"];
    const originalName = decodeURIComponent(Array.isArray(rawName) ? rawName[0] : rawName ?? "checklist");
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const buffer = Buffer.concat(chunks);
    if (!buffer.length) throw new RouteError(400, "EMPTY_BODY", "El archivo está vacío.");
    const { url: fileUrl, name } = await saveChecklistDocument(tenantSlug, originalName, buffer);
    await updateTenantMaintenancePlan(session, id, { checklistTemplate: fileUrl });
    sendJson(response, 200, { url: fileUrl, name });
    return true;
  }

  if (method === "POST" && /^\/app\/pms\/maintenance-plans\/[^/]+\/open-work-order$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    const body = await readJsonBody(request) as Parameters<typeof openFormalWorkOrder>[2];
    sendJson(response, 201, await openFormalWorkOrder(session, id, body));
    return true;
  }

  if (method === "GET" && /^\/app\/pms\/maintenance-plans\/[^/]+$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    sendJson(response, 200, await getTenantMaintenancePlan(session, id));
    return true;
  }

  if (method === "PATCH" && /^\/app\/pms\/maintenance-plans\/[^/]+$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    const body = await readJsonBody(request) as Parameters<typeof updateTenantMaintenancePlan>[2];
    sendJson(response, 200, await updateTenantMaintenancePlan(session, id, body));
    return true;
  }

  if (method === "DELETE" && /^\/app\/pms\/maintenance-plans\/[^/]+$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    const role = session.user.role;
    if (role !== "TENANT_ADMIN" && role !== "FLEET_SUPERINTENDENT") {
      throw new RouteError(403, "FORBIDDEN", "Solo ADMIN o Superintendente pueden eliminar planes.");
    }
    await deleteTenantMaintenancePlan(session, id);
    sendJson(response, 200, { ok: true });
    return true;
  }

  if (method === "GET" && url.pathname === "/app/pms/work-orders") {
    const items = await listTenantWorkOrders(session, {
      vesselCode: url.searchParams.get("vesselCode"),
      status: url.searchParams.get("status"),
      type: url.searchParams.get("type"),
      priority: url.searchParams.get("priority"),
      assignedToUserId: url.searchParams.get("assignedToUserId"),
    });
    sendJson(response, 200, { items, total: items.length });
    return true;
  }

  if (method === "POST" && url.pathname === "/app/pms/work-orders") {
    const body = await readJsonBody(request) as Parameters<typeof createTenantWorkOrder>[1];
    sendJson(response, 201, await createTenantWorkOrder(session, body));
    return true;
  }

  if (method === "POST" && url.pathname === "/app/pms/work-orders/suggest-acceptance-criteria") {
    enforceRateLimit(request, `ai:${session.user.id}`, { maxRequests: 30, windowMs: 60_000 });
    const body = await readJsonBody<{ assetLabel?: string; taskDesc?: string }>(request);
    sendJson(response, 200, await suggestAcceptanceCriteria(session, body));
    return true;
  }

  if (method === "POST" && url.pathname === "/app/pms/work-orders/suggest-loto") {
    enforceRateLimit(request, `ai:${session.user.id}`, { maxRequests: 30, windowMs: 60_000 });
    const body = await readJsonBody<{ assetLabel?: string; taskDesc?: string; acceptanceCriteria?: string }>(request);
    sendJson(response, 200, await suggestLoto(session, body));
    return true;
  }

  if (method === "POST" && url.pathname === "/app/pms/work-orders/suggest-risk") {
    enforceRateLimit(request, `ai:${session.user.id}`, { maxRequests: 30, windowMs: 60_000 });
    const body = await readJsonBody<{ assetLabel?: string; taskDesc?: string; acceptanceCriteria?: string; loto?: string }>(request);
    sendJson(response, 200, await suggestRisk(session, body));
    return true;
  }

  if (method === "POST" && /^\/app\/pms\/work-orders\/[^/]+\/start$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    sendJson(response, 200, await startWorkOrder(session, id));
    return true;
  }

  if (method === "POST" && /^\/app\/pms\/work-orders\/[^/]+\/hold$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    const body = await readJsonBody(request) as Parameters<typeof holdWorkOrder>[2];
    sendJson(response, 200, await holdWorkOrder(session, id, body));
    return true;
  }

  if (method === "POST" && /^\/app\/pms\/work-orders\/[^/]+\/close$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    const body = await readJsonBody(request) as Parameters<typeof closeWorkOrder>[2];
    sendJson(response, 200, await closeWorkOrder(session, id, body));
    return true;
  }

  if (method === "POST" && /^\/app\/pms\/work-orders\/[^/]+\/cancel$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    const body = await readJsonBody(request) as Parameters<typeof cancelWorkOrder>[2];
    sendJson(response, 200, await cancelWorkOrder(session, id, body));
    return true;
  }

  if (method === "GET" && /^\/app\/pms\/maintenance-plans\/[^/]+\/pdf$/.test(url.pathname)) {
    enforceRateLimit(request, `pdf:${session.user.id}`, { maxRequests: 10, windowMs: 60_000 });
    const id = url.pathname.split("/")[4]!;
    const plan = await getTenantMaintenancePlan(session, id);
    const filename = `${(plan as any).taskCode ?? id}.pdf`;
    const buffer = await buildMaintenancePlanPdf(session, id);
    response.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": buffer.length,
    });
    response.end(buffer);
    return true;
  }

  if (method === "GET" && url.pathname === "/app/pms/work-orders/open-report.pdf") {
    enforceRateLimit(request, `pdf:${session.user.id}`, { maxRequests: 10, windowMs: 60_000 });
    const vesselCode = url.searchParams.get("vesselCode")?.trim() || null;
    const buffer = await buildOpenWorkOrdersReportPdf(session, { vesselCode });
    const today = new Date().toISOString().slice(0, 10);
    const filename = vesselCode ? `OTs-Abiertas-${vesselCode}-${today}.pdf` : `OTs-Abiertas-${today}.pdf`;
    response.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": buffer.length,
    });
    response.end(buffer);
    return true;
  }

  if (method === "GET" && /^\/app\/pms\/work-orders\/[^/]+\/pdf$/.test(url.pathname)) {
    enforceRateLimit(request, `pdf:${session.user.id}`, { maxRequests: 10, windowMs: 60_000 });
    const id = url.pathname.split("/")[4]!;
    const wo = await getTenantWorkOrder(session, id);
    const filename = `${wo.workOrderCode}.pdf`;
    const buffer = await buildWorkOrderPdf(session, id);
    response.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": buffer.length,
    });
    response.end(buffer);
    return true;
  }

  if (/^\/app\/pms\/work-orders\/[^/]+$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    if (method === "GET") {
      sendJson(response, 200, await getTenantWorkOrder(session, id));
      return true;
    }
    if (method === "PATCH") {
      const body = await readJsonBody(request) as Parameters<typeof updateTenantWorkOrder>[2];
      sendJson(response, 200, await updateTenantWorkOrder(session, id, body));
      return true;
    }
  }

  if (method === "GET" && url.pathname === "/app/pms/work-logs") {
    const items = await listWorkLogs(session, {
      vesselCode: url.searchParams.get("vesselCode"),
      workOrderId: url.searchParams.get("workOrderId"),
      maintenancePlanId: url.searchParams.get("maintenancePlanId"),
      taskType: url.searchParams.get("taskType"),
      result: url.searchParams.get("result"),
    });
    sendJson(response, 200, { items, total: items.length });
    return true;
  }

  if (method === "POST" && url.pathname === "/app/pms/work-logs") {
    const body = await readJsonBody(request) as Parameters<typeof createWorkLog>[1];
    sendJson(response, 201, await createWorkLog(session, body));
    return true;
  }

  return false;
}
