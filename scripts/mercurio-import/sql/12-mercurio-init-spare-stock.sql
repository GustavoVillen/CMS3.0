-- =============================================================================
-- Mercurio — Inicialización de stock: onHand = minStock
-- =============================================================================
-- Crea un StockMovement de tipo ADJUSTMENT_PLUS por cada repuesto activo del
-- tenant Mercurio que cumpla:
--   - minStock > 0
--   - aún NO tiene movimientos de stock cargados (carga inicial)
--
-- ¿Por qué no UPDATE "Spare" SET "currentStock" = "minStock"?
-- Porque en el modelo actual la columna currentStock está deprecada. El stock
-- visible (onHand) se calcula en backend sumando los StockMovement vía
-- stock-calc-service.getOnHandMap. Para que el sistema "vea" stock, hay que
-- crear movimientos.
--
-- Idempotente: si un repuesto YA tiene cualquier StockMovement, se saltea.
--
-- Reversión manual:
--   DELETE FROM "StockMovement"
--    WHERE "tenantId" = '<id mercurio>'
--      AND notes = 'Carga inicial post-import (onHand = minStock)';
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_tenant_id   text;
  v_user_id     text;
  v_inserted    integer := 0;
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
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No TenantMembership found for tenant %', v_tenant_id;
  END IF;

  -- Insertar un movimiento ADJUSTMENT_PLUS por cada Spare elegible
  WITH eligible AS (
    SELECT s.id, s."vesselCode", s.unit, s."minStock", s.sku
    FROM "Spare" s
    WHERE s."tenantId" = v_tenant_id
      AND s."deletedAt" IS NULL
      AND s."minStock" > 0
      AND NOT EXISTS (
        SELECT 1 FROM "StockMovement" m WHERE m."spareId" = s.id
      )
  ),
  inserted AS (
    INSERT INTO "StockMovement" (
      id,
      "tenantId",
      "vesselCode",
      "spareId",
      "movementCode",
      "movementType",
      quantity,
      unit,
      "occurredAt",
      "referenceType",
      notes,
      "createdAt",
      "createdByUserId"
    )
    SELECT
      'cmv_' || substr(md5(random()::text || clock_timestamp()::text || e.id), 1, 22),
      v_tenant_id,
      e."vesselCode",
      e.id,
      'INIT-' || e."vesselCode" || '-' || e.sku,
      'ADJUSTMENT_PLUS'::"MovementType",
      e."minStock",
      e.unit,
      NOW(),
      'ADJUSTMENT'::"MovementRefType",
      'Carga inicial post-import (onHand = minStock)',
      NOW(),
      v_user_id
    FROM eligible e
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_inserted FROM inserted;

  RAISE NOTICE 'Stock inicial cargado en % repuestos (onHand = minStock)', v_inserted;
END $$;

-- ── Verificación: top 20 repuestos con stock cargado por esta corrida ───────
SELECT s.sku,
       s."vesselCode",
       s.name,
       s."minStock",
       (SELECT COALESCE(SUM(
                 CASE m."movementType"
                   WHEN 'RECEIPT'         THEN  ABS(m.quantity)
                   WHEN 'TRANSFER_IN'     THEN  ABS(m.quantity)
                   WHEN 'RETURN_IN'       THEN  ABS(m.quantity)
                   WHEN 'ADJUSTMENT_PLUS' THEN  ABS(m.quantity)
                   WHEN 'ISSUE'           THEN -ABS(m.quantity)
                   WHEN 'TRANSFER_OUT'    THEN -ABS(m.quantity)
                   WHEN 'TRANSFER'        THEN -ABS(m.quantity)
                   WHEN 'ADJUSTMENT_MINUS' THEN -ABS(m.quantity)
                   WHEN 'ADJUSTMENT'      THEN  m.quantity
                   ELSE 0 END
               ), 0)
        FROM "StockMovement" m WHERE m."spareId" = s.id) AS on_hand
FROM "Spare" s
WHERE s."tenantId" IN (SELECT id FROM "Tenant" WHERE slug='mercurio')
  AND s."deletedAt" IS NULL
  AND s."minStock" > 0
ORDER BY s."vesselCode", s.sku
LIMIT 20;

COMMIT;
