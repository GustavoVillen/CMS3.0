import type { AppEnv } from "../../config/env";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildHomePage(env: AppEnv): string {
  const dbStatus = env.hasDatabaseUrl ? "configured" : "not configured";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>PMS SaaS API</title>
    <style>
      body { font-family: Arial, sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; padding: 32px; }
      h1 { margin-top: 0; color: #eab308; }
      code { background: rgba(255,255,255,0.08); padding: 2px 6px; border-radius: 4px; }
      .card { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.12); border-radius: 12px; padding: 20px; margin-bottom: 16px; }
      a { color: #93c5fd; }
      ul { margin-top: 8px; }
      label { display: block; font-size: 0.9rem; margin-bottom: 6px; }
      input, select, button, textarea { font: inherit; }
      input, select { width: 100%; max-width: 380px; padding: 8px 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.16); background: rgba(15,23,42,0.8); color: #e2e8f0; }
      button { padding: 8px 14px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.16); background: #1e293b; color: #e2e8f0; cursor: pointer; }
      button:hover { background: #334155; }
      .row { display: flex; gap: 12px; flex-wrap: wrap; align-items: end; }
      .field { margin-bottom: 12px; }
      .mono { font-family: Consolas, monospace; }
      textarea { width: 100%; min-height: 220px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.12); background: rgba(15,23,42,0.92); color: #cbd5e1; padding: 12px; }
    </style>
  </head>
  <body>
    <h1>PMS SaaS API</h1>
    <div class="card">
      <strong>Status:</strong> foundation runtime active<br />
      <strong>Database:</strong> ${escapeHtml(dbStatus)}<br />
      <strong>Root domain:</strong> ${escapeHtml(env.rootDomain)}<br />
      <strong>Admin subdomain:</strong> ${escapeHtml(env.adminSubdomain)}
    </div>
    <div class="card">
      <strong>Available endpoints</strong>
      <ul>
        <li><a href="/health"><code>GET /health</code></a></li>
        <li><a href="/public/bootstrap?tenant=demo&locale=es"><code>GET /public/bootstrap?tenant=demo&amp;locale=es</code></a> using tenant host, dev path, or dev query</li>
        <li><code>POST /app/auth/login</code></li>
        <li><code>POST /app/auth/refresh</code></li>
        <li><code>GET /app/me</code> with Bearer token and tenant host</li>
        <li><code>GET /app/vessels</code> with Bearer token and tenant host</li>
        <li><code>GET /app/assets?vesselCode=LATERE</code> with Bearer token and tenant host</li>
        <li><code>GET /app/maintenance-plans?vesselCode=LATERE</code> with Bearer token and tenant host</li>
        <li><code>GET /app/work-orders?vesselCode=LATERE</code> with Bearer token and tenant host</li>
        <li><code>GET /app/defects?vesselCode=LATERE</code> with Bearer token and tenant host</li>
        <li><code>GET /app/deferrals?vesselCode=LATERE</code> with Bearer token and tenant host</li>
        <li><code>GET /app/capa?vesselCode=LATERE</code> with Bearer token and tenant host</li>
        <li><code>GET /app/spares?vesselCode=LATERE</code> with Bearer token and tenant host</li>
        <li><code>GET /app/providers?vesselCode=LATERE</code> with Bearer token and tenant host</li>
        <li><code>GET /app/spare-orders?vesselCode=LATERE</code> with Bearer token and tenant host</li>
        <li><code>GET /app/inspections?vesselCode=LATERE</code> with Bearer token and tenant host</li>
        <li><code>GET /app/certificates?vesselCode=LATERE</code> with Bearer token and tenant host</li>
        <li><code>GET /app/daily-reports?vesselCode=LATERE</code> with Bearer token and tenant host</li>
        <li><code>GET /app/attachments?vesselCode=LATERE</code> with Bearer token and tenant host</li>
        <li><code>GET /app/inspection-logs?vesselCode=LATERE</code> with Bearer token and tenant host</li>
        <li><code>GET /app/stock-movements?vesselCode=LATERE</code> with Bearer token and tenant host</li>
        <li><code>GET /app/provider-evaluations?vesselCode=LATERE</code> with Bearer token and tenant host</li>
        <li><code>GET /app/provider-nonconformities?vesselCode=LATERE</code> with Bearer token and tenant host</li>
        <li><code>GET /app/domain-events?vesselCode=LATERE</code> with Bearer token and tenant host</li>
        <li><code>GET /app/ai-insights?status=OPEN</code> with Bearer token and tenant host</li>
        <li><code>POST /platform/auth/login</code></li>
        <li><code>POST /platform/auth/refresh</code></li>
        <li><code>GET /platform/tenants</code> with Bearer token</li>
        <li><code>POST /platform/tenants</code> with Bearer token</li>
        <li><code>GET /platform/tenants/&lt;slug&gt;</code> with Bearer token</li>
        <li><code>PATCH /platform/tenants/&lt;slug&gt;</code> with Bearer token</li>
        <li><code>GET /platform/tenants/&lt;slug&gt;/domains</code> with Bearer token</li>
        <li><code>POST /platform/tenants/&lt;slug&gt;/domains</code> with Bearer token</li>
        <li><code>PATCH /platform/tenants/&lt;slug&gt;/domains/&lt;id&gt;</code> with Bearer token</li>
        <li><code>GET /platform/tenants/&lt;slug&gt;/invitations</code> with Bearer token</li>
        <li><code>POST /platform/tenants/&lt;slug&gt;/invitations</code> with Bearer token</li>
        <li><code>GET /platform/tenants/&lt;slug&gt;/users</code> with Bearer token</li>
        <li><code>POST /platform/tenants/&lt;slug&gt;/users</code> with Bearer token</li>
        <li><code>GET /platform/tenants/&lt;slug&gt;/users/&lt;id&gt;</code> with Bearer token</li>
        <li><code>PATCH /platform/tenants/&lt;slug&gt;/users/&lt;id&gt;</code> with Bearer token</li>
        <li><code>GET /platform/users</code> with Bearer token</li>
        <li><code>POST /platform/users</code> with Bearer token</li>
        <li><code>GET /platform/users/&lt;id&gt;</code> with Bearer token</li>
        <li><code>PATCH /platform/users/&lt;id&gt;</code> with Bearer token</li>
        <li><code>GET /platform/audit-events</code> with Bearer token</li>
        <li><code>GET /platform/prompts</code> with Bearer token</li>
        <li><code>POST /platform/prompts</code> with Bearer token</li>
        <li><code>GET /platform/prompts/&lt;id&gt;</code> with Bearer token</li>
        <li><code>PATCH /platform/prompts/&lt;id&gt;</code> with Bearer token</li>
        <li><code>POST /platform/prompts/&lt;id&gt;/publish</code> with Bearer token</li>
        <li><code>POST /platform/prompts/&lt;id&gt;/rollback</code> with Bearer token</li>
      </ul>
    </div>
    <div class="card">
      <strong>Notes</strong>
      <ul>
        <li>Public bootstrap works with in-memory demo tenants if database is not configured.</li>
        <li>In development mode, demo auth fallback is available if database auth is not ready.</li>
        <li>Demo tenant login: <code>admin@demo.local</code> or <code>DEMOADMIN</code> / <code>demo123</code></li>
        <li>Demo platform login: <code>admin@localhost</code> / <code>admin123</code></li>
        <li>Source of truth: <code>CLAUDE.md</code> + <code>HISTORY.txt</code> in the repo root.</li>
      </ul>
    </div>
    <div class="card">
      <strong>Local Dev Console</strong>
      <div class="field">
        <label for="tenantSlug">Tenant slug</label>
        <input id="tenantSlug" value="demo" />
      </div>
      <div class="row">
        <div class="field">
          <label for="tenantIdentifier">Tenant identifier</label>
          <input id="tenantIdentifier" value="DEMOADMIN" />
        </div>
        <div class="field">
          <label for="tenantPassword">Tenant password</label>
          <input id="tenantPassword" value="demo123" type="password" />
        </div>
        <div class="field">
          <label for="tenantLocale">Tenant locale</label>
          <select id="tenantLocale">
            <option value="es">es</option>
            <option value="en">en</option>
            <option value="pt">pt</option>
          </select>
        </div>
      </div>
      <div class="row" style="margin-bottom: 16px;">
        <button onclick="loginTenant()">Tenant Login</button>
        <button onclick="loadBootstrap()">Load Bootstrap</button>
        <button onclick="loadMe()">Load Me</button>
        <button onclick="loadVessels()">Load Vessels</button>
        <button onclick="loadAssets()">Load Assets</button>
        <button onclick="loadMaintenancePlans()">Load Maintenance Plans</button>
        <button onclick="loadWorkOrders()">Load Work Orders</button>
        <button onclick="loadDefects()">Load Defects</button>
        <button onclick="loadDeferrals()">Load Deferrals</button>
        <button onclick="loadCapa()">Load CAPA</button>
        <button onclick="loadSpares()">Load Spares</button>
        <button onclick="loadProviders()">Load Providers</button>
        <button onclick="loadSpareOrders()">Load Spare Orders</button>
        <button onclick="loadInspections()">Load Inspections</button>
        <button onclick="loadCertificates()">Load Certificates</button>
        <button onclick="loadDailyReports()">Load Daily Reports</button>
        <button onclick="loadAttachments()">Load Attachments</button>
        <button onclick="loadInspectionLogs()">Load Inspection Logs</button>
        <button onclick="loadStockMovements()">Load Stock Movements</button>
        <button onclick="loadProviderEvaluations()">Load Provider Evaluations</button>
        <button onclick="loadProviderNonconformities()">Load Provider Nonconformities</button>
        <button onclick="loadDomainEvents()">Load Domain Events</button>
        <button onclick="loadAiInsights()">Load AI Insights</button>
        <button onclick="acceptInvitation()">Accept Invitation</button>
      </div>
      <div class="row">
        <div class="field">
          <label for="platformEmail">Platform email</label>
          <input id="platformEmail" value="admin@localhost" />
        </div>
        <div class="field">
          <label for="platformPassword">Platform password</label>
          <input id="platformPassword" value="admin123" type="password" />
        </div>
      </div>
      <div class="row" style="margin-bottom: 16px;">
        <button onclick="loginPlatform()">Platform Login</button>
      </div>
      <div class="row">
        <div class="field">
          <label for="platformTenantSlug">Platform tenant slug</label>
          <input id="platformTenantSlug" value="demo" />
        </div>
      </div>
      <div class="field">
        <label for="platformTenantPayload">Platform tenant payload</label>
        <textarea id="platformTenantPayload">{
  "slug": "new-tenant",
  "status": "ACTIVE",
  "displayName": "New Tenant",
  "supportEmail": "support@new.local",
  "primaryColor": "#0ea5e9",
  "logoUrl": null,
  "defaultLocale": "en",
  "enabledLocales": ["en", "es", "pt"],
  "timezone": "UTC",
  "currency": "USD"
}</textarea>
      </div>
      <div class="row" style="margin-bottom: 16px;">
        <button onclick="loadPlatformTenants()">Load Tenants</button>
        <button onclick="loadPlatformTenant()">Load Tenant</button>
        <button onclick="createPlatformTenant()">Create Tenant</button>
        <button onclick="updatePlatformTenant()">Update Tenant</button>
      </div>
      <div class="row">
        <div class="field">
          <label for="platformTenantDomainId">Tenant domain id</label>
          <input id="platformTenantDomainId" value="dev-tenant-domain-demo-primary" />
        </div>
      </div>
      <div class="field">
        <label for="platformTenantDomainPayload">Tenant domain payload</label>
        <textarea id="platformTenantDomainPayload">{
  "host": "demo.example.test",
  "isPrimary": true
}</textarea>
      </div>
      <div class="row" style="margin-bottom: 16px;">
        <button onclick="loadPlatformTenantDomains()">Load Tenant Domains</button>
        <button onclick="createPlatformTenantDomain()">Create Tenant Domain</button>
        <button onclick="updatePlatformTenantDomain()">Update Tenant Domain</button>
      </div>
      <div class="field">
        <label for="platformTenantInvitationPayload">Tenant invitation payload</label>
        <textarea id="platformTenantInvitationPayload">{
  "email": "engineer@demo.local",
  "role": "MAINTENANCE_MANAGER",
  "locale": "es"
}</textarea>
      </div>
      <div class="row" style="margin-bottom: 16px;">
        <button onclick="loadPlatformTenantInvitations()">Load Invitations</button>
        <button onclick="createPlatformTenantInvitation()">Create Invitation</button>
      </div>
      <div class="row">
        <div class="field">
          <label for="platformTenantUserId">Tenant user id</label>
          <input id="platformTenantUserId" value="dev-tenant-user-demo-admin" />
        </div>
      </div>
      <div class="field">
        <label for="platformTenantUserPayload">Tenant user payload</label>
        <textarea id="platformTenantUserPayload">{
  "email": "crew@demo.local",
  "legacyUserId": "DEMOCREW",
  "password": "crew123",
  "role": "TECHNICIAN_OPERATOR",
  "assignedVesselCodes": ["LATERE"],
  "preferredLocale": "es",
  "firstName": "Crew",
  "lastName": "Operator",
  "userStatus": "ACTIVE",
  "membershipStatus": "ACTIVE"
}</textarea>
      </div>
      <div class="row" style="margin-bottom: 16px;">
        <button onclick="loadPlatformTenantUsers()">Load Tenant Users</button>
        <button onclick="loadPlatformTenantUser()">Load Tenant User</button>
        <button onclick="createPlatformTenantUser()">Create Tenant User</button>
        <button onclick="updatePlatformTenantUser()">Update Tenant User</button>
      </div>
      <div class="row">
        <div class="field">
          <label for="platformUserId">Platform user id</label>
          <input id="platformUserId" value="dev-platform-user-admin" />
        </div>
      </div>
      <div class="field">
        <label for="platformUserPayload">Platform user payload</label>
        <textarea id="platformUserPayload">{
  "email": "support@platform.local",
  "password": "support123",
  "role": "SUPPORT",
  "status": "ACTIVE",
  "firstName": "Support",
  "lastName": "Agent"
}</textarea>
      </div>
      <div class="row" style="margin-bottom: 16px;">
        <button onclick="loadPlatformUsers()">Load Users</button>
        <button onclick="loadPlatformUser()">Load User</button>
        <button onclick="createPlatformUser()">Create User</button>
        <button onclick="updatePlatformUser()">Update User</button>
      </div>
      <div class="row">
        <div class="field">
          <label for="platformAuditTenantSlug">Audit tenantSlug filter</label>
          <input id="platformAuditTenantSlug" value="demo" />
        </div>
        <div class="field">
          <label for="platformAuditActorType">Audit actor type filter</label>
          <select id="platformAuditActorType">
            <option value="">all</option>
            <option value="PLATFORM_USER">PLATFORM_USER</option>
            <option value="TENANT_USER">TENANT_USER</option>
            <option value="SYSTEM">SYSTEM</option>
          </select>
        </div>
        <div class="field">
          <label for="platformAuditAction">Audit action filter</label>
          <input id="platformAuditAction" value="" />
        </div>
        <div class="field">
          <label for="platformAuditEntityType">Audit entity type filter</label>
          <input id="platformAuditEntityType" value="" />
        </div>
      </div>
      <div class="row" style="margin-bottom: 16px;">
        <button onclick="loadPlatformAuditEvents()">Load Audit Events</button>
      </div>
      <div class="row">
        <div class="field">
          <label for="platformPromptId">Platform prompt id</label>
          <input id="platformPromptId" value="prompt-knowledge_assistant-es-v1" />
        </div>
      </div>
      <div class="field">
        <label for="platformPromptPayload">Platform prompt payload</label>
        <textarea id="platformPromptPayload">{
  "capability": "knowledge_assistant",
  "locale": "es",
  "title": "Asistente de conocimiento - nuevo",
  "content": "Responde con foco en seguridad y evidencia tecnica."
}</textarea>
      </div>
      <div class="row" style="margin-bottom: 16px;">
        <button onclick="loadPlatformPrompts()">Load Prompts</button>
        <button onclick="loadPlatformPrompt()">Load Prompt</button>
        <button onclick="createPlatformPrompt()">Create Prompt</button>
        <button onclick="updatePlatformPrompt()">Update Prompt</button>
        <button onclick="publishPlatformPrompt()">Publish Prompt</button>
        <button onclick="rollbackPlatformPrompt()">Rollback Prompt</button>
      </div>
      <div class="field">
        <label for="assetsVesselCode">Assets vesselCode filter</label>
        <input id="assetsVesselCode" value="LATERE" />
      </div>
      <div class="row">
        <div class="field">
          <label for="maintenanceVesselCode">Maintenance vesselCode filter</label>
          <input id="maintenanceVesselCode" value="LATERE" />
        </div>
        <div class="field">
          <label for="maintenanceStatus">Maintenance status filter</label>
          <select id="maintenanceStatus">
            <option value="">all</option>
            <option value="ACTIVE">ACTIVE</option>
            <option value="DUE_SOON">DUE_SOON</option>
            <option value="OVERDUE">OVERDUE</option>
            <option value="INACTIVE">INACTIVE</option>
          </select>
        </div>
        <div class="field">
          <label for="maintenanceTriggerType">Maintenance trigger type</label>
          <select id="maintenanceTriggerType">
            <option value="">all</option>
            <option value="HOURS">HOURS</option>
            <option value="MONTHS">MONTHS</option>
            <option value="CONDITION">CONDITION</option>
            <option value="EVENT">EVENT</option>
          </select>
        </div>
      </div>
      <div class="row">
        <div class="field">
          <label for="workOrderVesselCode">Work orders vesselCode filter</label>
          <input id="workOrderVesselCode" value="LATERE" />
        </div>
        <div class="field">
          <label for="workOrderStatus">Work orders status filter</label>
          <select id="workOrderStatus">
            <option value="">all</option>
            <option value="PLANNED">PLANNED</option>
            <option value="IN_PROGRESS">IN_PROGRESS</option>
            <option value="ON_HOLD">ON_HOLD</option>
            <option value="DEFERRED">DEFERRED</option>
            <option value="CLOSED">CLOSED</option>
            <option value="CANCELLED">CANCELLED</option>
          </select>
        </div>
        <div class="field">
          <label for="workOrderType">Work orders type filter</label>
          <select id="workOrderType">
            <option value="">all</option>
            <option value="PREVENTIVE">PREVENTIVE</option>
            <option value="CORRECTIVE">CORRECTIVE</option>
            <option value="INSPECTION">INSPECTION</option>
          </select>
        </div>
      </div>
      <div class="row">
        <div class="field">
          <label for="defectVesselCode">Defects vesselCode filter</label>
          <input id="defectVesselCode" value="LATERE" />
        </div>
        <div class="field">
          <label for="defectStatus">Defects status filter</label>
          <select id="defectStatus">
            <option value="">all</option>
            <option value="OPEN">OPEN</option>
            <option value="UNDER_REVIEW">UNDER_REVIEW</option>
            <option value="IN_PROGRESS">IN_PROGRESS</option>
            <option value="DEFERRED">DEFERRED</option>
            <option value="RESOLVED">RESOLVED</option>
            <option value="CLOSED">CLOSED</option>
          </select>
        </div>
        <div class="field">
          <label for="defectSeverity">Defects severity filter</label>
          <select id="defectSeverity">
            <option value="">all</option>
            <option value="LOW">LOW</option>
            <option value="MEDIUM">MEDIUM</option>
            <option value="HIGH">HIGH</option>
            <option value="CRITICAL">CRITICAL</option>
          </select>
        </div>
      </div>
      <div class="row">
        <div class="field">
          <label for="invitationToken">Invitation token</label>
          <input id="invitationToken" value="invite-demo-token-001" />
        </div>
        <div class="field">
          <label for="invitationFirstName">Invitation first name</label>
          <input id="invitationFirstName" value="New" />
        </div>
        <div class="field">
          <label for="invitationLastName">Invitation last name</label>
          <input id="invitationLastName" value="User" />
        </div>
        <div class="field">
          <label for="invitationPassword">Invitation password</label>
          <input id="invitationPassword" value="welcome123" type="password" />
        </div>
      </div>
      <div class="row">
        <div class="field">
          <label for="deferralVesselCode">Deferrals vesselCode filter</label>
          <input id="deferralVesselCode" value="LATERE" />
        </div>
        <div class="field">
          <label for="deferralStatus">Deferrals status filter</label>
          <select id="deferralStatus">
            <option value="">all</option>
            <option value="REQUESTED">REQUESTED</option>
            <option value="UNDER_REVIEW">UNDER_REVIEW</option>
            <option value="APPROVED">APPROVED</option>
            <option value="REJECTED">REJECTED</option>
            <option value="ACTIVE">ACTIVE</option>
            <option value="EXPIRED">EXPIRED</option>
            <option value="CLOSED">CLOSED</option>
          </select>
        </div>
        <div class="field">
          <label for="deferralSourceType">Deferrals source type filter</label>
          <select id="deferralSourceType">
            <option value="">all</option>
            <option value="DEFECT">DEFECT</option>
            <option value="WORK_ORDER">WORK_ORDER</option>
            <option value="MAINTENANCE_PLAN">MAINTENANCE_PLAN</option>
          </select>
        </div>
      </div>
      <div class="row">
        <div class="field">
          <label for="capaVesselCode">CAPA vesselCode filter</label>
          <input id="capaVesselCode" value="LATERE" />
        </div>
        <div class="field">
          <label for="capaStatus">CAPA status filter</label>
          <select id="capaStatus">
            <option value="">all</option>
            <option value="OPEN">OPEN</option>
            <option value="IN_PROGRESS">IN_PROGRESS</option>
            <option value="PENDING_VERIFICATION">PENDING_VERIFICATION</option>
            <option value="CLOSED">CLOSED</option>
            <option value="CANCELLED">CANCELLED</option>
          </select>
        </div>
        <div class="field">
          <label for="capaPriority">CAPA priority filter</label>
          <select id="capaPriority">
            <option value="">all</option>
            <option value="LOW">LOW</option>
            <option value="MEDIUM">MEDIUM</option>
            <option value="HIGH">HIGH</option>
            <option value="CRITICAL">CRITICAL</option>
          </select>
        </div>
        <div class="field">
          <label for="capaSourceType">CAPA source type filter</label>
          <select id="capaSourceType">
            <option value="">all</option>
            <option value="DEFECT">DEFECT</option>
            <option value="WORK_ORDER">WORK_ORDER</option>
            <option value="INSPECTION">INSPECTION</option>
          </select>
        </div>
      </div>
      <div class="row">
        <div class="field">
          <label for="sparesVesselCode">Spares vesselCode filter</label>
          <input id="sparesVesselCode" value="LATERE" />
        </div>
        <div class="field">
          <label for="sparesStatus">Spares status filter</label>
          <select id="sparesStatus">
            <option value="">all</option>
            <option value="ACTIVE">ACTIVE</option>
            <option value="OBSOLETE">OBSOLETE</option>
          </select>
        </div>
        <div class="field">
          <label for="sparesCriticality">Spares criticality filter</label>
          <select id="sparesCriticality">
            <option value="">all</option>
            <option value="A">A</option>
            <option value="B">B</option>
            <option value="C">C</option>
          </select>
        </div>
      </div>
      <div class="row">
        <div class="field">
          <label for="providersVesselCode">Providers vesselCode filter</label>
          <input id="providersVesselCode" value="LATERE" />
        </div>
        <div class="field">
          <label for="providersStatus">Providers status filter</label>
          <select id="providersStatus">
            <option value="">all</option>
            <option value="ACTIVE">ACTIVE</option>
            <option value="INACTIVE">INACTIVE</option>
          </select>
        </div>
        <div class="field">
          <label for="providersCategory">Providers category filter</label>
          <select id="providersCategory">
            <option value="">all</option>
            <option value="Engine">Engine</option>
            <option value="Spares">Spares</option>
            <option value="Electrical">Electrical</option>
            <option value="Inspection">Inspection</option>
            <option value="Drive">Drive</option>
          </select>
        </div>
      </div>
      <div class="row">
        <div class="field">
          <label for="spareOrdersVesselCode">Spare orders vesselCode filter</label>
          <input id="spareOrdersVesselCode" value="LATERE" />
        </div>
        <div class="field">
          <label for="spareOrdersStatus">Spare orders status filter</label>
          <select id="spareOrdersStatus">
            <option value="">all</option>
            <option value="DRAFT">DRAFT</option>
            <option value="REQUESTED">REQUESTED</option>
            <option value="APPROVED">APPROVED</option>
            <option value="ORDERED">ORDERED</option>
            <option value="PARTIALLY_RECEIVED">PARTIALLY_RECEIVED</option>
            <option value="RECEIVED">RECEIVED</option>
            <option value="CANCELLED">CANCELLED</option>
          </select>
        </div>
        <div class="field">
          <label for="spareOrdersPriority">Spare orders priority filter</label>
          <select id="spareOrdersPriority">
            <option value="">all</option>
            <option value="LOW">LOW</option>
            <option value="MEDIUM">MEDIUM</option>
            <option value="HIGH">HIGH</option>
            <option value="CRITICAL">CRITICAL</option>
          </select>
        </div>
      </div>
      <div class="row">
        <div class="field">
          <label for="inspectionsVesselCode">Inspections vesselCode filter</label>
          <input id="inspectionsVesselCode" value="LATERE" />
        </div>
        <div class="field">
          <label for="inspectionsStatus">Inspections status filter</label>
          <select id="inspectionsStatus">
            <option value="">all</option>
            <option value="SCHEDULED">SCHEDULED</option>
            <option value="IN_PROGRESS">IN_PROGRESS</option>
            <option value="COMPLETED">COMPLETED</option>
            <option value="CANCELLED">CANCELLED</option>
          </select>
        </div>
        <div class="field">
          <label for="inspectionsResult">Inspections result filter</label>
          <select id="inspectionsResult">
            <option value="">all</option>
            <option value="PASS">PASS</option>
            <option value="FAIL">FAIL</option>
            <option value="CONDITIONAL">CONDITIONAL</option>
          </select>
        </div>
        <div class="field">
          <label for="inspectionsType">Inspections type filter</label>
          <select id="inspectionsType">
            <option value="">all</option>
            <option value="SAFETY">SAFETY</option>
            <option value="TECHNICAL">TECHNICAL</option>
            <option value="REGULATORY">REGULATORY</option>
            <option value="CLASS">CLASS</option>
          </select>
        </div>
      </div>
      <div class="row">
        <div class="field">
          <label for="certificatesVesselCode">Certificates vesselCode filter</label>
          <input id="certificatesVesselCode" value="LATERE" />
        </div>
        <div class="field">
          <label for="certificatesStatus">Certificates status filter</label>
          <select id="certificatesStatus">
            <option value="">all</option>
            <option value="ACTIVE">ACTIVE</option>
            <option value="EXPIRING_SOON">EXPIRING_SOON</option>
            <option value="EXPIRED">EXPIRED</option>
            <option value="SUSPENDED">SUSPENDED</option>
            <option value="CLOSED">CLOSED</option>
          </select>
        </div>
      </div>
      <div class="row">
        <div class="field">
          <label for="dailyReportsVesselCode">Daily reports vesselCode filter</label>
          <input id="dailyReportsVesselCode" value="LATERE" />
        </div>
        <div class="field">
          <label for="dailyReportsStatus">Daily reports status filter</label>
          <select id="dailyReportsStatus">
            <option value="">all</option>
            <option value="DRAFT">DRAFT</option>
            <option value="SUBMITTED">SUBMITTED</option>
            <option value="REVIEWED">REVIEWED</option>
            <option value="CLOSED">CLOSED</option>
          </select>
        </div>
        <div class="field">
          <label for="dailyReportsDate">Daily reports date filter</label>
          <input id="dailyReportsDate" value="2026-04-12" />
        </div>
      </div>
      <div class="row">
        <div class="field">
          <label for="attachmentsVesselCode">Attachments vesselCode filter</label>
          <input id="attachmentsVesselCode" value="LATERE" />
        </div>
        <div class="field">
          <label for="attachmentsStatus">Attachments status filter</label>
          <select id="attachmentsStatus">
            <option value="">all</option>
            <option value="ACTIVE">ACTIVE</option>
            <option value="ARCHIVED">ARCHIVED</option>
          </select>
        </div>
        <div class="field">
          <label for="attachmentsTargetType">Attachments target type filter</label>
          <select id="attachmentsTargetType">
            <option value="">all</option>
            <option value="DEFECT">DEFECT</option>
            <option value="WORK_ORDER">WORK_ORDER</option>
            <option value="MAINTENANCE_PLAN">MAINTENANCE_PLAN</option>
            <option value="INSPECTION">INSPECTION</option>
            <option value="CERTIFICATE">CERTIFICATE</option>
            <option value="DAILY_REPORT">DAILY_REPORT</option>
            <option value="CAPA">CAPA</option>
            <option value="SPARE_ORDER">SPARE_ORDER</option>
          </select>
        </div>
      </div>
      <div class="row">
        <div class="field">
          <label for="inspectionLogsVesselCode">Inspection logs vesselCode filter</label>
          <input id="inspectionLogsVesselCode" value="LATERE" />
        </div>
        <div class="field">
          <label for="inspectionLogsInspectionId">Inspection logs inspectionId filter</label>
          <input id="inspectionLogsInspectionId" value="inspection-demo-latere-001" />
        </div>
        <div class="field">
          <label for="inspectionLogsEntryType">Inspection logs entry type filter</label>
          <select id="inspectionLogsEntryType">
            <option value="">all</option>
            <option value="FINDING">FINDING</option>
            <option value="ACTION">ACTION</option>
            <option value="NOTE">NOTE</option>
          </select>
        </div>
        <div class="field">
          <label for="inspectionLogsSeverity">Inspection logs severity filter</label>
          <select id="inspectionLogsSeverity">
            <option value="">all</option>
            <option value="LOW">LOW</option>
            <option value="MEDIUM">MEDIUM</option>
            <option value="HIGH">HIGH</option>
            <option value="CRITICAL">CRITICAL</option>
          </select>
        </div>
      </div>
      <div class="row">
        <div class="field">
          <label for="stockMovementsVesselCode">Stock movements vesselCode filter</label>
          <input id="stockMovementsVesselCode" value="LATERE" />
        </div>
        <div class="field">
          <label for="stockMovementsType">Stock movements type filter</label>
          <select id="stockMovementsType">
            <option value="">all</option>
            <option value="RECEIPT">RECEIPT</option>
            <option value="ISSUE">ISSUE</option>
            <option value="ADJUSTMENT">ADJUSTMENT</option>
            <option value="TRANSFER">TRANSFER</option>
          </select>
        </div>
        <div class="field">
          <label for="stockMovementsSpareId">Stock movements spareId filter</label>
          <input id="stockMovementsSpareId" value="spare-demo-latere-thermostat-003" />
        </div>
      </div>
      <div class="row">
        <div class="field">
          <label for="providerEvaluationsVesselCode">Provider evaluations vesselCode filter</label>
          <input id="providerEvaluationsVesselCode" value="LATERE" />
        </div>
        <div class="field">
          <label for="providerEvaluationsStatus">Provider evaluations status filter</label>
          <select id="providerEvaluationsStatus">
            <option value="">all</option>
            <option value="DRAFT">DRAFT</option>
            <option value="SUBMITTED">SUBMITTED</option>
            <option value="APPROVED">APPROVED</option>
            <option value="REJECTED">REJECTED</option>
          </select>
        </div>
        <div class="field">
          <label for="providerEvaluationsRating">Provider evaluations rating filter</label>
          <select id="providerEvaluationsRating">
            <option value="">all</option>
            <option value="A">A</option>
            <option value="B">B</option>
            <option value="C">C</option>
            <option value="D">D</option>
          </select>
        </div>
      </div>
      <div class="row">
        <div class="field">
          <label for="providerNonconformitiesVesselCode">Provider nonconformities vesselCode filter</label>
          <input id="providerNonconformitiesVesselCode" value="LATERE" />
        </div>
        <div class="field">
          <label for="providerNonconformitiesStatus">Provider nonconformities status filter</label>
          <select id="providerNonconformitiesStatus">
            <option value="">all</option>
            <option value="OPEN">OPEN</option>
            <option value="UNDER_REVIEW">UNDER_REVIEW</option>
            <option value="RESOLVED">RESOLVED</option>
            <option value="CLOSED">CLOSED</option>
          </select>
        </div>
        <div class="field">
          <label for="providerNonconformitiesSeverity">Provider nonconformities severity filter</label>
          <select id="providerNonconformitiesSeverity">
            <option value="">all</option>
            <option value="LOW">LOW</option>
            <option value="MEDIUM">MEDIUM</option>
            <option value="HIGH">HIGH</option>
            <option value="CRITICAL">CRITICAL</option>
          </select>
        </div>
      </div>
      <div class="row">
        <div class="field">
          <label for="domainEventsVesselCode">Domain events vesselCode filter</label>
          <input id="domainEventsVesselCode" value="LATERE" />
        </div>
        <div class="field">
          <label for="domainEventsCategory">Domain events category filter</label>
          <select id="domainEventsCategory">
            <option value="">all</option>
            <option value="master_data">master_data</option>
            <option value="maintenance">maintenance</option>
            <option value="operations">operations</option>
            <option value="compliance">compliance</option>
            <option value="stock">stock</option>
            <option value="procurement">procurement</option>
            <option value="document">document</option>
            <option value="AI">AI</option>
            <option value="import_export">import_export</option>
            <option value="security">security</option>
          </select>
        </div>
        <div class="field">
          <label for="domainEventsType">Domain events type filter</label>
          <input id="domainEventsType" value="work_order_created" />
        </div>
      </div>
      <div class="row">
        <div class="field">
          <label for="aiInsightsVesselCode">AI insights vesselCode filter</label>
          <input id="aiInsightsVesselCode" value="" />
        </div>
        <div class="field">
          <label for="aiInsightsStatus">AI insights status filter</label>
          <select id="aiInsightsStatus">
            <option value="">all</option>
            <option value="OPEN" selected>OPEN</option>
            <option value="DISMISSED">DISMISSED</option>
            <option value="RESOLVED">RESOLVED</option>
          </select>
        </div>
        <div class="field">
          <label for="aiInsightsType">AI insights type filter</label>
          <select id="aiInsightsType">
            <option value="">all</option>
            <option value="backlog_risk">backlog_risk</option>
            <option value="repeated_failure">repeated_failure</option>
            <option value="repeated_deferral">repeated_deferral</option>
            <option value="pm_frequency_review">pm_frequency_review</option>
            <option value="stock_below_minimum">stock_below_minimum</option>
            <option value="stock_below_reorder_point">stock_below_reorder_point</option>
            <option value="certificate_expiring">certificate_expiring</option>
            <option value="certificate_expired">certificate_expired</option>
            <option value="inspection_failure_pattern">inspection_failure_pattern</option>
            <option value="overdue_capa">overdue_capa</option>
            <option value="overdue_work_order">overdue_work_order</option>
            <option value="documentation_gap">documentation_gap</option>
            <option value="operational_anomaly">operational_anomaly</option>
            <option value="recurring_asset_downtime">recurring_asset_downtime</option>
            <option value="trend_based_maintenance_improvement">trend_based_maintenance_improvement</option>
            <option value="cross_vessel_spare_availability">cross_vessel_spare_availability</option>
            <option value="fleet_repeated_failure_pattern">fleet_repeated_failure_pattern</option>
            <option value="fleet_known_fix_suggestion">fleet_known_fix_suggestion</option>
            <option value="fleet_shared_operational_experience">fleet_shared_operational_experience</option>
          </select>
        </div>
        <div class="field">
          <label for="aiInsightsTargetType">AI insights target type filter</label>
          <select id="aiInsightsTargetType">
            <option value="">all</option>
            <option value="VESSEL">VESSEL</option>
            <option value="ASSET">ASSET</option>
            <option value="WORK_ORDER">WORK_ORDER</option>
            <option value="DEFECT">DEFECT</option>
            <option value="CAPA">CAPA</option>
            <option value="SPARE">SPARE</option>
            <option value="CERTIFICATE">CERTIFICATE</option>
            <option value="INSPECTION">INSPECTION</option>
            <option value="FLEET">FLEET</option>
          </select>
        </div>
      </div>
      <div class="field mono">
        <label for="consoleOutput">Response</label>
        <textarea id="consoleOutput" readonly></textarea>
      </div>
    </div>
    <script>
      const output = document.getElementById('consoleOutput');
      const accessTokens = { tenant: '', platform: '' };

      function writeOutput(title, data) {
        const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
        output.value = title + "\n\n" + content;
      }

      function getTenantHost() {
        return document.getElementById('tenantSlug').value.trim();
      }

      async function callJson(path, options = {}) {
        const response = await fetch(path, options);
        const text = await response.text();
        let payload;
        try {
          payload = JSON.parse(text);
        } catch {
          payload = text;
        }
        return { status: response.status, payload };
      }

      async function loginTenant() {
        const result = await callJson('/app/auth/login?tenant=' + encodeURIComponent(getTenantHost()), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            identifier: document.getElementById('tenantIdentifier').value,
            password: document.getElementById('tenantPassword').value,
            locale: document.getElementById('tenantLocale').value,
          }),
          credentials: 'same-origin',
        });

        if (result.payload && result.payload.session && result.payload.session.accessToken) {
          accessTokens.tenant = result.payload.session.accessToken;
        }

        writeOutput('Tenant Login', result);
      }

      async function loginPlatform() {
        const result = await callJson('/platform/auth/login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email: document.getElementById('platformEmail').value,
            password: document.getElementById('platformPassword').value,
          }),
        });

        if (result.payload && result.payload.session && result.payload.session.accessToken) {
          accessTokens.platform = result.payload.session.accessToken;
        }

        writeOutput('Platform Login', result);
      }

      function readPlatformTenantPayload() {
        const raw = document.getElementById('platformTenantPayload').value;
        try {
          return JSON.parse(raw);
        } catch (error) {
          writeOutput('Platform Tenant Payload Error', { error: String(error) });
          return null;
        }
      }

      async function loadPlatformTenants() {
        const result = await callJson('/platform/tenants', {
          headers: {
            'Authorization': 'Bearer ' + accessTokens.platform,
          },
        });
        writeOutput('Platform Tenants', result);
      }

      async function loadPlatformTenant() {
        const slug = document.getElementById('platformTenantSlug').value.trim();
        const result = await callJson('/platform/tenants/' + encodeURIComponent(slug), {
          headers: {
            'Authorization': 'Bearer ' + accessTokens.platform,
          },
        });
        writeOutput('Platform Tenant', result);
      }

      async function createPlatformTenant() {
        const payload = readPlatformTenantPayload();
        if (!payload) return;
        const result = await callJson('/platform/tenants', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + accessTokens.platform,
          },
          body: JSON.stringify(payload),
        });
        writeOutput('Platform Tenant Create', result);
      }

      async function updatePlatformTenant() {
        const payload = readPlatformTenantPayload();
        if (!payload) return;
        const slug = document.getElementById('platformTenantSlug').value.trim();
        const result = await callJson('/platform/tenants/' + encodeURIComponent(slug), {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + accessTokens.platform,
          },
          body: JSON.stringify(payload),
        });
        writeOutput('Platform Tenant Update', result);
      }

      function readPlatformTenantDomainPayload() {
        const raw = document.getElementById('platformTenantDomainPayload').value;
        try {
          return JSON.parse(raw);
        } catch (error) {
          writeOutput('Platform Tenant Domain Payload Error', { error: String(error) });
          return null;
        }
      }

      async function loadPlatformTenantDomains() {
        const slug = document.getElementById('platformTenantSlug').value.trim();
        const result = await callJson('/platform/tenants/' + encodeURIComponent(slug) + '/domains', {
          headers: {
            'Authorization': 'Bearer ' + accessTokens.platform,
          },
        });
        writeOutput('Platform Tenant Domains', result);
      }

      async function createPlatformTenantDomain() {
        const payload = readPlatformTenantDomainPayload();
        if (!payload) return;
        const slug = document.getElementById('platformTenantSlug').value.trim();
        const result = await callJson('/platform/tenants/' + encodeURIComponent(slug) + '/domains', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + accessTokens.platform,
          },
          body: JSON.stringify(payload),
        });
        writeOutput('Platform Tenant Domain Create', result);
      }

      async function updatePlatformTenantDomain() {
        const payload = readPlatformTenantDomainPayload();
        if (!payload) return;
        const slug = document.getElementById('platformTenantSlug').value.trim();
        const domainId = document.getElementById('platformTenantDomainId').value.trim();
        const result = await callJson(
          '/platform/tenants/' + encodeURIComponent(slug) + '/domains/' + encodeURIComponent(domainId),
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + accessTokens.platform,
            },
            body: JSON.stringify(payload),
          },
        );
        writeOutput('Platform Tenant Domain Update', result);
      }

      function readPlatformTenantInvitationPayload() {
        const raw = document.getElementById('platformTenantInvitationPayload').value;
        try {
          return JSON.parse(raw);
        } catch (error) {
          writeOutput('Platform Tenant Invitation Payload Error', { error: String(error) });
          return null;
        }
      }

      async function loadPlatformTenantInvitations() {
        const slug = document.getElementById('platformTenantSlug').value.trim();
        const result = await callJson('/platform/tenants/' + encodeURIComponent(slug) + '/invitations', {
          headers: {
            'Authorization': 'Bearer ' + accessTokens.platform,
          },
        });
        writeOutput('Platform Tenant Invitations', result);
      }

      async function createPlatformTenantInvitation() {
        const payload = readPlatformTenantInvitationPayload();
        if (!payload) return;
        const slug = document.getElementById('platformTenantSlug').value.trim();
        const result = await callJson('/platform/tenants/' + encodeURIComponent(slug) + '/invitations', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + accessTokens.platform,
          },
          body: JSON.stringify(payload),
        });
        writeOutput('Platform Tenant Invitation Create', result);
      }

      function readPlatformTenantUserPayload() {
        const raw = document.getElementById('platformTenantUserPayload').value;
        try {
          return JSON.parse(raw);
        } catch (error) {
          writeOutput('Platform Tenant User Payload Error', { error: String(error) });
          return null;
        }
      }

      async function loadPlatformTenantUsers() {
        const slug = document.getElementById('platformTenantSlug').value.trim();
        const result = await callJson('/platform/tenants/' + encodeURIComponent(slug) + '/users', {
          headers: {
            'Authorization': 'Bearer ' + accessTokens.platform,
          },
        });
        writeOutput('Platform Tenant Users', result);
      }

      async function loadPlatformTenantUser() {
        const slug = document.getElementById('platformTenantSlug').value.trim();
        const userId = document.getElementById('platformTenantUserId').value.trim();
        const result = await callJson(
          '/platform/tenants/' + encodeURIComponent(slug) + '/users/' + encodeURIComponent(userId),
          {
            headers: {
              'Authorization': 'Bearer ' + accessTokens.platform,
            },
          },
        );
        writeOutput('Platform Tenant User', result);
      }

      async function createPlatformTenantUser() {
        const payload = readPlatformTenantUserPayload();
        if (!payload) return;
        const slug = document.getElementById('platformTenantSlug').value.trim();
        const result = await callJson('/platform/tenants/' + encodeURIComponent(slug) + '/users', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + accessTokens.platform,
          },
          body: JSON.stringify(payload),
        });
        writeOutput('Platform Tenant User Create', result);
      }

      async function updatePlatformTenantUser() {
        const payload = readPlatformTenantUserPayload();
        if (!payload) return;
        const slug = document.getElementById('platformTenantSlug').value.trim();
        const userId = document.getElementById('platformTenantUserId').value.trim();
        const result = await callJson(
          '/platform/tenants/' + encodeURIComponent(slug) + '/users/' + encodeURIComponent(userId),
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + accessTokens.platform,
            },
            body: JSON.stringify(payload),
          },
        );
        writeOutput('Platform Tenant User Update', result);
      }

      function readPlatformUserPayload() {
        const raw = document.getElementById('platformUserPayload').value;
        try {
          return JSON.parse(raw);
        } catch (error) {
          writeOutput('Platform User Payload Error', { error: String(error) });
          return null;
        }
      }

      async function loadPlatformUsers() {
        const result = await callJson('/platform/users', {
          headers: {
            'Authorization': 'Bearer ' + accessTokens.platform,
          },
        });
        writeOutput('Platform Users', result);
      }

      async function loadPlatformUser() {
        const userId = document.getElementById('platformUserId').value.trim();
        const result = await callJson('/platform/users/' + encodeURIComponent(userId), {
          headers: {
            'Authorization': 'Bearer ' + accessTokens.platform,
          },
        });
        writeOutput('Platform User', result);
      }

      async function createPlatformUser() {
        const payload = readPlatformUserPayload();
        if (!payload) return;
        const result = await callJson('/platform/users', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + accessTokens.platform,
          },
          body: JSON.stringify(payload),
        });
        writeOutput('Platform User Create', result);
      }

      async function updatePlatformUser() {
        const payload = readPlatformUserPayload();
        if (!payload) return;
        const userId = document.getElementById('platformUserId').value.trim();
        const result = await callJson('/platform/users/' + encodeURIComponent(userId), {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + accessTokens.platform,
          },
          body: JSON.stringify(payload),
        });
        writeOutput('Platform User Update', result);
      }

      async function loadPlatformAuditEvents() {
        const tenantSlug = document.getElementById('platformAuditTenantSlug').value.trim();
        const actorType = document.getElementById('platformAuditActorType').value;
        const action = document.getElementById('platformAuditAction').value.trim();
        const entityType = document.getElementById('platformAuditEntityType').value.trim();
        const query = new URLSearchParams();
        if (tenantSlug) query.set('tenantSlug', tenantSlug);
        if (actorType) query.set('actorType', actorType);
        if (action) query.set('action', action);
        if (entityType) query.set('entityType', entityType);
        const result = await callJson('/platform/audit-events?' + query.toString(), {
          headers: {
            'Authorization': 'Bearer ' + accessTokens.platform,
          },
        });
        writeOutput('Platform Audit Events', result);
      }

      function readPlatformPromptPayload() {
        const raw = document.getElementById('platformPromptPayload').value;
        try {
          return JSON.parse(raw);
        } catch (error) {
          writeOutput('Platform Prompt Payload Error', { error: String(error) });
          return null;
        }
      }

      async function loadPlatformPrompts() {
        const result = await callJson('/platform/prompts', {
          headers: {
            'Authorization': 'Bearer ' + accessTokens.platform,
          },
        });
        writeOutput('Platform Prompts', result);
      }

      async function loadPlatformPrompt() {
        const promptId = document.getElementById('platformPromptId').value.trim();
        const result = await callJson('/platform/prompts/' + encodeURIComponent(promptId), {
          headers: {
            'Authorization': 'Bearer ' + accessTokens.platform,
          },
        });
        writeOutput('Platform Prompt', result);
      }

      async function createPlatformPrompt() {
        const payload = readPlatformPromptPayload();
        if (!payload) return;
        const result = await callJson('/platform/prompts', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + accessTokens.platform,
          },
          body: JSON.stringify(payload),
        });
        writeOutput('Platform Prompt Create', result);
      }

      async function updatePlatformPrompt() {
        const payload = readPlatformPromptPayload();
        if (!payload) return;
        const promptId = document.getElementById('platformPromptId').value.trim();
        const result = await callJson('/platform/prompts/' + encodeURIComponent(promptId), {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + accessTokens.platform,
          },
          body: JSON.stringify(payload),
        });
        writeOutput('Platform Prompt Update', result);
      }

      async function publishPlatformPrompt() {
        const promptId = document.getElementById('platformPromptId').value.trim();
        const result = await callJson('/platform/prompts/' + encodeURIComponent(promptId) + '/publish', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + accessTokens.platform,
          },
        });
        writeOutput('Platform Prompt Publish', result);
      }

      async function rollbackPlatformPrompt() {
        const promptId = document.getElementById('platformPromptId').value.trim();
        const result = await callJson('/platform/prompts/' + encodeURIComponent(promptId) + '/rollback', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + accessTokens.platform,
          },
        });
        writeOutput('Platform Prompt Rollback', result);
      }

      async function loadBootstrap() {
        const result = await callJson('/public/bootstrap?tenant=' + encodeURIComponent(getTenantHost()) + '&locale=' + encodeURIComponent(document.getElementById('tenantLocale').value));
        writeOutput('Bootstrap', result);
      }

      async function loadMe() {
        const result = await callJson('/app/me?tenant=' + encodeURIComponent(getTenantHost()), {
          headers: {
            'Authorization': 'Bearer ' + accessTokens.tenant,
          },
        });
        writeOutput('Me', result);
      }

      async function loadVessels() {
        const result = await callJson('/app/vessels?tenant=' + encodeURIComponent(getTenantHost()), {
          headers: {
            'Authorization': 'Bearer ' + accessTokens.tenant,
          },
        });
        writeOutput('Vessels', result);
      }

      async function loadAssets() {
        const vesselCode = document.getElementById('assetsVesselCode').value.trim();
        const result = await callJson('/app/assets?tenant=' + encodeURIComponent(getTenantHost()) + '&vesselCode=' + encodeURIComponent(vesselCode), {
          headers: {
            'Authorization': 'Bearer ' + accessTokens.tenant,
          },
        });
        writeOutput('Assets', result);
      }

      async function loadMaintenancePlans() {
        const vesselCode = document.getElementById('maintenanceVesselCode').value.trim();
        const status = document.getElementById('maintenanceStatus').value;
        const triggerType = document.getElementById('maintenanceTriggerType').value;
        const query = new URLSearchParams({ tenant: getTenantHost() });
        if (vesselCode) query.set('vesselCode', vesselCode);
        if (status) query.set('status', status);
        if (triggerType) query.set('triggerType', triggerType);

        const result = await callJson('/app/maintenance-plans?' + query.toString(), {
          headers: {
            'Authorization': 'Bearer ' + accessTokens.tenant,
          },
        });
        writeOutput('Maintenance Plans', result);
      }

      async function loadWorkOrders() {
        const vesselCode = document.getElementById('workOrderVesselCode').value.trim();
        const status = document.getElementById('workOrderStatus').value;
        const type = document.getElementById('workOrderType').value;
        const query = new URLSearchParams({ tenant: getTenantHost() });
        if (vesselCode) query.set('vesselCode', vesselCode);
        if (status) query.set('status', status);
        if (type) query.set('type', type);

        const result = await callJson('/app/work-orders?' + query.toString(), {
          headers: {
            'Authorization': 'Bearer ' + accessTokens.tenant,
          },
        });
        writeOutput('Work Orders', result);
      }

      async function loadDefects() {
        const vesselCode = document.getElementById('defectVesselCode').value.trim();
        const status = document.getElementById('defectStatus').value;
        const severity = document.getElementById('defectSeverity').value;
        const query = new URLSearchParams({ tenant: getTenantHost() });
        if (vesselCode) query.set('vesselCode', vesselCode);
        if (status) query.set('status', status);
        if (severity) query.set('severity', severity);

        const result = await callJson('/app/defects?' + query.toString(), {
          headers: {
            'Authorization': 'Bearer ' + accessTokens.tenant,
          },
        });
        writeOutput('Defects', result);
      }

      async function acceptInvitation() {
        const token = document.getElementById('invitationToken').value.trim();
        const firstName = document.getElementById('invitationFirstName').value.trim();
        const lastName = document.getElementById('invitationLastName').value.trim();
        const password = document.getElementById('invitationPassword').value;
        const result = await callJson('/app/invitations/accept?tenant=' + encodeURIComponent(getTenantHost()), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            token,
            password,
            firstName,
            lastName,
          }),
        });
        writeOutput('Invitation Accept', result);
      }

      async function loadDeferrals() {
        const vesselCode = document.getElementById('deferralVesselCode').value.trim();
        const status = document.getElementById('deferralStatus').value;
        const sourceType = document.getElementById('deferralSourceType').value;
        const query = new URLSearchParams({ tenant: getTenantHost() });
        if (vesselCode) query.set('vesselCode', vesselCode);
        if (status) query.set('status', status);
        if (sourceType) query.set('sourceType', sourceType);

        const result = await callJson('/app/deferrals?' + query.toString(), {
          headers: {
            'Authorization': 'Bearer ' + accessTokens.tenant,
          },
        });
        writeOutput('Deferrals', result);
      }

      async function loadCapa() {
        const vesselCode = document.getElementById('capaVesselCode').value.trim();
        const status = document.getElementById('capaStatus').value;
        const priority = document.getElementById('capaPriority').value;
        const sourceType = document.getElementById('capaSourceType').value;
        const query = new URLSearchParams({ tenant: getTenantHost() });
        if (vesselCode) query.set('vesselCode', vesselCode);
        if (status) query.set('status', status);
        if (priority) query.set('priority', priority);
        if (sourceType) query.set('sourceType', sourceType);

        const result = await callJson('/app/capa?' + query.toString(), {
          headers: {
            'Authorization': 'Bearer ' + accessTokens.tenant,
          },
        });
        writeOutput('CAPA', result);
      }

      async function loadSpares() {
        const vesselCode = document.getElementById('sparesVesselCode').value.trim();
        const status = document.getElementById('sparesStatus').value;
        const criticality = document.getElementById('sparesCriticality').value;
        const query = new URLSearchParams({ tenant: getTenantHost() });
        if (vesselCode) query.set('vesselCode', vesselCode);
        if (status) query.set('status', status);
        if (criticality) query.set('criticality', criticality);

        const result = await callJson('/app/spares?' + query.toString(), {
          headers: {
            'Authorization': 'Bearer ' + accessTokens.tenant,
          },
        });
        writeOutput('Spares', result);
      }

      async function loadProviders() {
        const vesselCode = document.getElementById('providersVesselCode').value.trim();
        const status = document.getElementById('providersStatus').value;
        const category = document.getElementById('providersCategory').value;
        const query = new URLSearchParams({ tenant: getTenantHost() });
        if (vesselCode) query.set('vesselCode', vesselCode);
        if (status) query.set('status', status);
        if (category) query.set('category', category);

        const result = await callJson('/app/providers?' + query.toString(), {
          headers: {
            'Authorization': 'Bearer ' + accessTokens.tenant,
          },
        });
        writeOutput('Providers', result);
      }

      async function loadSpareOrders() {
        const vesselCode = document.getElementById('spareOrdersVesselCode').value.trim();
        const status = document.getElementById('spareOrdersStatus').value;
        const priority = document.getElementById('spareOrdersPriority').value;
        const query = new URLSearchParams({ tenant: getTenantHost() });
        if (vesselCode) query.set('vesselCode', vesselCode);
        if (status) query.set('status', status);
        if (priority) query.set('priority', priority);

        const result = await callJson('/app/spare-orders?' + query.toString(), {
          headers: {
            'Authorization': 'Bearer ' + accessTokens.tenant,
          },
        });
        writeOutput('Spare Orders', result);
      }

      async function loadInspections() {
        const vesselCode = document.getElementById('inspectionsVesselCode').value.trim();
        const status = document.getElementById('inspectionsStatus').value;
        const resultFilter = document.getElementById('inspectionsResult').value;
        const type = document.getElementById('inspectionsType').value;
        const query = new URLSearchParams({ tenant: getTenantHost() });
        if (vesselCode) query.set('vesselCode', vesselCode);
        if (status) query.set('status', status);
        if (resultFilter) query.set('result', resultFilter);
        if (type) query.set('type', type);

        const result = await callJson('/app/inspections?' + query.toString(), {
          headers: {
            'Authorization': 'Bearer ' + accessTokens.tenant,
          },
        });
        writeOutput('Inspections', result);
      }

      async function loadCertificates() {
        const vesselCode = document.getElementById('certificatesVesselCode').value.trim();
        const status = document.getElementById('certificatesStatus').value;
        const query = new URLSearchParams({ tenant: getTenantHost() });
        if (vesselCode) query.set('vesselCode', vesselCode);
        if (status) query.set('status', status);

        const result = await callJson('/app/certificates?' + query.toString(), {
          headers: {
            'Authorization': 'Bearer ' + accessTokens.tenant,
          },
        });
        writeOutput('Certificates', result);
      }

      async function loadDailyReports() {
        const vesselCode = document.getElementById('dailyReportsVesselCode').value.trim();
        const status = document.getElementById('dailyReportsStatus').value;
        const reportDate = document.getElementById('dailyReportsDate').value.trim();
        const query = new URLSearchParams({ tenant: getTenantHost() });
        if (vesselCode) query.set('vesselCode', vesselCode);
        if (status) query.set('status', status);
        if (reportDate) query.set('reportDate', reportDate);

        const result = await callJson('/app/daily-reports?' + query.toString(), {
          headers: {
            'Authorization': 'Bearer ' + accessTokens.tenant,
          },
        });
        writeOutput('Daily Reports', result);
      }

      async function loadAttachments() {
        const vesselCode = document.getElementById('attachmentsVesselCode').value.trim();
        const status = document.getElementById('attachmentsStatus').value;
        const targetType = document.getElementById('attachmentsTargetType').value;
        const query = new URLSearchParams({ tenant: getTenantHost() });
        if (vesselCode) query.set('vesselCode', vesselCode);
        if (status) query.set('status', status);
        if (targetType) query.set('targetType', targetType);

        const result = await callJson('/app/attachments?' + query.toString(), {
          headers: {
            'Authorization': 'Bearer ' + accessTokens.tenant,
          },
        });
        writeOutput('Attachments', result);
      }

      async function loadInspectionLogs() {
        const vesselCode = document.getElementById('inspectionLogsVesselCode').value.trim();
        const inspectionId = document.getElementById('inspectionLogsInspectionId').value.trim();
        const entryType = document.getElementById('inspectionLogsEntryType').value;
        const severity = document.getElementById('inspectionLogsSeverity').value;
        const query = new URLSearchParams({ tenant: getTenantHost() });
        if (vesselCode) query.set('vesselCode', vesselCode);
        if (inspectionId) query.set('inspectionId', inspectionId);
        if (entryType) query.set('entryType', entryType);
        if (severity) query.set('severity', severity);

        const result = await callJson('/app/inspection-logs?' + query.toString(), {
          headers: {
            'Authorization': 'Bearer ' + accessTokens.tenant,
          },
        });
        writeOutput('Inspection Logs', result);
      }

      async function loadStockMovements() {
        const vesselCode = document.getElementById('stockMovementsVesselCode').value.trim();
        const movementType = document.getElementById('stockMovementsType').value;
        const spareId = document.getElementById('stockMovementsSpareId').value.trim();
        const query = new URLSearchParams({ tenant: getTenantHost() });
        if (vesselCode) query.set('vesselCode', vesselCode);
        if (movementType) query.set('movementType', movementType);
        if (spareId) query.set('spareId', spareId);

        const result = await callJson('/app/stock-movements?' + query.toString(), {
          headers: {
            'Authorization': 'Bearer ' + accessTokens.tenant,
          },
        });
        writeOutput('Stock Movements', result);
      }

      async function loadProviderEvaluations() {
        const vesselCode = document.getElementById('providerEvaluationsVesselCode').value.trim();
        const status = document.getElementById('providerEvaluationsStatus').value;
        const rating = document.getElementById('providerEvaluationsRating').value;
        const query = new URLSearchParams({ tenant: getTenantHost() });
        if (vesselCode) query.set('vesselCode', vesselCode);
        if (status) query.set('status', status);
        if (rating) query.set('rating', rating);

        const result = await callJson('/app/provider-evaluations?' + query.toString(), {
          headers: {
            'Authorization': 'Bearer ' + accessTokens.tenant,
          },
        });
        writeOutput('Provider Evaluations', result);
      }

      async function loadProviderNonconformities() {
        const vesselCode = document.getElementById('providerNonconformitiesVesselCode').value.trim();
        const status = document.getElementById('providerNonconformitiesStatus').value;
        const severity = document.getElementById('providerNonconformitiesSeverity').value;
        const query = new URLSearchParams({ tenant: getTenantHost() });
        if (vesselCode) query.set('vesselCode', vesselCode);
        if (status) query.set('status', status);
        if (severity) query.set('severity', severity);

        const result = await callJson('/app/provider-nonconformities?' + query.toString(), {
          headers: {
            'Authorization': 'Bearer ' + accessTokens.tenant,
          },
        });
        writeOutput('Provider Nonconformities', result);
      }

      async function loadDomainEvents() {
        const vesselCode = document.getElementById('domainEventsVesselCode').value.trim();
        const category = document.getElementById('domainEventsCategory').value;
        const eventType = document.getElementById('domainEventsType').value.trim();
        const query = new URLSearchParams({ tenant: getTenantHost() });
        if (vesselCode) query.set('vesselCode', vesselCode);
        if (category) query.set('category', category);
        if (eventType) query.set('eventType', eventType);

        const result = await callJson('/app/domain-events?' + query.toString(), {
          headers: {
            'Authorization': 'Bearer ' + accessTokens.tenant,
          },
        });
        writeOutput('Domain Events', result);
      }

      async function loadAiInsights() {
        const vesselCode = document.getElementById('aiInsightsVesselCode').value.trim();
        const status = document.getElementById('aiInsightsStatus').value;
        const insightType = document.getElementById('aiInsightsType').value;
        const targetType = document.getElementById('aiInsightsTargetType').value;
        const query = new URLSearchParams({ tenant: getTenantHost() });
        if (vesselCode) query.set('vesselCode', vesselCode);
        if (status) query.set('status', status);
        if (insightType) query.set('insightType', insightType);
        if (targetType) query.set('targetType', targetType);

        const result = await callJson('/app/ai-insights?' + query.toString(), {
          headers: {
            'Authorization': 'Bearer ' + accessTokens.tenant,
          },
        });
        writeOutput('AI Insights', result);
      }
    </script>
  </body>
</html>`;
}
