-- Crew Capability Matrix — SIRE 2.0: qué tareas críticas puede hacer cada
-- tripulante. Útil para asignar OT/PTW/drills.

CREATE TYPE "CapabilityLevel" AS ENUM ('TRAINED', 'CERTIFIED', 'EXPERT');

CREATE TYPE "CapabilityArea" AS ENUM (
  'ECDIS', 'BWMS', 'IG_SYSTEM', 'CARGO_HANDLING', 'MOORING_MASTER',
  'ENCLOSED_SPACE_ENTRY', 'HOT_WORK', 'RADAR_ARPA', 'GMDSS',
  'BRIDGE_RESOURCE_MGMT', 'ENGINE_ROOM_RESOURCE', 'FIRE_FIGHTING',
  'SURVIVAL_CRAFT', 'MEDICAL_FIRST_AID', 'HIGH_VOLTAGE',
  'CRANE_OPERATION', 'OTHER'
);

CREATE TABLE "CrewCapability" (
  "id"              TEXT NOT NULL,
  "tenantId"        TEXT NOT NULL,
  "crewId"          TEXT NOT NULL,
  "area"            "CapabilityArea" NOT NULL,
  "level"           "CapabilityLevel" NOT NULL DEFAULT 'CERTIFIED',
  "certificationId" TEXT,
  "notes"           TEXT,
  "validUntil"      TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" TEXT NOT NULL,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  "updatedByUserId" TEXT NOT NULL,

  CONSTRAINT "CrewCapability_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CrewCapability_crewId_area_key" ON "CrewCapability"("crewId", "area");
CREATE INDEX "CrewCapability_tenantId_idx" ON "CrewCapability"("tenantId");
CREATE INDEX "CrewCapability_crewId_idx" ON "CrewCapability"("crewId");
CREATE INDEX "CrewCapability_tenantId_area_idx" ON "CrewCapability"("tenantId", "area");
