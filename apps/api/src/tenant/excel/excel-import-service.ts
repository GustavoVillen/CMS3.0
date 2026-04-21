import { getPrismaClient } from "../../platform/data/prisma-client";
import type { TenantAccessSession } from "../auth/session-store";
import { parseExcelBuffer, getMatchingKey } from "./excel-parser";
import type { ExcelModule } from "./excel-permissions";

export interface PreviewRow {
  rowNumber: number;
  matchingKey: string;
  status: "CREATE" | "UPDATE" | "ERROR" | "CONFLICT_SOFT_DELETED";
  data: Record<string, unknown>;
  errorMessage?: string;
  existingId?: string;
}

export interface ConfirmRow {
  rowNumber: number;
  matchingKey: string;
  action: "CREATE" | "UPDATE" | "RESTORE_AND_UPDATE" | "SKIP";
  data: Record<string, unknown>;
  existingId?: string;
}

export interface ImportResult {
  importJobId: string;
  tenantSlug: string;
  module: string;
  actorUserId: string;
  created: number;
  updated: number;
  rejected: number;
  rowErrors: Array<{ rowNumber: number; error: string }>;
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

export async function previewImport(
  session: TenantAccessSession,
  module: ExcelModule,
  buffer: Buffer
): Promise<{ rows: PreviewRow[]; parseErrors: string[]; fixes: string[] }> {
  const parsed = await parseExcelBuffer(buffer, module);
  if (!parsed.ok || parsed.rows.length === 0) {
    return { rows: [], parseErrors: parsed.errors, fixes: parsed.fixes ?? [] };
  }

  const prisma = getPrismaClient();
  if (!prisma) {
    return { rows: [], parseErrors: ["Base de datos no disponible."], fixes: [] };
  }

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) {
    return { rows: [], parseErrors: ["Tenant no encontrado."], fixes: [] };
  }

  const keyField = getMatchingKey(module);
  const previewRows: PreviewRow[] = [];

  for (const parsed_row of parsed.rows) {
    const keyValue = parsed_row.data[keyField];
    if (!keyValue) {
      previewRows.push({
        rowNumber: parsed_row.rowNumber,
        matchingKey: String(keyValue ?? ""),
        status: "ERROR",
        data: parsed_row.data,
        errorMessage: `Campo "${keyField}" vacío.`,
      });
      continue;
    }

    try {
      const existing = await findExistingRecord(prisma, module, tenant.id, keyField, String(keyValue));

      if (!existing) {
        previewRows.push({ rowNumber: parsed_row.rowNumber, matchingKey: String(keyValue), status: "CREATE", data: parsed_row.data });
      } else if (existing.deletedAt) {
        previewRows.push({ rowNumber: parsed_row.rowNumber, matchingKey: String(keyValue), status: "CONFLICT_SOFT_DELETED", data: parsed_row.data, existingId: existing.id });
      } else {
        previewRows.push({ rowNumber: parsed_row.rowNumber, matchingKey: String(keyValue), status: "UPDATE", data: parsed_row.data, existingId: existing.id });
      }
    } catch {
      previewRows.push({ rowNumber: parsed_row.rowNumber, matchingKey: String(keyValue), status: "ERROR", data: parsed_row.data, errorMessage: "Error al consultar la base de datos." });
    }
  }

  return { rows: previewRows, parseErrors: parsed.errors, fixes: parsed.fixes ?? [] };
}

// ---------------------------------------------------------------------------
// Confirm
// ---------------------------------------------------------------------------

