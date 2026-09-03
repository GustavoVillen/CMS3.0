// TMSA Elemento 4 — Reliability & Maintenance Standards.
//
// Lente de evidencia read-only sobre datos que YA existen en el PMS. NO agrega
// dato nuevo ni schema: consolida, por buque, los sub-requisitos del Elemento 4
// (y los adyacentes de mantenimiento: MOC = Elem 7, Defectos/RCA = Elem 8) que un
// inspector / vetting quiere ver.
//
// Importante: NO calcula un "nivel TMSA" oficial (eso lo autoevalúa la compañía).
// Cada grupo devuelve métricas crudas + un semáforo determinístico (OK/ATTENTION/
// GAP/INFO). El frontend/PDF formatea y traduce por `key`.
//
// Reusa la lógica ya probada de compliance-service (woComplianceRate, scope por
// buque con chequeo anti-bypass) y sidebar-counts-service (estados de cada módulo,
// stock crítico vía stock-calc-service) para mantener coherencia de números.

import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { listVesselsInScope } from "../compliance/compliance-service";
import { getOnHandMap } from "../pms/stock-calc-service";
import { resolveComputedStatus } from "../certificates/certificates-service";

export type TmsaStatus = "OK" | "ATTENTION" | "GAP" | "INFO";

export interface TmsaMetric {
  /** clave estable → label vía i18n `tmsa.metric.<key>` */
  key: string;
  value: number;
  /** cómo formatear en el frontend/PDF */
  kind: "count" | "pct";
}

export interface TmsaGroup {
  /** clave estable → título vía i18n `tmsa.group.<key>` */
  key: string;
  /** referencia TMSA mostrada literal (ej. "4.1", "7", "8") */
  element: string;
  status: TmsaStatus;
  metrics: TmsaMetric[];
  /** Lo que falta, en orden de gravedad. Vacío = nada pendiente. */
  findings: TmsaFinding[];
}

/**
 * Qué es exactamente lo que falta en un grupo de evidencia.
 *
 * El semáforo dice "hay una brecha"; el hallazgo dice CUÁL, y con eso la
 * pantalla arma la ventana de "qué está mal / cómo se arregla" y el PDF su
 * bloque de diagnóstico. Se emite acá, junto al cálculo del estado, para que el
 * texto y el color no puedan contradecirse: son la misma condición.
 *
 * El backend manda la clave; el texto y los pasos son i18n (`tmsa.fix.<key>.*`
 * en web-modern). El panel ISM reusa tal cual los hallazgos de los grupos que
 * hereda, con su propio texto (`ism.fix.<key>.*`).
 */
export interface TmsaFinding {
  key: string;
  /** Cuántos registros lo tienen, o el porcentaje según `kind`. */
  value: number;
  kind: "count" | "pct";
  status: Exclude<TmsaStatus, "OK">;
}

/** Azúcar para armar la lista de hallazgos sin repetir el objeto entero. */
function finding(
  key: string,
  value: number,
  status: Exclude<TmsaStatus, "OK">,
  kind: "count" | "pct" = "count",
): TmsaFinding {
  return { key, value, kind, status };
}

export interface TmsaVesselEvidence {
  /** Código del buque, o "" cuando el item consolida toda la flota. */
  vesselCode: string;
  vesselName: string;
  /** Cuántos buques entraron en el cálculo (1 salvo en el item de flota). */
  vesselCount: number;
  summary: { ok: number; attention: number; gap: number; info: number };
  groups: TmsaGroup[];
}

/**
 * "fleet"     → un solo item con los totales de todos los buques del alcance.
 * "perVessel" → un item por buque (lo que necesita el PDF, que imprime el
 *               desglose para el auditor).
 *
 * Pedir un buque puntual da lo mismo en los dos modos: un item, ese buque.
 */
export type TmsaEvidenceMode = "fleet" | "perVessel";

// ── Thresholds (ajustables) ──────────────────────────────────────────────────
const PMS_COVERAGE_GAP = 0.90;        // cobertura de PMS por debajo → GAP
const PMS_COVERAGE_ATTENTION = 0.98;  // por debajo → ATTENTION
// Exportados: el panel ISM arma con ellos el diagnóstico de la cláusula 10.4
// (qué está mal / cómo se arregla). Un solo umbral para el semáforo y el texto.
export const WO_COMPLIANCE_GAP = 0.75;       // % OT en plazo por debajo → GAP
export const WO_COMPLIANCE_ATTENTION = 0.85; // por debajo → ATTENTION
const CRITICAL_OVERDUE_DAYS = 30;     // OT crítica vencida hace +N días
/** OT todavía sin cerrar. Mismo criterio que las métricas de 4.3. */
const OPEN_WO_STATUSES = ["PLANNED", "IN_PROGRESS"];
// Tope del detalle por métrica (/app/tmsa/maintenance/detail). Lo consume el
// filtro de las planillas (web: lib/tmsa-filter.tsx): si se corta, la planilla
// mostraría menos filas de las que dice la tarjeta, así que el cartel lo avisa.
const DETAIL_CAP = 1000;

// Diferimientos ya otorgados: el mismo conjunto que ofrece el importador de la
// Especificación de Varada (drydock-spec-items-service). Tienen que coincidir,
// si no el panel marca una brecha que la pantalla no deja cerrar.
const DEFERRAL_GRANTED: readonly string[] = ["APPROVED", "ACTIVE", "EXPIRED"];

// ── helpers ──────────────────────────────────────────────────────────────────
function clamp01(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  return n > 1 ? 1 : n;
}
async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}
function count(status: TmsaStatus, worst: TmsaStatus): TmsaStatus {
  // devuelve el peor de dos estados (GAP > ATTENTION > OK > INFO)
  const rank: Record<TmsaStatus, number> = { GAP: 3, ATTENTION: 2, OK: 1, INFO: 0 };
  return rank[status] >= rank[worst] ? status : worst;
}

interface Delegate {
  count(a: { where: Record<string, unknown> }): Promise<number>;
  findMany(a: unknown): Promise<unknown[]>;
}

export async function getTmsaMaintenanceEvidence(
  session: TenantAccessSession,
  vesselCode: string | null,
  mode: TmsaEvidenceMode = "fleet",
): Promise<{ items: TmsaVesselEvidence[] }> {
  const prisma = getPrismaClient();
  if (!prisma) return { items: [] };
  // El nombre visible de la empresa vive en TenantSetting.displayName; titula el
  // bloque de flota (CLAUDE.md: nombres, no códigos).
  const tenant = await prisma.tenant.findUnique({
    where: { slug: session.tenantSlug },
    include: { settings: { select: { displayName: true } } },
  });
  if (!tenant) return { items: [] };

  const vessels = await listVesselsInScope(prisma, session, tenant.id, vesselCode);
  if (vessels.length === 0) return { items: [] };

  // Sin buque pedido y en modo flota: UN item con los totales de todo el
  // alcance. No se suman las tarjetas de cada buque — se corre la misma consulta
  // con `vesselCode IN (...)`, porque los porcentajes (cobertura, % OT en plazo)
  // no se pueden promediar sin mentir.
  if (mode === "fleet" && vessels.length > 1) {
    const fleetName = tenant.settings?.displayName ?? session.tenantSlug.toUpperCase();
    return { items: [await computeOne(prisma, tenant.id, vessels, fleetName)] };
  }

  // Todos los buques en paralelo: el costo de la pantalla no crece en serie
  // con el tamaño de la flota.
  const items = await Promise.all(vessels.map((v) => computeOne(prisma, tenant.id, [v], v.name)));
  return { items };
}

