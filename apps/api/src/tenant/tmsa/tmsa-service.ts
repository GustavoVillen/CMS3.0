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
}

export interface TmsaVesselEvidence {
  vesselCode: string;
  vesselName: string;
  summary: { ok: number; attention: number; gap: number; info: number };
  groups: TmsaGroup[];
}

// ── Thresholds (ajustables) ──────────────────────────────────────────────────
const PMS_COVERAGE_GAP = 0.90;        // cobertura de PMS por debajo → GAP
const PMS_COVERAGE_ATTENTION = 0.98;  // por debajo → ATTENTION
const WO_COMPLIANCE_GAP = 0.75;       // % OT en plazo por debajo → GAP
const WO_COMPLIANCE_ATTENTION = 0.85; // por debajo → ATTENTION
const CRITICAL_OVERDUE_DAYS = 30;     // OT crítica vencida hace +N días

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
): Promise<{ items: TmsaVesselEvidence[] }> {
  const prisma = getPrismaClient();
  if (!prisma) return { items: [] };
  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) return { items: [] };

  const vessels = await listVesselsInScope(prisma, session, tenant.id, vesselCode);
  if (vessels.length === 0) return { items: [] };

  const items: TmsaVesselEvidence[] = [];
  for (const v of vessels) {
    items.push(await computeOne(prisma, tenant.id, v));
  }
  return { items };
}

