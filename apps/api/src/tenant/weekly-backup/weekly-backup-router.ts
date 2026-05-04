import type { IncomingMessage, ServerResponse } from "node:http";
import type { AppEnv } from "../../config/env";
import { sendJson } from "../../http/json-response";
import { readJsonBody } from "../../http/read-json-body";
import { requireTenantAccessSession } from "../auth/tenant-route-auth";
import { resolveTenantSlugFromRequest } from "../bootstrap/public-bootstrap-route";
import {
  getWeeklyBackupConfig,
  updateWeeklyBackupConfig,
  triggerWeeklyBackupNow,
  listWeeklyBackupRuns,
  type UpdateWeeklyBackupPayload,
} from "./weekly-backup-service";

export async function handleWeeklyBackupRoutes(
  method: string,
  url: URL,
  request: IncomingMessage,
  response: ServerResponse,
  env: AppEnv,
): Promise<boolean> {
  const slug = resolveTenantSlugFromRequest(request, env);
  if (!slug) return false;
  const session = requireTenantAccessSession(request, slug);

  if (method === "GET" && url.pathname === "/app/settings/weekly-backup") {
    sendJson(response, 200, await getWeeklyBackupConfig(session));
    return true;
  }

  if (method === "PUT" && url.pathname === "/app/settings/weekly-backup") {
    const body = await readJsonBody<UpdateWeeklyBackupPayload>(request);
    sendJson(response, 200, await updateWeeklyBackupConfig(session, body));
    return true;
  }

  if (method === "POST" && url.pathname === "/app/settings/weekly-backup/run-now") {
    const result = await triggerWeeklyBackupNow(session);
    sendJson(response, 200, result);
    return true;
  }

  if (method === "GET" && url.pathname === "/app/settings/weekly-backup/runs") {
    const limit = Number(url.searchParams.get("limit") || "20");
    sendJson(response, 200, { items: await listWeeklyBackupRuns(session, limit) });
    return true;
  }

  return false;
}
