-- CVIQ self-assessment — SIRE 2.0 catálogo de preguntas + ejecuciones.

CREATE TABLE "CviqQuestion" (
  "id"               TEXT NOT NULL,
  "questionCode"     TEXT NOT NULL,
  "chapter"          INTEGER NOT NULL,
  "chapterTitle"     TEXT NOT NULL,
  "section"          TEXT,
  "questionText"     TEXT NOT NULL,
  "expectedEvidence" TEXT,
  "vesselTypeScope"  TEXT,
  "tenantId"         TEXT,
  "isActive"         BOOLEAN NOT NULL DEFAULT true,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CviqQuestion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CviqQuestion_questionCode_key" ON "CviqQuestion"("questionCode");
CREATE INDEX "CviqQuestion_chapter_idx" ON "CviqQuestion"("chapter");
CREATE INDEX "CviqQuestion_tenantId_idx" ON "CviqQuestion"("tenantId");

CREATE TYPE "CviqAssessmentStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');
CREATE TYPE "CviqResponseStatus" AS ENUM (
  'PENDING', 'CONFORMING', 'NOT_CONFORMING', 'PARTIALLY_CONFORMING', 'NOT_APPLICABLE'
);

CREATE TABLE "CviqAssessment" (
  "id"                 TEXT NOT NULL,
  "tenantId"           TEXT NOT NULL,
  "vesselCode"         TEXT NOT NULL,
  "assessmentCode"     TEXT NOT NULL,
  "title"              TEXT NOT NULL,
  "status"             "CviqAssessmentStatus" NOT NULL DEFAULT 'IN_PROGRESS',
  "startedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt"        TIMESTAMP(3),
  "assessorName"       TEXT,
  "notes"              TEXT,
  "totalQuestions"     INTEGER NOT NULL DEFAULT 0,
  "conformingCount"    INTEGER NOT NULL DEFAULT 0,
  "notConformingCount" INTEGER NOT NULL DEFAULT 0,
  "partialCount"       INTEGER NOT NULL DEFAULT 0,
  "naCount"            INTEGER NOT NULL DEFAULT 0,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId"    TEXT NOT NULL,
  "updatedAt"          TIMESTAMP(3) NOT NULL,
  "updatedByUserId"    TEXT NOT NULL,
  "deletedAt"          TIMESTAMP(3),
  "deletedByUserId"    TEXT,

  CONSTRAINT "CviqAssessment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CviqAssessment_tenantId_vesselCode_assessmentCode_key"
  ON "CviqAssessment"("tenantId", "vesselCode", "assessmentCode");
CREATE INDEX "CviqAssessment_tenantId_idx" ON "CviqAssessment"("tenantId");
CREATE INDEX "CviqAssessment_tenantId_vesselCode_idx" ON "CviqAssessment"("tenantId", "vesselCode");
CREATE INDEX "CviqAssessment_tenantId_status_idx" ON "CviqAssessment"("tenantId", "status");

CREATE TABLE "CviqResponse" (
  "id"               TEXT NOT NULL,
  "tenantId"         TEXT NOT NULL,
  "assessmentId"     TEXT NOT NULL,
  "questionId"       TEXT NOT NULL,
  "status"           "CviqResponseStatus" NOT NULL DEFAULT 'PENDING',
  "notes"            TEXT,
  "evidenceLink"     TEXT,
  "linkedActionType" TEXT,
  "linkedActionId"   TEXT,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  "updatedByUserId"  TEXT NOT NULL,

  CONSTRAINT "CviqResponse_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CviqResponse_assessmentId_questionId_key"
  ON "CviqResponse"("assessmentId", "questionId");
CREATE INDEX "CviqResponse_tenantId_idx" ON "CviqResponse"("tenantId");
CREATE INDEX "CviqResponse_assessmentId_idx" ON "CviqResponse"("assessmentId");

ALTER TABLE "CviqResponse" ADD CONSTRAINT "CviqResponse_assessmentId_fkey"
  FOREIGN KEY ("assessmentId") REFERENCES "CviqAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CviqResponse" ADD CONSTRAINT "CviqResponse_questionId_fkey"
  FOREIGN KEY ("questionId") REFERENCES "CviqQuestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed inicial de preguntas representativas (no las 600, pero un núcleo cubriendo
-- los 10 capítulos del CVIQ — el resto se carga gradualmente desde la admin UI).
INSERT INTO "CviqQuestion" ("id", "questionCode", "chapter", "chapterTitle", "section", "questionText", "expectedEvidence", "updatedAt") VALUES
('cviq-1-1', '1.1', 1, 'Generalidades', 'Documentación del buque', 'Certificados del buque vigentes (SOC, Class, Flag, Statutory) — todos visibles y dentro de plazo.', 'Certificados originales o copias certificadas vigentes.', NOW()),
('cviq-1-2', '1.2', 1, 'Generalidades', 'Documentación del buque', 'Manuales operativos críticos disponibles (SMS, SOPEP/SMPEP, Cargo Operations, Loading).', 'Manuales actuales accesibles a la tripulación.', NOW()),
('cviq-1-3', '1.3', 1, 'Generalidades', 'Estructura del buque', 'Estructura del casco, cubierta y superestructura en buen estado, sin corrosión visible significativa.', 'Inspección visual + registros de hull integrity.', NOW()),

('cviq-2-1', '2.1', 2, 'Tripulación', 'Certificación', 'Tripulación certificada según STCW, con certificados vigentes y apropiados al cargo.', 'Lista de tripulantes con certs vigentes; CrewCertification table.', NOW()),
('cviq-2-2', '2.2', 2, 'Tripulación', 'Familiarización', 'Tripulantes nuevos completaron la inducción y familiarización antes de asumir funciones.', 'Registros firmados de inducción.', NOW()),
('cviq-2-3', '2.3', 2, 'Tripulación', 'Horas de descanso', 'Horas de descanso registradas y cumplen STCW Manila (≥10h/24h, ≥77h/7d).', 'Planilla mensual de horas de descanso por tripulante.', NOW()),
('cviq-2-4', '2.4', 2, 'Tripulación', 'Drills', 'Drills regulares según SOLAS, ISPS, MARPOL, con asistencia documentada.', 'Drill log + asistentes + escenario + lecciones aprendidas.', NOW()),

('cviq-3-1', '3.1', 3, 'Navegación', 'Bridge management', 'Procedimientos de puente claros, BRM implementado, voyage plan firmado.', 'Voyage plan firmado, master''s standing orders, BRM check.', NOW()),
('cviq-3-2', '3.2', 3, 'Navegación', 'ECDIS', 'Operadores ECDIS certificados, cartas actualizadas, sistema redundante.', 'Certs ECDIS, ENC update log, redundancy test.', NOW()),

('cviq-4-1', '4.1', 4, 'Seguridad', 'SMS', 'SMS implementado, auditorías internas regulares, no-conformidades cerradas.', 'Audit reports, NC log, CAPA.', NOW()),
('cviq-4-2', '4.2', 4, 'Seguridad', 'Near misses', 'Cultura de reporte de near misses establecida, con análisis y acciones.', 'NearMiss reports + análisis + lecciones aprendidas.', NOW()),
('cviq-4-3', '4.3', 4, 'Seguridad', 'PSC findings', 'Findings PSC anteriores cerrados con evidencia.', 'ExternalAudit findings history, clearance evidence.', NOW()),
('cviq-4-4', '4.4', 4, 'Seguridad', 'MOC', 'Proceso formal de Management of Change para cambios significativos.', 'MOC log con análisis riesgo, aprobación, implementación, revisión.', NOW()),

('cviq-5-1', '5.1', 5, 'Contaminación', 'MARPOL', 'Procedimientos MARPOL implementados (Annex I, V), Garbage Record Book y Oil Record Book actualizados.', 'GRB + ORB con entradas vigentes; SOPEP plan visible.', NOW()),
('cviq-5-2', '5.2', 5, 'Contaminación', 'Bunkering', 'Procedimientos de bunkering con checklist pre-bunker firmado.', 'Pre-bunkering checklist firmado por master, chief engineer y supplier.', NOW()),

('cviq-6-1', '6.1', 6, 'Maquinarias', 'PMS', 'Plan de mantenimiento preventivo implementado, OTs cerradas en tiempo.', 'PMS dashboard, OT compliance rate.', NOW()),
('cviq-6-2', '6.2', 6, 'Maquinarias', 'Análisis de fluidos', 'Análisis periódico de aceites/combustibles con seguimiento de tendencias.', 'FluidAnalysis records + trend analysis.', NOW()),
('cviq-6-3', '6.3', 6, 'Maquinarias', 'Defectos', 'Defectos identificados con RCA aplicado y CAPA cuando corresponda.', 'Defect log + RCA aprobado + CAPA generada.', NOW()),

('cviq-7-1', '7.1', 7, 'Carga', 'Cargo plan', 'Plan de carga calculado, aprobado y respetado durante operaciones.', 'Loading plan firmado, stability calculation.', NOW()),

('cviq-8-1', '8.1', 8, 'Amarras', 'MEG4', 'Líneas de amarre dentro de vida útil, registros de inspección y tensión.', 'Mooring lines log con fechas, breaking load, tests.', NOW()),

('cviq-9-1', '9.1', 9, 'Seguridad ISPS', 'SSP', 'SSP implementado, drills security trimestrales, exercise anual.', 'SSP, security drills log, SSO designado.', NOW()),

('cviq-10-1', '10.1', 10, 'Factores humanos', 'Fatiga', 'Procedimientos de fatigue management, horas de descanso verificadas.', 'Fatigue policy, rest hours monitoring.', NOW()),
('cviq-10-2', '10.2', 10, 'Factores humanos', 'Drug & Alcohol', 'Política D&A vigente, tests aleatorios y por causa.', 'D&A policy, test records.', NOW());
