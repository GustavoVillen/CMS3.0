/**
 * MAO 01 — suma a los checklists consolidados dos controles que no estaban
 * (decisión de Gustavo, 09-oct-2026):
 *  - M01-1-003 (mensual de cubierta): sección "LUCES PORTÁTILES DEL CONVOY". La
 *    tarea mensual propia (M01-LUC-CONV-01) se dio de baja el 07-oct y el
 *    checklist no las mencionaba: quedaban sin revisión.
 *  - M01-6-002 (mensual de máquinas): ítem "Tanques de Aire Comprimido" en la
 *    sección del electrocompresor, igual que MAO 02 y LATERE (botellones de aire).
 * Los vínculos "equipos que revisa" van aparte, con link-routine-coverage.ts.
 *
 * Por defecto NO escribe. Con --apply graba. Idempotente: si el texto ya está, no
 * lo repite. Lee la descripción vigente al correr (no pisa ediciones recientes).
 *
 * Uso (en el VPS, desde apps/api):
 *   ACTOR_EMAIL=... npx tsx --env-file=/app-cms3/.env ../../scripts/m01-checklist-items-oct2026.ts [--apply]
 */
import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
} as any) as any;

const APPLY = process.argv.includes("--apply");

interface Edit {
  taskCode: string;
  marker: RegExp;                 // si ya aparece, no se toca
  insertDesc: (lines: string[]) => string[];
  criterion: string;              // se agrega como tercera línea de los criterios
}

const EDITS: Edit[] = [
  {
    taskCode: "M01-1-003",
    marker: /LUCES PORT[AÁ]TILES DEL CONVOY/i,
    insertDesc: (lines) => {
      const at = lines.findIndex(l => /^##\s*BOTES DE RESCATE/i.test(l));
      const block = [
        "## LUCES PORTÁTILES DEL CONVOY:",
        "[  ]  Encender cada luz portátil del convoy y verificar intensidad, color y sector.",
        "[  ]  Controlar la carga de las baterías, las baterías de repuesto y el estado de soportes y fijaciones.",
        "",
      ];
      return at < 0 ? [...lines, "", ...block] : [...lines.slice(0, at), ...block, ...lines.slice(at)];
    },
    criterion: "* Luces portátiles del convoy: todas encienden con el color y sector correctos, baterías cargadas y repuestos disponibles.",
  },
  {
    taskCode: "M01-6-002",
    marker: /Tanques de Aire Comprimido/i,
    insertDesc: (lines) => {
      const start = lines.findIndex(l => /^##\s*ELECTROCOMPRESOR/i.test(l));
      if (start < 0) return [...lines, "", "## ELECTROCOMPRESOR CETEK NK40", "[  ] Tanques de Aire Comprimido: Indicadores de presión, tuberías, Valvula de seguridad."];
      let end = start + 1;
      while (end < lines.length && lines[end]!.trim() !== "" && !/^##/.test(lines[end]!)) end++;
      return [...lines.slice(0, end), "[  ] Tanques de Aire Comprimido: Indicadores de presión, tuberías, Valvula de seguridad.", ...lines.slice(end)];
    },
    criterion: "- Tanques de aire comprimido (botellones principales y auxiliares) sin pérdidas, con manómetros, tuberías y válvula de seguridad en condiciones.",
  },
];

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: process.env.TENANT_SLUG ?? "mercurio" } });
  if (!tenant) throw new Error("No existe el tenant");
  const actor = process.env.ACTOR_EMAIL
    ? await prisma.user.findFirst({ where: { email: process.env.ACTOR_EMAIL, memberships: { some: { tenantId: tenant.id } } } })
    : null;
  if (!actor) throw new Error("ACTOR_EMAIL no corresponde a un usuario de la empresa.");

  for (const e of EDITS) {
    const plan = await prisma.maintenancePlan.findFirst({
      where: { tenantId: tenant.id, vesselCode: "M01", taskCode: e.taskCode, deletedAt: null },
      select: { id: true, taskCode: true, title: true, description: true, acceptanceCriteria: true },
    });
    if (!plan) { console.log(`${e.taskCode}: no existe, se saltea`); continue; }
    if (e.marker.test(plan.description ?? "")) { console.log(`${e.taskCode}: ya tiene el ítem, no se toca`); continue; }
    const description = e.insertDesc((plan.description ?? "").split("\n")).join("\n");
    const crit = (plan.acceptanceCriteria ?? "").split("\n");
    const acceptanceCriteria = [...crit.slice(0, 2), e.criterion, ...crit.slice(2)].join("\n").trim();
    console.log(`${e.taskCode} (${plan.title}): se agrega el ítem y un criterio de aceptación`);
    if (!APPLY) continue;
    await prisma.$transaction([
      prisma.maintenancePlan.update({
        where: { id: plan.id },
        data: { description, acceptanceCriteria, updatedByUserId: actor.id },
      }),
      prisma.auditEvent.create({
        data: {
          tenantId: tenant.id, actorType: "TENANT_USER", actorUserId: actor.id, action: "MaintenancePlan.updated",
          entityType: "MaintenancePlan", entityId: plan.id,
          metadata: { title: plan.title, taskCode: plan.taskCode, vesselCode: "M01", change: "Ítem agregado al checklist" },
        },
      }),
    ]);
  }
  console.log(APPLY ? "Listo." : "(sin --apply no se escribió nada)");
}

main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
