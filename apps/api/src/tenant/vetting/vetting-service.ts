// Vetting · BIQ5 (OCIMF Barge Inspection Questionnaire, S.Am / C.Am v2.0).
//
// Tercer panel de evidencia, hermano de TMSA (Elemento 4) e ISM (Capítulo 10):
// READ-ONLY y sin schema propio. Muestra, por capítulo del BIQ, la evidencia que
// el PMS ya tiene para la inspección de vetting de una barcaza o un remolcador.
// NO predice el resultado de la inspección ni declara cumplimiento: buena parte
// del BIQ se verifica mirando el buque (que el radar ande hoy, la limpieza de la
// cubierta, la bandera roja izada) y eso queda "a verificar a bordo".
//
// Tres fuentes:
//   1. Grupos de tmsa-service que responden preguntas del BIQ (certificados,
//      permisos de trabajo y el sistema de mantenimiento planificado de la 11.2),
//      re-etiquetados con su capítulo. Viajan con sus hallazgos y su texto
//      `tmsa.fix.*`: describen el mismo problema con las mismas palabras.
//   2. Grupos propios: ficha del buque, ciclo de clase, inspecciones externas,
//      tripulación y simulacros.
//   3. Grupos por tema de equipo (vetting-topics.ts): el BIQ pregunta por la
//      bomba de incendio, las balsas o el guinche de remolque, y acá se mira si
//      esos equipos tienen plan, si hay mantenimiento vencido y defectos abiertos.
//
// Los textos del BIQ son de OCIMF (copyright): acá sólo viaja el número de
// pregunta; el resumen de cada capítulo está escrito con palabras propias en la
// web (i18n `vet.chapter.*`).

import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { log } from "../../common/logger";
import { listVesselsInScope } from "../compliance/compliance-service";
import { getDrillsMatrix, type DrillMatrixCell } from "../drills/drills-service";
import { isVesselCrewed } from "../ai/vessel-ai-context";
import { classCycleLevel, isClassCertificateName, loadClassCycles, type ClassCycleInfo } from "../certificates/class-cycle";
import { resolveComputedStatus } from "../certificates/certificates-service";
import {
  requireAuditPanelAccess,
  getTmsaMaintenanceEvidence,
  getTmsaMetricDetail,
  type TmsaEvidenceMode,
  type TmsaStatus,
  type TmsaMetric,
  type TmsaFinding,
  type TmsaEntityType,
} from "../tmsa/tmsa-service";
import {
  BIQ_CHAPTERS,
  VETTING_TOPICS,
  assetMatchesTopic,
  parseTopicMetricKey,
  topicMetricKey,
  type BiqChapter,
  type TopicMeasure,
  type VettingTopic,
} from "./vetting-topics";

export type VetStatus = TmsaStatus;
export type VetFinding = TmsaFinding;

export interface VetGroup {
  key: string;
  chapter: BiqChapter;
  /** Números de pregunta del BIQ que respalda (ej. "2.10–2.16"). */
  questions: string;
  status: VetStatus;
  metrics: TmsaMetric[];
  /** Lo que falta, en orden de gravedad. Vacío = nada pendiente. */
  findings: VetFinding[];
  /** true = se calcula acá; false = viene de la evidencia TMSA. */
  own: boolean;
}

export interface VetVesselEvidence {
  /** Código del buque, o "" cuando el item consolida toda la flota. */
  vesselCode: string;
  vesselName: string;
  vesselCount: number;
  /** Cuántos llevan dotación y cuántos no: decide qué capítulos aplican. */
  crewedCount: number;
  uncrewedCount: number;
  summary: { ok: number; attention: number; gap: number; info: number };
  groups: VetGroup[];
}

export type VetEntityType = TmsaEntityType | "vessel" | "crew" | "drill" | "externalAudit";

export interface VetDetailItem {
  id: string;
  code: string;
  label: string;
  sublabel?: string | null;
  entityType: VetEntityType;
}

/** Grupos de tmsa-service que responden preguntas del BIQ, con su ubicación. */
const INHERITED: Record<string, { chapter: BiqChapter; questions: string }> = {
  certificates:       { chapter: "2",  questions: "2.1" },
  permits:            { chapter: "5",  questions: "5.30" },
  pmsCoverage:        { chapter: "11", questions: "11.2" },
  plannedMaintenance: { chapter: "11", questions: "11.2" },
  criticalSpares:     { chapter: "11", questions: "11.2" },
  deferralControl:    { chapter: "11", questions: "11.2" },
};

/**
 * Módulo del que sale cada bloque. Si la empresa lo ocultó del menú
 * (Configuración → módulos visibles), el bloque no se arma: mostraría "sin
 * datos" y mandaría a cargar en una pantalla que nadie ve. Esa parte del
 * capítulo queda, como el resto de lo físico, a verificar a bordo.
 * En mercurio están ocultos Tripulantes, Simulacros y Auditoría externa.
 */
const GROUP_MODULE: Record<string, string> = {
  externalInspections: "/external-audits",
  crewCompliance:      "/crew",
  drills:              "/drills",
  permits:             "/permits",
};

