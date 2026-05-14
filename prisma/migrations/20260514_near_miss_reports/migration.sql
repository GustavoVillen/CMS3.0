-- SIRE 2.0 Ch. 4 Safety — Near Miss / Hazard Observation reporting.
-- Separado de Defect: el defecto es material; el near miss es un evento o
-- condición de riesgo. Cultura de reporte es uno de los pilares de SIRE.

CREATE TYPE "NearMissCategory" AS ENUM (
  'NEAR_MISS', 'HAZARD_OBSERVATION', 'UNSAFE_ACT', 'UNSAFE_CONDITION'
);

CREATE TYPE "NearMissSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

CREATE TYPE "NearMissStatus" AS ENUM ('REPORTED', 'UNDER_REVIEW', 'ACTIONED', 'CLOSED');

CREATE TABLE "NearMissReport" (
  "id"                TEXT NOT NULL,
  "tenantId"          TEXT NOT NULL,
  "vesselCode"        TEXT NOT NULL,
  "nearMissCode"      TEXT NOT NULL,
  "category"          "NearMissCategory" NOT NULL,
  "severity"          "NearMissSeverity" NOT NULL DEFAULT 'MEDIUM',
  "status"            "NearMissStatus" NOT NULL DEFAULT 'REPORTED',
  "occurredAt"        TIMESTAMP(3) NOT NULL,
  "location"          TEXT,
  "description"       TEXT NOT NULL,
  "immediateAction"   TEXT,
  "rootCause"         TEXT,
  "preventiveActions" TEXT,
  "lessonsLearned"    TEXT,
  "assetId"           TEXT,
  "reportedByName"    TEXT,
  "reportedByCrewId"  TEXT,
  "reviewedAt"        TIMESTAMP(3),
  "reviewedByUserId"  TEXT,
  "closedAt"          TIMESTAMP(3),
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId"   TEXT NOT NULL,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  "updatedByUserId"   TEXT NOT NULL,
  "deletedAt"         TIMESTAMP(3),
  "deletedByUserId"   TEXT,

  CONSTRAINT "NearMissReport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NearMissReport_tenantId_vesselCode_nearMissCode_key"
  ON "NearMissReport"("tenantId", "vesselCode", "nearMissCode");
CREATE INDEX "NearMissReport_tenantId_idx" ON "NearMissReport"("tenantId");
CREATE INDEX "NearMissReport_tenantId_vesselCode_idx" ON "NearMissReport"("tenantId", "vesselCode");
CREATE INDEX "NearMissReport_tenantId_status_idx" ON "NearMissReport"("tenantId", "status");
CREATE INDEX "NearMissReport_occurredAt_idx" ON "NearMissReport"("occurredAt");

ALTER TABLE "NearMissReport" ADD CONSTRAINT "NearMissReport_tenantId_vesselCode_fkey"
  FOREIGN KEY ("tenantId", "vesselCode") REFERENCES "Vessel"("tenantId", "code")
  ON DELETE RESTRICT ON UPDATE CASCADE;
