// Archivo automático de PDFs en el Google Drive de la empresa.
//
// El admin conecta la cuenta de Google de la empresa con un botón (OAuth con
// permiso `drive.file`, ver google-drive-client.ts) y CMS3 sube cada PDF a una
// carpeta propia, ordenada primero por buque y después por tipo: si el documento
// todavía no es final va a "<raíz>/<buque>/<tipo>/Borrador"; cuando queda
// cerrado/aprobado/rechazado/cancelado va a "<raíz>/<buque>/<tipo>/" como
// registro final y se borra la copia de Borrador.
//
// La subida NUNCA rompe el flujo del usuario: corre sin esperar y los errores
// quedan en `pdfArchiveLastError` para que el admin los vea en Configuración.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { log } from "../../common/logger";
import {
  buildAuthUrl,
  ensureFolder,
  exchangeCode,
  folderUrl,
  getAccessToken,
  getAccountEmail,
  googleOAuthConfig,
  revokeToken,
  trashByName,
  uploadPdf,
  type GoogleOAuthConfig,
} from "./google-drive-client";

export const PDF_ARCHIVE_KINDS = ["OT", "SS", "DEF", "FA", "APL", "VAR", "REQ", "MOC", "PLAN", "OTHER"] as const;
export type PdfArchiveKind = (typeof PDF_ARCHIVE_KINDS)[number];
type DocumentKind = Exclude<PdfArchiveKind, "OTHER">;

export const DEFAULT_PDF_ARCHIVE_FOLDERS: Record<PdfArchiveKind, string> = {
  OT: "OT",
  SS: "SS",
  DEF: "DEF",
  FA: "FA",
  APL: "APL",
  VAR: "VAR",
  REQ: "REQ",
  MOC: "MOC",
  PLAN: "Planes de Mantenimiento",
  OTHER: "Otros",
};

/** Carpeta que CMS3 crea en el Drive de la empresa. Con `drive.file` es la única que ve. */
const ROOT_FOLDER_NAME = "CMS3 — Documentos";
const DRAFT_FOLDER = "Borrador";
/** Primer nivel: el buque, por NOMBRE (nunca el código). Ver nombres-no-codigos. */
const FLEET_FOLDER = "General";
/** Ruta del callback de Google: tiene que coincidir con la registrada en Google Cloud. */
export const GOOGLE_CALLBACK_PATH = "/app/tenant/pdf-archive/google/callback";
const STATE_TTL_MS = 10 * 60 * 1000;

/**
 * Cómo encontrar cada documento, de qué buque es y cuándo es final.
 * `finalStatuses: null` = no tiene ciclo cerrado (planes): va siempre directo a
 * su carpeta. `vesselField` da el primer nivel de carpetas.
 */
const DOCUMENTS: Record<DocumentKind, { delegate: string; codeField: string; vesselField: string; finalStatuses: string[] | null }> = {
  OT: { delegate: "workOrder", codeField: "workOrderCode", vesselField: "vesselCode", finalStatuses: ["CLOSED", "CANCELLED"] },
  SS: { delegate: "serviceRequest", codeField: "serviceRequestCode", vesselField: "vesselCode", finalStatuses: ["COMPLETED", "REJECTED", "CANCELLED"] },
  DEF: { delegate: "defect", codeField: "defectCode", vesselField: "vesselCode", finalStatuses: ["CLOSED"] },
  FA: { delegate: "fluidSample", codeField: "sampleCode", vesselField: "vesselCode", finalStatuses: ["REPORTED", "ARCHIVED"] },
  APL: { delegate: "deferral", codeField: "deferralCode", vesselField: "vesselCode", finalStatuses: ["APPROVED", "ACTIVE", "REJECTED", "CLOSED", "EXPIRED"] },
  VAR: { delegate: "drydockSpec", codeField: "specCode", vesselField: "vesselCode", finalStatuses: ["APPROVED", "CANCELLED"] },
  // El pedido de repuestos puede no ser de un buque puntual: ahí va a "General".
  REQ: { delegate: "spareRequest", codeField: "requestCode", vesselField: "requestedForVesselCode", finalStatuses: ["FULFILLED", "REJECTED", "CANCELLED"] },
  MOC: { delegate: "mocRecord", codeField: "mocCode", vesselField: "vesselCode", finalStatuses: ["REVIEWED", "REJECTED", "CANCELLED"] },
  PLAN: { delegate: "maintenancePlan", codeField: "taskCode", vesselField: "vesselCode", finalStatuses: null },
};

