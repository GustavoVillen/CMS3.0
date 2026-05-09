#!/usr/bin/env python3
"""
Generate SQL UPDATE statements that set MaintenancePlan.samplingFluidType
based on the tasks contained in each plan.

Rule: a plan is a "fluid sampling plan" only if it explicitly contains a
task that involves changing or sampling a fluid (oil change, water sampling,
fuel filter change implies fuel sampling, etc.). Inspections without fluid
work => NULL (no sampling).

Strategy:
  1. Re-read normalized JSON
  2. Group tasks by (vessel, systemCode, freq, isInspection) — same key as build_sql
  3. For each group, scan task descriptions for fluid-related keywords
  4. Map keyword + system to a FluidType enum value
  5. Emit UPDATE statements keyed by taskCode
"""
import json
import re
from pathlib import Path
from collections import defaultdict

ROOT = Path(r"c:\NPMS\GPMS\scripts\mercurio-import")
OUT = ROOT / "sql"
OUT.mkdir(parents=True, exist_ok=True)

with open(ROOT / "normalized" / "all.json", encoding="utf-8") as f:
    DATA = json.load(f)


# ─────────────────────────────────────────────────────────────────────────────
# Fluid detection rules
# ─────────────────────────────────────────────────────────────────────────────

# Keywords that indicate a fluid sampling/change task (must appear in task text)
RX_OIL_CHANGE     = re.compile(r"\b(cambio|cambiar|reemplaz|renovar)\b.*\b(aceite|lubricant)", re.IGNORECASE)
# "Aceite – cambiar" / "Aceite — cambiar" / "Aceite - cambiar" / "Aceite cambiar"
RX_OIL_PROCESS    = re.compile(r"aceite\s*[‐-―−-]?\s*(cambiar|cambio|renovar|reemplaz)", re.IGNORECASE)
RX_FUEL_FILTER    = re.compile(r"\b(filtro|filtros)\b.*\b(combustible|diesel|gas-?oil|g\.?o\.?)", re.IGNORECASE)
RX_FUEL_PUMP      = re.compile(r"bomba.*combustible", re.IGNORECASE)
RX_COOLING_SYSTEM = re.compile(r"sistema\s+de\s+enfriamiento|enfriador|refriger", re.IGNORECASE)
RX_HYDRAULIC      = re.compile(r"hidr(a|á)ulic", re.IGNORECASE)
RX_TANK_FUEL_GO   = re.compile(r"\b(tanque|carbonera|sedimentaci[óo]n|residuos)\b.*\b(g\.?\s*o\.?|gas-?oil|combustible)", re.IGNORECASE)
RX_REFRIGERANT    = re.compile(r"refrigerante|gas\s+refrigerante|aire\s+acondicionado", re.IGNORECASE)
RX_POTABLE_WATER  = re.compile(r"agua\s+potable", re.IGNORECASE)
RX_BOILER_WATER   = re.compile(r"caldera|boiler", re.IGNORECASE)

# System code → default fluid when an oil-change task is found
SYSTEM_OIL_FLUID = {
    "PROP-BB":  "ENGINE_OIL",
    "PROP-EB":  "ENGINE_OIL",
    "PROP-BBC": "ENGINE_OIL",
    "PROP-EBC": "ENGINE_OIL",
    "PROP":     "ENGINE_OIL",
    "AUX-01":   "ENGINE_OIL",
    "AUX-02":   "ENGINE_OIL",
    "AUX-03":   "ENGINE_OIL",
    "LAN-01":   "ENGINE_OIL",
    "LAN-02":   "ENGINE_OIL",
    "CAJ":      "GEARBOX_OIL",
    "HID":      "HYDRAULIC_OIL",
    "GOB":      "HYDRAULIC_OIL",
    "CAB":      "HYDRAULIC_OIL",
    "PUR":      "ENGINE_OIL",   # purifies engine lube oil
    "SEP":      "ENGINE_OIL",
    "ENG":      "GEARBOX_OIL",  # engrase = grease, but closest match
}

# Systems whose entire purpose is fluid management (any maintenance => sampling)
SYSTEM_ALWAYS_FLUID = {
    "CMB":  "FUEL_DIESEL",
    "TNQ":  "FUEL_DIESEL",  # for barcaza tank operations
}


def freq_key(t):
    if t["trigger"] == "HOURS":
        return f"{t['hours']}H"
    if t["trigger"] == "MONTHS":
        return f"{t['months']}M"
    return ""


def task_code_for(vessel, sys_code, t, is_insp):
    insp_suffix = "I" if is_insp else "M"
    return f"{vessel}-{sys_code}-{freq_key(t)}-{insp_suffix}"


