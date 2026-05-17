// Compliance Score + Smart Alerts por vessel.
//
// 1. Compliance Score: número 0-100 compuesto de varios componentes
//    ponderados (OT compliance, drills, certs, findings PSC, NC abiertas).
//    Útil para ranking de flota en el dashboard del fleet manager.
//
// 2. Smart Alerts: lista priorizada de cosas que requieren atención AHORA,
//    detectadas con reglas determinísticas (no IA). Complementa AiInsights
//    con foco en alertas operativas inmediatas por vessel.

import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";

export interface ComplianceComponents {
  woComplianceRate: number;       // 0..1 — OTs cerradas en plazo en últimos 90d
  drillCompliance: number;        // 0..1 — drills realizados / esperados últimos 90d
  certVigent: number;             // 0..1 — % certs vigentes (no expired ni expiring)
  noFindingsPenalty: number;      // 0..1 — 1 si no hay findings PSC abiertos, 0 si hay ≥5
  noCriticalDefects: number;      // 0..1 — 1 si no hay defects CRITICAL abiertos
  noRestHoursViolations: number;  // 0..1 — 1 si no hubo violaciones STCW últimos 30d
}

export interface ComplianceScore {
  vesselCode: string;
  vesselName: string;
  score: number;                  // 0..100
  label: "EXCELLENT" | "GOOD" | "FAIR" | "POOR";
  /** false = barcaza / unidad no tripulada → drills y STCW NO aplican
   * (no se cuentan en el score y el UI los oculta). */
  crewedOperation: boolean;
  components: ComplianceComponents;
  // Datos crudos para que el frontend muestre tooltip explicativo
  totals: {
    woCompletedOnTime: number;
    woClosedTotal: number;
    drillsDone90d: number;
    drillsExpected90d: number;
    certsActive: number;
    certsTotal: number;
    findingsOpen: number;
    criticalDefectsOpen: number;
    restHoursViolations30d: number;
  };
}

export interface SmartAlert {
  id: string;
  vesselCode: string | null;
  vesselName: string | null;
  severity: "INFO" | "WARNING" | "CRITICAL";
  title: string;
  summary: string;
  /** Path al detalle (frontend hace navigate al recibirlo). */
  link: string | null;
}

// ─── helpers ────────────────────────────────────────────────────────────────

async function listVesselsInScope(prisma: NonNullable<ReturnType<typeof getPrismaClient>>, session: TenantAccessSession, tenantId: string, requestedVesselCode: string | null): Promise<Array<{ code: string; name: string; vesselType: string | null }>> {
  const where: Record<string, unknown> = { tenantId, deletedAt: null };
  if (requestedVesselCode) {
    where.code = requestedVesselCode;
  } else if (session.user.role !== "TENANT_ADMIN") {
    if (session.user.assignedVesselCodes.length === 0) return [];
    where.code = { in: session.user.assignedVesselCodes };
  }
  return (prisma as unknown as {
    vessel: { findMany(a: unknown): Promise<Array<{ code: string; name: string; vesselType: string | null }>> };
  }).vessel.findMany({
    where, select: { code: true, name: true, vesselType: true } as never, orderBy: { code: "asc" },
  });
}

/**
 * Barcazas y similares no son tripuladas → drills y horas de descanso STCW
 * no aplican. Cuando isCrewedOperation === false, omitimos esos dos
 * componentes del score (redistribuímos sus pesos entre los demás) y el
 * frontend / PDF los oculta.
 *
 * Matcher: cualquier vesselType que CONTENGA "BARCAZA" (case-insensitive,
 * sin acentos). Cubre variantes como "Barcaza", "Barcaza tanque",
 * "BARCAZA TQ", "barcaza-cisterna", etc. — el dato de vesselType es
 * texto libre en el modelo, así que no podemos asumir un valor exacto.
 */
function isCrewedOperation(vesselType: string | null): boolean {
  if (!vesselType) return true;
  const normalized = vesselType
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // quita acentos
    .toUpperCase();
  return !normalized.includes("BARCAZA");
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function safeDiv(num: number, den: number): number {
  return den === 0 ? 1 : num / den; // si no hay denominador, "perfecto" (no penalizar)
}

function scoreLabel(score: number): ComplianceScore["label"] {
  if (score >= 85) return "EXCELLENT";
  if (score >= 70) return "GOOD";
  if (score >= 50) return "FAIR";
  return "POOR";
}

// ─── COMPLIANCE SCORE ──────────────────────────────────────────────────────

export async function getComplianceScores(session: TenantAccessSession, vesselCode: string | null): Promise<{ items: ComplianceScore[] }> {
  const prisma = getPrismaClient();
  if (!prisma) return { items: [] };
  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) return { items: [] };

  const vessels = await listVesselsInScope(prisma, session, tenant.id, vesselCode);
  if (vessels.length === 0) return { items: [] };

  const items: ComplianceScore[] = [];
  for (const v of vessels) {
    items.push(await computeOne(prisma, tenant.id, v));
  }
  return { items };
}

