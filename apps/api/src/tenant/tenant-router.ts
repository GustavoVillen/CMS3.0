import type { IncomingMessage, ServerResponse } from "node:http";
import type { AppEnv } from "../config/env";
import { sendJson } from "../http/json-response";
import { readJsonBody } from "../http/read-json-body";
import { RouteError } from "../http/route-error";
import { enforceRateLimit } from "../http/rate-limiter";
import { resolveTenantSlugFromRequest } from "./bootstrap/public-bootstrap-route";
import { loginTenantUser, refreshTenantSession, logoutTenantSession } from "./auth/tenant-auth-service";
import { registerTenantAccessSession, revokeTenantAccessSession } from "./auth/session-store";
import { requireTenantAccessSession } from "./auth/tenant-route-auth";
import { acceptTenantInvitation } from "./invitations/tenant-invitations-service";
import { generateInsightsForTenant } from "./ai-insights/insight-generator";
import { listTenantAiInsights, updateTenantAiInsightStatus } from "./ai-insights/ai-insights-service";
import { streamCopilotoChat, type ChatMessage } from "./copiloto/copiloto-service";
import { getMonthlyAiUsageForUser, getLatestVesselPositionsByTenant } from "./usage/usage-service";
import { parseUploadedFile, assertFileSize } from "./copiloto/file-parser-service";
import { listTenantAssets } from "./assets/assets-service";
import { listTenantAttachments } from "./attachments/attachments-service";
import { saveAttachment } from "./attachments/attachment-uploads-service";
import { listTenantCapas } from "./capa/capa-service";
import { listTenantCertificates, getTenantCertificateById, createTenantCertificate, updateTenantCertificate, deleteTenantCertificate } from "./certificates/certificates-service";
import { saveCertificateSourceFile } from "./certificates/cert-uploads-service";
import { listTenantDailyReports, getTenantDailyReport, createTenantDailyReport, updateTenantDailyReport, getFuelConsumptionTrend } from "./daily-reports/daily-reports-service";
import {
  confirmAndIntegrateDailyReport,
  getDailyReportWithSubEntities,
  upsertDailyEquipmentHours,
  upsertDailyMaintenanceEntries,
  upsertDailyDefectEntries,
  upsertDailySpareUsages,
} from "./daily-reports/daily-report-integration-service";
import { getDailyReportPeriodSuggestions } from "./daily-reports/daily-report-suggestions-service";
import { listTenantDeferrals } from "./deferrals/deferrals-service";
import { listTenantDefects } from "./defects/defects-service";
import { listTenantDomainEvents } from "./domain-events/domain-events-service";
import { listTenantMaintenancePlans } from "./maintenance-plans/maintenance-plans-service";
import { listTenantInspectionLogs } from "./inspection-logs/inspection-logs-service";
import { listTenantInspections } from "./inspections/inspections-service";
import { listTenantProviders, getTenantProvider, createProvider, updateProvider, deleteProvider } from "./providers/providers-service";
import { listTenantProviderEvaluations } from "./provider-evaluations/provider-evaluations-service";
import { listTenantProviderNonconformities } from "./provider-nonconformities/provider-nonconformities-service";
import { listTenantSpares } from "./spares/spares-service";
import { listBitacoraEntries, createBitacoraEntry, updateBitacoraEntry, deleteBitacoraEntry } from "./bitacora/bitacora-service";
import { listTenantStockMovements } from "./stock-movements/stock-movements-service";
import { listTenantVessels, getTenantVesselById, createTenantVessel, updateTenantVessel, deleteTenantVessel } from "./vessels/vessels-service";
import { listTenantWorkOrders } from "./work-orders/work-orders-service";
import { isValidModule, canImport, canExport } from "./excel/excel-permissions";
import { generateTemplate } from "./excel/excel-template";
import { previewImport, confirmImport } from "./excel/excel-import-service";
import { exportModule } from "./excel/excel-export-service";
import {
  listTenantAiDocuments, getTenantAiDocument, createTenantAiDocument,
  createTenantAiDocumentVersion, activateTenantAiDocumentVersion, archiveTenantAiDocument,
  deleteTenantAiDocumentVersion, updateTenantAiDocumentVersionContent,
} from "./ai-documents/ai-documents-service";
import {
  listFluidSamples, getFluidSample, createFluidSample, updateFluidSample, deleteFluidSample,
  upsertFluidResult, listThresholds, upsertThreshold, deleteThreshold, getAssetFluidTrend,
  regenerateFluidAiAnalysis,
  type FluidType as FluidTypeEnum, type Verdict, type SampleStatus,
} from "./fluid-analyses/fluid-analyses-service";
import { saveFluidReportFile } from "./fluid-analyses/fluid-uploads-service";
import { extractFluidReport } from "./fluid-analyses/fluid-analyses-ai-extractor";
import { buildFluidAnalysisPdf } from "./fluid-analyses/fluid-analyses-pdf-service";
import { handleSuperintendentRoutes } from "./superintendents/superintendent-router";
import { handleTeamRoutes } from "./team/team-router";
import { handleProfileRoutes } from "./profile/profile-router";
import { listTenantAuditLog, type AuditLogItem } from "./audit/audit-log-service";
import ExcelJS from "exceljs";

async function buildAuditExcel(items: AuditLogItem[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "GPMS";
  const sheet = workbook.addWorksheet("Bitácora");

  sheet.columns = [
    { key: "fecha",      header: "Fecha",      width: 12 },
    { key: "hora",       header: "Hora",        width: 8 },
    { key: "tipo",       header: "Tipo",        width: 20 },
    { key: "referencia", header: "Referencia",  width: 22 },
    { key: "vessel",     header: "Vessel",      width: 14 },
    { key: "accion",     header: "Acción",      width: 24 },
    { key: "actor",      header: "Actor",        width: 24 },
    { key: "detalle",    header: "Detalle",      width: 50 },
    { key: "entityId",   header: "Entity ID",    width: 30 },
  ];

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8E8E8" } };
  headerRow.commit();

  const refCode = (m: Record<string, unknown> | null): string => {
    if (!m) return "";
    const c = [m.workOrderCode, m.taskCode, m.defectCode, m.deferralCode, m.rcaCode, m.capaCode, m.orderCode, m.certificateCode, m.assetCode, m.sku, m.code];
    const v = c.find(x => typeof x === "string" && (x as string).length > 0);
    return typeof v === "string" ? v : "";
  };

  const detailLine = (m: Record<string, unknown> | null): string => {
    if (!m) return "";
    const t = m.holdReason ?? m.cancelReason ?? m.closeNotes ?? m.rejectionReason ?? m.title ?? m.name ?? m.notes ?? m.type;
    return typeof t === "string" ? t.trim() : "";
  };

  for (const item of items) {
    const d = new Date(item.createdAt);
    sheet.addRow({
      fecha:      d.toLocaleDateString("es-AR"),
      hora:       d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }),
      tipo:       item.entityType,
      referencia: refCode(item.metadata),
      vessel:     typeof item.metadata?.vesselCode === "string" ? item.metadata.vesselCode : "",
      accion:     item.action,
      actor:      item.actorName ?? item.actorUserId ?? "",
      detalle:    detailLine(item.metadata),
      entityId:   item.entityId ?? "",
    });
  }

  const buf = await workbook.xlsx.writeBuffer();
  return Buffer.from(buf);
}

