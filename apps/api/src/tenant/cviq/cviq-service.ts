// CVIQ self-assessment SIRE 2.0.

import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { publishAudit } from "../../platform/audit/audit-publisher";

const RESPONSE_STATUSES = ["PENDING", "CONFORMING", "NOT_CONFORMING", "PARTIALLY_CONFORMING", "NOT_APPLICABLE"] as const;

/**
 * Seed inicial de preguntas CVIQ SIRE 2.0. Representativas, cubren los 10
 * capítulos. Idempotente: se inserta solo si el código no existe.
 * El catálogo se carga automáticamente la primera vez que se crea un
 * assessment (ensureCviqSeed).
 */
const CVIQ_SEED_QUESTIONS: Array<{ questionCode: string; chapter: number; chapterTitle: string; section: string; questionText: string; expectedEvidence: string }> = [
  // Cap. 1 — Generalidades
  { questionCode: "1.1", chapter: 1, chapterTitle: "Generalidades", section: "Documentación del buque", questionText: "Certificados del buque vigentes (SOC, Class, Flag, Statutory) — todos visibles y dentro de plazo.", expectedEvidence: "Certificados originales o copias certificadas vigentes." },
  { questionCode: "1.2", chapter: 1, chapterTitle: "Generalidades", section: "Documentación del buque", questionText: "Manuales operativos críticos disponibles (SMS, SOPEP/SMPEP, Cargo Operations, Loading).", expectedEvidence: "Manuales actuales accesibles a la tripulación." },
  { questionCode: "1.3", chapter: 1, chapterTitle: "Generalidades", section: "Estructura del buque", questionText: "Estructura del casco, cubierta y superestructura en buen estado, sin corrosión visible significativa.", expectedEvidence: "Inspección visual + registros de hull integrity." },
  // Cap. 2 — Tripulación
  { questionCode: "2.1", chapter: 2, chapterTitle: "Tripulación", section: "Certificación", questionText: "Tripulación certificada según STCW, con certificados vigentes y apropiados al cargo.", expectedEvidence: "Lista de tripulantes con certs vigentes; CrewCertification table." },
  { questionCode: "2.2", chapter: 2, chapterTitle: "Tripulación", section: "Familiarización", questionText: "Tripulantes nuevos completaron la inducción y familiarización antes de asumir funciones.", expectedEvidence: "Registros firmados de inducción." },
  { questionCode: "2.3", chapter: 2, chapterTitle: "Tripulación", section: "Horas de descanso", questionText: "Horas de descanso registradas y cumplen STCW Manila (>=10h/24h, >=77h/7d).", expectedEvidence: "Planilla mensual de horas de descanso por tripulante." },
  { questionCode: "2.4", chapter: 2, chapterTitle: "Tripulación", section: "Drills", questionText: "Drills regulares según SOLAS, ISPS, MARPOL, con asistencia documentada.", expectedEvidence: "Drill log + asistentes + escenario + lecciones aprendidas." },
  // Cap. 3 — Navegación
  { questionCode: "3.1", chapter: 3, chapterTitle: "Navegación", section: "Bridge management", questionText: "Procedimientos de puente claros, BRM implementado, voyage plan firmado.", expectedEvidence: "Voyage plan firmado, master's standing orders, BRM check." },
  { questionCode: "3.2", chapter: 3, chapterTitle: "Navegación", section: "ECDIS", questionText: "Operadores ECDIS certificados, cartas actualizadas, sistema redundante.", expectedEvidence: "Certs ECDIS, ENC update log, redundancy test." },
  // Cap. 4 — Seguridad
  { questionCode: "4.1", chapter: 4, chapterTitle: "Seguridad", section: "SMS", questionText: "SMS implementado, auditorías internas regulares, no-conformidades cerradas.", expectedEvidence: "Audit reports, NC log, CAPA." },
  { questionCode: "4.2", chapter: 4, chapterTitle: "Seguridad", section: "Near misses", questionText: "Cultura de reporte de near misses establecida, con análisis y acciones.", expectedEvidence: "NearMiss reports + análisis + lecciones aprendidas." },
  { questionCode: "4.3", chapter: 4, chapterTitle: "Seguridad", section: "PSC findings", questionText: "Findings PSC anteriores cerrados con evidencia.", expectedEvidence: "ExternalAudit findings history, clearance evidence." },
  { questionCode: "4.4", chapter: 4, chapterTitle: "Seguridad", section: "MOC", questionText: "Proceso formal de Management of Change para cambios significativos.", expectedEvidence: "MOC log con análisis riesgo, aprobación, implementación, revisión." },
  // Cap. 5 — Contaminación
  { questionCode: "5.1", chapter: 5, chapterTitle: "Contaminación", section: "MARPOL", questionText: "Procedimientos MARPOL implementados (Annex I, V), Garbage Record Book y Oil Record Book actualizados.", expectedEvidence: "GRB + ORB con entradas vigentes; SOPEP plan visible." },
  { questionCode: "5.2", chapter: 5, chapterTitle: "Contaminación", section: "Bunkering", questionText: "Procedimientos de bunkering con checklist pre-bunker firmado.", expectedEvidence: "Pre-bunkering checklist firmado por master, chief engineer y supplier." },
  // Cap. 6 — Maquinarias
  { questionCode: "6.1", chapter: 6, chapterTitle: "Maquinarias", section: "PMS", questionText: "Plan de mantenimiento preventivo implementado, OTs cerradas en tiempo.", expectedEvidence: "PMS dashboard, OT compliance rate." },
  { questionCode: "6.2", chapter: 6, chapterTitle: "Maquinarias", section: "Análisis de fluidos", questionText: "Análisis periódico de aceites/combustibles con seguimiento de tendencias.", expectedEvidence: "FluidAnalysis records + trend analysis." },
  { questionCode: "6.3", chapter: 6, chapterTitle: "Maquinarias", section: "Defectos", questionText: "Defectos identificados con RCA aplicado y CAPA cuando corresponda.", expectedEvidence: "Defect log + RCA aprobado + CAPA generada." },
  // Cap. 7 — Carga
  { questionCode: "7.1", chapter: 7, chapterTitle: "Carga", section: "Cargo plan", questionText: "Plan de carga calculado, aprobado y respetado durante operaciones.", expectedEvidence: "Loading plan firmado, stability calculation." },
  // Cap. 8 — Amarras
  { questionCode: "8.1", chapter: 8, chapterTitle: "Amarras", section: "MEG4", questionText: "Líneas de amarre dentro de vida útil, registros de inspección y tensión.", expectedEvidence: "Mooring lines log con fechas, breaking load, tests." },
  // Cap. 9 — Seguridad ISPS
  { questionCode: "9.1", chapter: 9, chapterTitle: "Seguridad ISPS", section: "SSP", questionText: "SSP implementado, drills security trimestrales, exercise anual.", expectedEvidence: "SSP, security drills log, SSO designado." },
  // Cap. 10 — Factores humanos
  { questionCode: "10.1", chapter: 10, chapterTitle: "Factores humanos", section: "Fatiga", questionText: "Procedimientos de fatigue management, horas de descanso verificadas.", expectedEvidence: "Fatigue policy, rest hours monitoring." },
  { questionCode: "10.2", chapter: 10, chapterTitle: "Factores humanos", section: "Drug & Alcohol", questionText: "Política D&A vigente, tests aleatorios y por causa.", expectedEvidence: "D&A policy, test records." },
];

