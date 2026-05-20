-- Seed: RankTrainingRequirement para mercurio & demo (Spanish default mapping)
-- Maps 21 standard deck/engine/service ranks × ~38 training items
-- Simplified CEOP-like matrix with OBRIGATORIO, VALIDO, DESEJAVEL levels
-- Idioma: Español
-- Tenants: mercurio, demo

DO $$
DECLARE
  tenant_rec RECORD;
  rank_row RECORD;
  item_row RECORD;
BEGIN
  -- Process for both mercurio and demo tenants
  FOR tenant_rec IN SELECT id, slug FROM "Tenant" WHERE slug IN ('mercurio', 'demo')
  LOOP
    -- Note: Do NOT delete existing requirements. ON CONFLICT clause will update them.

    -- CAPTAIN (Capitán/Comandante) - All STCW deck, mandatory safety
    FOR rank_row IN SELECT id, code FROM "RankDefinition" WHERE "tenantId" = tenant_rec.id AND code = 'CAPTAIN'
    LOOP
      FOR item_row IN SELECT id, code FROM "TrainingItem" WHERE "tenantId" = tenant_rec.id
        AND code IN ('STCW_II_1_B', 'STCW_II_1_C', 'STCW_VI_1', 'STCW_VI_2', 'STCW_VI_4',
                      'AFD', 'LSA', 'SEAMANSHIP', concat(tenant_rec.slug, '_ISM'), concat(tenant_rec.slug, '_SAFETY'),
                      'ECDIS_BASIC', 'ECDIS_ADVANCED', 'MARPOL_BASIC', 'PSC_PORT_STATE', 'VOYAGE_PLANNING')
      LOOP
        INSERT INTO "RankTrainingRequirement" (id, "rankDefinitionId", "trainingItemId", level, "validityYears", "createdAt", "updatedAt")
        VALUES (
          concat('req_', rank_row.id, '_', item_row.id),
          rank_row.id,
          item_row.id,
          CASE WHEN item_row.code IN ('STCW_II_1_B', 'STCW_VI_1', 'STCW_VI_2', concat(tenant_rec.slug, '_ISM'), concat(tenant_rec.slug, '_SAFETY'))
               THEN 'OBRIGATORIO'
               WHEN item_row.code IN ('ECDIS_BASIC', 'AFD', 'LSA', 'VOYAGE_PLANNING')
               THEN 'VALIDO'
               ELSE 'DESEJAVEL' END,
          5, NOW(), NOW()
        ) ON CONFLICT ("rankDefinitionId", "trainingItemId") DO NOTHING;
      END LOOP;
    END LOOP;

    -- CHIEF_OFFICER (Oficial Jefe) - Deck STCW level 1
    FOR rank_row IN SELECT id, code FROM "RankDefinition" WHERE "tenantId" = tenant_rec.id AND code = 'CHIEF_OFFICER'
    LOOP
      FOR item_row IN SELECT id, code FROM "TrainingItem" WHERE "tenantId" = tenant_rec.id
        AND code IN ('STCW_II_1_A', 'STCW_II_1_C', 'STCW_VI_1', 'STCW_VI_2', 'STCW_VI_4',
                      'AFD', 'LSA', 'SEAMANSHIP', concat(tenant_rec.slug, '_ISM'), concat(tenant_rec.slug, '_SAFETY'), 'ECDIS_BASIC')
      LOOP
        INSERT INTO "RankTrainingRequirement" (id, "rankDefinitionId", "trainingItemId", level, "validityYears", "createdAt", "updatedAt")
        VALUES (
          concat('req_', rank_row.id, '_', item_row.id),
          rank_row.id,
          item_row.id,
          CASE WHEN item_row.code IN ('STCW_II_1_A', 'STCW_VI_1', 'STCW_VI_2', concat(tenant_rec.slug, '_ISM'))
               THEN 'OBRIGATORIO'
               WHEN item_row.code IN ('AFD', 'LSA', 'ECDIS_BASIC')
               THEN 'VALIDO'
               ELSE 'DESEJAVEL' END,
          5, NOW(), NOW()
        ) ON CONFLICT ("rankDefinitionId", "trainingItemId") DO NOTHING;
      END LOOP;
    END LOOP;

    -- CHIEF_ENGINEER (Jefe de Máquinas) - Engine STCW
    FOR rank_row IN SELECT id, code FROM "RankDefinition" WHERE "tenantId" = tenant_rec.id AND code = 'CHIEF_ENGINEER'
    LOOP
      FOR item_row IN SELECT id, code FROM "TrainingItem" WHERE "tenantId" = tenant_rec.id
        AND code IN ('STCW_III_1_B', 'STCW_III_1_C', 'STCW_VI_1', 'STCW_VI_2', 'STCW_VI_4',
                      'REG_SAFETY', 'REG_ENV', concat(tenant_rec.slug, '_ISM'), concat(tenant_rec.slug, '_SAFETY'), concat(tenant_rec.slug, '_ENV'),
                      'MAINTENANCE', 'DRILLS_EXERCISES')
      LOOP
        INSERT INTO "RankTrainingRequirement" (id, "rankDefinitionId", "trainingItemId", level, "validityYears", "createdAt", "updatedAt")
        VALUES (
          concat('req_', rank_row.id, '_', item_row.id),
          rank_row.id,
          item_row.id,
          CASE WHEN item_row.code IN ('STCW_III_1_B', 'STCW_VI_1', 'STCW_VI_2', concat(tenant_rec.slug, '_ISM'))
               THEN 'OBRIGATORIO'
               WHEN item_row.code IN ('STCW_VI_4', 'REG_SAFETY', 'REG_ENV')
               THEN 'VALIDO'
               ELSE 'DESEJAVEL' END,
          5, NOW(), NOW()
        ) ON CONFLICT ("rankDefinitionId", "trainingItemId") DO NOTHING;
      END LOOP;
    END LOOP;

    -- SECOND_OFFICER (Segundo Oficial) - Deck officer
    FOR rank_row IN SELECT id, code FROM "RankDefinition" WHERE "tenantId" = tenant_rec.id AND code = 'SECOND_OFFICER'
    LOOP
      FOR item_row IN SELECT id, code FROM "TrainingItem" WHERE "tenantId" = tenant_rec.id
        AND code IN ('STCW_II_1_C', 'STCW_VI_1', 'STCW_VI_2', 'STCW_VI_4',
                      'LSA', 'SEAMANSHIP', concat(tenant_rec.slug, '_ISM'), concat(tenant_rec.slug, '_SAFETY'), 'ECDIS_BASIC', 'VOYAGE_PLANNING')
      LOOP
        INSERT INTO "RankTrainingRequirement" (id, "rankDefinitionId", "trainingItemId", level, "validityYears", "createdAt", "updatedAt")
        VALUES (
          concat('req_', rank_row.id, '_', item_row.id),
          rank_row.id,
          item_row.id,
          CASE WHEN item_row.code IN ('STCW_VI_1', 'STCW_VI_2', concat(tenant_rec.slug, '_SAFETY'))
               THEN 'OBRIGATORIO'
               WHEN item_row.code IN ('LSA', 'ECDIS_BASIC', 'SEAMANSHIP')
               THEN 'VALIDO'
               ELSE 'DESEJAVEL' END,
          3, NOW(), NOW()
        ) ON CONFLICT ("rankDefinitionId", "trainingItemId") DO NOTHING;
      END LOOP;
    END LOOP;

    -- SECOND_ENGINEER (Segundo Ingeniero) - Engine officer
    FOR rank_row IN SELECT id, code FROM "RankDefinition" WHERE "tenantId" = tenant_rec.id AND code = 'SECOND_ENGINEER'
    LOOP
      FOR item_row IN SELECT id, code FROM "TrainingItem" WHERE "tenantId" = tenant_rec.id
        AND code IN ('STCW_III_1_C', 'STCW_VI_1', 'STCW_VI_2', 'STCW_VI_4',
                      'REG_SAFETY', concat(tenant_rec.slug, '_SAFETY'), 'MAINTENANCE', 'DRILLS_EXERCISES')
      LOOP
        INSERT INTO "RankTrainingRequirement" (id, "rankDefinitionId", "trainingItemId", level, "validityYears", "createdAt", "updatedAt")
        VALUES (
          concat('req_', rank_row.id, '_', item_row.id),
          rank_row.id,
          item_row.id,
          CASE WHEN item_row.code IN ('STCW_VI_1', 'STCW_VI_2', concat(tenant_rec.slug, '_SAFETY'))
               THEN 'OBRIGATORIO'
               WHEN item_row.code IN ('STCW_VI_4', 'REG_SAFETY')
               THEN 'VALIDO'
               ELSE 'DESEJAVEL' END,
          3, NOW(), NOW()
        ) ON CONFLICT ("rankDefinitionId", "trainingItemId") DO NOTHING;
      END LOOP;
    END LOOP;

    -- BOSUN (Contramaestre) - Safety + NR, some deck
    FOR rank_row IN SELECT id, code FROM "RankDefinition" WHERE "tenantId" = tenant_rec.id AND code = 'BOSUN'
    LOOP
      FOR item_row IN SELECT id, code FROM "TrainingItem" WHERE "tenantId" = tenant_rec.id
        AND code IN ('STCW_VI_1', 'STCW_VI_2', 'STCW_VI_4', 'LSA', 'SEAMANSHIP',
                      concat(tenant_rec.slug, '_ISM'), concat(tenant_rec.slug, '_SAFETY'), 'PSCRB', 'MAINTENANCE', 'DRILLS_EXERCISES')
      LOOP
        INSERT INTO "RankTrainingRequirement" (id, "rankDefinitionId", "trainingItemId", level, "validityYears", "createdAt", "updatedAt")
        VALUES (
          concat('req_', rank_row.id, '_', item_row.id),
          rank_row.id,
          item_row.id,
          CASE WHEN item_row.code IN ('STCW_VI_2', concat(tenant_rec.slug, '_SAFETY'))
               THEN 'OBRIGATORIO'
               WHEN item_row.code IN ('STCW_VI_1', 'STCW_VI_4', 'LSA', 'MAINTENANCE')
               THEN 'VALIDO'
               ELSE 'DESEJAVEL' END,
          3, NOW(), NOW()
        ) ON CONFLICT ("rankDefinitionId", "trainingItemId") DO NOTHING;
      END LOOP;
    END LOOP;

    -- AB_SEAMAN (Marinero de 1ª) - Basic safety
    FOR rank_row IN SELECT id, code FROM "RankDefinition" WHERE "tenantId" = tenant_rec.id AND code = 'AB_SEAMAN'
    LOOP
      FOR item_row IN SELECT id, code FROM "TrainingItem" WHERE "tenantId" = tenant_rec.id
        AND code IN ('STCW_VI_1', 'STCW_VI_2', 'STCW_VI_4', 'LSA', 'SEAMANSHIP',
                      concat(tenant_rec.slug, '_INDUCTION'), concat(tenant_rec.slug, '_SAFETY'), 'DRILLS_EXERCISES')
      LOOP
        INSERT INTO "RankTrainingRequirement" (id, "rankDefinitionId", "trainingItemId", level, "validityYears", "createdAt", "updatedAt")
        VALUES (
          concat('req_', rank_row.id, '_', item_row.id),
          rank_row.id,
          item_row.id,
          CASE WHEN item_row.code IN ('STCW_VI_2', concat(tenant_rec.slug, '_INDUCTION'))
               THEN 'OBRIGATORIO'
               WHEN item_row.code IN ('STCW_VI_1', 'STCW_VI_4', 'LSA')
               THEN 'VALIDO'
               ELSE 'DESEJAVEL' END,
          2, NOW(), NOW()
        ) ON CONFLICT ("rankDefinitionId", "trainingItemId") DO NOTHING;
      END LOOP;
    END LOOP;

    -- OILER (Aceitero) - Basic engine + safety
    FOR rank_row IN SELECT id, code FROM "RankDefinition" WHERE "tenantId" = tenant_rec.id AND code = 'OILER'
    LOOP
      FOR item_row IN SELECT id, code FROM "TrainingItem" WHERE "tenantId" = tenant_rec.id
        AND code IN ('STCW_VI_1', 'STCW_VI_2', 'REG_SAFETY', concat(tenant_rec.slug, '_INDUCTION'),
                      concat(tenant_rec.slug, '_SAFETY'), concat(tenant_rec.slug, '_ENV'), 'MAINTENANCE', 'DRILLS_EXERCISES')
      LOOP
        INSERT INTO "RankTrainingRequirement" (id, "rankDefinitionId", "trainingItemId", level, "validityYears", "createdAt", "updatedAt")
        VALUES (
          concat('req_', rank_row.id, '_', item_row.id),
          rank_row.id,
          item_row.id,
          CASE WHEN item_row.code IN ('STCW_VI_2', concat(tenant_rec.slug, '_INDUCTION'))
               THEN 'OBRIGATORIO'
               WHEN item_row.code IN ('STCW_VI_1', 'REG_SAFETY', 'MAINTENANCE')
               THEN 'VALIDO'
               ELSE 'DESEJAVEL' END,
          2, NOW(), NOW()
        ) ON CONFLICT ("rankDefinitionId", "trainingItemId") DO NOTHING;
      END LOOP;
    END LOOP;

    -- COOK (Cocinero) - Basic safety + company induction
    FOR rank_row IN SELECT id, code FROM "RankDefinition" WHERE "tenantId" = tenant_rec.id AND code = 'COOK'
    LOOP
      FOR item_row IN SELECT id, code FROM "TrainingItem" WHERE "tenantId" = tenant_rec.id
        AND code IN ('STCW_VI_1', 'STCW_VI_2', 'STCW_VI_4', concat(tenant_rec.slug, '_INDUCTION'),
                      concat(tenant_rec.slug, '_SAFETY'), 'MEDICAL_FIRST_AID', 'DRILLS_EXERCISES')
      LOOP
        INSERT INTO "RankTrainingRequirement" (id, "rankDefinitionId", "trainingItemId", level, "validityYears", "createdAt", "updatedAt")
        VALUES (
          concat('req_', rank_row.id, '_', item_row.id),
          rank_row.id,
          item_row.id,
          CASE WHEN item_row.code IN ('STCW_VI_2', concat(tenant_rec.slug, '_INDUCTION'), concat(tenant_rec.slug, '_SAFETY'))
               THEN 'OBRIGATORIO'
               WHEN item_row.code IN ('STCW_VI_1', 'STCW_VI_4')
               THEN 'VALIDO'
               ELSE 'DESEJAVEL' END,
          2, NOW(), NOW()
        ) ON CONFLICT ("rankDefinitionId", "trainingItemId") DO NOTHING;
      END LOOP;
    END LOOP;

    -- STEWARD (Camarero) - Basic induction + safety
    FOR rank_row IN SELECT id, code FROM "RankDefinition" WHERE "tenantId" = tenant_rec.id AND code = 'STEWARD'
    LOOP
      FOR item_row IN SELECT id, code FROM "TrainingItem" WHERE "tenantId" = tenant_rec.id
        AND code IN ('STCW_VI_1', 'STCW_VI_2', concat(tenant_rec.slug, '_INDUCTION'),
                      concat(tenant_rec.slug, '_SAFETY'), 'DRILLS_EXERCISES')
      LOOP
        INSERT INTO "RankTrainingRequirement" (id, "rankDefinitionId", "trainingItemId", level, "validityYears", "createdAt", "updatedAt")
        VALUES (
          concat('req_', rank_row.id, '_', item_row.id),
          rank_row.id,
          item_row.id,
          CASE WHEN item_row.code IN ('STCW_VI_2', concat(tenant_rec.slug, '_INDUCTION'))
               THEN 'OBRIGATORIO'
               WHEN item_row.code IN ('STCW_VI_1')
               THEN 'VALIDO'
               ELSE 'DESEJAVEL' END,
          1, NOW(), NOW()
        ) ON CONFLICT ("rankDefinitionId", "trainingItemId") DO NOTHING;
      END LOOP;
    END LOOP;

    RAISE NOTICE 'Rank training requirements seeded for tenant %: matrix populated', tenant_rec.slug;
  END LOOP;

END $$;
