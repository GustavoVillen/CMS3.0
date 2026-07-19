import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { publishAudit } from "../../platform/audit/audit-publisher";
import { generateFluidAiAnalysis } from "./fluid-analyses-ai-insights";
import { applyAssignedVesselScope } from "../auth/vessel-scope";

// ── Constants ────────────────────────────────────────────────────────────────

export const FLUID_TYPES = [
  "ENGINE_OIL", "HYDRAULIC_OIL", "GEARBOX_OIL", "TRANSMISSION_OIL",
  "FUEL_DIESEL", "FUEL_GASOIL",
  "COOLING_WATER", "BOILER_WATER", "POTABLE_WATER",
  "REFRIGERANT", "OTHER",
] as const;
export type FluidType = typeof FLUID_TYPES[number];

export const SAMPLE_STATUSES = ["DRAFT", "SENT", "REPORTED", "ARCHIVED"] as const;
export type SampleStatus = typeof SAMPLE_STATUSES[number];

export const VERDICTS = ["NORMAL", "CAUTION", "CRITICAL", "ACTION_REQUIRED"] as const;
export type Verdict = typeof VERDICTS[number];

// ── Inputs ───────────────────────────────────────────────────────────────────

export interface CreateFluidSampleInput {
  vesselCode: string;
  assetId: string;
  fluidType: FluidType;
  fluidProduct?: string | null;
  sampledAt: string | Date;
  runningHours?: number | null;
  containerCode?: string | null;
  labName?: string | null;
  labReference?: string | null;
  notes?: string | null;
  sentAt?: string | Date | null;
  status?: SampleStatus;
}

export interface UpdateFluidSampleInput {
  assetId?: string;
  fluidType?: FluidType;
  fluidProduct?: string | null;
  sampledAt?: string | Date;
  runningHours?: number | null;
  containerCode?: string | null;
  labName?: string | null;
  labReference?: string | null;
  notes?: string | null;
  sentAt?: string | Date | null;
  status?: SampleStatus;
}

export interface CreateResultInput {
  receivedAt?: string | Date;
  verdict?: Verdict;
  summary?: string | null;
  parameters: Record<string, unknown>;
  reportUrl?: string | null;
  reportMime?: string | null;
  reportSourceText?: string | null;
  /**
   * Horómetro del equipo al momento del muestreo, leído del reporte del lab (la
   * IA lo extrae y el usuario lo confirma). Se guarda en la muestra y se asienta
   * en la OT que la originó — ver syncRunningHoursToSourceWorkOrder.
   */
  runningHours?: number | null;
}

export interface UpdateResultInput extends Partial<CreateResultInput> {}

// ── Helpers ──────────────────────────────────────────────────────────────────

function ensureAdminOrManager(session: TenantAccessSession): void {
  const role = session.user.role;
  const ok = role === "TENANT_ADMIN" || role === "MAINTENANCE_MANAGER";
  if (!ok) throw new RouteError(403, "FORBIDDEN", "Sin permiso para gestionar análisis de fluidos.");
}

/**
 * El horómetro es un dato de campo: lo lee quien está frente al equipo, no
 * necesariamente quien administra el módulo. Por eso su corrección se permite a
 * cualquier rol operativo — todos menos el auditor, que es de sólo lectura.
 */
function ensureCanEditRunningHours(session: TenantAccessSession): void {
  if (session.user.role === "AUDITOR_READONLY") {
    throw new RouteError(403, "FORBIDDEN", "Sin permiso para editar las horas de la muestra.");
  }
}

async function resolveTenantId(session: TenantAccessSession): Promise<string> {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const tenant = await (prisma as any).tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");
  return tenant.id;
}

function parseDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return null;
  return d;
}

function normText(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  return t.length > 0 ? t : null;
}

/**
 * Horómetro. `undefined` = el cliente no mandó el campo (no se toca lo guardado);
 * `null` = lo mandó vacío (se borra). Se acepta 0: un equipo recién instalado o
 * recién reacondicionado puede muestrearse con el horómetro en cero.
 */
function normHours(v: number | null | undefined): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

async function nextSampleCode(prisma: any, tenantId: string, vesselCode: string): Promise<string> {
  const last = await prisma.fluidSample.findFirst({
    where: { tenantId, vesselCode },
    orderBy: { createdAt: "desc" },
    select: { sampleCode: true },
  });
  let n = 1;
  if (last?.sampleCode) {
    const m = last.sampleCode.match(/(\d+)$/);
    if (m) n = parseInt(m[1], 10) + 1;
  }
  return `FA-${vesselCode}-${String(n).padStart(4, "0")}`;
}

// ── Verdict computation from parameters + thresholds ─────────────────────────

export interface ThresholdRow {
  parameter: string;
  cautionMin: number | null;
  cautionMax: number | null;
  criticalMin: number | null;
  criticalMax: number | null;
  direction: "HIGH_BAD" | "LOW_BAD" | "RANGE";
}