/**
 * Asegura que el catálogo global tenga las preguntas seed. Idempotente:
 * para cada questionCode, hace upsert (crea si no existe, deja igual si
 * ya está). Llamado al crear el primer assessment si la tabla está vacía.
 */
async function ensureCviqSeed(prisma: NonNullable<ReturnType<typeof getPrismaClient>>): Promise<number> {
  const count = await qDel(prisma).count({ where: { tenantId: null } });
  if (count > 0) return count;

  for (const q of CVIQ_SEED_QUESTIONS) {
    try {
      await (prisma as unknown as { cviqQuestion: { create(a: unknown): Promise<unknown> } }).cviqQuestion.create({
        data: {
          questionCode: q.questionCode,
          chapter: q.chapter,
          chapterTitle: q.chapterTitle,
          section: q.section,
          questionText: q.questionText,
          expectedEvidence: q.expectedEvidence,
          isActive: true,
          tenantId: null,
        },
      });
    } catch { /* unique violation: ya existe, ignoramos */ }
  }
  return CVIQ_SEED_QUESTIONS.length;
}

export interface AssessmentListFilters {
  vesselCode?: string | null;
  status?: string | null;
}

export interface CreateAssessmentInput {
  vesselCode: string;
  title: string;
  assessorName?: string | null;
}

export interface ResponseInput {
  questionId: string;
  status: string;
  notes?: string | null;
  evidenceLink?: string | null;
  linkedActionType?: string | null;
  linkedActionId?: string | null;
}

