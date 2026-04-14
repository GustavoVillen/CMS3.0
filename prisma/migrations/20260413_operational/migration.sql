-- CreateEnum
CREATE TYPE "public"."VesselStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "public"."AssetCriticality" AS ENUM ('A', 'B', 'C');

-- CreateEnum
CREATE TYPE "public"."AssetStatus" AS ENUM ('OPERATIONAL', 'DEGRADED', 'OUT_OF_SERVICE');

-- CreateEnum
CREATE TYPE "public"."MaintenancePlanTrigger" AS ENUM ('HOURS', 'MONTHS', 'CONDITION', 'EVENT');

-- CreateEnum
CREATE TYPE "public"."MaintenancePlanStatus" AS ENUM ('ACTIVE', 'DUE_SOON', 'OVERDUE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "public"."WorkOrderType" AS ENUM ('PREVENTIVE', 'CORRECTIVE', 'INSPECTION');

-- CreateEnum
CREATE TYPE "public"."WorkOrderStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'ON_HOLD', 'DEFERRED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."WorkOrderPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "public"."DefectStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'IN_PROGRESS', 'DEFERRED', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "public"."DefectSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "public"."DefectOperationalState" AS ENUM ('NORMAL', 'DEGRADED', 'RESTRICTED', 'NO_GO');

-- CreateEnum
CREATE TYPE "public"."DeferralSourceType" AS ENUM ('DEFECT', 'WORK_ORDER', 'MAINTENANCE_PLAN');

-- CreateEnum
CREATE TYPE "public"."DeferralStatus" AS ENUM ('REQUESTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'ACTIVE', 'EXPIRED', 'CLOSED');

-- CreateEnum
CREATE TYPE "public"."RcaStatus" AS ENUM ('DRAFT', 'UNDER_ANALYSIS', 'COMPLETED', 'APPROVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "public"."RcaMethodology" AS ENUM ('FIVE_WHYS', 'FISHBONE', 'FTA', 'BARRIER_ANALYSIS');

-- CreateEnum
CREATE TYPE "public"."CapaSourceType" AS ENUM ('RCA', 'DEFECT', 'WORK_ORDER', 'INSPECTION');

-- CreateEnum
CREATE TYPE "public"."CapaStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'PENDING_VERIFICATION', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."CapaPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "public"."InspectionType" AS ENUM ('SAFETY', 'TECHNICAL', 'REGULATORY', 'CLASS');

-- CreateEnum
CREATE TYPE "public"."InspectionStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."InspectionResult" AS ENUM ('PASS', 'FAIL', 'CONDITIONAL');

-- CreateEnum
CREATE TYPE "public"."InspectionLogEntryType" AS ENUM ('FINDING', 'ACTION', 'NOTE');

-- CreateEnum
CREATE TYPE "public"."InspectionLogSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "public"."CertificateStatus" AS ENUM ('ACTIVE', 'EXPIRING_SOON', 'EXPIRED', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "public"."DailyReportStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'REVIEWED', 'CLOSED');

-- CreateEnum
CREATE TYPE "public"."ProviderStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "public"."SpareStatus" AS ENUM ('ACTIVE', 'OBSOLETE');

-- CreateEnum
CREATE TYPE "public"."SpareOrderStatus" AS ENUM ('DRAFT', 'REQUESTED', 'APPROVED', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."SpareOrderPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "public"."MovementType" AS ENUM ('RECEIPT', 'ISSUE', 'ADJUSTMENT', 'TRANSFER');

-- CreateEnum
CREATE TYPE "public"."MovementRefType" AS ENUM ('SPARE_ORDER', 'WORK_ORDER', 'DEFECT', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "public"."EvaluationStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "public"."EvaluationRating" AS ENUM ('A', 'B', 'C', 'D');

-- CreateEnum
CREATE TYPE "public"."NcStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "public"."NcSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "public"."DomainEventKind" AS ENUM ('STATE_CHANGED', 'RECORD_CREATED', 'RECORD_UPDATED', 'RECORD_DELETED');

-- CreateEnum
CREATE TYPE "public"."AttachmentTarget" AS ENUM ('DEFECT', 'WORK_ORDER', 'MAINTENANCE_PLAN', 'INSPECTION', 'CERTIFICATE', 'DAILY_REPORT', 'RCA', 'CAPA', 'SPARE_ORDER');

-- CreateEnum
CREATE TYPE "public"."AttachmentStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateTable

CREATE TABLE "public"."DomainEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vesselCode" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "eventKind" "public"."DomainEventKind" NOT NULL,
    "actorUserId" TEXT,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DomainEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Vessel" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "public"."VesselStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByUserId" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedByUserId" TEXT,

    CONSTRAINT "Vessel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Asset" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vesselCode" TEXT NOT NULL,
    "assetCode" TEXT NOT NULL,
    "sfiCode" TEXT,
    "name" TEXT NOT NULL,
    "criticality" "public"."AssetCriticality" NOT NULL DEFAULT 'B',
    "status" "public"."AssetStatus" NOT NULL DEFAULT 'OPERATIONAL',
    "manufacturer" TEXT,
    "model" TEXT,
    "serialNumber" TEXT,
    "installationDate" TIMESTAMP(3),
    "lastOverhaulDate" TIMESTAMP(3),
    "replacementDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByUserId" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedByUserId" TEXT,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MaintenancePlan" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vesselCode" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "taskCode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "triggerType" "public"."MaintenancePlanTrigger" NOT NULL,
    "frequencyHours" DOUBLE PRECISION,
    "frequencyMonths" INTEGER,
    "responsible" TEXT,
    "acceptanceCriteria" TEXT,
    "evidenceRequired" TEXT,
    "status" "public"."MaintenancePlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastExecutionDate" TIMESTAMP(3),
    "nextDueDate" TIMESTAMP(3),
    "lastExecutionHours" DOUBLE PRECISION,
    "nextDueHours" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByUserId" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedByUserId" TEXT,

    CONSTRAINT "MaintenancePlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."WorkOrder" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vesselCode" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "maintenancePlanId" TEXT,
    "workOrderCode" TEXT NOT NULL,
    "type" "public"."WorkOrderType" NOT NULL,
    "status" "public"."WorkOrderStatus" NOT NULL DEFAULT 'PLANNED',
    "priority" "public"."WorkOrderPriority" NOT NULL DEFAULT 'MEDIUM',
    "criticality" "public"."AssetCriticality" NOT NULL DEFAULT 'B',
    "openDate" TIMESTAMP(3) NOT NULL,
    "startDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "completedDate" TIMESTAMP(3),
    "holdReason" TEXT,
    "cancelReason" TEXT,
    "closeNotes" TEXT,
    "independentVerifier" TEXT,
    "testResult" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByUserId" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedByUserId" TEXT,

    CONSTRAINT "WorkOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Defect" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vesselCode" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "workOrderId" TEXT,
    "defectCode" TEXT NOT NULL,
    "status" "public"."DefectStatus" NOT NULL DEFAULT 'OPEN',
    "severity" "public"."DefectSeverity" NOT NULL DEFAULT 'MEDIUM',
    "operationalState" "public"."DefectOperationalState" NOT NULL DEFAULT 'NORMAL',
    "classification" TEXT NOT NULL,
    "reportedAt" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "immediateAction" TEXT,
    "correctiveAction" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByUserId" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedByUserId" TEXT,

    CONSTRAINT "Defect_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Deferral" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vesselCode" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "sourceType" "public"."DeferralSourceType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "deferralCode" TEXT NOT NULL,
    "status" "public"."DeferralStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedAt" TIMESTAMP(3) NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "targetDate" TIMESTAMP(3),
    "justification" TEXT,
    "compensatoryMeasures" TEXT,
    "reviewNotes" TEXT,
    "decisionAt" TIMESTAMP(3),
    "decidedByUserId" TEXT,
    "activeSince" TIMESTAMP(3),
    "expiredAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closeNotes" TEXT,
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByUserId" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedByUserId" TEXT,

    CONSTRAINT "Deferral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RcaRecord" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vesselCode" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "defectId" TEXT,
    "workOrderId" TEXT,
    "rcaCode" TEXT NOT NULL,
    "status" "public"."RcaStatus" NOT NULL DEFAULT 'DRAFT',
    "methodology" "public"."RcaMethodology" NOT NULL,
    "analysisSummary" TEXT,
    "immediateCause" TEXT,
    "contributingCause" TEXT,
    "rootCause" TEXT,
    "correctiveActions" TEXT,
    "preventiveActions" TEXT,
    "completedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "approvedByUserId" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByUserId" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedByUserId" TEXT,

    CONSTRAINT "RcaRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CapaRecord" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vesselCode" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "sourceType" "public"."CapaSourceType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "capaCode" TEXT NOT NULL,
    "status" "public"."CapaStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "public"."CapaPriority" NOT NULL DEFAULT 'MEDIUM',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "owner" TEXT,
    "dueDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "verificationNote" TEXT,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByUserId" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedByUserId" TEXT,

    CONSTRAINT "CapaRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Inspection" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vesselCode" TEXT NOT NULL,
    "assetId" TEXT,
    "inspectionCode" TEXT NOT NULL,
    "type" "public"."InspectionType" NOT NULL,
    "status" "public"."InspectionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "result" "public"."InspectionResult",
    "providerId" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "inspectorName" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByUserId" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedByUserId" TEXT,

    CONSTRAINT "Inspection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."InspectionLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vesselCode" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "logCode" TEXT NOT NULL,
    "entryType" "public"."InspectionLogEntryType" NOT NULL,
    "severity" "public"."InspectionLogSeverity" NOT NULL DEFAULT 'LOW',
    "observedAt" TIMESTAMP(3) NOT NULL,
    "summary" TEXT NOT NULL,
    "recommendation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT NOT NULL,

    CONSTRAINT "InspectionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Certificate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vesselCode" TEXT NOT NULL,
    "assetId" TEXT,
    "certificateCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "issuingAuthority" TEXT NOT NULL,
    "status" "public"."CertificateStatus" NOT NULL DEFAULT 'ACTIVE',
    "issueDate" TIMESTAMP(3) NOT NULL,
    "expiryDate" TIMESTAMP(3) NOT NULL,
    "lastInspectionDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByUserId" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedByUserId" TEXT,

    CONSTRAINT "Certificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DailyReport" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vesselCode" TEXT NOT NULL,
    "reportDate" DATE NOT NULL,
    "status" "public"."DailyReportStatus" NOT NULL DEFAULT 'DRAFT',
    "summary" TEXT,
    "positionLat" DOUBLE PRECISION,
    "positionLon" DOUBLE PRECISION,
    "engineHoursMain" DOUBLE PRECISION,
    "generatorHours" DOUBLE PRECISION,
    "fuelConsumedLiters" DOUBLE PRECISION,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByUserId" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedByUserId" TEXT,

    CONSTRAINT "DailyReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Provider" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vesselCode" TEXT NOT NULL,
    "providerCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "status" "public"."ProviderStatus" NOT NULL DEFAULT 'ACTIVE',
    "contactName" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "location" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByUserId" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedByUserId" TEXT,

    CONSTRAINT "Provider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Spare" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vesselCode" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "criticality" "public"."AssetCriticality" NOT NULL DEFAULT 'B',
    "manufacturer" TEXT,
    "model" TEXT,
    "unit" TEXT NOT NULL,
    "currentStock" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "minStock" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reorderPoint" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "public"."SpareStatus" NOT NULL DEFAULT 'ACTIVE',
    "location" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByUserId" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedByUserId" TEXT,

    CONSTRAINT "Spare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SpareOrder" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vesselCode" TEXT NOT NULL,
    "orderCode" TEXT NOT NULL,
    "status" "public"."SpareOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "priority" "public"."SpareOrderPriority" NOT NULL DEFAULT 'MEDIUM',
    "providerId" TEXT,
    "requestedByUserId" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL,
    "expectedDeliveryDate" TIMESTAMP(3),
    "totalLines" INTEGER NOT NULL DEFAULT 0,
    "totalCost" DOUBLE PRECISION,
    "currency" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByUserId" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedByUserId" TEXT,

    CONSTRAINT "SpareOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."StockMovement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vesselCode" TEXT NOT NULL,
    "spareId" TEXT NOT NULL,
    "movementCode" TEXT NOT NULL,
    "movementType" "public"."MovementType" NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "referenceType" "public"."MovementRefType",
    "referenceId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT NOT NULL,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ProviderEvaluation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vesselCode" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "evaluationCode" TEXT NOT NULL,
    "status" "public"."EvaluationStatus" NOT NULL DEFAULT 'DRAFT',
    "score" DOUBLE PRECISION NOT NULL,
    "rating" "public"."EvaluationRating" NOT NULL,
    "evaluatedAt" TIMESTAMP(3) NOT NULL,
    "evaluatorName" TEXT NOT NULL,
    "summary" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByUserId" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedByUserId" TEXT,

    CONSTRAINT "ProviderEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ProviderNonconformity" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vesselCode" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "nonconformityCode" TEXT NOT NULL,
    "status" "public"."NcStatus" NOT NULL DEFAULT 'OPEN',
    "severity" "public"."NcSeverity" NOT NULL DEFAULT 'MEDIUM',
    "reportedAt" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "correctiveAction" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByUserId" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedByUserId" TEXT,

    CONSTRAINT "ProviderNonconformity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Attachment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vesselCode" TEXT NOT NULL,
    "targetType" "public"."AttachmentTarget" NOT NULL,
    "targetId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "status" "public"."AttachmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "uploadedAt" TIMESTAMP(3) NOT NULL,
    "uploadedByUserId" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByUserId" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedByUserId" TEXT,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "public"."Tenant"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "TenantDomain_host_key" ON "public"."TenantDomain"("host");

-- CreateIndex
CREATE INDEX "TenantDomain_tenantId_idx" ON "public"."TenantDomain"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformUser_email_key" ON "public"."PlatformUser"("email");

-- CreateIndex
CREATE INDEX "PlatformSession_platformUserId_idx" ON "public"."PlatformSession"("platformUserId");

-- CreateIndex
CREATE INDEX "PlatformSession_expiresAt_idx" ON "public"."PlatformSession"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "public"."User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_legacyUserId_key" ON "public"."User"("legacyUserId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantMembership_userId_key" ON "public"."TenantMembership"("userId");

-- CreateIndex
CREATE INDEX "TenantMembership_tenantId_idx" ON "public"."TenantMembership"("tenantId");

-- CreateIndex
CREATE INDEX "TenantMembership_role_idx" ON "public"."TenantMembership"("role");

-- CreateIndex
CREATE UNIQUE INDEX "UserInvitation_tokenHash_key" ON "public"."UserInvitation"("tokenHash");

-- CreateIndex
CREATE INDEX "UserInvitation_tenantId_idx" ON "public"."UserInvitation"("tenantId");

-- CreateIndex
CREATE INDEX "UserInvitation_email_idx" ON "public"."UserInvitation"("email");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "public"."RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "RefreshToken_tenantId_idx" ON "public"."RefreshToken"("tenantId");

-- CreateIndex
CREATE INDEX "RefreshToken_expiresAt_idx" ON "public"."RefreshToken"("expiresAt");

-- CreateIndex
CREATE INDEX "AuditEvent_tenantId_idx" ON "public"."AuditEvent"("tenantId");

-- CreateIndex
CREATE INDEX "AuditEvent_action_idx" ON "public"."AuditEvent"("action");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_idx" ON "public"."AuditEvent"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditEvent_createdAt_idx" ON "public"."AuditEvent"("createdAt");

-- CreateIndex
CREATE INDEX "DomainEvent_tenantId_idx" ON "public"."DomainEvent"("tenantId");

-- CreateIndex
CREATE INDEX "DomainEvent_tenantId_vesselCode_idx" ON "public"."DomainEvent"("tenantId", "vesselCode");

-- CreateIndex
CREATE INDEX "DomainEvent_entityType_entityId_idx" ON "public"."DomainEvent"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "DomainEvent_createdAt_idx" ON "public"."DomainEvent"("createdAt");

-- CreateIndex
CREATE INDEX "Vessel_tenantId_idx" ON "public"."Vessel"("tenantId");

-- CreateIndex
CREATE INDEX "Vessel_tenantId_status_idx" ON "public"."Vessel"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Vessel_tenantId_code_key" ON "public"."Vessel"("tenantId", "code");

-- CreateIndex
CREATE INDEX "Asset_tenantId_idx" ON "public"."Asset"("tenantId");

-- CreateIndex
CREATE INDEX "Asset_tenantId_vesselCode_idx" ON "public"."Asset"("tenantId", "vesselCode");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_tenantId_vesselCode_assetCode_key" ON "public"."Asset"("tenantId", "vesselCode", "assetCode");

-- CreateIndex
CREATE INDEX "MaintenancePlan_tenantId_idx" ON "public"."MaintenancePlan"("tenantId");

-- CreateIndex
CREATE INDEX "MaintenancePlan_tenantId_vesselCode_idx" ON "public"."MaintenancePlan"("tenantId", "vesselCode");

-- CreateIndex
CREATE INDEX "MaintenancePlan_tenantId_status_idx" ON "public"."MaintenancePlan"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MaintenancePlan_tenantId_vesselCode_taskCode_key" ON "public"."MaintenancePlan"("tenantId", "vesselCode", "taskCode");

-- CreateIndex
CREATE INDEX "WorkOrder_tenantId_idx" ON "public"."WorkOrder"("tenantId");

-- CreateIndex
CREATE INDEX "WorkOrder_tenantId_vesselCode_idx" ON "public"."WorkOrder"("tenantId", "vesselCode");

-- CreateIndex
CREATE INDEX "WorkOrder_tenantId_status_idx" ON "public"."WorkOrder"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrder_tenantId_vesselCode_workOrderCode_key" ON "public"."WorkOrder"("tenantId", "vesselCode", "workOrderCode");

-- CreateIndex
CREATE INDEX "Defect_tenantId_idx" ON "public"."Defect"("tenantId");

-- CreateIndex
CREATE INDEX "Defect_tenantId_vesselCode_idx" ON "public"."Defect"("tenantId", "vesselCode");

-- CreateIndex
CREATE INDEX "Defect_tenantId_status_idx" ON "public"."Defect"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Defect_tenantId_vesselCode_defectCode_key" ON "public"."Defect"("tenantId", "vesselCode", "defectCode");

-- CreateIndex
CREATE INDEX "Deferral_tenantId_idx" ON "public"."Deferral"("tenantId");

-- CreateIndex
CREATE INDEX "Deferral_tenantId_vesselCode_idx" ON "public"."Deferral"("tenantId", "vesselCode");

-- CreateIndex
CREATE INDEX "Deferral_tenantId_status_idx" ON "public"."Deferral"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Deferral_tenantId_vesselCode_deferralCode_key" ON "public"."Deferral"("tenantId", "vesselCode", "deferralCode");

-- CreateIndex
CREATE INDEX "RcaRecord_tenantId_idx" ON "public"."RcaRecord"("tenantId");

-- CreateIndex
CREATE INDEX "RcaRecord_tenantId_vesselCode_idx" ON "public"."RcaRecord"("tenantId", "vesselCode");

-- CreateIndex
CREATE INDEX "RcaRecord_tenantId_status_idx" ON "public"."RcaRecord"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RcaRecord_tenantId_vesselCode_rcaCode_key" ON "public"."RcaRecord"("tenantId", "vesselCode", "rcaCode");

-- CreateIndex
CREATE INDEX "CapaRecord_tenantId_idx" ON "public"."CapaRecord"("tenantId");

-- CreateIndex
CREATE INDEX "CapaRecord_tenantId_vesselCode_idx" ON "public"."CapaRecord"("tenantId", "vesselCode");

-- CreateIndex
CREATE INDEX "CapaRecord_tenantId_status_idx" ON "public"."CapaRecord"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CapaRecord_tenantId_vesselCode_capaCode_key" ON "public"."CapaRecord"("tenantId", "vesselCode", "capaCode");

-- CreateIndex
CREATE INDEX "Inspection_tenantId_idx" ON "public"."Inspection"("tenantId");

-- CreateIndex
CREATE INDEX "Inspection_tenantId_vesselCode_idx" ON "public"."Inspection"("tenantId", "vesselCode");

-- CreateIndex
CREATE INDEX "Inspection_tenantId_status_idx" ON "public"."Inspection"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Inspection_tenantId_vesselCode_inspectionCode_key" ON "public"."Inspection"("tenantId", "vesselCode", "inspectionCode");

-- CreateIndex
CREATE INDEX "InspectionLog_tenantId_idx" ON "public"."InspectionLog"("tenantId");

-- CreateIndex
CREATE INDEX "InspectionLog_inspectionId_idx" ON "public"."InspectionLog"("inspectionId");

-- CreateIndex
CREATE INDEX "Certificate_tenantId_idx" ON "public"."Certificate"("tenantId");

-- CreateIndex
CREATE INDEX "Certificate_tenantId_vesselCode_idx" ON "public"."Certificate"("tenantId", "vesselCode");

-- CreateIndex
CREATE INDEX "Certificate_tenantId_status_idx" ON "public"."Certificate"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Certificate_expiryDate_idx" ON "public"."Certificate"("expiryDate");

-- CreateIndex
CREATE UNIQUE INDEX "Certificate_tenantId_vesselCode_certificateCode_key" ON "public"."Certificate"("tenantId", "vesselCode", "certificateCode");

-- CreateIndex
CREATE INDEX "DailyReport_tenantId_idx" ON "public"."DailyReport"("tenantId");

-- CreateIndex
CREATE INDEX "DailyReport_tenantId_vesselCode_idx" ON "public"."DailyReport"("tenantId", "vesselCode");

-- CreateIndex
CREATE UNIQUE INDEX "DailyReport_tenantId_vesselCode_reportDate_key" ON "public"."DailyReport"("tenantId", "vesselCode", "reportDate");

-- CreateIndex
CREATE INDEX "Provider_tenantId_idx" ON "public"."Provider"("tenantId");

-- CreateIndex
CREATE INDEX "Provider_tenantId_vesselCode_idx" ON "public"."Provider"("tenantId", "vesselCode");

-- CreateIndex
CREATE UNIQUE INDEX "Provider_tenantId_vesselCode_providerCode_key" ON "public"."Provider"("tenantId", "vesselCode", "providerCode");

-- CreateIndex
CREATE INDEX "Spare_tenantId_idx" ON "public"."Spare"("tenantId");

-- CreateIndex
CREATE INDEX "Spare_tenantId_vesselCode_idx" ON "public"."Spare"("tenantId", "vesselCode");

-- CreateIndex
CREATE UNIQUE INDEX "Spare_tenantId_vesselCode_sku_key" ON "public"."Spare"("tenantId", "vesselCode", "sku");

-- CreateIndex
CREATE INDEX "SpareOrder_tenantId_idx" ON "public"."SpareOrder"("tenantId");

-- CreateIndex
CREATE INDEX "SpareOrder_tenantId_vesselCode_idx" ON "public"."SpareOrder"("tenantId", "vesselCode");

-- CreateIndex
CREATE INDEX "SpareOrder_tenantId_status_idx" ON "public"."SpareOrder"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SpareOrder_tenantId_vesselCode_orderCode_key" ON "public"."SpareOrder"("tenantId", "vesselCode", "orderCode");

-- CreateIndex
CREATE INDEX "StockMovement_tenantId_idx" ON "public"."StockMovement"("tenantId");

-- CreateIndex
CREATE INDEX "StockMovement_tenantId_vesselCode_idx" ON "public"."StockMovement"("tenantId", "vesselCode");

-- CreateIndex
CREATE INDEX "StockMovement_spareId_idx" ON "public"."StockMovement"("spareId");

-- CreateIndex
CREATE INDEX "ProviderEvaluation_tenantId_idx" ON "public"."ProviderEvaluation"("tenantId");

-- CreateIndex
CREATE INDEX "ProviderEvaluation_tenantId_vesselCode_idx" ON "public"."ProviderEvaluation"("tenantId", "vesselCode");

-- CreateIndex
CREATE INDEX "ProviderEvaluation_providerId_idx" ON "public"."ProviderEvaluation"("providerId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderEvaluation_tenantId_vesselCode_evaluationCode_key" ON "public"."ProviderEvaluation"("tenantId", "vesselCode", "evaluationCode");

-- CreateIndex
CREATE INDEX "ProviderNonconformity_tenantId_idx" ON "public"."ProviderNonconformity"("tenantId");

-- CreateIndex
CREATE INDEX "ProviderNonconformity_tenantId_vesselCode_idx" ON "public"."ProviderNonconformity"("tenantId", "vesselCode");

-- CreateIndex
CREATE INDEX "ProviderNonconformity_providerId_idx" ON "public"."ProviderNonconformity"("providerId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderNonconformity_tenantId_vesselCode_nonconformityCode_key" ON "public"."ProviderNonconformity"("tenantId", "vesselCode", "nonconformityCode");

-- CreateIndex
CREATE INDEX "Attachment_tenantId_idx" ON "public"."Attachment"("tenantId");

-- CreateIndex
CREATE INDEX "Attachment_tenantId_vesselCode_idx" ON "public"."Attachment"("tenantId", "vesselCode");

-- CreateIndex
CREATE INDEX "Attachment_targetType_targetId_idx" ON "public"."Attachment"("targetType", "targetId");

-- AddForeignKey
ALTER TABLE "public"."TenantDomain" ADD CONSTRAINT "TenantDomain_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TenantSetting" ADD CONSTRAINT "TenantSetting_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PlatformSession" ADD CONSTRAINT "PlatformSession_platformUserId_fkey" FOREIGN KEY ("platformUserId") REFERENCES "public"."PlatformUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TenantMembership" ADD CONSTRAINT "TenantMembership_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TenantMembership" ADD CONSTRAINT "TenantMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."UserInvitation" ADD CONSTRAINT "UserInvitation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."UserInvitation" ADD CONSTRAINT "UserInvitation_acceptedByUserId_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RefreshToken" ADD CONSTRAINT "RefreshToken_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AuditEvent" ADD CONSTRAINT "AuditEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AuditEvent" ADD CONSTRAINT "AuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AuditEvent" ADD CONSTRAINT "AuditEvent_actorPlatformUserId_fkey" FOREIGN KEY ("actorPlatformUserId") REFERENCES "public"."PlatformUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Asset" ADD CONSTRAINT "Asset_tenantId_vesselCode_fkey" FOREIGN KEY ("tenantId", "vesselCode") REFERENCES "public"."Vessel"("tenantId", "code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MaintenancePlan" ADD CONSTRAINT "MaintenancePlan_tenantId_vesselCode_fkey" FOREIGN KEY ("tenantId", "vesselCode") REFERENCES "public"."Vessel"("tenantId", "code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WorkOrder" ADD CONSTRAINT "WorkOrder_tenantId_vesselCode_fkey" FOREIGN KEY ("tenantId", "vesselCode") REFERENCES "public"."Vessel"("tenantId", "code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Defect" ADD CONSTRAINT "Defect_tenantId_vesselCode_fkey" FOREIGN KEY ("tenantId", "vesselCode") REFERENCES "public"."Vessel"("tenantId", "code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Deferral" ADD CONSTRAINT "Deferral_tenantId_vesselCode_fkey" FOREIGN KEY ("tenantId", "vesselCode") REFERENCES "public"."Vessel"("tenantId", "code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RcaRecord" ADD CONSTRAINT "RcaRecord_tenantId_vesselCode_fkey" FOREIGN KEY ("tenantId", "vesselCode") REFERENCES "public"."Vessel"("tenantId", "code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CapaRecord" ADD CONSTRAINT "CapaRecord_tenantId_vesselCode_fkey" FOREIGN KEY ("tenantId", "vesselCode") REFERENCES "public"."Vessel"("tenantId", "code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Inspection" ADD CONSTRAINT "Inspection_tenantId_vesselCode_fkey" FOREIGN KEY ("tenantId", "vesselCode") REFERENCES "public"."Vessel"("tenantId", "code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Inspection" ADD CONSTRAINT "Inspection_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "public"."Provider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InspectionLog" ADD CONSTRAINT "InspectionLog_tenantId_vesselCode_fkey" FOREIGN KEY ("tenantId", "vesselCode") REFERENCES "public"."Vessel"("tenantId", "code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InspectionLog" ADD CONSTRAINT "InspectionLog_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "public"."Inspection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Certificate" ADD CONSTRAINT "Certificate_tenantId_vesselCode_fkey" FOREIGN KEY ("tenantId", "vesselCode") REFERENCES "public"."Vessel"("tenantId", "code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DailyReport" ADD CONSTRAINT "DailyReport_tenantId_vesselCode_fkey" FOREIGN KEY ("tenantId", "vesselCode") REFERENCES "public"."Vessel"("tenantId", "code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Provider" ADD CONSTRAINT "Provider_tenantId_vesselCode_fkey" FOREIGN KEY ("tenantId", "vesselCode") REFERENCES "public"."Vessel"("tenantId", "code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Spare" ADD CONSTRAINT "Spare_tenantId_vesselCode_fkey" FOREIGN KEY ("tenantId", "vesselCode") REFERENCES "public"."Vessel"("tenantId", "code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SpareOrder" ADD CONSTRAINT "SpareOrder_tenantId_vesselCode_fkey" FOREIGN KEY ("tenantId", "vesselCode") REFERENCES "public"."Vessel"("tenantId", "code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SpareOrder" ADD CONSTRAINT "SpareOrder_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "public"."Provider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StockMovement" ADD CONSTRAINT "StockMovement_tenantId_vesselCode_fkey" FOREIGN KEY ("tenantId", "vesselCode") REFERENCES "public"."Vessel"("tenantId", "code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StockMovement" ADD CONSTRAINT "StockMovement_spareId_fkey" FOREIGN KEY ("spareId") REFERENCES "public"."Spare"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProviderEvaluation" ADD CONSTRAINT "ProviderEvaluation_tenantId_vesselCode_fkey" FOREIGN KEY ("tenantId", "vesselCode") REFERENCES "public"."Vessel"("tenantId", "code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProviderEvaluation" ADD CONSTRAINT "ProviderEvaluation_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "public"."Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProviderNonconformity" ADD CONSTRAINT "ProviderNonconformity_tenantId_vesselCode_fkey" FOREIGN KEY ("tenantId", "vesselCode") REFERENCES "public"."Vessel"("tenantId", "code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProviderNonconformity" ADD CONSTRAINT "ProviderNonconformity_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "public"."Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Attachment" ADD CONSTRAINT "Attachment_tenantId_vesselCode_fkey" FOREIGN KEY ("tenantId", "vesselCode") REFERENCES "public"."Vessel"("tenantId", "code") ON DELETE RESTRICT ON UPDATE CASCADE;

