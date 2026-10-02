// Auditoría de IA al cerrar una Orden de Trabajo.
//
// Por qué existe: el cierre es el momento en que la evidencia queda congelada.
// Lo que no se cargó ahí ya no se carga más, y es exactamente lo que mira un
// auditor TMSA (Elemento 4) o de bandera (ISM Cap. 10). Antes la OT se cerraba
// sin ningún control y el desvío aparecía meses después.
//
// Qué hace: lee la OT COMPLETA (la misma que se imprime en el formulario
// controlado) más lo que el usuario está tipeando en el cierre y todavía no
// guardó, y devuelve un informe de auditoría: veredicto, hallazgos contra
// criterios reales, próximos pasos concretos, y las dudas que no pudo resolver
// para que las conteste la persona.
//
// Qué NO hace: no decide. El veredicto no frena el cierre (decisión de producto,
// 2026-08-29) y el informe sólo se guarda si el usuario acepta pegarlo en
// Observaciones. Misma regla que el resto del copiloto: sugiere, no resuelve.

import Anthropic from "@anthropic-ai/sdk";
import { createAiClient, AI_MODEL, aiApiKey, aiApiKeyName } from "../ai/ai-provider";
import { recordAiUsage, assertAiBudgetAvailableBySlug } from "../usage/usage-service";
import { log } from "../../common/logger";
import { RouteError } from "../../http/route-error";
import { getVesselAiContext } from "../ai/vessel-ai-context";
import type { TenantAccessSession } from "../auth/session-store";
import { getCachedTenantBySlug } from "../tenant-cache";
import { getTenantAiLocale, localeInstruction, localeUserReminder } from "../ai/ai-locale";
import { loadWorkOrderPdfContext } from "../pms/work-order-pdf/data-loader";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { loadVesselCatalog } from "../spares/goods-receipts-service";
import { matchSpare, normalizeText, type SpareCandidate } from "../spares/spare-match";
import { matchSparesByAi, type AiLineInput } from "../spares/spare-ai-match";

const FEATURE = "wo_close_audit";

// Cláusulas del Capítulo 10 del Código ISM, literales. Son las mismas que usa el
// módulo /ism (ism-ai-suggestions.ts): el informe tiene que citar el criterio
// real, no una paráfrasis inventada por el modelo.
export const ISM_CLAUSES = `10.1 — La Compañía debe establecer procedimientos para asegurar que el buque se mantiene de conformidad con las reglas y reglamentos pertinentes y con cualquier requisito adicional que establezca la Compañía.
10.2.1 — Las inspecciones se realizan a intervalos apropiados.
10.2.2 — Toda no conformidad se notifica, indicando su posible causa, si se conoce.
10.2.3 — Se adoptan las medidas correctivas apropiadas.
10.2.4 — Se conserva registro de estas actividades.
10.3 — La Compañía identifica el equipo y los sistemas técnicos cuyo fallo repentino pueda ocasionar situaciones peligrosas, y prevé medidas para promover su fiabilidad, incluida la prueba periódica de equipos de reserva o no usados de forma continua.
10.4 — Las inspecciones de 10.2 y las medidas de 10.3 se integran en las operaciones ordinarias de mantenimiento del buque.`;

// Grupos de evidencia del Elemento 4 que el propio PMS audita (tmsa-service.ts).
// Se listan para que los hallazgos se anclen a un requisito que el sistema ya
// mide, y no a un número de TMSA inventado.
export const TMSA_ELEMENTS = `4.1 — Cobertura del PMS y uso del sistema de defectos.
4.2 — Equipo crítico, certificados, inspecciones y especificación de varada.
4.3 — Mantenimiento planificado ejecutado en fecha y control de diferimientos.
4.4 — Repuestos críticos y auditoría de ingeniería.
4.5 — Monitoreo de condición (CBM): análisis de fluidos, vibraciones, termografía.
4A.2 — Permiso de Trabajo en equipo crítico.
7 — Gestión del cambio (MOC) cuando la intervención modifica el equipo o el procedimiento.
8 — Análisis de falla / RCA cuando hubo falla.`;

// Qué tan estricta es la auditoría con LOTO y Permisos de Trabajo, del 1 al 10.
// La empresa definió 3 (sep 2026): la flota son remolcadores y barcazas de río
// donde el LOTO formal y el PTW recién se están implantando, y un cierre no
// puede caer en NO CONFORME sólo porque no hay un permiso vinculado. Si se
// sube el número, revisar también el texto de la regla en el prompt.
export const LOTO_STRICTNESS = 3;

