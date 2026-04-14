import {
  MembershipStatus,
  PlatformRole,
  PrismaClient,
  TenantRole,
  UserStatus,
} from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { hashPassword } from "../apps/api/src/platform/auth/passwords";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as any);

const SYSTEM_USER = "system";
const now = new Date();

async function main(): Promise<void> {
  // ── Tenant & auth ──────────────────────────────────────────────────────────
  const demoTenant = await prisma.tenant.upsert({
    where: { slug: "demo" },
    update: { status: "ACTIVE" },
    create: { slug: "demo", status: "ACTIVE" },
  });

  await prisma.tenantSetting.upsert({
    where: { tenantId: demoTenant.id },
    update: {
      displayName: "Demo Tenant",
      logoUrl: null,
      primaryColor: "#2563eb",
      supportEmail: "support@demo.local",
      defaultLocale: "es",
      enabledLocales: ["es", "en", "pt"],
      timezone: "America/Argentina/Buenos_Aires",
      currency: "USD",
    },
    create: {
      tenantId: demoTenant.id,
      displayName: "Demo Tenant",
      logoUrl: null,
      primaryColor: "#2563eb",
      supportEmail: "support@demo.local",
      defaultLocale: "es",
      enabledLocales: ["es", "en", "pt"],
      timezone: "America/Argentina/Buenos_Aires",
      currency: "USD",
    },
  });

  await prisma.tenantDomain.upsert({
    where: { host: "demo.localhost" },
    update: { tenantId: demoTenant.id, isPrimary: true },
    create: { tenantId: demoTenant.id, host: "demo.localhost", isPrimary: true },
  });

  const platformPasswordHash = hashPassword("admin123");
  await prisma.platformUser.upsert({
    where: { email: "admin@localhost" },
    update: { passwordHash: platformPasswordHash, role: PlatformRole.SUPERADMIN, status: UserStatus.ACTIVE, firstName: "Platform", lastName: "Admin" },
    create: { email: "admin@localhost", passwordHash: platformPasswordHash, role: PlatformRole.SUPERADMIN, status: UserStatus.ACTIVE, firstName: "Platform", lastName: "Admin" },
  });

  const tenantPasswordHash = hashPassword("demo123");
  const tenantUser = await prisma.user.upsert({
    where: { email: "admin@demo.local" },
    update: { legacyUserId: "DEMOADMIN", passwordHash: tenantPasswordHash, status: UserStatus.ACTIVE, preferredLocale: "es", firstName: "Demo", lastName: "Admin" },
    create: { email: "admin@demo.local", legacyUserId: "DEMOADMIN", passwordHash: tenantPasswordHash, status: UserStatus.ACTIVE, preferredLocale: "es", firstName: "Demo", lastName: "Admin" },
  });

  await prisma.tenantMembership.upsert({
    where: { userId: tenantUser.id },
    update: { tenantId: demoTenant.id, role: TenantRole.TENANT_ADMIN, status: MembershipStatus.ACTIVE, assignedVesselCodes: ["LATERE", "GLT001"], joinedAt: now },
    create: { tenantId: demoTenant.id, userId: tenantUser.id, role: TenantRole.TENANT_ADMIN, status: MembershipStatus.ACTIVE, assignedVesselCodes: ["LATERE", "GLT001"], joinedAt: now },
  });

  const tid = demoTenant.id;
  const uid = tenantUser.id;

  // ── Vessels ────────────────────────────────────────────────────────────────
  const vesselLatere = await prisma.vessel.upsert({
    where: { tenantId_code: { tenantId: tid, code: "LATERE" } },
    update: { name: "MV La Tercera", status: "ACTIVE", updatedByUserId: uid },
    create: { tenantId: tid, code: "LATERE", name: "MV La Tercera", status: "ACTIVE", createdByUserId: uid, updatedByUserId: uid },
  });

  const vesselGlt = await prisma.vessel.upsert({
    where: { tenantId_code: { tenantId: tid, code: "GLT001" } },
    update: { name: "MV Goleta I", status: "ACTIVE", updatedByUserId: uid },
    create: { tenantId: tid, code: "GLT001", name: "MV Goleta I", status: "ACTIVE", createdByUserId: uid, updatedByUserId: uid },
  });

  // ── Assets (LATERE) ────────────────────────────────────────────────────────
  const assetMainEngine = await prisma.asset.upsert({
    where: { tenantId_vesselCode_assetCode: { tenantId: tid, vesselCode: "LATERE", assetCode: "LAT-ME-001" } },
    update: { name: "Main Engine MAN B&W", status: "OPERATIONAL", updatedByUserId: uid },
    create: {
      tenantId: tid, vesselCode: "LATERE", assetCode: "LAT-ME-001",
      sfiCode: "700", name: "Main Engine MAN B&W", criticality: "A",
      status: "OPERATIONAL", manufacturer: "MAN Energy Solutions", model: "6S50MC-C",
      serialNumber: "SN-ME-2018-001", installationDate: new Date("2018-03-15"),
      createdByUserId: uid, updatedByUserId: uid,
    },
  });

  await prisma.asset.upsert({
    where: { tenantId_vesselCode_assetCode: { tenantId: tid, vesselCode: "LATERE", assetCode: "LAT-GEN-001" } },
    update: { name: "Generator Set #1", status: "OPERATIONAL", updatedByUserId: uid },
    create: {
      tenantId: tid, vesselCode: "LATERE", assetCode: "LAT-GEN-001",
      sfiCode: "710", name: "Generator Set #1", criticality: "A",
      status: "OPERATIONAL", manufacturer: "Caterpillar", model: "C18 Marine",
      serialNumber: "SN-GEN-2018-001", installationDate: new Date("2018-03-15"),
      createdByUserId: uid, updatedByUserId: uid,
    },
  });

  await prisma.asset.upsert({
    where: { tenantId_vesselCode_assetCode: { tenantId: tid, vesselCode: "LATERE", assetCode: "LAT-FWC-001" } },
    update: { name: "Fresh Water Cooling System", status: "OPERATIONAL", updatedByUserId: uid },
    create: {
      tenantId: tid, vesselCode: "LATERE", assetCode: "LAT-FWC-001",
      sfiCode: "721", name: "Fresh Water Cooling System", criticality: "B",
      status: "DEGRADED", createdByUserId: uid, updatedByUserId: uid,
    },
  });

  // ── Assets (GLT001) ────────────────────────────────────────────────────────
  await prisma.asset.upsert({
    where: { tenantId_vesselCode_assetCode: { tenantId: tid, vesselCode: "GLT001", assetCode: "GLT-ME-001" } },
    update: { name: "Main Engine Wärtsilä", status: "OPERATIONAL", updatedByUserId: uid },
    create: {
      tenantId: tid, vesselCode: "GLT001", assetCode: "GLT-ME-001",
      sfiCode: "700", name: "Main Engine Wärtsilä", criticality: "A",
      status: "OPERATIONAL", manufacturer: "Wärtsilä", model: "6L34DF",
      installationDate: new Date("2020-06-01"), createdByUserId: uid, updatedByUserId: uid,
    },
  });

  // ── Maintenance Plans ──────────────────────────────────────────────────────
  const mpOil = await prisma.maintenancePlan.upsert({
    where: { tenantId_vesselCode_taskCode: { tenantId: tid, vesselCode: "LATERE", taskCode: "MP-OIL-500H" } },
    update: { status: "DUE_SOON", updatedByUserId: uid },
    create: {
      tenantId: tid, vesselCode: "LATERE", assetId: assetMainEngine.id,
      taskCode: "MP-OIL-500H", title: "Cambio de aceite motor principal",
      triggerType: "HOURS", frequencyHours: 500,
      status: "DUE_SOON", nextDueDate: new Date(Date.now() + 7 * 86400000),
      lastExecutionDate: new Date(Date.now() - 400 * 3600000),
      createdByUserId: uid, updatedByUserId: uid,
    },
  });

  await prisma.maintenancePlan.upsert({
    where: { tenantId_vesselCode_taskCode: { tenantId: tid, vesselCode: "LATERE", taskCode: "MP-FILTER-1M" } },
    update: { updatedByUserId: uid },
    create: {
      tenantId: tid, vesselCode: "LATERE", assetId: assetMainEngine.id,
      taskCode: "MP-FILTER-1M", title: "Inspección filtros combustible",
      triggerType: "MONTHS", frequencyMonths: 1,
      status: "ACTIVE", nextDueDate: new Date(Date.now() + 15 * 86400000),
      createdByUserId: uid, updatedByUserId: uid,
    },
  });

  // ── Work Orders ────────────────────────────────────────────────────────────
  const wo1 = await prisma.workOrder.upsert({
    where: { tenantId_vesselCode_workOrderCode: { tenantId: tid, vesselCode: "LATERE", workOrderCode: "WO-2026-001" } },
    update: { status: "IN_PROGRESS", updatedByUserId: uid },
    create: {
      tenantId: tid, vesselCode: "LATERE", assetId: assetMainEngine.id,
      maintenancePlanId: mpOil.id,
      workOrderCode: "WO-2026-001", type: "PREVENTIVE",
      status: "IN_PROGRESS", priority: "HIGH", criticality: "A",
      openDate: new Date(Date.now() - 2 * 86400000),
      dueDate: new Date(Date.now() + 5 * 86400000),
      createdByUserId: uid, updatedByUserId: uid,
    },
  });

  await prisma.workOrder.upsert({
    where: { tenantId_vesselCode_workOrderCode: { tenantId: tid, vesselCode: "LATERE", workOrderCode: "WO-2026-002" } },
    update: { updatedByUserId: uid },
    create: {
      tenantId: tid, vesselCode: "LATERE", assetId: assetMainEngine.id,
      workOrderCode: "WO-2026-002", type: "CORRECTIVE",
      status: "PLANNED", priority: "MEDIUM", criticality: "B",
      openDate: new Date(), dueDate: new Date(Date.now() + 10 * 86400000),
      createdByUserId: uid, updatedByUserId: uid,
    },
  });

  await prisma.workOrder.upsert({
    where: { tenantId_vesselCode_workOrderCode: { tenantId: tid, vesselCode: "GLT001", workOrderCode: "WO-2026-003" } },
    update: { updatedByUserId: uid },
    create: {
      tenantId: tid, vesselCode: "GLT001", assetId: vesselGlt.id,
      workOrderCode: "WO-2026-003", type: "INSPECTION",
      status: "PLANNED", priority: "MEDIUM", criticality: "B",
      openDate: new Date(), dueDate: new Date(Date.now() + 14 * 86400000),
      createdByUserId: uid, updatedByUserId: uid,
    },
  });

  // ── Defects ────────────────────────────────────────────────────────────────
  const defect1 = await prisma.defect.upsert({
    where: { tenantId_vesselCode_defectCode: { tenantId: tid, vesselCode: "LATERE", defectCode: "DEF-2026-001" } },
    update: { updatedByUserId: uid },
    create: {
      tenantId: tid, vesselCode: "LATERE", assetId: assetMainEngine.id,
      defectCode: "DEF-2026-001", status: "OPEN", severity: "HIGH",
      operationalState: "DEGRADED", classification: "Mecánico",
      reportedAt: new Date(Date.now() - 3 * 86400000),
      description: "Fuga de aceite en cárter del motor principal. Goteo constante detectado durante inspección rutinaria.",
      immediateAction: "Colocación de bandeja de contención y aumento de frecuencia de monitoreo.",
      createdByUserId: uid, updatedByUserId: uid,
    },
  });

  // ── Providers ──────────────────────────────────────────────────────────────
  const provider1 = await prisma.provider.upsert({
    where: { tenantId_vesselCode_providerCode: { tenantId: tid, vesselCode: "LATERE", providerCode: "PROV-001" } },
    update: { updatedByUserId: uid },
    create: {
      tenantId: tid, vesselCode: "LATERE", providerCode: "PROV-001",
      name: "Técnica Naval S.A.", category: "Mantenimiento",
      status: "ACTIVE", contactName: "Carlos Méndez",
      contactEmail: "cmendez@tecnaval.com", contactPhone: "+54 11 4567-8900",
      createdByUserId: uid, updatedByUserId: uid,
    },
  });

  // ── Spares ─────────────────────────────────────────────────────────────────
  const spare1 = await prisma.spare.upsert({
    where: { tenantId_vesselCode_sku: { tenantId: tid, vesselCode: "LATERE", sku: "SPARE-OIL-FILTER-001" } },
    update: { updatedByUserId: uid },
    create: {
      tenantId: tid, vesselCode: "LATERE",
      sku: "SPARE-OIL-FILTER-001", name: "Filtro de aceite motor principal",
      category: "Filtros", criticality: "A",
      manufacturer: "MAN Energy", unit: "UND",
      currentStock: 4, minStock: 2, reorderPoint: 3,
      status: "ACTIVE", location: "Bodega A - Estante 2",
      createdByUserId: uid, updatedByUserId: uid,
    },
  });

  // ── Stock Movement ─────────────────────────────────────────────────────────
  await prisma.stockMovement.create({
    data: {
      tenantId: tid, vesselCode: "LATERE", spareId: spare1.id,
      movementCode: "MOV-2026-001", movementType: "RECEIPT",
      quantity: 6, unit: "UND",
      occurredAt: new Date(Date.now() - 10 * 86400000),
      referenceType: "SPARE_ORDER", notes: "Recepción inicial de stock",
      createdByUserId: uid,
    },
  }).catch(() => {}); // idempotent: ignore if already exists

  // ── Inspection ─────────────────────────────────────────────────────────────
  const inspection1 = await prisma.inspection.upsert({
    where: { tenantId_vesselCode_inspectionCode: { tenantId: tid, vesselCode: "LATERE", inspectionCode: "INSP-2026-001" } },
    update: { updatedByUserId: uid },
    create: {
      tenantId: tid, vesselCode: "LATERE",
      inspectionCode: "INSP-2026-001", type: "SAFETY",
      status: "SCHEDULED", providerId: provider1.id,
      scheduledAt: new Date(Date.now() + 30 * 86400000),
      inspectorName: "Ing. Roberto Silva",
      createdByUserId: uid, updatedByUserId: uid,
    },
  });

  // ── Certificate ────────────────────────────────────────────────────────────
  await prisma.certificate.upsert({
    where: { tenantId_vesselCode_certificateCode: { tenantId: tid, vesselCode: "LATERE", certificateCode: "CERT-SMS-2024" } },
    update: { updatedByUserId: uid },
    create: {
      tenantId: tid, vesselCode: "LATERE",
      certificateCode: "CERT-SMS-2024", name: "Safety Management Certificate",
      issuingAuthority: "DNV GL", status: "ACTIVE",
      issueDate: new Date("2024-01-15"),
      expiryDate: new Date("2029-01-14"),
      createdByUserId: uid, updatedByUserId: uid,
    },
  });

  await prisma.certificate.upsert({
    where: { tenantId_vesselCode_certificateCode: { tenantId: tid, vesselCode: "LATERE", certificateCode: "CERT-IOPP-2023" } },
    update: { status: "EXPIRING_SOON", updatedByUserId: uid },
    create: {
      tenantId: tid, vesselCode: "LATERE",
      certificateCode: "CERT-IOPP-2023",
      name: "International Oil Pollution Prevention Certificate",
      issuingAuthority: "Prefectura Naval Argentina", status: "EXPIRING_SOON",
      issueDate: new Date("2023-06-01"),
      expiryDate: new Date(Date.now() + 20 * 86400000),
      createdByUserId: uid, updatedByUserId: uid,
    },
  });

  // ── Daily Report ───────────────────────────────────────────────────────────
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  await prisma.dailyReport.upsert({
    where: { tenantId_vesselCode_reportDate: { tenantId: tid, vesselCode: "LATERE", reportDate: today } },
    update: { updatedByUserId: uid },
    create: {
      tenantId: tid, vesselCode: "LATERE", reportDate: today,
      status: "DRAFT", summary: "Operación normal. Se monitorea fuga de aceite ME.",
      positionLat: -34.603722, positionLon: -58.381592,
      engineHoursMain: 12450.5, generatorHours: 8230.0,
      fuelConsumedLiters: 2800, notes: "Sin novedades adicionales.",
      createdByUserId: uid, updatedByUserId: uid,
    },
  });

  // ── Spare Order ────────────────────────────────────────────────────────────
  await prisma.spareOrder.upsert({
    where: { tenantId_vesselCode_orderCode: { tenantId: tid, vesselCode: "LATERE", orderCode: "ORD-2026-001" } },
    update: { updatedByUserId: uid },
    create: {
      tenantId: tid, vesselCode: "LATERE",
      orderCode: "ORD-2026-001", status: "APPROVED", priority: "HIGH",
      providerId: provider1.id, requestedByUserId: uid,
      requestedAt: new Date(Date.now() - 5 * 86400000),
      expectedDeliveryDate: new Date(Date.now() + 10 * 86400000),
      totalLines: 2, totalCost: 1850.00, currency: "USD",
      notes: "Repuestos críticos motor principal.",
      createdByUserId: uid, updatedByUserId: uid,
    },
  });

  process.stdout.write("Seed completed.\n");
  process.stdout.write("Platform user: admin@localhost / admin123\n");
  process.stdout.write("Tenant user: admin@demo.local / demo123\n");
  process.stdout.write("Vessels: LATERE, GLT001\n");
  process.stdout.write("Operational data seeded: assets, work orders, defects, spares, inspection, certificates, daily report\n");
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
