import type { TenantRole } from "@pms-saas/shared-types";

export interface DevVesselRecord {
  tenantSlug: string;
  code: string;
  name: string;
  owner?: string;
  vesselType?: string;
  imo?: string;
  registration?: string;
  powerHp?: number;
  dwtTons?: number;
  lengthM?: number;
  beamM?: number;
  depthM?: number;
  trnTn?: number;
  trbTn?: number;
  buildYear?: number;
  buildCountry?: string;
  incorporationDate?: string;
  incorporationType?: string;
  status: "ACTIVE" | "INACTIVE";
  createdAt: string;
  createdByUserId: string;
  updatedAt: string;
  updatedByUserId: string;
}

export interface DevAssetRecord {
  tenantSlug: string;
  id: string;
  vesselCode: string;
  assetCode: string;
  sfiCode: string;
  name: string;
  criticality: "A" | "B" | "C";
  status: "OPERATIONAL" | "DEGRADED" | "OUT_OF_SERVICE";
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  installationDate?: string;
  lastOverhaulDate?: string;
  createdAt: string;
  createdByUserId: string;
  updatedAt: string;
  updatedByUserId: string;
}

export interface DevMaintenancePlanRecord {
  tenantSlug: string;
  id: string;
  vesselCode: string;
  assetId: string;
  taskCode: string;
  title: string;
  description?: string;
  triggerType: "HOURS" | "MONTHS" | "CONDITION" | "EVENT";
  frequencyHours?: number;
  frequencyMonths?: number;
  responsible?: string;
  acceptanceCriteria?: string;
  loto?: string;
  sfiGroupNumber?: number;
  sfiSubgroupCode?: string;
  riskLevel?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  riskAnalysisResult?: string;
  status: "ACTIVE" | "DUE_SOON" | "OVERDUE" | "INACTIVE";
  lastExecutionDate?: string;
  nextDueDate?: string;
  lastExecutionHours?: number;
  nextDueHours?: number;
  createdAt: string;
  createdByUserId: string;
  updatedAt: string;
  updatedByUserId: string;
}

export interface DevWorkOrderRecord {
  tenantSlug: string;
  id: string;
  vesselCode: string;
  assetId: string;
  maintenancePlanId?: string;
  workOrderCode: string;
  type: "PREVENTIVE" | "CORRECTIVE" | "INSPECTION";
  status: "PLANNED" | "IN_PROGRESS" | "ON_HOLD" | "DEFERRED" | "CLOSED" | "CANCELLED";
  priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  criticality: "A" | "B" | "C";
  openDate: string;
  startDate?: string;
  dueDate?: string;
  completedDate?: string;
  holdReason?: string;
  cancelReason?: string;
  closeNotes?: string;
  independentVerifier?: string;
  testResult?: string;
  createdAt: string;
  createdByUserId: string;
  updatedAt: string;
  updatedByUserId: string;
}

export interface DevDefectRecord {
  tenantSlug: string;
  id: string;
  vesselCode: string;
  assetId: string;
  workOrderId?: string;
  defectCode: string;
  status: "OPEN" | "UNDER_REVIEW" | "IN_PROGRESS" | "DEFERRED" | "RESOLVED" | "CLOSED";
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  operationalState: "NORMAL" | "DEGRADED" | "RESTRICTED" | "NO_GO";
  classification: string;
  reportedAt: string;
  description: string;
  immediateAction?: string;
  correctiveAction?: string;
  createdAt: string;
  createdByUserId: string;
  updatedAt: string;
  updatedByUserId: string;
}

export interface DevDeferralRecord {
  tenantSlug: string;
  id: string;
  vesselCode: string;
  assetId: string;
  sourceType: "DEFECT" | "WORK_ORDER" | "MAINTENANCE_PLAN";
  sourceId: string;
  deferralCode: string;
  status: "REQUESTED" | "UNDER_REVIEW" | "APPROVED" | "REJECTED" | "ACTIVE" | "EXPIRED" | "CLOSED";
  requestedAt: string;
  requestedByUserId: string;
  targetDate?: string;
  justification?: string;
  compensatoryMeasures?: string;
  reviewNotes?: string;
  decisionAt?: string;
  decidedByUserId?: string;
  activeSince?: string;
  expiredAt?: string;
  closedAt?: string;
  closeNotes?: string;
  rejectionReason?: string;
  createdAt: string;
  createdByUserId: string;
  updatedAt: string;
  updatedByUserId: string;
}

export interface DevCapaRecord {
  tenantSlug: string;
  id: string;
  vesselCode: string;
  assetId: string;
  sourceType: "RCA" | "DEFECT" | "WORK_ORDER" | "INSPECTION";
  sourceId: string;
  capaCode: string;
  status: "OPEN" | "IN_PROGRESS" | "PENDING_VERIFICATION" | "CLOSED" | "CANCELLED";
  priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  title: string;
  description?: string;
  owner?: string;
  dueDate?: string;
  completedAt?: string;
  verificationNote?: string;
  cancelReason?: string;
  createdAt: string;
  createdByUserId: string;
  updatedAt: string;
  updatedByUserId: string;
}

export interface DevSpareRecord {
  tenantSlug: string;
  id: string;
  vesselCode: string;
  sku: string;
  name: string;
  category?: string;
  criticality: "A" | "B" | "C";
  manufacturer?: string;
  model?: string;
  unit: string;
  currentStock: number;
  minStock: number;
  reorderPoint: number;
  status: "ACTIVE" | "OBSOLETE";
  location?: string;
  createdAt: string;
  createdByUserId: string;
  updatedAt: string;
  updatedByUserId: string;
}

export interface DevProviderRecord {
  tenantSlug: string;
  id: string;
  vesselCode: string;
  providerCode: string;
  name: string;
  category?: string;
  status: "ACTIVE" | "INACTIVE";
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  location?: string;
  createdAt: string;
  createdByUserId: string;
  updatedAt: string;
  updatedByUserId: string;
}

export interface DevSpareOrderRecord {
  tenantSlug: string;
  id: string;
  vesselCode: string;
  orderCode: string;
  status:
    | "DRAFT"
    | "REQUESTED"
    | "APPROVED"
    | "ORDERED"
    | "PARTIALLY_RECEIVED"
    | "RECEIVED"
    | "CANCELLED";
  priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  providerId?: string;
  requestedByUserId: string;
  requestedAt: string;
  expectedDeliveryDate?: string;
  totalLines: number;
  totalCost?: number;
  currency?: string;
  notes?: string;
  createdAt: string;
  createdByUserId: string;
  updatedAt: string;
  updatedByUserId: string;
}

export interface DevInspectionRecord {
  tenantSlug: string;
  id: string;
  vesselCode: string;
  assetId?: string;
  inspectionCode: string;
  type: "SAFETY" | "TECHNICAL" | "REGULATORY" | "CLASS";
  status: "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  result?: "PASS" | "FAIL" | "CONDITIONAL";
  providerId?: string;
  scheduledAt?: string;
  completedAt?: string;
  inspectorName?: string;
  notes?: string;
  createdAt: string;
  createdByUserId: string;
  updatedAt: string;
  updatedByUserId: string;
}

export interface DevCertificateRecord {
  tenantSlug: string;
  id: string;
  vesselCode: string;
  assetId?: string;
  certificateCode: string;
  name: string;
  issuingAuthority: string;
  status: "ACTIVE" | "EXPIRING_SOON" | "EXPIRED" | "SUSPENDED" | "CLOSED";
  issueDate: string;
  expiryDate: string;
  lastInspectionDate?: string;
  notes?: string;
  originalSourceLink?: string;
  originalSourceName?: string;
  originalSourceMimeOrExt?: string;
  createdAt: string;
  createdByUserId: string;
  updatedAt: string;
  updatedByUserId: string;
}

export interface DevDailyReportRecord {
  tenantSlug: string;
  id: string;
  vesselCode: string;
  reportDate: string;
  status: "DRAFT" | "SUBMITTED" | "REVIEWED" | "CLOSED";
  summary?: string;
  positionLat?: number;
  positionLon?: number;
  engineHoursMain?: number;
  generatorHours?: number;
  fuelConsumedLiters?: number;
  notes?: string;
  createdAt: string;
  createdByUserId: string;
  updatedAt: string;
  updatedByUserId: string;
}

export interface DevAttachmentRecord {
  tenantSlug: string;
  id: string;
  vesselCode: string;
  targetType:
    | "DEFECT"
    | "WORK_ORDER"
    | "MAINTENANCE_PLAN"
    | "INSPECTION"
    | "CERTIFICATE"
    | "DAILY_REPORT"
    | "RCA"
    | "CAPA"
    | "SPARE_REQUEST";
  targetId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  status: "ACTIVE" | "ARCHIVED";
  uploadedAt: string;
  uploadedByUserId: string;
  description?: string;
  createdAt: string;
  createdByUserId: string;
  updatedAt: string;
  updatedByUserId: string;
}

export interface DevInspectionLogRecord {
  tenantSlug: string;
  id: string;
  vesselCode: string;
  inspectionId: string;
  logCode: string;
  entryType: "FINDING" | "ACTION" | "NOTE";
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  observedAt: string;
  summary: string;
  recommendation?: string;
  createdAt: string;
  createdByUserId: string;
  updatedAt: string;
  updatedByUserId: string;
}

export interface DevStockMovementRecord {
  tenantSlug: string;
  id: string;
  vesselCode: string;
  spareId: string;
  movementCode: string;
  movementType: "RECEIPT" | "ISSUE" | "ADJUSTMENT" | "TRANSFER";
  quantity: number;
  unit: string;
  occurredAt: string;
  referenceType?: "SPARE_REQUEST" | "WORK_ORDER" | "DEFECT" | "ADJUSTMENT";
  referenceId?: string;
  notes?: string;
  createdAt: string;
  createdByUserId: string;
  updatedAt: string;
  updatedByUserId: string;
}