/** Regla del prompt para los análisis de condición (OT y SS la comparten). */
export const CONDITION_ANALYSES_RULE = `- Análisis de condición ("analisisDeCondicion"): son los registros FA del sistema (aceite, megado, vibraciones, termografía), cada uno con el informe del laboratorio o del taller. Un análisis con resultadoCargado = true y veredicto ya está EVALUADO: es la evidencia de las mediciones y del informe. No lo pidas, no preguntes por las mediciones, los valores, el instrumento ni el informe del taller, y no lo cuentes como hallazgo. Sólo si un análisis tiene veredicto distinto de NORMAL, fijate que la OT diga qué se hizo con eso (defecto, OT de reparación). Si un equipo del trabajo quedó sin análisis cargado, eso sí puede ser un hallazgo.`;

const AUDIT_PROMPT = `Sos auditor senior de Sistemas de Gestión de Mantenimiento de una naviera. Tenés experiencia en auditorías TMSA (OCIMF), verificaciones ISM de bandera y sociedad de clasificación, y en las buenas prácticas de mantenimiento de maquinaria naval.

Te paso una Orden de Trabajo que se está por CERRAR, con toda su evidencia. Tu trabajo es auditarla como si estuvieras parado frente al Jefe de Máquinas antes de firmar el cierre: revisar que el trabajo se haya hecho como corresponde, que la evidencia alcance para defender el cierre en una auditoría, y que no queden cabos sueltos.

CRITERIOS CONTRA LOS QUE AUDITÁS

Capítulo 10 del Código ISM (Mantenimiento del buque y el equipo):
${ISM_CLAUSES}

TMSA — Elemento 4 (Reliability and Maintenance) y 4A:
${TMSA_ELEMENTS}

Además: las buenas prácticas de mantenimiento propias del TIPO DE EQUIPO de esta OT (motores, bombas, compresores, calderas, equipos eléctricos, equipo de salvamento, equipo crítico de gobierno y propulsión, etc.), y lo que el fabricante o la práctica de la industria exigen para ese trabajo.

QUÉ REVISAR — la OT COMPLETA, no sólo el cierre
- Coherencia: ¿lo declarado en RESULTADO se sostiene con lo que dicen la tarea, el detalle, los avances y las observaciones? Un "satisfactorio" con un detalle que habla de una fuga es un hallazgo.
- Criterios de aceptación: ¿estaban definidos y hay evidencia de que se verificaron con valores medidos?
- Seguridad: ¿el trabajo requería análisis de riesgo? ¿Hay algo en la evidencia que muestre un trabajo inseguro (se trabajó sobre un equipo energizado o presurizado, hubo un incidente)?
- LOTO y Permisos de Trabajo — exigencia NIVEL ${LOTO_STRICTNESS} DE 10 (baja, definida por la empresa). Que falte un LOTO o un Permiso de Trabajo vinculado NO es hallazgo MAYOR ni MENOR y NO cambia el veredicto: como mucho va UNA observación (severidad OBSERVACION) recomendando registrarlo la próxima vez. Sólo sube a MENOR si la propia OT cuenta que se trabajó sin aislar un equipo energizado o presurizado, o si hubo un incidente. No preguntes por números de permiso ni certificados LOTO.
- Registro (ISM 10.2.4): ¿quedó quién lo hizo, cuándo, con qué horas de máquina, qué repuestos se usaron?
- Repuestos: ¿los repuestos previstos (materiales.repuestosPrevistos) coinciden con los consumidos (materiales.consumidosRegistrados y materiales.aConsumirEnEsteCierre)? Una diferencia sin explicar es un hallazgo.
- Materiales (aceite, grasa, trapos, sellador…): no mueven stock, así que NUNCA aparecen entre los consumidos. Su registro es materiales.materialesRegistrados. Si lo que se usó figura ahí, el consumo ESTÁ registrado: no es hallazgo, ni próximo paso, ni va en "consumoSinRegistrar".
- Consumo sin registrar: si la evidencia (avances, observaciones, respuestas del usuario, detalle) dice que se USÓ, CAMBIÓ o REPUSO un repuesto o un material con una cantidad conocida, y eso no figura en materiales.consumidosRegistrados, ni en materiales.aConsumirEnEsteCierre, ni en materiales.materialesRegistrados, va en "consumoSinRegistrar" además del hallazgo. La cantidad tiene que estar dicha o ser inequívoca ("se cambió el filtro" = 1). Si no se sabe cuánto se usó, no lo pongas ahí: preguntalo. Inspeccionar, medir o verificar no consume nada.
- Pendientes: si quedó algo pendiente, o si la tarea NO se concluyó, eso NO se cierra y se olvida: tiene que quedar planificado en algún lado.
- Trazabilidad: ¿hay defecto, diferimiento, MOC, RCA o SS que debería haberse abierto y no se abrió?
- Plan de mantenimiento: si la OT viene de un plan, ¿el cierre alcanza para acreditar la ejecución del plan?
${CONDITION_ANALYSES_RULE}

REGLAS INNEGOCIABLES
- Auditás SÓLO con la evidencia que te paso. No inventes datos, fechas, valores ni normas.
- Lo que no podés determinar con la evidencia NO es un hallazgo: es una PREGUNTA para el usuario.
- Preguntá SÓLO lo más importante: como máximo 2 dudas, las que pueden cambiar el veredicto. El resto de lo que no sabés va como observación, no como pregunta.
- Reportá SÓLO lo más importante: como máximo 3 hallazgos (los más graves) y 2 próximos pasos. Los detalles de forma o menores no van.
- No preguntes por datos vacíos del formulario (ubicación, número de viaje, condición, sistema, quién pide, quién ejecuta): la pantalla ya los pide aparte.
- Cada hallazgo cita el criterio concreto ("ISM 10.2.4", "TMSA 4A.2", "Buena práctica: …"). Nada de "no cumple con las normas".
- Si la OT está bien, decilo y no inventes hallazgos para justificar el análisis.
- Cada próximo paso tiene que ser una acción concreta y accionable en este sistema. Si quedaron pendientes, el paso es abrir la OT que los resuelve, con qué equipo y qué alcance. Si apareció una falla, abrir el defecto. Si hay que postergar, el diferimiento. Si se cambió el equipo o el procedimiento, el MOC.
- Escribí para un Jefe de Máquinas: técnico, corto, sin relleno y sin adular.

CAMPO "observationsText"
Es el texto que se va a pegar tal cual en el campo Observaciones de la OT, que se imprime en el formulario controlado y lo lee un auditor. Redactalo como una nota de cierre profesional: qué se verificó, qué quedó observado y qué queda pendiente. Sin encabezados de chat, sin markdown, sin viñetas con asteriscos. Si no hay nada que observar, una o dos líneas alcanzan.

Si te paso "Respuestas del usuario", son la aclaración a preguntas que hiciste antes: incorporalas como evidencia válida y NO vuelvas a preguntar lo mismo.`;

