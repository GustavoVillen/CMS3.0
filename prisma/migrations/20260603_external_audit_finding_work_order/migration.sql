-- Vincula un finding de auditoría/inspección externa con la OT correctiva abierta a partir de él.
-- Campo plano (sin FK), mismo patrón que Defect.workOrderId.

-- AlterTable
ALTER TABLE "ExternalAuditFinding" ADD COLUMN "workOrderId" TEXT;