async function computeOne(
  prisma: NonNullable<ReturnType<typeof getPrismaClient>>,
  tenantId: string,
  vessel: { code: string; name: string; vesselType: string | null },
): Promise<TmsaVesselEvidence> {
  const now = new Date();
  const d90 = new Date(now.getTime() - 90 * 86_400_000);
  const d60 = new Date(now.getTime() - 60 * 86_400_000);
  const dCritical = new Date(now.getTime() - CRITICAL_OVERDUE_DAYS * 86_400_000);
  const base = { tenantId, vesselCode: vessel.code, deletedAt: null };

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
  };

  const groups: TmsaGroup[] = [];

  // ── 4.1 · Cobertura del PMS ────────────────────────────────────────────────
  {
    const assetsTotal = await safe(() => p.asset.count({ where: { ...base } }), 0);
    // Activos con ≥1 plan activo (distinct assetId).
    const plans = await safe(
      () => p.maintenancePlan.findMany({ where: { ...base, status: "ACTIVE" }, select: { assetId: true } }) as Promise<Array<{ assetId: string }>>,
      [] as Array<{ assetId: string }>,
    );
    const assetsWithPlan = new Set(plans.map(pl => pl.assetId)).size;
    const assetsWithoutPlan = Math.max(0, assetsTotal - assetsWithPlan);
    const coverage = assetsTotal === 0 ? 1 : assetsWithPlan / assetsTotal;
    const status: TmsaStatus =
      assetsTotal === 0 ? "INFO" :
      coverage < PMS_COVERAGE_GAP ? "GAP" :
      coverage < PMS_COVERAGE_ATTENTION ? "ATTENTION" : "OK";
    groups.push({
      key: "pmsCoverage", element: "4.1", status,
      metrics: [
        { key: "assetsTotal", value: assetsTotal, kind: "count" },
        { key: "assetsWithPlan", value: assetsWithPlan, kind: "count" },
        { key: "assetsWithoutPlan", value: assetsWithoutPlan, kind: "count" },
        { key: "coverage", value: clamp01(coverage), kind: "pct" },
      ],
    });
  }

  // ── 4.2 · Equipo crítico ───────────────────────────────────────────────────
  {
    const criticalAssets = await safe(() => p.asset.count({ where: { ...base, criticality: "A" } }), 0);
    const safetyCritical = await safe(() => p.asset.count({ where: { ...base, isSafetyCritical: true } }), 0);
    // OTs abiertas de criticidad A vencidas (mantenimiento de equipo crítico sin ejecutar).
    const criticalOverdueWo = await safe(() => p.workOrder.count({
      where: { ...base, status: { in: ["PLANNED", "IN_PROGRESS"] }, criticality: "A", dueDate: { lt: now } },
    }), 0);
    const status: TmsaStatus =
      criticalAssets === 0 && safetyCritical === 0 ? "INFO" :
      criticalOverdueWo > 0 ? "GAP" : "OK";
    groups.push({
      key: "criticalEquipment", element: "4.2", status,
      metrics: [
        { key: "criticalAssets", value: criticalAssets, kind: "count" },
        { key: "safetyCritical", value: safetyCritical, kind: "count" },
        { key: "criticalOverdueWo", value: criticalOverdueWo, kind: "count" },
      ],
    });
  }

  // ── 4.3 · Cumplimiento de mantenimiento planificado ────────────────────────
  {
    // % OT cerradas en plazo (últimos 90d) — misma lógica que compliance-service.
    const closed = await safe(
      () => p.workOrder.findMany({
        where: { ...base, status: "CLOSED", completedDate: { gte: d90 } },
        select: { completedDate: true, dueDate: true },
      }) as Promise<Array<{ completedDate: Date | null; dueDate: Date | null }>>,
      [] as Array<{ completedDate: Date | null; dueDate: Date | null }>,
    );
    const closedOnTime = closed.filter(w => w.completedDate && w.dueDate && new Date(w.completedDate) <= new Date(w.dueDate)).length;
    const woComplianceRate = closed.length === 0 ? 1 : closedOnTime / closed.length;
    const woOpen = await safe(() => p.workOrder.count({ where: { ...base, status: { in: ["PLANNED", "IN_PROGRESS"] } } }), 0);
    const woOverdue = await safe(() => p.workOrder.count({ where: { ...base, status: { in: ["PLANNED", "IN_PROGRESS"] }, dueDate: { lt: now } } }), 0);
    const woCriticalOverdue = await safe(() => p.workOrder.count({ where: { ...base, status: { in: ["PLANNED", "IN_PROGRESS"] }, criticality: "A", dueDate: { lt: dCritical } } }), 0);
    const plansOverdue = await safe(() => p.maintenancePlan.count({ where: { ...base, status: "OVERDUE" } }), 0);
    let status: TmsaStatus =
      woComplianceRate < WO_COMPLIANCE_GAP ? "GAP" :
      woComplianceRate < WO_COMPLIANCE_ATTENTION ? "ATTENTION" : "OK";
    if (woCriticalOverdue > 0) status = "GAP";
    else if (woOverdue > 0) status = count("ATTENTION", status);
    groups.push({
      key: "plannedMaintenance", element: "4.3", status,
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
    const active = await safe(
      () => p.deferral.findMany({
        where: { ...base, status: { notIn: ["CLOSED", "CANCELLED", "EXPIRED", "REJECTED"] } },
        select: { riskLevel: true, decisionAt: true, status: true, targetDate: true, expiredAt: true },
      }) as Promise<Array<{ riskLevel: string | null; decisionAt: Date | null; status: string; targetDate: Date | null; expiredAt: Date | null }>>,
      [] as Array<{ riskLevel: string | null; decisionAt: Date | null; status: string; targetDate: Date | null; expiredAt: Date | null }>,
    );
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
    groups.push({
      key: "deferralControl", element: "4.3", status,
      metrics: [
        { key: "deferralsActive", value: total, kind: "count" },
        { key: "deferralsWithRisk", value: withRisk, kind: "count" },
        { key: "deferralsWithApproval", value: withApproval, kind: "count" },
        { key: "deferralsExpired", value: expiredStillActive, kind: "count" },
      ],
    });
  }

  // ── 4.4 · Repuestos críticos ───────────────────────────────────────────────
  {
    // Spares criticidad A con onHand < minStock — misma lógica que sidebar-counts.
    let sparesCriticalLow = 0;
    try {
      const spares = await (p.spare.findMany({
        where: { ...base, criticality: "A", status: "ACTIVE" },
        select: { id: true, minStock: true },
      }) as Promise<Array<{ id: string; minStock: number }>>);
      if (spares.length > 0) {
        const onHand = await getOnHandMap(prisma, spares.map(s => s.id));
        sparesCriticalLow = spares.filter(s => (onHand.get(s.id) ?? 0) < s.minStock).length;
      }
    } catch { sparesCriticalLow = 0; }
    const requestsPending = await safe(() => p.spareRequest.count({ where: { tenantId, deletedAt: null, status: { in: ["DRAFT", "SUBMITTED"] } } }), 0);
    const status: TmsaStatus = sparesCriticalLow > 0 ? "GAP" : "OK";
    groups.push({
      key: "criticalSpares", element: "4.4", status,
      metrics: [
        { key: "sparesCriticalLow", value: sparesCriticalLow, kind: "count" },
        { key: "spareRequestsPending", value: requestsPending, kind: "count" },
      ],
    });
  }

  // ── 4.5 · Monitoreo de condición (CBM) ─────────────────────────────────────
  {
    const plansWithSampling = await safe(() => p.maintenancePlan.count({ where: { ...base, status: "ACTIVE", samplingKind: { not: null } } }), 0);
    // Análisis de fluidos fuera de rango (verdict crítico) del buque, últimos 90d.
    const analysesOutOfRange = await safe(() => p.fluidAnalysisResult.count({
      where: { tenantId, verdict: { in: ["CRITICAL", "ACTION_REQUIRED"] }, receivedAt: { gte: d90 }, sample: { vesselCode: vessel.code, deletedAt: null } },
    }), 0);
    const status: TmsaStatus =
      plansWithSampling === 0 ? "INFO" :
      analysesOutOfRange > 0 ? "ATTENTION" : "OK";
    groups.push({
      key: "conditionMonitoring", element: "4.5", status,
      metrics: [
        { key: "plansWithSampling", value: plansWithSampling, kind: "count" },
        { key: "analysesOutOfRange", value: analysesOutOfRange, kind: "count" },
      ],
    });
  }

  // ── 4.6 / Elem 8 · Análisis de fallas y feedback ───────────────────────────
  {
    const defectsWithRca = await safe(() => p.defect.count({ where: { ...base, rcaApprovedAt: { not: null } } }), 0);
    // Activos con defectos recurrentes (≥3 en 60d) — misma lógica que getSmartAlerts.
    let recurringAssets = 0;
    try {
      const grouped = await p.defect.groupBy({
        by: ["assetId"],
        where: { ...base, reportedAt: { gte: d60 } },
        _count: { _all: true },
        having: { assetId: { _count: { gte: 3 } } },
      });
      recurringAssets = grouped.filter(g => g.assetId).length;
    } catch { recurringAssets = 0; }
    const status: TmsaStatus = recurringAssets > 0 ? "ATTENTION" : "OK";
    groups.push({
      key: "failureAnalysis", element: "8", status,
      metrics: [
        { key: "defectsWithRca", value: defectsWithRca, kind: "count" },
        { key: "recurringAssets", value: recurringAssets, kind: "count" },
      ],
    });
  }

  // ── Elem 7 · Gestión del cambio (MOC) ──────────────────────────────────────
  {
    const mocOpen = await safe(() => p.mocRecord.count({ where: { ...base, status: { notIn: ["REVIEWED", "REJECTED", "CANCELLED"] } } }), 0);
    const mocPendingImpl = await safe(() => p.mocRecord.count({ where: { ...base, status: { in: ["APPROVED", "IN_PROGRESS"] } } }), 0);
    groups.push({
      key: "managementOfChange", element: "7", status: "INFO",
      metrics: [
        { key: "mocOpen", value: mocOpen, kind: "count" },
        { key: "mocPendingImpl", value: mocPendingImpl, kind: "count" },
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

  return { vesselCode: vessel.code, vesselName: vessel.name, summary, groups };
}
