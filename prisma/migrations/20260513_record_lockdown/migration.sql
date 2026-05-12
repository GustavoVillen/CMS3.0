-- Record lockdown: reopen audit fields on WorkOrder, Defect, Deferral, CapaRecord, Inspection.
-- Una vez que el registro pasa a estado terminal (CLOSED/CANCELLED/COMPLETED/etc.) no se
-- puede modificar salvo que un TENANT_ADMIN dispare un reopen explícito con justificación.

-- WorkOrder
ALTER TABLE "WorkOrder"
  ADD COLUMN "reopenCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastReopenAt" TIMESTAMP(3),
  ADD COLUMN "lastReopenReason" TEXT,
  ADD COLUMN "lastReopenByUserId" TEXT;

-- Defect
ALTER TABLE "Defect"
  ADD COLUMN "reopenCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastReopenAt" TIMESTAMP(3),
  ADD COLUMN "lastReopenReason" TEXT,
  ADD COLUMN "lastReopenByUserId" TEXT;

-- Deferral
ALTER TABLE "Deferral"
  ADD COLUMN "reopenCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastReopenAt" TIMESTAMP(3),
  ADD COLUMN "lastReopenReason" TEXT,
  ADD COLUMN "lastReopenByUserId" TEXT;

-- CapaRecord
ALTER TABLE "CapaRecord"
  ADD COLUMN "reopenCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastReopenAt" TIMESTAMP(3),
  ADD COLUMN "lastReopenReason" TEXT,
  ADD COLUMN "lastReopenByUserId" TEXT;

-- Inspection
ALTER TABLE "Inspection"
  ADD COLUMN "reopenCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastReopenAt" TIMESTAMP(3),
  ADD COLUMN "lastReopenReason" TEXT,
  ADD COLUMN "lastReopenByUserId" TEXT;
