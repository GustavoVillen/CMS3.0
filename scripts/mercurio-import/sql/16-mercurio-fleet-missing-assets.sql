-- =============================================================================
-- Mercurio — Crea Assets faltantes en GLT/MGT/MAO y re-linkea huérfanos
-- =============================================================================
-- Después de los scripts 14 y 15 quedaron 29 planes huérfanos en otros
-- vessels (no YT). Patrón:
--
--   - Navegación: GLT001, GLT007, GLT008, MGT01-09, MGT16-26 (23 vessels)
--   - Compresores y Botellones de Aire: GLT007, GLT008 (2 vessels)
--   - Cajas Reductoras: MAO01 (1 vessel × 4 planes)
--
-- Total: 26 Assets nuevos a crear, que cierran los 29 planes huérfanos.
--
-- Criticidad y safety-critical seguimos el patrón establecido en LATERE/DONCHI/YT:
--   - Navegación                       → A / safety
--   - Compresores y Botellones de Aire → B / no-safety
--   - Cajas Reductoras                 → A / safety
--
-- Idempotente: ON CONFLICT DO NOTHING en (tenantId, vesselCode, assetCode).
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_tenant_id   text;
  v_user_id     text;
  v_inserted    integer := 0;
  v_relinked    integer := 0;
  v_remaining   integer := 0;

  systems text[][] := ARRAY[
    -- Navegación (23 vessels)
    ['GLT001','GLT001-SYS-NAV','Navegación','A','true'],
    ['GLT007','GLT007-SYS-NAV','Navegación','A','true'],
    ['GLT008','GLT008-SYS-NAV','Navegación','A','true'],
    ['MGT01', 'MGT01-SYS-NAV', 'Navegación','A','true'],
    ['MGT02', 'MGT02-SYS-NAV', 'Navegación','A','true'],
    ['MGT03', 'MGT03-SYS-NAV', 'Navegación','A','true'],
    ['MGT04', 'MGT04-SYS-NAV', 'Navegación','A','true'],
    ['MGT05', 'MGT05-SYS-NAV', 'Navegación','A','true'],
    ['MGT06', 'MGT06-SYS-NAV', 'Navegación','A','true'],
    ['MGT07', 'MGT07-SYS-NAV', 'Navegación','A','true'],
    ['MGT08', 'MGT08-SYS-NAV', 'Navegación','A','true'],
    ['MGT09', 'MGT09-SYS-NAV', 'Navegación','A','true'],
    ['MGT16', 'MGT16-SYS-NAV', 'Navegación','A','true'],
    ['MGT17', 'MGT17-SYS-NAV', 'Navegación','A','true'],
    ['MGT18', 'MGT18-SYS-NAV', 'Navegación','A','true'],
    ['MGT19', 'MGT19-SYS-NAV', 'Navegación','A','true'],
    ['MGT20', 'MGT20-SYS-NAV', 'Navegación','A','true'],
    ['MGT21', 'MGT21-SYS-NAV', 'Navegación','A','true'],
    ['MGT22', 'MGT22-SYS-NAV', 'Navegación','A','true'],
    ['MGT23', 'MGT23-SYS-NAV', 'Navegación','A','true'],
    ['MGT24', 'MGT24-SYS-NAV', 'Navegación','A','true'],
    ['MGT25', 'MGT25-SYS-NAV', 'Navegación','A','true'],
    ['MGT26', 'MGT26-SYS-NAV', 'Navegación','A','true'],

    -- Compresores y Botellones de Aire (2 vessels)
    ['GLT007','GLT007-SYS-AIR','Compresores y Botellones de Aire','B','false'],
    ['GLT008','GLT008-SYS-AIR','Compresores y Botellones de Aire','B','false'],

    -- Cajas Reductoras (1 vessel)
    ['MAO01', 'MAO01-SYS-CAJ', 'Cajas Reductoras','A','true']
  ];
  i integer;
  v_inserted_step integer;
