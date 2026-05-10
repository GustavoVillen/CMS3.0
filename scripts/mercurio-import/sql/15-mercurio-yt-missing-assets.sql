-- =============================================================================
-- Mercurio — Crea Assets faltantes en las YT y re-linkea los planes huérfanos
-- =============================================================================
-- 83 planes de YT005, YT010, YT012, YT013, YT015, YT022 quedaron huérfanos
-- porque apuntan a sistemas que no se cargaron en su día:
--   - Motor Principal
--   - Navegación
--   - Sistema Eléctrico
--   - Paradas de Emergencia
--   - Tanques de Carga
--
-- Este script:
--   1) Crea esos 5 Assets en cada una de las 6 YT (con ON CONFLICT DO NOTHING).
--   2) Re-linkea los planes huérfanos a los nuevos Assets por (vessel + name).
--
-- Idempotente: si los Assets ya existen, no se duplican; si los planes ya
-- están bien linkeados, no se tocan.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_tenant_id   text;
  v_user_id     text;
  v_inserted    integer := 0;
  v_relinked    integer := 0;
  v_remaining   integer := 0;

  -- (vesselCode, assetCode, name, criticality, isSafetyCritical)
  systems text[][] := ARRAY[
    -- YT005 solo tiene 2 huérfanos pero creamos los 5 para consistencia
    ['YT005','YT005-SYS-PROP','Motor Principal',         'A','true'],
    ['YT005','YT005-SYS-NAV', 'Navegación',              'A','true'],
    ['YT005','YT005-SYS-ELE', 'Sistema Eléctrico',       'A','true'],
    ['YT005','YT005-SYS-EMG', 'Paradas de Emergencia',   'A','true'],
    ['YT005','YT005-SYS-TNQ', 'Tanques de Carga',        'B','false'],

    ['YT010','YT010-SYS-PROP','Motor Principal',         'A','true'],
    ['YT010','YT010-SYS-NAV', 'Navegación',              'A','true'],
    ['YT010','YT010-SYS-ELE', 'Sistema Eléctrico',       'A','true'],
    ['YT010','YT010-SYS-EMG', 'Paradas de Emergencia',   'A','true'],
    ['YT010','YT010-SYS-TNQ', 'Tanques de Carga',        'B','false'],

    ['YT012','YT012-SYS-PROP','Motor Principal',         'A','true'],
    ['YT012','YT012-SYS-NAV', 'Navegación',              'A','true'],
    ['YT012','YT012-SYS-ELE', 'Sistema Eléctrico',       'A','true'],
    ['YT012','YT012-SYS-EMG', 'Paradas de Emergencia',   'A','true'],
    ['YT012','YT012-SYS-TNQ', 'Tanques de Carga',        'B','false'],

    ['YT013','YT013-SYS-PROP','Motor Principal',         'A','true'],
    ['YT013','YT013-SYS-NAV', 'Navegación',              'A','true'],
    ['YT013','YT013-SYS-ELE', 'Sistema Eléctrico',       'A','true'],
    ['YT013','YT013-SYS-EMG', 'Paradas de Emergencia',   'A','true'],
    ['YT013','YT013-SYS-TNQ', 'Tanques de Carga',        'B','false'],

    ['YT015','YT015-SYS-PROP','Motor Principal',         'A','true'],
    ['YT015','YT015-SYS-NAV', 'Navegación',              'A','true'],
    ['YT015','YT015-SYS-ELE', 'Sistema Eléctrico',       'A','true'],
    ['YT015','YT015-SYS-EMG', 'Paradas de Emergencia',   'A','true'],
    ['YT015','YT015-SYS-TNQ', 'Tanques de Carga',        'B','false'],

    ['YT022','YT022-SYS-PROP','Motor Principal',         'A','true'],
    ['YT022','YT022-SYS-NAV', 'Navegación',              'A','true'],
    ['YT022','YT022-SYS-ELE', 'Sistema Eléctrico',       'A','true'],
    ['YT022','YT022-SYS-EMG', 'Paradas de Emergencia',   'A','true'],
    ['YT022','YT022-SYS-TNQ', 'Tanques de Carga',        'B','false']
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

  RAISE NOTICE 'Assets nuevos creados en YT: %', v_inserted;

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

-- ── Verificación: Assets activos en YT después de la corrida ────────────
SELECT "vesselCode", COUNT(*) AS active_assets
FROM "Asset"
WHERE "tenantId" IN (SELECT id FROM "Tenant" WHERE slug='mercurio')
  AND "deletedAt" IS NULL
  AND "vesselCode" LIKE 'YT%'
GROUP BY "vesselCode"
ORDER BY "vesselCode";

COMMIT;
