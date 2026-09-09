// Aislamiento entre empresas: nadie controla la identidad global de alguien
// sólo por tenerlo en su nómina.
//
// Cubre el hallazgo CRÍTICO de la auditoría 2026-09-09: el admin de la empresa
// B sumaba a su equipo la cuenta de alguien de la empresa A (reusando el User
// global por `legacyUserId`) y después le cambiaba la contraseña — que es
// global — para entrar a la empresa A.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { assertSoleTenantIdentity } from "../src/tenant/team/user-identity-scope";
import { RouteError } from "../src/http/route-error";

function prismaWithMemberships(tenantIds: string[]) {
  return {
    tenantMembership: {
      findMany: async () => tenantIds.map((tenantId) => ({ tenantId })),
    },
  } as any;
}

describe("assertSoleTenantIdentity", () => {
  test("deja pasar cuando la persona pertenece SOLO a esta empresa", async () => {
    await assertSoleTenantIdentity(prismaWithMemberships(["t-mercurio"]), "t-mercurio", "u1");
  });

  test("bloquea el cambio de identidad global si además está en otra empresa", async () => {
    const err = await assertSoleTenantIdentity(
      prismaWithMemberships(["t-mercurio", "t-otra"]),
      "t-mercurio",
      "u1",
    ).then(() => null, (e) => e as RouteError);

    assert.ok(err instanceof RouteError, "tiene que fallar");
    assert.equal(err.statusCode, 409);
    assert.equal(err.code, "SHARED_USER_IDENTITY");
  });

  test("no revela nada de un usuario que no es de esta empresa: 404", async () => {
    const err = await assertSoleTenantIdentity(
      prismaWithMemberships(["t-otra"]),
      "t-mercurio",
      "u1",
    ).then(() => null, (e) => e as RouteError);

    assert.ok(err instanceof RouteError);
    assert.equal(err.statusCode, 404);
    assert.equal(err.code, "USER_NOT_FOUND");
  });

  test("un usuario sin ninguna membership tampoco se puede tocar", async () => {
    const err = await assertSoleTenantIdentity(
      prismaWithMemberships([]),
      "t-mercurio",
      "u1",
    ).then(() => null, (e) => e as RouteError);

    assert.ok(err instanceof RouteError);
    assert.equal(err.statusCode, 404);
  });

  test("el gate mira TODAS las memberships, no sólo la de este tenant", async () => {
    // Regresión directa: la query no puede filtrar por tenantId, porque
    // entonces nunca vería la membership de la otra empresa.
    let receivedWhere: any = null;
    const prisma = {
      tenantMembership: {
        findMany: async (args: any) => {
          receivedWhere = args.where;
          return [{ tenantId: "t-mercurio" }];
        },
      },
    } as any;

    await assertSoleTenantIdentity(prisma, "t-mercurio", "u1");
    assert.deepEqual(receivedWhere, { userId: "u1" });
  });
});