/** Grupos propios (sin contar los temas de equipo). */
export const OWN_GROUP_KEYS = [
  "vesselParticulars", "classSurveys", "externalInspections", "crewCompliance", "drills",
] as const;

/** Datos de la ficha que pide el capítulo 1. El IMO no: el BIQ admite "no asignado". */
const PARTICULAR_FIELDS = [
  ["registration", "matrícula"],
  ["vesselType", "tipo"],
  ["owner", "armador"],
  ["buildYear", "año de construcción"],
  ["dwtTons", "porte bruto"],
  ["trbTn", "arqueo bruto"],
] as const;

/** Días que faltan para que una inspección de dique o de eje se considere próxima. */
const DOCK_DUE_SOON_DAYS = 90;
/** Tope de filas del detalle, igual que TMSA (lo lee el filtro de las planillas). */
const DETAIL_CAP = 1000;

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Igual que en ism-service: la consulta que falla deja el valor por defecto y
 * el error en el log. Un cero falso en una pantalla de auditoría es peor que un
 * error visible, por eso no se traga en silencio.
 */
async function safe<T>(fn: () => Promise<T>, fallback: T, label: string): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    log.warn(`[vetting-service] consulta "${label}" falló, se usa el valor por defecto:`, err);
    return fallback;
  }
}

const isoDate = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : "");
const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, d.getDate());

function summarize(groups: VetGroup[]) {
  const summary = { ok: 0, attention: 0, gap: 0, info: 0 };
  for (const g of groups) {
    if (g.status === "OK") summary.ok++;
    else if (g.status === "ATTENTION") summary.attention++;
    else if (g.status === "GAP") summary.gap++;
    else summary.info++;
  }
  return summary;
}

// ── Datos crudos ─────────────────────────────────────────────────────────────
// Se cargan UNA vez para todos los buques del alcance y después se reparten por
// bloque. El detalle usa el mismo cargador: así el número de la tarjeta y la
// lista que abre no pueden separarse.

interface VesselFacts {
  code: string;
  name: string;
  vesselType: string | null;
  isCrewed: boolean | null;
  registration: string | null;
  owner: string | null;
  buildYear: number | null;
  dwtTons: number | null;
  trbTn: number | null;
}
interface AssetRow { id: string; vesselCode: string; assetCode: string; name: string; planNotRequired: boolean; criticality: string; status: string }
interface PlanRow { id: string; assetId: string; vesselCode: string; taskCode: string; title: string; executionStatus: string | null; nextDueDate: Date | null }
interface DefectRow { id: string; assetId: string; vesselCode: string; defectCode: string; classification: string | null; status: string; severity: string }
interface CertRow {
  id: string; vesselCode: string; certificateCode: string; name: string; issuingAuthority: string;
  status: string; expiryDate: Date;
  intermediateSurveyDate: Date | null; intermediateSurveyDueDate: Date | null;
  periodicSurveyDate: Date | null; periodicSurveyDueDate: Date | null;
  drydockSurveyDate: Date | null; drydockSurveyDueDate: Date | null;
  tailshaftSurveyDate: Date | null; tailshaftSurveyDueDate: Date | null;
}
interface AuditRow { id: string; vesselCode: string; auditCode: string; auditType: string; auditDate: Date; agencyOrAuthority: string | null }
interface FindingRow { id: string; vesselCode: string; findingCode: string | null; findingType: string; description: string; rectificationDeadline: Date | null }
interface CrewRow { id: string; vesselCode: string; crewCode: string; firstName: string; lastName: string }
interface CrewCertRow { id: string; crewId: string; type: string; expiryDate: Date | null }
interface RestRow { id: string; vesselCode: string; crewId: string; recordDate: Date; hasViolation: boolean }

interface VettingData {
  facts: Map<string, VesselFacts>;
  crewed: Map<string, boolean | null>;
  assets: AssetRow[];
  plans: PlanRow[];
  defects: DefectRow[];
  certs: CertRow[];
  cycles: Map<string, ClassCycleInfo>;
  audits12m: AuditRow[];
  findingsOpen: FindingRow[];
  crew: CrewRow[];
  crewCerts: CrewCertRow[];
  rest30d: RestRow[];
  drillCells: DrillMatrixCell[];
}

type FindMany = { findMany(a: unknown): Promise<unknown[]> };