/**
 * Filtro "esta OT es de equipo crítico".
 *
 * La criticidad que manda es la del ACTIVO. `WorkOrder.criticality` es un campo
 * propio de la orden, de carga manual y con default "B": las OT que genera un
 * plan nunca lo completan, así que filtrar sólo por él dejaba fuera la mayor
 * parte del mantenimiento vencido sobre equipo crítico. Cuenta la OT marcada A
 * a mano Y la que cuelga de un activo de criticidad A.
 *
 * Se usa igual en la tarjeta y en el detalle: si divergen, el número del panel
 * deja de coincidir con la lista que abre.
 */
function criticalWoWhere(criticalAssetIds: string[]): Record<string, unknown> {
  if (criticalAssetIds.length === 0) return { criticality: "A" };
  return { OR: [{ criticality: "A" }, { assetId: { in: criticalAssetIds } }] };
}

/** Ids de los activos de criticidad A del alcance, para `criticalWoWhere`. */
async function criticalAssetIdsOf(
  p: { asset: { findMany(a: unknown): Promise<unknown[]> } },
  base: Record<string, unknown>,
): Promise<string[]> {
  const rows = await safe(
    () => p.asset.findMany({ where: { ...base, criticality: "A" }, select: { id: true } }) as Promise<Array<{ id: string }>>,
    [] as Array<{ id: string }>,
  );
  return rows.map(a => a.id);
}

