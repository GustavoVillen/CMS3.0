// RESPALDO SEMANAL EN EXCEL al Google Drive de la empresa.
//
// Para qué: si algún día la empresa deja de usar CMS3, tiene que poder quedarse
// con sus datos en algo que cualquiera abre y entiende. Por eso son planillas
// PARA LEER — nombres de buque y de equipo, estados en español, fechas de
// calendario — y no un volcado de la base (ids, códigos internos, inglés). El
// respaldo técnico de la base es otro y vive fuera de la app (cms3-backup.sh).
//
// Qué sube, una vez por semana (domingo 05:00 en la hora de la empresa):
//
//   CMS3 — Documentos/Respaldo semanal en Excel/<AAAA-MM-DD>/
//     01 Órdenes de Trabajo (OT).xlsx
//     02 Solicitudes de Servicio (SS).xlsx
//     03 Defectos.xlsx
//     04 Equipos.xlsx
//     05 Repuestos.xlsx
//     06 Proveedores.xlsx
//     07 Plan de Mantenimiento.xlsx
//     08 Planillas a bordo/Planilla a bordo - <BUQUE>.xlsx   (una por buque)
//     LEEME.txt
//
// Se guardan las últimas KEEP_WEEKS semanas; las anteriores van a la papelera
// de Drive (que las guarda 30 días más).
//
// Usa la MISMA conexión que el archivo de PDFs (Configuración → Google Drive):
// si la empresa no la conectó o la apagó, no se sube nada.
//
// "Ya se hizo esta semana" se decide mirando el Drive, no la base: LEEME.txt
// se sube último, así que una carpeta sin él es una corrida que se cortó y se
// rehace (cada archivo pisa al anterior del mismo nombre). Si el servidor estuvo
// caído el domingo, el respaldo sale cuando vuelve.
//
// Aislamiento: cada consulta filtra por el tenantId de la empresa que se está
// respaldando; nada cruza de una empresa a otra.

import ExcelJS from "exceljs";
import { readFile } from "node:fs/promises";
import { join, normalize, sep } from "node:path";
import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { resolveTenantTime } from "../../common/tenant-time";
import { log } from "../../common/logger";
import { getOnHandMap } from "../pms/stock-calc-service";
import { listTenantMaintenancePlans } from "../maintenance-plans/maintenance-plans-service";
import { listTenantAssets } from "../assets/assets-service";
import { localNow } from "../reports/weekly-fleet-report-service";
import { getTenantDriveRoot, recordArchiveError } from "../settings/pdf-archive-service";
import { ensureFolder, listFileNames, listFolders, trashById, trashByName, uploadFile } from "../settings/google-drive-client";
// La planilla a bordo sale del MISMO armado que el botón de la app (el archivo
// vive en el frontend y no usa nada del navegador): así no pueden diferir.
import { buildMaintenanceSheet, type SheetLogo } from "../../../../web-modern/src/lib/maintenance-sheet-xlsx";
import type { SheetPlan, AssetInfo } from "../../../../web-modern/src/lib/maintenance-sheet-model";

const BACKUP_FOLDER = "Respaldo semanal en Excel";
const ONBOARD_FOLDER = "08 Planillas a bordo";
const DONE_MARKER = "LEEME.txt";
const KEEP_WEEKS = 4;
/** Domingo a esta hora (hora de la empresa) arranca el respaldo de la semana. */
const RUN_WEEKDAY = 7;
const RUN_HOUR = 5;
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// ── Etiquetas ────────────────────────────────────────────────────────────────
// Las mismas palabras que usa la app en pantalla (diccionario es de i18n.tsx).

