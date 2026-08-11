// Centralizes all data fetching for Work Order PDF rendering.
// Templates consume the resulting context without re-querying Prisma.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { TenantAccessSession } from "../../auth/session-store";
import { getTenantWorkOrder } from "../../work-orders/work-orders-service";
import { getPrismaClient } from "../../../platform/data/prisma-client";
import {
  resolveTenantLogo, sanitizePdfText,
  type WorkOrderPdfContext, type WorkOrderSpareUsage, type WorkOrderProgressPhoto,
  type WorkOrderPlannedItem, type WorkOrderScheduleRow,
} from "./shared";
import { resolveTenantForm, type TenantFormType } from "../tenant-forms-service";
import { resolveTenantTime } from "../../../common/tenant-time";

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

  // ── Assigned user (nombre + nombre-formularios + firma para la caja del responsable) ──
  let assignedName: string | null = null;
  let assignedFormName: string | null = null;
  let assignedSignatureBuffer: Buffer | null = null;
  if (prismaRaw && (wo as any).assignedToUserId) {
    try {
      const u = await (prismaRaw as any).user.findUnique({
        where: { id: (wo as any).assignedToUserId },
        select: { firstName: true, lastName: true, formName: true, signatureUrl: true },
      });
      if (u) {
        assignedName = `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || null;
        assignedFormName = u.formName?.trim() || null;
        if (u.signatureUrl && typeof u.signatureUrl === "string") {
          const m = u.signatureUrl.match(/^data:image\/[a-z+]+;base64,(.+)$/i);
          if (m) { try { assignedSignatureBuffer = Buffer.from(m[1], "base64"); } catch { /* skip */ } }
        }
      }
    } catch { /* non-blocking */ }
  }

  // ── Created-by user (= "Solicita") ──
  let createdByName: string | null = null;
  let createdByFormName: string | null = null;
  if (prismaRaw && (wo as any).createdByUserId) {
    try {
      const u = await (prismaRaw as any).user.findUnique({
        where: { id: (wo as any).createdByUserId },
        select: { firstName: true, lastName: true, email: true, formName: true },
      });
      if (u) {
        createdByName = `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email || null;
        createdByFormName = u.formName?.trim() || null;
      }
    } catch { /* non-blocking */ }
  }

  // ── Firmas de tramitación: Solicita (creador), Aprueba, Autoriza ──
  // Se incrustan en el recuadro TRAMITACION del PDF cuando el paso fue hecho
  // por un usuario con firma cargada.
  const sigByUserId = async (userId: string | null | undefined): Promise<Buffer | null> => {
    if (!prismaRaw || !userId) return null;
    try {
      const u = await (prismaRaw as any).user.findUnique({ where: { id: userId }, select: { signatureUrl: true } });
      const m = u?.signatureUrl?.match?.(/^data:image\/[a-z+]+;base64,(.+)$/i);
      if (m) return Buffer.from(m[1], "base64");
    } catch { /* non-blocking */ }
    return null;
  };
  const solicitaSignatureBuffer = await sigByUserId((wo as any).createdByUserId);
  const apruebaSignatureBuffer  = await sigByUserId((wo as any).aprobadoByUserId);
  const autorizaSignatureBuffer = await sigByUserId((wo as any).autorizadoByUserId);
  // "Cierra la SS": firma de quien cerró la OT. La OT cerrada queda bloqueada,
  // así que updatedByUserId = quien la cerró.
  const cierraSignatureBuffer = (wo as any).status === "CLOSED"
    ? await sigByUserId((wo as any).updatedByUserId)
    : null;

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
            select: { name: true, sku: true },
          });
          spareUsages.push({
            spareName: spare ? `${spare.name}${spare.sku ? ` (${spare.sku})` : ""}` : m.spareId,
            quantity: m.quantity,
            unit: m.unit,
          });
        } catch { /* non-blocking */ }
      }
    } catch { /* non-blocking */ }
  }

  // EQUIPO del papel. Si la OT cubre varios ítems del PDM de equipos distintos,
  // se listan todos (ver el bloque de ITEM DEL PDM, más abajo).
  let assetLabel = sanitizePdfText((wo as any).assetName ?? wo.assetId ?? "—");

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

  // ── Nombre de la embarcación (Vessel.name) ──
  let vesselName: string | null = null;
  if (prismaRaw && (wo as any).vesselCode) {
    try {
      const vessel = await (prismaRaw as any).vessel.findFirst({
        where: { tenantId: wo.tenantId, code: (wo as any).vesselCode },
        select: { name: true },
      });
      vesselName = vessel?.name ?? null;
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

  // ── Todos los avances (para el listado del PDF) ──
  const progressNotes: { kind: string; text: string | null; createdAt: Date }[] = [];
  if (prismaRaw) {
    try {
      const all = await (prismaRaw as any).workOrderProgressNote.findMany({
        where: { workOrderId: wo.id, tenantId: (wo as any).tenantId, deletedAt: null },
        orderBy: { createdAt: "asc" },
        select: { kind: true, text: true, createdAt: true },
      });
      for (const n of all) progressNotes.push({ kind: n.kind, text: n.text ?? null, createdAt: n.createdAt });
    } catch { /* non-blocking */ }
  }

  // ── Ejes de la matriz de riesgo: del plan de mantenimiento vinculado ──
  let riskProbability: string | null = null;
  let riskConsequence: string | null = null;
  if (prismaRaw && (wo as any).maintenancePlanId) {
    try {
      const plan = await (prismaRaw as any).maintenancePlan.findUnique({
        where: { id: (wo as any).maintenancePlanId },
        select: { riskProbability: true, riskConsequence: true },
      });
      riskProbability = plan?.riskProbability ?? null;
      riskConsequence = plan?.riskConsequence ?? null;
    } catch { /* non-blocking */ }
  }

  // ── Formulario REGI-OPE-26.3 ──────────────────────────────────────────────
  // REPUESTOS / MATERIALES planificados.
  let plannedItems: WorkOrderPlannedItem[] = [];
  if (prismaRaw) {
    try {
      const rows = await (prismaRaw as any).workOrderItem.findMany({
        where: { workOrderId: wo.id },
        orderBy: [{ kind: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
        select: { kind: true, description: true, quantity: true, unit: true },
      });
      plannedItems = rows.map((r: any) => ({
        kind: r.kind, description: r.description, quantity: r.quantity, unit: r.unit,
      }));
    } catch { /* non-blocking */ }
  }

  // PROGRAMACION DE TRABAJO: el papel pide fecha/técnico/lugar/empresa/horario.
  // WorkLog tiene fecha, técnico y horas; lugar y empresa salen de la OT
  // (location / provider), que es de donde el operador los tomaría igual.
  const scheduleRows: WorkOrderScheduleRow[] = [];
  if (prismaRaw) {
    try {
      // Lo cargado en la OT manda (WorkOrderScheduleEntry).
      const entries = await (prismaRaw as any).workOrderScheduleEntry.findMany({
        where: { workOrderId: wo.id },
        orderBy: [{ sortOrder: "asc" }, { workDate: "asc" }, { createdAt: "asc" }],
        take: 12,
      });
      for (const e of entries) {
        scheduleRows.push({
          date: e.workDate ?? null,
          technician: e.technician ?? "",
          place: e.place ?? (wo as any).location ?? "",
          company: e.company ?? (wo as any).providerName ?? "",
          time: e.timeFrom && e.timeTo ? `${e.timeFrom} - ${e.timeTo}` : (e.timeFrom ?? e.timeTo ?? ""),
        });
      }

      // Sin filas cargadas se cae a los WorkLog, como hacía antes: las OT
      // viejas (y las del Mantenimiento Express, que sí generan WorkLog) siguen
      // imprimiendo lo mismo de siempre.
      if (scheduleRows.length === 0) {
        const logs = await (prismaRaw as any).workLog.findMany({
          where: { workOrderId: wo.id, tenantId: (wo as any).tenantId },
          orderBy: { startedAt: "asc" },
          select: { startedAt: true, completedAt: true, executedByName: true },
          take: 6,
        });
        for (const l of logs) {
          const hhmm = (d: Date | null) => d ? new Date(d).toISOString().slice(11, 16) : "";
          const desde = hhmm(l.startedAt);
          const hasta = hhmm(l.completedAt);
          scheduleRows.push({
            date: l.startedAt ?? null,
            technician: l.executedByName ?? "",
            place: (wo as any).location ?? "",
            company: (wo as any).providerName ?? "",
            time: desde && hasta ? `${desde} - ${hasta}` : desde,
          });
        }
      }
    } catch { /* non-blocking */ }
  }

  // Recuadro de autorizaciones (CONFINADO/CALIENTE/ELECTRICO/ALTURA/FRIO):
  // se deriva de los permisos de trabajo vinculados, no de campos propios.
  let permitTypes: string[] = [];
  if (prismaRaw) {
    try {
      const permits = await (prismaRaw as any).permitToWork.findMany({
        where: { workOrderId: wo.id, tenantId: (wo as any).tenantId },
        select: { type: true },
      });
      permitTypes = [...new Set(permits.map((p: any) => String(p.type)))] as string[];
    } catch { /* non-blocking */ }
  }

  // Celda "NRO DE SS/SC": las SS abiertas desde esta OT. La SC la maneja otra app.
  let serviceRequestCodes: string[] = [];
  // Talleres involucrados: el de la OT + los de sus SS, sin repetir.
  let providerNames: string[] = [];
  if (prismaRaw) {
    try {
      const srs = await (prismaRaw as any).serviceRequest.findMany({
        where: { workOrderId: wo.id, deletedAt: null },
        orderBy: { serviceRequestCode: "asc" },
        // La SS sólo tiene providerId (no hay proveedor escrito a mano acá: eso
        // es de la OT). Pedir un campo inexistente rompe toda la consulta.
        select: { serviceRequestCode: true, providerId: true },
      });
      serviceRequestCodes = srs.map((s: any) => s.serviceRequestCode);

      const ids = [...new Set([
        ...(wo as any).providerId ? [(wo as any).providerId] : [],
        ...srs.map((s: any) => s.providerId).filter(Boolean),
      ])] as string[];
      const catalog = ids.length > 0
        ? await (prismaRaw as any).provider.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
        : [];
      const nameById = new Map<string, string>(catalog.map((p: any) => [p.id, p.name]));
      const names = [
        (wo as any).providerName ?? ((wo as any).providerId ? nameById.get((wo as any).providerId) : null) ?? (wo as any).providerOther ?? null,
        ...srs.map((s: any) => (s.providerId ? nameById.get(s.providerId) : null) ?? null),
      ].filter((n): n is string => !!n && !!String(n).trim());
      providerNames = [...new Set(names.map((n) => sanitizePdfText(n)))];
    } catch { /* non-blocking */ }
  }

  // ITEM DEL PDM = taskCode de los planes vinculados. Una OT de astillero cubre
  // varios ítems ("1.7 / 1.8 / 1.9 …") y el papel los lista todos, en el orden
  // en que se agregaron a la orden.
  let planTaskCode: string | null = null;
  if (prismaRaw) {
    try {
      const { listWorkOrderPlanIds } = await import("../../work-orders/work-order-plans-service");
      const planIds = await listWorkOrderPlanIds(prismaRaw, wo as any);
      if (planIds.length > 0) {
        const plans = await (prismaRaw as any).maintenancePlan.findMany({
          where: { id: { in: planIds } },
          select: { id: true, taskCode: true, assetId: true },
        });
        const byId = new Map<string, { taskCode: string; assetId: string }>(plans.map((p: any) => [p.id, p]));
        const ordered = planIds.map((id) => byId.get(id)).filter((p): p is { taskCode: string; assetId: string } => !!p);
        const codes = ordered.map((p) => p.taskCode);
        planTaskCode = codes.length > 0 ? codes.join(" / ") : null;

        // EQUIPO: los equipos de todos los planes incluidos, sin repetir y
        // empezando por el de la OT. Con un solo plan queda igual que antes.
        const assetIds = [...new Set(ordered.map((p) => p.assetId).filter(Boolean))];
        if (assetIds.length > 1 || (assetIds.length === 1 && assetIds[0] !== wo.assetId)) {
          const assets = await (prismaRaw as any).asset.findMany({
            where: { id: { in: [...new Set([wo.assetId, ...assetIds])] } },
            select: { id: true, name: true },
          });
          const nameById = new Map<string, string>(assets.map((a: any) => [a.id, a.name ?? a.id]));
          const labels = [wo.assetId, ...assetIds]
            .filter((id, i, arr) => !!id && arr.indexOf(id) === i)
            .map((id) => nameById.get(id) ?? id);
          if (labels.length > 0) assetLabel = sanitizePdfText(labels.join(", "));
        }
      }
    } catch { /* non-blocking */ }
  }

  return {
    wo,
    assetLabel,
    vesselName,
    assetIsSafetyCritical,
    assignedName,
    assignedFormName,
    assignedSignatureBuffer,
    createdByName,
    createdByFormName,
    solicitaSignatureBuffer,
    apruebaSignatureBuffer,
    autorizaSignatureBuffer,
    cierraSignatureBuffer,
    tenant,
    tenantLogoBuffer,
    spareUsages,
    progressPhotos,
    progressNotes,
    riskProbability,
    riskConsequence,
    plannedItems,
    scheduleRows,
    permitTypes,
    serviceRequestCodes,
    providerNames,
    planTaskCode,
    // `workOrderPdfTemplate` (TenantSetting) manda: es lo que elige el admin y el
    // único eje con las claves de layout (STANDARD/MERCURIO/MERCURIO_OT).
    // `FormStyle` sólo distingue el chrome del documento controlado y no tiene
    // esas claves. Fallback al style por compatibilidad (hoy dan el mismo valor).
    templateKey: templateKey ?? resolvedForm.meta.style,
    tenantSlug: session.tenantSlug,
    ...(await resolveTenantTime(session.tenantSlug)),
    formMeta: resolvedForm.meta,
    formConfig: resolvedForm.config,
    formLogoBuffer: resolvedForm.logoBuffer ?? tenantLogoBuffer,
  };
}