/** Estados finales por tipo, para que los services decidan si disparar el archivo. */
export function isFinalStatus(kind: DocumentKind, status: string | null | undefined): boolean {
  const finals = DOCUMENTS[kind].finalStatuses;
  return finals === null || (!!status && finals.includes(status));
}

async function buildPdf(kind: DocumentKind, session: TenantAccessSession, id: string): Promise<Buffer> {
  // Imports diferidos: los services de transición importan este archivo y los
  // generadores de PDF importan esos services — así no se arma un ciclo al cargar.
  switch (kind) {
    case "OT": return (await import("../pms/work-order-pdf-service")).buildWorkOrderPdf(session, id);
    case "SS": return (await import("../pms/service-request-pdf")).buildServiceRequestPdf(session, id);
    case "DEF": return (await import("../pms/defect-pdf-service")).buildDefectPdf(session, id);
    case "FA": return (await import("../fluid-analyses/fluid-analyses-pdf-service")).buildFluidAnalysisPdf(session, id);
    case "APL": return (await import("../pms/deferral-pdf-service")).buildDeferralPdf(session, id);
    case "VAR": return (await import("../pms/drydock-spec-pdf-service")).buildDrydockSpecPdf(session, id);
    case "REQ": return (await import("../pms/spare-request-pdf-service")).buildSpareRequestPdf(session, id);
    case "MOC": return (await import("../moc/moc-pdf-service")).buildMocPdf(session, id);
    case "PLAN": return (await import("../pms/maintenance-plan-pdf-service")).buildMaintenancePlanPdf(session, id);
  }
}

// ── Configuración ────────────────────────────────────────────────────────────

export interface PdfArchiveConfig {
  /** La instalación tiene credenciales de Google cargadas: sin esto no se puede conectar. */
  available: boolean;
  enabled: boolean;
  connected: boolean;
  /** Mail de la cuenta conectada, sólo para mostrarlo. El token nunca sale de la API. */
  account: string | null;
  folderUrl: string | null;
  folders: Record<PdfArchiveKind, string>;
  lastError: string | null;
  lastErrorAt: string | null;
}

function resolveFolders(raw: unknown): Record<PdfArchiveKind, string> {
  const stored = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out = { ...DEFAULT_PDF_ARCHIVE_FOLDERS };
  for (const kind of PDF_ARCHIVE_KINDS) {
    const v = stored[kind];
    if (typeof v === "string" && v.trim()) out[kind] = v.trim();
  }
  return out;
}

async function findTenantIdBySlug(tenantSlug: string): Promise<string | null> {
  const prisma = getPrismaClient();
  if (!prisma) return null;
  const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug }, select: { id: true } });
  return tenant?.id ?? null;
}

async function findTenantId(session: TenantAccessSession): Promise<string | null> {
  return findTenantIdBySlug(session.tenantSlug);
}

async function loadSettings(tenantId: string) {
  const prisma = getPrismaClient()!;
  return prisma.tenantSetting.findUnique({
    where: { tenantId },
    select: {
      pdfArchiveEnabled: true,
      pdfArchiveGoogleRefreshToken: true,
      pdfArchiveGoogleAccount: true,
      pdfArchiveRootFolderId: true,
      pdfArchiveFolderIds: true,
      pdfArchiveFolders: true,
      pdfArchiveLastError: true,
      pdfArchiveLastErrorAt: true,
    },
  });
}

type StoredSettings = Awaited<ReturnType<typeof loadSettings>>;

function toConfig(s: StoredSettings): PdfArchiveConfig {
  return {
    available: !!googleOAuthConfig(),
    enabled: s?.pdfArchiveEnabled ?? false,
    connected: !!s?.pdfArchiveGoogleRefreshToken,
    account: s?.pdfArchiveGoogleAccount ?? null,
    folderUrl: s?.pdfArchiveRootFolderId ? folderUrl(s.pdfArchiveRootFolderId) : null,
    folders: resolveFolders(s?.pdfArchiveFolders),
    lastError: s?.pdfArchiveLastError ?? null,
    lastErrorAt: s?.pdfArchiveLastErrorAt?.toISOString() ?? null,
  };
}

