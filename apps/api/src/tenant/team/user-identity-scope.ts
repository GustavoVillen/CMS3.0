// Control de la IDENTIDAD GLOBAL de un usuario desde la consola de una empresa.
//
// El modelo `User` es global (una fila por persona) y la pertenencia a una
// empresa la define `TenantMembership`. Hay campos que viven en `User` y que,
// por lo tanto, valen para TODAS sus empresas:
//
//     passwordHash · email · legacyUserId · formName · signatureUrl · status
//
// Hasta la auditoría 2026-09-09 alcanzaba con tener una membership en el
// tenant para poder escribirlos (`updateMany` scopeado por membership). Eso
// abría una toma de cuentas entre empresas:
//
//   1. El admin de la empresa B llama a `createDirectMember` con un nombre que
//      normaliza al `legacyUserId` de alguien de la empresa A. El código
//      reusaba ese `User` global y le creaba una membership en B.
//   2. Con esa membership, `setMemberPassword` le cambiaba el `passwordHash`
//      GLOBAL — y con esa contraseña se entra a la empresa A.
//
// Regla que aplicamos: **pertenecer a una empresa no autoriza a controlar la
// identidad global**. Sólo se pueden tocar los campos de `User` cuando esa
// persona pertenece exclusivamente a esta empresa. Si además está en otra, los
// datos globales quedan bloqueados (los de la membership —rol, buques, cargo,
// matrícula— se siguen editando con normalidad, porque son por empresa).

import { RouteError } from "../../http/route-error";
import type { getPrismaClient } from "../../platform/data/prisma-client";

type PrismaLike = NonNullable<ReturnType<typeof getPrismaClient>>;

/**
 * Exige que `userId` pertenezca a este tenant y **sólo** a este tenant antes de
 * dejar escribir un campo global de `User`.
 *
 * @throws 404 USER_NOT_FOUND        si no hay membership en este tenant.
 * @throws 409 SHARED_USER_IDENTITY  si la persona también está en otra empresa.
 */
export async function assertSoleTenantIdentity(
  prisma: PrismaLike,
  tenantId: string,
  userId: string,
): Promise<void> {
  const memberships = await (prisma as any).tenantMembership.findMany({
    where: { userId },
    select: { tenantId: true },
  });

  if (!memberships.some((m: { tenantId: string }) => m.tenantId === tenantId)) {
    throw new RouteError(404, "USER_NOT_FOUND", "Usuario no encontrado.");
  }

  const foreign = memberships.filter((m: { tenantId: string }) => m.tenantId !== tenantId);
  if (foreign.length > 0) {
    throw new RouteError(
      409,
      "SHARED_USER_IDENTITY",
      "Esta persona también está dada de alta en otra empresa. Sus datos de acceso " +
        "(contraseña, email, nombre de firma) sólo puede cambiarlos ella desde su perfil. " +
        "Desde acá podés cambiarle el rol, los buques y su calificación.",
    );
  }
}
