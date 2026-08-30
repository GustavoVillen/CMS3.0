/**
 * Abre la OT "DIQUE SECO 2026" del remolcador LATERE (LTE, tenant mercurio) y su
 * Solicitud de Servicio al Astillero La Barca del Pescador.
 *
 * Origen de los datos: "Informe final sobre trabajos - Astillero La Barca"
 * (dique de junio 2021, R/E LATERE, Gerardo Gimenez). Los trabajos de aquel
 * dique se replican en el dique 2026, así que el informe se usa como ALCANCE A
 * EJECUTAR (campo TAREA de la OT), no como historial: la OT nace SOLICITADA,
 * sin avances ni resultado.
 *
 * Se registra como si lo hubiera cargado el usuario MAQUINAS_LATERE
 * (legacyUserId MAQUINASLATERE, MAINTENANCE_MANAGER a cargo de LTE): es el
 * createdBy/updatedBy de la OT y de la SS, igual que si lo hubiese tipeado él en
 * la app. La tramitación (aprueba / autoriza) queda VACÍA a propósito: son pasos
 * de otras personas que todavía no ocurrieron.
 *
 * Numeración: mismo camino que el backend (MAX del correlativo, no COUNT) —
 * OT-LTE-26-NNNN para la OT y SS-<seq>-LTE-2026 para la SS.
 *
 * Idempotente: aborta si ya existe una OT de LTE titulada "DIQUE SECO 2026".
 *
 * Uso (en el VPS):
 *   export $(grep -E '^DATABASE_URL=' .env | xargs)
 *   DRY=1 npx tsx scripts/load-lte-dique-2026.ts     # previsualiza
 *   npx tsx scripts/load-lte-dique-2026.ts           # ejecuta
 */
import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
} as any) as any;

const DRY = process.env.DRY === "1";

const TENANT_SLUG = "mercurio";
const VESSEL = "LTE";                       // buque LATERE
const ASSET_CODE = "LTE-1-CC-001";          // Casco, Cubierta, Casillaje (Equipos y Estructura en general)
const USER_LEGACY_ID = "MAQUINASLATERE";    // MAQUINAS_LATERE, MAINTENANCE_MANAGER de LTE
const PROVIDER_NAME = "Astillero La Barca del Pescador";
const WO_TITLE = "DIQUE SECO 2026";

// Fecha de apertura de la OT = hoy (es un pedido, no una carga histórica).
const OPEN_DATE = new Date();

