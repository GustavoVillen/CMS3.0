// Pre-Arrival / Pre-Departure / etc. checklists firmadas (SIRE 2.0 Ch. 4).

import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { hasPermission } from "../auth/role-permissions";
import { publishAudit } from "../../platform/audit/audit-publisher";

const TEMPLATE_TYPES = [
  "PRE_ARRIVAL", "PRE_DEPARTURE", "PRE_BUNKERING", "PRE_CARGO_TRANSFER",
  "ENCLOSED_SPACE_ENTRY", "HOT_WORK", "PILOT_BOARDING", "ANCHOR", "MOORING", "OTHER",
] as const;
const EXEC_STATUSES = ["IN_PROGRESS", "COMPLETED", "CANCELLED"] as const;
const RESPONSE_STATUSES = ["PENDING", "CONFORMING", "NOT_CONFORMING", "NOT_APPLICABLE"] as const;

export interface TemplateItem {
  code: string;
  text: string;
  isMandatory?: boolean;
  category?: string;
}

export interface TemplateWriteInput {
  type?: string;
  name?: string;
  description?: string | null;
  items?: TemplateItem[];
  isActive?: boolean;
  // Aprobación formal de la plantilla. Si pasa de null → fecha, queda aprobada.
  // Una plantilla aprobada que luego se edita dispara MOC PROCEDURE_CHANGE.
  approved?: boolean;
}

export interface ExecutionListFilters {
  vesselCode?: string | null;
  type?: string | null;
  status?: string | null;
}

export interface CreateExecutionInput {
  vesselCode: string;
  templateId: string;
  eventDateTime: string | Date;
  port?: string | null;
  voyageRef?: string | null;
  performedByName?: string | null;
}

export interface UpdateExecutionInput {
  status?: string;
  port?: string | null;
  voyageRef?: string | null;
  performedByName?: string | null;
  signedByName?: string | null;
  signedAt?: string | Date | null;
  notes?: string | null;
}

export interface ResponseInput {
  itemCode: string;
  status: string;
  notes?: string | null;
  reportedByName?: string | null;
}

function canWrite(s: TenantAccessSession): boolean {
  return s.user.role !== "AUDITOR_READONLY";
}
function ensureCanWrite(s: TenantAccessSession) {
  if (!canWrite(s)) throw new RouteError(403, "FORBIDDEN", "Solo-lectura no puede gestionar checklists.");
}
function canManageTemplates(s: TenantAccessSession): boolean {
  return hasPermission(s, "checklist.manageTemplates");
}
function ensureCanManageTemplates(s: TenantAccessSession) {
  if (!canManageTemplates(s)) throw new RouteError(403, "FORBIDDEN", "No autorizado para editar templates.");
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
function parseDate(v: unknown, f: string): Date {
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) throw new RouteError(400, "VALIDATION_ERROR", `${f} fecha inválida.`);
  return d;
}
function parseOptDate(v: unknown, f: string): Date | null {
  if (v === undefined || v === null || v === "") return null;
  return parseDate(v, f);
}
function parseEnum<T extends string>(v: unknown, allowed: readonly T[], f: string): T {
  const s = String(v ?? "").trim().toUpperCase();
  if (!allowed.includes(s as T)) throw new RouteError(400, "VALIDATION_ERROR", `${f} inválido: ${s}.`);
  return s as T;
}
function validateItems(items: unknown): TemplateItem[] {
  if (!Array.isArray(items)) throw new RouteError(400, "VALIDATION_ERROR", "items debe ser array.");
  return items.map((it, i) => {
    const obj = (it ?? {}) as Record<string, unknown>;
    const code = String(obj.code ?? "").trim();
    const text = String(obj.text ?? "").trim();
    if (!code) throw new RouteError(400, "VALIDATION_ERROR", `items[${i}].code requerido.`);
    if (!text) throw new RouteError(400, "VALIDATION_ERROR", `items[${i}].text requerido.`);
    return { code, text, isMandatory: !!obj.isMandatory, category: obj.category ? String(obj.category) : undefined };
  });
}

