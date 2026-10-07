// Informe de salud de un GRUPO SFI de un buque (pedido de Gustavo, oct 2026).
//
// El botón "Ficha" de la barra del grupo en la Planilla ("G2: Sistemas de Carga"):
// la IA lee todo lo que el sistema tiene de los equipos de ese grupo en los
// últimos 12 meses y redacta una lectura del CONJUNTO. Mismo reparto que el
// informe del equipo (asset-health-service.ts):
//   - Los NÚMEROS los calcula este servicio (sumados en el grupo y por equipo).
//   - La IA sólo REDACTA. No decide cumplimiento, criticidad ni causa raíz.
//
// Qué equipos forman el grupo: los mismos que la Planilla muestra en esa banda.
// Regla de maintenance-sheet-model.ts (buildSheetGroups): el grupo SFI de la
// TAREA (sfiGroupNumber) y, si la tarea no lo trae, el primer dígito del código
// SFI del equipo; sólo planes que no estén INACTIVE. Si cambia esa regla, cambiar
// también `groupOfPlan` acá, o la ficha y la planilla dejan de hablar de lo mismo.
//
// Permisos: los del informe del equipo (`assetHealth.generate` / `assetHealth.view`),
// siempre dentro del alcance por buque del usuario.
import Anthropic from "@anthropic-ai/sdk";
import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { getCachedTenantBySlug } from "../tenant-cache";
import { createAiClient, AI_MODEL, aiApiKey, aiApiKeyName } from "../ai/ai-provider";
import { getTenantAiLocale, localeInstruction, localeUserReminder } from "../ai/ai-locale";
import { getVesselAiContext } from "../ai/vessel-ai-context";
import { recordAiUsage, assertAiBudgetAvailableBySlug } from "../usage/usage-service";
import { loadCurrentHoursNumberByAsset } from "../asset-hours/asset-hours-service";
import { listTenantMaintenancePlans } from "../maintenance-plans/maintenance-plans-service";
import { publishAudit } from "../../platform/audit/audit-publisher";
import { hasPermission } from "../auth/role-permissions";
import {
  HEALTH_STATES, canGenerateAssetHealth,
  type HealthState, type HealthMetrics, type HealthReportText, type HealthSources,
} from "./asset-health-service";

const PERIOD_MONTHS = 12;

/** Mismas etiquetas que la Planilla (claves i18n "sfi.g.N"). */
export const SFI_GROUP_NAMES: Record<number, string> = {
  0: "Inspecciones y Pruebas",
  1: "Casco y Estructuras",
  2: "Sistemas de Carga",
  3: "LCI y Salvamento",
  4: "Sistemas de Navegación",
  5: "Sistemas de Habitabilidad",
  6: "Sistemas de Propulsión y Generación",
  7: "Sistemas Auxiliares",
  8: "Sistemas Eléctricos",
  9: "Sistemas de Automatización y Control",
};

/** Una fila por equipo del grupo: la tabla del informe. Números del sistema. */
export interface GroupEquipmentRow {
  assetId: string;
  assetCode: string;
  name: string | null;
  criticality: string | null;
  isSafetyCritical: boolean;
  status: string | null;
  plansActive: number;
  plansOverdue: number;
  plansDueSoon: number;
  defectsOpen: number;
  labBad: number;
  labCaution: number;
  deferralsActive: number;
  correctiveWorkOrders: number;
  currentHours: number | null;
}

export interface GroupHealthMetrics extends HealthMetrics {
  equipmentCount: number;
  equipment: GroupEquipmentRow[];
}

export interface GroupHealthReportText extends HealthReportText {
  /** Viñetas sobre qué equipos del grupo concentran las señales. */
  equipment: string;
}

// ── Grupo y alcance ──────────────────────────────────────────────────────────

/** Grupo SFI de la tarea como dígito (300 → 3); si falta, el del equipo. */
function groupOfPlan(sfiGroupNumber: number | null | undefined, assetSfiCode: string | null | undefined): number | null {
  if (sfiGroupNumber != null) {
    const d = sfiGroupNumber < 10 ? sfiGroupNumber : Math.floor(sfiGroupNumber / 100);
    if (d >= 0 && d <= 9) return d;
  }
  const c = (assetSfiCode ?? "").trim()[0];
  return c && /^[0-9]$/.test(c) ? Number(c) : null;
}