async function computeOne(
  prisma: NonNullable<ReturnType<typeof getPrismaClient>>,
  tenantId: string,
  vessel: { code: string; name: string; vesselType: string | null },
): Promise<ComplianceScore> {
  const crewed = isCrewedOperation(vessel.vesselType);
  const now = new Date();
  const d90 = new Date(now.getTime() - 90 * 86_400_000);
  const d30 = new Date(now.getTime() - 30 * 86_400_000);

  const base = { tenantId, vesselCode: vessel.code, deletedAt: null };

  const p = prisma as unknown as {
    workOrder: { findMany(a: unknown): Promise<Array<{ completedDate: Date | null; dueDate: Date | null; status: string }>>; count(a: { where: Record<string, unknown> }): Promise<number> };
    drill: { count(a: { where: Record<string, unknown> }): Promise<number> };
    drillConfig: { findMany(a: { where: Record<string, unknown> }): Promise<Array<{ type: string; frequencyDays: number; enabled: boolean }>> };
    certificate: { count(a: { where: Record<string, unknown> }): Promise<number> };
    externalAuditFinding: { count(a: { where: Record<string, unknown> }): Promise<number> };
    defect: { count(a: { where: Record<string, unknown> }): Promise<number> };
    crewRestHours: { count(a: { where: Record<string, unknown> }): Promise<number> };
  };

  // --- 1) OT compliance: cerradas a tiempo / cerradas totales (últimos 90d) ---
  const closedWos = await p.workOrder.findMany({
    where: { ...base, status: "CLOSED", completedDate: { gte: d90 } },
    select: { completedDate: true, dueDate: true, status: true } as never,
  });
  const closedTotal = closedWos.length;
  const closedOnTime = closedWos.filter(w => {
    if (!w.completedDate || !w.dueDate) return false;
    return new Date(w.completedDate).getTime() <= new Date(w.dueDate).getTime();
  }).length;
  const woComplianceRate = closedTotal === 0 ? 1 : closedOnTime / closedTotal;

  // --- 2) Drill compliance: realizados vs esperados según frecuencias ---
  const drillsDone = await p.drill.count({
    where: { tenantId, vesselCode: vessel.code, deletedAt: null, status: "COMPLETED", completedDate: { gte: d90 } },
  });
  const configs = await p.drillConfig.findMany({ where: { tenantId } });
  // Defaults SOLAS (mismos que en drills-service): si no hay configs custom
  // por tenant, asumimos los defaults para los tipos críticos.
  const DEFAULT_FREQ_DAYS: Record<string, number> = {
    FIRE: 30, ABANDON_SHIP: 30, ENCLOSED_SPACE: 60,
    STEERING_GEAR: 90, SECURITY: 90, POLLUTION: 90, OIL_SPILL: 90,
    MAN_OVERBOARD: 90, MEDICAL: 90, BLACKOUT: 180, OTHER: 365,
  };
  const cfgByType = new Map<string, { frequencyDays: number; enabled: boolean }>();
  for (const c of configs) cfgByType.set(c.type, { frequencyDays: c.frequencyDays, enabled: c.enabled });
  let drillsExpected = 0;
  for (const [type, defaultFreq] of Object.entries(DEFAULT_FREQ_DAYS)) {
    const ov = cfgByType.get(type);
    const freq = ov?.frequencyDays ?? defaultFreq;
    const enabled = ov?.enabled ?? true;
    if (!enabled) continue;
    // En 90 días, cuántos drills se esperan: ceil(90 / freq)
    drillsExpected += Math.ceil(90 / freq);
  }
  const drillCompliance = clamp01(safeDiv(drillsDone, drillsExpected));

  // --- 3) Cert compliance: vigentes / total ---
  const certsTotal = await p.certificate.count({ where: { ...base } });
  const certsActive = await p.certificate.count({ where: { ...base, status: "ACTIVE" } });
  const certVigent = safeDiv(certsActive, certsTotal);

  // --- 4) Findings PSC abiertos (penalizar) ---
  const findingsOpen = await p.externalAuditFinding.count({
    where: { tenantId, vesselCode: vessel.code, status: { in: ["OPEN", "IN_PROGRESS"] } },
  });
  // 0 findings = 1, 1-2 findings = 0.7, 3-4 = 0.4, 5+ = 0.1
  const noFindingsPenalty =
    findingsOpen === 0 ? 1 :
    findingsOpen <= 2 ? 0.7 :
    findingsOpen <= 4 ? 0.4 :
    0.1;

  // --- 5) Defectos CRITICAL abiertos (penalizar) ---
  const criticalDefectsOpen = await p.defect.count({
    where: { ...base, severity: "CRITICAL", status: { notIn: ["RESOLVED", "CLOSED"] } },
  });
  const noCriticalDefects =
    criticalDefectsOpen === 0 ? 1 :
    criticalDefectsOpen === 1 ? 0.6 :
    criticalDefectsOpen <= 3 ? 0.3 :
    0.1;

  // --- 6) Violaciones STCW últimos 30d (penalizar) ---
  const restViolations = await p.crewRestHours.count({
    where: { tenantId, vesselCode: vessel.code, hasViolation: true, recordDate: { gte: d30 } },
  });
  const noRestHoursViolations =
    restViolations === 0 ? 1 :
    restViolations <= 2 ? 0.7 :
    restViolations <= 5 ? 0.4 :
    0.1;

  // --- Ponderación: si el buque es no-tripulado (barcaza), excluimos los
  // componentes que requieren tripulación (drills + horas STCW) y
  // redistribuímos sus pesos proporcionalmente entre los demás.
  const weightsFull = {
    woComplianceRate:      0.20,
    drillCompliance:       0.20,
    certVigent:            0.20,
    noFindingsPenalty:     0.15,
    noCriticalDefects:     0.15,
    noRestHoursViolations: 0.10,
  };
  const weights = crewed
    ? weightsFull
    : (() => {
        // Sin tripulación: drills + STCW se omiten. El 30% restante se
        // reparte entre los 4 componentes activos en proporción a su peso.
        const omitted = weightsFull.drillCompliance + weightsFull.noRestHoursViolations;
        const kept    = 1 - omitted;
        const factor  = 1 / kept;
        return {
          woComplianceRate:      weightsFull.woComplianceRate      * factor,
          drillCompliance:       0,
          certVigent:            weightsFull.certVigent            * factor,
          noFindingsPenalty:     weightsFull.noFindingsPenalty     * factor,
          noCriticalDefects:     weightsFull.noCriticalDefects     * factor,
          noRestHoursViolations: 0,
        };
      })();
  const components: ComplianceComponents = {
    woComplianceRate, drillCompliance, certVigent,
    noFindingsPenalty, noCriticalDefects, noRestHoursViolations,
  };
  const raw =
    components.woComplianceRate      * weights.woComplianceRate +
    components.drillCompliance       * weights.drillCompliance +
    components.certVigent            * weights.certVigent +
    components.noFindingsPenalty     * weights.noFindingsPenalty +
    components.noCriticalDefects     * weights.noCriticalDefects +
    components.noRestHoursViolations * weights.noRestHoursViolations;
  const score = Math.round(clamp01(raw) * 100);

  return {
    vesselCode: vessel.code,
    vesselName: vessel.name,
    score,
    label: scoreLabel(score),
    crewedOperation: crewed,
    components,
    totals: {
      woCompletedOnTime: closedOnTime,
      woClosedTotal: closedTotal,
      drillsDone90d: drillsDone,
      drillsExpected90d: drillsExpected,
      certsActive,
      certsTotal,
      findingsOpen,
      criticalDefectsOpen,
      restHoursViolations30d: restViolations,
    },
  };
}

