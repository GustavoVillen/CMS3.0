export type DevPlatformUserRole = "SUPERADMIN" | "SUPPORT";
export type DevPlatformUserStatus = "ACTIVE" | "SUSPENDED" | "DISABLED";

export interface DevPlatformUserRecord {
  id: string;
  email: string;
  passwordHash: string;
  role: DevPlatformUserRole;
  status: DevPlatformUserStatus;
  firstName?: string | null;
  lastName?: string | null;
  createdAt: string;
  updatedAt: string;
}

const DEV_PLATFORM_USERS: DevPlatformUserRecord[] = [
  {
    id: "dev-platform-user-admin",
    email: "admin@localhost",
    passwordHash: "plain$Mercurio26",
    role: "SUPERADMIN",
    status: "ACTIVE",
    firstName: "Platform",
    lastName: "Admin",
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-13T00:00:00.000Z",
  },
];

export interface DevPlatformUserCreateInput {
  email: string;
  passwordHash: string;
  role: DevPlatformUserRole;
  status: DevPlatformUserStatus;
  firstName?: string | null;
  lastName?: string | null;
}

export interface DevPlatformUserUpdateInput {
  email?: string;
  passwordHash?: string;
  role?: DevPlatformUserRole;
  status?: DevPlatformUserStatus;
  firstName?: string | null;
  lastName?: string | null;
}

export function listDevPlatformUsers(filters: { status?: string | null; role?: string | null; email?: string | null } = {}) {
  return DEV_PLATFORM_USERS.filter((user) => {
    if (filters.status && user.status !== filters.status) return false;
    if (filters.role && user.role !== filters.role) return false;
    if (filters.email && user.email !== filters.email) return false;
    return true;
  });
}

export function getDevPlatformUserByEmail(email: string): DevPlatformUserRecord | null {
  return DEV_PLATFORM_USERS.find((user) => user.email === email) || null;
}

export function getDevPlatformUserById(id: string): DevPlatformUserRecord | null {
  return DEV_PLATFORM_USERS.find((user) => user.id === id) || null;
}

export function createDevPlatformUser(input: DevPlatformUserCreateInput): DevPlatformUserRecord {
  const now = new Date().toISOString();
  const record: DevPlatformUserRecord = {
    id: `dev-platform-user-${input.email.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`,
    email: input.email,
    passwordHash: input.passwordHash,
    role: input.role,
    status: input.status,
    firstName: input.firstName ?? null,
    lastName: input.lastName ?? null,
    createdAt: now,
    updatedAt: now,
  };
  DEV_PLATFORM_USERS.push(record);
  return record;
}

export function updateDevPlatformUser(id: string, input: DevPlatformUserUpdateInput): DevPlatformUserRecord | null {
  const record = DEV_PLATFORM_USERS.find((user) => user.id === id);
  if (!record) return null;

  if (input.email) record.email = input.email;
  if (input.passwordHash) record.passwordHash = input.passwordHash;
  if (input.role) record.role = input.role;
  if (input.status) record.status = input.status;
  if (input.firstName !== undefined) record.firstName = input.firstName;
  if (input.lastName !== undefined) record.lastName = input.lastName;
  record.updatedAt = new Date().toISOString();
  return record;
}