function ensureAdmin(session: TenantAccessSession) {
  if (session.user.role !== "TENANT_ADMIN") {
    throw new RouteError(403, "FORBIDDEN", "Solo administradores pueden configurar el archivo de PDFs.");
  }
}

function requireGoogleConfig(): GoogleOAuthConfig {
  const config = googleOAuthConfig();
  if (!config) {
    throw new RouteError(503, "GOOGLE_NOT_CONFIGURED", "La conexión con Google Drive no está habilitada en este servidor.");
  }
  return config;
}

export async function getPdfArchiveConfig(session: TenantAccessSession): Promise<PdfArchiveConfig> {
  ensureAdmin(session);
  const tenantId = await findTenantId(session);
  if (!tenantId) return toConfig(null);
  return toConfig(await loadSettings(tenantId));
}

export async function setPdfArchiveConfig(
  session: TenantAccessSession,
  body: { enabled?: unknown; folders?: unknown },
): Promise<PdfArchiveConfig> {
  ensureAdmin(session);
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const tenantId = await findTenantId(session);
  if (!tenantId) throw new RouteError(404, "TENANT_NOT_FOUND", "Empresa no encontrada.");

  const current = await loadSettings(tenantId);
  const enabled = body?.enabled === true;
  if (enabled && !current?.pdfArchiveGoogleRefreshToken) {
    throw new RouteError(400, "GOOGLE_NOT_CONNECTED", "Para activar el archivo conectá primero la cuenta de Google Drive.");
  }

  const folders: Record<string, string> = {};
  const input = body?.folders && typeof body.folders === "object" ? (body.folders as Record<string, unknown>) : {};
  for (const kind of PDF_ARCHIVE_KINDS) {
    const v = typeof input[kind] === "string" ? (input[kind] as string).trim() : "";
    if (v.length > 100 || /[\\/]/.test(v)) {
      throw new RouteError(400, "INVALID_FOLDER_NAME", `Nombre de carpeta inválido: "${v}".`);
    }
    folders[kind] = v || DEFAULT_PDF_ARCHIVE_FOLDERS[kind];
  }

  await prisma.tenantSetting.update({
    where: { tenantId },
    data: { pdfArchiveEnabled: enabled, pdfArchiveFolders: folders },
  });
  return toConfig(await loadSettings(tenantId));
}

// ── Conectar la cuenta de Google ─────────────────────────────────────────────

/**
 * `state` firmado: el callback llega desde Google sin sesión (es una navegación
 * del navegador, y las sesiones de CMS3 van por bearer token). La firma es lo
 * que prueba que ese ida y vuelta lo arrancó un admin de esta empresa.
 */
function signState(config: GoogleOAuthConfig, payload: string): string {
  return createHmac("sha256", config.clientSecret).update(payload).digest("hex");
}

function buildState(config: GoogleOAuthConfig, tenantSlug: string, userId: string): string {
  const payload = [tenantSlug, userId, String(Date.now() + STATE_TTL_MS), randomBytes(8).toString("hex")].join("|");
  return `${Buffer.from(payload, "utf8").toString("base64url")}.${signState(config, payload)}`;
}

function readState(config: GoogleOAuthConfig, state: string): { tenantSlug: string } {
  const [encoded, signature] = String(state || "").split(".");
  if (!encoded || !signature) throw new RouteError(400, "INVALID_STATE", "La conexión con Google no se pudo validar.");
  const payload = Buffer.from(encoded, "base64url").toString("utf8");
  const expected = signState(config, payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new RouteError(400, "INVALID_STATE", "La conexión con Google no se pudo validar.");
  }
  const [tenantSlug, , expiresAt] = payload.split("|");
  if (!tenantSlug || Number(expiresAt) < Date.now()) {
    throw new RouteError(400, "EXPIRED_STATE", "La conexión con Google tardó demasiado. Probá de nuevo.");
  }
  return { tenantSlug };
}

function redirectUriFor(origin: string): string {
  return `${origin.replace(/\/+$/, "")}${GOOGLE_CALLBACK_PATH}`;
}

