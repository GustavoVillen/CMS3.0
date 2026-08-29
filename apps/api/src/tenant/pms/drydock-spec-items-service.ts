// Especificación de Varada — líneas del documento, importación del backlog y
// comentarios buque ↔ tierra.
//
// El upsert de ítems NO usa el patrón delete-all-then-recreate de
// voyage-tank-reports: acá cada línea tiene su hilo de comentarios colgando
// (onDelete: Cascade), así que borrar y recrear perdería la conversación.
// Se hace upsert por id y se borran sólo las líneas ausentes del payload.

import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { publishAudit } from "../../platform/audit/audit-publisher";
import {
  ensureCanApproveDrydock,
  ensureCanManageDrydock,
  ensureEditable,
  loadScopedSpec,
} from "./drydock-specs-service";

const ITEM_CATEGORIES = [
  "HULL_STRUCTURE", "MACHINERY", "ELECTRICAL", "PIPING_VALVES", "TANKS",
  "SAFETY_EQUIPMENT", "CLASS_STATUTORY", "PAINTING", "OTHER",
] as const;
type ItemCategory = (typeof ITEM_CATEGORIES)[number];

const ITEM_STATUSES = ["PROPOSED", "ACCEPTED", "REJECTED"] as const;
type ItemStatus = (typeof ITEM_STATUSES)[number];

const ITEM_SOURCE_TYPES = ["MANUAL", "DEFERRAL", "DEFECT", "WORK_ORDER"] as const;
type ItemSourceType = (typeof ITEM_SOURCE_TYPES)[number];

const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

export interface DrydockItemEntry {
  id?: string | null;
  category?: string | null;
  title: string;
  description?: string | null;
  assetId?: string | null;
  priority?: string | null;
  classRelated?: boolean | null;
}

export interface ImportSourceRef {
  type: string;
  id: string;
}

