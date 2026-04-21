export interface AuditPayload {
  tenantId: string;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
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
