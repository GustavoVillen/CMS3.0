#!/usr/bin/env bash
# =============================================================================
# Mercurio tenant — full data import (idempotent)
# =============================================================================
# Usage on VPS:
#   cd /app/scripts/mercurio-import/sql
#   bash run-all.sh
#
# Requires:
#   - DATABASE_URL env var set (e.g. postgresql://gpms:****@127.0.0.1:5432/gpms)
#   - Mercurio tenant must exist with slug='mercurio' OR have LATERE/DONCHI vessel
# =============================================================================

set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is not set"
  exit 1
fi

DIR="$(cd "$(dirname "$0")" && pwd)"

run() {
  local f="$1"
  echo ""
  echo "▶ Running: $f"
  echo "─────────────────────────────────────────────────────────────────────────"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$DIR/$f"
}

run "00-mercurio-vessels.sql"
run "01-mercurio-latere-assets.sql"
run "02-mercurio-latere-plans.sql"
run "03-mercurio-donchi-assets.sql"
run "04-mercurio-donchi-plans.sql"
run "05-mercurio-barcazas-assets.sql"
run "06-mercurio-barcazas-plans.sql"
run "07-mercurio-spares.sql"
run "08-mercurio-certificates.sql"

echo ""
echo "═════════════════════════════════════════════════════════════════════════"
echo "✓ Mercurio import complete"
echo "═════════════════════════════════════════════════════════════════════════"

psql "$DATABASE_URL" <<'EOF'
\echo ''
\echo '── Summary ─────────────────────────────────────────────────────'
WITH t AS (SELECT id FROM "Tenant" WHERE slug='mercurio' LIMIT 1)
SELECT
  (SELECT COUNT(*) FROM "Vessel"          WHERE "tenantId" IN (SELECT id FROM t) AND status='ACTIVE')              AS vessels,
  (SELECT COUNT(*) FROM "Asset"           WHERE "tenantId" IN (SELECT id FROM t) AND "deletedAt" IS NULL)          AS assets,
  (SELECT COUNT(*) FROM "MaintenancePlan" WHERE "tenantId" IN (SELECT id FROM t) AND "deletedAt" IS NULL)          AS plans,
  (SELECT COUNT(*) FROM "Spare"           WHERE "tenantId" IN (SELECT id FROM t) AND "deletedAt" IS NULL)          AS spares,
  (SELECT COUNT(*) FROM "Certificate"     WHERE "tenantId" IN (SELECT id FROM t) AND "deletedAt" IS NULL)          AS certificates;
EOF