const WO_TYPE: Record<string, string> = {
  PREVENTIVE: "Preventivo", CORRECTIVE: "Correctivo", INSPECTION: "Inspección",
};
const WO_STATUS: Record<string, string> = {
  PLANNED: "Planificada", IN_PROGRESS: "En progreso", ON_HOLD: "En espera",
  DEFERRED: "Diferida", CLOSED: "Cerrada", CANCELLED: "Cancelada",
};
const PRIORITY: Record<string, string> = { LOW: "Baja", MEDIUM: "Media", HIGH: "Alta", CRITICAL: "Crítica" };
const DEPARTMENT: Record<string, string> = {
  CUBIERTA: "Cubierta", MAQUINAS: "Máquinas", BARCAZA: "Barcaza", PROVEEDOR: "Proveedor", OTROS: "Otros",
};
const MAINT_KIND: Record<string, string> = {
  PREVENTIVO: "Preventivo", CORRECTIVO_PROGRAMADO: "Correctivo programado",
  CORRECTIVO_NO_PROGRAMADO: "Correctivo no programado", PREDICTIVO: "Predictivo", EMERGENCIA: "Emergencia",
};
const OPERATING_CONDITION: Record<string, string> = {
  NAVEGACION: "Navegación", PUERTO: "Puerto", FONDEADO: "Fondeado", DIQUE: "Dique",
};
const SS_STATUS: Record<string, string> = {
  DRAFT: "En preparación", SOLICITADA: "Pendiente de aprobación", APROBADA: "Pendiente de autorización",
  AUTORIZADA: "Autorizada", IN_PROGRESS: "En el taller", COMPLETED: "Completada",
  REJECTED: "Rechazada", CANCELLED: "Cancelada",
};
const DEFECT_STATUS: Record<string, string> = {
  OPEN: "Abierto", UNDER_REVIEW: "En revisión", IN_PROGRESS: "En progreso",
  DEFERRED: "Diferido", RESOLVED: "Resuelto", CLOSED: "Cerrado",
};
const OP_STATE: Record<string, string> = {
  NORMAL: "Normal", DEGRADED: "Degradado", RESTRICTED: "Restringido", NO_GO: "No operar",
};
// Mismas palabras que el PDF del defecto (pms/defect-pdf-service.ts).
const DEFECT_CLASSIFICATION: Record<string, string> = {
  WORK_ORDER_FINDING: "Hallazgo en OT",
  INSPECTION_FINDING: "Hallazgo en inspección",
  PREDICTIVE_FLUID_ANALYSIS: "Análisis de fluidos",
  EXTERNAL_AUDIT_FINDING: "Deficiencia de auditoría externa",
};
const RCA_METHOD: Record<string, string> = {
  FIVE_WHYS: "5 Porqués", FISHBONE: "Ishikawa (Espina de pescado)", FTA: "Árbol de fallas (FTA)", BARRIER_ANALYSIS: "Análisis de barreras",
};
const ASSET_STATUS: Record<string, string> = {
  OPERATIONAL: "Operativo", DEGRADED: "Degradado", OUT_OF_SERVICE: "Fuera de servicio",
};
const ACTIVE_STATUS: Record<string, string> = { ACTIVE: "Activo", INACTIVE: "Inactivo", OBSOLETE: "Obsoleto" };
const PLAN_STATUS: Record<string, string> = {
  ACTIVE: "Activo", DUE_SOON: "Activo", OVERDUE: "Activo", INACTIVE: "Inactivo",
};
const EXEC_STATUS: Record<string, string> = {
  FUTURE: "Al día", UPCOMING: "Próximo", IN_WINDOW: "En ventana (OT abierta)",
  DUE: "Por vencer", OVERDUE: "Vencido", COMPLETED: "Completado",
};
const TASK_TYPE: Record<string, string> = { MAINTENANCE: "Mantenimiento", INSPECTION: "Inspección" };
const CRITERIA_SOURCE: Record<string, string> = {
  CLASS_REQUIREMENT: "Requisito de Clase", STATUTORY: "Estatutario / Bandera",
  MAKER_MANUAL: "Manual del fabricante", COMPANY_STANDARD: "Estándar de la Compañía",
  ENGINEERING_CRITERION: "Criterio de ingeniería",
};
const SAMPLE_KIND: Record<string, string> = {
  FLUID: "Fluido", VIBRATION: "Vibraciones", THERMAL: "Termografía", ULTRASOUND: "Ultrasonido", OTHER: "Otro",
};

function label(map: Record<string, string>, v: unknown): string | null {
  if (v == null || v === "") return null;
  return map[String(v)] ?? String(v);
}

function yesNo(v: unknown): string | null {
  if (v == null) return null;
  return v ? "Sí" : "No";
}

function frequency(triggerType: string, hours: number | null, months: number | null): string | null {
  if (triggerType === "HOURS" || triggerType === "RUNNING_HOURS") {
    return hours != null ? `${hours.toLocaleString("es-AR")} horas` : null;
  }
  // DAY y WEEK guardan su valor en frequencyMonths (igual que la planilla a bordo).
  if (months == null) {
    if (triggerType === "CONDITION") return "Según condición";
    if (triggerType === "EVENT") return "Por evento";
    return null;
  }
  if (triggerType === "DAY") return months === 1 ? "1 día" : `${months} días`;
  if (triggerType === "WEEK") return months === 1 ? "1 semana" : `${months} semanas`;
  return months === 1 ? "1 mes" : `${months} meses`;
}

// ── Planilla genérica ────────────────────────────────────────────────────────

type Cell = string | number | Date | null | undefined;

interface Col<T> {
  header: string;
  width: number;
  /** "long": texto largo, parte en varias líneas. "date": fecha dd/mm/aaaa. */
  kind?: "long" | "date" | "number";
  value: (row: T) => Cell;
}

/**
 * Fecha para una celda de Excel (fecha real, se puede ordenar y filtrar).
 * Mismo criterio que common/tenant-time.ts: medianoche UTC = fecha de calendario
 * y queda como está; un sello de tiempo se pasa al día de la hora de la empresa.
 */
