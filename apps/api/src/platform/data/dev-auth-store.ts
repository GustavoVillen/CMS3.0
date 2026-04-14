import type { TenantRole } from "@pms-saas/shared-types";

export interface DevTenantUserRecord {
  tenantSlug: string;
  id: string;
  email: string;
  legacyUserId: string;
  passwordHash: string;
  preferredLocale: "es" | "en" | "pt";
  firstName: string;
  lastName: string;
  role: TenantRole;
  assignedVesselCodes: string[];
}

export interface DevPlatformUserRecord {
  id: string;
  email: string;
  passwordHash: string;
  role: "SUPERADMIN";
}

export const DEV_TENANT_USERS: DevTenantUserRecord[] = [
  {
    tenantSlug: "demo",
    id: "dev-tenant-user-demo-admin",
    email: "admin@demo.local",
    legacyUserId: "DEMOADMIN",
    passwordHash: "plain$demo123",
    preferredLocale: "es",
    firstName: "Demo",
    lastName: "Admin",
    role: "TENANT_ADMIN",
    assignedVesselCodes: ["LATERE", "GLT001"],
  },
];

export const DEV_PLATFORM_USERS: DevPlatformUserRecord[] = [
  {
    id: "dev-platform-user-admin",
    email: "admin@localhost",
    passwordHash: "plain$admin123",
    role: "SUPERADMIN",
  },
];
