export type DevAuditActorType = "PLATFORM_USER" | "TENANT_USER" | "SYSTEM";

export interface DevAuditEventRecord {
  id: string;
  tenantSlug?: string | null;
  actorType: DevAuditActorType;
  actorUserId?: string | null;
  actorPlatformUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

const DEV_AUDIT_EVENTS: DevAuditEventRecord[] = [
  {
    id: "audit-demo-001",
    tenantSlug: "operations",
    actorType: "PLATFORM_USER",
    actorPlatformUserId: "dev-platform-user-admin",
    action: "TENANT_CREATED",
    entityType: "TENANT",
    entityId: "dev-tenant-operations",
    metadata: { source: "platform" },
    createdAt: "2026-04-02T10:15:00.000Z",
  },
  {
    id: "audit-demo-002",
    tenantSlug: "demo",
    actorType: "PLATFORM_USER",
    actorPlatformUserId: "dev-platform-user-admin",
    action: "TENANT_UPDATED",
    entityType: "TENANT_SETTING",
    entityId: "dev-tenant-demo",
    metadata: { field: "primaryColor", value: "#2563eb" },
    createdAt: "2026-04-10T09:40:00.000Z",
  },
  {
    id: "audit-demo-003",
    tenantSlug: "demo",
    actorType: "TENANT_USER",
    actorUserId: "dev-tenant-user-demo-admin",
    action: "DEFECT_REPORTED",
    entityType: "DEFECT",
    entityId: "def-demo-latere-port-engine-001",
    metadata: { severity: "HIGH" },
    createdAt: "2026-04-10T09:35:00.000Z",
  },
  {
    id: "audit-demo-004",
    tenantSlug: "demo",
    actorType: "SYSTEM",
    action: "CERTIFICATE_EXPIRED",
    entityType: "CERTIFICATE",
    entityId: "cert-demo-glt-regulatory-003",
    metadata: { expiryDate: "2026-02-01" },
    createdAt: "2026-04-01T00:05:00.000Z",
  },
  {
    id: "audit-demo-005",
    tenantSlug: null,
    actorType: "PLATFORM_USER",
    actorPlatformUserId: "dev-platform-user-admin",
    action: "PLATFORM_USER_CREATED",
    entityType: "PLATFORM_USER",
    entityId: "dev-platform-user-admin",
    metadata: { role: "SUPERADMIN" },
    createdAt: "2026-04-01T00:00:00.000Z",
  },
  {
    id: "audit-demo-006",
    tenantSlug: "demo",
    actorType: "SYSTEM",
    action: "AI_INSIGHT_CREATED",
    entityType: "AI_INSIGHT",
    entityId: "ai-insight-demo-001",
    metadata: { insightType: "stock_below_minimum" },
    createdAt: "2026-04-13T08:00:00.000Z",
  },
];

export interface DevAuditEventListFilters {
  tenantSlug?: string | null;
  actorType?: string | null;
  action?: string | null;
  entityType?: string | null;
}

export function listDevAuditEvents(filters: DevAuditEventListFilters = {}): DevAuditEventRecord[] {
  return DEV_AUDIT_EVENTS.filter((event) => {
    if (filters.tenantSlug && event.tenantSlug !== filters.tenantSlug) return false;
    if (filters.actorType && event.actorType !== filters.actorType) return false;
    if (filters.action && event.action !== filters.action) return false;
    if (filters.entityType && event.entityType !== filters.entityType) return false;
    return true;
  });
}
