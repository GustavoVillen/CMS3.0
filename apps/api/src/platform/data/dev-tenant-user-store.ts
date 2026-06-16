import type { LocaleCode, TenantRole } from "@cms3/shared-types";

export type DevTenantUserStatus = "INVITED" | "ACTIVE" | "SUSPENDED" | "DISABLED";
export type DevMembershipStatus = "INVITED" | "ACTIVE" | "SUSPENDED" | "REVOKED";

export interface DevTenantUserRecord {
  id: string;
  tenantSlug: string;
  email: string;
  legacyUserId: string;
  passwordHash: string;
  preferredLocale: LocaleCode;
  firstName: string;
  lastName: string;
  role: TenantRole;
  assignedVesselCodes: string[];
  userStatus: DevTenantUserStatus;
  membershipStatus: DevMembershipStatus;
  createdAt: string;
  updatedAt: string;
}

const DEV_TENANT_USERS: DevTenantUserRecord[] = [
  {
    tenantSlug: "demo",
    id: "dev-tenant-user-demo-admin",
    email: "admin@demo.local",
    legacyUserId: "DEMOADMIN",
    passwordHash: "plain$Mercurio26",
    preferredLocale: "es",
    firstName: "Demo",
    lastName: "Admin",
    role: "TENANT_ADMIN",
    assignedVesselCodes: ["LATERE", "GLT001"],
    userStatus: "ACTIVE",
    membershipStatus: "ACTIVE",
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-13T00:00:00.000Z",
  },
];

export interface DevTenantUserCreateInput {
  tenantSlug: string;
  email: string;
  legacyUserId?: string | null;
  passwordHash: string;
  preferredLocale: LocaleCode;
  firstName: string;
  lastName: string;
  role: TenantRole;
  assignedVesselCodes: string[];
  userStatus: DevTenantUserStatus;
  membershipStatus: DevMembershipStatus;
}

export interface DevTenantUserUpdateInput {
  email?: string;
  legacyUserId?: string | null;
  passwordHash?: string;
  preferredLocale?: LocaleCode;
  firstName?: string;
  lastName?: string;
  role?: TenantRole;
  assignedVesselCodes?: string[];
  userStatus?: DevTenantUserStatus;
  membershipStatus?: DevMembershipStatus;
}

export function listDevTenantUsers(filters: {
  tenantSlug?: string | null;
  userStatus?: string | null;
  membershipStatus?: string | null;
  role?: string | null;
  email?: string | null;
} = {}): DevTenantUserRecord[] {
  return DEV_TENANT_USERS.filter((user) => {
    if (filters.tenantSlug && user.tenantSlug !== filters.tenantSlug) return false;
    if (filters.userStatus && user.userStatus !== filters.userStatus) return false;
    if (filters.membershipStatus && user.membershipStatus !== filters.membershipStatus) return false;
    if (filters.role && user.role !== filters.role) return false;
    if (filters.email && user.email !== filters.email) return false;
    return true;
  });
}

export function getDevTenantUserById(id: string): DevTenantUserRecord | null {
  return DEV_TENANT_USERS.find((user) => user.id === id) || null;
}

export function getDevTenantUserByIdentifier(tenantSlug: string, identifier: string): DevTenantUserRecord | null {
  return (
    DEV_TENANT_USERS.find(
      (user) =>
        user.tenantSlug === tenantSlug &&
        (user.email === identifier || user.legacyUserId === identifier),
    ) || null
  );
}

export function getDevTenantUserByEmail(email: string): DevTenantUserRecord | null {
  return DEV_TENANT_USERS.find((user) => user.email === email) || null;
}

export function getDevTenantUserByLegacyId(legacyUserId: string): DevTenantUserRecord | null {
  return DEV_TENANT_USERS.find((user) => user.legacyUserId === legacyUserId) || null;
}

export function createDevTenantUser(input: DevTenantUserCreateInput): DevTenantUserRecord {
  const now = new Date().toISOString();
  const record: DevTenantUserRecord = {
    id: `dev-tenant-user-${input.tenantSlug}-${input.email.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`,
    tenantSlug: input.tenantSlug,
    email: input.email,
    legacyUserId: input.legacyUserId || input.email.split("@")[0].toUpperCase(),
    passwordHash: input.passwordHash,
    preferredLocale: input.preferredLocale,
    firstName: input.firstName,
    lastName: input.lastName,
    role: input.role,
    assignedVesselCodes: [...input.assignedVesselCodes],
    userStatus: input.userStatus,
    membershipStatus: input.membershipStatus,
    createdAt: now,
    updatedAt: now,
  };
  DEV_TENANT_USERS.push(record);
  return record;
}

export function deleteDevTenantUser(id: string): boolean {
  const idx = DEV_TENANT_USERS.findIndex(u => u.id === id);
  if (idx < 0) return false;
  DEV_TENANT_USERS.splice(idx, 1);
  return true;
}

export function updateDevTenantUser(id: string, input: DevTenantUserUpdateInput): DevTenantUserRecord | null {
  const record = DEV_TENANT_USERS.find((user) => user.id === id);
  if (!record) return null;

  if (input.email) record.email = input.email;
  if (input.legacyUserId !== undefined) record.legacyUserId = input.legacyUserId || "";
  if (input.passwordHash) record.passwordHash = input.passwordHash;
  if (input.preferredLocale) record.preferredLocale = input.preferredLocale;
  if (input.firstName) record.firstName = input.firstName;
  if (input.lastName) record.lastName = input.lastName;
  if (input.role) record.role = input.role;
  if (input.assignedVesselCodes !== undefined) record.assignedVesselCodes = [...input.assignedVesselCodes];
  if (input.userStatus) record.userStatus = input.userStatus;
  if (input.membershipStatus) record.membershipStatus = input.membershipStatus;

  record.updatedAt = new Date().toISOString();
  return record;
}
