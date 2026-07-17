// Entry point for Work Order PDF generation.
// Loads context once, then dispatches to the tenant-selected template.
// Templates live in ./work-order-pdf/ — see ./work-order-pdf/index.ts.
//
// La Solicitud de Servicio (SS) NO se emite desde acá: es una entidad propia,
// con su propio documento — ver ./service-request-pdf/.

import type { TenantAccessSession } from "../auth/session-store";
import { loadWorkOrderPdfContext, WO_PDF_TEMPLATES } from "./work-order-pdf";
import { renderWorkOrderDoc } from "./work-order-pdf/word-work-order";

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
