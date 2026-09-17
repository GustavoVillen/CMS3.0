// Archivo automático de PDFs en Google Drive.
//
// La empresa publica un Apps Script con SU cuenta de Google (docs/drive-archive/)
// y carga acá la URL y la clave. Cada vez que se genera un PDF se manda al
// script: si el documento todavía no es final va a "<carpeta>/Borrador"; cuando
// queda cerrado/aprobado/rechazado/cancelado va a "<carpeta>/" como registro
// final y el script borra la copia de Borrador.
//
// Mismo patrón de config que `weekly-report-config-service.ts`. La subida NUNCA
// rompe el flujo del usuario: corre sin esperar y los errores quedan en
// `pdfArchiveLastError` para que el admin los vea en Configuración.

import { randomBytes } from "node:crypto";
import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { log } from "../../common/logger";

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

/**
 * Cómo encontrar cada documento y cuándo es final. `finalStatuses: null` =
 * no tiene ciclo cerrado (planes): va siempre directo a su carpeta.
 */
const DOCUMENTS: Record<DocumentKind, { delegate: string; codeField: string; finalStatuses: string[] | null }> = {
  OT: { delegate: "workOrder", codeField: "workOrderCode", finalStatuses: ["CLOSED", "CANCELLED"] },
  SS: { delegate: "serviceRequest", codeField: "serviceRequestCode", finalStatuses: ["COMPLETED", "REJECTED", "CANCELLED"] },
  DEF: { delegate: "defect", codeField: "defectCode", finalStatuses: ["CLOSED"] },
  FA: { delegate: "fluidSample", codeField: "sampleCode", finalStatuses: ["REPORTED", "ARCHIVED"] },
  APL: { delegate: "deferral", codeField: "deferralCode", finalStatuses: ["APPROVED", "ACTIVE", "REJECTED", "CLOSED", "EXPIRED"] },
  VAR: { delegate: "drydockSpec", codeField: "specCode", finalStatuses: ["APPROVED", "CANCELLED"] },
  REQ: { delegate: "spareRequest", codeField: "requestCode", finalStatuses: ["FULFILLED", "REJECTED", "CANCELLED"] },
  MOC: { delegate: "mocRecord", codeField: "mocCode", finalStatuses: ["REVIEWED", "REJECTED", "CANCELLED"] },
  PLAN: { delegate: "maintenancePlan", codeField: "taskCode", finalStatuses: null },
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
  enabled: boolean;
  scriptUrl: string;
  secret: string;
  folders: Record<PdfArchiveKind, string>;
  lastError: string | null;
  lastErrorAt: string | null;
}

// Sólo URLs de Apps Script publicados: además de validar lo que carga el admin,
// evita que el servidor termine haciendo POST a cualquier dirección.
const SCRIPT_URL_RE = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/;

function resolveFolders(raw: unknown): Record<PdfArchiveKind, string> {
  const stored = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out = { ...DEFAULT_PDF_ARCHIVE_FOLDERS };
  for (const kind of PDF_ARCHIVE_KINDS) {
    const v = stored[kind];
    if (typeof v === "string" && v.trim()) out[kind] = v.trim();
  }
  return out;
}

async function findTenantId(session: TenantAccessSession): Promise<string | null> {
  const prisma = getPrismaClient();
  if (!prisma) return null;
  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug }, select: { id: true } });
  return tenant?.id ?? null;
}

async function loadSettings(tenantId: string) {
  const prisma = getPrismaClient()!;
  return prisma.tenantSetting.findUnique({
    where: { tenantId },
    select: {
      pdfArchiveEnabled: true,
      pdfArchiveScriptUrl: true,
      pdfArchiveSecret: true,
      pdfArchiveFolders: true,
      pdfArchiveLastError: true,
      pdfArchiveLastErrorAt: true,
    },
  });
}