type Delegate = {
  findMany(a: unknown): Promise<Record<string, unknown>[]>;
  findFirst(a: unknown): Promise<Record<string, unknown> | null>;
  create(a: unknown): Promise<Record<string, unknown>>;
  update(a: unknown): Promise<Record<string, unknown>>;
  count(a: unknown): Promise<number>;
  upsert(a: unknown): Promise<Record<string, unknown>>;
};
function templateDel(prisma: NonNullable<ReturnType<typeof getPrismaClient>>) {
  return (prisma as unknown as { checklistTemplate: Delegate }).checklistTemplate;
}
function execDel(prisma: NonNullable<ReturnType<typeof getPrismaClient>>) {
  return (prisma as unknown as { checklistExecution: Delegate }).checklistExecution;
}
function respDel(prisma: NonNullable<ReturnType<typeof getPrismaClient>>) {
  return (prisma as unknown as { checklistItemResponse: Delegate }).checklistItemResponse;
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

// ─── Templates ──────────────────────────────────────────────────────────────

export async function listTemplates(session: TenantAccessSession, filters: { type?: string | null } = {}) {
  const prisma = getPrismaClient();
  if (!prisma) return [];
  const tenantId = await tenantIdOrThrow(session);
  const where: Record<string, unknown> = {
    OR: [{ tenantId }, { tenantId: null }],
    isActive: true,
  };
  if (filters.type) where.type = filters.type;
  return templateDel(prisma).findMany({ where, orderBy: { name: "asc" } });
}

export async function getTemplate(session: TenantAccessSession, id: string) {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "DB no disponible.");
  const tenantId = await tenantIdOrThrow(session);
  const tmpl = await templateDel(prisma).findFirst({
    where: { id, OR: [{ tenantId }, { tenantId: null }] },
  });
  if (!tmpl) throw new RouteError(404, "NOT_FOUND", "Template no encontrado.");
  return tmpl;
}

export async function createTemplate(session: TenantAccessSession, input: TemplateWriteInput) {
  ensureCanManageTemplates(session);
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "DB no disponible.");
  const tenantId = await tenantIdOrThrow(session);
  const type = parseEnum(input.type, TEMPLATE_TYPES, "type");
  const items = validateItems(input.items ?? []);
  const created = await templateDel(prisma).create({
    data: {
      tenantId, type,
      name: normReq(input.name, "name"),
      description: normOpt(input.description),
      itemsJson: items,
      isActive: input.isActive ?? true,
      createdByUserId: session.user.id,
      updatedByUserId: session.user.id,
    },
  });
  return created;
}

export async function updateTemplate(session: TenantAccessSession, id: string, input: TemplateWriteInput) {
  ensureCanManageTemplates(session);
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "DB no disponible.");
  const current = await getTemplate(session, id) as unknown as { id: string; tenantId: string | null };
  if (current.tenantId === null) throw new RouteError(403, "FORBIDDEN", "Templates globales no se editan desde el tenant.");
  const data: Record<string, unknown> = { updatedByUserId: session.user.id };
  if (input.type !== undefined) data.type = parseEnum(input.type, TEMPLATE_TYPES, "type");
  if (input.name !== undefined) data.name = normReq(input.name, "name");
  if (input.description !== undefined) data.description = normOpt(input.description);
  if (input.items !== undefined) data.itemsJson = validateItems(input.items);
  if (input.isActive !== undefined) data.isActive = !!input.isActive;
  if (input.approved !== undefined) {
    data.approvedAt = input.approved ? new Date() : null;
    data.approvedByUserId = input.approved ? session.user.id : null;
  }
  return templateDel(prisma).update({ where: { id }, data });
}

// ─── Executions ─────────────────────────────────────────────────────────────