function parseGroup(raw: string): number {
  const g = Number(raw);
  if (!Number.isInteger(g) || g < 0 || g > 9) throw new RouteError(400, "INVALID_GROUP", "Grupo SFI inválido.");
  return g;
}

function canView(session: TenantAccessSession): boolean {
  return hasPermission(session, "assetHealth.view") || canGenerateAssetHealth(session);
}

async function resolveScope(session: TenantAccessSession, vesselCode: string) {
  const tenant = await getCachedTenantBySlug(session.tenantSlug);
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");
  // El Capitán de un buque no puede leer el grupo de otro buque cambiando la URL.
  if (session.user.role !== "TENANT_ADMIN" && !(session.user.assignedVesselCodes ?? []).includes(vesselCode)) {
    throw new RouteError(404, "NOT_FOUND", "Buque no encontrado.");
  }
  const prisma = getPrismaClient() as any;
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const vessel = await prisma.vessel.findFirst({ where: { tenantId: tenant.id, code: vesselCode }, select: { name: true } });
  if (!vessel) throw new RouteError(404, "NOT_FOUND", "Buque no encontrado.");
  return { prisma, tenantId: tenant.id as string, vesselName: (vessel.name as string | null) ?? null };
}

// ── Lectura ──────────────────────────────────────────────────────────────────

export async function listGroupHealthReports(session: TenantAccessSession, vesselCode: string, groupRaw: string) {
  if (!canView(session)) throw new RouteError(403, "FORBIDDEN", "Sin permiso para ver informes de salud.");
  const sfiGroup = parseGroup(groupRaw);
  const { prisma, tenantId } = await resolveScope(session, vesselCode);
  const items = await prisma.assetGroupHealthReport.findMany({
    where: { tenantId, vesselCode, sfiGroup },
    orderBy: { createdAt: "desc" },
    select: { id: true, healthState: true, periodFrom: true, periodTo: true, createdAt: true, createdByName: true },
    take: 100,
  });
  return { items, canGenerate: canGenerateAssetHealth(session) };
}

export async function getGroupHealthReport(session: TenantAccessSession, vesselCode: string, groupRaw: string, reportId: string) {
  if (!canView(session)) throw new RouteError(403, "FORBIDDEN", "Sin permiso para ver informes de salud.");
  const sfiGroup = parseGroup(groupRaw);
  const { prisma, tenantId, vesselName } = await resolveScope(session, vesselCode);
  const report = await prisma.assetGroupHealthReport.findFirst({ where: { id: reportId, tenantId, vesselCode, sfiGroup } });
  if (!report) throw new RouteError(404, "NOT_FOUND", "Informe no encontrado.");
  return {
    ...report,
    group: { sfiGroup, name: SFI_GROUP_NAMES[sfiGroup] ?? "", vesselCode, vesselName },
  };
}

// ── Generación ───────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Sos un superintendente técnico naval con experiencia en mantenimiento planificado (PMS), análisis de aceite y vibraciones, y gestión de defectos según el Código ISM (cap. 10).

Vas a recibir en JSON TODO lo que el sistema de mantenimiento registra de los equipos de UN GRUPO SFI de un buque (por ejemplo "Sistemas de Carga") en los últimos 12 meses: la lista de equipos con sus números, el plan de mantenimiento del grupo, órdenes de trabajo, ejecuciones, análisis de laboratorio, defectos, postergaciones, inspecciones, MOC, horas de marcha y alertas automáticas. Cada registro indica a qué equipo pertenece ("equipo": código). "metricas" trae números YA CALCULADOS por el sistema, sumados en el grupo; "equipos" trae los mismos números por equipo.

Tu tarea: redactar un INFORME DE SALUD DEL GRUPO para el superintendente: cómo está el conjunto, qué equipos concentran las señales y qué conviene revisar primero.

