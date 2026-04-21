Loaded Prisma config from prisma.config.ts.

-- CreateEnum
CREATE TYPE "PromptCapability" AS ENUM ('knowledge_assistant', 'rca_assistant', 'defect_assistant', 'deferral_analysis', 'barrier_interviewer', 'maintenance_insights', 'daily_executive_summary', 'document_summarizer', 'evidence_link_assistant');

-- CreateEnum
CREATE TYPE "PromptStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AiDocumentStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AiDocumentVersionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateTable
CREATE TABLE "PromptTemplate" (
    "id" TEXT NOT NULL,
    "capability" "PromptCapability" NOT NULL,
    "locale" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "PromptStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "createdById" TEXT,

    CONSTRAINT "PromptTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiDocument" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "AiDocumentStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByUserId" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedByUserId" TEXT,

    CONSTRAINT "AiDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiDocumentVersion" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "AiDocumentVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "content" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'text/plain',
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "activatedAt" TIMESTAMP(3),
    "activatedByUserId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "archivedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT NOT NULL,

    CONSTRAINT "AiDocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PromptTemplate_capability_locale_status_idx" ON "PromptTemplate"("capability", "locale", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PromptTemplate_capability_locale_version_key" ON "PromptTemplate"("capability", "locale", "version");

-- CreateIndex
CREATE INDEX "AiDocument_tenantId_status_idx" ON "AiDocument"("tenantId", "status");

-- CreateIndex
CREATE INDEX "AiDocumentVersion_tenantId_status_idx" ON "AiDocumentVersion"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AiDocumentVersion_documentId_version_key" ON "AiDocumentVersion"("documentId", "version");

-- AddForeignKey
ALTER TABLE "AiDocument" ADD CONSTRAINT "AiDocument_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiDocumentVersion" ADD CONSTRAINT "AiDocumentVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "AiDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

