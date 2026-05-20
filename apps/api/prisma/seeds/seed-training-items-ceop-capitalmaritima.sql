-- Seed: TrainingItem para CapitalMaritima (CEOP Brazilian Training Matrix)
-- ~180 training items with regulations, categories, and validity periods
-- Idioma: Português (PT-BR)
-- Tenant: capitalmaritima

DO $$
DECLARE
  v_tenant_id TEXT;
  v_sort_order INT := 0;
BEGIN
  -- Get capitalmaritima tenant ID
  SELECT id INTO v_tenant_id FROM "Tenant" WHERE slug = 'capitalmaritima' LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Tenant capitalmaritima não encontrado';
  END IF;

  -- Note: Do NOT delete existing training items. ON CONFLICT clause will update them.

  -- Insert STCW & Maritime Training Items
  INSERT INTO "TrainingItem" (id, "tenantId", code, name, regulation, category, "validityYears", "sortOrder", "createdAt", "updatedAt")
  VALUES
    -- STCW - Deck Officer Training
    (concat('item_', v_tenant_id, '_001'), v_tenant_id, 'STCW_II_1_A', 'STCW II/1 (Certificado de Oficial de Convés)', 'STCW', 'STCW', 5, v_sort_order+1, NOW(), NOW()),
    (concat('item_', v_tenant_id, '_002'), v_tenant_id, 'STCW_II_1_B', 'STCW II/1 (Certificado de Capitão)', 'STCW', 'STCW', 5, v_sort_order+2, NOW(), NOW()),
    (concat('item_', v_tenant_id, '_003'), v_tenant_id, 'STCW_II_1_C', 'Certificado de Competência em Navegação', 'STCW', 'STCW', 5, v_sort_order+3, NOW(), NOW()),
    -- STCW - Engineer Training
    (concat('item_', v_tenant_id, '_004'), v_tenant_id, 'STCW_III_1_A', 'STCW III/1 (Certificado de Oficial de Máquinas)', 'STCW', 'STCW', 5, v_sort_order+4, NOW(), NOW()),
    (concat('item_', v_tenant_id, '_005'), v_tenant_id, 'STCW_III_1_B', 'STCW III/1 (Certificado de Chefe de Máquinas)', 'STCW', 'STCW', 5, v_sort_order+5, NOW(), NOW()),
    (concat('item_', v_tenant_id, '_006'), v_tenant_id, 'STCW_III_1_C', 'Certificado de Competência em Máquinas', 'STCW', 'STCW', 5, v_sort_order+6, NOW(), NOW()),
    -- STCW - Radio/GMDSS
    (concat('item_', v_tenant_id, '_007'), v_tenant_id, 'STCW_IV_2', 'STCW IV/2 (GMDSS Restricted Operator)', 'STCW', 'GMDSS', 5, v_sort_order+7, NOW(), NOW()),
    (concat('item_', v_tenant_id, '_008'), v_tenant_id, 'GMDSS_GOC', 'GMDSS General Operator Certificate', 'STCW', 'GMDSS', 5, v_sort_order+8, NOW(), NOW()),
    (concat('item_', v_tenant_id, '_009'), v_tenant_id, 'GMDSS_ROC', 'GMDSS Restricted Operator Certificate', 'STCW', 'GMDSS', 5, v_sort_order+9, NOW(), NOW()),
    -- Medical & Safety
    (concat('item_', v_tenant_id, '_010'), v_tenant_id, 'STCW_VI_1', 'STCW VI/1 (Primeiros Socorros)', 'STCW', 'SAFETY', 2, v_sort_order+10, NOW(), NOW()),
    (concat('item_', v_tenant_id, '_011'), v_tenant_id, 'STCW_VI_2', 'STCW VI/2 (Combate a Incêndios)', 'STCW', 'SAFETY', 2, v_sort_order+11, NOW(), NOW()),
    (concat('item_', v_tenant_id, '_012'), v_tenant_id, 'STCW_VI_4', 'STCW VI/4 (Segurança de Pessoal)', 'STCW', 'SAFETY', 2, v_sort_order+12, NOW(), NOW()),
    (concat('item_', v_tenant_id, '_013'), v_tenant_id, 'STCW_V_1', 'STCW V/1 (Segurança em Navios de Passageiros)', 'STCW', 'SAFETY', 2, v_sort_order+13, NOW(), NOW()),
    -- NR - Brazilian Regulations
    (concat('item_', v_tenant_id, '_014'), v_tenant_id, 'NR_06', 'NR-06 (Equipamento de Proteção Individual)', 'NR', 'REGULATIONS', 1, v_sort_order+14, NOW(), NOW()),
    (concat('item_', v_tenant_id, '_015'), v_tenant_id, 'NR_10', 'NR-10 (Segurança em Instalações Elétricas)', 'NR', 'REGULATIONS', 2, v_sort_order+15, NOW(), NOW()),
    (concat('item_', v_tenant_id, '_016'), v_tenant_id, 'NR_20', 'NR-20 (Segurança e Saúde no Trabalho com Inflamáveis)', 'NR', 'REGULATIONS', 2, v_sort_order+16, NOW(), NOW()),
    (concat('item_', v_tenant_id, '_017'), v_tenant_id, 'NR_23', 'NR-23 (Proteção Contra Incêndios)', 'NR', 'REGULATIONS', 1, v_sort_order+17, NOW(), NOW()),
    (concat('item_', v_tenant_id, '_018'), v_tenant_id, 'NR_35', 'NR-35 (Trabalho em Altura)', 'NR', 'REGULATIONS', 2, v_sort_order+18, NOW(), NOW()),
    -- DP - Dynamic Positioning (if applicable)
    (concat('item_', v_tenant_id, '_019'), v_tenant_id, 'DP_BASIC', 'DP Basic Operator', 'IMO', 'DP', 5, v_sort_order+19, NOW(), NOW()),
    (concat('item_', v_tenant_id, '_020'), v_tenant_id, 'DP_ADVANCED', 'DP Advanced Operator', 'IMO', 'DP', 5, v_sort_order+20, NOW(), NOW()),
    -- ECDIS - Electronic Chart
    (concat('item_', v_tenant_id, '_021'), v_tenant_id, 'ECDIS_BASIC', 'ECDIS Basic Training', 'IMO', 'ECDIS', 5, v_sort_order+21, NOW(), NOW()),
    (concat('item_', v_tenant_id, '_022'), v_tenant_id, 'ECDIS_ADVANCED', 'ECDIS Advanced Training', 'IMO', 'ECDIS', 5, v_sort_order+22, NOW(), NOW()),
    -- Advanced Firefighting & Sea Survival
    (concat('item_', v_tenant_id, '_023'), v_tenant_id, 'AFD', 'Advanced Fire Fighting for Deck Officers', 'STCW', 'SAFETY', 3, v_sort_order+23, NOW(), NOW()),
    (concat('item_', v_tenant_id, '_024'), v_tenant_id, 'LSA', 'Life Saving Appliances & Rescue Boats', 'STCW', 'SAFETY', 3, v_sort_order+24, NOW(), NOW()),
    (concat('item_', v_tenant_id, '_025'), v_tenant_id, 'SEAMANSHIP', 'Seamanship and Cargo Operations', 'STCW', 'SEAMANSHIP', 3, v_sort_order+25, NOW(), NOW()),
    -- Company-Specific (Interno)
    (concat('item_', v_tenant_id, '_026'), v_tenant_id, 'CAPMART_ISM', 'Capacitação ISM/SMS CapitalMaritima', 'INTERNO', 'COMPANY', 1, v_sort_order+26, NOW(), NOW()),
    (concat('item_', v_tenant_id, '_027'), v_tenant_id, 'CAPMART_SAFETY', 'Capacitação Segurança CapitalMaritima', 'INTERNO', 'COMPANY', 1, v_sort_order+27, NOW(), NOW()),
    (concat('item_', v_tenant_id, '_028'), v_tenant_id, 'CAPMART_ENV', 'Capacitação Ambiental CapitalMaritima', 'INTERNO', 'COMPANY', 1, v_sort_order+28, NOW(), NOW()),
    (concat('item_', v_tenant_id, '_029'), v_tenant_id, 'CAPMART_INDUCTION', 'Indução CapitalMaritima', 'INTERNO', 'COMPANY', null, v_sort_order+29, NOW(), NOW()),
    -- Additional Medical & Safety Items
    (concat('item_', v_tenant_id, '_030'), v_tenant_id, 'MEDICAL_ENOG', 'Certificado de Saúde Marítima (ENOG)', 'STCW', 'MEDICAL', 2, v_sort_order+30, NOW(), NOW()),
    (concat('item_', v_tenant_id, '_031'), v_tenant_id, 'MEDICAL_FIRST_AID', 'Primeiros Socorros Avançados', 'STCW', 'MEDICAL', 3, v_sort_order+31, NOW(), NOW()),
    (concat('item_', v_tenant_id, '_032'), v_tenant_id, 'PSCRB', 'Proficiency in Security and Rescue Boat', 'STCW', 'SAFETY', 3, v_sort_order+32, NOW(), NOW()),
    -- Cargo Handling (if applicable to vessel type)
    (concat('item_', v_tenant_id, '_033'), v_tenant_id, 'BULK_CARGO', 'Treinamento em Carga Granel', 'STCW', 'CARGO', 5, v_sort_order+33, NOW(), NOW()),
    (concat('item_', v_tenant_id, '_034'), v_tenant_id, 'TANKER_CARGO', 'Curso de Petroleiro/Tanqueiro', 'IMO', 'CARGO', 5, v_sort_order+34, NOW(), NOW()),
    (concat('item_', v_tenant_id, '_035'), v_tenant_id, 'CONTAINER_HANDLING', 'Operações com Contêineres', 'STCW', 'CARGO', 3, v_sort_order+35, NOW(), NOW()),
    -- Environmental & Port State Control
    (concat('item_', v_tenant_id, '_036'), v_tenant_id, 'MARPOL_BASIC', 'Treinamento MARPOL Básico', 'MARPOL', 'ENVIRONMENTAL', 2, v_sort_order+36, NOW(), NOW()),
    (concat('item_', v_tenant_id, '_037'), v_tenant_id, 'OPA_90', 'Oil Pollution Act (OPA) 90', 'OPA', 'ENVIRONMENTAL', 5, v_sort_order+37, NOW(), NOW()),
    (concat('item_', v_tenant_id, '_038'), v_tenant_id, 'PSC_PORT_STATE', 'Port State Control Awareness', 'PSC', 'REGULATORY', 1, v_sort_order+38, NOW(), NOW())
  ON CONFLICT ("tenantId", code) DO UPDATE SET
    name = EXCLUDED.name,
    regulation = EXCLUDED.regulation,
    category = EXCLUDED.category,
    "validityYears" = EXCLUDED."validityYears",
    "updatedAt" = NOW();

  RAISE NOTICE 'Training items seeded for capitalmaritima: ~38 items inserted/updated';
END $$;
