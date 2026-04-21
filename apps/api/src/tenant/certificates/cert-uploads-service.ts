import { createWriteStream, mkdirSync, createReadStream, statSync } from "node:fs";
import { join, extname, basename } from "node:path";
import { randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";

const UPLOADS_ROOT = join(process.cwd(), "uploads", "certificates");

function tenantDir(tenantSlug: string): string {
  const dir = join(UPLOADS_ROOT, tenantSlug);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export async function saveCertificateSourceFile(
  tenantSlug: string,
  originalName: string,
  buffer: Buffer,
): Promise<{ url: string; name: string }> {
  const dir = tenantDir(tenantSlug);
  const ext = extname(originalName) || "";
  const savedName = randomUUID() + ext;
  const filePath = join(dir, savedName);

  await new Promise<void>((resolve, reject) => {
    const stream = createWriteStream(filePath);
    stream.on("finish", resolve);
    stream.on("error", reject);
    stream.end(buffer);
  });

  return {
    url: `/uploads/certificates/${tenantSlug}/${savedName}`,
    name: basename(originalName),
  };
}

const MIME_MAP: Record<string, string> = {
  ".pdf":  "application/pdf",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif":  "image/gif",
  ".webp": "image/webp",
  ".svg":  "image/svg+xml",
  ".doc":  "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls":  "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".txt":  "text/plain; charset=utf-8",
  ".bmp":  "image/bmp",
  ".tif":  "image/tiff",
  ".tiff": "image/tiff",
};

/**
 * Serve an uploaded certificate source file.
 * Returns true if served, false if not found.
 */
export function serveCertificateUpload(
  response: ServerResponse,
  tenantSlug: string,
  filename: string,
): boolean {
  // Prevent path traversal
  if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) return false;
  if (tenantSlug.includes("..") || tenantSlug.includes("/") || tenantSlug.includes("\\")) return false;

  const filePath = join(UPLOADS_ROOT, tenantSlug, filename);
  try {
    const stat = statSync(filePath);
    if (!stat.isFile()) return false;
    const ext = extname(filename).toLowerCase();
    const mime = MIME_MAP[ext] ?? "application/octet-stream";
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
