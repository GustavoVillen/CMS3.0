// Rutas de la planilla "Horas de Equipos" (/app/pms/asset-hours).
// Lectura: cualquier usuario con acceso al buque. Escritura: permiso assetHours.write
// (lo valida el service; acá sólo se corta a AUDITOR_READONLY, que nunca escribe).

import type { IncomingMessage, ServerResponse } from "node:http";
import type { AppEnv } from "../../config/env";
import { sendJson } from "../../http/json-response";
import { readJsonBody } from "../../http/read-json-body";
import { RouteError } from "../../http/route-error";
import { resolveTenantSlugFromRequest } from "../bootstrap/public-bootstrap-route";
import { requireTenantAccessSession } from "../auth/tenant-route-auth";
import {
  getAssetHoursHistory,
  listVesselHoursSheet,
  recordHoursReadings,
  type HoursReadingInput,
} from "./asset-hours-service";

function requireTenantSlug(request: IncomingMessage, env: AppEnv): string {
  const slug = resolveTenantSlugFromRequest(request, env);
  if (!slug) throw new RouteError(400, "TENANT_UNRESOLVED", "Unable to resolve tenant.");
  return slug;
}

interface SaveBody {
  readingDate?: string;
  entries?: Array<{
    assetId?: string;
    runningHours?: number | string | null;
    readingDate?: string;
    note?: string | null;
  }>;
}

export async function handleAssetHoursRoutes(
  method: string,
  url: URL,
  request: IncomingMessage,
  response: ServerResponse,
  env: AppEnv,
): Promise<boolean> {
  if (!url.pathname.startsWith("/app/pms/asset-hours")) return false;

  const session = requireTenantAccessSession(request, requireTenantSlug(request, env));

  if (method === "GET" && url.pathname === "/app/pms/asset-hours") {
    const vesselCode = url.searchParams.get("vesselCode");
    if (!vesselCode) throw new RouteError(400, "VALIDATION_ERROR", "Falta el parámetro vesselCode.");
    sendJson(response, 200, await listVesselHoursSheet(session, {
      vesselCode,
      readingDate: url.searchParams.get("date"),
      includeUntracked: url.searchParams.get("includeUntracked") === "true",
    }));
    return true;
  }

  if (method === "GET" && /^\/app\/pms\/asset-hours\/[^/]+\/history$/.test(url.pathname)) {
    const assetId = url.pathname.split("/")[4]!;
    sendJson(response, 200, await getAssetHoursHistory(session, assetId));
    return true;
  }

  if (method === "PUT" && url.pathname === "/app/pms/asset-hours") {
    if (session.user.role === "AUDITOR_READONLY") {
      throw new RouteError(403, "FORBIDDEN", "AUDITOR_READONLY solo puede consultar.");
    }
    const body = await readJsonBody(request) as SaveBody;
    const fallbackDate = body.readingDate;

    const entries: HoursReadingInput[] = (body.entries ?? [])
      .filter((e) => e?.assetId && e.runningHours !== null && e.runningHours !== undefined && e.runningHours !== "")
      .map((e) => {
        const readingDate = e.readingDate ?? fallbackDate;
        if (!readingDate) {
          throw new RouteError(400, "VALIDATION_ERROR", "Falta la fecha de la lectura.");
        }
        const runningHours = Number(e.runningHours);
        if (!Number.isFinite(runningHours)) {
          throw new RouteError(400, "VALIDATION_ERROR", "Las horas deben ser un número.");
        }
        return { assetId: e.assetId!, runningHours, readingDate, note: e.note ?? null };
      });

    if (entries.length === 0) {
      throw new RouteError(400, "VALIDATION_ERROR", "No hay lecturas para guardar.");
    }

    sendJson(response, 200, await recordHoursReadings(session, entries, { source: "MANUAL" }));
    return true;
  }

  return false;
}
