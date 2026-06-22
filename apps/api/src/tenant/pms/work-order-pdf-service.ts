// Entry point for Work Order PDF generation.
// Loads context once, then dispatches to the tenant-selected template.
// Templates live in ./work-order-pdf/ — see ./work-order-pdf/index.ts.

import type { TenantAccessSession } from "../auth/session-store";
import { loadWorkOrderPdfContext, WO_PDF_TEMPLATES } from "./work-order-pdf";
import { renderServiceRequestPdf } from "./work-order-pdf/template-service-request";
import { renderWorkOrderDoc } from "./work-order-pdf/word-work-order";
import { renderServiceRequestDoc } from "./work-order-pdf/word-service-request";
import { issueFormCode } from "./tenant-forms-service";

export async function buildWorkOrderPdf(session: TenantAccessSession, id: string): Promise<Buffer> {
  const ctx = await loadWorkOrderPdfContext(session, id);
  const render = WO_PDF_TEMPLATES[ctx.templateKey] ?? WO_PDF_TEMPLATES.STANDARD;
  return render(ctx);
}

// Versión Word (.doc) de la OT — mismo contexto que el PDF.
export async function buildWorkOrderDoc(session: TenantAccessSession, id: string): Promise<Buffer> {
  const ctx = await loadWorkOrderPdfContext(session, id);
  return renderWorkOrderDoc(ctx);
}

async function loadServiceRequestCtx(session: TenantAccessSession, id: string) {
  const ctx = await loadWorkOrderPdfContext(session, id, "SERVICE_REQUEST");
  const docCode = await issueFormCode(session.tenantSlug, "SERVICE_REQUEST", {
    sourceType: "WORK_ORDER",
    sourceId: ctx.wo.id,
    vesselCode: ctx.wo.vesselCode ?? "",
    fallbackCode: ctx.wo.workOrderCode ?? "",
  });
  return { ...ctx, docCode };
}

// Solicitud de servicios: mismo contexto que la OT pero con el formulario
// SERVICE_REQUEST resuelto y un codigo de documento emitido (estable por OT).
export async function buildServiceRequestPdf(session: TenantAccessSession, id: string): Promise<Buffer> {
  return renderServiceRequestPdf(await loadServiceRequestCtx(session, id));
}

export async function buildServiceRequestDoc(session: TenantAccessSession, id: string): Promise<Buffer> {
  return renderServiceRequestDoc(await loadServiceRequestCtx(session, id));
}
