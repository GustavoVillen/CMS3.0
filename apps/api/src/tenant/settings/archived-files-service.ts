// Retención de los archivos subidos: el Drive como archivo definitivo.
//
// Todo lo que sube la gente (fotos, videos, informes del laboratorio, remitos)
// se copia al Drive de la empresa (pdf-archive-service.ts) y queda anotado acá,
// con el id que le dio Drive. Pasados 2 años, el original se borra del servidor
// y el sistema lo sigue mostrando igual: cuando alguien lo abre, la API lo baja
// del Drive en el momento. El usuario no cambia de pantalla ni necesita permisos
// de Google — los permisos siguen siendo los de CMS3.
//
// Dos candados antes de borrar nada, porque después el Drive es el ÚNICO lugar
// donde vive ese archivo:
//   1. La empresa tiene que tener el archivo activo y la cuenta conectada.
//   2. Se verifica archivo por archivo que la copia siga existiendo en Drive
//      (y que no esté en la papelera) justo antes de borrar el original.

import { statSync, unlinkSync } from "node:fs";
import { join, normalize, sep } from "node:path";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { log } from "../../common/logger";
import { downloadFile, fileExists, getAccessToken } from "./google-drive-client";
import { getTenantDriveAccess } from "./pdf-archive-service";

/** Dos años, como pidió Gustavo. Lo que es más viejo que esto vive sólo en Drive. */
const RETENTION_DAYS = 730;
const UPLOADS_ROOT = join(process.cwd(), "uploads");

export interface ArchivedFileRecord {
  localUrl: string;
  driveFileId: string;
  driveName: string;
  mimeType: string;
  sizeBytes: number;
  vesselCode: string | null | undefined;
  kind: string;
}

/** Anota que ese archivo ya tiene copia en Drive. Idempotente por (tenant, archivo). */
export async function recordArchivedFile(tenantId: string, file: ArchivedFileRecord): Promise<void> {
  const prisma = getPrismaClient();
  if (!prisma || !file.localUrl) return;
  const data = {
    driveFileId: file.driveFileId,
    driveName: file.driveName,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    vesselCode: file.vesselCode ?? null,
    kind: file.kind,
  };
  await prisma.archivedFile.upsert({
    where: { tenantId_localUrl: { tenantId, localUrl: file.localUrl } },
    create: { tenantId, localUrl: file.localUrl, ...data },
    update: data,
  });
}

/** Ruta física del archivo, con la misma defensa contra "..'" que los uploads-service. */
function localPathFor(localUrl: string): string | null {
  if (!localUrl.startsWith("/uploads/")) return null;
  const relative = localUrl.slice("/uploads/".length);
  if (!relative || relative.includes("..")) return null;
  const full = normalize(join(UPLOADS_ROOT, relative));
  if (!full.startsWith(UPLOADS_ROOT + sep)) return null;
  return full;
}

/**
 * Contenido de un archivo que ya no está en el disco pero sí en Drive.
 * Devuelve null si no hay copia, si la empresa desconectó la cuenta o si Drive
 * no responde — el llamador contesta 404 como siempre.
 */
export async function readFromDrive(
  tenantSlug: string,
  localUrl: string,
): Promise<{ content: Buffer; mimeType: string; name: string } | null> {
  try {
    const prisma = getPrismaClient();
    if (!prisma) return null;
    const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug }, select: { id: true } });
    if (!tenant) return null;
    const row = await prisma.archivedFile.findUnique({
      where: { tenantId_localUrl: { tenantId: tenant.id, localUrl } },
    });
    if (!row) return null;

    const access = await getTenantDriveAccess(tenant.id);
    if (!access) return null;
    const accessToken = await getAccessToken(access.config, access.refreshToken);
    const content = await downloadFile(accessToken, row.driveFileId);
    return { content, mimeType: row.mimeType || "application/octet-stream", name: row.driveName };
  } catch (err) {
    log.warn("[archived-files] no se pudo traer del Drive", tenantSlug, localUrl,
      err instanceof Error ? err.message : String(err));
    return null;
  }
}

/**
 * Borra del servidor los originales de más de 2 años que ya están en Drive.
 * Corre una vez por día; devuelve cuántos liberó y cuántos bytes.
 */
export async function runArchivedFilesRetention(): Promise<{ removed: number; freedBytes: number }> {
  const prisma = getPrismaClient();
  if (!prisma) return { removed: 0, freedBytes: 0 };

  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const pending = await prisma.archivedFile.findMany({
    where: { localDeletedAt: null },
    select: { id: true, tenantId: true, localUrl: true, driveFileId: true, sizeBytes: true },
    take: 2000,
  });
  if (pending.length === 0) return { removed: 0, freedBytes: 0 };

  // Un token por empresa, no uno por archivo.
  const tokens = new Map<string, string | null>();
  async function tokenFor(tenantId: string): Promise<string | null> {
    if (tokens.has(tenantId)) return tokens.get(tenantId)!;
    const access = await getTenantDriveAccess(tenantId);
    let token: string | null = null;
    try {
      token = access ? await getAccessToken(access.config, access.refreshToken) : null;
    } catch {
      token = null;
    }
    tokens.set(tenantId, token);
    return token;
  }

  let removed = 0;
  let freedBytes = 0;
  for (const row of pending) {
    const path = localPathFor(row.localUrl);
    if (!path) continue;

    let mtimeMs: number;
    try {
      mtimeMs = statSync(path).mtimeMs;
    } catch {
      // Ya no está en el disco (lo borró otra cosa): se anota para no volver a mirarlo.
      await prisma.archivedFile.update({ where: { id: row.id }, data: { localDeletedAt: new Date() } });
      continue;
    }
    if (mtimeMs > cutoff) continue;

    const accessToken = await tokenFor(row.tenantId);
    if (!accessToken) continue;                       // cuenta desconectada: no se borra nada
    if (!await fileExists(accessToken, row.driveFileId)) continue;  // sin copia viva: tampoco

    try {
      unlinkSync(path);
    } catch {
      continue;
    }
    await prisma.archivedFile.update({ where: { id: row.id }, data: { localDeletedAt: new Date() } });
    removed += 1;
    freedBytes += row.sizeBytes ?? 0;
  }
  return { removed, freedBytes };
}