/** Devuelve la URL de Google a la que mandamos al admin para que elija su cuenta. */
export async function startGoogleConnect(session: TenantAccessSession, origin: string): Promise<{ url: string }> {
  ensureAdmin(session);
  const config = requireGoogleConfig();
  const tenantId = await findTenantId(session);
  if (!tenantId) throw new RouteError(404, "TENANT_NOT_FOUND", "Empresa no encontrada.");
  const state = buildState(config, session.tenantSlug, session.user.id);
  return { url: buildAuthUrl(config, redirectUriFor(origin), state) };
}

/**
 * Vuelta de Google. Guarda el permiso permanente y deja creada la carpeta raíz.
 * Devuelve a dónde mandar el navegador (Configuración, con el resultado).
 */
export async function completeGoogleConnect(
  origin: string,
  query: { code?: string | null; state?: string | null; error?: string | null },
): Promise<string> {
  const config = requireGoogleConfig();
  const done = (result: string) => `/configuracion?drive=${result}`;
  if (query.error) return done("cancelado");

  try {
    const { tenantSlug } = readState(config, String(query.state ?? ""));
    const code = String(query.code ?? "");
    if (!code) return done("error");

    const prisma = getPrismaClient();
    const tenantId = prisma ? await findTenantIdBySlug(tenantSlug) : null;
    if (!tenantId) return done("error");

    const { refreshToken, accessToken } = await exchangeCode(config, code, redirectUriFor(origin));
    const account = await getAccountEmail(accessToken);
    const rootFolderId = await ensureFolder(accessToken, ROOT_FOLDER_NAME, null);

    await prisma!.tenantSetting.update({
      where: { tenantId },
      data: {
        pdfArchiveGoogleRefreshToken: refreshToken,
        pdfArchiveGoogleAccount: account,
        pdfArchiveRootFolderId: rootFolderId,
        // Las carpetas por tipo se rearman solas en la primera subida.
        pdfArchiveFolderIds: {},
        pdfArchiveLastError: null,
        pdfArchiveLastErrorAt: null,
      },
    });
    return done("ok");
  } catch (err) {
    log.warn("[pdf-archive] connect failed", errorMessage(err));
    return done("error");
  }
}

export async function disconnectGoogle(session: TenantAccessSession): Promise<PdfArchiveConfig> {
  ensureAdmin(session);
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const tenantId = await findTenantId(session);
  if (!tenantId) throw new RouteError(404, "TENANT_NOT_FOUND", "Empresa no encontrada.");

  const current = await loadSettings(tenantId);
  if (current?.pdfArchiveGoogleRefreshToken) {
    // Si Google ya no lo conoce (permiso revocado a mano), igual limpiamos acá.
    try { await revokeToken(current.pdfArchiveGoogleRefreshToken); }
    catch (err) { log.warn("[pdf-archive] revoke failed", errorMessage(err)); }
  }
  await prisma.tenantSetting.update({
    where: { tenantId },
    data: {
      pdfArchiveEnabled: false,
      pdfArchiveGoogleRefreshToken: null,
      pdfArchiveGoogleAccount: null,
      pdfArchiveRootFolderId: null,
      pdfArchiveFolderIds: {},
      pdfArchiveLastError: null,
      pdfArchiveLastErrorAt: null,
    },
  });
  return toConfig(await loadSettings(tenantId));
}

/** "Probar conexión": pide un permiso de acceso y se asegura de que la carpeta esté. */
export async function testPdfArchive(session: TenantAccessSession): Promise<{ ok: true }> {
  ensureAdmin(session);
  const config = requireGoogleConfig();
  const tenantId = await findTenantId(session);
  const s = tenantId ? await loadSettings(tenantId) : null;
  if (!s?.pdfArchiveGoogleRefreshToken) {
    throw new RouteError(400, "NOT_CONFIGURED", "Primero conectá la cuenta de Google Drive.");
  }
  try {
    const accessToken = await getAccessToken(config, s.pdfArchiveGoogleRefreshToken);
    const rootFolderId = await ensureFolder(accessToken, ROOT_FOLDER_NAME, null);
    await getPrismaClient()!.tenantSetting.update({
      where: { tenantId: tenantId! },
      data: { pdfArchiveRootFolderId: rootFolderId, pdfArchiveLastError: null, pdfArchiveLastErrorAt: null },
    });
  } catch (err) {
    throw new RouteError(502, "DRIVE_ERROR", `Google Drive no respondió bien: ${errorMessage(err)}`);
  }
  return { ok: true };
}