export function computeVerdict(parameters: Record<string, unknown>, thresholds: ThresholdRow[]): Verdict {
  let worst: Verdict = "NORMAL";
  for (const t of thresholds) {
    const raw = parameters[t.parameter];
    if (raw == null) continue;
    const v = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(v)) continue;

    let level: Verdict = "NORMAL";
    if (t.direction === "HIGH_BAD") {
      if (t.criticalMax != null && v >= t.criticalMax) level = "CRITICAL";
      else if (t.cautionMax != null && v >= t.cautionMax) level = "CAUTION";
    } else if (t.direction === "LOW_BAD") {
      if (t.criticalMin != null && v <= t.criticalMin) level = "CRITICAL";
      else if (t.cautionMin != null && v <= t.cautionMin) level = "CAUTION";
    } else {
      // RANGE: critical fuera del rango critico, caution fuera del rango caution
      if ((t.criticalMin != null && v < t.criticalMin) || (t.criticalMax != null && v > t.criticalMax)) level = "CRITICAL";
      else if ((t.cautionMin != null && v < t.cautionMin) || (t.cautionMax != null && v > t.cautionMax)) level = "CAUTION";
    }

    if (level === "CRITICAL") return "CRITICAL";
    if (level === "CAUTION" && worst === "NORMAL") worst = "CAUTION";
  }
  return worst;
}

// ── List / get ───────────────────────────────────────────────────────────────

export interface ListFilters {
  vesselCode?: string | null;
  assetId?: string | null;
  fluidType?: FluidType | null;
  verdict?: Verdict | null;
  status?: SampleStatus | null;
  from?: string | null;
  to?: string | null;
}

export async function listFluidSamples(session: TenantAccessSession, filters: ListFilters = {}) {
  const prisma = getPrismaClient();
  if (!prisma) return { items: [], total: 0 };
  const tenantId = await resolveTenantId(session);
  // Seed defaults the first time the tenant uses the feature (idempotent)
  void seedDefaultThresholds(tenantId).catch(() => {});

  const where: any = { tenantId, deletedAt: null };
  applyAssignedVesselScope(session, where, filters.vesselCode ?? null);
  if (filters.assetId)    where.assetId    = filters.assetId;
  if (filters.fluidType)  where.fluidType  = filters.fluidType;
  if (filters.status)     where.status     = filters.status;
  if (filters.from || filters.to) {
    where.sampledAt = {};
    if (filters.from) where.sampledAt.gte = new Date(filters.from);
    if (filters.to)   where.sampledAt.lte = new Date(filters.to);
  }

  const samples = await (prisma as any).fluidSample.findMany({
    where,
    orderBy: { sampledAt: "desc" },
    include: { result: true },
    take: 500,
  });

  // Filter by verdict (post-load since it's on result)
  const filtered = filters.verdict
    ? samples.filter((s: any) => s.result?.verdict === filters.verdict)
    : samples;

  // La muestra sólo guarda el id interno de la OT que la generó. El listado
  // muestra el CÓDIGO (OT-M02-26-0456), así que se resuelve en lote — una sola
  // consulta para todas, no una por fila. Mismo patrón que listServiceRequests
  // con los nombres de equipo y de proveedor.
  const woIds = [...new Set(filtered.map((s: any) => s.sourceWorkOrderId).filter(Boolean))] as string[];
  if (woIds.length > 0) {
    const wos = await (prisma as any).workOrder.findMany({
      where: { id: { in: woIds }, tenantId },
      select: { id: true, workOrderCode: true },
    });
    const codeOf = new Map(wos.map((w: any) => [w.id, w.workOrderCode]));
    for (const s of filtered) {
      s.sourceWorkOrderCode = s.sourceWorkOrderId ? (codeOf.get(s.sourceWorkOrderId) ?? null) : null;
    }
  } else {
    for (const s of filtered) s.sourceWorkOrderCode = null;
  }

  return { items: filtered, total: filtered.length };
}

export async function regenerateFluidAiAnalysis(session: TenantAccessSession, id: string) {
  const tenantId = await resolveTenantId(session);
  // El informe es extenso (~60s). Se genera en SEGUNDO PLANO y se responde al
  // instante; el frontend sondea GET /app/fluid-analyses/:id hasta que aparece
  // el nuevo análisis. Así el request HTTP no queda colgado ~60s (evita cortes
  // de timeout del proxy en producción).
  void generateFluidAiAnalysis({
    tenantId,
    tenantSlug: session.tenantSlug,
    userId: session.user.id,
    userEmail: session.user.email,
    sampleId: id,
  }).catch(() => { /* errores ya se loguean y se tragan dentro del generador */ });
  return { status: "generating", sampleId: id };
}

