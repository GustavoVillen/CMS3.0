// Entry point de los documentos de la Solicitud de Servicio (SS).
// Carga el contexto una vez y despacha al renderer.

import type { TenantAccessSession } from "../../auth/session-store";
import { loadServiceRequestPdfContext } from "./data-loader";
import { renderServiceRequestPdf } from "./template-service-request";
import { renderServiceRequestDoc, renderServiceRequestHtml } from "./word-service-request";
import { wrapHtmlAsDocx } from "../docx-export";
import { sealPdf } from "../../../common/pdf-seal";

// Sellado acá: la descarga, el envío al proveedor y el archivo en Drive usan
// todos esta función.
export async function buildServiceRequestPdf(session: TenantAccessSession, id: string): Promise<Buffer> {
  const ctx = await loadServiceRequestPdfContext(session, id);
  return sealPdf(await renderServiceRequestPdf(ctx), session.tenantSlug, ctx.docCode);
}

export async function buildServiceRequestDoc(session: TenantAccessSession, id: string): Promise<Buffer> {
  return renderServiceRequestDoc(await loadServiceRequestPdfContext(session, id));
}

/** Mismo documento, pero en .docx de verdad (contenedor OOXML). */
export async function buildServiceRequestDocx(session: TenantAccessSession, id: string): Promise<Buffer> {
  return wrapHtmlAsDocx(renderServiceRequestHtml(await loadServiceRequestPdfContext(session, id)));
}

export { loadServiceRequestPdfContext };
export type { ServiceRequestPdfContext } from "./shared";
