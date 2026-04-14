export interface VesselRecord {
  tenantSlug: string;
  code: string;
  name: string;
  status: "ACTIVE" | "INACTIVE";
  createdAt: string;
  createdByUserId: string;
  updatedAt: string;
  updatedByUserId: string;
}

export interface AssetRecord {
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

export interface MaintenancePlanRecord {
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
  evidenceRequired?: string;
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

export interface WorkOrderRecord {
  tenantSlug: string;
  id: string;
  vesselCode: string;
  assetId?: string;
  planId?: string;
  woNumber: string;
  title: string;
  description?: string;
  type: "PREVENTIVE" | "CORRECTIVE" | "IMPROVEMENT" | "INSPECTION";
  priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  status: "PENDING" | "ASSIGNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  assignedTo?: string;
  scheduledDate?: string;
  completedDate?: string;
  estimatedHours?: number;
  actualHours?: number;
  createdAt: string;
  createdByUserId: string;
  updatedAt: string;
  updatedByUserId: string;
}

export interface DefectRecord {
  tenantSlug: string;
  id: string;
  vesselCode: string;
  assetId?: string;
  defectNumber: string;
  title: string;
  description?: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  status: "OPEN" | "IN_PROGRESS" | "PENDING_PARTS" | "CLOSED" | "DEFERRED";
  reportedBy?: string;
  reportedDate?: string;
  closedDate?: string;
  createdAt: string;
  createdByUserId: string;
  updatedAt: string;
  updatedByUserId: string;
}

export interface DeferralRecord {
  tenantSlug: string;
  id: string;
  vesselCode: string;
  assetId?: string;
  defectId?: string;
  deferralNumber: string;
  title: string;
  description?: string;
  sourceType: "DEFECT" | "INSPECTION" | "CERTIFICATE" | "OTHER";
  status: "ACTIVE" | "PENDING_REVIEW" | "CLOSED";
  reason: string;
  targetDate?: string;
  approvedBy?: string;
  approvedDate?: string;
  createdAt: string;
  createdByUserId: string;
  updatedAt: string;
  updatedByUserId: string;
}

export interface DailyReportRecord {
  tenantSlug: string;
  id: string;
  vesselCode: string;
  reportDate: string;
  reportNumber: string;
  weather?: string;
  seaCondition?: string;
  activities: string[];
  incidents?: string;
  notes?: string;
  createdBy?: string;
  createdAt: string;
  createdByUserId: string;
  updatedAt: string;
  updatedByUserId: string;
}

export interface AiInsightRecord {
  tenantSlug: string;
  id: string;
  type: string;
  category: "MAINTENANCE" | "SAFETY" | "COMPLIANCE" | "EFFICIENCY" | "RELIABILITY";
  priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  status: "NEW" | "REVIEWED" | "DISMISSED" | "ACTIONED";
  title: string;
  description: string;
  vesselCode?: string;
  assetId?: string;
  recommendation?: string;
  createdAt: string;
  createdByUserId: string;
  updatedAt: string;
  updatedByUserId: string;
}

export interface ApiResponse<T> {
  items: T[];
  total: number;
}