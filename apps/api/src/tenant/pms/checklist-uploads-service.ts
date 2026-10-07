import { createReadStream, statSync } from "node:fs";
import { join, extname } from "node:path";
import type { ServerResponse } from "node:http";
import { applySecurityHeaders } from "../../http/security-headers";

const UPLOADS_ROOT = join(process.cwd(), "uploads", "checklists");

const MIME_MAP: Record<string, string> = {
  ".pdf":  "application/pdf",
  ".doc":  "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls":  "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".txt":  "text/plain; charset=utf-8",
};

// Sirve las planillas que se subieron a los planes antes de oct-2026 (ese
// adjunto del plan ya no existe: la planilla de una ejecución va en su OT).
export function serveChecklistUpload(
  response: ServerResponse,
  tenantSlug: string,
  filename: string,
): boolean {
  if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) return false;
  if (tenantSlug.includes("..") || tenantSlug.includes("/") || tenantSlug.includes("\\")) return false;

  const filePath = join(UPLOADS_ROOT, tenantSlug, filename);
  try {
    const stat = statSync(filePath);
    if (!stat.isFile()) return false;
    const ext = extname(filename).toLowerCase();
    const mime = MIME_MAP[ext] ?? "application/octet-stream";
    applySecurityHeaders(response);
    response.writeHead(200, {
      "Content-Type": mime,
      "Content-Length": stat.size,
      "Cache-Control": "private, max-age=3600",
      "Content-Disposition": `inline; filename="${filename}"`,
    });
    createReadStream(filePath).pipe(response);
    return true;
  } catch {
    return false;
  }
}