function dateCell(v: unknown, tz: string): Date | null {
  if (!v) return null;
  const d = new Date(v as string);
  if (Number.isNaN(d.getTime())) return null;
  const dateOnly = d.getUTCHours() === 0 && d.getUTCMinutes() === 0
    && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
  if (dateOnly) return d;
  try {
    const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
    return new Date(`${ymd}T00:00:00Z`);
  } catch {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
}

/**
 * Excel evalúa como fórmula lo que empieza con = + - @ (CWE-1236). Mismo
 * resguardo que excel-export-service.ts: un apóstrofo lo deja como texto.
 */
function safeText(s: string): string {
  const c = s.charCodeAt(0);
  return c === 0x3D || c === 0x2B || c === 0x2D || c === 0x40 || c === 0x09 || c === 0x0D ? `'${s}` : s;
}

async function buildSheet<T>(title: string, cols: Col<T>[], rows: T[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "CMS3.0";
  wb.created = new Date();
  const ws = wb.addWorksheet(title.slice(0, 31), { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = cols.map((c, i) => ({ key: `c${i}`, header: c.header, width: c.width }));

  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3864" } };
  header.alignment = { vertical: "middle", wrapText: true };
  header.height = 30;

  for (const r of rows) {
    const values: Record<string, Cell> = {};
    cols.forEach((c, i) => {
      const v = c.value(r);
      values[`c${i}`] = typeof v === "string" ? (v.trim() ? safeText(v.trim()) : null) : v ?? null;
    });
    ws.addRow(values);
  }

  cols.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    if (c.kind === "date") col.numFmt = "dd/mm/yyyy";
    if (c.kind === "long") col.alignment = { wrapText: true, vertical: "top" };
    else col.alignment = { vertical: "top" };
  });
  ws.getRow(1).alignment = { vertical: "middle", wrapText: true };
  if (rows.length > 0) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: rows.length + 1, column: cols.length } };

  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ── Datos ────────────────────────────────────────────────────────────────────

/**
 * Sesión sintética del job (mismo criterio que el parte semanal de flota): rol
 * TENANT_ADMIN para ver la flota completa. No es un token, no se registra en el
 * session-store y no llega a ninguna ruta HTTP.
 */
function systemSession(tenantSlug: string): TenantAccessSession {
  return {
    kind: "tenant",
    tenantSlug,
    accessToken: "system-excel-backup",
    refreshToken: "system-excel-backup",
    accessTokenExpiresAt: new Date(0).toISOString(),
    user: {
      id: "system", email: "system@local", firstName: "Sistema", lastName: null,
      role: "TENANT_ADMIN", assignedVesselCodes: [], locale: "es", permissions: [],
    },
  } as TenantAccessSession;
}

export interface OutFile {
  /** Subcarpeta dentro de la carpeta de la semana; null = en la raíz de la semana. */
  folder: string | null;
  name: string;
  content: Buffer;
  rows: number;
}

function joinNames(list: Array<string | null | undefined>): string | null {
  const clean = [...new Set(list.map(s => (s ?? "").trim()).filter(Boolean))];
  return clean.length ? clean.join(", ") : null;
}

/** Nombre apto para un archivo de Drive (el buque puede traer "/" o comillas). */
function fileSafe(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, "-").trim().slice(0, 100);
}

/**
 * Logo del armador para la banda de la planilla a bordo. En la app es una ruta
 * del frontend (/mercurio-logo.png): se lee del disco. Si no está, la planilla
 * sale igual, sin logo — mismo criterio que el botón.
 */
async function loadLogo(logoUrl: string | null | undefined): Promise<SheetLogo | null> {
  const url = (logoUrl ?? "").trim();
  if (!url.startsWith("/") || url.includes("..")) return null;
  const webRoot = normalize(join(process.cwd(), "..", "web-modern"));
  let buf: Buffer | null = null;
  for (const dir of ["dist", "public"]) {
    const base = join(webRoot, dir);
    const full = normalize(join(base, url));
    if (!full.startsWith(base + sep)) continue;
    try { buf = await readFile(full); break; } catch { /* probar el siguiente */ }
  }
  if (!buf) return null;
  // Proporción del logo para no deformarlo. PNG: ancho/alto en el encabezado IHDR.
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    return { base64: `data:image/png;base64,${buf.toString("base64")}`, extension: "png", ratio: h ? w / h : 3 };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    return { base64: `data:image/jpeg;base64,${buf.toString("base64")}`, extension: "jpeg", ratio: 3 };
  }
  return null;
}

