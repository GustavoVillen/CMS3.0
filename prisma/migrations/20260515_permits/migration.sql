-- Permit to Work (Vetting Sprint 1 — SOLAS II-2/10, XI-1/7 + IMO A.1050(27), SIRE 2.0 Ch. 7/8).

-- CreateEnum
CREATE TYPE "PermitType" AS ENUM (
  'HOT_WORK', 'ENCLOSED_SPACE_ENTRY', 'WORKING_ALOFT', 'ELECTRICAL_ISOLATION'
);

-- CreateEnum
CREATE TYPE "PermitStatus" AS ENUM (
  'DRAFT', 'REQUESTED', 'APPROVED', 'REJECTED', 'ACTIVE', 'CLOSED', 'CANCELLED'
);

-- CreateEnum
CREATE TYPE "PermitParticipantRole" AS ENUM (
  'PERFORMER', 'FIRE_WATCH', 'STAND_BY', 'ATTENDANT', 'SUPERVISOR'
);

-- CreateEnum
CREATE TYPE "PermitGasVerdict" AS ENUM ('PASS', 'FAIL');

-- CreateTable PermitToWork
CREATE TABLE "PermitToWork" (
  "id"                 TEXT NOT NULL,
  "tenantId"           TEXT NOT NULL,
  "vesselCode"         TEXT NOT NULL,
  "permitCode"         TEXT NOT NULL,
  "type"               "PermitType" NOT NULL,
  "status"             "PermitStatus" NOT NULL DEFAULT 'DRAFT',
  "assetId"            TEXT,
  "workOrderId"        TEXT,
  "location"           TEXT NOT NULL,
  "description"        TEXT NOT NULL,
  "plannedStart"       TIMESTAMP(3) NOT NULL,
  "plannedEnd"         TIMESTAMP(3) NOT NULL,
  "validFrom"          TIMESTAMP(3),
  "validTo"            TIMESTAMP(3),
  "requestedAt"        TIMESTAMP(3),
  "requestedByUserId"  TEXT,
  "approvedAt"         TIMESTAMP(3),
  "approvedByUserId"   TEXT,
  "activatedAt"        TIMESTAMP(3),
  "activatedByUserId"  TEXT,
  "closedAt"           TIMESTAMP(3),
  "closedByUserId"     TEXT,
  "closeNotes"         TEXT,
  "rejectionReason"    TEXT,
  "cancelReason"       TEXT,
  "hazardsIdentified"  TEXT,
  "controlMeasures"    TEXT,
  "ppeRequired"        TEXT,
  "details"            JSONB NOT NULL DEFAULT '{}',
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId"    TEXT NOT NULL,
  "updatedAt"          TIMESTAMP(3) NOT NULL,
  "updatedByUserId"    TEXT NOT NULL,
  "deletedAt"          TIMESTAMP(3),
  "deletedByUserId"    TEXT,
  "reopenCount"        INTEGER NOT NULL DEFAULT 0,
  "lastReopenAt"       TIMESTAMP(3),
  "lastReopenReason"   TEXT,
  "lastReopenByUserId" TEXT,

  CONSTRAINT "PermitToWork_pkey" PRIMARY KEY ("id")
);

-- CreateIndex PermitToWork
CREATE UNIQUE INDEX "PermitToWork_tenantId_vesselCode_permitCode_key" ON "PermitToWork"("tenantId", "vesselCode", "permitCode");
CREATE INDEX "PermitToWork_tenantId_idx" ON "PermitToWork"("tenantId");
CREATE INDEX "PermitToWork_tenantId_vesselCode_idx" ON "PermitToWork"("tenantId", "vesselCode");
CREATE INDEX "PermitToWork_tenantId_status_idx" ON "PermitToWork"("tenantId", "status");
CREATE INDEX "PermitToWork_tenantId_type_idx" ON "PermitToWork"("tenantId", "type");
CREATE INDEX "PermitToWork_validTo_idx" ON "PermitToWork"("validTo");

-- AddForeignKey PermitToWork → Vessel
ALTER TABLE "PermitToWork" ADD CONSTRAINT "PermitToWork_tenantId_vesselCode_fkey"
  FOREIGN KEY ("tenantId", "vesselCode") REFERENCES "Vessel"("tenantId", "code")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable PermitGasTest
CREATE TABLE "PermitGasTest" (
  "id"              TEXT NOT NULL,
  "tenantId"        TEXT NOT NULL,
  "permitId"        TEXT NOT NULL,
  "testedAt"        TIMESTAMP(3) NOT NULL,
  "testedByName"    TEXT NOT NULL,
  "location"        TEXT,
  "o2Pct"           DOUBLE PRECISION,
  "lelPct"          DOUBLE PRECISION,
  "h2sPpm"          DOUBLE PRECISION,
  "coPpm"           DOUBLE PRECISION,
  "verdict"         "PermitGasVerdict" NOT NULL,
  "notes"           TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" TEXT NOT NULL,

  CONSTRAINT "PermitGasTest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex PermitGasTest
CREATE INDEX "PermitGasTest_tenantId_idx" ON "PermitGasTest"("tenantId");
CREATE INDEX "PermitGasTest_permitId_idx" ON "PermitGasTest"("permitId");
CREATE INDEX "PermitGasTest_tenantId_testedAt_idx" ON "PermitGasTest"("tenantId", "testedAt");

-- AddForeignKey PermitGasTest → PermitToWork
ALTER TABLE "PermitGasTest" ADD CONSTRAINT "PermitGasTest_permitId_fkey"
  FOREIGN KEY ("permitId") REFERENCES "PermitToWork"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable PermitParticipant
CREATE TABLE "PermitParticipant" (
  "id"              TEXT NOT NULL,
  "tenantId"        TEXT NOT NULL,
  "permitId"        TEXT NOT NULL,
  "crewId"          TEXT,
  "name"            TEXT NOT NULL,
  "role"            "PermitParticipantRole" NOT NULL,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" TEXT NOT NULL,

  CONSTRAINT "PermitParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex PermitParticipant
CREATE INDEX "PermitParticipant_tenantId_idx" ON "PermitParticipant"("tenantId");
CREATE INDEX "PermitParticipant_permitId_idx" ON "PermitParticipant"("permitId");
CREATE INDEX "PermitParticipant_crewId_idx" ON "PermitParticipant"("crewId");

-- AddForeignKey PermitParticipant → PermitToWork
ALTER TABLE "PermitParticipant" ADD CONSTRAINT "PermitParticipant_permitId_fkey"
  FOREIGN KEY ("permitId") REFERENCES "PermitToWork"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
