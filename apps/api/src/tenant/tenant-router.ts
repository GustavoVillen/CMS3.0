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
import { ensureCapability } from "../platform/prompts/platform-prompts-service";
import { generateInsightsForTenant } from "./ai-insights/insight-generator";
import {
  listExternalAudits, getExternalAudit, createExternalAudit, updateExternalAudit, softDeleteExternalAudit,
  createFinding, updateFinding, deleteFinding,
} from "./external-audits/external-audits-service";
import {
  listNearMisses, getNearMiss, createNearMiss, updateNearMiss, deleteNearMiss,
} from "./near-miss/near-miss-service";
import {
  listRestHours, upsertRestHours, monthlySnapshot, deleteRestHoursDay,
} from "./rest-hours/rest-hours-service";
import {
  listTemplates, getTemplate, createTemplate, updateTemplate,
  listExecutions, getExecution, createExecution, updateExecution, deleteExecution, setResponse,
} from "./checklists/checklists-service";
import {
  getMatrix, upsertCapability, deleteCapability,
} from "./crew-matrix/crew-matrix-service";
import {
  listMocs, getMoc, createMoc, updateMoc, transitionMoc, deleteMoc,
} from "./moc/moc-service";
import {
  listQuestions, listAssessments, getAssessment, createAssessment, setResponseCviq, completeAssessment, deleteAssessment,
} from "./cviq/cviq-service";
import { getSidebarCounts } from "./sidebar/sidebar-counts-service";
import { getComplianceScores, getSmartAlerts } from "./compliance/compliance-service";
import { listTenantAiInsights, updateTenantAiInsightStatus } from "./ai-insights/ai-insights-service";
import { streamCopilotoChat, type ChatMessage } from "./copiloto/copiloto-service";
import { getMonthlyAiUsageForUser, getLatestVesselPositionsByTenant } from "./usage/usage-service";
import { parseUploadedFile, assertFileSize } from "./copiloto/file-parser-service";
import { listTenantAssets } from "./assets/assets-service";
import { listTenantAttachments, registerAttachmentRecord, softDeleteTenantAttachment } from "./attachments/attachments-service";
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
import { listTenantMaintenancePlans, getTenantMaintenancePlansSummary, getMaintenanceWorkloadProjection } from "./maintenance-plans/maintenance-plans-service";
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
import {
  listCrew, getCrew, createCrew, updateCrew, signOffCrew, reopenCrew, deleteCrew,
} from "./crew/crew-service";
import {
  listCertifications, createCertification, updateCertification, deleteCertification,
} from "./crew/certifications-service";
import {
  listDrills, getDrill, createDrill, updateDrill, completeDrill, cancelDrill, reopenDrill, deleteDrill,
  getDrillsMatrix, listDrillConfig, upsertDrillConfig,
} from "./drills/drills-service";
import { suggestDrillScenario } from "./drills/drills-ai-suggestions";
import { buildDrillPdf } from "./drills/drills-pdf-service";
import { getCrewSummary } from "./crew/crew-summary-service";
import {
  listPermits, getPermit, createPermit, updatePermit,
  requestPermit, approvePermit, rejectPermit, activatePermit, closePermit, cancelPermit, reopenPermit, deletePermit,
} from "./permits/permits-service";
import { listGasTests, createGasTest, deleteGasTest } from "./permits/gas-tests-service";
import { listParticipants, createParticipant, deleteParticipant } from "./permits/participants-service";
import { buildPermitPdf } from "./permits/permit-pdf-service";
import { getPermitsSummary } from "./permits/permits-summary-service";
import { suggestPermitHazards, suggestPermitControls, suggestPermitPpe } from "./permits/permits-ai-suggestions";
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

  if (method === "GET" && url.pathname === "/app/dashboard/mp-summary") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const summary = await getTenantMaintenancePlansSummary(session, {
      vesselCode: url.searchParams.get("vesselCode"),
    });
    sendJson(response, 200, summary);
    return true;
  }

  if (method === "GET" && url.pathname === "/app/dashboard/maintenance-workload") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const weeksParam = parseInt(url.searchParams.get("weeks") ?? "52", 10);
    const projection = await getMaintenanceWorkloadProjection(session, {
      vesselCode: url.searchParams.get("vesselCode"),
      weeks: isNaN(weeksParam) ? 52 : weeksParam,
    });
    sendJson(response, 200, projection);
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
    const entityId   = url.searchParams.get("entityId");
    const rawName = request.headers["x-filename"];
    const originalName = decodeURIComponent(Array.isArray(rawName) ? rawName[0] : rawName ?? "archivo");
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const buffer = Buffer.concat(chunks);
    if (!buffer.length) throw new RouteError(400, "EMPTY_BODY", "El archivo está vacío.");
    const result = await saveAttachment(session.tenantSlug, entityType, originalName, buffer);
    // Si el caller dio entityType + entityId, registramos también en tabla Attachment
    // para que después se puedan listar / borrar. Best-effort: si falla, el archivo
    // sigue accesible vía URL pero no aparecerá en /app/attachments.
    let attachmentId: string | null = null;
    try {
      attachmentId = await registerAttachmentRecord(session, { entityType, entityId, originalName, savedUrl: result.url, sizeBytes: buffer.length });
    } catch (err) {
      // log silencioso — no romper upload por fallar el registro
      // (se ve igual el archivo via URL)
      void err;
    }
    sendJson(response, 200, { ...result, attachmentId });
    return true;
  }

  if (method === "GET" && url.pathname === "/app/attachments") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const records = await listTenantAttachments(session, {
      vesselCode:  url.searchParams.get("vesselCode"),
      status:      url.searchParams.get("status"),
      targetType:  url.searchParams.get("targetType"),
      targetId:    url.searchParams.get("targetId"),
    });
    sendJson(response, 200, { items: records, total: records.length });
    return true;
  }

  if (method === "DELETE" && /^\/app\/attachments\/[^/]+$/.test(url.pathname)) {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const id = url.pathname.split("/").pop()!;
    await softDeleteTenantAttachment(session, id);
    sendJson(response, 200, { ok: true });
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
    const session = requireTenantAccessSession(request, slug);
    enforceRateLimit(request, `ai-parse-file:${session.user.id}`, { maxRequests: 15, windowMs: 60_000 });

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
    // Validar capability contra whitelist — antes pasaba cualquier string
    // y el get del prompt podía cargar capabilities no autorizadas.
    const capability = ensureCapability(body.capability ?? "knowledge_assistant");

    // Si el cliente cierra la conexión (cerrar pestaña, navegar fuera),
    // cancelamos la llamada a Claude vía AbortSignal. Antes el stream
    // seguía consumiendo tokens hasta que terminara la respuesta completa.
    const abortController = new AbortController();
    response.on("close", () => abortController.abort());

    try {
      await streamCopilotoChat(
        {
          capability,
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
          abortSignal:    abortController.signal,
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
    enforceRateLimit(request, `ai-analyze:${session.user.id}`, { maxRequests: 30, windowMs: 60_000 });
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
    enforceRateLimit(request, `ai-analyze:${session.user.id}`, { maxRequests: 30, windowMs: 60_000 });
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

  // ── Crew / Tripulación ─────────────────────────────────────────────────────
  if (method === "GET" && url.pathname === "/app/crew") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const items = await listCrew(session, {
      vesselCode: url.searchParams.get("vesselCode"),
      status:     url.searchParams.get("status"),
      rank:       url.searchParams.get("rank"),
    });
    sendJson(response, 200, { items, total: items.length });
    return true;
  }
  if (method === "POST" && url.pathname === "/app/crew") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const body = await readJsonBody(request) as Parameters<typeof createCrew>[1];
    sendJson(response, 201, await createCrew(session, body));
    return true;
  }
  if (method === "POST" && /^\/app\/crew\/[^/]+\/sign-off$/.test(url.pathname)) {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const id = url.pathname.split("/")[3]!;
    const body = await readJsonBody(request) as Parameters<typeof signOffCrew>[2];
    sendJson(response, 200, await signOffCrew(session, id, body));
    return true;
  }
  if (method === "POST" && /^\/app\/crew\/[^/]+\/reopen$/.test(url.pathname)) {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const id = url.pathname.split("/")[3]!;
    const body = await readJsonBody(request) as Parameters<typeof reopenCrew>[2];
    sendJson(response, 200, await reopenCrew(session, id, body));
    return true;
  }
  if (method === "GET" && /^\/app\/crew\/[^/]+\/certifications$/.test(url.pathname)) {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const crewId = url.pathname.split("/")[3]!;
    const items = await listCertifications(session, crewId);
    sendJson(response, 200, { items, total: items.length });
    return true;
  }
  if (method === "POST" && /^\/app\/crew\/[^/]+\/certifications$/.test(url.pathname)) {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const crewId = url.pathname.split("/")[3]!;
    const body = await readJsonBody(request) as Parameters<typeof createCertification>[2];
    sendJson(response, 201, await createCertification(session, crewId, body));
    return true;
  }
  if (/^\/app\/crew\/[^/]+\/certifications\/[^/]+$/.test(url.pathname)) {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const parts = url.pathname.split("/");
    const crewId = parts[3]!;
    const certId = parts[5]!;
    if (method === "PATCH") {
      const body = await readJsonBody(request) as Parameters<typeof updateCertification>[3];
      sendJson(response, 200, await updateCertification(session, crewId, certId, body));
      return true;
    }
    if (method === "DELETE") {
      await deleteCertification(session, crewId, certId);
      sendJson(response, 200, { ok: true });
      return true;
    }
  }
  if (/^\/app\/crew\/[^/]+$/.test(url.pathname)) {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const id = url.pathname.split("/")[3]!;
    if (method === "GET") {
      sendJson(response, 200, await getCrew(session, id));
      return true;
    }
    if (method === "PATCH") {
      const body = await readJsonBody(request) as Parameters<typeof updateCrew>[2];
      sendJson(response, 200, await updateCrew(session, id, body));
      return true;
    }
    if (method === "DELETE") {
      await deleteCrew(session, id);
      sendJson(response, 200, { ok: true });
      return true;
    }
  }

  // ── Drills / Simulacros ────────────────────────────────────────────────────
  if (method === "GET" && url.pathname === "/app/drills/matrix") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const matrix = await getDrillsMatrix(session, { vesselCode: url.searchParams.get("vesselCode") });
    sendJson(response, 200, matrix);
    return true;
  }
  if (method === "GET" && url.pathname === "/app/drills/config") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    sendJson(response, 200, await listDrillConfig(session));
    return true;
  }
  if (method === "PATCH" && /^\/app\/drills\/config\/[A-Z_]+$/.test(url.pathname)) {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const type = url.pathname.split("/")[4]!;
    const body = await readJsonBody(request) as Parameters<typeof upsertDrillConfig>[2];
    sendJson(response, 200, await upsertDrillConfig(session, type, body));
    return true;
  }
  if (method === "POST" && url.pathname === "/app/drills/suggest-scenario") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const body = await readJsonBody(request) as Parameters<typeof suggestDrillScenario>[1];
    sendJson(response, 200, await suggestDrillScenario(session, body));
    return true;
  }
  if (method === "GET" && /^\/app\/drills\/[^/]+\/pdf$/.test(url.pathname)) {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const id = url.pathname.split("/")[3]!;
    const drill = await getDrill(session, id) as { drillCode: string };
    const buffer = await buildDrillPdf(session, id);
    response.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${drill.drillCode}.pdf"`,
      "Content-Length": buffer.length,
    });
    response.end(buffer);
    return true;
  }
  if (method === "GET" && url.pathname === "/app/drills") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const items = await listDrills(session, {
      vesselCode: url.searchParams.get("vesselCode"),
      status:     url.searchParams.get("status"),
      type:       url.searchParams.get("type"),
    });
    sendJson(response, 200, { items, total: items.length });
    return true;
  }
  if (method === "POST" && url.pathname === "/app/drills") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const body = await readJsonBody(request) as Parameters<typeof createDrill>[1];
    sendJson(response, 201, await createDrill(session, body));
    return true;
  }
  if (method === "POST" && /^\/app\/drills\/[^/]+\/complete$/.test(url.pathname)) {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const id = url.pathname.split("/")[3]!;
    const body = await readJsonBody(request) as Parameters<typeof completeDrill>[2];
    sendJson(response, 200, await completeDrill(session, id, body));
    return true;
  }
  if (method === "POST" && /^\/app\/drills\/[^/]+\/cancel$/.test(url.pathname)) {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const id = url.pathname.split("/")[3]!;
    const body = await readJsonBody(request) as Parameters<typeof cancelDrill>[2];
    sendJson(response, 200, await cancelDrill(session, id, body));
    return true;
  }
  if (method === "POST" && /^\/app\/drills\/[^/]+\/reopen$/.test(url.pathname)) {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const id = url.pathname.split("/")[3]!;
    const body = await readJsonBody(request) as Parameters<typeof reopenDrill>[2];
    sendJson(response, 200, await reopenDrill(session, id, body));
    return true;
  }
  if (/^\/app\/drills\/[^/]+$/.test(url.pathname)) {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const id = url.pathname.split("/")[3]!;
    if (method === "GET") {
      sendJson(response, 200, await getDrill(session, id));
      return true;
    }
    if (method === "PATCH") {
      const body = await readJsonBody(request) as Parameters<typeof updateDrill>[2];
      sendJson(response, 200, await updateDrill(session, id, body));
      return true;
    }
    if (method === "DELETE") {
      await deleteDrill(session, id);
      sendJson(response, 200, { ok: true });
      return true;
    }
  }

  // ── External Audits (SIRE 2.0 Ch. 4 — PSC / Flag / Class / Vetting) ────────
  if (method === "GET" && url.pathname === "/app/external-audits") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const items = await listExternalAudits(session, {
      vesselCode: url.searchParams.get("vesselCode"),
      auditType:  url.searchParams.get("auditType"),
      fromDate:   url.searchParams.get("fromDate"),
      toDate:     url.searchParams.get("toDate"),
    });
    sendJson(response, 200, { items, total: items.length });
    return true;
  }
  if (method === "POST" && url.pathname === "/app/external-audits") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const body = await readJsonBody(request) as Parameters<typeof createExternalAudit>[1];
    sendJson(response, 201, await createExternalAudit(session, body));
    return true;
  }
  if (/^\/app\/external-audits\/[^/]+\/findings$/.test(url.pathname)) {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const id = url.pathname.split("/")[3]!;
    if (method === "POST") {
      const body = await readJsonBody(request) as Parameters<typeof createFinding>[2];
      sendJson(response, 201, await createFinding(session, id, body));
      return true;
    }
  }
  if (/^\/app\/external-audits\/[^/]+\/findings\/[^/]+$/.test(url.pathname)) {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const parts = url.pathname.split("/");
    const auditId = parts[3]!;
    const findingId = parts[5]!;
    if (method === "PATCH") {
      const body = await readJsonBody(request) as Parameters<typeof updateFinding>[3];
      sendJson(response, 200, await updateFinding(session, auditId, findingId, body));
      return true;
    }
    if (method === "DELETE") {
      await deleteFinding(session, auditId, findingId);
      sendJson(response, 200, { ok: true });
      return true;
    }
  }
  if (/^\/app\/external-audits\/[^/]+$/.test(url.pathname)) {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const id = url.pathname.split("/")[3]!;
    if (method === "GET") { sendJson(response, 200, await getExternalAudit(session, id)); return true; }
    if (method === "PATCH") {
      const body = await readJsonBody(request) as Parameters<typeof updateExternalAudit>[2];
      sendJson(response, 200, await updateExternalAudit(session, id, body));
      return true;
    }
    if (method === "DELETE") {
      await softDeleteExternalAudit(session, id);
      sendJson(response, 200, { ok: true });
      return true;
    }
  }

  // ── Near Miss / Hazard Observations (SIRE 2.0 Ch. 4 Safety culture) ────────
  if (method === "GET" && url.pathname === "/app/near-miss") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const items = await listNearMisses(session, {
      vesselCode: url.searchParams.get("vesselCode"),
      category:   url.searchParams.get("category"),
      status:     url.searchParams.get("status"),
      severity:   url.searchParams.get("severity"),
    });
    sendJson(response, 200, { items, total: items.length });
    return true;
  }
  if (method === "POST" && url.pathname === "/app/near-miss") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const body = await readJsonBody(request) as Parameters<typeof createNearMiss>[1];
    sendJson(response, 201, await createNearMiss(session, body));
    return true;
  }
  if (/^\/app\/near-miss\/[^/]+$/.test(url.pathname)) {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const id = url.pathname.split("/")[3]!;
    if (method === "GET") { sendJson(response, 200, await getNearMiss(session, id)); return true; }
    if (method === "PATCH") {
      const body = await readJsonBody(request) as Parameters<typeof updateNearMiss>[2];
      sendJson(response, 200, await updateNearMiss(session, id, body));
      return true;
    }
    if (method === "DELETE") {
      await deleteNearMiss(session, id);
      sendJson(response, 200, { ok: true });
      return true;
    }
  }

  // ── Hours of Rest (STCW Manila / MLC 2006) ─────────────────────────────────
  if (method === "GET" && url.pathname === "/app/rest-hours") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const items = await listRestHours(session, {
      vesselCode:     url.searchParams.get("vesselCode"),
      crewId:         url.searchParams.get("crewId"),
      fromDate:       url.searchParams.get("fromDate"),
      toDate:         url.searchParams.get("toDate"),
      onlyViolations: url.searchParams.get("onlyViolations") === "true",
    });
    sendJson(response, 200, { items, total: items.length });
    return true;
  }
  if (method === "GET" && url.pathname === "/app/rest-hours/monthly") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const vesselCode = url.searchParams.get("vesselCode") ?? "";
    const year  = parseInt(url.searchParams.get("year")  ?? "0", 10);
    const month = parseInt(url.searchParams.get("month") ?? "0", 10);
    if (!vesselCode || !year || !month) throw new RouteError(400, "VALIDATION_ERROR", "vesselCode, year y month requeridos.");
    sendJson(response, 200, await monthlySnapshot(session, { vesselCode, year, month }));
    return true;
  }
  if (method === "POST" && url.pathname === "/app/rest-hours") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const body = await readJsonBody(request) as Parameters<typeof upsertRestHours>[1];
    sendJson(response, 200, await upsertRestHours(session, body));
    return true;
  }
  if (method === "DELETE" && /^\/app\/rest-hours\/[^/]+$/.test(url.pathname)) {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const id = url.pathname.split("/")[3]!;
    await deleteRestHoursDay(session, id);
    sendJson(response, 200, { ok: true });
    return true;
  }

  // ── Checklists (Pre-Arrival / Pre-Departure / etc.) ───────────────────────
  if (method === "GET" && url.pathname === "/app/checklist-templates") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const items = await listTemplates(session, { type: url.searchParams.get("type") });
    sendJson(response, 200, { items, total: items.length });
    return true;
  }
  if (method === "POST" && url.pathname === "/app/checklist-templates") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const body = await readJsonBody(request) as Parameters<typeof createTemplate>[1];
    sendJson(response, 201, await createTemplate(session, body));
    return true;
  }
  if (/^\/app\/checklist-templates\/[^/]+$/.test(url.pathname)) {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const id = url.pathname.split("/")[3]!;
    if (method === "GET") { sendJson(response, 200, await getTemplate(session, id)); return true; }
    if (method === "PATCH") {
      const body = await readJsonBody(request) as Parameters<typeof updateTemplate>[2];
      sendJson(response, 200, await updateTemplate(session, id, body));
      return true;
    }
  }

  if (method === "GET" && url.pathname === "/app/checklist-executions") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const items = await listExecutions(session, {
      vesselCode: url.searchParams.get("vesselCode"),
      type:       url.searchParams.get("type"),
      status:     url.searchParams.get("status"),
    });
    sendJson(response, 200, { items, total: items.length });
    return true;
  }
  if (method === "POST" && url.pathname === "/app/checklist-executions") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const body = await readJsonBody(request) as Parameters<typeof createExecution>[1];
    sendJson(response, 201, await createExecution(session, body));
    return true;
  }
  if (/^\/app\/checklist-executions\/[^/]+\/responses$/.test(url.pathname)) {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const id = url.pathname.split("/")[3]!;
    if (method === "POST") {
      const body = await readJsonBody(request) as Parameters<typeof setResponse>[2];
      sendJson(response, 200, await setResponse(session, id, body));
      return true;
    }
  }
  if (/^\/app\/checklist-executions\/[^/]+$/.test(url.pathname)) {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const id = url.pathname.split("/")[3]!;
    if (method === "GET") { sendJson(response, 200, await getExecution(session, id)); return true; }
    if (method === "PATCH") {
      const body = await readJsonBody(request) as Parameters<typeof updateExecution>[2];
      sendJson(response, 200, await updateExecution(session, id, body));
      return true;
    }
    if (method === "DELETE") { await deleteExecution(session, id); sendJson(response, 200, { ok: true }); return true; }
  }

  // ── Crew Capability Matrix ────────────────────────────────────────────────
  if (method === "GET" && url.pathname === "/app/crew-matrix") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    sendJson(response, 200, await getMatrix(session, {
      vesselCode: url.searchParams.get("vesselCode"),
      area:       url.searchParams.get("area"),
    }));
    return true;
  }
  if (method === "POST" && url.pathname === "/app/crew-matrix") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const body = await readJsonBody(request) as Parameters<typeof upsertCapability>[1];
    sendJson(response, 200, await upsertCapability(session, body));
    return true;
  }
  if (method === "DELETE" && /^\/app\/crew-matrix\/[^/]+\/[^/]+$/.test(url.pathname)) {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const parts = url.pathname.split("/");
    const crewId = parts[3]!;
    const area = parts[4]!;
    await deleteCapability(session, crewId, area);
    sendJson(response, 200, { ok: true });
    return true;
  }

  // ── Management of Change (MOC) ────────────────────────────────────────────
  if (method === "GET" && url.pathname === "/app/mocs") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const items = await listMocs(session, {
      vesselCode: url.searchParams.get("vesselCode"),
      status:     url.searchParams.get("status"),
      category:   url.searchParams.get("category"),
    });
    sendJson(response, 200, { items, total: items.length });
    return true;
  }
  if (method === "POST" && url.pathname === "/app/mocs") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const body = await readJsonBody(request) as Parameters<typeof createMoc>[1];
    sendJson(response, 201, await createMoc(session, body));
    return true;
  }
  if (/^\/app\/mocs\/[^/]+\/transition$/.test(url.pathname)) {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const id = url.pathname.split("/")[3]!;
    if (method === "POST") {
      const body = await readJsonBody(request) as Parameters<typeof transitionMoc>[2];
      sendJson(response, 200, await transitionMoc(session, id, body));
      return true;
    }
  }
  if (/^\/app\/mocs\/[^/]+$/.test(url.pathname)) {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const id = url.pathname.split("/")[3]!;
    if (method === "GET") { sendJson(response, 200, await getMoc(session, id)); return true; }
    if (method === "PATCH") {
      const body = await readJsonBody(request) as Parameters<typeof updateMoc>[2];
      sendJson(response, 200, await updateMoc(session, id, body));
      return true;
    }
    if (method === "DELETE") { await deleteMoc(session, id); sendJson(response, 200, { ok: true }); return true; }
  }

  // ── CVIQ self-assessment ──────────────────────────────────────────────────
  if (method === "GET" && url.pathname === "/app/cviq/questions") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const items = await listQuestions(session);
    sendJson(response, 200, { items, total: items.length });
    return true;
  }
  if (method === "GET" && url.pathname === "/app/cviq/assessments") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const items = await listAssessments(session, {
      vesselCode: url.searchParams.get("vesselCode"),
      status:     url.searchParams.get("status"),
    });
    sendJson(response, 200, { items, total: items.length });
    return true;
  }
  if (method === "POST" && url.pathname === "/app/cviq/assessments") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const body = await readJsonBody(request) as Parameters<typeof createAssessment>[1];
    sendJson(response, 201, await createAssessment(session, body));
    return true;
  }
  if (/^\/app\/cviq\/assessments\/[^/]+\/responses$/.test(url.pathname)) {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const id = url.pathname.split("/")[4]!;
    if (method === "POST") {
      const body = await readJsonBody(request) as Parameters<typeof setResponseCviq>[2];
      sendJson(response, 200, await setResponseCviq(session, id, body));
      return true;
    }
  }
  if (/^\/app\/cviq\/assessments\/[^/]+\/complete$/.test(url.pathname)) {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const id = url.pathname.split("/")[4]!;
    if (method === "POST") { sendJson(response, 200, await completeAssessment(session, id)); return true; }
  }
  if (/^\/app\/cviq\/assessments\/[^/]+$/.test(url.pathname)) {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const id = url.pathname.split("/")[4]!;
    if (method === "GET") { sendJson(response, 200, await getAssessment(session, id)); return true; }
    if (method === "DELETE") { await deleteAssessment(session, id); sendJson(response, 200, { ok: true }); return true; }
  }

  // ── Compliance scores + smart alerts ──────────────────────────────────────
  if (method === "GET" && url.pathname === "/app/compliance/scores") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const vesselCode = url.searchParams.get("vesselCode");
    sendJson(response, 200, await getComplianceScores(session, vesselCode));
    return true;
  }
  if (method === "GET" && url.pathname === "/app/compliance/alerts") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const vesselCode = url.searchParams.get("vesselCode");
    sendJson(response, 200, await getSmartAlerts(session, vesselCode));
    return true;
  }

  // ── Sidebar counts (badges) ───────────────────────────────────────────────
  if (method === "GET" && url.pathname === "/app/dashboard/sidebar-counts") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const vesselCode = url.searchParams.get("vesselCode");
    sendJson(response, 200, await getSidebarCounts(session, vesselCode));
    return true;
  }

  // ── Crew dashboard summary ─────────────────────────────────────────────────
  if (method === "GET" && url.pathname === "/app/dashboard/crew-summary") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const summary = await getCrewSummary(session, { vesselCode: url.searchParams.get("vesselCode") });
    sendJson(response, 200, summary);
    return true;
  }

  // ── Permits dashboard summary ──────────────────────────────────────────────
  if (method === "GET" && url.pathname === "/app/dashboard/permits-summary") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const summary = await getPermitsSummary(session, { vesselCode: url.searchParams.get("vesselCode") });
    sendJson(response, 200, summary);
    return true;
  }

  // ── Permits AI suggestions ─────────────────────────────────────────────────
  if (method === "POST" && url.pathname === "/app/permits/suggest-hazards") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    enforceRateLimit(request, `ai:${session.user.id}`, { maxRequests: 30, windowMs: 60_000 });
    const body = await readJsonBody<Parameters<typeof suggestPermitHazards>[1]>(request);
    sendJson(response, 200, await suggestPermitHazards(session, body));
    return true;
  }
  if (method === "POST" && url.pathname === "/app/permits/suggest-controls") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    enforceRateLimit(request, `ai:${session.user.id}`, { maxRequests: 30, windowMs: 60_000 });
    const body = await readJsonBody<Parameters<typeof suggestPermitControls>[1]>(request);
    sendJson(response, 200, await suggestPermitControls(session, body));
    return true;
  }
  if (method === "POST" && url.pathname === "/app/permits/suggest-ppe") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    enforceRateLimit(request, `ai:${session.user.id}`, { maxRequests: 30, windowMs: 60_000 });
    const body = await readJsonBody<Parameters<typeof suggestPermitPpe>[1]>(request);
    sendJson(response, 200, await suggestPermitPpe(session, body));
    return true;
  }

  // ── Permits (PTW) ──────────────────────────────────────────────────────────
  if (method === "GET" && url.pathname === "/app/permits") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const items = await listPermits(session, {
      vesselCode:  url.searchParams.get("vesselCode"),
      status:      url.searchParams.get("status"),
      type:        url.searchParams.get("type"),
      workOrderId: url.searchParams.get("workOrderId"),
    });
    sendJson(response, 200, { items, total: items.length });
    return true;
  }
  if (method === "POST" && url.pathname === "/app/permits") {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const body = await readJsonBody(request) as Parameters<typeof createPermit>[1];
    sendJson(response, 201, await createPermit(session, body));
    return true;
  }
  if (method === "GET" && /^\/app\/permits\/[^/]+\/pdf$/.test(url.pathname)) {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    enforceRateLimit(request, `pdf:${session.user.id}`, { maxRequests: 10, windowMs: 60_000 });
    const id = url.pathname.split("/")[3]!;
    const permit = await getPermit(session, id) as unknown as { permitCode: string };
    const buffer = await buildPermitPdf(session, id);
    response.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${permit.permitCode}.pdf"`,
      "Content-Length": buffer.length,
    });
    response.end(buffer);
    return true;
  }
  if (method === "POST" && /^\/app\/permits\/[^/]+\/request$/.test(url.pathname)) {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const id = url.pathname.split("/")[3]!;
    sendJson(response, 200, await requestPermit(session, id));
    return true;
  }
  if (method === "POST" && /^\/app\/permits\/[^/]+\/approve$/.test(url.pathname)) {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const id = url.pathname.split("/")[3]!;
    const body = await readJsonBody(request) as Parameters<typeof approvePermit>[2];
    sendJson(response, 200, await approvePermit(session, id, body));
    return true;
  }
  if (method === "POST" && /^\/app\/permits\/[^/]+\/reject$/.test(url.pathname)) {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const id = url.pathname.split("/")[3]!;
    const body = await readJsonBody(request) as Parameters<typeof rejectPermit>[2];
    sendJson(response, 200, await rejectPermit(session, id, body));
    return true;
  }
  if (method === "POST" && /^\/app\/permits\/[^/]+\/activate$/.test(url.pathname)) {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const id = url.pathname.split("/")[3]!;
    sendJson(response, 200, await activatePermit(session, id));
    return true;
  }
  if (method === "POST" && /^\/app\/permits\/[^/]+\/close$/.test(url.pathname)) {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const id = url.pathname.split("/")[3]!;
    const body = await readJsonBody(request) as Parameters<typeof closePermit>[2];
    sendJson(response, 200, await closePermit(session, id, body));
    return true;
  }
  if (method === "POST" && /^\/app\/permits\/[^/]+\/cancel$/.test(url.pathname)) {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const id = url.pathname.split("/")[3]!;
    const body = await readJsonBody(request) as Parameters<typeof cancelPermit>[2];
    sendJson(response, 200, await cancelPermit(session, id, body));
    return true;
  }
  if (method === "POST" && /^\/app\/permits\/[^/]+\/reopen$/.test(url.pathname)) {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const id = url.pathname.split("/")[3]!;
    const body = await readJsonBody(request) as Parameters<typeof reopenPermit>[2];
    sendJson(response, 200, await reopenPermit(session, id, body));
    return true;
  }
  if (method === "GET" && /^\/app\/permits\/[^/]+\/gas-tests$/.test(url.pathname)) {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const permitId = url.pathname.split("/")[3]!;
    const items = await listGasTests(session, permitId);
    sendJson(response, 200, { items, total: items.length });
    return true;
  }
  if (method === "POST" && /^\/app\/permits\/[^/]+\/gas-tests$/.test(url.pathname)) {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const permitId = url.pathname.split("/")[3]!;
    const body = await readJsonBody(request) as Parameters<typeof createGasTest>[2];
    sendJson(response, 201, await createGasTest(session, permitId, body));
    return true;
  }
  if (method === "DELETE" && /^\/app\/permits\/[^/]+\/gas-tests\/[^/]+$/.test(url.pathname)) {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const parts = url.pathname.split("/");
    await deleteGasTest(session, parts[3]!, parts[5]!);
    sendJson(response, 200, { ok: true });
    return true;
  }
  if (method === "GET" && /^\/app\/permits\/[^/]+\/participants$/.test(url.pathname)) {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const permitId = url.pathname.split("/")[3]!;
    const items = await listParticipants(session, permitId);
    sendJson(response, 200, { items, total: items.length });
    return true;
  }
  if (method === "POST" && /^\/app\/permits\/[^/]+\/participants$/.test(url.pathname)) {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const permitId = url.pathname.split("/")[3]!;
    const body = await readJsonBody(request) as Parameters<typeof createParticipant>[2];
    sendJson(response, 201, await createParticipant(session, permitId, body));
    return true;
  }
  if (method === "DELETE" && /^\/app\/permits\/[^/]+\/participants\/[^/]+$/.test(url.pathname)) {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const parts = url.pathname.split("/");
    await deleteParticipant(session, parts[3]!, parts[5]!);
    sendJson(response, 200, { ok: true });
    return true;
  }
  if (/^\/app\/permits\/[^/]+$/.test(url.pathname)) {
    const session = requireTenantAccessSession(request, requireTenantSlug(request, env));
    const id = url.pathname.split("/")[3]!;
    if (method === "GET") {
      sendJson(response, 200, await getPermit(session, id));
      return true;
    }
    if (method === "PATCH") {
      const body = await readJsonBody(request) as Parameters<typeof updatePermit>[2];
      sendJson(response, 200, await updatePermit(session, id, body));
      return true;
    }
    if (method === "DELETE") {
      await deletePermit(session, id);
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