BEGIN
  SELECT id INTO v_tenant_id FROM "Tenant" WHERE slug = 'mercurio' LIMIT 1;
  IF v_tenant_id IS NULL THEN
    SELECT t.id INTO v_tenant_id
    FROM "Tenant" t
    JOIN "Vessel" v ON v."tenantId" = t.id
    WHERE v.code IN ('LATERE','DONCHI')
    ORDER BY v."createdAt" ASC LIMIT 1;
  END IF;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Tenant Mercurio not found';
  END IF;

  SELECT m."userId" INTO v_user_id
  FROM "TenantMembership" m
  WHERE m."tenantId" = v_tenant_id AND m.role = 'TENANT_ADMIN'
  ORDER BY m."createdAt" ASC LIMIT 1;
  IF v_user_id IS NULL THEN
    SELECT m."userId" INTO v_user_id
    FROM "TenantMembership" m
    WHERE m."tenantId" = v_tenant_id
    ORDER BY m."createdAt" ASC LIMIT 1;
  END IF;

  -- ── 1) Insertar Assets faltantes ────────────────────────────────────────
  FOR i IN 1 .. array_length(systems, 1) LOOP
    INSERT INTO "Asset" (
      id, "tenantId", "vesselCode", "assetCode", name,
      criticality, status, "isSafetyCritical", "trackDailyReport",
      "createdAt", "createdByUserId", "updatedAt", "updatedByUserId"
    )
    VALUES (
      gen_random_uuid()::text,
      v_tenant_id,
      systems[i][1],
      systems[i][2],
      systems[i][3],
      systems[i][4]::"AssetCriticality",
      'OPERATIONAL'::"AssetStatus",
      systems[i][5]::boolean,
      false,
      NOW(), v_user_id, NOW(), v_user_id
    )
    ON CONFLICT ("tenantId", "vesselCode", "assetCode") DO NOTHING;

    GET DIAGNOSTICS v_inserted_step = ROW_COUNT;
    v_inserted := v_inserted + v_inserted_step;
  END LOOP;

  RAISE NOTICE 'Assets nuevos creados: %', v_inserted;

  -- ── 2) Re-link de planes huérfanos por (vessel + name) ─────────────────
  WITH orphan AS (
    SELECT mp.id, mp."vesselCode", substring(mp.title from '\[(.*?)\]') AS sys_name
    FROM "MaintenancePlan" mp
    LEFT JOIN "Asset" orig ON orig.id = mp."assetId"
    WHERE mp."tenantId"  = v_tenant_id
      AND mp."deletedAt" IS NULL
      AND orig.id        IS NULL
  ),
  resolved AS (
    SELECT o.id AS plan_id, a.id AS new_asset_id
    FROM orphan o
    JOIN "Asset" a
      ON a."tenantId"   = v_tenant_id
     AND a."vesselCode" = o."vesselCode"
     AND a.name         = o.sys_name
     AND a."deletedAt"  IS NULL
  )
  UPDATE "MaintenancePlan" mp
     SET "assetId"         = r.new_asset_id,
         "updatedAt"       = NOW(),
         "updatedByUserId" = v_user_id
    FROM resolved r
   WHERE mp.id = r.plan_id;
  GET DIAGNOSTICS v_relinked = ROW_COUNT;

  RAISE NOTICE 'Planes huérfanos re-linkeados en esta corrida: %', v_relinked;

  SELECT COUNT(*) INTO v_remaining
  FROM "MaintenancePlan" mp
  LEFT JOIN "Asset" a ON a.id = mp."assetId"
  WHERE mp."tenantId"  = v_tenant_id
    AND mp."deletedAt" IS NULL
    AND a.id           IS NULL;

  RAISE NOTICE 'Planes huérfanos restantes: %', v_remaining;
END $$;

-- ── Verificación final ────────────────────────────────────────────────────
SELECT
  mp."vesselCode",
  mp."taskCode",
  substring(mp.title from '\[(.*?)\]') AS expected_asset_name
FROM "MaintenancePlan" mp
LEFT JOIN "Asset" a ON a.id = mp."assetId"
WHERE mp."tenantId" IN (SELECT id FROM "Tenant" WHERE slug='mercurio')
  AND mp."deletedAt" IS NULL
  AND a.id IS NULL
ORDER BY mp."vesselCode", mp."taskCode";

COMMIT;
