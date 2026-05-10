-- =============================================================================
-- Mercurio — Soft-delete de TODOS los Maintenance Plans del tenant
-- =============================================================================
-- Marca todos los planes como eliminados (deletedAt = NOW()).
--
-- ⚠ DESTRUCTIVO pero REVERSIBLE: los registros NO se borran físicamente,
-- solo se marcan con deletedAt. La UI los oculta. Las WorkOrders/WorkLogs
-- ya generadas siguen apuntando al planId (no se rompe la referencia).
--
-- Para restaurar manualmente:
--   UPDATE "MaintenancePlan"
--      SET "deletedAt" = NULL, "deletedByUserId" = NULL
--    WHERE "tenantId" = '<id mercurio>'
--      AND "deletedAt" IS NOT NULL;
--
-- Idempotente: si ya están eliminados, no hace nada.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_tenant_id   text;
  v_user_id     text;
  v_before      integer;
  v_after       integer;
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

  -- Cuenta antes
  SELECT COUNT(*) INTO v_before
  FROM "MaintenancePlan"
  WHERE "tenantId" = v_tenant_id
    AND "deletedAt" IS NULL;

  RAISE NOTICE 'Maintenance plans activos antes del delete: %', v_before;

  -- Soft-delete masivo
  UPDATE "MaintenancePlan"
     SET "deletedAt"        = NOW(),
         "deletedByUserId"  = v_user_id,
         "updatedAt"        = NOW(),
         "updatedByUserId"  = v_user_id
   WHERE "tenantId" = v_tenant_id
     AND "deletedAt" IS NULL;

  GET DIAGNOSTICS v_after = ROW_COUNT;
  RAISE NOTICE 'Soft-deleted % maintenance plans', v_after;
END $$;

-- ── Verificación ────────────────────────────────────────────────────────────
SELECT
  COUNT(*) FILTER (WHERE "deletedAt" IS NULL)     AS active_plans,
  COUNT(*) FILTER (WHERE "deletedAt" IS NOT NULL) AS deleted_plans,
  COUNT(*)                                         AS total
FROM "MaintenancePlan"
WHERE "tenantId" IN (SELECT id FROM "Tenant" WHERE slug='mercurio');

COMMIT;
