// Auditoría de IA al completar una Solicitud de Servicio ("Servicio recibido").
//
// Mismo criterio que la auditoría de cierre de la OT (work-order-close-audit.ts):
// la recepción es el momento en que la evidencia del trabajo del taller queda
// congelada. Lo que no se asentó ahí (quién recibió, si hubo conformidad, qué
// pasó en el camino) ya no se asienta más, y es lo que busca un auditor.
//
// Qué hace: lee la SS COMPLETA (la misma que se imprime en el formulario
// controlado), su hoja de ruta, las muestras que viajaron y lo que el usuario
// está cargando en la recepción, y devuelve el mismo informe que la OT.
//
// Qué NO hace: no decide ni frena. El informe sólo se guarda si el usuario acepta
// agregarlo a Observaciones.

import Anthropic from "@anthropic-ai/sdk";
import { createAiClient, AI_MODEL, aiApiKey, aiApiKeyName } from "../ai/ai-provider";
import { recordAiUsage, assertAiBudgetAvailableBySlug } from "../usage/usage-service";
import { log } from "../../common/logger";
import { RouteError } from "../../http/route-error";
import { getVesselAiContext } from "../ai/vessel-ai-context";
import type { TenantAccessSession } from "../auth/session-store";
import { getCachedTenantBySlug } from "../tenant-cache";
import { getTenantAiLocale, localeInstruction, localeUserReminder } from "../ai/ai-locale";
import { loadServiceRequestPdfContext } from "../pms/service-request-pdf/data-loader";
import { listHojaRuta, listServiceRequestLabSamples } from "./service-requests-service";
import {
  ISM_CLAUSES, TMSA_ELEMENTS, AUDIT_RESULT_SCHEMA, normalizeAuditResult,
  type WoCloseAuditResult,
} from "../work-orders/work-order-close-audit";

const FEATURE = "sr_complete_audit";

const AUDIT_PROMPT = `Sos auditor senior de Sistemas de Gestión de Mantenimiento de una naviera. Tenés experiencia en auditorías TMSA (OCIMF), verificaciones ISM de bandera y sociedad de clasificación, y en la gestión de servicios de talleres y laboratorios externos.

Te paso una Solicitud de Servicio (SS) que se está por dar por COMPLETADA: el taller o laboratorio terminó y el buque está registrando la recepción. La SS siempre cuelga de una Orden de Trabajo (OT) madre. Tu trabajo es auditarla como si estuvieras parado frente al Jefe de Máquinas antes de firmar la recepción: que el servicio se haya pedido, autorizado y recibido como corresponde, que la evidencia alcance para defenderlo en una auditoría, y que no queden cabos sueltos.

CRITERIOS CONTRA LOS QUE AUDITÁS

Capítulo 10 del Código ISM (Mantenimiento del buque y el equipo):
${ISM_CLAUSES}

TMSA — Elemento 4 (Reliability and Maintenance) y 4A:
${TMSA_ELEMENTS}

Además: las buenas prácticas de gestión de servicios de terceros y de mantenimiento propias del TIPO DE EQUIPO sobre el que trabajó el taller.

QUÉ REVISAR — la SS COMPLETA, no sólo la recepción
- Pedido: ¿está claro qué servicio se pidió, sobre qué equipo y por qué causa? ¿El taller o laboratorio está identificado?
- Tramitación: ¿se solicitó, aprobó y autorizó ANTES de mandar el trabajo al taller? ¿Están las firmas? Un envío sin autorización es un hallazgo.
- Hoja de ruta: ¿las fechas cierran (pedido → autorización → envío → recepción)? ¿Las novedades asentadas muestran algo que quedó sin resolver (demoras, faltantes, trabajo parcial)?
- Recepción: ¿quedó quién recibió y si hubo conformidad? Una recepción NO CONFORME no se completa y se olvida: tiene que tener un próximo paso (reclamo al taller, defecto, nueva SS o nueva OT).
- Coherencia: ¿la conformidad declarada se sostiene con lo que dicen la hoja de ruta, las observaciones y los comentarios? Un "conforme" con una novedad que habla de una falla es un hallazgo.
- Muestras de laboratorio: si viajaron muestras, ¿estaban numeradas? Si el resultado todavía no está cargado, el paso es cargarlo en Muestreos cuando llegue el informe.
- OT madre: la SS no cierra la OT. Si la OT sigue abierta, indicá qué evidencia de este servicio tiene que quedar en la OT para cerrarla.
- Seguridad: si el equipo es crítico (ISM 10.3) o el pedido marca "AFECTA SEGURIDAD", el estándar es más exigente.

REGLAS INNEGOCIABLES
- Auditás SÓLO con la evidencia que te paso. No inventes datos, fechas, valores ni normas.
- Lo que no podés determinar con la evidencia NO es un hallazgo: es una PREGUNTA para el usuario.
- Cada hallazgo cita el criterio concreto ("ISM 10.2.4", "TMSA 4.3", "Buena práctica: …"). Nada de "no cumple con las normas".
- Si la SS está bien, decilo y no inventes hallazgos para justificar el análisis.
- Cada próximo paso tiene que ser una acción concreta y accionable en este sistema (OT, defecto, SS, diferimiento, MOC, muestreo…), con el alcance concreto.
- Escribí para un Jefe de Máquinas: técnico, corto, sin relleno y sin adular.

CAMPO "observationsText"
Es el texto que se va a pegar tal cual en el campo Observaciones de la SS, que se imprime en el formulario controlado y lo lee un auditor. Redactalo como una nota de recepción profesional: qué se verificó, qué quedó observado y qué queda pendiente. Sin encabezados de chat, sin markdown, sin viñetas con asteriscos. Si no hay nada que observar, una o dos líneas alcanzan.

Si te paso "Respuestas del usuario", son la aclaración a preguntas que hiciste antes: incorporalas como evidencia válida y NO vuelvas a preguntar lo mismo.`;