export async function getFluidSample(session: TenantAccessSession, id: string) {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const tenantId = await resolveTenantId(session);
  const where: Record<string, unknown> = { id, tenantId, deletedAt: null };
  applyAssignedVesselScope(session, where);
  const sample = await (prisma as any).fluidSample.findFirst({
    where,
    include: { result: true },
  });
  if (!sample) throw new RouteError(404, "FLUID_SAMPLE_NOT_FOUND", "Muestra no encontrada.");

  // Defensa contra Prisma client desactualizado: si el include no trajo aiAnalysis,
  // lo traemos con raw SQL para no perder datos en producción durante migraciones.
  if (sample.result && (sample.result.aiAnalysis === undefined || sample.result.aiAnalysisGeneratedAt === undefined)) {
    try {
      const rows = await (prisma as any).$queryRawUnsafe(
        `SELECT "aiAnalysis", "aiAnalysisGeneratedAt" FROM "FluidAnalysisResult" WHERE id = $1 LIMIT 1`,
        sample.result.id,
      );
      if (Array.isArray(rows) && rows.length > 0) {
        sample.result.aiAnalysis = rows[0].aiAnalysis ?? null;
        sample.result.aiAnalysisGeneratedAt = rows[0].aiAnalysisGeneratedAt ?? null;
      }
    } catch { /* non-blocking */ }
  }

  return sample;
}

// ── Create / update / delete sample ──────────────────────────────────────────

export async function createFluidSample(session: TenantAccessSession, input: CreateFluidSampleInput) {
  ensureAdminOrManager(session);
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const tenantId = await resolveTenantId(session);

  const vesselCode = String(input.vesselCode || "").trim();
  if (!vesselCode) throw new RouteError(400, "FIELD_REQUIRED", "vesselCode es requerido.");
  const assetId = String(input.assetId || "").trim();
  if (!assetId) throw new RouteError(400, "FIELD_REQUIRED", "assetId es requerido.");
  if (!FLUID_TYPES.includes(input.fluidType)) throw new RouteError(400, "INVALID_FLUID_TYPE", "Tipo de fluido inválido.");

  const sampledAt = parseDate(input.sampledAt);
  if (!sampledAt) throw new RouteError(400, "INVALID_DATE", "sampledAt inválido.");

  const sampleCode = await nextSampleCode(prisma as any, tenantId, vesselCode);

  const created = await (prisma as any).fluidSample.create({
    data: {
      tenantId,
      vesselCode,
      assetId,
      sampleCode,
      fluidType: input.fluidType,
      fluidProduct: normText(input.fluidProduct),
      sampledAt,
      runningHours: input.runningHours ?? null,
      sampledByUserId: session.user.id,
      containerCode: normText(input.containerCode),
      sentAt: parseDate(input.sentAt),
      labName: normText(input.labName),
      labReference: normText(input.labReference),
      notes: normText(input.notes),
      status: input.status ?? "DRAFT",
      createdByUserId: session.user.id,
      updatedByUserId: session.user.id,
    },
  });

  void publishAudit(prisma, {
    tenantId,
    actorUserId: session.user.id,
    action: "FluidSample.created",
    entityType: "FluidSample",
    entityId: created.id,
    metadata: { sampleCode, vesselCode, fluidType: created.fluidType },
  });

  return created;
}

export async function updateFluidSample(session: TenantAccessSession, id: string, input: UpdateFluidSampleInput) {
  ensureAdminOrManager(session);
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const tenantId = await resolveTenantId(session);

  const current = await (prisma as any).fluidSample.findFirst({ where: { id, tenantId, deletedAt: null } });
  if (!current) throw new RouteError(404, "FLUID_SAMPLE_NOT_FOUND", "Muestra no encontrada.");

  const data: any = { updatedByUserId: session.user.id };
  if (input.assetId !== undefined)       data.assetId       = String(input.assetId).trim();
  if (input.fluidType !== undefined)     data.fluidType     = input.fluidType;
  if (input.fluidProduct !== undefined)  data.fluidProduct  = normText(input.fluidProduct);
  if (input.sampledAt !== undefined)     data.sampledAt     = parseDate(input.sampledAt);
  if (input.runningHours !== undefined)  data.runningHours  = input.runningHours ?? null;
  if (input.containerCode !== undefined) data.containerCode = normText(input.containerCode);
  if (input.sentAt !== undefined)        data.sentAt        = parseDate(input.sentAt);
  if (input.labName !== undefined)       data.labName       = normText(input.labName);
  if (input.labReference !== undefined)  data.labReference  = normText(input.labReference);
  if (input.notes !== undefined)         data.notes         = normText(input.notes);
  if (input.status !== undefined)        data.status        = input.status;

  const updated = await (prisma as any).fluidSample.update({ where: { id }, data });
  return updated;
}

/**
 * Corrección puntual del horómetro de la muestra, abierta a todo rol operativo.
 * Es deliberadamente más acotada que updateFluidSample: toca un solo campo, para
 * no abrir el resto de la ficha a roles que no la administran.
 */
