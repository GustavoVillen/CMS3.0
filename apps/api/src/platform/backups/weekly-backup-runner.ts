import JSZip from "jszip";
import { getPrismaClient } from "../data/prisma-client";
import { isMailConfigured, sendMail } from "../mail/mail-service";
import { buildAllBackupFiles, listBackupDatasetLabels } from "./backup-data-export";
import { publishSystemAudit } from "../audit/audit-publisher";
import { log } from "../../common/logger";

// Generates the weekly Excel backup for ONE tenant and emails it.
//
// The flow is intentionally fail-fast around config so an undelivered backup
// never silently passes: we reject early when MAIL is not configured or the
// tenant didn't set a destination email. Failures are recorded in BackupRun
// and audited; the scheduler decides retry policy (currently: next weekly
// window).

export interface WeeklyBackupResult {
  status: "SUCCESS" | "FAILED";
  recipientEmail: string | null;
  fileSizeBytes: number | null;
  errorMessage: string | null;
  backupRunId: string;
}

const ZIP_SIZE_WARNING_BYTES = 30 * 1024 * 1024; // 30 MB

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function formatDateYmd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function buildEmailHtml(tenantDisplayName: string, dateLabel: string): string {
  const items = listBackupDatasetLabels()
    .map((label) => `<li>${label}</li>`)
    .join("");
  return [
    `<p>Backup semanal de <strong>${tenantDisplayName}</strong> — ${dateLabel}.</p>`,
    `<p>Se adjunta un ZIP con las siguientes planillas Excel:</p>`,
    `<ul>${items}</ul>`,
    `<p style="color:#666;font-size:12px;margin-top:24px">Mensaje generado automáticamente por GPMS. Si recibió este correo por error, contacte al administrador del sistema.</p>`,
  ].join("");
}

export async function runWeeklyBackupForTenant(tenantId: string): Promise<WeeklyBackupResult> {
  const prisma = getPrismaClient();
  if (!prisma) {
    throw new Error("DATABASE_NOT_CONFIGURED");
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    include: { settings: true },
  });
  if (!tenant || !tenant.settings) {
    throw new Error("TENANT_NOT_FOUND");
  }

  const recipient = String(tenant.settings.weeklyBackupEmail || "").trim();
  const enabled = tenant.settings.weeklyBackupEnabled === true;

  // Create the BackupRun row up front so partial failures still leave a trace.
  const backupRun = await prisma.backupRun.create({
    data: {
      tenantId: tenant.id,
      status: "FAILED",
      recipientEmail: recipient || null,
    },
  });

  const finalize = async (
    status: "SUCCESS" | "FAILED",
    fileSizeBytes: number | null,
    errorMessage: string | null,
  ): Promise<WeeklyBackupResult> => {
    await prisma.backupRun.update({
      where: { id: backupRun.id },
      data: {
        status,
        finishedAt: new Date(),
        fileSizeBytes,
        errorMessage,
      },
    });
    await publishSystemAudit(prisma, {
      tenantId: tenant.id,
      action: status === "SUCCESS" ? "WEEKLY_BACKUP_SUCCESS" : "WEEKLY_BACKUP_FAILED",
      entityType: "Tenant",
      entityId: tenant.id,
      metadata: {
        tenantSlug: tenant.slug,
        recipientEmail: recipient || null,
        fileSizeBytes,
        errorMessage,
      },
    });
    return {
      status,
      recipientEmail: recipient || null,
      fileSizeBytes,
      errorMessage,
      backupRunId: backupRun.id,
    };
  };

  try {
    if (!enabled) {
      return await finalize("FAILED", null, "BACKUP_NOT_ENABLED");
    }
    if (!recipient) {
      return await finalize("FAILED", null, "RECIPIENT_EMAIL_NOT_SET");
    }
    if (!isMailConfigured()) {
      return await finalize("FAILED", null, "MAIL_NOT_CONFIGURED");
    }

    const files = await buildAllBackupFiles(tenant.id);

    const zip = new JSZip();
    for (const f of files) {
      zip.file(f.filename, f.buffer);
    }
    const zipBuffer = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });

    if (zipBuffer.length > ZIP_SIZE_WARNING_BYTES) {
      log.warn(
        "[weekly-backup] ZIP exceeds soft limit",
        tenant.slug,
        `${(zipBuffer.length / 1024 / 1024).toFixed(1)}MB`,
      );
    }

    const dateLabel = formatDateYmd(new Date());
    const zipFilename = `gpms_backup_${tenant.slug}_${dateLabel}.zip`;

    await sendMail({
      to: recipient,
      subject: `GPMS — Backup semanal de planillas (${dateLabel})`,
      html: buildEmailHtml(tenant.settings.displayName, dateLabel),
      attachments: [
        {
          filename: zipFilename,
          contentBase64: zipBuffer.toString("base64"),
        },
      ],
    });

    return await finalize("SUCCESS", zipBuffer.length, null);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log.error("[weekly-backup] failed", tenant.slug, msg);
    return await finalize("FAILED", null, msg.slice(0, 500));
  }
}
