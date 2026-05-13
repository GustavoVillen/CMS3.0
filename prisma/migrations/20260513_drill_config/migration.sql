-- DrillConfig: frecuencia mínima por tipo de simulacro, configurable por tenant.
-- Si no hay registro, el servicio aplica el default SOLAS/ISPS/MARPOL.

CREATE TABLE "DrillConfig" (
  "id"              TEXT NOT NULL,
  "tenantId"        TEXT NOT NULL,
  "type"            "DrillType" NOT NULL,
  "frequencyDays"   INTEGER NOT NULL,
  "enabled"         BOOLEAN NOT NULL DEFAULT true,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  "updatedByUserId" TEXT NOT NULL,

  CONSTRAINT "DrillConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DrillConfig_tenantId_type_key" ON "DrillConfig"("tenantId", "type");
CREATE INDEX "DrillConfig_tenantId_idx" ON "DrillConfig"("tenantId");