// ── Subida ───────────────────────────────────────────────────────────────────

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function readFolderIds(raw: unknown): Record<string, string> {
  const stored = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(stored)) {
    if (typeof value === "string" && value) out[key] = value;
  }
  return out;
}

/**
 * Id de una carpeta bajo la raíz, creándola si hace falta. El cache
 * (`pdfArchiveFolderIds`) evita una búsqueda en Drive por cada PDF; si alguien
 * borra la carpeta en Drive, Drive avisa y el error queda en Configuración.
 */
async function resolveFolderId(
  accessToken: string,
  rootFolderId: string,
  cache: Record<string, string>,
  segments: string[],
): Promise<string> {
  let parentId = rootFolderId;
  let path = "";
  for (const segment of segments) {
    path = path ? `${path}/${segment}` : segment;
    const cached = cache[path];
    if (cached) { parentId = cached; continue; }
    parentId = await ensureFolder(accessToken, segment, parentId);
    cache[path] = parentId;
  }
  return parentId;
}

// Dos subidas del mismo archivo (generar el PDF y cerrar enseguida) se encolan:
// si el borrador llegara después del final, quedaría una copia vieja en Borrador.
const queues = new Map<string, Promise<void>>();

function enqueue(key: string, job: () => Promise<void>): Promise<void> {
  const previous = queues.get(key) ?? Promise.resolve();
  const result = previous.then(job);
  // La cola guarda una versión que nunca rechaza: si no, un error de subida
  // quedaría como rechazo sin manejar y tumbaría el proceso de la API.
  const settled = result.catch(() => undefined);
  queues.set(key, settled);
  void settled.then(() => { if (queues.get(key) === settled) queues.delete(key); });
  return result;
}

export type ArchivePdfInput =
  | { kind: DocumentKind; id: string; buffer?: Buffer }
  // `vesselCode`: el buque bajo el que se archiva; sin él va a "General".
  // `from`: datos a buscar en el propio registro — `codeField` cuando el nombre
  // de descarga usa el id interno y en Drive se prefiere el número de documento,
  // `vesselField` cuando el que llama no tiene el buque a mano.
  | {
      kind: "OTHER";
      fileName: string;
      buffer: Buffer;
      vesselCode?: string | null;
      from?: { delegate: string; id: string; codeField?: string; vesselField?: string };
    };

/**
 * Nombre de la carpeta del buque. Siempre el NOMBRE ("DON CHICUETO"), no el
 * código: es lo que la gente reconoce al abrir el Drive.
 */
async function resolveVesselFolder(tenantId: string, vesselCode: string | null | undefined): Promise<string> {
  const code = (vesselCode ?? "").trim();
  if (!code) return FLEET_FOLDER;
  const vessel = await getPrismaClient()!.vessel.findFirst({
    where: { tenantId, code },
    select: { name: true },
  });
  const name = (vessel?.name ?? "").trim() || code;
  return name.replace(/[\\/]/g, "-").slice(0, 100);
}

/**
 * Manda el PDF al Drive de la empresa si el archivo está activo. Nunca tira:
 * se llama con `void` desde los endpoints de PDF y desde las transiciones.
 */
