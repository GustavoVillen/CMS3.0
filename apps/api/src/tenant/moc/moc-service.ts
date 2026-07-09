// Management of Change (MOC) — workflow formal de cambios significativos.

import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { publishAudit } from "../../platform/audit/audit-publisher";

const CATEGORIES = ["EQUIPMENT_CHANGE", "PROCEDURE_CHANGE", "ORGANIZATIONAL", "TEMPORARY", "SOFTWARE_FIRMWARE", "OTHER"] as const;
const RISK_LEVELS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
const STATUSES = ["REQUESTED", "UNDER_ANALYSIS", "APPROVED", "IN_PROGRESS", "IMPLEMENTED", "REVIEWED", "REJECTED", "CANCELLED"] as const;

export interface MocListFilters {
  vesselCode?: string | null;
  status?: string | null;
  category?: string | null;
}

export interface MocWriteInput {
  vesselCode?: string;
  category?: string;
  title?: string;
  reasonForChange?: string;
  proposedChange?: string;
  riskLevel?: string;
  impactAreas?: string[];
  riskAssessmentNotes?: string | null;
  mitigationActions?: string | null;
  plannedDate?: string | Date | null;
  relatedAssetId?: string | null;
  relatedWorkOrderId?: string | null;
  // ─── Formulario controlado REGI-GES-06.1 ──────────────────────────────────
  requesterName?: string | null;
  requesterRegistration?: string | null;
  changeManagerName?: string | null;
  changeManagerRegistration?: string | null;
  requestingArea?: string | null;
  areaSupervisor?: string | null;
  managementName?: string | null;
  managerName?: string | null;
  changeTypes?: string[];
  duration?: string | null;
  temporaryUntil?: string | Date | null;
  locationType?: string | null;
  locationUnit?: string | null;
  physicalArea?: string | null;
  currentSituation?: string | null;
  expectedResult?: string | null;
  evaluationAnswers?: unknown[];
  evaluatorAreas?: string[];
  technicalReviews?: unknown[];
  actionPlan?: unknown[];
  finalRiskLevel?: string | null;
  recommendationsBeforeChange?: string | null;
  additionalInfo?: string | null;
  effectivenessAnswers?: unknown[];
}

/** array JSON passthrough — devuelve el array si lo es, o [] */
function jsonArr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
/** Screening del propio formulario: si alguna pregunta marca "¿puede impactar?"
 * (canImpact=true) o se responde "No sabe" (UNKNOWN) en impacto, aplica la
 * gestión completa. */
function computeRequiresFull(answers: unknown): boolean {
  if (!Array.isArray(answers)) return false;
  return answers.some((a) => {
    if (!a || typeof a !== "object") return false;
    const o = a as { canImpact?: unknown; answer?: unknown };
    return o.canImpact === true || o.answer === "UNKNOWN";
  });
}
/** Ensambla los campos del formulario REGI-GES-06.1 en `data`.
 * mode "create" setea siempre; mode "update" solo los presentes en input. */
