import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { publishAudit } from "../../platform/audit/audit-publisher";
import { getPermitForRelatedWrite } from "./permits-service";

/**
 * Gas testing para entry permits. Cumple IMO Res. A.1050(27):
 *  - O2: 19.5% – 23%
 *  - LEL: < 1%
 *  - H2S: < 10 ppm
 *  - CO: < 50 ppm
 *
 * Computamos un verdict PASS/FAIL servidor-side a partir de las lecturas que vengan,
 * para evitar que el cliente lo manipule. Si un parámetro no se midió, se ignora.
 */

export interface GasTestWriteInput {
  testedAt?: string;
  testedByName?: string;
  location?: string | null;
  o2Pct?: number | null;
  lelPct?: number | null;
  h2sPpm?: number | null;
  coPpm?: number | null;
  notes?: string | null;
}

function canRecordGasTest(session: TenantAccessSession): boolean {
  const r = session.user.role;
  return r === "TENANT_ADMIN" || r === "FLEET_SUPERINTENDENT" || r === "MAINTENANCE_MANAGER" || r === "TECHNICIAN_OPERATOR";
}

function normalizeRequired(value: unknown, field: string): string {
  const text = String(value ?? "").trim();
  if (!text) throw new RouteError(400, "VALIDATION_ERROR", `${field} es requerido.`);
  return text;
}
function normalizeOptional(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}
function parseDate(value: unknown, field: string): Date {
  if (!value) throw new RouteError(400, "VALIDATION_ERROR", `${field} es requerido.`);
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) throw new RouteError(400, "VALIDATION_ERROR", `${field} no es una fecha válida.`);
  return d;
}
function parseOptionalNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function computeVerdict(readings: {
  o2Pct: number | null;
  lelPct: number | null;
  h2sPpm: number | null;
  coPpm: number | null;
}): "PASS" | "FAIL" {
  // Umbrales IMO Res. A.1050(27)
  if (readings.o2Pct !== null && (readings.o2Pct < 19.5 || readings.o2Pct > 23)) return "FAIL";
  if (readings.lelPct !== null && readings.lelPct >= 1) return "FAIL";
  if (readings.h2sPpm !== null && readings.h2sPpm >= 10) return "FAIL";
  if (readings.coPpm !== null && readings.coPpm >= 50) return "FAIL";
  // Si todas las lecturas presentes están en rango (o no hay lecturas), PASS.
  return "PASS";
}

type GasTestClient = {
  permitGasTest: {
    findMany(args: { where: Record<string, unknown>; orderBy?: unknown }): Promise<Record<string, unknown>[]>;
    findFirst(args: { where: Record<string, unknown> }): Promise<Record<string, unknown> | null>;
    create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>>;
    delete(args: { where: { id: string } }): Promise<Record<string, unknown>>;
  };
};
function gasTestClient(prisma: NonNullable<ReturnType<typeof getPrismaClient>>): GasTestClient {
  return prisma as unknown as GasTestClient;
}

export async function listGasTests(session: TenantAccessSession, permitId: string) {
  const permit = await getPermitForRelatedWrite(session, permitId);
  const prisma = getPrismaClient();
  if (!prisma) return [];
  return gasTestClient(prisma).permitGasTest.findMany({
    where: { permitId: permit.id, tenantId: permit.tenantId },
    orderBy: { testedAt: "desc" },
  });
}

export async function createGasTest(session: TenantAccessSession, permitId: string, input: GasTestWriteInput) {
  if (!canRecordGasTest(session)) {
    throw new RouteError(403, "FORBIDDEN", "No autorizado para registrar gas tests.");
  }

  const permit = await getPermitForRelatedWrite(session, permitId);
  // Permitir registrar gas tests sólo en estados activos del workflow (DRAFT/REQUESTED/APPROVED/ACTIVE).
  // En estados terminales (CLOSED/CANCELLED/REJECTED) no tiene sentido.
  if (["CLOSED", "CANCELLED", "REJECTED"].includes(permit.status)) {
    throw new RouteError(409, "RECORD_LOCKED", `No se pueden agregar gas tests a un permiso ${permit.status}.`);
  }

  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const testedAt = parseDate(input.testedAt ?? new Date().toISOString(), "testedAt");
  const testedByName = normalizeRequired(input.testedByName, "testedByName");
  const readings = {
    o2Pct: parseOptionalNumber(input.o2Pct),
    lelPct: parseOptionalNumber(input.lelPct),
    h2sPpm: parseOptionalNumber(input.h2sPpm),
    coPpm: parseOptionalNumber(input.coPpm),
  };
  const verdict = computeVerdict(readings);

  const created = await gasTestClient(prisma).permitGasTest.create({
    data: {
      tenantId: permit.tenantId,
      permitId: permit.id,
      testedAt,
      testedByName,
      location: normalizeOptional(input.location),
      o2Pct: readings.o2Pct,
      lelPct: readings.lelPct,
      h2sPpm: readings.h2sPpm,
      coPpm: readings.coPpm,
      verdict,
      notes: normalizeOptional(input.notes),
      createdByUserId: session.user.id,
    },
  });

  void publishAudit(prisma, {
    tenantId: permit.tenantId,
    actorUserId: session.user.id,
    action: "Permit.gasTestRecorded",
    entityType: "Permit",
    entityId: permit.id,
    metadata: { permitCode: permit.permitCode, vesselCode: permit.vesselCode, verdict, testedByName },
  });

  return created;
}

export async function deleteGasTest(session: TenantAccessSession, permitId: string, gasTestId: string) {
  if (!canRecordGasTest(session)) {
    throw new RouteError(403, "FORBIDDEN", "No autorizado.");
  }
  const permit = await getPermitForRelatedWrite(session, permitId);
  if (["CLOSED", "CANCELLED", "REJECTED"].includes(permit.status)) {
    throw new RouteError(409, "RECORD_LOCKED", `No se puede borrar un gas test de un permiso ${permit.status}.`);
  }

  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");

  const existing = await gasTestClient(prisma).permitGasTest.findFirst({
    where: { id: gasTestId, permitId: permit.id, tenantId: permit.tenantId },
  });
  if (!existing) throw new RouteError(404, "NOT_FOUND", "Gas test no encontrado.");

  await gasTestClient(prisma).permitGasTest.delete({ where: { id: gasTestId } });

  void publishAudit(prisma, {
    tenantId: permit.tenantId,
    actorUserId: session.user.id,
    action: "Permit.gasTestDeleted",
    entityType: "Permit",
    entityId: permit.id,
    metadata: { permitCode: permit.permitCode, vesselCode: permit.vesselCode, gasTestId },
  });
}
