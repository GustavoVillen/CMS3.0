// CVIQ self-assessment SIRE 2.0.

import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { publishAudit } from "../../platform/audit/audit-publisher";

const RESPONSE_STATUSES = ["PENDING", "CONFORMING", "NOT_CONFORMING", "PARTIALLY_CONFORMING", "NOT_APPLICABLE"] as const;

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