async function computeOne(
  prisma: NonNullable<ReturnType<typeof getPrismaClient>>,
  tenantId: string,
  /** Uno solo, o todos los del alcance cuando el item consolida la flota. */
  vesselsIn: Array<{ code: string; name: string; vesselType: string | null }>,
  /** Título del bloque: el nombre del buque, o el de la empresa para la flota. */
  displayName: string,
): Promise<TmsaVesselEvidence> {
  const now = new Date();
  const d90 = new Date(now.getTime() - 90 * 86_400_000);
  const d60 = new Date(now.getTime() - 60 * 86_400_000);
  const dCritical = new Date(now.getTime() - CRITICAL_OVERDUE_DAYS * 86_400_000);
  const d365 = new Date(now.getTime() - 365 * 86_400_000);
  // Un buque o todos los del alcance: el mismo `where` sirve para los dos casos.
  const vesselCodes = vesselsIn.map(v => v.code);
  const scope = vesselCodes.length === 1 ? vesselCodes[0]! : { in: vesselCodes };
  const base = { tenantId, vesselCode: scope, deletedAt: null };

  const p = prisma as unknown as {
    asset: Delegate;
    maintenancePlan: Delegate;
    workOrder: Delegate;
    deferral: Delegate;
    spare: Delegate;
    spareRequest: Delegate;
    fluidAnalysisResult: Delegate;
    defect: Delegate & { groupBy(a: unknown): Promise<Array<{ assetId: string | null; _count: { _all: number } }>> };
    mocRecord: Delegate;
    certificate: Delegate;
    inspection: Delegate;
    permitToWork: Delegate;
    drydockSpec: Delegate;
  };

  const groups: TmsaGroup[] = [];

  // Planes de auditoría de ingeniería del buque (los crea
  // scripts/load-superintendent-audit-plan.ts, código `<BUQUE>-AUD-ING-NN`).
  // Hace falta antes del resto para poder contar SÓLO las OT que salen de esa
  // auditoría: si se contara toda OT de inspección, entrarían las inspecciones
  // de rutina del plan de mantenimiento y el indicador mentiría.
  const auditPlanIds = (await safe(
    () => p.maintenancePlan.findMany({
      // El código es `<BUQUE>-AUD-ING-NN`; con varios buques no sirve un
      // startsWith, y el prefijo ya lo garantiza el filtro de vesselCode.
      where: { ...base, taskCode: { contains: "-AUD-ING" } },
      select: { id: true },
    }) as Promise<Array<{ id: string }>>,
    [] as Array<{ id: string }>,
  )).map(pl => pl.id);

  // Ids de los activos de criticidad A del alcance. Hacen falta antes del resto
  // por la misma razón que los planes de auditoría: las métricas de "equipo
  // crítico" filtran por ellos.
  const criticalAssetIds = await criticalAssetIdsOf(p, base);

  // Todas las consultas son independientes entre sí: se disparan juntas y se
  // espera una sola vez (antes eran ~20 idas a la base en serie POR BUQUE).
  const [
    assetsTotal, plans, criticalAssets, safetyCritical, criticalOverdueWo,
    closed, woOpen, woOverdue, woCriticalOverdue, plansOverdue,
    active, sparesCriticalA, requestsPending, plansWithSampling, analysesOutOfRange,
    defectsWithRca, defectsGrouped, mocOpen, mocPendingImpl,
    certificateRows, inspectionRows, defectsTotal, defectsStaleOpen, permitsTotal, permitsDraftStuck,
    drydockSpecs, engineeringAuditRows, assetsPlanNotRequiredRows,
  ] = await Promise.all([
    safe(() => p.asset.count({ where: { ...base } }), 0),
    // Activos con ≥1 plan activo (distinct assetId).
    safe(
      () => p.maintenancePlan.findMany({ where: { ...base, status: "ACTIVE" }, select: { assetId: true } }) as Promise<Array<{ assetId: string }>>,
      [] as Array<{ assetId: string }>,
    ),
    safe(() => p.asset.count({ where: { ...base, criticality: "A" } }), 0),
    safe(() => p.asset.count({ where: { ...base, isSafetyCritical: true } }), 0),
    // OTs abiertas de criticidad A vencidas (mantenimiento de equipo crítico sin ejecutar).
    safe(() => p.workOrder.count({
      where: { ...base, status: { in: ["PLANNED", "IN_PROGRESS"] }, ...criticalWoWhere(criticalAssetIds), dueDate: { lt: now } },
    }), 0),
    // % OT cerradas en plazo (últimos 90d) — misma lógica que compliance-service.
    safe(
      () => p.workOrder.findMany({
        where: { ...base, status: "CLOSED", completedDate: { gte: d90 } },
        select: { completedDate: true, dueDate: true },
      }) as Promise<Array<{ completedDate: Date | null; dueDate: Date | null }>>,
      [] as Array<{ completedDate: Date | null; dueDate: Date | null }>,
    ),
    safe(() => p.workOrder.count({ where: { ...base, status: { in: ["PLANNED", "IN_PROGRESS"] } } }), 0),
    safe(() => p.workOrder.count({ where: { ...base, status: { in: ["PLANNED", "IN_PROGRESS"] }, dueDate: { lt: now } } }), 0),
    safe(() => p.workOrder.count({ where: { ...base, status: { in: ["PLANNED", "IN_PROGRESS"] }, ...criticalWoWhere(criticalAssetIds), dueDate: { lt: dCritical } } }), 0),
    safe(() => p.maintenancePlan.count({ where: { ...base, status: "OVERDUE" } }), 0),
    safe(
      () => p.deferral.findMany({
        where: { ...base, status: { notIn: ["CLOSED", "EXPIRED", "REJECTED"] } },
        select: { id: true, riskLevel: true, decisionAt: true, status: true, targetDate: true, expiredAt: true },
      }) as Promise<Array<{ id: string; riskLevel: string | null; decisionAt: Date | null; status: string; targetDate: Date | null; expiredAt: Date | null }>>,
      [] as Array<{ id: string; riskLevel: string | null; decisionAt: Date | null; status: string; targetDate: Date | null; expiredAt: Date | null }>,
    ),
    // Spares criticidad A con onHand < minStock — misma lógica que sidebar-counts.
    safe(
      () => p.spare.findMany({
        where: { ...base, criticality: "A", status: "ACTIVE" },
        select: { id: true, minStock: true },
      }) as Promise<Array<{ id: string; minStock: number }>>,
      [] as Array<{ id: string; minStock: number }>,
    ),
    safe(() => p.spareRequest.count({ where: { tenantId, deletedAt: null, status: { in: ["DRAFT", "SUBMITTED"] } } }), 0),
    safe(() => p.maintenancePlan.count({ where: { ...base, status: "ACTIVE", samplingKind: { not: null } } }), 0),
    // Análisis de fluidos fuera de rango (verdict crítico) del buque, últimos 90d.
    safe(() => p.fluidAnalysisResult.count({
      where: { tenantId, verdict: { in: ["CRITICAL", "ACTION_REQUIRED"] }, receivedAt: { gte: d90 }, sample: { vesselCode: scope, deletedAt: null } },
    }), 0),
    safe(() => p.defect.count({ where: { ...base, rcaApprovedAt: { not: null } } }), 0),
    // Activos con defectos recurrentes (≥3 en 60d) — misma lógica que getSmartAlerts.
    safe(
      () => p.defect.groupBy({
        by: ["assetId"],
        where: { ...base, reportedAt: { gte: d60 } },
        _count: { _all: true },
        having: { assetId: { _count: { gte: 3 } } },
      }),
      [] as Array<{ assetId: string | null; _count: { _all: number } }>,
    ),
    safe(() => p.mocRecord.count({ where: { ...base, status: { notIn: ["REVIEWED", "REJECTED", "CANCELLED"] } } }), 0),
    safe(() => p.mocRecord.count({ where: { ...base, status: { in: ["APPROVED", "IN_PROGRESS"] } } }), 0),
    // Certificados del buque — status EXPIRED/EXPIRING_SOON se recalcula en JS
    // con la misma función que usa el módulo de Certificados (single source of truth).
    // Hay que traer también el status guardado: un certificado SUSPENDIDO o
    // CERRADO no es un vencimiento aunque su fecha ya haya pasado, y contarlo
    // como tal hacía que este panel contradijera a la pantalla de Certificados.
    safe(
      () => p.certificate.findMany({ where: { ...base }, select: { expiryDate: true, status: true } }) as Promise<Array<{ expiryDate: Date; status: string }>>,
      [] as Array<{ expiryDate: Date; status: string }>,
    ),
    // Una inspección del PMS es una ORDEN DE TRABAJO de tipo INSPECTION,
    // abierta desde un ítem del plan (es lo que lista la pantalla Inspecciones,
    // ver pages/Inspections.tsx). El modelo `Inspection` pertenece al motor de
    // plantillas de checklist, que está dormido por decisión de producto: leerlo
    // acá hacía que el panel dijera "no hay inspecciones cargadas" con veinte
    // inspecciones hechas en pantalla.
    safe(
      () => p.workOrder.findMany({
        where: { ...base, type: "INSPECTION" },
        select: { status: true, dueDate: true },
      }) as Promise<Array<{ status: string; dueDate: Date | null }>>,
      [] as Array<{ status: string; dueDate: Date | null }>,
    ),
    safe(() => p.defect.count({ where: { ...base } }), 0),
    safe(() => p.defect.count({ where: { ...base, status: "OPEN", reportedAt: { lt: d60 } } }), 0),
    safe(() => p.permitToWork.count({ where: { ...base } }), 0),
    safe(() => p.permitToWork.count({ where: { ...base, status: "DRAFT", createdAt: { lt: d60 } } }), 0),
    // Especificaciones de varada del buque (sin las anuladas) con sus ítems:
    // sirven para 4.2.4 (existe el documento) y 4.4.2 (los diferidos entran en él).
    safe(
      () => p.drydockSpec.findMany({
        where: { ...base, status: { not: "CANCELLED" } },
        select: {
          status: true,
          items: { select: { itemStatus: true, sourceType: true, sourceId: true } },
        },
      }) as Promise<Array<{ status: string; items: Array<{ itemStatus: string; sourceType: string; sourceId: string | null }> }>>,
      [] as Array<{ status: string; items: Array<{ itemStatus: string; sourceType: string; sourceId: string | null }> }>,
    ),
    // Auditorías de ingeniería del último año: las OT ya cerradas que salieron
    // del plan de auditoría. La condición operativa dice cuáles se hicieron con
    // el buque en marcha, que es lo que TMSA pide observar.
    auditPlanIds.length === 0 ? Promise.resolve([] as Array<{ operatingCondition: string | null }>) : safe(
      () => p.workOrder.findMany({
        where: { ...base, status: "CLOSED", completedDate: { gte: d365 }, maintenancePlanId: { in: auditPlanIds } },
        select: { operatingCondition: true },
      }) as Promise<Array<{ operatingCondition: string | null }>>,
      [] as Array<{ operatingCondition: string | null }>,
    ),
    // Equipos con la excepción declarada "no requiere plan de mantenimiento".
    // No son una brecha de cobertura: son una decisión escrita.
    safe(
      () => p.asset.findMany({ where: { ...base, planNotRequired: true }, select: { id: true } }) as Promise<Array<{ id: string }>>,
      [] as Array<{ id: string }>,
    ),
  ]);

  const certificatesTotal = certificateRows.length;
  const certificatesExpired = certificateRows.filter(c => resolveComputedStatus(c.expiryDate, c.status) === "EXPIRED").length;
  const certificatesExpiringSoon = certificateRows.filter(c => resolveComputedStatus(c.expiryDate, c.status) === "EXPIRING_SOON").length;
  const inspectionsTotal = inspectionRows.length;
  const inspectionsOverdue = inspectionRows.filter(
    i => OPEN_WO_STATUSES.includes(i.status) && i.dueDate && new Date(i.dueDate) < now,
  ).length;

  // ── 4.1 · Cobertura del PMS ────────────────────────────────────────────────
  {
    // Los equipos con la excepción declarada salen del cálculo: no llevan plan
    // por decisión escrita, así que contarlos como brecha castigaría al que
    // documentó su estrategia de mantenimiento en vez de al que la omitió.
    const exempt = new Set(assetsPlanNotRequiredRows.map(a => a.id));
    const assetsExempt = exempt.size;
    const assetsRequiringPlan = Math.max(0, assetsTotal - assetsExempt);
    const assetsWithPlan = new Set(plans.map(pl => pl.assetId).filter(id => !exempt.has(id))).size;
    const assetsWithoutPlan = Math.max(0, assetsRequiringPlan - assetsWithPlan);
    const coverage = assetsRequiringPlan === 0 ? 1 : assetsWithPlan / assetsRequiringPlan;
    const status: TmsaStatus =
      assetsTotal === 0 ? "INFO" :
      coverage < PMS_COVERAGE_GAP ? "GAP" :
      coverage < PMS_COVERAGE_ATTENTION ? "ATTENTION" : "OK";
    const findings: TmsaFinding[] = [];
    if (assetsTotal === 0) findings.push(finding("pmsNothing", 0, "INFO"));
    else if (coverage < PMS_COVERAGE_ATTENTION) {
      findings.push(finding("assetsWithoutPlan", assetsWithoutPlan, coverage < PMS_COVERAGE_GAP ? "GAP" : "ATTENTION"));
    }

    groups.push({
      key: "pmsCoverage", element: "4.1", status, findings,
      metrics: [
        { key: "assetsTotal", value: assetsTotal, kind: "count" },
        { key: "assetsWithPlan", value: assetsWithPlan, kind: "count" },
        { key: "assetsWithoutPlan", value: assetsWithoutPlan, kind: "count" },
        ...(assetsExempt > 0 ? [{ key: "assetsPlanNotRequired", value: assetsExempt, kind: "count" as const }] : []),
        { key: "coverage", value: clamp01(coverage), kind: "pct" },
      ],
    });
  }

  // ── 4.2 · Equipo crítico ───────────────────────────────────────────────────
  {
    const status: TmsaStatus =
      criticalAssets === 0 && safetyCritical === 0 ? "INFO" :
      criticalOverdueWo > 0 ? "GAP" : "OK";
    const findings: TmsaFinding[] = [];
    if (criticalAssets === 0 && safetyCritical === 0) findings.push(finding("criticalNothing", 0, "INFO"));
    else if (criticalOverdueWo > 0) findings.push(finding("criticalOverdueWo", criticalOverdueWo, "GAP"));

    groups.push({
      key: "criticalEquipment", element: "4.2", status, findings,
      metrics: [
        { key: "criticalAssets", value: criticalAssets, kind: "count" },
        { key: "safetyCritical", value: safetyCritical, kind: "count" },
        { key: "criticalOverdueWo", value: criticalOverdueWo, kind: "count" },
      ],
    });
  }

  // ── 4.3 · Cumplimiento de mantenimiento planificado ────────────────────────
  {
    const closedOnTime = closed.filter(w => w.completedDate && w.dueDate && new Date(w.completedDate) <= new Date(w.dueDate)).length;
    const woComplianceRate = closed.length === 0 ? 1 : closedOnTime / closed.length;
    let status: TmsaStatus =
      woComplianceRate < WO_COMPLIANCE_GAP ? "GAP" :
      woComplianceRate < WO_COMPLIANCE_ATTENTION ? "ATTENTION" : "OK";
    if (woCriticalOverdue > 0) status = "GAP";
    else if (woOverdue > 0) status = count("ATTENTION", status);
    // Estos tres hallazgos los reusa el panel ISM en su cláusula 10.4.
    const findings: TmsaFinding[] = [];
    if (woCriticalOverdue > 0) findings.push(finding("woCriticalOverdue", woCriticalOverdue, "GAP"));
    if (woOverdue > 0) findings.push(finding("woOverdue", woOverdue, "ATTENTION"));
    if (woComplianceRate < WO_COMPLIANCE_ATTENTION) {
      findings.push(finding("woComplianceLow", clamp01(woComplianceRate), woComplianceRate < WO_COMPLIANCE_GAP ? "GAP" : "ATTENTION", "pct"));
    }

    groups.push({
      key: "plannedMaintenance", element: "4.3", status, findings,
      metrics: [
        { key: "woComplianceRate", value: clamp01(woComplianceRate), kind: "pct" },
        { key: "woOpen", value: woOpen, kind: "count" },
        { key: "woOverdue", value: woOverdue, kind: "count" },
        { key: "woCriticalOverdue", value: woCriticalOverdue, kind: "count" },
        { key: "plansOverdue", value: plansOverdue, kind: "count" },
      ],
    });
  }

  // ── 4.3 · Control de diferimientos ─────────────────────────────────────────
  {
    const total = active.length;
    const withRisk = active.filter(d => d.riskLevel != null && d.riskLevel !== "").length;
    const withApproval = active.filter(d => d.decisionAt != null).length;
    const expiredStillActive = active.filter(d =>
      d.status === "ACTIVE" && ((d.expiredAt && new Date(d.expiredAt) < now) || (d.targetDate && new Date(d.targetDate) < now)),
    ).length;
    const status: TmsaStatus =
      total === 0 ? "OK" :
      (withRisk < total || withApproval < total) ? "GAP" :
      expiredStillActive > 0 ? "ATTENTION" : "OK";
    const findings: TmsaFinding[] = [];
    if (withRisk < total) findings.push(finding("deferralsWithoutRisk", total - withRisk, "GAP"));
    if (withApproval < total) findings.push(finding("deferralsWithoutApproval", total - withApproval, "GAP"));
    if (expiredStillActive > 0) findings.push(finding("deferralsExpired", expiredStillActive, "ATTENTION"));

    groups.push({
      key: "deferralControl", element: "4.3", status, findings,
      metrics: [
        { key: "deferralsActive", value: total, kind: "count" },
        { key: "deferralsWithRisk", value: withRisk, kind: "count" },
        { key: "deferralsWithApproval", value: withApproval, kind: "count" },
        { key: "deferralsExpired", value: expiredStillActive, kind: "count" },
      ],
    });
  }

  // ── 4.2 · Especificación de varada ─────────────────────────────────────────
  // Evidencia de 4.2.4 (existe el documento formal, armado entre buque y tierra)
  // y de 4.4.2 (los diferimientos terminan adentro de ese documento, no sueltos).
  {
    const specsOpen = drydockSpecs.filter(s => s.status !== "APPROVED").length;
    const allItems = drydockSpecs.flatMap(s => s.items);
    const itemsTotal = allItems.length;
    const itemsFromBacklog = allItems.filter(i => i.sourceType !== "MANUAL").length;

    // Diferimientos vigentes que no figuran en ninguna especificación: es el
    // agujero real que mira el auditor.
    //
    // Sólo cuentan los YA OTORGADOS (APPROVED/ACTIVE/EXPIRED), que es exactamente
    // el conjunto que ofrece el importador de la especificación. Un diferimiento
    // todavía en REQUESTED o UNDER_REVIEW no es trabajo diferido: es un pedido.
    // Contándolo, el panel encendía una brecha roja que nadie podía apagar,
    // porque la pantalla de varada no lo ofrecía para importar.
    //
    // Y un renglón RECHAZADO no cubre nada: el trabajo quedó afuera de la
    // varada. Contándolo, un diferimiento rechazado apagaba la brecha como si
    // ya tuviera dónde ejecutarse.
    const deferralIdsInSpec = new Set(
      allItems
        .filter(i => i.sourceType === "DEFERRAL" && i.sourceId && i.itemStatus !== "REJECTED")
        .map(i => i.sourceId as string),
    );
    const granted = active.filter(d => DEFERRAL_GRANTED.includes(d.status));
    const deferralsNotInSpec = granted.filter(d => !deferralIdsInSpec.has(d.id)).length;

    const status: TmsaStatus =
      drydockSpecs.length === 0 && active.length === 0 ? "INFO" :
      deferralsNotInSpec > 0 ? "GAP" :
      itemsTotal === 0 ? "ATTENTION" : "OK";

    const findings: TmsaFinding[] = [];
    if (drydockSpecs.length === 0 && active.length === 0) findings.push(finding("drydockNothing", 0, "INFO"));
    else {
      if (deferralsNotInSpec > 0) findings.push(finding("deferralsNotInSpec", deferralsNotInSpec, "GAP"));
      if (itemsTotal === 0) findings.push(finding("drydockNoItems", 0, "ATTENTION"));
    }

    groups.push({
      key: "drydockSpec", element: "4.2", status, findings,
      metrics: [
        { key: "drydockSpecsOpen", value: specsOpen, kind: "count" },
        { key: "drydockItemsTotal", value: itemsTotal, kind: "count" },
        { key: "drydockItemsFromBacklog", value: itemsFromBacklog, kind: "count" },
        { key: "deferralsNotInSpec", value: deferralsNotInSpec, kind: "count" },
      ],
    });
  }

  // ── 4.4 · Repuestos críticos ───────────────────────────────────────────────
  {
    // El stock disponible depende de la lista de spares: es la única consulta
    // que queda fuera del Promise.all inicial.
    let sparesCriticalLow = 0;
    try {
      if (sparesCriticalA.length > 0) {
        const onHand = await getOnHandMap(prisma, sparesCriticalA.map(s => s.id));
        sparesCriticalLow = sparesCriticalA.filter(s => (onHand.get(s.id) ?? 0) < s.minStock).length;
      }
    } catch { sparesCriticalLow = 0; }
    // Sin repuestos críticos cargados no hay inventario que evaluar: informa,
    // no aprueba. Un buque recién dado de alta salía en verde sin tener nada.
    const status: TmsaStatus =
      sparesCriticalA.length === 0 ? "INFO" :
      sparesCriticalLow > 0 ? "GAP" : "OK";
    const findings: TmsaFinding[] = [];
    if (sparesCriticalA.length === 0) findings.push(finding("sparesNothing", 0, "INFO"));
    else if (sparesCriticalLow > 0) findings.push(finding("sparesCriticalLow", sparesCriticalLow, "GAP"));

    groups.push({
      key: "criticalSpares", element: "4.4", status, findings,
      metrics: [
        { key: "sparesCriticalLow", value: sparesCriticalLow, kind: "count" },
        { key: "spareRequestsPending", value: requestsPending, kind: "count" },
      ],
    });
  }

  // ── 4.5 · Monitoreo de condición (CBM) ─────────────────────────────────────
  {
    const status: TmsaStatus =
      plansWithSampling === 0 ? "INFO" :
      analysesOutOfRange > 0 ? "ATTENTION" : "OK";
    const findings: TmsaFinding[] = [];
    if (plansWithSampling === 0) findings.push(finding("cbmNothing", 0, "INFO"));
    else if (analysesOutOfRange > 0) findings.push(finding("analysesOutOfRange", analysesOutOfRange, "ATTENTION"));

    groups.push({
      key: "conditionMonitoring", element: "4.5", status, findings,
      metrics: [
        { key: "plansWithSampling", value: plansWithSampling, kind: "count" },
        { key: "analysesOutOfRange", value: analysesOutOfRange, kind: "count" },
      ],
    });
  }

  // ── 4.6 / Elem 8 · Análisis de fallas y feedback ───────────────────────────
  {
    const recurringAssets = defectsGrouped.filter(g => g.assetId).length;
    // Sin defectos cargados no hay análisis de fallas que evaluar: es "sin
    // evidencia", no "impecable". Mismo criterio que defectReporting, que mira
    // la misma tabla — antes las dos tarjetas leían distinto el mismo vacío.
    // Y si hay defectos pero ninguno con causa raíz, tampoco es OK.
    const status: TmsaStatus =
      defectsTotal === 0 ? "INFO" :
      recurringAssets > 0 ? "ATTENTION" :
      defectsWithRca === 0 ? "ATTENTION" : "OK";
    const findings: TmsaFinding[] = [];
    if (defectsTotal === 0) findings.push(finding("rcaNothing", 0, "INFO"));
    else {
      if (recurringAssets > 0) findings.push(finding("recurringAssets", recurringAssets, "ATTENTION"));
      if (defectsWithRca === 0) findings.push(finding("noRca", defectsTotal, "ATTENTION"));
    }

    groups.push({
      key: "failureAnalysis", element: "8", status, findings,
      metrics: [
        { key: "defectsWithRca", value: defectsWithRca, kind: "count" },
        { key: "recurringAssets", value: recurringAssets, kind: "count" },
      ],
    });
  }

  // ── Elem 7 · Gestión del cambio (MOC) ──────────────────────────────────────
  {
    const findings: TmsaFinding[] = [];
    if (mocPendingImpl > 0) findings.push(finding("mocPendingImpl", mocPendingImpl, "INFO"));

    groups.push({
      key: "managementOfChange", element: "7", status: "INFO", findings,
      metrics: [
        { key: "mocOpen", value: mocOpen, kind: "count" },
        { key: "mocPendingImpl", value: mocPendingImpl, kind: "count" },
      ],
    });
  }

  // ── 4.1 · Uso real del sistema de defectos ─────────────────────────────────
  // Distinto de "failureAnalysis" (Elem 8, RCA): esto responde si el módulo de
  // Defectos tiene evidencia cargada para este buque, no si esa evidencia
  // incluye un análisis de causa raíz.
  {
    const status: TmsaStatus = defectsTotal === 0 ? "INFO" : defectsStaleOpen > 0 ? "ATTENTION" : "OK";
    const findings: TmsaFinding[] = [];
    if (defectsTotal === 0) findings.push(finding("defectsNothing", 0, "INFO"));
    else if (defectsStaleOpen > 0) findings.push(finding("defectsStaleOpen", defectsStaleOpen, "ATTENTION"));

    groups.push({
      key: "defectReporting", element: "4.1", status, findings,
      metrics: [
        { key: "defectsTotal", value: defectsTotal, kind: "count" },
        { key: "defectsStaleOpen", value: defectsStaleOpen, kind: "count" },
      ],
    });
  }

  // ── 4.2 · Certificados (validez y exactitud) ───────────────────────────────
  // Reusa la misma lógica de estado (30 días) que certificates-service.ts —
  // no reinventa el umbral de vencimiento.
  {
    const status: TmsaStatus = certificatesTotal === 0 ? "INFO" : certificatesExpired > 0 ? "GAP" : certificatesExpiringSoon > 0 ? "ATTENTION" : "OK";
    const findings: TmsaFinding[] = [];
    if (certificatesTotal === 0) findings.push(finding("certificatesNothing", 0, "INFO"));
    else {
      if (certificatesExpired > 0) findings.push(finding("certificatesExpired", certificatesExpired, "GAP"));
      if (certificatesExpiringSoon > 0) findings.push(finding("certificatesExpiringSoon", certificatesExpiringSoon, "ATTENTION"));
    }

    groups.push({
      key: "certificates", element: "4.2", status, findings,
      metrics: [
        { key: "certificatesTotal", value: certificatesTotal, kind: "count" },
        { key: "certificatesExpired", value: certificatesExpired, kind: "count" },
        { key: "certificatesExpiringSoon", value: certificatesExpiringSoon, kind: "count" },
      ],
    });
  }

  // ── 4.2 · Inspecciones (tanques/lastre, visitas) ───────────────────────────
  {
    const status: TmsaStatus = inspectionsTotal === 0 ? "INFO" : inspectionsOverdue > 0 ? "GAP" : "OK";
    const findings: TmsaFinding[] = [];
    if (inspectionsTotal === 0) findings.push(finding("inspectionsNone", 0, "INFO"));
    else if (inspectionsOverdue > 0) findings.push(finding("inspectionsOverdue", inspectionsOverdue, "GAP"));

    groups.push({
      key: "inspections", element: "4.2", status, findings,
      metrics: [
        { key: "inspectionsTotal", value: inspectionsTotal, kind: "count" },
        { key: "inspectionsOverdue", value: inspectionsOverdue, kind: "count" },
      ],
    });
  }

  // ── 4.1 · Auditoría de ingeniería del representante de la compañía ─────────
  // TMSA pide auditorías integrales de ingeniería, hechas por un representante
  // calificado, que incluyan la observación de las prácticas DURANTE LA
  // NAVEGACIÓN. Se esperan 2 al año; lo que cuenta como evidencia es la OT de
  // inspección cerrada con condición "en navegación".
  {
    const auditsLast12m = engineeringAuditRows.length;
    const auditsAtSea = engineeringAuditRows.filter(r => r.operatingCondition === "NAVEGACION").length;
    // Sin plan de auditoría no hay nada que reclamar: son las barcazas, que no
    // llevan tripulación de máquinas. Se informa, no se marca brecha.
    const status: TmsaStatus =
      auditPlanIds.length === 0 ? "INFO" :
      auditsAtSea === 0 ? "GAP" :
      auditsAtSea < 2 ? "ATTENTION" : "OK";
    const findings: TmsaFinding[] = [];
    if (auditPlanIds.length === 0) findings.push(finding("auditNoPlan", 0, "INFO"));
    else if (auditsAtSea === 0) findings.push(finding("auditNoneAtSea", 0, "GAP"));
    else if (auditsAtSea < 2) findings.push(finding("auditBelowTwo", auditsAtSea, "ATTENTION"));

    groups.push({
      // El requisito que cubre este grupo es el 4.4.5 de la lista OCIMF (etapa 4
      // del elemento 4), no el 4.1: con la etiqueta vieja el panel de evidencia
      // y la pestaña Checklist numeraban distinto el mismo requisito.
      key: "engineeringAudit", element: "4.4", status, findings,
      metrics: [
        { key: "auditsLast12m", value: auditsLast12m, kind: "count" },
        { key: "auditsAtSea", value: auditsAtSea, kind: "count" },
      ],
    });
  }

  // ── 4A.2 · Permisos de Trabajo en equipo crítico ───────────────────────────
  {
    const status: TmsaStatus = permitsTotal === 0 ? "INFO" : permitsDraftStuck > 0 ? "ATTENTION" : "OK";
    const findings: TmsaFinding[] = [];
    if (permitsTotal === 0) findings.push(finding("permitsNothing", 0, "INFO"));
    else if (permitsDraftStuck > 0) findings.push(finding("permitsDraftStuck", permitsDraftStuck, "ATTENTION"));

    groups.push({
      key: "permits", element: "4A.2", status, findings,
      metrics: [
        { key: "permitsTotal", value: permitsTotal, kind: "count" },
        { key: "permitsDraftStuck", value: permitsDraftStuck, kind: "count" },
      ],
    });
  }

  const summary = { ok: 0, attention: 0, gap: 0, info: 0 };
  for (const g of groups) {
    if (g.status === "OK") summary.ok++;
    else if (g.status === "ATTENTION") summary.attention++;
    else if (g.status === "GAP") summary.gap++;
    else summary.info++;
  }

  // vesselCode vacío = item de flota; el frontend lo usa para titular el bloque
  // con el nombre de la empresa en vez del de un barco.
  return {
    vesselCode: vesselsIn.length === 1 ? vesselsIn[0]!.code : "",
    vesselName: displayName,
    vesselCount: vesselsIn.length,
    summary,
    groups,
  };
}