// ── TAREA (campo `description` de la OT) ─────────────────────────────────────
// Alcance completo del dique, en orden de ejecución. Sale del informe 2021:
// tabla "Estatus de avance de trabajos" + el detalle de cada capítulo.
const TAREA = `ALCANCE DEL DIQUE SECO 2026 - Remolcador LATERE. Replica los trabajos ejecutados en el dique de junio 2021 (Astillero La Barca del Pescador). Duración de referencia: 9 días de trabajo en dique.

1. DESEMBARQUE DE COMBUSTIBLE previo a la entrada a dique (referencia 2021: 100 m3).

2. INGRESO A DIQUE FLOTANTE para reparación a seco.

3. BUJES DE TINTERO DE PALAS DE AVANCE. Desmontaje de las 12 palas de avance. Inspección de huelgo de bujes superior e inferior. Cambio de la totalidad de los bujes de tintero. Pernos del conjunto de movimiento: reparación, relleno, mecanizado y cromado.

4. BUJES DE LIMERA. Verificación de huelgos de los 12 bujes. Fabricación a nuevo y reemplazo de los que estén fuera de huelgo admisible, según diseño provisto por la Naviera (en 2021 se cambiaron 5 de 12).

5. PALAS DE AVANCE - REPARACIÓN Y MONTAJE. Verificación de las 12 palas con pruebas neumáticas / de presión. Reparación por soldadura de las que presenten fisuras y nueva verificación antes del montaje. Montaje de las 12 palas.

6. HÉLICES. Desmontaje de todas las hélices. Ensayos no destructivos: líquidos penetrantes en las aspas y partículas magnéticas en el cono / alojamiento, en presencia del inspector de Clase. Montaje según el mismo procedimiento del Astillero Tsuneishi para el montaje original.

7. COOLERS DE MMPP Y MMAA. Limpieza de rejillas y serpentinas de ambas bandas (incrustación de mejillones). Pruebas de presión de las tapas. Reemplazo de juntas y reapriete de todas las tapas. Recarga de refrigerante y verificación de estanqueidad del circuito (en 2021 aparecieron pérdidas recién en la recarga, ya fuera de dique).

8. TOMAS DE MAR. Inspección y ensayos neumáticos de las 4 válvulas de toma de mar (2 babor y 2 estribor).

9. VÁLVULAS. Recorrido y prueba de válvulas.

10. TOBERA. Verificación de desgastes en la soldadura. Reparación con soldadura inoxidable entre el recubrimiento inox y el soporte de acero al carbono. Ensayo neumático / prueba de presión para descartar pérdidas.

11. PANTOQUE PROA / BABOR. Verificación del casco. Corte del sector deformado y reemplazo por chapa del mismo espesor. Prueba de presión y ensayo de ultrasonido de la soldadura (servicio externo).

12. DEFENSAS DE GOMA EN TOPES. Intervención de la estructura del tope, cierre de espacios abiertos con chapas y montaje de las defensas de goma (12 unidades). Colocación de 4 defensas en la parte central de proa, contra el tanque de agua, para proteger el remolcador y las barcazas transportadas. ATENCIÓN: en 2021 quedaron 2 defensas sin montar por atraso del proveedor - asegurar la provisión completa antes de la varada.

13. IMBORNALES. Intervención de la cubierta principal y colocación de imbornales en ambas bandas hacia proa, para evitar acumulación de agua en cubierta.

14. PINTURA. Renovación de pintura de marcaciones en obra viva y de los números de calado.

15. RENOVACIÓN DE CLASE NK - INSPECCIÓN ESPECIAL (2 etapas: inicio y complemento). Puntos a verificar:
   a) Inspecciones en dique: casco por debajo de la línea de flotación; timón; tomas de mar; hélices; ancla; tanques y espacios confinados; análisis de aceite de líneas de eje.
   b) Inspecciones de casco y máquinas: planos de estabilidad; plan de control de incendios; seguridad de puertas estancas; casco por encima de la línea de flotación; ventilación y lumbreras; imbornales; elementos de amarre y molinetes; elementos de combate de incendio; bombas de incendio principal y de emergencia; bombas de lastre; hidrantes; mangueras; extintores; conexión internacional de toma de agua para incendio; salidas de emergencia; alarmas de incendio; repuestos críticos; alarmas de sentinas; motores principales; motores generadores principales y de emergencia; cajas reductoras; tableros eléctricos; análisis de aceites de motores; sistema de espuma; tuberías de sentina y lastre; sistemas de comunicación; prueba de alarmas de equipos (presión, temperatura, nivel); cierre remoto general de válvulas de combustible; sistema de sobrevelocidad de motores principales; iluminación general y luces de navegación; documentación (planes de mantenimiento, arreglo general, lucha contra incendio); equipos auxiliares.
   c) Inspección de líneas de ejes: ensayos no destructivos al cono de la línea de eje incluido el chavetero; holguras de la línea de ejes; ensayos no destructivos e inspección visual de la hélice; lubricación de las líneas de ejes; verificación de sellos; alarmas de nivel de aceite.

16. SALIDA DE DIQUE FLOTANTE.

17. EMBARQUE DE COMBUSTIBLE (referencia 2021: 100 m3).`;

