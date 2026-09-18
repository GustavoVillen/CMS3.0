// A quién se le manda la Solicitud de Servicio (Configuración → sección).
//
// Hasta ahora el correo iba SIEMPRE a la casilla interna de Mercurio y desde
// ahí una persona lo reenviaba al taller. Desde sep 2026 la empresa elige:
// apagado, sigue igual; encendido, el PDF va directo al correo del proveedor de
// esa SS. En los dos casos se manda copia a las direcciones que se carguen acá
// (más la casilla del sistema, que copia todo — ver common/mailer.ts).
//
// Mismo patrón que weekly-report-config-service y spare-request-config-service:
// vive en TenantSetting y se sanea en el servidor.

import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_RECIPIENTS = 20;

export interface ServiceRequestMailConfig {
  /** true = el PDF va al correo del proveedor de la SS. */
  toProvider: boolean;
  /** Copia, en los dos casos. */
  ccRecipients: string[];
}

async function tenantIdOf(session: TenantAccessSession): Promise<string | null> {
  const prisma = getPrismaClient();
  if (!prisma) return null;
  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug }, select: { id: true } });
  return tenant?.id ?? null;
}

/** Lo usa el envío de la SS. Sin fila o sin base: se comporta como antes (casilla interna). */
export async function readServiceRequestMailConfig(tenantId: string): Promise<ServiceRequestMailConfig> {
  const prisma = getPrismaClient();
  if (!prisma) return { toProvider: false, ccRecipients: [] };
  const settings = await prisma.tenantSetting.findUnique({
    where: { tenantId },
    select: { serviceRequestToProvider: true, serviceRequestCcRecipients: true },
  });
  return {
    toProvider: settings?.serviceRequestToProvider ?? false,
    ccRecipients: (settings?.serviceRequestCcRecipients ?? []).filter(Boolean),
  };
}

export async function getServiceRequestMailConfig(session: TenantAccessSession): Promise<ServiceRequestMailConfig> {
  const tenantId = await tenantIdOf(session);
  return tenantId ? readServiceRequestMailConfig(tenantId) : { toProvider: false, ccRecipients: [] };
}

export async function setServiceRequestMailConfig(
  session: TenantAccessSession,
  body: { toProvider?: unknown; ccRecipients?: unknown },
): Promise<ServiceRequestMailConfig> {
  if (session.user.role !== "TENANT_ADMIN") {
    throw new RouteError(403, "FORBIDDEN", "Solo administradores pueden configurar el envío de las Solicitudes de Servicio.");
  }
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const tenantId = await tenantIdOf(session);
  if (!tenantId) throw new RouteError(404, "TENANT_NOT_FOUND", "Empresa no encontrada.");

  const raw = Array.isArray(body?.ccRecipients) ? body.ccRecipients : [];
  const seen = new Set<string>();
  const ccRecipients: string[] = [];
  for (const value of raw) {
    const email = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (!email) continue;
    if (email.length > 200 || !EMAIL_RE.test(email)) {
      throw new RouteError(400, "INVALID_EMAIL", `"${email}" no es una dirección de correo válida.`);
    }
    if (seen.has(email)) continue;
    seen.add(email);
    ccRecipients.push(email);
  }
  if (ccRecipients.length > MAX_RECIPIENTS) {
    throw new RouteError(400, "TOO_MANY_RECIPIENTS", `Como máximo ${MAX_RECIPIENTS} direcciones en copia.`);
  }

  const updated = await prisma.tenantSetting.update({
    where: { tenantId },
    data: { serviceRequestToProvider: body?.toProvider === true, serviceRequestCcRecipients: ccRecipients },
    select: { serviceRequestToProvider: true, serviceRequestCcRecipients: true },
  });
  return { toProvider: updated.serviceRequestToProvider, ccRecipients: updated.serviceRequestCcRecipients };
}
