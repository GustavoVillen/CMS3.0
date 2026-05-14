-- STCW Manila / MLC 2006 — Hours of Rest tracking.
-- Una fila por (crew, día). hoursData es un Json[24] con true=descanso por
-- slot horario (0..23). El cálculo de violaciones se hace en el servicio.

CREATE TABLE "CrewRestHours" (
  "id"              TEXT NOT NULL,
  "tenantId"        TEXT NOT NULL,
  "vesselCode"      TEXT NOT NULL,
  "crewId"          TEXT NOT NULL,
  "recordDate"      DATE NOT NULL,
  "hoursData"       JSONB NOT NULL DEFAULT '[false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false]',
  "notes"           TEXT,
  "totalRestHours"  DECIMAL(4, 2),
  "hasViolation"    BOOLEAN NOT NULL DEFAULT false,
  "violationsJson"  JSONB,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" TEXT NOT NULL,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  "updatedByUserId" TEXT NOT NULL,

  CONSTRAINT "CrewRestHours_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CrewRestHours_tenantId_vesselCode_crewId_recordDate_key"
  ON "CrewRestHours"("tenantId", "vesselCode", "crewId", "recordDate");
CREATE INDEX "CrewRestHours_tenantId_idx" ON "CrewRestHours"("tenantId");
CREATE INDEX "CrewRestHours_tenantId_vesselCode_recordDate_idx"
  ON "CrewRestHours"("tenantId", "vesselCode", "recordDate");
CREATE INDEX "CrewRestHours_crewId_recordDate_idx"
  ON "CrewRestHours"("crewId", "recordDate");
CREATE INDEX "CrewRestHours_tenantId_hasViolation_idx"
  ON "CrewRestHours"("tenantId", "hasViolation");
