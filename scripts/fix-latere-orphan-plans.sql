-- =============================================================================
-- Fix LATERE orphaned maintenance plans (2026-05-05)
-- =============================================================================
-- Tras correr seed-latere-assets.sql quedaron 4 maintenance plans apuntando
-- a assets soft-deleted. Este script:
--   1. Crea 2 assets nuevos para preservar la semántica:
--        - LAT-INS-01: Inspecciones y Pruebas en Sala de Máquinas (bucket)
--        - LAT-CMB-02: Sistema de Embarque de Combustible
--   2. Reasigna los 4 planes huérfanos a los nuevos assets correspondientes.
--
-- Idempotente: si los assets ya existen activos, los reutiliza sin duplicar.
--
-- Run: psql "$DATABASE_URL" -f /app/scripts/fix-latere-orphan-plans.sql
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_tenant_id     text;
  v_user_id       text;
  v_vessel_code   text := 'LATERE';
  v_ins_asset_id  text;
  v_cmb_asset_id  text;
  v_ins_count     integer;
  v_cmb_count     integer;
BEGIN
  -- ── Resolve tenant + user ────────────────────────────────────────────────
  SELECT t.id INTO v_tenant_id
  FROM "Tenant" t
  JOIN "Vessel" v ON v."tenantId" = t.id
  WHERE v.code = v_vessel_code
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Vessel % not found', v_vessel_code;
  END IF;

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

  RAISE NOTICE 'Tenant: %, User: %', v_tenant_id, v_user_id;

  -- ── Get-or-create LAT-INS-01 (Inspecciones bucket) ───────────────────────
  SELECT id INTO v_ins_asset_id
  FROM "Asset"
  WHERE "tenantId"   = v_tenant_id
    AND "vesselCode" = v_vessel_code
    AND "assetCode"  = 'LAT-INS-01'
    AND "deletedAt"  IS NULL
  LIMIT 1;

  IF v_ins_asset_id IS NULL THEN
    INSERT INTO "Asset" (
      id, "tenantId", "vesselCode", "assetCode", "sfiCode",
      name, manufacturer, model, criticality, status,
      "isSafetyCritical", "trackDailyReport",
      "createdAt", "createdByUserId", "updatedAt", "updatedByUserId"
    )
    VALUES (
      gen_random_uuid()::text, v_tenant_id, v_vessel_code, 'LAT-INS-01', NULL,
      'Inspecciones y Pruebas en Sala de Máquinas', NULL, NULL, 'B', 'OPERATIONAL',
      false, false,
      NOW(), v_user_id, NOW(), v_user_id
    )
    RETURNING id INTO v_ins_asset_id;
    RAISE NOTICE 'Created LAT-INS-01 (id=%)', v_ins_asset_id;
  ELSE
    RAISE NOTICE 'LAT-INS-01 already exists (id=%), reusing', v_ins_asset_id;
  END IF;

  -- ── Get-or-create LAT-CMB-02 (Embarque de combustible) ───────────────────
  SELECT id INTO v_cmb_asset_id
  FROM "Asset"
  WHERE "tenantId"   = v_tenant_id
    AND "vesselCode" = v_vessel_code
    AND "assetCode"  = 'LAT-CMB-02'
    AND "deletedAt"  IS NULL
  LIMIT 1;

  IF v_cmb_asset_id IS NULL THEN
    INSERT INTO "Asset" (
      id, "tenantId", "vesselCode", "assetCode", "sfiCode",
      name, manufacturer, model, criticality, status,
      "isSafetyCritical", "trackDailyReport",
      "createdAt", "createdByUserId", "updatedAt", "updatedByUserId"
    )
    VALUES (
      gen_random_uuid()::text, v_tenant_id, v_vessel_code, 'LAT-CMB-02', NULL,
      'Sistema de Embarque de Combustible', NULL, NULL, 'B', 'OPERATIONAL',
      false, false,
      NOW(), v_user_id, NOW(), v_user_id
    )
    RETURNING id INTO v_cmb_asset_id;
    RAISE NOTICE 'Created LAT-CMB-02 (id=%)', v_cmb_asset_id;
  ELSE
    RAISE NOTICE 'LAT-CMB-02 already exists (id=%), reusing', v_cmb_asset_id;
  END IF;

  -- ── Reasignar los 3 planes de inspección a LAT-INS-01 ────────────────────
  UPDATE "MaintenancePlan"
  SET "assetId"         = v_ins_asset_id,
      "updatedAt"       = NOW(),
      "updatedByUserId" = v_user_id
  WHERE "tenantId"   = v_tenant_id
    AND "vesselCode" = v_vessel_code
    AND "taskCode"   IN ('LATERE-600-15D', 'LATERE-600-1D', 'LATERE-600-1SE')
    AND "deletedAt"  IS NULL;
  GET DIAGNOSTICS v_ins_count = ROW_COUNT;
  RAISE NOTICE 'Reasignados % planes a LAT-INS-01', v_ins_count;

  -- ── Reasignar el plan de combustible a LAT-CMB-02 ────────────────────────
  UPDATE "MaintenancePlan"
  SET "assetId"         = v_cmb_asset_id,
      "updatedAt"       = NOW(),
      "updatedByUserId" = v_user_id
  WHERE "tenantId"   = v_tenant_id
    AND "vesselCode" = v_vessel_code
    AND "taskCode"   = 'M-MGT01-270-96M'
    AND "deletedAt"  IS NULL;
  GET DIAGNOSTICS v_cmb_count = ROW_COUNT;
  RAISE NOTICE 'Reasignados % planes a LAT-CMB-02', v_cmb_count;
END $$;

-- ── Verificación: planes ya no apuntan a assets soft-deleted ───────────────
SELECT
  mp."taskCode"     AS plan_code,
  mp.title          AS plan_title,
  a."assetCode"     AS asset_actual,
  a.name            AS asset_actual_nombre
FROM "MaintenancePlan" mp
JOIN "Asset" a ON a.id = mp."assetId"
JOIN "Vessel" v ON v.code = a."vesselCode" AND v."tenantId" = a."tenantId"
WHERE a."vesselCode" = 'LATERE'
  AND mp."deletedAt" IS NULL
  AND mp."taskCode" IN ('LATERE-600-15D', 'LATERE-600-1D', 'LATERE-600-1SE', 'M-MGT01-270-96M')
ORDER BY mp."taskCode";

-- ── Confirmación: ya no quedan planes huérfanos ────────────────────────────
SELECT
  COUNT(*) AS planes_huerfanos_restantes
FROM "MaintenancePlan" mp
JOIN "Asset" a ON a.id = mp."assetId"
WHERE a."vesselCode" = 'LATERE'
  AND a."deletedAt"  IS NOT NULL
  AND mp."deletedAt" IS NULL;

COMMIT;
