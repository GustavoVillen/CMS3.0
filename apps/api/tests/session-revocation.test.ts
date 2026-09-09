// Revocación de accesos: la baja, la suspensión y el cambio de rol o de buques
// tienen que valer en el request siguiente, no cuando venza el token.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { membershipToLive } from "../src/tenant/auth/live-session-guard";
import {
  registerTenantAccessSession,
  getTenantAccessSession,
  revokeTenantSessionsForUser,
} from "../src/tenant/auth/session-store";
import { fakeSession } from "./helpers/fakes";

const activeUser = { status: "ACTIVE" };

describe("membershipToLive — quién sigue pudiendo operar", () => {
  test("membership ACTIVE con usuario ACTIVE: habilitado", () => {
    const live = membershipToLive({
      role: "TECHNICIAN_OPERATOR",
      status: "ACTIVE",
      assignedVesselCodes: ["DCH"],
      user: activeUser,
    });
    assert.deepEqual(live, { role: "TECHNICIAN_OPERATOR", assignedVesselCodes: ["DCH"] });
  });

  test("dado de baja (sin membership): cortado", () => {
    assert.equal(membershipToLive(null), null);
    assert.equal(membershipToLive(undefined), null);
  });

  test("membership REVOKED o SUSPENDED: cortado", () => {
    for (const status of ["REVOKED", "SUSPENDED", "INVITED"]) {
      assert.equal(
        membershipToLive({ role: "TENANT_ADMIN", status, assignedVesselCodes: [], user: activeUser }),
        null,
        `status ${status} tiene que cortar`,
      );
    }
  });

  test("usuario global deshabilitado o suspendido: cortado aunque la membership siga ACTIVE", () => {
    for (const status of ["DISABLED", "SUSPENDED", "INVITED"]) {
      assert.equal(
        membershipToLive({
          role: "TENANT_ADMIN",
          status: "ACTIVE",
          assignedVesselCodes: [],
          user: { status },
        }),
        null,
        `user.status ${status} tiene que cortar`,
      );
    }
  });

  test("el rol y los buques salen de la base, no del token", () => {
    // El token se emitió como TENANT_ADMIN; la base ya dice otra cosa.
    const live = membershipToLive({
      role: "AUDITOR_READONLY",
      status: "ACTIVE",
      assignedVesselCodes: ["LTE"],
      user: activeUser,
    });
    assert.equal(live?.role, "AUDITOR_READONLY");
    assert.deepEqual(live?.assignedVesselCodes, ["LTE"]);
  });

  test("sin buques asignados devuelve lista vacía (fail-closed aguas abajo)", () => {
    const live = membershipToLive({
      role: "TECHNICIAN_OPERATOR",
      status: "ACTIVE",
      assignedVesselCodes: undefined,
      user: activeUser,
    });
    assert.deepEqual(live?.assignedVesselCodes, []);
  });
});

describe("revokeTenantSessionsForUser — cambio de contraseña", () => {
  test("baja todas las sesiones vivas de esa persona en ese tenant", () => {
    const a = fakeSession({ userId: "u1", tenantSlug: "mercurio" });
    const b = { ...fakeSession({ userId: "u1", tenantSlug: "mercurio" }), accessToken: "at-u1-b" };
    const other = fakeSession({ userId: "u2", tenantSlug: "mercurio" });
    const otherTenant = fakeSession({ userId: "u1", tenantSlug: "otra" });
    for (const s of [a, b, other, otherTenant]) registerTenantAccessSession(s);

    const revoked = revokeTenantSessionsForUser("mercurio", "u1");

    assert.equal(revoked, 2);
    assert.equal(getTenantAccessSession(a.accessToken), null);
    assert.equal(getTenantAccessSession(b.accessToken), null);
    // No toca a otras personas ni a la misma persona en otra empresa.
    assert.ok(getTenantAccessSession(other.accessToken));
    assert.ok(getTenantAccessSession(otherTenant.accessToken));
  });

  test("puede preservar la sesión desde la que se cambió la contraseña", () => {
    const current = { ...fakeSession({ userId: "u9", tenantSlug: "mercurio" }), accessToken: "at-u9-current" };
    const stolen = { ...fakeSession({ userId: "u9", tenantSlug: "mercurio" }), accessToken: "at-u9-stolen" };
    registerTenantAccessSession(current);
    registerTenantAccessSession(stolen);

    const revoked = revokeTenantSessionsForUser("mercurio", "u9", current.accessToken);

    assert.equal(revoked, 1);
    assert.ok(getTenantAccessSession(current.accessToken), "la sesión propia sigue viva");
    assert.equal(getTenantAccessSession(stolen.accessToken), null);
  });
});