// ─── SMART ALERTS ──────────────────────────────────────────────────────────

export async function getSmartAlerts(session: TenantAccessSession, vesselCode: string | null): Promise<{ items: SmartAlert[] }> {
  const prisma = getPrismaClient();
  if (!prisma) return { items: [] };
  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) return { items: [] };

  const vessels = await listVesselsInScope(prisma, session, tenant.id, vesselCode);
  if (vessels.length === 0) return { items: [] };
  const vesselNames = new Map(vessels.map(v => [v.code, v.name]));

  const now = new Date();
  const d30 = new Date(now.getTime() - 30 * 86_400_000);
  const d60 = new Date(now.getTime() - 60 * 86_400_000);
  const d7  = new Date(now.getTime() - 7 * 86_400_000);
  const d7f = new Date(now.getTime() + 7 * 86_400_000);

  const codes = vessels.map(v => v.code);
  const items: SmartAlert[] = [];

  const p = prisma as unknown as {
    certificate: { findMany(a: unknown): Promise<Array<{ id: string; vesselCode: string; certificateCode: string; name: string; expiryDate: Date | null }>> };
    workOrder: { findMany(a: unknown): Promise<Array<{ id: string; vesselCode: string; workOrderCode: string; criticality?: string | null; dueDate: Date | null }>> };
    defect: { groupBy(a: unknown): Promise<Array<{ assetId: string; vesselCode: string; _count: { _all: number } }>> };
    externalAuditFinding: { findMany(a: unknown): Promise<Array<{ id: string; vesselCode: string; description: string; rectificationDeadline: Date | null; status: string }>> };
    crewRestHours: { count(a: unknown): Promise<number> };
  };

  // --- A) Certs vencidos + próximos a vencer ──────────────────────────────
  // Alineado con el cálculo de status del módulo Certificates:
  //   - EXPIRED:       diffDays < 0  (cualquier cert ya vencido)
  //   - EXPIRING_SOON: 0 ≤ diffDays ≤ 30
  // El bug anterior usaba ventana [-7, +7] y dejaba afuera los expired
  // viejos y los que vencen entre 8-30 días.
  const d30f = new Date(now.getTime() + 30 * 86_400_000);
  try {
    const relevantCerts = await p.certificate.findMany({
      where: {
        tenantId: tenant.id, vesselCode: { in: codes }, deletedAt: null,
        expiryDate: { lte: d30f },   // todos los vencidos + los que vencen en ≤30d
      },
      select: { id: true, vesselCode: true, certificateCode: true, name: true, expiryDate: true } as never,
      take: 200,
    });
    // Agrupamos por vessel para no generar N alertas individuales
    const byVessel = new Map<string, typeof relevantCerts>();
    for (const c of relevantCerts) {
      const arr = byVessel.get(c.vesselCode) ?? [];
      arr.push(c);
      byVessel.set(c.vesselCode, arr);
    }
    for (const [vc, certs] of byVessel.entries()) {
      const overdue = certs.filter(c => c.expiryDate && new Date(c.expiryDate) < now);
      const soon    = certs.filter(c => c.expiryDate && new Date(c.expiryDate) >= now);
      if (overdue.length > 0) {
        items.push({
          id: `cert-expired-${vc}`,
          vesselCode: vc,
          vesselName: vesselNames.get(vc) ?? null,
          severity: "CRITICAL",
          title: `${overdue.length} certificado${overdue.length > 1 ? "s" : ""} vencido${overdue.length > 1 ? "s" : ""} en ${vc}`,
          summary: overdue.slice(0, 3).map(c => c.certificateCode).join(", ") + (overdue.length > 3 ? ` y ${overdue.length - 3} más` : ""),
          link: `/certificates?vesselCode=${encodeURIComponent(vc)}&status=EXPIRED`,
        });
      }
      if (soon.length > 0) {
        items.push({
          id: `cert-soon-${vc}`,
          vesselCode: vc,
          vesselName: vesselNames.get(vc) ?? null,
          severity: "WARNING",
          title: `${soon.length} certificado${soon.length > 1 ? "s" : ""} vence${soon.length === 1 ? "" : "n"} en ≤30 días en ${vc}`,
          summary: soon.slice(0, 3).map(c => c.certificateCode).join(", ") + (soon.length > 3 ? ` y ${soon.length - 3} más` : ""),
          link: `/certificates?vesselCode=${encodeURIComponent(vc)}&status=EXPIRING_SOON`,
        });
      }
    }
  } catch { /* tabla missing, skip */ }

  // --- B) OTs críticas vencidas hace mucho ---
  try {
    const overdueCriticals = await p.workOrder.findMany({
      where: {
        tenantId: tenant.id, vesselCode: { in: codes }, deletedAt: null,
        status: { in: ["PLANNED", "IN_PROGRESS"] },
        criticality: "A",
        dueDate: { lt: d30 },
      },
      select: { id: true, vesselCode: true, workOrderCode: true, criticality: true, dueDate: true } as never,
      take: 20,
    });
    const byVessel = new Map<string, typeof overdueCriticals>();
    for (const w of overdueCriticals) {
      const arr = byVessel.get(w.vesselCode) ?? [];
      arr.push(w);
      byVessel.set(w.vesselCode, arr);
    }
    for (const [vc, wos] of byVessel.entries()) {
      items.push({
        id: `wo-critical-overdue-${vc}`,
        vesselCode: vc,
        vesselName: vesselNames.get(vc) ?? null,
        severity: "CRITICAL",
        title: `${wos.length} OT crítica${wos.length > 1 ? "s" : ""} vencida${wos.length > 1 ? "s" : ""} hace +30 días en ${vc}`,
        summary: wos.slice(0, 3).map(w => w.workOrderCode).join(", ") + (wos.length > 3 ? ` y ${wos.length - 3} más` : ""),
        link: `/work-orders?view=overdue&vesselCode=${encodeURIComponent(vc)}`,
      });
    }
  } catch { /* skip */ }

  // --- C) Defectos recurrentes en mismo asset (≥3 en 60d) ---
  try {
    const grouped = await p.defect.groupBy({
      by: ["assetId", "vesselCode"],
      where: {
        tenantId: tenant.id, vesselCode: { in: codes }, deletedAt: null,
        reportedAt: { gte: d60 },
      },
      _count: { _all: true },
      having: { assetId: { _count: { gte: 3 } } },
    });
    for (const g of grouped) {
      if (!g.assetId) continue;
      items.push({
        id: `defect-recurring-${g.assetId}`,
        vesselCode: g.vesselCode,
        vesselName: vesselNames.get(g.vesselCode) ?? null,
        severity: "WARNING",
        title: `Activo con ${g._count._all} defectos en 60 días`,
        summary: `Asset ${g.assetId.slice(-8)} en ${g.vesselCode} acumula ${g._count._all} defectos. Considerar RCA + CAPA.`,
        link: `/defects?vesselCode=${encodeURIComponent(g.vesselCode)}&assetId=${encodeURIComponent(g.assetId)}`,
      });
    }
  } catch { /* skip */ }

  // --- D) Findings PSC con rectification deadline pasada ---
  try {
    const breached = await p.externalAuditFinding.findMany({
      where: {
        tenantId: tenant.id, vesselCode: { in: codes },
        status: { in: ["OPEN", "IN_PROGRESS"] },
        rectificationDeadline: { lt: now },
      },
      select: { id: true, vesselCode: true, description: true, rectificationDeadline: true, status: true } as never,
      take: 20,
    });
    const byVessel = new Map<string, typeof breached>();
    for (const f of breached) {
      const arr = byVessel.get(f.vesselCode) ?? [];
      arr.push(f);
      byVessel.set(f.vesselCode, arr);
    }
    for (const [vc, finds] of byVessel.entries()) {
      items.push({
        id: `psc-deadline-${vc}`,
        vesselCode: vc,
        vesselName: vesselNames.get(vc) ?? null,
        severity: "CRITICAL",
        title: `${finds.length} finding PSC con plazo vencido en ${vc}`,
        summary: "Findings cuyo plazo de rectificación ya pasó. Riesgo de detention o sanción.",
        link: `/external-audits?vesselCode=${encodeURIComponent(vc)}&filter=open`,
      });
    }
  } catch { /* skip */ }

  // --- E) Violaciones STCW de las últimas semanas ---
  try {
    for (const v of vessels) {
      const violations = await p.crewRestHours.count({
        where: { tenantId: tenant.id, vesselCode: v.code, hasViolation: true, recordDate: { gte: d7 } },
      });
      if (violations >= 3) {
        items.push({
          id: `stcw-${v.code}`,
          vesselCode: v.code,
          vesselName: v.name,
          severity: "WARNING",
          title: `${violations} días con violación STCW últimos 7 días en ${v.code}`,
          summary: "Horas de descanso por debajo del mínimo SOLAS/STCW. Revisar planilla.",
          link: `/rest-hours?vesselCode=${encodeURIComponent(v.code)}`,
        });
      }
    }
  } catch { /* skip */ }

  // Sort: CRITICAL primero, después WARNING, después INFO
  const sevRank: Record<SmartAlert["severity"], number> = { CRITICAL: 0, WARNING: 1, INFO: 2 };
  items.sort((a, b) => sevRank[a.severity] - sevRank[b.severity]);

  return { items: items.slice(0, 20) };
}
