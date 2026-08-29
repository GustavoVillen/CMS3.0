import type { IncomingMessage, ServerResponse } from "node:http";
import type { AppEnv } from "../../config/env";
import { sendJson } from "../../http/json-response";
import { RouteError } from "../../http/route-error";
import { resolveTenantSlugFromRequest } from "../bootstrap/public-bootstrap-route";
import { requireTenantAccessSession } from "../auth/tenant-route-auth";
import { deleteTenantMaintenancePlan } from "../maintenance-plans/maintenance-plans-service";
import { handleInstrumentRoutes } from "../instruments/instruments-router";
import { handleAssetRoutes } from "./assets-router";
import { handleAssetHoursRoutes } from "../asset-hours/asset-hours-router";
import { handleSparesRoutes } from "./spares-router";
import { handleInspectionsRoutes } from "./inspections-router";
import { handleMaintenanceRoutes } from "./maintenance-router";
import { handleServiceRequestsRoutes } from "./service-requests-router";
import { handleTriggersRoutes } from "./triggers-router";
import { handleQualityRoutes } from "./quality-router";
import { handleCatalogsRoutes } from "./catalogs-router";
import { handleDrydockRoutes } from "./drydock-router";

/**
 * PMS (Preventive Maintenance System) router - Etapa 2+
 *
 * Handles all /app/pms/* routes: triggers, execution windows, due items,
 * inspection templates, checklist executions, work logs, instruments, etc.
 */
export async function handlePmsRoutes(
  method: string,
  url: URL,
  request: IncomingMessage,
  response: ServerResponse,
  env: AppEnv,
): Promise<boolean> {
  // DELETE /app/pms/maintenance-plans/:id — handled here directly for reliability
  if (method === "DELETE" && /^\/app\/pms\/maintenance-plans\/[^/]+$/.test(url.pathname)) {
    const slug = resolveTenantSlugFromRequest(request, env);
    if (!slug) throw new RouteError(400, "TENANT_UNRESOLVED", "Unable to resolve tenant.");
    const session = requireTenantAccessSession(request, slug);
    const role = session.user.role;
    if (role !== "TENANT_ADMIN" && role !== "FLEET_SUPERINTENDENT") {
      throw new RouteError(403, "FORBIDDEN", "Solo ADMIN o Superintendente pueden eliminar planes.");
    }
    const id = url.pathname.split("/")[4]!;
    await deleteTenantMaintenancePlan(session, id);
    sendJson(response, 200, { ok: true });
    return true;
  }

  if (await handleInstrumentRoutes(method, url, request, response, env)) return true;
  if (await handleAssetRoutes(method, url, request, response, env)) return true;
  if (await handleAssetHoursRoutes(method, url, request, response, env)) return true;
  if (await handleSparesRoutes(method, url, request, response, env)) return true;
  if (await handleInspectionsRoutes(method, url, request, response, env)) return true;
  if (await handleMaintenanceRoutes(method, url, request, response, env)) return true;
  if (await handleServiceRequestsRoutes(method, url, request, response, env)) return true;
  if (await handleTriggersRoutes(method, url, request, response, env)) return true;
  if (await handleQualityRoutes(method, url, request, response, env)) return true;
  if (await handleCatalogsRoutes(method, url, request, response, env)) return true;
  if (await handleDrydockRoutes(method, url, request, response, env)) return true;

  return false;
}