export async function buildTenantExcelFiles(tenantId: string, tenantSlug: string): Promise<OutFile[]> {
  const prisma = getPrismaClient() as any;
  const { tz } = await resolveTenantTime(tenantSlug);
  const d = (v: unknown) => dateCell(v, tz);
  const notDeleted = { tenantId, deletedAt: null };

  const [vessels, assets, providers, settings] = await Promise.all([
    prisma.vessel.findMany({ where: { tenantId }, select: { code: true, name: true } }),
    prisma.asset.findMany({
      where: notDeleted,
      select: {
        id: true, vesselCode: true, assetCode: true, sfiCode: true, name: true, criticality: true, status: true,
        manufacturer: true, model: true, serialNumber: true, installationDate: true, lastOverhaulDate: true,
        replacementDate: true, criticalityRationale: true, isSafetyCritical: true, planNotRequired: true,
        planNotRequiredReason: true, isStandby: true, parentAssetId: true,
      },
    }),
    prisma.provider.findMany({ where: notDeleted }),
    prisma.tenantSetting.findUnique({ where: { tenantId }, select: { logoUrl: true, logoUrlLight: true } }),
  ]);

  const vesselName = new Map<string, string>(vessels.map((v: any) => [v.code, (v.name || v.code) as string]));
  const vName = (code: string | null | undefined) => (code ? vesselName.get(code) ?? code : null);
  const assetById = new Map<string, any>(assets.map((a: any) => [a.id, a]));
  const assetName = (id: string | null | undefined) => (id ? assetById.get(id)?.name ?? null : null);
  const providerName = new Map<string, string>(providers.map((p: any) => [p.id, p.name as string]));
  const pName = (id: string | null | undefined) => (id ? providerName.get(id) ?? null : null);
  const byVesselThen = <T>(vessel: (r: T) => string | null, code: (r: T) => string) => (a: T, b: T) =>
    (vName(vessel(a)) ?? "").localeCompare(vName(vessel(b)) ?? "", "es") || code(a).localeCompare(code(b), "es");

  const files: OutFile[] = [];
  const push = (name: string, content: Buffer, rows: number, folder: string | null = null) =>
    files.push({ folder, name, content, rows });

  // ── 01 OT ──
  const wos = await prisma.workOrder.findMany({ where: notDeleted });
  const woCode = new Map<string, string>(wos.map((w: any) => [w.id, w.workOrderCode]));
  // Una OT puede ejecutar varios ítems del plan, de equipos distintos: se listan todos.
  const links = wos.length
    ? await prisma.workOrderMaintenancePlan.findMany({
        where: { workOrderId: { in: wos.map((w: any) => w.id) } },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: { workOrderId: true, maintenancePlanId: true },
      })
    : [];
  const plansLite = await prisma.maintenancePlan.findMany({
    where: { tenantId },
    select: { id: true, taskCode: true, assetId: true },
  });
  const planById = new Map<string, any>(plansLite.map((p: any) => [p.id, p]));
  const linksByWo = new Map<string, string[]>();
  for (const l of links) {
    const list = linksByWo.get(l.workOrderId) ?? [];
    list.push(l.maintenancePlanId);
    linksByWo.set(l.workOrderId, list);
  }
  const woPlanIds = (w: any) => [...new Set([...(linksByWo.get(w.id) ?? []), ...(w.maintenancePlanId ? [w.maintenancePlanId] : [])])];
  wos.sort(byVesselThen((w: any) => w.vesselCode, (w: any) => w.workOrderCode));
  push("01 Órdenes de Trabajo (OT).xlsx", await buildSheet<any>("Órdenes de Trabajo", [
    { header: "Buque", width: 20, value: w => vName(w.vesselCode) },
    { header: "N° OT", width: 20, value: w => w.workOrderCode },
    { header: "Título", width: 40, kind: "long", value: w => w.title },
    { header: "Equipo(s)", width: 32, kind: "long", value: w => joinNames([assetName(w.assetId), ...woPlanIds(w).map(id => assetName(planById.get(id)?.assetId))]) },
    { header: "Tareas del plan", width: 22, kind: "long", value: w => joinNames(woPlanIds(w).map(id => planById.get(id)?.taskCode)) },
    { header: "Tipo", width: 13, value: w => label(WO_TYPE, w.type) },
    { header: "Clase de mantenimiento", width: 22, value: w => label(MAINT_KIND, w.maintenanceKind) },
    { header: "Estado", width: 13, value: w => label(WO_STATUS, w.status) },
    { header: "Prioridad", width: 11, value: w => label(PRIORITY, w.priority) },
    { header: "Criticidad", width: 10, value: w => w.criticality },
    { header: "Área", width: 12, value: w => label(DEPARTMENT, w.department) },
    { header: "Proveedor", width: 24, value: w => pName(w.providerId) ?? w.providerOther },
    { header: "Condición operativa", width: 14, value: w => label(OPERATING_CONDITION, w.operatingCondition) },
    { header: "Ubicación", width: 16, value: w => w.location },
    { header: "Apertura", width: 12, kind: "date", value: w => d(w.openDate) },
    { header: "Inicio", width: 12, kind: "date", value: w => d(w.startDate) },
    { header: "Vencimiento", width: 12, kind: "date", value: w => d(w.dueDate) },
    { header: "Cierre", width: 12, kind: "date", value: w => d(w.completedDate) },
    { header: "Descripción", width: 50, kind: "long", value: w => w.description },
    { header: "Resultado", width: 40, kind: "long", value: w => w.woResult },
    { header: "Trabajo completo", width: 10, value: w => yesNo(w.taskCompleted) },
    { header: "Pendientes", width: 36, kind: "long", value: w => w.pendingDetail },
    { header: "Observaciones", width: 40, kind: "long", value: w => w.observations },
    { header: "Notas de cierre", width: 40, kind: "long", value: w => w.closeNotes },
    { header: "Motivo de espera", width: 30, kind: "long", value: w => w.holdReason },
    { header: "Motivo de cancelación", width: 30, kind: "long", value: w => w.cancelReason },
    { header: "Ejecutado por", width: 22, value: w => w.executedByName },
    { header: "Horas estimadas", width: 10, kind: "number", value: w => w.estimatedHours },
    { header: "Horas reales", width: 10, kind: "number", value: w => w.actualHours },
    { header: "Horómetro al ejecutar", width: 12, kind: "number", value: w => w.runningHoursAtExecution },
    { header: "Enviada a aprobación por", width: 22, value: w => w.enviadoAprobacionByName },
    { header: "Aprobada por", width: 22, value: w => w.aprobadoByName },
    { header: "Fecha aprobación", width: 12, kind: "date", value: w => d(w.aprobadoAt) },
    { header: "Autorizada por", width: 22, value: w => w.autorizadoByName },
    { header: "Fecha autorización", width: 12, kind: "date", value: w => d(w.autorizadoAt) },
    { header: "Rechazada por", width: 22, value: w => w.rechazadoByName },
    { header: "Motivo de rechazo", width: 30, kind: "long", value: w => w.rechazoReason },
  ], wos), wos.length);

  // ── 02 SS ──
  const srs = await prisma.serviceRequest.findMany({ where: notDeleted });
  srs.sort(byVesselThen((s: any) => s.vesselCode, (s: any) => s.serviceRequestCode));
  push("02 Solicitudes de Servicio (SS).xlsx", await buildSheet<any>("Solicitudes de Servicio", [
    { header: "Buque", width: 20, value: s => vName(s.vesselCode) },
    { header: "N° SS", width: 20, value: s => s.serviceRequestCode },
    { header: "OT", width: 20, value: s => woCode.get(s.workOrderId) ?? null },
    { header: "Título", width: 36, kind: "long", value: s => s.title },
    { header: "Estado", width: 22, value: s => label(SS_STATUS, s.status) },
    { header: "Prioridad", width: 11, value: s => label(PRIORITY, s.priority) },
    { header: "Fecha", width: 12, kind: "date", value: s => d(s.openDate) },
    { header: "Taller", width: 26, value: s => pName(s.providerId) ?? s.tallerNotes },
    { header: "Área", width: 12, value: s => label(DEPARTMENT, s.department) },
    { header: "Solicitud de compras", width: 22, value: s => joinNames(s.purchaseRequestKinds ?? []) },
    { header: "Descripción del servicio", width: 50, kind: "long", value: s => s.description },
    { header: "Causas", width: 40, kind: "long", value: s => s.causes },
    { header: "Observaciones", width: 40, kind: "long", value: s => s.observations },
    { header: "Solicitada por", width: 22, value: s => s.solicitaByName },
    { header: "Aprobada por", width: 22, value: s => s.aprobadoByName },
    { header: "Fecha aprobación", width: 12, kind: "date", value: s => d(s.aprobadoAt) },
    { header: "Autorizada por", width: 22, value: s => s.autorizadoByName },
    { header: "Fecha autorización", width: 12, kind: "date", value: s => d(s.autorizadoAt) },
    { header: "Enviada al taller", width: 12, kind: "date", value: s => d(s.startedAt) },
    { header: "Recibida", width: 12, kind: "date", value: s => d(s.receivedAt) },
    { header: "Recibió", width: 22, value: s => s.receivedByName },
    { header: "Conforme", width: 10, value: s => yesNo(s.receptionConform) },
    { header: "Ítem recibido", width: 30, kind: "long", value: s => s.receptionItem },
    { header: "Notas de cierre", width: 36, kind: "long", value: s => s.closeNotes },
    { header: "Rechazada por", width: 22, value: s => s.rechazadoByName },
    { header: "Motivo de rechazo", width: 30, kind: "long", value: s => s.rechazoReason },
    { header: "Motivo de cancelación", width: 30, kind: "long", value: s => s.cancelReason },
    { header: "Capitán", width: 22, value: s => s.capitanName },
    { header: "Jefe de Máquinas", width: 22, value: s => s.jefeMaquinasName },
  ], srs), srs.length);

  // ── 03 Defectos ──
  const defects = await prisma.defect.findMany({ where: notDeleted });
  defects.sort(byVesselThen((x: any) => x.vesselCode, (x: any) => x.defectCode));
  push("03 Defectos.xlsx", await buildSheet<any>("Defectos", [
    { header: "Buque", width: 20, value: x => vName(x.vesselCode) },
    { header: "N° Defecto", width: 20, value: x => x.defectCode },
    { header: "Equipo", width: 30, value: x => assetName(x.assetId) },
    { header: "Fecha", width: 12, kind: "date", value: x => d(x.reportedAt) },
    { header: "Estado", width: 13, value: x => label(DEFECT_STATUS, x.status) },
    { header: "Severidad", width: 11, value: x => label(PRIORITY, x.severity) },
    { header: "Estado operativo", width: 14, value: x => label(OP_STATE, x.operationalState) },
    { header: "Clasificación", width: 24, value: x => label(DEFECT_CLASSIFICATION, x.classification) },
    { header: "Descripción", width: 50, kind: "long", value: x => x.description },
    { header: "Acción inmediata", width: 36, kind: "long", value: x => x.immediateAction },
    { header: "Acción correctiva", width: 36, kind: "long", value: x => x.correctiveAction },
    { header: "Tipo de reparación", width: 16, value: x => x.repairType },
    { header: "OT asociada", width: 20, value: x => (x.workOrderId ? woCode.get(x.workOrderId) ?? null : null) },
    { header: "Método de análisis (RCA)", width: 18, value: x => label(RCA_METHOD, x.rcaMethodology) },
    { header: "Causa inmediata", width: 30, kind: "long", value: x => x.rcaImmediateCause },
    { header: "Causa contribuyente", width: 30, kind: "long", value: x => x.rcaContributingCause },
    { header: "Causa raíz", width: 30, kind: "long", value: x => x.rcaRootCause },
    { header: "Acciones preventivas", width: 30, kind: "long", value: x => x.rcaPreventiveActions },
    { header: "Análisis completado", width: 12, kind: "date", value: x => d(x.rcaCompletedAt) },
  ], defects), defects.length);

  // ── 04 Equipos ──
  // Horómetro actual: el mismo dato que muestra "Horas de Equipos".
  const session = systemSession(tenantSlug);
  const assetsWithHours = await listTenantAssets(session, {}) as any[];
  const hoursById = new Map<string, any>(assetsWithHours.map(a => [a.id, a]));
  const assetRows = [...assets].sort(byVesselThen((a: any) => a.vesselCode, (a: any) => a.assetCode));
  push("04 Equipos.xlsx", await buildSheet<any>("Equipos", [
    { header: "Buque", width: 20, value: a => vName(a.vesselCode) },
    { header: "Código", width: 18, value: a => a.assetCode },
    { header: "Código SFI", width: 12, value: a => a.sfiCode },
    { header: "Equipo", width: 34, kind: "long", value: a => a.name },
    { header: "Equipo padre", width: 28, value: a => assetName(a.parentAssetId) },
    { header: "Criticidad", width: 10, value: a => a.criticality },
    { header: "Crítico para la seguridad", width: 12, value: a => yesNo(a.isSafetyCritical) },
    { header: "Estado", width: 16, value: a => label(ASSET_STATUS, a.status) },
    { header: "Fabricante", width: 20, value: a => a.manufacturer },
    { header: "Modelo", width: 20, value: a => a.model },
    { header: "N° de serie", width: 18, value: a => a.serialNumber },
    { header: "Instalación", width: 12, kind: "date", value: a => d(a.installationDate) },
    { header: "Último overhaul", width: 12, kind: "date", value: a => d(a.lastOverhaulDate) },
    { header: "Reemplazo", width: 12, kind: "date", value: a => d(a.replacementDate) },
    { header: "Horómetro actual", width: 12, kind: "number", value: a => hoursById.get(a.id)?.currentHours ?? null },
    { header: "Fecha de la lectura", width: 12, kind: "date", value: a => d(hoursById.get(a.id)?.currentHoursDate) },
    { header: "En stand-by", width: 10, value: a => yesNo(a.isStandby) },
    { header: "No requiere plan", width: 10, value: a => yesNo(a.planNotRequired) },
    { header: "Motivo (no requiere plan)", width: 30, kind: "long", value: a => a.planNotRequiredReason },
    { header: "Fundamento de la criticidad", width: 36, kind: "long", value: a => a.criticalityRationale },
  ], assetRows), assetRows.length);

  // ── 05 Repuestos ──
  const spares = await prisma.spare.findMany({ where: notDeleted });
  // Stock real = el del libro de movimientos (el mismo que muestra la app), no
  // el campo currentStock, que puede quedar viejo.
  const onHand = await getOnHandMap(prisma, spares.map((s: any) => s.id), { tenantId });
  const spareLinks = spares.length
    ? await prisma.spareAsset.findMany({ where: { tenantId }, select: { spareId: true, assetId: true } })
    : [];
  const assetsBySpare = new Map<string, string[]>();
  for (const l of spareLinks) {
    const list = assetsBySpare.get(l.spareId) ?? [];
    list.push(l.assetId);
    assetsBySpare.set(l.spareId, list);
  }
  const locations = await prisma.stockLocation.findMany({ where: { tenantId }, select: { id: true, name: true } });
  const locationName = new Map<string, string>(locations.map((l: any) => [l.id, l.name]));
  spares.sort(byVesselThen((s: any) => s.vesselCode, (s: any) => s.sku));
  push("05 Repuestos.xlsx", await buildSheet<any>("Repuestos", [
    { header: "Buque", width: 20, value: s => vName(s.vesselCode) },
    { header: "Código", width: 18, value: s => s.sku },
    { header: "Repuesto", width: 34, kind: "long", value: s => s.name },
    { header: "Descripción", width: 36, kind: "long", value: s => s.longDescription },
    { header: "Equipo(s)", width: 32, kind: "long", value: s => joinNames([assetName(s.linkedAssetId), ...(assetsBySpare.get(s.id) ?? []).map(assetName)]) },
    { header: "Categoría", width: 16, value: s => s.category },
    { header: "Criticidad", width: 10, value: s => s.criticality },
    { header: "Fabricante", width: 18, value: s => s.manufacturer },
    { header: "Modelo", width: 18, value: s => s.model },
    { header: "P/N fabricante", width: 18, value: s => s.manufacturerPartNumber },
    { header: "P/N interno", width: 16, value: s => s.internalPartNumber },
    { header: "Unidad", width: 9, value: s => s.unit },
    { header: "Stock a bordo", width: 10, kind: "number", value: s => onHand.get(s.id) ?? 0 },
    { header: "Stock mínimo", width: 10, kind: "number", value: s => s.minStock },
    { header: "Punto de pedido", width: 10, kind: "number", value: s => s.reorderPoint },
    { header: "Stock objetivo", width: 10, kind: "number", value: s => s.targetStock },
    { header: "Ubicación", width: 20, value: s => (s.defaultLocationId ? locationName.get(s.defaultLocationId) : null) ?? s.location },
    { header: "Proveedor preferido", width: 24, value: s => pName(s.preferredSupplierId) },
    { header: "Plazo de entrega (días)", width: 10, kind: "number", value: s => s.leadTimeDays },
    { header: "Estado", width: 10, value: s => label(ACTIVE_STATUS, s.status) },
  ], spares), spares.length);

  // ── 06 Proveedores ──
  const provRows = [...providers].sort((a: any, b: any) => String(a.name).localeCompare(String(b.name), "es"));
  push("06 Proveedores.xlsx", await buildSheet<any>("Proveedores", [
    { header: "Código", width: 16, value: p => p.providerCode },
    { header: "Proveedor", width: 34, value: p => p.name },
    { header: "Rubro", width: 20, value: p => p.category },
    { header: "Estado", width: 10, value: p => label(ACTIVE_STATUS, p.status) },
    { header: "Contacto", width: 24, value: p => p.contactName },
    { header: "Correo", width: 28, value: p => p.contactEmail },
    { header: "Teléfono", width: 18, value: p => p.contactPhone },
    { header: "Ubicación", width: 22, value: p => p.location },
    { header: "Notas", width: 40, kind: "long", value: p => p.notes },
  ], provRows), provRows.length);

  // ── 07 Plan de Mantenimiento ──
  // Del mismo listado que la pantalla de Planes: trae el estado de ejecución
  // calculado, el horómetro del equipo y los talleres con nombre.
  const plans = await listTenantMaintenancePlans(session, {}) as any[];
  plans.sort(byVesselThen((p: any) => p.vesselCode, (p: any) => p.taskCode));
  const lastDone = (p: any) => (p.triggerType === "HOURS" || p.triggerType === "RUNNING_HOURS") ? p.lastExecutionHours : null;
  const nextDue = (p: any) => (p.triggerType === "HOURS" || p.triggerType === "RUNNING_HOURS") ? p.nextDueHours : null;
  push("07 Plan de Mantenimiento.xlsx", await buildSheet<any>("Plan de Mantenimiento", [
    { header: "Buque", width: 20, value: p => vName(p.vesselCode) },
    { header: "Código de tarea", width: 20, value: p => p.taskCode },
    { header: "Equipo", width: 30, kind: "long", value: p => p.assetName },
    { header: "Grupo SFI", width: 8, kind: "number", value: p => p.sfiGroupNumber },
    { header: "Tarea", width: 40, kind: "long", value: p => p.title },
    { header: "Tareas a realizar", width: 50, kind: "long", value: p => p.description },
    { header: "Tipo", width: 14, value: p => label(TASK_TYPE, p.taskType) },
    { header: "Toma de muestra", width: 12, value: p => label(SAMPLE_KIND, p.samplingKind) },
    { header: "Frecuencia", width: 14, value: p => frequency(p.triggerType, p.frequencyHours ?? null, p.frequencyMonths ?? null) },
    { header: "Última ejecución", width: 12, kind: "date", value: p => d(p.lastExecutionDate) },
    { header: "Última ejecución (horas)", width: 12, kind: "number", value: lastDone },
    { header: "Próximo vencimiento", width: 12, kind: "date", value: p => d(p.nextDueDate) },
    { header: "Próximo vencimiento (horas)", width: 12, kind: "number", value: nextDue },
    { header: "Horómetro actual del equipo", width: 12, kind: "number", value: p => p.assetCurrentHours },
    { header: "Situación", width: 16, value: p => label(EXEC_STATUS, p.executionStatus) },
    { header: "Área responsable", width: 14, value: p => label(DEPARTMENT, p.department) },
    { header: "Taller(es)", width: 26, kind: "long", value: p => joinNames([...(p.providerRequests ?? []).map((r: any) => r.providerName), p.providerName]) },
    { header: "Responsable", width: 18, value: p => p.responsible },
    { header: "Horas estimadas", width: 10, kind: "number", value: p => p.estimatedHours },
    { header: "Origen del criterio", width: 20, value: p => label(CRITERIA_SOURCE, p.criteriaSource) },
    { header: "Criterio de aceptación", width: 40, kind: "long", value: p => p.acceptanceCriteria },
    { header: "Seguridad / bloqueo (LOTO)", width: 40, kind: "long", value: p => p.loto },
    { header: "Nivel de riesgo", width: 12, value: p => p.riskLevel },
    { header: "Análisis de riesgo", width: 40, kind: "long", value: p => p.riskAnalysisResult },
    { header: "Estado", width: 10, value: p => label(PLAN_STATUS, p.status) },
  ], plans), plans.length);

  // ── 08 Planillas a bordo, una por buque ──
  // Mismo armado y mismos datos que el botón "Planilla" de la app (sin planes
  // inactivos, catálogo de equipos del buque para marca/modelo/grupo SFI).
  const logo = await loadLogo(settings?.logoUrl || settings?.logoUrlLight);
  const activePlans = plans.filter(p => p.status !== "INACTIVE");
  const plansByVessel = new Map<string, SheetPlan[]>();
  for (const p of activePlans) {
    const list = plansByVessel.get(p.vesselCode) ?? [];
    list.push(p as SheetPlan);
    plansByVessel.set(p.vesselCode, list);
  }
  const sheetAssets = new Map<string, AssetInfo>(assetsWithHours.map(a => [a.id, a as AssetInfo]));
  const vesselCodes = [...plansByVessel.keys()].sort((a, b) => (vName(a) ?? a).localeCompare(vName(b) ?? b, "es"));
  for (const code of vesselCodes) {
    const name = vName(code) ?? code;
    const wb = await buildMaintenanceSheet({
      plans: plansByVessel.get(code)!,
      assetById: sheetAssets,
      vesselName: name,
      vesselCode: code,
      logo,
    });
    const content = Buffer.from(await wb.xlsx.writeBuffer());
    push(`Planilla a bordo - ${fileSafe(name)}.xlsx`, content, plansByVessel.get(code)!.length, ONBOARD_FOLDER);
  }

  return files;
}