Devolvé EXCLUSIVAMENTE este JSON, sin markdown alrededor:
{
  "healthState": "GOOD" | "ATTENTION" | "RISK",
  "summary": string,          // 3 a 5 frases: estado general del grupo y por qué
  "equipment": string,        // viñetas "- ": los equipos que requieren atención, uno por viñeta, el más comprometido primero; cerrá con una viñeta que diga cuántos equipos están sin novedades
  "maintenance": string,      // viñetas "- " sobre cumplimiento del plan del grupo, vencidas, OT correctivas, postergaciones
  "lab": string,              // viñetas "- " sobre análisis de aceite y vibraciones y su evolución
  "defects": string,          // viñetas "- " sobre defectos abiertos, repetidos (en un equipo o entre equipos gemelos), RCA
  "recommendations": string[],// 2 a 6 sugerencias concretas, una frase cada una, la más importante primero
  "limitations": string       // 1 o 2 frases: qué datos faltan o limitan la lectura (ej. equipos sin plan, sin lecturas de horas)
}

CRITERIO DE healthState DEL GRUPO (lectura prudente, no un dictamen):
- RISK: al menos un equipo del grupo en situación de riesgo: defecto abierto de severidad CRITICAL/HIGH con el equipo degradado o fuera de servicio, análisis en CRITICAL/ACTION_REQUIRED sin intervención posterior, o tareas vencidas de un equipo crítico para la seguridad (ISM 10.3).
- ATTENTION: alguna señal a seguir en uno o más equipos (análisis en precaución o en rojo con acción en curso, defectos abiertos, tareas vencidas, postergaciones activas, correctivos repetidos).
- GOOD: plan del grupo al día, sin defectos abiertos relevantes y laboratorio normal.

