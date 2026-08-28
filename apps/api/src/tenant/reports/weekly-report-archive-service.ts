// Semanas anteriores del parte de flota: lectura de las copias congeladas que
// deja el job (`ScheduledReportRun.html`).
//
// Todas las consultas filtran por tenantId ademas de por id, para que un id de
// otra empresa no devuelva nada aunque alguien lo adivine.

import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";

/** Cuantas semanas se listan. 26 = medio año, suficiente para comparar. */
const MAX_HISTORY = 52;

export interface WeeklyReportHistoryItem {
  id: string;
  reportKind: "WEEKLY_OPENING" | "WEEKLY_CLOSING";
  periodKey: string;
  status: string;
  recipients: string[];
  sentAt: string;
  /** false cuando la fila quedo de una version anterior, sin copia guardada. */
  hasSnapshot: boolean;
}

async function resolveTenantId(session: TenantAccessSession): Promise<string | null> {
  const prisma = getPrismaClient();
  if (!prisma) return null;
  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug }, select: { id: true } });
  return tenant?.id ?? null;
}

export async function listWeeklyReportHistory(
  session: TenantAccessSession,
): Promise<WeeklyReportHistoryItem[]> {
  const prisma = getPrismaClient();
  if (!prisma) return [];
  const tenantId = await resolveTenantId(session);
  if (!tenantId) return [];

  const rows = await prisma.scheduledReportRun.findMany({
    where: { tenantId },
    orderBy: { sentAt: "desc" },
    take: MAX_HISTORY,
    // El HTML no se trae en el listado: son ~12 KB por fila y no se muestran.
    select: {
      id: true, reportKind: true, periodKey: true, status: true,
      recipients: true, sentAt: true, html: true,
    },
  });

  return rows.map(r => ({
    id: r.id,
    reportKind: r.reportKind as WeeklyReportHistoryItem["reportKind"],
    periodKey: r.periodKey,
    status: r.status as string,
    recipients: r.recipients,
    sentAt: r.sentAt.toISOString(),
    hasSnapshot: !!r.html,
  }));
}

export async function getArchivedWeeklyReport(
  session: TenantAccessSession,
  id: string,
): Promise<string> {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const tenantId = await resolveTenantId(session);
  if (!tenantId) throw new RouteError(404, "TENANT_NOT_FOUND", "Empresa no encontrada.");

  const row = await prisma.scheduledReportRun.findFirst({
    where: { id, tenantId },
    select: { html: true },
  });
  if (!row) throw new RouteError(404, "REPORT_NOT_FOUND", "No se encontró ese parte.");
  if (!row.html) {
    throw new RouteError(404, "NO_SNAPSHOT", "Ese parte se registró antes de que se guardaran las copias, así que no hay nada para mostrar.");
  }
  return row.html;
}
