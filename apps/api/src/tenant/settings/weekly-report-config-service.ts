// Destinatarios del parte semanal de flota (ver tenant/reports/).
// Mismo patron que `nav-config-service.ts`: la config vive en TenantSetting, se
// sanea SIEMPRE en el servidor y la lectura es fail-open para no romper pantalla.

import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";

/** Tope de destinatarios: es un parte de gestion, no una lista de difusion. */
const MAX_RECIPIENTS = 20;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export interface WeeklyReportConfig {
  enabled: boolean;
  recipients: string[];
}

function sanitizeRecipients(input: unknown): string[] {
  if (!Array.isArray(input)) {
    throw new RouteError(400, "INVALID_BODY", "Se esperaba { recipients: string[] }.");
  }
  const cleaned = input
    .filter((v): v is string => typeof v === "string")
    .map(v => v.trim().toLowerCase())
    .filter(v => v.length > 0 && v.length <= 200);

  const invalid = cleaned.find(v => !EMAIL_RE.test(v));
  if (invalid) {
    throw new RouteError(400, "INVALID_EMAIL", `"${invalid}" no es una dirección de correo válida.`);
  }
  return Array.from(new Set(cleaned)).slice(0, MAX_RECIPIENTS);
}

/**
 * Config del parte semanal. Fail-open: si la base no responde o la empresa no
 * tiene settings todavia, devuelve apagado — nunca rompe la pantalla de
 * Configuracion, y apagado es el default seguro (no manda correos solo).
 */
export async function getWeeklyReportConfig(session: TenantAccessSession): Promise<WeeklyReportConfig> {
  const prisma = getPrismaClient();
  if (!prisma) return { enabled: false, recipients: [] };
  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) return { enabled: false, recipients: [] };
  const settings = await prisma.tenantSetting.findUnique({
    where: { tenantId: tenant.id },
    select: { weeklyReportEnabled: true, weeklyReportRecipients: true },
  });
  return {
    enabled: settings?.weeklyReportEnabled ?? false,
    recipients: settings?.weeklyReportRecipients ?? [],
  };
}

export async function setWeeklyReportConfig(
  session: TenantAccessSession,
  body: { enabled?: unknown; recipients?: unknown },
): Promise<WeeklyReportConfig> {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Empresa no encontrada.");

  const recipients = sanitizeRecipients(body?.recipients ?? []);
  const enabled = body?.enabled === true;

  // Sin destinatarios NO es un error: el interruptor genera y archiva el parte
  // de cada semana (que es lo que alimenta "semanas anteriores"); mandarlo por
  // correo es un paso aparte que ademas necesita el servidor SMTP cargado.
  const updated = await prisma.tenantSetting.update({
    where: { tenantId: tenant.id },
    data: { weeklyReportEnabled: enabled, weeklyReportRecipients: recipients },
    select: { weeklyReportEnabled: true, weeklyReportRecipients: true },
  });
  return { enabled: updated.weeklyReportEnabled, recipients: updated.weeklyReportRecipients };
}