// Formato del informe. Lo comparte la auditoría de la SS
// (service-request-complete-audit.ts): la misma ventana muestra los dos.
export const AUDIT_RESULT_SCHEMA: Anthropic.Tool["input_schema"] = {
  type: "object",
  additionalProperties: false,
  properties: {
    verdict: {
      type: "string",
      enum: ["CONFORME", "CON_OBSERVACIONES", "NO_CONFORME"],
      description: "CONFORME: la evidencia sostiene el cierre. CON_OBSERVACIONES: se puede cerrar pero hay que dejar registro. NO_CONFORME: falta evidencia esencial o hay un desvío de seguridad (la sola falta de LOTO o Permiso de Trabajo vinculado NO alcanza para NO_CONFORME).",
    },
    summary: { type: "string", description: "2 o 3 líneas: qué se auditó y a qué conclusión llegaste." },
    findings: {
      type: "array",
      description: "Como máximo 3 hallazgos, los más graves primero. Sólo lo importante: nada de detalles de forma. Vacío si no hay ninguno.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          criterion: { type: "string", description: 'Criterio citado: "ISM 10.2.4", "TMSA 4A.2", "Buena práctica: …".' },
          evidence: { type: "string", description: "Qué muestra (o qué falta en) la evidencia del registro auditado." },
          recommendedAction: { type: "string", description: "Corrección concreta para cerrar la brecha." },
          severity: { type: "string", enum: ["MAYOR", "MENOR", "OBSERVACION"] },
        },
        required: ["criterion", "evidence", "recommendedAction", "severity"],
      },
    },
    nextSteps: {
      type: "array",
      description: "Como máximo 2 próximos pasos concretos tras el cierre, los más importantes (abrir OT por los pendientes, registrar el defecto, abrir MOC, programar la inspección…). Vacío si no hace falta ninguno.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          action: { type: "string", description: "Qué hacer, en imperativo y con el alcance concreto." },
          why: { type: "string", description: "Por qué: qué dato del registro auditado lo dispara." },
          module: {
            type: "string",
            enum: ["ORDEN_DE_TRABAJO", "DEFECTO", "SOLICITUD_DE_SERVICIO", "DIFERIMIENTO", "MOC", "RCA", "PLAN_DE_MANTENIMIENTO", "REPUESTOS", "INSPECCION", "CERTIFICADO", "PERMISO_DE_TRABAJO", "OTRO"],
            description: "Módulo del sistema donde se hace.",
          },
        },
        required: ["action", "why", "module"],
      },
    },
    questions: {
      type: "array",
      description: "Máximo 2 dudas, las más importantes: las que la evidencia no resuelve y pueden cambiar el veredicto. Cada una contestable en una línea. Vacío si no tenés dudas.",
      items: { type: "string" },
    },
    observationsText: { type: "string", description: "Nota de cierre lista para pegar en el campo Observaciones." },
  },
  required: ["verdict", "summary", "findings", "nextSteps", "questions", "observationsText"],
};

