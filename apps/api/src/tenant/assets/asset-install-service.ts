// Alta o reemplazo de un equipo con su OT de instalación (asistente "Nueva OT →
// Para un Equipo Nuevo"). Al confirmar se crean el equipo, sus tareas copiadas
// (en espera, INACTIVE), la OT y el vínculo con el MOC; el cambio RIGE al cerrar
// la OT: ahí las tareas nuevas empiezan a contar y el equipo reemplazado se da de
// baja con sus tareas. Hasta entonces el equipo viejo sigue con su mantenimiento.

import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { ensurePermission } from "../auth/role-permissions";
import { publishAudit } from "../../platform/audit/audit-publisher";
import { log } from "../../common/logger";
import { createTenantAsset, getTenantAsset, type CreateAssetInput } from "./assets-service";
import {
  createTenantMaintenancePlan,
  getTenantMaintenancePlan,
  recalculateNextDue,
  resolvePlanProviderRequests,
  resolvePlanSpares,
  type CreateMaintenancePlanInput,
} from "../maintenance-plans/maintenance-plans-service";
import { createTenantWorkOrder } from "../work-orders/work-orders-service";
import { createMoc, getMoc, updateMoc } from "../moc/moc-service";

type Prisma = NonNullable<ReturnType<typeof getPrismaClient>>;

export interface AssetInstallationInfo {
  replacesAssetId: string | null;
  mocRequired: boolean;
  mocNotRequiredReason: string | null;
}

export type AssetInstallationMocInput =
  | { mode: "NEW"; title: string; reasonForChange: string; proposedChange: string }
  | { mode: "EXISTING"; mocId: string }
  | { mode: "NOT_REQUIRED"; reason: string };

export interface AssetInstallationInput {
  vesselCode: string;
  replacesAssetId?: string | null;
  asset: Pick<CreateAssetInput,
    "assetCode" | "name" | "sfiCode" | "criticality" | "criticalityRationale" | "isSafetyCritical" |
    "manufacturer" | "model" | "serialNumber">;
  copyPlanIds?: string[] | null;
  moc: AssetInstallationMocInput;
  /** Título y descripción los arma la pantalla, en el idioma del tenant. */
  workOrder: { title: string; description?: string | null };
}

/** MOC en estos estados ya autoriza ejecutar el cambio. */
const MOC_APPROVED_STATUSES = new Set(["APPROVED", "IN_PROGRESS", "IMPLEMENTED", "REVIEWED"]);
/** MOC terminales: no se pueden editar (updateMoc) ni vincular. */
const MOC_TERMINAL_STATUSES = new Set(["REVIEWED", "REJECTED", "CANCELLED"]);
const MOC_STATUS_NAME: Record<string, string> = {
  REQUESTED: "Solicitado", UNDER_ANALYSIS: "En análisis", APPROVED: "Aprobado", IN_PROGRESS: "En curso",
  IMPLEMENTED: "Implementado", REVIEWED: "Revisado", REJECTED: "Rechazado", CANCELLED: "Cancelado",
};
const MAX_COPY_PLANS = 200;

function requiredText(value: unknown, message: string): string {
  const text = String(value ?? "").trim();
  if (!text) throw new RouteError(400, "VALIDATION_ERROR", message);
  return text;
}

export function parseAssetInstallation(value: unknown): AssetInstallationInfo | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  return {
    replacesAssetId: typeof raw.replacesAssetId === "string" && raw.replacesAssetId ? raw.replacesAssetId : null,
    mocRequired: raw.mocRequired === true,
    mocNotRequiredReason: typeof raw.mocNotRequiredReason === "string" ? raw.mocNotRequiredReason : null,
  };
}

function sfiGroupOf(sfiCode: string | null | undefined): number | null {
  const first = (sfiCode ?? "").trim()[0];
  return first && /^[0-9]$/.test(first) ? Number(first) : null;
}

/** Datos de una tarea existente para crearla en el equipo nuevo. Sale con código
 *  nuevo, en espera (INACTIVE) y sin vencimiento propio: se calcula al cerrar la OT.
 *  El catálogo de repuestos es de cada buque: desde otro buque se copia la
 *  descripción del repuesto, no el vínculo. */
