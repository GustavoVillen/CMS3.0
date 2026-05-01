import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";

export type MonthlyReportType = "INVENTORY" | "CONSUMPTION";

export interface RecordMonthlyReportInput {
  type: MonthlyReportType;
  vesselCode: string;
  fileName: string;
  /** INVENTORY: snapshot date (YYYY-MM-DD). CONSUMPTION: undefined. */
  asOfDate?: string | null;
  /** CONSUMPTION only. */
  year?: number | null;
  month?: number | null;
  /** INVENTORY only. */
  department?: string | null;
}

export interface MonthlyReportHistoryItem {
  id: string;
  createdAt: string;
  type: MonthlyReportType;
  vesselCode: string;
  fileName: string;
  asOfDate: string | null;
  year: number | null;
  month: number | null;
  department: string | null;
  actorUserId: string | null;
  actorName: string | null;
}

const ENTITY_TYPE = "MonthlyReport";
const ACTION = "MONTHLY_REPORT_GENERATED";

async function resolveTenantId(session: TenantAccessSession): Promise<string | null> {
  const prisma = getPrismaClient();
  if (!prisma) return null;
  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  return tenant?.id ?? null;
}

/** Append a record to AuditEvent — best-effort, never throws. */
export async function recordMonthlyReportGenerated(
  session: TenantAccessSession,
  input: RecordMonthlyReportInput,
): Promise<void> {
  try {
    const prisma = getPrismaClient();
    if (!prisma) return;
    const tenantId = await resolveTenantId(session);
    if (!tenantId) return;

    await prisma.auditEvent.create({
      data: {
        tenantId,
        actorType:   "TENANT_USER",
        actorUserId: session.user.id,
        action:      ACTION,
        entityType:  ENTITY_TYPE,
        metadata: {
          type:       input.type,
          vesselCode: input.vesselCode,
          fileName:   input.fileName,
          asOfDate:   input.asOfDate ?? null,
          year:       input.year     ?? null,
          month:      input.month    ?? null,
          department: input.department ?? null,
        },
      },
    });
  } catch {
    // Audit failures must not block the PDF download.
  }
}

export async function listMonthlyReportHistory(
  session: TenantAccessSession,
  filters: { vesselCode?: string | null; type?: MonthlyReportType | null; limit?: number } = {},
): Promise<MonthlyReportHistoryItem[]> {
  const prisma = getPrismaClient();
  if (!prisma) return [];
  const tenantId = await resolveTenantId(session);
  if (!tenantId) return [];

  const where: Record<string, unknown> = {
    tenantId,
    actorType:  "TENANT_USER",
    entityType: ENTITY_TYPE,
    action:     ACTION,
  };

  const records = await prisma.auditEvent.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: Math.min(filters.limit ?? 100, 500),
    include: { actorUser: { select: { firstName: true, lastName: true } } },
  });

  // Vessel scope: non-admin users only see entries for their assigned vessels.
  const allowedVessels = session.user.assignedVesselCodes;
  const vesselScoped = session.user.role !== "TENANT_ADMIN" && allowedVessels.length > 0;

  const items: MonthlyReportHistoryItem[] = [];
  for (const r of records) {
    const meta = (r.metadata as Record<string, unknown> | null) ?? {};
    const vesselCode = String(meta.vesselCode ?? "");

    if (filters.vesselCode && vesselCode !== filters.vesselCode) continue;
    if (vesselScoped && !allowedVessels.includes(vesselCode)) continue;

    const type = (meta.type as MonthlyReportType) ?? "INVENTORY";
    if (filters.type && type !== filters.type) continue;

    const actor = (r as unknown as { actorUser?: { firstName?: string; lastName?: string } | null }).actorUser;
    const actorName = actor ? `${actor.firstName ?? ""} ${actor.lastName ?? ""}`.trim() || null : null;

    items.push({
      id:          r.id,
      createdAt:   r.createdAt.toISOString(),
      type,
      vesselCode,
      fileName:    String(meta.fileName ?? ""),
      asOfDate:    (meta.asOfDate   as string | null) ?? null,
      year:        (meta.year       as number | null) ?? null,
      month:       (meta.month      as number | null) ?? null,
      department:  (meta.department as string | null) ?? null,
      actorUserId: r.actorUserId ?? null,
      actorName,
    });
  }

  return items;
}
