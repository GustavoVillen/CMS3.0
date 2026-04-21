import { createWriteStream, mkdirSync, createReadStream, statSync } from "node:fs";
import { join, extname } from "node:path";
import { randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";

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

function tenantDir(tenantSlug: string): string {
  const dir = join(UPLOADS_ROOT, tenantSlug);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export async function saveChecklistDocument(
  tenantSlug: string,
  originalName: string,
  buffer: Buffer,
): Promise<{ url: string; name: string }> {
  const ext = extname(originalName).toLowerCase();
  if (!Object.keys(MIME_MAP).includes(ext)) {
    throw new Error(`Tipo de archivo no permitido: ${ext}`);
  }

  const dir = tenantDir(tenantSlug);
  const savedName = randomUUID() + ext;
  const filePath = join(dir, savedName);

  await new Promise<void>((resolve, reject) => {
    const stream = createWriteStream(filePath);
    stream.on("finish", resolve);
    stream.on("error", reject);
    stream.end(buffer);
  });

  return {
    url: `/uploads/checklists/${tenantSlug}/${savedName}`,
    name: originalName,
  };
}

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
