// Código ISM — Capítulo 10: Mantenimiento del buque y el equipo.
//
// Misma idea que el panel TMSA: lente de evidencia READ-ONLY sobre datos que ya
// existen en el PMS, sin schema propio. NO declara conformidad ISM (eso lo
// certifica la Administración o la Organización Reconocida): muestra la
// evidencia objetiva que respalda cada cláusula, para preparar una auditoría
// interna o externa del SGS.
//
// Dos fuentes:
//   1. Los grupos de evidencia que ya calcula tmsa-service. Los dos marcos
//      miran los MISMOS datos de mantenimiento; acá se re-etiquetan con la
//      cláusula ISM que respaldan, en vez de duplicar 900 líneas de queries.
//   2. Los grupos propios de este archivo: lo que el Capítulo 10 exige y el
//      Elemento 4 de TMSA no mide (origen normativo, no conformidades con su
//      causa, medidas correctivas, registros y pruebas de equipo crítico).
//
// Texto de referencia (IMO, Código IGS/ISM):
//   10.1  La Compañía debe establecer procedimientos para asegurar que el buque
//         se mantiene de conformidad con las reglas y reglamentos pertinentes y
//         con los requisitos adicionales que ella misma establezca.
//   10.2  .1 inspecciones a intervalos apropiados; .2 toda no conformidad se
//         notifica con su posible causa, si se conoce; .3 se adoptan medidas
//         correctivas apropiadas; .4 se conserva registro de esas actividades.
//   10.3  Identificar el equipo y los sistemas técnicos cuyo fallo repentino
//         pueda ocasionar situaciones peligrosas, y prever medidas para promover
//         su fiabilidad, incluida la prueba periódica de dispositivos y equipos
//         de reserva o no usados de forma continua.
//   10.4  Las inspecciones de 10.2 y las medidas de 10.3 se integran en las
//         operaciones ordinarias de mantenimiento del buque.

import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { log } from "../../common/logger";
import { listVesselsInScope } from "../compliance/compliance-service";
import { requireAuditPanelAccess } from "../tmsa/tmsa-service";
import {
  getTmsaMaintenanceEvidence,
  type TmsaEvidenceMode,
  getTmsaMetricDetail,
  type TmsaStatus,
  type TmsaGroup,
  type TmsaMetric,
  type TmsaDetailItem,
} from "../tmsa/tmsa-service";

export type IsmStatus = TmsaStatus;
export type IsmMetric = TmsaMetric;

/**
 * Qué es exactamente lo que falta en un bloque de evidencia.
 *
 * El semáforo dice "hay una brecha"; el hallazgo dice CUÁL, y con eso la
 * pantalla arma la ventana de "qué está mal / cómo se arregla". Se emite acá y
 * no en el frontend a propósito: los umbrales que prenden el semáforo son estos
 * mismos, y si el texto los repitiera por su cuenta un día dirían cosas
 * distintas. El backend manda la clave; el texto y los pasos son i18n.
 */
export interface IsmFinding {
  /** Identifica el problema. Tiene su texto en `ism.fix.<key>.*` (web). */
  key: string;
  /** Cuántos registros lo tienen (o el porcentaje, según `kind`). */
  value: number;
  kind: "count" | "pct";
  /** Peso del hallazgo. OK nunca genera hallazgos. */
  status: Exclude<IsmStatus, "OK">;
}

export interface IsmGroup extends Omit<TmsaGroup, "element"> {
  /** Cláusula del Capítulo 10 que respalda este grupo (ej. "10.2.2"). */
  clause: string;
  /** true = el grupo se calcula acá; false = viene de la evidencia TMSA. */
  own: boolean;
  /** Lo que falta, en orden de gravedad. Vacío = nada pendiente. */
  findings: IsmFinding[];
}

export interface IsmVesselEvidence {
  /** Código del buque, o "" cuando el item consolida toda la flota. */
  vesselCode: string;
  vesselName: string;
  /** Cuántos buques entraron en el cálculo (1 salvo en el item de flota). */
  vesselCount: number;
  summary: { ok: number; attention: number; gap: number; info: number };
  groups: IsmGroup[];
}

/**
 * Grupos de tmsa-service que son evidencia válida del Capítulo 10, con la
 * cláusula que respaldan. Lo que no está acá queda fuera a propósito:
 * `managementOfChange` y `permits` pertenecen a otros capítulos del ISM
 * (gestión del cambio y operaciones), no al 10.
 */
const INHERITED_CLAUSE: Record<string, string> = {
  pmsCoverage:         "10.1",
  certificates:        "10.1",
  inspections:         "10.2.1",
  engineeringAudit:    "10.2.1",
  defectReporting:     "10.2.2",
  failureAnalysis:     "10.2.2",
  deferralControl:     "10.2.3",
  criticalEquipment:   "10.3",
  criticalSpares:      "10.3",
  conditionMonitoring: "10.3",
  plannedMaintenance:  "10.4",
  drydockSpec:         "10.4",
};

/**
 * Bloques heredados cuyos hallazgos muestra el Capítulo 10. Los calcula
 * tmsa-service junto a su semáforo y viajan con la misma clave, así que acá se
 * toman tal cual y sólo cambia el texto (`ism.fix.*` en vez de `tmsa.fix.*`).
 * Los demás grupos heredados pertenecen a otras cláusulas y se dejan sin
 * diagnóstico para no mostrar un texto que no es el de este marco.
 */
const INHERITED_WITH_FINDINGS = new Set(["inspections", "plannedMaintenance"]);

/** Orden de cláusulas para presentar los grupos en la pantalla y el PDF. */
const CLAUSE_ORDER = ["10.1", "10.2.1", "10.2.2", "10.2.3", "10.2.4", "10.3", "10.4"];