export async function updateFluidSampleRunningHours(
  session: TenantAccessSession,
  id: string,
  runningHours: number | null,
) {
  ensureCanEditRunningHours(session);
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const tenantId = await resolveTenantId(session);

  const current = await (prisma as any).fluidSample.findFirst({ where: { id, tenantId, deletedAt: null } });
  if (!current) throw new RouteError(404, "FLUID_SAMPLE_NOT_FOUND", "Muestra no encontrada.");

  if (runningHours != null && (!Number.isFinite(runningHours) || runningHours < 0)) {
    throw new RouteError(400, "VALIDATION_ERROR", "Las horas deben ser un número mayor o igual a cero.");
  }

  await (prisma as any).fluidSample.update({
    where: { id },
    data: { runningHours, updatedByUserId: session.user.id },
  });

  void publishAudit(prisma, {
    tenantId,
    actorUserId: session.user.id,
    action: "FluidSample.runningHoursUpdated",
    entityType: "FluidSample",
    entityId: id,
    metadata: { sampleCode: current.sampleCode, from: current.runningHours, to: runningHours },
  });

  // Se devuelve la muestra COMPLETA (con `result`), no lo que devuelve el
  // update. `fluidSample.update` no incluye la relación, y el detalle del front
  // reemplaza su estado con esta respuesta: al corregir el horómetro, la muestra
  // se quedaba sin resultado en pantalla y parecía que se había borrado el
  // análisis del laboratorio (los datos nunca se tocaron, sólo la copia en
  // memoria). Reutilizar getFluidSample garantiza además la misma forma que el
  // GET del detalle, incluida su defensa para traer aiAnalysis.
  return getFluidSample(session, id);
}

export async function deleteFluidSample(session: TenantAccessSession, id: string) {
  ensureAdminOrManager(session);
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const tenantId = await resolveTenantId(session);
  const current = await (prisma as any).fluidSample.findFirst({ where: { id, tenantId, deletedAt: null } });
  if (!current) throw new RouteError(404, "FLUID_SAMPLE_NOT_FOUND", "Muestra no encontrada.");

  await (prisma as any).fluidSample.update({
    where: { id },
    data: { deletedAt: new Date(), deletedByUserId: session.user.id, updatedByUserId: session.user.id },
  });
  return { ok: true };
}

// ── Create / update result ───────────────────────────────────────────────────

export async function upsertFluidResult(session: TenantAccessSession, sampleId: string, input: CreateResultInput) {
  ensureAdminOrManager(session);
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const tenantId = await resolveTenantId(session);

  const sample = await (prisma as any).fluidSample.findFirst({
    where: { id: sampleId, tenantId, deletedAt: null },
    include: { result: true },
  });
  if (!sample) throw new RouteError(404, "FLUID_SAMPLE_NOT_FOUND", "Muestra no encontrada.");

  const params = (input.parameters && typeof input.parameters === "object") ? input.parameters : {};
  const receivedAt = parseDate(input.receivedAt) ?? new Date();

  // Compute verdict from thresholds if not explicitly provided
  let verdict: Verdict = input.verdict ?? "NORMAL";
  if (!input.verdict) {
    const thresholds = await (prisma as any).fluidParameterThreshold.findMany({
      where: { tenantId, fluidType: sample.fluidType },
    });
    if (thresholds.length > 0) verdict = computeVerdict(params, thresholds);
  }

  const baseData = {
    receivedAt,
    verdict,
    summary: normText(input.summary),
    parameters: params as any,
    reportUrl: normText(input.reportUrl),
    reportMime: normText(input.reportMime),
    reportSourceText: normText(input.reportSourceText),
  };

  let result;
  if (sample.result) {
    result = await (prisma as any).fluidAnalysisResult.update({
      where: { id: sample.result.id },
      data: baseData,
    });
  } else {
    result = await (prisma as any).fluidAnalysisResult.create({
      data: { ...baseData, tenantId, sampleId, enteredByUserId: session.user.id },
    });
  }

  // Move sample to REPORTED. El horómetro leído del reporte se guarda acá:
  // llega como parte del resultado porque el dato está impreso en el PDF del lab.
  const runningHours = normHours(input.runningHours);
  await (prisma as any).fluidSample.update({
    where: { id: sampleId },
    data:  {
      status: "REPORTED",
      ...(runningHours !== undefined ? { runningHours } : {}),
      updatedByUserId: session.user.id,
    },
  });

  // Asentar el horómetro en la OT que originó la muestra (no bloquea el guardado
  // del resultado si falla: el dato del análisis ya quedó registrado).
  if (runningHours != null) {
    try {
      await syncRunningHoursToSourceWorkOrder(prisma, session, sample, runningHours);
    } catch {
      // Non-fatal — el resultado del análisis se guarda igual.
    }
  }

  void publishAudit(prisma, {
    tenantId,
    actorUserId: session.user.id,
    action: "FluidAnalysisResult.entered",
    entityType: "FluidSample",
    entityId: sampleId,
    metadata: { sampleCode: sample.sampleCode, vesselCode: sample.vesselCode, verdict },
  });

  // El análisis IA (informe de especialista senior) NO se dispara automáticamente:
  // es un informe extenso y costoso, se genera on-demand con el botón
  // "Generar/Regenerar análisis IA" → regenerateFluidAiAnalysis().

  if (verdict === "CRITICAL" || verdict === "ACTION_REQUIRED") {
    void publishAudit(prisma, {
      tenantId,
      actorUserId: session.user.id,
      action: "FluidAnalysisResult.criticalAlert",
      entityType: "FluidSample",
      entityId: sampleId,
      metadata: { sampleCode: sample.sampleCode, vesselCode: sample.vesselCode, verdict },
    });

    // Auto-create Defect if not already linked
    if (!result.defectId) {
      try {
        const defectId = await createDefectFromResult(prisma, session, sample, result, params);
        if (defectId) {
          await (prisma as any).fluidAnalysisResult.update({
            where: { id: result.id },
            data:  { defectId },
          });
          result.defectId = defectId;
        }
      } catch {
        // Non-fatal: surfaced via the criticalAlert audit event regardless
      }
    }
  }

  return result;
}

