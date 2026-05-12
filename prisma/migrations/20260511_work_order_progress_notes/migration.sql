-- CreateEnum
CREATE TYPE "WorkOrderProgressKind" AS ENUM ('TEXT', 'PHOTO', 'VIDEO', 'AUDIO');

-- CreateTable
CREATE TABLE "WorkOrderProgressNote" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vesselCode" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "kind" "WorkOrderProgressKind" NOT NULL,
    "text" TEXT,
    "fileUrl" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "processedText" TEXT,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "processError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedByUserId" TEXT,

    CONSTRAINT "WorkOrderProgressNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkOrderProgressNote_tenantId_idx" ON "WorkOrderProgressNote"("tenantId");

-- CreateIndex
CREATE INDEX "WorkOrderProgressNote_workOrderId_idx" ON "WorkOrderProgressNote"("workOrderId");

-- CreateIndex
CREATE INDEX "WorkOrderProgressNote_tenantId_vesselCode_idx" ON "WorkOrderProgressNote"("tenantId", "vesselCode");

-- AddForeignKey
ALTER TABLE "WorkOrderProgressNote" ADD CONSTRAINT "WorkOrderProgressNote_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
