// Descargas: conocer la URL no alcanza. El archivo se autoriza por el registro
// que lo contiene y por el buque de ese registro.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  canAccessVessel,
  ownerVesselCodes,
  toStoredUrl,
  urlVariants,
  claimUploadedFile,
  assertFileAccess,
  __clearUploadClaims,
} from "../src/tenant/files/file-access-service";
import { serializeFileUrl } from "../src/tenant/files/files-router";
import { RouteError } from "../src/http/route-error";
import { fakeSession } from "./helpers/fakes";

/**
 * Prisma falso: cada modelo devuelve las filas cuyo campo indicado está en el
 * `in` del where, respetando el filtro por tenantId.
 */
function fakePrisma(tables: Record<string, Array<Record<string, any>>>) {
  const model = (name: string) => ({
    findMany: async (args: any) => {
      const where = args.where ?? {};
      return (tables[name] ?? []).filter((row) => {
        for (const [field, cond] of Object.entries(where)) {
          if (field === "OR") {
            const ok = (cond as any[]).some((clause) =>
              Object.entries(clause).some(([f, c]: any) => c?.in?.includes(row[f])),
            );
            if (!ok) return false;
            continue;
          }
          if (cond && typeof cond === "object" && "in" in (cond as any)) {
            if (!(cond as any).in.includes(row[field])) return false;
          } else if (row[field] !== cond) {
            return false;
          }
        }
        return true;
      });
    },
  });
  return new Proxy({}, { get: (_t, name: string) => model(name) }) as any;
}

const TENANT = "t-mercurio";

describe("normalización de URLs (compatibilidad con lo ya cargado)", () => {
  test("la forma /app/files/ se traduce a la forma /uploads/ que guarda la base", () => {
    assert.equal(toStoredUrl("/app/files/certificates/mercurio/a.pdf"), "/uploads/certificates/mercurio/a.pdf");
    assert.equal(toStoredUrl("/uploads/certificates/mercurio/a.pdf"), "/uploads/certificates/mercurio/a.pdf");
  });

  test("se buscan las dos formas: hay filas viejas y filas reenviadas por el formulario", () => {
    assert.deepEqual(urlVariants("/uploads/certificates/mercurio/a.pdf"), [
      "/uploads/certificates/mercurio/a.pdf",
      "/app/files/certificates/mercurio/a.pdf",
    ]);
  });

  test("va y vuelve con serializeFileUrl, que es lo que ve el cliente", () => {
    const stored = "/uploads/goods-receipts/mercurio/r.pdf";
    assert.equal(toStoredUrl(serializeFileUrl(stored)!), stored);
  });
});

describe("canAccessVessel — mismo criterio que vessel-scope", () => {
  test("TENANT_ADMIN ve todos los buques de su empresa", () => {
    assert.equal(canAccessVessel(fakeSession({ role: "TENANT_ADMIN" }), "CUALQUIERA"), true);
  });

  test("el resto sólo ve sus buques asignados", () => {
    const s = fakeSession({ role: "TECHNICIAN_OPERATOR", vessels: ["DCH"] });
    assert.equal(canAccessVessel(s, "DCH"), true);
    assert.equal(canAccessVessel(s, "LTE"), false);
  });

  test("sin buques asignados no ve nada (fail-closed)", () => {
    assert.equal(canAccessVessel(fakeSession({ role: "MAINTENANCE_MANAGER", vessels: [] }), "DCH"), false);
  });
});