def detect_fluid(group_tasks, system_code):
    """Return FluidType enum string or None."""
    sc = system_code

    # Sytems that always represent fluid sampling
    if sc in SYSTEM_ALWAYS_FLUID:
        for t in group_tasks:
            text = f"{t['equipment']} {t['task']}".lower()
            if RX_OIL_CHANGE.search(text) or RX_FUEL_FILTER.search(text) or RX_TANK_FUEL_GO.search(text):
                return SYSTEM_ALWAYS_FLUID[sc]
        # Fall through to per-task analysis below

    found_oil_change = False
    found_fuel = False
    found_cooling = False
    found_refrigerant = False
    found_hydraulic = False

    for t in group_tasks:
        text = f"{t['equipment']} {t['task']}".lower()

        if RX_OIL_CHANGE.search(text) or RX_OIL_PROCESS.search(text):
            found_oil_change = True
        if RX_FUEL_FILTER.search(text) or RX_TANK_FUEL_GO.search(text):
            found_fuel = True
        if RX_COOLING_SYSTEM.search(text):
            found_cooling = True
        if RX_REFRIGERANT.search(text):
            found_refrigerant = True
        if RX_HYDRAULIC.search(text):
            found_hydraulic = True

    # Priority order: oil-change is the most direct sampling indicator.
    # Only assign a fluid type when we have a strong system mapping.
    # Unmapped systems (e.g. AIR compressor, BBA pumps) keep NULL — operators
    # decide manually if they want to track sampling for those.
    if found_oil_change:
        if sc in SYSTEM_OIL_FLUID:
            return SYSTEM_OIL_FLUID[sc]
        if found_hydraulic:
            return "HYDRAULIC_OIL"
        return None

    if found_hydraulic and sc in ("HID", "GOB", "CAB"):
        return "HYDRAULIC_OIL"

    if found_fuel and sc in ("CMB", "TNQ", "PROP-BB", "PROP-EB", "PROP-BBC", "PROP-EBC", "PROP", "AUX-01", "AUX-02", "AUX-03", "LAN-01", "LAN-02"):
        return "FUEL_DIESEL"

    if found_cooling and sc in ("PROP-BB", "PROP-EB", "PROP-BBC", "PROP-EBC", "PROP", "AUX-01", "AUX-02", "AUX-03"):
        # Cooling tasks on engines: water sampling
        # But filter out generic "Sistema de enfriamiento — limpieza" without water sampling
        # We accept it as cooling water sampling
        return "COOLING_WATER"

    if found_refrigerant and sc == "CLI":
        return "REFRIGERANT"

    return None


# ─────────────────────────────────────────────────────────────────────────────
# Build SQL
# ─────────────────────────────────────────────────────────────────────────────
def group_plans_with_fluid(tasks):
    """Returns dict[taskCode] -> fluidType enum string."""
    groups = defaultdict(list)
    for t in tasks:
        key = (t["vesselCode"], t["systemCode"], freq_key(t), t["isInspection"])
        groups[key].append(t)

    out = {}
    for key, tlist in groups.items():
        vessel, sc, _fk, is_insp = key
        fluid = detect_fluid(tlist, sc)
        if fluid is None:
            continue
        # taskCode same format as build_sql.py
        sample_t = tlist[0]
        tc = task_code_for(vessel, sc, sample_t, is_insp)
        out[tc] = fluid
    return out


def main():
    pmp_assignments  = group_plans_with_fluid(DATA["tasks"])
    barc_assignments = group_plans_with_fluid(DATA["barcazasTasks"])
    all_assignments = {**pmp_assignments, **barc_assignments}

    sql = """-- =============================================================================
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

"""
    counts_by_fluid = defaultdict(int)
    for tc in sorted(all_assignments.keys()):
        fluid = all_assignments[tc]
        counts_by_fluid[fluid] += 1
        sql += f"""  UPDATE "MaintenancePlan"
     SET "samplingFluidType" = CAST('{fluid}' AS "FluidType"),
         "updatedAt"         = NOW(),
         "updatedByUserId"   = v_user_id
   WHERE "tenantId"   = v_tenant_id
     AND "taskCode"   = '{tc}'
     AND "deletedAt"  IS NULL
     AND ("samplingFluidType" IS NULL OR "samplingFluidType"::text != '{fluid}');
  IF FOUND THEN v_count := v_count + 1; END IF;
"""

    sql += """
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
"""

    out_path = OUT / "09-mercurio-fluid-sampling.sql"
    out_path.write_text(sql, encoding="utf-8")
    print(f"-> {out_path.name}  ({out_path.stat().st_size // 1024} KB, {len(all_assignments)} updates)")
    print()
    print("Distribution by fluid type:")
    for fluid, c in sorted(counts_by_fluid.items(), key=lambda x: -x[1]):
        print(f"  {fluid:20s} {c}")


if __name__ == "__main__":
    main()