async function loadVettingData(
  prisma: NonNullable<ReturnType<typeof getPrismaClient>>,
  session: TenantAccessSession,
  tenantId: string,
  codes: string[],
  /** Buque pedido (null = todo el alcance): acota la matriz de simulacros. */
  requestedVessel: string | null,
): Promise<VettingData> {
  const now = new Date();
  const d30 = new Date(now.getTime() - 30 * 86_400_000);
  const d365 = new Date(now.getTime() - 365 * 86_400_000);
  const inCodes = { in: codes };
  const p = prisma as unknown as {
    vessel: FindMany; asset: FindMany; maintenancePlan: FindMany; defect: FindMany; certificate: FindMany;
    externalAudit: FindMany; externalAuditFinding: FindMany; crew: FindMany; crewCertification: FindMany;
    crewRestHours: FindMany;
  };

  const [facts, assets, plans, defects, certs, cycles, audits12m, findingsOpen, crew, crewCerts, rest30d, drills] = await Promise.all([
    safe(() => p.vessel.findMany({
      where: { tenantId, code: inCodes, deletedAt: null },
      select: { code: true, name: true, vesselType: true, isCrewed: true, registration: true, owner: true, buildYear: true, dwtTons: true, trbTn: true },
    }) as Promise<VesselFacts[]>, [], "vessels"),
    safe(() => p.asset.findMany({
      where: { tenantId, vesselCode: inCodes, deletedAt: null },
      select: { id: true, vesselCode: true, assetCode: true, name: true, planNotRequired: true, criticality: true, status: true },
      orderBy: { assetCode: "asc" },
      take: 20000,
    }) as Promise<AssetRow[]>, [], "assets"),
    // Plan vigente = status ACTIVE, igual que la cobertura de TMSA. El vencimiento
    // vive en executionStatus (status nunca pasa a OVERDUE en la práctica).
    safe(() => p.maintenancePlan.findMany({
      where: { tenantId, vesselCode: inCodes, deletedAt: null, status: "ACTIVE" },
      select: { id: true, assetId: true, vesselCode: true, taskCode: true, title: true, executionStatus: true, nextDueDate: true },
      take: 20000,
    }) as Promise<PlanRow[]>, [], "plans"),
    safe(() => p.defect.findMany({
      where: { tenantId, vesselCode: inCodes, deletedAt: null, status: { notIn: ["RESOLVED", "CLOSED"] } },
      select: { id: true, assetId: true, vesselCode: true, defectCode: true, classification: true, status: true, severity: true },
      orderBy: { reportedAt: "desc" },
      take: 5000,
    }) as Promise<DefectRow[]>, [], "openDefects"),
    safe(() => p.certificate.findMany({
      where: { tenantId, vesselCode: inCodes, deletedAt: null },
      select: {
        id: true, vesselCode: true, certificateCode: true, name: true, issuingAuthority: true, status: true, expiryDate: true,
        intermediateSurveyDate: true, intermediateSurveyDueDate: true, periodicSurveyDate: true, periodicSurveyDueDate: true,
        drydockSurveyDate: true, drydockSurveyDueDate: true, tailshaftSurveyDate: true, tailshaftSurveyDueDate: true,
      },
      orderBy: { expiryDate: "desc" },
    }) as Promise<CertRow[]>, [], "certificates"),
    safe(() => loadClassCycles(prisma, tenantId, codes), new Map<string, ClassCycleInfo>(), "classCycles"),
    safe(() => p.externalAudit.findMany({
      where: { tenantId, vesselCode: inCodes, deletedAt: null, auditDate: { gte: d365 } },
      select: { id: true, vesselCode: true, auditCode: true, auditType: true, auditDate: true, agencyOrAuthority: true },
      orderBy: { auditDate: "desc" },
    }) as Promise<AuditRow[]>, [], "externalAudits"),
    safe(() => p.externalAuditFinding.findMany({
      where: { tenantId, vesselCode: inCodes, status: { in: ["OPEN", "IN_PROGRESS"] }, audit: { deletedAt: null } },
      select: { id: true, vesselCode: true, findingCode: true, findingType: true, description: true, rectificationDeadline: true },
      orderBy: { rectificationDeadline: "asc" },
    }) as Promise<FindingRow[]>, [], "externalFindings"),
    safe(() => p.crew.findMany({
      where: { tenantId, vesselCode: inCodes, deletedAt: null, status: "ONBOARD" },
      select: { id: true, vesselCode: true, crewCode: true, firstName: true, lastName: true },
      orderBy: { lastName: "asc" },
    }) as Promise<CrewRow[]>, [], "crewOnboard"),
    safe(() => p.crewCertification.findMany({
      where: { tenantId, deletedAt: null, expiryDate: { not: null }, crew: { vesselCode: inCodes, status: "ONBOARD", deletedAt: null } },
      select: { id: true, crewId: true, type: true, expiryDate: true },
    }) as Promise<CrewCertRow[]>, [], "crewCertifications"),
    safe(() => p.crewRestHours.findMany({
      where: { tenantId, vesselCode: inCodes, recordDate: { gte: d30 } },
      select: { id: true, vesselCode: true, crewId: true, recordDate: true, hasViolation: true },
      orderBy: { recordDate: "desc" },
    }) as Promise<RestRow[]>, [], "restHours30d"),
    // La misma matriz que muestra la pantalla Simulacros (último hecho + frecuencia).
    safe(() => getDrillsMatrix(session, { vesselCode: requestedVessel }), { cells: [] as DrillMatrixCell[] }, "drillsMatrix"),
  ]);

  const factsMap = new Map(facts.map(f => [f.code, f]));
  const crewed = new Map(facts.map(f => [f.code, isVesselCrewed(f)]));
  const codeSet = new Set(codes);
  return {
    facts: factsMap, crewed, assets, plans, defects, certs, cycles, audits12m, findingsOpen, crew, crewCerts, rest30d,
    drillCells: drills.cells.filter(c => codeSet.has(c.vesselCode)),
  };
}

