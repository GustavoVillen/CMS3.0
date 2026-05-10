-- =============================================================================
-- Mercurio — Re-link de planes huérfanos a Assets activos
-- =============================================================================
-- Diagnóstico: 804 planes activos del tenant Mercurio apuntan a un assetId
-- que ya no existe en la tabla Asset (Assets hard-deleted en algún momento
-- previo). En la UI esto se manifiesta como UUIDs en la columna "EQUIPO" en
-- vez del nombre del sistema.
--
-- Estrategia: parsear el nombre del sistema desde mp.title (formato
-- '[Nombre del Sistema] ...') y matchear contra Asset.name del mismo vessel.
--
-- 721 de 804 huérfanos son re-linkables por este método. Los 83 restantes
-- quedan para revisión manual (se listan al final).
--
-- Idempotente: solo actúa sobre planes cuyo assetId actual NO existe en Asset.
-- Una segunda corrida no hace nada si ya están bien linkeados.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_tenant_id   text;
  v_user_id     text;
  v_relinked    integer := 0;
  v_remaining   integer := 0;
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

  -- ── Re-link masivo ──────────────────────────────────────────────────────
  -- Para cada plan huérfano (assetId no existe en Asset), buscar un Asset
  -- activo del mismo vessel cuyo .name = nombre extraído del title.
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
     SET "assetId"       = r.new_asset_id,
         "updatedAt"     = NOW(),
         "updatedByUserId" = v_user_id
    FROM resolved r
   WHERE mp.id = r.plan_id;
  GET DIAGNOSTICS v_relinked = ROW_COUNT;

  RAISE NOTICE 'Planes re-linkeados: %', v_relinked;

  -- Conteo de huérfanos restantes
  SELECT COUNT(*) INTO v_remaining
  FROM "MaintenancePlan" mp
  LEFT JOIN "Asset" a ON a.id = mp."assetId"
  WHERE mp."tenantId"  = v_tenant_id
    AND mp."deletedAt" IS NULL
    AND a.id           IS NULL;

  RAISE NOTICE 'Planes huérfanos restantes: %', v_remaining;
END $$;

-- ── Listado de los huérfanos que NO pudieron re-linkear ──────────────────
-- (para revisión manual: probablemente Assets que nunca se crearon o que
-- tienen un nombre distinto al esperado por el title del plan)
SELECT
  mp."vesselCode",
  mp."taskCode",
  substring(mp.title from '\[(.*?)\]') AS expected_asset_name,
  LEFT(mp.title, 60) AS title
FROM "MaintenancePlan" mp
LEFT JOIN "Asset" a ON a.id = mp."assetId"
WHERE mp."tenantId" IN (SELECT id FROM "Tenant" WHERE slug='mercurio')
  AND mp."deletedAt" IS NULL
  AND a.id IS NULL
ORDER BY mp."vesselCode", expected_asset_name, mp."taskCode";

COMMIT;
