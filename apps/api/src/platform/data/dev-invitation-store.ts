import { randomBytes } from "node:crypto";
import type { LocaleCode, TenantRole } from "@cms3/shared-types";

export type DevInvitationStatus = "INVITED" | "ACCEPTED" | "EXPIRED" | "REVOKED";

export interface DevInvitationRecord {
  id: string;
  tenantSlug: string;
  email: string;
  role: TenantRole;
  locale: LocaleCode;
  status: DevInvitationStatus;
  token: string;
  createdAt: string;
  expiresAt: string;
  acceptedAt?: string | null;
  acceptedByUserId?: string | null;
  revokedAt?: string | null;
}

const DEV_INVITATIONS: DevInvitationRecord[] = [
  {
    id: "invite-demo-001",
    tenantSlug: "demo",
    email: "chief.engineer@demo.local",
    role: "MAINTENANCE_MANAGER",
    locale: "es",
    status: "INVITED",
    token: "invite-demo-token-001",
    createdAt: "2026-04-10T12:00:00.000Z",
    expiresAt: "2026-04-17T12:00:00.000Z",
  },
  {
    id: "invite-demo-002",
    tenantSlug: "operations",
    email: "auditor@operations.local",
    role: "AUDITOR_READONLY",
    locale: "en",
    status: "ACCEPTED",
    token: "invite-demo-token-002",
    createdAt: "2026-04-01T09:00:00.000Z",
    expiresAt: "2026-04-08T09:00:00.000Z",
    acceptedAt: "2026-04-02T11:30:00.000Z",
    acceptedByUserId: "dev-tenant-user-demo-admin",
  },
];

export interface DevInvitationListFilters {
  status?: string | null;
  email?: string | null;
}

export interface DevInvitationCreateInput {
  tenantSlug: string;
  email: string;
  role: TenantRole;
  locale: LocaleCode;
}

export function listDevInvitations(
  tenantSlug: string,
  filters: DevInvitationListFilters = {},
): DevInvitationRecord[] {
  return DEV_INVITATIONS.filter((invite) => {
    if (invite.tenantSlug !== tenantSlug) return false;
    if (filters.status && invite.status !== filters.status) return false;
    if (filters.email && invite.email !== filters.email) return false;
    return true;
  });
}

export function getDevInvitationById(id: string): DevInvitationRecord | null {
  return DEV_INVITATIONS.find((invite) => invite.id === id) || null;
}

export function getDevInvitationByToken(token: string): DevInvitationRecord | null {
  return DEV_INVITATIONS.find((invite) => invite.token === token) || null;
}

export function createDevInvitation(input: DevInvitationCreateInput): DevInvitationRecord {
  const existing = DEV_INVITATIONS.find(
    (invite) =>
      invite.tenantSlug === input.tenantSlug &&
      invite.email === input.email &&
      invite.status === "INVITED" &&
      new Date(invite.expiresAt) > new Date(),
  );
  if (existing) {
    throw new Error("INVITATION_ALREADY_EXISTS");
  }

  const now = new Date();
  const token = `invite-${randomBytes(16).toString("hex")}`;
  const record: DevInvitationRecord = {
    id: `invite-${input.tenantSlug}-${token.slice(-8)}`,
    tenantSlug: input.tenantSlug,
    email: input.email,
    role: input.role,
    locale: input.locale,
    status: "INVITED",
    token,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  };
  DEV_INVITATIONS.push(record);
  return record;
}

export function acceptDevInvitation(token: string, userId: string): DevInvitationRecord | null {
  const record = getDevInvitationByToken(token);
  if (!record) return null;
  const now = new Date();
  if (new Date(record.expiresAt) <= now) {
    record.status = "EXPIRED";
    return record;
  }
  record.status = "ACCEPTED";
  record.acceptedAt = now.toISOString();
  record.acceptedByUserId = userId;
  return record;
}