export interface ItemDecisionInput {
  itemStatus: string;
  decisionNotes?: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function requirePrisma() {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  return prisma;
}

function normReq(v: unknown, field: string): string {
  const t = String(v ?? "").trim();
  if (!t) throw new RouteError(400, "VALIDATION_ERROR", `El campo ${field} es requerido.`);
  return t;
}

function normOpt(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const t = String(v).trim();
  return t || null;
}

function parseCategory(v: unknown): ItemCategory {
  const t = String(v ?? "OTHER").trim().toUpperCase();
  if (!(ITEM_CATEGORIES as readonly string[]).includes(t)) {
    throw new RouteError(400, "VALIDATION_ERROR", `Categoria invalida: ${t}.`);
  }
  return t as ItemCategory;
}

function parsePriority(v: unknown): string | null {
  const t = normOpt(v);
  if (!t) return null;
  const upper = t.toUpperCase();
  if (!(PRIORITIES as readonly string[]).includes(upper)) {
    throw new RouteError(400, "VALIDATION_ERROR", `Prioridad invalida: ${t}.`);
  }
  return upper;
}

/** El buque propone; tierra también puede agregar líneas. Se marca el origen. */
function isShoreRole(role: string): boolean {
  return role === "FLEET_SUPERINTENDENT" || role === "TENANT_ADMIN" || role === "PROCUREMENT_STORE";
}

async function loadScopedItem(session: TenantAccessSession, itemId: string) {
  const prisma = requirePrisma();
  const item = await prisma.drydockSpecItem.findFirst({ where: { id: itemId } });
  if (!item) throw new RouteError(404, "NOT_FOUND", "Item de especificacion no encontrado.");
  // El scope real lo aplica loadScopedSpec: si el usuario no alcanza la spec,
  // tampoco alcanza sus items.
  const spec = await loadScopedSpec(session, item.specId);
  return { item, spec };
}

// ─── Upsert de líneas ────────────────────────────────────────────────────────

export async function upsertDrydockSpecItems(
  session: TenantAccessSession,
  specId: string,
  entries: DrydockItemEntry[],
) {
  ensureCanManageDrydock(session);
  const prisma = requirePrisma();
  const spec = await loadScopedSpec(session, specId);
  ensureEditable(spec);

  if (!Array.isArray(entries)) {
    throw new RouteError(400, "VALIDATION_ERROR", "entries debe ser una lista.");
  }

  const existing = await prisma.drydockSpecItem.findMany({
    where: { specId: spec.id },
    select: { id: true },
  });
  const existingIds = new Set(existing.map(i => i.id));
  const keptIds = new Set(entries.map(e => e.id).filter((v): v is string => !!v && existingIds.has(v)));

  // Las líneas que ya no vienen en el payload se eliminan (con sus comentarios).
  const removedIds = [...existingIds].filter(id => !keptIds.has(id));

  const proposedByVessel = !isShoreRole(session.user.role);

  // Se valida TODO el payload antes de tocar la base: si una línea venía sin
  // título, el borrado de las ausentes ya se había ejecutado y el documento
  // quedaba mutilado sin forma de recuperarlo.
  const prepared = entries.map((entry, i) => ({
    entry,
    data: {
      itemNo: i + 1,
      category: parseCategory(entry.category),
      title: normReq(entry.title, "title"),
      description: normOpt(entry.description),
      priority: parsePriority(entry.priority),
      classRelated: entry.classRelated === true,
      updatedByUserId: session.user.id,
    },
  }));

  // Borrar + reescribir es una sola operación: a mitad de camino el documento
  // no es un documento.
  await prisma.$transaction(async (tx) => {
    if (removedIds.length > 0) {
      await tx.drydockSpecItem.deleteMany({ where: { id: { in: removedIds }, specId: spec.id } });
    }

    for (const { entry, data } of prepared) {
      // `assetId` sólo se pisa si el cliente lo mandó. La pantalla no edita el
      // equipo, así que mandarlo siempre como null borraba el vínculo que había
      // dejado la importación del backlog en cada guardado.
      const assetPatch = "assetId" in entry ? { assetId: normOpt(entry.assetId) } : {};

      if (entry.id && existingIds.has(entry.id)) {
        await tx.drydockSpecItem.update({ where: { id: entry.id }, data: { ...data, ...assetPatch } });
      } else {
        await tx.drydockSpecItem.create({
          data: {
            ...data,
            ...assetPatch,
            tenantId: spec.tenantId,
            vesselCode: spec.vesselCode,
            specId: spec.id,
            sourceType: "MANUAL",
            proposedByVessel,
            createdByUserId: session.user.id,
          },
        });
      }
    }

    await tx.drydockSpec.update({
      where: { id: spec.id },
      data: { updatedByUserId: session.user.id },
    });
  });

  return prisma.drydockSpecItem.findMany({
    where: { specId: spec.id },
    orderBy: { itemNo: "asc" },
    include: { comments: { orderBy: { createdAt: "asc" } } },
  });
}

// ─── Importar del backlog ────────────────────────────────────────────────────
// Es lo que cierra TMSA 4.4.2: los diferimientos, defectos y OT pendientes se
// vuelcan a la especificación en vez de quedar sólo en una lista consultable.

export async function listImportCandidates(session: TenantAccessSession, specId: string) {
  const prisma = requirePrisma();
  const spec = await loadScopedSpec(session, specId);

  const already = await prisma.drydockSpecItem.findMany({
    where: { specId: spec.id, sourceId: { not: null } },
    select: { sourceType: true, sourceId: true },
  });
  const taken = new Set(already.map(a => `${a.sourceType}:${a.sourceId}`));

  const base = { tenantId: spec.tenantId, vesselCode: spec.vesselCode, deletedAt: null };

  const [deferrals, defects, workOrders] = await Promise.all([
    prisma.deferral.findMany({
      where: { ...base, status: { in: ["APPROVED", "ACTIVE", "EXPIRED"] } },
      orderBy: { requestedAt: "desc" },
      take: 200,
      select: {
        id: true, deferralCode: true, assetId: true, justification: true,
        targetDate: true, targetPort: true, riskLevel: true, status: true,
      },
    }),
    prisma.defect.findMany({
      where: { ...base, status: { in: ["OPEN", "UNDER_REVIEW", "IN_PROGRESS", "DEFERRED"] } },
      orderBy: { reportedAt: "desc" },
      take: 200,
      select: {
        id: true, defectCode: true, assetId: true, classification: true,
        description: true, severity: true, status: true,
      },
    }),
    prisma.workOrder.findMany({
      where: { ...base, status: { in: ["PLANNED", "ON_HOLD", "DEFERRED"] } },
      orderBy: { openDate: "desc" },
      take: 200,
      select: {
        id: true, workOrderCode: true, assetId: true, title: true,
        description: true, priority: true, status: true, dueDate: true,
      },
    }),
  ]);

  const assetIds = [...new Set([
    ...deferrals.map(d => d.assetId),
    ...defects.map(d => d.assetId),
    ...workOrders.map(w => w.assetId),
  ].filter((v): v is string => !!v))];

  const assets = assetIds.length > 0
    ? await prisma.asset.findMany({
        where: { id: { in: assetIds }, tenantId: spec.tenantId },
        select: { id: true, name: true },
      })
    : [];
  const assetName = new Map(assets.map(a => [a.id, a.name]));

  return {
    deferrals: deferrals
      .filter(d => !taken.has(`DEFERRAL:${d.id}`))
      .map(d => ({
        sourceType: "DEFERRAL" as const,
        id: d.id,
        code: d.deferralCode,
        title: d.justification ?? d.deferralCode,
        description: [d.targetPort ? `Puerto objetivo: ${d.targetPort}` : null, d.justification].filter(Boolean).join(" — ") || null,
        assetId: d.assetId,
        assetName: assetName.get(d.assetId) ?? null,
        priority: d.riskLevel ?? null,
        status: d.status,
        date: d.targetDate,
      })),
    defects: defects
      .filter(d => !taken.has(`DEFECT:${d.id}`))
      .map(d => ({
        sourceType: "DEFECT" as const,
        id: d.id,
        code: d.defectCode,
        title: d.classification,
        description: d.description,
        assetId: d.assetId,
        assetName: assetName.get(d.assetId) ?? null,
        priority: d.severity,
        status: d.status,
        date: null,
      })),
    workOrders: workOrders
      .filter(w => !taken.has(`WORK_ORDER:${w.id}`))
      .map(w => ({
        sourceType: "WORK_ORDER" as const,
        id: w.id,
        code: w.workOrderCode,
        title: w.title ?? w.workOrderCode,
        description: w.description,
        assetId: w.assetId,
        assetName: assetName.get(w.assetId) ?? null,
        priority: w.priority,
        status: w.status,
        date: w.dueDate,
      })),
  };
}

export async function importItemsFromSources(
  session: TenantAccessSession,
  specId: string,
  sources: ImportSourceRef[],
) {
  ensureCanManageDrydock(session);
  const prisma = requirePrisma();
  const spec = await loadScopedSpec(session, specId);
  ensureEditable(spec);

  if (!Array.isArray(sources) || sources.length === 0) {
    throw new RouteError(400, "VALIDATION_ERROR", "No se indicaron origenes para importar.");
  }

  const candidates = await listImportCandidates(session, specId);
  const byKey = new Map<string, { code: string; title: string; description: string | null; assetId: string | null; priority: string | null }>();
  for (const group of [candidates.deferrals, candidates.defects, candidates.workOrders]) {
    for (const c of group) byKey.set(`${c.sourceType}:${c.id}`, c);
  }

  const last = await prisma.drydockSpecItem.findFirst({
    where: { specId: spec.id },
    orderBy: { itemNo: "desc" },
    select: { itemNo: true },
  });
  let itemNo = (last?.itemNo ?? 0) + 1;

  const proposedByVessel = !isShoreRole(session.user.role);
  const created: string[] = [];

  for (const ref of sources) {
    const type = String(ref?.type ?? "").trim().toUpperCase();
    if (!(ITEM_SOURCE_TYPES as readonly string[]).includes(type) || type === "MANUAL") {
      throw new RouteError(400, "VALIDATION_ERROR", `Origen invalido: ${type}.`);
    }
    const key = `${type}:${String(ref?.id ?? "")}`;
    const candidate = byKey.get(key);
    // Si no está entre los candidatos: o no existe, o es de otro buque, o ya
    // fue importado. En cualquier caso se ignora en silencio.
    if (!candidate) continue;

    const item = await prisma.drydockSpecItem.create({
      data: {
        tenantId: spec.tenantId,
        vesselCode: spec.vesselCode,
        specId: spec.id,
        itemNo: itemNo++,
        category: "OTHER",
        title: `${candidate.code} — ${candidate.title}`.slice(0, 300),
        description: candidate.description,
        assetId: candidate.assetId,
        sourceType: type as ItemSourceType,
        sourceId: String(ref.id),
        priority: (PRIORITIES as readonly string[]).includes(String(candidate.priority ?? "").toUpperCase())
          ? String(candidate.priority).toUpperCase()
          : null,
        proposedByVessel,
        createdByUserId: session.user.id,
        updatedByUserId: session.user.id,
      },
    });
    created.push(item.id);
  }

  void publishAudit(prisma, {
    tenantId: spec.tenantId,
    actorUserId: session.user.id,
    action: "DrydockSpec.itemsImported",
    entityType: "DrydockSpec",
    entityId: spec.id,
    metadata: { specCode: spec.specCode, vesselCode: spec.vesselCode, imported: created.length },
  });

  return prisma.drydockSpecItem.findMany({
    where: { specId: spec.id },
    orderBy: { itemNo: "asc" },
    include: { comments: { orderBy: { createdAt: "asc" } } },
  });
}

// ─── Decisión por línea (tierra acepta o descarta) ───────────────────────────

export async function setItemDecision(
  session: TenantAccessSession,
  itemId: string,
  input: ItemDecisionInput,
) {
  // Aceptar o descartar una línea es la decisión DE TIERRA sobre el alcance de
  // la varada, no una edición del buque: exige el mismo permiso que aprobar el
  // documento. Sin esto el botón queda escondido en React pero el endpoint lo
  // dejaba pasar a cualquier rol operativo.
  ensureCanApproveDrydock(session);
  const prisma = requirePrisma();
  const { item, spec } = await loadScopedItem(session, itemId);
  ensureEditable(spec);

  const next = String(input.itemStatus ?? "").trim().toUpperCase();
  if (!(ITEM_STATUSES as readonly string[]).includes(next)) {
    throw new RouteError(400, "VALIDATION_ERROR", `Estado de item invalido: ${next}.`);
  }

  return prisma.drydockSpecItem.update({
    where: { id: item.id },
    data: {
      itemStatus: next as ItemStatus,
      decisionNotes: normOpt(input.decisionNotes),
      updatedByUserId: session.user.id,
    },
  });
}

// ─── Comentarios por línea ───────────────────────────────────────────────────
// Se admiten también sobre una spec aprobada: el documento queda congelado,
// pero la conversación sobre él no se cierra.

export async function addItemComment(session: TenantAccessSession, itemId: string, body: unknown) {
  ensureCanManageDrydock(session);
  const prisma = requirePrisma();
  const { item, spec } = await loadScopedItem(session, itemId);

  const text = normReq(body, "body");

  const comment = await prisma.drydockSpecItemComment.create({
    data: {
      tenantId: spec.tenantId,
      itemId: item.id,
      body: text,
      authorUserId: session.user.id,
      authorName: session.user.email,
      authorRole: session.user.role,
    },
  });

  return comment;
}
