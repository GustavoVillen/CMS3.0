-- =============================================================================
-- Mercurio — Ajuste de triggerResultMode según taskType
-- =============================================================================
-- Tras el import masivo todos los planes quedaron con triggerResultMode =
-- DUE_ONLY (default del schema), lo que en UI muestra el botón "Reportar"
-- (cierre rápido) en vez de "Abrir OT" (Orden de Trabajo formal).
--
-- Regla aplicada:
--   taskType = MAINTENANCE → APPROVAL_WO  (abre OT con aprobación)
--   taskType = INSPECTION  → DUE_ONLY     (reportar rápido sin OT)
--
-- Justificación operativa:
--   Una inspección visual mensual ("comprobar alarmas", "verificar nivel")
--   no necesita OT formal. Un mantenimiento real (cambio de aceite, ajuste,
--   reemplazo de filtro) sí debe generar OT con aprobación del responsable.
--
-- Idempotente: si el plan ya tiene el modo correcto, no hace nada.
-- Solo afecta planes activos (deletedAt IS NULL) del tenant Mercurio.
-- NO toca planes con triggerResultMode = AUTO_WO o CHECKLIST (configuración
-- intencional del usuario que no debemos sobreescribir).
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_tenant_id           text;
  v_user_id             text;
  v_updated_maintenance integer := 0;
  v_updated_inspection  integer := 0;
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

  -- MAINTENANCE → APPROVAL_WO
  UPDATE "MaintenancePlan"
     SET "triggerResultMode" = 'APPROVAL_WO'::"TriggerResultMode",
         "updatedAt"         = NOW(),
         "updatedByUserId"   = v_user_id
   WHERE "tenantId"          = v_tenant_id
     AND "deletedAt"         IS NULL
     AND "taskType"          = 'MAINTENANCE'::"TaskType"
     AND "triggerResultMode" = 'DUE_ONLY'::"TriggerResultMode";
  GET DIAGNOSTICS v_updated_maintenance = ROW_COUNT;

  -- INSPECTION → DUE_ONLY (no-op si ya está, pero por completitud)
  -- Solo actualizamos las que NO están ya en DUE_ONLY (no debería haber, pero
  -- por si quedó alguna como AUTO_WO/APPROVAL_WO de un import anterior).
  -- En la práctica este UPDATE casi nunca toca filas porque el default ya es DUE_ONLY.
  UPDATE "MaintenancePlan"
     SET "triggerResultMode" = 'DUE_ONLY'::"TriggerResultMode",
         "updatedAt"         = NOW(),
         "updatedByUserId"   = v_user_id
   WHERE "tenantId"          = v_tenant_id
     AND "deletedAt"         IS NULL
     AND "taskType"          = 'INSPECTION'::"TaskType"
     AND "triggerResultMode" IN ('AUTO_WO'::"TriggerResultMode", 'APPROVAL_WO'::"TriggerResultMode");
  GET DIAGNOSTICS v_updated_inspection = ROW_COUNT;

  RAISE NOTICE 'Planes MAINTENANCE → APPROVAL_WO: %', v_updated_maintenance;
  RAISE NOTICE 'Planes INSPECTION  → DUE_ONLY:    %', v_updated_inspection;
END $$;

-- ── Verificación: distribución actual de modos ─────────────────────────────
SELECT
  "taskType",
  "triggerResultMode",
  COUNT(*) AS total
FROM "MaintenancePlan"
WHERE "tenantId" IN (SELECT id FROM "Tenant" WHERE slug='mercurio')
  AND "deletedAt" IS NULL
GROUP BY "taskType", "triggerResultMode"
ORDER BY "taskType", "triggerResultMode";

COMMIT;