REGLAS:
- Usá SÓLO los datos del JSON. No inventes valores, fechas, códigos ni eventos. Si una sección no tiene datos, decilo en una viñeta ("- Sin análisis de laboratorio en el período.").
- Los números de "metricas" y "equipos" son exactos: si los citás, citalos iguales. No recalcules.
- Nombrá cada equipo por su nombre y, entre paréntesis, su código la primera vez. Citá los códigos de OT, defectos, planes y muestras cuando ayuden a ubicar el dato.
- Los estados, veredictos y severidades vienen como códigos en inglés (CRITICAL, ACTION_REQUIRED, CAUTION, OVERDUE, HIGH…): escribilos con palabras en el idioma del informe (Crítico, Acción requerida, Precaución, Vencida, Alta…), nunca el código.
- Nombrá al buque por su NOMBRE, nunca por su código.
- Sos un asistente: SUGERÍS. No declares cumplimiento normativo, no asignes causa raíz como hecho, no cambies la criticidad. Usá "conviene", "revisar", "puede estar relacionado".
- Adaptá las sugerencias al buque (con o sin tripulación, según "sobreElBuque").
- Relacioná señales entre equipos cuando la evidencia lo permita (ej. la misma falla en dos bombas gemelas), marcándolo como hipótesis.
- Redactá en forma impersonal: no menciones que el texto lo generó una IA o un asistente, ni te nombres a vos mismo.
- Tono técnico y directo. Cada viñeta de una o dos líneas. Total aproximado: 500 palabras.`;

const ACTIVE_DEFECT = ["OPEN", "UNDER_REVIEW", "IN_PROGRESS", "DEFERRED"];
const ACTIVE_DEFERRAL = ["REQUESTED", "UNDER_REVIEW", "APPROVED", "ACTIVE"];
const DUE_SOON = new Set(["DUE", "IN_WINDOW", "UPCOMING"]);

type PlanRow = {
  id: string; assetId: string; status: string; sfiGroupNumber: number | null;
  taskCode: string; title: string; taskType: string | null; triggerType: string | null;
  frequencyMonths: number | null; frequencyHours: number | null; executionStatus: string | null;
  nextDueDate: string | Date | null; nextDueHours: number | null;
  lastExecutionDate: string | Date | null; lastExecutionHours: number | null;
};

export async function generateGroupHealthReport(session: TenantAccessSession, vesselCode: string, groupRaw: string) {
  if (!canGenerateAssetHealth(session)) {
    throw new RouteError(403, "FORBIDDEN", "Sólo el DPA y el Superintendente pueden generar informes de salud.");
  }
  const apiKey = aiApiKey();
  if (!apiKey) throw new RouteError(503, "AI_NOT_CONFIGURED", aiApiKeyName() + " no esta configurada.");
  const sfiGroup = parseGroup(groupRaw);
  const { prisma, tenantId, vesselName } = await resolveScope(session, vesselCode);
  await assertAiBudgetAvailableBySlug(session.tenantSlug);

  const periodTo = new Date();
  const periodFrom = new Date(periodTo);
  periodFrom.setMonth(periodFrom.getMonth() - PERIOD_MONTHS);
  const inPeriod = { gte: periodFrom };

  // ── Equipos del grupo (misma regla que la Planilla) ──
  const allPlans = (await listTenantMaintenancePlans(session, { vesselCode }) as unknown as PlanRow[])
    .filter(p => p.status !== "INACTIVE");
  const vesselAssetIds = [...new Set(allPlans.map(p => p.assetId))];
  const assetRows = vesselAssetIds.length === 0 ? [] : await prisma.asset.findMany({
    where: { id: { in: vesselAssetIds }, tenantId, vesselCode, deletedAt: null },
    select: {
      id: true, assetCode: true, name: true, sfiCode: true, criticality: true, status: true,
      manufacturer: true, model: true, isSafetyCritical: true, isStandby: true,
    },
  });
  const assetById = new Map<string, any>(assetRows.map((a: any) => [a.id, a]));
  const plans = allPlans.filter(p => assetById.has(p.assetId) && groupOfPlan(p.sfiGroupNumber, assetById.get(p.assetId)?.sfiCode) === sfiGroup);
  const assetIds = [...new Set(plans.map(p => p.assetId))];
  if (assetIds.length === 0) throw new RouteError(404, "EMPTY_GROUP", "El grupo no tiene equipos con plan en este buque.");
  const assets = assetIds.map(id => assetById.get(id)!);
  const codeOf = (id: string | null | undefined) => (id ? assetById.get(id)?.assetCode ?? null : null);
  const activePlans = plans.filter(p => p.status === "ACTIVE");
  const planIds = plans.map(p => p.id);
  const base = { tenantId, vesselCode };
  const inGroup = { in: assetIds };

  // ── Datos ── (topes más altos que el informe del equipo: son varios equipos)
  const workOrders = await prisma.workOrder.findMany({
    where: {
      ...base, deletedAt: null,
      AND: [
        { OR: [{ assetId: inGroup }, { planLinks: { some: { maintenancePlanId: { in: planIds } } } }] },
        { OR: [{ openDate: inPeriod }, { completedDate: inPeriod }, { status: { notIn: ["CLOSED", "CANCELLED"] } }] },
      ],
    },
    orderBy: { openDate: "desc" },
    take: 150,
    select: {
      workOrderCode: true, assetId: true, type: true, status: true, priority: true, maintenanceKind: true,
      title: true, description: true, openDate: true, dueDate: true, completedDate: true,
      woResult: true, observations: true, closeNotes: true,
    },
  });

  const workLogs = await prisma.workLog.findMany({
    where: { ...base, assetId: inGroup, workOrderId: null, startedAt: inPeriod },
    orderBy: { startedAt: "desc" },
    take: 80,
    select: { logCode: true, assetId: true, result: true, startedAt: true, completedAt: true, notes: true, followUpRequired: true, maintenancePlan: { select: { taskCode: true, title: true } } },
  });

  const samples = await prisma.fluidSample.findMany({
    where: { ...base, assetId: inGroup, deletedAt: null, sampledAt: inPeriod },
    orderBy: { sampledAt: "desc" },
    take: 80,
    select: {
      sampleCode: true, assetId: true, kind: true, fluidType: true, sampledAt: true, runningHours: true, status: true,
      result: { select: { verdict: true, summary: true } },
    },
  });

  const defects = await prisma.defect.findMany({
    where: { ...base, assetId: inGroup, deletedAt: null, OR: [{ reportedAt: inPeriod }, { status: { in: ACTIVE_DEFECT } }] },
    orderBy: { reportedAt: "desc" },
    take: 80,
    select: { defectCode: true, assetId: true, status: true, severity: true, operationalState: true, reportedAt: true, description: true, rcaRootCause: true },
  });

  const deferrals = await prisma.deferral.findMany({
    where: { ...base, assetId: inGroup, deletedAt: null, OR: [{ requestedAt: inPeriod }, { status: { in: ACTIVE_DEFERRAL } }] },
    orderBy: { requestedAt: "desc" },
    take: 40,
    select: { deferralCode: true, assetId: true, status: true, deferralType: true, requestedAt: true, targetDate: true, toNextDrydock: true, justification: true, riskLevel: true },
  });

  const inspections = await prisma.inspection.findMany({
    where: { ...base, assetId: inGroup, deletedAt: null, OR: [{ completedAt: inPeriod }, { scheduledAt: inPeriod }] },
    orderBy: { scheduledAt: "desc" },
    take: 30,
    select: { inspectionCode: true, assetId: true, type: true, status: true, result: true, scheduledAt: true, completedAt: true, notes: true },
  });
  const inspectionExecs = await prisma.inspectionExecution.findMany({
    where: { ...base, assetId: inGroup, deletedAt: null, OR: [{ completedAt: inPeriod }, { scheduledAt: inPeriod }] },
    orderBy: { scheduledAt: "desc" },
    take: 30,
    select: { executionCode: true, assetId: true, status: true, result: true, scheduledAt: true, completedAt: true, generalObservations: true },
  });

  const mocs = await prisma.mocRecord.findMany({
    where: { ...base, relatedAssetId: inGroup, deletedAt: null, createdAt: inPeriod },
    orderBy: { createdAt: "desc" },
    take: 15,
    select: { mocCode: true, relatedAssetId: true, title: true, status: true, category: true, riskLevel: true, createdAt: true, implementedAt: true },
  });

  const hoursReadingsCount = await prisma.assetHoursReading.count({ where: { tenantId, assetId: inGroup, readingDate: inPeriod } });
  const currentHours = await loadCurrentHoursNumberByAsset(prisma, tenantId, assetIds);

  const alerts = await prisma.aiInsight.findMany({
    where: { tenantId, targetType: "ASSET", targetId: inGroup, status: "OPEN" },
    take: 20,
    select: { targetId: true, insightType: true, priority: true, title: true, summary: true },
  });

  // ── Números: los calcula el sistema ──
  const woInPeriod = (w: any) => w.openDate >= periodFrom || (w.completedDate && w.completedDate >= periodFrom);
  const equipment: GroupEquipmentRow[] = assets.map((a: any) => {
    const ap = activePlans.filter(p => p.assetId === a.id);
    const as = samples.filter((s: any) => s.assetId === a.id);
    return {
      assetId: a.id, assetCode: a.assetCode, name: a.name ?? null,
      criticality: a.criticality ?? null, isSafetyCritical: !!a.isSafetyCritical, status: a.status ?? null,
      plansActive: ap.length,
      plansOverdue: ap.filter(p => p.executionStatus === "OVERDUE").length,
      plansDueSoon: ap.filter(p => DUE_SOON.has(String(p.executionStatus))).length,
      defectsOpen: defects.filter((d: any) => d.assetId === a.id && ACTIVE_DEFECT.includes(d.status)).length,
      labBad: as.filter((s: any) => ["CRITICAL", "ACTION_REQUIRED"].includes(s.result?.verdict)).length,
      labCaution: as.filter((s: any) => s.result?.verdict === "CAUTION").length,
      deferralsActive: deferrals.filter((d: any) => d.assetId === a.id && ACTIVE_DEFERRAL.includes(d.status)).length,
      correctiveWorkOrders: workOrders.filter((w: any) => w.assetId === a.id && w.type === "CORRECTIVE" && w.openDate >= periodFrom).length,
      currentHours: currentHours.get(a.id) ?? null,
    };
  });
  // Los equipos que más preocupan, primero (mismo orden en pantalla y PDF).
  const weight = (r: GroupEquipmentRow) => r.labBad * 100 + r.plansOverdue * 10 + r.defectsOpen * 10 + r.labCaution * 3 + r.deferralsActive * 3 + r.plansDueSoon;
  equipment.sort((x, y) => weight(y) - weight(x) || x.assetCode.localeCompare(y.assetCode));

  const metrics: GroupHealthMetrics = {
    plansActive: activePlans.length,
    plansOverdue: activePlans.filter(p => p.executionStatus === "OVERDUE").length,
    plansDueSoon: activePlans.filter(p => DUE_SOON.has(String(p.executionStatus))).length,
    workOrdersInPeriod: workOrders.filter(woInPeriod).length,
    workOrdersOpen: workOrders.filter((w: any) => !["CLOSED", "CANCELLED"].includes(w.status)).length,
    correctiveWorkOrders: workOrders.filter((w: any) => w.type === "CORRECTIVE" && w.openDate >= periodFrom).length,
    defectsOpen: defects.filter((d: any) => ACTIVE_DEFECT.includes(d.status)).length,
    defectsInPeriod: defects.filter((d: any) => d.reportedAt >= periodFrom).length,
    labInPeriod: samples.filter((s: any) => s.result).length,
    labBad: samples.filter((s: any) => ["CRITICAL", "ACTION_REQUIRED"].includes(s.result?.verdict)).length,
    labCaution: samples.filter((s: any) => s.result?.verdict === "CAUTION").length,
    deferralsActive: deferrals.filter((d: any) => ACTIVE_DEFERRAL.includes(d.status)).length,
    // Horas: no se suman horómetros de equipos distintos; van por equipo en la tabla.
    currentHours: null,
    currentHoursDate: null,
    equipmentCount: equipment.length,
    equipment,
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
    hoursReadings: hoursReadingsCount,
    alerts: alerts.length,
  };

  const d = (v: unknown) => (v ? new Date(v as string).toISOString().slice(0, 10) : null);
  const cut = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
  const groupName = SFI_GROUP_NAMES[sfiGroup] ?? "";

  const payload = {
    periodo: { desde: d(periodFrom), hasta: d(periodTo) },
    buque: vesselName,
    sobreElBuque: await getVesselAiContext(session.tenantSlug, vesselCode),
    grupo: { numero: sfiGroup, nombre: groupName },
    metricas: { ...metrics, equipment: undefined },
    equipos: equipment.map(r => {
      const a = assetById.get(r.assetId);
      return {
        codigo: r.assetCode, nombre: r.name, fabricante: a?.manufacturer ?? null, modelo: a?.model ?? null,
        criticidad: r.criticality, criticoSeguridadISM103: r.isSafetyCritical, deReserva: !!a?.isStandby, estado: r.status,
        tareasActivas: r.plansActive, vencidas: r.plansOverdue, porVencer: r.plansDueSoon, defectosAbiertos: r.defectsOpen,
        laboratorioRojo: r.labBad, laboratorioPrecaucion: r.labCaution, postergacionesActivas: r.deferralsActive,
        otCorrectivas: r.correctiveWorkOrders, horasActuales: r.currentHours,
      };
    }),
    planDeMantenimiento: activePlans.map(p => ({
      equipo: codeOf(p.assetId), tarea: p.taskCode, titulo: p.title, disparo: p.triggerType,
      frecuenciaMeses: p.frequencyMonths, frecuenciaHoras: p.frequencyHours,
      estado: p.executionStatus, proximaFecha: d(p.nextDueDate), proximaHoras: p.nextDueHours, ultimaEjecucion: d(p.lastExecutionDate),
    })),
    ordenesDeTrabajo: workOrders.map((w: any) => ({
      codigo: w.workOrderCode, equipo: codeOf(w.assetId), tipo: w.type, clase: w.maintenanceKind, estado: w.status, prioridad: w.priority,
      titulo: w.title, descripcion: cut(w.description, 180), apertura: d(w.openDate), cierre: d(w.completedDate),
      resultado: cut(w.woResult, 150), observaciones: cut(w.observations, 180),
    })),
    ejecucionesSinOT: workLogs.map((l: any) => ({
      codigo: l.logCode, equipo: codeOf(l.assetId), plan: l.maintenancePlan?.taskCode ?? null,
      resultado: l.result, fecha: d(l.completedAt ?? l.startedAt), seguimiento: l.followUpRequired, notas: cut(l.notes, 150),
    })),
    analisisDeLaboratorio: samples.map((s: any) => ({
      muestra: s.sampleCode, equipo: codeOf(s.assetId), tipo: s.kind, fluido: s.fluidType, fecha: d(s.sampledAt), horas: s.runningHours,
      estado: s.status, veredicto: s.result?.verdict ?? null, resumen: cut(s.result?.summary, 300),
    })),
    defectos: defects.map((x: any) => ({
      codigo: x.defectCode, equipo: codeOf(x.assetId), estado: x.status, severidad: x.severity, estadoOperativo: x.operationalState,
      reportado: d(x.reportedAt), descripcion: cut(x.description, 250), causaRaiz: cut(x.rcaRootCause, 200),
    })),
    postergaciones: deferrals.map((x: any) => ({
      codigo: x.deferralCode, equipo: codeOf(x.assetId), estado: x.status, tipo: x.deferralType, pedida: d(x.requestedAt),
      hasta: d(x.targetDate), hastaVarada: x.toNextDrydock, riesgo: x.riskLevel, justificacion: cut(x.justification, 180),
    })),
    inspecciones: [
      ...inspections.map((x: any) => ({ codigo: x.inspectionCode, equipo: codeOf(x.assetId), tipo: x.type, estado: x.status, resultado: x.result, fecha: d(x.completedAt ?? x.scheduledAt), notas: cut(x.notes, 150) })),
      ...inspectionExecs.map((x: any) => ({ codigo: x.executionCode, equipo: codeOf(x.assetId), tipo: "CHECKLIST", estado: x.status, resultado: x.result, fecha: d(x.completedAt ?? x.scheduledAt), notas: cut(x.generalObservations, 150) })),
    ],
    moc: mocs.map((x: any) => ({ codigo: x.mocCode, equipo: codeOf(x.relatedAssetId), titulo: x.title, estado: x.status, riesgo: x.riskLevel, fecha: d(x.createdAt), implementado: d(x.implementedAt) })),
    alertasAutomaticas: alerts.map((a: any) => ({ equipo: codeOf(a.targetId), tipo: a.insightType, prioridad: a.priority, titulo: a.title, resumen: cut(a.summary, 200) })),
  };

  // ── IA ──
  const locale = await getTenantAiLocale(session.tenantSlug);
  const model = AI_MODEL.deep;
  const client = createAiClient({ apiKey, timeout: 180_000, maxRetries: 1 });
  const started = Date.now();
  const response = await client.messages.create({
    model,
    max_tokens: 8000,
    // Mismo motivo que asset-health-service: sin razonamiento, o se gasta el presupuesto sin texto.
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
    vesselCode,
    feature: "asset_group_health_report",
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
  const report: GroupHealthReportText = {
    summary: text(parsed.summary),
    equipment: text(parsed.equipment),
    maintenance: text(parsed.maintenance),
    lab: text(parsed.lab),
    defects: text(parsed.defects),
    recommendations: Array.isArray(parsed.recommendations)
      ? parsed.recommendations.map(text).filter(Boolean).slice(0, 6)
      : [],
    limitations: text(parsed.limitations),
  };
  if (!report.summary) {
    throw new RouteError(502, "AI_EMPTY", "La IA no devolvió el informe. Probá generarlo de nuevo.");
  }
  const healthState: HealthState = HEALTH_STATES.includes(parsed.healthState) ? parsed.healthState : "ATTENTION";

  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { firstName: true, lastName: true, email: true } });
  const createdByName = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || user?.email || session.user.email;

  const saved = await prisma.assetGroupHealthReport.create({
    data: {
      tenantId, vesselCode, sfiGroup,
      healthState, periodFrom, periodTo,
      metrics: metrics as any, report: report as any, sources: sources as any,
      locale, model,
      createdByUserId: session.user.id, createdByName,
    },
  });

  void publishAudit(prisma, {
    tenantId,
    actorUserId: session.user.id,
    action: "AssetGroupHealthReport.generated",
    entityType: "Vessel",
    entityId: vesselCode,
    metadata: { reportId: saved.id, vesselCode, sfiGroup, equipmentCount: equipment.length, healthState },
  });

  return getGroupHealthReport(session, vesselCode, String(sfiGroup), saved.id);
}
