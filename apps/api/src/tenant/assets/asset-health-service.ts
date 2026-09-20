// Informe de salud de un equipo (Preview V43).
//
// Un botón en la ficha del equipo: la IA lee todo lo que el sistema tiene de ese
// equipo en los últimos 12 meses y redacta una lectura de su estado. Cada informe
// queda GUARDADO y no se modifica; "generar nuevo" agrega otro al historial.
//
// Reparto de responsabilidades, a propósito:
//   - Los NÚMEROS (vencidas, defectos abiertos, análisis en rojo, horas) los
//     calcula este servicio con consultas exactas y se guardan en `metrics`.
//   - La IA sólo REDACTA: lectura general, secciones y sugerencias. No decide
//     cumplimiento, criticidad ni causa raíz (regla del copiloto): sugiere, y el
//     informe lo dice.
//
// Quién: generar = `assetHealth.generate` (DPA y Superintendente por defecto);
// ver el historial = `assetHealth.view` (además el Capitán / Jefe de Máquinas).
// Siempre dentro del alcance por buque del usuario.
import Anthropic from "@anthropic-ai/sdk";
import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { hasPermission } from "../auth/role-permissions";
import { getCachedTenantBySlug } from "../tenant-cache";
import { createAiClient, AI_MODEL, aiApiKey, aiApiKeyName } from "../ai/ai-provider";
import { getTenantAiLocale, localeInstruction, localeUserReminder } from "../ai/ai-locale";
import { getVesselAiContext } from "../ai/vessel-ai-context";
import { recordAiUsage, assertAiBudgetAvailableBySlug } from "../usage/usage-service";
import { loadCurrentHoursForAsset } from "../asset-hours/asset-hours-service";
import { listTenantMaintenancePlans } from "../maintenance-plans/maintenance-plans-service";
import { publishAudit } from "../../platform/audit/audit-publisher";

export const HEALTH_STATES = ["GOOD", "ATTENTION", "RISK"] as const;
export type HealthState = typeof HEALTH_STATES[number];

/** Meses hacia atrás que lee el informe (acordado con Gustavo en la Preview V43). */
const PERIOD_MONTHS = 12;

export interface HealthMetrics {
  plansActive: number;
  plansOverdue: number;
  plansDueSoon: number;
  workOrdersInPeriod: number;
  workOrdersOpen: number;
  correctiveWorkOrders: number;
  defectsOpen: number;
  defectsInPeriod: number;
  labInPeriod: number;
  labBad: number;
  labCaution: number;
  deferralsActive: number;
  currentHours: number | null;
  currentHoursDate: string | null;
}

export interface HealthReportText {
  summary: string;
  maintenance: string;
  lab: string;
  defects: string;
  recommendations: string[];
  limitations: string;
}

export interface HealthSources {
  plans: number;
  workOrders: number;
  workLogs: number;
  labAnalyses: number;
  defects: number;
  deferrals: number;
  inspections: number;
  mocs: number;
  hoursReadings: number;
  alerts: number;
}

// ── Permisos y alcance ───────────────────────────────────────────────────────

export function canGenerateAssetHealth(session: TenantAccessSession): boolean {
  return hasPermission(session, "assetHealth.generate");
}

function canViewAssetHealth(session: TenantAccessSession): boolean {
  return hasPermission(session, "assetHealth.view") || canGenerateAssetHealth(session);
}

async function resolveTenantId(session: TenantAccessSession): Promise<string> {
  const tenant = await getCachedTenantBySlug(session.tenantSlug);
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");
  return tenant.id;
}

/**
 * El equipo, verificando tenant Y buque. `getTenantAsset` sólo filtra por
 * tenant; acá no alcanza: el Capitán de un buque no puede leer el informe de un
 * equipo de otro buque cambiando el id en la URL.
 */
