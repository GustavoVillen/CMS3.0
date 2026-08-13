// Exportación a .docx REAL (Office Open XML), no a .doc.
//
// Los documentos de este sistema (OT, SS) se arman como HTML, que Word abre bien
// pero como archivo .doc: si se le cambia la extensión a .docx, Word avisa que
// "el formato y la extensión no coinciden". Para entregar un .docx de verdad hay
// que armar el contenedor OOXML, que es un ZIP con varias piezas.
//
// Se usa `altChunk`: el .docx declara un pedazo alternativo con el HTML adentro y
// Word lo convierte a contenido nativo al abrirlo. Es la técnica estándar para
// llevar HTML a Word conservando tablas, imágenes y estilos — reimplementar el
// formulario en OOXML a mano daría un documento peor y mucho más frágil.
//
// Limitación conocida: `altChunk` lo resuelve MS Word (y Word Online). Google
// Docs y LibreOffice pueden mostrarlo vacío. Por eso el PDF sigue siendo el
// documento oficial y esto es la copia editable.

import JSZip from "jszip";
import type { ServerResponse } from "node:http";

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Default Extension="jpeg" ContentType="image/jpeg"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/afchunk.htm" ContentType="text/html"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOCUMENT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="htmlChunk" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/aFChunk" Target="afchunk.htm"/>
</Relationships>`;

// A4 vertical con los mismos márgenes que el PDF del formulario controlado.
// Medidas en twips (1 pt = 20 twips): A4 = 595.3 x 841.9 pt.
const DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    <w:altChunk r:id="htmlChunk"/>
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="794" w:right="624" w:bottom="794" w:left="624" w:header="340" w:footer="340" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;

/**
 * Envuelve el HTML de un formulario en un contenedor .docx.
 * `html` es el documento completo (con <html>, estilos y todo), el mismo que se
 * usa para el .doc.
 */
export async function wrapHtmlAsDocx(html: string): Promise<Buffer> {
  const zip = new JSZip();
  // El orden importa poco, pero [Content_Types].xml va primero por convención.
  zip.file("[Content_Types].xml", CONTENT_TYPES);
  zip.file("_rels/.rels", ROOT_RELS);
  zip.file("word/document.xml", DOCUMENT_XML);
  zip.file("word/_rels/document.xml.rels", DOCUMENT_RELS);
  zip.file("word/afchunk.htm", html);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

export function serveDocx(response: ServerResponse, buffer: Buffer, filename: string): void {
  const safe = filename.endsWith(".docx") ? filename : `${filename}.docx`;
  response.writeHead(200, {
    "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "Content-Disposition": `attachment; filename="${safe}"`,
    "Content-Length": buffer.length,
  });
  response.end(buffer);
}
