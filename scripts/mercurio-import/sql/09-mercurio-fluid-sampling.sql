-- =============================================================================
-- Mercurio — MaintenancePlan.samplingFluidType assignment
-- =============================================================================
-- Sets the fluid type for plans that involve fluid sampling/changes.
-- Plans without fluid-related tasks remain NULL (no sampling required).
--
-- Idempotent: only updates rows where samplingFluidType differs from target.
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
    SELECT m."userId" INTO v_user_id FROM "TenantMembership" m WHERE m."tenantId" = v_tenant_id ORDER BY m."createdAt" ASC LIMIT 1;
  END IF;

  RAISE NOTICE 'Tenant: %, User: %', v_tenant_id, v_user_id;

  UPDATE "MaintenancePlan"
     SET "samplingFluidType" = CAST('COOLING_WATER' AS "FluidType"),
         "updatedAt"         = NOW(),
         "updatedByUserId"   = v_user_id
   WHERE "tenantId"   = v_tenant_id
     AND "taskCode"   = 'DONCHI-AUX-01-3000H-M'
     AND "deletedAt"  IS NULL
     AND ("samplingFluidType" IS NULL OR "samplingFluidType"::text != 'COOLING_WATER');
  IF FOUND THEN v_count := v_count + 1; END IF;
  UPDATE "MaintenancePlan"
     SET "samplingFluidType" = CAST('ENGINE_OIL' AS "FluidType"),
         "updatedAt"         = NOW(),
         "updatedByUserId"   = v_user_id
   WHERE "tenantId"   = v_tenant_id
     AND "taskCode"   = 'DONCHI-AUX-01-450H-M'
     AND "deletedAt"  IS NULL
     AND ("samplingFluidType" IS NULL OR "samplingFluidType"::text != 'ENGINE_OIL');
  IF FOUND THEN v_count := v_count + 1; END IF;
  UPDATE "MaintenancePlan"
     SET "samplingFluidType" = CAST('FUEL_DIESEL' AS "FluidType"),
         "updatedAt"         = NOW(),
         "updatedByUserId"   = v_user_id
   WHERE "tenantId"   = v_tenant_id
     AND "taskCode"   = 'DONCHI-AUX-01-900H-M'
     AND "deletedAt"  IS NULL
     AND ("samplingFluidType" IS NULL OR "samplingFluidType"::text != 'FUEL_DIESEL');
  IF FOUND THEN v_count := v_count + 1; END IF;
  UPDATE "MaintenancePlan"
     SET "samplingFluidType" = CAST('COOLING_WATER' AS "FluidType"),
         "updatedAt"         = NOW(),
         "updatedByUserId"   = v_user_id
   WHERE "tenantId"   = v_tenant_id
     AND "taskCode"   = 'DONCHI-AUX-02-3000H-M'
     AND "deletedAt"  IS NULL
     AND ("samplingFluidType" IS NULL OR "samplingFluidType"::text != 'COOLING_WATER');
  IF FOUND THEN v_count := v_count + 1; END IF;
  UPDATE "MaintenancePlan"
     SET "samplingFluidType" = CAST('ENGINE_OIL' AS "FluidType"),
         "updatedAt"         = NOW(),
         "updatedByUserId"   = v_user_id
   WHERE "tenantId"   = v_tenant_id
     AND "taskCode"   = 'DONCHI-AUX-02-450H-M'
     AND "deletedAt"  IS NULL
     AND ("samplingFluidType" IS NULL OR "samplingFluidType"::text != 'ENGINE_OIL');
  IF FOUND THEN v_count := v_count + 1; END IF;
  UPDATE "MaintenancePlan"
     SET "samplingFluidType" = CAST('FUEL_DIESEL' AS "FluidType"),
         "updatedAt"         = NOW(),
         "updatedByUserId"   = v_user_id
   WHERE "tenantId"   = v_tenant_id
     AND "taskCode"   = 'DONCHI-AUX-02-900H-M'
     AND "deletedAt"  IS NULL
     AND ("samplingFluidType" IS NULL OR "samplingFluidType"::text != 'FUEL_DIESEL');
  IF FOUND THEN v_count := v_count + 1; END IF;
  UPDATE "MaintenancePlan"
     SET "samplingFluidType" = CAST('COOLING_WATER' AS "FluidType"),
         "updatedAt"         = NOW(),
         "updatedByUserId"   = v_user_id
   WHERE "tenantId"   = v_tenant_id
     AND "taskCode"   = 'DONCHI-AUX-03-3000H-M'
     AND "deletedAt"  IS NULL
     AND ("samplingFluidType" IS NULL OR "samplingFluidType"::text != 'COOLING_WATER');
  IF FOUND THEN v_count := v_count + 1; END IF;
  UPDATE "MaintenancePlan"
     SET "samplingFluidType" = CAST('ENGINE_OIL' AS "FluidType"),
         "updatedAt"         = NOW(),
         "updatedByUserId"   = v_user_id
   WHERE "tenantId"   = v_tenant_id
     AND "taskCode"   = 'DONCHI-AUX-03-450H-M'
     AND "deletedAt"  IS NULL
     AND ("samplingFluidType" IS NULL OR "samplingFluidType"::text != 'ENGINE_OIL');
  IF FOUND THEN v_count := v_count + 1; END IF;
  UPDATE "MaintenancePlan"
     SET "samplingFluidType" = CAST('FUEL_DIESEL' AS "FluidType"),
         "updatedAt"         = NOW(),
         "updatedByUserId"   = v_user_id
   WHERE "tenantId"   = v_tenant_id
     AND "taskCode"   = 'DONCHI-AUX-03-900H-M'
     AND "deletedAt"  IS NULL
     AND ("samplingFluidType" IS NULL OR "samplingFluidType"::text != 'FUEL_DIESEL');
  IF FOUND THEN v_count := v_count + 1; END IF;
  UPDATE "MaintenancePlan"
     SET "samplingFluidType" = CAST('GEARBOX_OIL' AS "FluidType"),
         "updatedAt"         = NOW(),
         "updatedByUserId"   = v_user_id
   WHERE "tenantId"   = v_tenant_id
     AND "taskCode"   = 'DONCHI-CAJ-12M-M'
     AND "deletedAt"  IS NULL
     AND ("samplingFluidType" IS NULL OR "samplingFluidType"::text != 'GEARBOX_OIL');
  IF FOUND THEN v_count := v_count + 1; END IF;
  UPDATE "MaintenancePlan"
     SET "samplingFluidType" = CAST('HYDRAULIC_OIL' AS "FluidType"),
         "updatedAt"         = NOW(),
         "updatedByUserId"   = v_user_id
   WHERE "tenantId"   = v_tenant_id
     AND "taskCode"   = 'DONCHI-GOB-12M-M'
     AND "deletedAt"  IS NULL
     AND ("samplingFluidType" IS NULL OR "samplingFluidType"::text != 'HYDRAULIC_OIL');
  IF FOUND THEN v_count := v_count + 1; END IF;
  UPDATE "MaintenancePlan"
     SET "samplingFluidType" = CAST('HYDRAULIC_OIL' AS "FluidType"),
         "updatedAt"         = NOW(),
         "updatedByUserId"   = v_user_id
   WHERE "tenantId"   = v_tenant_id
     AND "taskCode"   = 'DONCHI-GOB-1M-I'
     AND "deletedAt"  IS NULL
     AND ("samplingFluidType" IS NULL OR "samplingFluidType"::text != 'HYDRAULIC_OIL');
  IF FOUND THEN v_count := v_count + 1; END IF;
  UPDATE "MaintenancePlan"
     SET "samplingFluidType" = CAST('FUEL_DIESEL' AS "FluidType"),
         "updatedAt"         = NOW(),
         "updatedByUserId"   = v_user_id
   WHERE "tenantId"   = v_tenant_id
     AND "taskCode"   = 'DONCHI-LAN-01-1M-M'
     AND "deletedAt"  IS NULL
     AND ("samplingFluidType" IS NULL OR "samplingFluidType"::text != 'FUEL_DIESEL');
  IF FOUND THEN v_count := v_count + 1; END IF;
  UPDATE "MaintenancePlan"
     SET "samplingFluidType" = CAST('FUEL_DIESEL' AS "FluidType"),
         "updatedAt"         = NOW(),
         "updatedByUserId"   = v_user_id
   WHERE "tenantId"   = v_tenant_id
     AND "taskCode"   = 'DONCHI-PROP-BB-1500H-M'
     AND "deletedAt"  IS NULL
     AND ("samplingFluidType" IS NULL OR "samplingFluidType"::text != 'FUEL_DIESEL');
  IF FOUND THEN v_count := v_count + 1; END IF;
  UPDATE "MaintenancePlan"
     SET "samplingFluidType" = CAST('COOLING_WATER' AS "FluidType"),
         "updatedAt"         = NOW(),
         "updatedByUserId"   = v_user_id
   WHERE "tenantId"   = v_tenant_id
     AND "taskCode"   = 'DONCHI-PROP-BB-16000H-I'
     AND "deletedAt"  IS NULL
     AND ("samplingFluidType" IS NULL OR "samplingFluidType"::text != 'COOLING_WATER');
  IF FOUND THEN v_count := v_count + 1; END IF;
  UPDATE "MaintenancePlan"
     SET "samplingFluidType" = CAST('COOLING_WATER' AS "FluidType"),
         "updatedAt"         = NOW(),
         "updatedByUserId"   = v_user_id
   WHERE "tenantId"   = v_tenant_id
     AND "taskCode"   = 'DONCHI-PROP-BB-24000H-I'
     AND "deletedAt"  IS NULL
     AND ("samplingFluidType" IS NULL OR "samplingFluidType"::text != 'COOLING_WATER');
  IF FOUND THEN v_count := v_count + 1; END IF;
  UPDATE "MaintenancePlan"
     SET "samplingFluidType" = CAST('ENGINE_OIL' AS "FluidType"),
         "updatedAt"         = NOW(),
         "updatedByUserId"   = v_user_id
   WHERE "tenantId"   = v_tenant_id
     AND "taskCode"   = 'DONCHI-PROP-BB-3000H-M'
     AND "deletedAt"  IS NULL
     AND ("samplingFluidType" IS NULL OR "samplingFluidType"::text != 'ENGINE_OIL');
  IF FOUND THEN v_count := v_count + 1; END IF;
  UPDATE "MaintenancePlan"
     SET "samplingFluidType" = CAST('COOLING_WATER' AS "FluidType"),
         "updatedAt"         = NOW(),
         "updatedByUserId"   = v_user_id
   WHERE "tenantId"   = v_tenant_id
     AND "taskCode"   = 'DONCHI-PROP-BB-8000H-M'
     AND "deletedAt"  IS NULL
     AND ("samplingFluidType" IS NULL OR "samplingFluidType"::text != 'COOLING_WATER');
  IF FOUND THEN v_count := v_count + 1; END IF;
  UPDATE "MaintenancePlan"
     SET "samplingFluidType" = CAST('FUEL_DIESEL' AS "FluidType"),
         "updatedAt"         = NOW(),
         "updatedByUserId"   = v_user_id
   WHERE "tenantId"   = v_tenant_id
     AND "taskCode"   = 'DONCHI-PROP-EB-1500H-M'
     AND "deletedAt"  IS NULL
     AND ("samplingFluidType" IS NULL OR "samplingFluidType"::text != 'FUEL_DIESEL');
  IF FOUND THEN v_count := v_count + 1; END IF;
  UPDATE "MaintenancePlan"
     SET "samplingFluidType" = CAST('COOLING_WATER' AS "FluidType"),
         "updatedAt"         = NOW(),
         "updatedByUserId"   = v_user_id
   WHERE "tenantId"   = v_tenant_id
     AND "taskCode"   = 'DONCHI-PROP-EB-16000H-I'
     AND "deletedAt"  IS NULL
     AND ("samplingFluidType" IS NULL OR "samplingFluidType"::text != 'COOLING_WATER');
  IF FOUND THEN v_count := v_count + 1; END IF;
  UPDATE "MaintenancePlan"
     SET "samplingFluidType" = CAST('COOLING_WATER' AS "FluidType"),
         "updatedAt"         = NOW(),
         "updatedByUserId"   = v_user_id
   WHERE "tenantId"   = v_tenant_id
     AND "taskCode"   = 'DONCHI-PROP-EB-24000H-I'
     AND "deletedAt"  IS NULL
     AND ("samplingFluidType" IS NULL OR "samplingFluidType"::text != 'COOLING_WATER');
  IF FOUND THEN v_count := v_count + 1; END IF;
  UPDATE "MaintenancePlan"
     SET "samplingFluidType" = CAST('ENGINE_OIL' AS "FluidType"),
         "updatedAt"         = NOW(),
         "updatedByUserId"   = v_user_id
   WHERE "tenantId"   = v_tenant_id
     AND "taskCode"   = 'DONCHI-PROP-EB-3000H-M'
     AND "deletedAt"  IS NULL
     AND ("samplingFluidType" IS NULL OR "samplingFluidType"::text != 'ENGINE_OIL');
  IF FOUND THEN v_count := v_count + 1; END IF;
  UPDATE "MaintenancePlan"
     SET "samplingFluidType" = CAST('COOLING_WATER' AS "FluidType"),
         "updatedAt"         = NOW(),
         "updatedByUserId"   = v_user_id
   WHERE "tenantId"   = v_tenant_id
     AND "taskCode"   = 'DONCHI-PROP-EB-8000H-M'
     AND "deletedAt"  IS NULL
     AND ("samplingFluidType" IS NULL OR "samplingFluidType"::text != 'COOLING_WATER');
  IF FOUND THEN v_count := v_count + 1; END IF;
  UPDATE "MaintenancePlan"
     SET "samplingFluidType" = CAST('FUEL_DIESEL' AS "FluidType"),
         "updatedAt"         = NOW(),
         "updatedByUserId"   = v_user_id
   WHERE "tenantId"   = v_tenant_id
     AND "taskCode"   = 'GLT007-PROP-300H-M'
     AND "deletedAt"  IS NULL
     AND ("samplingFluidType" IS NULL OR "samplingFluidType"::text != 'FUEL_DIESEL');
  IF FOUND THEN v_count := v_count + 1; END IF;
  UPDATE "MaintenancePlan"
     SET "samplingFluidType" = CAST('FUEL_DIESEL' AS "FluidType"),
         "updatedAt"         = NOW(),
         "updatedByUserId"   = v_user_id
   WHERE "tenantId"   = v_tenant_id
     AND "taskCode"   = 'GLT008-PROP-300H-M'
     AND "deletedAt"  IS NULL
     AND ("samplingFluidType" IS NULL OR "samplingFluidType"::text != 'FUEL_DIESEL');
  IF FOUND THEN v_count := v_count + 1; END IF;
  UPDATE "MaintenancePlan"
     SET "samplingFluidType" = CAST('ENGINE_OIL' AS "FluidType"),
         "updatedAt"         = NOW(),
         "updatedByUserId"   = v_user_id
   WHERE "tenantId"   = v_tenant_id
     AND "taskCode"   = 'LATERE-AUX-01-250H-M'
     AND "deletedAt"  IS NULL
     AND ("samplingFluidType" IS NULL OR "samplingFluidType"::text != 'ENGINE_OIL');
  IF FOUND THEN v_count := v_count + 1; END IF;
  UPDATE "MaintenancePlan"
     SET "samplingFluidType" = CAST('COOLING_WATER' AS "FluidType"),
         "updatedAt"         = NOW(),
         "updatedByUserId"   = v_user_id
   WHERE "tenantId"   = v_tenant_id
     AND "taskCode"   = 'LATERE-AUX-01-3000H-M'
     AND "deletedAt"  IS NULL
     AND ("samplingFluidType" IS NULL OR "samplingFluidType"::text != 'COOLING_WATER');
  IF FOUND THEN v_count := v_count + 1; END IF;
  UPDATE "MaintenancePlan"
     SET "samplingFluidType" = CAST('FUEL_DIESEL' AS "FluidType"),
         "updatedAt"         = NOW(),
         "updatedByUserId"   = v_user_id
   WHERE "tenantId"   = v_tenant_id
     AND "taskCode"   = 'LATERE-AUX-01-500H-M'
     AND "deletedAt"  IS NULL
     AND ("samplingFluidType" IS NULL OR "samplingFluidType"::text != 'FUEL_DIESEL');
  IF FOUND THEN v_count := v_count + 1; END IF;
  UPDATE "MaintenancePlan"
     SET "samplingFluidType" = CAST('ENGINE_OIL' AS "FluidType"),
         "updatedAt"         = NOW(),
         "updatedByUserId"   = v_user_id
   WHERE "tenantId"   = v_tenant_id
     AND "taskCode"   = 'LATERE-AUX-02-250H-M'
     AND "deletedAt"  IS NULL
     AND ("samplingFluidType" IS NULL OR "samplingFluidType"::text != 'ENGINE_OIL');
  IF FOUND THEN v_count := v_count + 1; END IF;
  UPDATE "MaintenancePlan"
     SET "samplingFluidType" = CAST('COOLING_WATER' AS "FluidType"),
         "updatedAt"         = NOW(),
         "updatedByUserId"   = v_user_id
   WHERE "tenantId"   = v_tenant_id
     AND "taskCode"   = 'LATERE-AUX-02-3000H-M'
     AND "deletedAt"  IS NULL
     AND ("samplingFluidType" IS NULL OR "samplingFluidType"::text != 'COOLING_WATER');
  IF FOUND THEN v_count := v_count + 1; END IF;
  UPDATE "MaintenancePlan"
     SET "samplingFluidType" = CAST('FUEL_DIESEL' AS "FluidType"),
         "updatedAt"         = NOW(),
         "updatedByUserId"   = v_user_id
   WHERE "tenantId"   = v_tenant_id
     AND "taskCode"   = 'LATERE-AUX-02-500H-M'
     AND "deletedAt"  IS NULL
     AND ("samplingFluidType" IS NULL OR "samplingFluidType"::text != 'FUEL_DIESEL');
  IF FOUND THEN v_count := v_count + 1; END IF;
  UPDATE "MaintenancePlan"
     SET "samplingFluidType" = CAST('ENGINE_OIL' AS "FluidType"),
         "updatedAt"         = NOW(),
         "updatedByUserId"   = v_user_id
   WHERE "tenantId"   = v_tenant_id
     AND "taskCode"   = 'LATERE-AUX-03-250H-M'
     AND "deletedAt"  IS NULL
     AND ("samplingFluidType" IS NULL OR "samplingFluidType"::text != 'ENGINE_OIL');
  IF FOUND THEN v_count := v_count + 1; END IF;
  UPDATE "MaintenancePlan"
     SET "samplingFluidType" = CAST('COOLING_WATER' AS "FluidType"),
         "updatedAt"         = NOW(),
         "updatedByUserId"   = v_user_id
   WHERE "tenantId"   = v_tenant_id
     AND "taskCode"   = 'LATERE-AUX-03-3000H-M'
     AND "deletedAt"  IS NULL
     AND ("samplingFluidType" IS NULL OR "samplingFluidType"::text != 'COOLING_WATER');
  IF FOUND THEN v_count := v_count + 1; END IF;
  UPDATE "MaintenancePlan"
     SET "samplingFluidType" = CAST('FUEL_DIESEL' AS "FluidType"),
         "updatedAt"         = NOW(),
         "updatedByUserId"   = v_user_id
   WHERE "tenantId"   = v_tenant_id
     AND "taskCode"   = 'LATERE-AUX-03-500H-M'
     AND "deletedAt"  IS NULL
     AND ("samplingFluidType" IS NULL OR "samplingFluidType"::text != 'FUEL_DIESEL');
  IF FOUND THEN v_count := v_count + 1; END IF;
  UPDATE "MaintenancePlan"
     SET "samplingFluidType" = CAST('GEARBOX_OIL' AS "FluidType"),
         "updatedAt"         = NOW(),
         "updatedByUserId"   = v_user_id
   WHERE "tenantId"   = v_tenant_id
     AND "taskCode"   = 'LATERE-CAJ-12M-M'
     AND "deletedAt"  IS NULL
     AND ("samplingFluidType" IS NULL OR "samplingFluidType"::text != 'GEARBOX_OIL');
  IF FOUND THEN v_count := v_count + 1; END IF;
  UPDATE "MaintenancePlan"
     SET "samplingFluidType" = CAST('HYDRAULIC_OIL' AS "FluidType"),
         "updatedAt"         = NOW(),
         "updatedByUserId"   = v_user_id
   WHERE "tenantId"   = v_tenant_id
     AND "taskCode"   = 'LATERE-GOB-12M-M'
     AND "deletedAt"  IS NULL
     AND ("samplingFluidType" IS NULL OR "samplingFluidType"::text != 'HYDRAULIC_OIL');
  IF FOUND THEN v_count := v_count + 1; END IF;
  UPDATE "MaintenancePlan"
     SET "samplingFluidType" = CAST('HYDRAULIC_OIL' AS "FluidType"),
         "updatedAt"         = NOW(),
         "updatedByUserId"   = v_user_id
   WHERE "tenantId"   = v_tenant_id
     AND "taskCode"   = 'LATERE-GOB-1M-I'
     AND "deletedAt"  IS NULL
     AND ("samplingFluidType" IS NULL OR "samplingFluidType"::text != 'HYDRAULIC_OIL');
  IF FOUND THEN v_count := v_count + 1; END IF;
  UPDATE "MaintenancePlan"
     SET "samplingFluidType" = CAST('FUEL_DIESEL' AS "FluidType"),
         "updatedAt"         = NOW(),
         "updatedByUserId"   = v_user_id
   WHERE "tenantId"   = v_tenant_id
     AND "taskCode"   = 'LATERE-LAN-01-1M-M'
     AND "deletedAt"  IS NULL
     AND ("samplingFluidType" IS NULL OR "samplingFluidType"::text != 'FUEL_DIESEL');
  IF FOUND THEN v_count := v_count + 1; END IF;
  UPDATE "MaintenancePlan"
     SET "samplingFluidType" = CAST('FUEL_DIESEL' AS "FluidType"),
         "updatedAt"         = NOW(),
         "updatedByUserId"   = v_user_id
   WHERE "tenantId"   = v_tenant_id
     AND "taskCode"   = 'LATERE-LAN-02-1M-M'
     AND "deletedAt"  IS NULL
     AND ("samplingFluidType" IS NULL OR "samplingFluidType"::text != 'FUEL_DIESEL');
  IF FOUND THEN v_count := v_count + 1; END IF;
  UPDATE "MaintenancePlan"
     SET "samplingFluidType" = CAST('ENGINE_OIL' AS "FluidType"),
         "updatedAt"         = NOW(),
         "updatedByUserId"   = v_user_id
   WHERE "tenantId"   = v_tenant_id
     AND "taskCode"   = 'LATERE-PROP-BB-250H-M'
     AND "deletedAt"  IS NULL
     AND ("samplingFluidType" IS NULL OR "samplingFluidType"::text != 'ENGINE_OIL');
  IF FOUND THEN v_count := v_count + 1; END IF;
  UPDATE "MaintenancePlan"
     SET "samplingFluidType" = CAST('COOLING_WATER' AS "FluidType"),
         "updatedAt"         = NOW(),
         "updatedByUserId"   = v_user_id
   WHERE "tenantId"   = v_tenant_id
     AND "taskCode"   = 'LATERE-PROP-BB-27000H-I'
     AND "deletedAt"  IS NULL
     AND ("samplingFluidType" IS NULL OR "samplingFluidType"::text != 'COOLING_WATER');
  IF FOUND THEN v_count := v_count + 1; END IF;
  UPDATE "MaintenancePlan"
     SET "samplingFluidType" = CAST('FUEL_DIESEL' AS "FluidType"),
         "updatedAt"         = NOW(),
         "updatedByUserId"   = v_user_id
   WHERE "tenantId"   = v_tenant_id
     AND "taskCode"   = 'LATERE-PROP-BB-500H-M'
     AND "deletedAt"  IS NULL
     AND ("samplingFluidType" IS NULL OR "samplingFluidType"::text != 'FUEL_DIESEL');
  IF FOUND THEN v_count := v_count + 1; END IF;
  UPDATE "MaintenancePlan"
     SET "samplingFluidType" = CAST('COOLING_WATER' AS "FluidType"),
         "updatedAt"         = NOW(),
         "updatedByUserId"   = v_user_id
   WHERE "tenantId"   = v_tenant_id
     AND "taskCode"   = 'LATERE-PROP-BB-6000H-M'
     AND "deletedAt"  IS NULL
     AND ("samplingFluidType" IS NULL OR "samplingFluidType"::text != 'COOLING_WATER');
  IF FOUND THEN v_count := v_count + 1; END IF;
  UPDATE "MaintenancePlan"
     SET "samplingFluidType" = CAST('FUEL_DIESEL' AS "FluidType"),
         "updatedAt"         = NOW(),
         "updatedByUserId"   = v_user_id
   WHERE "tenantId"   = v_tenant_id
     AND "taskCode"   = 'LATERE-PROP-BBC-1500H-M'
     AND "deletedAt"  IS NULL
     AND ("samplingFluidType" IS NULL OR "samplingFluidType"::text != 'FUEL_DIESEL');
  IF FOUND THEN v_count := v_count + 1; END IF;
  UPDATE "MaintenancePlan"
     SET "samplingFluidType" = CAST('COOLING_WATER' AS "FluidType"),
         "updatedAt"         = NOW(),
         "updatedByUserId"   = v_user_id
   WHERE "tenantId"   = v_tenant_id
     AND "taskCode"   = 'LATERE-PROP-BBC-27000H-I'
     AND "deletedAt"  IS NULL
     AND ("samplingFluidType" IS NULL OR "samplingFluidType"::text != 'COOLING_WATER');
  IF FOUND THEN v_count := v_count + 1; END IF;
  UPDATE "MaintenancePlan"
     SET "samplingFluidType" = CAST('ENGINE_OIL' AS "FluidType"),
         "updatedAt"         = NOW(),
         "updatedByUserId"   = v_user_id
   WHERE "tenantId"   = v_tenant_id
     AND "taskCode"   = 'LATERE-PROP-BBC-3000H-M'
     AND "deletedAt"  IS NULL
     AND ("samplingFluidType" IS NULL OR "samplingFluidType"::text != 'ENGINE_OIL');
  IF FOUND THEN v_count := v_count + 1; END IF;
  UPDATE "MaintenancePlan"
     SET "samplingFluidType" = CAST('COOLING_WATER' AS "FluidType"),
         "updatedAt"         = NOW(),
         "updatedByUserId"   = v_user_id
   WHERE "tenantId"   = v_tenant_id
     AND "taskCode"   = 'LATERE-PROP-BBC-6000H-M'
     AND "deletedAt"  IS NULL
     AND ("samplingFluidType" IS NULL OR "samplingFluidType"::text != 'COOLING_WATER');
  IF FOUND THEN v_count := v_count + 1; END IF;
  UPDATE "MaintenancePlan"
     SET "samplingFluidType" = CAST('FUEL_DIESEL' AS "FluidType"),
         "updatedAt"         = NOW(),
         "updatedByUserId"   = v_user_id
   WHERE "tenantId"   = v_tenant_id
     AND "taskCode"   = 'LATERE-PROP-EB-1500H-M'
     AND "deletedAt"  IS NULL
     AND ("samplingFluidType" IS NULL OR "samplingFluidType"::text != 'FUEL_DIESEL');
  IF FOUND THEN v_count := v_count + 1; END IF;
  UPDATE "MaintenancePlan"
     SET "samplingFluidType" = CAST('COOLING_WATER' AS "FluidType"),
         "updatedAt"         = NOW(),
         "updatedByUserId"   = v_user_id
   WHERE "tenantId"   = v_tenant_id
     AND "taskCode"   = 'LATERE-PROP-EB-27000H-I'
     AND "deletedAt"  IS NULL
     AND ("samplingFluidType" IS NULL OR "samplingFluidType"::text != 'COOLING_WATER');
  IF FOUND THEN v_count := v_count + 1; END IF;
  UPDATE "MaintenancePlan"
     SET "samplingFluidType" = CAST('ENGINE_OIL' AS "FluidType"),
         "updatedAt"         = NOW(),
         "updatedByUserId"   = v_user_id
   WHERE "tenantId"   = v_tenant_id
     AND "taskCode"   = 'LATERE-PROP-EB-3000H-M'
     AND "deletedAt"  IS NULL
     AND ("samplingFluidType" IS NULL OR "samplingFluidType"::text != 'ENGINE_OIL');
  IF FOUND THEN v_count := v_count + 1; END IF;
  UPDATE "MaintenancePlan"
     SET "samplingFluidType" = CAST('COOLING_WATER' AS "FluidType"),
         "updatedAt"         = NOW(),
         "updatedByUserId"   = v_user_id
   WHERE "tenantId"   = v_tenant_id
     AND "taskCode"   = 'LATERE-PROP-EB-6000H-M'
     AND "deletedAt"  IS NULL
     AND ("samplingFluidType" IS NULL OR "samplingFluidType"::text != 'COOLING_WATER');
  IF FOUND THEN v_count := v_count + 1; END IF;
  UPDATE "MaintenancePlan"
     SET "samplingFluidType" = CAST('FUEL_DIESEL' AS "FluidType"),
         "updatedAt"         = NOW(),
         "updatedByUserId"   = v_user_id
   WHERE "tenantId"   = v_tenant_id
     AND "taskCode"   = 'LATERE-PROP-EBC-1500H-M'
     AND "deletedAt"  IS NULL
     AND ("samplingFluidType" IS NULL OR "samplingFluidType"::text != 'FUEL_DIESEL');
  IF FOUND THEN v_count := v_count + 1; END IF;
  UPDATE "MaintenancePlan"
     SET "samplingFluidType" = CAST('COOLING_WATER' AS "FluidType"),
         "updatedAt"         = NOW(),
         "updatedByUserId"   = v_user_id
   WHERE "tenantId"   = v_tenant_id
     AND "taskCode"   = 'LATERE-PROP-EBC-27000H-I'
     AND "deletedAt"  IS NULL
     AND ("samplingFluidType" IS NULL OR "samplingFluidType"::text != 'COOLING_WATER');
  IF FOUND THEN v_count := v_count + 1; END IF;
  UPDATE "MaintenancePlan"
     SET "samplingFluidType" = CAST('ENGINE_OIL' AS "FluidType"),
         "updatedAt"         = NOW(),
         "updatedByUserId"   = v_user_id
   WHERE "tenantId"   = v_tenant_id
     AND "taskCode"   = 'LATERE-PROP-EBC-3000H-M'
     AND "deletedAt"  IS NULL
     AND ("samplingFluidType" IS NULL OR "samplingFluidType"::text != 'ENGINE_OIL');
  IF FOUND THEN v_count := v_count + 1; END IF;
  UPDATE "MaintenancePlan"
     SET "samplingFluidType" = CAST('COOLING_WATER' AS "FluidType"),
         "updatedAt"         = NOW(),
         "updatedByUserId"   = v_user_id
   WHERE "tenantId"   = v_tenant_id
     AND "taskCode"   = 'LATERE-PROP-EBC-6000H-M'
     AND "deletedAt"  IS NULL
     AND ("samplingFluidType" IS NULL OR "samplingFluidType"::text != 'COOLING_WATER');
  IF FOUND THEN v_count := v_count + 1; END IF;

  RAISE NOTICE 'samplingFluidType updated on % plans', v_count;
END $$;

-- ── Verification: distribution of samplingFluidType across Mercurio plans ────
SELECT
  COALESCE("samplingFluidType"::text, '(none)') AS fluid_type,
  COUNT(*) AS plans
FROM "MaintenancePlan" mp
WHERE mp."tenantId" IN (SELECT id FROM "Tenant" WHERE slug='mercurio')
  AND mp."deletedAt" IS NULL
GROUP BY 1
ORDER BY 2 DESC;

COMMIT;