async function loadScopedAsset(prisma: any, session: TenantAccessSession, tenantId: string, assetId: string) {
  const asset = await prisma.asset.findFirst({
    where: { id: assetId, tenantId, deletedAt: null },
    select: {
      id: true, vesselCode: true, assetCode: true, name: true, sfiCode: true,
      criticality: true, status: true, manufacturer: true, model: true, serialNumber: true,
      installationDate: true, lastOverhaulDate: true, isSafetyCritical: true, isStandby: true,
      planNotRequired: true, planNotRequiredReason: true, criticalityRationale: true,
    },
  });
  if (!asset) throw new RouteError(404, "NOT_FOUND", "Equipo no encontrado.");
  if (session.user.role !== "TENANT_ADMIN" && !(session.user.assignedVesselCodes ?? []).includes(asset.vesselCode)) {
    throw new RouteError(404, "NOT_FOUND", "Equipo no encontrado.");
  }
  return asset;
}

// ── Lectura ──────────────────────────────────────────────────────────────────

export async function listAssetHealthReports(session: TenantAccessSession, assetId: string) {
  if (!canViewAssetHealth(session)) throw new RouteError(403, "FORBIDDEN", "Sin permiso para ver informes de salud.");
  const prisma = getPrismaClient() as any;
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const tenantId = await resolveTenantId(session);
  await loadScopedAsset(prisma, session, tenantId, assetId);

  const items = await prisma.assetHealthReport.findMany({
    where: { tenantId, assetId },
    orderBy: { createdAt: "desc" },
    select: { id: true, healthState: true, periodFrom: true, periodTo: true, createdAt: true, createdByName: true },
    take: 100,
  });
  return { items, canGenerate: canGenerateAssetHealth(session) };
}

export async function getAssetHealthReport(session: TenantAccessSession, assetId: string, reportId: string) {
  if (!canViewAssetHealth(session)) throw new RouteError(403, "FORBIDDEN", "Sin permiso para ver informes de salud.");
  const prisma = getPrismaClient() as any;
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const tenantId = await resolveTenantId(session);
  const asset = await loadScopedAsset(prisma, session, tenantId, assetId);

  const report = await prisma.assetHealthReport.findFirst({ where: { id: reportId, tenantId, assetId } });
  if (!report) throw new RouteError(404, "NOT_FOUND", "Informe no encontrado.");
  const vessel = await prisma.vessel.findFirst({ where: { tenantId, code: asset.vesselCode }, select: { name: true } });
  return {
    ...report,
    asset: { id: asset.id, assetCode: asset.assetCode, name: asset.name, vesselCode: asset.vesselCode, vesselName: vessel?.name ?? null },
  };
}

// ── Generación ───────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Sos un superintendente técnico naval con experiencia en mantenimiento planificado (PMS), análisis de aceite y vibraciones, y gestión de defectos según el Código ISM (cap. 10).

Vas a recibir en JSON TODO lo que el sistema de mantenimiento registra de UN equipo en los últimos 12 meses: ficha, plan de mantenimiento con su estado, órdenes de trabajo, ejecuciones, análisis de laboratorio, defectos, postergaciones, inspecciones, MOC, horas de marcha y alertas automáticas. Además, "metricas" trae números YA CALCULADOS por el sistema.

Tu tarea: redactar un INFORME DE SALUD del equipo para el superintendente.

Devolvé EXCLUSIVAMENTE este JSON, sin markdown alrededor:
{
  "healthState": "GOOD" | "ATTENTION" | "RISK",
  "summary": string,          // 3 a 5 frases: estado general y por qué
  "maintenance": string,      // viñetas "- " sobre cumplimiento del plan, vencidas, OT correctivas, postergaciones
  "lab": string,              // viñetas "- " sobre análisis de aceite y vibraciones y su evolución
  "defects": string,          // viñetas "- " sobre defectos abiertos, repetidos, RCA
  "recommendations": string[],// 2 a 5 sugerencias concretas, una frase cada una, la más importante primero
  "limitations": string       // 1 o 2 frases: qué datos faltan o limitan la lectura
}

CRITERIO DE healthState (lectura prudente, no un dictamen):
- RISK: defecto abierto de severidad CRITICAL/HIGH con el equipo degradado o fuera de servicio, análisis en CRITICAL/ACTION_REQUIRED sin intervención posterior, o tareas vencidas de un equipo crítico para la seguridad (ISM 10.3).
- ATTENTION: alguna señal a seguir (análisis en precaución o en rojo con acción en curso, defectos abiertos, tareas vencidas, postergaciones activas, correctivos repetidos).
- GOOD: plan al día, sin defectos abiertos relevantes y laboratorio normal.