export interface DevProviderEvaluationRecord {
  tenantSlug: string;
  id: string;
  vesselCode: string;
  providerId: string;
  evaluationCode: string;
  status: "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED";
  score: number;
  rating: "A" | "B" | "C" | "D";
  evaluatedAt: string;
  evaluatorName: string;
  summary?: string;
  notes?: string;
  createdAt: string;
  createdByUserId: string;
  updatedAt: string;
  updatedByUserId: string;
}

export interface DevProviderNonconformityRecord {
  tenantSlug: string;
  id: string;
  vesselCode: string;
  providerId: string;
  nonconformityCode: string;
  status: "OPEN" | "UNDER_REVIEW" | "RESOLVED" | "CLOSED";
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  reportedAt: string;
  description: string;
  correctiveAction?: string;
  closedAt?: string;
  createdAt: string;
  createdByUserId: string;
  updatedAt: string;
  updatedByUserId: string;
}

export interface DevAiInsightRecord {
  tenantSlug: string;
  id: string;
  insightCode: string;
  insightType:
    | "backlog_risk"
    | "repeated_failure"
    | "repeated_deferral"
    | "pm_frequency_review"
    | "stock_below_minimum"
    | "stock_below_reorder_point"
    | "certificate_expiring"
    | "certificate_expired"
    | "inspection_failure_pattern"
    | "overdue_capa"
    | "overdue_work_order"
    | "documentation_gap"
    | "operational_anomaly"
    | "recurring_asset_downtime"
    | "trend_based_maintenance_improvement"
    | "cross_vessel_spare_availability"
    | "fleet_repeated_failure_pattern"
    | "fleet_known_fix_suggestion"
    | "fleet_shared_operational_experience";
  status: "OPEN" | "DISMISSED" | "RESOLVED";
  priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  targetType:
    | "VESSEL"
    | "ASSET"
    | "WORK_ORDER"
    | "DEFECT"
    | "CAPA"
    | "SPARE"
    | "CERTIFICATE"
    | "INSPECTION"
    | "FLEET";
  targetId?: string | null;
  vesselCode?: string | null;
  title: string;
  summary: string;
  recommendation: string;
  detectedAt: string;
  createdAt: string;
  createdByUserId: string;
  updatedAt: string;
  updatedByUserId: string;
}

export interface DevDomainEventRecord {
  tenantSlug: string;
  id: string;
  vesselCode: string;
  eventCode: string;
  category:
    | "master_data"
    | "maintenance"
    | "operations"
    | "compliance"
    | "stock"
    | "procurement"
    | "document"
    | "AI"
    | "import_export"
    | "security";
  eventType: string;
  title: string;
  summary?: string;
  targetType:
    | "VESSEL"
    | "ASSET"
    | "WORK_ORDER"
    | "DEFECT"
    | "CAPA"
    | "SPARE"
    | "SPARE_REQUEST"
    | "CERTIFICATE"
    | "INSPECTION";
  targetId?: string | null;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  occurredAt: string;
  createdAt: string;
  createdByUserId: string;
  updatedAt: string;
  updatedByUserId: string;
}

const createdAt = "2026-04-01T00:00:00.000Z";
const updatedAt = "2026-04-13T00:00:00.000Z";
const createdByUserId = "dev-tenant-user-demo-admin";