// Helper: resolve tenant slug or throw
function requireTenantSlug(request: IncomingMessage, env: AppEnv): string {
  const slug = resolveTenantSlugFromRequest(request, env);
  if (!slug) throw new RouteError(400, "TENANT_UNRESOLVED", "Unable to resolve tenant.");
  return slug;
}

export async function handleTenantRoutes(
  method: string,
  url: URL,
  request: IncomingMessage,
  response: ServerResponse,
  env: AppEnv,
): Promise<boolean> {

  // ── Auth ───────────────────────────────────────────────────────────────────
  if (method === "POST" && url.pathname === "/app/auth/login") {
    enforceRateLimit(request, "auth:tenant-login", { maxRequests: 10, windowMs: 60_000 });
    const slug = requireTenantSlug(request, env);
    const payload = await readJsonBody<{ identifier: string; password: string; locale?: string | null }>(request);
    const result = await loginTenantUser(slug, payload);
    registerTenantAccessSession({
      kind: "tenant",
      tenantSlug: slug,
      accessToken: result.session.accessToken,
      refreshToken: result.session.refreshToken,
      accessTokenExpiresAt: result.session.accessTokenExpiresAt,
      user: result.user,
    });
    sendJson(response, 200, result);
    return true;
  }

  if (method === "POST" && url.pathname === "/app/auth/refresh") {
    enforceRateLimit(request, "auth:tenant-refresh", { maxRequests: 30, windowMs: 60_000 });
    const slug = requireTenantSlug(request, env);
    const payload = await readJsonBody<{ refreshToken: string }>(request);
    const result = await refreshTenantSession(slug, payload);

    // Re-registrar la sesión en el Map en memoria para que el nuevo access token
    // resuelva en getTenantAccessSession (el Map se vacía con cada restart del API)
    if (result.userId) {
      try {
        const prisma = (await import("../platform/data/prisma-client")).getPrismaClient();
        if (prisma) {
          const tenant = await (prisma as any).tenant.findUnique({ where: { slug } });
          if (tenant) {
            const membership = await (prisma as any).tenantMembership.findFirst({
              where: { tenantId: tenant.id, userId: result.userId, status: "ACTIVE" },
              include: { user: true },
            });
            if (membership && membership.user.status === "ACTIVE") {
              registerTenantAccessSession({
                kind: "tenant",
                tenantSlug: slug,
                accessToken: result.session.accessToken,
                refreshToken: result.session.refreshToken,
                accessTokenExpiresAt: result.session.accessTokenExpiresAt,
                user: {
                  id: membership.user.id,
                  email: membership.user.email,
                  firstName: membership.user.firstName,
                  lastName: membership.user.lastName,
                  role: membership.role,
                  assignedVesselCodes: membership.assignedVesselCodes,
                  locale: membership.user.preferredLocale ?? "es",
                },
              });
            }
          }
        }
      } catch { /* non-blocking */ }
    }

    sendJson(response, 200, result);
    return true;
  }

  if (method === "POST" && url.pathname === "/app/auth/logout") {
    // Rate-limit razonable. No requerimos sesión activa: si el access token
    // ya expiró pero el refresh sigue válido, igual queremos poder revocarlo.
    enforceRateLimit(request, "auth:tenant-logout", { maxRequests: 30, windowMs: 60_000 });
    const slug = requireTenantSlug(request, env);
    let payload: { refreshToken?: string; accessToken?: string } = {};
    try { payload = await readJsonBody<typeof payload>(request); } catch { /* body opcional */ }

    // Revoca refresh en DB (idempotente — siempre OK).
    if (payload.refreshToken) {
      await logoutTenantSession(slug, payload.refreshToken);
    }
    // Quita el access token del Map en memoria.
    if (payload.accessToken) {
      revokeTenantAccessSession(payload.accessToken);
    }

    sendJson(response, 200, { ok: true });
    return true;
  }

  if (method === "POST" && url.pathname === "/app/invitations/accept") {
    const slug = requireTenantSlug(request, env);
    const payload = await readJsonBody<{
      token: string;
      password: string;
      firstName: string;
      lastName: string;
      legacyUserId?: string | null;
      preferredLocale?: "es" | "en" | "pt";
    }>(request);
    const result = await acceptTenantInvitation(slug, payload);
    sendJson(response, 200, result);
    return true;
  }

  // ── /app/me ────────────────────────────────────────────────────────────────
  if (method === "GET" && url.pathname === "/app/me") {
    const slug = requireTenantSlug(request, env);
    const session = requireTenantAccessSession(request, slug);
    sendJson(response, 200, { tenant: { slug: session.tenantSlug }, user: session.user });
    return true;
  }

  // ── /app/me/ai-usage (badge sidebar — AI tokens consumed this month) ──────
  if (method === "GET" && url.pathname === "/app/me/ai-usage") {
    const slug = requireTenantSlug(request, env);
    const session = requireTenantAccessSession(request, slug);
    const prisma = (await import("../platform/data/prisma-client")).getPrismaClient();
    if (!prisma) {
      sendJson(response, 200, { monthLabel: "", totalTokens: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 });
      return true;
    }
    const tenant = await prisma.tenant.findUnique({ where: { slug }, select: { id: true } });
    if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant not found.");
    const summary = await getMonthlyAiUsageForUser(tenant.id, session.user.id);
    sendJson(response, 200, summary);
    return true;
  }

  // ── Fleet Superintendents ──────────────────────────────────────────────────
  if (url.pathname.startsWith("/app/superintendents")) {
    if (await handleSuperintendentRoutes(method, url, request, response, env)) return true;
  }

  if (url.pathname.startsWith("/app/team")) {
    if (await handleTeamRoutes(method, url, request, response, env)) return true;
  }

  if (url.pathname.startsWith("/app/profile")) {
    if (await handleProfileRoutes(method, url, request, response, env)) return true;
  }

  // ── Vessel positions (last known GPS per vessel, TECHNICIAN_OPERATOR only) ──
  if (method === "GET" && url.pathname === "/app/vessel-positions") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const prisma = (await import("../platform/data/prisma-client")).getPrismaClient();
    const tenant = await (prisma as any).tenant.findUnique({ where: { slug: session.tenantSlug }, select: { id: true } });
    if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant not found");
    const positions = await getLatestVesselPositionsByTenant(tenant.id);
    sendJson(response, 200, { items: positions });
    return true;
  }

  // ── Vessels ────────────────────────────────────────────────────────────────
  if (method === "GET" && url.pathname === "/app/vessels") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const records = await listTenantVessels(session);
    sendJson(response, 200, { items: records, total: records.length });
    return true;
  }
  if (method === "POST" && url.pathname === "/app/vessels") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    if (session.user.role !== "TENANT_ADMIN") throw new RouteError(403, "FORBIDDEN", "Solo administradores pueden crear vessels.");
    const body = await readJsonBody<any>(request);
    sendJson(response, 201, await createTenantVessel(session, body));
    return true;
  }
  if (/^\/app\/vessels\/[^/]+$/.test(url.pathname)) {
    const id = url.pathname.split("/").pop()!;
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    if (method === "GET") {
      const vessel = await getTenantVesselById(session, id);
      if (!vessel) throw new RouteError(404, "NOT_FOUND", "Vessel no encontrado.");
      sendJson(response, 200, vessel);
      return true;
    }
    if (method === "PUT") {
      if (session.user.role !== "TENANT_ADMIN") throw new RouteError(403, "FORBIDDEN", "Solo administradores pueden editar vessels.");
      const body = await readJsonBody<any>(request);
      sendJson(response, 200, await updateTenantVessel(session, id, body));
      return true;
    }
    if (method === "DELETE") {
      if (session.user.role !== "TENANT_ADMIN") throw new RouteError(403, "FORBIDDEN", "Solo administradores pueden eliminar vessels.");
      await deleteTenantVessel(session, id);
      sendJson(response, 200, { ok: true });
      return true;
    }
  }

  // ── Assets ─────────────────────────────────────────────────────────────────
  if (method === "GET" && url.pathname === "/app/assets") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const records = await listTenantAssets(session, { vesselCode: url.searchParams.get("vesselCode") });
    sendJson(response, 200, { items: records, total: records.length });
    return true;
  }

  // ── Maintenance Plans ──────────────────────────────────────────────────────
  if (method === "GET" && url.pathname === "/app/maintenance-plans") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const records = await listTenantMaintenancePlans(session, {
      vesselCode:  url.searchParams.get("vesselCode"),
      status:      url.searchParams.get("status"),
      triggerType: url.searchParams.get("triggerType"),
    });
    sendJson(response, 200, { items: records, total: records.length });
    return true;
  }

  // ── Work Orders ────────────────────────────────────────────────────────────
  if (method === "GET" && url.pathname === "/app/work-orders") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const records = await listTenantWorkOrders(session, {
      vesselCode: url.searchParams.get("vesselCode"),
      status:     url.searchParams.get("status"),
      type:       url.searchParams.get("type"),
    });
    sendJson(response, 200, { items: records, total: records.length });
    return true;
  }

  // ── Defects ────────────────────────────────────────────────────────────────
  if (method === "GET" && url.pathname === "/app/defects") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const records = await listTenantDefects(session, {
      vesselCode: url.searchParams.get("vesselCode"),
      status:     url.searchParams.get("status"),
      severity:   url.searchParams.get("severity"),
    });
    sendJson(response, 200, { items: records, total: records.length });
    return true;
  }

  // ── Deferrals ──────────────────────────────────────────────────────────────
  if (method === "GET" && url.pathname === "/app/deferrals") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const records = await listTenantDeferrals(session, {
      vesselCode:  url.searchParams.get("vesselCode"),
      status:      url.searchParams.get("status"),
      sourceType:  url.searchParams.get("sourceType"),
    });
    sendJson(response, 200, { items: records, total: records.length });
    return true;
  }

  // ── CAPA ───────────────────────────────────────────────────────────────────
  if (method === "GET" && url.pathname === "/app/capa") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const records = await listTenantCapas(session, {
      vesselCode:  url.searchParams.get("vesselCode"),
      status:      url.searchParams.get("status"),
      priority:    url.searchParams.get("priority"),
      sourceType:  url.searchParams.get("sourceType"),
    });
    sendJson(response, 200, { items: records, total: records.length });
    return true;
  }

  // ── Spares ─────────────────────────────────────────────────────────────────
  if (method === "GET" && url.pathname === "/app/spares") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const records = await listTenantSpares(session, {
      vesselCode:  url.searchParams.get("vesselCode"),
      status:      url.searchParams.get("status"),
      criticality: url.searchParams.get("criticality"),
    });
    sendJson(response, 200, { items: records, total: records.length });
    return true;
  }

  // ── Providers ──────────────────────────────────────────────────────────────
  if (method === "GET" && url.pathname === "/app/providers") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const records = await listTenantProviders(session, {
      vesselCode: url.searchParams.get("vesselCode"),
      status:     url.searchParams.get("status"),
      category:   url.searchParams.get("category"),
    });
    sendJson(response, 200, { items: records, total: records.length });
    return true;
  }

  if (method === "POST" && url.pathname === "/app/providers") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const body = await readJsonBody(request) as Parameters<typeof createProvider>[1];
    sendJson(response, 201, await createProvider(session, body));
    return true;
  }

  if (/^\/app\/providers\/[^/]+$/.test(url.pathname)) {
    const id = url.pathname.split("/")[3]!;
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    if (method === "GET") {
      sendJson(response, 200, await getTenantProvider(session, id));
      return true;
    }
    if (method === "PATCH") {
      const body = await readJsonBody(request) as Parameters<typeof updateProvider>[2];
      sendJson(response, 200, await updateProvider(session, id, body));
      return true;
    }
    if (method === "DELETE") {
      await deleteProvider(session, id);
      sendJson(response, 200, { ok: true });
      return true;
    }
  }

  // ── Inspections ────────────────────────────────────────────────────────────
  if (method === "GET" && url.pathname === "/app/inspections") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const records = await listTenantInspections(session, {
      vesselCode: url.searchParams.get("vesselCode"),
      status:     url.searchParams.get("status"),
      result:     url.searchParams.get("result"),
      type:       url.searchParams.get("type"),
    });
    sendJson(response, 200, { items: records, total: records.length });
    return true;
  }

  // ── Certificates ───────────────────────────────────────────────────────────
  if (method === "GET" && url.pathname === "/app/certificates") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const records = await listTenantCertificates(session, {
      vesselCode: url.searchParams.get("vesselCode"),
      status:     url.searchParams.get("status"),
    });
    sendJson(response, 200, { items: records, total: records.length });
    return true;
  }
  if (method === "POST" && url.pathname === "/app/certificates") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    if (session.user.role !== "TENANT_ADMIN") throw new RouteError(403, "FORBIDDEN", "Solo administradores pueden crear certificados.");
    const body = await readJsonBody<any>(request);
    sendJson(response, 201, await createTenantCertificate(session, body));
    return true;
  }
  if (/^\/app\/certificates\/[^/]+$/.test(url.pathname)) {
    const id = url.pathname.split("/").pop()!;
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    if (method === "GET") {
      const cert = await getTenantCertificateById(session, id);
      if (!cert) throw new RouteError(404, "NOT_FOUND", "Certificado no encontrado.");
      sendJson(response, 200, cert);
      return true;
    }
    if (method === "PATCH") {
      if (session.user.role !== "TENANT_ADMIN") throw new RouteError(403, "FORBIDDEN", "Solo administradores pueden editar certificados.");
      const body = await readJsonBody<any>(request);
      sendJson(response, 200, await updateTenantCertificate(session, id, body));
      return true;
    }
    if (method === "DELETE") {
      if (session.user.role !== "TENANT_ADMIN") throw new RouteError(403, "FORBIDDEN", "Solo administradores pueden eliminar certificados.");
      await deleteTenantCertificate(session, id);
      sendJson(response, 200, { ok: true });
      return true;
    }
  }

  // ── Certificate source file upload ─────────────────────────────────────────
  if (method === "POST" && url.pathname === "/app/certificates/upload-source") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    if (session.user.role !== "TENANT_ADMIN") throw new RouteError(403, "FORBIDDEN", "Solo administradores pueden subir archivos.");
    const rawName = request.headers["x-filename"];
    const originalName = decodeURIComponent(Array.isArray(rawName) ? rawName[0] : rawName ?? "archivo");
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const buffer = Buffer.concat(chunks);
    if (!buffer.length) throw new RouteError(400, "EMPTY_BODY", "El archivo está vacío.");
    const result = await saveCertificateSourceFile(session.tenantSlug, originalName, buffer);
    sendJson(response, 200, result);
    return true;
  }

  // ── Dashboard ─────────────────────────────────────────────────────────────
  if (method === "GET" && url.pathname === "/app/dashboard/fuel-consumption") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const vesselCode = url.searchParams.get("vesselCode") || null;
    const days = Math.min(90, Math.max(7, parseInt(url.searchParams.get("days") ?? "30", 10) || 30));
    const points = await getFuelConsumptionTrend(session, vesselCode, days);
    sendJson(response, 200, { items: points });
    return true;
  }

  // ── Daily Reports ──────────────────────────────────────────────────────────
  if (method === "GET" && url.pathname === "/app/daily-reports") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const records = await listTenantDailyReports(session, {
      vesselCode:  url.searchParams.get("vesselCode"),
      status:      url.searchParams.get("status"),
      reportDate:  url.searchParams.get("reportDate"),
    });
    sendJson(response, 200, { items: records, total: records.length });
    return true;
  }

  if (method === "POST" && url.pathname === "/app/daily-reports") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const body = await readJsonBody(request) as Parameters<typeof createTenantDailyReport>[1];
    sendJson(response, 201, await createTenantDailyReport(session, body));
    return true;
  }

  if (method === "GET" && /^\/app\/daily-reports\/[^/]+$/.test(url.pathname)) {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const id = url.pathname.split("/").pop()!;
    sendJson(response, 200, await getTenantDailyReport(session, id));
    return true;
  }

  if (method === "PATCH" && /^\/app\/daily-reports\/[^/]+$/.test(url.pathname)) {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const id = url.pathname.split("/").pop()!;
    const body = await readJsonBody(request) as Parameters<typeof updateTenantDailyReport>[2];
    sendJson(response, 200, await updateTenantDailyReport(session, id, body));
    return true;
  }

  if (method === "GET" && /^\/app\/daily-reports\/[^/]+\/period-suggestions$/.test(url.pathname)) {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const id = url.pathname.split("/")[3]!;
    sendJson(response, 200, await getDailyReportPeriodSuggestions(session, id));
    return true;
  }

  if (method === "GET" && /^\/app\/daily-reports\/[^/]+\/full$/.test(url.pathname)) {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const id = url.pathname.split("/")[3]!;
    sendJson(response, 200, await getDailyReportWithSubEntities(session, id));
    return true;
  }

  if (method === "POST" && /^\/app\/daily-reports\/[^/]+\/confirm-and-integrate$/.test(url.pathname)) {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const id = url.pathname.split("/")[3]!;
    sendJson(response, 200, await confirmAndIntegrateDailyReport(session, id));
    return true;
  }

  if (method === "PUT" && /^\/app\/daily-reports\/[^/]+\/equipment-hours$/.test(url.pathname)) {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const id = url.pathname.split("/")[3]!;
    const body = await readJsonBody(request) as { entries: Parameters<typeof upsertDailyEquipmentHours>[2] };
    sendJson(response, 200, await upsertDailyEquipmentHours(session, id, body.entries ?? []));
    return true;
  }

  if (method === "PUT" && /^\/app\/daily-reports\/[^/]+\/maintenance-entries$/.test(url.pathname)) {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const id = url.pathname.split("/")[3]!;
    const body = await readJsonBody(request) as { entries: Parameters<typeof upsertDailyMaintenanceEntries>[2] };
    sendJson(response, 200, await upsertDailyMaintenanceEntries(session, id, body.entries ?? []));
    return true;
  }

  if (method === "PUT" && /^\/app\/daily-reports\/[^/]+\/defect-entries$/.test(url.pathname)) {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const id = url.pathname.split("/")[3]!;
    const body = await readJsonBody(request) as { entries: Parameters<typeof upsertDailyDefectEntries>[2] };
    sendJson(response, 200, await upsertDailyDefectEntries(session, id, body.entries ?? []));
    return true;
  }

  if (method === "PUT" && /^\/app\/daily-reports\/[^/]+\/spare-usages$/.test(url.pathname)) {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const id = url.pathname.split("/")[3]!;
    const body = await readJsonBody(request) as { entries: Parameters<typeof upsertDailySpareUsages>[2] };
    sendJson(response, 200, await upsertDailySpareUsages(session, id, body.entries ?? []));
    return true;
  }

  // ── Attachments ────────────────────────────────────────────────────────────
  if (method === "POST" && url.pathname === "/app/attachments/upload") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const entityType = url.searchParams.get("entityType") ?? "generic";
    const rawName = request.headers["x-filename"];
    const originalName = decodeURIComponent(Array.isArray(rawName) ? rawName[0] : rawName ?? "archivo");
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const buffer = Buffer.concat(chunks);
    if (!buffer.length) throw new RouteError(400, "EMPTY_BODY", "El archivo está vacío.");
    const result = await saveAttachment(session.tenantSlug, entityType, originalName, buffer);
    sendJson(response, 200, result);
    return true;
  }

  if (method === "GET" && url.pathname === "/app/attachments") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const records = await listTenantAttachments(session, {
      vesselCode:  url.searchParams.get("vesselCode"),
      status:      url.searchParams.get("status"),
      targetType:  url.searchParams.get("targetType"),
    });
    sendJson(response, 200, { items: records, total: records.length });
    return true;
  }

  // ── Inspection Logs ────────────────────────────────────────────────────────
  if (method === "GET" && url.pathname === "/app/inspection-logs") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const records = await listTenantInspectionLogs(session, {
      vesselCode:   url.searchParams.get("vesselCode"),
      inspectionId: url.searchParams.get("inspectionId"),
      entryType:    url.searchParams.get("entryType"),
      severity:     url.searchParams.get("severity"),
    });
    sendJson(response, 200, { items: records, total: records.length });
    return true;
  }

  // ── Stock Movements ────────────────────────────────────────────────────────
  if (method === "GET" && url.pathname === "/app/stock-movements") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const records = await listTenantStockMovements(session, {
      vesselCode:   url.searchParams.get("vesselCode"),
      movementType: url.searchParams.get("movementType"),
      spareId:      url.searchParams.get("spareId"),
    });
    sendJson(response, 200, { items: records, total: records.length });
    return true;
  }

  // ── Provider Evaluations ───────────────────────────────────────────────────
  if (method === "GET" && url.pathname === "/app/provider-evaluations") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const records = await listTenantProviderEvaluations(session, {
      vesselCode: url.searchParams.get("vesselCode"),
      status:     url.searchParams.get("status"),
      rating:     url.searchParams.get("rating"),
    });
    sendJson(response, 200, { items: records, total: records.length });
    return true;
  }

  // ── Provider Nonconformities ───────────────────────────────────────────────
  if (method === "GET" && url.pathname === "/app/provider-nonconformities") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const records = await listTenantProviderNonconformities(session, {
      vesselCode: url.searchParams.get("vesselCode"),
      status:     url.searchParams.get("status"),
      severity:   url.searchParams.get("severity"),
    });
    sendJson(response, 200, { items: records, total: records.length });
    return true;
  }

  // ── Domain Events ──────────────────────────────────────────────────────────
  if (method === "GET" && url.pathname === "/app/domain-events") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const records = await listTenantDomainEvents(session, {
      vesselCode:  url.searchParams.get("vesselCode"),
      entityType:  url.searchParams.get("entityType"),
      eventKind:   url.searchParams.get("eventKind"),
    });
    sendJson(response, 200, { items: records, total: records.length });
    return true;
  }

  // ── AI Insights ────────────────────────────────────────────────────────────
  if (method === "POST" && url.pathname === "/app/ai-insights/refresh") {
    const slug = requireTenantSlug(request, env);
    const session = requireTenantAccessSession(request, slug);
    if (session.user.role !== "TENANT_ADMIN") throw new RouteError(403, "FORBIDDEN", "Solo administradores pueden regenerar insights.");
    const prisma = (await import("../platform/data/prisma-client")).getPrismaClient();
    if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
    const tenant = await prisma.tenant.findUnique({ where: { slug } });
    if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant not found.");
    const generated = await generateInsightsForTenant(tenant.id);
    sendJson(response, 200, { generated });
    return true;
  }
  if (method === "GET" && url.pathname === "/app/ai-insights") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const records = await listTenantAiInsights(session, {
      vesselCode:  url.searchParams.get("vesselCode"),
      status:      url.searchParams.get("status"),
      insightType: url.searchParams.get("insightType"),
      targetType:  url.searchParams.get("targetType"),
    });
    sendJson(response, 200, { items: records, total: records.length });
    return true;
  }
  if (method === "PATCH" && /^\/app\/ai-insights\/[^/]+$/.test(url.pathname)) {
    const id = url.pathname.split("/").pop()!;
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const body = await readJsonBody(request) as { status: "DISMISSED" | "RESOLVED" };
    sendJson(response, 200, await updateTenantAiInsightStatus(session, id, body.status));
    return true;
  }

  // ── AI Documents ───────────────────────────────────────────────────────────
  if (method === "GET" && url.pathname === "/app/ai-documents") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    sendJson(response, 200, await listTenantAiDocuments(session));
    return true;
  }
  if (method === "POST" && url.pathname === "/app/ai-documents") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const body = await readJsonBody(request) as any;
    sendJson(response, 201, await createTenantAiDocument(session, body));
    return true;
  }
  if (method === "GET" && /^\/app\/ai-documents\/[\w-]+$/.test(url.pathname)) {
    const id = url.pathname.split("/").pop()!;
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    sendJson(response, 200, await getTenantAiDocument(session, id));
    return true;
  }
  if (method === "DELETE" && /^\/app\/ai-documents\/[\w-]+$/.test(url.pathname)) {
    const id = url.pathname.split("/").pop()!;
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    sendJson(response, 200, await archiveTenantAiDocument(session, id));
    return true;
  }
  if (method === "POST" && /^\/app\/ai-documents\/[\w-]+\/versions$/.test(url.pathname)) {
    const documentId = url.pathname.split("/")[3]!;
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const body = await readJsonBody(request) as any;
    sendJson(response, 201, await createTenantAiDocumentVersion(session, documentId, body));
    return true;
  }
  if (method === "POST" && /^\/app\/ai-documents\/[\w-]+\/versions\/[\w-]+\/activate$/.test(url.pathname)) {
    const parts = url.pathname.split("/");
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    sendJson(response, 200, await activateTenantAiDocumentVersion(session, parts[3]!, parts[5]!));
    return true;
  }
  if (method === "DELETE" && /^\/app\/ai-documents\/[\w-]+\/versions\/[\w-]+$/.test(url.pathname)) {
    const parts = url.pathname.split("/");
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    sendJson(response, 200, await deleteTenantAiDocumentVersion(session, parts[3]!, parts[5]!));
    return true;
  }
  if (method === "PATCH" && /^\/app\/ai-documents\/[\w-]+\/versions\/[\w-]+$/.test(url.pathname)) {
    const parts = url.pathname.split("/");
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const body = await readJsonBody(request) as any;
    sendJson(response, 200, await updateTenantAiDocumentVersionContent(session, parts[3]!, parts[5]!, String(body.content ?? "")));
    return true;
  }

  // ── Fluid Analyses ─────────────────────────────────────────────────────────
  if (method === "GET" && url.pathname === "/app/fluid-analyses") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    sendJson(response, 200, await listFluidSamples(session, {
      vesselCode: url.searchParams.get("vesselCode"),
      assetId:    url.searchParams.get("assetId"),
      fluidType:  url.searchParams.get("fluidType") as FluidTypeEnum | null,
      verdict:    url.searchParams.get("verdict")   as Verdict | null,
      status:     url.searchParams.get("status")    as SampleStatus | null,
      from:       url.searchParams.get("from"),
      to:         url.searchParams.get("to"),
    }));
    return true;
  }
  if (method === "POST" && url.pathname === "/app/fluid-analyses") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const body = await readJsonBody(request) as any;
    sendJson(response, 201, await createFluidSample(session, body));
    return true;
  }
  if (method === "GET" && /^\/app\/fluid-analyses\/[\w-]+$/.test(url.pathname)) {
    const id = url.pathname.split("/").pop()!;
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    sendJson(response, 200, await getFluidSample(session, id));
    return true;
  }
  if (method === "PATCH" && /^\/app\/fluid-analyses\/[\w-]+$/.test(url.pathname)) {
    const id = url.pathname.split("/").pop()!;
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const body = await readJsonBody(request) as any;
    sendJson(response, 200, await updateFluidSample(session, id, body));
    return true;
  }
  if (method === "DELETE" && /^\/app\/fluid-analyses\/[\w-]+$/.test(url.pathname)) {
    const id = url.pathname.split("/").pop()!;
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    sendJson(response, 200, await deleteFluidSample(session, id));
    return true;
  }
  if (method === "POST" && /^\/app\/fluid-analyses\/[\w-]+\/result$/.test(url.pathname)) {
    const sampleId = url.pathname.split("/")[3]!;
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const body = await readJsonBody(request) as any;
    sendJson(response, 200, await upsertFluidResult(session, sampleId, body));
    return true;
  }
  if (method === "POST" && /^\/app\/fluid-analyses\/[\w-]+\/generate-ai-analysis$/.test(url.pathname)) {
    const sampleId = url.pathname.split("/")[3]!;
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    sendJson(response, 200, await regenerateFluidAiAnalysis(session, sampleId));
    return true;
  }
  if (method === "GET" && /^\/app\/fluid-analyses\/[\w-]+\/pdf$/.test(url.pathname)) {
    const sampleId = url.pathname.split("/")[3]!;
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    enforceRateLimit(request, `pdf:${session.user.id}`, { maxRequests: 10, windowMs: 60_000 });
    const pdfBuffer = await buildFluidAnalysisPdf(session, sampleId);
    response.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="fluid-${sampleId}.pdf"`,
      "Content-Length": pdfBuffer.length,
    });
    response.end(pdfBuffer);
    return true;
  }
  if (method === "POST" && url.pathname === "/app/fluid-analyses/upload-report") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const rawName = request.headers["x-filename"];
    const originalName = decodeURIComponent(Array.isArray(rawName) ? rawName[0]! : rawName ?? "reporte");
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const buffer = Buffer.concat(chunks);
    if (!buffer.length) throw new RouteError(400, "EMPTY_BODY", "El archivo está vacío.");
    const saved = await saveFluidReportFile(session.tenantSlug, originalName, buffer);
    sendJson(response, 201, { url: saved.url, name: saved.name, mime: saved.mime });
    return true;
  }
  if (method === "POST" && url.pathname === "/app/fluid-analyses/extract") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const rawName = request.headers["x-filename"];
    const originalName = decodeURIComponent(Array.isArray(rawName) ? rawName[0]! : rawName ?? "reporte");
    const vesselCode = (Array.isArray(request.headers["x-vessel-code"]) ? request.headers["x-vessel-code"][0] : request.headers["x-vessel-code"]) ?? null;
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const buffer = Buffer.concat(chunks);
    if (!buffer.length) throw new RouteError(400, "EMPTY_BODY", "El archivo está vacío.");
    // Save the file first so the URL is available for later
    const saved = await saveFluidReportFile(session.tenantSlug, originalName, buffer);
    const extracted = await extractFluidReport(session, { buffer, mime: saved.mime, vesselCode });
    sendJson(response, 200, { extracted, file: { url: saved.url, name: saved.name, mime: saved.mime } });
    return true;
  }
  if (method === "GET" && url.pathname === "/app/fluid-analyses-trend") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const assetId = url.searchParams.get("assetId");
    if (!assetId) throw new RouteError(400, "ASSET_ID_REQUIRED", "assetId es requerido.");
    const fluidType = url.searchParams.get("fluidType") as FluidTypeEnum | null;
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 12), 50);
    sendJson(response, 200, await getAssetFluidTrend(session, assetId, fluidType, limit));
    return true;
  }
  if (method === "GET" && url.pathname === "/app/fluid-analyses-thresholds") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    sendJson(response, 200, await listThresholds(session, url.searchParams.get("fluidType") as FluidTypeEnum | null));
    return true;
  }
  if (method === "POST" && url.pathname === "/app/fluid-analyses-thresholds") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const body = await readJsonBody(request) as any;
    sendJson(response, 200, await upsertThreshold(session, body));
    return true;
  }
  if (method === "DELETE" && /^\/app\/fluid-analyses-thresholds\/[\w-]+$/.test(url.pathname)) {
    const id = url.pathname.split("/").pop()!;
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    sendJson(response, 200, await deleteThreshold(session, id));
    return true;
  }

  // ── Excel ──────────────────────────────────────────────────────────────────
  if (method === "GET" && /^\/app\/excel\/template\/[\w_]+$/.test(url.pathname)) {
    const mod = url.pathname.split("/").pop()!;
    if (!isValidModule(mod)) throw new RouteError(400, "INVALID_MODULE", `Módulo desconocido: ${mod}`);
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    if (!canExport(mod, session.user.role)) throw new RouteError(403, "FORBIDDEN", "Sin permiso.");
    const buffer = await generateTemplate(mod);
    response.writeHead(200, {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="template_${mod}.xlsx"`,
      "Content-Length": buffer.length,
    });
    response.end(buffer);
    return true;
  }
  if (method === "POST" && /^\/app\/excel\/preview\/[\w_]+$/.test(url.pathname)) {
    const mod = url.pathname.split("/").pop()!;
    if (!isValidModule(mod)) throw new RouteError(400, "INVALID_MODULE", `Módulo desconocido: ${mod}`);
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    if (!canImport(mod, session.user.role)) throw new RouteError(403, "FORBIDDEN", "Sin permiso.");
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const buffer = Buffer.concat(chunks);
    if (!buffer.length) throw new RouteError(400, "EMPTY_BODY", "El cuerpo está vacío.");
    sendJson(response, 200, await previewImport(session, mod, buffer));
    return true;
  }
  if (method === "POST" && /^\/app\/excel\/import\/[\w_]+$/.test(url.pathname)) {
    const mod = url.pathname.split("/").pop()!;
    if (!isValidModule(mod)) throw new RouteError(400, "INVALID_MODULE", `Módulo desconocido: ${mod}`);
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    if (!canImport(mod, session.user.role)) throw new RouteError(403, "FORBIDDEN", "Sin permiso.");
    const body = await readJsonBody(request) as { rows: unknown[] };
    if (!body?.rows || !Array.isArray(body.rows)) throw new RouteError(400, "INVALID_BODY", "Se esperaba { rows: [...] }");
    sendJson(response, 200, await confirmImport(session, mod, body.rows as any));
    return true;
  }
  if (method === "GET" && /^\/app\/excel\/export\/[\w_]+$/.test(url.pathname)) {
    const mod = url.pathname.split("/").pop()!;
    if (!isValidModule(mod)) throw new RouteError(400, "INVALID_MODULE", `Módulo desconocido: ${mod}`);
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    if (!canExport(mod, session.user.role)) throw new RouteError(403, "FORBIDDEN", "Sin permiso.");
    const filters: Record<string, string | null> = {
      vesselCode:  url.searchParams.get("vesselCode"),
      status:      url.searchParams.get("status"),
      criticality: url.searchParams.get("criticality"),
      triggerType: url.searchParams.get("triggerType"),
      category:    url.searchParams.get("category"),
      priority:    url.searchParams.get("priority"),
      type:        url.searchParams.get("type"),
    };
    const buffer = await exportModule(session, mod, filters);
    response.writeHead(200, {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="export_${mod}.xlsx"`,
      "Content-Length": buffer.length,
    });
    response.end(buffer);
    return true;
  }

  // ── Copiloto file upload ───────────────────────────────────────────────────
  if (method === "POST" && url.pathname === "/app/copiloto/parse-file") {
    const slug = requireTenantSlug(request, env);
    requireTenantAccessSession(request, slug);

    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const buffer = Buffer.concat(chunks);
    assertFileSize(buffer);

    const mimeType  = (request.headers["content-type"] ?? "application/octet-stream").split(";")[0]!.trim();
    const rawName   = request.headers["x-filename"] ?? "archivo";
    const fileName  = decodeURIComponent(Array.isArray(rawName) ? rawName[0]! : rawName);

    const content = await parseUploadedFile(buffer, mimeType, fileName);
    sendJson(response, 200, content);
    return true;
  }

  // ── Copiloto (SSE streaming) ───────────────────────────────────────────────
  if (method === "POST" && url.pathname === "/app/copiloto/chat") {
    const slug = requireTenantSlug(request, env);
    const session = requireTenantAccessSession(request, slug);
    enforceRateLimit(request, `ai:${session.user.id}`, { maxRequests: 30, windowMs: 60_000 });
    const body = await readJsonBody(request) as {
      capability?: string; locale?: string;
      messages: ChatMessage[]; vesselCode?: string | null;
      screenContext?: Record<string, unknown> | null;
      fileAttachment?: Record<string, unknown> | null;
      mode?: "voice" | null;
    };
    const prisma = (await import("../platform/data/prisma-client")).getPrismaClient();
    if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
    const tenant = await prisma.tenant.findUnique({ where: { slug } });
    if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant not found.");

    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });
    try {
      await streamCopilotoChat(
        {
          capability:     body.capability    ?? "knowledge_assistant",
          locale:         body.locale        ?? "es",
          messages:       body.messages      ?? [],
          vesselCode:     body.vesselCode    ?? null,
          tenantId:       tenant.id,
          tenantSlug:     slug,
          userId:         session.user.id,
          userEmail:      session.user.email,
          screenContext:  body.screenContext ?? null,
          fileAttachment: (body.fileAttachment ?? null) as import("./copiloto/file-parser-service").FileContent | null,
          mode:           body.mode ?? null,
        },
        (text) => { response.write(`data: ${JSON.stringify({ text })}\n\n`); },
      );
      response.write("data: [DONE]\n\n");
    } catch (e: any) {
      const raw: string = e.message ?? "Error";
      let friendly = raw;
      if (raw.includes("credit balance") || raw.includes("billing")) {
        friendly = "El servicio de IA no tiene créditos disponibles.";
      } else if (raw.includes("API_NOT_CONFIGURED") || raw.includes("not configured")) {
        friendly = "La API de IA no está configurada en el servidor.";
      } else if (raw.includes("429") || raw.includes("rate limit") || raw.includes("quota")) {
        friendly = "Límite de uso de IA alcanzado. Intentá de nuevo en unos minutos.";
      } else if (raw.length > 200) {
        friendly = raw.slice(0, 200) + "…";
      }
      response.write(`data: ${JSON.stringify({ error: friendly })}\n\n`);
    } finally {
      response.end();
    }
    return true;
  }

  // ── Copiloto one-shot analysis endpoints ─────────────────────────────────
  if (method === "POST" && url.pathname === "/app/copiloto/analyze-deficiency") {
    const slug = requireTenantSlug(request, env);
    const session = requireTenantAccessSession(request, slug);
    const body = await readJsonBody(request) as {
      planTitle?: string; vesselCode?: string; deficienciesNotes?: string;
    };
    const prisma = (await import("../platform/data/prisma-client")).getPrismaClient();
    if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
    const tenant = await prisma.tenant.findUnique({ where: { slug } });
    if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant not found.");
    const prompt = [
      `Sos experto en mantenimiento naval. Se ejecutó una tarea de mantenimiento en el buque "${body.vesselCode ?? "desconocido"}" y se encontraron deficiencias.`,
      `Tarea: "${body.planTitle ?? "sin título"}"`,
      `Deficiencias encontradas: ${body.deficienciesNotes ?? "sin detalle"}`,
      "",
      "Evaluá brevemente si corresponde abrir un registro de Defecto formal en el sistema.",
      "Considerá: gravedad aparente, riesgo operativo, si podría afectar la operatividad del buque.",
      "Respondé en 2-3 oraciones concisas, en español, sin JSON.",
    ].join("\n");
    let output = "";
    await streamCopilotoChat(
      { capability: "knowledge_assistant", locale: "es", messages: [{ role: "user", content: prompt }], vesselCode: body.vesselCode ?? null, tenantId: tenant.id, tenantSlug: slug, userId: session.user.id, userEmail: session.user.email },
      (chunk) => { output += chunk; },
    );
    sendJson(response, 200, { suggestion: output.trim() });
    return true;
  }

  if (method === "POST" && url.pathname === "/app/copiloto/analyze-postponement") {
    const slug = requireTenantSlug(request, env);
    const session = requireTenantAccessSession(request, slug);
    const body = await readJsonBody(request) as {
      planTitle?: string; vesselCode?: string; triggerType?: string;
      justification?: string; newDueDate?: string | null; newDueHours?: string | null;
    };
    const prisma = (await import("../platform/data/prisma-client")).getPrismaClient();
    if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
    const tenant = await prisma.tenant.findUnique({ where: { slug } });
    if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant not found.");
    const prompt = [
      `Sos experto en gestión de mantenimiento naval. Se solicita postergar una tarea de mantenimiento.`,
      `Buque: ${body.vesselCode ?? "desconocido"} | Tarea: "${body.planTitle ?? "sin título"}"`,
      `Trigger: ${body.triggerType ?? "N/A"}`,
      `Justificación: ${body.justification ?? "sin justificación"}`,
      body.newDueDate ? `Nueva fecha propuesta: ${body.newDueDate}` : "",
      body.newDueHours ? `Nuevas horas propuestas: ${body.newDueHours}h` : "",
      "",
      "Evaluá la justificación y sugerí mejoras si corresponde. Indicá si las medidas compensatorias propuestas son suficientes.",
      "Si la postergación parece improcedente desde el punto de vista de seguridad marítima, advertilo claramente.",
      "Respondé en 2-4 oraciones en español.",
    ].filter(Boolean).join("\n");
    let output = "";
    await streamCopilotoChat(
      { capability: "knowledge_assistant", locale: "es", messages: [{ role: "user", content: prompt }], vesselCode: body.vesselCode ?? null, tenantId: tenant.id, tenantSlug: slug, userId: session.user.id, userEmail: session.user.email },
      (chunk) => { output += chunk; },
    );
    sendJson(response, 200, { suggestion: output.trim() });
    return true;
  }

  // ── Bitácora narrativa ────────────────────────────────────────────────────
  if (url.pathname === "/app/bitacora") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    if (method === "GET") {
      const monitoringParam = url.searchParams.get("isMonitoring");
      const items = await listBitacoraEntries(session, {
        vesselCode:  url.searchParams.get("vesselCode"),
        category:    url.searchParams.get("category"),
        isMonitoring: monitoringParam !== null ? monitoringParam === "true" : undefined,
        from:        url.searchParams.get("from"),
        to:          url.searchParams.get("to"),
      });
      sendJson(response, 200, { items, total: items.length });
      return true;
    }
    if (method === "POST") {
      const body = await readJsonBody(request) as Parameters<typeof createBitacoraEntry>[1];
      sendJson(response, 201, await createBitacoraEntry(session, body));
      return true;
    }
  }

  if (/^\/app\/bitacora\/[^/]+$/.test(url.pathname)) {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const id = url.pathname.split("/")[3]!;
    if (method === "PATCH") {
      const body = await readJsonBody(request) as Parameters<typeof updateBitacoraEntry>[2];
      sendJson(response, 200, await updateBitacoraEntry(session, id, body));
      return true;
    }
    if (method === "DELETE") {
      await deleteBitacoraEntry(session, id);
      sendJson(response, 200, { ok: true });
      return true;
    }
  }

  // ── Audit Log (TENANT_ADMIN only) ─────────────────────────────────────────
  if (method === "GET" && url.pathname === "/app/audit/log") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    if (session.user.role !== "TENANT_ADMIN") throw new RouteError(403, "FORBIDDEN", "Solo administradores pueden ver la bitácora.");
    const entityType = url.searchParams.get("entityType") ?? undefined;
    const action = url.searchParams.get("action") ?? undefined;
    const from = url.searchParams.get("from") ?? undefined;
    const to = url.searchParams.get("to") ?? undefined;
    const limit = Math.min(Number(url.searchParams.get("limit") ?? "100"), 200);
    const offset = Number(url.searchParams.get("offset") ?? "0");
    const result = await listTenantAuditLog(session, { entityType, action, from, to, limit, offset });
    sendJson(response, 200, result);
    return true;
  }

  if (method === "GET" && url.pathname === "/app/audit/log/export") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    if (session.user.role !== "TENANT_ADMIN") throw new RouteError(403, "FORBIDDEN", "Solo administradores pueden exportar la bitácora.");
    const entityType = url.searchParams.get("entityType") ?? undefined;
    const from = url.searchParams.get("from") ?? undefined;
    const to = url.searchParams.get("to") ?? undefined;
    const { items } = await listTenantAuditLog(session, { entityType, from, to, limit: 5000 });
    const buffer = await buildAuditExcel(items);
    response.writeHead(200, {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="bitacora_${new Date().toISOString().slice(0, 10)}.xlsx"`,
      "Content-Length": buffer.length,
    });
    response.end(buffer);
    return true;
  }

  return false;
}