export async function confirmImport(
  session: TenantAccessSession,
  module: ExcelModule,
  rows: ConfirmRow[]
): Promise<ImportResult> {
  const importJobId = `import_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  let created = 0;
  let updated = 0;
  let rejected = 0;
  const rowErrors: Array<{ rowNumber: number; error: string }> = [];

  const prisma = getPrismaClient();
  if (!prisma) {
    return { importJobId, tenantSlug: session.tenantSlug, module, actorUserId: session.user.id, created, updated, rejected: rows.length, rowErrors: [{ rowNumber: 0, error: "Base de datos no disponible." }] };
  }

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) {
    return { importJobId, tenantSlug: session.tenantSlug, module, actorUserId: session.user.id, created, updated, rejected: rows.length, rowErrors: [{ rowNumber: 0, error: "Tenant no encontrado." }] };
  }

  const now = new Date();

  for (const row of rows) {
    if (row.action === "SKIP") {
      rejected++;
      continue;
    }

    try {
      const rawData = buildModelData(module, row.data, tenant.id);
      // Strip server-managed fields — never trust values from the file
      const { id: _id, createdAt: _ca, updatedAt: _ua, ...baseData } = rawData;

      if (row.action === "CREATE") {
        await createRecord(prisma, module, {
          ...baseData,
          createdAt: now,
          createdByUserId: session.user.id,
          updatedAt: now,
          updatedByUserId: session.user.id,
        });
        created++;
      } else if (row.action === "UPDATE" && row.existingId) {
        await updateRecord(prisma, module, row.existingId, {
          ...baseData,
          updatedAt: now,
          updatedByUserId: session.user.id,
        });
        updated++;
      } else if (row.action === "RESTORE_AND_UPDATE" && row.existingId) {
        await updateRecord(prisma, module, row.existingId, {
          ...baseData,
          deletedAt: null,
          deletedByUserId: null,
          updatedAt: now,
          updatedByUserId: session.user.id,
        });
        updated++;
      } else {
        rejected++;
      }
    } catch (err: unknown) {
      rowErrors.push({ rowNumber: row.rowNumber, error: err instanceof Error ? err.message : "Error desconocido." });
      rejected++;
    }
  }

  return { importJobId, tenantSlug: session.tenantSlug, module, actorUserId: session.user.id, created, updated, rejected, rowErrors };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function findExistingRecord(
  prisma: NonNullable<ReturnType<typeof getPrismaClient>>,
  module: ExcelModule,
  tenantId: string,
  keyField: string,
  keyValue: string
): Promise<{ id: string; deletedAt: Date | null } | null> {
  const where = { tenantId, [keyField]: keyValue };
  switch (module) {
    case "vessels":           return prisma.vessel.findFirst({ where, select: { id: true, deletedAt: true } });
    case "assets":            return prisma.asset.findFirst({ where, select: { id: true, deletedAt: true } });
    case "maintenance_plans": return prisma.maintenancePlan.findFirst({ where, select: { id: true, deletedAt: true } });
    case "spares":            return prisma.spare.findFirst({ where, select: { id: true, deletedAt: true } });
    case "providers":         return prisma.provider.findFirst({ where, select: { id: true, deletedAt: true } });
    case "certificates":      return prisma.certificate.findFirst({ where, select: { id: true, deletedAt: true } });
  }
}

const VESSEL_DETAIL_COLUMNS: Record<string, string> = {
  owner: "owner",
  vesselType: "vesselType",
  imo: "imo",
  registration: "registration",
  powerHp: "powerHp",
  dwtTons: "dwtTons",
  lengthM: "lengthM",
  beamM: "beamM",
  depthM: "depthM",
  trnTn: "trnTn",
  trbTn: "trbTn",
  buildYear: "buildYear",
  buildCountry: "buildCountry",
  incorporationDate: "incorporationDate",
  incorporationType: "incorporationType",
};

function pickRecord(source: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (key in source) out[key] = source[key];
  }
  return out;
}

function getVesselDetails(source: Record<string, unknown>): Record<string, unknown> {
  return pickRecord(source, Object.keys(VESSEL_DETAIL_COLUMNS));
}

async function updateVesselDetailsRaw(
  prisma: NonNullable<ReturnType<typeof getPrismaClient>>,
  id: string,
  details: Record<string, unknown>,
): Promise<void> {
  const entries = Object.entries(details).filter(([key]) => key in VESSEL_DETAIL_COLUMNS);
  if (!entries.length) return;

  const sets: string[] = [];
  const values: unknown[] = [id];
  let idx = 2;
  for (const [key, value] of entries) {
    sets.push(`"${VESSEL_DETAIL_COLUMNS[key]}" = $${idx}`);
    values.push(value);
    idx += 1;
  }

  const sql = `UPDATE "public"."Vessel" SET ${sets.join(", ")} WHERE "id" = $1`;
  await prisma.$executeRawUnsafe(sql, ...values);
}

function buildModelData(module: ExcelModule, rowData: Record<string, unknown>, tenantId: string): Record<string, unknown> {
  const d = rowData;

  const parseNumeric = (value: unknown): number | null => {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    const text = String(value).trim();
    if (!text || text.toUpperCase() === "N.A.") return null;
    const parsed = Number(text.replace(/\./g, "").replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  };

  switch (module) {
    case "vessels":
      return {
        tenantId,
        code: d.code,
        name: d.name ?? d.code ?? "",
        owner: d.owner ?? null,
        vesselType: d.vesselType ?? null,
        imo: d.imo ?? null,
        registration: d.registration ?? null,
        powerHp: parseNumeric(d.powerHp),
        dwtTons: parseNumeric(d.dwtTons),
        lengthM: parseNumeric(d.lengthM),
        beamM: parseNumeric(d.beamM),
        depthM: parseNumeric(d.depthM),
        trnTn: parseNumeric(d.trnTn),
        trbTn: parseNumeric(d.trbTn),
        buildYear: parseNumeric(d.buildYear),
        buildCountry: d.buildCountry ?? null,
        incorporationDate: d.incorporationDate ? new Date(String(d.incorporationDate)) : null,
        incorporationType: d.incorporationType ?? null,
        status: d.status ?? "ACTIVE",
      };
    case "assets":
      return {
        tenantId,
        vesselCode:       d.vesselCode,
        sfiCode:          d.sfiCode != null ? String(d.sfiCode) : null,
        assetCode:        d.assetCode,
        name:             d.name ?? null,
        criticality:      d.criticality ?? "B",
        status:           d.status ?? "OPERATIONAL",
        manufacturer:     d.manufacturer ?? null,
        model:            d.model ?? null,
        serialNumber:     d.serialNumber ?? null,
        installationDate: d.installationDate ? new Date(String(d.installationDate)) : null,
        lastOverhaulDate: d.lastOverhaulDate ? new Date(String(d.lastOverhaulDate)) : null,
        replacementDate:  d.replacementDate  ? new Date(String(d.replacementDate))  : null,
      };
    case "maintenance_plans":
      return {
        tenantId,
        vesselCode:  d.vesselCode,
        taskCode:    d.taskCode,
        title:       d.title ?? null,
        triggerType: d.triggerType ?? "MONTHS",
        frequency:   d.frequency ? Number(d.frequency) : null,
        status:      d.status ?? "ACTIVE",
      };
    case "spares":
      return {
        tenantId,
        vesselCode:   d.vesselCode,
        sku:          d.sku,
        name:         d.name ?? null,
        category:     d.category ?? null,
        criticality:  d.criticality ?? "B",
        manufacturer: d.manufacturer ?? null,
        model:        d.model ?? null,
        unit:         d.unit ?? "unit",
        currentStock: 0,
        minStock:     d.minStock ? Number(d.minStock) : 0,
        reorderPoint: d.reorderPoint ? Number(d.reorderPoint) : 0,
        status:       d.status ?? "ACTIVE",
        location:     d.location ?? null,
      };
    case "providers":
      return {
        tenantId,
        vesselCode:   d.vesselCode,
        providerCode: d.providerCode,
        name:         d.name ?? null,
        category:     d.category ?? null,
        status:       d.status ?? "ACTIVE",
        contactName:  d.contactName ?? null,
        contactEmail: d.contactEmail ?? null,
        contactPhone: d.contactPhone ?? null,
        location:     d.location ?? null,
      };
    case "certificates":
      return {
        tenantId,
        vesselCode:        d.vesselCode,
        certificateCode:   d.certificateCode,
        name:              d.name ?? null,
        issuingAuthority:  d.issuingAuthority ?? null,
        status:            d.status ?? "ACTIVE",
        issueDate:         d.issueDate  ? new Date(String(d.issueDate))  : null,
        expiryDate:        d.expiryDate ? new Date(String(d.expiryDate)) : null,
      };
  }
}

async function createRecord(
  prisma: NonNullable<ReturnType<typeof getPrismaClient>>,
  module: ExcelModule,
  data: Record<string, unknown>
): Promise<void> {
  switch (module) {
    case "vessels": {
      const createData = pickRecord(data, [
        "tenantId",
        "code",
        "name",
        "status",
        "createdAt",
        "createdByUserId",
        "updatedAt",
        "updatedByUserId",
        "deletedAt",
        "deletedByUserId",
      ]);
      const created = await prisma.vessel.create({ data: createData as any });
      await updateVesselDetailsRaw(prisma, created.id, getVesselDetails(data));
      break;
    }
    case "assets":            await prisma.asset.create({ data: data as any }); break;
    case "maintenance_plans": await prisma.maintenancePlan.create({ data: data as any }); break;
    case "spares":            await prisma.spare.create({ data: data as any }); break;
    case "providers":         await prisma.provider.create({ data: data as any }); break;
    case "certificates":      await prisma.certificate.create({ data: data as any }); break;
  }
}

async function updateRecord(
  prisma: NonNullable<ReturnType<typeof getPrismaClient>>,
  module: ExcelModule,
  id: string,
  data: Record<string, unknown>
): Promise<void> {
  switch (module) {
    case "vessels": {
      const updateData = pickRecord(data, [
        "code",
        "name",
        "status",
        "updatedAt",
        "updatedByUserId",
        "deletedAt",
        "deletedByUserId",
      ]);
      await prisma.vessel.update({ where: { id }, data: updateData as any });
      await updateVesselDetailsRaw(prisma, id, getVesselDetails(data));
      break;
    }
    case "assets":            await prisma.asset.update({ where: { id }, data: data as any }); break;
    case "maintenance_plans": await prisma.maintenancePlan.update({ where: { id }, data: data as any }); break;
    case "spares":            await prisma.spare.update({ where: { id }, data: data as any }); break;
    case "providers":         await prisma.provider.update({ where: { id }, data: data as any }); break;
    case "certificates":      await prisma.certificate.update({ where: { id }, data: data as any }); break;
  }
}