// ── Horómetro del reporte → OT de origen ─────────────────────────────────────

/**
 * Asienta el horómetro leído del reporte del lab en la OT que generó la muestra,
 * en "horas del motor al momento de ejecución".
 *
 * Reglas de negocio:
 * - Sólo completa si la OT NO tiene horas cargadas. Un valor puesto por la
 *   tripulación es un dato humano y no se pisa con una lectura de la IA.
 * - Cuando la OT viene de un plan se usa updatePlanExecution: es el camino
 *   sancionado para corregir una ejecución aunque la OT esté CERRADA (las OT de
 *   muestreo suelen estarlo cuando llega el resultado) y además recalcula
 *   lastExecution/nextDue del plan — el horómetro real reprograma el plan.
 * - Si la OT no cuelga de un plan no hay vencimiento que recalcular: se escribe
 *   sólo el campo.
 */
async function syncRunningHoursToSourceWorkOrder(
  prisma: any,
  session: TenantAccessSession,
  sample: { id: string; tenantId: string; sampleCode: string; sourceWorkOrderId: string | null },
  runningHours: number,
): Promise<void> {
  if (!sample.sourceWorkOrderId) return;

  const wo = await prisma.workOrder.findFirst({
    where: { id: sample.sourceWorkOrderId, tenantId: sample.tenantId, deletedAt: null },
    select: { id: true, workOrderCode: true, maintenancePlanId: true, runningHoursAtExecution: true },
  });
  if (!wo) return;
  // Dato humano ya cargado: no se pisa.
  if (wo.runningHoursAtExecution != null) return;

  if (wo.maintenancePlanId) {
    const { updatePlanExecution } = await import("../maintenance-plans/maintenance-plans-service");
    await updatePlanExecution(session, wo.maintenancePlanId, wo.id, { runningHoursAtExecution: runningHours });
  } else {
    await prisma.workOrder.update({
      where: { id: wo.id },
      data:  { runningHoursAtExecution: runningHours, updatedByUserId: session.user.id },
    });
  }

  void publishAudit(prisma, {
    tenantId: sample.tenantId,
    actorUserId: session.user.id,
    action: "WorkOrder.runningHoursFromFluidReport",
    entityType: "WorkOrder",
    entityId: wo.id,
    metadata: {
      workOrderCode: wo.workOrderCode,
      sampleCode: sample.sampleCode,
      runningHoursAtExecution: runningHours,
    },
  });
}

// ── Auto-create Defect from a critical fluid result ──────────────────────────

async function createDefectFromResult(
  prisma: any,
  session: TenantAccessSession,
  sample: any,
  result: any,
  parameters: Record<string, unknown>,
): Promise<string | null> {
  // Pick the worst parameters to surface in the description
  const worstParams = Object.entries(parameters)
    .filter(([, v]) => Number.isFinite(Number(v)))
    .map(([k, v]) => `${k}=${v}`)
    .slice(0, 6)
    .join(", ");

  // Generate next defect code
  const last = await prisma.defect.findFirst({
    where: { tenantId: sample.tenantId, vesselCode: sample.vesselCode },
    orderBy: { createdAt: "desc" },
    select: { defectCode: true },
  });
  let n = 1;
  if (last?.defectCode) {
    const m = last.defectCode.match(/(\d+)$/);
    if (m) n = parseInt(m[1], 10) + 1;
  }
  const defectCode = `DEF-${sample.vesselCode}-${String(n).padStart(4, "0")}`;

  const severity = result.verdict === "ACTION_REQUIRED" ? "CRITICAL" : "HIGH";
  const description = [
    `Análisis de fluido ${sample.sampleCode} (${sample.fluidType}) — Veredicto: ${result.verdict}.`,
    result.summary ? `Resumen del lab: ${result.summary}` : "",
    worstParams ? `Parámetros: ${worstParams}` : "",
  ].filter(Boolean).join(" ");

  const defect = await prisma.defect.create({
    data: {
      tenantId: sample.tenantId,
      vesselCode: sample.vesselCode,
      assetId: sample.assetId,
      defectCode,
      status: "OPEN",
      severity,
      classification: "PREDICTIVE_FLUID_ANALYSIS",
      reportedAt: new Date(),
      description,
      createdByUserId: session.user.id,
      updatedByUserId: session.user.id,
    },
  });

  void publishAudit(prisma, {
    tenantId: sample.tenantId,
    actorUserId: session.user.id,
    action: "Defect.createdFromFluidAnalysis",
    entityType: "Defect",
    entityId: defect.id,
    metadata: { defectCode, sampleCode: sample.sampleCode, vesselCode: sample.vesselCode, severity },
  });

  return defect.id;
}