function readme(dateKey: string, files: OutFile[], generatedAt: Date, tz: string): string {
  const when = generatedAt.toLocaleString("es-AR", { timeZone: tz, dateStyle: "short", timeStyle: "short" });
  const main = files.filter(f => !f.folder);
  const onboard = files.filter(f => f.folder === ONBOARD_FOLDER);
  return [
    `RESPALDO SEMANAL EN EXCEL — semana del ${dateKey.split("-").reverse().join("/")}`,
    `Generado por CMS3.0 el ${when} (hora de la empresa).`,
    "",
    "Son planillas para leer: nombres de buques y equipos, estados en español y",
    "fechas de calendario. Contienen los registros vigentes (no los eliminados).",
    "",
    ...main.map(f => `  ${f.name.padEnd(42)} ${f.rows} registros`),
    `  ${ONBOARD_FOLDER}/  ${onboard.length} planillas (una por buque, formato de a bordo)`,
    "",
    `Se conservan las últimas ${KEEP_WEEKS} semanas; las anteriores pasan a la papelera`,
    "de Google Drive, que las guarda 30 días más.",
    "",
  ].join("\r\n");
}

// ── Subida ───────────────────────────────────────────────────────────────────

/** "Semana" del respaldo: el domingo (fecha local) más reciente cuya hora de corrida ya pasó. */
export function backupWeekKey(now: Date, tz: string): string {
  const local = localNow(now, tz);
  const daysBack = local.weekday === RUN_WEEKDAY
    ? (local.hour >= RUN_HOUR ? 0 : 7)
    : local.weekday;
  const day = new Date(Date.UTC(local.year, local.month - 1, local.day) - daysBack * 86_400_000);
  return day.toISOString().slice(0, 10);
}

