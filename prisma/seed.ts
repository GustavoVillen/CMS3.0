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
    update: { name: "MV La Tercera", vesselType: "Remolcador / Empuje", status: "ACTIVE", updatedByUserId: uid },
    create: { tenantId: tid, code: "LATERE", name: "MV La Tercera", vesselType: "Remolcador / Empuje", status: "ACTIVE", createdByUserId: uid, updatedByUserId: uid },
  });

  const vesselGlt = await prisma.vessel.upsert({
    where: { tenantId_code: { tenantId: tid, code: "GLT001" } },
    update: { name: "MV Goleta I", vesselType: "Barcaza Tanque", status: "ACTIVE", updatedByUserId: uid },
    create: { tenantId: tid, code: "GLT001", name: "MV Goleta I", vesselType: "Barcaza Tanque", status: "ACTIVE", createdByUserId: uid, updatedByUserId: uid },
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
  const existingSM = await prisma.stockMovement.findFirst({
    where: { tenantId: tid, vesselCode: "LATERE", movementCode: "MOV-2026-001" },
  });
  if (!existingSM) {
    await prisma.stockMovement.create({
      data: {
        tenantId: tid, vesselCode: "LATERE", spareId: spare1.id,
        movementCode: "MOV-2026-001", movementType: "RECEIPT",
        quantity: 6, unit: "UND",
        occurredAt: new Date(Date.now() - 10 * 86400000),
        referenceType: "SPARE_ORDER", notes: "Recepción inicial de stock",
        createdByUserId: uid,
      },
    });
  }

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

  // ── Deferrals ──────────────────────────────────────────────────────────────
  await prisma.deferral.upsert({
    where: { tenantId_vesselCode_deferralCode: { tenantId: tid, vesselCode: "LATERE", deferralCode: "DFR-2026-001" } },
    update: { updatedByUserId: uid },
    create: {
      tenantId: tid, vesselCode: "LATERE", assetId: assetMainEngine.id,
      deferralCode: "DFR-2026-001", sourceType: "WORK_ORDER", sourceId: wo1.id,
      status: "ACTIVE", requestedAt: new Date(Date.now() - 10 * 86400000),
      requestedByUserId: uid, targetDate: new Date(Date.now() + 20 * 86400000),
      justification: "Repuesto requerido no disponible en inventario. Pendiente de orden de compra.",
      compensatoryMeasures: "Monitoreo diario de parámetros del motor. Reducción de carga al 80%.",
      activeSince: new Date(Date.now() - 8 * 86400000),
      createdByUserId: uid, updatedByUserId: uid,
    },
  });

  await prisma.deferral.upsert({
    where: { tenantId_vesselCode_deferralCode: { tenantId: tid, vesselCode: "LATERE", deferralCode: "DFR-2026-002" } },
    update: { updatedByUserId: uid },
    create: {
      tenantId: tid, vesselCode: "LATERE", assetId: assetMainEngine.id,
      deferralCode: "DFR-2026-002", sourceType: "DEFECT", sourceId: defect1.id,
      status: "UNDER_REVIEW", requestedAt: new Date(Date.now() - 3 * 86400000),
      requestedByUserId: uid, targetDate: new Date(Date.now() + 30 * 86400000),
      justification: "Fuga menor sin impacto en operación. Se solicita próxima escala para reparación.",
      createdByUserId: uid, updatedByUserId: uid,
    },
  });

  // ── RCA ────────────────────────────────────────────────────────────────────
  const rca1 = await prisma.rcaRecord.upsert({
    where: { tenantId_vesselCode_rcaCode: { tenantId: tid, vesselCode: "LATERE", rcaCode: "RCA-2026-001" } },
    update: { updatedByUserId: uid },
    create: {
      tenantId: tid, vesselCode: "LATERE", assetId: assetMainEngine.id,
      defectId: defect1.id,
      rcaCode: "RCA-2026-001", status: "UNDER_ANALYSIS", methodology: "FIVE_WHYS",
      analysisSummary: "Análisis de fuga de aceite en cárter motor principal.",
      immediateCause: "Sello del cárter deteriorado por temperatura excesiva.",
      contributingCause: "Filtro de aceite no reemplazado en intervalo requerido.",
      rootCause: "Falla en seguimiento de plan de mantenimiento preventivo.",
      createdByUserId: uid, updatedByUserId: uid,
    },
  });

  await prisma.rcaRecord.upsert({
    where: { tenantId_vesselCode_rcaCode: { tenantId: tid, vesselCode: "GLT001", rcaCode: "RCA-2026-002" } },
    update: { updatedByUserId: uid },
    create: {
      tenantId: tid, vesselCode: "GLT001", assetId: vesselGlt.id,
      rcaCode: "RCA-2026-002", status: "COMPLETED", methodology: "FISHBONE",
      analysisSummary: "Vibración anormal en motor principal Wärtsilä.",
      rootCause: "Desequilibrio en hélice por acumulación de incrustaciones marinas.",
      correctiveActions: "Limpieza y balanceo de hélice en dique.",
      preventiveActions: "Inspección semestral de hélice programada.",
      completedAt: new Date(Date.now() - 2 * 86400000),
      createdByUserId: uid, updatedByUserId: uid,
    },
  });

  // ── CAPA ───────────────────────────────────────────────────────────────────
  await prisma.capaRecord.upsert({
    where: { tenantId_vesselCode_capaCode: { tenantId: tid, vesselCode: "LATERE", capaCode: "CAPA-2026-001" } },
    update: { updatedByUserId: uid },
    create: {
      tenantId: tid, vesselCode: "LATERE", assetId: assetMainEngine.id,
      sourceType: "RCA", sourceId: rca1.id,
      capaCode: "CAPA-2026-001", status: "IN_PROGRESS", priority: "HIGH",
      title: "Implementar checklist de verificación de sellos antes de arranque",
      description: "Desarrollar e implementar procedimiento de inspección visual de sellos del cárter como parte del checklist de pre-arranque del motor principal.",
      owner: "Jefe de Máquinas",
      dueDate: new Date(Date.now() + 15 * 86400000),
      createdByUserId: uid, updatedByUserId: uid,
    },
  });

  await prisma.capaRecord.upsert({
    where: { tenantId_vesselCode_capaCode: { tenantId: tid, vesselCode: "LATERE", capaCode: "CAPA-2026-002" } },
    update: { updatedByUserId: uid },
    create: {
      tenantId: tid, vesselCode: "LATERE", assetId: assetMainEngine.id,
      sourceType: "DEFECT", sourceId: defect1.id,
      capaCode: "CAPA-2026-002", status: "OPEN", priority: "MEDIUM",
      title: "Revisar y actualizar frecuencia de cambio de filtro de aceite",
      description: "Actualizar MP-FILTER-1M para incluir inspección de sellos y reducir intervalo a 750h según recomendación del fabricante.",
      owner: "Superintendente Técnico",
      dueDate: new Date(Date.now() + 30 * 86400000),
      createdByUserId: uid, updatedByUserId: uid,
    },
  });

  await prisma.capaRecord.upsert({
    where: { tenantId_vesselCode_capaCode: { tenantId: tid, vesselCode: "GLT001", capaCode: "CAPA-2026-003" } },
    update: { updatedByUserId: uid },
    create: {
      tenantId: tid, vesselCode: "GLT001", assetId: vesselGlt.id,
      sourceType: "RCA", sourceId: (await prisma.rcaRecord.findFirst({ where: { tenantId: tid, rcaCode: "RCA-2026-002" } }))!.id,
      capaCode: "CAPA-2026-003", status: "PENDING_VERIFICATION", priority: "HIGH",
      title: "Programar inspección semestral de hélice y sistema de propulsión",
      description: "Coordinar con astillero la inspección y limpieza de hélice cada 6 meses. Incluir análisis de vibraciones post-limpieza.",
      owner: "Armador / Superintendente",
      dueDate: new Date(Date.now() + 45 * 86400000),
      completedAt: new Date(Date.now() - 1 * 86400000),
      verificationNote: "Trabajo completado en astillero. Pendiente verificación de vibraciones en siguiente viaje.",
      createdByUserId: uid, updatedByUserId: uid,
    },
  });

  // ── Provider Evaluation ────────────────────────────────────────────────────
  await prisma.providerEvaluation.upsert({
    where: { tenantId_vesselCode_evaluationCode: { tenantId: tid, vesselCode: "LATERE", evaluationCode: "EVAL-2026-001" } },
    update: { updatedByUserId: uid },
    create: {
      tenantId: tid, vesselCode: "LATERE", providerId: provider1.id,
      evaluationCode: "EVAL-2026-001", status: "APPROVED",
      score: 88, rating: "A",
      evaluatedAt: new Date(Date.now() - 30 * 86400000),
      evaluatorName: "Jefe de Máquinas",
      summary: "Buena calidad de trabajo y cumplimiento de plazos.",
      notes: "Se recomienda renovar contrato.",
      createdByUserId: uid, updatedByUserId: uid,
    },
  });

  await prisma.providerEvaluation.upsert({
    where: { tenantId_vesselCode_evaluationCode: { tenantId: tid, vesselCode: "LATERE", evaluationCode: "EVAL-2026-002" } },
    update: { updatedByUserId: uid },
    create: {
      tenantId: tid, vesselCode: "LATERE", providerId: provider1.id,
      evaluationCode: "EVAL-2026-002", status: "DRAFT",
      score: 0, rating: "C",
      evaluatedAt: new Date(Date.now() - 5 * 86400000),
      evaluatorName: "Superintendente",
      summary: "Evaluación en proceso tras último trabajo de reparación.",
      createdByUserId: uid, updatedByUserId: uid,
    },
  });

  // ── Provider Nonconformity ─────────────────────────────────────────────────
  await prisma.providerNonconformity.upsert({
    where: { tenantId_vesselCode_nonconformityCode: { tenantId: tid, vesselCode: "LATERE", nonconformityCode: "NC-2026-001" } },
    update: { updatedByUserId: uid },
    create: {
      tenantId: tid, vesselCode: "LATERE", providerId: provider1.id,
      nonconformityCode: "NC-2026-001", status: "OPEN", severity: "MEDIUM",
      reportedAt: new Date(Date.now() - 15 * 86400000),
      description: "Retraso de 5 días en entrega de repuestos críticos sin notificación previa.",
      correctiveAction: "Exigir plan de comunicación para demoras.",
      createdByUserId: uid, updatedByUserId: uid,
    },
  });

  // ── Domain Events ──────────────────────────────────────────────────────────
  await prisma.domainEvent.createMany({
    skipDuplicates: true,
    data: [
      {
        tenantId: tid, vesselCode: "LATERE",
        entityType: "WorkOrder", entityId: "seed-wo-001",
        eventKind: "RECORD_CREATED", actorUserId: uid,
        payload: { workOrderCode: "WO-2026-001", type: "PREVENTIVE" },
        createdAt: new Date(Date.now() - 7 * 86400000),
      },
      {
        tenantId: tid, vesselCode: "LATERE",
        entityType: "Defect", entityId: "seed-def-001",
        eventKind: "RECORD_CREATED", actorUserId: uid,
        payload: { defectCode: "DEF-2026-001", severity: "HIGH" },
        createdAt: new Date(Date.now() - 5 * 86400000),
      },
      {
        tenantId: tid, vesselCode: "GLT001",
        entityType: "Certificate", entityId: "seed-cert-001",
        eventKind: "STATE_CHANGED", actorUserId: uid,
        payload: { certificateCode: "CERT-001", newStatus: "EXPIRING_SOON" },
        createdAt: new Date(Date.now() - 3 * 86400000),
      },
      {
        tenantId: tid, vesselCode: "LATERE",
        entityType: "Spare", entityId: "seed-spare-001",
        eventKind: "STATE_CHANGED", actorUserId: uid,
        payload: { sku: "ENG-FILTER-01", currentStock: 0, minStock: 2 },
        createdAt: new Date(Date.now() - 2 * 86400000),
      },
      {
        tenantId: tid, vesselCode: "GLT001",
        entityType: "Inspection", entityId: "seed-insp-001",
        eventKind: "STATE_CHANGED", actorUserId: uid,
        payload: { inspectionCode: "INSP-001", result: "CONDITIONAL" },
        createdAt: new Date(Date.now() - 1 * 86400000),
      },
    ],
  });

  // ── Generate AI insights from current data ─────────────────────────────────
  // ── SFI Nodes (catálogo global, 96 nodos estándar) ────────────────────────
  const SFI_DATA: { code: string; description: string; groupNumber: number; groupName: string }[] = [
    // Grupo 0 — Documentation
    { code: "000", description: "General documentation",    groupNumber: 0, groupName: "Documentation" },
    { code: "010", description: "Project documentation",    groupNumber: 0, groupName: "Documentation" },
    { code: "020", description: "Administration",           groupNumber: 0, groupName: "Documentation" },
    { code: "030", description: "Spare parts management",   groupNumber: 0, groupName: "Documentation" },
    { code: "040", description: "Tools",                    groupNumber: 0, groupName: "Documentation" },
    { code: "050", description: "Maintenance support",      groupNumber: 0, groupName: "Documentation" },
    // Grupo 1 — Hull
    { code: "100", description: "Hull general",             groupNumber: 1, groupName: "Hull" },
    { code: "110", description: "Shell structure",          groupNumber: 1, groupName: "Hull" },
    { code: "120", description: "Superstructure",           groupNumber: 1, groupName: "Hull" },
    { code: "130", description: "Decks",                    groupNumber: 1, groupName: "Hull" },
    { code: "140", description: "Tanks",                    groupNumber: 1, groupName: "Hull" },
    { code: "150", description: "Foundations",              groupNumber: 1, groupName: "Hull" },
    { code: "160", description: "Insulation",               groupNumber: 1, groupName: "Hull" },
    { code: "170", description: "Doors and hatches",        groupNumber: 1, groupName: "Hull" },
    { code: "180", description: "Masts",                    groupNumber: 1, groupName: "Hull" },
    { code: "190", description: "Special hull structures",  groupNumber: 1, groupName: "Hull" },
    // Grupo 2 — Cargo Equipment
    { code: "200", description: "Cargo equipment general",  groupNumber: 2, groupName: "Cargo Equipment" },
    { code: "210", description: "Cargo tanks",              groupNumber: 2, groupName: "Cargo Equipment" },
    { code: "220", description: "Cargo holds",              groupNumber: 2, groupName: "Cargo Equipment" },
    { code: "230", description: "Cargo heating",            groupNumber: 2, groupName: "Cargo Equipment" },
    { code: "240", description: "Cargo ventilation",        groupNumber: 2, groupName: "Cargo Equipment" },
    { code: "250", description: "Cargo monitoring",         groupNumber: 2, groupName: "Cargo Equipment" },
    { code: "260", description: "Cargo pipelines",          groupNumber: 2, groupName: "Cargo Equipment" },
    { code: "270", description: "Cargo valves",             groupNumber: 2, groupName: "Cargo Equipment" },
    { code: "280", description: "Cargo pumps",              groupNumber: 2, groupName: "Cargo Equipment" },
    { code: "290", description: "Cargo safety systems",     groupNumber: 2, groupName: "Cargo Equipment" },
    // Grupo 3 — Cargo Handling Equipment
    { code: "300", description: "Cargo handling general",   groupNumber: 3, groupName: "Cargo Handling Equipment" },
    { code: "310", description: "Cranes",                   groupNumber: 3, groupName: "Cargo Handling Equipment" },
    { code: "320", description: "Winches",                  groupNumber: 3, groupName: "Cargo Handling Equipment" },
    { code: "330", description: "Lifting equipment",        groupNumber: 3, groupName: "Cargo Handling Equipment" },
    { code: "340", description: "Conveyors",                groupNumber: 3, groupName: "Cargo Handling Equipment" },
    { code: "350", description: "Ro-Ro equipment",          groupNumber: 3, groupName: "Cargo Handling Equipment" },
    { code: "360", description: "Hatch covers",             groupNumber: 3, groupName: "Cargo Handling Equipment" },
    { code: "370", description: "Mooring winches",          groupNumber: 3, groupName: "Cargo Handling Equipment" },
    { code: "380", description: "Anchor handling",          groupNumber: 3, groupName: "Cargo Handling Equipment" },
    { code: "390", description: "Special cargo handling",   groupNumber: 3, groupName: "Cargo Handling Equipment" },
    // Grupo 4 — Ship Equipment
    { code: "400", description: "Ship equipment general",   groupNumber: 4, groupName: "Ship Equipment" },
    { code: "410", description: "Anchoring",                groupNumber: 4, groupName: "Ship Equipment" },
    { code: "420", description: "Mooring",                  groupNumber: 4, groupName: "Ship Equipment" },
    { code: "430", description: "Towing",                   groupNumber: 4, groupName: "Ship Equipment" },
    { code: "440", description: "Steering gear",            groupNumber: 4, groupName: "Ship Equipment" },
    { code: "450", description: "Stabilizers",              groupNumber: 4, groupName: "Ship Equipment" },
    { code: "460", description: "Deck machinery",           groupNumber: 4, groupName: "Ship Equipment" },
    { code: "470", description: "Ladders and gangways",     groupNumber: 4, groupName: "Ship Equipment" },
    { code: "480", description: "Life-saving equipment",    groupNumber: 4, groupName: "Ship Equipment" },
    { code: "490", description: "Safety equipment",         groupNumber: 4, groupName: "Ship Equipment" },
    // Grupo 5 — Equipment for Crew and Passengers
    { code: "500", description: "Accommodation general",    groupNumber: 5, groupName: "Equipment for Crew and Passengers" },
    { code: "510", description: "Cabins",                   groupNumber: 5, groupName: "Equipment for Crew and Passengers" },
    { code: "520", description: "Sanitary systems",         groupNumber: 5, groupName: "Equipment for Crew and Passengers" },
    { code: "530", description: "Galley",                   groupNumber: 5, groupName: "Equipment for Crew and Passengers" },
    { code: "540", description: "Laundry",                  groupNumber: 5, groupName: "Equipment for Crew and Passengers" },
    { code: "550", description: "HVAC",                     groupNumber: 5, groupName: "Equipment for Crew and Passengers" },
    { code: "560", description: "Water supply",             groupNumber: 5, groupName: "Equipment for Crew and Passengers" },
    { code: "570", description: "Sewage system",            groupNumber: 5, groupName: "Equipment for Crew and Passengers" },
    { code: "580", description: "Refrigeration",            groupNumber: 5, groupName: "Equipment for Crew and Passengers" },
    { code: "590", description: "Entertainment systems",    groupNumber: 5, groupName: "Equipment for Crew and Passengers" },
    // Grupo 6 — Main Components
    { code: "600", description: "Main components general",  groupNumber: 6, groupName: "Main Components" },
    { code: "610", description: "Main engine",              groupNumber: 6, groupName: "Main Components" },
    { code: "620", description: "Propulsion gear",          groupNumber: 6, groupName: "Main Components" },
    { code: "630", description: "Shafting",                 groupNumber: 6, groupName: "Main Components" },
    { code: "640", description: "Propeller",                groupNumber: 6, groupName: "Main Components" },
    { code: "650", description: "Thrusters",                groupNumber: 6, groupName: "Main Components" },
    { code: "660", description: "Reduction gears",          groupNumber: 6, groupName: "Main Components" },
    { code: "670", description: "Clutches",                 groupNumber: 6, groupName: "Main Components" },
    { code: "680", description: "Couplings",                groupNumber: 6, groupName: "Main Components" },
    { code: "690", description: "Other propulsion components", groupNumber: 6, groupName: "Main Components" },
    // Grupo 7 — Systems for Main Components
    { code: "700", description: "Machinery systems general", groupNumber: 7, groupName: "Systems for Main Components" },
    { code: "710", description: "Fuel oil systems",          groupNumber: 7, groupName: "Systems for Main Components" },
    { code: "720", description: "Lubricating oil systems",   groupNumber: 7, groupName: "Systems for Main Components" },
    { code: "730", description: "Cooling water systems",     groupNumber: 7, groupName: "Systems for Main Components" },
    { code: "740", description: "Air systems",               groupNumber: 7, groupName: "Systems for Main Components" },
    { code: "750", description: "Bilge and ballast systems", groupNumber: 7, groupName: "Systems for Main Components" },
    { code: "760", description: "Fire fighting systems",     groupNumber: 7, groupName: "Systems for Main Components" },
    { code: "770", description: "Compressed air",            groupNumber: 7, groupName: "Systems for Main Components" },
    { code: "780", description: "Steam systems",             groupNumber: 7, groupName: "Systems for Main Components" },
    { code: "790", description: "Other machinery systems",   groupNumber: 7, groupName: "Systems for Main Components" },
    // Grupo 8 — Electrical Installations
    { code: "800", description: "Electrical systems general", groupNumber: 8, groupName: "Electrical Installations" },
    { code: "810", description: "Power generation",           groupNumber: 8, groupName: "Electrical Installations" },
    { code: "820", description: "Power distribution",         groupNumber: 8, groupName: "Electrical Installations" },
    { code: "830", description: "Lighting",                   groupNumber: 8, groupName: "Electrical Installations" },
    { code: "840", description: "Navigation lights",          groupNumber: 8, groupName: "Electrical Installations" },
    { code: "850", description: "Communication systems",      groupNumber: 8, groupName: "Electrical Installations" },
    { code: "860", description: "Alarm systems",              groupNumber: 8, groupName: "Electrical Installations" },
    { code: "870", description: "Battery systems",            groupNumber: 8, groupName: "Electrical Installations" },
    { code: "880", description: "Emergency power",            groupNumber: 8, groupName: "Electrical Installations" },
    { code: "890", description: "Electrical auxiliaries",     groupNumber: 8, groupName: "Electrical Installations" },
    // Grupo 9 — Automation, Control and Monitoring
    { code: "900", description: "Automation general",          groupNumber: 9, groupName: "Automation, Control and Monitoring" },
    { code: "910", description: "Alarm systems",               groupNumber: 9, groupName: "Automation, Control and Monitoring" },
    { code: "920", description: "Remote control",              groupNumber: 9, groupName: "Automation, Control and Monitoring" },
    { code: "930", description: "Process control",             groupNumber: 9, groupName: "Automation, Control and Monitoring" },
    { code: "940", description: "Measuring instruments",       groupNumber: 9, groupName: "Automation, Control and Monitoring" },
    { code: "950", description: "Monitoring systems",          groupNumber: 9, groupName: "Automation, Control and Monitoring" },
    { code: "960", description: "Navigation instrumentation",  groupNumber: 9, groupName: "Automation, Control and Monitoring" },
    { code: "970", description: "Automation systems",          groupNumber: 9, groupName: "Automation, Control and Monitoring" },
    { code: "980", description: "Computer systems",            groupNumber: 9, groupName: "Automation, Control and Monitoring" },
    { code: "990", description: "Integrated control systems",  groupNumber: 9, groupName: "Automation, Control and Monitoring" },
  ];

  for (const node of SFI_DATA) {
    const existing = await prisma.sfiNode.findFirst({ where: { code: node.code, tenantId: null } });
    if (!existing) {
      await prisma.sfiNode.create({ data: { ...node, isGlobal: true, tenantId: null, sortOrder: parseInt(node.code) } });
    }
  }
  process.stdout.write(`SFI nodes seeded: ${SFI_DATA.length}\n`);

  // ── Equipment Classes (catálogo global base) ──────────────────────────────
  const EQUIPMENT_CLASSES: {
    code: string; name: string; description: string;
    defaultSfiCode: string; defaultCriticality: "A" | "B" | "C";
  }[] = [
    { code: "MAIN_ENGINE",        name: "Main Engine",               description: "Propulsion main engine",                   defaultSfiCode: "610", defaultCriticality: "A" },
    { code: "AUX_ENGINE",         name: "Auxiliary Engine",          description: "Auxiliary / generator engine",             defaultSfiCode: "610", defaultCriticality: "A" },
    { code: "GENERATOR",          name: "Generator",                 description: "Electric power generator",                 defaultSfiCode: "810", defaultCriticality: "A" },
    { code: "GEARBOX",            name: "Reduction Gearbox",         description: "Propulsion reduction gear",                defaultSfiCode: "660", defaultCriticality: "A" },
    { code: "PROPELLER",          name: "Propeller",                 description: "Fixed or controllable pitch propeller",    defaultSfiCode: "640", defaultCriticality: "A" },
    { code: "THRUSTER",           name: "Thruster",                  description: "Bow or stern thruster",                    defaultSfiCode: "650", defaultCriticality: "B" },
    { code: "STEERING_GEAR",      name: "Steering Gear",             description: "Rudder steering gear system",              defaultSfiCode: "440", defaultCriticality: "A" },
    { code: "FUEL_SYSTEM",        name: "Fuel Oil System",           description: "Fuel oil transfer and treatment system",   defaultSfiCode: "710", defaultCriticality: "A" },
    { code: "LUBE_OIL_SYSTEM",    name: "Lube Oil System",           description: "Lubricating oil system",                   defaultSfiCode: "720", defaultCriticality: "A" },
    { code: "COOLING_SYSTEM",     name: "Cooling Water System",      description: "Fresh water and sea water cooling",        defaultSfiCode: "730", defaultCriticality: "A" },
    { code: "COMPRESSED_AIR",     name: "Compressed Air System",     description: "Starting air and service air system",      defaultSfiCode: "770", defaultCriticality: "B" },
    { code: "BILGE_SYSTEM",       name: "Bilge System",              description: "Bilge and ballast pumping system",         defaultSfiCode: "750", defaultCriticality: "B" },
    { code: "FIRE_FIGHTING",      name: "Fire Fighting System",      description: "Fixed and portable fire fighting systems", defaultSfiCode: "760", defaultCriticality: "A" },
    { code: "CENTRIFUGAL_PUMP",   name: "Centrifugal Pump",          description: "General centrifugal pump",                 defaultSfiCode: "280", defaultCriticality: "B" },
    { code: "ANCHOR_WINDLASS",    name: "Anchor Windlass",           description: "Anchor windlass and chain stopper",        defaultSfiCode: "410", defaultCriticality: "B" },
    { code: "MOORING_WINCH",      name: "Mooring Winch",             description: "Mooring and towing winch",                 defaultSfiCode: "370", defaultCriticality: "B" },
    { code: "CRANE",              name: "Crane / Davit",             description: "Deck crane or lifeboat davit",             defaultSfiCode: "310", defaultCriticality: "B" },
    { code: "LIFEBOAT",           name: "Lifeboat / Rescue Boat",    description: "Lifeboat, rescue boat and launching gear", defaultSfiCode: "480", defaultCriticality: "A" },
    { code: "EMERGENCY_GEN",      name: "Emergency Generator",       description: "Emergency power generator set",            defaultSfiCode: "880", defaultCriticality: "A" },
    { code: "HVAC_UNIT",          name: "HVAC Unit",                 description: "Heating, ventilation and air conditioning", defaultSfiCode: "550", defaultCriticality: "C" },
    { code: "HEAT_EXCHANGER",     name: "Heat Exchanger",            description: "Shell and tube or plate heat exchanger",   defaultSfiCode: "730", defaultCriticality: "B" },
    { code: "SEPARATOR",          name: "Oil/Water Separator",       description: "Centrifugal separator or purifier",        defaultSfiCode: "710", defaultCriticality: "B" },
    { code: "COMPRESSOR",         name: "Compressor",                description: "Air or refrigerant compressor",            defaultSfiCode: "770", defaultCriticality: "B" },
    { code: "VALVE_CRITICAL",     name: "Critical Valve",            description: "Safety, relief or main isolation valve",  defaultSfiCode: "270", defaultCriticality: "A" },
    { code: "NAVIGATION_EQUIP",   name: "Navigation Equipment",      description: "Radar, GPS, ECDIS, AIS",                  defaultSfiCode: "960", defaultCriticality: "A" },
  ];

  for (const ec of EQUIPMENT_CLASSES) {
    const existing = await prisma.equipmentClass.findFirst({ where: { code: ec.code, tenantId: null } });
    if (!existing) {
      await prisma.equipmentClass.create({
        data: { ...ec, isGlobal: true, tenantId: null, status: "ACTIVE" },
      });
    }
  }
  process.stdout.write(`Equipment classes seeded: ${EQUIPMENT_CLASSES.length}\n`);

  const { generateInsightsForTenant } = await import("../apps/api/src/tenant/ai-insights/insight-generator");
  // Temporarily set DATABASE_URL so getPrismaClient works in the generator
  const insightsGenerated = await generateInsightsForTenant(tid);

  process.stdout.write("Seed completed.\n");
  process.stdout.write("Platform user: admin@localhost / admin123\n");
  process.stdout.write("Tenant user: admin@demo.local / demo123\n");
  process.stdout.write("Vessels: LATERE, GLT001\n");
  process.stdout.write("Operational data seeded: assets, work orders, defects, deferrals, rca, capa, spares, inspection, certificates, daily report, provider evaluations/NCs\n");
  process.stdout.write(`Domain events seeded: 5\n`);
  process.stdout.write(`AI insights generated: ${insightsGenerated}\n`);
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