function applyFormFields(data: Record<string, unknown>, input: MocWriteInput, mode: "create" | "update") {
  const set = (key: string, present: boolean, value: unknown) => {
    if (mode === "create" || present) data[key] = value;
  };
  set("requesterName", input.requesterName !== undefined, normOpt(input.requesterName));
  set("requesterRegistration", input.requesterRegistration !== undefined, normOpt(input.requesterRegistration));
  set("changeManagerName", input.changeManagerName !== undefined, normOpt(input.changeManagerName));
  set("changeManagerRegistration", input.changeManagerRegistration !== undefined, normOpt(input.changeManagerRegistration));
  set("requestingArea", input.requestingArea !== undefined, normOpt(input.requestingArea));
  set("areaSupervisor", input.areaSupervisor !== undefined, normOpt(input.areaSupervisor));
  set("managementName", input.managementName !== undefined, normOpt(input.managementName));
  set("managerName", input.managerName !== undefined, normOpt(input.managerName));
  set("changeTypesJson", input.changeTypes !== undefined, jsonArr(input.changeTypes));
  set("duration", input.duration !== undefined, normOpt(input.duration));
  set("temporaryUntil", input.temporaryUntil !== undefined, parseOptDate(input.temporaryUntil, "temporaryUntil"));
  set("locationType", input.locationType !== undefined, normOpt(input.locationType));
  set("locationUnit", input.locationUnit !== undefined, normOpt(input.locationUnit));
  set("physicalArea", input.physicalArea !== undefined, normOpt(input.physicalArea));
  set("currentSituation", input.currentSituation !== undefined, normOpt(input.currentSituation));
  set("expectedResult", input.expectedResult !== undefined, normOpt(input.expectedResult));
  set("evaluatorAreasJson", input.evaluatorAreas !== undefined, jsonArr(input.evaluatorAreas));
  set("technicalReviewsJson", input.technicalReviews !== undefined, jsonArr(input.technicalReviews));
  set("actionPlanJson", input.actionPlan !== undefined, jsonArr(input.actionPlan));
  set("finalRiskLevel", input.finalRiskLevel !== undefined, input.finalRiskLevel ? parseEnum(input.finalRiskLevel, RISK_LEVELS, "finalRiskLevel") : null);
  set("recommendationsBeforeChange", input.recommendationsBeforeChange !== undefined, normOpt(input.recommendationsBeforeChange));
  set("additionalInfo", input.additionalInfo !== undefined, normOpt(input.additionalInfo));
  set("effectivenessAnswersJson", input.effectivenessAnswers !== undefined, jsonArr(input.effectivenessAnswers));
  // Evaluación previa + screening derivado.
  if (mode === "create" || input.evaluationAnswers !== undefined) {
    const answers = jsonArr(input.evaluationAnswers);
    data.evaluationAnswersJson = answers;
    data.requiresFullManagement = computeRequiresFull(answers);
  }
}

export interface TransitionInput {
  status: string;
  approvedByName?: string | null;
  rejectedReason?: string | null;
  implementedByName?: string | null;
  implementationNotes?: string | null;
  reviewNotes?: string | null;
  reviewOutcome?: string | null;
}

function canCreate(s: TenantAccessSession): boolean {
  return s.user.role !== "AUDITOR_READONLY";
}
function canApprove(s: TenantAccessSession): boolean {
  const r = s.user.role;
  return r === "TENANT_ADMIN" || r === "FLEET_SUPERINTENDENT";
}
function ensureCanCreate(s: TenantAccessSession) {
  if (!canCreate(s)) throw new RouteError(403, "FORBIDDEN", "Solo-lectura no puede crear MOC.");
}
function ensureCanApprove(s: TenantAccessSession) {
  if (!canApprove(s)) throw new RouteError(403, "FORBIDDEN", "Solo TENANT_ADMIN / FLEET_SUPERINTENDENT pueden aprobar/rechazar MOC.");
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
function parseOptDate(v: unknown, f: string): Date | null {
  if (v === undefined || v === null || v === "") return null;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) throw new RouteError(400, "VALIDATION_ERROR", `${f} fecha inválida.`);
  return d;
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
  count(a: unknown): Promise<number>;
};
function del(prisma: NonNullable<ReturnType<typeof getPrismaClient>>) {
  return (prisma as unknown as { mocRecord: Delegate }).mocRecord;
}
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

export async function listMocs(session: TenantAccessSession, filters: MocListFilters = {}) {
  const prisma = getPrismaClient();
  if (!prisma) return [];
  const tenantId = await tenantIdOrThrow(session);
  const where: Record<string, unknown> = { tenantId, deletedAt: null };
  applyVesselScope(session, where, filters.vesselCode ?? null);
  if (filters.status) where.status = filters.status;
  if (filters.category) where.category = filters.category;
  return del(prisma).findMany({ where, orderBy: { createdAt: "desc" } });
}