// ── SS al astillero ─────────────────────────────────────────────────────────
const SS_TITLE = "DIQUE SECO 2026 - Trabajos en dique seco";
const SS_DESCRIPTION = `Se solicita al Astillero La Barca del Pescador la ejecución de los trabajos de varada del remolcador LATERE (Dique Seco 2026), replicando el alcance del dique de junio 2021:

- Ingreso y salida de dique flotante, con desembarque y embarque de combustible.
- Palas de avance: desmontaje de las 12 unidades, cambio de bujes de tintero, fabricación y cambio de bujes de limera fuera de huelgo, reparación de fisuras con prueba neumática y montaje final.
- Hélices: desmontaje, ensayos no destructivos (líquidos penetrantes y partículas magnéticas) y montaje según procedimiento original Tsuneishi.
- Coolers de MMPP y MMAA: limpieza de rejillas y serpentinas, prueba de presión de tapas, cambio de juntas y reapriete.
- Tomas de mar: ensayos neumáticos de las 4 válvulas. Recorrido y prueba de válvulas.
- Tobera: reparación de soldadura inox sobre soporte de acero al carbono y prueba de presión.
- Pantoque proa/babor: cambio de chapa, prueba de presión y ultrasonido de soldadura.
- Defensas de goma en topes (12 unidades) y 4 defensas en proa contra el tanque de agua.
- Imbornales en cubierta principal, ambas bandas hacia proa.
- Pintura de obra viva y marcaciones de calado.
- Asistencia y andamiaje para las inspecciones de Renovación de Clase NK (dique seco, casco y máquinas, línea de ejes).`;

const SS_CAUSES = `Varada programada del remolcador LATERE: renovación de Clase NK (Inspección Especial, con inspección en dique seco, casco y máquinas y línea de ejes) y ejecución de los trabajos de casco, propulsión, línea de ejes y estructura que sólo pueden hacerse con el buque en seco. El alcance replica el dique de junio 2021 en el mismo astillero.`;

