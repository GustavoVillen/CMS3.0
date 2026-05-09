-- =============================================================================
-- LATERE asset replacement (2026-05-05)
-- =============================================================================
-- Strategy:
--   1. Soft-delete all currently active assets for vessel LATERE.
--   2. Insert 25 fresh assets based on the equipment list provided by the
--      operator (see Excel screenshot in the conversation).
--
-- Idempotent: re-running this script will soft-delete the previous run's
-- inserts and create fresh ones. Final state is always the same set of
-- 25 active assets; old runs accumulate as soft-deleted history rows.
--
-- Run on VPS:
--   DATABASE_URL=postgresql://gpms:****@127.0.0.1:5432/gpms
--   psql "$DATABASE_URL" -f /app/scripts/seed-latere-assets.sql
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_tenant_id   text;
  v_user_id     text;
  v_vessel_code text := 'LATERE';
  v_old_count   integer;
  v_orphan_plans integer;
BEGIN
  -- ── 1. Resolve tenant that owns LATERE ───────────────────────────────────
  SELECT t.id INTO v_tenant_id
  FROM "Tenant" t
  JOIN "Vessel" v ON v."tenantId" = t.id
  WHERE v.code = v_vessel_code
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Vessel % not found in any tenant', v_vessel_code;
  END IF;
  RAISE NOTICE 'Tenant resolved: %', v_tenant_id;

  -- ── 2. Resolve a user to attribute audit fields to ───────────────────────
  SELECT m."userId" INTO v_user_id
  FROM "TenantMembership" m
  WHERE m."tenantId" = v_tenant_id
    AND m.role = 'TENANT_ADMIN'
  ORDER BY m."createdAt" ASC
  LIMIT 1;

  IF v_user_id IS NULL THEN
    SELECT m."userId" INTO v_user_id
    FROM "TenantMembership" m
    WHERE m."tenantId" = v_tenant_id
    ORDER BY m."createdAt" ASC
    LIMIT 1;
  END IF;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No member found for tenant %', v_tenant_id;
  END IF;
  RAISE NOTICE 'User attributed: %', v_user_id;

  -- ── 3. Warn if active maintenance plans depend on assets to be deleted ───
  SELECT COUNT(*) INTO v_orphan_plans
  FROM "MaintenancePlan" mp
  JOIN "Asset" a ON a.id = mp."assetId"
  WHERE a."tenantId"   = v_tenant_id
    AND a."vesselCode" = v_vessel_code
    AND a."deletedAt"  IS NULL
    AND mp."deletedAt" IS NULL;

  IF v_orphan_plans > 0 THEN
    RAISE WARNING '⚠ % active maintenance plans reference assets about to be soft-deleted. They will keep pointing to soft-deleted assets (still queryable but flagged). Reassign or delete them manually after this run if needed.', v_orphan_plans;
  END IF;

  -- ── 4. Soft-delete current active LATERE assets ──────────────────────────
  SELECT COUNT(*) INTO v_old_count
  FROM "Asset"
  WHERE "tenantId"   = v_tenant_id
    AND "vesselCode" = v_vessel_code
    AND "deletedAt" IS NULL;

  UPDATE "Asset"
  SET "deletedAt"       = NOW(),
      "deletedByUserId" = v_user_id,
      "updatedAt"       = NOW(),
      "updatedByUserId" = v_user_id
  WHERE "tenantId"   = v_tenant_id
    AND "vesselCode" = v_vessel_code
    AND "deletedAt" IS NULL;
  RAISE NOTICE 'Soft-deleted % previous assets', v_old_count;

  -- ── 5. Insert 25 fresh assets ────────────────────────────────────────────
  INSERT INTO "Asset" (
    id, "tenantId", "vesselCode", "assetCode", "sfiCode",
    name, manufacturer, model,
    criticality, status, "isSafetyCritical", "trackDailyReport",
    "createdAt", "createdByUserId", "updatedAt", "updatedByUserId"
  )
  VALUES
  -- ── Propulsión ─────────────────────────────────────────────────────────
  (gen_random_uuid()::text, v_tenant_id, v_vessel_code, 'LAT-PROP-01', NULL, 'Motor Propulsor',                        'Cummins',                        'K50',                 'A', 'OPERATIONAL', true,  true,  NOW(), v_user_id, NOW(), v_user_id),
  (gen_random_uuid()::text, v_tenant_id, v_vessel_code, 'LAT-PROP-02', NULL, 'Reductor',                               'Reintjes',                       'WAF763L',             'A', 'OPERATIONAL', true,  false, NOW(), v_user_id, NOW(), v_user_id),
  (gen_random_uuid()::text, v_tenant_id, v_vessel_code, 'LAT-PROP-03', NULL, 'Bomba Recirculación Aceite Caja',        'KRACHT',                         NULL,                  'A', 'OPERATIONAL', true,  false, NOW(), v_user_id, NOW(), v_user_id),
  -- ── Sistema Eléctrico Principal ────────────────────────────────────────
  (gen_random_uuid()::text, v_tenant_id, v_vessel_code, 'LAT-ELE-01',  NULL, 'Generador Principal',                    'Cummins',                        'N855-DM',             'A', 'OPERATIONAL', true,  true,  NOW(), v_user_id, NOW(), v_user_id),
  (gen_random_uuid()::text, v_tenant_id, v_vessel_code, 'LAT-ELE-02',  NULL, 'Alternador Principal',                   'Stamford',                       'HCM434E1',            'A', 'OPERATIONAL', true,  false, NOW(), v_user_id, NOW(), v_user_id),
  -- ── Eléctrico Emergencia ───────────────────────────────────────────────
  (gen_random_uuid()::text, v_tenant_id, v_vessel_code, 'LAT-EME-01',  NULL, 'Generador de Emergencia',                'Cummins',                        '6BT5.9D(M)',          'A', 'OPERATIONAL', true,  true,  NOW(), v_user_id, NOW(), v_user_id),
  (gen_random_uuid()::text, v_tenant_id, v_vessel_code, 'LAT-EME-02',  NULL, 'Alternador Emergencia',                  'Stamford',                       'UCM274E1',            'A', 'OPERATIONAL', true,  false, NOW(), v_user_id, NOW(), v_user_id),
  -- ── Control Generadores ────────────────────────────────────────────────
  (gen_random_uuid()::text, v_tenant_id, v_vessel_code, 'LAT-GEN-01',  NULL, 'Controladores / Drivers / Relés',        'Cummins, ComAp, Schrack',        NULL,                  'B', 'OPERATIONAL', false, false, NOW(), v_user_id, NOW(), v_user_id),
  -- ── Transformadores ────────────────────────────────────────────────────
  (gen_random_uuid()::text, v_tenant_id, v_vessel_code, 'LAT-TRA-01',  NULL, 'Transformador 15KVA',                    'Trafosur',                       NULL,                  'B', 'OPERATIONAL', false, false, NOW(), v_user_id, NOW(), v_user_id),
  -- ── Carga de Baterías ──────────────────────────────────────────────────
  (gen_random_uuid()::text, v_tenant_id, v_vessel_code, 'LAT-BAT-01',  NULL, 'Cargador automático y baterías',         'Mastervolt, Odyssey',            NULL,                  'B', 'OPERATIONAL', false, false, NOW(), v_user_id, NOW(), v_user_id),
  -- ── Achique Slop ───────────────────────────────────────────────────────
  (gen_random_uuid()::text, v_tenant_id, v_vessel_code, 'LAT-SLO-01',  NULL, 'Bombas y motores Achique Slop',          'ABB',                            NULL,                  'B', 'OPERATIONAL', false, false, NOW(), v_user_id, NOW(), v_user_id),
  -- ── Combustible ────────────────────────────────────────────────────────
  (gen_random_uuid()::text, v_tenant_id, v_vessel_code, 'LAT-CMB-01',  NULL, 'Bombas de Trasvase y filtros',           'ABB, Taiko, TDK',                NULL,                  'B', 'OPERATIONAL', false, false, NOW(), v_user_id, NOW(), v_user_id),
  -- ── Sentina ────────────────────────────────────────────────────────────
  (gen_random_uuid()::text, v_tenant_id, v_vessel_code, 'LAT-SNT-01',  NULL, 'Bombas y Centrífuga de Sentina',         'ABB, Taiko',                     NULL,                  'B', 'OPERATIONAL', true,  false, NOW(), v_user_id, NOW(), v_user_id),
  -- ── Contra Incendio ────────────────────────────────────────────────────
  (gen_random_uuid()::text, v_tenant_id, v_vessel_code, 'LAT-CIN-01',  NULL, 'Motor, bomba y presostatos C/I',         'ABB, Taiko, Saginomiya',         NULL,                  'A', 'OPERATIONAL', true,  false, NOW(), v_user_id, NOW(), v_user_id),
  -- ── Aire Comprimido ────────────────────────────────────────────────────
  (gen_random_uuid()::text, v_tenant_id, v_vessel_code, 'LAT-AIR-01',  NULL, 'Compresor y accesorios',                 'Sanwa, Hitachi, Nippon Oil',     NULL,                  'B', 'OPERATIONAL', false, true,  NOW(), v_user_id, NOW(), v_user_id),
  -- ── Tratamiento de Agua / Efluentes ────────────────────────────────────
  (gen_random_uuid()::text, v_tenant_id, v_vessel_code, 'LAT-WTR-01',  NULL, 'Centrífugas Tratamiento de Agua',        'Taiko Kikai',                    NULL,                  'A', 'OPERATIONAL', false, false, NOW(), v_user_id, NOW(), v_user_id),
  -- ── Sistema Hidráulico Timón ───────────────────────────────────────────
  (gen_random_uuid()::text, v_tenant_id, v_vessel_code, 'LAT-TIM-01',  NULL, 'Sistema Hidráulico Timón',               'WEG, Telemecanique',             NULL,                  'A', 'OPERATIONAL', true,  false, NOW(), v_user_id, NOW(), v_user_id),
  -- ── Climatización ──────────────────────────────────────────────────────
  (gen_random_uuid()::text, v_tenant_id, v_vessel_code, 'LAT-CLI-01',  NULL, 'Aires Acondicionados',                   'Toshiba',                        'MMY-MAP1204HT8P',     'B', 'OPERATIONAL', false, false, NOW(), v_user_id, NOW(), v_user_id),
  -- ── Control Timonera ───────────────────────────────────────────────────
  (gen_random_uuid()::text, v_tenant_id, v_vessel_code, 'LAT-CTR-01',  NULL, 'Paneles, Indicadores y Alarmas',         'Cummins, Omron, Seematz',        NULL,                  'B', 'OPERATIONAL', false, false, NOW(), v_user_id, NOW(), v_user_id),
  -- ── Navegación ─────────────────────────────────────────────────────────
  (gen_random_uuid()::text, v_tenant_id, v_vessel_code, 'LAT-NAV-01',  NULL, 'Radar',                                  'JRC',                            'JMA 610',             'A', 'OPERATIONAL', true,  false, NOW(), v_user_id, NOW(), v_user_id),
  (gen_random_uuid()::text, v_tenant_id, v_vessel_code, 'LAT-NAV-02',  NULL, 'Ecosonda',                               'JRC',                            'JFC-7050',            'A', 'OPERATIONAL', true,  false, NOW(), v_user_id, NOW(), v_user_id),
  (gen_random_uuid()::text, v_tenant_id, v_vessel_code, 'LAT-NAV-03',  NULL, 'GPS COMPASS',                            'JRC',                            'JLR-21/31',           'A', 'OPERATIONAL', true,  false, NOW(), v_user_id, NOW(), v_user_id),
  (gen_random_uuid()::text, v_tenant_id, v_vessel_code, 'LAT-NAV-04',  NULL, 'AIS',                                    'em-trak',                        'A100',                'A', 'OPERATIONAL', true,  false, NOW(), v_user_id, NOW(), v_user_id),
  -- ── Detección de Incendios ─────────────────────────────────────────────
  (gen_random_uuid()::text, v_tenant_id, v_vessel_code, 'LAT-DTI-01',  NULL, 'Central de Incendio',                    'HOCHIKY',                        'MH80161M2',           'A', 'OPERATIONAL', true,  false, NOW(), v_user_id, NOW(), v_user_id),
  -- ── Comunicación ───────────────────────────────────────────────────────
  (gen_random_uuid()::text, v_tenant_id, v_vessel_code, 'LAT-COM-01',  NULL, 'Radio VHF',                              'SAILOR',                         '6248 VHF',            'A', 'OPERATIONAL', true,  false, NOW(), v_user_id, NOW(), v_user_id);

  RAISE NOTICE 'Inserted 25 fresh assets for vessel %', v_vessel_code;
END $$;

-- ── 6. Verification report ────────────────────────────────────────────────
SELECT
  "assetCode",
  name,
  manufacturer,
  COALESCE(model, '—') AS model,
  criticality,
  CASE WHEN "isSafetyCritical" THEN 'YES' ELSE '' END AS safety,
  CASE WHEN "trackDailyReport" THEN 'YES' ELSE '' END AS track_hours
FROM "Asset"
WHERE "vesselCode" = 'LATERE'
  AND "deletedAt" IS NULL
ORDER BY "assetCode";

COMMIT;
