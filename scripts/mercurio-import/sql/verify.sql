-- =============================================================================
-- Mercurio tenant — verification report (read-only)
-- =============================================================================
-- Run this BEFORE importing to see current state, and AFTER to verify results.
-- =============================================================================

\echo ''
\echo '── Tenant ──────────────────────────────────────────────────────'
SELECT id, slug, status, "createdAt"
FROM "Tenant"
WHERE slug = 'mercurio'
   OR id IN (SELECT t.id FROM "Tenant" t JOIN "Vessel" v ON v."tenantId"=t.id WHERE v.code IN ('LATERE','DONCHI'))
LIMIT 5;

\echo ''
\echo '── Vessels ─────────────────────────────────────────────────────'
WITH t AS (SELECT id FROM "Tenant" WHERE slug='mercurio' LIMIT 1)
SELECT v.code, v.name, v.status, v."createdAt"::date AS created
FROM "Vessel" v
WHERE v."tenantId" IN (SELECT id FROM t)
ORDER BY v.code;

\echo ''
\echo '── Assets per vessel ───────────────────────────────────────────'
WITH t AS (SELECT id FROM "Tenant" WHERE slug='mercurio' LIMIT 1)
SELECT v.code AS vessel,
       COUNT(*) FILTER (WHERE a."deletedAt" IS NULL) AS active_assets,
       COUNT(*) FILTER (WHERE a."deletedAt" IS NOT NULL) AS deleted_assets
FROM "Vessel" v
LEFT JOIN "Asset" a ON a."tenantId" = v."tenantId" AND a."vesselCode" = v.code
WHERE v."tenantId" IN (SELECT id FROM t)
GROUP BY v.code
ORDER BY v.code;

\echo ''
\echo '── MaintenancePlans per vessel ─────────────────────────────────'
WITH t AS (SELECT id FROM "Tenant" WHERE slug='mercurio' LIMIT 1)
SELECT v.code AS vessel,
       COUNT(*) FILTER (WHERE mp."deletedAt" IS NULL) AS active_plans,
       COUNT(*) FILTER (WHERE mp."triggerType"::text = 'HOURS')  AS hours_plans,
       COUNT(*) FILTER (WHERE mp."triggerType"::text = 'MONTHS') AS months_plans
FROM "Vessel" v
LEFT JOIN "MaintenancePlan" mp ON mp."tenantId" = v."tenantId" AND mp."vesselCode" = v.code
WHERE v."tenantId" IN (SELECT id FROM t)
GROUP BY v.code
ORDER BY v.code;

\echo ''
\echo '── Spares per vessel ───────────────────────────────────────────'
WITH t AS (SELECT id FROM "Tenant" WHERE slug='mercurio' LIMIT 1)
SELECT v.code AS vessel, COUNT(s.id) AS spares
FROM "Vessel" v
LEFT JOIN "Spare" s ON s."tenantId" = v."tenantId" AND s."vesselCode" = v.code AND s."deletedAt" IS NULL
WHERE v."tenantId" IN (SELECT id FROM t)
GROUP BY v.code
ORDER BY v.code;

\echo ''
\echo '── Certificates by status ──────────────────────────────────────'
WITH t AS (SELECT id FROM "Tenant" WHERE slug='mercurio' LIMIT 1)
SELECT
  CASE
    WHEN c."expiryDate" < NOW() THEN 'EXPIRED'
    WHEN c."expiryDate" < NOW() + INTERVAL '30 days' THEN 'EXPIRING_30D'
    WHEN c."expiryDate" < NOW() + INTERVAL '90 days' THEN 'EXPIRING_90D'
    ELSE 'ACTIVE'
  END AS status_calc,
  COUNT(*) AS qty
FROM "Certificate" c
WHERE c."tenantId" IN (SELECT id FROM t) AND c."deletedAt" IS NULL
GROUP BY 1
ORDER BY 1;

\echo ''
\echo '── Top 5 vessels with most certificates ────────────────────────'
WITH t AS (SELECT id FROM "Tenant" WHERE slug='mercurio' LIMIT 1)
SELECT v.code, COUNT(c.id) AS certs
FROM "Vessel" v
LEFT JOIN "Certificate" c ON c."tenantId" = v."tenantId" AND c."vesselCode" = v.code AND c."deletedAt" IS NULL
WHERE v."tenantId" IN (SELECT id FROM t)
GROUP BY v.code
ORDER BY certs DESC
LIMIT 5;

\echo ''
\echo '── Sample plans for LATERE ─────────────────────────────────────'
WITH t AS (SELECT id FROM "Tenant" WHERE slug='mercurio' LIMIT 1)
SELECT mp."taskCode", mp.title, mp."triggerType"::text AS trig, mp."frequencyHours" AS hrs, mp."frequencyMonths" AS mo
FROM "MaintenancePlan" mp
WHERE mp."tenantId" IN (SELECT id FROM t) AND mp."vesselCode" = 'LATERE' AND mp."deletedAt" IS NULL
ORDER BY mp.title
LIMIT 10;