/** Lo que cuenta un bloque: los datos de sus buques. */
function slice(data: VettingData, codes: string[]) {
  const set = new Set(codes);
  const assets = data.assets.filter(a => set.has(a.vesselCode));
  // Simulacros y tripulación sólo en los buques con gente a bordo: en una
  // barcaza sin dotación el simulacro lo hace la tripulación del remolcador.
  const crewedCodes = codes.filter(c => data.crewed.get(c) !== false);
  const crewedSet = new Set(crewedCodes);
  const crew = data.crew.filter(c => crewedSet.has(c.vesselCode));
  const crewIds = new Set(crew.map(c => c.id));
  return {
    codes,
    crewedCodes,
    assets,
    plans: data.plans.filter(pl => set.has(pl.vesselCode)),
    defects: data.defects.filter(d => set.has(d.vesselCode)),
    certs: data.certs.filter(c => set.has(c.vesselCode)),
    audits12m: data.audits12m.filter(a => set.has(a.vesselCode)),
    findingsOpen: data.findingsOpen.filter(f => set.has(f.vesselCode)),
    crew,
    crewCerts: data.crewCerts.filter(c => crewIds.has(c.crewId)),
    rest30d: data.rest30d.filter(r => crewedSet.has(r.vesselCode)),
    drillCells: data.drillCells.filter(c => crewedSet.has(c.vesselCode)),
  };
}
type Slice = ReturnType<typeof slice>;

// ── Cálculos compartidos por la tarjeta y el detalle ────────────────────────

/** Ficha incompleta: qué datos del capítulo 1 le faltan a cada buque. */
function missingParticulars(f: VesselFacts): string[] {
  return PARTICULAR_FIELDS
    .filter(([k]) => { const v = f[k]; return v === null || v === undefined || (typeof v === "string" && v.trim() === ""); })
    .map(([, label]) => label);
}

type ClassState = "missing" | "expired" | "unrecorded" | "windowOpen" | "upToDate";

/** Situación de clase de un buque, con la misma regla que la barra de Certificados. */
function classStateOf(data: VettingData, s: Slice, code: string, now: Date): { state: ClassState; cert: CertRow | null } {
  // El certificado de clase más nuevo del buque (vienen ordenados por vencimiento desc).
  const cert = s.certs.find(c => c.vesselCode === code && isClassCertificateName(c.name)) ?? null;
  if (!cert) return { state: "missing", cert: null };
  const computed = resolveComputedStatus(cert.expiryDate, cert.status);
  if (computed === "EXPIRED" || computed === "SUSPENDED") return { state: "expired", cert };
  const info = data.cycles.get(code);
  // Sin tipo de buque reconocible no hay ciclo que dibujar: sólo cuenta el vencimiento.
  const level = info ? classCycleLevel(cert, info, now) : 0;
  const state: ClassState = level === 4 ? "expired" : level === 3 ? "unrecorded" : level === 2 ? "windowOpen" : "upToDate";
  return { state, cert };
}

/** Dique seco y eje portahélice: vencido si pasó la fecha y no hay una inspección cercana registrada. */
function dockShaftStateOf(cert: CertRow, now: Date): "overdue" | "dueSoon" | "ok" {
  const soon = new Date(now.getTime() + DOCK_DUE_SOON_DAYS * 86_400_000);
  let worst: "overdue" | "dueSoon" | "ok" = "ok";
  for (const [done, due] of [[cert.drydockSurveyDate, cert.drydockSurveyDueDate], [cert.tailshaftSurveyDate, cert.tailshaftSurveyDueDate]] as const) {
    if (!due) continue;
    const doneForThis = !!done && done >= addMonths(due, -12);
    if (due < now && !doneForThis) return "overdue";
    if (due >= now && due <= soon) worst = "dueSoon";
  }
  return worst;
}

/** Filas de un tema de equipo, por medida. */
function topicRows(data: VettingData, s: Slice, topic: VettingTopic) {
  const assets = s.assets.filter(a => assetMatchesTopic(topic, a.name, data.crewed.get(a.vesselCode) ?? null));
  const ids = new Set(assets.map(a => a.id));
  const plans = s.plans.filter(pl => ids.has(pl.assetId));
  const planned = new Set(plans.map(pl => pl.assetId));
  return {
    assets,
    // Los exentos ("no requiere plan", decisión escrita) no son ni cubiertos ni brecha.
    withPlan: assets.filter(a => planned.has(a.id) && !a.planNotRequired),
    withoutPlan: assets.filter(a => !planned.has(a.id) && !a.planNotRequired),
    overduePlans: plans.filter(pl => pl.executionStatus === "OVERDUE"),
    openDefects: s.defects.filter(d => ids.has(d.assetId)),
  };
}

// ── Evidencia ────────────────────────────────────────────────────────────────

