import { getPrismaClient } from "../../platform/data/prisma-client";
import type { TenantAccessSession } from "../auth/session-store";
import { RouteError } from "../../http/route-error";
import { runWeeklyBackupForTenant, type WeeklyBackupResult } from "../../platform/backups/weekly-backup-runner";
import { isMailConfigured } from "../../platform/mail/mail-service";
import { publishAudit } from "../../platform/audit/audit-publisher";
import { listBackupDatasetLabels } from "../../platform/backups/backup-data-export";

// TenantAdmin-facing API for the weekly Excel backup feature.
//
// All write operations require TENANT_ADMIN. Read operations require an
// authenticated tenant session (any role) — but only TENANT_ADMIN sees the
// page in the UI; this is defense-in-depth at the API layer.

export interface WeeklyBackupConfig {
  enabled: boolean;
  email: string | null;
  dayOfWeek: number;
  hourLocal: number;
  mailProviderConfigured: boolean;
  datasetLabels: string[];
}

export interface WeeklyBackupRunSummary {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: "SUCCESS" | "FAILED";
  recipientEmail: string | null;
  fileSizeBytes: number | null;
  errorMessage: string | null;
}

function assertTenantAdmin(session: TenantAccessSession): void {
  if (session.user.role !== "TENANT_ADMIN") {
    throw new RouteError(403, "FORBIDDEN", "Solo administradores pueden modificar el backup semanal.");
  }
}

async function loadTenantId(session: TenantAccessSession): Promise<string> {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_NOT_CONFIGURED", "Base de datos no disponible.");
  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug }, select: { id: true } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");
  return tenant.id;
}

export async function getWeeklyBackupConfig(session: TenantAccessSession): Promise<WeeklyBackupConfig> {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_NOT_CONFIGURED", "Base de datos no disponible.");
  const tenant = await prisma.tenant.findUnique({
    where: { slug: session.tenantSlug },
    include: { settings: true },
  });
  if (!tenant || !tenant.settings) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");

  return {
    enabled: tenant.settings.weeklyBackupEnabled,
    email: tenant.settings.weeklyBackupEmail,
    dayOfWeek: tenant.settings.weeklyBackupDayOfWeek,
    hourLocal: tenant.settings.weeklyBackupHourLocal,
    mailProviderConfigured: isMailConfigured(),
    datasetLabels: listBackupDatasetLabels(),
  };
}

export interface UpdateWeeklyBackupPayload {
  enabled?: boolean;
  email?: string | null;
  dayOfWeek?: number;
  hourLocal?: number;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function updateWeeklyBackupConfig(
  session: TenantAccessSession,
  payload: UpdateWeeklyBackupPayload,
): Promise<WeeklyBackupConfig> {
  assertTenantAdmin(session);

  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_NOT_CONFIGURED", "Base de datos no disponible.");

  const data: Record<string, unknown> = {};

  if (payload.enabled !== undefined) {
    data.weeklyBackupEnabled = !!payload.enabled;
  }

  if (payload.email !== undefined) {
    const email = payload.email === null ? null : String(payload.email || "").trim();
    if (email && !EMAIL_RE.test(email)) {
      throw new RouteError(400, "INVALID_EMAIL", "El email no tiene un formato válido.");
    }
    data.weeklyBackupEmail = email || null;
  }

  if (payload.dayOfWeek !== undefined) {
    const d = Number(payload.dayOfWeek);
    if (!Number.isInteger(d) || d < 0 || d > 6) {
      throw new RouteError(400, "INVALID_DAY", "El día de la semana debe ser un entero entre 0 (domingo) y 6 (sábado).");
    }
    data.weeklyBackupDayOfWeek = d;
  }

  if (payload.hourLocal !== undefined) {
    const h = Number(payload.hourLocal);
    if (!Number.isInteger(h) || h < 0 || h > 23) {
      throw new RouteError(400, "INVALID_HOUR", "La hora debe ser un entero entre 0 y 23.");
    }
    data.weeklyBackupHourLocal = h;
  }

  // If after merging the user wants enabled=true, require email present.
  // Read current to validate the final state.
  const tenant = await prisma.tenant.findUnique({
    where: { slug: session.tenantSlug },
    include: { settings: true },
  });
  if (!tenant || !tenant.settings) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");

  const finalEnabled =
    data.weeklyBackupEnabled !== undefined ? (data.weeklyBackupEnabled as boolean) : tenant.settings.weeklyBackupEnabled;
  const finalEmail =
    data.weeklyBackupEmail !== undefined ? (data.weeklyBackupEmail as string | null) : tenant.settings.weeklyBackupEmail;

  if (finalEnabled && !finalEmail) {
    throw new RouteError(400, "EMAIL_REQUIRED", "Para activar el backup hay que configurar un email destino.");
  }

  await prisma.tenantSetting.update({
    where: { tenantId: tenant.id },
    data,
  });

  await publishAudit(prisma, {
    tenantId: tenant.id,
    actorUserId: session.user.id,
    action: "WEEKLY_BACKUP_CONFIG_UPDATED",
    entityType: "TenantSetting",
    entityId: tenant.id,
    metadata: {
      enabled: finalEnabled,
      email: finalEmail,
      dayOfWeek: data.weeklyBackupDayOfWeek ?? tenant.settings.weeklyBackupDayOfWeek,
      hourLocal: data.weeklyBackupHourLocal ?? tenant.settings.weeklyBackupHourLocal,
    },
  });

  return getWeeklyBackupConfig(session);
}

export async function triggerWeeklyBackupNow(session: TenantAccessSession): Promise<WeeklyBackupResult> {
  assertTenantAdmin(session);
  const tenantId = await loadTenantId(session);

  const prisma = getPrismaClient();
  if (prisma) {
    await publishAudit(prisma, {
      tenantId,
      actorUserId: session.user.id,
      action: "WEEKLY_BACKUP_TRIGGERED_MANUAL",
      entityType: "Tenant",
      entityId: tenantId,
      metadata: {},
    });
  }

  return runWeeklyBackupForTenant(tenantId);
}

export async function listWeeklyBackupRuns(
  session: TenantAccessSession,
  limit: number,
): Promise<WeeklyBackupRunSummary[]> {
  const prisma = getPrismaClient();
  if (!prisma) return [];
  const tenantId = await loadTenantId(session);
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);

  const runs = await prisma.backupRun.findMany({
    where: { tenantId },
    orderBy: { startedAt: "desc" },
    take: safeLimit,
  });

  return runs.map((r) => ({
    id: r.id,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
    status: r.status,
    recipientEmail: r.recipientEmail,
    fileSizeBytes: r.fileSizeBytes,
    errorMessage: r.errorMessage,
  }));
}