function toConfig(s: Awaited<ReturnType<typeof loadSettings>>): PdfArchiveConfig {
  return {
    enabled: s?.pdfArchiveEnabled ?? false,
    scriptUrl: s?.pdfArchiveScriptUrl ?? "",
    secret: s?.pdfArchiveSecret ?? "",
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

/** Incluye la clave: la ruta es sólo para TENANT_ADMIN, que la necesita para pegarla en el script. */
export async function getPdfArchiveConfig(session: TenantAccessSession): Promise<PdfArchiveConfig> {
  ensureAdmin(session);
  const tenantId = await findTenantId(session);
  if (!tenantId) return toConfig(null);
  return toConfig(await loadSettings(tenantId));
}

export async function setPdfArchiveConfig(
  session: TenantAccessSession,
  body: { enabled?: unknown; scriptUrl?: unknown; folders?: unknown; regenerateSecret?: unknown },
): Promise<PdfArchiveConfig> {
  ensureAdmin(session);
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const tenantId = await findTenantId(session);
  if (!tenantId) throw new RouteError(404, "TENANT_NOT_FOUND", "Empresa no encontrada.");

  const enabled = body?.enabled === true;
  const scriptUrl = typeof body?.scriptUrl === "string" ? body.scriptUrl.trim() : "";
  if (scriptUrl && !SCRIPT_URL_RE.test(scriptUrl)) {
    throw new RouteError(400, "INVALID_SCRIPT_URL", "La URL tiene que ser la del script publicado (https://script.google.com/macros/s/…/exec).");
  }
  if (enabled && !scriptUrl) {
    throw new RouteError(400, "SCRIPT_URL_REQUIRED", "Para activar el archivo cargá la URL del script.");
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

  const current = await loadSettings(tenantId);
  const secret = body?.regenerateSecret === true || !current?.pdfArchiveSecret
    ? randomBytes(24).toString("hex")
    : current.pdfArchiveSecret;

  await prisma.tenantSetting.update({
    where: { tenantId },
    data: {
      pdfArchiveEnabled: enabled,
      pdfArchiveScriptUrl: scriptUrl || null,
      pdfArchiveSecret: secret,
      pdfArchiveFolders: folders,
    },
  });
  return toConfig(await loadSettings(tenantId));
}

/** "Probar conexión": el script contesta sin tocar Drive si la clave es correcta. */
export async function testPdfArchive(session: TenantAccessSession): Promise<{ ok: true }> {
  ensureAdmin(session);
  const tenantId = await findTenantId(session);
  const s = tenantId ? await loadSettings(tenantId) : null;
  if (!s?.pdfArchiveScriptUrl || !s.pdfArchiveSecret) {
    throw new RouteError(400, "NOT_CONFIGURED", "Primero guardá la URL del script.");
  }
  try {
    await callScript(s.pdfArchiveScriptUrl, { action: "ping", secret: s.pdfArchiveSecret });
  } catch (err) {
    throw new RouteError(502, "SCRIPT_ERROR", `El script no respondió bien: ${errorMessage(err)}`);
  }
  await getPrismaClient()!.tenantSetting.update({
    where: { tenantId: tenantId! },
    data: { pdfArchiveLastError: null, pdfArchiveLastErrorAt: null },
  });
  return { ok: true };
}

// ── Subida ───────────────────────────────────────────────────────────────────

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function callScript(url: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  // Apps Script ejecuta el POST y responde con un redirect a la salida: fetch lo sigue.
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // Típico: el script no está publicado para "Cualquier persona" y Google devuelve una página de login.
    throw new Error(`respuesta inesperada (HTTP ${res.status}). Revisá que el script esté publicado con acceso "Cualquier persona".`);
  }
  if (data.ok !== true) throw new Error(String(data.error ?? "error desconocido"));
  return data;
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
  // `codeFrom`: cuando el nombre de descarga usa el id interno, en Drive se
  // prefiere el número de documento (si el registro lo tiene cargado).
  | { kind: "OTHER"; fileName: string; buffer: Buffer; codeFrom?: { delegate: string; codeField: string; id: string } };

/**
 * Manda el PDF al Drive de la empresa si el archivo está activo. Nunca tira:
 * se llama con `void` desde los endpoints de PDF y desde las transiciones.
 */
export async function archivePdf(session: TenantAccessSession, input: ArchivePdfInput): Promise<void> {
  let tenantId: string | null = null;
  try {
    tenantId = await findTenantId(session);
    if (!tenantId) return;
    const settings = await loadSettings(tenantId);
    if (!settings?.pdfArchiveEnabled || !settings.pdfArchiveScriptUrl || !settings.pdfArchiveSecret) return;
    const folders = resolveFolders(settings.pdfArchiveFolders);
    const scriptUrl = settings.pdfArchiveScriptUrl;
    const secret = settings.pdfArchiveSecret;

    let fileName: string;
    let final: boolean;
    let buffer = input.buffer;

    if (input.kind === "OTHER") {
      fileName = input.fileName;
      final = true;
      if (input.codeFrom) {
        const row = await (getPrismaClient() as any)[input.codeFrom.delegate].findFirst({
          where: { id: input.codeFrom.id, tenantId },
          select: { [input.codeFrom.codeField]: true },
        }) as Record<string, string | null> | null;
        if (!row) return;
        const code = row[input.codeFrom.codeField];
        if (code) fileName = `${code}.pdf`;
      }
    } else {
      const doc = DOCUMENTS[input.kind];
      // Filtro por tenant: el id viene de la URL o del service, nunca se confía solo en él.
      const row = await (getPrismaClient() as any)[doc.delegate].findFirst({
        where: { id: input.id, tenantId, deletedAt: null },
        select: { [doc.codeField]: true, status: true },
      }) as Record<string, string> | null;
      if (!row) return;
      fileName = `${row[doc.codeField]}.pdf`;
      final = isFinalStatus(input.kind, row.status);
      if (!buffer) buffer = await buildPdf(input.kind, session, input.id);
    }

    const safeName = fileName.replace(/[\\/:*?"<>|]/g, "_");
    const content = buffer!.toString("base64");
    await enqueue(`${tenantId}:${input.kind}:${safeName}`, async () => {
      await callScript(scriptUrl, {
        action: "upload",
        secret,
        folder: folders[input.kind],
        final,
        fileName: safeName,
        base64: content,
      });
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
