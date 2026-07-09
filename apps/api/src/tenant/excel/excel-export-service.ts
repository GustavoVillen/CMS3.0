import ExcelJS from "exceljs";
import { getPrismaClient } from "../../platform/data/prisma-client";
import type { TenantAccessSession } from "../auth/session-store";
import type { ExcelModule } from "./excel-permissions";
import { getModuleColumns } from "./excel-template";
import { getOnHandMap } from "../pms/stock-calc-service";

const DYNAMIC_COLUMN_PRIORITIES: Record<ExcelModule, string[]> = {
  vessels: [
    "createdByUserId",
    "updatedByUserId",
    "deletedAt",
    "deletedByUserId",
  ],
  assets: [
    "equipmentClassId",
    "parentAssetId",
    "createdByUserId",
    "updatedByUserId",
    "deletedAt",
    "deletedByUserId",
  ],
  work_orders: [
    "holdReason",
    "cancelReason",
    "closeNotes",
    "independentVerifier",
    "testResult",
    "assignedToUserId",
    "maintenancePlanId",
    "assetId",
    "createdByUserId",
    "updatedByUserId",
    "deletedAt",
    "deletedByUserId",
  ],
  maintenance_plans: [
    "sfiGroupNumber",
    "responsible",
    "acceptanceCriteria",
    "loto",
    "riskLevel",
    "riskAnalysisResult",
    "frequencyHours",
    "frequencyMonths",
    "triggerResultMode",
    "samplingKind",
    "samplingFluidType",
    "taskMasterId",
    "executionStatus",
    "lastExecutionDate",
    "nextDueDate",
    "lastExecutionHours",
    "nextDueHours",
    "windowMode",
    "windowLeadDays",
    "windowLeadHours",
    "windowLeadPercent",
    "windowOpenDate",
    "windowOpenHours",
    "createdByUserId",
    "updatedByUserId",
    "deletedAt",
    "deletedByUserId",
  ],
  spares: [
    "createdByUserId",
    "updatedByUserId",
    "deletedAt",
    "deletedByUserId",
  ],
  providers: [
    "createdByUserId",
    "updatedByUserId",
    "deletedAt",
    "deletedByUserId",
  ],
  certificates: [
    "lastInspectionDate",
    "notes",
    "assetId",
    "originalSourceLink",
    "originalSourceName",
    "originalSourceMimeOrExt",
    "createdByUserId",
    "updatedByUserId",
    "deletedAt",
    "deletedByUserId",
  ],
  // ── Módulos export-only ──────────────────────────────────────────────────
  // Estos arrays definen el orden EN QUE APARECEN las columnas extras
  // (campos retornados por DB que no están en el template). Si una columna
  // no figura, se ordena alfabéticamente al final.
  crew: [
    "rank", "nationality", "dateOfBirth", "passportNumber",
    "signOnDate", "signOffDate", "status", "notes",
    "createdByUserId", "updatedByUserId", "deletedAt", "deletedByUserId",
  ],
  crew_certifications: [
    "type", "certificateNumber", "issuingAuthority", "issuedDate", "expiryDate",
    "status", "docUrl", "notes",
    "crewId", "createdByUserId", "updatedByUserId", "deletedAt", "deletedByUserId",
  ],
  crew_rest_hours: [
    "recordDate", "totalRestHours", "hasViolation", "violationsJson", "notes",
    "crewId", "createdByUserId", "updatedByUserId",
  ],
  drills: [
    "type", "status", "scheduledDate", "completedDate",
    "scenario", "observations", "lessonsLearned",
    "participantCrewIds", "pdfUrl",
    "createdByUserId", "updatedByUserId", "deletedAt", "deletedByUserId",
  ],
  permits: [
    "type", "status", "location", "description",
    "plannedStart", "plannedEnd", "validFrom", "validTo",
    "requestedAt", "requestedByUserId",
    "approvedAt", "approvedByUserId",
    "activatedAt", "activatedByUserId",
    "closedAt", "closedByUserId", "closeNotes",
    "rejectionReason", "cancelReason",
    "hazardsIdentified", "controlMeasures", "ppeRequired",
    "details", "alarmOverride",
    "assetId", "workOrderId",
    "createdByUserId", "updatedByUserId", "deletedAt", "deletedByUserId",
  ],
  external_audits: [
    "auditType", "auditDate", "port", "country", "agencyOrAuthority",
    "inspectorName", "durationHours", "overallResult", "summary",
    "scoreOrRating", "reportUrl",
    "findingsCount", "findingsOpen",
    "createdByUserId", "updatedByUserId", "deletedAt", "deletedByUserId",
  ],
  near_miss: [
    "category", "severity", "status", "occurredAt", "location",
    "description", "immediateAction", "rootCause", "preventiveActions",
    "lessonsLearned", "assetId",
    "reportedByName", "reportedByCrewId",
    "reviewedAt", "reviewedByUserId", "closedAt",
    "createdByUserId", "updatedByUserId", "deletedAt", "deletedByUserId",
  ],
  moc: [
    "category", "status", "riskLevel", "title",
    "reasonForChange", "proposedChange",
    "riskAssessmentNotes", "mitigationActions", "impactAreasJson",
    "plannedDate",
    "approvedAt", "approvedByName", "approvedByUserId", "rejectedReason",
    "implementedAt", "implementedByName", "implementationNotes",
    "reviewedAt", "reviewOutcome", "reviewNotes", "reviewedByUserId",
    "relatedAssetId", "relatedWorkOrderId",
    "createdByUserId", "updatedByUserId", "deletedAt", "deletedByUserId",
  ],
  spare_requests: [
    "status", "priority", "requestedAt",
    "requestedByUserId", "approvedByUserId", "approvedAt", "rejectionReason",
    "requestedForVesselCode", "requestedForAssetId", "requestedForLocationId",
    "itemsCount", "notes",
    "createdByUserId", "updatedByUserId", "deletedAt", "deletedByUserId",
  ],
  fluid_samples: [
    "kind", "fluidType", "fluidProduct",
    "sampledAt", "runningHours", "sampledByUserId",
    "containerCode", "sentAt", "labName", "labReference",
    "status", "notes",
    "resultVerdict", "resultReceivedAt", "resultSummary",
    "sourceWorkOrderId", "sourcePlanId",
    "createdByUserId", "updatedByUserId", "deletedAt", "deletedByUserId",
  ],
  capa: [
    "sourceType", "sourceId", "assetId",
    "status", "priority", "title", "description",
    "owner", "dueDate", "completedAt",
    "actionsTaken", "verificationNote",
    "effectivenessCriteria", "effectivenessReviewDate", "effectivenessOutcome",
    "cancelReason",
    "createdByUserId", "updatedByUserId", "deletedAt", "deletedByUserId",
  ],
  deferrals: [
    "assetId", "sourceType", "sourceId", "deferralType",
    "status", "requestedAt", "requestedByUserId",
    "targetDate", "targetPort",
    "justification", "compensatoryMeasures", "reviewNotes",
    "decisionAt", "decidedByUserId",
    "approverName", "rejectorName",
    "activeSince", "expiredAt", "closedAt", "closeNotes", "rejectionReason",
    "createdByUserId", "updatedByUserId", "deletedAt", "deletedByUserId",
  ],
  defects: [
    "assetId", "workOrderId",
    "status", "severity", "operationalState",
    "classification", "reportedAt",
    "description", "immediateAction", "correctiveAction",
    "rcaAnalysis", "rcaMethodology",
    "rcaImmediateCause", "rcaContributingCause", "rcaRootCause", "rcaPreventiveActions",
    "rcaCompletedAt", "rcaApprovedAt", "rcaApprovedByUserId",
    "capaDescription", "repairType",
    "createdByUserId", "updatedByUserId", "deletedAt", "deletedByUserId",
  ],
  daily_reports: [
    "reportDate", "status",
    "reportType", "operationalStatus",
    "currentPort", "timezone", "nextPort",
    "etaNextPort", "etdNextPort", "portCallType", "estimatedStayHours",
    "maintenanceOpportunity", "sparesReceiptPossible", "operationalRemarks",
    "positionLat", "positionLon",
    "engineHoursMain", "generatorHours",
    "fuelConsumedLiters", "oilConsumedLiters",
    "summary", "notes",
    "submittedByUserId", "verifiedByUserId", "verifiedAt", "integratedAt",
    "createdByUserId", "updatedByUserId", "deletedAt", "deletedByUserId",
  ],
  monthly_reports: [
    "reportYear", "reportMonth", "status",
    "operationalStatus", "currentPort", "nextPort", "etaNextPort",
    "positionLat", "positionLon",
    "summary", "notes",
    "submittedAt", "submittedByUserId", "integratedAt",
    "inventorySnapshotAt",
    "createdByUserId", "updatedByUserId", "deletedAt", "deletedByUserId",
  ],
};

