import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ExcelJS = require("../node_modules/.pnpm/exceljs@4.4.0/node_modules/exceljs/excel.js");
const { Client } = require("../node_modules/.pnpm/pg@8.20.0/node_modules/pg/lib/index.js");

const DB_URL = "postgresql://postgres:postgres@localhost:5434/pms_saas";

function cell(row, col) {
  const v = row.getCell(col).value;
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "object" && v.result !== undefined) return v.result ?? null;
  if (typeof v === "object" && v.text !== undefined) return v.text ?? null;
  return v;
}
function str(row, col) {
  const v = cell(row, col);
  return v == null ? null : String(v).trim() || null;
}
function num(row, col) {
  const v = cell(row, col);
  if (v == null) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}
function bool(row, col) {
  const v = cell(row, col);
  if (v == null) return false;
  if (typeof v === "boolean") return v;
  return String(v).toLowerCase() === "true";
}

async function run() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(__dirname, "assets_plan_repuestos.xlsx"));

  const client = new Client({ connectionString: DB_URL });
  await client.connect();

  const now = new Date().toISOString();

  // ── 1. ASSETS ───────────────────────────────────────────────────────────────
  // col: 1=vesselCode, 2=sfiCode, 3=assetCode, 4=name, 5=criticality, 6=status
  //      7=manufacturer, 8=model, 9=serialNumber, 15=createdByUserId,
  //      16=updatedByUserId, 19=tenantId, 20=trackDailyReport, 21=id
  console.log("\n── Importing Assets ──");
  const assetWs = wb.getWorksheet("Assets");
  let assetOk = 0, assetErr = 0;

  for (let i = 2; i <= assetWs.rowCount; i++) {
    const row = assetWs.getRow(i);
    const id = str(row, 21);
    if (!id) continue;

    try {
      await client.query(`
        INSERT INTO "Asset" (
          id, "tenantId", "vesselCode", "assetCode", "sfiCode", name,
          criticality, status, manufacturer, model, "serialNumber",
          "trackDailyReport", "createdByUserId", "updatedByUserId",
          "createdAt", "updatedAt"
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
        ON CONFLICT (id) DO NOTHING
      `, [
        id,
        str(row, 19) ?? "tenant_demo",      // tenantId
        str(row, 1),                          // vesselCode
        str(row, 3),                          // assetCode
        str(row, 2),                          // sfiCode (stored as text)
        str(row, 4) ?? "",                    // name
        str(row, 5) ?? "B",                   // criticality
        str(row, 6) ?? "OPERATIONAL",         // status
        str(row, 7),                          // manufacturer
        str(row, 8),                          // model
        str(row, 9),                          // serialNumber
        bool(row, 20),                        // trackDailyReport
        str(row, 15) ?? "user_demoadmin",     // createdByUserId
        str(row, 16) ?? "user_demoadmin",     // updatedByUserId
        now, now,
      ]);
      assetOk++;
    } catch (e) {
      console.error(`  Asset row ${i} (${str(row, 3)}) error:`, e.message);
      assetErr++;
    }
  }
  console.log(`  OK: ${assetOk}  ERR: ${assetErr}`);

  // ── 2. MAINTENANCE PLANS ────────────────────────────────────────────────────
  // col: 1=vesselCode, 4=taskCode, 5=title, 6=description, 7=taskType,
  //      8=triggerType, 9=frequencyMonths, 10=frequencyHours, 11=responsible,
  //      12=triggerResultMode, 13=windowMode, 14=windowLeadDays,
  //      20=checklistTemplate, 21=status, 22=sfiGroupNumber, 23=sfiSubgroupCode,
  //      24=acceptanceCriteria, 25=evidenceRequired, 26=riskLevel,
  //      27=riskAnalysisResult, 29=executionStatus, 33=createdByUserId,
  //      34=updatedByUserId, 37=assetId, 38=tenantId, 39=id
  console.log("\n── Importing Maintenance Plans ──");
  const planWs = wb.getWorksheet("Plan_Mantenimiento");
  let planOk = 0, planErr = 0;

  for (let i = 2; i <= planWs.rowCount; i++) {
    const row = planWs.getRow(i);
    const id = str(row, 39);
    if (!id) continue;

    try {
      await client.query(`
        INSERT INTO "MaintenancePlan" (
          id, "tenantId", "vesselCode", "assetId", "taskCode", title,
          description, "taskType", "triggerType", "frequencyMonths", "frequencyHours",
          responsible, "triggerResultMode", "windowMode", "windowLeadDays",
          "checklistTemplate", status, "sfiGroupNumber", "sfiSubgroupCode",
          "acceptanceCriteria", "evidenceRequired", "riskLevel", "riskAnalysisResult",
          "executionStatus", "createdByUserId", "updatedByUserId", "createdAt", "updatedAt"
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28
        )
        ON CONFLICT (id) DO NOTHING
      `, [
        id,
        str(row, 38) ?? "tenant_demo",       // tenantId
        str(row, 1),                           // vesselCode
        str(row, 37),                          // assetId
        str(row, 4),                           // taskCode
        str(row, 5) ?? "",                     // title
        str(row, 6),                           // description
        str(row, 7) ?? "MAINTENANCE",          // taskType
        str(row, 8) ?? "CALENDAR",             // triggerType
        num(row, 9),                           // frequencyMonths
        num(row, 10),                          // frequencyHours
        str(row, 11),                          // responsible
        str(row, 12) ?? "AUTO_WO",             // triggerResultMode
        str(row, 13) ?? "AUTO",                // windowMode
        num(row, 14),                          // windowLeadDays
        str(row, 20),                          // checklistTemplate
        str(row, 21) ?? "ACTIVE",              // status
        num(row, 22),                          // sfiGroupNumber
        str(row, 23),                          // sfiSubgroupCode
        str(row, 24),                          // acceptanceCriteria
        str(row, 25),                          // evidenceRequired
        str(row, 26),                          // riskLevel
        str(row, 27),                          // riskAnalysisResult
        str(row, 29) ?? "FUTURE",              // executionStatus
        str(row, 33) ?? "user_demoadmin",      // createdByUserId
        str(row, 34) ?? "user_demoadmin",      // updatedByUserId
        now, now,
      ]);
      planOk++;
    } catch (e) {
      console.error(`  Plan row ${i} (${str(row, 4)}) error:`, e.message);
      planErr++;
    }
  }
  console.log(`  OK: ${planOk}  ERR: ${planErr}`);

  // ── 3. REPUESTOS ────────────────────────────────────────────────────────────
  // col: 1=vesselCode, 2=sku, 3=name, 4=category, 5=criticality,
  //      6=manufacturer, 7=model, 8=unit, 9=minStock, 10=reorderPoint,
  //      11=location, 12=currentStock, 13=createdByUserId, 14=updatedByUserId,
  //      18=internalPartNumber, 19=leadTimeDays, 20=linkedAssetId,
  //      21=longDescription, 22=manufacturerPartNumber, 24=sfiCode,
  //      25=status, 26=targetStock, 27=tenantId, 28=id
  console.log("\n── Importing Repuestos ──");
  const spareWs = wb.getWorksheet("Repuestos");
  let spareOk = 0, spareErr = 0;

  for (let i = 2; i <= spareWs.rowCount; i++) {
    const row = spareWs.getRow(i);
    const id = str(row, 28);
    if (!id) continue;

    try {
      await client.query(`
        INSERT INTO "Spare" (
          id, "tenantId", "vesselCode", sku, name, category, criticality,
          manufacturer, model, unit, "currentStock", "minStock", "reorderPoint",
          "targetStock", location, status, "internalPartNumber", "leadTimeDays",
          "linkedAssetId", "longDescription", "manufacturerPartNumber", "sfiCode",
          "createdByUserId", "updatedByUserId", "createdAt", "updatedAt"
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26
        )
        ON CONFLICT (id) DO NOTHING
      `, [
        id,
        str(row, 27) ?? "tenant_demo",         // tenantId
        str(row, 1),                             // vesselCode
        str(row, 2),                             // sku
        str(row, 3) ?? "",                       // name
        str(row, 4),                             // category
        str(row, 5) ?? "B",                      // criticality
        str(row, 6),                             // manufacturer
        str(row, 7),                             // model
        str(row, 8) ?? "un",                     // unit
        num(row, 12) ?? 0,                       // currentStock
        num(row, 9) ?? 0,                        // minStock
        num(row, 10) ?? 0,                       // reorderPoint
        num(row, 26),                            // targetStock
        str(row, 11),                            // location
        str(row, 25) ?? "ACTIVE",                // status
        str(row, 18),                            // internalPartNumber
        num(row, 19),                            // leadTimeDays
        str(row, 20),                            // linkedAssetId
        str(row, 21),                            // longDescription
        str(row, 22),                            // manufacturerPartNumber
        str(row, 24),                            // sfiCode
        str(row, 13) ?? "user_demoadmin",        // createdByUserId
        str(row, 14) ?? "user_demoadmin",        // updatedByUserId
        now, now,
      ]);
      spareOk++;
    } catch (e) {
      console.error(`  Spare row ${i} (${str(row, 2)}) error:`, e.message);
      spareErr++;
    }
  }
  console.log(`  OK: ${spareOk}  ERR: ${spareErr}`);

  await client.end();
  console.log("\n✓ Import complete");
}

run().catch(e => { console.error(e); process.exit(1); });
