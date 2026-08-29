// Rutas de la Especificación de Varada (/app/pms/drydock-specs).
// Router de despacho puro: parsea, delega en el service y responde.
// Los permisos y el scope por buque los valida el service.

import type { IncomingMessage, ServerResponse } from "node:http";
import type { AppEnv } from "../../config/env";
import { sendJson } from "../../http/json-response";
import { readJsonBody } from "../../http/read-json-body";
import { RouteError } from "../../http/route-error";
import { resolveTenantSlugFromRequest } from "../bootstrap/public-bootstrap-route";
import { requireTenantAccessSession } from "../auth/tenant-route-auth";
import {
  createDrydockSpec,
  deleteDrydockSpec,
  getDrydockSpecFull,
  listDrydockSpecs,
  transitionDrydockSpec,
  updateDrydockSpec,
} from "./drydock-specs-service";
import {
  addItemComment,
  importItemsFromSources,
  listImportCandidates,
  setItemDecision,
  upsertDrydockSpecItems,
} from "./drydock-spec-items-service";
import { buildDrydockSpecPdf } from "./drydock-spec-pdf-service";

const BASE = "/app/pms/drydock-specs";

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

/** /app/pms/drydock-specs/<specId>/<sub> → segmentos después de la base. */
function tail(pathname: string): string[] {
  return pathname.slice(BASE.length).split("/").filter(Boolean);
}

export async function handleDrydockRoutes(
  method: string,
  url: URL,
  request: IncomingMessage,
  response: ServerResponse,
  env: AppEnv,
): Promise<boolean> {
  if (!url.pathname.startsWith(BASE)) return false;

  const tenantSlug = requireTenantSlug(request, env);
  const session = requireTenantAccessSession(request, tenantSlug);
  enforceAuditorMutations(method, session.user.role);

  const segments = tail(url.pathname);

  // ── Colección ──────────────────────────────────────────────────────────────
  if (segments.length === 0) {
    if (method === "GET") {
      const items = await listDrydockSpecs(session, {
        vesselCode: url.searchParams.get("vesselCode"),
        status: url.searchParams.get("status"),
      });
      sendJson(response, 200, { items, total: items.length });
      return true;
    }
    if (method === "POST") {
      const body = await readJsonBody(request) as Parameters<typeof createDrydockSpec>[1];
      sendJson(response, 201, await createDrydockSpec(session, body));
      return true;
    }
  }

  // ── Acciones sobre un ítem: /items/:itemId/... ────────────────────────────
  // Van antes que las rutas de :id para que "items" no se lea como un specId.
  if (segments[0] === "items" && segments.length === 3 && segments[1]) {
    const itemId = segments[1];
    if (method === "PATCH" && segments[2] === "decision") {
      const body = await readJsonBody(request) as Parameters<typeof setItemDecision>[2];
      sendJson(response, 200, await setItemDecision(session, itemId, body));
      return true;
    }
    if (method === "POST" && segments[2] === "comments") {
      const body = await readJsonBody(request) as { body?: unknown };
      sendJson(response, 201, await addItemComment(session, itemId, body?.body));
      return true;
    }
  }

  // ── Documento por id ──────────────────────────────────────────────────────
  const specId = segments[0];
  if (!specId) return false;

  if (segments.length === 1) {
    if (method === "GET") {
      sendJson(response, 200, await getDrydockSpecFull(session, specId));
      return true;
    }
    if (method === "PATCH") {
      const body = await readJsonBody(request) as Parameters<typeof updateDrydockSpec>[2];
      sendJson(response, 200, await updateDrydockSpec(session, specId, body));
      return true;
    }
    if (method === "DELETE") {
      await deleteDrydockSpec(session, specId);
      sendJson(response, 200, { ok: true });
      return true;
    }
  }

  if (segments.length === 2) {
    const sub = segments[1];

    if (method === "GET" && sub === "full") {
      sendJson(response, 200, await getDrydockSpecFull(session, specId));
      return true;
    }
    if (method === "GET" && sub === "candidates") {
      sendJson(response, 200, await listImportCandidates(session, specId));
      return true;
    }
    if (method === "GET" && sub === "pdf") {
      const spec = await getDrydockSpecFull(session, specId);
      const buffer = await buildDrydockSpecPdf(session, specId);
      const filename = `${spec.specCode}.pdf`;
      response.writeHead(200, {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": buffer.length,
      });
      response.end(buffer);
      return true;
    }
    if (method === "PUT" && sub === "items") {
      const body = await readJsonBody(request) as { entries?: Parameters<typeof upsertDrydockSpecItems>[2] };
      sendJson(response, 200, { items: await upsertDrydockSpecItems(session, specId, body?.entries ?? []) });
      return true;
    }
    if (method === "POST" && sub === "transition") {
      const body = await readJsonBody(request) as Parameters<typeof transitionDrydockSpec>[2];
      sendJson(response, 200, await transitionDrydockSpec(session, specId, body));
      return true;
    }
  }

  if (method === "POST" && segments.length === 3 && segments[1] === "items" && segments[2] === "import") {
    const body = await readJsonBody(request) as { sources?: Parameters<typeof importItemsFromSources>[2] };
    sendJson(response, 200, { items: await importItemsFromSources(session, specId, body?.sources ?? []) });
    return true;
  }

  return false;
}