async function generateExecutionCode(prisma: NonNullable<ReturnType<typeof getPrismaClient>>, tenantId: string, vesselCode: string): Promise<string> {
  const year = new Date().getFullYear();
  const yy = String(year).slice(-2);
  const count = await execDel(prisma).count({
    where: { tenantId, vesselCode, createdAt: { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) } },
  });
  return `CHK-${vesselCode}-${yy}-${String(count + 1).padStart(4, "0")}`;
}

export async function listExecutions(session: TenantAccessSession, filters: ExecutionListFilters = {}) {
  const prisma = getPrismaClient();
  if (!prisma) return [];
  const tenantId = await tenantIdOrThrow(session);
  const where: Record<string, unknown> = { tenantId, deletedAt: null };
  applyVesselScope(session, where, filters.vesselCode ?? null);
  if (filters.type) where.type = filters.type;
  if (filters.status) where.status = filters.status;
  const items = await execDel(prisma).findMany({ where, orderBy: { eventDateTime: "desc" } });

  // Enriquecemos con templateName para que el frontend no tenga que joinear.
  const tplIds = [...new Set(items.map(i => (i as { templateId: string }).templateId))];
  let tplMap = new Map<string, string>();
  if (tplIds.length > 0) {
    const tpls = await templateDel(prisma).findMany({
      where: { id: { in: tplIds } },
      select: { id: true, name: true } as never,
    });
    for (const t of tpls as Array<{ id: string; name: string }>) tplMap.set(t.id, t.name);
  }
  return items.map(i => ({ ...i, templateName: tplMap.get((i as { templateId: string }).templateId) ?? null }));
}

export async function getExecution(session: TenantAccessSession, id: string) {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "DB no disponible.");
  const tenantId = await tenantIdOrThrow(session);
  const where: Record<string, unknown> = { id, tenantId, deletedAt: null };
  applyVesselScope(session, where);
  const exec = await execDel(prisma).findFirst({ where });
  if (!exec) throw new RouteError(404, "NOT_FOUND", "Checklist no encontrado.");
  const responses = await respDel(prisma).findMany({
    where: { executionId: id }, orderBy: { itemCode: "asc" },
  });
  const tpl = await templateDel(prisma).findFirst({ where: { id: (exec as { templateId: string }).templateId } });
  return { ...exec, responses, template: tpl };
}

export async function createExecution(session: TenantAccessSession, input: CreateExecutionInput) {
  ensureCanWrite(session);
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "DB no disponible.");
  const tenantId = await tenantIdOrThrow(session);
  const vesselCode = normReq(input.vesselCode, "vesselCode").toUpperCase();
  if (session.user.role !== "TENANT_ADMIN" && !session.user.assignedVesselCodes.includes(vesselCode)) {
    throw new RouteError(403, "FORBIDDEN", "Sin acceso al vessel.");
  }
  const tpl = await getTemplate(session, input.templateId) as unknown as { id: string; type: string; itemsJson: TemplateItem[] };
  const executionCode = await generateExecutionCode(prisma, tenantId, vesselCode);
  const eventDateTime = parseDate(input.eventDateTime, "eventDateTime");

  const created = await execDel(prisma).create({
    data: {
      tenantId, vesselCode, executionCode,
      templateId: tpl.id, type: tpl.type as never,
      eventDateTime,
      port: normOpt(input.port),
      voyageRef: normOpt(input.voyageRef),
      performedByName: normOpt(input.performedByName),
      totalItems: (tpl.itemsJson as TemplateItem[]).length,
      createdByUserId: session.user.id,
      updatedByUserId: session.user.id,
    },
  }) as unknown as { id: string };

  // Pre-crear responses con status PENDING para todos los items del template.
  for (const item of tpl.itemsJson as TemplateItem[]) {
    await respDel(prisma).create({
      data: {
        tenantId,
        executionId: created.id,
        itemCode: item.code,
        itemText: item.text,
        status: "PENDING",
        updatedByUserId: session.user.id,
      },
    });
  }

  void publishAudit(prisma, {
    tenantId, actorUserId: session.user.id,
    action: "Checklist.created", entityType: "ChecklistExecution", entityId: created.id,
    metadata: { executionCode, vesselCode, templateType: tpl.type },
  });
  return execDel(prisma).findFirst({ where: { id: created.id } });
}