// La OT suma al informe común el consumo que la evidencia cuenta y no quedó
// registrado: con eso la ventana ofrece registrarlo por el usuario.
const WO_AUDIT_RESULT_SCHEMA: Anthropic.Tool["input_schema"] = {
  ...AUDIT_RESULT_SCHEMA,
  properties: {
    ...(AUDIT_RESULT_SCHEMA.properties as Record<string, unknown>),
    consumoSinRegistrar: {
      type: "array",
      description: "Repuestos o materiales que la evidencia dice que se usaron, con cantidad conocida, y que la OT no tiene registrados. Vacío si no hay ninguno.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          descripcion: { type: "string", description: 'Qué se usó, como lo dice la evidencia ("Aceite SAE 80W-90", "Filtro de combustible").' },
          cantidad: { type: "number", description: "Cuánto se usó." },
          unidad: { type: "string", description: "Unidad de la cantidad: l, ud, kg, m…" },
        },
        required: ["descripcion", "cantidad", "unidad"],
      },
    },
  },
  required: [...(AUDIT_RESULT_SCHEMA.required as string[]), "consumoSinRegistrar"],
};

const AUDIT_TOOL: Anthropic.Tool = {
  name: "wo_close_audit",
  description: "Registra la auditoría de cierre de la orden de trabajo.",
  input_schema: WO_AUDIT_RESULT_SCHEMA,
};

export interface WoCloseAuditDraft {
  /** RESULTADO elegido en el cierre (SATISFACTORY / WITH_DEFICIENCIES). */
  woResult?: string | null;
  /** RESPONSABLE del trabajo. */
  executedByName?: string | null;
  completedDate?: string | null;
  runningHoursAtExecution?: number | null;
  actualHours?: number | null;
  observations?: string | null;
  /** Deficiencias encontradas (van al registro de defecto, no a la OT). */
  deficiencias?: string | null;
  /** DETALLE DE PENDIENTES (MATERIALES/TAREAS) del formulario. */
  pendingDetail?: string | null;
  /** TAREA CONCLUIDA? del formulario: "YES" | "NO" | "". */
  taskCompleted?: string | null;
  /** Repuestos que se van a descontar del stock al cerrar. */
  spareUsages?: Array<{ spareId?: string | null; name?: string | null; qty?: number | null; unit?: string | null }>;
  /**
   * Repuestos y materiales de la sección 4 tal como están en pantalla. Se
   * guardan solos con una demora: si el usuario carga uno y cierra enseguida,
   * la base todavía no lo tiene. Sin esto la auditoría leía la base y lo daba
   * por faltante. Ausente: se usa lo guardado.
   */
  plannedItems?: Array<{ kind?: string | null; description?: string | null; quantity?: number | null; unit?: string | null }>;
}

/** Ítems de la sección 4 que ve la auditoría: los de pantalla si vinieron, si no los guardados. */
function woItems(ctx: any, draft: WoCloseAuditDraft): Array<{ kind: string; description: string; quantity: number | null; unit: string | null }> {
  const raw: any[] = Array.isArray(draft.plannedItems) ? draft.plannedItems : (ctx.plannedItems ?? []);
  return raw
    .map(i => ({
      kind: i?.kind === "MATERIAL" ? "MATERIAL" : "SPARE",
      description: String(i?.description ?? "").trim(),
      quantity: i?.quantity == null ? null : Number(i.quantity),
      unit: i?.unit ? String(i.unit) : null,
    }))
    .filter(i => i.description);
}

/**
 * Consumo que la evidencia cuenta y la OT no registró, ya ubicado en el
 * catálogo del buque. La ventana pregunta si se registra por el usuario.
 */
export interface WoConsumptionOfferItem {
  /** Qué se usó, como lo dice la evidencia. */
  description: string;
  quantity: number;
  unit: string;
  /** Ficha del buque a la que se descuenta. null: no está en el catálogo. */
  spare: { id: string; sku: string; name: string; unit: string; onHand: number } | null;
}

export interface WoCloseAuditFinding {
  criterion: string;
  evidence: string;
  recommendedAction: string;
  severity: "MAYOR" | "MENOR" | "OBSERVACION";
}

export interface WoCloseAuditNextStep {
  action: string;
  why: string;
  module: string;
}

export interface WoCloseAuditResult {
  verdict: "CONFORME" | "CON_OBSERVACIONES" | "NO_CONFORME";
  summary: string;
  findings: WoCloseAuditFinding[];
  nextSteps: WoCloseAuditNextStep[];
  questions: string[];
  observationsText: string;
  /** Sólo la OT: consumo sin registrar que se ofrece registrar. */
  consumptionOffer?: WoConsumptionOfferItem[];
}

const iso =(d: unknown): string | null =>
  d instanceof Date ? d.toISOString().slice(0, 10) : (typeof d === "string" && d ? d.slice(0, 10) : null);

const txt = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : v == null ? "" : String(v);
  return s ? s : null;
};

