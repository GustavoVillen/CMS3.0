// Registry de plantillas del PDF de Permiso de Trabajo.
//
// Para agregar una plantilla:
//   1. Crear `template-<nombre>.ts` exportando `render<Nombre>PermitPdf(ctx)`.
//   2. Agregar la entrada al mapa de abajo.
//   3. La plantilla que usa cada tenant sale de `TenantForm.style` (o del estilo
//      de documento del tenant si no tiene fila propia) — ver tenant-forms-service.

import type { TenantAccessSession } from "../../auth/session-store";
import { loadPermitPdfContext } from "./data-loader";
import { renderStandardPermitPdf } from "./template-standard";
import { renderMercurioPermitPdf } from "./template-mercurio";
import { renderMercurioPermitDoc, renderStandardPermitDoc } from "./word-permit";
import type { PermitPdfContext } from "./shared";

export type PermitPdfRenderer = (ctx: PermitPdfContext) => Promise<Buffer>;
export type PermitDocRenderer = (ctx: PermitPdfContext) => Buffer;

export const PERMIT_PDF_TEMPLATES: Record<string, PermitPdfRenderer> = {
  STANDARD: renderStandardPermitPdf,
  // Formularios controlados REGI-SYE-01.4 .. 01.9 de Mercurio.
  MERCURIO: renderMercurioPermitPdf,
};

/** Mismos formularios, en Word editable. Espejo del mapa de arriba. */
export const PERMIT_DOC_TEMPLATES: Record<string, PermitDocRenderer> = {
  STANDARD: renderStandardPermitDoc,
  MERCURIO: renderMercurioPermitDoc,
};

export interface PermitPdfDocument {
  buffer: Buffer;
  /** Nombre del archivo descargado (sin extensión). */
  fileName: string;
}

/**
 * PDF del permiso + el nombre con el que se descarga. Con documento controlado
 * el archivo lleva el código del formulario adelante ("REGI-SYE-01.5 - PTW-...")
 * porque es el número con el que el buque lo archiva en el sistema de gestión.
 */
export async function buildPermitPdfDocument(session: TenantAccessSession, id: string): Promise<PermitPdfDocument> {
  const ctx = await loadPermitPdfContext(session, id);
  const render = PERMIT_PDF_TEMPLATES[ctx.formMeta.style] ?? renderStandardPermitPdf;
  const buffer = await render(ctx);
  const code = ctx.formMeta.style === "MERCURIO" ? ctx.formMeta.formCode : "";
  return { buffer, fileName: code ? `${code} - ${ctx.permit.permitCode}` : ctx.permit.permitCode };
}

export async function buildPermitPdf(session: TenantAccessSession, id: string): Promise<Buffer> {
  return (await buildPermitPdfDocument(session, id)).buffer;
}

/**
 * El mismo formulario en Word (.doc), editable: a bordo se completan las
 * casillas y las firmas antes de imprimir.
 */
export async function buildPermitWordDocument(session: TenantAccessSession, id: string): Promise<PermitPdfDocument> {
  const ctx = await loadPermitPdfContext(session, id);
  const render = PERMIT_DOC_TEMPLATES[ctx.formMeta.style] ?? renderStandardPermitDoc;
  const buffer = render(ctx);
  const code = ctx.formMeta.style === "MERCURIO" ? ctx.formMeta.formCode : "";
  return { buffer, fileName: code ? `${code} - ${ctx.permit.permitCode}` : ctx.permit.permitCode };
}

export { loadPermitPdfContext } from "./data-loader";
export type { PermitPdfContext } from "./shared";
