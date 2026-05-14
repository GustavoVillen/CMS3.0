-- Management of Change (MOC) — SIRE 2.0 Ch. 4 + ISM.

CREATE TYPE "MocCategory" AS ENUM (
  'EQUIPMENT_CHANGE', 'PROCEDURE_CHANGE', 'ORGANIZATIONAL',
  'TEMPORARY', 'SOFTWARE_FIRMWARE', 'OTHER'
);

CREATE TYPE "MocRiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

CREATE TYPE "MocStatus" AS ENUM (
  'REQUESTED', 'UNDER_ANALYSIS', 'APPROVED', 'IN_PROGRESS',
  'IMPLEMENTED', 'REVIEWED', 'REJECTED', 'CANCELLED'
);

CREATE TABLE "MocRecord" (
  "id"                    TEXT NOT NULL,
  "tenantId"              TEXT NOT NULL,
  "vesselCode"            TEXT NOT NULL,
  "mocCode"               TEXT NOT NULL,
  "category"              "MocCategory" NOT NULL,
  "status"                "MocStatus" NOT NULL DEFAULT 'REQUESTED',
  "title"                 TEXT NOT NULL,
  "reasonForChange"       TEXT NOT NULL,
  "proposedChange"        TEXT NOT NULL,
  "riskLevel"             "MocRiskLevel" NOT NULL DEFAULT 'MEDIUM',
  "impactAreasJson"       JSONB NOT NULL DEFAULT '[]',
  "riskAssessmentNotes"   TEXT,
  "mitigationActions"     TEXT,
  "approvedAt"            TIMESTAMP(3),
  "approvedByUserId"      TEXT,
  "approvedByName"        TEXT,
  "rejectedReason"        TEXT,
  "plannedDate"           TIMESTAMP(3),
  "implementedAt"         TIMESTAMP(3),
  "implementedByName"     TEXT,
  "implementationNotes"   TEXT,
  "reviewedAt"            TIMESTAMP(3),
  "reviewedByUserId"      TEXT,
  "reviewNotes"           TEXT,
  "reviewOutcome"         TEXT,
  "relatedAssetId"        TEXT,
  "relatedWorkOrderId"    TEXT,
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId"       TEXT NOT NULL,
  "updatedAt"             TIMESTAMP(3) NOT NULL,
  "updatedByUserId"       TEXT NOT NULL,
  "deletedAt"             TIMESTAMP(3),
  "deletedByUserId"       TEXT,

  CONSTRAINT "MocRecord_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MocRecord_tenantId_vesselCode_mocCode_key"
  ON "MocRecord"("tenantId", "vesselCode", "mocCode");
CREATE INDEX "MocRecord_tenantId_idx" ON "MocRecord"("tenantId");
CREATE INDEX "MocRecord_tenantId_vesselCode_idx" ON "MocRecord"("tenantId", "vesselCode");
CREATE INDEX "MocRecord_tenantId_status_idx" ON "MocRecord"("tenantId", "status");