// ── Auto-create a DRAFT sample from an authorized work order ────────────────
//
// Called from setWorkOrderApproval (step AUTORIZA) when the linked MaintenancePlan
// has a sampling kind/fluid set. The newly created FluidSample is in DRAFT status —
// runningHours/sampledAt are backfilled when the WO closes (closeWorkOrder), and
// the user finishes filling lab data afterwards from the FluidAnalyses page.

export type SampleKindInput = "FLUID" | "VIBRATION" | "THERMAL" | "ULTRASOUND" | "OTHER";

export interface CreateSampleFromWoInput {
  tenantId: string;
  vesselCode: string;
  assetId: string;
  /** Tipo de muestreo. Default FLUID por compat. */
  kind?: SampleKindInput;
  /** Sub-tipo de fluido — solo aplica cuando kind === "FLUID". */
  fluidType?: FluidType | null;
  workOrderId: string;
  workOrderCode: string;
  planId: string | null;
  runningHours: number | null;
  completedAt: Date;
  createdByUserId: string;
}

export async function createFluidSampleFromWorkOrder(input: CreateSampleFromWoInput): Promise<string | null> {
  const prisma = getPrismaClient();
  if (!prisma) return null;

  const sampleCode = await nextSampleCode(prisma as any, input.tenantId, input.vesselCode);
  const kind = input.kind ?? "FLUID";

  const sample = await (prisma as any).fluidSample.create({
    data: {
      tenantId:          input.tenantId,
      vesselCode:        input.vesselCode,
      assetId:           input.assetId,
      sampleCode,
      kind,
      // fluidType solo se setea si el sample es FLUID; para otros kinds queda null.
      fluidType:         kind === "FLUID" ? (input.fluidType ?? null) : null,
      sampledAt:         input.completedAt,
      runningHours:      input.runningHours,
      sampledByUserId:   input.createdByUserId,
      status:            "DRAFT",
      notes:             `Generada automáticamente al autorizar OT ${input.workOrderCode}.`,
      sourceWorkOrderId: input.workOrderId,
      sourcePlanId:      input.planId,
      createdByUserId:   input.createdByUserId,
      updatedByUserId:   input.createdByUserId,
    },
  });

  void publishAudit(prisma, {
    tenantId: input.tenantId,
    actorUserId: input.createdByUserId,
    action: "FluidSample.createdFromWorkOrder",
    entityType: "FluidSample",
    entityId: sample.id,
    metadata: { sampleCode, vesselCode: input.vesselCode, kind, fluidType: input.fluidType ?? null, workOrderCode: input.workOrderCode },
  });

  return sample.id;
}

// ── Trend data: last N samples of an asset, optionally filtered by parameter ─

export interface TrendPoint {
  sampleId: string;
  sampleCode: string;
  sampledAt: string;
  runningHours: number | null;
  verdict: Verdict | null;
  values: Record<string, number>;   // only numeric parameters
}

export async function getAssetFluidTrend(
  session: TenantAccessSession,
  assetId: string,
  fluidType?: FluidType | null,
  limit = 12,
): Promise<{ items: TrendPoint[] }> {
  const prisma = getPrismaClient();
  if (!prisma) return { items: [] };
  const tenantId = await resolveTenantId(session);

  const where: any = { tenantId, assetId, deletedAt: null };
  if (fluidType) where.fluidType = fluidType;

  const samples = await (prisma as any).fluidSample.findMany({
    where,
    orderBy: { sampledAt: "asc" },
    take: limit,
    include: { result: true },
  });

  const items: TrendPoint[] = samples.map((s: any) => {
    const values: Record<string, number> = {};
    const params = s.result?.parameters as Record<string, any> | null;
    if (params) {
      for (const [k, raw] of Object.entries(params)) {
        const v = (raw && typeof raw === "object" && "value" in (raw as any)) ? (raw as any).value : raw;
        const n = typeof v === "number" ? v : Number(v);
        if (Number.isFinite(n)) values[k] = n;
      }
    }
    return {
      sampleId:     s.id,
      sampleCode:   s.sampleCode,
      sampledAt:    s.sampledAt.toISOString(),
      runningHours: s.runningHours,
      verdict:      s.result?.verdict ?? null,
      values,
    };
  });

  return { items };
}

// ── Thresholds CRUD (admin only) ─────────────────────────────────────────────

export async function listThresholds(session: TenantAccessSession, fluidType?: FluidType | null) {
  const prisma = getPrismaClient();
  if (!prisma) return { items: [] };
  const tenantId = await resolveTenantId(session);
  await seedDefaultThresholds(tenantId).catch(() => {});
  const where: any = { tenantId };
  if (fluidType) where.fluidType = fluidType;
  const items = await (prisma as any).fluidParameterThreshold.findMany({
    where,
    orderBy: [{ fluidType: "asc" }, { parameter: "asc" }],
  });
  return { items };
}

