export interface AuditPayload {
  tenantId: string;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata?: Record<string, unknown>;
}

export interface PlatformAuditPayload {
  actorPlatformUserId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  tenantId?: string | null;
  metadata?: Record<string, unknown>;
}

type AuditClient = {
  auditEvent: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
};

export async function publishAudit(prisma: AuditClient, payload: AuditPayload): Promise<void> {
  try {
    await prisma.auditEvent.create({
      data: {
        tenantId: payload.tenantId,
        actorType: "TENANT_USER",
        actorUserId: payload.actorUserId,
        action: payload.action,
        entityType: payload.entityType,
        entityId: payload.entityId,
        metadata: (payload.metadata ?? {}) as object,
      },
    });
  } catch {
    // non-fatal — audit failures must never break business operations
  }
}

export async function publishPlatformAudit(prisma: AuditClient, payload: PlatformAuditPayload): Promise<void> {
  try {
    await prisma.auditEvent.create({
      data: {
        tenantId: payload.tenantId ?? null,
        actorType: "PLATFORM_USER",
        actorPlatformUserId: payload.actorPlatformUserId,
        action: payload.action,
        entityType: payload.entityType,
        entityId: payload.entityId,
        metadata: (payload.metadata ?? {}) as object,
      },
    });
  } catch {
    // non-fatal — audit failures must never break business operations
  }
}

export async function publishSystemAudit(prisma: AuditClient, payload: Omit<PlatformAuditPayload, "actorPlatformUserId">): Promise<void> {
  try {
    await prisma.auditEvent.create({
      data: {
        tenantId: payload.tenantId ?? null,
        actorType: "SYSTEM",
        action: payload.action,
        entityType: payload.entityType,
        entityId: payload.entityId,
        metadata: (payload.metadata ?? {}) as object,
      },
    });
  } catch {
    // non-fatal — audit failures must never break business operations
  }
}