export async function getVettingBiqEvidence(
  session: TenantAccessSession,
  vesselCode: string | null,
  mode: TmsaEvidenceMode = "fleet",
): Promise<{ items: VetVesselEvidence[] }> {
  requireAuditPanelAccess(session);
  const prisma = getPrismaClient();
  if (!prisma) return { items: [] };
  const tenant = await prisma.tenant.findUnique({
    where: { slug: session.tenantSlug },
    include: { settings: { select: { displayName: true, hiddenNavPaths: true } } },
  });
  if (!tenant) return { items: [] };
  const hidden = new Set(tenant.settings?.hiddenNavPaths ?? []);
  const visible = (groupKey: string) => !GROUP_MODULE[groupKey] || !hidden.has(GROUP_MODULE[groupKey]!);

  const vessels = await listVesselsInScope(prisma, session, tenant.id, vesselCode);
  if (vessels.length === 0) return { items: [] };
  const codes = vessels.map(v => v.code);

  // La evidencia TMSA viene con el mismo alcance y modo: sus grupos se
  // corresponden uno a uno con los bloques de acá.
  const [tmsa, data] = await Promise.all([
    getTmsaMaintenanceEvidence(session, vesselCode, mode),
    loadVettingData(prisma, session, tenant.id, codes, vesselCode),
  ]);
  const tmsaByVessel = new Map(tmsa.items.map(v => [v.vesselCode, v]));

  const fleetMode = mode === "fleet" && vessels.length > 1;
  const buckets: Array<{ code: string; name: string; codes: string[] }> = fleetMode
    ? [{ code: "", name: tenant.settings?.displayName ?? session.tenantSlug.toUpperCase(), codes }]
    : vessels.map(v => ({ code: v.code, name: v.name, codes: [v.code] }));

  const now = new Date();
  const items = buckets.map(b => {
    const s = slice(data, b.codes);
    const inherited: VetGroup[] = (tmsaByVessel.get(b.code)?.groups ?? [])
      .filter(g => INHERITED[g.key])
      .map(g => ({ key: g.key, ...INHERITED[g.key]!, status: g.status, metrics: g.metrics, findings: g.findings, own: false }));
    const own = computeOwnGroups(data, s, now);
    // Orden del cuestionario; dentro de un capítulo, primero lo propio del BIQ.
    const groups = [...own, ...inherited].filter(g => visible(g.key)).sort(
      (a, c) => BIQ_CHAPTERS.indexOf(a.chapter) - BIQ_CHAPTERS.indexOf(c.chapter),
    );
    const crewedCount = s.crewedCodes.length;
    return {
      vesselCode: b.code, vesselName: b.name, vesselCount: b.codes.length,
      crewedCount, uncrewedCount: b.codes.length - crewedCount,
      summary: summarize(groups), groups,
    };
  });

  return { items };
}