export async function getMoc(session: TenantAccessSession, id: string) {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "DB no disponible.");
  const tenantId = await tenantIdOrThrow(session);
  const where: Record<string, unknown> = { id, tenantId, deletedAt: null };
  applyVesselScope(session, where);
  const rec = await del(prisma).findFirst({ where });
  if (!rec) throw new RouteError(404, "NOT_FOUND", "MOC no encontrado.");
  return rec;
}

async function generateMocCode(prisma: NonNullable<ReturnType<typeof getPrismaClient>>, tenantId: string, vesselCode: string): Promise<string> {
  const year = new Date().getFullYear();
  const yy = String(year).slice(-2);
  const count = await del(prisma).count({
    where: { tenantId, vesselCode, createdAt: { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) } },
  });
  return `MOC-${vesselCode}-${yy}-${String(count + 1).padStart(4, "0")}`;
}

export async function createMoc(session: TenantAccessSession, input: MocWriteInput) {
  ensureCanCreate(session);
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "DB no disponible.");
  const tenantId = await tenantIdOrThrow(session);
  const vesselCode = normReq(input.vesselCode, "vesselCode").toUpperCase();
  if (session.user.role !== "TENANT_ADMIN" && !session.user.assignedVesselCodes.includes(vesselCode)) {
    throw new RouteError(403, "FORBIDDEN", "Sin acceso al vessel.");
  }
  const mocCode = await generateMocCode(prisma, tenantId, vesselCode);
  const data: Record<string, unknown> = {
    tenantId, vesselCode, mocCode,
    category:           parseEnum(input.category, CATEGORIES, "category"),
    title:              normReq(input.title, "title"),
    reasonForChange:    normReq(input.reasonForChange, "reasonForChange"),
    proposedChange:     normReq(input.proposedChange, "proposedChange"),
    riskLevel:          input.riskLevel ? parseEnum(input.riskLevel, RISK_LEVELS, "riskLevel") : "MEDIUM",
    impactAreasJson:    Array.isArray(input.impactAreas) ? input.impactAreas : [],
    riskAssessmentNotes: normOpt(input.riskAssessmentNotes),
    mitigationActions:  normOpt(input.mitigationActions),
    plannedDate:        parseOptDate(input.plannedDate, "plannedDate"),
    relatedAssetId:     normOpt(input.relatedAssetId),
    relatedWorkOrderId: normOpt(input.relatedWorkOrderId),
    createdByUserId:    session.user.id,
    updatedByUserId:    session.user.id,
  };
  applyFormFields(data, input, "create");
  const created = await del(prisma).create({ data }) as unknown as { id: string };
  void publishAudit(prisma, {
    tenantId, actorUserId: session.user.id,
    action: "Moc.created", entityType: "MocRecord", entityId: created.id,
    metadata: { mocCode, vesselCode, category: input.category },
  });
  return created;
}

export async function updateMoc(session: TenantAccessSession, id: string, input: MocWriteInput) {
  ensureCanCreate(session);
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "DB no disponible.");
  const current = await getMoc(session, id) as unknown as { id: string; tenantId: string; status: string; mocCode: string };
  if (["REVIEWED", "CANCELLED", "REJECTED"].includes(current.status)) {
    throw new RouteError(409, "INVALID_STATUS", "MOC terminal, no editable.");
  }
  const data: Record<string, unknown> = { updatedByUserId: session.user.id };
  if (input.category !== undefined) data.category = parseEnum(input.category, CATEGORIES, "category");
  if (input.title !== undefined) data.title = normReq(input.title, "title");
  if (input.reasonForChange !== undefined) data.reasonForChange = normReq(input.reasonForChange, "reasonForChange");
  if (input.proposedChange !== undefined) data.proposedChange = normReq(input.proposedChange, "proposedChange");
  if (input.riskLevel !== undefined) data.riskLevel = parseEnum(input.riskLevel, RISK_LEVELS, "riskLevel");
  if (input.impactAreas !== undefined) data.impactAreasJson = Array.isArray(input.impactAreas) ? input.impactAreas : [];
  if (input.riskAssessmentNotes !== undefined) data.riskAssessmentNotes = normOpt(input.riskAssessmentNotes);
  if (input.mitigationActions !== undefined) data.mitigationActions = normOpt(input.mitigationActions);
  if (input.plannedDate !== undefined) data.plannedDate = parseOptDate(input.plannedDate, "plannedDate");
  if (input.relatedAssetId !== undefined) data.relatedAssetId = normOpt(input.relatedAssetId);
  if (input.relatedWorkOrderId !== undefined) data.relatedWorkOrderId = normOpt(input.relatedWorkOrderId);
  applyFormFields(data, input, "update");
  return del(prisma).update({ where: { id }, data });
}