async function main() {
  const tenant = await prisma.tenant.findFirst({ where: { slug: TENANT_SLUG }, select: { id: true } });
  if (!tenant) throw new Error(`Tenant ${TENANT_SLUG} no encontrado`);
  const tenantId = tenant.id;

  const vessel = await prisma.vessel.findFirst({ where: { tenantId, code: VESSEL }, select: { code: true, name: true } });
  if (!vessel) throw new Error(`Buque ${VESSEL} no encontrado en ${TENANT_SLUG}`);

  const asset = await prisma.asset.findFirst({
    where: { tenantId, vesselCode: VESSEL, assetCode: ASSET_CODE, deletedAt: null },
    select: { id: true, assetCode: true, name: true },
  });
  if (!asset) throw new Error(`Asset ${ASSET_CODE} no encontrado en ${VESSEL}`);

  const user = await prisma.user.findFirst({
    where: { legacyUserId: USER_LEGACY_ID },
    select: { id: true, firstName: true, legacyUserId: true },
  });
  if (!user) throw new Error(`Usuario ${USER_LEGACY_ID} no encontrado`);
  const membership = await prisma.tenantMembership.findFirst({
    where: { tenantId, userId: user.id },
    select: { role: true, assignedVesselCodes: true },
  });
  if (!membership) throw new Error(`${USER_LEGACY_ID} no pertenece al tenant ${TENANT_SLUG}`);
  if (!(membership.assignedVesselCodes ?? []).includes(VESSEL)) {
    throw new Error(`${USER_LEGACY_ID} no tiene alcance sobre ${VESSEL} (${JSON.stringify(membership.assignedVesselCodes)})`);
  }

  const provider = await prisma.provider.findFirst({
    where: { tenantId, name: PROVIDER_NAME },
    select: { id: true, providerCode: true, name: true },
  });
  if (!provider) throw new Error(`Proveedor "${PROVIDER_NAME}" no encontrado en el catálogo de ${TENANT_SLUG}`);

  // Idempotencia: una sola OT "DIQUE SECO 2026" por buque.
  const dupe = await prisma.workOrder.findFirst({
    where: { tenantId, vesselCode: VESSEL, title: WO_TITLE, deletedAt: null },
    select: { workOrderCode: true },
  });
  if (dupe) throw new Error(`Ya existe la OT ${dupe.workOrderCode} con título "${WO_TITLE}" en ${VESSEL}. Nada que hacer.`);

  // ── Numeración, mismo criterio que el backend (MAX, no COUNT) ─────────────
  const yy = String(OPEN_DATE.getFullYear()).slice(-2);
  const codeBody = `${VESSEL}-${yy}-`;
  const codePrefix = `OT-${codeBody}`;
  const woRows = await prisma.$queryRawUnsafe(
    `SELECT MAX(CAST(SUBSTRING("workOrderCode", ${codePrefix.length + 1}) AS INTEGER)) AS max_seq
       FROM "WorkOrder"
      WHERE "tenantId" = $1 AND "vesselCode" = $2
        AND SUBSTRING("workOrderCode", 4) LIKE $3 AND "deletedAt" IS NULL`,
    tenantId, VESSEL, codeBody + "%",
  );
  const workOrderCode = `${codePrefix}${String((woRows[0]?.max_seq ?? 0) + 1).padStart(4, "0")}`;

  const year = OPEN_DATE.getFullYear();
  const ssRows = await prisma.$queryRawUnsafe(
    `SELECT MAX(CAST(SPLIT_PART("serviceRequestCode", '-', 2) AS INTEGER)) AS max_seq
       FROM "ServiceRequest"
      WHERE "tenantId" = $1 AND "vesselCode" = $2
        AND "serviceRequestCode" ~ ('^SS-[0-9]+-' || $2 || '-' || $3 || '$')
        AND "deletedAt" IS NULL`,
    tenantId, VESSEL, String(year),
  );
  const serviceRequestCode = `SS-${(ssRows[0]?.max_seq ?? 0) + 1}-${VESSEL}-${year}`;

  console.log("── DIQUE SECO 2026 — LATERE ──────────────────────────────────");
  console.log(`Buque:      ${vessel.name} (${VESSEL})`);
  console.log(`Equipo:     ${asset.assetCode} — ${asset.name}`);
  console.log(`Usuario:    ${user.firstName} (${user.legacyUserId}) — ${membership.role}`);
  console.log(`Taller:     ${provider.name} (${provider.providerCode})`);
  console.log(`OT:         ${workOrderCode}  — PLANNED / SOLICITADA, sin aprobar ni autorizar`);
  console.log(`SS:         ${serviceRequestCode} — DRAFT`);
  console.log(`Apertura:   ${OPEN_DATE.toISOString().slice(0, 10)}`);
  console.log(`TAREA:      ${TAREA.length} caracteres, 17 ítems`);
  if (DRY) {
    console.log("\n--- TAREA ---\n" + TAREA);
    console.log("\n[DRY] No se escribió nada.");
    return;
  }

  const wo = await prisma.workOrder.create({
    data: {
      tenantId,
      vesselCode: VESSEL,
      assetId: asset.id,
      maintenancePlanId: null,
      workOrderCode,
      // Varada programada con renovación de clase: mantenimiento preventivo
      // planificado, no una falla.
      type: "PREVENTIVE",
      maintenanceKind: "PREVENTIVO",
      status: "PLANNED",
      priority: "HIGH",
      criticality: "A",
      openDate: OPEN_DATE,
      dueDate: null,              // la fecha de varada la fija la Naviera con el astillero
      title: WO_TITLE,
      description: TAREA,
      // Formulario REGI-OPE-26.3
      requestedByArea: "MAQUINAS",
      assignedToArea: "TERCERIZADO",
      systemArea: "MAQUINAS",
      department: "PROVEEDOR",
      providerId: provider.id,
      location: PROVIDER_NAME,
      communicationMethod: [],
      distribution: [],
      createdByUserId: user.id,
      updatedByUserId: user.id,
    },
    select: { id: true, workOrderCode: true },
  });

  const ss = await prisma.serviceRequest.create({
    data: {
      tenantId,
      vesselCode: VESSEL,
      workOrderId: wo.id,
      serviceRequestCode,
      status: "DRAFT",
      priority: "HIGH",
      openDate: OPEN_DATE,
      title: SS_TITLE,
      description: SS_DESCRIPTION,
      causes: SS_CAUSES,
      providerId: provider.id,
      department: "MAQUINAS",
      // purchaseRequestKinds / communicationMethod / distribution quedan vacíos:
      // son casilleros del formulario que decide quien tramita, no datos del informe.
      purchaseRequestKinds: [],
      communicationMethod: [],
      distribution: [],
      createdByUserId: user.id,
      updatedByUserId: user.id,
    },
    select: { id: true, serviceRequestCode: true },
  });

  console.log(`\nOK — OT ${wo.workOrderCode} (${wo.id}) + SS ${ss.serviceRequestCode} (${ss.id})`);
}

main().catch(e => { console.error("ERROR:", e.message ?? e); process.exitCode = 1; }).finally(() => process.exit());
