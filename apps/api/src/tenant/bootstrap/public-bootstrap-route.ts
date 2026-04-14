import type { IncomingMessage } from "node:http";
import type { TenantBootstrapPayload } from "@pms-saas/shared-types";
import { buildTenantBootstrapPayload } from "./public-bootstrap";
import { getTenantBootstrapSourceBySlug } from "./tenant-bootstrap-store";
import { getRequestUrl } from "../../http/request-url";
import { resolveTenantRequest } from "../../platform/tenancy/tenant-resolution";
import type { AppEnv } from "../../config/env";

export interface PublicBootstrapRouteResult {
  statusCode: number;
  payload:
    | TenantBootstrapPayload
    | {
        error: {
          code: string;
          message: string;
        };
      };
}

export function resolveTenantSlugFromRequest(
  request: IncomingMessage,
  env: AppEnv,
): string | null {
  const requestUrl = getRequestUrl(request);
  const resolution = resolveTenantRequest(
    {
      host: request.headers.host,
      path: requestUrl.pathname,
      tenantHeader: request.headers["x-tenant-slug"] as string | undefined,
      tenantQuery: requestUrl.searchParams.get("tenant"),
    },
    {
      rootDomain: env.rootDomain,
      adminSubdomain: env.adminSubdomain,
      allowTenantHeaderFallback: env.allowTenantHeaderFallback,
    },
  );

  if (resolution.kind !== "tenant") return null;
  return resolution.tenantSlug;
}

export async function handlePublicBootstrapRequest(
  request: IncomingMessage,
  env: AppEnv,
): Promise<PublicBootstrapRouteResult> {
  const requestUrl = getRequestUrl(request);
  const resolution = resolveTenantRequest(
    {
      host: request.headers.host,
      path: requestUrl.pathname,
      tenantHeader: request.headers["x-tenant-slug"] as string | undefined,
      tenantQuery: requestUrl.searchParams.get("tenant"),
    },
    {
      rootDomain: env.rootDomain,
      adminSubdomain: env.adminSubdomain,
      allowTenantHeaderFallback: env.allowTenantHeaderFallback,
    },
  );

  if (resolution.kind === "platform") {
    return {
      statusCode: 400,
      payload: {
        error: {
          code: "BOOTSTRAP_PLATFORM_HOST_UNSUPPORTED",
          message: "The public bootstrap endpoint is tenant-scoped and is not available on the admin host.",
        },
      },
    };
  }

  if (resolution.kind !== "tenant" || !resolution.tenantSlug) {
    return {
      statusCode: 400,
      payload: {
        error: {
          code: "BOOTSTRAP_TENANT_UNRESOLVED",
          message: "Unable to resolve tenant from request host or path.",
        },
      },
    };
  }

  const tenantSource = await getTenantBootstrapSourceBySlug(resolution.tenantSlug);
  if (!tenantSource) {
    return {
      statusCode: 404,
      payload: {
        error: {
          code: "BOOTSTRAP_TENANT_NOT_FOUND",
          message: `Tenant '${resolution.tenantSlug}' is not configured for bootstrap.`,
        },
      },
    };
  }

  return {
    statusCode: 200,
    payload: buildTenantBootstrapPayload(tenantSource, {
      requestedLocale: requestUrl.searchParams.get("locale"),
      preferredLocale:
        (request.headers["x-user-locale"] as string | undefined) ||
        request.headers["accept-language"]?.split(",")[0] ||
        null,
    }),
  };
}
