import type { IncomingMessage, ServerResponse } from "node:http";
import type { AppEnv } from "../../config/env";
import { sendJson } from "../../http/json-response";
import { readJsonBody } from "../../http/read-json-body";
import { RouteError } from "../../http/route-error";
import { resolveTenantSlugFromRequest } from "../bootstrap/public-bootstrap-route";
import { requireTenantAccessSession } from "../auth/tenant-route-auth";
import {
  closeDefect,
  createDefect,
  getDefect,
  listDefects,
  softDeleteDefect,
  updateDefect,
} from "./defects-service";
import { buildDefectPdf } from "./defect-pdf-service";
import { buildDeferralPdf } from "./deferral-pdf-service";
import {
  activateDeferral,
  approveDeferral,
  cancelDeferral,
  closeDeferral,
  createDeferral,
  getDeferral,
  listDeferrals,
  rejectDeferral,
  reviewDeferral,
  updateDeferral,
} from "./deferrals-service";
import {
  cancelCapaRecord,
  closeCapaRecord,
  completeCapaRecord,
  createCapaRecord,
  getCapaRecord,
  listCapaRecords,
  updateCapaRecord,
} from "./capa-service";

function requireTenantSlug(request: IncomingMessage, env: AppEnv): string {
  const slug = resolveTenantSlugFromRequest(request, env);
  if (!slug) throw new RouteError(400, "TENANT_UNRESOLVED", "Unable to resolve tenant.");
  return slug;
}

function enforceAuditorMutations(method: string, role: string) {
  if (role === "AUDITOR_READONLY" && method !== "GET") {
    throw new RouteError(403, "FORBIDDEN", "AUDITOR_READONLY solo puede listar.");
  }
}