function computeOwnGroups(data: VettingData, s: Slice, now: Date): VetGroup[] {
  const groups: VetGroup[] = [];

  // ── 1 · Datos generales del buque ──────────────────────────────────────────
  {
    const incomplete = s.codes.filter(c => { const f = data.facts.get(c); return !f || missingParticulars(f).length > 0; }).length;
    const complete = s.codes.length - incomplete;
    const findings: VetFinding[] = incomplete > 0
      ? [{ key: "particularsIncomplete", value: incomplete, kind: "count", status: "ATTENTION" }]
      : [];
    groups.push({
      key: "vesselParticulars", chapter: "1", questions: "1.2–1.11", own: true,
      status: incomplete > 0 ? "ATTENTION" : "OK", findings,
      metrics: [
        { key: "vetVesselsComplete", value: complete, kind: "count" },
        { key: "vetVesselsIncomplete", value: incomplete, kind: "count" },
      ],
    });
  }

  // ── 2 · Clase: vigencia, inspecciones del ciclo, dique seco y eje ─────────
  {
    const counts: Record<ClassState, number> = { missing: 0, expired: 0, unrecorded: 0, windowOpen: 0, upToDate: 0 };
    let dockOverdue = 0;
    let dockSoon = 0;
    for (const code of s.codes) {
      const { state, cert } = classStateOf(data, s, code, now);
      counts[state]++;
      if (cert) {
        const ds = dockShaftStateOf(cert, now);
        if (ds === "overdue") dockOverdue++;
        else if (ds === "dueSoon") dockSoon++;
      }
    }
    const findings: VetFinding[] = [];
    if (counts.missing > 0) findings.push({ key: "classMissing", value: counts.missing, kind: "count", status: "GAP" });
    if (counts.expired > 0) findings.push({ key: "classExpired", value: counts.expired, kind: "count", status: "GAP" });
    if (counts.unrecorded > 0) findings.push({ key: "classUnrecorded", value: counts.unrecorded, kind: "count", status: "GAP" });
    if (dockOverdue > 0) findings.push({ key: "dockShaftOverdue", value: dockOverdue, kind: "count", status: "GAP" });
    if (counts.windowOpen > 0) findings.push({ key: "classWindowOpen", value: counts.windowOpen, kind: "count", status: "ATTENTION" });
    if (dockSoon > 0) findings.push({ key: "dockShaftDueSoon", value: dockSoon, kind: "count", status: "ATTENTION" });
    const status: VetStatus = findings.some(f => f.status === "GAP") ? "GAP" : findings.length > 0 ? "ATTENTION" : "OK";
    groups.push({
      key: "classSurveys", chapter: "2", questions: "2.10–2.16 · 2.19–2.20", own: true, status, findings,
      metrics: [
        { key: "vetClassUpToDate", value: counts.upToDate, kind: "count" },
        { key: "vetClassWindowOpen", value: counts.windowOpen, kind: "count" },
        { key: "vetClassUnrecorded", value: counts.unrecorded, kind: "count" },
        { key: "vetClassExpired", value: counts.expired, kind: "count" },
        { key: "vetClassMissing", value: counts.missing, kind: "count" },
        { key: "vetDockShaftOverdue", value: dockOverdue, kind: "count" },
        { key: "vetDockShaftDueSoon", value: dockSoon, kind: "count" },
      ],
    });
  }

  // ── 2.21 · Inspecciones externas (PSC, bandera, clase, vetting previo) ─────
  {
    const audits = s.audits12m.length;
    const vetting = s.audits12m.filter(a => a.auditType === "VETTING_OIL_MAJOR").length;
    const open = s.findingsOpen.length;
    const overdue = s.findingsOpen.filter(f => f.rectificationDeadline && f.rectificationDeadline < now).length;
    const findings: VetFinding[] = [];
    let status: VetStatus;
    if (audits === 0 && open === 0) {
      status = "INFO";
      findings.push({ key: "extNothing", value: 0, kind: "count", status: "INFO" });
    } else if (overdue > 0) {
      status = "GAP";
      findings.push({ key: "extFindingsOverdue", value: overdue, kind: "count", status: "GAP" });
    } else if (open > 0) {
      status = "ATTENTION";
      findings.push({ key: "extFindingsOpen", value: open, kind: "count", status: "ATTENTION" });
    } else {
      status = "OK";
    }
    groups.push({
      key: "externalInspections", chapter: "2", questions: "2.21", own: true, status, findings,
      metrics: [
        { key: "vetExtAudits12m", value: audits, kind: "count" },
        { key: "vetVettingInspections12m", value: vetting, kind: "count" },
        { key: "vetExtFindingsOpen", value: open, kind: "count" },
        { key: "vetExtFindingsOverdue", value: overdue, kind: "count" },
      ],
    });
  }

  // ── 3 · Tripulación (sólo buques con dotación) ─────────────────────────────
  {
    const onboard = s.crew.length;
    const certsExpired = s.crewCerts.filter(c => c.expiryDate && c.expiryDate < now).length;
    const restRecords = s.rest30d.length;
    const restViolations = s.rest30d.filter(r => r.hasViolation).length;
    const findings: VetFinding[] = [];
    let status: VetStatus;
    if (s.crewedCodes.length === 0) {
      status = "INFO";
      findings.push({ key: "crewNotApplicable", value: 0, kind: "count", status: "INFO" });
    } else if (onboard === 0) {
      status = "INFO";
      findings.push({ key: "crewNothing", value: 0, kind: "count", status: "INFO" });
    } else {
      if (certsExpired > 0) findings.push({ key: "crewCertsExpired", value: certsExpired, kind: "count", status: "GAP" });
      if (restRecords === 0) findings.push({ key: "restNoRecords", value: 0, kind: "count", status: "ATTENTION" });
      if (restViolations > 0) findings.push({ key: "restViolations", value: restViolations, kind: "count", status: "ATTENTION" });
      status = certsExpired > 0 ? "GAP" : findings.length > 0 ? "ATTENTION" : "OK";
    }
    groups.push({
      key: "crewCompliance", chapter: "3", questions: "3.1 · 3.4 · 3.6", own: true, status, findings,
      metrics: [
        { key: "vetCrewOnboard", value: onboard, kind: "count" },
        { key: "vetCrewCertsExpired", value: certsExpired, kind: "count" },
        { key: "vetRestRecords30d", value: restRecords, kind: "count" },
        { key: "vetRestViolations30d", value: restViolations, kind: "count" },
      ],
    });
  }

  // ── 5 / 6 · Simulacros (incendio, abandono, SOPEP) ─────────────────────────
  {
    const cells = s.drillCells;
    const ok = cells.filter(c => c.status === "OK").length;
    const dueSoon = cells.filter(c => c.status === "DUE_SOON").length;
    const overdue = cells.filter(c => c.status === "OVERDUE" || c.status === "NEVER").length;
    const findings: VetFinding[] = [];
    let status: VetStatus;
    if (s.crewedCodes.length === 0) {
      status = "INFO";
      findings.push({ key: "drillsNotApplicable", value: 0, kind: "count", status: "INFO" });
    } else if (cells.length === 0) {
      status = "INFO";
      findings.push({ key: "drillsNothing", value: 0, kind: "count", status: "INFO" });
    } else {
      if (overdue > 0) findings.push({ key: "drillsOverdue", value: overdue, kind: "count", status: "GAP" });
      if (dueSoon > 0) findings.push({ key: "drillsDueSoon", value: dueSoon, kind: "count", status: "ATTENTION" });
      status = overdue > 0 ? "GAP" : dueSoon > 0 ? "ATTENTION" : "OK";
    }
    groups.push({
      key: "drills", chapter: "5", questions: "5.12 · 5.16 · 5.20 · 6.2", own: true, status, findings,
      metrics: [
        { key: "vetDrillsOk", value: ok, kind: "count" },
        { key: "vetDrillsDueSoon", value: dueSoon, kind: "count" },
        { key: "vetDrillsOverdue", value: overdue, kind: "count" },
      ],
    });
  }

  // ── Temas de equipo (capítulos 4, 5, 7, 8, 9, 10 y 11) ────────────────────
  for (const topic of VETTING_TOPICS) {
    const r = topicRows(data, s, topic);
    const findings: VetFinding[] = [];
    let status: VetStatus;
    if (r.assets.length === 0) {
      status = "INFO";
      findings.push({ key: "eqNothing", value: 0, kind: "count", status: "INFO" });
    } else {
      if (r.withoutPlan.length > 0) {
        findings.push({ key: "eqWithoutPlan", value: r.withoutPlan.length, kind: "count", status: topic.safety ? "GAP" : "ATTENTION" });
      }
      if (r.overduePlans.length > 0) findings.push({ key: "eqOverduePlans", value: r.overduePlans.length, kind: "count", status: "ATTENTION" });
      if (r.openDefects.length > 0) findings.push({ key: "eqOpenDefects", value: r.openDefects.length, kind: "count", status: "ATTENTION" });
      status = findings.some(f => f.status === "GAP") ? "GAP" : findings.length > 0 ? "ATTENTION" : "OK";
    }
    groups.push({
      key: topic.key, chapter: topic.chapter, questions: topic.questions, own: true, status, findings,
      metrics: (["assets", "withPlan", "withoutPlan", "overduePlans", "openDefects"] as TopicMeasure[])
        .map(m => ({ key: topicMetricKey(topic.key, m), value: r[m].length, kind: "count" as const })),
    });
  }

  return groups;
}

