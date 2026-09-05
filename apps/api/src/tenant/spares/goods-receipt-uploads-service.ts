// Archivos de remito de recepción de repuestos (PDF escaneado o foto del
// celular). Mismo patrón que fluid-uploads-service.ts: un directorio por
// tenant, nombre en disco aleatorio y servido sólo por /app/files/... con
// sesión válida (ver tenant/files/files-router.ts).
import { createWriteStream, mkdirSync, createReadStream, statSync } from "node:fs";
import { join, extname, basename } from "node:path";
import { randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";
import { applySecurityHeaders } from "../../http/security-headers";

const UPLOADS_ROOT = join(process.cwd(), "uploads", "goods-receipts");

function tenantDir(tenantSlug: string): string {
  const dir = join(UPLOADS_ROOT, tenantSlug);
  mkdirSync(dir, { recursive: true });
  return dir;
}

const MIME_MAP: Record<string, string> = {
  ".pdf":  "application/pdf",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif":  "image/gif",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".bmp":  "image/bmp",
  ".tif":  "image/tiff",
  ".tiff": "image/tiff",
};

export function mimeForReceiptFile(filename: string): string {
  const ext = extname(filename).toLowerCase();
  return MIME_MAP[ext] ?? "application/octet-stream";
}

export async function saveGoodsReceiptFile(
  tenantSlug: string,
  originalName: string,
  buffer: Buffer,
): Promise<{ url: string; name: string; mime: string; absolutePath: string }> {
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
    url: `/uploads/goods-receipts/${tenantSlug}/${savedName}`,
    name: basename(originalName),
    mime: mimeForReceiptFile(originalName),
    absolutePath: filePath,
  };
}

export function serveGoodsReceiptUpload(
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
    applySecurityHeaders(response);
    response.writeHead(200, {
      "Content-Type": mimeForReceiptFile(filename),
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
