import ExcelJS from "exceljs";
import type { ExcelModule } from "./excel-permissions";

interface ColumnDef {
  key: string;
  header: string;
  required: boolean;
  width?: number;
}

const MODULE_COLUMNS: Record<ExcelModule, ColumnDef[]> = {
  vessels: [
    { key: "code",               header: "code *",               required: true,  width: 20 },
    { key: "name",               header: "name",                 required: false, width: 30 },
    { key: "owner",              header: "owner",                required: false, width: 30 },
    { key: "vesselType",         header: "vesselType",           required: false, width: 28 },
    { key: "imo",                header: "imo",                  required: false, width: 18 },
    { key: "registration",       header: "registration",         required: false, width: 18 },
    { key: "powerHp",            header: "powerHp",              required: false, width: 14 },
    { key: "dwtTons",            header: "dwtTons",              required: false, width: 14 },
    { key: "lengthM",            header: "lengthM",              required: false, width: 12 },
    { key: "beamM",              header: "beamM",                required: false, width: 12 },
    { key: "depthM",             header: "depthM",               required: false, width: 12 },
    { key: "trnTn",              header: "trnTn",                required: false, width: 12 },
    { key: "trbTn",              header: "trbTn",                required: false, width: 12 },
    { key: "buildYear",          header: "buildYear",            required: false, width: 12 },
    { key: "buildCountry",       header: "buildCountry",         required: false, width: 20 },
    { key: "incorporationDate",  header: "incorporationDate",    required: false, width: 18 },
    { key: "incorporationType",  header: "incorporationType",    required: false, width: 20 },
    { key: "status",             header: "status",               required: false, width: 15 },
  ],
  assets: [
    { key: "vesselCode",       header: "vesselCode *",       required: true,  width: 20 },
    { key: "sfiCode",          header: "sfiCode *",          required: true,  width: 20 },
    { key: "assetCode",        header: "assetCode *",        required: true,  width: 20 },
    { key: "name",             header: "name",               required: false, width: 30 },
    { key: "criticality",      header: "criticality",        required: false, width: 15 },
    { key: "status",           header: "status",             required: false, width: 20 },
    { key: "manufacturer",     header: "manufacturer",       required: false, width: 25 },
    { key: "model",            header: "model",              required: false, width: 20 },
    { key: "serialNumber",     header: "serialNumber",       required: false, width: 25 },
    { key: "installationDate", header: "installationDate",   required: false, width: 20 },
    { key: "lastOverhaulDate", header: "lastOverhaulDate",   required: false, width: 20 },
    { key: "replacementDate",  header: "replacementDate",    required: false, width: 20 },
  ],
  maintenance_plans: [
    { key: "vesselCode",          header: "vesselCode *",         required: true,  width: 20 },
    { key: "assetCode",           header: "assetCode",            required: false, width: 22 },
    { key: "sfiGroupNumber",      header: "sfiGroupNumber",       required: false, width: 16 },
    { key: "sfiCode",             header: "sfiCode",              required: false, width: 20 },
    { key: "taskCode",            header: "taskCode *",           required: true,  width: 20 },
    { key: "title",               header: "title *",              required: true,  width: 40 },
    { key: "description",         header: "description",          required: false, width: 50 },
    { key: "taskType",            header: "taskType",             required: false, width: 18 },
    { key: "triggerType",         header: "triggerType",          required: false, width: 18 },
    { key: "frequencyMonths",     header: "frequencyMonths",      required: false, width: 18 },
    { key: "frequencyHours",      header: "frequencyHours",       required: false, width: 18 },
    { key: "responsible",         header: "responsible",          required: false, width: 25 },
    { key: "acceptanceCriteria",  header: "acceptanceCriteria",   required: false, width: 50 },
    { key: "loto",                header: "loto",                 required: false, width: 40 },
    { key: "riskLevel",           header: "riskLevel",            required: false, width: 14 },
    { key: "riskAnalysisResult",  header: "riskAnalysisResult",   required: false, width: 50 },
    { key: "triggerResultMode",   header: "triggerResultMode",    required: false, width: 22 },
    { key: "windowMode",          header: "windowMode",           required: false, width: 15 },
    { key: "windowLeadDays",      header: "windowLeadDays",       required: false, width: 16 },
    { key: "windowLeadHours",     header: "windowLeadHours",      required: false, width: 17 },
    { key: "lastExecutionDate",   header: "lastExecutionDate",    required: false, width: 20 },
    { key: "nextDueDate",         header: "nextDueDate",          required: false, width: 18 },
    { key: "lastExecutionHours",  header: "lastExecutionHours",   required: false, width: 20 },
    { key: "nextDueHours",        header: "nextDueHours",         required: false, width: 16 },
    { key: "checklistTemplate",   header: "checklistTemplate",    required: false, width: 25 },
    { key: "status",              header: "status",               required: false, width: 18 },
  ],
  work_orders: [
    { key: "workOrderCode",  header: "workOrderCode",  required: false, width: 22 },
    { key: "vesselCode",     header: "vesselCode",     required: false, width: 18 },
    { key: "type",           header: "type",           required: false, width: 20 },
    { key: "status",         header: "status",         required: false, width: 18 },
    { key: "priority",       header: "priority",       required: false, width: 14 },
    { key: "criticality",    header: "criticality",    required: false, width: 14 },
    { key: "title",          header: "title",          required: false, width: 40 },
    { key: "openDate",       header: "openDate",       required: false, width: 18 },
    { key: "dueDate",        header: "dueDate",        required: false, width: 18 },
    { key: "startDate",      header: "startDate",      required: false, width: 18 },
    { key: "completedDate",  header: "completedDate",  required: false, width: 18 },
    { key: "estimatedHours", header: "estimatedHours", required: false, width: 16 },
    { key: "description",    header: "description",    required: false, width: 50 },
  ],
  spares: [
    { key: "vesselCode",             header: "vesselCode *",           required: true,  width: 20 },
    { key: "sku",                    header: "sku *",                  required: true,  width: 20 },
    { key: "name",                   header: "name",                   required: false, width: 30 },
    { key: "category",               header: "category",               required: false, width: 20 },
    { key: "criticality",            header: "criticality",            required: false, width: 15 },
    { key: "status",                 header: "status",                 required: false, width: 15 },
    { key: "manufacturer",           header: "manufacturer",           required: false, width: 25 },
    { key: "model",                  header: "model",                  required: false, width: 20 },
    { key: "internalPartNumber",     header: "internalPartNumber",     required: false, width: 25 },
    { key: "manufacturerPartNumber", header: "manufacturerPartNumber", required: false, width: 28 },
    { key: "unit",                   header: "unit",                   required: false, width: 12 },
    { key: "minStock",               header: "minStock",               required: false, width: 12 },
    { key: "reorderPoint",           header: "reorderPoint",           required: false, width: 15 },
    { key: "targetStock",            header: "targetStock",            required: false, width: 14 },
    { key: "location",               header: "location",               required: false, width: 20 },
    { key: "sfiCode",                header: "sfiCode",                required: false, width: 18 },
    { key: "leadTimeDays",           header: "leadTimeDays",           required: false, width: 14 },
    { key: "longDescription",        header: "longDescription",        required: false, width: 50 },
  ],
  providers: [
    { key: "vesselCode",    header: "vesselCode *",   required: true,  width: 20 },
    { key: "providerCode",  header: "providerCode *", required: true,  width: 20 },
    { key: "name",          header: "name",           required: false, width: 30 },
    { key: "category",      header: "category",       required: false, width: 20 },
    { key: "status",        header: "status",         required: false, width: 15 },
    { key: "contactName",   header: "contactName",    required: false, width: 25 },
    { key: "contactEmail",  header: "contactEmail",   required: false, width: 30 },
    { key: "contactPhone",  header: "contactPhone",   required: false, width: 20 },
    { key: "location",      header: "location",       required: false, width: 25 },
  ],
  certificates: [
    { key: "vesselCode",       header: "vesselCode *",       required: true,  width: 20 },
    { key: "certificateCode",  header: "certificateCode *",  required: true,  width: 25 },
    { key: "name",             header: "name",               required: false, width: 35 },
    { key: "issuingAuthority", header: "issuingAuthority",   required: false, width: 30 },
    { key: "status",           header: "status",             required: false, width: 18 },
    { key: "issueDate",        header: "issueDate",          required: false, width: 18 },
    { key: "expiryDate",       header: "expiryDate",         required: false, width: 18 },
  ],
};

export function getModuleColumns(module: ExcelModule): ColumnDef[] {
  return MODULE_COLUMNS[module];
}

export async function generateTemplate(module: ExcelModule): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "GPMS";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(module);
  const cols = MODULE_COLUMNS[module];

  sheet.columns = cols.map((c) => ({
    key:   c.key,
    header: c.header,
    width: c.width ?? 20,
  }));

  // Bold header row
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE8E8E8" },
  };
  headerRow.commit();

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
