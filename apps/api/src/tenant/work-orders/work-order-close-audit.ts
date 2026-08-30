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

const FEATURE = "wo_close_audit";

// Cláusulas del Capítulo 10 del Código ISM, literales. Son las mismas que usa el
// módulo /ism (ism-ai-suggestions.ts): el informe tiene que citar el criterio
// real, no una paráfrasis inventada por el modelo.
const ISM_CLAUSES = `10.1 — La Compañía debe establecer procedimientos para asegurar que el buque se mantiene de conformidad con las reglas y reglamentos pertinentes y con cualquier requisito adicional que establezca la Compañía.
10.2.1 — Las inspecciones se realizan a intervalos apropiados.
10.2.2 — Toda no conformidad se notifica, indicando su posible causa, si se conoce.
10.2.3 — Se adoptan las medidas correctivas apropiadas.
10.2.4 — Se conserva registro de estas actividades.
10.3 — La Compañía identifica el equipo y los sistemas técnicos cuyo fallo repentino pueda ocasionar situaciones peligrosas, y prevé medidas para promover su fiabilidad, incluida la prueba periódica de equipos de reserva o no usados de forma continua.
10.4 — Las inspecciones de 10.2 y las medidas de 10.3 se integran en las operaciones ordinarias de mantenimiento del buque.`;

// Grupos de evidencia del Elemento 4 que el propio PMS audita (tmsa-service.ts).
// Se listan para que los hallazgos se anclen a un requisito que el sistema ya
// mide, y no a un número de TMSA inventado.
const TMSA_ELEMENTS = `4.1 — Cobertura del PMS y uso del sistema de defectos.
4.2 — Equipo crítico, certificados, inspecciones y especificación de varada.
4.3 — Mantenimiento planificado ejecutado en fecha y control de diferimientos.
4.4 — Repuestos críticos y auditoría de ingeniería.
4.5 — Monitoreo de condición (CBM): análisis de fluidos, vibraciones, termografía.
4A.2 — Permiso de Trabajo en equipo crítico.
7 — Gestión del cambio (MOC) cuando la intervención modifica el equipo o el procedimiento.
8 — Análisis de falla / RCA cuando hubo falla.`;

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
- Seguridad: ¿el trabajo requería Permiso de Trabajo, LOTO o análisis de riesgo? ¿Están y están cerrados? Si el equipo es crítico (ISM 10.3), el estándar es más exigente.
- Registro (ISM 10.2.4): ¿quedó quién lo hizo, cuándo, con qué horas de máquina, qué repuestos se usaron?
- Repuestos: ¿lo planificado coincide con lo consumido? Una diferencia sin explicar es un hallazgo.
- Pendientes: si quedó algo pendiente, o si la tarea NO se concluyó, eso NO se cierra y se olvida: tiene que quedar planificado en algún lado.
- Trazabilidad: ¿hay defecto, diferimiento, MOC, RCA o SS que debería haberse abierto y no se abrió?
- Plan de mantenimiento: si la OT viene de un plan, ¿el cierre alcanza para acreditar la ejecución del plan?

REGLAS INNEGOCIABLES
- Auditás SÓLO con la evidencia que te paso. No inventes datos, fechas, valores ni normas.
- Lo que no podés determinar con la evidencia NO es un hallazgo: es una PREGUNTA para el usuario.
- Cada hallazgo cita el criterio concreto ("ISM 10.2.4", "TMSA 4A.2", "Buena práctica: …"). Nada de "no cumple con las normas".
- Si la OT está bien, decilo y no inventes hallazgos para justificar el análisis.
- Cada próximo paso tiene que ser una acción concreta y accionable en este sistema. Si quedaron pendientes, el paso es abrir la OT que los resuelve, con qué equipo y qué alcance. Si apareció una falla, abrir el defecto. Si hay que postergar, el diferimiento. Si se cambió el equipo o el procedimiento, el MOC.
- Escribí para un Jefe de Máquinas: técnico, corto, sin relleno y sin adular.

CAMPO "observationsText"
Es el texto que se va a pegar tal cual en el campo Observaciones de la OT, que se imprime en el formulario controlado y lo lee un auditor. Redactalo como una nota de cierre profesional: qué se verificó, qué quedó observado y qué queda pendiente. Sin encabezados de chat, sin markdown, sin viñetas con asteriscos. Si no hay nada que observar, una o dos líneas alcanzan.

