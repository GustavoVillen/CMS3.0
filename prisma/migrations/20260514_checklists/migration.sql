-- Pre-Arrival / Pre-Departure / Pre-Bunkering / Enclosed Space / Hot Work
-- checklists firmadas. SIRE 2.0 Ch. 4 + ISGOTT + ISM.

CREATE TYPE "ChecklistTemplateType" AS ENUM (
  'PRE_ARRIVAL', 'PRE_DEPARTURE', 'PRE_BUNKERING', 'PRE_CARGO_TRANSFER',
  'ENCLOSED_SPACE_ENTRY', 'HOT_WORK', 'PILOT_BOARDING', 'ANCHOR', 'MOORING', 'OTHER'
);

CREATE TYPE "ChecklistExecutionStatus" AS ENUM (
  'IN_PROGRESS', 'COMPLETED', 'CANCELLED'
);

CREATE TYPE "ChecklistItemResponseStatus" AS ENUM (
  'PENDING', 'CONFORMING', 'NOT_CONFORMING', 'NOT_APPLICABLE'
);

CREATE TABLE "ChecklistTemplate" (
  "id"              TEXT NOT NULL,
  "tenantId"        TEXT,
  "type"            "ChecklistTemplateType" NOT NULL,
  "name"            TEXT NOT NULL,
  "description"     TEXT,
  "itemsJson"       JSONB NOT NULL DEFAULT '[]',
  "isActive"        BOOLEAN NOT NULL DEFAULT true,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" TEXT NOT NULL,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  "updatedByUserId" TEXT NOT NULL,

  CONSTRAINT "ChecklistTemplate_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ChecklistTemplate_tenantId_idx" ON "ChecklistTemplate"("tenantId");
CREATE INDEX "ChecklistTemplate_type_idx" ON "ChecklistTemplate"("type");

CREATE TABLE "ChecklistExecution" (
  "id"                 TEXT NOT NULL,
  "tenantId"           TEXT NOT NULL,
  "vesselCode"         TEXT NOT NULL,
  "templateId"         TEXT NOT NULL,
  "executionCode"      TEXT NOT NULL,
  "type"               "ChecklistTemplateType" NOT NULL,
  "status"             "ChecklistExecutionStatus" NOT NULL DEFAULT 'IN_PROGRESS',
  "eventDateTime"      TIMESTAMP(3) NOT NULL,
  "port"               TEXT,
  "voyageRef"          TEXT,
  "performedByName"    TEXT,
  "performedByCrewId"  TEXT,
  "signedByName"       TEXT,
  "signedByCrewId"     TEXT,
  "signedAt"           TIMESTAMP(3),
  "notes"              TEXT,
  "totalItems"         INTEGER NOT NULL DEFAULT 0,
  "conformingItems"    INTEGER NOT NULL DEFAULT 0,
  "notConformingItems" INTEGER NOT NULL DEFAULT 0,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId"    TEXT NOT NULL,
  "updatedAt"          TIMESTAMP(3) NOT NULL,
  "updatedByUserId"    TEXT NOT NULL,
  "deletedAt"          TIMESTAMP(3),
  "deletedByUserId"    TEXT,

  CONSTRAINT "ChecklistExecution_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ChecklistExecution_tenantId_vesselCode_executionCode_key"
  ON "ChecklistExecution"("tenantId", "vesselCode", "executionCode");
CREATE INDEX "ChecklistExecution_tenantId_idx" ON "ChecklistExecution"("tenantId");
CREATE INDEX "ChecklistExecution_tenantId_vesselCode_idx" ON "ChecklistExecution"("tenantId", "vesselCode");
CREATE INDEX "ChecklistExecution_tenantId_type_status_idx" ON "ChecklistExecution"("tenantId", "type", "status");
CREATE INDEX "ChecklistExecution_eventDateTime_idx" ON "ChecklistExecution"("eventDateTime");

ALTER TABLE "ChecklistExecution" ADD CONSTRAINT "ChecklistExecution_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "ChecklistTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChecklistExecution" ADD CONSTRAINT "ChecklistExecution_tenantId_vesselCode_fkey"
  FOREIGN KEY ("tenantId", "vesselCode") REFERENCES "Vessel"("tenantId", "code")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ChecklistItemResponse" (
  "id"              TEXT NOT NULL,
  "tenantId"        TEXT NOT NULL,
  "executionId"     TEXT NOT NULL,
  "itemCode"        TEXT NOT NULL,
  "itemText"        TEXT NOT NULL,
  "status"          "ChecklistItemResponseStatus" NOT NULL DEFAULT 'PENDING',
  "notes"           TEXT,
  "reportedByName"  TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  "updatedByUserId" TEXT NOT NULL,

  CONSTRAINT "ChecklistItemResponse_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ChecklistItemResponse_executionId_itemCode_key"
  ON "ChecklistItemResponse"("executionId", "itemCode");
CREATE INDEX "ChecklistItemResponse_tenantId_idx" ON "ChecklistItemResponse"("tenantId");
CREATE INDEX "ChecklistItemResponse_executionId_idx" ON "ChecklistItemResponse"("executionId");

ALTER TABLE "ChecklistItemResponse" ADD CONSTRAINT "ChecklistItemResponse_executionId_fkey"
  FOREIGN KEY ("executionId") REFERENCES "ChecklistExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
