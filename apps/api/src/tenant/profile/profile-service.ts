import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { getDevTenantUserById, updateDevTenantUser } from "../../platform/data/dev-tenant-user-store";
import { RouteError } from "../../http/route-error";
import { verifyPassword, hashPassword } from "../../platform/auth/passwords";

function isDev(): boolean {
  return String(process.env.NODE_ENV || "development").trim().toLowerCase() === "development";
}

export interface ProfileData {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  preferredLocale: string;
}

export async function getProfile(session: TenantAccessSession): Promise<ProfileData> {
  if (isDev()) {
    const u = getDevTenantUserById(session.user.id);
    if (!u) throw new RouteError(404, "USER_NOT_FOUND", "User not found.");
    return { id: u.id, email: u.email, firstName: u.firstName, lastName: u.lastName, preferredLocale: u.preferredLocale };
  }
  const prisma = getPrismaClient();
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { id: true, email: true, firstName: true, lastName: true, preferredLocale: true } });
  if (!user) throw new RouteError(404, "USER_NOT_FOUND", "User not found.");
  return { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, preferredLocale: user.preferredLocale ?? "es" };
}

export async function updateProfile(
  session: TenantAccessSession,
  input: { firstName?: string; lastName?: string; preferredLocale?: string },
): Promise<ProfileData> {
  if (isDev()) {
    const updated = updateDevTenantUser(session.user.id, {
      firstName: input.firstName,
      lastName: input.lastName,
      preferredLocale: input.preferredLocale as "es" | "en" | "pt" | undefined,
    });
    if (!updated) throw new RouteError(404, "USER_NOT_FOUND", "User not found.");
    return { id: updated.id, email: updated.email, firstName: updated.firstName, lastName: updated.lastName, preferredLocale: updated.preferredLocale };
  }
  const prisma = getPrismaClient();
  const user = await prisma.user.update({
    where: { id: session.user.id },
    data: {
      firstName: input.firstName,
      lastName: input.lastName,
      preferredLocale: input.preferredLocale,
    },
    select: { id: true, email: true, firstName: true, lastName: true, preferredLocale: true },
  });
  return { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, preferredLocale: user.preferredLocale ?? "es" };
}

export async function changePassword(
  session: TenantAccessSession,
  input: { currentPassword: string; newPassword: string },
): Promise<void> {
  if (input.newPassword.length < 8) {
    throw new RouteError(400, "PASSWORD_TOO_SHORT", "Password must be at least 8 characters.");
  }
  if (isDev()) {
    const u = getDevTenantUserById(session.user.id);
    if (!u) throw new RouteError(404, "USER_NOT_FOUND", "User not found.");
    if (!verifyPassword(input.currentPassword, u.passwordHash)) {
      throw new RouteError(401, "WRONG_PASSWORD", "Current password is incorrect.");
    }
    updateDevTenantUser(session.user.id, { passwordHash: `plain$${input.newPassword}` });
    return;
  }
  const prisma = getPrismaClient();
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { passwordHash: true } });
  if (!user?.passwordHash) throw new RouteError(404, "USER_NOT_FOUND", "User not found.");
  if (!verifyPassword(input.currentPassword, user.passwordHash)) {
    throw new RouteError(401, "WRONG_PASSWORD", "Current password is incorrect.");
  }
  await prisma.user.update({ where: { id: session.user.id }, data: { passwordHash: hashPassword(input.newPassword) } });
}
