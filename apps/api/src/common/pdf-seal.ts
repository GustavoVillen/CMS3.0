// Sello digital de los PDF del sistema (firma PAdES con el certificado de la empresa).
//
// No reemplaza las firmas de la tramitacion (las imagenes de Solicita / Aprueba /
// Autoriza que estampa cada plantilla): las PROTEGE. Un PDF sellado muestra en
// Adobe "firmado, sin modificaciones"; si alguien lo edita despues, la firma se
// rompe y el lector lo avisa. Eso es lo que pide una auditoria: que el documento
// no se pueda adulterar sin que se note.
//
// Un certificado POR TENANT: cada empresa sella con el suyo. Nunca se sella el
// documento de una empresa con el certificado de otra.
//
//   PDF_SEAL_DIR=/ruta/a/certificados    # .env de la API
//     <tenantSlug>.p12                   # certificado + clave privada (PKCS#12)
//     <tenantSlug>.pass                  # contrasena del .p12 (una linea)
//
// Sin PDF_SEAL_DIR o sin el .p12 del tenant, el PDF sale sin sellar, como hasta
// ahora. Los archivos se leen en cada emision: cambiar el certificado (el de
// prueba por el real, o la renovacion anual) no requiere reiniciar la API.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { SignPdf } from "@signpdf/signpdf";
import { pdflibAddPlaceholder } from "@signpdf/placeholder-pdf-lib";
import { P12Signer } from "@signpdf/signer-p12";
import { log } from "./logger";

function readSealFiles(tenantSlug: string): { p12: Buffer; passphrase: string } | null {
  const dir = (process.env.PDF_SEAL_DIR || "").trim();
  // El slug arma un nombre de archivo: sin separadores ni "..".
  if (!dir || !/^[a-z0-9-]+$/i.test(tenantSlug)) return null;
  const p12Path = join(dir, `${tenantSlug}.p12`);
  if (!existsSync(p12Path)) return null;
  const passPath = join(dir, `${tenantSlug}.pass`);
  const passphrase = existsSync(passPath) ? readFileSync(passPath, "utf8").trim() : "";
  return { p12: readFileSync(p12Path), passphrase };
}

/** ¿El tenant tiene certificado cargado? */
export function isPdfSealConfigured(tenantSlug: string): boolean {
  return readSealFiles(tenantSlug) !== null;
}

/**
 * Sella el PDF con el certificado del tenant. `documentCode` (OT-..., SS-...)
 * va como motivo de la firma: es lo que Adobe muestra en el panel de firmas.
 *
 * Si el sello falla (certificado vencido, contrasena mal cargada) el PDF sale
 * igual, sin sellar, y queda el aviso en el log: un problema de configuracion
 * no puede frenar la emision de una OT a bordo.
 */
export async function sealPdf(pdf: Buffer, tenantSlug: string, documentCode: string): Promise<Buffer> {
  const files = readSealFiles(tenantSlug);
  if (!files) return pdf;
  try {
    // pdf-lib y no el parser "plain" de signpdf: la OT trae campos de formulario
    // propios (AcroForm) y el parser plain los corrompe al agregar el de firma.
    const doc = await PDFDocument.load(pdf);
    pdflibAddPlaceholder({
      pdfDoc: doc,
      // Solo ASCII: el motivo viaja como string PDF y los acentos/guiones largos
      // salen como basura en el panel de firmas.
      reason: `${documentCode} - emitido por CMS3`,
      contactInfo: "",
      name: "CMS3",
      location: "",
      appName: "CMS3",
    });
    const withPlaceholder = Buffer.from(await doc.save({ useObjectStreams: false }));
    const signer = new P12Signer(files.p12, { passphrase: files.passphrase });
    return await new SignPdf().sign(withPlaceholder, signer);
  } catch (err) {
    log.warn(`[pdf-seal] no se pudo sellar ${documentCode} (tenant ${tenantSlug}):`, err);
    return pdf;
  }
}
