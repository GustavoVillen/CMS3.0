-- =============================================================================
-- Mercurio — Cleanup: soft-delete repuestos Cummins erróneos en LATERE
-- =============================================================================
-- Los repuestos Cummins (LF670, LFP815FN, etc.) fueron cargados en LATERE
-- desde la lista del motor Cummins de YT 007. Pero LATERE tiene Cummins K50
-- (propulsor), N855-DM (generador) y 6BT5.9D(M) (emergencia) — modelos
-- distintos al de YT 007, por lo que esos part numbers no aplican.
--
-- Esta operación soft-deletea esos repuestos. Cuando se consigan los part
-- numbers correctos de los motores reales de LATERE, se cargan de nuevo.
--
-- Idempotente: si los repuestos ya están borrados, no hace nada.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_tenant_id  text;
  v_user_id    text;
  v_count      integer := 0;
BEGIN
  SELECT id INTO v_tenant_id FROM "Tenant" WHERE slug = 'mercurio' LIMIT 1;
  IF v_tenant_id IS NULL THEN
    SELECT t.id INTO v_tenant_id
    FROM "Tenant" t
    JOIN "Vessel" v ON v."tenantId" = t.id
    WHERE v.code = 'LATERE'
    LIMIT 1;
  END IF;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Tenant Mercurio not found';
  END IF;

  SELECT m."userId" INTO v_user_id
  FROM "TenantMembership" m
  WHERE m."tenantId" = v_tenant_id AND m.role = 'TENANT_ADMIN'
  ORDER BY m."createdAt" ASC LIMIT 1;
  IF v_user_id IS NULL THEN
    SELECT m."userId" INTO v_user_id FROM "TenantMembership" m WHERE m."tenantId" = v_tenant_id ORDER BY m."createdAt" ASC LIMIT 1;
  END IF;

  -- Soft-delete repuestos Cummins activos de LATERE (motor inválido para esa nave)
  UPDATE "Spare"
     SET "deletedAt"        = NOW(),
         "deletedByUserId"  = v_user_id,
         "updatedAt"        = NOW(),
         "updatedByUserId"  = v_user_id
   WHERE "tenantId"   = v_tenant_id
     AND "vesselCode" = 'LATERE'
     AND manufacturer = 'CUMMINS'
     AND "deletedAt"  IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RAISE NOTICE 'Soft-deleted % spares Cummins de LATERE', v_count;
END $$;

-- ── Verificación: lista los spares activos restantes en LATERE ───────────────
SELECT sku, name, manufacturer, "manufacturerPartNumber", "minStock"
FROM "Spare" s
WHERE s."tenantId" IN (SELECT id FROM "Tenant" WHERE slug='mercurio')
  AND s."vesselCode" = 'LATERE'
  AND s."deletedAt"  IS NULL
ORDER BY s.manufacturer, s.sku;

COMMIT;