function planCopyPayload(
  src: Record<string, unknown>,
  target: { vesselCode: string; assetId: string; sfiGroupNumber: number | null },
): CreateMaintenancePlanInput {
  const sameVessel = String(src.vesselCode) === target.vesselCode;
  const spares = resolvePlanSpares(src).map(s => sameVessel ? s : { ...s, spareId: null });
  const providerRequests = resolvePlanProviderRequests(src).map(r => ({ providerId: r.providerId, purpose: r.purpose ?? null }));
  const get = <T>(key: string) => (src[key] ?? null) as T;
  return {
    vesselCode: target.vesselCode,
    assetId: target.assetId,
    title: String(src.title),
    description: get("description"),
    taskType: get("taskType"),
    criteriaSource: get("criteriaSource"),
    triggerType: src.triggerType as CreateMaintenancePlanInput["triggerType"],
    frequencyHours: get("frequencyHours"),
    frequencyMonths: get("frequencyMonths"),
    estimatedHours: get("estimatedHours"),
    responsible: get("responsible"),
    department: get("department"),
    providerRequests,
    spares,
    acceptanceCriteria: get("acceptanceCriteria"),
    loto: get("loto"),
    sfiGroupNumber: target.sfiGroupNumber,
    riskLevel: get("riskLevel"),
    riskProbability: get("riskProbability"),
    riskConsequence: get("riskConsequence"),
    riskAnalysisResult: get("riskAnalysisResult"),
    consequenceCategory: get("consequenceCategory"),
    consequenceRationale: get("consequenceRationale"),
    status: "INACTIVE",
    taskMasterId: get("taskMasterId"),
    samplingKind: get("samplingKind"),
    samplingFluidType: get("samplingFluidType"),
    requiredPermitTypes: get("requiredPermitTypes"),
    triggerResultMode: get("triggerResultMode") ?? undefined,
    checklistTemplate: get("checklistTemplate"),
    windowMode: get("windowMode") ?? undefined,
    windowLeadDays: get("windowLeadDays"),
    windowLeadHours: get("windowLeadHours"),
    windowLeadPercent: get("windowLeadPercent"),
  };
}

