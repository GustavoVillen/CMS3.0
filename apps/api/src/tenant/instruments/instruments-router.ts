import type { IncomingMessage, ServerResponse } from "node:http";
import type { AppEnv } from "../../config/env";
import { sendJson } from "../../http/json-response";
import { readJsonBody } from "../../http/read-json-body";
import { RouteError } from "../../http/route-error";
import { resolveTenantSlugFromRequest } from "../bootstrap/public-bootstrap-route";
import { requireTenantAccessSession } from "../auth/tenant-route-auth";
import {
  createTenantInstrument,
  getTenantInstrument,
  listTenantInstruments,
  listOverdueCalibrations,
  parseCalibrationDueQuery,
  recordCalibration,
  softDeleteTenantInstrument,
  updateTenantInstrument,
} from "./instruments-service";

function requireTenantSlug(request: IncomingMessage, env: AppEnv): string {
  const slug = resolveTenantSlugFromRequest(request, env);
  if (!slug) throw new RouteError(400, "TENANT_UNRESOLVED", "Unable to resolve tenant.");
  return slug;
}

export async function handleInstrumentRoutes(
  method: string,
  url: URL,
  request: IncomingMessage,
  response: ServerResponse,
  env: AppEnv,
): Promise<boolean> {
  if (!url.pathname.startsWith("/app/pms/instruments")) return false;

  const tenantSlug = requireTenantSlug(request, env);
  const session = requireTenantAccessSession(request, tenantSlug);

  if (method === "GET" && url.pathname === "/app/pms/instruments") {
    const items = await listTenantInstruments(session, {
      vesselCode: url.searchParams.get("vesselCode"),
      status: url.searchParams.get("status"),
      instrumentType: url.searchParams.get("instrumentType"),
      calibrationDue: parseCalibrationDueQuery(url.searchParams.get("calibrationDue")),
    });
    sendJson(response, 200, { items, total: items.length });
    return true;
  }

  if (method === "POST" && url.pathname === "/app/pms/instruments") {
    const body = await readJsonBody(request) as Parameters<typeof createTenantInstrument>[1];
    const created = await createTenantInstrument(session, body);
    sendJson(response, 201, created);
    return true;
  }

  if (method === "GET" && url.pathname === "/app/pms/instruments/overdue-calibrations") {
    const items = await listOverdueCalibrations(session, url.searchParams.get("vesselCode"));
    sendJson(response, 200, { items, total: items.length });
    return true;
  }

  if (method === "POST" && /^\/app\/pms\/instruments\/[^/]+\/calibration$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    const body = await readJsonBody(request) as Parameters<typeof recordCalibration>[2];
    const updated = await recordCalibration(session, id, body);
    sendJson(response, 200, updated);
    return true;
  }

  if (/^\/app\/pms\/instruments\/[^/]+$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;

    if (method === "GET") {
      sendJson(response, 200, await getTenantInstrument(session, id));
      return true;
    }

    if (method === "PATCH") {
      const body = await readJsonBody(request) as Parameters<typeof updateTenantInstrument>[2];
      sendJson(response, 200, await updateTenantInstrument(session, id, body));
      return true;
    }

    if (method === "DELETE") {
      await softDeleteTenantInstrument(session, id);
      sendJson(response, 200, { ok: true });
      return true;
    }
  }

  return false;
}
