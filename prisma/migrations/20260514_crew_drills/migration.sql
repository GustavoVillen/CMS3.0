-- Crew / Certifications / Drills (Vetting Sprint 1 — TMSA 4 Elem. 3, SIRE 2.0 Ch. 3, ISM 6).

-- CreateEnum
CREATE TYPE "CrewRank" AS ENUM (
  'CAPTAIN', 'CHIEF_OFFICER', 'SECOND_OFFICER', 'THIRD_OFFICER',
  'CHIEF_ENGINEER', 'SECOND_ENGINEER', 'THIRD_ENGINEER', 'FOURTH_ENGINEER',
  'ELECTRICIAN', 'BOSUN', 'AB_SEAMAN', 'OS_SEAMAN', 'OILER', 'WIPER',
  'COOK', 'STEWARD', 'CADET', 'RADIO_OPERATOR', 'OTHER'
);

-- CreateEnum
CREATE TYPE "CrewStatus" AS ENUM ('ONBOARD', 'SIGNED_OFF');

-- CreateEnum
CREATE TYPE "CrewCertificationType" AS ENUM (
  'STCW_II_1', 'STCW_II_2', 'STCW_III_1', 'STCW_III_2', 'STCW_IV_2',
  'STCW_V_1', 'STCW_VI_1', 'STCW_VI_2', 'STCW_VI_3', 'STCW_VI_4',
  'GMDSS_GOC', 'GMDSS_ROC', 'BST', 'MEDICAL_ENOG', 'MEDICAL_FIRST_AID',
  'ADVANCED_FIRE_FIGHTING', 'SHIP_SECURITY_OFFICER', 'CROWD_MANAGEMENT',
  'PASSPORT', 'SEAMANS_BOOK', 'OTHER'
);

-- CreateEnum
CREATE TYPE "CrewCertificationStatus" AS ENUM ('VALID', 'EXPIRING_SOON', 'EXPIRED');

-- CreateEnum
CREATE TYPE "DrillType" AS ENUM (
  'FIRE', 'ABANDON_SHIP', 'ENCLOSED_SPACE', 'MAN_OVERBOARD',
  'POLLUTION', 'SECURITY', 'MEDICAL', 'STEERING_GEAR', 'BLACKOUT',
  'OIL_SPILL', 'OTHER'
);

-- CreateEnum
CREATE TYPE "DrillStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED');

-- CreateTable Crew
CREATE TABLE "Crew" (
  "id"                 TEXT NOT NULL,
  "tenantId"           TEXT NOT NULL,
  "vesselCode"         TEXT NOT NULL,
  "crewCode"           TEXT NOT NULL,
  "firstName"          TEXT NOT NULL,
  "lastName"           TEXT NOT NULL,
  "rank"               "CrewRank" NOT NULL,
  "nationality"        TEXT,
  "dateOfBirth"        TIMESTAMP(3),
  "passportNumber"     TEXT,
  "signOnDate"         TIMESTAMP(3) NOT NULL,
  "signOffDate"        TIMESTAMP(3),
  "status"             "CrewStatus" NOT NULL DEFAULT 'ONBOARD',
  "notes"              TEXT,
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

  CONSTRAINT "Crew_pkey" PRIMARY KEY ("id")
);

-- CreateIndex Crew
CREATE UNIQUE INDEX "Crew_tenantId_vesselCode_crewCode_key" ON "Crew"("tenantId", "vesselCode", "crewCode");
CREATE INDEX "Crew_tenantId_idx" ON "Crew"("tenantId");
CREATE INDEX "Crew_tenantId_vesselCode_idx" ON "Crew"("tenantId", "vesselCode");
CREATE INDEX "Crew_tenantId_status_idx" ON "Crew"("tenantId", "status");

-- AddForeignKey Crew → Vessel
ALTER TABLE "Crew" ADD CONSTRAINT "Crew_tenantId_vesselCode_fkey"
  FOREIGN KEY ("tenantId", "vesselCode") REFERENCES "Vessel"("tenantId", "code")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable CrewCertification
CREATE TABLE "CrewCertification" (
  "id"                TEXT NOT NULL,
  "tenantId"          TEXT NOT NULL,
  "crewId"            TEXT NOT NULL,
  "type"              "CrewCertificationType" NOT NULL,
  "certificateNumber" TEXT,
  "issuingAuthority"  TEXT,
  "issuedDate"        TIMESTAMP(3),
  "expiryDate"        TIMESTAMP(3),
  "docUrl"            TEXT,
  "status"            "CrewCertificationStatus" NOT NULL DEFAULT 'VALID',
  "notes"             TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId"   TEXT NOT NULL,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  "updatedByUserId"   TEXT NOT NULL,
  "deletedAt"         TIMESTAMP(3),
  "deletedByUserId"   TEXT,

  CONSTRAINT "CrewCertification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex CrewCertification
CREATE INDEX "CrewCertification_tenantId_idx" ON "CrewCertification"("tenantId");
CREATE INDEX "CrewCertification_crewId_idx" ON "CrewCertification"("crewId");
CREATE INDEX "CrewCertification_tenantId_status_idx" ON "CrewCertification"("tenantId", "status");
CREATE INDEX "CrewCertification_expiryDate_idx" ON "CrewCertification"("expiryDate");

-- AddForeignKey CrewCertification → Crew
ALTER TABLE "CrewCertification" ADD CONSTRAINT "CrewCertification_crewId_fkey"
  FOREIGN KEY ("crewId") REFERENCES "Crew"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable Drill
CREATE TABLE "Drill" (
  "id"                 TEXT NOT NULL,
  "tenantId"           TEXT NOT NULL,
  "vesselCode"         TEXT NOT NULL,
  "drillCode"          TEXT NOT NULL,
  "type"               "DrillType" NOT NULL,
  "status"             "DrillStatus" NOT NULL DEFAULT 'SCHEDULED',
  "scheduledDate"      TIMESTAMP(3) NOT NULL,
  "completedDate"      TIMESTAMP(3),
  "scenario"           TEXT,
  "observations"       TEXT,
  "lessonsLearned"     TEXT,
  "participantCrewIds" JSONB NOT NULL DEFAULT '[]',
  "pdfUrl"             TEXT,
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

  CONSTRAINT "Drill_pkey" PRIMARY KEY ("id")
);

-- CreateIndex Drill
CREATE UNIQUE INDEX "Drill_tenantId_vesselCode_drillCode_key" ON "Drill"("tenantId", "vesselCode", "drillCode");
CREATE INDEX "Drill_tenantId_idx" ON "Drill"("tenantId");
CREATE INDEX "Drill_tenantId_vesselCode_idx" ON "Drill"("tenantId", "vesselCode");
CREATE INDEX "Drill_tenantId_status_idx" ON "Drill"("tenantId", "status");
CREATE INDEX "Drill_scheduledDate_idx" ON "Drill"("scheduledDate");

-- AddForeignKey Drill → Vessel
ALTER TABLE "Drill" ADD CONSTRAINT "Drill_tenantId_vesselCode_fkey"
  FOREIGN KEY ("tenantId", "vesselCode") REFERENCES "Vessel"("tenantId", "code")
  ON DELETE RESTRICT ON UPDATE CASCADE;