export async function createAssetInstallation(session: TenantAccessSession, input: AssetInstallationInput) {
  ensurePermission(session, "asset.install", "No autorizado para dar de alta o reemplazar equipos.");
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  // ── Validación completa antes de escribir nada ─────────────────────────────
  const vesselCode = requiredText(input?.vesselCode, "Falta el buque.").toUpperCase();
  if (!input.asset) throw new RouteError(400, "VALIDATION_ERROR", "Faltan los datos del equipo nuevo.");
  const woTitle = requiredText(input.workOrder?.title, "Falta el título de la OT.");

  const replacesAssetId = input.replacesAssetId?.trim() || null;
  let replaced: Awaited<ReturnType<typeof getTenantAsset>> | null = null;
  if (replacesAssetId) {
    replaced = await getTenantAsset(session, replacesAssetId);
    if (replaced.vesselCode !== vesselCode) {
      throw new RouteError(400, "VALIDATION_ERROR", "El equipo que se reemplaza tiene que ser del mismo buque.");
    }
    // Dos OT de instalación sobre el mismo equipo darían de baja dos veces lo mismo.
    const pending = await (prisma as unknown as {
      workOrder: { findFirst(a: unknown): Promise<{ workOrderCode: string } | null> };
    }).workOrder.findFirst({
      where: {
        tenantId: replaced.tenantId, deletedAt: null,
        status: { notIn: ["CLOSED", "CANCELLED"] },
        assetInstallation: { path: ["replacesAssetId"], equals: replaced.id },
      },
      select: { workOrderCode: true },
    });
    if (pending) {
      throw new RouteError(409, "INSTALLATION_PENDING",
        `Ya hay una OT de instalación abierta que reemplaza a ${replaced.name}: ${pending.workOrderCode}.`);
    }
  }

  const copyIds = [...new Set((input.copyPlanIds ?? []).filter(id => typeof id === "string" && id))];
  if (copyIds.length > MAX_COPY_PLANS) {
    throw new RouteError(400, "VALIDATION_ERROR", `Se pueden copiar hasta ${MAX_COPY_PLANS} tareas por vez.`);
  }
  // getTenantMaintenancePlan valida empresa y alcance por buque del usuario.
  const sourcePlans = await Promise.all(copyIds.map(id => getTenantMaintenancePlan(session, id)));

  const moc = input.moc;
  let mocCreate: { title: string; reasonForChange: string; proposedChange: string } | null = null;
  let mocExistingId: string | null = null;
  let mocNotRequiredReason: string | null = null;
  if (moc?.mode === "NEW") {
    mocCreate = {
      title: requiredText(moc.title, "Falta el título del MOC."),
      reasonForChange: requiredText(moc.reasonForChange, "Falta el motivo del cambio para el MOC."),
      proposedChange: requiredText(moc.proposedChange, "Falta el cambio propuesto para el MOC."),
    };
  } else if (moc?.mode === "EXISTING") {
    const existing = await getMoc(session, requiredText(moc.mocId, "Falta elegir el MOC.")) as unknown as {
      id: string; vesselCode: string; status: string; mocCode: string;
    };
    if (existing.vesselCode !== vesselCode) {
      throw new RouteError(400, "VALIDATION_ERROR", "El MOC elegido es de otro buque.");
    }
    if (MOC_TERMINAL_STATUSES.has(existing.status)) {
      throw new RouteError(409, "MOC_CLOSED", `El MOC ${existing.mocCode} está ${MOC_STATUS_NAME[existing.status] ?? existing.status} y no se puede vincular.`);
    }
    mocExistingId = existing.id;
  } else if (moc?.mode === "NOT_REQUIRED") {
    mocNotRequiredReason = requiredText(moc.reason, "Falta el motivo por el que no requiere MOC.");
  } else {
    throw new RouteError(400, "VALIDATION_ERROR", "Falta indicar qué pasa con el MOC.");
  }

  // ── Escritura. Si algo falla después de crear el equipo, se deshace lo creado ─
  const asset = await createTenantAsset(session, {
    ...input.asset,
    vesselCode,
    status: "OPERATIONAL",
    planNotRequired: false,
  });

  const createdPlanIds: string[] = [];
  let workOrder: { id: string; workOrderCode: string } | null = null;
  let mocId: string | null = mocExistingId;
  try {
    const target = { vesselCode, assetId: asset.id, sfiGroupNumber: sfiGroupOf(asset.sfiCode) };
    for (const src of sourcePlans) {
      const created = await createTenantMaintenancePlan(session, planCopyPayload(src as unknown as Record<string, unknown>, target));
      createdPlanIds.push(created.id);
    }

    const info: AssetInstallationInfo = {
      replacesAssetId: replaced?.id ?? null,
      mocRequired: moc.mode !== "NOT_REQUIRED",
      mocNotRequiredReason,
    };
    const wo = await createTenantWorkOrder(session, {
      vesselCode,
      assetId: asset.id,
      maintenanceKind: "CORRECTIVO_PROGRAMADO",
      priority: "MEDIUM",
      criticality: asset.criticality as "A" | "B" | "C",
      title: woTitle,
      description: input.workOrder.description ?? null,
    });
    workOrder = { id: wo.id, workOrderCode: wo.workOrderCode };
    await (prisma as unknown as {
      workOrder: { update(a: unknown): Promise<unknown> };
    }).workOrder.update({ where: { id: wo.id }, data: { assetInstallation: info } });

    if (mocCreate) {
      const created = await createMoc(session, {
        vesselCode,
        category: "EQUIPMENT_CHANGE",
        // Mismos valores iniciales que "Nuevo MOC" de cambio de equipo (Moc.tsx).
        riskLevel: "MEDIUM",
        impactAreas: ["Safety", "Operational"],
        ...mocCreate,
        relatedAssetId: asset.id,
        relatedWorkOrderId: wo.id,
      }) as unknown as { id: string };
      mocId = created.id;
    } else if (mocExistingId) {
      await updateMoc(session, mocExistingId, { relatedAssetId: asset.id, relatedWorkOrderId: wo.id });
    }
  } catch (err) {
    log.error("[asset-install] fallo después de crear el equipo, se deshace lo creado", asset.assetCode, err);
    const now = new Date();
    const del = { deletedAt: now, deletedByUserId: session.user.id };
    const p = prisma as unknown as Record<string, { updateMany(a: unknown): Promise<unknown> }>;
    try {
      if (workOrder) await p.workOrder!.updateMany({ where: { id: workOrder.id, tenantId: asset.tenantId }, data: del });
      if (createdPlanIds.length) await p.maintenancePlan!.updateMany({ where: { id: { in: createdPlanIds }, tenantId: asset.tenantId }, data: del });
      await p.asset!.updateMany({ where: { id: asset.id, tenantId: asset.tenantId }, data: { ...del, updatedByUserId: session.user.id } });
    } catch (cleanupErr) {
      log.error("[asset-install] no se pudo deshacer lo creado", asset.assetCode, cleanupErr);
    }
    throw err;
  }

  void publishAudit(prisma, {
    tenantId: asset.tenantId,
    actorUserId: session.user.id,
    action: "Asset.installationRequested",
    entityType: "Asset",
    entityId: asset.id,
    metadata: {
      assetCode: asset.assetCode, name: asset.name, vesselCode,
      workOrderCode: workOrder.workOrderCode,
      replacesAssetCode: replaced?.assetCode ?? null,
      copiedPlans: createdPlanIds.length,
      mocMode: moc.mode,
    },
  });

  return {
    assetId: asset.id,
    assetCode: asset.assetCode,
    workOrderId: workOrder.id,
    workOrderCode: workOrder.workOrderCode,
    mocId,
    copiedPlans: createdPlanIds.length,
  };
}