export async function upsertThreshold(session: TenantAccessSession, input: {
  fluidType: FluidType; parameter: string; label: string; unit?: string | null;
  cautionMin?: number | null; cautionMax?: number | null;
  criticalMin?: number | null; criticalMax?: number | null;
  direction: "HIGH_BAD" | "LOW_BAD" | "RANGE";
}) {
  if (session.user.role !== "TENANT_ADMIN") {
    throw new RouteError(403, "FORBIDDEN", "Solo el administrador del tenant puede modificar umbrales.");
  }
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const tenantId = await resolveTenantId(session);

  const data = {
    tenantId,
    fluidType: input.fluidType,
    parameter: String(input.parameter || "").trim(),
    label: String(input.label || "").trim(),
    unit: normText(input.unit),
    cautionMin: input.cautionMin ?? null,
    cautionMax: input.cautionMax ?? null,
    criticalMin: input.criticalMin ?? null,
    criticalMax: input.criticalMax ?? null,
    direction: input.direction,
  };
  if (!data.parameter || !data.label) throw new RouteError(400, "FIELD_REQUIRED", "parameter y label son requeridos.");

  const existing = await (prisma as any).fluidParameterThreshold.findFirst({
    where: { tenantId, fluidType: data.fluidType, parameter: data.parameter },
  });
  if (existing) {
    return (prisma as any).fluidParameterThreshold.update({ where: { id: existing.id }, data });
  } else {
    return (prisma as any).fluidParameterThreshold.create({ data });
  }
}

export async function deleteThreshold(session: TenantAccessSession, id: string) {
  if (session.user.role !== "TENANT_ADMIN") {
    throw new RouteError(403, "FORBIDDEN", "Solo el administrador del tenant puede modificar umbrales.");
  }
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const tenantId = await resolveTenantId(session);
  await (prisma as any).fluidParameterThreshold.deleteMany({ where: { id, tenantId } });
  return { ok: true };
}

// ── Seed default thresholds for a tenant ─────────────────────────────────────

export async function seedDefaultThresholds(tenantId: string) {
  const prisma = getPrismaClient();
  if (!prisma) return;
  const existing = await (prisma as any).fluidParameterThreshold.count({ where: { tenantId } });
  if (existing > 0) return;
  const rows = DEFAULT_THRESHOLDS.map(t => ({ ...t, tenantId }));
  await (prisma as any).fluidParameterThreshold.createMany({ data: rows, skipDuplicates: true });
}

