// Centralizes all data fetching for Work Order PDF rendering.
// Templates consume the resulting context without re-querying Prisma.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { TenantAccessSession } from "../../auth/session-store";
import { getTenantWorkOrder } from "../../work-orders/work-orders-service";
import { getPrismaClient } from "../../../platform/data/prisma-client";
import { resolveTenantLogo, sanitizePdfText, type WorkOrderPdfContext, type WorkOrderSpareUsage, type WorkOrderProgressPhoto } from "./shared";
import { resolveTenantForm, type TenantFormType } from "../tenant-forms-service";

const UPLOADS_ROOT = join(process.cwd(), "uploads", "attachments");

function fileUrlToPath(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/^\/uploads\/attachments\/([^/]+)\/([^/]+)\/([^/]+)$/);
  if (!m) return null;
  const [, slug, entity, filename] = m;
  return join(UPLOADS_ROOT, slug, entity, filename);
}

export async function loadWorkOrderPdfContext(
  session: TenantAccessSession,
  id: string,
  formType: TenantFormType = "WORK_ORDER",
): Promise<WorkOrderPdfContext> {
  const wo = await getTenantWorkOrder(session, id);
  const prismaRaw = getPrismaClient();

  // ── Definicion del formulario para este tenant (numero, revision, footer,
  //    secciones, opciones, logo) — fuente de verdad: tabla TenantForm. ──
  const resolvedForm = await resolveTenantForm(session.tenantSlug, formType);

  // ── Assigned user ──
  let assignedName: string | null = null;
  if (prismaRaw && (wo as any).assignedToUserId) {
    try {
      const u = await (prismaRaw as any).user.findUnique({
        where: { id: (wo as any).assignedToUserId },
        select: { firstName: true, lastName: true },
      });
      if (u) assignedName = `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || null;
    } catch { /* non-blocking */ }
  }

  // ── Created-by user ──
  let createdByName: string | null = null;
  if (prismaRaw && (wo as any).createdByUserId) {
    try {
      const u = await (prismaRaw as any).user.findUnique({
        where: { id: (wo as any).createdByUserId },
        select: { firstName: true, lastName: true, email: true },
      });
      if (u) createdByName = `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email || null;
    } catch { /* non-blocking */ }
  }

  // ── Tenant info + logo + template key ──
  let tenant: WorkOrderPdfContext["tenant"] = null;
  let tenantLogoBuffer: Buffer | null = null;
  let templateKey = "STANDARD";
  if (prismaRaw) {
    try {
      const row = await (prismaRaw as any).tenant.findUnique({
        where: { slug: session.tenantSlug },
        select: {
          settings: {
            select: {
              displayName: true,
              logoUrl: true,
              logoUrlLight: true,
              workOrderPdfTemplate: true,
            },
          },
        },
      });
      if (row?.settings) {
        tenant = {
          name: row.settings.displayName,
          logoUrl: row.settings.logoUrl,
          logoUrlLight: row.settings.logoUrlLight,
        };
        templateKey = row.settings.workOrderPdfTemplate ?? "STANDARD";
      }
      tenantLogoBuffer = await resolveTenantLogo(session.tenantSlug, tenant?.logoUrl, tenant?.logoUrlLight);
    } catch { /* non-blocking */ }
  }

  // ── Spare usages reconstructed from stock movements ──
  const spareUsages: WorkOrderSpareUsage[] = [];
  if (prismaRaw) {
    try {
      const movements = await (prismaRaw as any).stockMovement.findMany({
        where: {
          referenceType: "WORK_ORDER",
          referenceId: wo.id,
          tenantId: (wo as any).tenantId,
          quantity: { gt: 0 },
        },
        select: { quantity: true, unit: true, spareId: true },
      });
      for (const m of movements) {
        try {
          const spare = await (prismaRaw as any).spare.findUnique({
            where: { id: m.spareId },
            select: { name: true, partNumber: true },
          });
          spareUsages.push({
            spareName: spare ? `${spare.name}${spare.partNumber ? ` (${spare.partNumber})` : ""}` : m.spareId,
            quantity: m.quantity,
            unit: m.unit,
          });
        } catch { /* non-blocking */ }
      }
    } catch { /* non-blocking */ }
  }

  const assetLabel = sanitizePdfText((wo as any).assetName ?? wo.assetId ?? "—");

  // ISM 10.3 — flag safety-critical del activo
  let assetIsSafetyCritical = false;
  if (prismaRaw && wo.assetId) {
    try {
      const asset = await (prismaRaw as any).asset.findUnique({
        where: { id: wo.assetId },
        select: { isSafetyCritical: true },
      });
      assetIsSafetyCritical = Boolean(asset?.isSafetyCritical);
    } catch { /* non-blocking */ }
  }

  // ── Progress photos (avances con kind=PHOTO) ──
  const progressPhotos: WorkOrderProgressPhoto[] = [];
  if (prismaRaw) {
    try {
      const notes = await (prismaRaw as any).workOrderProgressNote.findMany({
        where: {
          workOrderId: wo.id,
          tenantId: (wo as any).tenantId,
          kind: "PHOTO",
          deletedAt: null,
        },
        orderBy: { createdAt: "asc" },
        select: { id: true, fileUrl: true, text: true, mimeType: true, createdAt: true },
      });
      for (const n of notes) {
        if (!n.fileUrl) continue;
        const fp = fileUrlToPath(n.fileUrl);
        let buffer: Buffer | null = null;
        if (fp && existsSync(fp)) {
          try { buffer = readFileSync(fp); } catch { /* skip if read fails */ }
        }
        progressPhotos.push({
          id: n.id,
          fileUrl: n.fileUrl,
          text: n.text ?? null,
          createdAt: n.createdAt,
          buffer,
          mimeType: n.mimeType ?? null,
        });
      }
    } catch { /* non-blocking */ }
  }

  return {
    wo,
    assetLabel,
    assetIsSafetyCritical,
    assignedName,
    createdByName,
    tenant,
    tenantLogoBuffer,
    spareUsages,
    progressPhotos,
    // El estilo del formulario manda sobre el enum legacy (mismo valor cuando hay back-compat).
    templateKey: resolvedForm.meta.style ?? templateKey,
    tenantSlug: session.tenantSlug,
    formMeta: resolvedForm.meta,
    formConfig: resolvedForm.config,
    formLogoBuffer: resolvedForm.logoBuffer ?? tenantLogoBuffer,
  };
}