const AUDIT_TOOL: Anthropic.Tool = {
  name: "sr_complete_audit",
  description: "Registra la auditoría de recepción de la solicitud de servicio.",
  input_schema: AUDIT_RESULT_SCHEMA,
};

export interface SrCompleteAuditDraft {
  /** ¿Quién recibe el servicio? */
  receivedByName?: string | null;
  /** Ítem recibido. */
  receptionItem?: string | null;
  /** Conformidad con el trabajo del tercero. */
  receptionConform?: boolean | null;
  /** Comentarios adicionales de la recepción. */
  closeNotes?: string | null;
}

const iso = (d: unknown): string | null =>
  d instanceof Date ? d.toISOString().slice(0, 10) : (typeof d === "string" && d ? d.slice(0, 10) : null);

const txt = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : v == null ? "" : String(v);
  return s ? s : null;
};

const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);

/**
 * Arma el JSON que ve la IA. Sale del mismo contexto que imprime el formulario
 * controlado: auditar y firmar la recepción miran lo mismo. Sin Buffers (logos,
 * firmas): de la firma sólo importa que exista.
 */
function buildAuditPayload(
  ctx: any,
  hojaRuta: Array<{ fecha: Date; novedad: string; asienta: string }>,
  samples: { items: any[]; carriesSamples: boolean },
  draft: SrCompleteAuditDraft,
  answers: Record<string, string>,
  sobreElBuque: string | null,
) {
  const sr = ctx.sr ?? {};
  const wo = ctx.wo ?? {};
  return {
    solicitud: {
      codigo: sr.serviceRequestCode,
      buque: ctx.vesselName ?? sr.vesselCode,
      sobreElBuque,
      estado: sr.status,
      prioridad: sr.priority,
      departamento: sr.department,
      fechaApertura: iso(sr.openDate),
      titulo: txt(sr.title),
      descripcionDelServicio: txt(sr.description),
      detalleDeLasCausas: txt(sr.causes),
      solicitudDeCompras: list(sr.purchaseRequestKinds),
      taller: ctx.providerName ?? txt(sr.tallerNotes),
      notasDelTaller: txt(sr.tallerNotes),
      comunicacion: list(sr.communicationMethod),
      distribucion: list(sr.distribution),
      observaciones: txt(sr.observations),
    },
    equipo: {
      nombre: ctx.assetLabel,
      equipoCritico: !!ctx.assetIsSafetyCritical,
    },
    ordenDeTrabajoMadre: {
      codigo: wo.workOrderCode ?? null,
      tarea: txt(wo.title),
      estado: wo.status ?? null,
    },
    tramitacion: {
      solicitadaPor: txt(sr.solicitaByName) ?? ctx.createdByFormName ?? ctx.createdByName,
      aprobadaPor: txt(sr.aprobadoByName),
      aprobadaEl: iso(sr.aprobadoAt),
      autorizadaPor: txt(sr.autorizadoByName),
      autorizadaEl: iso(sr.autorizadoAt),
      enviadaAlTallerEl: iso(sr.startedAt),
      firmasCargadas: {
        solicita: !!ctx.solicitaSignatureBuffer,
        aprueba: !!ctx.apruebaSignatureBuffer,
        autoriza: !!ctx.autorizaSignatureBuffer,
      },
      firmanElPie: { capitan: txt(sr.capitanName), jefeDeMaquinas: txt(sr.jefeMaquinasName) },
    },
    hojaDeRuta: hojaRuta.map(r => ({ fecha: iso(r.fecha), novedad: txt(r.novedad), asienta: txt(r.asienta) })),
    muestrasDeLaboratorio: samples.carriesSamples
      ? samples.items.map(s => ({
          equipo: s.assetName ?? null,
          codigo: s.sampleCode,
          numeroDeFrasco: txt(s.labReference),
          resultadoCargado: !!s.hasResult,
        }))
      : [],
    recepcionQueSeEstaPorRegistrar: {
      recibe: txt(draft.receivedByName),
      itemRecibido: txt(draft.receptionItem),
      conformidad: draft.receptionConform === true ? "CONFORME" : draft.receptionConform === false ? "NO CONFORME" : null,
      comentarios: txt(draft.closeNotes),
    },
    respuestasDelUsuario: Object.entries(answers)
      .filter(([, v]) => (v ?? "").trim())
      .map(([pregunta, respuesta]) => ({ pregunta, respuesta: respuesta.trim() })),
  };
}

