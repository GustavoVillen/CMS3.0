-- AlterTable: tramitación de OT (cadena de aprobación Aprueba/Autoriza)
ALTER TABLE "WorkOrder"
ADD COLUMN "aprobadoByName" TEXT,
ADD COLUMN "aprobadoAt" TIMESTAMP(3),
ADD COLUMN "autorizadoByName" TEXT,
ADD COLUMN "autorizadoAt" TIMESTAMP(3);