/**
 * Análisis de condición de la OT (los FA: aceite, megado, vibraciones,
 * termografía), con su resultado y si el informe del laboratorio o del taller
 * quedó adjunto. Son la evidencia de las mediciones: sin esto la auditoría
 * pedía "el informe de mediciones del taller" cuando ya estaba cargado.
 */
export async function loadConditionAnalyses(
  prisma: any,
  tenantId: string,
  workOrderId: string,
): Promise<Array<Record<string, unknown>>> {
  if (!prisma || !workOrderId) return [];
  const rows: any[] = await prisma.fluidSample.findMany({
    where: { tenantId, sourceWorkOrderId: workOrderId, deletedAt: null },
    select: {
      sampleCode: true, assetId: true, kind: true, fluidType: true, labName: true, labReference: true, sampledAt: true,
      result: { select: { verdict: true, summary: true, reportUrl: true } },
    },
    orderBy: { sampleCode: "asc" },
  });
  if (rows.length === 0) return [];
  const assets: Array<{ id: string; name: string | null }> = await prisma.asset.findMany({
    where: { tenantId, id: { in: [...new Set(rows.map(r => r.assetId))] } },
    select: { id: true, name: true },
  });
  const nameOf = new Map(assets.map(a => [a.id, a.name]));
  return rows.map(r => ({
    codigo: r.sampleCode,
    equipo: nameOf.get(r.assetId) ?? null,
    tipo: r.kind === "FLUID" ? `FLUID ${r.fluidType ?? ""}`.trim() : r.kind,
    laboratorioOTaller: txt(r.labName),
    numeroDeInforme: txt(r.labReference),
    fechaDeMedicion: iso(r.sampledAt),
    resultadoCargado: !!r.result,
    veredicto: r.result?.verdict ?? null,
    resumenDelResultado: txt(r.result?.summary)?.slice(0, 300) ?? null,
    informeAdjunto: !!r.result?.reportUrl,
  }));
}

/** Tope de ítems que se ofrecen registrar: una OT real no olvida más. */
const MAX_CONSUMPTION_OFFER = 5;

/** Palabras con números de dos o más caracteres: grados SAE, medidas, part numbers. */
const specTokens = (text: string) =>
  normalizeText(text).split(" ").filter(t => t.length >= 2 && /\d/.test(t));

/**
 * La ficha tiene que nombrar la especificación de lo que se usó. Si el avance
 * dice "aceite SAE 80W-90" y la ficha es "Aceite lubricante para Volvo Penta",
 * NO es esa ficha aunque la IA diga que sí (pasó en las pruebas, con certeza
 * alta). Un match equivocado descuenta stock de otro repuesto.
 */
function specsMatch(description: string, spare: SpareCandidate): boolean {
  const wanted = specTokens(description);
  if (wanted.length === 0) return true;
  // Se compara sin espacios ni guiones: "15W-40" y "15W40" son lo mismo.
  const have = normalizeText([
    spare.name, spare.sku, spare.longDescription, spare.model,
    spare.manufacturerPartNumber, spare.internalPartNumber,
  ].filter(Boolean).join(" ")).replace(/ /g, "");
  return wanted.every(t => have.includes(t));
}

/**
 * Ubica en el catálogo del buque lo que la IA vio consumido y sin registrar.
 *
 * Mismo emparejador que la recepción de remitos (spare-match + desempate por
 * IA): la descripción de un avance ("aceite de la pata") casi nunca coincide
 * letra por letra con la ficha. Lo que no aparece en el catálogo vuelve con
 * `spare: null` y la pantalla lo anota como material, sin mover stock.
 *
 * No se ofrece lo que la OT ya tiene (el mismo repuesto descontado o el mismo
 * material anotado): registrar dos veces es peor que no registrar.
 *
 * Nunca rompe la auditoría: si algo falla, simplemente no hay oferta.
 */