// ── Drill-down por métrica ────────────────────────────────────────────────────
// Para cada métrica "count" del panel, lista las entidades concretas que la
// componen (mismo filtro que computeOne — no debe poder dar un número
// distinto al de la tarjeta). El frontend arma un link de navegación por
// entityType (asset → /assets?open=, workOrder → /work-orders?openId=, etc.).

function isoDateOnly(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const date = new Date(d);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

export type TmsaEntityType = "asset" | "workOrder" | "maintenancePlan" | "deferral" | "spare" | "spareRequest" | "fluidAnalysis" | "defect" | "moc" | "certificate" | "inspection" | "permit" | "drydockSpec";

export interface TmsaDetailItem {
  id: string;
  code: string;
  label: string;
  sublabel?: string | null;
  entityType: TmsaEntityType;
}

export async function getTmsaMetricDetail(
  session: TenantAccessSession,
  vesselCode: string,
  metric: string,
): Promise<{ items: TmsaDetailItem[] }> {
  const prisma = getPrismaClient();
  if (!prisma) return { items: [] };
  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) return { items: [] };
  const vessels = await listVesselsInScope(prisma, session, tenant.id, vesselCode);
  if (vessels.length === 0) return { items: [] };

  const tenantId = tenant.id;
  const now = new Date();
  const d90 = new Date(now.getTime() - 90 * 86_400_000);
  const d60 = new Date(now.getTime() - 60 * 86_400_000);
  const dCritical = new Date(now.getTime() - CRITICAL_OVERDUE_DAYS * 86_400_000);
  const d365 = new Date(now.getTime() - 365 * 86_400_000);
  // vesselCode vacío = el detalle de una tarjeta de flota: mismo alcance que
  // usó computeOne para contarla, así el número de la tarjeta y el largo de la
  // lista no pueden separarse.
  const scope = vesselCode ? vesselCode : { in: vessels.map(v => v.code) };
  const base = { tenantId, vesselCode: scope, deletedAt: null };

  const p = prisma as unknown as {
    asset: { findMany(a: unknown): Promise<any[]> };
    maintenancePlan: { findMany(a: unknown): Promise<any[]> };
    workOrder: { findMany(a: unknown): Promise<any[]> };
    deferral: { findMany(a: unknown): Promise<any[]> };
    spare: { findMany(a: unknown): Promise<any[]> };
    spareRequest: { findMany(a: unknown): Promise<any[]> };
    fluidAnalysisResult: { findMany(a: unknown): Promise<any[]> };
    defect: { findMany(a: unknown): Promise<any[]>; groupBy(a: unknown): Promise<Array<{ assetId: string | null; _count: { _all: number } }>> };
    mocRecord: { findMany(a: unknown): Promise<any[]> };
    certificate: { findMany(a: unknown): Promise<any[]> };
    inspection: { findMany(a: unknown): Promise<any[]> };
    permitToWork: { findMany(a: unknown): Promise<any[]> };
    drydockSpec: { findMany(a: unknown): Promise<any[]> };
  };

  const assetSelect = { id: true, assetCode: true, name: true, criticality: true, status: true };
  const asAsset = (a: any): TmsaDetailItem =>
    ({ id: a.id, code: a.assetCode, label: a.name ?? a.assetCode, sublabel: `Criticidad ${a.criticality} · ${a.status}`, entityType: "asset" });
  const asWorkOrder = (w: any): TmsaDetailItem =>
    ({ id: w.id, code: w.workOrderCode, label: w.title ?? w.workOrderCode, sublabel: w.dueDate ? `Vencimiento ${isoDateOnly(w.dueDate)}` : null, entityType: "workOrder" });
  const asPlan = (pl: any): TmsaDetailItem =>
    ({ id: pl.id, code: pl.taskCode, label: pl.title, sublabel: pl.nextDueDate ? `Próximo ${isoDateOnly(pl.nextDueDate)}` : null, entityType: "maintenancePlan" });
  const asDeferral = (d: any): TmsaDetailItem =>
    ({ id: d.id, code: d.deferralCode, label: d.justification ?? d.deferralCode, sublabel: d.status, entityType: "deferral" });
  const asDrydockSpec = (s: any): TmsaDetailItem =>
    ({ id: s.id, code: s.specCode, label: s.title ?? s.specCode, sublabel: s.status, entityType: "drydockSpec" });
  // Una línea de la varada se abre por su documento: la pantalla no tiene
  // deep-link por ítem, así que el código que se muestra es el de la spec.
  const asDrydockItem = (i: any): TmsaDetailItem =>
    ({ id: i.specId, code: i.specCode, label: `${i.itemNo}. ${i.title}`, sublabel: i.sourceType, entityType: "drydockSpec" });
  const asSpare = (s: any): TmsaDetailItem =>
    ({ id: s.id, code: s.sku, label: s.name, entityType: "spare" });
  const asSpareRequest = (r: any): TmsaDetailItem =>
    ({ id: r.id, code: r.requestCode, label: `${r.priority} · ${r.status}`, sublabel: isoDateOnly(r.requestedAt), entityType: "spareRequest" });
  const asDefect = (d: any): TmsaDetailItem =>
    ({ id: d.id, code: d.defectCode, label: d.description, sublabel: d.severity, entityType: "defect" });
  const asMoc = (m: any): TmsaDetailItem =>
    ({ id: m.id, code: m.mocCode, label: m.title, sublabel: m.status, entityType: "moc" });
  const asCertificate = (c: any): TmsaDetailItem =>
    ({ id: c.id, code: c.certificateCode, label: c.name, sublabel: c.expiryDate ? `Vence ${isoDateOnly(c.expiryDate)}` : null, entityType: "certificate" });
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- queda para cuando se habilite el motor de plantillas
  const asInspection = (i: any): TmsaDetailItem =>
    ({ id: i.id, code: i.inspectionCode, label: i.type, sublabel: i.scheduledAt ? `Programada ${isoDateOnly(i.scheduledAt)}` : i.status, entityType: "inspection" });
  const asPermit = (pw: any): TmsaDetailItem =>
    ({ id: pw.id, code: pw.permitCode, label: pw.type, sublabel: pw.status, entityType: "permit" });

  switch (metric) {
    case "assetsTotal": {
      const rows = await p.asset.findMany({ where: { ...base }, select: assetSelect, orderBy: { assetCode: "asc" } });
      return { items: rows.map(asAsset) };
    }
    case "assetsPlanNotRequired": {
      const rows = await p.asset.findMany({ where: { ...base, planNotRequired: true }, select: assetSelect, orderBy: { assetCode: "asc" } });
      return { items: rows.map(asAsset) };
    }
    case "assetsWithPlan":
    case "assetsWithoutPlan": {
      const plans = await p.maintenancePlan.findMany({ where: { ...base, status: "ACTIVE" }, select: { assetId: true } });
      const ids = [...new Set(plans.map((pl: any) => pl.assetId))];
      // Los exentos no figuran en ninguna de las dos listas: ni cubiertos ni brecha.
      const where = metric === "assetsWithPlan"
        ? { ...base, id: { in: ids }, planNotRequired: false }
        : { ...base, id: { notIn: ids }, planNotRequired: false };
      if (metric === "assetsWithPlan" && ids.length === 0) return { items: [] };
      const rows = await p.asset.findMany({ where, select: assetSelect, orderBy: { assetCode: "asc" } });
      return { items: rows.map(asAsset) };
    }
    case "criticalAssets": {
      const rows = await p.asset.findMany({ where: { ...base, criticality: "A" }, select: assetSelect, orderBy: { assetCode: "asc" } });
      return { items: rows.map(asAsset) };
    }
    case "safetyCritical": {
      const rows = await p.asset.findMany({ where: { ...base, isSafetyCritical: true }, select: assetSelect, orderBy: { assetCode: "asc" } });
      return { items: rows.map(asAsset) };
    }
    case "criticalOverdueWo": {
      const rows = await p.workOrder.findMany({
        where: { ...base, status: { in: ["PLANNED", "IN_PROGRESS"] }, ...criticalWoWhere(await criticalAssetIdsOf(p, base)), dueDate: { lt: now } },
        select: { id: true, workOrderCode: true, title: true, dueDate: true }, orderBy: { dueDate: "asc" },
      });
      return { items: rows.map(asWorkOrder) };
    }
    case "woOpen": {
      const rows = await p.workOrder.findMany({
        where: { ...base, status: { in: ["PLANNED", "IN_PROGRESS"] } },
        select: { id: true, workOrderCode: true, title: true, dueDate: true }, orderBy: { dueDate: "asc" }, take: DETAIL_CAP,
      });
      return { items: rows.map(asWorkOrder) };
    }
    case "woOverdue": {
      const rows = await p.workOrder.findMany({
        where: { ...base, status: { in: ["PLANNED", "IN_PROGRESS"] }, dueDate: { lt: now } },
        select: { id: true, workOrderCode: true, title: true, dueDate: true }, orderBy: { dueDate: "asc" },
      });
      return { items: rows.map(asWorkOrder) };
    }
    case "woCriticalOverdue": {
      const rows = await p.workOrder.findMany({
        where: { ...base, status: { in: ["PLANNED", "IN_PROGRESS"] }, ...criticalWoWhere(await criticalAssetIdsOf(p, base)), dueDate: { lt: dCritical } },
        select: { id: true, workOrderCode: true, title: true, dueDate: true }, orderBy: { dueDate: "asc" },
      });
      return { items: rows.map(asWorkOrder) };
    }
    case "plansOverdue": {
      const rows = await p.maintenancePlan.findMany({
        where: { ...base, status: "OVERDUE" },
        select: { id: true, taskCode: true, title: true, nextDueDate: true }, orderBy: { nextDueDate: "asc" },
      });
      return { items: rows.map(asPlan) };
    }
    case "deferralsActive": {
      const rows = await p.deferral.findMany({
        where: { ...base, status: { notIn: ["CLOSED", "EXPIRED", "REJECTED"] } },
        select: { id: true, deferralCode: true, justification: true, status: true }, orderBy: { deferralCode: "asc" },
      });
      return { items: rows.map(asDeferral) };
    }
    case "deferralsWithRisk":
    case "deferralsWithApproval":
    case "deferralsExpired": {
      // Mismo filtro base que computeOne, luego el mismo predicado exacto en JS
      // (no en SQL) para garantizar que el drill-down nunca desalinee con el
      // número mostrado en la tarjeta.
      const active = await p.deferral.findMany({
        where: { ...base, status: { notIn: ["CLOSED", "EXPIRED", "REJECTED"] } },
        select: { id: true, deferralCode: true, justification: true, status: true, riskLevel: true, decisionAt: true, targetDate: true, expiredAt: true },
        orderBy: { deferralCode: "asc" },
      });
      let filtered = active;
      if (metric === "deferralsWithRisk") filtered = active.filter((d: any) => d.riskLevel != null && d.riskLevel !== "");
      else if (metric === "deferralsWithApproval") filtered = active.filter((d: any) => d.decisionAt != null);
      else filtered = active.filter((d: any) =>
        d.status === "ACTIVE" && ((d.expiredAt && new Date(d.expiredAt) < now) || (d.targetDate && new Date(d.targetDate) < now)));
      return { items: filtered.map(asDeferral) };
    }
    case "sparesCriticalLow": {
      const spares = await p.spare.findMany({ where: { ...base, criticality: "A", status: "ACTIVE" }, select: { id: true, sku: true, name: true, minStock: true } });
      if (spares.length === 0) return { items: [] };
      const onHand = await getOnHandMap(prisma, spares.map((s: any) => s.id));
      const low = spares.filter((s: any) => (onHand.get(s.id) ?? 0) < s.minStock);
      return { items: low.map((s: any) => ({ ...asSpare(s), sublabel: `Stock ${onHand.get(s.id) ?? 0} / mínimo ${s.minStock}` })) };
    }
    case "spareRequestsPending": {
      // Sin filtro por vesselCode — igual que computeOne (el pedido de repuestos es tenant-wide, no por buque).
      const rows = await p.spareRequest.findMany({
        where: { tenantId, deletedAt: null, status: { in: ["DRAFT", "SUBMITTED"] } },
        select: { id: true, requestCode: true, status: true, priority: true, requestedAt: true }, orderBy: { requestedAt: "desc" },
      });
      return { items: rows.map(asSpareRequest) };
    }
    case "plansWithSampling": {
      const rows = await p.maintenancePlan.findMany({
        where: { ...base, status: "ACTIVE", samplingKind: { not: null } },
        select: { id: true, taskCode: true, title: true, nextDueDate: true }, orderBy: { taskCode: "asc" },
      });
      return { items: rows.map(asPlan) };
    }
    case "analysesOutOfRange": {
      const rows = await p.fluidAnalysisResult.findMany({
        where: { tenantId, verdict: { in: ["CRITICAL", "ACTION_REQUIRED"] }, receivedAt: { gte: d90 }, sample: { vesselCode: scope, deletedAt: null } },
        select: { id: true, verdict: true, receivedAt: true, sample: { select: { sampleCode: true } } },
        orderBy: { receivedAt: "desc" },
      });
      return { items: rows.map((r: any) => ({ id: r.id, code: r.sample.sampleCode, label: `Verdict ${r.verdict}`, sublabel: isoDateOnly(r.receivedAt), entityType: "fluidAnalysis" as const })) };
    }
    case "defectsWithRca": {
      const rows = await p.defect.findMany({
        where: { ...base, rcaApprovedAt: { not: null } },
        select: { id: true, defectCode: true, description: true, severity: true }, orderBy: { defectCode: "desc" },
      });
      return { items: rows.map(asDefect) };
    }
    case "recurringAssets": {
      const grouped = await p.defect.groupBy({
        by: ["assetId"],
        where: { ...base, reportedAt: { gte: d60 } },
        _count: { _all: true },
        having: { assetId: { _count: { gte: 3 } } },
      });
      const ids = grouped.filter(g => g.assetId).map(g => g.assetId as string);
      if (ids.length === 0) return { items: [] };
      const countByAsset = new Map(grouped.map(g => [g.assetId, g._count._all]));
      const rows = await p.asset.findMany({ where: { ...base, id: { in: ids } }, select: assetSelect });
      return { items: rows.map((a: any) => ({ ...asAsset(a), sublabel: `${countByAsset.get(a.id) ?? 0} defectos en 60 días` })) };
    }
    case "mocOpen": {
      const rows = await p.mocRecord.findMany({
        where: { ...base, status: { notIn: ["REVIEWED", "REJECTED", "CANCELLED"] } },
        select: { id: true, mocCode: true, title: true, status: true }, orderBy: { mocCode: "desc" },
      });
      return { items: rows.map(asMoc) };
    }
    case "mocPendingImpl": {
      const rows = await p.mocRecord.findMany({
        where: { ...base, status: { in: ["APPROVED", "IN_PROGRESS"] } },
        select: { id: true, mocCode: true, title: true, status: true }, orderBy: { mocCode: "desc" },
      });
      return { items: rows.map(asMoc) };
    }
    case "defectsTotal": {
      const rows = await p.defect.findMany({
        where: { ...base },
        select: { id: true, defectCode: true, description: true, severity: true }, orderBy: { defectCode: "desc" },
      });
      return { items: rows.map(asDefect) };
    }
    case "defectsStaleOpen": {
      const rows = await p.defect.findMany({
        where: { ...base, status: "OPEN", reportedAt: { lt: d60 } },
        select: { id: true, defectCode: true, description: true, severity: true }, orderBy: { reportedAt: "asc" },
      });
      return { items: rows.map(asDefect) };
    }
    case "certificatesTotal": {
      const rows = await p.certificate.findMany({ where: { ...base }, select: { id: true, certificateCode: true, name: true, expiryDate: true }, orderBy: { expiryDate: "asc" } });
      return { items: rows.map(asCertificate) };
    }
    case "certificatesExpired":
    case "certificatesExpiringSoon": {
      // Mismo filtro base, luego el mismo predicado en JS que computeOne
      // (resolveComputedStatus) para no desalinear tarjeta vs. drill-down: los
      // SUSPENDIDOS/CERRADOS no son vencimientos aunque la fecha haya pasado.
      const rows = await p.certificate.findMany({ where: { ...base }, select: { id: true, certificateCode: true, name: true, expiryDate: true, status: true }, orderBy: { expiryDate: "asc" } });
      const wanted = metric === "certificatesExpired" ? "EXPIRED" : "EXPIRING_SOON";
      const filtered = rows.filter((c: any) => resolveComputedStatus(c.expiryDate, c.status) === wanted);
      return { items: filtered.map(asCertificate) };
    }
    // Las inspecciones son OT de tipo INSPECTION (ver el grupo 4.2 arriba): el
    // detalle abre la orden, que es donde se ejecuta y se cierra.
    case "inspectionsTotal": {
      const rows = await p.workOrder.findMany({
        where: { ...base, type: "INSPECTION" },
        select: { id: true, workOrderCode: true, title: true, status: true, dueDate: true },
        orderBy: { openDate: "desc" },
      });
      return { items: rows.map(asWorkOrder) };
    }
    case "inspectionsOverdue": {
      const rows = await p.workOrder.findMany({
        where: { ...base, type: "INSPECTION", status: { in: OPEN_WO_STATUSES }, dueDate: { lt: now } },
        select: { id: true, workOrderCode: true, title: true, status: true, dueDate: true },
        orderBy: { dueDate: "asc" },
      });
      return { items: rows.map(asWorkOrder) };
    }
    // Auditorías de ingeniería: mismo filtro que el grupo, para que la tarjeta
    // y su detalle no se desalineen.
    case "auditsLast12m":
    case "auditsAtSea": {
      const auditPlans = await p.maintenancePlan.findMany({
        // Mismo criterio que computeOne: el prefijo del buque ya lo garantiza
        // el filtro de vesselCode, así que alcanza con el sufijo del código.
        where: { ...base, taskCode: { contains: "-AUD-ING" } },
        select: { id: true },
      });
      if (auditPlans.length === 0) return { items: [] };
      const rows = await p.workOrder.findMany({
        where: {
          ...base, status: "CLOSED", completedDate: { gte: d365 },
          maintenancePlanId: { in: auditPlans.map((pl: any) => pl.id) },
          ...(metric === "auditsAtSea" ? { operatingCondition: "NAVEGACION" } : {}),
        },
        select: { id: true, workOrderCode: true, title: true, dueDate: true }, orderBy: { completedDate: "desc" }, take: DETAIL_CAP,
      });
      return { items: rows.map(asWorkOrder) };
    }
    case "permitsTotal": {
      const rows = await p.permitToWork.findMany({ where: { ...base }, select: { id: true, permitCode: true, type: true, status: true }, orderBy: { permitCode: "desc" } });
      return { items: rows.map(asPermit) };
    }
    case "permitsDraftStuck": {
      const rows = await p.permitToWork.findMany({
        where: { ...base, status: "DRAFT", createdAt: { lt: d60 } },
        select: { id: true, permitCode: true, type: true, status: true }, orderBy: { permitCode: "desc" },
      });
      return { items: rows.map(asPermit) };
    }
    // ── Especificación de Varada ──────────────────────────────────────────────
    // Mismo filtro que computeOne (status != CANCELLED) y el mismo predicado en
    // JS, para que el detalle nunca desalinee con el número de la tarjeta.
    case "drydockSpecsOpen":
    case "drydockItemsTotal":
    case "drydockItemsFromBacklog": {
      const specs = await p.drydockSpec.findMany({
        where: { ...base, status: { not: "CANCELLED" } },
        select: {
          id: true, specCode: true, title: true, status: true,
          items: { select: { itemNo: true, title: true, sourceType: true }, orderBy: { itemNo: "asc" } },
        },
        orderBy: { specCode: "desc" },
      });
      if (metric === "drydockSpecsOpen") {
        return { items: specs.filter((s: any) => s.status !== "APPROVED").map(asDrydockSpec) };
      }
      const lines = specs.flatMap((s: any) =>
        s.items.map((i: any) => ({ ...i, specId: s.id, specCode: s.specCode })));
      const filtered = metric === "drydockItemsFromBacklog"
        ? lines.filter((i: any) => i.sourceType !== "MANUAL")
        : lines;
      return { items: filtered.map(asDrydockItem) };
    }
    // El agujero que mira el auditor: diferimientos vigentes que no entraron a
    // ninguna especificación. Se devuelven los diferimientos, no las specs.
    case "deferralsNotInSpec": {
      const [active, specs] = await Promise.all([
        p.deferral.findMany({
          where: { ...base, status: { in: [...DEFERRAL_GRANTED] } },
          select: { id: true, deferralCode: true, justification: true, status: true },
          orderBy: { deferralCode: "asc" },
        }),
        p.drydockSpec.findMany({
          where: { ...base, status: { not: "CANCELLED" } },
          select: { items: { select: { itemStatus: true, sourceType: true, sourceId: true } } },
        }),
      ]);
      // Mismo criterio que la tarjeta: el renglón rechazado no cubre el
      // diferimiento (ver deferralsNotInSpec en computeOne).
      const inSpec = new Set(
        specs.flatMap((s: any) => s.items)
          .filter((i: any) => i.sourceType === "DEFERRAL" && i.sourceId && i.itemStatus !== "REJECTED")
          .map((i: any) => i.sourceId as string),
      );
      return { items: active.filter((d: any) => !inSpec.has(d.id)).map(asDeferral) };
    }
    default:
      return { items: [] };
  }
}