const DEFAULT_THRESHOLDS = [
  // Engine oil (4-stroke marine diesel)
  { fluidType: "ENGINE_OIL" as const, parameter: "fe",    label: "Hierro",        unit: "ppm",     cautionMin: null, cautionMax: 80,  criticalMin: null, criticalMax: 150, direction: "HIGH_BAD" as const },
  { fluidType: "ENGINE_OIL" as const, parameter: "cu",    label: "Cobre",         unit: "ppm",     cautionMin: null, cautionMax: 25,  criticalMin: null, criticalMax: 60,  direction: "HIGH_BAD" as const },
  { fluidType: "ENGINE_OIL" as const, parameter: "cr",    label: "Cromo",         unit: "ppm",     cautionMin: null, cautionMax: 10,  criticalMin: null, criticalMax: 25,  direction: "HIGH_BAD" as const },
  { fluidType: "ENGINE_OIL" as const, parameter: "pb",    label: "Plomo",         unit: "ppm",     cautionMin: null, cautionMax: 30,  criticalMin: null, criticalMax: 80,  direction: "HIGH_BAD" as const },
  { fluidType: "ENGINE_OIL" as const, parameter: "si",    label: "Silicio",       unit: "ppm",     cautionMin: null, cautionMax: 15,  criticalMin: null, criticalMax: 35,  direction: "HIGH_BAD" as const },
  { fluidType: "ENGINE_OIL" as const, parameter: "water", label: "Agua",          unit: "%",       cautionMin: null, cautionMax: 0.2, criticalMin: null, criticalMax: 0.5, direction: "HIGH_BAD" as const },
  { fluidType: "ENGINE_OIL" as const, parameter: "fuel",  label: "Dilución comb.",unit: "%",       cautionMin: null, cautionMax: 3,   criticalMin: null, criticalMax: 6,   direction: "HIGH_BAD" as const },
  { fluidType: "ENGINE_OIL" as const, parameter: "tbn",   label: "TBN",           unit: "mgKOH/g", cautionMin: 5,    cautionMax: null, criticalMin: 3,   criticalMax: null, direction: "LOW_BAD" as const },
  { fluidType: "ENGINE_OIL" as const, parameter: "viscosity100", label: "Viscosidad @100°C", unit: "cSt", cautionMin: 12, cautionMax: 16, criticalMin: 10, criticalMax: 18, direction: "RANGE" as const },

  // Hydraulic
  { fluidType: "HYDRAULIC_OIL" as const, parameter: "water", label: "Agua",   unit: "ppm", cautionMin: null, cautionMax: 200,  criticalMin: null, criticalMax: 500, direction: "HIGH_BAD" as const },
  { fluidType: "HYDRAULIC_OIL" as const, parameter: "iso",   label: "ISO 4406 (sumado)", unit: "código", cautionMin: null, cautionMax: 50, criticalMin: null, criticalMax: 60, direction: "HIGH_BAD" as const },
  { fluidType: "HYDRAULIC_OIL" as const, parameter: "viscosity40", label: "Viscosidad @40°C", unit: "cSt", cautionMin: 40, cautionMax: 50, criticalMin: 35, criticalMax: 55, direction: "RANGE" as const },

  // Gearbox
  { fluidType: "GEARBOX_OIL" as const, parameter: "fe",    label: "Hierro", unit: "ppm",  cautionMin: null, cautionMax: 100, criticalMin: null, criticalMax: 200, direction: "HIGH_BAD" as const },
  { fluidType: "GEARBOX_OIL" as const, parameter: "cu",    label: "Cobre",  unit: "ppm",  cautionMin: null, cautionMax: 30,  criticalMin: null, criticalMax: 80,  direction: "HIGH_BAD" as const },
  { fluidType: "GEARBOX_OIL" as const, parameter: "water", label: "Agua",   unit: "%",    cautionMin: null, cautionMax: 0.1, criticalMin: null, criticalMax: 0.3, direction: "HIGH_BAD" as const },

  // Fuel diesel
  { fluidType: "FUEL_DIESEL" as const, parameter: "water",     label: "Agua",          unit: "%",   cautionMin: null, cautionMax: 0.05, criticalMin: null, criticalMax: 0.2, direction: "HIGH_BAD" as const },
  { fluidType: "FUEL_DIESEL" as const, parameter: "sediment",  label: "Sedimentos",    unit: "%",   cautionMin: null, cautionMax: 0.05, criticalMin: null, criticalMax: 0.1, direction: "HIGH_BAD" as const },
  { fluidType: "FUEL_DIESEL" as const, parameter: "sulfur",    label: "Azufre",        unit: "ppm", cautionMin: null, cautionMax: 1000, criticalMin: null, criticalMax: 5000, direction: "HIGH_BAD" as const },
  { fluidType: "FUEL_DIESEL" as const, parameter: "density",   label: "Densidad",      unit: "kg/m³", cautionMin: 820, cautionMax: 860, criticalMin: 810, criticalMax: 870, direction: "RANGE" as const },

  // Cooling water
  { fluidType: "COOLING_WATER" as const, parameter: "ph",        label: "pH",                unit: "", cautionMin: 8.3, cautionMax: 10, criticalMin: 7.5, criticalMax: 11, direction: "RANGE" as const },
  { fluidType: "COOLING_WATER" as const, parameter: "nitrites",  label: "Nitritos",          unit: "ppm", cautionMin: 1000, cautionMax: null, criticalMin: 500, criticalMax: null, direction: "LOW_BAD" as const },
  { fluidType: "COOLING_WATER" as const, parameter: "chlorides", label: "Cloruros",          unit: "ppm", cautionMin: null, cautionMax: 50, criticalMin: null, criticalMax: 100, direction: "HIGH_BAD" as const },

  // Boiler water
  { fluidType: "BOILER_WATER" as const, parameter: "ph",         label: "pH",                unit: "", cautionMin: 9, cautionMax: 11, criticalMin: 8.5, criticalMax: 12, direction: "RANGE" as const },
  { fluidType: "BOILER_WATER" as const, parameter: "alkalinity", label: "Alcalinidad",       unit: "ppm CaCO3", cautionMin: 100, cautionMax: 700, criticalMin: 50, criticalMax: 900, direction: "RANGE" as const },
  { fluidType: "BOILER_WATER" as const, parameter: "silica",     label: "Sílice",            unit: "ppm SiO2", cautionMin: null, cautionMax: 30, criticalMin: null, criticalMax: 100, direction: "HIGH_BAD" as const },

  // Potable water
  { fluidType: "POTABLE_WATER" as const, parameter: "ph",            label: "pH",        unit: "",     cautionMin: 6.5, cautionMax: 8.5, criticalMin: 6, criticalMax: 9, direction: "RANGE" as const },
  { fluidType: "POTABLE_WATER" as const, parameter: "freeChlorine",  label: "Cloro libre", unit: "ppm", cautionMin: 0.2, cautionMax: 1.0, criticalMin: 0.1, criticalMax: 4, direction: "RANGE" as const },
  { fluidType: "POTABLE_WATER" as const, parameter: "coliforms",     label: "Coliformes (UFC/100mL)", unit: "UFC", cautionMin: null, cautionMax: 0.5, criticalMin: null, criticalMax: 1, direction: "HIGH_BAD" as const },
];
