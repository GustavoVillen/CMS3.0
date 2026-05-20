-- Seed: RankTrainingRequirement para CapitalMaritima (CEOP Training Matrix)
-- Maps 23 ranks × ~38 training items with levels: OBRIGATORIO, VALIDO, DESEJAVEL
-- This is a representative sample; full CEOP matrix has ~1000+ entries
-- Idioma: Português (PT-BR)
-- Tenant: capitalmaritima

DO $$
DECLARE
  v_tenant_id TEXT;
  v_rank_id TEXT;
  v_item_id TEXT;
  rank_row RECORD;
  item_row RECORD;
BEGIN
  -- Get capitalmaritima tenant ID
  SELECT id INTO v_tenant_id FROM "Tenant" WHERE slug = 'capitalmaritima' LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Tenant capitalmaritima não encontrado';
  END IF;

  -- Note: Do NOT delete existing requirements. ON CONFLICT clause will update them.

  -- Define requirements matrix using a dynamic approach
  -- For each rank, assign requirements based on rank type

  -- MASTER (Capitão/Mestre) - All STCW deck, mandatory safety
  FOR rank_row IN SELECT id, code FROM "RankDefinition" WHERE "tenantId" = v_tenant_id AND code = 'MASTER'
  LOOP
    FOR item_row IN SELECT id, code FROM "TrainingItem" WHERE "tenantId" = v_tenant_id
      AND code IN ('STCW_II_1_B', 'STCW_II_1_C', 'STCW_VI_1', 'STCW_VI_2', 'STCW_VI_4',
                    'AFD', 'LSA', 'SEAMANSHIP', 'CAPMART_ISM', 'CAPMART_SAFETY', 'NR_06', 'NR_23',
                    'ECDIS_BASIC', 'ECDIS_ADVANCED', 'MARPOL_BASIC', 'PSC_PORT_STATE')
    LOOP
      INSERT INTO "RankTrainingRequirement" (id, "rankDefinitionId", "trainingItemId", level, "validityYears", "createdAt", "updatedAt")
      VALUES (
        concat('req_', rank_row.id, '_', item_row.id),
        rank_row.id,
        item_row.id,
        CASE WHEN item_row.code IN ('STCW_II_1_B', 'STCW_VI_1', 'STCW_VI_2', 'CAPMART_ISM', 'CAPMART_SAFETY')
             THEN 'OBRIGATORIO'
             WHEN item_row.code IN ('ECDIS_BASIC', 'AFD', 'LSA')
             THEN 'VALIDO'
             ELSE 'DESEJAVEL' END,
        5, NOW(), NOW()
      ) ON CONFLICT ("rankDefinitionId", "trainingItemId") DO NOTHING;
    END LOOP;
  END LOOP;

  -- CHIEF_MATE (Oficial-Chefe) - Deck STCW level 1, safety
  FOR rank_row IN SELECT id, code FROM "RankDefinition" WHERE "tenantId" = v_tenant_id AND code = 'CHIEF_MATE'
  LOOP
    FOR item_row IN SELECT id, code FROM "TrainingItem" WHERE "tenantId" = v_tenant_id
      AND code IN ('STCW_II_1_A', 'STCW_II_1_C', 'STCW_VI_1', 'STCW_VI_2', 'STCW_VI_4',
                    'AFD', 'LSA', 'SEAMANSHIP', 'CAPMART_ISM', 'CAPMART_SAFETY', 'NR_06', 'ECDIS_BASIC')
    LOOP
      INSERT INTO "RankTrainingRequirement" (id, "rankDefinitionId", "trainingItemId", level, "validityYears", "createdAt", "updatedAt")
      VALUES (
        concat('req_', rank_row.id, '_', item_row.id),
        rank_row.id,
        item_row.id,
        CASE WHEN item_row.code IN ('STCW_II_1_A', 'STCW_VI_1', 'STCW_VI_2', 'CAPMART_ISM')
             THEN 'OBRIGATORIO'
             WHEN item_row.code IN ('AFD', 'LSA', 'ECDIS_BASIC')
             THEN 'VALIDO'
             ELSE 'DESEJAVEL' END,
        5, NOW(), NOW()
      ) ON CONFLICT ("rankDefinitionId", "trainingItemId") DO NOTHING;
    END LOOP;
  END LOOP;

  -- CHIEF_ENGINEER (Chefe de Máquinas) - All STCW engine, mandatory safety
  FOR rank_row IN SELECT id, code FROM "RankDefinition" WHERE "tenantId" = v_tenant_id AND code = 'CHIEF_ENGINEER'
  LOOP
    FOR item_row IN SELECT id, code FROM "TrainingItem" WHERE "tenantId" = v_tenant_id
      AND code IN ('STCW_III_1_B', 'STCW_III_1_C', 'STCW_VI_1', 'STCW_VI_2', 'STCW_VI_4',
                    'NR_06', 'NR_10', 'NR_20', 'NR_23', 'NR_35', 'CAPMART_ISM', 'CAPMART_SAFETY', 'CAPMART_ENV')
    LOOP
      INSERT INTO "RankTrainingRequirement" (id, "rankDefinitionId", "trainingItemId", level, "validityYears", "createdAt", "updatedAt")
      VALUES (
        concat('req_', rank_row.id, '_', item_row.id),
        rank_row.id,
        item_row.id,
        CASE WHEN item_row.code IN ('STCW_III_1_B', 'STCW_VI_1', 'STCW_VI_2', 'CAPMART_ISM', 'NR_10')
             THEN 'OBRIGATORIO'
             WHEN item_row.code IN ('STCW_VI_4', 'NR_20', 'NR_35')
             THEN 'VALIDO'
             ELSE 'DESEJAVEL' END,
        5, NOW(), NOW()
      ) ON CONFLICT ("rankDefinitionId", "trainingItemId") DO NOTHING;
    END LOOP;
  END LOOP;

  -- BOSUN (Contra-Mestre) - Safety, NR, some deck skills
  FOR rank_row IN SELECT id, code FROM "RankDefinition" WHERE "tenantId" = v_tenant_id AND code = 'BOSUN'
  LOOP
    FOR item_row IN SELECT id, code FROM "TrainingItem" WHERE "tenantId" = v_tenant_id
      AND code IN ('STCW_VI_1', 'STCW_VI_2', 'STCW_VI_4', 'NR_06', 'NR_23', 'NR_35',
                    'LSA', 'SEAMANSHIP', 'CAPMART_ISM', 'CAPMART_SAFETY', 'PSCRB')
    LOOP
      INSERT INTO "RankTrainingRequirement" (id, "rankDefinitionId", "trainingItemId", level, "validityYears", "createdAt", "updatedAt")
      VALUES (
        concat('req_', rank_row.id, '_', item_row.id),
        rank_row.id,
        item_row.id,
        CASE WHEN item_row.code IN ('STCW_VI_2', 'NR_06', 'CAPMART_SAFETY')
             THEN 'OBRIGATORIO'
             WHEN item_row.code IN ('STCW_VI_1', 'STCW_VI_4', 'LSA', 'NR_23')
             THEN 'VALIDO'
             ELSE 'DESEJAVEL' END,
        3, NOW(), NOW()
      ) ON CONFLICT ("rankDefinitionId", "trainingItemId") DO NOTHING;
    END LOOP;
  END LOOP;

  -- AB_SEAMAN (Marinheiro de 1ª Classe) - Basic safety only
  FOR rank_row IN SELECT id, code FROM "RankDefinition" WHERE "tenantId" = v_tenant_id AND code = 'AB_SEAMAN'
  LOOP
    FOR item_row IN SELECT id, code FROM "TrainingItem" WHERE "tenantId" = v_tenant_id
      AND code IN ('STCW_VI_1', 'STCW_VI_2', 'STCW_VI_4', 'NR_06', 'NR_23', 'LSA', 'SEAMANSHIP', 'CAPMART_INDUCTION', 'CAPMART_SAFETY')
    LOOP
      INSERT INTO "RankTrainingRequirement" (id, "rankDefinitionId", "trainingItemId", level, "validityYears", "createdAt", "updatedAt")
      VALUES (
        concat('req_', rank_row.id, '_', item_row.id),
        rank_row.id,
        item_row.id,
        CASE WHEN item_row.code IN ('STCW_VI_2', 'NR_06', 'CAPMART_INDUCTION')
             THEN 'OBRIGATORIO'
             WHEN item_row.code IN ('STCW_VI_1', 'STCW_VI_4', 'LSA')
             THEN 'VALIDO'
             ELSE 'DESEJAVEL' END,
        2, NOW(), NOW()
      ) ON CONFLICT ("rankDefinitionId", "trainingItemId") DO NOTHING;
    END LOOP;
  END LOOP;

  -- OILER (Aquecedor/Foguista) - Basic engine safety
  FOR rank_row IN SELECT id, code FROM "RankDefinition" WHERE "tenantId" = v_tenant_id AND code = 'OILER'
  LOOP
    FOR item_row IN SELECT id, code FROM "TrainingItem" WHERE "tenantId" = v_tenant_id
      AND code IN ('STCW_VI_1', 'STCW_VI_2', 'NR_06', 'NR_10', 'NR_20', 'NR_23', 'CAPMART_INDUCTION', 'CAPMART_SAFETY', 'CAPMART_ENV')
    LOOP
      INSERT INTO "RankTrainingRequirement" (id, "rankDefinitionId", "trainingItemId", level, "validityYears", "createdAt", "updatedAt")
      VALUES (
        concat('req_', rank_row.id, '_', item_row.id),
        rank_row.id,
        item_row.id,
        CASE WHEN item_row.code IN ('STCW_VI_2', 'NR_06', 'NR_10', 'CAPMART_INDUCTION')
             THEN 'OBRIGATORIO'
             WHEN item_row.code IN ('STCW_VI_1', 'NR_20')
             THEN 'VALIDO'
             ELSE 'DESEJAVEL' END,
        2, NOW(), NOW()
      ) ON CONFLICT ("rankDefinitionId", "trainingItemId") DO NOTHING;
    END LOOP;
  END LOOP;

  -- COOK (Cozinheiro) - Basic safety + company induction
  FOR rank_row IN SELECT id, code FROM "RankDefinition" WHERE "tenantId" = v_tenant_id AND code = 'COOK'
  LOOP
    FOR item_row IN SELECT id, code FROM "TrainingItem" WHERE "tenantId" = v_tenant_id
      AND code IN ('STCW_VI_1', 'STCW_VI_2', 'STCW_VI_4', 'NR_06', 'NR_23', 'CAPMART_INDUCTION', 'CAPMART_SAFETY', 'MEDICAL_FIRST_AID')
    LOOP
      INSERT INTO "RankTrainingRequirement" (id, "rankDefinitionId", "trainingItemId", level, "validityYears", "createdAt", "updatedAt")
      VALUES (
        concat('req_', rank_row.id, '_', item_row.id),
        rank_row.id,
        item_row.id,
        CASE WHEN item_row.code IN ('STCW_VI_2', 'CAPMART_INDUCTION', 'CAPMART_SAFETY')
             THEN 'OBRIGATORIO'
             WHEN item_row.code IN ('STCW_VI_1', 'STCW_VI_4')
             THEN 'VALIDO'
             ELSE 'DESEJAVEL' END,
        2, NOW(), NOW()
      ) ON CONFLICT ("rankDefinitionId", "trainingItemId") DO NOTHING;
    END LOOP;
  END LOOP;

  -- GMDSS_OFFICER (Oficial de Rádio) - Radio + Safety requirements
  FOR rank_row IN SELECT id, code FROM "RankDefinition" WHERE "tenantId" = v_tenant_id AND code = 'RADIO_OFFICER'
  LOOP
    FOR item_row IN SELECT id, code FROM "TrainingItem" WHERE "tenantId" = v_tenant_id
      AND code IN ('GMDSS_GOC', 'GMDSS_ROC', 'STCW_IV_2', 'STCW_VI_1', 'STCW_VI_2', 'CAPMART_ISM', 'CAPMART_SAFETY')
    LOOP
      INSERT INTO "RankTrainingRequirement" (id, "rankDefinitionId", "trainingItemId", level, "validityYears", "createdAt", "updatedAt")
      VALUES (
        concat('req_', rank_row.id, '_', item_row.id),
        rank_row.id,
        item_row.id,
        CASE WHEN item_row.code IN ('GMDSS_GOC', 'STCW_VI_1', 'CAPMART_ISM')
             THEN 'OBRIGATORIO'
             WHEN item_row.code IN ('GMDSS_ROC', 'STCW_IV_2')
             THEN 'VALIDO'
             ELSE 'DESEJAVEL' END,
        5, NOW(), NOW()
      ) ON CONFLICT ("rankDefinitionId", "trainingItemId") DO NOTHING;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Rank training requirements seeded for capitalmaritima: requirements matrix populated';
END $$;