export async function auditServiceRequestComplete(
  session: TenantAccessSession,
  serviceRequestId: string,
  body: { draft?: SrCompleteAuditDraft; answers?: Record<string, string> },
): Promise<WoCloseAuditResult> {
  // Auditar la recepción es parte de registrarla: mismo gate que completar.
  if (session.user.role === "AUDITOR_READONLY") {
    throw new RouteError(403, "FORBIDDEN", "No autorizado para gestionar solicitudes de servicio.");
  }
  const apiKey = aiApiKey();
  if (!apiKey) throw new RouteError(503, "AI_NOT_CONFIGURED", aiApiKeyName() + " no esta configurada.");

  await assertAiBudgetAvailableBySlug(session.tenantSlug);

  // Las tres lecturas filtran por tenant + vessel scope (getRequestOrThrow /
  // getServiceRequest) y tiran 404 si la SS no es visible para el usuario.
  const ctx = await loadServiceRequestPdfContext(session, serviceRequestId);
  const [hojaRuta, samples] = await Promise.all([
    listHojaRuta(session, serviceRequestId),
    listServiceRequestLabSamples(session, serviceRequestId),
  ]);
  const vesselCode: string | null = (ctx.sr as any)?.vesselCode ?? null;
  const payload = buildAuditPayload(
    ctx, hojaRuta, samples, body.draft ?? {}, body.answers ?? {},
    await getVesselAiContext(session.tenantSlug, vesselCode),
  );

  // Razonamiento extendido DESACTIVADO: Sonnet 5 lo trae activo y consume todo
  // el presupuesto pensando sin emitir la respuesta (ver work-order-close-audit).
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
      tool_choice: { type: "tool", name: "sr_complete_audit" },
      messages: [{
        role: "user",
        content: `${localeUserReminder(locale)}\nAuditá la recepción de esta solicitud de servicio:\n${JSON.stringify(payload, null, 2)}`,
      }],
    });
    log.info(`[${FEATURE}] responded in ${Date.now() - aiStarted}ms (in=${response.usage.input_tokens} out=${response.usage.output_tokens})`);
  } catch (err) {
    log.error(`[${FEATURE}] AI call failed after ${Date.now() - aiStarted}ms:`, err);
    throw new RouteError(502, "AI_CALL_FAILED", "No se pudo generar la auditoria de recepcion.");
  }

  (async () => {
    const tenant = await getCachedTenantBySlug(session.tenantSlug);
    if (!tenant) return;
    recordAiUsage({
      tenantId: tenant.id,
      tenantSlug: session.tenantSlug,
      userId: session.user.id,
      userEmail: session.user.email,
      vesselCode,
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
  return normalizeAuditResult(toolBlock.input as Partial<WoCloseAuditResult>);
}
