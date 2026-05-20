-- Seed: RankDefinition para CapitalMaritima (CEOP Brazilian Standard)
-- 23 posições/ranks conforme Matriz de Treinamento CEOP
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

  -- Note: Do NOT delete existing ranks as they may be referenced by Crew records.
  -- ON CONFLICT clause will update existing ranks instead.

  -- Insert 23 CEOP ranks for capitalmaritima
  INSERT INTO "RankDefinition" (id, "tenantId", code, name, "sortOrder", "createdAt", "updatedAt")
  VALUES
    -- Convés (Deck)
    (concat('ceop_', v_tenant_id, '_01'), v_tenant_id, 'MASTER', 'Capitão/Mestre', v_sort_order, NOW(), NOW()),
    (concat('ceop_', v_tenant_id, '_02'), v_tenant_id, 'CHIEF_MATE', 'Oficial-Chefe', v_sort_order+1, NOW(), NOW()),
    (concat('ceop_', v_tenant_id, '_03'), v_tenant_id, 'FIRST_MATE', 'Primeiro Oficial', v_sort_order+2, NOW(), NOW()),
    (concat('ceop_', v_tenant_id, '_04'), v_tenant_id, 'SECOND_MATE', 'Segundo Oficial', v_sort_order+3, NOW(), NOW()),
    (concat('ceop_', v_tenant_id, '_05'), v_tenant_id, 'THIRD_MATE', 'Terceiro Oficial', v_sort_order+4, NOW(), NOW()),
    (concat('ceop_', v_tenant_id, '_06'), v_tenant_id, 'BOSUN', 'Contra-Mestre', v_sort_order+5, NOW(), NOW()),
    (concat('ceop_', v_tenant_id, '_07'), v_tenant_id, 'AB_SEAMAN', 'Marinheiro de 1ª Classe', v_sort_order+6, NOW(), NOW()),
    (concat('ceop_', v_tenant_id, '_08'), v_tenant_id, 'ORDINARY_SEAMAN', 'Marinheiro de 2ª Classe', v_sort_order+7, NOW(), NOW()),
    (concat('ceop_', v_tenant_id, '_09'), v_tenant_id, 'DECK_CADET', 'Cadete de Convés', v_sort_order+8, NOW(), NOW()),
    -- Máquinas (Engine)
    (concat('ceop_', v_tenant_id, '_10'), v_tenant_id, 'CHIEF_ENGINEER', 'Chefe de Máquinas', v_sort_order+9, NOW(), NOW()),
    (concat('ceop_', v_tenant_id, '_11'), v_tenant_id, 'FIRST_ENGINEER', 'Primeiro Engenheiro', v_sort_order+10, NOW(), NOW()),
    (concat('ceop_', v_tenant_id, '_12'), v_tenant_id, 'SECOND_ENGINEER', 'Segundo Engenheiro', v_sort_order+11, NOW(), NOW()),
    (concat('ceop_', v_tenant_id, '_13'), v_tenant_id, 'THIRD_ENGINEER', 'Terceiro Engenheiro', v_sort_order+12, NOW(), NOW()),
    (concat('ceop_', v_tenant_id, '_14'), v_tenant_id, 'CHIEF_ELECTRICIAN', 'Chefe Eletricista', v_sort_order+13, NOW(), NOW()),
    (concat('ceop_', v_tenant_id, '_15'), v_tenant_id, 'ELECTRICIAN', 'Eletricista', v_sort_order+14, NOW(), NOW()),
    (concat('ceop_', v_tenant_id, '_16'), v_tenant_id, 'OILER', 'Aquecedor/Foguista', v_sort_order+15, NOW(), NOW()),
    (concat('ceop_', v_tenant_id, '_17'), v_tenant_id, 'WIPER', 'Limpador', v_sort_order+16, NOW(), NOW()),
    (concat('ceop_', v_tenant_id, '_18'), v_tenant_id, 'ENGINE_CADET', 'Cadete de Máquinas', v_sort_order+17, NOW(), NOW()),
    -- Serviços
    (concat('ceop_', v_tenant_id, '_19'), v_tenant_id, 'CHIEF_STEWARD', 'Chefe de Comissariado', v_sort_order+18, NOW(), NOW()),
    (concat('ceop_', v_tenant_id, '_20'), v_tenant_id, 'STEWARD', 'Comissário/Camarero', v_sort_order+19, NOW(), NOW()),
    (concat('ceop_', v_tenant_id, '_21'), v_tenant_id, 'COOK', 'Cozinheiro', v_sort_order+20, NOW(), NOW()),
    (concat('ceop_', v_tenant_id, '_22'), v_tenant_id, 'RADIO_OFFICER', 'Oficial de Rádio/GMDSS', v_sort_order+21, NOW(), NOW()),
    (concat('ceop_', v_tenant_id, '_23'), v_tenant_id, 'PILOT', 'Prático', v_sort_order+22, NOW(), NOW())
  ON CONFLICT ("tenantId", code) DO UPDATE SET
    name = EXCLUDED.name,
    "updatedAt" = NOW();

  RAISE NOTICE 'CEOP ranks seeded for capitalmaritima: 23 ranks inserted/updated';
END $$;
