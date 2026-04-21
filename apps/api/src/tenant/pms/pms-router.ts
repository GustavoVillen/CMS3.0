import type { IncomingMessage, ServerResponse } from "node:http";
import type { AppEnv } from "../../config/env";
import { handleInstrumentRoutes } from "../instruments/instruments-router";
import { handleAssetRoutes } from "./assets-router";
import { handleSparesRoutes } from "./spares-router";
import { handleInspectionsRoutes } from "./inspections-router";
import { handleMaintenanceRoutes } from "./maintenance-router";
import { handleTriggersRoutes } from "./triggers-router";
import { handleQualityRoutes } from "./quality-router";
import { handleCatalogsRoutes } from "./catalogs-router";

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
  if (await handleInstrumentRoutes(method, url, request, response, env)) return true;
  if (await handleAssetRoutes(method, url, request, response, env)) return true;
  if (await handleSparesRoutes(method, url, request, response, env)) return true;
  if (await handleInspectionsRoutes(method, url, request, response, env)) return true;
  if (await handleMaintenanceRoutes(method, url, request, response, env)) return true;
  if (await handleTriggersRoutes(method, url, request, response, env)) return true;
  if (await handleQualityRoutes(method, url, request, response, env)) return true;
  if (await handleCatalogsRoutes(method, url, request, response, env)) return true;

  return false;
}
