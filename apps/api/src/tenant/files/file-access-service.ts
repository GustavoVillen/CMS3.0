// Autorización de descarga de archivos subidos.
//
// AUDITORÍA 2026-09-09 — `files-router.ts` sólo comprobaba que el tenantSlug
// del path coincidiera con el de la sesión. Alcanzaba con conocer el nombre
// del archivo (un UUID, pero viaja en URLs, PDFs, mails y logs) para que
// CUALQUIER usuario de la empresa se bajara un documento de un buque que no
// tiene asignado: certificados, checklists, análisis de fluidos, escaneos de
// OT, remitos y adjuntos.
//
// Ahora la autorización se ata al REGISTRO dueño del archivo:
//
//   1. Se busca en la base qué fila guarda esa URL (por kind, dentro del
//      tenant). De ahí sale el `vesselCode`.
//   2. Se aplica el mismo alcance por buque que el resto del sistema
//      (`vessel-scope.ts`): TENANT_ADMIN ve todo; los demás, sólo sus buques
//      asignados.
//   3. Si ninguna fila reclama el archivo, sólo lo puede bajar quien lo acaba
//      de subir (ver "claim" más abajo). Si no, 404.
//
// COMPATIBILIDAD CON LO YA CARGADO: las columnas guardan la URL con prefijo
// `/uploads/...`, pero el backend le devuelve al cliente la forma
// `/app/files/...` (`serializeFileUrl`) y algunos formularios reenvían ese
// valor al guardar. Por eso cada búsqueda matchea LAS DOS formas.

import type { TenantAccessSession } from "../auth/session-store";
import { RouteError } from "../../http/route-error";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { getCachedTenantBySlug } from "../tenant-cache";

export type FileKind =
  | "certificates"
  | "checklists"
  | "fluid-reports"
  | "wo-scans"
  | "goods-receipts"
  | "attachments";

// ─── Archivos recién subidos, todavía sin registro ───────────────────────────
//
// Varios flujos suben primero y guardan después: el escaneo de un remito, el
// wizard de análisis de fluidos, el archivo de un certificado que se adjunta
// antes de darle "Guardar". Entre una cosa y la otra no hay fila que reclame
// el archivo, pero el que lo subió necesita poder verlo (previsualización).
//
// Se registra quién subió cada archivo. El escaneo de OT
// (`/app/files/wo-scans/...`) NUNCA se guarda en la base: para ese kind ésta
// es la única vía de acceso, y es la correcta — sólo lo lee quien lo subió.
//
// LÍMITE: el registro es de ESTE proceso. Con varias instancias y sin afinidad
// de sesión, la previsualización de un archivo recién subido puede dar 404 si
// el GET cae en otra instancia. Una vez guardado el registro, la resolución
// por entidad funciona en todas.

interface UploadClaim {
  tenantSlug: string;
  userId: string;
  expiresAt: number;
}

const CLAIM_TTL_MS = 24 * 60 * 60 * 1000;
const CLAIM_MAX_ENTRIES = 20_000;
const uploadClaims = new Map<string, UploadClaim>();

/** Normaliza cualquiera de las dos formas de URL a la que se guarda en la base. */
export function toStoredUrl(url: string): string {
  if (url.startsWith("/app/files/")) return "/uploads/" + url.slice("/app/files/".length);
  return url;
}

/** Las dos formas con las que un mismo archivo puede estar escrito en la base. */
export function urlVariants(storedUrl: string): string[] {
  const app = "/app/files/" + storedUrl.slice("/uploads/".length);
  return [storedUrl, app];
}

/**
 * Registra que `userId` acaba de subir este archivo. Se llama desde los
 * endpoints de upload, con la URL que devuelve el `save*` correspondiente.
 */
export function claimUploadedFile(tenantSlug: string, userId: string, url: string | null | undefined): void {
  if (!url) return;
  const key = toStoredUrl(url);
  if (!key.startsWith("/uploads/")) return;

  if (uploadClaims.size >= CLAIM_MAX_ENTRIES) evictExpiredUploadClaims(true);
  uploadClaims.set(key, { tenantSlug, userId, expiresAt: Date.now() + CLAIM_TTL_MS });
}

/** Barrido periódico (y de emergencia, si el Map se llena). */
export function evictExpiredUploadClaims(force = false): void {
  const now = Date.now();
  for (const [key, claim] of uploadClaims) {
    if (claim.expiresAt <= now) uploadClaims.delete(key);
  }
  if (force && uploadClaims.size >= CLAIM_MAX_ENTRIES) {
    // Todavía lleno: soltamos la mitad más vieja (orden de inserción del Map).
    let toDrop = Math.ceil(uploadClaims.size / 2);
    for (const key of uploadClaims.keys()) {
      uploadClaims.delete(key);
      if (--toDrop <= 0) break;
    }
  }
}

function hasFreshClaim(session: TenantAccessSession, storedUrl: string): boolean {
  const claim = uploadClaims.get(storedUrl);
  if (!claim) return false;
  if (claim.expiresAt <= Date.now()) {
    uploadClaims.delete(storedUrl);
    return false;
  }
  return claim.tenantSlug === session.tenantSlug && claim.userId === session.user.id;
}

// ─── Alcance por buque ───────────────────────────────────────────────────────

