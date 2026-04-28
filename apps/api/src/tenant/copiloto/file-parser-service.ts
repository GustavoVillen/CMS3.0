/**
 * Parses uploaded files into a structure Claude can consume.
 *
 * Supported types:
 *   - Images (PNG, JPG, WEBP, GIF) → base64 image block (Claude vision)
 *   - PDF → base64 document block (Claude native PDF reading)
 *   - Excel (.xlsx/.xls) → extracted text table via ExcelJS
 *   - CSV / plain text → UTF-8 text, truncated at 20k chars
 */

import ExcelJS from "exceljs";

export type FileContent =
  | { type: "text";     text: string;   fileName: string }
  | { type: "image";    base64: string; mediaType: string; fileName: string }
  | { type: "document"; base64: string; fileName: string };

const MAX_TEXT_CHARS = 20_000;
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

export function assertFileSize(buffer: Buffer): void {
  if (buffer.length > MAX_FILE_BYTES) {
    throw new Error(`Archivo demasiado grande. Máximo permitido: 10 MB.`);
  }
}

export async function parseUploadedFile(
  buffer: Buffer,
  mimeType: string,
  fileName: string,
): Promise<FileContent> {
  const mt = mimeType.split(";")[0]!.trim().toLowerCase();
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";

  if (mt.startsWith("image/")) {
    const supportedImages = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    const safeType = supportedImages.includes(mt) ? mt : "image/jpeg";
    return { type: "image", base64: buffer.toString("base64"), mediaType: safeType, fileName };
  }

  if (mt === "application/pdf" || ext === "pdf") {
    return { type: "document", base64: buffer.toString("base64"), fileName };
  }

  if (
    mt.includes("spreadsheet") || mt.includes("excel") ||
    ext === "xlsx" || ext === "xls"
  ) {
    const text = await extractExcelText(buffer);
    return { type: "text", text, fileName };
  }

  // CSV, plain text, or anything else — treat as UTF-8 text
  const text = buffer.toString("utf-8").slice(0, MAX_TEXT_CHARS);
  return { type: "text", text, fileName };
}

async function extractExcelText(buffer: Buffer): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

  const lines: string[] = [];
  workbook.eachSheet(sheet => {
    lines.push(`### ${sheet.name}`);
    sheet.eachRow(row => {
      const cells = (row.values as unknown[])
        .slice(1)
        .map(v => (v == null ? "" : String(v)))
        .join("\t");
      if (cells.trim()) lines.push(cells);
    });
  });

  return lines.join("\n").slice(0, MAX_TEXT_CHARS);
}
