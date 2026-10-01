// El informe del laboratorio que disparó un defecto (veredicto crítico o de
// acción requerida) viaja con él: queda adjunto en el defecto y, cuando se abre
// la OT que lo repara, figura en los Avances de esa OT.
//
// No se copia el archivo: el adjunto y el avance apuntan al mismo informe
// (/uploads/fluid-reports/...). file-access-service autoriza su descarga por la
// muestra, que es del mismo buque que el defecto y la OT.
//
// Es idempotente y se puede llamar las veces que haga falta (al cargar el
// resultado, al vincular la OT y en la corrección de lo ya abierto). Si alguien
// borró el adjunto o el avance a propósito, no se vuelve a crear.

import { publishAudit } from "../../platform/audit/audit-publisher";
import { resolveTenantTime, fmtDate } from "../../common/tenant-time";
import { toStoredUrl, urlVariants } from "../files/file-access-service";
import { buildLabReportCaption } from "./analysis-text";
import { fluidReportSize } from "./fluid-uploads-service";

const LOCKED_WO_STATUSES = new Set(["CLOSED", "CANCELLED"]);

export interface LabReportLinkOutcome {
  defectAttachment: boolean;
  workOrderNote: boolean;
}

export async function linkLabReportToDefect(
  prisma: any,
  input: { tenantId: string; defectId: string; actorUserId: string },
): Promise<LabReportLinkOutcome> {
  const outcome: LabReportLinkOutcome = { defectAttachment: false, workOrderNote: false };

  const defect = await prisma.defect.findFirst({
    where: { id: input.defectId, tenantId: input.tenantId, deletedAt: null },
    select: { id: true, tenantId: true, vesselCode: true, defectCode: true, workOrderId: true },
  });
  if (!defect) return outcome;

  const result = await prisma.fluidAnalysisResult.findFirst({
    where: { tenantId: defect.tenantId, defectId: defect.id },
    select: {
      verdict: true, reportUrl: true, reportMime: true,
      sample: { select: { kind: true, sampleCode: true, labReference: true, labName: true, sampledAt: true, vesselCode: true } },
    },
  });
  if (!result?.reportUrl || !result.sample) return outcome;
  // El informe tiene que ser del mismo buque que el defecto: si no, quien ve el
  // defecto no tendría por qué ver el archivo.
  if (result.sample.vesselCode !== defect.vesselCode) return outcome;

  const storedUrl = toStoredUrl(result.reportUrl);
  const parts = storedUrl.split("/"); // ["", "uploads", "fluid-reports", slug, archivo]
  if (parts.length !== 5 || parts[2] !== "fluid-reports") return outcome;
  const tenant = await prisma.tenant.findUnique({ where: { id: defect.tenantId }, select: { slug: true } });
  if (!tenant || tenant.slug !== parts[3]) return outcome;

  const savedName = parts[4];
  const ext = savedName.includes(".") ? savedName.slice(savedName.lastIndexOf(".")) : "";
  const mimeType = result.reportMime || (ext.toLowerCase() === ".pdf" ? "application/pdf" : "application/octet-stream");
  const sizeBytes = fluidReportSize(tenant.slug, savedName);
  const urls = urlVariants(storedUrl);

  const { tz, locale } = await resolveTenantTime(tenant.slug);
  const caption = buildLabReportCaption({
    kind: String(result.sample.kind ?? "FLUID"),
    sampleCode: result.sample.sampleCode,
    labReference: result.sample.labReference ?? null,
    labName: result.sample.labName ?? null,
    sampledAtText: result.sample.sampledAt ? fmtDate(result.sample.sampledAt, tz, locale) : null,
    verdict: result.verdict,
    defectCode: defect.defectCode,
  });

  // ── Adjunto del defecto ──
  const existingAttachment = await prisma.attachment.findFirst({
    where: { tenantId: defect.tenantId, targetType: "DEFECT", targetId: defect.id, description: { in: urls } },
    select: { id: true },
  });
  if (!existingAttachment) {
    const now = new Date();
    await prisma.attachment.create({
      data: {
        tenantId: defect.tenantId,
        vesselCode: defect.vesselCode,
        targetType: "DEFECT",
        targetId: defect.id,
        filename: `Informe laboratorio ${result.sample.sampleCode}${ext}`,
        mimeType,
        sizeBytes,
        status: "ACTIVE",
        uploadedAt: now,
        uploadedByUserId: input.actorUserId,
        description: storedUrl, // convención vigente: la URL va en description
        createdByUserId: input.actorUserId,
        updatedByUserId: input.actorUserId,
      },
    });
    outcome.defectAttachment = true;
    void publishAudit(prisma, {
      tenantId: defect.tenantId,
      actorUserId: input.actorUserId,
      action: "Defect.labReportAttached",
      entityType: "Defect",
      entityId: defect.id,
      metadata: { defectCode: defect.defectCode, sampleCode: result.sample.sampleCode, vesselCode: defect.vesselCode },
    });
  }

  // ── Avance de la OT que repara el defecto ──
  if (!defect.workOrderId) return outcome;
  const wo = await prisma.workOrder.findFirst({
    where: { id: defect.workOrderId, tenantId: defect.tenantId, deletedAt: null },
    select: { id: true, workOrderCode: true, vesselCode: true, status: true },
  });
  // OT cerrada o cancelada: no se le agregan avances (mismo criterio que la carga manual).
  if (!wo || LOCKED_WO_STATUSES.has(wo.status) || wo.vesselCode !== defect.vesselCode) return outcome;

  const existingNote = await prisma.workOrderProgressNote.findFirst({
    where: { tenantId: defect.tenantId, workOrderId: wo.id, fileUrl: { in: urls } },
    select: { id: true },
  });
  if (existingNote) return outcome;

  await prisma.workOrderProgressNote.create({
    data: {
      tenantId: defect.tenantId,
      vesselCode: wo.vesselCode,
      workOrderId: wo.id,
      kind: "DOCUMENT",
      text: caption,
      fileUrl: storedUrl,
      mimeType,
      sizeBytes: sizeBytes || null,
      processedText: caption,
      processed: true,
      createdByUserId: input.actorUserId,
    },
  });
  outcome.workOrderNote = true;
  void publishAudit(prisma, {
    tenantId: defect.tenantId,
    actorUserId: input.actorUserId,
    action: "WorkOrder.labReportAdded",
    entityType: "WorkOrder",
    entityId: wo.id,
    metadata: { workOrderCode: wo.workOrderCode, defectCode: defect.defectCode, sampleCode: result.sample.sampleCode },
  });

  return outcome;
}