// ── Drill-down ───────────────────────────────────────────────────────────────

export async function getVettingMetricDetail(
  session: TenantAccessSession,
  vesselCode: string,
  metric: string,
): Promise<{ items: VetDetailItem[] }> {
  requireAuditPanelAccess(session);
  // Las métricas heredadas las sabe listar TMSA.
  if (!metric.startsWith("vet")) return getTmsaMetricDetail(session, vesselCode, metric);

  const prisma = getPrismaClient();
  if (!prisma) return { items: [] };
  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) return { items: [] };
  // Mismo chequeo anti-bypass que TMSA e ISM: el buque pedido tiene que estar
  // dentro del alcance. vesselCode vacío = la tarjeta de flota.
  const vessels = await listVesselsInScope(prisma, session, tenant.id, vesselCode || null);
  if (vessels.length === 0) return { items: [] };
  const codes = vessels.map(v => v.code);

  const data = await loadVettingData(prisma, session, tenant.id, codes, vesselCode || null);
  const s = slice(data, codes);
  const now = new Date();
  const vesselName = (code: string) => data.facts.get(code)?.name ?? code;
  const cap = (items: VetDetailItem[]) => ({ items: items.slice(0, DETAIL_CAP) });

  const asAsset = (a: AssetRow): VetDetailItem =>
    ({ id: a.id, code: a.assetCode, label: a.name, sublabel: `${vesselName(a.vesselCode)} · Criticidad ${a.criticality}`, entityType: "asset" });
  const asPlan = (pl: PlanRow): VetDetailItem =>
    ({ id: pl.id, code: pl.taskCode, label: pl.title, sublabel: `${vesselName(pl.vesselCode)}${pl.nextDueDate ? ` · vencía ${isoDate(pl.nextDueDate)}` : ""}`, entityType: "maintenancePlan" });
  const asDefect = (d: DefectRow): VetDetailItem =>
    ({ id: d.id, code: d.defectCode, label: d.classification ?? d.defectCode, sublabel: `${vesselName(d.vesselCode)} · ${d.status} · ${d.severity}`, entityType: "defect" });
  const asCert = (c: CertRow, extra?: string): VetDetailItem =>
    ({ id: c.id, code: c.certificateCode, label: vesselName(c.vesselCode), sublabel: extra ?? `${c.issuingAuthority} · vence ${isoDate(c.expiryDate)}`, entityType: "certificate" });
  // Nombres, no códigos (CLAUDE.md): el buque se muestra por su nombre.
  const asVessel = (code: string, sub: string): VetDetailItem =>
    ({ id: code, code: vesselName(code), label: sub, entityType: "vessel" });

  const topic = parseTopicMetricKey(metric);
  if (topic) {
    const r = topicRows(data, s, topic.topic);
    switch (topic.measure) {
      case "assets": return cap(r.assets.map(asAsset));
      case "withPlan": return cap(r.withPlan.map(asAsset));
      case "withoutPlan": return cap(r.withoutPlan.map(asAsset));
      case "overduePlans": return cap(r.overduePlans.map(asPlan));
      case "openDefects": return cap(r.openDefects.map(asDefect));
    }
  }

  switch (metric) {
    case "vetVesselsComplete":
    case "vetVesselsIncomplete": {
      const rows = s.codes.map(code => {
        const f = data.facts.get(code);
        return { code, missing: f ? missingParticulars(f) : PARTICULAR_FIELDS.map(([, l]) => l) as string[] };
      });
      const wanted = metric === "vetVesselsComplete" ? rows.filter(r => r.missing.length === 0) : rows.filter(r => r.missing.length > 0);
      return cap(wanted.map(r => asVessel(r.code, r.missing.length ? `Falta: ${r.missing.join(", ")}` : "Ficha completa")));
    }

    case "vetClassUpToDate":
    case "vetClassWindowOpen":
    case "vetClassUnrecorded":
    case "vetClassExpired":
    case "vetClassMissing": {
      const want: Record<string, ClassState> = {
        vetClassUpToDate: "upToDate", vetClassWindowOpen: "windowOpen", vetClassUnrecorded: "unrecorded",
        vetClassExpired: "expired", vetClassMissing: "missing",
      };
      const items: VetDetailItem[] = [];
      for (const code of s.codes) {
        const { state, cert } = classStateOf(data, s, code, now);
        if (state !== want[metric]) continue;
        items.push(cert ? asCert(cert) : asVessel(code, "Sin certificado de clase cargado"));
      }
      return cap(items);
    }
    case "vetDockShaftOverdue":
    case "vetDockShaftDueSoon": {
      const want = metric === "vetDockShaftOverdue" ? "overdue" : "dueSoon";
      const items: VetDetailItem[] = [];
      for (const code of s.codes) {
        const { cert } = classStateOf(data, s, code, now);
        if (!cert || dockShaftStateOf(cert, now) !== want) continue;
        const parts = [
          cert.drydockSurveyDueDate ? `Dique ${isoDate(cert.drydockSurveyDueDate)}` : "",
          cert.tailshaftSurveyDueDate ? `Eje ${isoDate(cert.tailshaftSurveyDueDate)}` : "",
        ].filter(Boolean).join(" · ");
        items.push(asCert(cert, parts));
      }
      return cap(items);
    }

    case "vetExtAudits12m":
    case "vetVettingInspections12m": {
      const rows = metric === "vetVettingInspections12m" ? s.audits12m.filter(a => a.auditType === "VETTING_OIL_MAJOR") : s.audits12m;
      return cap(rows.map(a => ({
        id: a.id, code: a.auditCode, label: `${a.auditType}${a.agencyOrAuthority ? ` · ${a.agencyOrAuthority}` : ""}`,
        sublabel: `${vesselName(a.vesselCode)} · ${isoDate(a.auditDate)}`, entityType: "externalAudit" as const,
      })));
    }
    case "vetExtFindingsOpen":
    case "vetExtFindingsOverdue": {
      const rows = metric === "vetExtFindingsOverdue"
        ? s.findingsOpen.filter(f => f.rectificationDeadline && f.rectificationDeadline < now)
        : s.findingsOpen;
      return cap(rows.map(f => ({
        id: f.id, code: f.findingCode ?? f.findingType, label: f.description,
        sublabel: `${vesselName(f.vesselCode)}${f.rectificationDeadline ? ` · plazo ${isoDate(f.rectificationDeadline)}` : ""}`,
        entityType: "externalAudit" as const,
      })));
    }

    case "vetCrewOnboard":
      return cap(s.crew.map(c => ({
        id: c.id, code: c.crewCode, label: `${c.lastName}, ${c.firstName}`, sublabel: vesselName(c.vesselCode), entityType: "crew" as const,
      })));
    case "vetCrewCertsExpired": {
      const byId = new Map(s.crew.map(c => [c.id, c]));
      return cap(s.crewCerts
        .filter(c => c.expiryDate && c.expiryDate < now)
        .map(c => {
          const who = byId.get(c.crewId);
          return {
            id: c.id, code: c.type, label: who ? `${who.lastName}, ${who.firstName}` : c.crewId,
            sublabel: `${who ? vesselName(who.vesselCode) : ""} · venció ${isoDate(c.expiryDate)}`, entityType: "crew" as const,
          };
        }));
    }
    case "vetRestRecords30d":
    case "vetRestViolations30d": {
      const byId = new Map(s.crew.map(c => [c.id, c]));
      const rows = metric === "vetRestViolations30d" ? s.rest30d.filter(r => r.hasViolation) : s.rest30d;
      return cap(rows.map(r => {
        const who = byId.get(r.crewId);
        return {
          id: r.id, code: isoDate(r.recordDate), label: who ? `${who.lastName}, ${who.firstName}` : r.crewId,
          sublabel: `${vesselName(r.vesselCode)}${r.hasViolation ? " · con violación" : ""}`, entityType: "crew" as const,
        };
      }));
    }

    case "vetDrillsOk":
    case "vetDrillsDueSoon":
    case "vetDrillsOverdue": {
      const rows = s.drillCells.filter(c =>
        metric === "vetDrillsOk" ? c.status === "OK"
          : metric === "vetDrillsDueSoon" ? c.status === "DUE_SOON"
          : c.status === "OVERDUE" || c.status === "NEVER");
      return cap(rows.map(c => ({
        id: `${c.vesselCode}:${c.requirementId}`, code: vesselName(c.vesselCode), label: c.requirementTitle,
        sublabel: c.status === "NEVER" ? "Nunca realizado" : `Último ${c.lastCompletedDate ?? "—"} · próximo ${c.nextDueDate ?? "—"}`,
        entityType: "drill" as const,
      })));
    }

    default:
      return { items: [] };
  }
}