export interface ExcelBackupResult {
  tenantSlug: string;
  status: "DONE" | "ALREADY_DONE" | "NOT_CONNECTED";
  weekKey?: string;
  files?: number;
}

/**
 * Respaldo de una empresa. Sin `force`, no hace nada si la semana ya está
 * completa en el Drive. Tira si Drive o la base fallan (el que llama lo registra).
 */
export async function runTenantExcelBackup(
  tenantId: string,
  tenantSlug: string,
  opts: { now?: Date; force?: boolean } = {},
): Promise<ExcelBackupResult> {
  const now = opts.now ?? new Date();
  const drive = await getTenantDriveRoot(tenantId);
  if (!drive) return { tenantSlug, status: "NOT_CONNECTED" };
  const { accessToken, rootFolderId } = drive;

  const { tz } = await resolveTenantTime(tenantSlug);
  const weekKey = backupWeekKey(now, tz);
  const backupFolderId = await ensureFolder(accessToken, BACKUP_FOLDER, rootFolderId);

  const existing = (await listFolders(accessToken, backupFolderId)).find(f => f.name === weekKey);
  if (existing && !opts.force) {
    const done = await listFileNames(accessToken, existing.id, DONE_MARKER);
    if (done.includes(DONE_MARKER)) return { tenantSlug, status: "ALREADY_DONE", weekKey };
  }

  const files = await buildTenantExcelFiles(tenantId, tenantSlug);

  const weekFolderId = existing?.id ?? await ensureFolder(accessToken, weekKey, backupFolderId);
  // Si se rehace (corrida cortada o forzada), la marca de "completo" se saca
  // primero: sólo vuelve a aparecer si todo lo demás subió.
  await trashByName(accessToken, weekFolderId, DONE_MARKER);
  const subfolders = new Map<string, string>();
  for (const f of files) {
    let target = weekFolderId;
    if (f.folder) {
      if (!subfolders.has(f.folder)) subfolders.set(f.folder, await ensureFolder(accessToken, f.folder, weekFolderId));
      target = subfolders.get(f.folder)!;
    }
    await trashByName(accessToken, target, f.name);
    await uploadFile(accessToken, target, f.name, XLSX_MIME, f.content);
  }
  await uploadFile(accessToken, weekFolderId, DONE_MARKER, "text/plain", Buffer.from(readme(weekKey, files, now, tz), "utf8"));

  // Semanas viejas a la papelera. Sólo carpetas con nombre de fecha: si alguien
  // dejó otra cosa en la carpeta del respaldo, no se toca.
  const weeks = (await listFolders(accessToken, backupFolderId))
    .filter(f => /^\d{4}-\d{2}-\d{2}$/.test(f.name))
    .sort((a, b) => b.name.localeCompare(a.name));
  for (const old of weeks.slice(KEEP_WEEKS)) await trashById(accessToken, old.id);

  return { tenantSlug, status: "DONE", weekKey, files: files.length };
}