describe("ownerVesselCodes — de qué registro cuelga cada archivo", () => {
  const url = "/uploads/certificates/mercurio/x.pdf";

  test("certificado: sale el buque del certificado", async () => {
    const prisma = fakePrisma({
      certificate: [{ tenantId: TENANT, originalSourceLink: url, vesselCode: "DCH" }],
    });
    assert.deepEqual(await ownerVesselCodes(prisma, TENANT, "certificates", url), ["DCH"]);
  });

  test("certificado de OTRA empresa: no aparece (aislamiento por tenant)", async () => {
    const prisma = fakePrisma({
      certificate: [{ tenantId: "t-otra", originalSourceLink: url, vesselCode: "DCH" }],
    });
    assert.deepEqual(await ownerVesselCodes(prisma, TENANT, "certificates", url), []);
  });

  test("certificado renovado: el archivo viejo queda colgando de la renovación", async () => {
    const prisma = fakePrisma({
      certificateRenewal: [{ tenantId: TENANT, previousSourceLink: url, vesselCode: "LTE" }],
    });
    assert.deepEqual(await ownerVesselCodes(prisma, TENANT, "certificates", url), ["LTE"]);
  });

  test("análisis de fluidos: el buque sale de la muestra, no del resultado", async () => {
    const u = "/uploads/fluid-reports/mercurio/f.pdf";
    const prisma = fakePrisma({
      fluidAnalysisResult: [{ tenantId: TENANT, reportUrl: u, sample: { vesselCode: "MGT" } }],
    });
    assert.deepEqual(await ownerVesselCodes(prisma, TENANT, "fluid-reports", u), ["MGT"]);
  });

  test("remito: sale el buque del remito", async () => {
    const u = "/uploads/goods-receipts/mercurio/r.pdf";
    const prisma = fakePrisma({ goodsReceipt: [{ tenantId: TENANT, fileUrl: u, vesselCode: "DCH" }] });
    assert.deepEqual(await ownerVesselCodes(prisma, TENANT, "goods-receipts", u), ["DCH"]);
  });

  test("checklist de un plan: sale el buque del plan", async () => {
    const u = "/uploads/checklists/mercurio/c.pdf";
    const prisma = fakePrisma({ maintenancePlan: [{ tenantId: TENANT, checklistTemplate: u, vesselCode: "DCH" }] });
    assert.deepEqual(await ownerVesselCodes(prisma, TENANT, "checklists", u), ["DCH"]);
  });

  test("adjunto: se buscan las tres tablas donde puede terminar la URL", async () => {
    const u = "/uploads/attachments/mercurio/workorder/a.jpg";
    const soloAttachment = fakePrisma({
      attachment: [{ tenantId: TENANT, description: u, vesselCode: "DCH", deletedAt: null }],
    });
    assert.deepEqual(await ownerVesselCodes(soloAttachment, TENANT, "attachments", u), ["DCH"]);

    const soloProgreso = fakePrisma({ workOrderProgressNote: [{ tenantId: TENANT, fileUrl: u, vesselCode: "LTE" }] });
    assert.deepEqual(await ownerVesselCodes(soloProgreso, TENANT, "attachments", u), ["LTE"]);

    const soloWo = fakePrisma({ workOrder: [{ tenantId: TENANT, checklistDocUrl: u, vesselCode: "MGT" }] });
    assert.deepEqual(await ownerVesselCodes(soloWo, TENANT, "attachments", u), ["MGT"]);
  });

  test("un adjunto borrado ya no se puede bajar", async () => {
    const u = "/uploads/attachments/mercurio/defect/a.jpg";
    const prisma = fakePrisma({
      attachment: [{ tenantId: TENANT, description: u, vesselCode: "DCH", deletedAt: new Date() }],
    });
    assert.deepEqual(await ownerVesselCodes(prisma, TENANT, "attachments", u), []);
  });

  test("la URL guardada en la forma /app/files/ también se encuentra", async () => {
    const prisma = fakePrisma({
      certificate: [{ tenantId: TENANT, originalSourceLink: "/app/files/certificates/mercurio/x.pdf", vesselCode: "DCH" }],
    });
    assert.deepEqual(await ownerVesselCodes(prisma, TENANT, "certificates", url), ["DCH"]);
  });

  test("escaneo de OT: no lo reclama ninguna tabla, por diseño", async () => {
    const prisma = fakePrisma({});
    assert.deepEqual(
      await ownerVesselCodes(prisma, TENANT, "wo-scans", "/uploads/wo-scans/mercurio/s.jpg"),
      [],
    );
  });
});

describe("assertFileAccess — archivos recién subidos, todavía sin registro", () => {
  beforeEach(() => __clearUploadClaims());

  const url = "/app/files/wo-scans/mercurio/scan.jpg";

  async function denied(session: ReturnType<typeof fakeSession>) {
    return assertFileAccess(session, "wo-scans", url).then(
      () => null,
      (e) => e as RouteError,
    );
  }

  test("quien lo subió lo puede ver aunque no exista el registro", async () => {
    const uploader = fakeSession({ userId: "u1" });
    claimUploadedFile("mercurio", "u1", url);
    await assertFileAccess(uploader, "wo-scans", url); // no tira
  });

  test("otro usuario de la MISMA empresa no lo puede ver", async () => {
    claimUploadedFile("mercurio", "u1", url);
    const err = await denied(fakeSession({ userId: "u2" }));
    assert.ok(err instanceof RouteError);
    assert.equal(err.statusCode, 404, "404, no 403: no se confirma que exista");
  });

  test("el mismo userId en OTRA empresa tampoco", async () => {
    claimUploadedFile("mercurio", "u1", url);
    const err = await denied(fakeSession({ userId: "u1", tenantSlug: "otra" }));
    assert.ok(err instanceof RouteError);
    assert.equal(err.statusCode, 404);
  });

  test("sin claim y sin registro: 404 (no hay base en el test → fail-closed)", async () => {
    const err = await denied(fakeSession({ userId: "u1" }));
    assert.ok(err instanceof RouteError);
    assert.equal(err.statusCode, 404);
  });

  test("el claim guarda la forma /uploads/ sin importar cómo se lo pasen", async () => {
    claimUploadedFile("mercurio", "u1", "/uploads/wo-scans/mercurio/scan.jpg");
    await assertFileAccess(fakeSession({ userId: "u1" }), "wo-scans", url);
  });
});