function canWrite(s: TenantAccessSession): boolean {
  return s.user.role !== "AUDITOR_READONLY";
}
function ensureCanWrite(s: TenantAccessSession) {
  if (!canWrite(s)) throw new RouteError(403, "FORBIDDEN", "Solo-lectura no puede llenar CVIQ.");
}
function normReq(v: unknown, f: string): string {
  const t = String(v ?? "").trim();
  if (!t) throw new RouteError(400, "VALIDATION_ERROR", `${f} requerido.`);
  return t;
}
function normOpt(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const t = String(v).trim();
  return t || null;
}
function parseEnum<T extends string>(v: unknown, allowed: readonly T[], f: string): T {
  const s = String(v ?? "").trim().toUpperCase();
  if (!allowed.includes(s as T)) throw new RouteError(400, "VALIDATION_ERROR", `${f} inválido: ${s}.`);
  return s as T;
}

type Delegate = {
  findMany(a: unknown): Promise<Record<string, unknown>[]>;
  findFirst(a: unknown): Promise<Record<string, unknown> | null>;
  create(a: unknown): Promise<Record<string, unknown>>;
  update(a: unknown): Promise<Record<string, unknown>>;
  upsert(a: unknown): Promise<Record<string, unknown>>;
  count(a: unknown): Promise<number>;
};
function qDel(prisma: NonNullable<ReturnType<typeof getPrismaClient>>) { return (prisma as unknown as { cviqQuestion: Delegate }).cviqQuestion; }
function aDel(prisma: NonNullable<ReturnType<typeof getPrismaClient>>) { return (prisma as unknown as { cviqAssessment: Delegate }).cviqAssessment; }
function rDel(prisma: NonNullable<ReturnType<typeof getPrismaClient>>) { return (prisma as unknown as { cviqResponse: Delegate }).cviqResponse; }

async function tenantIdOrThrow(s: TenantAccessSession): Promise<string> {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "DB no disponible.");
  const tenant = await prisma.tenant.findUnique({ where: { slug: s.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");
  return tenant.id;
}
function applyVesselScope(s: TenantAccessSession, where: Record<string, unknown>, req?: string | null) {
  if (s.user.role === "TENANT_ADMIN") { if (req) where.vesselCode = req; return; }
  if (req) {
    if (!s.user.assignedVesselCodes.includes(req)) { where.vesselCode = "__NO_ASSIGNED_VESSEL__"; return; }
    where.vesselCode = req; return;
  }
  if (s.user.assignedVesselCodes.length === 0) { where.vesselCode = "__NO_ASSIGNED_VESSEL__"; return; }
  where.vesselCode = { in: s.user.assignedVesselCodes };
}

// ─── Questions catalog ──────────────────────────────────────────────────────

export async function listQuestions(session: TenantAccessSession) {
  const prisma = getPrismaClient();
  if (!prisma) return [];
  const tenantId = await tenantIdOrThrow(session);
  return qDel(prisma).findMany({
    where: { isActive: true, OR: [{ tenantId }, { tenantId: null }] },
    orderBy: [{ chapter: "asc" }, { questionCode: "asc" }],
  });
}

// ─── Assessments ────────────────────────────────────────────────────────────

export async function listAssessments(session: TenantAccessSession, filters: AssessmentListFilters = {}) {
  const prisma = getPrismaClient();
  if (!prisma) return [];
  const tenantId = await tenantIdOrThrow(session);
  const where: Record<string, unknown> = { tenantId, deletedAt: null };
  applyVesselScope(session, where, filters.vesselCode ?? null);
  if (filters.status) where.status = filters.status;
  return aDel(prisma).findMany({ where, orderBy: { startedAt: "desc" } });
}

export async function getAssessment(session: TenantAccessSession, id: string) {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "DB no disponible.");
  const tenantId = await tenantIdOrThrow(session);
  const where: Record<string, unknown> = { id, tenantId, deletedAt: null };
  applyVesselScope(session, where);
  const asm = await aDel(prisma).findFirst({ where });
  if (!asm) throw new RouteError(404, "NOT_FOUND", "Assessment no encontrado.");
  const responses = await rDel(prisma).findMany({
    where: { assessmentId: id }, orderBy: { questionId: "asc" },
  });
  const questions = await qDel(prisma).findMany({
    where: { isActive: true, OR: [{ tenantId }, { tenantId: null }] },
    orderBy: [{ chapter: "asc" }, { questionCode: "asc" }],
  });
  return { ...asm, responses, questions };
}

async function generateAssessmentCode(prisma: NonNullable<ReturnType<typeof getPrismaClient>>, tenantId: string, vesselCode: string): Promise<string> {
  const year = new Date().getFullYear();
  const yy = String(year).slice(-2);
  const count = await aDel(prisma).count({
    where: { tenantId, vesselCode, createdAt: { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) } },
  });
  return `CVIQ-${vesselCode}-${yy}-${String(count + 1).padStart(4, "0")}`;
}