// Última semana ya confirmada por empresa: evita preguntarle al Drive cada hora.
const confirmedWeek = new Map<string, string>();
let running = false;

/** Tick del scheduler (server.ts): corre para cada empresa activa con el Drive conectado. */
export async function runWeeklyExcelBackups(now = new Date()): Promise<void> {
  if (running) return;
  running = true;
  try {
    const prisma = getPrismaClient();
    if (!prisma) return;
    const tenants = await prisma.tenant.findMany({
      where: { status: "ACTIVE", settings: { pdfArchiveEnabled: true } },
      select: { id: true, slug: true, settings: { select: { timezone: true } } },
    });
    for (const t of tenants) {
      const weekKey = backupWeekKey(now, t.settings?.timezone || "UTC");
      if (confirmedWeek.get(t.id) === weekKey) continue;
      try {
        const started = Date.now();
        const result = await runTenantExcelBackup(t.id, t.slug, { now });
        if (result.status !== "NOT_CONNECTED") confirmedWeek.set(t.id, weekKey);
        if (result.status === "DONE") {
          log.info(`[excel-backup] tenant=${t.slug} semana=${result.weekKey} ${result.files} archivos en ${Math.round((Date.now() - started) / 1000)}s`);
        }
      } catch (err) {
        await recordArchiveError(t.id, t.slug, "Respaldo semanal en Excel", err);
      }
    }
  } finally {
    running = false;
  }
}
