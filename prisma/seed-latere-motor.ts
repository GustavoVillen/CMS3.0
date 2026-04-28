/**
 * Seed: Motor Ppal. Babor Externo — LATERE
 * Asset + Maintenance Plans + Critical Spares
 * Run: npx ts-node --project tsconfig.json prisma/seed-latere-motor.ts
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as any);

const VESSEL   = "LATERE";
const ASSET_CODE = "LAT-ME-BABOR-EXT";
const now      = new Date();

async function main() {
  // ── Resolve tenant & system user ────────────────────────────────────────────
  const tenant = await prisma.tenant.findUnique({ where: { slug: "demo" } });
  if (!tenant) throw new Error("Tenant 'demo' not found. Run seed.ts first.");
  const tid = tenant.id;

  const user = await prisma.user.findUnique({ where: { email: "admin@demo.local" } });
  if (!user) throw new Error("User 'admin@demo.local' not found. Run seed.ts first.");
  const uid = user.id;

  // ── Asset: Motor Ppal. Babor Externo ────────────────────────────────────────
  const asset = await prisma.asset.upsert({
    where: { tenantId_vesselCode_assetCode: { tenantId: tid, vesselCode: VESSEL, assetCode: ASSET_CODE } },
    update: { name: "Motor Ppal. Babor Externo", updatedByUserId: uid },
    create: {
      tenantId:        tid,
      vesselCode:      VESSEL,
      assetCode:       ASSET_CODE,
      sfiCode:         "610",
      name:            "Motor Ppal. Babor Externo",
      criticality:     "A",
      status:          "OPERATIONAL",
      manufacturer:    "Caterpillar",
      model:           "3512C Marine",
      createdByUserId: uid,
      updatedByUserId: uid,
    },
  });

  console.log(`✓ Asset: ${asset.assetCode} — ${asset.name}`);

  // ── Maintenance Plans ────────────────────────────────────────────────────────
  const plans = [
    {
      taskCode:       "TRK-610-0266",
      title:          "Aceite lubricante: Cambio de aceite, limpieza de carter y filtro canasto",
      description:    "Cambio de aceite lubricante de motor, limpieza de carter y filtro canasto.",
      taskType:       "MAINTENANCE" as const,
      triggerType:    "HOURS" as const,
      frequencyHours: 250,
      responsible:    "Mecánico Naval",
      criticality:    "A",
      sfiSubgroupCode: "610",
    },
    {
      taskCode:       "TRK-610-0267",
      title:          "Filtro de aceite: Cambio filtro aceite y filtro aceite refrigerante",
      description:    "Cambio de filtro de aceite motor y filtro de aceite refrigerante.",
      taskType:       "MAINTENANCE" as const,
      triggerType:    "HOURS" as const,
      frequencyHours: 250,
      responsible:    "Mecánico Naval",
      criticality:    "A",
      sfiSubgroupCode: "610",
    },
    {
      taskCode:       "TRK-710-0268",
      title:          "Filtro de combustible: Cambio de filtros de combustible",
      description:    "Cambio de filtros de combustible primario y secundario.",
      taskType:       "MAINTENANCE" as const,
      triggerType:    "HOURS" as const,
      frequencyHours: 500,
      responsible:    "Mecánico Naval",
      criticality:    "A",
      sfiSubgroupCode: "710",
    },
    {
      taskCode:       "TRK-610-0269",
      title:          "Filtro de aire: Cambio de filtros de aire y limpieza porta filtro",
      description:    "Cambio de filtros de aire y limpieza del porta filtro.",
      taskType:       "MAINTENANCE" as const,
      triggerType:    "HOURS" as const,
      frequencyHours: 250,
      responsible:    "Mecánico Naval",
      criticality:    "A",
      sfiSubgroupCode: "610",
    },
    {
      taskCode:       "TRK-610-0270",
      title:          "Burro de arranque: Control del burro de arranque",
      description:    "Inspección y control del burro de arranque.",
      taskType:       "INSPECTION" as const,
      triggerType:    "HOURS" as const,
      frequencyHours: 100,
      responsible:    "Mecánico Naval",
      criticality:    "B",
      sfiSubgroupCode: "610",
    },
    {
      taskCode:       "TRK-610-0271",
      title:          "Tren de válvulas e inyectores: Ajuste del tren de válvulas e inyectores",
      description:    "Ajuste y verificación del tren de válvulas e inyectores.",
      taskType:       "MAINTENANCE" as const,
      triggerType:    "HOURS" as const,
      frequencyHours: 1500,
      responsible:    "Mecánico Naval",
      criticality:    "A",
      sfiSubgroupCode: "610",
    },
    {
      taskCode:       "TRK-610-0272",
      title:          "Bomba de combustible: Calibración de bomba de combustible",
      description:    "Desmontaje, revisión y calibración de bomba de combustible. Requiere servicio externo.",
      taskType:       "MAINTENANCE" as const,
      triggerType:    "HOURS" as const,
      frequencyHours: 6000,
      responsible:    "Mecánico Naval / Externo",
      criticality:    "A",
      sfiSubgroupCode: "610",
    },
    {
      taskCode:       "TRK-730-0273",
      title:          "Sistema de enfriamiento: Limpieza del sistema de enfriamiento",
      description:    "Limpieza general del sistema de enfriamiento, verificación de mangueras y sellos.",
      taskType:       "MAINTENANCE" as const,
      triggerType:    "HOURS" as const,
      frequencyHours: 6000,
      responsible:    "Mecánico Naval",
      criticality:    "A",
      sfiSubgroupCode: "730",
    },
    {
      taskCode:       "TRK-610-0274",
      title:          "Culatas: Inspección visual elementos de culata, verificar apriete",
      description:    "Inspección visual de elementos de culata, verificación de torques de apriete.",
      taskType:       "MAINTENANCE" as const,
      triggerType:    "HOURS" as const,
      frequencyHours: 6000,
      responsible:    "Mecánico Naval",
      criticality:    "A",
      sfiSubgroupCode: "610",
    },
    {
      taskCode:       "TRK-610-0275",
      title:          "Colector de escape: Apriete de bulonería del colector de escape",
      description:    "Verificación y apriete de bulonería del colector de escape. Revisión de empaquetaduras.",
      taskType:       "MAINTENANCE" as const,
      triggerType:    "HOURS" as const,
      frequencyHours: 4000,
      responsible:    "Mecánico Naval",
      criticality:    "B",
      sfiSubgroupCode: "610",
    },
  ];

  for (const p of plans) {
    const mp = await prisma.maintenancePlan.upsert({
      where: { tenantId_vesselCode_taskCode: { tenantId: tid, vesselCode: VESSEL, taskCode: p.taskCode } },
      update: { title: p.title, updatedByUserId: uid },
      create: {
        tenantId:        tid,
        vesselCode:      VESSEL,
        assetId:         asset.id,
        taskCode:        p.taskCode,
        title:           p.title,
        description:     p.description,
        triggerType:     p.triggerType,
        frequencyHours:  p.frequencyHours,
        responsible:     p.responsible,
        status:          "ACTIVE",
        createdByUserId: uid,
        updatedByUserId: uid,
      },
    });
    console.log(`  ✓ Plan: ${mp.taskCode} — ${mp.title.substring(0, 60)}...`);
  }

  // ── Critical Spares (Repuestos Críticos) ─────────────────────────────────────
  // Derived from explicit "Insumos/Repuestos" column + standard engine knowledge
  const spares = [
    // -- Explicitly mentioned in the plan
    {
      sku:          "LAT-OIL-15W40",
      name:         "Aceite lubricante motor SAE 15W-40",
      category:     "Lubricantes",
      criticality:  "A",
      unit:         "L",
      minStock:     20,
      reorderPoint: 40,
      location:     "Pañol Motor",
    },
    {
      sku:          "LAT-FILT-OIL-001",
      name:         "Filtro de aceite motor (primario)",
      category:     "Filtros",
      criticality:  "A",
      unit:         "un",
      minStock:     2,
      reorderPoint: 4,
      location:     "Pañol Motor",
    },
    {
      sku:          "LAT-FILT-OIL-REFRIG",
      name:         "Filtro de aceite refrigerante",
      category:     "Filtros",
      criticality:  "A",
      unit:         "un",
      minStock:     2,
      reorderPoint: 4,
      location:     "Pañol Motor",
    },
    {
      sku:          "LAT-FILT-COMB-PRI",
      name:         "Filtro de combustible primario",
      category:     "Filtros",
      criticality:  "A",
      unit:         "un",
      minStock:     2,
      reorderPoint: 4,
      location:     "Pañol Motor",
    },
    {
      sku:          "LAT-FILT-COMB-SEC",
      name:         "Filtro de combustible secundario",
      category:     "Filtros",
      criticality:  "A",
      unit:         "un",
      minStock:     2,
      reorderPoint: 4,
      location:     "Pañol Motor",
    },
    {
      sku:          "LAT-FILT-AIRE-001",
      name:         "Filtro de aire motor",
      category:     "Filtros",
      criticality:  "A",
      unit:         "un",
      minStock:     1,
      reorderPoint: 2,
      location:     "Pañol Motor",
    },
    // -- Deduced from overhaul / major tasks
    {
      sku:          "LAT-KIT-CULATA",
      name:         "Kit juntas y empaquetaduras de culata",
      category:     "Juntas y Sellos",
      criticality:  "A",
      unit:         "kit",
      minStock:     1,
      reorderPoint: 1,
      location:     "Pañol Repuestos A",
    },
    {
      sku:          "LAT-INJ-001",
      name:         "Inyector motor (unitario)",
      category:     "Inyección",
      criticality:  "A",
      unit:         "un",
      minStock:     2,
      reorderPoint: 4,
      location:     "Pañol Repuestos A",
    },
    {
      sku:          "LAT-KIT-BCOMBUS",
      name:         "Kit sellos y juntas bomba de combustible",
      category:     "Juntas y Sellos",
      criticality:  "A",
      unit:         "kit",
      minStock:     1,
      reorderPoint: 1,
      location:     "Pañol Repuestos A",
    },
    {
      sku:          "LAT-REFRIG-COOLANT",
      name:         "Refrigerante / Anticongelante concentrado",
      category:     "Lubricantes",
      criticality:  "B",
      unit:         "L",
      minStock:     10,
      reorderPoint: 20,
      location:     "Pañol Motor",
    },
    {
      sku:          "LAT-GASK-ESCAPE",
      name:         "Empaquetadura colector de escape",
      category:     "Juntas y Sellos",
      criticality:  "B",
      unit:         "un",
      minStock:     1,
      reorderPoint: 2,
      location:     "Pañol Repuestos A",
    },
    {
      sku:          "LAT-BOLT-ESCAPE",
      name:         "Bulonería colector de escape (juego)",
      category:     "Tornillería",
      criticality:  "B",
      unit:         "kit",
      minStock:     1,
      reorderPoint: 1,
      location:     "Pañol Repuestos A",
    },
  ];

  for (const s of spares) {
    const spare = await prisma.spare.upsert({
      where: { tenantId_vesselCode_sku: { tenantId: tid, vesselCode: VESSEL, sku: s.sku } },
      update: { name: s.name, updatedByUserId: uid },
      create: {
        tenantId:     tid,
        vesselCode:   VESSEL,
        sku:          s.sku,
        name:         s.name,
        category:     s.category,
        criticality:  s.criticality,
        unit:         s.unit,
        currentStock: 0,
        minStock:     s.minStock,
        reorderPoint: s.reorderPoint,
        location:     s.location,
        status:       "ACTIVE",
        createdByUserId: uid,
        updatedByUserId: uid,
      },
    });
    console.log(`  ✓ Spare: ${spare.sku} — ${spare.name}`);
  }

  console.log("\n✅ Seed completado: 1 asset + 10 planes de mantenimiento + 12 repuestos críticos.");
}

main()
  .catch((e) => { console.error("❌ Error:", e); process.exit(1); })
  .finally(() => prisma.$disconnect());
