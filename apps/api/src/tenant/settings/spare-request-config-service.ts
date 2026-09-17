// Casilla de Compras para las Solicitudes de repuestos (Configuración → sección).
// Mismo patrón que weekly-report-config-service: vive en TenantSetting, se sanea
// en el servidor y la lectura es fail-open (vacío = no se envía nada).

import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export interface SpareRequestConfig {
  mailbox: string | null;
}

async function tenantIdOf(session: TenantAccessSession): Promise<string | null> {
  const prisma = getPrismaClient();
  if (!prisma) return null;
  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug }, select: { id: true } });
  return tenant?.id ?? null;
}

/** Casilla de Compras de la empresa, o null si no está cargada. */
export async function readSpareRequestMailbox(tenantId: string): Promise<string | null> {
  const prisma = getPrismaClient();
  if (!prisma) return null;
  const settings = await prisma.tenantSetting.findUnique({
    where: { tenantId },
    select: { spareRequestMailbox: true },
  });
  return settings?.spareRequestMailbox?.trim() || null;
}

export async function getSpareRequestConfig(session: TenantAccessSession): Promise<SpareRequestConfig> {
  const tenantId = await tenantIdOf(session);
  return { mailbox: tenantId ? await readSpareRequestMailbox(tenantId) : null };
}

export async function setSpareRequestConfig(
  session: TenantAccessSession,
  body: { mailbox?: unknown },
): Promise<SpareRequestConfig> {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const tenantId = await tenantIdOf(session);
  if (!tenantId) throw new RouteError(404, "TENANT_NOT_FOUND", "Empresa no encontrada.");

  const raw = typeof body?.mailbox === "string" ? body.mailbox.trim().toLowerCase() : "";
  if (raw && (raw.length > 200 || !EMAIL_RE.test(raw))) {
    throw new RouteError(400, "INVALID_EMAIL", `"${raw}" no es una dirección de correo válida.`);
  }

  const updated = await prisma.tenantSetting.update({
    where: { tenantId },
    data: { spareRequestMailbox: raw || null },
    select: { spareRequestMailbox: true },
  });
  return { mailbox: updated.spareRequestMailbox };
}
