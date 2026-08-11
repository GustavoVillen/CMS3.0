// Carga todo lo que el PDF del Permiso de Trabajo necesita, en un solo lugar.
// Los renderers consumen el contexto sin volver a consultar Prisma.

import type { TenantAccessSession } from "../../auth/session-store";
import { getPrismaClient } from "../../../platform/data/prisma-client";
import { getPermit } from "../permits-service";
import { resolveTenantLogo } from "../../pms/pdf-helpers";
import { resolveTenantForm, PERMIT_FORM_TYPE_BY_PERMIT_TYPE } from "../../pms/tenant-forms-service";
import { resolveTenantTime } from "../../../common/tenant-time";
import type { PermitPdfContext, PermitRecord } from "./shared";

async function userName(prismaRaw: any, userId: string | null | undefined): Promise<string | null> {
  if (!prismaRaw || !userId) return null;
  try {
    const u = await prismaRaw.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true, formName: true },
    });
    if (!u) return null;
    return u.formName?.trim() || `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || null;
  } catch { return null; }
}

export async function loadPermitPdfContext(
  session: TenantAccessSession,
  id: string,
): Promise<PermitPdfContext> {
  // Aplica tenant + vessel scope y tira 404 si no es visible para el usuario.
  const row = await getPermit(session, id) as unknown as PermitRecord & {
    tenantId: string;
    createdByUserId: string | null;
    approvedByUserId: string | null;
    closedByUserId: string | null;
  };
  const prismaRaw = getPrismaClient() as any;

  // Un formulario controlado por tipo de permiso (REGI-SYE-01.4 .. 01.9).
  const formType = PERMIT_FORM_TYPE_BY_PERMIT_TYPE[row.type] ?? "PERMIT_HOT_WORK";
  const resolvedForm = await resolveTenantForm(session.tenantSlug, formType);
  const { tz, locale } = await resolveTenantTime(session.tenantSlug);

  let tenantName = "CMS3.0";
  let tenantLogoBuffer: Buffer | null = null;
  let formLogoBuffer: Buffer | null = resolvedForm.logoBuffer;
  let vesselName = row.vesselCode;

  if (prismaRaw) {
    try {
      const tenantRow = await prismaRaw.tenant.findUnique({
        where: { slug: session.tenantSlug },
        select: { settings: { select: { displayName: true, logoUrl: true, logoUrlLight: true } } },
      });
      if (tenantRow?.settings?.displayName) tenantName = tenantRow.settings.displayName;
      tenantLogoBuffer = await resolveTenantLogo(
        session.tenantSlug,
        tenantRow?.settings?.logoUrl,
        tenantRow?.settings?.logoUrlLight,
      );
      if (!formLogoBuffer) formLogoBuffer = tenantLogoBuffer;
    } catch { /* non-blocking */ }

    // El papel muestra el NOMBRE del buque, no el código.
    try {
      const vessel = await prismaRaw.vessel.findFirst({
        where: { tenantId: row.tenantId, code: row.vesselCode },
        select: { name: true },
      });
      if (vessel?.name) vesselName = vessel.name;
    } catch { /* non-blocking */ }
  }

  const [createdByName, approvedByName, closedByName] = await Promise.all([
    userName(prismaRaw, row.createdByUserId),
    userName(prismaRaw, row.approvedByUserId),
    userName(prismaRaw, row.closedByUserId),
  ]);

  return {
    permit: row,
    vesselName,
    tenantName,
    createdByName,
    approvedByName,
    closedByName,
    formMeta: resolvedForm.meta,
    formConfig: resolvedForm.config,
    formLogoBuffer,
    tenantLogoBuffer,
    tz,
    locale,
  };
}
