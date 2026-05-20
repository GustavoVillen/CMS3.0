-- Seed: TrainingItem para mercurio & demo (Spanish translations, default training items)
-- ~40 basic training items with STCW, NR (Spanish regulatory), safety, and company-specific
-- Idioma: Español
-- Tenants: mercurio, demo

DO $$
DECLARE
  v_sort_order INT := 0;
  tenant_rec RECORD;
BEGIN
  -- Insert for both mercurio and demo tenants
  FOR tenant_rec IN SELECT id, slug FROM "Tenant" WHERE slug IN ('mercurio', 'demo')
  LOOP
    -- Note: Do NOT delete existing training items. ON CONFLICT clause will update them.

    -- Insert Spanish/Default training items
    INSERT INTO "TrainingItem" (id, "tenantId", code, name, regulation, category, "validityYears", "sortOrder", "createdAt", "updatedAt")
    VALUES
      -- STCW Deck Officer Training (Spanish)
      (concat('item_', tenant_rec.id, '_001'), tenant_rec.id, 'STCW_II_1_A', 'STCW II/1 (Certificado de Oficial de Cubierta)', 'STCW', 'STCW', 5, v_sort_order+1, NOW(), NOW()),
      (concat('item_', tenant_rec.id, '_002'), tenant_rec.id, 'STCW_II_1_B', 'STCW II/1 (Certificado de Capitán)', 'STCW', 'STCW', 5, v_sort_order+2, NOW(), NOW()),
      (concat('item_', tenant_rec.id, '_003'), tenant_rec.id, 'STCW_II_1_C', 'Certificado de Competencia en Navegación', 'STCW', 'STCW', 5, v_sort_order+3, NOW(), NOW()),
      -- STCW Engine Officer Training (Spanish)
      (concat('item_', tenant_rec.id, '_004'), tenant_rec.id, 'STCW_III_1_A', 'STCW III/1 (Certificado de Oficial de Máquinas)', 'STCW', 'STCW', 5, v_sort_order+4, NOW(), NOW()),
      (concat('item_', tenant_rec.id, '_005'), tenant_rec.id, 'STCW_III_1_B', 'STCW III/1 (Certificado de Jefe de Máquinas)', 'STCW', 'STCW', 5, v_sort_order+5, NOW(), NOW()),
      (concat('item_', tenant_rec.id, '_006'), tenant_rec.id, 'STCW_III_1_C', 'Certificado de Competencia en Máquinas', 'STCW', 'STCW', 5, v_sort_order+6, NOW(), NOW()),
      -- STCW Safety & Medical Training (Spanish)
      (concat('item_', tenant_rec.id, '_007'), tenant_rec.id, 'STCW_VI_1', 'STCW VI/1 (Primeros Auxilios)', 'STCW', 'SAFETY', 2, v_sort_order+7, NOW(), NOW()),
      (concat('item_', tenant_rec.id, '_008'), tenant_rec.id, 'STCW_VI_2', 'STCW VI/2 (Combate a Incendios)', 'STCW', 'SAFETY', 2, v_sort_order+8, NOW(), NOW()),
      (concat('item_', tenant_rec.id, '_009'), tenant_rec.id, 'STCW_VI_4', 'STCW VI/4 (Seguridad de Personas)', 'STCW', 'SAFETY', 2, v_sort_order+9, NOW(), NOW()),
      (concat('item_', tenant_rec.id, '_010'), tenant_rec.id, 'STCW_V_1', 'STCW V/1 (Seguridad Buques Pasaje)', 'STCW', 'SAFETY', 2, v_sort_order+10, NOW(), NOW()),
      -- GMDSS & Radio Training (Spanish)
      (concat('item_', tenant_rec.id, '_011'), tenant_rec.id, 'GMDSS_GOC', 'GMDSS Certificado General', 'STCW', 'GMDSS', 5, v_sort_order+11, NOW(), NOW()),
      (concat('item_', tenant_rec.id, '_012'), tenant_rec.id, 'GMDSS_ROC', 'GMDSS Certificado Restringido', 'STCW', 'GMDSS', 5, v_sort_order+12, NOW(), NOW()),
      -- Advanced Firefighting & Rescue (Spanish)
      (concat('item_', tenant_rec.id, '_013'), tenant_rec.id, 'AFD', 'Combate Avanzado de Incendios para Oficiales', 'STCW', 'SAFETY', 3, v_sort_order+13, NOW(), NOW()),
      (concat('item_', tenant_rec.id, '_014'), tenant_rec.id, 'LSA', 'Botes y Aparatos de Salvamento', 'STCW', 'SAFETY', 3, v_sort_order+14, NOW(), NOW()),
      (concat('item_', tenant_rec.id, '_015'), tenant_rec.id, 'PSCRB', 'Proficiencia en Embarcación de Rescate', 'STCW', 'SAFETY', 3, v_sort_order+15, NOW(), NOW()),
      -- Seamanship & Cargo (Spanish)
      (concat('item_', tenant_rec.id, '_016'), tenant_rec.id, 'SEAMANSHIP', 'Arte Naval y Operaciones de Carga', 'STCW', 'SEAMANSHIP', 3, v_sort_order+16, NOW(), NOW()),
      (concat('item_', tenant_rec.id, '_017'), tenant_rec.id, 'BULK_CARGO', 'Entrenamiento en Carga a Granel', 'STCW', 'CARGO', 5, v_sort_order+17, NOW(), NOW()),
      (concat('item_', tenant_rec.id, '_018'), tenant_rec.id, 'TANKER_CARGO', 'Curso de Buque Tanque/Petrolero', 'IMO', 'CARGO', 5, v_sort_order+18, NOW(), NOW()),
      -- Electronic Navigation (Spanish)
      (concat('item_', tenant_rec.id, '_019'), tenant_rec.id, 'ECDIS_BASIC', 'Entrenamiento ECDIS Básico', 'IMO', 'ECDIS', 5, v_sort_order+19, NOW(), NOW()),
      (concat('item_', tenant_rec.id, '_020'), tenant_rec.id, 'ECDIS_ADVANCED', 'Entrenamiento ECDIS Avanzado', 'IMO', 'ECDIS', 5, v_sort_order+20, NOW(), NOW()),
      -- Medical & Health (Spanish)
      (concat('item_', tenant_rec.id, '_021'), tenant_rec.id, 'MEDICAL_ENOG', 'Certificado de Aptitud Médica', 'STCW', 'MEDICAL', 2, v_sort_order+21, NOW(), NOW()),
      (concat('item_', tenant_rec.id, '_022'), tenant_rec.id, 'MEDICAL_FIRST_AID', 'Primeros Auxilios Avanzados', 'STCW', 'MEDICAL', 3, v_sort_order+22, NOW(), NOW()),
      -- Environmental & Port State Control (Spanish)
      (concat('item_', tenant_rec.id, '_023'), tenant_rec.id, 'MARPOL_BASIC', 'Entrenamiento MARPOL Básico', 'MARPOL', 'ENVIRONMENTAL', 2, v_sort_order+23, NOW(), NOW()),
      (concat('item_', tenant_rec.id, '_024'), tenant_rec.id, 'OPA_90', 'Oil Pollution Act (OPA) 90', 'OPA', 'ENVIRONMENTAL', 5, v_sort_order+24, NOW(), NOW()),
      (concat('item_', tenant_rec.id, '_025'), tenant_rec.id, 'PSC_PORT_STATE', 'Control por Estado Puerto', 'PSC', 'REGULATORY', 1, v_sort_order+25, NOW(), NOW()),
      -- Dynamic Positioning (Spanish)
      (concat('item_', tenant_rec.id, '_026'), tenant_rec.id, 'DP_BASIC', 'Posicionamiento Dinámico Básico', 'IMO', 'DP', 5, v_sort_order+26, NOW(), NOW()),
      (concat('item_', tenant_rec.id, '_027'), tenant_rec.id, 'DP_ADVANCED', 'Posicionamiento Dinámico Avanzado', 'IMO', 'DP', 5, v_sort_order+27, NOW(), NOW()),
      -- Spanish Regulations (NR translations for maritime use)
      (concat('item_', tenant_rec.id, '_028'), tenant_rec.id, 'REG_SAFETY', 'Regulaciones de Seguridad Marítima', 'SPANISH', 'REGULATIONS', 2, v_sort_order+28, NOW(), NOW()),
      (concat('item_', tenant_rec.id, '_029'), tenant_rec.id, 'REG_ENV', 'Regulaciones Ambientales Marítimas', 'SPANISH', 'REGULATIONS', 2, v_sort_order+29, NOW(), NOW()),
      (concat('item_', tenant_rec.id, '_030'), tenant_rec.id, 'REG_LABOR', 'Convenio Laboral Marítimo (MLC)', 'SPANISH', 'REGULATIONS', 3, v_sort_order+30, NOW(), NOW()),
      -- Company-Specific Training (Spanish)
      (concat('item_', tenant_rec.id, '_031'), tenant_rec.id, concat(tenant_rec.slug, '_ISM'), 'Capacitación ISM/SMS de ' || initcap(tenant_rec.slug), 'INTERNO', 'COMPANY', 1, v_sort_order+31, NOW(), NOW()),
      (concat('item_', tenant_rec.id, '_032'), tenant_rec.id, concat(tenant_rec.slug, '_SAFETY'), 'Capacitación de Seguridad de ' || initcap(tenant_rec.slug), 'INTERNO', 'COMPANY', 1, v_sort_order+32, NOW(), NOW()),
      (concat('item_', tenant_rec.id, '_033'), tenant_rec.id, concat(tenant_rec.slug, '_ENV'), 'Capacitación Ambiental de ' || initcap(tenant_rec.slug), 'INTERNO', 'COMPANY', 1, v_sort_order+33, NOW(), NOW()),
      (concat('item_', tenant_rec.id, '_034'), tenant_rec.id, concat(tenant_rec.slug, '_INDUCTION'), 'Inducción de ' || initcap(tenant_rec.slug), 'INTERNO', 'COMPANY', null, v_sort_order+34, NOW(), NOW()),
      -- Operational Training (Spanish)
      (concat('item_', tenant_rec.id, '_035'), tenant_rec.id, 'VOYAGE_PLANNING', 'Planificación de Viaje', 'STCW', 'OPERATIONS', 3, v_sort_order+35, NOW(), NOW()),
      (concat('item_', tenant_rec.id, '_036'), tenant_rec.id, 'WEATHER_ROUTING', 'Enrutamiento por Condiciones Meteo', 'STCW', 'OPERATIONS', 2, v_sort_order+36, NOW(), NOW()),
      (concat('item_', tenant_rec.id, '_037'), tenant_rec.id, 'MAINTENANCE', 'Mantenimiento de Buque', 'INTERNAL', 'OPERATIONS', 2, v_sort_order+37, NOW(), NOW()),
      (concat('item_', tenant_rec.id, '_038'), tenant_rec.id, 'DRILLS_EXERCISES', 'Ejercicios y Simulacros de Emergencia', 'ISM', 'OPERATIONS', 1, v_sort_order+38, NOW(), NOW())
    ON CONFLICT ("tenantId", code) DO UPDATE SET
      name = EXCLUDED.name,
      regulation = EXCLUDED.regulation,
      category = EXCLUDED.category,
      "validityYears" = EXCLUDED."validityYears",
      "updatedAt" = NOW();

    RAISE NOTICE 'Training items seeded for tenant %: ~38 items inserted/updated', tenant_rec.slug;
  END LOOP;

END $$;
