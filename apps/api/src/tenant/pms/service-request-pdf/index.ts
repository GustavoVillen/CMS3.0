// Entry point de los documentos de la Solicitud de Servicio (SS).
// Carga el contexto una vez y despacha al renderer.

import type { TenantAccessSession } from "../../auth/session-store";
import { loadServiceRequestPdfContext } from "./data-loader";
import { renderServiceRequestPdf } from "./template-service-request";
import { renderServiceRequestDoc, renderServiceRequestHtml } from "./word-service-request";
import { wrapHtmlAsDocx } from "../docx-export";

export async function buildServiceRequestPdf(session: TenantAccessSession, id: string): Promise<Buffer> {
  return renderServiceRequestPdf(await loadServiceRequestPdfContext(session, id));
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
