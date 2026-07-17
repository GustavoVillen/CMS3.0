-- Formulario controlado de OT: REGI-OPE-26.3 "Orden de trabajo" (rev 0, 29.12.2025).
--
-- Cambio ADITIVO: enums nuevos + columnas nullable + tabla hija. No toca datos
-- existentes; las ~400 OT ya cargadas siguen siendo válidas (los campos quedan
-- en NULL y el PDF cae a lo que ya tenían).
--
-- `WorkOrderType` NO se ensancha a propósito: MTTR, el flujo OT→Defecto y los
-- reportes filtran por type='CORRECTIVE', y agregar valores los rompería en
-- silencio. El detalle de 5 opciones del papel vive en `maintenanceKind`, y el
-- service deriva `type` a partir de él.

-- CreateEnum
CREATE TYPE "WorkOrderRequestedByArea" AS ENUM ('CUBIERTA', 'MAQUINAS', 'TECNICA', 'OPS_SSMA');
CREATE TYPE "WorkOrderAssignedToArea"  AS ENUM ('TRIPULACION', 'TERCERIZADO', 'TECNICA', 'OPS_SSMA');
CREATE TYPE "WorkOrderSystemArea"      AS ENUM ('MAQUINAS', 'RE_CUBIERTA', 'BARCAZAS');
CREATE TYPE "WorkOrderMaintenanceKind" AS ENUM ('PREVENTIVO', 'CORRECTIVO_PROGRAMADO', 'CORRECTIVO_NO_PROGRAMADO', 'PREDICTIVO', 'EMERGENCIA');
CREATE TYPE "WorkOrderItemKind"        AS ENUM ('SPARE', 'MATERIAL');

-- AlterEnum: "FRIO" del formulario. Agregar valores a un enum en uso es seguro
-- en Postgres (remover no lo es).
ALTER TYPE "PermitType" ADD VALUE IF NOT EXISTS 'COLD_WORK';

-- AlterEnum: plantilla del formulario nuevo. Key nueva (no se reescribe
-- MERCURIO) para que revertir sea un UPDATE de TenantSetting.
ALTER TYPE "WorkOrderPdfTemplate" ADD VALUE IF NOT EXISTS 'MERCURIO_OT';

-- AlterTable: campos del formulario (todos nullable, sin backfill)
ALTER TABLE "WorkOrder"
  ADD COLUMN "voyageNumber"    TEXT,
  ADD COLUMN "requestedByArea" "WorkOrderRequestedByArea",
  ADD COLUMN "assignedToArea"  "WorkOrderAssignedToArea",
  ADD COLUMN "systemArea"      "WorkOrderSystemArea",
  ADD COLUMN "maintenanceKind" "WorkOrderMaintenanceKind",
  ADD COLUMN "taskCompleted"   BOOLEAN,
  ADD COLUMN "pendingDetail"   TEXT;

-- CreateTable: REPUESTOS / MATERIALES planificados del formulario
CREATE TABLE "WorkOrderItem" (
    "id" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "kind" "WorkOrderItemKind" NOT NULL,
    "spareId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "unit" TEXT NOT NULL DEFAULT 'ud',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByUserId" TEXT NOT NULL,

    CONSTRAINT "WorkOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkOrderItem_workOrderId_idx" ON "WorkOrderItem"("workOrderId");

-- AddForeignKey
ALTER TABLE "WorkOrderItem" ADD CONSTRAINT "WorkOrderItem_workOrderId_fkey"
  FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
