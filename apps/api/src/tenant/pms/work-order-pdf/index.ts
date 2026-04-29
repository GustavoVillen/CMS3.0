// Registry of Work Order PDF templates.
//
// To add a new template:
//   1. Create `template-<name>.ts` exporting `render<Name>WorkOrderPdf(ctx): Promise<Buffer>`.
//   2. Add the entry below.
//   3. Add the value to the `WorkOrderPdfTemplate` enum in prisma/schema.prisma.
//   4. The platform admin UI exposes whatever keys exist in this map.

import type { WorkOrderPdfContext } from "./shared";
import { renderStandardWorkOrderPdf } from "./template-standard";
import { renderMercurioWorkOrderPdf } from "./template-mercurio";

export type WorkOrderPdfRenderer = (ctx: WorkOrderPdfContext) => Promise<Buffer>;

export const WO_PDF_TEMPLATES: Record<string, WorkOrderPdfRenderer> = {
  STANDARD: renderStandardWorkOrderPdf,
  MERCURIO: renderMercurioWorkOrderPdf,
};

export const WO_PDF_TEMPLATE_KEYS = Object.keys(WO_PDF_TEMPLATES) as Array<keyof typeof WO_PDF_TEMPLATES>;

export { loadWorkOrderPdfContext } from "./data-loader";
export type { WorkOrderPdfContext } from "./shared";
