// Entry point for Work Order PDF generation.
// Loads context once, then dispatches to the tenant-selected template.
// Templates live in ./work-order-pdf/ — see ./work-order-pdf/index.ts.

import type { TenantAccessSession } from "../auth/session-store";
import { loadWorkOrderPdfContext, WO_PDF_TEMPLATES } from "./work-order-pdf";

export async function buildWorkOrderPdf(session: TenantAccessSession, id: string): Promise<Buffer> {
  const ctx = await loadWorkOrderPdfContext(session, id);
  const render = WO_PDF_TEMPLATES[ctx.templateKey] ?? WO_PDF_TEMPLATES.STANDARD;
  return render(ctx);
}
