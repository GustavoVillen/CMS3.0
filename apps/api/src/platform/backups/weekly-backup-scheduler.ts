import { getPrismaClient } from "../data/prisma-client";
import { runWeeklyBackupForTenant } from "./weekly-backup-runner";
import { isMailConfigured } from "../mail/mail-service";
import { log } from "../../common/logger";

// Hourly tick that checks every tenant with weekly backup enabled and fires
// the runner once when the local-time window opens. We don't use a real cron
// because the rest of the app uses the same setInterval pattern (insights,
// session sweep, lockout sweep) — see server.ts. Adding node-cron here just
// for one task would be inconsistency for inconsistency's sake.
//
// Idempotency: a tenant only runs if it has no BackupRun in the last 6 hours.
// That covers two cases:
//   - server restarts mid-day: we don't fire twice in the same scheduled hour
//   - failed run earlier today: we don't retry until next week's window
//
// Time zone: each tenant's settings.timezone defines the local hour. Default
// schedule is Monday 03:00 local time.

interface TenantLocalTime {
  dayOfWeek: number; // 0=Sun, 6=Sat
  hour: number;      // 0–23
}

function getLocalTimeInTz(now: Date, timezone: string): TenantLocalTime {
  // Intl.DateTimeFormat understands IANA tz IDs (America/Argentina/Buenos_Aires, etc.).
  // Invalid tz throws → caller treats as misconfigured tenant and skips.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "numeric",
    hour12: false,
  }).formatToParts(now);

  const weekday = parts.find((p) => p.type === "weekday")?.value || "Sun";
  const hourStr = parts.find((p) => p.type === "hour")?.value || "0";
  const hour = Number.parseInt(hourStr, 10);
  const dayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };

  return {
    dayOfWeek: dayMap[weekday] ?? 0,
    // Intl emits "24" for midnight in some locales; normalize.
    hour: hour === 24 ? 0 : hour,
  };
}

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

export async function runWeeklyBackupScheduler(): Promise<void> {
  const prisma = getPrismaClient();
  if (!prisma) return;
  if (!isMailConfigured()) return; // no point listing tenants if mail is off

  const now = new Date();
  const recentlyRanCutoff = new Date(now.getTime() - SIX_HOURS_MS);

  // Pull only tenants with backup enabled to keep the query small.
  const tenants = await prisma.tenant.findMany({
    where: {
      status: "ACTIVE",
      settings: { weeklyBackupEnabled: true },
    },
    include: { settings: true },
  });

  for (const tenant of tenants) {
    if (!tenant.settings) continue;
    const targetDay = tenant.settings.weeklyBackupDayOfWeek;
    const targetHour = tenant.settings.weeklyBackupHourLocal;
    const tz = tenant.settings.timezone || "UTC";

    let local: TenantLocalTime;
    try {
      local = getLocalTimeInTz(now, tz);
    } catch {
      log.warn("[weekly-backup-scheduler] invalid timezone for tenant", tenant.slug, tz);
      continue;
    }

    if (local.dayOfWeek !== targetDay || local.hour !== targetHour) continue;

    // Skip if any BackupRun fired in the last 6h — idempotency guard.
    const existingRun = await prisma.backupRun.findFirst({
      where: {
        tenantId: tenant.id,
        startedAt: { gte: recentlyRanCutoff },
      },
      select: { id: true },
    });
    if (existingRun) continue;

    try {
      const result = await runWeeklyBackupForTenant(tenant.id);
      log.info(
        "[weekly-backup-scheduler] ran tenant",
        tenant.slug,
        result.status,
        result.errorMessage ?? "",
      );
    } catch (error) {
      // Runner already records to BackupRun; this catches truly unexpected
      // errors (e.g. DB disconnected mid-loop). We swallow so other tenants
      // in this tick still get a chance.
      const msg = error instanceof Error ? error.message : String(error);
      log.error("[weekly-backup-scheduler] runner threw", tenant.slug, msg);
    }
  }
}
