import { createWriteStream, mkdirSync, createReadStream, statSync } from "node:fs";
import { join, extname } from "node:path";
import { randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";
import { applySecurityHeaders } from "../../http/security-headers";

const UPLOADS_ROOT = join(process.cwd(), "uploads", "attachments");

const MIME_MAP: Record<string, string> = {
  ".pdf":  "application/pdf",
  ".doc":  "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls":  "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".txt":  "text/plain; charset=utf-8",
  // Audio
  ".webm": "audio/webm",
  ".mp3":  "audio/mpeg",
  ".m4a":  "audio/mp4",
  ".ogg":  "audio/ogg",
  ".wav":  "audio/wav",
  // Video
  ".mp4":  "video/mp4",
  ".mov":  "video/quicktime",
  // Comprimidos: un informe de taller suele venir con sus anexos (fotos,
  // planos) en un solo .zip. Se sirve como descarga, nunca se descomprime ni
  // se ejecuta nada de adentro.
  ".zip":  "application/zip",
};

function entityDir(tenantSlug: string, entityType: string): string {
  const dir = join(UPLOADS_ROOT, tenantSlug, entityType.toLowerCase());
  mkdirSync(dir, { recursive: true });
  return dir;
}

export async function saveAttachment(
  tenantSlug: string,
  entityType: string,
  originalName: string,
  buffer: Buffer,
): Promise<{ url: string; name: string }> {
  const ext = extname(originalName).toLowerCase();
  if (!Object.keys(MIME_MAP).includes(ext)) {
    throw new Error(`Tipo de archivo no permitido: ${ext}`);
  }

  const dir = entityDir(tenantSlug, entityType);
  const savedName = randomUUID() + ext;
  const filePath = join(dir, savedName);

  await new Promise<void>((resolve, reject) => {
    const stream = createWriteStream(filePath);
    stream.on("finish", resolve);
    stream.on("error", reject);
    stream.end(buffer);
  });

  return {
    url: `/uploads/attachments/${tenantSlug}/${entityType.toLowerCase()}/${savedName}`,
    name: originalName,
  };
}

export function serveAttachment(
  response: ServerResponse,
  tenantSlug: string,
  entityType: string,
  filename: string,
): boolean {
  if ([tenantSlug, entityType, filename].some(s => s.includes("..") || s.includes("/") || s.includes("\\"))) return false;

  const filePath = join(UPLOADS_ROOT, tenantSlug, entityType, filename);
  try {
    const stat = statSync(filePath);
    if (!stat.isFile()) return false;
    const ext = extname(filename).toLowerCase();
    const mime = MIME_MAP[ext] ?? "application/octet-stream";
    // Igual que en certificados, checklists y análisis de fluidos: sin esto el
    // adjunto se sirve sin nosniff ni CSP, y se muestra inline.
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
