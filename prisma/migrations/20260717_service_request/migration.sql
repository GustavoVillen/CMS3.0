-- Solicitud de Servicio (SS) como entidad propia.
--
-- Hasta ahora "SS" era sólo un renombre cosmético de la OT para el tenant Mercurio.
-- No lo es: la SS es el pedido de un servicio EXTERNO (un taller) que sólo se abre
-- desde una OT abierta y queda ligada a ella (1 OT → N SS).
--
-- Cambio aditivo: tabla nueva + enum nuevo. No toca WorkOrder ni datos existentes.

-- CreateEnum
CREATE TYPE "ServiceRequestStatus" AS ENUM (
  'DRAFT', 'SOLICITADA', 'APROBADA', 'AUTORIZADA', 'IN_PROGRESS', 'COMPLETED', 'REJECTED', 'CANCELLED'
);

-- CreateTable
CREATE TABLE "ServiceRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vesselCode" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "serviceRequestCode" TEXT NOT NULL,
    "status" "ServiceRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "priority" "WorkOrderPriority" NOT NULL DEFAULT 'MEDIUM',
    "openDate" TIMESTAMP(3) NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "causes" TEXT,
    "providerId" TEXT,
    "tallerNotes" TEXT,
    -- Múltiple: el formulario real admite "AFECTA SEGURIDAD" + "AFECTA SERVICIO" juntas.
    "purchaseRequestKinds" TEXT[],
    "department" "WorkOrderDepartment",
    "communicationMethod" TEXT[],
    "distribution" TEXT[],
    "observations" TEXT,
    "closeNotes" TEXT,
    "cancelReason" TEXT,
    -- ENTREGA / RECEPCION
    "receptionItem" TEXT,
    "receivedByName" TEXT,
    "receptionConform" BOOLEAN,
    -- Pie: firman Jefe de Máquinas y Capitán
    "capitanName" TEXT,
    "jefeMaquinasName" TEXT,
    "solicitaByName" TEXT,
    "aprobadoByName" TEXT,
    "aprobadoByUserId" TEXT,
    "aprobadoAt" TIMESTAMP(3),
    "autorizadoByName" TEXT,
    "autorizadoByUserId" TEXT,
    "autorizadoAt" TIMESTAMP(3),
    "rechazadoByName" TEXT,
    "rechazadoAt" TIMESTAMP(3),
    "rechazoReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByUserId" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedByUserId" TEXT,

    CONSTRAINT "ServiceRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ServiceRequest_tenantId_vesselCode_serviceRequestCode_key"
  ON "ServiceRequest"("tenantId", "vesselCode", "serviceRequestCode");
CREATE INDEX "ServiceRequest_tenantId_idx" ON "ServiceRequest"("tenantId");
CREATE INDEX "ServiceRequest_tenantId_vesselCode_idx" ON "ServiceRequest"("tenantId", "vesselCode");
CREATE INDEX "ServiceRequest_tenantId_status_idx" ON "ServiceRequest"("tenantId", "status");
CREATE INDEX "ServiceRequest_workOrderId_idx" ON "ServiceRequest"("workOrderId");

-- AddForeignKey
ALTER TABLE "ServiceRequest" ADD CONSTRAINT "ServiceRequest_tenantId_vesselCode_fkey"
  FOREIGN KEY ("tenantId", "vesselCode") REFERENCES "Vessel"("tenantId", "code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ServiceRequest" ADD CONSTRAINT "ServiceRequest_workOrderId_fkey"
  FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
