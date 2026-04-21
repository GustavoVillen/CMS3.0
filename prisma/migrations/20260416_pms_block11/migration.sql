-- CreateEnum
CREATE TYPE "TaskType" AS ENUM ('MAINTENANCE', 'INSPECTION');

-- CreateEnum
CREATE TYPE "TriggerResultMode" AS ENUM ('DUE_ONLY', 'AUTO_WO', 'APPROVAL_WO');

-- CreateEnum
CREATE TYPE "ExecutionWindowMode" AS ENUM ('AUTO', 'MANUAL');

-- CreateEnum
CREATE TYPE "ExecutionStatus" AS ENUM ('FUTURE', 'UPCOMING', 'IN_WINDOW', 'DUE', 'OVERDUE', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ChecklistItemType" AS ENUM ('BOOLEAN_OK_NOK', 'PASS_FAIL_NA', 'NUMERIC_READING', 'SHORT_TEXT', 'TECHNICAL_NOTES', 'PHOTO_REQUIRED');

-- CreateEnum
CREATE TYPE "InspectionExecutionResult" AS ENUM ('SATISFACTORY', 'SATISFACTORY_WITH_OBSERVATIONS', 'UNSATISFACTORY_FOLLOW_UP_REQUIRED', 'CRITICAL_DEFICIENCY_IMMEDIATE_ACTION');

-- CreateEnum
CREATE TYPE "DeficiencySeverity" AS ENUM ('OBSERVATION', 'DEFICIENCY', 'CRITICAL');

-- CreateEnum
CREATE TYPE "CriteriaSource" AS ENUM ('MAKER_MANUAL', 'COMPANY_STANDARD', 'CLASS_REQUIREMENT', 'STATUTORY', 'ENGINEERING_CRITERION');

-- CreateEnum
CREATE TYPE "WorkLogResult" AS ENUM ('COMPLETED', 'COMPLETED_WITH_OBSERVATIONS', 'NOT_COMPLETED', 'FOLLOW_UP_REQUIRED');

-- CreateEnum
CREATE TYPE "PortCallType" AS ENUM ('LOADING', 'DISCHARGING', 'BUNKERING', 'ANCHORAGE', 'WAITING', 'REPAIR', 'OTHER');

-- CreateEnum
CREATE TYPE "MaintenanceOpportunity" AS ENUM ('YES', 'LIMITED', 'NO', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "SparesReceiptPossible" AS ENUM ('YES', 'NO', 'UNKNOWN');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AttachmentTarget" ADD VALUE 'INSPECTION_EXECUTION';
ALTER TYPE "AttachmentTarget" ADD VALUE 'WORK_LOG';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MaintenancePlanTrigger" ADD VALUE 'CALENDAR';
ALTER TYPE "MaintenancePlanTrigger" ADD VALUE 'RUNNING_HOURS';

-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "equipmentClassId" TEXT,
ADD COLUMN     "parentAssetId" TEXT;

-- AlterTable
ALTER TABLE "DailyReport" ADD COLUMN     "estimatedStayHours" DOUBLE PRECISION,
ADD COLUMN     "etaNextPort" TIMESTAMP(3),
ADD COLUMN     "etdNextPort" TIMESTAMP(3),
ADD COLUMN     "maintenanceOpportunity" "MaintenanceOpportunity" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "nextPort" TEXT,
ADD COLUMN     "operationalRemarks" TEXT,
ADD COLUMN     "portCallType" "PortCallType",
ADD COLUMN     "sparesReceiptPossible" "SparesReceiptPossible" NOT NULL DEFAULT 'UNKNOWN';

-- AlterTable
ALTER TABLE "MaintenancePlan" ADD COLUMN     "executionStatus" "ExecutionStatus" NOT NULL DEFAULT 'FUTURE',
ADD COLUMN     "taskMasterId" TEXT,
ADD COLUMN     "triggerResultMode" "TriggerResultMode" NOT NULL DEFAULT 'DUE_ONLY',
ADD COLUMN     "windowLeadDays" INTEGER,
ADD COLUMN     "windowLeadHours" DOUBLE PRECISION,
ADD COLUMN     "windowLeadPercent" DOUBLE PRECISION,
ADD COLUMN     "windowMode" "ExecutionWindowMode" NOT NULL DEFAULT 'AUTO',
ADD COLUMN     "windowOpenDate" TIMESTAMP(3),
ADD COLUMN     "windowOpenHours" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "WorkOrder" ADD COLUMN     "assignedToUserId" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "estimatedHours" DOUBLE PRECISION,
ADD COLUMN     "taskMasterId" TEXT,
ADD COLUMN     "title" TEXT;

-- CreateTable
CREATE TABLE "SfiNode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "groupNumber" INTEGER NOT NULL,
    "groupName" TEXT NOT NULL,
    "isGlobal" BOOLEAN NOT NULL DEFAULT true,
    "tenantId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SfiNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EquipmentClass" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "defaultSfiCode" TEXT,
    "defaultCriticality" "AssetCriticality",
    "isGlobal" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EquipmentClass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskMaster" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "taskType" "TaskType" NOT NULL,
    "triggerType" "MaintenancePlanTrigger" NOT NULL,
    "triggerResultMode" "TriggerResultMode" NOT NULL DEFAULT 'DUE_ONLY',
    "frequencyDays" INTEGER,
    "frequencyHours" DOUBLE PRECISION,
    "estimatedHours" DOUBLE PRECISION,
    "procedure" TEXT,
    "procedureReference" TEXT,
    "acceptanceCriteria" TEXT,
    "evidenceRequired" BOOLEAN NOT NULL DEFAULT false,
    "isGlobal" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskMaster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassTaskTemplate" (
    "id" TEXT NOT NULL,
    "equipmentClassId" TEXT NOT NULL,
    "taskMasterId" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClassTaskTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InspectionTemplate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "equipmentClassId" TEXT,
    "sfiCode" TEXT,
    "triggerType" "MaintenancePlanTrigger" NOT NULL,
    "triggerResultMode" "TriggerResultMode" NOT NULL DEFAULT 'DUE_ONLY',
    "frequencyDays" INTEGER,
    "windowMode" "ExecutionWindowMode" NOT NULL DEFAULT 'AUTO',
    "windowLeadDays" INTEGER,
    "evidenceRequired" BOOLEAN NOT NULL DEFAULT false,
    "isGlobal" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InspectionTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InspectionChecklistItem" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT NOT NULL,
    "itemType" "ChecklistItemType" NOT NULL,
    "acceptanceCriteria" TEXT,
    "nominalValue" DOUBLE PRECISION,
    "minValue" DOUBLE PRECISION,
    "maxValue" DOUBLE PRECISION,
    "unit" TEXT,
    "requiresInstrument" BOOLEAN NOT NULL DEFAULT false,
    "requiredInstrumentType" TEXT,
    "evidenceRequired" BOOLEAN NOT NULL DEFAULT false,
    "deficiencySeverity" "DeficiencySeverity",
    "criteriaSource" "CriteriaSource",
    "isOptional" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "InspectionChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InspectionExecution" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vesselCode" TEXT NOT NULL,
    "assetId" TEXT,
    "templateId" TEXT NOT NULL,
    "executionCode" TEXT NOT NULL,
    "status" "InspectionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "result" "InspectionExecutionResult",
    "scheduledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "inspectorUserId" TEXT,
    "inspectorName" TEXT,
    "generalObservations" TEXT,
    "nextScheduledDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByUserId" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedByUserId" TEXT,

    CONSTRAINT "InspectionExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InspectionItemResult" (
    "id" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "checklistItemId" TEXT NOT NULL,
    "resultValue" TEXT,
    "numericValue" DOUBLE PRECISION,
    "isConforming" BOOLEAN,
    "deficiencySeverity" "DeficiencySeverity",
    "instrumentId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InspectionItemResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Instrument" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vesselCode" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "instrumentType" TEXT NOT NULL,
    "serialNumber" TEXT,
    "calibrationRequired" BOOLEAN NOT NULL DEFAULT false,
    "calibrationDate" TIMESTAMP(3),
    "calibrationDueDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Instrument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vesselCode" TEXT NOT NULL,
    "workOrderId" TEXT,
    "maintenancePlanId" TEXT,
    "assetId" TEXT NOT NULL,
    "logCode" TEXT NOT NULL,
    "taskType" "TaskType" NOT NULL,
    "result" "WorkLogResult" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "executedByUserId" TEXT,
    "executedByName" TEXT NOT NULL,
    "hoursWorked" DOUBLE PRECISION,
    "runningHoursAtExecution" DOUBLE PRECISION,
    "notes" TEXT,
    "followUpRequired" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT NOT NULL,

    CONSTRAINT "WorkLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpareLink" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "equipmentClassId" TEXT,
    "taskMasterId" TEXT,
    "spareSku" TEXT,
    "spareName" TEXT NOT NULL,
    "isConsumable" BOOLEAN NOT NULL DEFAULT false,
    "estimatedQty" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "unit" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpareLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SfiNode_tenantId_idx" ON "SfiNode"("tenantId");

-- CreateIndex
CREATE INDEX "SfiNode_groupNumber_idx" ON "SfiNode"("groupNumber");

-- CreateIndex
CREATE INDEX "EquipmentClass_tenantId_idx" ON "EquipmentClass"("tenantId");

-- CreateIndex
CREATE INDEX "TaskMaster_tenantId_idx" ON "TaskMaster"("tenantId");

-- CreateIndex
CREATE INDEX "TaskMaster_taskType_idx" ON "TaskMaster"("taskType");

-- CreateIndex
CREATE INDEX "ClassTaskTemplate_equipmentClassId_idx" ON "ClassTaskTemplate"("equipmentClassId");

-- CreateIndex
CREATE INDEX "ClassTaskTemplate_taskMasterId_idx" ON "ClassTaskTemplate"("taskMasterId");

-- CreateIndex
CREATE UNIQUE INDEX "ClassTaskTemplate_equipmentClassId_taskMasterId_key" ON "ClassTaskTemplate"("equipmentClassId", "taskMasterId");

-- CreateIndex
CREATE INDEX "InspectionTemplate_tenantId_idx" ON "InspectionTemplate"("tenantId");

-- CreateIndex
CREATE INDEX "InspectionChecklistItem_templateId_idx" ON "InspectionChecklistItem"("templateId");

-- CreateIndex
CREATE INDEX "InspectionExecution_tenantId_idx" ON "InspectionExecution"("tenantId");

-- CreateIndex
CREATE INDEX "InspectionExecution_tenantId_vesselCode_idx" ON "InspectionExecution"("tenantId", "vesselCode");

-- CreateIndex
CREATE INDEX "InspectionExecution_tenantId_status_idx" ON "InspectionExecution"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "InspectionExecution_tenantId_vesselCode_executionCode_key" ON "InspectionExecution"("tenantId", "vesselCode", "executionCode");

-- CreateIndex
CREATE INDEX "InspectionItemResult_executionId_idx" ON "InspectionItemResult"("executionId");

-- CreateIndex
CREATE UNIQUE INDEX "InspectionItemResult_executionId_checklistItemId_key" ON "InspectionItemResult"("executionId", "checklistItemId");

-- CreateIndex
CREATE INDEX "Instrument_tenantId_idx" ON "Instrument"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Instrument_tenantId_code_key" ON "Instrument"("tenantId", "code");

-- CreateIndex
CREATE INDEX "WorkLog_tenantId_idx" ON "WorkLog"("tenantId");

-- CreateIndex
CREATE INDEX "WorkLog_tenantId_vesselCode_idx" ON "WorkLog"("tenantId", "vesselCode");

-- CreateIndex
CREATE INDEX "WorkLog_workOrderId_idx" ON "WorkLog"("workOrderId");

-- CreateIndex
CREATE INDEX "WorkLog_maintenancePlanId_idx" ON "WorkLog"("maintenancePlanId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkLog_tenantId_vesselCode_logCode_key" ON "WorkLog"("tenantId", "vesselCode", "logCode");

-- CreateIndex
CREATE INDEX "SpareLink_equipmentClassId_idx" ON "SpareLink"("equipmentClassId");

-- CreateIndex
CREATE INDEX "SpareLink_taskMasterId_idx" ON "SpareLink"("taskMasterId");

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_equipmentClassId_fkey" FOREIGN KEY ("equipmentClassId") REFERENCES "EquipmentClass"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_parentAssetId_fkey" FOREIGN KEY ("parentAssetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenancePlan" ADD CONSTRAINT "MaintenancePlan_taskMasterId_fkey" FOREIGN KEY ("taskMasterId") REFERENCES "TaskMaster"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassTaskTemplate" ADD CONSTRAINT "ClassTaskTemplate_equipmentClassId_fkey" FOREIGN KEY ("equipmentClassId") REFERENCES "EquipmentClass"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassTaskTemplate" ADD CONSTRAINT "ClassTaskTemplate_taskMasterId_fkey" FOREIGN KEY ("taskMasterId") REFERENCES "TaskMaster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionTemplate" ADD CONSTRAINT "InspectionTemplate_equipmentClassId_fkey" FOREIGN KEY ("equipmentClassId") REFERENCES "EquipmentClass"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionChecklistItem" ADD CONSTRAINT "InspectionChecklistItem_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "InspectionTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionExecution" ADD CONSTRAINT "InspectionExecution_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "InspectionTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionExecution" ADD CONSTRAINT "InspectionExecution_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionItemResult" ADD CONSTRAINT "InspectionItemResult_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "InspectionExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionItemResult" ADD CONSTRAINT "InspectionItemResult_checklistItemId_fkey" FOREIGN KEY ("checklistItemId") REFERENCES "InspectionChecklistItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionItemResult" ADD CONSTRAINT "InspectionItemResult_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkLog" ADD CONSTRAINT "WorkLog_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkLog" ADD CONSTRAINT "WorkLog_maintenancePlanId_fkey" FOREIGN KEY ("maintenancePlanId") REFERENCES "MaintenancePlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpareLink" ADD CONSTRAINT "SpareLink_equipmentClassId_fkey" FOREIGN KEY ("equipmentClassId") REFERENCES "EquipmentClass"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpareLink" ADD CONSTRAINT "SpareLink_taskMasterId_fkey" FOREIGN KEY ("taskMasterId") REFERENCES "TaskMaster"("id") ON DELETE SET NULL ON UPDATE CASCADE;
