Loaded Prisma config from prisma.config.ts.

-- CreateEnum
CREATE TYPE "InsightType" AS ENUM ('backlog_risk', 'repeated_failure', 'repeated_deferral', 'pm_frequency_review', 'stock_below_minimum', 'stock_below_reorder_point', 'certificate_expiring', 'certificate_expired', 'inspection_failure_pattern', 'overdue_capa', 'overdue_work_order', 'documentation_gap', 'operational_anomaly', 'recurring_asset_downtime', 'trend_based_maintenance_improvement', 'cross_vessel_spare_availability', 'fleet_repeated_failure_pattern', 'fleet_known_fix_suggestion', 'fleet_shared_operational_experience');

-- CreateEnum
CREATE TYPE "InsightStatus" AS ENUM ('OPEN', 'DISMISSED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "InsightPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "InsightTargetType" AS ENUM ('VESSEL', 'ASSET', 'WORK_ORDER', 'DEFECT', 'CAPA', 'SPARE', 'CERTIFICATE', 'INSPECTION', 'FLEET');

-- CreateTable
CREATE TABLE "AiInsight" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "insightCode" TEXT NOT NULL,
    "insightType" "InsightType" NOT NULL,
    "status" "InsightStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "InsightPriority" NOT NULL DEFAULT 'MEDIUM',
    "targetType" "InsightTargetType" NOT NULL,
    "targetId" TEXT,
    "vesselCode" TEXT,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "recommendation" TEXT NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByUserId" TEXT NOT NULL,

    CONSTRAINT "AiInsight_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiInsight_tenantId_status_idx" ON "AiInsight"("tenantId", "status");

-- CreateIndex
CREATE INDEX "AiInsight_tenantId_vesselCode_status_idx" ON "AiInsight"("tenantId", "vesselCode", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AiInsight_tenantId_insightType_targetType_targetId_key" ON "AiInsight"("tenantId", "insightType", "targetType", "targetId");