/** Grupos calculados en este archivo (los que TMSA no cubre). */
export const OWN_GROUP_KEYS = [
  "regulatoryBasis", "nonConformity", "correctiveAction", "maintenanceRecords", "standbyTesting",
] as const;
export type IsmOwnGroupKey = (typeof OWN_GROUP_KEYS)[number];

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Ejecuta una consulta y cae al fallback si falla, PERO deja el error en el log.
 * El panel no se cae por un modelo vacío, y a la vez un where mal escrito (un
 * valor de enum que no existe, por ejemplo) no pasa desapercibido como un cero:
 * en una pantalla de auditoría, un cero falso es peor que un error visible.
 */
async function safe<T>(fn: () => Promise<T>, fallback: T, label?: string): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    log.warn(`[ism-service] consulta "${label ?? "sin etiqueta"}" falló, se usa el valor por defecto:`, err);
    return fallback;
  }
}

function pct(part: number, total: number): number {
  if (total <= 0) return 1;
  const v = part / total;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

interface Delegate {
  count(a: { where: Record<string, unknown> }): Promise<number>;
  findMany(a: unknown): Promise<unknown[]>;
}

// ── Evidencia por buque ──────────────────────────────────────────────────────

export async function getIsmChapter10Evidence(
  session: TenantAccessSession,
  vesselCode: string | null,
  mode: TmsaEvidenceMode = "fleet",
): Promise<{ items: IsmVesselEvidence[] }> {
  requireAuditPanelAccess(session);
  const prisma = getPrismaClient();
  if (!prisma) return { items: [] };
  // displayName titula el bloque de flota (CLAUDE.md: nombres, no códigos).
  const tenant = await prisma.tenant.findUnique({
    where: { slug: session.tenantSlug },
    include: { settings: { select: { displayName: true } } },
  });
  if (!tenant) return { items: [] };

  const vessels = await listVesselsInScope(prisma, session, tenant.id, vesselCode);
  if (vessels.length === 0) return { items: [] };

  // La evidencia TMSA ya viene con el scope aplicado y en el mismo modo, así que
  // los grupos heredados corresponden uno a uno con los items de acá.
  const tmsa = await getTmsaMaintenanceEvidence(session, vesselCode, mode);
  const tmsaByVessel = new Map(tmsa.items.map(v => [v.vesselCode, v]));

  // Igual que TMSA: sin buque pedido y en modo flota, un único item con los
  // totales de todo el alcance (ver TmsaEvidenceMode).
  const fleetMode = mode === "fleet" && vessels.length > 1;
  const buckets: Array<{ code: string; name: string; codes: string[] }> = fleetMode
    ? [{ code: "", name: tenant.settings?.displayName ?? session.tenantSlug.toUpperCase(), codes: vessels.map(v => v.code) }]
    : vessels.map(v => ({ code: v.code, name: v.name, codes: [v.code] }));

  const items = await Promise.all(buckets.map(async (b) => {
    const inherited: IsmGroup[] = (tmsaByVessel.get(b.code)?.groups ?? [])
      .filter(g => INHERITED_CLAUSE[g.key])
      .map(g => ({
        key: g.key,
        clause: INHERITED_CLAUSE[g.key]!,
        status: g.status,
        metrics: g.metrics,
        own: false,
        findings: INHERITED_WITH_FINDINGS.has(g.key) ? g.findings : [],
      }));

    const own = await computeOwnGroups(prisma, tenant.id, b.codes);
    const groups = [...inherited, ...own].sort(
      (a, b2) => CLAUSE_ORDER.indexOf(a.clause) - CLAUSE_ORDER.indexOf(b2.clause),
    );

    const summary = { ok: 0, attention: 0, gap: 0, info: 0 };
    for (const g of groups) {
      if (g.status === "OK") summary.ok++;
      else if (g.status === "ATTENTION") summary.attention++;
      else if (g.status === "GAP") summary.gap++;
      else summary.info++;
    }

    return { vesselCode: b.code, vesselName: b.name, vesselCount: b.codes.length, summary, groups };
  }));

  return { items };
}

/**
 * Los cinco grupos que el Capítulo 10 exige y el Elemento 4 de TMSA no mide.
 * Todas las consultas van envueltas en safe(): un modelo vacío o una query que
 * falle deja el grupo en cero, nunca tumba la pantalla entera.
 */
async function computeOwnGroups(
  prisma: NonNullable<ReturnType<typeof getPrismaClient>>,
  tenantId: string,
  /** Un buque, o todos los del alcance cuando el item consolida la flota. */
  vesselCodes: string[],
): Promise<IsmGroup[]> {
  const now = new Date();
  const d30 = new Date(now.getTime() - 30 * 86_400_000);
  const d90 = new Date(now.getTime() - 90 * 86_400_000);
  const d365 = new Date(now.getTime() - 365 * 86_400_000);
  // El mismo `where` sirve para un buque o para varios.
  const vesselCode: string | { in: string[] } =
    vesselCodes.length === 1 ? vesselCodes[0]! : { in: vesselCodes };
  const base = { tenantId, vesselCode, deletedAt: null };

  const p = prisma as unknown as {
    asset: Delegate;
    maintenancePlan: Delegate;
    workOrder: Delegate;
    defect: Delegate;
    inspection: Delegate;
    inspectionExecution: Delegate;
    inspectionItemResult: Delegate;
    certificate: Delegate;
    externalAuditFinding: Delegate;
    checklistExecution: Delegate;
    workLog: Delegate;
    attachment: Delegate;
  };

  const [
    regulatoryInspections, certificatesWithPlan, certificatesTotal,
    planCriteriaRows, inspectionsWithCriteria, itemResults,
    defectsOpen, auditFindingsOpen,
    defectsClosed90d, correctiveWoOpen,
    effectivenessVerified, effectivenessOverdue,
    woClosed90d, workLogs90d, inspectionExecutions90d, maintenanceAttachments,
    safetyCriticalAssets, activePlans, preDepartureChecks30d,
  ] = await Promise.all([
    // 10.1 — inspecciones cuyo origen es una regla o la clase.
    safe(() => p.inspection.count({ where: { ...base, type: { in: ["REGULATORY", "CLASS"] } } }), 0, "regulatoryInspections"),
    // Certificado con el plan que lo renueva enganchado: es la trazabilidad
    // "regla → tarea de mantenimiento" que pide 10.1.
    safe(() => p.certificate.count({ where: { ...base, maintenancePlanId: { not: null } } }), 0, "certificatesWithPlan"),
    safe(() => p.certificate.count({ where: { ...base } }), 0, "certificatesTotal"),
    // 10.1 — origen normativo declarado en las tareas del plan. Es la forma en
    // que la mayoría de las flotas responde "¿de qué regla nace esto?": no con
    // una plantilla de inspección, sino con el plan de mantenimiento en sí.
    // Se miran los planes VIGENTES: un plan inactivo ya no mantiene nada, y
    // contarlo como pendiente de clasificar sería trabajo inventado.
    safe(
      () => p.maintenancePlan.findMany({
        where: { ...base, status: { not: "INACTIVE" } },
        select: { criteriaSource: true },
        take: 20000,
      }) as Promise<Array<{ criteriaSource: string | null }>>,
      [] as Array<{ criteriaSource: string | null }>,
      "planCriteriaRows",
    ),
    // Inspecciones completadas en el último año cuyos ítems declaran de qué
    // criterio salen. Es la otra vía de trazabilidad de 10.1, para los tenants
    // que arman sus rutinas como plantillas de inspección y no como planes.
    safe(
      () => p.inspectionExecution.count({
        where: {
          ...base, status: "COMPLETED", completedAt: { gte: d365 },
          itemResults: { some: { checklistItem: { criteriaSource: { not: null } } } },
        },
      }),
      0,
      "inspectionsWithCriteria",
    ),
    // Resultados de ítems inspeccionados en el último año, con el origen del
    // criterio (regla / clase / estándar de la Compañía) y su conformidad.
    // Alimenta 10.1 (origen normativo) y 10.2.2 (no conformidades detectadas).
    safe(
      () => p.inspectionItemResult.findMany({
        where: {
          execution: { tenantId, vesselCode, deletedAt: null, status: "COMPLETED", completedAt: { gte: d365 } },
        },
        select: { isConforming: true, checklistItem: { select: { criteriaSource: true } } },
        take: 5000,
      }) as Promise<Array<{ isConforming: boolean | null; checklistItem: { criteriaSource: string | null } | null }>>,
      [] as Array<{ isConforming: boolean | null; checklistItem: { criteriaSource: string | null } | null }>,
      "inspectionItemResults",
    ),
    // 10.2.2 — no conformidades abiertas y si tienen causa registrada.
    safe(
      () => p.defect.findMany({
        where: { ...base, status: { notIn: ["CLOSED", "RESOLVED"] } },
        select: { rcaRootCause: true, rcaImmediateCause: true, rcaContributingCause: true, severity: true },
        take: 2000,
      }) as Promise<Array<{ rcaRootCause: string | null; rcaImmediateCause: string | null; rcaContributingCause: string | null; severity: string }>>,
      [] as Array<{ rcaRootCause: string | null; rcaImmediateCause: string | null; rcaContributingCause: string | null; severity: string }>,
      "defectsOpen",
    ),
    safe(() => p.externalAuditFinding.count({ where: { tenantId, vesselCode, status: "OPEN" } }), 0, "auditFindingsOpen"),
    // 10.2.3 — defectos cerrados y si dejaron registrada la medida correctiva.
    safe(
      () => p.defect.findMany({
        where: { ...base, status: { in: ["CLOSED", "RESOLVED"] }, updatedAt: { gte: d90 } },
        select: { correctiveAction: true, rcaPreventiveActions: true },
        take: 2000,
      }) as Promise<Array<{ correctiveAction: string | null; rcaPreventiveActions: string | null }>>,
      [] as Array<{ correctiveAction: string | null; rcaPreventiveActions: string | null }>,
      "defectsClosed90d",
    ),
    safe(() => p.workOrder.count({ where: { ...base, type: "CORRECTIVE", status: { in: ["PLANNED", "IN_PROGRESS"] } } }), 0, "correctiveWoOpen"),
    // 10.2.3 — verificación de eficacia: la medida se confirma 30 días después
    // del cierre. Sólo entran los defectos cerrados con el circuito vigente
    // (effectivenessDueAt cargado); los cerrados antes no se cuentan ni a favor
    // ni en contra, porque nunca se les pidió la confirmación.
    safe(() => p.defect.count({
      where: { ...base, status: "CLOSED", effectivenessVerifiedAt: { not: null } },
    }), 0, "effectivenessVerified"),
    safe(() => p.defect.count({
      where: {
        ...base, status: "CLOSED",
        effectivenessDueAt: { not: null, lte: now },
        effectivenessVerifiedAt: null,
      },
    }), 0, "effectivenessOverdue"),
    // 10.2.4 — registros de las actividades.
    safe(() => p.workOrder.count({ where: { ...base, status: "CLOSED", completedDate: { gte: d90 } } }), 0, "woClosed90d"),
    safe(() => p.workLog.count({ where: { tenantId, vesselCode, completedAt: { gte: d90 } } }), 0, "workLogs90d"),
    // Inspecciones ejecutadas: las OT de tipo INSPECTION cerradas. Es lo que
    // usa la flota (el motor de plantillas de checklist está dormido), y es lo
    // que lista la pantalla Inspecciones.
    safe(() => p.workOrder.count({
      where: { ...base, type: "INSPECTION", status: "CLOSED", completedDate: { gte: d90 } },
    }), 0, "inspectionExecutions90d"),
    safe(() => p.attachment.count({
      where: {
        tenantId, vesselCode, deletedAt: null, status: "ACTIVE",
        targetType: { in: ["WORK_ORDER", "MAINTENANCE_PLAN", "INSPECTION"] },
      },
    }), 0, "maintenanceAttachments"),
    // 10.3 — equipo crítico para la seguridad (el flag ya existe en Asset con
    // esta misma referencia normativa) y su cobertura de mantenimiento.
    safe(
      () => p.asset.findMany({
        where: { ...base, isSafetyCritical: true },
        select: { id: true, isStandby: true, standbyTestPlanId: true },
        take: 2000,
      }) as Promise<Array<{ id: string; isStandby: boolean; standbyTestPlanId: string | null }>>,
      [] as Array<{ id: string; isStandby: boolean; standbyTestPlanId: string | null }>,
      "safetyCriticalAssets",
    ),
    // Se trae el id del plan además del asset: la prueba periódica designada
    // sólo cuenta si ese plan sigue existiendo y ACTIVO en el mismo equipo.
    safe(
      () => p.maintenancePlan.findMany({
        where: { ...base, status: "ACTIVE" },
        select: { id: true, assetId: true },
        take: 5000,
      }) as Promise<Array<{ id: string; assetId: string }>>,
      [] as Array<{ id: string; assetId: string }>,
      "activePlans",
    ),
    // Verificación previa al zarpe: es donde la tripulación prueba los equipos
    // críticos que no están en uso continuo (PROC-MAN-03 / lista de zarpe).
    safe(() => p.checklistExecution.count({
      where: { ...base, type: "PRE_DEPARTURE", status: "COMPLETED", eventDateTime: { gte: d30 } },
    }), 0, "preDepartureChecks30d"),
  ]);

  const groups: IsmGroup[] = [];

  // ── 10.1 · Base normativa del mantenimiento ────────────────────────────────
  {
    // Una "tarea con origen declarado" puede ser un plan de mantenimiento o un
    // ítem de una plantilla de inspección: las dos responden la misma pregunta
    // del Código ("¿de qué regla nace lo que hago?") y se cuentan juntas. Los
    // planes son la vía principal — casi ninguna flota arma sus rutinas como
    // plantillas de inspección.
    const RULE = ["CLASS_REQUIREMENT", "STATUTORY"];
    const COMPANY = ["COMPANY_STANDARD", "MAKER_MANUAL", "ENGINEERING_CRITERION"];
    const isRule = (v: string | null | undefined) => !!v && RULE.includes(v);
    const isCompany = (v: string | null | undefined) => !!v && COMPANY.includes(v);

    // Cada métrica que se muestra tiene que poder abrir EXACTAMENTE los
    // registros que contó (ver tmsa-filter.tsx). Por eso los planes y los ítems
    // de inspección se cuentan por separado en la tarjeta, aunque para decidir
    // el semáforo se sumen: un solo número mezclado no tendría una planilla que
    // devolviera esa misma cantidad de filas.
    const plansTotal = planCriteriaRows.length;
    const planRuleBased = planCriteriaRows.filter(pl => isRule(pl.criteriaSource)).length;
    const planCompanyBased = planCriteriaRows.filter(pl => isCompany(pl.criteriaSource)).length;
    const plansWithoutCriteria = planCriteriaRows.filter(pl => !pl.criteriaSource).length;
    // Se cuenta la INSPECCIÓN, no el renglón: un renglón de plantilla no es una
    // entidad que se pueda abrir en una planilla, y una métrica que no puede
    // mostrar sus registros no sirve delante de un auditor.
    const inspectionCriteria = inspectionsWithCriteria;

    // Sin ningún criterio trazado a una regla ni al estándar de la Compañía no
    // hay forma de mostrar de dónde sale lo que se mantiene. Mientras queden
    // tareas sin declarar, la trazabilidad está empezada pero incompleta: eso es
    // atención, no brecha.
    const declared = planRuleBased + planCompanyBased + inspectionCriteria;
    const nothingLoaded =
      plansTotal === 0 && itemResults.length === 0 && regulatoryInspections === 0 && certificatesTotal === 0;
    const status: IsmStatus =
      nothingLoaded ? "INFO" :
      declared === 0 && regulatoryInspections === 0 ? "GAP" :
      plansWithoutCriteria > 0 ? "ATTENTION" :
      certificatesTotal > 0 && certificatesWithPlan === 0 ? "ATTENTION" : "OK";

    // Qué falta, con el mismo criterio que prendió el semáforo de arriba.
    const findings: IsmFinding[] = [];
    if (nothingLoaded) {
      findings.push({ key: "regulatoryNothing", value: 0, kind: "count", status: "INFO" });
    } else {
      if (declared === 0 && regulatoryInspections === 0) {
        findings.push({ key: "regulatoryUndeclared", value: plansWithoutCriteria, kind: "count", status: "GAP" });
      } else if (plansWithoutCriteria > 0) {
        findings.push({ key: "plansWithoutCriteria", value: plansWithoutCriteria, kind: "count", status: "ATTENTION" });
      }
      if (certificatesTotal > 0 && certificatesWithPlan === 0) {
        findings.push({ key: "certificatesWithoutPlan", value: certificatesTotal, kind: "count", status: "ATTENTION" });
      }
    }

    groups.push({
      key: "regulatoryBasis", clause: "10.1", status, own: true, findings,
      metrics: [
        { key: "ismRuleBasedCriteria", value: planRuleBased, kind: "count" },
        { key: "ismCompanyCriteria", value: planCompanyBased, kind: "count" },
        { key: "ismPlansWithoutCriteria", value: plansWithoutCriteria, kind: "count" },
        { key: "ismInspectionCriteria", value: inspectionCriteria, kind: "count" },
        { key: "ismRegulatoryInspections", value: regulatoryInspections, kind: "count" },
        { key: "ismCertificatesWithPlan", value: certificatesWithPlan, kind: "count" },
      ],
    });
  }

  // ── 10.2.2 · No conformidades notificadas con su causa ─────────────────────
  {
    const ncOpen = defectsOpen.length;
    const withCause = defectsOpen.filter(
      d => (d.rcaRootCause ?? d.rcaImmediateCause ?? d.rcaContributingCause ?? "").trim() !== "",
    ).length;
    const withoutCause = ncOpen - withCause;
    const nonConformingItems = itemResults.filter(r => r.isConforming === false).length;

    // El Código pide la causa "si se conoce", así que no tener causa en TODAS no
    // es incumplimiento; sí lo es no tener ninguna cuando hay muchas abiertas.
    const status: IsmStatus =
      ncOpen === 0 && auditFindingsOpen === 0 ? "OK" :
      ncOpen >= 3 && withCause === 0 ? "GAP" :
      withoutCause > 0 ? "ATTENTION" : "OK";

    const findings: IsmFinding[] = [];
    if (ncOpen >= 3 && withCause === 0) {
      findings.push({ key: "ncNoCause", value: ncOpen, kind: "count", status: "GAP" });
    } else if (withoutCause > 0) {
      findings.push({ key: "ncWithoutCause", value: withoutCause, kind: "count", status: "ATTENTION" });
    }
    // No mueve el semáforo (el hallazgo de auditoría se gestiona en su módulo),
    // pero es un pendiente del buque y el auditor lo va a cruzar con las NC.
    if (auditFindingsOpen > 0) {
      findings.push({ key: "auditFindingsOpen", value: auditFindingsOpen, kind: "count", status: "INFO" });
    }

    groups.push({
      key: "nonConformity", clause: "10.2.2", status, own: true, findings,
      metrics: [
        { key: "ismNcOpen", value: ncOpen, kind: "count" },
        { key: "ismNcWithCause", value: withCause, kind: "count" },
        { key: "ismNcWithoutCause", value: withoutCause, kind: "count" },
        { key: "ismAuditFindingsOpen", value: auditFindingsOpen, kind: "count" },
        { key: "ismInspectionNonConforming", value: nonConformingItems, kind: "count" },
      ],
    });
  }

  // ── 10.2.3 · Medidas correctivas ───────────────────────────────────────────
  {
    const closed = defectsClosed90d.length;
    const withAction = defectsClosed90d.filter(
      d => (d.correctiveAction ?? "").trim() !== "" || (d.rcaPreventiveActions ?? "").trim() !== "",
    ).length;
    const withoutAction = closed - withAction;
    const rate = pct(withAction, closed);

    // La medida registrada dice QUÉ se hizo; la verificación de eficacia dice si
    // SIRVIÓ. Una confirmación vencida es evidencia que el auditor va a pedir y
    // todavía no existe, así que baja el semáforo a atención.
    const status: IsmStatus =
      closed === 0 && effectivenessVerified === 0 && effectivenessOverdue === 0 ? "INFO" :
      closed > 0 && rate < 0.5 ? "GAP" :
      withoutAction > 0 || effectivenessOverdue > 0 ? "ATTENTION" : "OK";

    const findings: IsmFinding[] = [];
    if (closed === 0 && effectivenessVerified === 0 && effectivenessOverdue === 0) {
      findings.push({ key: "caNothing", value: 0, kind: "count", status: "INFO" });
    } else {
      if (closed > 0 && rate < 0.5) {
        findings.push({ key: "caLowRate", value: rate, kind: "pct", status: "GAP" });
      } else if (withoutAction > 0) {
        findings.push({ key: "caWithoutAction", value: withoutAction, kind: "count", status: "ATTENTION" });
      }
      if (effectivenessOverdue > 0) {
        findings.push({ key: "caEffectivenessOverdue", value: effectivenessOverdue, kind: "count", status: "ATTENTION" });
      }
    }

    groups.push({
      key: "correctiveAction", clause: "10.2.3", status, own: true, findings,
      metrics: [
        { key: "ismDefectsClosed90d", value: closed, kind: "count" },
        { key: "ismClosedWithAction", value: withAction, kind: "count" },
        { key: "ismClosedWithoutAction", value: withoutAction, kind: "count" },
        { key: "ismCorrectiveWoOpen", value: correctiveWoOpen, kind: "count" },
        { key: "ismEffectivenessVerified", value: effectivenessVerified, kind: "count" },
        { key: "ismEffectivenessOverdue", value: effectivenessOverdue, kind: "count" },
        { key: "ismCorrectiveActionRate", value: rate, kind: "pct" },
      ],
    });
  }

  // ── 10.2.4 · Registro de las actividades ───────────────────────────────────
  {
    // Una OT cerrada sin ningún parte de trabajo asociado es mantenimiento
    // hecho sin registro: es exactamente lo que un auditor busca.
    const coverage = pct(workLogs90d, woClosed90d);
    const status: IsmStatus =
      woClosed90d === 0 ? "INFO" :
      workLogs90d === 0 ? "GAP" :
      coverage < 0.8 ? "ATTENTION" : "OK";

    const findings: IsmFinding[] = [];
    if (woClosed90d === 0) {
      findings.push({ key: "recNothing", value: 0, kind: "count", status: "INFO" });
    } else if (workLogs90d === 0) {
      findings.push({ key: "recNoWorkLogs", value: woClosed90d, kind: "count", status: "GAP" });
    } else if (coverage < 0.8) {
      findings.push({ key: "recLowCoverage", value: coverage, kind: "pct", status: "ATTENTION" });
    }

    groups.push({
      key: "maintenanceRecords", clause: "10.2.4", status, own: true, findings,
      metrics: [
        { key: "ismWoClosed90d", value: woClosed90d, kind: "count" },
        { key: "ismWorkLogs90d", value: workLogs90d, kind: "count" },
        { key: "ismInspectionExecutions90d", value: inspectionExecutions90d, kind: "count" },
        { key: "ismMaintenanceAttachments", value: maintenanceAttachments, kind: "count" },
        { key: "ismRecordCoverage", value: coverage, kind: "pct" },
      ],
    });
  }

  // ── 10.3 · Fiabilidad del equipo crítico y pruebas periódicas ──────────────
  {
    const planned = new Set(activePlans.map(pl => pl.assetId));
    // planId → assetId de los planes ACTIVE: sirve para verificar que la prueba
    // designada siga viva Y siga siendo del mismo equipo (el puntero del Asset
    // no tiene FK; ver schema.prisma · Asset.standbyTestPlanId).
    const activePlanOwner = new Map(activePlans.map(pl => [pl.id, pl.assetId]));
    const total = safetyCriticalAssets.length;
    const withPlan = safetyCriticalAssets.filter(a => planned.has(a.id)).length;
    const withoutPlan = total - withPlan;

    // Segunda mitad del 10.3: el equipo que no está en uso continuo hay que
    // probarlo periódicamente. La prueba no es un registro aparte: es una de las
    // tareas del propio equipo, designada en su ficha.
    const standby = safetyCriticalAssets.filter(a => a.isStandby);
    const hasTest = (a: { id: string; standbyTestPlanId: string | null }) =>
      !!a.standbyTestPlanId && activePlanOwner.get(a.standbyTestPlanId) === a.id;
    const standbyTotal = standby.length;
    const standbyWithTest = standby.filter(hasTest).length;
    const standbyWithoutTest = standbyTotal - standbyWithTest;

    // Un equipo crítico sin plan activo no tiene ninguna medida que promueva su
    // fiabilidad, y uno de reserva sin prueba periódica designada no cumple la
    // exigencia expresa de la cláusula: las dos son brecha directa de 10.3.
    const status: IsmStatus =
      total === 0 ? "INFO" :
      withoutPlan > 0 || standbyWithoutTest > 0 ? "GAP" :
      preDepartureChecks30d === 0 ? "ATTENTION" : "OK";

    const findings: IsmFinding[] = [];
    if (total === 0) {
      findings.push({ key: "scNothing", value: 0, kind: "count", status: "INFO" });
    } else {
      if (withoutPlan > 0) {
        findings.push({ key: "scWithoutPlan", value: withoutPlan, kind: "count", status: "GAP" });
      }
      if (standbyWithoutTest > 0) {
        findings.push({ key: "standbyWithoutTest", value: standbyWithoutTest, kind: "count", status: "GAP" });
      }
      if (preDepartureChecks30d === 0) {
        findings.push({ key: "preDepartureMissing", value: 0, kind: "count", status: "ATTENTION" });
      }
    }

    groups.push({
      key: "standbyTesting", clause: "10.3", status, own: true, findings,
      metrics: [
        { key: "ismSafetyCriticalTotal", value: total, kind: "count" },
        { key: "ismSafetyCriticalWithPlan", value: withPlan, kind: "count" },
        { key: "ismSafetyCriticalWithoutPlan", value: withoutPlan, kind: "count" },
        { key: "ismStandbyTotal", value: standbyTotal, kind: "count" },
        { key: "ismStandbyWithTest", value: standbyWithTest, kind: "count" },
        { key: "ismStandbyWithoutTest", value: standbyWithoutTest, kind: "count" },
        { key: "ismPreDepartureChecks30d", value: preDepartureChecks30d, kind: "count" },
      ],
    });
  }

  return groups;
}

// ── Drill-down ───────────────────────────────────────────────────────────────
// Las métricas propias se resuelven acá; las heredadas se delegan en TMSA, que
// ya sabe listar los registros detrás de cada una.

export async function getIsmMetricDetail(
  session: TenantAccessSession,
  vesselCode: string,
  metric: string,
): Promise<{ items: TmsaDetailItem[] }> {
  requireAuditPanelAccess(session);
  if (!metric.startsWith("ism")) return getTmsaMetricDetail(session, vesselCode, metric);

  const prisma = getPrismaClient();
  if (!prisma) return { items: [] };
  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) return { items: [] };
  // Mismo chequeo anti-bypass que usa TMSA: el vessel pedido tiene que estar
  // dentro del alcance del usuario.
  const vessels = await listVesselsInScope(prisma, session, tenant.id, vesselCode);
  if (vessels.length === 0) return { items: [] };

  const tenantId = tenant.id;
  const now = new Date();
  const d30 = new Date(now.getTime() - 30 * 86_400_000);
  const d90 = new Date(now.getTime() - 90 * 86_400_000);
  const d365 = new Date(now.getTime() - 365 * 86_400_000);
  // vesselCode vacío = detalle de una tarjeta de flota: mismo alcance que usó
  // computeOwnGroups para contarla, así el número y la lista no se separan.
  const scope: string | { in: string[] } = vesselCode ? vesselCode : { in: vessels.map(v => v.code) };
  const base = { tenantId, vesselCode: scope, deletedAt: null };

  const p = prisma as unknown as {
    asset: { findMany(a: unknown): Promise<any[]> };
    maintenancePlan: { findMany(a: unknown): Promise<any[]> };
    workOrder: { findMany(a: unknown): Promise<any[]> };
    defect: { findMany(a: unknown): Promise<any[]> };
    inspection: { findMany(a: unknown): Promise<any[]> };
    certificate: { findMany(a: unknown): Promise<any[]> };
    externalAuditFinding: { findMany(a: unknown): Promise<any[]> };
    checklistExecution: { findMany(a: unknown): Promise<any[]> };
    inspectionExecution: { findMany(a: unknown): Promise<any[]> };
  };

  const isoDate = (d: Date | string | null | undefined) =>
    d ? new Date(d).toISOString().slice(0, 10) : null;

  const asDefect = (d: any): TmsaDetailItem =>
    ({ id: d.id, code: d.defectCode, label: d.classification ?? d.defectCode, sublabel: `${d.status} · ${d.severity}`, entityType: "defect" });
  const asWorkOrder = (w: any): TmsaDetailItem =>
    ({ id: w.id, code: w.workOrderCode, label: w.title ?? w.workOrderCode, sublabel: w.dueDate ? `Vencimiento ${isoDate(w.dueDate)}` : w.status, entityType: "workOrder" });
  const asAsset = (a: any): TmsaDetailItem =>
    ({ id: a.id, code: a.assetCode, label: a.name ?? a.assetCode, sublabel: `Criticidad ${a.criticality} · ${a.status}`, entityType: "asset" });
  const asPlan = (pl: any): TmsaDetailItem =>
    ({ id: pl.id, code: pl.taskCode, label: pl.title ?? pl.taskCode, sublabel: pl.criteriaSource ?? pl.status, entityType: "maintenancePlan" });

  // Mismo tope que el detalle de TMSA (DETAIL_CAP). Con 100 la vista de flota se
  // quedaba corta —147 OT cerradas devolvían 100— y la planilla filtrada habría
  // mostrado menos filas de las que dice la tarjeta.
  const TAKE = 1000;
  // Un buque tiene cientos de planes vigentes: con el tope de 100 la planilla
  // mostraría muchas menos filas que el número de la tarjeta y encima sin avisar
  // (el cartel de "truncado" recién salta en 1000, DETAIL_CAP de tmsa-filter.tsx).
  const PLAN_TAKE = 1000;

  switch (metric) {
    // 10.1
    case "ismRegulatoryInspections": {
      const rows = await p.inspection.findMany({
        where: { ...base, type: { in: ["REGULATORY", "CLASS"] } },
        select: { id: true, inspectionCode: true, type: true, status: true, scheduledAt: true },
        orderBy: { scheduledAt: "desc" }, take: TAKE,
      });
      return { items: rows.map(i => ({
        id: i.id, code: i.inspectionCode, label: i.type,
        sublabel: `${i.status}${i.scheduledAt ? ` · ${isoDate(i.scheduledAt)}` : ""}`, entityType: "inspection" as const,
      })) };
    }
    case "ismRuleBasedCriteria":
    case "ismCompanyCriteria":
    case "ismPlansWithoutCriteria": {
      // Mismo where que contó la tarjeta: planes VIGENTES del buque, filtrados
      // por el origen normativo que corresponde a la métrica.
      const RULE = ["CLASS_REQUIREMENT", "STATUTORY"];
      const COMPANY = ["COMPANY_STANDARD", "MAKER_MANUAL", "ENGINEERING_CRITERION"];
      const criteriaWhere =
        metric === "ismRuleBasedCriteria" ? { in: RULE } :
        metric === "ismCompanyCriteria" ? { in: COMPANY } : null;
      const rows = await p.maintenancePlan.findMany({
        where: { ...base, status: { not: "INACTIVE" }, criteriaSource: criteriaWhere },
        select: { id: true, taskCode: true, title: true, status: true, criteriaSource: true },
        orderBy: { taskCode: "asc" }, take: PLAN_TAKE,
      });
      return { items: rows.map(asPlan) };
    }
    case "ismInspectionCriteria": {
      const rows = await p.inspectionExecution.findMany({
        where: {
          ...base, status: "COMPLETED", completedAt: { gte: d365 },
          itemResults: { some: { checklistItem: { criteriaSource: { not: null } } } },
        },
        select: { id: true, executionCode: true, completedAt: true, template: { select: { title: true } } },
        orderBy: { completedAt: "desc" }, take: TAKE,
      });
      return { items: rows.map(e => ({
        id: e.id, code: e.executionCode, label: e.template?.title ?? e.executionCode,
        sublabel: isoDate(e.completedAt), entityType: "inspection" as const,
      })) };
    }
    case "ismCertificatesWithPlan": {
      const rows = await p.certificate.findMany({
        where: { ...base, maintenancePlanId: { not: null } },
        select: { id: true, certificateCode: true, name: true, issuingAuthority: true, expiryDate: true },
        orderBy: { expiryDate: "asc" }, take: TAKE,
      });
      return { items: rows.map(c => ({
        id: c.id, code: c.certificateCode, label: c.name,
        sublabel: `${c.issuingAuthority} · vence ${isoDate(c.expiryDate)}`, entityType: "certificate" as const,
      })) };
    }

    // 10.2.2
    case "ismNcOpen":
    case "ismNcWithCause":
    case "ismNcWithoutCause": {
      const rows = await p.defect.findMany({
        where: { ...base, status: { notIn: ["CLOSED", "RESOLVED"] } },
        select: {
          id: true, defectCode: true, classification: true, status: true, severity: true,
          rcaRootCause: true, rcaImmediateCause: true, rcaContributingCause: true,
        },
        orderBy: { reportedAt: "desc" }, take: 500,
      });
      const hasCause = (d: any) => ((d.rcaRootCause ?? d.rcaImmediateCause ?? d.rcaContributingCause ?? "") as string).trim() !== "";
      const filtered = metric === "ismNcWithCause" ? rows.filter(hasCause)
        : metric === "ismNcWithoutCause" ? rows.filter(d => !hasCause(d))
        : rows;
      return { items: filtered.slice(0, TAKE).map(asDefect) };
    }
    case "ismAuditFindingsOpen": {
      const rows = await p.externalAuditFinding.findMany({
        where: { tenantId, vesselCode: scope, status: "OPEN" },
        select: { id: true, findingCode: true, description: true, severity: true, findingType: true },
        take: TAKE,
      });
      return { items: rows.map(f => ({
        id: f.id, code: f.findingCode ?? f.findingType, label: f.description,
        sublabel: f.severity ?? f.findingType, entityType: "defect" as const,
      })) };
    }

    // 10.2.3
    case "ismDefectsClosed90d":
    case "ismClosedWithAction":
    case "ismClosedWithoutAction": {
      const rows = await p.defect.findMany({
        where: { ...base, status: { in: ["CLOSED", "RESOLVED"] }, updatedAt: { gte: d90 } },
        select: {
          id: true, defectCode: true, classification: true, status: true, severity: true,
          correctiveAction: true, rcaPreventiveActions: true,
        },
        orderBy: { updatedAt: "desc" }, take: 500,
      });
      const hasAction = (d: any) =>
        ((d.correctiveAction ?? "") as string).trim() !== "" || ((d.rcaPreventiveActions ?? "") as string).trim() !== "";
      const filtered = metric === "ismClosedWithAction" ? rows.filter(hasAction)
        : metric === "ismClosedWithoutAction" ? rows.filter(d => !hasAction(d))
        : rows;
      return { items: filtered.slice(0, TAKE).map(asDefect) };
    }
    case "ismEffectivenessVerified": {
      const rows = await p.defect.findMany({
        where: { ...base, status: "CLOSED", effectivenessVerifiedAt: { not: null } },
        select: { id: true, defectCode: true, classification: true, status: true, severity: true },
        orderBy: { effectivenessVerifiedAt: "desc" }, take: TAKE,
      });
      return { items: rows.map(asDefect) };
    }
    case "ismEffectivenessOverdue": {
      const rows = await p.defect.findMany({
        where: {
          ...base, status: "CLOSED",
          effectivenessDueAt: { not: null, lte: new Date() },
          effectivenessVerifiedAt: null,
        },
        select: { id: true, defectCode: true, classification: true, status: true, severity: true },
        orderBy: { effectivenessDueAt: "asc" }, take: TAKE,
      });
      return { items: rows.map(asDefect) };
    }
    case "ismCorrectiveWoOpen": {
      const rows = await p.workOrder.findMany({
        where: { ...base, type: "CORRECTIVE", status: { in: ["PLANNED", "IN_PROGRESS"] } },
        select: { id: true, workOrderCode: true, title: true, dueDate: true, status: true },
        orderBy: { dueDate: "asc" }, take: TAKE,
      });
      return { items: rows.map(asWorkOrder) };
    }

    // 10.2.4
    case "ismWoClosed90d": {
      const rows = await p.workOrder.findMany({
        where: { ...base, status: "CLOSED", completedDate: { gte: d90 } },
        select: { id: true, workOrderCode: true, title: true, dueDate: true, status: true },
        orderBy: { completedDate: "desc" }, take: TAKE,
      });
      return { items: rows.map(asWorkOrder) };
    }

    // 10.3
    case "ismSafetyCriticalTotal":
    case "ismSafetyCriticalWithPlan":
    case "ismSafetyCriticalWithoutPlan":
    case "ismStandbyTotal":
    case "ismStandbyWithTest":
    case "ismStandbyWithoutTest": {
      const [assets, plans] = await Promise.all([
        p.asset.findMany({
          where: { ...base, isSafetyCritical: true },
          select: {
            id: true, assetCode: true, name: true, criticality: true, status: true,
            isStandby: true, standbyTestPlanId: true,
          },
          orderBy: { assetCode: "asc" }, take: 500,
        }),
        p.maintenancePlan.findMany({ where: { ...base, status: "ACTIVE" }, select: { id: true, assetId: true }, take: 5000 }),
      ]);
      const planned = new Set(plans.map((pl: any) => pl.assetId));
      const activePlanOwner = new Map(plans.map((pl: any) => [pl.id, pl.assetId]));
      const hasTest = (a: any) => !!a.standbyTestPlanId && activePlanOwner.get(a.standbyTestPlanId) === a.id;
      const standby = assets.filter((a: any) => a.isStandby);
      const filtered = metric === "ismSafetyCriticalWithPlan" ? assets.filter((a: any) => planned.has(a.id))
        : metric === "ismSafetyCriticalWithoutPlan" ? assets.filter((a: any) => !planned.has(a.id))
        : metric === "ismStandbyTotal" ? standby
        : metric === "ismStandbyWithTest" ? standby.filter(hasTest)
        : metric === "ismStandbyWithoutTest" ? standby.filter((a: any) => !hasTest(a))
        : assets;
      return { items: filtered.slice(0, TAKE).map(asAsset) };
    }
    case "ismPreDepartureChecks30d": {
      const rows = await p.checklistExecution.findMany({
        where: { ...base, type: "PRE_DEPARTURE", status: "COMPLETED", eventDateTime: { gte: d30 } },
        select: { id: true, executionCode: true, eventDateTime: true, port: true, notConformingItems: true },
        orderBy: { eventDateTime: "desc" }, take: TAKE,
      });
      return { items: rows.map(c => ({
        id: c.id, code: c.executionCode, label: `${isoDate(c.eventDateTime)}${c.port ? ` · ${c.port}` : ""}`,
        sublabel: c.notConformingItems > 0 ? `${c.notConformingItems} no conformes` : "Sin observaciones",
        entityType: "inspection" as const,
      })) };
    }

    default:
      return { items: [] };
  }
}