export async function handleQualityRoutes(
  method: string,
  url: URL,
  request: IncomingMessage,
  response: ServerResponse,
  env: AppEnv,
): Promise<boolean> {
  const isDefectsPath = url.pathname.startsWith("/app/pms/defects");
  const isDeferralsPath = url.pathname.startsWith("/app/pms/deferrals");
  const isCapaPath = url.pathname.startsWith("/app/pms/capa");
  if (!isDefectsPath && !isDeferralsPath && !isCapaPath) return false;

  const tenantSlug = requireTenantSlug(request, env);
  const session = requireTenantAccessSession(request, tenantSlug);
  enforceAuditorMutations(method, session.user.role);

  if (method === "GET" && url.pathname === "/app/pms/defects") {
    const items = await listDefects(session, {
      vesselCode: url.searchParams.get("vesselCode"),
      status: url.searchParams.get("status"),
      severity: url.searchParams.get("severity"),
      operationalState: url.searchParams.get("operationalState"),
      assetId: url.searchParams.get("assetId"),
    });
    sendJson(response, 200, { items, total: items.length });
    return true;
  }
  if (method === "POST" && url.pathname === "/app/pms/defects") {
    const body = await readJsonBody(request) as Parameters<typeof createDefect>[1];
    sendJson(response, 201, await createDefect(session, body));
    return true;
  }
  if (method === "GET" && /^\/app\/pms\/defects\/[^/]+\/pdf$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    const defect = await getDefect(session, id);
    const filename = `${defect.defectCode}-${defect.vesselCode}.pdf`;
    const buffer = await buildDefectPdf(session, id);
    response.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": buffer.length,
    });
    response.end(buffer);
    return true;
  }
  if (method === "POST" && /^\/app\/pms\/defects\/[^/]+\/close$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    const body = await readJsonBody(request) as Parameters<typeof closeDefect>[2];
    sendJson(response, 200, await closeDefect(session, id, body));
    return true;
  }
  if (/^\/app\/pms\/defects\/[^/]+$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    if (method === "GET") {
      sendJson(response, 200, await getDefect(session, id));
      return true;
    }
    if (method === "PATCH") {
      const body = await readJsonBody(request) as Parameters<typeof updateDefect>[2];
      sendJson(response, 200, await updateDefect(session, id, body));
      return true;
    }
    if (method === "DELETE") {
      await softDeleteDefect(session, id);
      sendJson(response, 200, { ok: true });
      return true;
    }
  }

  if (method === "GET" && /^\/app\/pms\/deferrals\/[^/]+\/pdf$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    const deferral = await getDeferral(session, id);
    const filename = `${deferral.deferralCode}.pdf`;
    const buffer = await buildDeferralPdf(session, id);
    response.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": buffer.length,
    });
    response.end(buffer);
    return true;
  }

  if (method === "GET" && url.pathname === "/app/pms/deferrals") {
    const items = await listDeferrals(session, {
      vesselCode: url.searchParams.get("vesselCode"),
      status: url.searchParams.get("status"),
      sourceType: url.searchParams.get("sourceType"),
      sourceId: url.searchParams.get("sourceId"),
    });
    sendJson(response, 200, { items, total: items.length });
    return true;
  }
  if (method === "POST" && url.pathname === "/app/pms/deferrals") {
    const body = await readJsonBody(request) as Parameters<typeof createDeferral>[1];
    sendJson(response, 201, await createDeferral(session, body));
    return true;
  }
  if (method === "POST" && /^\/app\/pms\/deferrals\/[^/]+\/review$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    const body = await readJsonBody(request) as Parameters<typeof reviewDeferral>[2];
    sendJson(response, 200, await reviewDeferral(session, id, body));
    return true;
  }
  if (method === "POST" && /^\/app\/pms\/deferrals\/[^/]+\/approve$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    const body = await readJsonBody(request) as Parameters<typeof approveDeferral>[2];
    sendJson(response, 200, await approveDeferral(session, id, body));
    return true;
  }
  if (method === "POST" && /^\/app\/pms\/deferrals\/[^/]+\/reject$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    const body = await readJsonBody(request) as Parameters<typeof rejectDeferral>[2];
    sendJson(response, 200, await rejectDeferral(session, id, body));
    return true;
  }
  if (method === "POST" && /^\/app\/pms\/deferrals\/[^/]+\/activate$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    sendJson(response, 200, await activateDeferral(session, id));
    return true;
  }
  if (method === "PATCH" && /^\/app\/pms\/deferrals\/[^/]+$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    const body = await readJsonBody(request) as Parameters<typeof updateDeferral>[2];
    sendJson(response, 200, await updateDeferral(session, id, body));
    return true;
  }
  if (method === "DELETE" && /^\/app\/pms\/deferrals\/[^/]+$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    await cancelDeferral(session, id);
    sendJson(response, 200, { ok: true });
    return true;
  }
  if (method === "POST" && /^\/app\/pms\/deferrals\/[^/]+\/close$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    const body = await readJsonBody(request) as Parameters<typeof closeDeferral>[2];
    sendJson(response, 200, await closeDeferral(session, id, body));
    return true;
  }
  if (method === "GET" && /^\/app\/pms\/deferrals\/[^/]+$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    sendJson(response, 200, await getDeferral(session, id));
    return true;
  }

  if (method === "GET" && url.pathname === "/app/pms/capa") {
    const items = await listCapaRecords(session, {
      vesselCode: url.searchParams.get("vesselCode"),
      status: url.searchParams.get("status"),
      priority: url.searchParams.get("priority"),
      sourceType: url.searchParams.get("sourceType"),
      sourceId: url.searchParams.get("sourceId"),
    });
    sendJson(response, 200, { items, total: items.length });
    return true;
  }
  if (method === "POST" && url.pathname === "/app/pms/capa") {
    const body = await readJsonBody(request) as Parameters<typeof createCapaRecord>[1];
    sendJson(response, 201, await createCapaRecord(session, body));
    return true;
  }
  if (method === "POST" && /^\/app\/pms\/capa\/[^/]+\/complete$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    const body = await readJsonBody(request) as Parameters<typeof completeCapaRecord>[2];
    sendJson(response, 200, await completeCapaRecord(session, id, body));
    return true;
  }
  if (method === "POST" && /^\/app\/pms\/capa\/[^/]+\/close$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    const body = await readJsonBody(request) as Parameters<typeof closeCapaRecord>[2];
    sendJson(response, 200, await closeCapaRecord(session, id, body));
    return true;
  }
  if (method === "POST" && /^\/app\/pms\/capa\/[^/]+\/cancel$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    const body = await readJsonBody(request) as Parameters<typeof cancelCapaRecord>[2];
    sendJson(response, 200, await cancelCapaRecord(session, id, body));
    return true;
  }
  if (/^\/app\/pms\/capa\/[^/]+$/.test(url.pathname)) {
    const id = url.pathname.split("/")[4]!;
    if (method === "GET") {
      sendJson(response, 200, await getCapaRecord(session, id));
      return true;
    }
    if (method === "PATCH") {
      const body = await readJsonBody(request) as Parameters<typeof updateCapaRecord>[2];
      sendJson(response, 200, await updateCapaRecord(session, id, body));
      return true;
    }
  }

  return false;
}