async function resolveUnregisteredConsumption(
  session: TenantAccessSession,
  wo: { id: string; tenantId: string; vesselCode?: string },
  raw: unknown,
  ctx: any,
  draft: WoCloseAuditDraft,
): Promise<WoConsumptionOfferItem[]> {
  const items = (Array.isArray(raw) ? raw : [])
    .map((r: any) => ({
      description: String(r?.descripcion ?? "").trim(),
      quantity: Number(r?.cantidad),
      unit: String(r?.unidad ?? "").trim() || "ud",
    }))
    .filter(i => i.description && Number.isFinite(i.quantity) && i.quantity > 0 && i.quantity <= 1000)
    .slice(0, MAX_CONSUMPTION_OFFER);
  const prisma = getPrismaClient();
  if (items.length === 0 || !prisma || !wo.vesselCode) return [];

  try {
    const movements: Array<{ spareId: string }> = await (prisma as any).stockMovement.findMany({
      where: { tenantId: wo.tenantId, referenceType: "WORK_ORDER", referenceId: wo.id },
      select: { spareId: true },
    });
    const usedSpareIds = new Set<string>([
      ...movements.map(m => m.spareId),
      ...(draft.spareUsages ?? []).map(u => u.spareId ?? "").filter(Boolean),
    ]);
    const materials: string[] = woItems(ctx, draft)
      .filter(i => i.kind === "MATERIAL")
      .map((i: any) => normalizeText(String(i.description ?? "")))
      .filter(Boolean);
    const alreadyMaterial = (d: string) => {
      const n = normalizeText(d);
      return materials.some(m => m === n || m.includes(n) || n.includes(m));
    };

    const catalog = await loadVesselCatalog(prisma, wo.tenantId, wo.vesselCode);
    const byId = new Map(catalog.map(c => [c.id, c]));
    // Primero por texto; la IA decide entre los parecidos sabiendo en qué
    // equipo se usó (el mismo filtro existe para varios motores).
    const chosen: Array<SpareCandidate | null> = items.map(() => null);
    const textMatch: Array<SpareCandidate | null> = items.map(() => null);
    const pending: AiLineInput[] = [];
    items.forEach((it, idx) => {
      const r = matchSpare({ description: it.description }, catalog);
      if (r.status === "matched" && r.best) textMatch[idx] = r.best.candidate;
      if (r.candidates.length > 0) {
        pending.push({
          line: idx + 1,
          description: `${it.description} (usado en: ${ctx.assetLabel ?? "—"})`,
          candidates: r.candidates.map(c => c.candidate),
        });
      }
    });
    // La certeza de la IA sola no alcanza (el aceite equivocado vino con
    // certeza alta y los aciertos del generador con media): lo que protege es
    // que la ficha nombre la especificación (specsMatch), y el usuario ve la
    // ficha propuesta y puede destildarla. "low" es conjetura: no se usa.
    const decided = new Set<number>();
    if (pending.length > 0) {
      for (const d of await matchSparesByAi(session, wo.vesselCode, pending, "wo_close_audit_spares")) {
        decided.add(d.line);
        const spare = d.spareId && d.confidence !== "low" ? byId.get(d.spareId) : undefined;
        if (spare) chosen[d.line - 1] = spare;
      }
    }
    // Sin respuesta de la IA vale el emparejamiento por texto, si fue claro.
    items.forEach((it, idx) => {
      if (!decided.has(idx + 1)) chosen[idx] = textMatch[idx];
      const s = chosen[idx];
      if (s && !specsMatch(it.description, s)) chosen[idx] = null;
    });

    const out: WoConsumptionOfferItem[] = [];
    items.forEach((it, idx) => {
      const s = chosen[idx];
      if (!s) {
        if (!alreadyMaterial(it.description)) out.push({ ...it, spare: null });
        return;
      }
      if (usedSpareIds.has(s.id)) return;
      // Dos líneas que caen en la misma ficha: un solo consumo con la suma.
      const prev = out.find(o => o.spare?.id === s.id);
      if (prev) { prev.quantity += it.quantity; return; }
      out.push({
        ...it,
        unit: s.unit,
        spare: { id: s.id, sku: s.sku, name: s.name, unit: s.unit, onHand: s.onHand },
      });
    });
    return out;
  } catch (err) {
    log.error(`[${FEATURE}] consumption lookup failed:`, err);
    return [];
  }
}

/**
 * Arma el JSON que ve la IA. Sale del mismo contexto que imprime el formulario
 * controlado, así que auditar y firmar miran EXACTAMENTE lo mismo. Se dejan
 * afuera los Buffers (logos, firmas, fotos): del adjunto sólo importa que exista.
 */
