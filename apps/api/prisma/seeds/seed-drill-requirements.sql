-- Seed SOLAS/ISPS/MARPOL drill requirements per tenant
-- - capitalmaritima: PT
-- - mercurio: ES
-- - demo: ES

-- Helper: get tenant + admin userId
DO $$
DECLARE
  v_cap_tid TEXT; v_cap_uid TEXT;
  v_mer_tid TEXT; v_mer_uid TEXT;
  v_dem_tid TEXT; v_dem_uid TEXT;
  v_now TIMESTAMP := NOW();
BEGIN
  SELECT t.id, tm."userId" INTO v_cap_tid, v_cap_uid
    FROM "Tenant" t JOIN "TenantMembership" tm ON tm."tenantId"=t.id
    WHERE t.slug='capitalmaritima' AND tm.role='TENANT_ADMIN' LIMIT 1;
  SELECT t.id, tm."userId" INTO v_mer_tid, v_mer_uid
    FROM "Tenant" t JOIN "TenantMembership" tm ON tm."tenantId"=t.id
    WHERE t.slug='mercurio' AND tm.role='TENANT_ADMIN' LIMIT 1;
  SELECT t.id, tm."userId" INTO v_dem_tid, v_dem_uid
    FROM "Tenant" t JOIN "TenantMembership" tm ON tm."tenantId"=t.id
    WHERE t.slug='demo' AND tm.role='TENANT_ADMIN' LIMIT 1;

  -- ─── capitalmaritima (PT) ─────────────────────────────────────────────────
  INSERT INTO "DrillRequirement"
    (id, "tenantId", title, "solasRegulation", "frequencyDays", "intervalLabel",
     "performedBy", "applicableVesselCodes", notes, enabled, "sortOrder",
     "createdAt", "createdByUserId", "updatedAt", "updatedByUserId")
  VALUES
    ('drlrq_cap_01', v_cap_tid, 'Incêndio',                 'SOLAS III/19.3.2',  30, 'Mensal',     '[]'::jsonb, '[]'::jsonb, NULL, true,  1, v_now, v_cap_uid, v_now, v_cap_uid),
    ('drlrq_cap_02', v_cap_tid, 'Abandono de embarcação',   'SOLAS III/19.3.2',  30, 'Mensal',     '[]'::jsonb, '[]'::jsonb, NULL, true,  2, v_now, v_cap_uid, v_now, v_cap_uid),
    ('drlrq_cap_03', v_cap_tid, 'Espaços confinados',       'SOLAS III/19.3.3',  60, 'Bimestral',  '[]'::jsonb, '[]'::jsonb, NULL, true,  3, v_now, v_cap_uid, v_now, v_cap_uid),
    ('drlrq_cap_04', v_cap_tid, 'Homem ao mar',             'SOLAS III/19.3',    90, 'Trimestral', '[]'::jsonb, '[]'::jsonb, NULL, true,  4, v_now, v_cap_uid, v_now, v_cap_uid),
    ('drlrq_cap_05', v_cap_tid, 'Poluição (MARPOL)',        'MARPOL I/37',       90, 'Trimestral', '[]'::jsonb, '[]'::jsonb, NULL, true,  5, v_now, v_cap_uid, v_now, v_cap_uid),
    ('drlrq_cap_06', v_cap_tid, 'Derramamento de óleo',     'SOPEP / SMPEP',     90, 'Trimestral', '[]'::jsonb, '[]'::jsonb, NULL, true,  6, v_now, v_cap_uid, v_now, v_cap_uid),
    ('drlrq_cap_07', v_cap_tid, 'Segurança (ISPS)',         'ISPS Code A/13.4',  90, 'Trimestral', '[]'::jsonb, '[]'::jsonb, NULL, true,  7, v_now, v_cap_uid, v_now, v_cap_uid),
    ('drlrq_cap_08', v_cap_tid, 'Emergência médica',        'SOLAS III/19',      90, 'Trimestral', '[]'::jsonb, '[]'::jsonb, NULL, true,  8, v_now, v_cap_uid, v_now, v_cap_uid),
    ('drlrq_cap_09', v_cap_tid, 'Governo de emergência',    'SOLAS V/26.4',      90, 'Trimestral', '[]'::jsonb, '[]'::jsonb, NULL, true,  9, v_now, v_cap_uid, v_now, v_cap_uid),
    ('drlrq_cap_10', v_cap_tid, 'Blackout / Dead ship',     'SOLAS II-1/27',    180, 'Semestral',  '[]'::jsonb, '[]'::jsonb, NULL, true, 10, v_now, v_cap_uid, v_now, v_cap_uid);

  -- ─── mercurio (ES) ────────────────────────────────────────────────────────
  INSERT INTO "DrillRequirement"
    (id, "tenantId", title, "solasRegulation", "frequencyDays", "intervalLabel",
     "performedBy", "applicableVesselCodes", notes, enabled, "sortOrder",
     "createdAt", "createdByUserId", "updatedAt", "updatedByUserId")
  VALUES
    ('drlrq_mer_01', v_mer_tid, 'Incendio',                 'SOLAS III/19.3.2',  30, 'Mensual',    '[]'::jsonb, '[]'::jsonb, NULL, true,  1, v_now, v_mer_uid, v_now, v_mer_uid),
    ('drlrq_mer_02', v_mer_tid, 'Abandono de buque',        'SOLAS III/19.3.2',  30, 'Mensual',    '[]'::jsonb, '[]'::jsonb, NULL, true,  2, v_now, v_mer_uid, v_now, v_mer_uid),
    ('drlrq_mer_03', v_mer_tid, 'Espacios confinados',      'SOLAS III/19.3.3',  60, 'Bimensual',  '[]'::jsonb, '[]'::jsonb, NULL, true,  3, v_now, v_mer_uid, v_now, v_mer_uid),
    ('drlrq_mer_04', v_mer_tid, 'Hombre al agua',           'SOLAS III/19.3',    90, 'Trimestral', '[]'::jsonb, '[]'::jsonb, NULL, true,  4, v_now, v_mer_uid, v_now, v_mer_uid),
    ('drlrq_mer_05', v_mer_tid, 'Contaminación (MARPOL)',   'MARPOL I/37',       90, 'Trimestral', '[]'::jsonb, '[]'::jsonb, NULL, true,  5, v_now, v_mer_uid, v_now, v_mer_uid),
    ('drlrq_mer_06', v_mer_tid, 'Derrame de combustible',   'SOPEP / SMPEP',     90, 'Trimestral', '[]'::jsonb, '[]'::jsonb, NULL, true,  6, v_now, v_mer_uid, v_now, v_mer_uid),
    ('drlrq_mer_07', v_mer_tid, 'Seguridad (ISPS)',         'ISPS Code A/13.4',  90, 'Trimestral', '[]'::jsonb, '[]'::jsonb, NULL, true,  7, v_now, v_mer_uid, v_now, v_mer_uid),
    ('drlrq_mer_08', v_mer_tid, 'Emergencia médica',        'SOLAS III/19',      90, 'Trimestral', '[]'::jsonb, '[]'::jsonb, NULL, true,  8, v_now, v_mer_uid, v_now, v_mer_uid),
    ('drlrq_mer_09', v_mer_tid, 'Gobierno de emergencia',   'SOLAS V/26.4',      90, 'Trimestral', '[]'::jsonb, '[]'::jsonb, NULL, true,  9, v_now, v_mer_uid, v_now, v_mer_uid),
    ('drlrq_mer_10', v_mer_tid, 'Blackout / Dead ship',     'SOLAS II-1/27',    180, 'Semestral',  '[]'::jsonb, '[]'::jsonb, NULL, true, 10, v_now, v_mer_uid, v_now, v_mer_uid);

  -- ─── demo (ES) ────────────────────────────────────────────────────────────
  INSERT INTO "DrillRequirement"
    (id, "tenantId", title, "solasRegulation", "frequencyDays", "intervalLabel",
     "performedBy", "applicableVesselCodes", notes, enabled, "sortOrder",
     "createdAt", "createdByUserId", "updatedAt", "updatedByUserId")
  VALUES
    ('drlrq_dem_01', v_dem_tid, 'Incendio',                 'SOLAS III/19.3.2',  30, 'Mensual',    '[]'::jsonb, '[]'::jsonb, NULL, true,  1, v_now, v_dem_uid, v_now, v_dem_uid),
    ('drlrq_dem_02', v_dem_tid, 'Abandono de buque',        'SOLAS III/19.3.2',  30, 'Mensual',    '[]'::jsonb, '[]'::jsonb, NULL, true,  2, v_now, v_dem_uid, v_now, v_dem_uid),
    ('drlrq_dem_03', v_dem_tid, 'Espacios confinados',      'SOLAS III/19.3.3',  60, 'Bimensual',  '[]'::jsonb, '[]'::jsonb, NULL, true,  3, v_now, v_dem_uid, v_now, v_dem_uid),
    ('drlrq_dem_04', v_dem_tid, 'Hombre al agua',           'SOLAS III/19.3',    90, 'Trimestral', '[]'::jsonb, '[]'::jsonb, NULL, true,  4, v_now, v_dem_uid, v_now, v_dem_uid),
    ('drlrq_dem_05', v_dem_tid, 'Contaminación (MARPOL)',   'MARPOL I/37',       90, 'Trimestral', '[]'::jsonb, '[]'::jsonb, NULL, true,  5, v_now, v_dem_uid, v_now, v_dem_uid),
    ('drlrq_dem_06', v_dem_tid, 'Derrame de combustible',   'SOPEP / SMPEP',     90, 'Trimestral', '[]'::jsonb, '[]'::jsonb, NULL, true,  6, v_now, v_dem_uid, v_now, v_dem_uid),
    ('drlrq_dem_07', v_dem_tid, 'Seguridad (ISPS)',         'ISPS Code A/13.4',  90, 'Trimestral', '[]'::jsonb, '[]'::jsonb, NULL, true,  7, v_now, v_dem_uid, v_now, v_dem_uid),
    ('drlrq_dem_08', v_dem_tid, 'Emergencia médica',        'SOLAS III/19',      90, 'Trimestral', '[]'::jsonb, '[]'::jsonb, NULL, true,  8, v_now, v_dem_uid, v_now, v_dem_uid),
    ('drlrq_dem_09', v_dem_tid, 'Gobierno de emergencia',   'SOLAS V/26.4',      90, 'Trimestral', '[]'::jsonb, '[]'::jsonb, NULL, true,  9, v_now, v_dem_uid, v_now, v_dem_uid),
    ('drlrq_dem_10', v_dem_tid, 'Blackout / Dead ship',     'SOLAS II-1/27',    180, 'Semestral',  '[]'::jsonb, '[]'::jsonb, NULL, true, 10, v_now, v_dem_uid, v_now, v_dem_uid);
END $$;

SELECT t.slug, COUNT(dr.*) as requirements
FROM "Tenant" t LEFT JOIN "DrillRequirement" dr ON dr."tenantId" = t.id
GROUP BY t.slug ORDER BY t.slug;
