-- Vínculo genérico de Defect a su origen (mismo patrón que Deferral/CapaRecord).
-- Hoy se usa para EXTERNAL_AUDIT_FINDING: sourceId = ExternalAuditFinding.id.

-- AlterTable
ALTER TABLE "Defect" ADD COLUMN "sourceType" TEXT;
ALTER TABLE "Defect" ADD COLUMN "sourceId" TEXT;

-- CreateIndex
CREATE INDEX "Defect_tenantId_sourceType_sourceId_idx" ON "Defect"("tenantId", "sourceType", "sourceId");
