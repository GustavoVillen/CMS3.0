-- Migration: Add Crew Training Models + Migrate CrewRank to RankDefinition
-- FASE 3: Mapear enums CrewRank a RankDefinition dinámico por tenant

-- Step 1: Create RankDefinition table
CREATE TABLE IF NOT EXISTS "RankDefinition" (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  "sortOrder" INTEGER DEFAULT 0,
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "updatedAt" TIMESTAMP DEFAULT NOW(),
  UNIQUE("tenantId", code),
  CONSTRAINT fk_rankdef_tenant FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id)
);
CREATE INDEX IF NOT EXISTS idx_rankdef_tenantid ON "RankDefinition"("tenantId");

-- Step 2: Create TrainingItem table
CREATE TABLE IF NOT EXISTS "TrainingItem" (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  regulation TEXT,
  category TEXT,
  "validityYears" INTEGER,
  "sortOrder" INTEGER DEFAULT 0,
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "updatedAt" TIMESTAMP DEFAULT NOW(),
  UNIQUE("tenantId", code),
  CONSTRAINT fk_trainingitem_tenant FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id)
);
CREATE INDEX IF NOT EXISTS idx_trainingitem_tenantid ON "TrainingItem"("tenantId");

-- Step 3: Create RankTrainingRequirement table
CREATE TABLE IF NOT EXISTS "RankTrainingRequirement" (
  id TEXT PRIMARY KEY,
  "rankDefinitionId" TEXT NOT NULL,
  "trainingItemId" TEXT NOT NULL,
  level TEXT NOT NULL,
  "validityYears" INTEGER,
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "updatedAt" TIMESTAMP DEFAULT NOW(),
  UNIQUE("rankDefinitionId", "trainingItemId"),
  CONSTRAINT fk_rtr_rankdef FOREIGN KEY ("rankDefinitionId") REFERENCES "RankDefinition"(id) ON DELETE CASCADE,
  CONSTRAINT fk_rtr_trainingitem FOREIGN KEY ("trainingItemId") REFERENCES "TrainingItem"(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_rtr_rankdefid ON "RankTrainingRequirement"("rankDefinitionId");
CREATE INDEX IF NOT EXISTS idx_rtr_trainingitemid ON "RankTrainingRequirement"("trainingItemId");

-- Step 4: Create CrewTrainingRecord table
CREATE TABLE IF NOT EXISTS "CrewTrainingRecord" (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "crewId" TEXT NOT NULL,
  "trainingItemId" TEXT NOT NULL,
  "completedAt" TIMESTAMP NOT NULL,
  "expiryDate" TIMESTAMP,
  "docUrl" TEXT,
  notes TEXT,
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "updatedAt" TIMESTAMP DEFAULT NOW(),
  UNIQUE("crewId", "trainingItemId"),
  CONSTRAINT fk_ctr_crew FOREIGN KEY ("crewId") REFERENCES "Crew"(id) ON DELETE CASCADE,
  CONSTRAINT fk_ctr_trainingitem FOREIGN KEY ("trainingItemId") REFERENCES "TrainingItem"(id)
);
CREATE INDEX IF NOT EXISTS idx_ctr_tenantid ON "CrewTrainingRecord"("tenantId");
CREATE INDEX IF NOT EXISTS idx_ctr_crewid ON "CrewTrainingRecord"("crewId");
CREATE INDEX IF NOT EXISTS idx_ctr_trainingitemid ON "CrewTrainingRecord"("trainingItemId");
CREATE INDEX IF NOT EXISTS idx_ctr_expirydate ON "CrewTrainingRecord"("expiryDate");

-- Step 5: Add rankId and rankDefinition relation to Crew (if not already present)
-- Check if column exists before adding
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='Crew' AND column_name='rankId') THEN
    ALTER TABLE "Crew" ADD COLUMN "rankId" TEXT;
    ALTER TABLE "Crew" ADD CONSTRAINT fk_crew_rankdef FOREIGN KEY ("rankId") REFERENCES "RankDefinition"(id);
  END IF;

  -- Remove old rank enum column if it exists (backup: SELECT DISTINCT rank FROM "Crew" before running)
  -- Note: Keep CrewRank enum for now; don't drop yet for backward compatibility
END $$;

-- Step 6: Populate RankDefinition with hardcoded CrewRank values for each tenant
-- This creates the 21 standard ranks for all tenants
DO $$
DECLARE
  v_tenant_id TEXT;
  v_rank_code TEXT;
  v_rank_name TEXT;
  v_sort_order INT;
  rank_mapping RECORD;
BEGIN
  -- Mapping of CrewRank enum values to codes and names (in Spanish/Portuguese as needed)
  -- This will be tenant-specific later, but for now we use default names

  FOR v_tenant_id IN SELECT id FROM "Tenant" WHERE status='ACTIVE' LOOP
    v_sort_order := 0;

    -- Insert standard ranks for all tenants
    INSERT INTO "RankDefinition" (id, "tenantId", code, name, "sortOrder", "createdAt", "updatedAt")
    VALUES
      (concat('rank_', v_tenant_id, '_01'), v_tenant_id, 'CAPTAIN', 'Capitán/Comandante', v_sort_order, NOW(), NOW()),
      (concat('rank_', v_tenant_id, '_02'), v_tenant_id, 'CHIEF_OFFICER', 'Oficial Jefe', v_sort_order+1, NOW(), NOW()),
      (concat('rank_', v_tenant_id, '_03'), v_tenant_id, 'SECOND_OFFICER', 'Segundo Oficial', v_sort_order+2, NOW(), NOW()),
      (concat('rank_', v_tenant_id, '_04'), v_tenant_id, 'THIRD_OFFICER', 'Tercer Oficial', v_sort_order+3, NOW(), NOW()),
      (concat('rank_', v_tenant_id, '_05'), v_tenant_id, 'CHIEF_ENGINEER', 'Jefe de Máquinas', v_sort_order+4, NOW(), NOW()),
      (concat('rank_', v_tenant_id, '_06'), v_tenant_id, 'SECOND_ENGINEER', 'Segundo Ingeniero', v_sort_order+5, NOW(), NOW()),
      (concat('rank_', v_tenant_id, '_07'), v_tenant_id, 'THIRD_ENGINEER', 'Tercer Ingeniero', v_sort_order+6, NOW(), NOW()),
      (concat('rank_', v_tenant_id, '_08'), v_tenant_id, 'FOURTH_ENGINEER', 'Cuarto Ingeniero', v_sort_order+7, NOW(), NOW()),
      (concat('rank_', v_tenant_id, '_09'), v_tenant_id, 'ELECTRICIAN', 'Electricista', v_sort_order+8, NOW(), NOW()),
      (concat('rank_', v_tenant_id, '_10'), v_tenant_id, 'BOSUN', 'Contramaestre', v_sort_order+9, NOW(), NOW()),
      (concat('rank_', v_tenant_id, '_11'), v_tenant_id, 'AB_SEAMAN', 'Marinero de 1ª', v_sort_order+10, NOW(), NOW()),
      (concat('rank_', v_tenant_id, '_12'), v_tenant_id, 'OS_SEAMAN', 'Marinero de 2ª', v_sort_order+11, NOW(), NOW()),
      (concat('rank_', v_tenant_id, '_13'), v_tenant_id, 'OILER', 'Aceitero', v_sort_order+12, NOW(), NOW()),
      (concat('rank_', v_tenant_id, '_14'), v_tenant_id, 'WIPER', 'Limpiador', v_sort_order+13, NOW(), NOW()),
      (concat('rank_', v_tenant_id, '_15'), v_tenant_id, 'COOK', 'Cocinero', v_sort_order+14, NOW(), NOW()),
      (concat('rank_', v_tenant_id, '_16'), v_tenant_id, 'STEWARD', 'Camarero', v_sort_order+15, NOW(), NOW()),
      (concat('rank_', v_tenant_id, '_17'), v_tenant_id, 'CADET', 'Cadete', v_sort_order+16, NOW(), NOW()),
      (concat('rank_', v_tenant_id, '_18'), v_tenant_id, 'RADIO_OPERATOR', 'Operador de Radio', v_sort_order+17, NOW(), NOW()),
      (concat('rank_', v_tenant_id, '_19'), v_tenant_id, 'PILOT', 'Práctico', v_sort_order+18, NOW(), NOW()),
      (concat('rank_', v_tenant_id, '_20'), v_tenant_id, 'PILOTIN', 'Patiño', v_sort_order+19, NOW(), NOW()),
      (concat('rank_', v_tenant_id, '_21'), v_tenant_id, 'OTHER', 'Otro', v_sort_order+20, NOW(), NOW())
    ON CONFLICT ("tenantId", code) DO NOTHING;
  END LOOP;
END $$;

-- Step 7: Migrate Crew.rank enum values to rankId ForeignKey
-- Map each rank enum to its corresponding RankDefinition.id
DO $$
DECLARE
  v_crew_id TEXT;
  v_tenant_id TEXT;
  v_rank_enum TEXT;
  v_rank_id TEXT;
  v_rank_code TEXT;
BEGIN
  FOR v_crew_id, v_tenant_id, v_rank_enum IN
    SELECT id, "tenantId", rank::text FROM "Crew" WHERE "rankId" IS NULL AND rank IS NOT NULL
  LOOP
    -- Map enum text to our standard codes (already created above)
    v_rank_code := v_rank_enum; -- They should match

    -- Find the rankDefinition id
    SELECT id INTO v_rank_id FROM "RankDefinition"
    WHERE "tenantId" = v_tenant_id AND code = v_rank_code LIMIT 1;

    -- Update Crew with rankId
    IF v_rank_id IS NOT NULL THEN
      UPDATE "Crew" SET "rankId" = v_rank_id WHERE id = v_crew_id;
    END IF;
  END LOOP;
END $$;

-- Step 8: Verify migration
SELECT 'Migration completed!' as status;
SELECT COUNT(*) as rank_definitions_created FROM "RankDefinition";
SELECT COUNT(*) as crew_with_rankid FROM "Crew" WHERE "rankId" IS NOT NULL;
SELECT COUNT(*) as crew_still_using_enum FROM "Crew" WHERE "rankId" IS NULL AND rank IS NOT NULL;