export async function updateExecution(session: TenantAccessSession, id: string, input: UpdateExecutionInput) {
  ensureCanWrite(session);
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "DB no disponible.");
  const current = await getExecution(session, id) as unknown as { id: string; tenantId: string; executionCode: string; status: string };
  const data: Record<string, unknown> = { updatedByUserId: session.user.id };
  if (input.port !== undefined) data.port = normOpt(input.port);
  if (input.voyageRef !== undefined) data.voyageRef = normOpt(input.voyageRef);
  if (input.performedByName !== undefined) data.performedByName = normOpt(input.performedByName);
  if (input.signedByName !== undefined) data.signedByName = normOpt(input.signedByName);
  if (input.signedAt !== undefined) data.signedAt = parseOptDate(input.signedAt, "signedAt");
  if (input.notes !== undefined) data.notes = normOpt(input.notes);
  if (input.status !== undefined) {
    const next = parseEnum(input.status, EXEC_STATUSES, "status");
    data.status = next;
    if (next === "COMPLETED") {
      // Recalcular conformingItems / notConformingItems
      const responses = await respDel(prisma).findMany({
        where: { executionId: id }, select: { status: true } as never,
      }) as Array<{ status: string }>;
      data.conformingItems = responses.filter(r => r.status === "CONFORMING").length;
      data.notConformingItems = responses.filter(r => r.status === "NOT_CONFORMING").length;
      if (!data.signedAt) data.signedAt = new Date();
    }
  }
  const updated = await execDel(prisma).update({ where: { id }, data });
  void publishAudit(prisma, {
    tenantId: current.tenantId, actorUserId: session.user.id,
    action: "Checklist.updated", entityType: "ChecklistExecution", entityId: id,
    metadata: { executionCode: current.executionCode, status: data.status ?? current.status },
  });
  return updated;
}

export async function deleteExecution(session: TenantAccessSession, id: string) {
  if (session.user.role !== "TENANT_ADMIN") throw new RouteError(403, "FORBIDDEN", "Solo TENANT_ADMIN.");
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "DB no disponible.");
  const current = await getExecution(session, id) as unknown as { id: string; tenantId: string; executionCode: string };
  await execDel(prisma).update({
    where: { id },
    data: { deletedAt: new Date(), deletedByUserId: session.user.id, updatedByUserId: session.user.id },
  });
  void publishAudit(prisma, {
    tenantId: current.tenantId, actorUserId: session.user.id,
    action: "Checklist.deleted", entityType: "ChecklistExecution", entityId: id,
    metadata: { executionCode: current.executionCode },
  });
}

export async function setResponse(session: TenantAccessSession, executionId: string, input: ResponseInput) {
  ensureCanWrite(session);
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "DB no disponible.");
  const exec = await getExecution(session, executionId) as unknown as { id: string; tenantId: string; status: string };
  if (exec.status !== "IN_PROGRESS") {
    throw new RouteError(409, "INVALID_STATUS", "Solo se editan responses de checklists IN_PROGRESS.");
  }
  const itemCode = normReq(input.itemCode, "itemCode");
  const status = parseEnum(input.status, RESPONSE_STATUSES, "status");

  const existing = await respDel(prisma).findFirst({
    where: { executionId, itemCode },
  });
  if (!existing) throw new RouteError(404, "NOT_FOUND", "Item no encontrado en este checklist.");

  return respDel(prisma).update({
    where: { id: (existing as { id: string }).id },
    data: {
      status,
      notes: normOpt(input.notes),
      reportedByName: normOpt(input.reportedByName),
      updatedByUserId: session.user.id,
    },
  });
}