REGLAS:
- Usá SÓLO los datos del JSON. No inventes valores, fechas, códigos ni eventos. Si una sección no tiene datos, decilo en una viñeta ("- Sin análisis de laboratorio en el período.").
- Los números de "metricas" son exactos: si los citás, citalos iguales. No recalcules.
- Citá los códigos de OT, defectos, planes y muestras cuando ayuden a ubicar el dato (ej. "DEF-LTE-0024").
- Los estados, veredictos y severidades vienen como códigos en inglés (CRITICAL, ACTION_REQUIRED, CAUTION, OVERDUE, HIGH…): escribilos con palabras en el idioma del informe (Crítico, Acción requerida, Precaución, Vencida, Alta…), nunca el código.
- Nombrá al buque por su NOMBRE, nunca por su código.
- Sos un asistente: SUGERÍS. No declares cumplimiento normativo, no asignes causa raíz como hecho, no cambies la criticidad. Usá "conviene", "revisar", "puede estar relacionado".
- Adaptá las sugerencias al buque (con o sin tripulación, según "sobreElBuque") y al alcance del equipo.
- Relacioná señales cuando la evidencia lo permita (ej. vibraciones en alerta y hierro en alza en el aceite del mismo equipo), marcándolo como hipótesis.
- Redactá en forma impersonal: no menciones que el texto lo generó una IA o un asistente, ni te nombres a vos mismo.
- Tono técnico y directo. Cada viñeta de una o dos líneas. Total aproximado: 400 palabras.`;

const ACTIVE_DEFECT = ["OPEN", "UNDER_REVIEW", "IN_PROGRESS", "DEFERRED"];
const ACTIVE_DEFERRAL = ["REQUESTED", "UNDER_REVIEW", "APPROVED", "ACTIVE"];
const DUE_SOON = new Set(["DUE", "IN_WINDOW", "UPCOMING"]);

export async function generateAssetHealthReport(session: TenantAccessSession, assetId: string) {
  if (!canGenerateAssetHealth(session)) {
    throw new RouteError(403, "FORBIDDEN", "Sólo el DPA y el Superintendente pueden generar informes de salud.");
  }
  const apiKey = aiApiKey();
  if (!apiKey) throw new RouteError(503, "AI_NOT_CONFIGURED", aiApiKeyName() + " no esta configurada.");
  const prisma = getPrismaClient() as any;
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const tenantId = await resolveTenantId(session);
  const asset = await loadScopedAsset(prisma, session, tenantId, assetId);
  await assertAiBudgetAvailableBySlug(session.tenantSlug);

  const periodTo = new Date();
  const periodFrom = new Date(periodTo);
  periodFrom.setMonth(periodFrom.getMonth() - PERIOD_MONTHS);
  const inPeriod = { gte: periodFrom };
  const base = { tenantId, vesselCode: asset.vesselCode };

  const vessel = await prisma.vessel.findFirst({ where: { tenantId, code: asset.vesselCode }, select: { name: true } });

  // ── Datos ──
  // Planes: el service deriva el executionStatus vigente (el guardado se queda viejo).
  const plans = await listTenantMaintenancePlans(session, { assetId, status: "ACTIVE" }) as unknown as Array<{
    taskCode: string; title: string; taskType: string | null; triggerType: string | null;
    frequencyMonths: number | null; frequencyHours: number | null; executionStatus: string | null;
    nextDueDate: string | Date | null; nextDueHours: number | null;
    lastExecutionDate: string | Date | null; lastExecutionHours: number | null;
    samplingKind?: string | null;
  }>;

  // OT del equipo: las que lo tienen como equipo principal y las que ejecutan un
  // plan suyo (una OT de varada o de muestreo cubre varios equipos).
  const workOrders = await prisma.workOrder.findMany({
    where: {
      ...base, deletedAt: null,
      AND: [
        { OR: [{ assetId }, { planLinks: { some: { maintenancePlan: { assetId } } } }] },
        { OR: [{ openDate: inPeriod }, { completedDate: inPeriod }, { status: { notIn: ["CLOSED", "CANCELLED"] } }] },
      ],
    },
    orderBy: { openDate: "desc" },
    take: 80,
    select: {
      workOrderCode: true, type: true, status: true, priority: true, maintenanceKind: true,
      title: true, description: true, openDate: true, dueDate: true, completedDate: true,
      woResult: true, observations: true, closeNotes: true, runningHoursAtExecution: true,
    },
  });

  const workLogs = await prisma.workLog.findMany({
    where: { ...base, assetId, workOrderId: null, startedAt: inPeriod },
    orderBy: { startedAt: "desc" },
    take: 50,
    select: { logCode: true, taskType: true, result: true, startedAt: true, completedAt: true, notes: true, followUpRequired: true, maintenancePlan: { select: { taskCode: true, title: true } } },
  });

  const samples = await prisma.fluidSample.findMany({
    where: { ...base, assetId, deletedAt: null, sampledAt: inPeriod },
    orderBy: { sampledAt: "desc" },
    take: 40,
    select: {
      sampleCode: true, kind: true, fluidType: true, sampledAt: true, runningHours: true, status: true, labName: true,
      result: { select: { verdict: true, summary: true, parameters: true } },
    },
  });

  const defects = await prisma.defect.findMany({
    where: { ...base, assetId, deletedAt: null, OR: [{ reportedAt: inPeriod }, { status: { in: ACTIVE_DEFECT } }] },
    orderBy: { reportedAt: "desc" },
    take: 40,
    select: { defectCode: true, status: true, severity: true, operationalState: true, reportedAt: true, description: true, rcaRootCause: true, classification: true },
  });

  const deferrals = await prisma.deferral.findMany({
    where: { ...base, assetId, deletedAt: null, OR: [{ requestedAt: inPeriod }, { status: { in: ACTIVE_DEFERRAL } }] },
    orderBy: { requestedAt: "desc" },
    take: 20,
    select: { deferralCode: true, status: true, deferralType: true, requestedAt: true, targetDate: true, toNextDrydock: true, justification: true, riskLevel: true },
  });

  const inspections = await prisma.inspection.findMany({
    where: { ...base, assetId, deletedAt: null, OR: [{ completedAt: inPeriod }, { scheduledAt: inPeriod }] },
    orderBy: { scheduledAt: "desc" },
    take: 20,
    select: { inspectionCode: true, type: true, status: true, result: true, scheduledAt: true, completedAt: true, notes: true },
  });
  const inspectionExecs = await prisma.inspectionExecution.findMany({
    where: { ...base, assetId, deletedAt: null, OR: [{ completedAt: inPeriod }, { scheduledAt: inPeriod }] },
    orderBy: { scheduledAt: "desc" },
    take: 20,
    select: { executionCode: true, status: true, result: true, scheduledAt: true, completedAt: true, generalObservations: true },
  });

  const mocs = await prisma.mocRecord.findMany({
    where: { ...base, relatedAssetId: assetId, deletedAt: null, createdAt: inPeriod },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { mocCode: true, title: true, status: true, category: true, riskLevel: true, createdAt: true, implementedAt: true },
  });

  const hoursReadings = await prisma.assetHoursReading.findMany({
    where: { tenantId, assetId, readingDate: inPeriod },
    orderBy: { readingDate: "desc" },
    take: 24,
    select: { readingDate: true, runningHours: true, source: true },
  });
  const current = await loadCurrentHoursForAsset(prisma, tenantId, assetId);

  const alerts = await prisma.aiInsight.findMany({
    where: { tenantId, targetType: "ASSET", targetId: assetId, status: "OPEN" },
    take: 10,
    select: { insightType: true, priority: true, title: true, summary: true },
  });

  // ── Números: los calcula el sistema ──
  const metrics: HealthMetrics = {
    plansActive: plans.length,
    plansOverdue: plans.filter(p => p.executionStatus === "OVERDUE").length,
    plansDueSoon: plans.filter(p => DUE_SOON.has(String(p.executionStatus))).length,
    workOrdersInPeriod: workOrders.filter((w: any) => w.openDate >= periodFrom || (w.completedDate && w.completedDate >= periodFrom)).length,
    workOrdersOpen: workOrders.filter((w: any) => !["CLOSED", "CANCELLED"].includes(w.status)).length,
    correctiveWorkOrders: workOrders.filter((w: any) => w.type === "CORRECTIVE" && w.openDate >= periodFrom).length,
    defectsOpen: defects.filter((d: any) => ACTIVE_DEFECT.includes(d.status)).length,
    defectsInPeriod: defects.filter((d: any) => d.reportedAt >= periodFrom).length,
    labInPeriod: samples.filter((s: any) => s.result).length,
    labBad: samples.filter((s: any) => ["CRITICAL", "ACTION_REQUIRED"].includes(s.result?.verdict)).length,
    labCaution: samples.filter((s: any) => s.result?.verdict === "CAUTION").length,
    deferralsActive: deferrals.filter((d: any) => ACTIVE_DEFERRAL.includes(d.status)).length,
    currentHours: current?.runningHours ?? null,
    currentHoursDate: current?.readingDate ? new Date(current.readingDate).toISOString().slice(0, 10) : null,
  };

  const sources: HealthSources = {
    plans: plans.length,
    workOrders: workOrders.length,
    workLogs: workLogs.length,
    labAnalyses: samples.length,
    defects: defects.length,
    deferrals: deferrals.length,
    inspections: inspections.length + inspectionExecs.length,
    mocs: mocs.length,
    hoursReadings: hoursReadings.length,
    alerts: alerts.length,
  };

  const d = (v: unknown) => (v ? new Date(v as string).toISOString().slice(0, 10) : null);
  const cut = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);

  const payload = {
    periodo: { desde: d(periodFrom), hasta: d(periodTo) },
    buque: vessel?.name ?? null,
    sobreElBuque: await getVesselAiContext(session.tenantSlug, asset.vesselCode),
    equipo: {
      codigo: asset.assetCode, nombre: asset.name, sfi: asset.sfiCode,
      fabricante: asset.manufacturer, modelo: asset.model, serie: asset.serialNumber,
      criticidad: asset.criticality, justificacionCriticidad: cut(asset.criticalityRationale, 300),
      criticoSeguridadISM103: asset.isSafetyCritical, deReserva: asset.isStandby,
      estado: asset.status, instalacion: d(asset.installationDate), ultimoOverhaul: d(asset.lastOverhaulDate),
      sinPlanPorDecision: asset.planNotRequired ? (asset.planNotRequiredReason ?? true) : false,
    },
    metricas: metrics,
    planDeMantenimiento: plans.map(p => ({
      tarea: p.taskCode, titulo: p.title, tipo: p.taskType, disparo: p.triggerType,
      frecuenciaMeses: p.frequencyMonths, frecuenciaHoras: p.frequencyHours,
      estado: p.executionStatus, proximaFecha: d(p.nextDueDate), proximaHoras: p.nextDueHours,
      ultimaEjecucion: d(p.lastExecutionDate), ultimaEjecucionHoras: p.lastExecutionHours,
    })),
    ordenesDeTrabajo: workOrders.map((w: any) => ({
      codigo: w.workOrderCode, tipo: w.type, clase: w.maintenanceKind, estado: w.status, prioridad: w.priority,
      titulo: w.title, descripcion: cut(w.description, 250), apertura: d(w.openDate), vence: d(w.dueDate),
      cierre: d(w.completedDate), horas: w.runningHoursAtExecution,
      resultado: cut(w.woResult, 200), observaciones: cut(w.observations, 250), notasCierre: cut(w.closeNotes, 200),
    })),
    ejecucionesSinOT: workLogs.map((l: any) => ({
      codigo: l.logCode, plan: l.maintenancePlan?.taskCode ?? null, titulo: l.maintenancePlan?.title ?? null,
      resultado: l.result, fecha: d(l.completedAt ?? l.startedAt), seguimiento: l.followUpRequired, notas: cut(l.notes, 200),
    })),
    analisisDeLaboratorio: samples.map((s: any) => ({
      muestra: s.sampleCode, tipo: s.kind, fluido: s.fluidType, fecha: d(s.sampledAt), horas: s.runningHours,
      laboratorio: s.labName, estado: s.status, veredicto: s.result?.verdict ?? null,
      resumen: cut(s.result?.summary, 400), parametros: s.result?.parameters ?? null,
    })),
    defectos: defects.map((x: any) => ({
      codigo: x.defectCode, estado: x.status, severidad: x.severity, estadoOperativo: x.operationalState,
      reportado: d(x.reportedAt), origen: x.classification, descripcion: cut(x.description, 350), causaRaiz: cut(x.rcaRootCause, 250),
    })),
    postergaciones: deferrals.map((x: any) => ({
      codigo: x.deferralCode, estado: x.status, tipo: x.deferralType, pedida: d(x.requestedAt),
      hasta: d(x.targetDate), hastaVarada: x.toNextDrydock, riesgo: x.riskLevel, justificacion: cut(x.justification, 250),
    })),
    inspecciones: [
      ...inspections.map((x: any) => ({ codigo: x.inspectionCode, tipo: x.type, estado: x.status, resultado: x.result, fecha: d(x.completedAt ?? x.scheduledAt), notas: cut(x.notes, 200) })),
      ...inspectionExecs.map((x: any) => ({ codigo: x.executionCode, tipo: "CHECKLIST", estado: x.status, resultado: x.result, fecha: d(x.completedAt ?? x.scheduledAt), notas: cut(x.generalObservations, 200) })),
    ],
    moc: mocs.map((x: any) => ({ codigo: x.mocCode, titulo: x.title, estado: x.status, categoria: x.category, riesgo: x.riskLevel, fecha: d(x.createdAt), implementado: d(x.implementedAt) })),
    horasDeMarcha: hoursReadings.map((h: any) => ({ fecha: d(h.readingDate), horas: h.runningHours, origen: h.source })),
    alertasAutomaticas: alerts.map((a: any) => ({ tipo: a.insightType, prioridad: a.priority, titulo: a.title, resumen: cut(a.summary, 250) })),
  };

  // ── IA ──
  const locale = await getTenantAiLocale(session.tenantSlug);
  const model = AI_MODEL.deep;
  const client = createAiClient({ apiKey, timeout: 120_000, maxRetries: 1 });
  const started = Date.now();
  const response = await client.messages.create({
    model,
    max_tokens: 6000,
    // Sonnet 5 trae el razonamiento activo por defecto y puede gastar todo el
    // presupuesto sin emitir texto (ver fluid-analyses-ai-insights.ts).
    thinking: { type: "disabled" },
    system: [
      { type: "text", text: localeInstruction(locale) },
      { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content: `${localeUserReminder(locale)}\n${JSON.stringify(payload)}` }],
  } as any) as Anthropic.Message;

  recordAiUsage({
    tenantId,
    tenantSlug: session.tenantSlug,
    userId: session.user.id,
    userEmail: session.user.email,
    vesselCode: asset.vesselCode,
    feature: "asset_health_report",
    model,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
    latencyMs: Date.now() - started,
  });

  const raw = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map(b => b.text).join("\n").trim()
    .replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new RouteError(502, "AI_PARSE_ERROR", "La IA devolvió una respuesta inválida. Probá generar el informe de nuevo.");
  }

  const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const report: HealthReportText = {
    summary: text(parsed.summary),
    maintenance: text(parsed.maintenance),
    lab: text(parsed.lab),
    defects: text(parsed.defects),
    recommendations: Array.isArray(parsed.recommendations)
      ? parsed.recommendations.map(text).filter(Boolean).slice(0, 5)
      : [],
    limitations: text(parsed.limitations),
  };
  if (!report.summary) {
    throw new RouteError(502, "AI_EMPTY", "La IA no devolvió el informe. Probá generarlo de nuevo.");
  }
  const healthState: HealthState = HEALTH_STATES.includes(parsed.healthState) ? parsed.healthState : "ATTENTION";

  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { firstName: true, lastName: true, email: true } });
  const createdByName = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || user?.email || session.user.email;

  const saved = await prisma.assetHealthReport.create({
    data: {
      tenantId, vesselCode: asset.vesselCode, assetId,
      healthState, periodFrom, periodTo,
      metrics: metrics as any, report: report as any, sources: sources as any,
      locale, model,
      createdByUserId: session.user.id, createdByName,
    },
  });

  void publishAudit(prisma, {
    tenantId,
    actorUserId: session.user.id,
    action: "AssetHealthReport.generated",
    entityType: "Asset",
    entityId: assetId,
    metadata: { reportId: saved.id, assetCode: asset.assetCode, vesselCode: asset.vesselCode, healthState },
  });

  return getAssetHealthReport(session, assetId, saved.id);
}
