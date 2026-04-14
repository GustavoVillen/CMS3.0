import { createServer } from "node:http";
import { serveStaticFile, serveSpaHtml } from "./http/static-files";
import { loadDotEnvFile } from "./config/load-dotenv";
import { parseAppEnv } from "./config/env";
import { sendHtml } from "./http/html-response";
import { sendJson } from "./http/json-response";
import { readJsonBody } from "./http/read-json-body";
import { toErrorPayload, RouteError } from "./http/route-error";
import { getRequestUrl } from "./http/request-url";
import { buildHealthcheckPayload } from "./health/health-route";
import { loginPlatformUser, refreshPlatformSession } from "./platform/auth/platform-auth-service";
import { requirePlatformAccessSession, requirePlatformSuperadmin } from "./platform/auth/platform-route-auth";
import { buildHomePage } from "./platform/home/home-page";
import { listPlatformAuditEvents } from "./platform/audit/platform-audit-service";
import {
  createPlatformTenant,
  getPlatformTenant,
  listPlatformTenants,
  updatePlatformTenant,
} from "./platform/tenants/platform-tenants-service";
import {
  createPlatformTenantDomain,
  listPlatformTenantDomains,
  updatePlatformTenantDomain,
} from "./platform/tenants/platform-tenant-domains-service";
import {
  createPlatformTenantInvitation,
  listPlatformTenantInvitations,
} from "./platform/tenants/platform-tenant-invitations-service";
import {
  createPlatformTenantUser,
  getPlatformTenantUser,
  listPlatformTenantUsers,
  updatePlatformTenantUser,
} from "./platform/tenants/platform-tenant-users-service";
import {
  createPlatformPrompt,
  getPlatformPrompt,
  listPlatformPrompts,
  publishPlatformPrompt,
  rollbackPlatformPrompt,
  updatePlatformPrompt,
} from "./platform/prompts/platform-prompts-service";
import {
  createPlatformUser,
  getPlatformUser,
  listPlatformUsers,
  updatePlatformUser,
} from "./platform/users/platform-users-service";
import { listTenantAiInsights } from "./tenant/ai-insights/ai-insights-service";
import { listTenantAssets } from "./tenant/assets/assets-service";
import { listTenantAttachments } from "./tenant/attachments/attachments-service";
import { listTenantCapas } from "./tenant/capa/capa-service";
import { listTenantCertificates } from "./tenant/certificates/certificates-service";
import { listTenantDailyReports } from "./tenant/daily-reports/daily-reports-service";
import { listTenantDeferrals } from "./tenant/deferrals/deferrals-service";
import { listTenantDefects } from "./tenant/defects/defects-service";
import { listTenantDomainEvents } from "./tenant/domain-events/domain-events-service";
import { listTenantMaintenancePlans } from "./tenant/maintenance-plans/maintenance-plans-service";
import { listTenantInspectionLogs } from "./tenant/inspection-logs/inspection-logs-service";
import { listTenantInspections } from "./tenant/inspections/inspections-service";
import { acceptTenantInvitation } from "./tenant/invitations/tenant-invitations-service";
import { listTenantProviders } from "./tenant/providers/providers-service";
import { listTenantProviderEvaluations } from "./tenant/provider-evaluations/provider-evaluations-service";
import { listTenantProviderNonconformities } from "./tenant/provider-nonconformities/provider-nonconformities-service";
import { listTenantRcas } from "./tenant/rca/rca-service";
import { listTenantSpares } from "./tenant/spares/spares-service";
import { listTenantSpareOrders } from "./tenant/spare-orders/spare-orders-service";
import { listTenantStockMovements } from "./tenant/stock-movements/stock-movements-service";
import { handlePublicBootstrapRequest, resolveTenantSlugFromRequest } from "./tenant/bootstrap/public-bootstrap-route";
import { loginTenantUser, refreshTenantSession } from "./tenant/auth/tenant-auth-service";
import { registerPlatformAccessSession, registerTenantAccessSession } from "./tenant/auth/session-store";
import { requireTenantAccessSession } from "./tenant/auth/tenant-route-auth";
import { listTenantVessels } from "./tenant/vessels/vessels-service";
import { listTenantWorkOrders } from "./tenant/work-orders/work-orders-service";

loadDotEnvFile();

const env = parseAppEnv(process.env as Record<string, string | undefined>);
const port = Number(process.env.PORT || 3105);

