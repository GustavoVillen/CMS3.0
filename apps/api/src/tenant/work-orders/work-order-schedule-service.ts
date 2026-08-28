// PROGRAMACION DE TRABAJO de una OT (recuadro del formulario REGI-OPE-26.3):
// una fila por jornada — fecha, técnico, lugar, empresa y horario.
//
// Antes el PDF derivaba estas filas de los WorkLog, que sólo nacen del cierre
// de un plan y del parte diario: en una OT tramitada la tabla salía siempre
// vacía porque no había dónde cargarla. Ahora se carga en la OT.

import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { assertNotLocked } from "../../common/record-lock";
import { requireWorkOrderScope } from "./work-orders-service";

export interface WorkOrderScheduleInput {
  workDate?: string | Date | null;
  technician?: string | null;
  place?: string | null;
  company?: string | null;
  timeFrom?: string | null;
  timeTo?: string | null;
  sortOrder?: number;
}

function ensureCanManage(session: TenantAccessSession) {
  if (session.user.role === "AUDITOR_READONLY") {
    throw new RouteError(403, "FORBIDDEN", "No autorizado para editar la programación de trabajo.");
  }
}

function optionalText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

/** "HH:MM" o null. Se valida acá para que el papel no salga con basura. */
function optionalTime(value: unknown, field: string): string | null {
  const text = optionalText(value);
  if (!text) return null;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) {
    throw new RouteError(400, "VALIDATION_ERROR", `Horario inválido en ${field}. Se espera HH:MM (ej. 08:30).`);
  }
  return text;
}

function optionalDate(value: unknown, field: string): Date | null {
  if (value === undefined || value === null || value === "") return null;
  const d = new Date(value as string);
  if (Number.isNaN(d.getTime())) throw new RouteError(400, "VALIDATION_ERROR", `Fecha inválida en ${field}.`);
  return d;
}

function buildData(payload: WorkOrderScheduleInput) {
  const data: Record<string, unknown> = {};
  if (payload.workDate !== undefined)   data.workDate   = optionalDate(payload.workDate, "workDate");
  if (payload.technician !== undefined) data.technician = optionalText(payload.technician);
  if (payload.place !== undefined)      data.place      = optionalText(payload.place);
  if (payload.company !== undefined)    data.company    = optionalText(payload.company);
  if (payload.timeFrom !== undefined)   data.timeFrom   = optionalTime(payload.timeFrom, "timeFrom");
  if (payload.timeTo !== undefined)     data.timeTo     = optionalTime(payload.timeTo, "timeTo");
  if (payload.sortOrder !== undefined && Number.isFinite(payload.sortOrder)) data.sortOrder = Number(payload.sortOrder);
  return data;
}

export async function listWorkOrderSchedule(session: TenantAccessSession, workOrderId: string) {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const wo = await requireWorkOrderScope(session, workOrderId);
  return (prisma as any).workOrderScheduleEntry.findMany({
    where: { workOrderId: wo.id },
    orderBy: [{ sortOrder: "asc" }, { workDate: "asc" }, { createdAt: "asc" }],
  });
}

export async function createWorkOrderScheduleEntry(
  session: TenantAccessSession,
  workOrderId: string,
  payload: WorkOrderScheduleInput,
) {
  ensureCanManage(session);
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const wo = await requireWorkOrderScope(session, workOrderId);
  assertNotLocked("WORK_ORDER", wo.status);

  const count = await (prisma as any).workOrderScheduleEntry.count({ where: { workOrderId: wo.id } });
  return (prisma as any).workOrderScheduleEntry.create({
    data: {
      tenantId: wo.tenantId,
      workOrderId: wo.id,
      sortOrder: count,
      ...buildData(payload),
      createdByUserId: session.user.id,
      updatedByUserId: session.user.id,
    },
  });
}

export async function updateWorkOrderScheduleEntry(
  session: TenantAccessSession,
  workOrderId: string,
  entryId: string,
  payload: WorkOrderScheduleInput,
) {
  ensureCanManage(session);
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const wo = await requireWorkOrderScope(session, workOrderId);
  assertNotLocked("WORK_ORDER", wo.status);

  const existing = await (prisma as any).workOrderScheduleEntry.findFirst({
    where: { id: entryId, workOrderId: wo.id },
    select: { id: true },
  });
  if (!existing) throw new RouteError(404, "NOT_FOUND", "Fila de programación no encontrada.");

  return (prisma as any).workOrderScheduleEntry.update({
    where: { id: entryId },
    data: { ...buildData(payload), updatedByUserId: session.user.id },
  });
}

export async function deleteWorkOrderScheduleEntry(
  session: TenantAccessSession,
  workOrderId: string,
  entryId: string,
) {
  ensureCanManage(session);
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const wo = await requireWorkOrderScope(session, workOrderId);
  assertNotLocked("WORK_ORDER", wo.status);

  const existing = await (prisma as any).workOrderScheduleEntry.findFirst({
    where: { id: entryId, workOrderId: wo.id },
    select: { id: true },
  });
  if (!existing) throw new RouteError(404, "NOT_FOUND", "Fila de programación no encontrada.");

  await (prisma as any).workOrderScheduleEntry.delete({ where: { id: entryId } });
  return { ok: true };
}