export async function transitionMoc(session: TenantAccessSession, id: string, input: TransitionInput) {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "DB no disponible.");
  const current = await getMoc(session, id) as unknown as { id: string; tenantId: string; status: string; mocCode: string; vesselCode: string };
  const next = parseEnum(input.status, STATUSES, "status");

  // Validar transición
  const valid: Record<string, string[]> = {
    REQUESTED:      ["UNDER_ANALYSIS", "CANCELLED"],
    UNDER_ANALYSIS: ["APPROVED", "REJECTED", "CANCELLED"],
    APPROVED:       ["IN_PROGRESS", "CANCELLED"],
    IN_PROGRESS:    ["IMPLEMENTED", "CANCELLED"],
    IMPLEMENTED:    ["REVIEWED", "IN_PROGRESS"],
    REVIEWED:       [],
    REJECTED:       [],
    CANCELLED:      [],
  };
  const allowed = valid[current.status] ?? [];
  if (!allowed.includes(next)) {
    throw new RouteError(409, "INVALID_TRANSITION", `${current.status} → ${next} no permitido.`);
  }

  // Approval / rejection requieren rol con autoridad
  if (next === "APPROVED" || next === "REJECTED") ensureCanApprove(session);
  else ensureCanCreate(session);

  const now = new Date();
  const data: Record<string, unknown> = { status: next, updatedByUserId: session.user.id };
  if (next === "APPROVED") {
    data.approvedAt = now;
    data.approvedByUserId = session.user.id;
    data.approvedByName = normOpt(input.approvedByName) ?? session.user.email;
  }
  if (next === "REJECTED") {
    data.rejectedReason = normReq(input.rejectedReason, "rejectedReason");
  }
  if (next === "IMPLEMENTED") {
    data.implementedAt = now;
    data.implementedByName = normOpt(input.implementedByName);
    data.implementationNotes = normOpt(input.implementationNotes);
  }
  if (next === "REVIEWED") {
    data.reviewedAt = now;
    data.reviewedByUserId = session.user.id;
    data.reviewNotes = normOpt(input.reviewNotes);
    data.reviewOutcome = normOpt(input.reviewOutcome);
  }

  const updated = await del(prisma).update({ where: { id }, data });
  void publishAudit(prisma, {
    tenantId: current.tenantId, actorUserId: session.user.id,
    action: `Moc.${next.toLowerCase()}`, entityType: "MocRecord", entityId: id,
    metadata: { mocCode: current.mocCode, vesselCode: current.vesselCode, previousStatus: current.status, newStatus: next },
  });
  return updated;
}

export async function deleteMoc(session: TenantAccessSession, id: string) {
  if (session.user.role !== "TENANT_ADMIN") throw new RouteError(403, "FORBIDDEN", "Solo TENANT_ADMIN.");
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "DB no disponible.");
  const current = await getMoc(session, id) as unknown as { id: string; tenantId: string; mocCode: string };
  await del(prisma).update({
    where: { id },
    data: { deletedAt: new Date(), deletedByUserId: session.user.id, updatedByUserId: session.user.id },
  });
  void publishAudit(prisma, {
    tenantId: current.tenantId, actorUserId: session.user.id,
    action: "Moc.deleted", entityType: "MocRecord", entityId: id,
    metadata: { mocCode: current.mocCode },
  });
}
