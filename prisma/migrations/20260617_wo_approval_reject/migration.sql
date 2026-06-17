-- AlterTable: rechazo de tramitación de OT ([NO APROBADA]/[NO AUTORIZADA])
-- Devuelve la OT a Solicitada (fondo rojo) registrando quién rechazó y el motivo.
ALTER TABLE "WorkOrder"
ADD COLUMN "rechazadoByName" TEXT,
ADD COLUMN "rechazadoAt" TIMESTAMP(3),
ADD COLUMN "rechazoReason" TEXT;