export async function archivePdf(session: TenantAccessSession, input: ArchivePdfInput): Promise<void> {
  let tenantId: string | null = null;
  try {
    const googleConfig = googleOAuthConfig();
    if (!googleConfig) return;
    tenantId = await findTenantId(session);
    if (!tenantId) return;
    const settings = await loadSettings(tenantId);
    if (!settings?.pdfArchiveEnabled || !settings.pdfArchiveGoogleRefreshToken) return;
    const refreshToken = settings.pdfArchiveGoogleRefreshToken;
    const folders = resolveFolders(settings.pdfArchiveFolders);

    let fileName: string;
    let final: boolean;
    let vesselCode: string | null | undefined;
    let buffer = input.buffer;

    if (input.kind === "OTHER") {
      fileName = input.fileName;
      final = true;
      vesselCode = input.vesselCode;
      if (input.from) {
        const select: Record<string, boolean> = {};
        if (input.from.codeField) select[input.from.codeField] = true;
        if (input.from.vesselField) select[input.from.vesselField] = true;
        if (Object.keys(select).length) {
          const row = await (getPrismaClient() as any)[input.from.delegate].findFirst({
            where: { id: input.from.id, tenantId },
            select,
          }) as Record<string, string | null> | null;
          if (!row) return;
          const code = input.from.codeField ? row[input.from.codeField] : null;
          if (code) fileName = `${code}.pdf`;
          if (input.from.vesselField) vesselCode = row[input.from.vesselField] ?? vesselCode;
        }
      }
    } else {
      const doc = DOCUMENTS[input.kind];
      // Filtro por tenant: el id viene de la URL o del service, nunca se confía solo en él.
      const row = await (getPrismaClient() as any)[doc.delegate].findFirst({
        where: { id: input.id, tenantId, deletedAt: null },
        select: { [doc.codeField]: true, [doc.vesselField]: true, status: true },
      }) as Record<string, string> | null;
      if (!row) return;
      fileName = `${row[doc.codeField]}.pdf`;
      vesselCode = row[doc.vesselField];
      final = isFinalStatus(input.kind, row.status);
      if (!buffer) buffer = await buildPdf(input.kind, session, input.id);
    }

    const safeName = fileName.replace(/[\\/:*?"<>|]/g, "_");
    const content = buffer!;
    // Primero el buque, después el tipo: "<raíz>/DON CHICUETO/OT/…".
    const vesselFolder = await resolveVesselFolder(tenantId, vesselCode);
    const folderName = folders[input.kind];
    const typePath = `${vesselFolder}/${folderName}`;
    const cache = readFolderIds(settings.pdfArchiveFolderIds);
    const cacheBefore = JSON.stringify(cache);

    await enqueue(`${tenantId}:${input.kind}:${safeName}`, async () => {
      const accessToken = await getAccessToken(googleConfig, refreshToken);
      const rootFolderId = settings.pdfArchiveRootFolderId
        ?? await ensureFolder(accessToken, ROOT_FOLDER_NAME, null);
      const segments = final ? [vesselFolder, folderName] : [vesselFolder, folderName, DRAFT_FOLDER];
      const targetId = await resolveFolderId(accessToken, rootFolderId, cache, segments);

      await trashByName(accessToken, targetId, safeName);
      await uploadPdf(accessToken, targetId, safeName, content);

      // Quedó el registro final: el borrador ya no hace falta. Sólo si la
      // carpeta Borrador existe (no la creamos para borrar algo que no está).
      const draftId = final ? cache[`${typePath}/${DRAFT_FOLDER}`] : null;
      if (draftId) await trashByName(accessToken, draftId, safeName);

      if (JSON.stringify(cache) !== cacheBefore || rootFolderId !== settings.pdfArchiveRootFolderId) {
        await getPrismaClient()!.tenantSetting.update({
          where: { tenantId: tenantId! },
          data: { pdfArchiveFolderIds: cache, pdfArchiveRootFolderId: rootFolderId },
        });
      }
    });
    // Anduvo: el aviso de error viejo ya no describe el estado actual.
    if (settings.pdfArchiveLastError) {
      await getPrismaClient()!.tenantSetting.update({
        where: { tenantId },
        data: { pdfArchiveLastError: null, pdfArchiveLastErrorAt: null },
      });
    }
  } catch (err) {
    const message = errorMessage(err).slice(0, 500);
    log.warn("[pdf-archive] upload failed", session.tenantSlug, input.kind, message);
    if (!tenantId) return;
    try {
      await getPrismaClient()!.tenantSetting.update({
        where: { tenantId },
        data: { pdfArchiveLastError: `${input.kind}: ${message}`, pdfArchiveLastErrorAt: new Date() },
      });
    } catch { /* si ni esto se puede guardar, queda el log */ }
  }
}

/** Atajo para las transiciones: sólo archiva si el nuevo estado es final. */
export function archiveIfFinal(session: TenantAccessSession, kind: DocumentKind, id: string, status: string | null | undefined): void {
  if (isFinalStatus(kind, status)) void archivePdf(session, { kind, id });
}