const DEV_VESSELS: DevVesselRecord[] = [
  {
    tenantSlug: "demo",
    code: "LATERE",
    name: "Latere",
    status: "ACTIVE",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    code: "GLT001",
    name: "GLT 001",
    status: "ACTIVE",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
];

const DEV_ASSETS: DevAssetRecord[] = [
  {
    tenantSlug: "demo",
    id: "asset-demo-latere-main-engine-port",
    vesselCode: "LATERE",
    assetCode: "LAT-ME-P",
    sfiCode: "200.10",
    name: "Main Engine Port",
    criticality: "A",
    status: "OPERATIONAL",
    manufacturer: "Caterpillar",
    model: "3512",
    serialNumber: "CAT-LAT-P-001",
    installationDate: "2020-05-12",
    lastOverhaulDate: "2025-11-20",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "asset-demo-latere-main-engine-starboard",
    vesselCode: "LATERE",
    assetCode: "LAT-ME-S",
    sfiCode: "200.20",
    name: "Main Engine Starboard",
    criticality: "A",
    status: "DEGRADED",
    manufacturer: "Caterpillar",
    model: "3512",
    serialNumber: "CAT-LAT-S-001",
    installationDate: "2020-05-12",
    lastOverhaulDate: "2025-09-15",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "asset-demo-glt-generator-a",
    vesselCode: "GLT001",
    assetCode: "GLT-GEN-A",
    sfiCode: "310.05",
    name: "Generator A",
    criticality: "B",
    status: "OPERATIONAL",
    manufacturer: "Cummins",
    model: "KTA19",
    serialNumber: "CUM-GLT-A-001",
    installationDate: "2021-02-18",
    lastOverhaulDate: "2025-12-05",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
];

const DEV_MAINTENANCE_PLANS: DevMaintenancePlanRecord[] = [
  {
    tenantSlug: "demo",
    id: "mp-demo-latere-port-engine-250h",
    vesselCode: "LATERE",
    assetId: "asset-demo-latere-main-engine-port",
    taskCode: "LAT-ME-P-250H",
    title: "250 Hour Main Engine Port Service",
    description: "Routine lubrication, filters, and visual inspection for port main engine.",
    triggerType: "HOURS",
    frequencyHours: 250,
    responsible: "Chief Engineer",
    acceptanceCriteria: "No leaks, stable oil pressure, clean filter replacement confirmed.",
    loto: "Photos and service checklist",
    sfiGroupNumber: 7,
    sfiSubgroupCode: "710",
    riskLevel: "HIGH",
    riskAnalysisResult: "Riesgo alto por impacto directo en propulsión. Ejecutar mantenimiento en la primera ventana operativa.",
    status: "DUE_SOON",
    lastExecutionDate: "2026-02-20",
    nextDueDate: "2026-04-20",
    lastExecutionHours: 11250,
    nextDueHours: 11500,
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "mp-demo-latere-starboard-engine-500h",
    vesselCode: "LATERE",
    assetId: "asset-demo-latere-main-engine-starboard",
    taskCode: "LAT-ME-S-500H",
    title: "500 Hour Main Engine Starboard Preventive Maintenance",
    description: "Extended preventive service including valve clearance and fuel system inspection.",
    triggerType: "HOURS",
    frequencyHours: 500,
    responsible: "Chief Engineer",
    acceptanceCriteria: "Engine parameters within standard operating range after maintenance.",
    loto: "Checklist, readings, and signed verification",
    sfiGroupNumber: 7,
    sfiSubgroupCode: "720",
    riskLevel: "CRITICAL",
    riskAnalysisResult: "Riesgo crítico por condición degradada y vencimiento del plan. Prioridad inmediata con monitoreo continuo.",
    status: "OVERDUE",
    lastExecutionDate: "2025-12-15",
    nextDueDate: "2026-03-15",
    lastExecutionHours: 9800,
    nextDueHours: 10300,
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "mp-demo-glt-generator-a-monthly",
    vesselCode: "GLT001",
    assetId: "asset-demo-glt-generator-a",
    taskCode: "GLT-GEN-A-M01",
    title: "Monthly Generator A Functional Check",
    description: "Monthly operational and safety verification of Generator A.",
    triggerType: "MONTHS",
    frequencyMonths: 1,
    responsible: "Engine Officer",
    acceptanceCriteria: "Stable load acceptance and no alarm condition during test.",
    loto: "Functional test report",
    sfiGroupNumber: 7,
    sfiSubgroupCode: "740",
    riskLevel: "MEDIUM",
    riskAnalysisResult: "Riesgo medio; mantener la periodicidad mensual para evitar escalamiento.",
    status: "ACTIVE",
    lastExecutionDate: "2026-04-05",
    nextDueDate: "2026-05-05",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
];

const DEV_WORK_ORDERS: DevWorkOrderRecord[] = [
  {
    tenantSlug: "demo",
    id: "wo-demo-latere-port-engine-001",
    vesselCode: "LATERE",
    assetId: "asset-demo-latere-main-engine-port",
    maintenancePlanId: "mp-demo-latere-port-engine-250h",
    workOrderCode: "OT-0001",
    type: "PREVENTIVE",
    status: "PLANNED",
    priority: "HIGH",
    criticality: "A",
    openDate: "2026-04-10",
    dueDate: "2026-04-20",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "wo-demo-latere-starboard-engine-002",
    vesselCode: "LATERE",
    assetId: "asset-demo-latere-main-engine-starboard",
    maintenancePlanId: "mp-demo-latere-starboard-engine-500h",
    workOrderCode: "OT-0002",
    type: "CORRECTIVE",
    status: "IN_PROGRESS",
    priority: "CRITICAL",
    criticality: "A",
    openDate: "2026-04-08",
    startDate: "2026-04-09",
    dueDate: "2026-04-14",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "wo-demo-glt-generator-a-003",
    vesselCode: "GLT001",
    assetId: "asset-demo-glt-generator-a",
    maintenancePlanId: "mp-demo-glt-generator-a-monthly",
    workOrderCode: "OT-0003",
    type: "INSPECTION",
    status: "ON_HOLD",
    priority: "MEDIUM",
    criticality: "B",
    openDate: "2026-04-11",
    startDate: "2026-04-12",
    dueDate: "2026-04-18",
    holdReason: "Waiting for spare test lamp delivery.",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "wo-demo-latere-port-engine-004",
    vesselCode: "LATERE",
    assetId: "asset-demo-latere-main-engine-port",
    workOrderCode: "OT-0004",
    type: "CORRECTIVE",
    status: "DEFERRED",
    priority: "HIGH",
    criticality: "A",
    openDate: "2026-03-28",
    dueDate: "2026-04-05",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "wo-demo-glt-generator-a-005",
    vesselCode: "GLT001",
    assetId: "asset-demo-glt-generator-a",
    workOrderCode: "OT-0005",
    type: "PREVENTIVE",
    status: "CLOSED",
    priority: "MEDIUM",
    criticality: "B",
    openDate: "2026-03-20",
    startDate: "2026-03-21",
    dueDate: "2026-03-25",
    completedDate: "2026-03-24",
    closeNotes: "Functional check completed successfully.",
    independentVerifier: "Senior Engineer",
    testResult: "PASS",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
];

const DEV_DEFECTS: DevDefectRecord[] = [
  {
    tenantSlug: "demo",
    id: "def-demo-latere-port-engine-001",
    vesselCode: "LATERE",
    assetId: "asset-demo-latere-main-engine-port",
    workOrderId: "wo-demo-latere-port-engine-004",
    defectCode: "DEF-0001",
    status: "OPEN",
    severity: "HIGH",
    operationalState: "DEGRADED",
    classification: "Fuel leakage",
    reportedAt: "2026-04-10T09:30:00.000Z",
    description: "Minor fuel leak observed around the port main engine injector line during startup checks.",
    immediateAction: "Reduced operating load and isolated affected line for inspection.",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "def-demo-latere-starboard-engine-002",
    vesselCode: "LATERE",
    assetId: "asset-demo-latere-main-engine-starboard",
    workOrderId: "wo-demo-latere-starboard-engine-002",
    defectCode: "DEF-0002",
    status: "IN_PROGRESS",
    severity: "CRITICAL",
    operationalState: "RESTRICTED",
    classification: "Cooling system pressure instability",
    reportedAt: "2026-04-08T14:15:00.000Z",
    description: "Cooling pressure fluctuations above operating tolerance detected under load.",
    immediateAction: "Load restricted pending inspection of pump and thermostat assembly.",
    correctiveAction: "Pump inspection and thermostat replacement in progress.",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "def-demo-glt-generator-a-003",
    vesselCode: "GLT001",
    assetId: "asset-demo-glt-generator-a",
    workOrderId: "wo-demo-glt-generator-a-003",
    defectCode: "DEF-0003",
    status: "UNDER_REVIEW",
    severity: "MEDIUM",
    operationalState: "DEGRADED",
    classification: "Alarm lamp intermittent fault",
    reportedAt: "2026-04-11T07:20:00.000Z",
    description: "Generator alarm indication lamp failed intermittently during pre-start checks.",
    immediateAction: "Functional tests initiated and spare lamp requested.",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "def-demo-latere-port-engine-004",
    vesselCode: "LATERE",
    assetId: "asset-demo-latere-main-engine-port",
    defectCode: "DEF-0004",
    status: "DEFERRED",
    severity: "HIGH",
    operationalState: "RESTRICTED",
    classification: "Turbocharger vibration above trend",
    reportedAt: "2026-03-28T11:00:00.000Z",
    description: "Port engine turbocharger vibration trend exceeded maintenance threshold.",
    immediateAction: "Operating envelope restricted and monitored.",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "def-demo-glt-generator-a-005",
    vesselCode: "GLT001",
    assetId: "asset-demo-glt-generator-a",
    workOrderId: "wo-demo-glt-generator-a-005",
    defectCode: "DEF-0005",
    status: "RESOLVED",
    severity: "MEDIUM",
    operationalState: "NORMAL",
    classification: "Battery charger calibration drift",
    reportedAt: "2026-03-19T08:45:00.000Z",
    description: "Generator battery charger output was drifting below set point.",
    immediateAction: "Manual charge monitoring started.",
    correctiveAction: "Calibration adjusted and stable readings confirmed.",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
];

const DEV_DEFERRALS: DevDeferralRecord[] = [
  {
    tenantSlug: "demo",
    id: "deferral-demo-latere-port-engine-001",
    vesselCode: "LATERE",
    assetId: "asset-demo-latere-main-engine-port",
    sourceType: "DEFECT",
    sourceId: "def-demo-latere-port-engine-004",
    deferralCode: "DFR-0001",
    status: "ACTIVE",
    requestedAt: "2026-03-28T15:30:00.000Z",
    requestedByUserId: createdByUserId,
    targetDate: "2026-05-15",
    justification: "Awaiting turbocharger inspection slot during next port stay.",
    compensatoryMeasures: "Reduced load and vibration monitoring every watch.",
    decisionAt: "2026-03-29T10:00:00.000Z",
    decidedByUserId: createdByUserId,
    activeSince: "2026-03-29",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "deferral-demo-latere-port-engine-002",
    vesselCode: "LATERE",
    assetId: "asset-demo-latere-main-engine-port",
    sourceType: "WORK_ORDER",
    sourceId: "wo-demo-latere-port-engine-004",
    deferralCode: "DFR-0002",
    status: "APPROVED",
    requestedAt: "2026-03-27T12:00:00.000Z",
    requestedByUserId: createdByUserId,
    targetDate: "2026-04-30",
    justification: "Spare kit delivery delayed; request to align with revised delivery schedule.",
    decisionAt: "2026-03-28T09:15:00.000Z",
    decidedByUserId: createdByUserId,
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "deferral-demo-glt-generator-a-003",
    vesselCode: "GLT001",
    assetId: "asset-demo-glt-generator-a",
    sourceType: "DEFECT",
    sourceId: "def-demo-glt-generator-a-003",
    deferralCode: "DFR-0003",
    status: "UNDER_REVIEW",
    requestedAt: "2026-04-11T09:45:00.000Z",
    requestedByUserId: createdByUserId,
    targetDate: "2026-04-25",
    justification: "Awaiting vendor confirmation on alarm lamp batch issue.",
    reviewNotes: "Engineering review pending onboard test results.",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "deferral-demo-glt-generator-a-004",
    vesselCode: "GLT001",
    assetId: "asset-demo-glt-generator-a",
    sourceType: "MAINTENANCE_PLAN",
    sourceId: "mp-demo-glt-generator-a-monthly",
    deferralCode: "DFR-0004",
    status: "REQUESTED",
    requestedAt: "2026-04-12T08:20:00.000Z",
    requestedByUserId: createdByUserId,
    targetDate: "2026-04-20",
    justification: "Crew rotation scheduled; request to defer monthly check by one week.",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "deferral-demo-latere-starboard-005",
    vesselCode: "LATERE",
    assetId: "asset-demo-latere-main-engine-starboard",
    sourceType: "WORK_ORDER",
    sourceId: "wo-demo-latere-starboard-engine-002",
    deferralCode: "DFR-0005",
    status: "REJECTED",
    requestedAt: "2026-04-08T16:10:00.000Z",
    requestedByUserId: createdByUserId,
    targetDate: "2026-04-12",
    justification: "Requested deferment pending spare thermostat delivery.",
    rejectionReason: "Risk level unacceptable due to cooling instability.",
    decisionAt: "2026-04-09T09:00:00.000Z",
    decidedByUserId: createdByUserId,
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "deferral-demo-glt-generator-a-006",
    vesselCode: "GLT001",
    assetId: "asset-demo-glt-generator-a",
    sourceType: "DEFECT",
    sourceId: "def-demo-glt-generator-a-005",
    deferralCode: "DFR-0006",
    status: "EXPIRED",
    requestedAt: "2026-03-18T10:30:00.000Z",
    requestedByUserId: createdByUserId,
    targetDate: "2026-03-22",
    justification: "Short-term deferment requested for calibration tools arrival.",
    decisionAt: "2026-03-18T14:00:00.000Z",
    decidedByUserId: createdByUserId,
    activeSince: "2026-03-18",
    expiredAt: "2026-03-23",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "deferral-demo-glt-generator-a-007",
    vesselCode: "GLT001",
    assetId: "asset-demo-glt-generator-a",
    sourceType: "WORK_ORDER",
    sourceId: "wo-demo-glt-generator-a-005",
    deferralCode: "DFR-0007",
    status: "CLOSED",
    requestedAt: "2026-03-12T09:00:00.000Z",
    requestedByUserId: createdByUserId,
    targetDate: "2026-03-20",
    justification: "Deferred closure pending inspection signoff.",
    decisionAt: "2026-03-12T15:00:00.000Z",
    decidedByUserId: createdByUserId,
    activeSince: "2026-03-12",
    closedAt: "2026-03-25",
    closeNotes: "Inspection complete and deferral closed.",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
];

const DEV_CAPAS: DevCapaRecord[] = [
  {
    tenantSlug: "demo",
    id: "capa-demo-latere-port-engine-001",
    vesselCode: "LATERE",
    assetId: "asset-demo-latere-main-engine-port",
    sourceType: "DEFECT",
    sourceId: "def-demo-latere-port-engine-001",
    capaCode: "CAPA-0001",
    status: "OPEN",
    priority: "HIGH",
    title: "Stabilize injector line sealing",
    description: "Define corrective action plan for injector line sealing and monitoring.",
    owner: "Chief Engineer",
    dueDate: "2026-04-25",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "capa-demo-latere-starboard-engine-002",
    vesselCode: "LATERE",
    assetId: "asset-demo-latere-main-engine-starboard",
    sourceType: "RCA",
    sourceId: "rca-demo-latere-starboard-engine-002",
    capaCode: "CAPA-0002",
    status: "IN_PROGRESS",
    priority: "CRITICAL",
    title: "Cooling system lead-time mitigation",
    description: "Update maintenance plan and add procurement buffer for thermostat assembly.",
    owner: "Maintenance Manager",
    dueDate: "2026-04-20",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "capa-demo-glt-generator-a-003",
    vesselCode: "GLT001",
    assetId: "asset-demo-glt-generator-a",
    sourceType: "RCA",
    sourceId: "rca-demo-glt-generator-a-004",
    capaCode: "CAPA-0003",
    status: "PENDING_VERIFICATION",
    priority: "MEDIUM",
    title: "Grounding verification checklist update",
    description: "Add grounding torque checks and verify implementation onboard.",
    owner: "Electrical Supervisor",
    dueDate: "2026-03-30",
    completedAt: "2026-03-28T16:00:00.000Z",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "capa-demo-glt-generator-a-004",
    vesselCode: "GLT001",
    assetId: "asset-demo-glt-generator-a",
    sourceType: "WORK_ORDER",
    sourceId: "wo-demo-glt-generator-a-005",
    capaCode: "CAPA-0004",
    status: "CLOSED",
    priority: "LOW",
    title: "Battery charger calibration protocol",
    description: "Document calibration stability verification steps.",
    owner: "Engine Officer",
    dueDate: "2026-03-22",
    completedAt: "2026-03-21T12:00:00.000Z",
    verificationNote: "Verification checklist completed and signed.",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "capa-demo-latere-starboard-engine-005",
    vesselCode: "LATERE",
    assetId: "asset-demo-latere-main-engine-starboard",
    sourceType: "DEFECT",
    sourceId: "def-demo-latere-starboard-engine-002",
    capaCode: "CAPA-0005",
    status: "CANCELLED",
    priority: "HIGH",
    title: "Cooling pump contingency plan",
    description: "Cancelled due to immediate pump replacement scope.",
    owner: "Maintenance Manager",
    cancelReason: "Superseded by emergency replacement work order.",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "capa-demo-glt-generator-a-006",
    vesselCode: "GLT001",
    assetId: "asset-demo-glt-generator-a",
    sourceType: "INSPECTION",
    sourceId: "insp-demo-glt-generator-a-001",
    capaCode: "CAPA-0006",
    status: "IN_PROGRESS",
    priority: "HIGH",
    title: "Alarm circuit redundancy audit",
    description: "Audit alarm circuit redundancy and update wiring diagram controls.",
    owner: "Electrical Supervisor",
    dueDate: "2026-03-18",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
];

const DEV_SPARES: DevSpareRecord[] = [
  {
    tenantSlug: "demo",
    id: "spare-demo-latere-injector-seal-001",
    vesselCode: "LATERE",
    sku: "LAT-SEA-001",
    name: "Injector Seal Kit",
    category: "Fuel System",
    criticality: "A",
    manufacturer: "Caterpillar",
    model: "3512",
    unit: "kit",
    currentStock: 1,
    minStock: 2,
    reorderPoint: 5,
    status: "ACTIVE",
    location: "LATERE Store A",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "spare-demo-latere-oil-filter-002",
    vesselCode: "LATERE",
    sku: "LAT-OIL-014",
    name: "Main Engine Oil Filter",
    category: "Lubrication",
    criticality: "B",
    manufacturer: "Caterpillar",
    model: "3512",
    unit: "pcs",
    currentStock: 3,
    minStock: 2,
    reorderPoint: 6,
    status: "ACTIVE",
    location: "LATERE Store B",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "spare-demo-latere-thermostat-003",
    vesselCode: "LATERE",
    sku: "LAT-THR-009",
    name: "Cooling Thermostat",
    category: "Cooling",
    criticality: "A",
    manufacturer: "Caterpillar",
    model: "3512",
    unit: "pcs",
    currentStock: 0,
    minStock: 1,
    reorderPoint: 2,
    status: "ACTIVE",
    location: "LATERE Store A",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "spare-demo-glt-alarm-lamp-004",
    vesselCode: "GLT001",
    sku: "GLT-ALM-120",
    name: "Alarm Indicator Lamp",
    category: "Electrical",
    criticality: "C",
    manufacturer: "Siemens",
    model: "SIG-120",
    unit: "pcs",
    currentStock: 12,
    minStock: 4,
    reorderPoint: 8,
    status: "ACTIVE",
    location: "GLT001 Locker 2",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "spare-demo-glt-ground-strap-005",
    vesselCode: "GLT001",
    sku: "GLT-GND-044",
    name: "Grounding Strap",
    category: "Electrical",
    criticality: "B",
    manufacturer: "ABB",
    unit: "pcs",
    currentStock: 2,
    minStock: 2,
    reorderPoint: 5,
    status: "ACTIVE",
    location: "GLT001 Locker 1",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "spare-demo-glt-legacy-coupler-006",
    vesselCode: "GLT001",
    sku: "GLT-CPL-199",
    name: "Legacy Coupler",
    category: "Drive",
    criticality: "C",
    manufacturer: "SKF",
    unit: "pcs",
    currentStock: 0,
    minStock: 0,
    reorderPoint: 0,
    status: "OBSOLETE",
    location: "GLT001 Retired Stock",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
];

const DEV_PROVIDERS: DevProviderRecord[] = [
  {
    tenantSlug: "demo",
    id: "provider-demo-latere-engine-001",
    vesselCode: "LATERE",
    providerCode: "LAT-ENG-01",
    name: "Atlantic Engine Services",
    category: "Engine",
    status: "ACTIVE",
    contactName: "Laura Perez",
    contactEmail: "lperez@atlantic-engine.test",
    contactPhone: "+1-555-0142",
    location: "Montevideo",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "provider-demo-latere-spares-002",
    vesselCode: "LATERE",
    providerCode: "LAT-SPR-02",
    name: "Harbor Spares Logistics",
    category: "Spares",
    status: "ACTIVE",
    contactName: "Gaston Ruiz",
    contactEmail: "sales@harbor-spares.test",
    contactPhone: "+1-555-0188",
    location: "Buenos Aires",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "provider-demo-glt-electrical-003",
    vesselCode: "GLT001",
    providerCode: "GLT-ELC-03",
    name: "Delta Electrical Marine",
    category: "Electrical",
    status: "ACTIVE",
    contactName: "Sofia Mendes",
    contactEmail: "sofia@delta-electrical.test",
    contactPhone: "+1-555-0119",
    location: "Santos",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "provider-demo-glt-inspection-004",
    vesselCode: "GLT001",
    providerCode: "GLT-INSP-04",
    name: "Mariner Inspection Bureau",
    category: "Inspection",
    status: "ACTIVE",
    contactName: "Haruto Sato",
    contactEmail: "hsato@mariner-inspection.test",
    contactPhone: "+1-555-0174",
    location: "Valparaiso",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "provider-demo-glt-retired-005",
    vesselCode: "GLT001",
    providerCode: "GLT-LEG-05",
    name: "Legacy Coupler Supply Co.",
    category: "Drive",
    status: "INACTIVE",
    contactName: "Martin Doyle",
    contactEmail: "mdoyle@legacy-coupler.test",
    contactPhone: "+1-555-0133",
    location: "Rio de Janeiro",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
];

const DEV_SPARE_ORDERS: DevSpareOrderRecord[] = [
  {
    tenantSlug: "demo",
    id: "spare-order-demo-latere-001",
    vesselCode: "LATERE",
    orderCode: "SO-0001",
    status: "REQUESTED",
    priority: "HIGH",
    providerId: "provider-demo-latere-spares-002",
    requestedByUserId: createdByUserId,
    requestedAt: "2026-04-10T09:00:00.000Z",
    expectedDeliveryDate: "2026-04-22",
    totalLines: 3,
    totalCost: 4500,
    currency: "USD",
    notes: "Urgent seal kit and thermostat replacement.",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "spare-order-demo-latere-002",
    vesselCode: "LATERE",
    orderCode: "SO-0002",
    status: "APPROVED",
    priority: "MEDIUM",
    providerId: "provider-demo-latere-engine-001",
    requestedByUserId: createdByUserId,
    requestedAt: "2026-04-05T14:30:00.000Z",
    expectedDeliveryDate: "2026-04-18",
    totalLines: 2,
    totalCost: 1200,
    currency: "USD",
    notes: "Routine filters and gaskets.",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "spare-order-demo-glt-003",
    vesselCode: "GLT001",
    orderCode: "SO-0003",
    status: "ORDERED",
    priority: "HIGH",
    providerId: "provider-demo-glt-electrical-003",
    requestedByUserId: createdByUserId,
    requestedAt: "2026-04-08T11:15:00.000Z",
    expectedDeliveryDate: "2026-04-20",
    totalLines: 4,
    totalCost: 3100,
    currency: "USD",
    notes: "Alarm lamp batch and grounding straps.",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "spare-order-demo-glt-004",
    vesselCode: "GLT001",
    orderCode: "SO-0004",
    status: "PARTIALLY_RECEIVED",
    priority: "MEDIUM",
    providerId: "provider-demo-glt-electrical-003",
    requestedByUserId: createdByUserId,
    requestedAt: "2026-03-28T10:10:00.000Z",
    expectedDeliveryDate: "2026-04-06",
    totalLines: 3,
    totalCost: 980,
    currency: "USD",
    notes: "Partial delivery received; remaining items pending.",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "spare-order-demo-glt-005",
    vesselCode: "GLT001",
    orderCode: "SO-0005",
    status: "RECEIVED",
    priority: "LOW",
    providerId: "provider-demo-glt-electrical-003",
    requestedByUserId: createdByUserId,
    requestedAt: "2026-03-15T08:45:00.000Z",
    expectedDeliveryDate: "2026-03-22",
    totalLines: 2,
    totalCost: 540,
    currency: "USD",
    notes: "Order received and stocked.",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "spare-order-demo-latere-006",
    vesselCode: "LATERE",
    orderCode: "SO-0006",
    status: "CANCELLED",
    priority: "LOW",
    providerId: "provider-demo-latere-spares-002",
    requestedByUserId: createdByUserId,
    requestedAt: "2026-03-12T12:20:00.000Z",
    expectedDeliveryDate: "2026-03-25",
    totalLines: 1,
    totalCost: 180,
    currency: "USD",
    notes: "Cancelled due to alternate stock availability.",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
];

const DEV_INSPECTIONS: DevInspectionRecord[] = [
  {
    tenantSlug: "demo",
    id: "inspection-demo-latere-001",
    vesselCode: "LATERE",
    assetId: "asset-demo-latere-main-engine-port",
    inspectionCode: "INSP-0001",
    type: "TECHNICAL",
    status: "COMPLETED",
    result: "CONDITIONAL",
    providerId: "provider-demo-latere-engine-001",
    scheduledAt: "2026-04-03T09:00:00.000Z",
    completedAt: "2026-04-03T13:20:00.000Z",
    inspectorName: "Laura Perez",
    notes: "Conditionally accepted; monitor injector line sealing.",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "inspection-demo-latere-002",
    vesselCode: "LATERE",
    assetId: "asset-demo-latere-main-engine-starboard",
    inspectionCode: "INSP-0002",
    type: "SAFETY",
    status: "COMPLETED",
    result: "FAIL",
    providerId: "provider-demo-latere-engine-001",
    scheduledAt: "2026-04-08T08:30:00.000Z",
    completedAt: "2026-04-08T11:10:00.000Z",
    inspectorName: "Laura Perez",
    notes: "Cooling pressure instability triggered fail.",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "inspection-demo-glt-003",
    vesselCode: "GLT001",
    assetId: "asset-demo-glt-generator-a",
    inspectionCode: "INSP-0003",
    type: "REGULATORY",
    status: "COMPLETED",
    result: "PASS",
    providerId: "provider-demo-glt-inspection-004",
    scheduledAt: "2026-03-25T10:00:00.000Z",
    completedAt: "2026-03-25T15:30:00.000Z",
    inspectorName: "Haruto Sato",
    notes: "Regulatory inspection passed without findings.",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "inspection-demo-glt-004",
    vesselCode: "GLT001",
    assetId: "asset-demo-glt-generator-a",
    inspectionCode: "INSP-0004",
    type: "TECHNICAL",
    status: "IN_PROGRESS",
    providerId: "provider-demo-glt-electrical-003",
    scheduledAt: "2026-04-12T07:30:00.000Z",
    inspectorName: "Sofia Mendes",
    notes: "Alarm circuit redundancy review in progress.",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "inspection-demo-latere-005",
    vesselCode: "LATERE",
    inspectionCode: "INSP-0005",
    type: "CLASS",
    status: "SCHEDULED",
    providerId: "provider-demo-latere-spares-002",
    scheduledAt: "2026-04-20T09:00:00.000Z",
    inspectorName: "Gaston Ruiz",
    notes: "Class survey scheduled with dock visit.",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "inspection-demo-glt-006",
    vesselCode: "GLT001",
    inspectionCode: "INSP-0006",
    type: "SAFETY",
    status: "CANCELLED",
    providerId: "provider-demo-glt-inspection-004",
    scheduledAt: "2026-03-18T10:00:00.000Z",
    inspectorName: "Haruto Sato",
    notes: "Cancelled due to reschedule request.",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
];

const DEV_CERTIFICATES: DevCertificateRecord[] = [
  {
    tenantSlug: "demo",
    id: "cert-demo-latere-safety-001",
    vesselCode: "LATERE",
    certificateCode: "CERT-0001",
    name: "Safety Management Certificate",
    issuingAuthority: "Class Authority",
    status: "ACTIVE",
    issueDate: "2025-06-01",
    expiryDate: "2027-06-01",
    lastInspectionDate: "2026-03-15",
    notes: "Annual review completed.",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "cert-demo-latere-class-002",
    vesselCode: "LATERE",
    certificateCode: "CERT-0002",
    name: "Hull Classification Certificate",
    issuingAuthority: "Class Authority",
    status: "EXPIRING_SOON",
    issueDate: "2021-05-10",
    expiryDate: "2026-05-08",
    lastInspectionDate: "2025-05-02",
    notes: "Renewal survey scheduled.",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "cert-demo-glt-regulatory-003",
    vesselCode: "GLT001",
    certificateCode: "CERT-0003",
    name: "Regulatory Compliance Certificate",
    issuingAuthority: "Flag State",
    status: "EXPIRED",
    issueDate: "2022-02-01",
    expiryDate: "2026-02-01",
    lastInspectionDate: "2024-02-01",
    notes: "Expired; renewal pending.",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "cert-demo-glt-suspended-004",
    vesselCode: "GLT001",
    assetId: "asset-demo-glt-generator-a",
    certificateCode: "CERT-0004",
    name: "Generator Compliance Certificate",
    issuingAuthority: "Flag State",
    status: "SUSPENDED",
    issueDate: "2024-08-20",
    expiryDate: "2027-08-20",
    lastInspectionDate: "2026-04-01",
    notes: "Suspended pending inspection findings closure.",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "cert-demo-latere-closed-005",
    vesselCode: "LATERE",
    certificateCode: "CERT-0005",
    name: "Legacy Equipment Certificate",
    issuingAuthority: "Legacy Authority",
    status: "CLOSED",
    issueDate: "2019-01-15",
    expiryDate: "2024-01-15",
    lastInspectionDate: "2023-01-10",
    notes: "Retired equipment; certificate closed.",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
];

const DEV_DAILY_REPORTS: DevDailyReportRecord[] = [
  {
    tenantSlug: "demo",
    id: "daily-report-demo-latere-2026-04-12",
    vesselCode: "LATERE",
    reportDate: "2026-04-12",
    status: "SUBMITTED",
    summary: "Port engine operated with reduced load; monitoring continued.",
    positionLat: -34.9033,
    positionLon: -56.1639,
    engineHoursMain: 11520,
    generatorHours: 3240,
    fuelConsumedLiters: 1450,
    notes: "Awaiting turbocharger inspection slot confirmation.",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "daily-report-demo-latere-2026-04-11",
    vesselCode: "LATERE",
    reportDate: "2026-04-11",
    status: "REVIEWED",
    summary: "Cooling system restrictions in place; corrective work ongoing.",
    positionLat: -34.9061,
    positionLon: -56.1915,
    engineHoursMain: 11502,
    generatorHours: 3232,
    fuelConsumedLiters: 1520,
    notes: "Maintenance manager reviewed and approved compensatory measures.",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "daily-report-demo-glt-2026-04-12",
    vesselCode: "GLT001",
    reportDate: "2026-04-12",
    status: "DRAFT",
    summary: "Generator A alarm circuit review in progress.",
    positionLat: -23.9587,
    positionLon: -46.3336,
    engineHoursMain: 8420,
    generatorHours: 2788,
    fuelConsumedLiters: 980,
    notes: "Awaiting inspection results before final submission.",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "daily-report-demo-glt-2026-04-10",
    vesselCode: "GLT001",
    reportDate: "2026-04-10",
    status: "CLOSED",
    summary: "Routine operations; no new defects reported.",
    positionLat: -23.9525,
    positionLon: -46.3282,
    engineHoursMain: 8410,
    generatorHours: 2779,
    fuelConsumedLiters: 910,
    notes: "Closed after compliance review.",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
];

const DEV_ATTACHMENTS: DevAttachmentRecord[] = [
  {
    tenantSlug: "demo",
    id: "attachment-demo-defect-001",
    vesselCode: "LATERE",
    targetType: "DEFECT",
    targetId: "def-demo-latere-port-engine-001",
    filename: "injector-line-leak.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 284512,
    status: "ACTIVE",
    uploadedAt: "2026-04-10T10:05:00.000Z",
    uploadedByUserId: createdByUserId,
    description: "Photo of injector line leak during startup check.",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "attachment-demo-workorder-002",
    vesselCode: "LATERE",
    targetType: "WORK_ORDER",
    targetId: "wo-demo-latere-port-engine-004",
    filename: "work-order-ot-0004.pdf",
    mimeType: "application/pdf",
    sizeBytes: 512000,
    status: "ACTIVE",
    uploadedAt: "2026-03-29T09:20:00.000Z",
    uploadedByUserId: createdByUserId,
    description: "Deferred corrective work order report.",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "attachment-demo-inspection-003",
    vesselCode: "GLT001",
    targetType: "INSPECTION",
    targetId: "inspection-demo-glt-003",
    filename: "inspection-regulatory-report.pdf",
    mimeType: "application/pdf",
    sizeBytes: 764112,
    status: "ACTIVE",
    uploadedAt: "2026-03-25T16:30:00.000Z",
    uploadedByUserId: createdByUserId,
    description: "Regulatory inspection report and checklist.",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "attachment-demo-certificate-004",
    vesselCode: "LATERE",
    targetType: "CERTIFICATE",
    targetId: "cert-demo-latere-class-002",
    filename: "class-certificate-renewal.pdf",
    mimeType: "application/pdf",
    sizeBytes: 633288,
    status: "ACTIVE",
    uploadedAt: "2026-04-02T12:10:00.000Z",
    uploadedByUserId: createdByUserId,
    description: "Draft renewal certificate package.",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "attachment-demo-rca-005",
    vesselCode: "LATERE",
    targetType: "RCA",
    targetId: "rca-demo-latere-starboard-engine-002",
    filename: "rca-fishbone.png",
    mimeType: "image/png",
    sizeBytes: 142881,
    status: "ACTIVE",
    uploadedAt: "2026-04-12T19:05:00.000Z",
    uploadedByUserId: createdByUserId,
    description: "Fishbone diagram capture.",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "attachment-demo-daily-report-006",
    vesselCode: "GLT001",
    targetType: "DAILY_REPORT",
    targetId: "daily-report-demo-glt-2026-04-10",
    filename: "daily-report-2026-04-10.pdf",
    mimeType: "application/pdf",
    sizeBytes: 388200,
    status: "ARCHIVED",
    uploadedAt: "2026-04-10T23:45:00.000Z",
    uploadedByUserId: createdByUserId,
    description: "Closed daily report archive.",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
];

const DEV_INSPECTION_LOGS: DevInspectionLogRecord[] = [
  {
    tenantSlug: "demo",
    id: "inspection-log-demo-latere-001",
    vesselCode: "LATERE",
    inspectionId: "inspection-demo-latere-001",
    logCode: "ILOG-0001",
    entryType: "FINDING",
    severity: "MEDIUM",
    observedAt: "2026-04-03T10:05:00.000Z",
    summary: "Injector line seal showing early wear; minor seepage noted.",
    recommendation: "Replace seal kit at next port; monitor seepage daily.",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "inspection-log-demo-latere-002",
    vesselCode: "LATERE",
    inspectionId: "inspection-demo-latere-002",
    logCode: "ILOG-0002",
    entryType: "FINDING",
    severity: "CRITICAL",
    observedAt: "2026-04-08T09:40:00.000Z",
    summary: "Cooling pressure dropped below safe threshold during load test.",
    recommendation: "Restrict load and initiate corrective work order.",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "inspection-log-demo-glt-003",
    vesselCode: "GLT001",
    inspectionId: "inspection-demo-glt-003",
    logCode: "ILOG-0003",
    entryType: "NOTE",
    severity: "LOW",
    observedAt: "2026-03-25T12:15:00.000Z",
    summary: "Regulatory checklist completed; documentation verified onboard.",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "inspection-log-demo-glt-004",
    vesselCode: "GLT001",
    inspectionId: "inspection-demo-glt-004",
    logCode: "ILOG-0004",
    entryType: "ACTION",
    severity: "HIGH",
    observedAt: "2026-04-12T08:10:00.000Z",
    summary: "Alarm circuit test initiated; redundancy checks ongoing.",
    recommendation: "Document voltage readings and update wiring diagram.",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "inspection-log-demo-latere-005",
    vesselCode: "LATERE",
    inspectionId: "inspection-demo-latere-005",
    logCode: "ILOG-0005",
    entryType: "NOTE",
    severity: "LOW",
    observedAt: "2026-04-20T09:20:00.000Z",
    summary: "Class survey kickoff meeting held; initial checklist reviewed.",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "inspection-log-demo-glt-006",
    vesselCode: "GLT001",
    inspectionId: "inspection-demo-glt-006",
    logCode: "ILOG-0006",
    entryType: "ACTION",
    severity: "MEDIUM",
    observedAt: "2026-03-18T09:45:00.000Z",
    summary: "Inspection rescheduled; notify crew and update calendar.",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
];

const DEV_STOCK_MOVEMENTS: DevStockMovementRecord[] = [
  {
    tenantSlug: "demo",
    id: "stock-movement-demo-latere-001",
    vesselCode: "LATERE",
    spareId: "spare-demo-latere-thermostat-003",
    movementCode: "SM-0001",
    movementType: "RECEIPT",
    quantity: 2,
    unit: "pcs",
    occurredAt: "2026-04-12T15:30:00.000Z",
    referenceType: "SPARE_REQUEST",
    referenceId: "spare-order-demo-latere-001",
    notes: "Thermostat delivery received.",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "stock-movement-demo-latere-002",
    vesselCode: "LATERE",
    spareId: "spare-demo-latere-injector-seal-001",
    movementCode: "SM-0002",
    movementType: "ISSUE",
    quantity: 1,
    unit: "kit",
    occurredAt: "2026-04-10T12:10:00.000Z",
    referenceType: "WORK_ORDER",
    referenceId: "wo-demo-latere-port-engine-004",
    notes: "Issued seal kit for injector line inspection.",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "stock-movement-demo-latere-003",
    vesselCode: "LATERE",
    spareId: "spare-demo-latere-oil-filter-002",
    movementCode: "SM-0003",
    movementType: "ISSUE",
    quantity: 2,
    unit: "pcs",
    occurredAt: "2026-04-05T08:45:00.000Z",
    referenceType: "WORK_ORDER",
    referenceId: "wo-demo-latere-port-engine-001",
    notes: "Issued filters for scheduled maintenance.",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "stock-movement-demo-glt-004",
    vesselCode: "GLT001",
    spareId: "spare-demo-glt-alarm-lamp-004",
    movementCode: "SM-0004",
    movementType: "TRANSFER",
    quantity: 4,
    unit: "pcs",
    occurredAt: "2026-04-11T09:20:00.000Z",
    referenceType: "ADJUSTMENT",
    referenceId: "transfer-demo-glt-001",
    notes: "Transferred lamps to onboard locker.",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "stock-movement-demo-glt-005",
    vesselCode: "GLT001",
    spareId: "spare-demo-glt-ground-strap-005",
    movementCode: "SM-0005",
    movementType: "RECEIPT",
    quantity: 6,
    unit: "pcs",
    occurredAt: "2026-03-28T14:05:00.000Z",
    referenceType: "SPARE_REQUEST",
    referenceId: "spare-order-demo-glt-004",
    notes: "Partial delivery received.",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "stock-movement-demo-glt-006",
    vesselCode: "GLT001",
    spareId: "spare-demo-glt-ground-strap-005",
    movementCode: "SM-0006",
    movementType: "ADJUSTMENT",
    quantity: -1,
    unit: "pcs",
    occurredAt: "2026-03-30T10:00:00.000Z",
    referenceType: "ADJUSTMENT",
    referenceId: "stock-adjustment-demo-glt-001",
    notes: "Inventory count adjustment.",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
];

const DEV_PROVIDER_EVALUATIONS: DevProviderEvaluationRecord[] = [
  {
    tenantSlug: "demo",
    id: "provider-eval-demo-latere-001",
    vesselCode: "LATERE",
    providerId: "provider-demo-latere-engine-001",
    evaluationCode: "P-EVAL-0001",
    status: "APPROVED",
    score: 92,
    rating: "A",
    evaluatedAt: "2026-03-30T12:00:00.000Z",
    evaluatorName: "Maintenance Manager",
    summary: "Strong response time and quality workmanship.",
    notes: "No corrective actions required.",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "provider-eval-demo-latere-002",
    vesselCode: "LATERE",
    providerId: "provider-demo-latere-spares-002",
    evaluationCode: "P-EVAL-0002",
    status: "SUBMITTED",
    score: 76,
    rating: "B",
    evaluatedAt: "2026-04-05T09:30:00.000Z",
    evaluatorName: "Procurement Lead",
    summary: "Delivery delays noted; documentation acceptable.",
    notes: "Follow up on lead time improvements.",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "provider-eval-demo-glt-003",
    vesselCode: "GLT001",
    providerId: "provider-demo-glt-electrical-003",
    evaluationCode: "P-EVAL-0003",
    status: "DRAFT",
    score: 68,
    rating: "C",
    evaluatedAt: "2026-04-12T16:00:00.000Z",
    evaluatorName: "Electrical Supervisor",
    summary: "Workmanship acceptable; documentation incomplete.",
    notes: "Awaiting final inspection report.",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "provider-eval-demo-glt-004",
    vesselCode: "GLT001",
    providerId: "provider-demo-glt-inspection-004",
    evaluationCode: "P-EVAL-0004",
    status: "REJECTED",
    score: 54,
    rating: "D",
    evaluatedAt: "2026-03-20T10:15:00.000Z",
    evaluatorName: "Compliance Officer",
    summary: "Inspection report late and incomplete.",
    notes: "Requires corrective action plan before reapproval.",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
];

const DEV_PROVIDER_NONCONFORMITIES: DevProviderNonconformityRecord[] = [
  {
    tenantSlug: "demo",
    id: "provider-nc-demo-latere-001",
    vesselCode: "LATERE",
    providerId: "provider-demo-latere-spares-002",
    nonconformityCode: "PNC-0001",
    status: "OPEN",
    severity: "MEDIUM",
    reportedAt: "2026-04-06T10:15:00.000Z",
    description: "Delayed delivery without notification; missing packing list.",
    correctiveAction: "Provide updated delivery schedule and documentation checklist.",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "provider-nc-demo-latere-002",
    vesselCode: "LATERE",
    providerId: "provider-demo-latere-engine-001",
    nonconformityCode: "PNC-0002",
    status: "UNDER_REVIEW",
    severity: "HIGH",
    reportedAt: "2026-04-08T14:20:00.000Z",
    description: "Service report incomplete; calibration data missing.",
    correctiveAction: "Submit complete calibration data within 48 hours.",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "provider-nc-demo-glt-003",
    vesselCode: "GLT001",
    providerId: "provider-demo-glt-electrical-003",
    nonconformityCode: "PNC-0003",
    status: "RESOLVED",
    severity: "LOW",
    reportedAt: "2026-03-30T09:50:00.000Z",
    description: "Incorrect part labeling on alarm lamps batch.",
    correctiveAction: "Relabeled batch and updated QA checklist.",
    closedAt: "2026-04-02T12:00:00.000Z",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "provider-nc-demo-glt-004",
    vesselCode: "GLT001",
    providerId: "provider-demo-glt-inspection-004",
    nonconformityCode: "PNC-0004",
    status: "CLOSED",
    severity: "CRITICAL",
    reportedAt: "2026-03-19T11:30:00.000Z",
    description: "Inspection report delivered after regulatory deadline.",
    correctiveAction: "Updated escalation and delivery SLA with provider.",
    closedAt: "2026-03-28T17:00:00.000Z",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
];

const DEV_AI_INSIGHTS: DevAiInsightRecord[] = [
  {
    tenantSlug: "demo",
    id: "ai-insight-demo-001",
    insightCode: "INS-0001",
    insightType: "stock_below_minimum",
    status: "OPEN",
    priority: "HIGH",
    targetType: "SPARE",
    targetId: "spare-demo-latere-thermostat-003",
    vesselCode: "LATERE",
    title: "Thermostat stock below minimum",
    summary: "Cooling thermostat stock is below minimum for LATERE.",
    recommendation: "Create a spare order and review lead time buffer.",
    detectedAt: "2026-04-13T08:00:00.000Z",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "ai-insight-demo-002",
    insightCode: "INS-0002",
    insightType: "certificate_expiring",
    status: "OPEN",
    priority: "MEDIUM",
    targetType: "CERTIFICATE",
    targetId: "cert-demo-latere-class-002",
    vesselCode: "LATERE",
    title: "Hull classification certificate expiring soon",
    summary: "Certificate CERT-0002 expires within 30 days.",
    recommendation: "Confirm renewal survey and upload updated documents.",
    detectedAt: "2026-04-13T08:30:00.000Z",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "ai-insight-demo-003",
    insightCode: "INS-0003",
    insightType: "inspection_failure_pattern",
    status: "OPEN",
    priority: "HIGH",
    targetType: "VESSEL",
    targetId: null,
    vesselCode: "LATERE",
    title: "Repeated inspection failures on LATERE",
    summary: "Multiple inspection failures detected within 90 days.",
    recommendation: "Review recent findings and open corrective actions.",
    detectedAt: "2026-04-13T09:10:00.000Z",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "ai-insight-demo-004",
    insightCode: "INS-0004",
    insightType: "overdue_capa",
    status: "OPEN",
    priority: "CRITICAL",
    targetType: "CAPA",
    targetId: "capa-demo-latere-starboard-engine-002",
    vesselCode: "LATERE",
    title: "Critical CAPA overdue",
    summary: "CAPA CAPA-0002 is overdue beyond the critical threshold.",
    recommendation: "Escalate and complete verification immediately.",
    detectedAt: "2026-04-13T07:45:00.000Z",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "ai-insight-demo-005",
    insightCode: "INS-0005",
    insightType: "repeated_deferral",
    status: "OPEN",
    priority: "MEDIUM",
    targetType: "ASSET",
    targetId: "asset-demo-latere-main-engine-port",
    vesselCode: "LATERE",
    title: "Repeated deferrals on main engine port",
    summary: "Multiple deferrals detected for the same asset within 90 days.",
    recommendation: "Review deferral root causes and plan corrective work.",
    detectedAt: "2026-04-13T06:30:00.000Z",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "ai-insight-demo-006",
    insightCode: "INS-0006",
    insightType: "cross_vessel_spare_availability",
    status: "OPEN",
    priority: "LOW",
    targetType: "FLEET",
    targetId: null,
    vesselCode: null,
    title: "Spare availability across fleet",
    summary: "Grounding straps are available on GLT001 while LATERE is low on critical spares.",
    recommendation: "Consider cross-vessel transfer or shared order planning.",
    detectedAt: "2026-04-13T08:20:00.000Z",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "ai-insight-demo-007",
    insightCode: "INS-0007",
    insightType: "documentation_gap",
    status: "RESOLVED",
    priority: "MEDIUM",
    targetType: "WORK_ORDER",
    targetId: "wo-demo-glt-generator-a-005",
    vesselCode: "GLT001",
    title: "Work order closed without verifier",
    summary: "OT-0005 closed without independent verifier noted.",
    recommendation: "Capture verifier signoff and evidence attachment.",
    detectedAt: "2026-04-12T12:00:00.000Z",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
];

const DEV_DOMAIN_EVENTS: DevDomainEventRecord[] = [
  {
    tenantSlug: "demo",
    id: "domain-event-demo-001",
    vesselCode: "LATERE",
    eventCode: "EVT-0001",
    category: "maintenance",
    eventType: "work_order_created",
    title: "Work order OT-0001 created",
    summary: "Preventive work order created for port engine service.",
    targetType: "WORK_ORDER",
    targetId: "wo-demo-latere-port-engine-001",
    severity: "LOW",
    occurredAt: "2026-04-10T08:15:00.000Z",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "domain-event-demo-002",
    vesselCode: "LATERE",
    eventCode: "EVT-0002",
    category: "operations",
    eventType: "defect_reported",
    title: "Defect DEF-0001 reported",
    summary: "Fuel leak observed on port main engine.",
    targetType: "DEFECT",
    targetId: "def-demo-latere-port-engine-001",
    severity: "HIGH",
    occurredAt: "2026-04-10T09:30:00.000Z",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "domain-event-demo-003",
    vesselCode: "LATERE",
    eventCode: "EVT-0003",
    category: "maintenance",
    eventType: "deferral_approved",
    title: "Deferral DFR-0002 approved",
    summary: "Work order deferral approved with target date 2026-04-30.",
    targetType: "WORK_ORDER",
    targetId: "wo-demo-latere-port-engine-004",
    severity: "MEDIUM",
    occurredAt: "2026-03-28T09:15:00.000Z",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "domain-event-demo-004",
    vesselCode: "LATERE",
    eventCode: "EVT-0004",
    category: "compliance",
    eventType: "certificate_expiring",
    title: "Certificate CERT-0002 expiring",
    summary: "Hull classification certificate expires within 30 days.",
    targetType: "CERTIFICATE",
    targetId: "cert-demo-latere-class-002",
    severity: "MEDIUM",
    occurredAt: "2026-04-13T08:30:00.000Z",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "domain-event-demo-005",
    vesselCode: "GLT001",
    eventCode: "EVT-0005",
    category: "stock",
    eventType: "stock_below_minimum",
    title: "Grounding strap stock below minimum",
    summary: "Grounding strap stock below minimum threshold on GLT001.",
    targetType: "SPARE",
    targetId: "spare-demo-glt-ground-strap-005",
    severity: "HIGH",
    occurredAt: "2026-04-13T08:00:00.000Z",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "domain-event-demo-006",
    vesselCode: "GLT001",
    eventCode: "EVT-0006",
    category: "procurement",
    eventType: "spare_order_received",
    title: "Spare order SO-0005 received",
    summary: "Order received and stocked for GLT001.",
    targetType: "SPARE_REQUEST",
    targetId: "spare-order-demo-glt-005",
    severity: "LOW",
    occurredAt: "2026-03-22T12:00:00.000Z",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
  {
    tenantSlug: "demo",
    id: "domain-event-demo-007",
    vesselCode: "LATERE",
    eventCode: "EVT-0007",
    category: "compliance",
    eventType: "inspection_failed",
    title: "Inspection INSP-0002 failed",
    summary: "Safety inspection failed due to cooling pressure instability.",
    targetType: "INSPECTION",
    targetId: "inspection-demo-latere-002",
    severity: "CRITICAL",
    occurredAt: "2026-04-08T11:10:00.000Z",
    createdAt,
    createdByUserId,
    updatedAt,
    updatedByUserId: createdByUserId,
  },
];

function canViewVessel(
  role: TenantRole,
  assignedVesselCodes: string[],
  vesselCode: string,
): boolean {
  if (role === "TENANT_ADMIN") return true;
  return assignedVesselCodes.includes(vesselCode);
}

export function listDevVesselsForTenant(
  tenantSlug: string,
  role: TenantRole,
  assignedVesselCodes: string[],
): DevVesselRecord[] {
  return DEV_VESSELS.filter(
    (item) => item.tenantSlug === tenantSlug && canViewVessel(role, assignedVesselCodes, item.code),
  );
}

export function listDevAssetsForTenant(
  tenantSlug: string,
  role: TenantRole,
  assignedVesselCodes: string[],
  vesselCode?: string | null,
): DevAssetRecord[] {
  return DEV_ASSETS.filter((item) => {
    if (item.tenantSlug !== tenantSlug) return false;
    if (!canViewVessel(role, assignedVesselCodes, item.vesselCode)) return false;
    if (vesselCode && item.vesselCode !== vesselCode) return false;
    return true;
  });
}

export function listDevMaintenancePlansForTenant(
  tenantSlug: string,
  role: TenantRole,
  assignedVesselCodes: string[],
  filters: {
    vesselCode?: string | null;
    status?: string | null;
    triggerType?: string | null;
  } = {},
): (DevMaintenancePlanRecord & { assetName: string | null })[] {
  const assetMap = new Map(DEV_ASSETS.map(a => [a.id, a.name ?? null]));
  return DEV_MAINTENANCE_PLANS
    .filter((item) => {
      if (item.tenantSlug !== tenantSlug) return false;
      if (!canViewVessel(role, assignedVesselCodes, item.vesselCode)) return false;
      if (filters.vesselCode && item.vesselCode !== filters.vesselCode) return false;
      if (filters.status && item.status !== filters.status) return false;
      if (filters.triggerType && item.triggerType !== filters.triggerType) return false;
      return true;
    })
    .map(item => ({ ...item, assetName: assetMap.get(item.assetId) ?? null }));
}

export function listDevWorkOrdersForTenant(
  tenantSlug: string,
  role: TenantRole,
  assignedVesselCodes: string[],
  filters: {
    vesselCode?: string | null;
    status?: string | null;
    type?: string | null;
  } = {},
): (DevWorkOrderRecord & { assetName: string | null; assignedToUserName: string | null })[] {
  const assetMap = new Map(DEV_ASSETS.map(a => [a.id, a.name ?? null]));
  return DEV_WORK_ORDERS.filter((item) => {
    if (item.tenantSlug !== tenantSlug) return false;
    if (!canViewVessel(role, assignedVesselCodes, item.vesselCode)) return false;
    if (filters.vesselCode && item.vesselCode !== filters.vesselCode) return false;
    if (filters.status && item.status !== filters.status) return false;
    if (filters.type && item.type !== filters.type) return false;
    return true;
  }).map(item => ({ ...item, assetName: assetMap.get(item.assetId) ?? null, assignedToUserName: null }));
}

export function listDevDefectsForTenant(
  tenantSlug: string,
  role: TenantRole,
  assignedVesselCodes: string[],
  filters: {
    vesselCode?: string | null;
    status?: string | null;
    severity?: string | null;
  } = {},
): DevDefectRecord[] {
  return DEV_DEFECTS.filter((item) => {
    if (item.tenantSlug !== tenantSlug) return false;
    if (!canViewVessel(role, assignedVesselCodes, item.vesselCode)) return false;
    if (filters.vesselCode && item.vesselCode !== filters.vesselCode) return false;
    if (filters.status && item.status !== filters.status) return false;
    if (filters.severity && item.severity !== filters.severity) return false;
    return true;
  });
}

export function listDevDeferralsForTenant(
  tenantSlug: string,
  role: TenantRole,
  assignedVesselCodes: string[],
  filters: {
    vesselCode?: string | null;
    status?: string | null;
    sourceType?: string | null;
  } = {},
): DevDeferralRecord[] {
  return DEV_DEFERRALS.filter((item) => {
    if (item.tenantSlug !== tenantSlug) return false;
    if (!canViewVessel(role, assignedVesselCodes, item.vesselCode)) return false;
    if (filters.vesselCode && item.vesselCode !== filters.vesselCode) return false;
    if (filters.status && item.status !== filters.status) return false;
    if (filters.sourceType && item.sourceType !== filters.sourceType) return false;
    return true;
  });
}

export function listDevCapasForTenant(
  tenantSlug: string,
  role: TenantRole,
  assignedVesselCodes: string[],
  filters: {
    vesselCode?: string | null;
    status?: string | null;
    priority?: string | null;
    sourceType?: string | null;
  } = {},
): DevCapaRecord[] {
  return DEV_CAPAS.filter((item) => {
    if (item.tenantSlug !== tenantSlug) return false;
    if (!canViewVessel(role, assignedVesselCodes, item.vesselCode)) return false;
    if (filters.vesselCode && item.vesselCode !== filters.vesselCode) return false;
    if (filters.status && item.status !== filters.status) return false;
    if (filters.priority && item.priority !== filters.priority) return false;
    if (filters.sourceType && item.sourceType !== filters.sourceType) return false;
    return true;
  });
}

export function listDevSparesForTenant(
  tenantSlug: string,
  role: TenantRole,
  assignedVesselCodes: string[],
  filters: {
    vesselCode?: string | null;
    status?: string | null;
    criticality?: string | null;
  } = {},
): DevSpareRecord[] {
  return DEV_SPARES.filter((item) => {
    if (item.tenantSlug !== tenantSlug) return false;
    if (!canViewVessel(role, assignedVesselCodes, item.vesselCode)) return false;
    if (filters.vesselCode && item.vesselCode !== filters.vesselCode) return false;
    if (filters.status && item.status !== filters.status) return false;
    if (filters.criticality && item.criticality !== filters.criticality) return false;
    return true;
  });
}

export function listDevProvidersForTenant(
  tenantSlug: string,
  role: TenantRole,
  assignedVesselCodes: string[],
  filters: {
    vesselCode?: string | null;
    status?: string | null;
    category?: string | null;
  } = {},
): DevProviderRecord[] {
  return DEV_PROVIDERS.filter((item) => {
    if (item.tenantSlug !== tenantSlug) return false;
    if (!canViewVessel(role, assignedVesselCodes, item.vesselCode)) return false;
    if (filters.vesselCode && item.vesselCode !== filters.vesselCode) return false;
    if (filters.status && item.status !== filters.status) return false;
    if (filters.category && item.category !== filters.category) return false;
    return true;
  });
}

export function listDevSpareOrdersForTenant(
  tenantSlug: string,
  role: TenantRole,
  assignedVesselCodes: string[],
  filters: {
    vesselCode?: string | null;
    status?: string | null;
    priority?: string | null;
  } = {},
): DevSpareOrderRecord[] {
  return DEV_SPARE_ORDERS.filter((item) => {
    if (item.tenantSlug !== tenantSlug) return false;
    if (!canViewVessel(role, assignedVesselCodes, item.vesselCode)) return false;
    if (filters.vesselCode && item.vesselCode !== filters.vesselCode) return false;
    if (filters.status && item.status !== filters.status) return false;
    if (filters.priority && item.priority !== filters.priority) return false;
    return true;
  });
}

export function listDevInspectionsForTenant(
  tenantSlug: string,
  role: TenantRole,
  assignedVesselCodes: string[],
  filters: {
    vesselCode?: string | null;
    status?: string | null;
    result?: string | null;
    type?: string | null;
  } = {},
): DevInspectionRecord[] {
  return DEV_INSPECTIONS.filter((item) => {
    if (item.tenantSlug !== tenantSlug) return false;
    if (!canViewVessel(role, assignedVesselCodes, item.vesselCode)) return false;
    if (filters.vesselCode && item.vesselCode !== filters.vesselCode) return false;
    if (filters.status && item.status !== filters.status) return false;
    if (filters.result && item.result !== filters.result) return false;
    if (filters.type && item.type !== filters.type) return false;
    return true;
  });
}

export function listDevCertificatesForTenant(
  tenantSlug: string,
  role: TenantRole,
  assignedVesselCodes: string[],
  filters: {
    vesselCode?: string | null;
    status?: string | null;
  } = {},
): DevCertificateRecord[] {
  return DEV_CERTIFICATES.filter((item) => {
    if (item.tenantSlug !== tenantSlug) return false;
    if (!canViewVessel(role, assignedVesselCodes, item.vesselCode)) return false;
    if (filters.vesselCode && item.vesselCode !== filters.vesselCode) return false;
    if (filters.status && item.status !== filters.status) return false;
    return true;
  });
}

export function listDevDailyReportsForTenant(
  tenantSlug: string,
  role: TenantRole,
  assignedVesselCodes: string[],
  filters: {
    vesselCode?: string | null;
    status?: string | null;
    reportDate?: string | null;
  } = {},
): DevDailyReportRecord[] {
  return DEV_DAILY_REPORTS.filter((item) => {
    if (item.tenantSlug !== tenantSlug) return false;
    if (!canViewVessel(role, assignedVesselCodes, item.vesselCode)) return false;
    if (filters.vesselCode && item.vesselCode !== filters.vesselCode) return false;
    if (filters.status && item.status !== filters.status) return false;
    if (filters.reportDate && item.reportDate !== filters.reportDate) return false;
    return true;
  });
}

export function listDevAttachmentsForTenant(
  tenantSlug: string,
  role: TenantRole,
  assignedVesselCodes: string[],
  filters: {
    vesselCode?: string | null;
    status?: string | null;
    targetType?: string | null;
  } = {},
): DevAttachmentRecord[] {
  return DEV_ATTACHMENTS.filter((item) => {
    if (item.tenantSlug !== tenantSlug) return false;
    if (!canViewVessel(role, assignedVesselCodes, item.vesselCode)) return false;
    if (filters.vesselCode && item.vesselCode !== filters.vesselCode) return false;
    if (filters.status && item.status !== filters.status) return false;
    if (filters.targetType && item.targetType !== filters.targetType) return false;
    return true;
  });
}

export function listDevInspectionLogsForTenant(
  tenantSlug: string,
  role: TenantRole,
  assignedVesselCodes: string[],
  filters: {
    vesselCode?: string | null;
    inspectionId?: string | null;
    entryType?: string | null;
    severity?: string | null;
  } = {},
): DevInspectionLogRecord[] {
  return DEV_INSPECTION_LOGS.filter((item) => {
    if (item.tenantSlug !== tenantSlug) return false;
    if (!canViewVessel(role, assignedVesselCodes, item.vesselCode)) return false;
    if (filters.vesselCode && item.vesselCode !== filters.vesselCode) return false;
    if (filters.inspectionId && item.inspectionId !== filters.inspectionId) return false;
    if (filters.entryType && item.entryType !== filters.entryType) return false;
    if (filters.severity && item.severity !== filters.severity) return false;
    return true;
  });
}

export function listDevStockMovementsForTenant(
  tenantSlug: string,
  role: TenantRole,
  assignedVesselCodes: string[],
  filters: {
    vesselCode?: string | null;
    movementType?: string | null;
    spareId?: string | null;
  } = {},
): DevStockMovementRecord[] {
  return DEV_STOCK_MOVEMENTS.filter((item) => {
    if (item.tenantSlug !== tenantSlug) return false;
    if (!canViewVessel(role, assignedVesselCodes, item.vesselCode)) return false;
    if (filters.vesselCode && item.vesselCode !== filters.vesselCode) return false;
    if (filters.movementType && item.movementType !== filters.movementType) return false;
    if (filters.spareId && item.spareId !== filters.spareId) return false;
    return true;
  });
}

export function listDevProviderEvaluationsForTenant(
  tenantSlug: string,
  role: TenantRole,
  assignedVesselCodes: string[],
  filters: {
    vesselCode?: string | null;
    status?: string | null;
    rating?: string | null;
  } = {},
): DevProviderEvaluationRecord[] {
  return DEV_PROVIDER_EVALUATIONS.filter((item) => {
    if (item.tenantSlug !== tenantSlug) return false;
    if (!canViewVessel(role, assignedVesselCodes, item.vesselCode)) return false;
    if (filters.vesselCode && item.vesselCode !== filters.vesselCode) return false;
    if (filters.status && item.status !== filters.status) return false;
    if (filters.rating && item.rating !== filters.rating) return false;
    return true;
  });
}

// NCRs son fleet-wide: cualquier usuario del tenant las ve. Solo se filtra
// por vessel si el caller lo pide explícitamente (acotar la vista).
export function listDevProviderNonconformitiesForTenant(
  tenantSlug: string,
  filters: {
    vesselCode?: string | null;
    status?: string | null;
    severity?: string | null;
  } = {},
): DevProviderNonconformityRecord[] {
  return DEV_PROVIDER_NONCONFORMITIES.filter((item) => {
    if (item.tenantSlug !== tenantSlug) return false;
    if (filters.vesselCode && item.vesselCode !== filters.vesselCode) return false;
    if (filters.status && item.status !== filters.status) return false;
    if (filters.severity && item.severity !== filters.severity) return false;
    return true;
  });
}

export function listDevAiInsightsForTenant(
  tenantSlug: string,
  filters: {
    vesselCode?: string | null;
    status?: string | null;
    insightType?: string | null;
    targetType?: string | null;
  } = {},
): DevAiInsightRecord[] {
  return DEV_AI_INSIGHTS.filter((item) => {
    if (item.tenantSlug !== tenantSlug) return false;
    if (filters.vesselCode && item.vesselCode !== filters.vesselCode) return false;
    if (filters.status && item.status !== filters.status) return false;
    if (filters.insightType && item.insightType !== filters.insightType) return false;
    if (filters.targetType && item.targetType !== filters.targetType) return false;
    return true;
  });
}

export function listDevDomainEventsForTenant(
  tenantSlug: string,
  role: TenantRole,
  assignedVesselCodes: string[],
  filters: {
    vesselCode?: string | null;
    category?: string | null;
    eventType?: string | null;
  } = {},
): DevDomainEventRecord[] {
  return DEV_DOMAIN_EVENTS.filter((item) => {
    if (item.tenantSlug !== tenantSlug) return false;
    if (!canViewVessel(role, assignedVesselCodes, item.vesselCode)) return false;
    if (filters.vesselCode && item.vesselCode !== filters.vesselCode) return false;
    if (filters.category && item.category !== filters.category) return false;
    if (filters.eventType && item.eventType !== filters.eventType) return false;
    return true;
  });
}