export async function createAssessment(session: TenantAccessSession, input: CreateAssessmentInput) {
  ensureCanWrite(session);
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "DB no disponible.");
  const tenantId = await tenantIdOrThrow(session);
  const vesselCode = normReq(input.vesselCode, "vesselCode").toUpperCase();
  if (session.user.role !== "TENANT_ADMIN" && !session.user.assignedVesselCodes.includes(vesselCode)) {
    throw new RouteError(403, "FORBIDDEN", "Sin acceso al vessel.");
  }

  // Seed automatico del catalogo global si todavia no existe.
  // Evita que un assessment se cree con 0 preguntas cuando el INSERT del
  // migration.sql no se aplico (porque el proyecto usa prisma db push,
  // que no ejecuta INSERTs de los archivos de migration).
  await ensureCviqSeed(prisma);

  const assessmentCode = await generateAssessmentCode(prisma, tenantId, vesselCode);
  const questions = await qDel(prisma).findMany({
    where: { isActive: true, OR: [{ tenantId }, { tenantId: null }] },
    select: { id: true } as never,
  }) as Array<{ id: string }>;

  const created = await aDel(prisma).create({
    data: {
      tenantId, vesselCode, assessmentCode,
      title: normReq(input.title, "title"),
      assessorName: normOpt(input.assessorName),
      totalQuestions: questions.length,
      createdByUserId: session.user.id,
      updatedByUserId: session.user.id,
    },
  }) as unknown as { id: string };

  // Pre-crear responses PENDING para todas las preguntas
  for (const q of questions) {
    await rDel(prisma).create({
      data: {
        tenantId,
        assessmentId: created.id,
        questionId: q.id,
        status: "PENDING",
        updatedByUserId: session.user.id,
      },
    });
  }

  void publishAudit(prisma, {
    tenantId, actorUserId: session.user.id,
    action: "Cviq.created", entityType: "CviqAssessment", entityId: created.id,
    metadata: { assessmentCode, vesselCode },
  });
  return created;
}

export async function setResponseCviq(session: TenantAccessSession, assessmentId: string, input: ResponseInput) {
  ensureCanWrite(session);
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "DB no disponible.");
  const asm = await getAssessment(session, assessmentId) as unknown as { id: string; tenantId: string; status: string };
  if (asm.status !== "IN_PROGRESS") {
    throw new RouteError(409, "INVALID_STATUS", "Assessment ya completado.");
  }
  const status = parseEnum(input.status, RESPONSE_STATUSES, "status");
  const existing = await rDel(prisma).findFirst({
    where: { assessmentId, questionId: input.questionId },
  });
  if (!existing) throw new RouteError(404, "NOT_FOUND", "Response no encontrada.");
  return rDel(prisma).update({
    where: { id: (existing as { id: string }).id },
    data: {
      status,
      notes: normOpt(input.notes),
      evidenceLink: normOpt(input.evidenceLink),
      linkedActionType: normOpt(input.linkedActionType),
      linkedActionId: normOpt(input.linkedActionId),
      updatedByUserId: session.user.id,
    },
  });
}

export async function completeAssessment(session: TenantAccessSession, id: string) {
  ensureCanWrite(session);
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "DB no disponible.");
  const asm = await getAssessment(session, id) as unknown as { id: string; tenantId: string; assessmentCode: string };
  const responses = await rDel(prisma).findMany({
    where: { assessmentId: id }, select: { status: true } as never,
  }) as Array<{ status: string }>;
  const counts = {
    conforming: responses.filter(r => r.status === "CONFORMING").length,
    notConforming: responses.filter(r => r.status === "NOT_CONFORMING").length,
    partial: responses.filter(r => r.status === "PARTIALLY_CONFORMING").length,
    na: responses.filter(r => r.status === "NOT_APPLICABLE").length,
  };
  return aDel(prisma).update({
    where: { id },
    data: {
      status: "COMPLETED",
      completedAt: new Date(),
      conformingCount: counts.conforming,
      notConformingCount: counts.notConforming,
      partialCount: counts.partial,
      naCount: counts.na,
      updatedByUserId: session.user.id,
    },
  });
}

export async function deleteAssessment(session: TenantAccessSession, id: string) {
  if (session.user.role !== "TENANT_ADMIN") throw new RouteError(403, "FORBIDDEN", "Solo TENANT_ADMIN.");
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "DB no disponible.");
  const asm = await getAssessment(session, id) as unknown as { id: string; tenantId: string; assessmentCode: string };
  await aDel(prisma).update({
    where: { id },
    data: { deletedAt: new Date(), deletedByUserId: session.user.id, updatedByUserId: session.user.id },
  });
  void publishAudit(prisma, {
    tenantId: asm.tenantId, actorUserId: session.user.id,
    action: "Cviq.deleted", entityType: "CviqAssessment", entityId: id,
    metadata: { assessmentCode: asm.assessmentCode },
  });
}
