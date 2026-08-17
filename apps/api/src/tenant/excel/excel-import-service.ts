import { getPrismaClient } from "../../platform/data/prisma-client";
import type { TenantAccessSession } from "../auth/session-store";
import { parseExcelBuffer, getMatchingKey } from "./excel-parser";
import type { ExcelModule } from "./excel-permissions";
import { getOnHandQty } from "../pms/stock-calc-service";

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
  const keyField = getMatchingKey(module);

  for (const row of rows) {
    if (row.action === "SKIP") {
      rejected++;
      continue;
    }

    try {
      // El `existingId` viaja al navegador en la previsualización y vuelve en el
      // confirm: es un dato del cliente, no del servidor. Si se usara tal cual,
      // un usuario con permiso de importar en su empresa podría mandar el id de
      // un registro de OTRA empresa y sobrescribirlo. Se vuelve a resolver acá
      // contra la base, filtrando por tenant — mismo criterio que ya se aplica
      // al assetId de los planes unas líneas más abajo.
      if (row.action === "UPDATE" || row.action === "RESTORE_AND_UPDATE") {
        const keyValue = row.data[keyField];
        const owned = keyValue
          ? await findExistingRecord(prisma, module, tenant.id, keyField, String(keyValue))
          : null;
        if (!owned) {
          rejected++;
          rowErrors.push({ rowNumber: row.rowNumber, error: `No se encontró un registro propio con ${keyField} "${String(keyValue ?? "")}".` });
          continue;
        }
        row.existingId = owned.id;
      }

      if (module === "maintenance_plans") {
        // Strip any assetId that came from the Excel (it may be stale — exported
        // files carry assetId as a dynamic column but the source of truth is
        // always assetCode → DB lookup).
        delete row.data.assetId;
        if (row.data.assetCode) {
          const asset = await prisma.asset.findFirst({
            where: { tenantId: tenant.id, vesselCode: String(row.data.vesselCode ?? ""), assetCode: String(row.data.assetCode) },
            select: { id: true },
          });
          if (asset) row.data.assetId = asset.id;
        }
        // CREATE requires assetId to be present (NOT NULL in schema).
        // UPDATE without a resolved assetId omits the field so the existing
        // correctly-linked assetId is preserved.
        if (row.action === "CREATE" && !("assetId" in row.data)) {
          row.data.assetId = "";
        }
      }

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
    case "work_orders":       return null;
    // Módulos export-only: no se importa, no se busca registro existente.
    case "crew":
    case "crew_certifications":
    case "crew_rest_hours":
    case "drills":
    case "permits":
    case "external_audits":
    case "near_miss":
    case "moc":
    case "spare_requests":
    case "fluid_samples":
    case "capa":
    case "deferrals":
    case "defects":
    case "daily_reports":
    case "monthly_reports":
    case "asset_hours":
      return null;
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
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    if (key in VESSEL_DETAIL_COLUMNS) data[VESSEL_DETAIL_COLUMNS[key]] = value;
  }
  if (Object.keys(data).length === 0) return;

  await prisma.vessel.update({ where: { id }, data: data as any });
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
    case "assets": {
      const trackRaw = d.trackDailyReport;
      const trackBool =
        trackRaw === "true" || trackRaw === true || trackRaw === 1 || trackRaw === "1";
      return {
        tenantId,
        vesselCode:       d.vesselCode,
        sfiCode:          d.sfiCode != null ? String(d.sfiCode) : null,
        assetCode:        d.assetCode,
        // schema: name String (NOT NULL) — fallback al assetCode si vino vacío
        name:             d.name != null && String(d.name).trim() !== "" ? d.name : d.assetCode,
        criticality:      d.criticality ?? "B",
        status:           d.status ?? "OPERATIONAL",
        manufacturer:     d.manufacturer ?? null,
        model:            d.model ?? null,
        serialNumber:     d.serialNumber ?? null,
        installationDate: d.installationDate ? new Date(String(d.installationDate)) : null,
        lastOverhaulDate: d.lastOverhaulDate ? new Date(String(d.lastOverhaulDate)) : null,
        replacementDate:  d.replacementDate  ? new Date(String(d.replacementDate))  : null,
        trackDailyReport: trackBool,
      };
    }
    case "maintenance_plans": {
      const r: Record<string, unknown> = {
        tenantId,
        vesselCode:        d.vesselCode,
        taskCode:          d.taskCode,
        title:             d.title             ?? "",
        taskType:          d.taskType          ?? "MAINTENANCE",
        triggerType:       d.triggerType       ?? "MONTHS",
        triggerResultMode: d.triggerResultMode ?? "DUE_ONLY",
        windowMode:        d.windowMode        ?? "AUTO",
        status:            d.status            ?? "ACTIVE",
      };
      // assetId: only include when resolved; UPDATE preserves existing value when absent
      if ("assetId" in d) r.assetId = (d.assetId as string) ?? "";
      if ("sfiGroupNumber"    in d) r.sfiGroupNumber    = d.sfiGroupNumber ? Number(d.sfiGroupNumber) : null;
      if ("description"       in d) r.description       = d.description       ?? null;
      if ("responsible"       in d) r.responsible       = d.responsible       ?? null;
      if ("acceptanceCriteria" in d) r.acceptanceCriteria = d.acceptanceCriteria ?? null;
      if ("loto"             in d) r.loto             = d.loto             ?? null;
      if ("riskLevel"         in d) r.riskLevel         = d.riskLevel         ?? null;
      if ("riskAnalysisResult" in d) r.riskAnalysisResult = d.riskAnalysisResult ?? null;
      if ("consequenceCategory" in d) r.consequenceCategory = d.consequenceCategory ?? null;
      if ("consequenceRationale" in d) r.consequenceRationale = d.consequenceRationale ?? null;
      if ("frequencyMonths"   in d) r.frequencyMonths   = d.frequencyMonths   ? Number(d.frequencyMonths) : null;
      if ("frequencyHours"    in d) r.frequencyHours    = parseNumeric(d.frequencyHours);
      if ("estimatedHours"    in d) r.estimatedHours    = parseNumeric(d.estimatedHours);
      if ("windowLeadDays"    in d) r.windowLeadDays    = d.windowLeadDays    ? Number(d.windowLeadDays) : null;
      if ("windowLeadHours"   in d) r.windowLeadHours   = parseNumeric(d.windowLeadHours);
      if ("lastExecutionDate" in d) r.lastExecutionDate = d.lastExecutionDate ? new Date(String(d.lastExecutionDate)) : null;
      if ("nextDueDate"       in d) r.nextDueDate       = d.nextDueDate       ? new Date(String(d.nextDueDate)) : null;
      if ("lastExecutionHours" in d) r.lastExecutionHours = parseNumeric(d.lastExecutionHours);
      if ("nextDueHours"      in d) r.nextDueHours      = parseNumeric(d.nextDueHours);
      if ("checklistTemplate"  in d) r.checklistTemplate  = d.checklistTemplate  ?? null;
      if ("samplingKind"      in d) r.samplingKind       = d.samplingKind      ?? null;
      if ("samplingFluidType" in d) r.samplingFluidType = d.samplingFluidType ?? null;
      return r;
    }
    case "spares":
      return {
        tenantId,
        vesselCode:             d.vesselCode,
        sku:                    d.sku,
        name:                   d.name ?? null,
        category:               d.category ?? null,
        criticality:            d.criticality ?? "B",
        manufacturer:           d.manufacturer ?? null,
        model:                  d.model ?? null,
        internalPartNumber:     d.internalPartNumber ?? null,
        manufacturerPartNumber: d.manufacturerPartNumber ?? null,
        unit:                   d.unit ?? "unit",
        currentStock:           d.currentStock ? Number(d.currentStock) : 0,
        minStock:               d.minStock     ? Number(d.minStock)     : 0,
        reorderPoint:           d.reorderPoint ? Number(d.reorderPoint) : 0,
        targetStock:            d.targetStock  ? Number(d.targetStock)  : null,
        status:                 d.status ?? "ACTIVE",
        location:               d.location ?? null,
        sfiCode:                d.sfiCode ?? null,
        leadTimeDays:           d.leadTimeDays ? parseInt(String(d.leadTimeDays), 10) : null,
        longDescription:        d.longDescription ?? null,
      };
    case "providers":
      return {
        tenantId,
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
        vesselCode:           d.vesselCode,
        certificateCode:      d.certificateCode,
        name:                 d.name ?? null,
        issuingAuthority:     d.issuingAuthority ?? null,
        status:               d.status ?? "ACTIVE",
        issueDate:            d.issueDate            ? new Date(String(d.issueDate))            : null,
        expiryDate:           d.expiryDate           ? new Date(String(d.expiryDate))           : null,
        lastInspectionDate:   d.lastInspectionDate   ? new Date(String(d.lastInspectionDate))   : null,
        notes:                d.notes ?? null,
        assetId:              d.assetId ? String(d.assetId) : null,
      };
    case "work_orders":
      return { tenantId };
    // Módulos export-only: no se construye payload de creación.
    case "crew":
    case "crew_certifications":
    case "crew_rest_hours":
    case "drills":
    case "permits":
    case "external_audits":
    case "near_miss":
    case "moc":
    case "spare_requests":
    case "fluid_samples":
    case "capa":
    case "deferrals":
    case "defects":
    case "daily_reports":
    case "monthly_reports":
    case "asset_hours":
      return { tenantId };
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
    case "spares": {
      const createdSpare = await prisma.spare.create({ data: data as any });
      // Si la planilla trae stock inicial, generar StockMovement RECEIPT para que aparezca en la UI
      // (la UI calcula onHand sumando movements, no usa Spare.currentStock directo).
      const initialStock = Number((data as any).currentStock ?? 0);
      if (initialStock > 0) {
        await prisma.stockMovement.create({
          data: {
            tenantId:        createdSpare.tenantId,
            vesselCode:      createdSpare.vesselCode,
            spareId:         createdSpare.id,
            locationId:      null,
            movementCode:    `MOV-${createdSpare.vesselCode}-${Date.now()}-${createdSpare.id.slice(-6)}`,
            movementType:    "RECEIPT",
            quantity:        initialStock,
            unit:            createdSpare.unit ?? "unit",
            occurredAt:      new Date(),
            referenceType:   "ADJUSTMENT",
            notes:           "Stock inicial importado desde planilla",
            createdByUserId: (data as any).createdByUserId as string,
          },
        });
      }
      break;
    }
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
    case "spares": {
      const updatedSpare = await prisma.spare.update({ where: { id }, data: data as any });
      // Reconciliar el ledger con el stock de la planilla: la app calcula onHand
      // sumando StockMovement (ignora Spare.currentStock). Si la planilla trae un
      // stock (>0) distinto al onHand actual, generamos un ADJUSTMENT por la
      // diferencia para que la app refleje la planilla. Gateado en >0 igual que el
      // alta: una columna ausente llega como 0 y NO debe vaciar stock existente.
      const sheetStock = Number((data as any).currentStock ?? 0);
      if (Number.isFinite(sheetStock) && sheetStock > 0) {
        const onHand = await getOnHandQty(prisma as any, id);
        const delta = sheetStock - onHand;
        if (delta !== 0) {
          await prisma.stockMovement.create({
            data: {
              tenantId:        updatedSpare.tenantId,
              vesselCode:      updatedSpare.vesselCode,
              spareId:         updatedSpare.id,
              locationId:      null,
              movementCode:    `MOV-${updatedSpare.vesselCode}-${Date.now()}-${updatedSpare.id.slice(-6)}`,
              movementType:    "ADJUSTMENT",
              quantity:        delta, // signo conservado: + suma, - resta
              unit:            updatedSpare.unit ?? "unit",
              occurredAt:      new Date(),
              referenceType:   "ADJUSTMENT",
              notes:           "Reconciliación de stock por importación de planilla",
              createdByUserId: ((data as any).updatedByUserId as string) ?? updatedSpare.updatedByUserId,
            },
          });
        }
      }
      break;
    }
    case "providers":         await prisma.provider.update({ where: { id }, data: data as any }); break;
    case "certificates":      await prisma.certificate.update({ where: { id }, data: data as any }); break;
  }
}
