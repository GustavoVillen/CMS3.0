-- SIRE 2.0 Ch. 4: External audits (PSC, Flag, Class, Vetting de oil majors)
-- Separados de las inspecciones internas (Inspection) que ya existen.

CREATE TYPE "ExternalAuditType" AS ENUM (
  'PSC', 'FLAG', 'CLASS', 'VETTING_OIL_MAJOR', 'CDI', 'RIGHTSHIP', 'OTHER'
);

CREATE TYPE "ExternalAuditFindingType" AS ENUM (
  'DEFICIENCY', 'OBSERVATION', 'RECOMMENDATION', 'POSITIVE_OBSERVATION'
);

CREATE TYPE "ExternalAuditFindingStatus" AS ENUM (
  'OPEN', 'IN_PROGRESS', 'CLOSED', 'REJECTED_BY_AUDITOR'
);

CREATE TABLE "ExternalAudit" (
  "id"                TEXT NOT NULL,
  "tenantId"          TEXT NOT NULL,
  "vesselCode"        TEXT NOT NULL,
  "auditCode"         TEXT NOT NULL,
  "auditType"         "ExternalAuditType" NOT NULL,
  "auditDate"         TIMESTAMP(3) NOT NULL,
  "port"              TEXT,
  "country"           TEXT,
  "agencyOrAuthority" TEXT,
  "inspectorName"     TEXT,
  "durationHours"     DECIMAL(5, 2),
  "overallResult"     TEXT,
  "summary"           TEXT,
  "scoreOrRating"     TEXT,
  "reportUrl"         TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId"   TEXT NOT NULL,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  "updatedByUserId"   TEXT NOT NULL,
  "deletedAt"         TIMESTAMP(3),
  "deletedByUserId"   TEXT,

  CONSTRAINT "ExternalAudit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExternalAudit_tenantId_vesselCode_auditCode_key"
  ON "ExternalAudit"("tenantId", "vesselCode", "auditCode");
CREATE INDEX "ExternalAudit_tenantId_idx" ON "ExternalAudit"("tenantId");
CREATE INDEX "ExternalAudit_tenantId_vesselCode_idx" ON "ExternalAudit"("tenantId", "vesselCode");
CREATE INDEX "ExternalAudit_tenantId_auditType_idx" ON "ExternalAudit"("tenantId", "auditType");
CREATE INDEX "ExternalAudit_auditDate_idx" ON "ExternalAudit"("auditDate");

ALTER TABLE "ExternalAudit" ADD CONSTRAINT "ExternalAudit_tenantId_vesselCode_fkey"
  FOREIGN KEY ("tenantId", "vesselCode") REFERENCES "Vessel"("tenantId", "code")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ExternalAuditFinding" (
  "id"                    TEXT NOT NULL,
  "tenantId"              TEXT NOT NULL,
  "auditId"               TEXT NOT NULL,
  "vesselCode"            TEXT NOT NULL,
  "findingCode"           TEXT,
  "findingType"           "ExternalAuditFindingType" NOT NULL,
  "category"              TEXT,
  "description"           TEXT NOT NULL,
  "status"                "ExternalAuditFindingStatus" NOT NULL DEFAULT 'OPEN',
  "severity"              TEXT,
  "detentionRelated"      BOOLEAN NOT NULL DEFAULT false,
  "rectificationDeadline" TIMESTAMP(3),
  "clearingDate"          TIMESTAMP(3),
  "evidenceNotes"         TEXT,
  "evidenceDocUrl"        TEXT,
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId"       TEXT NOT NULL,
  "updatedAt"             TIMESTAMP(3) NOT NULL,
  "updatedByUserId"       TEXT NOT NULL,

  CONSTRAINT "ExternalAuditFinding_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ExternalAuditFinding_tenantId_idx" ON "ExternalAuditFinding"("tenantId");
CREATE INDEX "ExternalAuditFinding_auditId_idx" ON "ExternalAuditFinding"("auditId");
CREATE INDEX "ExternalAuditFinding_tenantId_vesselCode_status_idx"
  ON "ExternalAuditFinding"("tenantId", "vesselCode", "status");

ALTER TABLE "ExternalAuditFinding" ADD CONSTRAINT "ExternalAuditFinding_auditId_fkey"
  FOREIGN KEY ("auditId") REFERENCES "ExternalAudit"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