function buildAuditPayload(
  ctx: any,
  draft: WoCloseAuditDraft,
  answers: Record<string, string>,
  sobreElBuque?: string | null,
  analisisDeCondicion: Array<Record<string, unknown>> = [],
) {
  const wo = ctx.wo ?? {};
  return {
    orden: {
      codigo: wo.workOrderCode,
      buque: ctx.vesselName ?? wo.vesselCode,
      sobreElBuque: sobreElBuque ?? null,
      equipo: ctx.assetLabel,
      equipoCritico: !!ctx.assetIsSafetyCritical,
      criticidad: wo.criticality,
      tipo: wo.type,
      tipoMantenimiento: wo.maintenanceKind,
      estado: wo.status,
      prioridad: wo.priority,
      sistema: wo.systemArea,
      condicionOperativa: wo.operatingCondition,
      ubicacion: txt(wo.location),
      viaje: txt(wo.voyageNumber),
      fechaApertura: iso(wo.openDate),
      fechaVencimiento: iso(wo.dueDate),
      fechaInicio: iso(wo.startDate),
      fechaCierre: iso(wo.completedDate),
      itemDelPlan: ctx.planTaskCode,
      vieneDeUnPlan: !!wo.maintenancePlanId,
    },
    trabajo: {
      trabajoSolicitado: txt(wo.description),
      tarea: txt(wo.title),
      criteriosDeAceptacion: txt(wo.acceptanceCriteria),
      loto: txt(wo.loto),
      nivelDeRiesgo: txt(wo.riskLevel),
      analisisDeRiesgo: txt(wo.riskAnalysisResult),
      matrizRiesgoProbabilidad: ctx.riskProbability,
      matrizRiesgoConsecuencia: ctx.riskConsequence,
      consecuenciaRcm: wo.consequenceCategory,
      justificacionRcm: txt(wo.consequenceRationale),
    },
    responsables: {
      solicitadoPorArea: wo.requestedByArea,
      asignadoAArea: wo.assignedToArea,
      tecnicoAsignado: ctx.assignedName,
      calificacionDelTecnico: ctx.assignedQualification ?? null,
      abiertaPor: ctx.createdByName,
      talleres: ctx.providerNames ?? [],
    },
    tramitacion: {
      enviadoAAprobar: iso(wo.enviadoAprobacionAt),
      aprobadaPor: txt(wo.aprobadoByName),
      autorizadaPor: txt(wo.autorizadoByName),
      firmasCargadas: {
        solicita: !!ctx.solicitaSignatureBuffer,
        aprueba: !!ctx.apruebaSignatureBuffer,
        autoriza: !!ctx.autorizaSignatureBuffer,
        cierra: !!ctx.cierraSignatureBuffer,
        responsable: !!ctx.assignedSignatureBuffer,
      },
    },
    seguridad: {
      permisosDeTrabajoVinculados: ctx.permitTypes ?? [],
    },
    materiales: {
      // Los dos recuadros de la sección 4 significan cosas distintas: los
      // repuestos son lo PREVISTO (se descuentan al consumirse); los materiales
      // no mueven stock y la fila ES el registro de lo usado. Antes iban juntos
      // como "planificados" y la IA marcaba como no registrado un aceite que
      // estaba cargado en Materiales.
      repuestosPrevistos: woItems(ctx, draft).filter(i => i.kind !== "MATERIAL"),
      materialesRegistrados: woItems(ctx, draft).filter(i => i.kind === "MATERIAL"),
      consumidosRegistrados: ctx.spareUsages ?? [],
      // Lo que el usuario está por descontar en este mismo cierre.
      aConsumirEnEsteCierre: draft.spareUsages ?? [],
    },
    programacion: (ctx.scheduleRows ?? []).map((r: any) => ({
      fecha: iso(r.date), tecnico: r.technician, lugar: r.place, empresa: r.company, horas: r.time,
    })),
    avances: (ctx.progressNotes ?? []).map((n: any) => ({
      tipo: n.kind, texto: txt(n.text), fecha: iso(n.createdAt),
    })),
    fotosDeAvance: (ctx.progressPhotos ?? []).length,
    solicitudesDeServicio: ctx.serviceRequestCodes ?? [],
    analisisDeCondicion,
    documentos: {
      checklistCargado: !!txt(wo.checklistDocUrl),
      respaldoCargado: !!txt(wo.supportingDocUrl),
    },
    cierreQueSeEstaPorRegistrar: {
      resultado: txt(draft.woResult),
      responsable: txt(draft.executedByName),
      fecha: iso(draft.completedDate),
      horasDeMaquinaDelEquipo: draft.runningHoursAtExecution ?? null,
      horasHombre: draft.actualHours ?? null,
      tareaConcluida: draft.taskCompleted === "YES" ? "SI" : draft.taskCompleted === "NO" ? "NO" : null,
      detalleDePendientes: txt(draft.pendingDetail) ?? txt(wo.pendingDetail),
      deficienciasEncontradas: txt(draft.deficiencias),
      observaciones: txt(draft.observations),
    },
    respuestasDelUsuario: Object.entries(answers)
      .filter(([, v]) => (v ?? "").trim())
      .map(([pregunta, respuesta]) => ({ pregunta, respuesta: respuesta.trim() })),
  };
}