/** Compuerta del cierre: si el cambio requiere MOC, tiene que estar aprobado. */
export async function checkAssetInstallationBeforeClose(
  prisma: Prisma,
  wo: { id: string; tenantId: string; assetInstallation?: unknown },
): Promise<void> {
  const info = parseAssetInstallation(wo.assetInstallation);
  if (!info?.mocRequired) return;
  const moc = await (prisma as unknown as {
    mocRecord: { findFirst(a: unknown): Promise<{ mocCode: string; status: string } | null> };
  }).mocRecord.findFirst({
    where: { tenantId: wo.tenantId, relatedWorkOrderId: wo.id, deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: { mocCode: true, status: true },
  });
  if (!moc) {
    throw new RouteError(409, "MOC_REQUIRED",
      "No se puede cerrar la OT: el cambio de equipo requiere MOC y no hay ninguno vinculado a esta OT.");
  }
  if (!MOC_APPROVED_STATUSES.has(moc.status)) {
    throw new RouteError(409, "MOC_NOT_APPROVED",
      `No se puede cerrar la OT: el cambio de equipo requiere MOC y ${moc.mocCode} está ${MOC_STATUS_NAME[moc.status] ?? moc.status}.\nTiene que estar aprobado por el Superintendente o el DPA.`);
  }
}

export interface AssetInstallationApplied {
  newAssetId: string;
  activatedPlans: number;
  replacedAssetId: string | null;
  replacedAssetCode: string | null;
  deactivatedPlans: number;
  movedCoverage: number;
}

/** Lo que rige al cerrar la OT de instalación. Corre dentro de la transacción del cierre. */
export async function applyAssetInstallationOnClose(
  txRaw: unknown,
  wo: { assetId: string; tenantId: string; assetInstallation?: unknown },
  completedDate: Date,
  hoursAtClose: number | null,
  userId: string,
): Promise<AssetInstallationApplied | null> {
  const info = parseAssetInstallation(wo.assetInstallation);
  if (!info) return null;
  type Delegate = {
    findFirst(a: unknown): Promise<Record<string, unknown> | null>;
    findMany(a: unknown): Promise<Record<string, unknown>[]>;
    update(a: unknown): Promise<unknown>;
    updateMany(a: unknown): Promise<{ count: number }>;
    delete(a: unknown): Promise<unknown>;
  };
  const tx = txRaw as { asset: Delegate; maintenancePlan: Delegate; maintenancePlanCoveredAsset: Delegate };
  const { tenantId } = wo;

  await tx.asset.updateMany({
    where: { id: wo.assetId, tenantId, deletedAt: null },
    data: { installationDate: completedDate, updatedByUserId: userId },
  });

  // Tareas en espera del equipo nuevo: arrancan a contar desde el cierre. Las que
  // ya tienen una ejecución no son "en espera" sino dadas de baja a propósito.
  const pending = await tx.maintenancePlan.findMany({
    where: { tenantId, assetId: wo.assetId, status: "INACTIVE", deletedAt: null, lastExecutionDate: null },
    select: { id: true, triggerType: true, frequencyMonths: true, frequencyHours: true },
  });
  for (const plan of pending) {
    const next = recalculateNextDue(
      {
        triggerType: plan.triggerType as string,
        frequencyMonths: plan.frequencyMonths as number | null,
        frequencyHours: plan.frequencyHours as number | null,
      },
      completedDate,
      hoursAtClose ?? 0,
    );
    await tx.maintenancePlan.update({
      where: { id: plan.id },
      data: { status: "ACTIVE", nextDueDate: next.nextDueDate, nextDueHours: next.nextDueHours, executionStatus: "FUTURE", updatedByUserId: userId },
    });
  }

  let replacedAssetCode: string | null = null;
  let deactivatedPlans = 0;
  let movedCoverage = 0;
  if (info.replacesAssetId) {
    const old = await tx.asset.findFirst({
      where: { id: info.replacesAssetId, tenantId, deletedAt: null },
      select: { id: true, assetCode: true },
    });
    if (old) {
      replacedAssetCode = old.assetCode as string;
      await tx.asset.update({
        where: { id: old.id },
        data: { replacementDate: completedDate, deletedAt: new Date(), deletedByUserId: userId, updatedByUserId: userId },
      });
      const off = await tx.maintenancePlan.updateMany({
        where: { tenantId, assetId: old.id, deletedAt: null, status: { not: "INACTIVE" } },
        data: { status: "INACTIVE", updatedByUserId: userId },
      });
      deactivatedPlans = off.count;
      // Las rutinas de otros equipos que revisaban al viejo pasan a revisar al nuevo.
      const covered = await tx.maintenancePlanCoveredAsset.findMany({
        where: { tenantId, assetId: old.id },
        select: { id: true, maintenancePlanId: true },
      });
      for (const row of covered) {
        const already = await tx.maintenancePlanCoveredAsset.findFirst({
          where: { maintenancePlanId: row.maintenancePlanId, assetId: wo.assetId },
          select: { id: true },
        });
        if (already) await tx.maintenancePlanCoveredAsset.delete({ where: { id: row.id } });
        else await tx.maintenancePlanCoveredAsset.update({ where: { id: row.id }, data: { assetId: wo.assetId } });
        movedCoverage++;
      }
    }
  }

  return {
    newAssetId: wo.assetId,
    activatedPlans: pending.length,
    replacedAssetId: info.replacesAssetId,
    replacedAssetCode,
    deactivatedPlans,
    movedCoverage,
  };
}

export function publishAssetInstallationAudit(
  prisma: Prisma,
  wo: { id: string; tenantId: string; workOrderCode: string; vesselCode: string },
  applied: AssetInstallationApplied,
  actorUserId: string,
): void {
  void publishAudit(prisma, {
    tenantId: wo.tenantId,
    actorUserId,
    action: "Asset.installed",
    entityType: "Asset",
    entityId: applied.newAssetId,
    metadata: {
      workOrderCode: wo.workOrderCode, vesselCode: wo.vesselCode,
      activatedPlans: applied.activatedPlans,
      replacedAssetCode: applied.replacedAssetCode,
      deactivatedPlans: applied.deactivatedPlans,
      movedCoverage: applied.movedCoverage,
    },
  });
  if (applied.replacedAssetId) {
    void publishAudit(prisma, {
      tenantId: wo.tenantId,
      actorUserId,
      action: "Asset.deleted",
      entityType: "Asset",
      entityId: applied.replacedAssetId,
      metadata: { assetCode: applied.replacedAssetCode, vesselCode: wo.vesselCode, reason: `Reemplazado (OT ${wo.workOrderCode})` },
    });
  }
}