const server = createServer(async (request, response) => {
  const method = String(request.method || "GET").toUpperCase();
  const requestUrl = getRequestUrl(request);

  if (method === "GET" && requestUrl.pathname === "/") {
    sendHtml(response, 200, buildHomePage(env));
    return;
  }

  if (method === "GET" && requestUrl.pathname === "/health") {
    sendJson(response, 200, buildHealthcheckPayload());
    return;
  }

  if (method === "GET" && requestUrl.pathname === "/public/bootstrap") {
    const result = await handlePublicBootstrapRequest(request, env);
    sendJson(response, result.statusCode, result.payload);
    return;
  }

  try {
    if (method === "POST" && requestUrl.pathname === "/app/auth/login") {
      const tenantSlug = resolveTenantSlugFromRequest(request, env);
      if (!tenantSlug) {
        throw new RouteError(400, "TENANT_UNRESOLVED", "Unable to resolve tenant for login.");
      }

      const payload = await readJsonBody<{ identifier: string; password: string; locale?: string | null }>(request);
      const result = await loginTenantUser(tenantSlug, payload);
      registerTenantAccessSession({
        kind: "tenant",
        tenantSlug,
        accessToken: result.session.accessToken,
        refreshToken: result.session.refreshToken,
        accessTokenExpiresAt: result.session.accessTokenExpiresAt,
        user: result.user,
      });
      sendJson(response, 200, result);
      return;
    }

    if (method === "POST" && requestUrl.pathname === "/app/invitations/accept") {
      const tenantSlug = resolveTenantSlugFromRequest(request, env);
      if (!tenantSlug) {
        throw new RouteError(400, "TENANT_UNRESOLVED", "Unable to resolve tenant for invitation acceptance.");
      }

      const payload = await readJsonBody<{
        token: string;
        password: string;
        firstName: string;
        lastName: string;
        legacyUserId?: string | null;
        preferredLocale?: "es" | "en" | "pt";
      }>(request);
      const result = await acceptTenantInvitation(tenantSlug, payload);
      sendJson(response, 200, result);
      return;
    }

    if (method === "POST" && requestUrl.pathname === "/app/auth/refresh") {
      const tenantSlug = resolveTenantSlugFromRequest(request, env);
      if (!tenantSlug) {
        throw new RouteError(400, "TENANT_UNRESOLVED", "Unable to resolve tenant for refresh.");
      }

      const payload = await readJsonBody<{ refreshToken: string }>(request);
      const result = await refreshTenantSession(tenantSlug, payload);
      sendJson(response, 200, result);
      return;
    }

    if (method === "POST" && requestUrl.pathname === "/platform/auth/login") {
      const payload = await readJsonBody<{ email: string; password: string }>(request);
      const result = await loginPlatformUser(payload);
      registerPlatformAccessSession({
        kind: "platform",
        accessToken: result.session.accessToken,
        refreshToken: result.session.refreshToken,
        accessTokenExpiresAt: result.session.accessTokenExpiresAt,
        user: result.user,
      });
      sendJson(response, 200, result);
      return;
    }

    if (method === "POST" && requestUrl.pathname === "/platform/auth/refresh") {
      const payload = await readJsonBody<{ refreshToken: string }>(request);
      const result = await refreshPlatformSession(payload);
      sendJson(response, 200, result);
      return;
    }

    if (method === "GET" && requestUrl.pathname === "/platform/tenants") {
      const session = requirePlatformAccessSession(request);
      requirePlatformSuperadmin(session);
      const status = requestUrl.searchParams.get("status");
      const slug = requestUrl.searchParams.get("slug");
      const records = await listPlatformTenants({ status, slug });
      sendJson(response, 200, {
        items: records,
        total: records.length,
      });
      return;
    }

    if (method === "POST" && requestUrl.pathname === "/platform/tenants") {
      const session = requirePlatformAccessSession(request);
      requirePlatformSuperadmin(session);
      const payload = await readJsonBody<{
        slug: string;
        status?: "ACTIVE" | "SUSPENDED" | "DISABLED";
        displayName: string;
        logoUrl?: string | null;
        primaryColor?: string | null;
        supportEmail: string;
        defaultLocale: "es" | "en" | "pt";
        enabledLocales: ("es" | "en" | "pt")[];
        timezone: string;
        currency: string;
      }>(request);
      const record = await createPlatformTenant(payload);
      sendJson(response, 201, record);
      return;
    }

    const platformTenantMatch = requestUrl.pathname.match(/^\/platform\/tenants\/([a-z0-9-]+)$/);
    if (platformTenantMatch && method === "GET") {
      const session = requirePlatformAccessSession(request);
      requirePlatformSuperadmin(session);
      const record = await getPlatformTenant(platformTenantMatch[1]);
      sendJson(response, 200, record);
      return;
    }

    if (platformTenantMatch && method === "PATCH") {
      const session = requirePlatformAccessSession(request);
      requirePlatformSuperadmin(session);
      const payload = await readJsonBody<{
        status?: "ACTIVE" | "SUSPENDED" | "DISABLED";
        displayName?: string;
        logoUrl?: string | null;
        primaryColor?: string | null;
        supportEmail?: string;
        defaultLocale?: "es" | "en" | "pt";
        enabledLocales?: ("es" | "en" | "pt")[];
        timezone?: string;
        currency?: string;
      }>(request);
      const record = await updatePlatformTenant(platformTenantMatch[1], payload);
      sendJson(response, 200, record);
      return;
    }

    const platformTenantDomainsMatch = requestUrl.pathname.match(/^\/platform\/tenants\/([a-z0-9-]+)\/domains$/);
    if (platformTenantDomainsMatch && method === "GET") {
      const session = requirePlatformAccessSession(request);
      requirePlatformSuperadmin(session);
      const records = await listPlatformTenantDomains(platformTenantDomainsMatch[1]);
      sendJson(response, 200, {
        items: records,
        total: records.length,
      });
      return;
    }

    if (platformTenantDomainsMatch && method === "POST") {
      const session = requirePlatformAccessSession(request);
      requirePlatformSuperadmin(session);
      const payload = await readJsonBody<{
        host: string;
        isPrimary?: boolean;
      }>(request);
      const record = await createPlatformTenantDomain(platformTenantDomainsMatch[1], payload);
      sendJson(response, 201, record);
      return;
    }

    const platformTenantDomainMatch = requestUrl.pathname.match(
      /^\/platform\/tenants\/([a-z0-9-]+)\/domains\/([a-zA-Z0-9_-]+)$/,
    );
    if (platformTenantDomainMatch && method === "PATCH") {
      const session = requirePlatformAccessSession(request);
      requirePlatformSuperadmin(session);
      const payload = await readJsonBody<{
        host?: string;
        isPrimary?: boolean;
      }>(request);
      const record = await updatePlatformTenantDomain(
        platformTenantDomainMatch[1],
        platformTenantDomainMatch[2],
        payload,
      );
      sendJson(response, 200, record);
      return;
    }

    const platformTenantInvitesMatch = requestUrl.pathname.match(/^\/platform\/tenants\/([a-z0-9-]+)\/invitations$/);
    if (platformTenantInvitesMatch && method === "GET") {
      const session = requirePlatformAccessSession(request);
      requirePlatformSuperadmin(session);
      const status = requestUrl.searchParams.get("status");
      const email = requestUrl.searchParams.get("email");
      const records = await listPlatformTenantInvitations(platformTenantInvitesMatch[1], { status, email });
      sendJson(response, 200, {
        items: records,
        total: records.length,
      });
      return;
    }

    if (platformTenantInvitesMatch && method === "POST") {
      const session = requirePlatformAccessSession(request);
      requirePlatformSuperadmin(session);
      const payload = await readJsonBody<{
        email: string;
        role: "TENANT_ADMIN" | "MAINTENANCE_MANAGER" | "TECHNICIAN_OPERATOR" | "INSPECTOR_COMPLIANCE" | "PROCUREMENT_STORE" | "AUDITOR_READONLY";
        locale: "es" | "en" | "pt";
      }>(request);
      const record = await createPlatformTenantInvitation(platformTenantInvitesMatch[1], payload);
      sendJson(response, 201, record);
      return;
    }

    const platformTenantUsersMatch = requestUrl.pathname.match(/^\/platform\/tenants\/([a-z0-9-]+)\/users$/);
    if (platformTenantUsersMatch && method === "GET") {
      const session = requirePlatformAccessSession(request);
      requirePlatformSuperadmin(session);
      const userStatus = requestUrl.searchParams.get("userStatus");
      const membershipStatus = requestUrl.searchParams.get("membershipStatus");
      const role = requestUrl.searchParams.get("role");
      const email = requestUrl.searchParams.get("email");
      const records = await listPlatformTenantUsers(platformTenantUsersMatch[1], {
        userStatus,
        membershipStatus,
        role,
        email,
      });
      sendJson(response, 200, {
        items: records,
        total: records.length,
      });
      return;
    }

    if (platformTenantUsersMatch && method === "POST") {
      const session = requirePlatformAccessSession(request);
      requirePlatformSuperadmin(session);
      const payload = await readJsonBody<{
        email: string;
        legacyUserId?: string | null;
        password: string;
        role: "TENANT_ADMIN" | "MAINTENANCE_MANAGER" | "TECHNICIAN_OPERATOR" | "INSPECTOR_COMPLIANCE" | "PROCUREMENT_STORE" | "AUDITOR_READONLY";
        assignedVesselCodes?: string[];
        preferredLocale?: "es" | "en" | "pt";
        firstName?: string | null;
        lastName?: string | null;
        userStatus?: "INVITED" | "ACTIVE" | "SUSPENDED" | "DISABLED";
        membershipStatus?: "INVITED" | "ACTIVE" | "SUSPENDED" | "REVOKED";
      }>(request);
      const record = await createPlatformTenantUser(platformTenantUsersMatch[1], payload);
      sendJson(response, 201, record);
      return;
    }

    const platformTenantUserMatch = requestUrl.pathname.match(/^\/platform\/tenants\/([a-z0-9-]+)\/users\/([a-zA-Z0-9_-]+)$/);
    if (platformTenantUserMatch && method === "GET") {
      const session = requirePlatformAccessSession(request);
      requirePlatformSuperadmin(session);
      const record = await getPlatformTenantUser(platformTenantUserMatch[1], platformTenantUserMatch[2]);
      sendJson(response, 200, record);
      return;
    }

    if (platformTenantUserMatch && method === "PATCH") {
      const session = requirePlatformAccessSession(request);
      requirePlatformSuperadmin(session);
      const payload = await readJsonBody<{
        email?: string;
        legacyUserId?: string | null;
        password?: string;
        role?: "TENANT_ADMIN" | "MAINTENANCE_MANAGER" | "TECHNICIAN_OPERATOR" | "INSPECTOR_COMPLIANCE" | "PROCUREMENT_STORE" | "AUDITOR_READONLY";
        assignedVesselCodes?: string[];
        preferredLocale?: "es" | "en" | "pt";
        firstName?: string | null;
        lastName?: string | null;
        userStatus?: "INVITED" | "ACTIVE" | "SUSPENDED" | "DISABLED";
        membershipStatus?: "INVITED" | "ACTIVE" | "SUSPENDED" | "REVOKED";
      }>(request);
      const record = await updatePlatformTenantUser(platformTenantUserMatch[1], platformTenantUserMatch[2], payload);
      sendJson(response, 200, record);
      return;
    }

    if (method === "GET" && requestUrl.pathname === "/platform/users") {
      const session = requirePlatformAccessSession(request);
      requirePlatformSuperadmin(session);
      const status = requestUrl.searchParams.get("status");
      const role = requestUrl.searchParams.get("role");
      const email = requestUrl.searchParams.get("email");
      const records = await listPlatformUsers({ status, role, email });
      sendJson(response, 200, {
        items: records,
        total: records.length,
      });
      return;
    }

    if (method === "POST" && requestUrl.pathname === "/platform/users") {
      const session = requirePlatformAccessSession(request);
      requirePlatformSuperadmin(session);
      const payload = await readJsonBody<{
        email: string;
        password: string;
        role: "SUPERADMIN" | "SUPPORT";
        status?: "ACTIVE" | "SUSPENDED" | "DISABLED";
        firstName?: string | null;
        lastName?: string | null;
      }>(request);
      const record = await createPlatformUser(payload);
      sendJson(response, 201, record);
      return;
    }

    const platformUserMatch = requestUrl.pathname.match(/^\/platform\/users\/([a-zA-Z0-9_-]+)$/);
    if (platformUserMatch && method === "GET") {
      const session = requirePlatformAccessSession(request);
      requirePlatformSuperadmin(session);
      const record = await getPlatformUser(platformUserMatch[1]);
      sendJson(response, 200, record);
      return;
    }

    if (platformUserMatch && method === "PATCH") {
      const session = requirePlatformAccessSession(request);
      requirePlatformSuperadmin(session);
      const payload = await readJsonBody<{
        email?: string;
        password?: string;
        role?: "SUPERADMIN" | "SUPPORT";
        status?: "ACTIVE" | "SUSPENDED" | "DISABLED";
        firstName?: string | null;
        lastName?: string | null;
      }>(request);
      const record = await updatePlatformUser(platformUserMatch[1], payload);
      sendJson(response, 200, record);
      return;
    }

    if (method === "GET" && requestUrl.pathname === "/platform/audit-events") {
      const session = requirePlatformAccessSession(request);
      requirePlatformSuperadmin(session);
      const tenantSlug = requestUrl.searchParams.get("tenantSlug");
      const actorType = requestUrl.searchParams.get("actorType");
      const action = requestUrl.searchParams.get("action");
      const entityType = requestUrl.searchParams.get("entityType");
      const records = await listPlatformAuditEvents({ tenantSlug, actorType, action, entityType });
      sendJson(response, 200, {
        items: records,
        total: records.length,
      });
      return;
    }

    if (method === "GET" && requestUrl.pathname === "/platform/prompts") {
      const session = requirePlatformAccessSession(request);
      requirePlatformSuperadmin(session);
      const capability = requestUrl.searchParams.get("capability");
      const locale = requestUrl.searchParams.get("locale");
      const status = requestUrl.searchParams.get("status");
      const records = await listPlatformPrompts({ capability, locale, status });
      sendJson(response, 200, {
        items: records,
        total: records.length,
      });
      return;
    }

    if (method === "POST" && requestUrl.pathname === "/platform/prompts") {
      const session = requirePlatformAccessSession(request);
      requirePlatformSuperadmin(session);
      const payload = await readJsonBody<{
        capability: string;
        locale: "es" | "en" | "pt";
        title: string;
        content: string;
      }>(request);
      const record = await createPlatformPrompt(payload);
      sendJson(response, 201, record);
      return;
    }

    const platformPromptMatch = requestUrl.pathname.match(/^\/platform\/prompts\/([a-zA-Z0-9_-]+)$/);
    if (platformPromptMatch && method === "GET") {
      const session = requirePlatformAccessSession(request);
      requirePlatformSuperadmin(session);
      const record = await getPlatformPrompt(platformPromptMatch[1]);
      sendJson(response, 200, record);
      return;
    }

    if (platformPromptMatch && method === "PATCH") {
      const session = requirePlatformAccessSession(request);
      requirePlatformSuperadmin(session);
      const payload = await readJsonBody<{
        title?: string;
        content?: string;
      }>(request);
      const record = await updatePlatformPrompt(platformPromptMatch[1], payload);
      sendJson(response, 200, record);
      return;
    }

    const platformPromptPublishMatch = requestUrl.pathname.match(/^\/platform\/prompts\/([a-zA-Z0-9_-]+)\/publish$/);
    if (platformPromptPublishMatch && method === "POST") {
      const session = requirePlatformAccessSession(request);
      requirePlatformSuperadmin(session);
      const record = await publishPlatformPrompt(platformPromptPublishMatch[1]);
      sendJson(response, 200, record);
      return;
    }

    const platformPromptRollbackMatch = requestUrl.pathname.match(/^\/platform\/prompts\/([a-zA-Z0-9_-]+)\/rollback$/);
    if (platformPromptRollbackMatch && method === "POST") {
      const session = requirePlatformAccessSession(request);
      requirePlatformSuperadmin(session);
      const record = await rollbackPlatformPrompt(platformPromptRollbackMatch[1]);
      sendJson(response, 200, record);
      return;
    }

    if (method === "GET" && requestUrl.pathname === "/app/me") {
      const tenantSlug = resolveTenantSlugFromRequest(request, env);
      if (!tenantSlug) {
        throw new RouteError(400, "TENANT_UNRESOLVED", "Unable to resolve tenant for current user route.");
      }

      const session = requireTenantAccessSession(request, tenantSlug);
      sendJson(response, 200, {
        tenant: { slug: session.tenantSlug },
        user: session.user,
      });
      return;
    }

    if (method === "GET" && requestUrl.pathname === "/app/vessels") {
      const tenantSlug = resolveTenantSlugFromRequest(request, env);
      if (!tenantSlug) {
        throw new RouteError(400, "TENANT_UNRESOLVED", "Unable to resolve tenant for vessels route.");
      }

      const session = requireTenantAccessSession(request, tenantSlug);
      const records = await listTenantVessels(session);
      sendJson(response, 200, {
        items: records,
        total: records.length,
      });
      return;
    }

    if (method === "GET" && requestUrl.pathname === "/app/assets") {
      const tenantSlug = resolveTenantSlugFromRequest(request, env);
      if (!tenantSlug) {
        throw new RouteError(400, "TENANT_UNRESOLVED", "Unable to resolve tenant for assets route.");
      }

      const session = requireTenantAccessSession(request, tenantSlug);
      const vesselCode = requestUrl.searchParams.get("vesselCode");
      const records = await listTenantAssets(session, { vesselCode });
      sendJson(response, 200, {
        items: records,
        total: records.length,
      });
      return;
    }

    if (method === "GET" && requestUrl.pathname === "/app/maintenance-plans") {
      const tenantSlug = resolveTenantSlugFromRequest(request, env);
      if (!tenantSlug) {
        throw new RouteError(400, "TENANT_UNRESOLVED", "Unable to resolve tenant for maintenance plans route.");
      }

      const session = requireTenantAccessSession(request, tenantSlug);
      const vesselCode = requestUrl.searchParams.get("vesselCode");
      const status = requestUrl.searchParams.get("status");
      const triggerType = requestUrl.searchParams.get("triggerType");
      const records = await listTenantMaintenancePlans(session, { vesselCode, status, triggerType });
      sendJson(response, 200, {
        items: records,
        total: records.length,
      });
      return;
    }

    if (method === "GET" && requestUrl.pathname === "/app/work-orders") {
      const tenantSlug = resolveTenantSlugFromRequest(request, env);
      if (!tenantSlug) {
        throw new RouteError(400, "TENANT_UNRESOLVED", "Unable to resolve tenant for work orders route.");
      }

      const session = requireTenantAccessSession(request, tenantSlug);
      const vesselCode = requestUrl.searchParams.get("vesselCode");
      const status = requestUrl.searchParams.get("status");
      const type = requestUrl.searchParams.get("type");
      const records = await listTenantWorkOrders(session, { vesselCode, status, type });
      sendJson(response, 200, {
        items: records,
        total: records.length,
      });
      return;
    }

    if (method === "GET" && requestUrl.pathname === "/app/defects") {
      const tenantSlug = resolveTenantSlugFromRequest(request, env);
      if (!tenantSlug) {
        throw new RouteError(400, "TENANT_UNRESOLVED", "Unable to resolve tenant for defects route.");
      }

      const session = requireTenantAccessSession(request, tenantSlug);
      const vesselCode = requestUrl.searchParams.get("vesselCode");
      const status = requestUrl.searchParams.get("status");
      const severity = requestUrl.searchParams.get("severity");
      const records = await listTenantDefects(session, { vesselCode, status, severity });
      sendJson(response, 200, {
        items: records,
        total: records.length,
      });
      return;
    }

    if (method === "GET" && requestUrl.pathname === "/app/deferrals") {
      const tenantSlug = resolveTenantSlugFromRequest(request, env);
      if (!tenantSlug) {
        throw new RouteError(400, "TENANT_UNRESOLVED", "Unable to resolve tenant for deferrals route.");
      }

      const session = requireTenantAccessSession(request, tenantSlug);
      const vesselCode = requestUrl.searchParams.get("vesselCode");
      const status = requestUrl.searchParams.get("status");
      const sourceType = requestUrl.searchParams.get("sourceType");
      const records = await listTenantDeferrals(session, { vesselCode, status, sourceType });
      sendJson(response, 200, {
        items: records,
        total: records.length,
      });
      return;
    }

    if (method === "GET" && requestUrl.pathname === "/app/rca") {
      const tenantSlug = resolveTenantSlugFromRequest(request, env);
      if (!tenantSlug) {
        throw new RouteError(400, "TENANT_UNRESOLVED", "Unable to resolve tenant for RCA route.");
      }

      const session = requireTenantAccessSession(request, tenantSlug);
      const vesselCode = requestUrl.searchParams.get("vesselCode");
      const status = requestUrl.searchParams.get("status");
      const methodology = requestUrl.searchParams.get("methodology");
      const records = await listTenantRcas(session, { vesselCode, status, methodology });
      sendJson(response, 200, {
        items: records,
        total: records.length,
      });
      return;
    }

    if (method === "GET" && requestUrl.pathname === "/app/capa") {
      const tenantSlug = resolveTenantSlugFromRequest(request, env);
      if (!tenantSlug) {
        throw new RouteError(400, "TENANT_UNRESOLVED", "Unable to resolve tenant for CAPA route.");
      }

      const session = requireTenantAccessSession(request, tenantSlug);
      const vesselCode = requestUrl.searchParams.get("vesselCode");
      const status = requestUrl.searchParams.get("status");
      const priority = requestUrl.searchParams.get("priority");
      const sourceType = requestUrl.searchParams.get("sourceType");
      const records = await listTenantCapas(session, { vesselCode, status, priority, sourceType });
      sendJson(response, 200, {
        items: records,
        total: records.length,
      });
      return;
    }

    if (method === "GET" && requestUrl.pathname === "/app/spares") {
      const tenantSlug = resolveTenantSlugFromRequest(request, env);
      if (!tenantSlug) {
        throw new RouteError(400, "TENANT_UNRESOLVED", "Unable to resolve tenant for spares route.");
      }

      const session = requireTenantAccessSession(request, tenantSlug);
      const vesselCode = requestUrl.searchParams.get("vesselCode");
      const status = requestUrl.searchParams.get("status");
      const criticality = requestUrl.searchParams.get("criticality");
      const records = await listTenantSpares(session, { vesselCode, status, criticality });
      sendJson(response, 200, {
        items: records,
        total: records.length,
      });
      return;
    }

    if (method === "GET" && requestUrl.pathname === "/app/providers") {
      const tenantSlug = resolveTenantSlugFromRequest(request, env);
      if (!tenantSlug) {
        throw new RouteError(400, "TENANT_UNRESOLVED", "Unable to resolve tenant for providers route.");
      }

      const session = requireTenantAccessSession(request, tenantSlug);
      const vesselCode = requestUrl.searchParams.get("vesselCode");
      const status = requestUrl.searchParams.get("status");
      const category = requestUrl.searchParams.get("category");
      const records = await listTenantProviders(session, { vesselCode, status, category });
      sendJson(response, 200, {
        items: records,
        total: records.length,
      });
      return;
    }

    if (method === "GET" && requestUrl.pathname === "/app/spare-orders") {
      const tenantSlug = resolveTenantSlugFromRequest(request, env);
      if (!tenantSlug) {
        throw new RouteError(400, "TENANT_UNRESOLVED", "Unable to resolve tenant for spare orders route.");
      }

      const session = requireTenantAccessSession(request, tenantSlug);
      const vesselCode = requestUrl.searchParams.get("vesselCode");
      const status = requestUrl.searchParams.get("status");
      const priority = requestUrl.searchParams.get("priority");
      const records = await listTenantSpareOrders(session, { vesselCode, status, priority });
      sendJson(response, 200, {
        items: records,
        total: records.length,
      });
      return;
    }

    if (method === "GET" && requestUrl.pathname === "/app/inspections") {
      const tenantSlug = resolveTenantSlugFromRequest(request, env);
      if (!tenantSlug) {
        throw new RouteError(400, "TENANT_UNRESOLVED", "Unable to resolve tenant for inspections route.");
      }

      const session = requireTenantAccessSession(request, tenantSlug);
      const vesselCode = requestUrl.searchParams.get("vesselCode");
      const status = requestUrl.searchParams.get("status");
      const result = requestUrl.searchParams.get("result");
      const type = requestUrl.searchParams.get("type");
      const records = await listTenantInspections(session, { vesselCode, status, result, type });
      sendJson(response, 200, {
        items: records,
        total: records.length,
      });
      return;
    }

    if (method === "GET" && requestUrl.pathname === "/app/certificates") {
      const tenantSlug = resolveTenantSlugFromRequest(request, env);
      if (!tenantSlug) {
        throw new RouteError(400, "TENANT_UNRESOLVED", "Unable to resolve tenant for certificates route.");
      }

      const session = requireTenantAccessSession(request, tenantSlug);
      const vesselCode = requestUrl.searchParams.get("vesselCode");
      const status = requestUrl.searchParams.get("status");
      const records = await listTenantCertificates(session, { vesselCode, status });
      sendJson(response, 200, {
        items: records,
        total: records.length,
      });
      return;
    }

    if (method === "GET" && requestUrl.pathname === "/app/daily-reports") {
      const tenantSlug = resolveTenantSlugFromRequest(request, env);
      if (!tenantSlug) {
        throw new RouteError(400, "TENANT_UNRESOLVED", "Unable to resolve tenant for daily reports route.");
      }

      const session = requireTenantAccessSession(request, tenantSlug);
      const vesselCode = requestUrl.searchParams.get("vesselCode");
      const status = requestUrl.searchParams.get("status");
      const reportDate = requestUrl.searchParams.get("reportDate");
      const records = await listTenantDailyReports(session, { vesselCode, status, reportDate });
      sendJson(response, 200, {
        items: records,
        total: records.length,
      });
      return;
    }

    if (method === "GET" && requestUrl.pathname === "/app/attachments") {
      const tenantSlug = resolveTenantSlugFromRequest(request, env);
      if (!tenantSlug) {
        throw new RouteError(400, "TENANT_UNRESOLVED", "Unable to resolve tenant for attachments route.");
      }

      const session = requireTenantAccessSession(request, tenantSlug);
      const vesselCode = requestUrl.searchParams.get("vesselCode");
      const status = requestUrl.searchParams.get("status");
      const targetType = requestUrl.searchParams.get("targetType");
      const records = await listTenantAttachments(session, { vesselCode, status, targetType });
      sendJson(response, 200, {
        items: records,
        total: records.length,
      });
      return;
    }

    if (method === "GET" && requestUrl.pathname === "/app/inspection-logs") {
      const tenantSlug = resolveTenantSlugFromRequest(request, env);
      if (!tenantSlug) {
        throw new RouteError(400, "TENANT_UNRESOLVED", "Unable to resolve tenant for inspection logs route.");
      }

      const session = requireTenantAccessSession(request, tenantSlug);
      const vesselCode = requestUrl.searchParams.get("vesselCode");
      const inspectionId = requestUrl.searchParams.get("inspectionId");
      const entryType = requestUrl.searchParams.get("entryType");
      const severity = requestUrl.searchParams.get("severity");
      const records = await listTenantInspectionLogs(session, { vesselCode, inspectionId, entryType, severity });
      sendJson(response, 200, {
        items: records,
        total: records.length,
      });
      return;
    }

    if (method === "GET" && requestUrl.pathname === "/app/stock-movements") {
      const tenantSlug = resolveTenantSlugFromRequest(request, env);
      if (!tenantSlug) {
        throw new RouteError(400, "TENANT_UNRESOLVED", "Unable to resolve tenant for stock movements route.");
      }

      const session = requireTenantAccessSession(request, tenantSlug);
      const vesselCode = requestUrl.searchParams.get("vesselCode");
      const movementType = requestUrl.searchParams.get("movementType");
      const spareId = requestUrl.searchParams.get("spareId");
      const records = await listTenantStockMovements(session, { vesselCode, movementType, spareId });
      sendJson(response, 200, {
        items: records,
        total: records.length,
      });
      return;
    }

    if (method === "GET" && requestUrl.pathname === "/app/provider-evaluations") {
      const tenantSlug = resolveTenantSlugFromRequest(request, env);
      if (!tenantSlug) {
        throw new RouteError(400, "TENANT_UNRESOLVED", "Unable to resolve tenant for provider evaluations route.");
      }

      const session = requireTenantAccessSession(request, tenantSlug);
      const vesselCode = requestUrl.searchParams.get("vesselCode");
      const status = requestUrl.searchParams.get("status");
      const rating = requestUrl.searchParams.get("rating");
      const records = await listTenantProviderEvaluations(session, { vesselCode, status, rating });
      sendJson(response, 200, {
        items: records,
        total: records.length,
      });
      return;
    }

    if (method === "GET" && requestUrl.pathname === "/app/provider-nonconformities") {
      const tenantSlug = resolveTenantSlugFromRequest(request, env);
      if (!tenantSlug) {
        throw new RouteError(400, "TENANT_UNRESOLVED", "Unable to resolve tenant for provider nonconformities route.");
      }

      const session = requireTenantAccessSession(request, tenantSlug);
      const vesselCode = requestUrl.searchParams.get("vesselCode");
      const status = requestUrl.searchParams.get("status");
      const severity = requestUrl.searchParams.get("severity");
      const records = await listTenantProviderNonconformities(session, { vesselCode, status, severity });
      sendJson(response, 200, {
        items: records,
        total: records.length,
      });
      return;
    }

    if (method === "GET" && requestUrl.pathname === "/app/domain-events") {
      const tenantSlug = resolveTenantSlugFromRequest(request, env);
      if (!tenantSlug) {
        throw new RouteError(400, "TENANT_UNRESOLVED", "Unable to resolve tenant for domain events route.");
      }

      const session = requireTenantAccessSession(request, tenantSlug);
      const vesselCode = requestUrl.searchParams.get("vesselCode");
      const category = requestUrl.searchParams.get("category");
      const eventType = requestUrl.searchParams.get("eventType");
      const records = listTenantDomainEvents(session, { vesselCode, category, eventType });
      sendJson(response, 200, {
        items: records,
        total: records.length,
      });
      return;
    }

    if (method === "GET" && requestUrl.pathname === "/app/ai-insights") {
      const tenantSlug = resolveTenantSlugFromRequest(request, env);
      if (!tenantSlug) {
        throw new RouteError(400, "TENANT_UNRESOLVED", "Unable to resolve tenant for AI insights route.");
      }

      const session = requireTenantAccessSession(request, tenantSlug);
      const vesselCode = requestUrl.searchParams.get("vesselCode");
      const status = requestUrl.searchParams.get("status");
      const insightType = requestUrl.searchParams.get("insightType");
      const targetType = requestUrl.searchParams.get("targetType");
      const records = listTenantAiInsights(session, { vesselCode, status, insightType, targetType });
      sendJson(response, 200, {
        items: records,
        total: records.length,
      });
      return;
    }
  } catch (error) {
    const handled = toErrorPayload(error);
    sendJson(response, handled.statusCode, handled.payload);
    return;
  }

  // ── web-legacy SPA static serving ──────────────────────────────────────────
  // Serve the compiled frontend bundle (GET /bundle.js, GET /bundle.js.map)
  if (method === "GET" && requestUrl.pathname.startsWith("/bundle.js")) {
    const served = serveStaticFile(response, requestUrl.pathname.slice(1));
    if (served) return;
  }

  // Serve index.html for all /ui and /ui/* browser navigation paths
  if (method === "GET" && (requestUrl.pathname === "/ui" || requestUrl.pathname.startsWith("/ui/"))) {
    serveSpaHtml(response);
    return;
  }

  sendJson(response, 404, {
    error: {
      code: "ROUTE_NOT_FOUND",
      message: `No route matches ${method} ${requestUrl.pathname}`,
    },
  });
});

server.listen(port, () => {
  process.stdout.write(`API server listening on http://localhost:${port}\n`);
});