export async function auditWorkOrderClose(
  session: TenantAccessSession,
  workOrderId: string,
  body: { draft?: WoCloseAuditDraft; answers?: Record<string, string> },
): Promise<WoCloseAuditResult> {
  const apiKey = aiApiKey();
  if (!apiKey) throw new RouteError(503, "AI_NOT_CONFIGURED", aiApiKeyName() + " no esta configurada.");

  await assertAiBudgetAvailableBySlug(session.tenantSlug);

  // Misma lectura que el PDF del formulario: auditar y firmar miran lo mismo.
  // Ya filtra por tenant y vessel scope (getTenantWorkOrder).
  const ctx = await loadWorkOrderPdfContext(session, workOrderId);
  const wo = ctx.wo as { id: string; tenantId: string; vesselCode?: string };
  const payload = buildAuditPayload(
    ctx, body.draft ?? {}, body.answers ?? {},
    await getVesselAiContext(session.tenantSlug, wo?.vesselCode),
    await loadConditionAnalyses(getPrismaClient(), wo.tenantId, wo.id),
  );

  // Razonamiento extendido DESACTIVADO: Sonnet 5 lo trae activo y en tareas
  // largas consume todo el presupuesto pensando, sin llegar a emitir la
  // respuesta (stop_reason=max_tokens, tool_use vacío).
  const client = createAiClient({ apiKey, timeout: 120_000, maxRetries: 1 });
  const model = AI_MODEL.deep;
  const aiStarted = Date.now();
  const locale = await getTenantAiLocale(session.tenantSlug);

  let response;
  try {
    response = await client.messages.create({
      model,
      max_tokens: 8192,
      thinking: { type: "disabled" },
      system: [
        { type: "text", text: localeInstruction(locale) },
        { type: "text", text: AUDIT_PROMPT, cache_control: { type: "ephemeral" } },
      ],
      tools: [AUDIT_TOOL],
      tool_choice: { type: "tool", name: "wo_close_audit" },
      messages: [{
        role: "user",
        content: `${localeUserReminder(locale)}\nAuditá el cierre de esta orden de trabajo:\n${JSON.stringify(payload, null, 2)}`,
      }],
    });
    log.info(`[${FEATURE}] responded in ${Date.now() - aiStarted}ms (in=${response.usage.input_tokens} out=${response.usage.output_tokens})`);
  } catch (err) {
    log.error(`[${FEATURE}] AI call failed after ${Date.now() - aiStarted}ms:`, err);
    throw new RouteError(502, "AI_CALL_FAILED", "No se pudo generar la auditoria de cierre.");
  }

  (async () => {
    const tenant = await getCachedTenantBySlug(session.tenantSlug);
    if (!tenant) return;
    recordAiUsage({
      tenantId: tenant.id,
      tenantSlug: session.tenantSlug,
      userId: session.user.id,
      userEmail: session.user.email,
      vesselCode: (ctx.wo as any)?.vesselCode ?? null,
      feature: FEATURE,
      model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
      latencyMs: Date.now() - aiStarted,
    });
  })().catch(() => { /* swallow */ });

  const toolBlock = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!toolBlock) throw new RouteError(502, "AI_CALL_FAILED", "La IA no devolvio una auditoria estructurada.");
  const out = toolBlock.input as Partial<WoCloseAuditResult> & { consumoSinRegistrar?: unknown };
  const consumptionOffer = await resolveUnregisteredConsumption(session, wo, out.consumoSinRegistrar, ctx, body.draft ?? {});
  return { ...normalizeAuditResult(out), consumptionOffer };
}

/** Sanea la salida del modelo: la consume una ventana, no puede venir rota. */
/** Orden de gravedad para quedarse con lo más importante. */
const SEVERITY_RANK: Record<WoCloseAuditFinding["severity"], number> = { MAYOR: 0, MENOR: 1, OBSERVACION: 2 };

export function normalizeAuditResult(out: Partial<WoCloseAuditResult>): WoCloseAuditResult {
  const verdict = out.verdict === "CONFORME" || out.verdict === "NO_CONFORME" || out.verdict === "CON_OBSERVACIONES"
    ? out.verdict
    : "CON_OBSERVACIONES";

  return {
    verdict,
    summary: String(out.summary ?? "").trim(),
    findings: (Array.isArray(out.findings) ? out.findings : []).map(f => ({
      criterion: String(f?.criterion ?? "").trim(),
      evidence: String(f?.evidence ?? "").trim(),
      recommendedAction: String(f?.recommendedAction ?? "").trim(),
      severity: (f?.severity === "MAYOR" || f?.severity === "MENOR" ? f.severity : "OBSERVACION") as WoCloseAuditFinding["severity"],
    })).filter(f => f.criterion || f.evidence)
      // Sólo lo más importante (pedido del usuario): los 3 más graves. El
      // prompt ya lo pide; esto es el tope duro por si la IA se pasa.
      .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
      .slice(0, 3),
    nextSteps: (Array.isArray(out.nextSteps) ? out.nextSteps : []).map(s => ({
      action: String(s?.action ?? "").trim(),
      why: String(s?.why ?? "").trim(),
      module: String(s?.module ?? "OTRO").trim(),
    })).filter(s => s.action).slice(0, 2),
    // Tope duro: el prompt pide 2 (sólo lo más importante, pedido del usuario),
    // pero la lista la consume un formulario y la IA puede pasarse.
    questions: (Array.isArray(out.questions) ? out.questions : [])
      .map(q => String(q ?? "").trim()).filter(Boolean).slice(0, 2),
    observationsText: String(out.observationsText ?? "").trim(),
  };
}