Si te paso "Respuestas del usuario", son la aclaración a preguntas que hiciste antes: incorporalas como evidencia válida y NO vuelvas a preguntar lo mismo.`;

const AUDIT_TOOL: Anthropic.Tool = {
  name: "wo_close_audit",
  description: "Registra la auditoría de cierre de la orden de trabajo.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      verdict: {
        type: "string",
        enum: ["CONFORME", "CON_OBSERVACIONES", "NO_CONFORME"],
        description: "CONFORME: la evidencia sostiene el cierre. CON_OBSERVACIONES: se puede cerrar pero hay que dejar registro. NO_CONFORME: falta evidencia esencial o hay un desvío de seguridad.",
      },
      summary: { type: "string", description: "2 o 3 líneas: qué se auditó y a qué conclusión llegaste." },
      findings: {
        type: "array",
        description: "Hallazgos de la auditoría. Vacío si no hay ninguno.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            criterion: { type: "string", description: 'Criterio citado: "ISM 10.2.4", "TMSA 4A.2", "Buena práctica: …".' },
            evidence: { type: "string", description: "Qué muestra (o qué falta en) la evidencia de esta OT." },
            recommendedAction: { type: "string", description: "Corrección concreta para cerrar la brecha." },
            severity: { type: "string", enum: ["MAYOR", "MENOR", "OBSERVACION"] },
          },
          required: ["criterion", "evidence", "recommendedAction", "severity"],
        },
      },
      nextSteps: {
        type: "array",
        description: "Próximos pasos concretos tras el cierre (abrir OT por los pendientes, registrar el defecto, abrir MOC, programar la inspección…). Vacío si no hace falta ninguno.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            action: { type: "string", description: "Qué hacer, en imperativo y con el alcance concreto." },
            why: { type: "string", description: "Por qué: qué dato de esta OT lo dispara." },
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
        description: "Máximo 5 dudas que la evidencia no resuelve y que cambian la conclusión. Cada una contestable en una línea. Vacío si no tenés dudas.",
        items: { type: "string" },
      },
      observationsText: { type: "string", description: "Nota de cierre lista para pegar en el campo Observaciones." },
    },
    required: ["verdict", "summary", "findings", "nextSteps", "questions", "observationsText"],
  },
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
  spareUsages?: Array<{ name?: string | null; qty?: number | null; unit?: string | null }>;
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
}

const iso = (d: unknown): string | null =>
  d instanceof Date ? d.toISOString().slice(0, 10) : (typeof d === "string" && d ? d.slice(0, 10) : null);

const txt = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : v == null ? "" : String(v);
  return s ? s : null;
};

/**
 * Arma el JSON que ve la IA. Sale del mismo contexto que imprime el formulario
 * controlado, así que auditar y firmar miran EXACTAMENTE lo mismo. Se dejan
 * afuera los Buffers (logos, firmas, fotos): del adjunto sólo importa que exista.
 */
function buildAuditPayload(ctx: any, draft: WoCloseAuditDraft, answers: Record<string, string>, sobreElBuque?: string | null) {
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
      planificados: ctx.plannedItems ?? [],
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
  const payload = buildAuditPayload(
    ctx, body.draft ?? {}, body.answers ?? {},
    await getVesselAiContext(session.tenantSlug, ctx.wo?.vesselCode),
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
  const out = toolBlock.input as Partial<WoCloseAuditResult>;

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
    })).filter(f => f.criterion || f.evidence),
    nextSteps: (Array.isArray(out.nextSteps) ? out.nextSteps : []).map(s => ({
      action: String(s?.action ?? "").trim(),
      why: String(s?.why ?? "").trim(),
      module: String(s?.module ?? "OTRO").trim(),
    })).filter(s => s.action),
    // Tope duro: el prompt pide 5, pero la lista la consume un formulario.
    questions: (Array.isArray(out.questions) ? out.questions : [])
      .map(q => String(q ?? "").trim()).filter(Boolean).slice(0, 5),
    observationsText: String(out.observationsText ?? "").trim(),
  };
}