/**
 * Mismo criterio que `applyAssignedVesselScope`, en versión booleana:
 * TENANT_ADMIN ve todos los buques del tenant; el resto, sólo los asignados
 * (sin buques asignados no ve nada — fail-closed).
 */
export function canAccessVessel(session: TenantAccessSession, vesselCode: string): boolean {
  if (session.user.role === "TENANT_ADMIN") return true;
  return (session.user.assignedVesselCodes ?? []).includes(vesselCode);
}

// ─── Resolución del registro dueño ───────────────────────────────────────────

/**
 * Buques de los registros del tenant que guardan esta URL. Puede ser más de
 * uno si el mismo archivo quedó referenciado por varias filas (por ejemplo un
 * certificado y su renovación).
 */
export async function ownerVesselCodes(
  prisma: unknown,
  tenantId: string,
  kind: FileKind,
  storedUrl: string,
): Promise<string[]> {
  if (!prisma) return [];

  const p = prisma as any;
  const urls = urlVariants(storedUrl);
  const codes = new Set<string>();
  const add = (rows: Array<{ vesselCode?: string | null }> | null | undefined) => {
    for (const row of rows ?? []) if (row?.vesselCode) codes.add(row.vesselCode);
  };

  switch (kind) {
    case "certificates": {
      add(await p.certificate.findMany({
        where: { tenantId, originalSourceLink: { in: urls } },
        select: { vesselCode: true },
      }));
      // El archivo del período anterior queda colgando de la renovación.
      add(await p.certificateRenewal.findMany({
        where: { tenantId, previousSourceLink: { in: urls } },
        select: { vesselCode: true },
      }));
      break;
    }

    case "checklists": {
      add(await p.maintenancePlan.findMany({
        where: { tenantId, checklistTemplate: { in: urls } },
        select: { vesselCode: true },
      }));
      break;
    }

    case "fluid-reports": {
      // FluidAnalysisResult no tiene vesselCode propio: cuelga de la muestra.
      const rows: Array<{ sample?: { vesselCode?: string | null } | null }> =
        await p.fluidAnalysisResult.findMany({
          where: { tenantId, reportUrl: { in: urls } },
          select: { sample: { select: { vesselCode: true } } },
        });
      add(rows.map((r) => ({ vesselCode: r.sample?.vesselCode ?? null })));
      break;
    }

    case "goods-receipts": {
      add(await p.goodsReceipt.findMany({
        where: { tenantId, fileUrl: { in: urls } },
        select: { vesselCode: true },
      }));
      break;
    }

    case "attachments": {
      // El modelo Attachment guarda la URL en `description` (convención vigente).
      add(await p.attachment.findMany({
        where: { tenantId, description: { in: urls }, deletedAt: null },
        select: { vesselCode: true },
      }));
      // Fotos, audios y videos del avance de una OT: modelo propio.
      add(await p.workOrderProgressNote.findMany({
        where: { tenantId, fileUrl: { in: urls } },
        select: { vesselCode: true },
      }));
      // El checklist y el respaldo de la OT se suben por el endpoint genérico
      // de adjuntos, pero la URL termina en columnas de WorkOrder.
      add(await p.workOrder.findMany({
        where: {
          tenantId,
          OR: [{ checklistDocUrl: { in: urls } }, { supportingDocUrl: { in: urls } }],
        },
        select: { vesselCode: true },
      }));
      break;
    }

    case "wo-scans":
      // El escaneo para autocompletar la OT no se persiste en ninguna tabla:
      // su única vía de acceso es el claim de quien lo subió.
      break;
  }

  return [...codes];
}

/**
 * Autoriza (o rechaza) la descarga de un archivo servido por
 * `/app/files/{kind}/{tenantSlug}/...`.
 *
 * Se responde 404 —y no 403— cuando el archivo no está reclamado por ningún
 * registro accesible: conocer la URL no debe servir ni para confirmar que el
 * documento existe.
 *
 * @param requestedPath  pathname completo del request (`/app/files/...`).
 * @throws RouteError 404 si el usuario no tiene por qué ver ese archivo.
 */
export async function assertFileAccess(
  session: TenantAccessSession,
  kind: FileKind,
  requestedPath: string,
): Promise<void> {
  const storedUrl = toStoredUrl(requestedPath);

  // Quien lo acaba de subir siempre puede verlo, aunque todavía no exista el
  // registro (previsualización antes de guardar).
  if (hasFreshClaim(session, storedUrl)) return;

  const prisma = getPrismaClient();
  if (!prisma) {
    // Dev sin base: no hay registros que consultar. Fail-closed salvo claim.
    throw notFound();
  }

  const tenant = await getCachedTenantBySlug(session.tenantSlug);
  if (!tenant) throw notFound();

  const vesselCodes = await ownerVesselCodes(prisma, tenant.id, kind, storedUrl);
  if (vesselCodes.length === 0) throw notFound();
  if (!vesselCodes.some((code) => canAccessVessel(session, code))) throw notFound();
}

/** Sólo para tests: vacía el registro de archivos recién subidos. */
export function __clearUploadClaims(): void {
  uploadClaims.clear();
}

function notFound(): RouteError {
  return new RouteError(404, "NOT_FOUND", "Archivo no encontrado.");
}
