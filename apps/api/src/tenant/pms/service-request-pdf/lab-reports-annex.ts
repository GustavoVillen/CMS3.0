// Anexo del PDF de la SS: el informe del laboratorio, cuando ya volvió.
//
// El formulario REGI-MAN-02.4 no tiene un bloque de resultados, así que el
// informe no se redibuja: se agregan sus páginas tal cual detrás del formulario.
// Va antes del sello digital, para que el sello cubra el documento completo.
//
// Un informe que no se puede leer (archivo borrado, PDF dañado o cifrado) se
// saltea: la SS sale igual.

import { PDFDocument } from "pdf-lib";
import { log } from "../../../common/logger";
import { readFluidReportFile } from "../../fluid-analyses/fluid-uploads-service";
import type { ServiceRequestLabReport } from "../../service-requests/service-requests-service";

/** A4 en puntos, el mismo tamaño que el formulario. */
const A4: [number, number] = [595.28, 841.89];
const MARGIN = 28;

function readReport(tenantSlug: string, storedUrl: string): Buffer | null {
  const parts = storedUrl.split("/"); // ["", "uploads", "fluid-reports", slug, archivo]
  if (parts.length !== 5 || parts[1] !== "uploads" || parts[2] !== "fluid-reports") return null;
  // Sólo informes de la misma empresa.
  if (parts[3] !== tenantSlug) return null;
  return readFluidReportFile(tenantSlug, parts[4]);
}

export async function appendLabReports(
  formPdf: Buffer,
  reports: ServiceRequestLabReport[],
  tenantSlug: string,
): Promise<Buffer> {
  if (reports.length === 0) return formPdf;
  const doc = await PDFDocument.load(formPdf);
  let added = 0;

  for (const report of reports) {
    const file = readReport(tenantSlug, report.storedUrl);
    if (!file) continue;
    const name = report.storedUrl.toLowerCase();
    const mime = (report.mime ?? "").toLowerCase();
    try {
      if (mime === "application/pdf" || name.endsWith(".pdf")) {
        const src = await PDFDocument.load(file);
        const pages = await doc.copyPages(src, src.getPageIndices());
        pages.forEach(p => doc.addPage(p));
        added += pages.length;
      } else if (mime.startsWith("image/") || /\.(png|jpe?g)$/.test(name)) {
        const isPng = mime === "image/png" || name.endsWith(".png");
        const img = isPng ? await doc.embedPng(file) : await doc.embedJpg(file);
        const page = doc.addPage(A4);
        const scale = Math.min((A4[0] - 2 * MARGIN) / img.width, (A4[1] - 2 * MARGIN) / img.height, 1);
        const w = img.width * scale;
        const h = img.height * scale;
        page.drawImage(img, { x: (A4[0] - w) / 2, y: A4[1] - MARGIN - h, width: w, height: h });
        added += 1;
      }
    } catch (err) {
      log.warn("ss-pdf: no se pudo anexar el informe del laboratorio", {
        storedUrl: report.storedUrl,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (added === 0) return formPdf;
  return Buffer.from(await doc.save());
}
