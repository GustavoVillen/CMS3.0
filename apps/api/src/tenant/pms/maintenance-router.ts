import type { IncomingMessage, ServerResponse } from "node:http";
import type { AppEnv } from "../../config/env";
import { sendJson } from "../../http/json-response";
import { readJsonBody } from "../../http/read-json-body";
import { readBinaryBody } from "../../http/read-binary-body";
import { RouteError } from "../../http/route-error";
import { resolveTenantSlugFromRequest } from "../bootstrap/public-bootstrap-route";
import { requireTenantAccessSession } from "../auth/tenant-route-auth";
import { enforceRateLimit } from "../../http/rate-limiter";
import { log } from "../../common/logger";
import {
  completeChecklistPlan,
  createTenantMaintenancePlan,
  deleteTenantMaintenancePlan,
  ensureCanManagePlans,
  generateUniqueTaskCode,
  getTenantMaintenancePlan,
  getTenantMaintenancePlansSummary,
  listPlanExecutions,
  listTenantMaintenancePlans,
  openFormalWorkOrder,
  postponePlan,
  previewMergedPlanText,
  quickClosePlan,
  reportExecution,
  updatePlanExecution,
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
  setWorkOrderType,
  reopenWorkOrder,
  resumeWorkOrder,
  setWorkOrderApproval,
} from "../work-orders/work-orders-service";
import {
  createServiceRequestForWorkOrder,
  listWorkOrderServiceRequests,
} from "../service-requests/service-requests-service";
import {
  createWorkOrderItem,
  deleteWorkOrderItem,
  listWorkOrderItems,
  updateWorkOrderItem,
} from "../work-orders/work-order-items-service";
import {
  addPlanToWorkOrder,
  listTenantWorkOrderPlans,
  removePlanFromWorkOrder,
} from "../work-orders/work-order-plans-service";
import {
  createWorkOrderScheduleEntry,
  deleteWorkOrderScheduleEntry,
  listWorkOrderSchedule,
  updateWorkOrderScheduleEntry,
} from "../work-orders/work-order-schedule-service";
import {
  createProgressNote,
  listProgressNotes,
  updateProgressNote,
  deleteProgressNote,
} from "../work-orders/work-order-progress-notes-service";
import { createWorkLog, listWorkLogs } from "./work-logs-service";
import {
  suggestTitle,
  suggestAcceptanceCriteria,
  suggestTaskSteps,
  suggestLoto,
  suggestRisk,
  suggestAsset,
  suggestPlanLinks,
} from "../work-orders/work-orders-ai-suggestions";
import { extractWorkOrderScan } from "../work-orders/work-orders-ai-extractor";
import { saveWorkOrderScanFile } from "../work-orders/work-order-scan-uploads-service";
import {
  suggestPlanAcceptanceCriteria,
  suggestPlanLoto,
  suggestPlanRisk,
} from "../maintenance-plans/maintenance-plans-ai-suggestions";
import { suggestPlanConsequence } from "../maintenance-plans/maintenance-plans-rcm-ai";
import { rewriteDeficiencies } from "../work-orders/work-orders-rewrite-ai";
import { saveChecklistDocument } from "./checklist-uploads-service";
import { buildWorkOrderPdf, buildWorkOrderDoc } from "./work-order-pdf-service";
import { serveDoc } from "./doc-export";
import { buildMaintenancePlanPdf } from "./maintenance-plan-pdf-service";
import { buildDueSoonPlansXlsx } from "./maintenance-plans-due-excel-service";
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
      taskType: url.searchParams.get("taskType"),
      triggerType: url.searchParams.get("triggerType"),
      triggerTypeNot: url.searchParams.get("triggerTypeNot"),
      executionStatus: url.searchParams.get("executionStatus"),
      taskMasterId: url.searchParams.get("taskMasterId"),
      assetId: url.searchParams.get("assetId"),
    });
    // La LISTA no muestra los campos de texto pesados (LOTO, criterios de
    // aceptación, análisis de riesgo, justificación de consecuencia): son ~60%
    // del payload y solo se ven en el detalle/modal, que refetchea el plan
    // completo por id. Los quitamos de la respuesta de lista para que "Todos
    // los buques" (1000+ planes) no transfiera varios MB. `description` se
    // conserva porque el buscador de la lista filtra por él.
    const light = items.map((p) => {
      const { loto, acceptanceCriteria, riskAnalysisResult, consequenceRationale, ...rest } =
        p as Record<string, unknown>;
      void loto; void acceptanceCriteria; void riskAnalysisResult; void consequenceRationale;
      return rest;
    });
    sendJson(response, 200, { items: light, total: light.length }, request);
    return true;
  }

  // Reporte Excel de planes PRÓXIMOS A VENCER (vencidos / por vencer / en ventana).
  // Debe ir ANTES de la ruta genérica /maintenance-plans/:id para no ser capturada por ella.
  if (method === "GET" && url.pathname === "/app/pms/maintenance-plans/due-soon.xlsx") {
    enforceRateLimit(request, `xlsx:${session.user.id}`, { maxRequests: 10, windowMs: 60_000 });
    const vesselCode = url.searchParams.get("vesselCode")?.trim() || null;
    const buffer = await buildDueSoonPlansXlsx(session, { vesselCode });
    const today = new Date().toISOString().slice(0, 10);
    const filename = vesselCode
      ? `Planes-Proximos-Vencer-${vesselCode}-${today}.xlsx`
      : `Planes-Proximos-Vencer-${today}.xlsx`;
    response.writeHead(200, {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": buffer.length,
    });
    response.end(buffer);
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
    ensureCanManagePlans(session);
    enforceRateLimit(request, `ai:${session.user.id}`, { maxRequests: 30, windowMs: 60_000 });
    const body = await readJsonBody<Parameters<typeof suggestPlanAcceptanceCriteria>[1]>(request);
    sendJson(response, 200, await suggestPlanAcceptanceCriteria(session, body));
    return true;
  }

  if (method === "POST" && url.pathname === "/app/pms/maintenance-plans/suggest-loto") {
    ensureCanManagePlans(session);
    enforceRateLimit(request, `ai:${session.user.id}`, { maxRequests: 30, windowMs: 60_000 });
    const body = await readJsonBody<Parameters<typeof suggestPlanLoto>[1]>(request);
    sendJson(response, 200, await suggestPlanLoto(session, body));
    return true;
  }

  if (method === "POST" && url.pathname === "/app/pms/maintenance-plans/suggest-risk") {
    ensureCanManagePlans(session);
    enforceRateLimit(request, `ai:${session.user.id}`, { maxRequests: 30, windowMs: 60_000 });
    const body = await readJsonBody<Parameters<typeof suggestPlanRisk>[1]>(request);
    sendJson(response, 200, await suggestPlanRisk(session, body));
    return true;
  }

  if (method === "POST" && url.pathname === "/app/pms/maintenance-plans/suggest-consequence") {
    ensureCanManagePlans(session);
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
    const buffer = await readBinaryBody(request);
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

  // Historial de ejecuciones del plan (OTs). Debe ir ANTES de la ruta genérica
  // /maintenance-plans/:id para no ser capturada por ella.
  if (method === "GET" && /^\/app\/pms\/maintenance-plans\/[^/]+\/executions$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    const items = await listPlanExecutions(session, id);
    sendJson(response, 200, { items, total: items.length });
    return true;
  }

  if (method === "PATCH" && /^\/app\/pms\/maintenance-plans\/[^/]+\/executions\/[^/]+$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    const woId = url.pathname.split("/")[6]!;
    const body = await readJsonBody(request) as Parameters<typeof updatePlanExecution>[3];
    const items = await updatePlanExecution(session, id, woId, body);
    sendJson(response, 200, { items, total: items.length });
    return true;
  }

  // ANTES del GET por id: "merged-text" no es un id de plan y esa ruta lo
  // capturaría. Devuelve los textos combinados de varios ítems del PDM para que
  // el formulario de Nueva OT muestre lo mismo que se va a guardar.
  if (method === "GET" && url.pathname === "/app/pms/maintenance-plans/merged-text") {
    const ids = (url.searchParams.get("ids") ?? "").split(",").map(s => s.trim()).filter(Boolean);
    if (ids.length === 0) {
      sendJson(response, 400, { error: { code: "VALIDATION_ERROR", message: "Se requiere al menos un plan." } });
      return true;
    }
    sendJson(response, 200, await previewMergedPlanText(session, ids));
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
      assetId: url.searchParams.get("assetId"),
    });
    sendJson(response, 200, { items, total: items.length });
    return true;
  }

  if (method === "POST" && url.pathname === "/app/pms/work-orders") {
    const body = await readJsonBody(request) as Parameters<typeof createTenantWorkOrder>[1];
    sendJson(response, 201, await createTenantWorkOrder(session, body));
    return true;
  }

  // Sugerir el título a partir del equipo y la tarea ya cargada (si hay).
  if (method === "POST" && url.pathname === "/app/pms/work-orders/suggest-title") {
    enforceRateLimit(request, `ai:${session.user.id}`, { maxRequests: 30, windowMs: 60_000 });
    const body = await readJsonBody<{ assetLabel?: string; taskDesc?: string }>(request);
    sendJson(response, 200, await suggestTitle(session, body));
    return true;
  }

  // Sugerir las tareas a ejecutar a partir del equipo y el titulo de la OT.
  if (method === "POST" && url.pathname === "/app/pms/work-orders/suggest-task") {
    enforceRateLimit(request, `ai:${session.user.id}`, { maxRequests: 30, windowMs: 60_000 });
    const body = await readJsonBody<{ assetLabel?: string; taskDesc?: string; existingTasks?: string }>(request);
    sendJson(response, 200, await suggestTaskSteps(session, body));
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

  if (method === "POST" && url.pathname === "/app/pms/work-orders/suggest-asset") {
    enforceRateLimit(request, `ai:${session.user.id}`, { maxRequests: 30, windowMs: 60_000 });
    const body = await readJsonBody<{ taskDesc?: string; assets?: Array<{ id: string; code?: string; name?: string }> }>(request);
    sendJson(response, 200, await suggestAsset(session, body));
    return true;
  }

  // Sugerir a que item(s) del plan de mantenimiento del mismo equipo podria
  // corresponder esta OT recien creada, para ofrecer vincularla (y asi acreditar
  // el plan al cerrarla). Solo sugiere: el vinculo real se crea via POST a
  // /app/pms/work-orders/:id/plans cuando el usuario confirma en el popup.
  if (method === "POST" && url.pathname === "/app/pms/work-orders/suggest-plan-links") {
    enforceRateLimit(request, `ai:${session.user.id}`, { maxRequests: 30, windowMs: 60_000 });
    const body = await readJsonBody<{
      assetLabel?: string; title?: string; taskDesc?: string;
      plans?: Array<{ id: string; taskCode?: string; title?: string; triggerType?: string; nextDueDate?: string; nextDueHours?: number; executionStatus?: string }>;
    }>(request);
    sendJson(response, 200, await suggestPlanLinks(session, body));
    return true;
  }

  // Escanear una OT llenada a mano en papel (foto/PDF) y extraer los campos
  // del formulario de creación. No guarda la OT: el usuario revisa/corrige y
  // confirma con el botón Guardar de siempre.
  if (method === "POST" && url.pathname === "/app/pms/work-orders/extract-scan") {
    enforceRateLimit(request, `ai-extract:${session.user.id}`, { maxRequests: 15, windowMs: 60_000 });
    const rawName = request.headers["x-filename"];
    const originalName = decodeURIComponent(Array.isArray(rawName) ? rawName[0]! : rawName ?? "ot-escaneada");
    const rawVessel = request.headers["x-vessel-code"];
    const vesselCode = (Array.isArray(rawVessel) ? rawVessel[0] : rawVessel) ?? null;
    const buffer = await readBinaryBody(request);
    if (!buffer.length) throw new RouteError(400, "EMPTY_BODY", "El archivo está vacío.");
    const saved = await saveWorkOrderScanFile(session.tenantSlug, originalName, buffer);
    const extracted = await extractWorkOrderScan(session, { buffer, mime: saved.mime, vesselCode });
    sendJson(response, 200, { extracted, file: { url: saved.url, name: saved.name, mime: saved.mime } });
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

  if (method === "POST" && /^\/app\/pms\/work-orders\/[^/]+\/resume$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    sendJson(response, 200, await resumeWorkOrder(session, id));
    return true;
  }

  if (method === "POST" && /^\/app\/pms\/work-orders\/[^/]+\/approval$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    const body = await readJsonBody(request) as Parameters<typeof setWorkOrderApproval>[2];
    sendJson(response, 200, await setWorkOrderApproval(session, id, body));
    return true;
  }

  if (method === "PATCH" && /^\/app\/pms\/work-orders\/[^/]+\/type$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    const body = await readJsonBody(request) as Parameters<typeof setWorkOrderType>[2];
    sendJson(response, 200, await setWorkOrderType(session, id, body));
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

  // Record lockdown — re-abrir una OT CLOSED/CANCELLED (solo TENANT_ADMIN, con justificación)
  if (method === "POST" && /^\/app\/pms\/work-orders\/[^/]+\/reopen$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    const body = await readJsonBody(request) as Parameters<typeof reopenWorkOrder>[2];
    sendJson(response, 200, await reopenWorkOrder(session, id, body));
    return true;
  }

  // ── Solicitudes de Servicio (SS) de esta OT ────────────────────────────────
  // Este POST es la ÚNICA forma de crear una SS: no existe `POST /app/pms/
  // service-requests`. Así la regla "una SS sólo se abre desde una OT abierta"
  // no se puede saltear (el service valida además que la OT esté abierta).
  if (method === "GET" && /^\/app\/pms\/work-orders\/[^/]+\/service-requests$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    const items = await listWorkOrderServiceRequests(session, id);
    sendJson(response, 200, { items, total: items.length });
    return true;
  }

  if (method === "POST" && /^\/app\/pms\/work-orders\/[^/]+\/service-requests$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    const body = await readJsonBody(request) as Parameters<typeof createServiceRequestForWorkOrder>[2];
    sendJson(response, 201, await createServiceRequestForWorkOrder(session, id, body));
    return true;
  }

  // ── REPUESTOS / MATERIALES planificados (recuadros del formulario) ─────────
  if (/^\/app\/pms\/work-orders\/[^/]+\/items$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    if (method === "GET") {
      const items = await listWorkOrderItems(session, id);
      sendJson(response, 200, { items, total: items.length });
      return true;
    }
    if (method === "POST") {
      const body = await readJsonBody(request) as Parameters<typeof createWorkOrderItem>[2];
      sendJson(response, 201, await createWorkOrderItem(session, id, body));
      return true;
    }
  }

  // ── PROGRAMACION DE TRABAJO (una fila por jornada, recuadro del formulario) ─
  if (/^\/app\/pms\/work-orders\/[^/]+\/schedule$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    if (method === "GET") {
      const items = await listWorkOrderSchedule(session, id);
      sendJson(response, 200, { items, total: items.length });
      return true;
    }
    if (method === "POST") {
      const body = await readJsonBody(request) as Parameters<typeof createWorkOrderScheduleEntry>[2];
      sendJson(response, 201, await createWorkOrderScheduleEntry(session, id, body));
      return true;
    }
  }

  if (/^\/app\/pms\/work-orders\/[^/]+\/schedule\/[^/]+$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    const entryId = url.pathname.split("/")[6]!;
    if (method === "PATCH") {
      const body = await readJsonBody(request) as Parameters<typeof updateWorkOrderScheduleEntry>[3];
      sendJson(response, 200, await updateWorkOrderScheduleEntry(session, id, entryId, body));
      return true;
    }
    if (method === "DELETE") {
      sendJson(response, 200, await deleteWorkOrderScheduleEntry(session, id, entryId));
      return true;
    }
  }

  // ── PLANES DEL PDM que ejecuta la OT (uno o varios: parada de astillero) ───
  if (/^\/app\/pms\/work-orders\/[^/]+\/plans$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    if (method === "GET") {
      sendJson(response, 200, await listTenantWorkOrderPlans(session, id));
      return true;
    }
    if (method === "POST") {
      const body = await readJsonBody(request) as { planId?: string; providerOverride?: Record<string, string> };
      sendJson(response, 201, await addPlanToWorkOrder(session, id, String(body?.planId ?? ""), body?.providerOverride));
      return true;
    }
  }

  if (/^\/app\/pms\/work-orders\/[^/]+\/plans\/[^/]+$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    const planId = url.pathname.split("/")[6]!;
    if (method === "DELETE") {
      sendJson(response, 200, await removePlanFromWorkOrder(session, id, planId));
      return true;
    }
  }

  if (/^\/app\/pms\/work-orders\/[^/]+\/items\/[^/]+$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    const itemId = url.pathname.split("/")[6]!;
    if (method === "PATCH") {
      const body = await readJsonBody(request) as Parameters<typeof updateWorkOrderItem>[3];
      sendJson(response, 200, await updateWorkOrderItem(session, id, itemId, body));
      return true;
    }
    if (method === "DELETE") {
      sendJson(response, 200, await deleteWorkOrderItem(session, id, itemId));
      return true;
    }
  }

  // ── Progress notes (avances de trabajo): TEXT, PHOTO, VIDEO, AUDIO ──────────
  if (method === "GET" && /^\/app\/pms\/work-orders\/[^/]+\/progress-notes$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    const notes = await listProgressNotes(session, id);
    sendJson(response, 200, { items: notes });
    return true;
  }

  if (method === "POST" && /^\/app\/pms\/work-orders\/[^/]+\/progress-notes$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    const kind = (url.searchParams.get("kind") ?? "TEXT").toUpperCase() as "TEXT" | "PHOTO" | "VIDEO" | "AUDIO" | "DOCUMENT";

    if (kind === "TEXT") {
      // Sin archivo: body JSON con { text, occurredAt }
      const body = await readJsonBody(request) as { text?: string; occurredAt?: string };
      const note = await createProgressNote(session, id, { kind, text: body.text, occurredAt: body.occurredAt });
      sendJson(response, 201, note);
      return true;
    }

    // Con archivo: binary body + headers x-filename y x-mime-type, opcional x-caption / x-occurred-at
    const rawName = request.headers["x-filename"];
    const fileName = decodeURIComponent(Array.isArray(rawName) ? rawName[0] : rawName ?? `nota.${kind === "PHOTO" ? "jpg" : kind === "VIDEO" ? "mp4" : kind === "DOCUMENT" ? "pdf" : "webm"}`);
    const rawMime = request.headers["x-mime-type"];
    const mimeType = (Array.isArray(rawMime) ? rawMime[0] : rawMime) ?? undefined;
    const rawCaption = request.headers["x-caption"];
    const caption = rawCaption ? decodeURIComponent(Array.isArray(rawCaption) ? rawCaption[0] : rawCaption) : undefined;
    const rawOccurred = request.headers["x-occurred-at"];
    const occurredAt = (Array.isArray(rawOccurred) ? rawOccurred[0] : rawOccurred) ?? undefined;

    const fileBuffer = await readBinaryBody(request);
    if (!fileBuffer.length) throw new RouteError(400, "EMPTY_BODY", "El archivo está vacío.");

    const note = await createProgressNote(session, id, { kind, text: caption, fileBuffer, fileName, mimeType, occurredAt });
    sendJson(response, 201, note);
    return true;
  }

  if (method === "PATCH" && /^\/app\/pms\/work-orders\/[^/]+\/progress-notes\/[^/]+$/.test(url.pathname)) {
    const parts = url.pathname.split("/");
    const woId = parts[4]!;
    const noteId = parts[6]!;
    const body = await readJsonBody(request) as { text?: string | null };
    const note = await updateProgressNote(session, woId, noteId, { text: body.text ?? null });
    sendJson(response, 200, note);
    return true;
  }

  if (method === "DELETE" && /^\/app\/pms\/work-orders\/[^/]+\/progress-notes\/[^/]+$/.test(url.pathname)) {
    const parts = url.pathname.split("/");
    const woId = parts[4]!;
    const noteId = parts[6]!;
    await deleteProgressNote(session, woId, noteId);
    sendJson(response, 200, { ok: true });
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

  // ── Variantes .doc (Word) — espejo de las rutas .pdf ──
  if (method === "GET" && /^\/app\/pms\/work-orders\/[^/]+\/doc$/.test(url.pathname)) {
    enforceRateLimit(request, `pdf:${session.user.id}`, { maxRequests: 10, windowMs: 60_000 });
    const id = url.pathname.split("/")[4]!;
    const wo = await getTenantWorkOrder(session, id);
    serveDoc(response, await buildWorkOrderDoc(session, id), wo.workOrderCode);
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
      assetId: url.searchParams.get("assetId"),
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