function sortDynamicKeys(module: ExcelModule, keys: string[]): string[] {
  const priorities = DYNAMIC_COLUMN_PRIORITIES[module];
  const priorityIndex = new Map<string, number>();
  priorities.forEach((key, index) => {
    priorityIndex.set(key, index);
  });

  return [...keys].sort((a, b) => {
    const aIdx = priorityIndex.get(a);
    const bIdx = priorityIndex.get(b);
    if (aIdx !== undefined && bIdx !== undefined) return aIdx - bIdx;
    if (aIdx !== undefined) return -1;
    if (bIdx !== undefined) return 1;
    return a.localeCompare(b);
  });
}

export async function exportModule(
  session: TenantAccessSession,
  module: ExcelModule,
  filters: Record<string, string | null>
): Promise<Buffer> {
  const prisma = getPrismaClient();
  if (!prisma) throw new Error("Base de datos no disponible.");

  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new Error("Tenant no encontrado.");

  const baseWhere: Record<string, unknown> = { tenantId: tenant.id, deletedAt: null };

  // Vessel scope enforcement (FAIL-CLOSED).
  if (session.user.role === "TENANT_ADMIN") {
    if (filters.vesselCode) baseWhere.vesselCode = filters.vesselCode;
  } else if (filters.vesselCode) {
    baseWhere.vesselCode = session.user.assignedVesselCodes.includes(filters.vesselCode)
      ? filters.vesselCode
      : "__NO_ASSIGNED_VESSEL__";
  } else if (session.user.assignedVesselCodes.length === 0) {
    baseWhere.vesselCode = "__NO_ASSIGNED_VESSEL__";
  } else {
    baseWhere.vesselCode = { in: session.user.assignedVesselCodes };
  }

  // El modelo Vessel identifica al buque por `code`, no por `vesselCode` (que sí
  // existe en los demás módulos). Sin este remapeo, exportar Vessels con un buque
  // seleccionado hace que Prisma reciba un campo inexistente → error 500.
  if (module === "vessels" && "vesselCode" in baseWhere) {
    baseWhere.code = baseWhere.vesselCode;
    delete baseWhere.vesselCode;
  }

  const records = await fetchRecords(prisma, module, baseWhere, filters);
  return buildWorkbook(module, records);
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

async function fetchRecords(
  prisma: NonNullable<ReturnType<typeof getPrismaClient>>,
  module: ExcelModule,
  where: Record<string, unknown>,
  filters: Record<string, string | null>
): Promise<Record<string, unknown>[]> {
  switch (module) {
    case "vessels": {
      if (filters.status) where.status = filters.status;
      return prisma.vessel.findMany({ where, orderBy: { code: "asc" } }) as any;
    }
    case "assets": {
      if (filters.status)      where.status      = filters.status;
      if (filters.criticality) where.criticality = filters.criticality;
      return prisma.asset.findMany({ where, orderBy: [{ vesselCode: "asc" }, { assetCode: "asc" }] }) as any;
    }
    case "maintenance_plans": {
      if (filters.status)      where.status      = filters.status;
      if (filters.triggerType) where.triggerType = filters.triggerType;
      const rows = await prisma.maintenancePlan.findMany({
        where,
        orderBy: { nextDueDate: "asc" },
      }) as Array<Record<string, unknown> & { assetId: string; tenantId: string }>;

      // MaintenancePlan stores assetId as a "soft" FK (no Prisma @relation).
      // The template columns assetCode / sfiCode describe the linked Asset, not
      // the plan itself — fetch them in one query and merge.
      const assetIds = [...new Set(rows.map((r) => r.assetId).filter(Boolean))];
      const assets = assetIds.length
        ? await prisma.asset.findMany({
            where: { id: { in: assetIds }, tenantId: where.tenantId as string },
            select: { id: true, assetCode: true, sfiCode: true },
          })
        : [];
      const assetMap = new Map(assets.map((a) => [a.id, a]));

      return rows.map((r) => {
        const a = assetMap.get(r.assetId);
        return {
          ...r,
          assetCode: a?.assetCode ?? null,
          sfiCode:   a?.sfiCode   ?? null,
        };
      });
    }
    case "work_orders": {
      if (filters.status)   where.status   = filters.status;
      if (filters.priority) where.priority = filters.priority;
      if (filters.type)     where.type     = filters.type;
      return (prisma as any).workOrder.findMany({ where, orderBy: { openDate: "desc" } }) as any;
    }
    case "spares": {
      if (filters.status)      where.status      = filters.status;
      if (filters.criticality) where.criticality = filters.criticality;
      const rows = await prisma.spare.findMany({ where, orderBy: [{ vesselCode: "asc" }, { sku: "asc" }] });
      // El stock real es el onHand del ledger de movimientos; la app ignora el
      // campo Spare.currentStock (que puede quedar viejo). Exportamos
      // currentStock = onHand para que el Excel coincida con la app y el
      // round-trip export→import reconcilie correctamente.
      const onHandMap = await getOnHandMap(prisma as any, rows.map((r) => r.id));
      return rows.map((r) => ({ ...r, currentStock: onHandMap.get(r.id) ?? 0 })) as any;
    }
    case "providers": {
      if (filters.status)   where.status   = filters.status;
      if (filters.category) where.category = filters.category;
      return prisma.provider.findMany({ where, orderBy: { name: "asc" } }) as any;
    }
    case "certificates": {
      if (filters.status) where.status = filters.status;
      return prisma.certificate.findMany({ where, orderBy: { expiryDate: "asc" } }) as any;
    }

    // ── Módulos export-only ──────────────────────────────────────────────
    case "crew": {
      if (filters.status) where.status = filters.status;
      const crew = await (prisma as any).crew.findMany({
        where,
        select: {
          id: true, tenantId: true, vesselCode: true, crewCode: true,
          firstName: true, lastName: true, rankId: true,
          nationality: true, dateOfBirth: true, passportNumber: true,
          signOnDate: true, signOffDate: true, status: true, notes: true,
          createdAt: true, createdByUserId: true,
          updatedAt: true, updatedByUserId: true,
          deletedAt: true, deletedByUserId: true,
          rankDefinition: { select: { name: true } },
        },
        orderBy: [{ vesselCode: "asc" }, { lastName: "asc" }],
      });
      // Map rankDefinition.name to rank for backward compatibility with export templates
      return crew.map((c: any) => ({
        ...c,
        rank: c.rankDefinition?.name ?? null,
      }));
    }

    case "crew_certifications": {
      // CrewCertification no tiene vesselCode directo; el vessel se infiere por
      // la relación con Crew. Quitamos vesselCode del where heredado y lo
      // re-aplicamos a través de la relación.
      const vesselScope = where.vesselCode;
      delete where.vesselCode;
      if (filters.status) where.status = filters.status;
      const rows = await (prisma as any).crewCertification.findMany({
        where: {
          ...where,
          ...(vesselScope ? { crew: { vesselCode: vesselScope, deletedAt: null } } : { crew: { deletedAt: null } }),
        },
        include: { crew: { select: { crewCode: true, firstName: true, lastName: true, vesselCode: true } } },
        orderBy: { expiryDate: "asc" },
      }) as any[];
      return rows.map((r) => ({
        ...r,
        crewCode:     r.crew?.crewCode    ?? null,
        crewFullName: r.crew ? `${r.crew.firstName} ${r.crew.lastName}` : null,
        vesselCode:   r.crew?.vesselCode  ?? null,
        crew: undefined, // no exportar el objeto anidado
      }));
    }

    case "crew_rest_hours": {
      const rows = await (prisma as any).crewRestHours.findMany({
        where,
        orderBy: [{ recordDate: "desc" }, { vesselCode: "asc" }],
      }) as any[];
      // Join a Crew para mostrar nombres + crewCode.
      const crewIds = [...new Set(rows.map((r) => r.crewId).filter(Boolean))];
      const crew = crewIds.length
        ? await (prisma as any).crew.findMany({
            where: { id: { in: crewIds }, tenantId: where.tenantId as string },
            select: { id: true, crewCode: true, firstName: true, lastName: true },
          })
        : [];
      const crewMap = new Map(crew.map((c: any) => [c.id, c]));
      return rows.map((r) => {
        const c = crewMap.get(r.crewId) as any;
        return {
          ...r,
          crewCode:     c?.crewCode ?? null,
          crewFullName: c ? `${c.firstName} ${c.lastName}` : null,
          // hoursData es Json[24] — no útil en Excel sin contexto; lo dejamos fuera.
          hoursData: undefined,
          // violationsJson lo aplanamos a texto.
          violationsJson: r.violationsJson ? JSON.stringify(r.violationsJson) : null,
        };
      });
    }

    case "drills": {
      if (filters.status) where.status = filters.status;
      if (filters.type)   where.type   = filters.type;
      return (prisma as any).drill.findMany({
        where,
        orderBy: { scheduledDate: "desc" },
      }) as any;
    }

    case "permits": {
      if (filters.status) where.status = filters.status;
      if (filters.type)   where.type   = filters.type;
      return (prisma as any).permitToWork.findMany({
        where,
        orderBy: { plannedStart: "desc" },
      }) as any;
    }

    case "external_audits": {
      if (filters.auditType) where.auditType = filters.auditType;
      const rows = await (prisma as any).externalAudit.findMany({
        where,
        include: { findings: { select: { status: true } } },
        orderBy: { auditDate: "desc" },
      }) as any[];
      return rows.map((r) => {
        const findings = (r.findings ?? []) as Array<{ status: string }>;
        return {
          ...r,
          findingsCount: findings.length,
          findingsOpen:  findings.filter(f => f.status === "OPEN" || f.status === "IN_PROGRESS").length,
          findings: undefined, // no exportar relación cruda
        };
      });
    }

    case "near_miss": {
      if (filters.status)   where.status   = filters.status;
      if (filters.severity) where.severity = filters.severity;
      if (filters.category) where.category = filters.category;
      return (prisma as any).nearMissReport.findMany({
        where,
        orderBy: { occurredAt: "desc" },
      }) as any;
    }

    case "moc": {
      if (filters.status)    where.status    = filters.status;
      if (filters.category)  where.category  = filters.category;
      if (filters.riskLevel) where.riskLevel = filters.riskLevel;
      const rows = await (prisma as any).mocRecord.findMany({
        where,
        orderBy: { createdAt: "desc" },
      }) as any[];
      // impactAreasJson es Json — lo aplanamos a CSV.
      return rows.map((r) => ({
        ...r,
        impactAreasJson: Array.isArray(r.impactAreasJson)
          ? r.impactAreasJson.join(", ")
          : (r.impactAreasJson ? JSON.stringify(r.impactAreasJson) : null),
      }));
    }

    case "spare_requests": {
      // SpareRequest no tiene vesselCode; usa requestedForVesselCode. Y NO usa
      // base.deletedAt → SpareRequest sí tiene deletedAt, mantenemos.
      const vesselScope = where.vesselCode;
      delete where.vesselCode;
      if (filters.status)   where.status   = filters.status;
      if (filters.priority) where.priority = filters.priority;
      if (vesselScope) where.requestedForVesselCode = vesselScope;
      const rows = await (prisma as any).spareRequest.findMany({
        where,
        include: { items: { select: { id: true } } },
        orderBy: { requestedAt: "desc" },
      }) as any[];
      return rows.map((r) => ({
        ...r,
        itemsCount: (r.items ?? []).length,
        items: undefined,
      }));
    }

    case "fluid_samples": {
      if (filters.status) where.status = filters.status;
      if (filters.kind)   where.kind   = filters.kind;
      const rows = await (prisma as any).fluidSample.findMany({
        where,
        include: { result: { select: { verdict: true, receivedAt: true, summary: true } } },
        orderBy: { sampledAt: "desc" },
      }) as any[];
      return rows.map((r) => ({
        ...r,
        resultVerdict:    r.result?.verdict    ?? null,
        resultReceivedAt: r.result?.receivedAt ?? null,
        resultSummary:    r.result?.summary    ?? null,
        result: undefined,
      }));
    }

    case "capa": {
      if (filters.status)   where.status   = filters.status;
      if (filters.priority) where.priority = filters.priority;
      return (prisma as any).capaRecord.findMany({
        where,
        orderBy: { dueDate: "asc" },
      }) as any;
    }

    case "deferrals": {
      if (filters.status) where.status = filters.status;
      return (prisma as any).deferral.findMany({
        where,
        orderBy: { requestedAt: "desc" },
      }) as any;
    }

    case "defects": {
      if (filters.status)   where.status   = filters.status;
      if (filters.severity) where.severity = filters.severity;
      return (prisma as any).defect.findMany({
        where,
        orderBy: { reportedAt: "desc" },
      }) as any;
    }

    case "daily_reports": {
      if (filters.status) where.status = filters.status;
      return (prisma as any).dailyReport.findMany({
        where,
        orderBy: [{ reportDate: "desc" }, { vesselCode: "asc" }],
      }) as any;
    }

    case "monthly_reports": {
      if (filters.status) where.status = filters.status;
      const rows = await (prisma as any).monthlyReport.findMany({
        where,
        orderBy: [{ reportYear: "desc" }, { reportMonth: "desc" }, { vesselCode: "asc" }],
      }) as any[];
      // inventorySnapshot es Json grande — lo excluimos del export para no
      // ensuciar el Excel. Si el user lo necesita, está en el PDF del reporte.
      return rows.map((r) => ({
        ...r,
        inventorySnapshot: undefined,
      }));
    }
  }
}

// ---------------------------------------------------------------------------
// Build workbook
// ---------------------------------------------------------------------------

/**
 * Sanitiza un string contra "CSV/Excel formula injection" (CWE-1236):
 * Excel evalúa como fórmula cualquier celda que arranque con =, +, -, @, TAB
 * o CR. Un atacante con permiso de escribir un nombre/descripción puede
 * embeber `=cmd|'/c calc'!A1` y, al exportar y abrir el Excel en otra PC,
 * dispara ejecución. Prefijamos con apóstrofo para forzar interpretación
 * literal sin alterar el rendering.
 */
function escapeFormula(s: string): string {
  if (!s) return s;
  const first = s.charCodeAt(0);
  // = + - @  \t  \r
  if (first === 0x3D || first === 0x2B || first === 0x2D || first === 0x40 || first === 0x09 || first === 0x0D) {
    return "'" + s;
  }
  return s;
}

function toExcelValue(val: unknown): string | number | null {
  if (val === null || val === undefined) return null;
  if (val instanceof Date) return val.toISOString().split("T")[0];
  if (typeof val === "boolean") return val ? "true" : "false";
  if (typeof val === "string") return escapeFormula(val);
  return val as string | number;
}

async function buildWorkbook(module: ExcelModule, records: Record<string, unknown>[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "CMS3.0";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(module);
  const templateCols = getModuleColumns(module);

  const baseCols = templateCols.map((c) => ({ key: c.key, header: c.header, width: c.width ?? 20 }));
  const reserved = new Set(baseCols.map((c) => c.key));
  reserved.add("id");
  reserved.add("createdAt");
  reserved.add("updatedAt");

  // Include every extra field returned by DB so exports remain complete when schema evolves.
  const dynamicKeys: string[] = [];
  for (const record of records) {
    for (const key of Object.keys(record)) {
      if (reserved.has(key)) continue;
      reserved.add(key);
      dynamicKeys.push(key);
    }
  }

  const dynamicCols = sortDynamicKeys(module, dynamicKeys).map((key) => ({
    key,
    header: key,
    width: Math.min(Math.max(key.length + 4, 14), 36),
  }));

  // Export columns = template columns + detected fields + audit columns
  const exportCols = [
    ...baseCols,
    ...dynamicCols,
    { key: "id", header: "id", width: 30 },
    { key: "createdAt", header: "createdAt", width: 22 },
    { key: "updatedAt", header: "updatedAt", width: 22 },
  ];

  sheet.columns = exportCols;

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8E8E8" } };
  headerRow.commit();

  for (const record of records) {
    const row: Record<string, string | number | null> = {};
    for (const col of exportCols) {
      row[col.key] = toExcelValue(record[col.key]);
    }
    sheet.addRow(row);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
