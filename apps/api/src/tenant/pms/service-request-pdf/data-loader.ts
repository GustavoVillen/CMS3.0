// Carga todo lo que el PDF de la Solicitud de Servicio necesita, en un solo lugar.
// Los renderers consumen el contexto sin volver a consultar Prisma.

import type { TenantAccessSession } from "../../auth/session-store";
import { getPrismaClient } from "../../../platform/data/prisma-client";
import { getServiceRequest } from "../../service-requests/service-requests-service";
import { resolveTenantLogo } from "../pdf-helpers";
import { sanitizePdfText } from "../work-order-pdf/shared";
import { resolveTenantForm } from "../tenant-forms-service";
import { resolveTenantTime } from "../../../common/tenant-time";
import type { ServiceRequestPdfContext, ServiceRequestPdfTenantInfo } from "./shared";
// La regla de "que firma corresponde a cada paso" es una sola, compartida con
// la pantalla del formulario (ver service-requests/signatures.ts).
import { resolveServiceRequestSignatures, signatureUrlToBuffer } from "../../service-requests/signatures";

/** Firma del usuario como Buffer, sólo si es un data-URI base64. */
function signatureBuffer(signatureUrl: unknown): Buffer | null {
  return signatureUrlToBuffer(typeof signatureUrl === "string" ? signatureUrl : null);
}

export async function loadServiceRequestPdfContext(
  session: TenantAccessSession,
  id: string,
): Promise<ServiceRequestPdfContext> {
  // Aplica tenant + vessel scope y tira 404 si no es visible para el usuario.
  const sr = await getServiceRequest(session, id) as Record<string, any>;
  const prismaRaw = getPrismaClient() as any;

  const resolvedForm = await resolveTenantForm(session.tenantSlug, "SERVICE_REQUEST");

  // ── Tenant (nombre + logo) ──
  let tenant: ServiceRequestPdfTenantInfo | null = null;
  let formLogoBuffer: Buffer | null = resolvedForm.logoBuffer;
  if (prismaRaw) {
    try {
      const row = await prismaRaw.tenant.findUnique({
        where: { slug: session.tenantSlug },
        select: { settings: { select: { displayName: true, logoUrl: true, logoUrlLight: true } } },
      });
      if (row?.settings) {
        tenant = {
          name: row.settings.displayName,
          logoUrl: row.settings.logoUrl,
          logoUrlLight: row.settings.logoUrlLight,
        };
      }
      // El formulario puede traer logo propio; si no, cae al del tenant.
      if (!formLogoBuffer) {
        formLogoBuffer = await resolveTenantLogo(session.tenantSlug, tenant?.logoUrl, tenant?.logoUrlLight);
      }
    } catch { /* non-blocking */ }
  }

  // ── Equipo afectado: sale del asset de la OT padre ──
  let assetLabel = "—";
  let assetIsSafetyCritical = false;
  const woAssetId: string | null = sr.workOrder?.assetId ?? null;
  if (prismaRaw && woAssetId) {
    try {
      const asset = await prismaRaw.asset.findUnique({
        where: { id: woAssetId },
        select: { name: true, assetCode: true, isSafetyCritical: true },
      });
      if (asset) {
        assetLabel = sanitizePdfText(`${asset.name ?? ""}${asset.assetCode ? ` (${asset.assetCode})` : ""}`.trim() || woAssetId);
        assetIsSafetyCritical = Boolean(asset.isSafetyCritical);
      }
    } catch { /* non-blocking */ }
  }

  // ── Buque, taller, firmas ──
  let vesselName: string | null = null;
  let providerName: string | null = null;
  let createdByName: string | null = null;
  let createdByFormName: string | null = null;
  let assignedName: string | null = null;
  let assignedFormName: string | null = null;
  let assignedSignatureBuffer: Buffer | null = null;
  let solicitaSignatureBuffer: Buffer | null = null;
  let apruebaSignatureBuffer: Buffer | null = null;
  let autorizaSignatureBuffer: Buffer | null = null;

  if (prismaRaw) {
    try {
      const vessel = await prismaRaw.vessel.findFirst({
        where: { tenantId: sr.tenantId, code: sr.vesselCode },
        select: { name: true },
      });
      vesselName = vessel?.name ?? null;
    } catch { /* non-blocking */ }

    if (sr.providerId) {
      try {
        // Con tenantId, igual que en service-requests-service: el PDF no debe
        // resolver el nombre de un proveedor de otra empresa.
        const p = await prismaRaw.provider.findFirst({
          where: { id: sr.providerId, tenantId: (sr as any).tenantId },
          select: { name: true },
        });
        providerName = p?.name ?? null;
      } catch { /* non-blocking */ }
    }

    if (sr.createdByUserId) {
      try {
        const u = await prismaRaw.user.findUnique({
          where: { id: sr.createdByUserId },
          select: { firstName: true, lastName: true, formName: true, signatureUrl: true },
        });
        if (u) {
          createdByName = `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || null;
          createdByFormName = u.formName?.trim() || null;
          assignedSignatureBuffer = signatureBuffer(u.signatureUrl);
        }
      } catch { /* non-blocking */ }
    }
    // "Asignado" en el formulario = quien autorizó (tierra) si ya está autorizada;
    // si no, quien la aprobó a bordo.
    const signerId: string | null = sr.autorizadoByUserId ?? sr.aprobadoByUserId ?? null;
    if (signerId) {
      try {
        const u = await prismaRaw.user.findUnique({
          where: { id: signerId },
          select: { firstName: true, lastName: true, formName: true, signatureUrl: true },
        });
        if (u) {
          assignedName = `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || null;
          assignedFormName = u.formName?.trim() || null;
          const sig = signatureBuffer(u.signatureUrl);
          if (sig) assignedSignatureBuffer = sig;
        }
      } catch { /* non-blocking */ }
    }

    // Firmas de la tramitación: la regla vive en service-requests/signatures.ts,
    // compartida con la pantalla del formulario.
    const solicitaNombre = sr.solicitaByName ?? createdByFormName ?? createdByName;
    const firmas = await resolveServiceRequestSignatures(sr as any, solicitaNombre);
    solicitaSignatureBuffer = signatureUrlToBuffer(firmas.solicita);
    apruebaSignatureBuffer  = signatureUrlToBuffer(firmas.aprueba);
    autorizaSignatureBuffer = signatureUrlToBuffer(firmas.autoriza);
  }

  return {
    sr,
    wo: sr.workOrder ?? null,
    assetLabel,
    assetIsSafetyCritical,
    vesselName,
    providerName,
    createdByName,
    createdByFormName,
    assignedName: assignedName ?? sr.autorizadoByName ?? sr.aprobadoByName ?? null,
    assignedFormName,
    solicitaSignatureBuffer,
    apruebaSignatureBuffer,
    autorizaSignatureBuffer,
    assignedSignatureBuffer,
    tenant,
    tenantSlug: session.tenantSlug,
    ...(await resolveTenantTime(session.tenantSlug)),
    formMeta: resolvedForm.meta,
    formConfig: resolvedForm.config,
    formLogoBuffer,
    docCode: String(sr.serviceRequestCode ?? ""),
  };
}
