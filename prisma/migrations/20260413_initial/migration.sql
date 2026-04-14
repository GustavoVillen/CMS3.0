-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."TenantStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DISABLED');

-- CreateEnum
CREATE TYPE "public"."LocaleCode" AS ENUM ('es', 'en', 'pt');

-- CreateEnum
CREATE TYPE "public"."UserStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED', 'DISABLED');

-- CreateEnum
CREATE TYPE "public"."MembershipStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED', 'REVOKED');

-- CreateEnum
CREATE TYPE "public"."PlatformRole" AS ENUM ('SUPERADMIN', 'SUPPORT');

-- CreateEnum
CREATE TYPE "public"."TenantRole" AS ENUM ('TENANT_ADMIN', 'MAINTENANCE_MANAGER', 'TECHNICIAN_OPERATOR', 'INSPECTOR_COMPLIANCE', 'PROCUREMENT_STORE', 'AUDITOR_READONLY');

-- CreateEnum
CREATE TYPE "public"."AuditActorType" AS ENUM ('PLATFORM_USER', 'TENANT_USER', 'SYSTEM');

-- CreateTable
CREATE TABLE "public"."Tenant" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "public"."TenantStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TenantDomain" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantDomain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TenantSetting" (
    "tenantId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "logoUrl" TEXT,
    "primaryColor" TEXT,
    "supportEmail" TEXT NOT NULL,
    "defaultLocale" "public"."LocaleCode" NOT NULL DEFAULT 'es',
    "enabledLocales" "public"."LocaleCode"[] DEFAULT ARRAY['es']::"public"."LocaleCode"[],
    "timezone" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantSetting_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "public"."PlatformUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "public"."PlatformRole" NOT NULL,
    "status" "public"."UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "firstName" TEXT,
    "lastName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PlatformSession" (
    "id" TEXT NOT NULL,
    "platformUserId" TEXT NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "legacyUserId" TEXT,
    "passwordHash" TEXT NOT NULL,
    "status" "public"."UserStatus" NOT NULL DEFAULT 'INVITED',
    "preferredLocale" "public"."LocaleCode",
    "firstName" TEXT,
    "lastName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TenantMembership" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "public"."TenantRole" NOT NULL,
    "status" "public"."MembershipStatus" NOT NULL DEFAULT 'INVITED',
    "assignedVesselCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "joinedAt" TIMESTAMP(3),
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."UserInvitation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "public"."TenantRole" NOT NULL,
    "locale" "public"."LocaleCode",
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "acceptedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AuditEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "actorType" "public"."AuditActorType" NOT NULL,
    "actorUserId" TEXT,
    "actorPlatformUserId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
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

