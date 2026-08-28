/**
 * Herramientas de consulta del copiloto — segunda mitad del catálogo.
 *
 * `copiloto-service.ts` define las tools núcleo (planes, órdenes de trabajo,
 * defectos, activos, repuestos, reportes diarios, tripulación, base documental).
 * Este archivo cubre el resto de los módulos del sistema para que el copiloto
 * pueda responder sobre CUALQUIER registro que el usuario ve en pantalla:
 * certificados, inspecciones, solicitudes de servicio, postergaciones, horas de
 * equipos, pedidos y movimientos de repuestos, proveedores, buques, reportes
 * mensuales y de viaje, bitácora, permisos de trabajo, cuasi accidentes,
 * auditorías externas, horas de descanso, checklists, MOC, insights y matriz de
 * competencias.
 *
 * Reglas que valen para TODAS las tools de este archivo:
 *   - Toda query filtra por `tenantId`. Sin excepción.
 *   - El alcance por buque sale de `VesselScope` (fail-closed: sin buques
 *     asignados no se devuelve nada).
 *   - Los resultados se devuelven vallados con `wrapUntrusted` porque contienen
 *     texto libre cargado por usuarios.
 *   - Nunca se exponen IDs internos como dato de salida: se resuelven a nombres.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { getPrismaClient } from "../../platform/data/prisma-client";
import {
  applyVesselWhereScope,
  applyVesselWhereScopeOn,
  attachAssetNames,
  attachProviderNames,
  daysUntil,
  deniedVesselResponse,
  expiryStatus,
  textSearchWhere,
  toolResult,
  wrapUntrusted,
  type VesselScope,
} from "./copilot-tool-utils";

// ---------------------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------------------

export const EXTENDED_COPILOT_TOOLS: Anthropic.Tool[] = [
  // ── Cumplimiento y certificación ──────────────────────────────────────────
  {
    name: "query_certificates",
    description:
      "Query the vessel's statutory and class certificates (certificados del buque: matrícula, seguridad, arqueo, clase, bandera, seguros, etc.). USE THIS whenever the user asks which certificates are expired or about to expire ('certificados vencidos', 'qué vence este mes'), for the validity of a specific certificate, its issuing authority or its last inspection. Returns certificateCode, name, issuingAuthority, issueDate, expiryDate, daysToExpiry and a computed expiryStatus (EXPIRED / EXPIRING_SOON / VALID). Sentinel dates used in historical loads: expiryDate in year 2099 means 'no expiry / permanent' and a date in year 2000 means 'original date unknown' — read the `notes` field before reporting those as expired.",
    input_schema: {
      type: "object" as const,
      properties: {
        vesselCode:         { type: "string",  description: "Filter by vessel code (optional — omit to include all accessible vessels)" },
        status:             { type: "string",  description: "Filter by stored status: ACTIVE | EXPIRING_SOON | EXPIRED | SUSPENDED | CLOSED (optional)" },
        expiringWithinDays: { type: "number",  description: "Return only certificates expiring within N days from today (e.g. 30, 90). Includes already-expired ones unless you also filter by status." },
        textSearch:         { type: "string",  description: "Search across certificate name, code and issuing authority (optional)" },
        limit:              { type: "number",  description: "Max results (default 20, max 50)" },
      },
    },
  },
  {
    name: "query_inspections",
    description:
      "Query inspections (inspecciones de seguridad, técnicas, reglamentarias y de clase) for the current tenant/vessel. Use this to check when an inspection was done or is scheduled, its result (PASS/FAIL/CONDITIONAL), who inspected, and the findings recorded in its log. Set includeFindings=true to also get the log entries (observations, deficiencies and recommendations with their severity).",
    input_schema: {
      type: "object" as const,
      properties: {
        vesselCode:      { type: "string",  description: "Filter by vessel code (optional)" },
        assetId:         { type: "string",  description: "Filter by asset ID (optional)" },
        status:          { type: "string",  description: "Filter by status: SCHEDULED | IN_PROGRESS | COMPLETED | CANCELLED (optional)" },
        type:            { type: "string",  description: "Filter by type: SAFETY | TECHNICAL | REGULATORY | CLASS (optional)" },
        result:          { type: "string",  description: "Filter by result: PASS | FAIL | CONDITIONAL (optional)" },
        textSearch:      { type: "string",  description: "Search across inspection code, inspector name and notes (optional)" },
        includeFindings: { type: "boolean", description: "If true, also return the inspection log entries (findings/observations). Default false." },
        limit:           { type: "number",  description: "Max results (default 10, max 30)" },
      },
    },
  },
  {
    name: "query_external_audits",
    description:
      "Query external audits and inspections by third parties (PSC / Port State Control, flag state, class society, SIRE vetting, CDI, RightShip). Use this when the user asks about port state control results, detentions, deficiencies raised by an inspector, or open findings pending rectification. Returns the audit header plus its findings (type, category, description, severity, detention-related flag, rectification deadline and clearing date).",
    input_schema: {
      type: "object" as const,
      properties: {
        vesselCode:       { type: "string",  description: "Filter by vessel code (optional)" },
        auditType:        { type: "string",  description: "Filter by type: PSC | FLAG | CLASS | VETTING_OIL_MAJOR | CDI | RIGHTSHIP | OTHER (optional)" },
        sinceDate:        { type: "string",  description: "ISO date (YYYY-MM-DD) — only audits on/after this date (optional)" },
        openFindingsOnly: { type: "boolean", description: "If true, return only audits that still have OPEN or IN_PROGRESS findings, and only those findings." },
        limit:            { type: "number",  description: "Max results (default 10, max 20)" },
      },
    },
  },
  {
    name: "query_permits",
    description:
      "Query permits to work / PTW (permisos de trabajo: trabajo en caliente, espacios confinados, trabajo en altura, aislación eléctrica, trabajo en frío, trabajo subacuático). Use this when the user asks which permits are active right now, whether a job has an approved permit, the hazards and control measures declared, or the PPE required. Pass activeNow=true for permits currently in force.",
    input_schema: {
      type: "object" as const,
      properties: {
        vesselCode: { type: "string",  description: "Filter by vessel code (optional)" },
        status:     { type: "string",  description: "Filter by status: DRAFT | REQUESTED | APPROVED | REJECTED | ACTIVE | CLOSED | CANCELLED (optional)" },
        type:       { type: "string",  description: "Filter by type: HOT_WORK | ENCLOSED_SPACE_ENTRY | WORKING_ALOFT | ELECTRICAL_ISOLATION | COLD_WORK | UNDERWATER_WORK (optional)" },
        assetId:    { type: "string",  description: "Filter by asset ID (optional)" },
        activeNow:  { type: "boolean", description: "If true, return only permits in status ACTIVE whose validity window covers the current moment." },
        textSearch: { type: "string",  description: "Search across permit code, location and description (optional)" },
        limit:      { type: "number",  description: "Max results (default 10, max 30)" },
      },
    },
  },
  {
    name: "query_near_misses",
    description:
      "Query near miss reports, hazard observations, unsafe acts and unsafe conditions (cuasi accidentes / observaciones de riesgo). Different from defects: a defect is broken hardware, a near miss is an event or condition that could have caused harm but did not. Use this for safety-culture questions, repeated unsafe conditions, lessons learned, or when an RCA needs precedent events for an asset or area.",
    input_schema: {
      type: "object" as const,
      properties: {
        vesselCode: { type: "string", description: "Filter by vessel code (optional)" },
        status:     { type: "string", description: "Filter by status: REPORTED | UNDER_REVIEW | ACTIONED | CLOSED (optional)" },
        category:   { type: "string", description: "Filter by category: NEAR_MISS | HAZARD_OBSERVATION | UNSAFE_ACT | UNSAFE_CONDITION (optional)" },
        severity:   { type: "string", description: "Filter by severity: LOW | MEDIUM | HIGH | CRITICAL (optional)" },
        assetId:    { type: "string", description: "Filter by asset ID (optional)" },
        textSearch: { type: "string", description: "Search across description, immediate action, root cause and lessons learned (optional)" },
        sinceDate:  { type: "string", description: "ISO date (YYYY-MM-DD) — only events on/after this date (optional)" },
        limit:      { type: "number", description: "Max results (default 10, max 30)" },
      },
    },
  },
  {
    name: "query_checklists",
    description:
      "Query signed operational checklists (listas de verificación: pre-arribo, pre-zarpe, pre-bunkering, transferencia de carga, entrada a espacio confinado, trabajo en caliente, práctico a bordo, fondeo, amarre). Use this to prove a checklist was completed and signed for an event, or to find non-conforming items. Returns the execution header with totals (totalItems / conformingItems / notConformingItems); set includeResponses=true to get the individual item answers.",
    input_schema: {
      type: "object" as const,
      properties: {
        vesselCode:       { type: "string",  description: "Filter by vessel code (optional)" },
        type:             { type: "string",  description: "Filter by type: PRE_ARRIVAL | PRE_DEPARTURE | PRE_BUNKERING | PRE_CARGO_TRANSFER | ENCLOSED_SPACE_ENTRY | HOT_WORK | PILOT_BOARDING | ANCHOR | MOORING | OTHER (optional)" },
        status:           { type: "string",  description: "Filter by status: IN_PROGRESS | COMPLETED | CANCELLED (optional)" },
        sinceDate:        { type: "string",  description: "ISO date (YYYY-MM-DD) — only executions on/after this date (optional)" },
        includeResponses: { type: "boolean", description: "If true, also return each checklist item and its answer. Default false (heavy)." },
        limit:            { type: "number",  description: "Max results (default 10, max 20)" },
      },
    },
  },
  {
    name: "query_moc",
    description:
      "Query Management of Change records (MOC / gestión del cambio: cambios de equipo, de procedimiento, organizacionales, temporales o de software). Use this when the user asks whether a change was formally approved, its risk level, the impact analysis, the mitigation actions or the post-implementation review. Also useful to check whether an alarm bypass or a temporary workaround was authorised.",
    input_schema: {
      type: "object" as const,
      properties: {
        vesselCode: { type: "string", description: "Filter by vessel code (optional)" },
        status:     { type: "string", description: "Filter by status: REQUESTED | UNDER_ANALYSIS | APPROVED | IN_PROGRESS | IMPLEMENTED | REVIEWED | REJECTED | CANCELLED (optional)" },
        category:   { type: "string", description: "Filter by category: EQUIPMENT_CHANGE | PROCEDURE_CHANGE | ORGANIZATIONAL | TEMPORARY | SOFTWARE_FIRMWARE | OTHER (optional)" },
        riskLevel:  { type: "string", description: "Filter by risk level: LOW | MEDIUM | HIGH | CRITICAL (optional)" },
        textSearch: { type: "string", description: "Search across title, reason for change and proposed change (optional)" },
        limit:      { type: "number", description: "Max results (default 10, max 20)" },
      },
    },
  },

  // ── Mantenimiento: lo que rodea a la OT ───────────────────────────────────
  {
    name: "query_service_requests",
    description:
      "Query service requests / SS (solicitudes de servicio a taller externo). IMPORTANT: since the OT/SS split, a ServiceRequest is a SEPARATE entity that hangs from an authorised work order — it is NOT the same record as the work order. Use this when the user asks what was sent to a workshop, which provider did the job, whether a service was approved/authorised, whether it was received conforming, or the state of the paperwork (solicitada → aprobada → autorizada → en ejecución → recibida). Returns the SS code, its parent work order code, the workshop, the purchase-request kinds and the reception data.",
    input_schema: {
      type: "object" as const,
      properties: {
        vesselCode:     { type: "string", description: "Filter by vessel code (optional)" },
        status:         { type: "string", description: "Filter by status: DRAFT | SOLICITADA | APROBADA | AUTORIZADA | IN_PROGRESS | COMPLETED | REJECTED | CANCELLED (optional)" },
        workOrderCode:  { type: "string", description: "Filter by the parent work order code, e.g. 'OT-DONCHI-26-0003' (optional)" },
        textSearch:     { type: "string", description: "Search across title, description, causes and observations (optional)" },
        sinceDate:      { type: "string", description: "ISO date (YYYY-MM-DD) — only SS opened on/after this date (optional)" },
        limit:          { type: "number", description: "Max results (default 10, max 30)" },
      },
    },
  },
  {
    name: "query_deferrals",
    description:
      "Query deferrals (postergaciones: tareas de mantenimiento, defectos u OT que se difieren con justificación, análisis de riesgo y medidas compensatorias). Use this when the user asks what is postponed, until when, why, who approved it, what compensatory measures were put in place, or which deferrals are expired. Critical for audits: a deferral is the formal record of NOT doing something on time.",
    input_schema: {
      type: "object" as const,
      properties: {
        vesselCode: { type: "string", description: "Filter by vessel code (optional)" },
        assetId:    { type: "string", description: "Filter by asset ID (optional)" },
        status:     { type: "string", description: "Filter by status: REQUESTED | UNDER_REVIEW | APPROVED | REJECTED | ACTIVE | EXPIRED | CLOSED (optional)" },
        sourceType: { type: "string", description: "Filter by what is being deferred: DEFECT | WORK_ORDER | MAINTENANCE_PLAN (optional)" },
        riskLevel:  { type: "string", description: "Filter by risk level: LOW | MEDIUM | HIGH | CRITICAL (optional)" },
        limit:      { type: "number", description: "Max results (default 10, max 30)" },
      },
    },
  },
  {
    name: "query_asset_hours",
    description:
      "Query the running-hours ledger of equipment (horas de equipos). This is the SINGLE SOURCE of running hours: readings come from manual entry, from the daily report or from the voyage/tank report (M2). Use this when the user asks how many hours an engine/generator has, when the hourmeter was last read, or how many hours it ran in a period. Pass latestPerAsset=true to get the current hours of each piece of equipment of the vessel (one row per asset, the most recent reading).",
    input_schema: {
      type: "object" as const,
      properties: {
        vesselCode:     { type: "string",  description: "Filter by vessel code (optional)" },
        assetId:        { type: "string",  description: "Filter by asset ID (optional — resolve the equipment name with query_assets first)" },
        latestPerAsset: { type: "boolean", description: "If true, return only the most recent reading per asset (current hours). Default false (full history, newest first)." },
        sinceDate:      { type: "string",  description: "ISO date (YYYY-MM-DD) — only readings on/after this date (optional)" },
        limit:          { type: "number",  description: "Max results (default 20, max 100)" },
      },
    },
  },

  // ── Repuestos, compras y proveedores ──────────────────────────────────────
  {
    name: "query_spare_requests",
    description:
      "Query spare part requests (pedidos de repuestos: solicitud → aprobación → reserva → recepción). Use this when the user asks what was requested, whether a request was approved or rejected and why, what is still pending delivery, or when an item was received. Different from query_spares (that one is the stock catalogue) and from query_stock_movements (that one is the physical in/out ledger). Returns each request with its items, quantities requested / reserved / fulfilled and reception dates.",
    input_schema: {
      type: "object" as const,
      properties: {
        vesselCode: { type: "string", description: "Filter by the vessel the request is for (optional). Requests not tied to a vessel are also returned." },
        status:     { type: "string", description: "Filter by status: DRAFT | SUBMITTED | APPROVED | REJECTED | PARTIALLY_FULFILLED | FULFILLED | CANCELLED (optional)" },
        priority:   { type: "string", description: "Filter by priority: LOW | MEDIUM | HIGH | CRITICAL (optional)" },
        textSearch: { type: "string", description: "Search across request code and notes (optional)" },
        limit:      { type: "number", description: "Max results (default 10, max 30)" },
      },
    },
  },
  {
    name: "query_stock_movements",
    description:
      "Query stock movements (movimientos de inventario: recepciones, salidas/consumos, ajustes, transferencias y devoluciones). Use this to answer WHEN a spare entered or left the store, how much was consumed by a work order or a maintenance execution record, or to reconstruct the history behind a current stock figure. movementType RECEIPT = recepción de repuestos. referenceType tells you what caused the movement (WORK_ORDER, WORK_LOG, SPARE_REQUEST, DEFECT, ADJUSTMENT).",
    input_schema: {
      type: "object" as const,
      properties: {
        vesselCode:    { type: "string", description: "Filter by vessel code (optional)" },
        spareId:       { type: "string", description: "Filter by spare ID (optional — get it from query_spares)" },
        textSearch:    { type: "string", description: "Search by spare name or SKU (optional)" },
        movementType:  { type: "string", description: "Filter by type: RECEIPT | ISSUE | ADJUSTMENT | TRANSFER | TRANSFER_IN | TRANSFER_OUT | RETURN_IN | ADJUSTMENT_PLUS | ADJUSTMENT_MINUS (optional)" },
        referenceType: { type: "string", description: "Filter by origin: WORK_ORDER | DEFECT | ADJUSTMENT | SPARE_REQUEST | WORK_LOG (optional)" },
        sinceDate:     { type: "string", description: "ISO date (YYYY-MM-DD) — only movements on/after this date (optional)" },
        limit:         { type: "number", description: "Max results (default 20, max 50)" },
      },
    },
  },
  {
    name: "query_providers",
    description:
      "Query the provider / workshop catalogue (proveedores y talleres) of the tenant. Providers are tenant-wide, not per vessel. Use this to find a workshop's contact details or location, or to judge a provider: set includeEvaluations=true to also get its performance evaluations (score and rating A/B/C/D) and its nonconformities. Useful when the user asks 'who did this service', 'how does this workshop perform' or 'which providers have open nonconformities'.",
    input_schema: {
      type: "object" as const,
      properties: {
        textSearch:         { type: "string",  description: "Search across name, provider code, category and location (optional)" },
        status:             { type: "string",  description: "Filter by status: ACTIVE | INACTIVE (optional)" },
        category:           { type: "string",  description: "Filter by category, exact match (optional)" },
        includeEvaluations: { type: "boolean", description: "If true, also return evaluations and nonconformities of each provider. Default false." },
        limit:              { type: "number",  description: "Max results (default 10, max 30)" },
      },
    },
  },

  // ── Operación, buques y reportes ──────────────────────────────────────────
  {
    name: "query_vessels",
    description:
      "Query the fleet registry (buques). Use this to resolve a vessel NAME the user mentioned into its vesselCode before calling other query_* tools, to list the fleet, or to answer questions about the ship itself: IMO number, registration, owner, type, power (HP), deadweight, dimensions (length/beam/depth), gross and net tonnage, build year and country. ALWAYS refer to a vessel by its name in your answer, never by its code.",
    input_schema: {
      type: "object" as const,
      properties: {
        textSearch: { type: "string", description: "Search across vessel name, code, IMO and registration (optional)" },
        status:     { type: "string", description: "Filter by status: ACTIVE | INACTIVE (optional)" },
        limit:      { type: "number", description: "Max results (default 20, max 50)" },
      },
    },
  },
  {
    name: "query_monthly_reports",
    description:
      "Query monthly reports (reportes mensuales por buque, con snapshot de inventario congelado al enviarlo). Use this when the user asks for the monthly summary, the operational status of a given month, the port and position reported, or the inventory picture at month end.",
    input_schema: {
      type: "object" as const,
      properties: {
        vesselCode:               { type: "string",  description: "Filter by vessel code (optional)" },
        year:                     { type: "number",  description: "Filter by report year, e.g. 2026 (optional)" },
        month:                    { type: "number",  description: "Filter by report month 1..12 (optional)" },
        status:                   { type: "string",  description: "Filter by status: DRAFT | SUBMITTED | REVIEWED | CLOSED (optional)" },
        includeInventorySnapshot: { type: "boolean", description: "If true, also return the frozen inventory snapshot. Default false (heavy)." },
        limit:                    { type: "number",  description: "Max results (default 6, max 24)" },
      },
    },
  },
  {
    name: "query_voyage_tank_reports",
    description:
      "Query voyage / tank reports, known on board as 'M2' (reporte de tanques y viaje: tramo navegado, kilómetros, días de navegación, bunker recibido y entregado a barcazas, soundings inicial/final de cada tanque y horas de motores del viaje). Use this for fuel reconciliation, consumption per voyage, or engine hours registered in a voyage. Set includeReadings=true to get the per-tank soundings and the per-engine hours.",
    input_schema: {
      type: "object" as const,
      properties: {
        vesselCode:      { type: "string",  description: "Filter by vessel code (optional)" },
        voyageCode:      { type: "string",  description: "Filter by voyage code, e.g. 'M01' (optional)" },
        status:          { type: "string",  description: "Filter by status: DRAFT | SUBMITTED | CLOSED (optional)" },
        includeReadings: { type: "boolean", description: "If true, also return tank readings and engine hours of the voyage. Default false." },
        limit:           { type: "number",  description: "Max results (default 5, max 20)" },
      },
    },
  },
  {
    name: "query_bitacora",
    description:
      "Query the deck/engine log book (bitácora del buque: novedades técnicas, observaciones operativas, eventos importantes, instrucciones recibidas y seguimientos abiertos). Use this when the user asks what was recorded on a date, what happened with an asset, whether there is an open follow-up (seguimiento) on something, or needs the narrative context that does not live in a work order. Pass monitoringOnly=true for follow-ups still open.",
    input_schema: {
      type: "object" as const,
      properties: {
        vesselCode:     { type: "string",  description: "Filter by vessel code (optional)" },
        category:       { type: "string",  description: "Filter by category: NOVEDAD_TECNICA | OBSERVACION_OPERATIVA | EVENTO_IMPORTANTE | INSTRUCCION_RECIBIDA | SEGUIMIENTO | ANOTACION_GENERAL (optional)" },
        textSearch:     { type: "string",  description: "Search across entry title and body (optional)" },
        sinceDate:      { type: "string",  description: "ISO date (YYYY-MM-DD) — only entries on/after this date (optional)" },
        monitoringOnly: { type: "boolean", description: "If true, return only entries flagged as open follow-up (seguimiento sin cerrar)." },
        limit:          { type: "number",  description: "Max results (default 10, max 30)" },
      },
    },
  },

  // ── Tripulación ───────────────────────────────────────────────────────────
  {
    name: "query_rest_hours",
    description:
      "Query hours of rest records (horas de descanso — STCW Manila / MLC 2006). One record per crew member per day, with the total rest hours and whether the day breaks the rule (minimum 10h in 24h, 77h in 7 days, no more than two rest periods with one of at least 6h). Use this when the user asks about fatigue, rest-hour violations, or needs evidence for a PSC / MLC inspection. Pass violationsOnly=true for the days with violations.",
    input_schema: {
      type: "object" as const,
      properties: {
        vesselCode:     { type: "string",  description: "Filter by vessel code (optional)" },
        crewName:       { type: "string",  description: "Filter by crew member first/last name, partial match (optional)" },
        violationsOnly: { type: "boolean", description: "If true, return only records flagged with a violation." },
        sinceDate:      { type: "string",  description: "ISO date (YYYY-MM-DD) — only records on/after this date (optional)" },
        limit:          { type: "number",  description: "Max results (default 20, max 60)" },
      },
    },
  },
  {
    name: "query_crew_capabilities",
    description:
      "Query the crew competency matrix (matriz de competencias: quién está habilitado para ECDIS, BWMS, sistema de gas inerte, operación de carga, entrada a espacios confinados, trabajo en caliente, alta tensión, operación de grúa, GMDSS, etc., y con qué nivel — TRAINED / CERTIFIED / EXPERT). Use this when the user asks who can legally or safely perform a task, or whether the vessel has anyone qualified for a given operation. Different from query_crew_certs, which returns documents and courses with expiry dates.",
    input_schema: {
      type: "object" as const,
      properties: {
        vesselCode: { type: "string", description: "Filter by vessel code (optional)" },
        area:       { type: "string", description: "Filter by capability area: ECDIS | BWMS | IG_SYSTEM | CARGO_HANDLING | MOORING_MASTER | ENCLOSED_SPACE_ENTRY | HOT_WORK | RADAR_ARPA | GMDSS | BRIDGE_RESOURCE_MGMT | ENGINE_ROOM_RESOURCE | FIRE_FIGHTING | SURVIVAL_CRAFT | MEDICAL_FIRST_AID | HIGH_VOLTAGE | CRANE_OPERATION | OTHER (optional)" },
        level:      { type: "string", description: "Filter by level: TRAINED | CERTIFIED | EXPERT (optional)" },
        crewName:   { type: "string", description: "Filter by crew member first/last name, partial match (optional)" },
        limit:      { type: "number", description: "Max results (default 30, max 80)" },
      },
    },
  },

  // ── Inteligencia operativa ────────────────────────────────────────────────
  {
    name: "query_ai_insights",
    description:
      "Query the AI operational insights already generated by the system (Insights IA: riesgo de backlog, fallas repetidas, postergaciones repetidas, revisión de frecuencia de PM, stock bajo mínimo, certificados por vencer, patrones de falla de inspección, CAPA vencidas, OT vencidas, anomalías operativas, patrones de flota). Use this when the user asks 'qué está detectando el sistema', 'qué debería mirar', or wants the open alerts for a vessel. Fleet-wide insights (targetType FLEET) apply to every vessel.",
    input_schema: {
      type: "object" as const,
      properties: {
        vesselCode:  { type: "string", description: "Filter by vessel code (optional). Fleet-wide insights are always included." },
        status:      { type: "string", description: "Filter by status: OPEN | DISMISSED | RESOLVED (optional, default OPEN)" },
        priority:    { type: "string", description: "Filter by priority: LOW | MEDIUM | HIGH | CRITICAL (optional)" },
        insightType: { type: "string", description: "Filter by insight type, e.g. backlog_risk, repeated_failure, stock_below_minimum, certificate_expiring, overdue_work_order (optional)" },
        limit:       { type: "number", description: "Max results (default 10, max 30)" },
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Ejecutor
// ---------------------------------------------------------------------------

/** Nombres que resuelve este archivo. Se usa para rutear desde el ejecutor núcleo. */
const HANDLED = new Set(EXTENDED_COPILOT_TOOLS.map(t => t.name));

export function handlesExtendedTool(name: string): boolean {
  return HANDLED.has(name);
}

/**
 * Ejecuta una tool de este catálogo. Devuelve `null` si el nombre no pertenece
 * a este archivo (para que el llamador siga buscando).
 */
export async function executeExtendedCopilotTool(
  name: string,
  input: Record<string, unknown>,
  tenantId: string,
  scope: VesselScope,
): Promise<string | null> {
  if (!HANDLED.has(name)) return null;

  const prisma: any = getPrismaClient();
  if (!prisma) return JSON.stringify({ error: "Database not available in current environment" });

  const cap = (raw: unknown, def: number, max: number) => Math.min(Number(raw ?? def) || def, max);
  const sinceFilter = (raw: unknown): Date | null =>
    typeof raw === "string" && raw ? new Date(raw) : null;

  try {
    // ── Certificados del buque ─────────────────────────────────────────────
    if (name === "query_certificates") {
      const limit = cap(input.limit, 20, 50);
      const where: Record<string, unknown> = { tenantId, deletedAt: null };
      const scoped = applyVesselWhereScope(where, input.vesselCode, scope);
      if (!scoped.ok) return scoped.reason;
      if (input.status) where.status = input.status;
      if (typeof input.expiringWithinDays === "number") {
        const until = new Date(Date.now() + input.expiringWithinDays * 86_400_000);
        where.expiryDate = { lte: until };
      }
      const ts = textSearchWhere(input.textSearch, ["name", "certificateCode", "issuingAuthority"]);
      if (ts) Object.assign(where, ts);

      const rows = await prisma.certificate.findMany({
        where,
        take: limit,
        orderBy: { expiryDate: "asc" },
        select: {
          certificateCode: true, name: true, issuingAuthority: true, status: true,
          issueDate: true, expiryDate: true, lastInspectionDate: true, notes: true,
          vesselCode: true, assetId: true,
        },
      });
      const enriched = await attachAssetNames(prisma, tenantId, rows);
      return toolResult(
        enriched.map((c: any) => ({
          ...c,
          daysToExpiry: daysUntil(c.expiryDate),
          expiryStatus: expiryStatus(c.expiryDate),
        })),
        "No certificates found matching the given criteria.",
      );
    }

    // ── Inspecciones ───────────────────────────────────────────────────────
    if (name === "query_inspections") {
      const limit = cap(input.limit, 10, 30);
      const where: Record<string, unknown> = { tenantId, deletedAt: null };
      const scoped = applyVesselWhereScope(where, input.vesselCode, scope);
      if (!scoped.ok) return scoped.reason;
      if (input.assetId) where.assetId = input.assetId;
      if (input.status)  where.status  = input.status;
      if (input.type)    where.type    = input.type;
      if (input.result)  where.result  = input.result;
      const ts = textSearchWhere(input.textSearch, ["inspectionCode", "inspectorName", "notes"]);
      if (ts) Object.assign(where, ts);

      const rows = await prisma.inspection.findMany({
        where,
        take: limit,
        orderBy: [{ completedAt: "desc" }, { scheduledAt: "desc" }],
        select: {
          id: true, inspectionCode: true, vesselCode: true, assetId: true,
          type: true, status: true, result: true,
          scheduledAt: true, completedAt: true, inspectorName: true, notes: true,
          provider: { select: { name: true } },
          ...(input.includeFindings
            ? {
                logs: {
                  orderBy: { observedAt: "desc" },
                  take: 20,
                  select: {
                    logCode: true, entryType: true, severity: true,
                    observedAt: true, summary: true, recommendation: true,
                  },
                },
              }
            : {}),
        },
      });

      const enriched = await attachAssetNames(prisma, tenantId, rows);
      return toolResult(
        enriched.map(({ id, provider, ...rest }: any) => ({
          ...rest,
          providerName: provider?.name ?? null,
        })),
        "No inspections found matching the given criteria.",
      );
    }

    // ── Auditorías externas (PSC / bandera / clase / vetting) ──────────────
    if (name === "query_external_audits") {
      const limit = cap(input.limit, 10, 20);
      const where: Record<string, unknown> = { tenantId, deletedAt: null };
      const scoped = applyVesselWhereScope(where, input.vesselCode, scope);
      if (!scoped.ok) return scoped.reason;
      if (input.auditType) where.auditType = input.auditType;
      const since = sinceFilter(input.sinceDate);
      if (since) where.auditDate = { gte: since };
      if (input.openFindingsOnly) {
        where.findings = { some: { status: { in: ["OPEN", "IN_PROGRESS"] } } };
      }

      const rows = await prisma.externalAudit.findMany({
        where,
        take: limit,
        orderBy: { auditDate: "desc" },
        select: {
          auditCode: true, vesselCode: true, auditType: true, auditDate: true,
          port: true, country: true, agencyOrAuthority: true, inspectorName: true,
          overallResult: true, scoreOrRating: true, summary: true,
          findings: {
            where: input.openFindingsOnly ? { status: { in: ["OPEN", "IN_PROGRESS"] } } : undefined,
            orderBy: { createdAt: "asc" },
            take: 30,
            select: {
              findingCode: true, findingType: true, category: true, description: true,
              status: true, severity: true, detentionRelated: true,
              rectificationDeadline: true, clearingDate: true, evidenceNotes: true,
            },
          },
        },
      });

      return toolResult(rows, "No external audits found matching the given criteria.");
    }

    // ── Permisos de trabajo ────────────────────────────────────────────────
    if (name === "query_permits") {
      const limit = cap(input.limit, 10, 30);
      const where: Record<string, unknown> = { tenantId, deletedAt: null };
      const scoped = applyVesselWhereScope(where, input.vesselCode, scope);
      if (!scoped.ok) return scoped.reason;
      if (input.status)  where.status  = input.status;
      if (input.type)    where.type    = input.type;
      if (input.assetId) where.assetId = input.assetId;
      if (input.activeNow) {
        const now = new Date();
        where.status = "ACTIVE";
        where.AND = [
          { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
          { OR: [{ validTo:   null }, { validTo:   { gte: now } }] },
        ];
      }
      const ts = textSearchWhere(input.textSearch, ["permitCode", "location", "description"]);
      if (ts) {
        // `activeNow` ya usó AND: fusionar en vez de pisar.
        if (Array.isArray(where.AND) && Array.isArray(ts.AND)) where.AND = [...where.AND, ...ts.AND];
        else Object.assign(where, ts);
      }

      const rows = await prisma.permitToWork.findMany({
        where,
        take: limit,
        orderBy: [{ plannedStart: "desc" }],
        select: {
          permitCode: true, vesselCode: true, type: true, status: true,
          location: true, description: true, assetId: true,
          plannedStart: true, plannedEnd: true, validFrom: true, validTo: true,
          hazardsIdentified: true, controlMeasures: true, ppeRequired: true,
          alarmOverride: true, requestedAt: true, approvedAt: true,
          activatedAt: true, closedAt: true, closeNotes: true, rejectionReason: true,
        },
      });

      const enriched = await attachAssetNames(prisma, tenantId, rows);
      return toolResult(enriched, "No permits to work found matching the given criteria.");
    }

    // ── Cuasi accidentes / observaciones de riesgo ─────────────────────────
    if (name === "query_near_misses") {
      const limit = cap(input.limit, 10, 30);
      const where: Record<string, unknown> = { tenantId, deletedAt: null };
      const scoped = applyVesselWhereScope(where, input.vesselCode, scope);
      if (!scoped.ok) return scoped.reason;
      if (input.status)   where.status   = input.status;
      if (input.category) where.category = input.category;
      if (input.severity) where.severity = input.severity;
      if (input.assetId)  where.assetId  = input.assetId;
      const since = sinceFilter(input.sinceDate);
      if (since) where.occurredAt = { gte: since };
      const ts = textSearchWhere(input.textSearch, [
        "description", "immediateAction", "rootCause", "preventiveActions", "lessonsLearned",
      ]);
      if (ts) Object.assign(where, ts);

      const rows = await prisma.nearMissReport.findMany({
        where,
        take: limit,
        orderBy: { occurredAt: "desc" },
        select: {
          nearMissCode: true, vesselCode: true, assetId: true,
          category: true, severity: true, status: true,
          occurredAt: true, location: true, description: true,
          immediateAction: true, rootCause: true, preventiveActions: true,
          lessonsLearned: true, reportedByName: true, reviewedAt: true, closedAt: true,
        },
      });

      const enriched = await attachAssetNames(prisma, tenantId, rows);
      return toolResult(enriched, "No near miss reports found matching the given criteria.");
    }

    // ── Checklists operativos firmados ─────────────────────────────────────
    if (name === "query_checklists") {
      const limit = cap(input.limit, 10, 20);
      const where: Record<string, unknown> = { tenantId, deletedAt: null };
      const scoped = applyVesselWhereScope(where, input.vesselCode, scope);
      if (!scoped.ok) return scoped.reason;
      if (input.type)   where.type   = input.type;
      if (input.status) where.status = input.status;
      const since = sinceFilter(input.sinceDate);
      if (since) where.eventDateTime = { gte: since };

      const rows = await prisma.checklistExecution.findMany({
        where,
        take: limit,
        orderBy: { eventDateTime: "desc" },
        select: {
          executionCode: true, vesselCode: true, type: true, status: true,
          eventDateTime: true, port: true, voyageRef: true,
          performedByName: true, signedByName: true, signedAt: true, notes: true,
          totalItems: true, conformingItems: true, notConformingItems: true,
          template: { select: { name: true } },
          ...(input.includeResponses
            ? {
                responses: {
                  take: 60,
                  select: { itemCode: true, itemText: true, status: true, notes: true, reportedByName: true },
                },
              }
            : {}),
        },
      });

      return toolResult(
        rows.map(({ template, ...rest }: any) => ({ ...rest, templateName: template?.name ?? null })),
        "No checklist executions found matching the given criteria.",
      );
    }

    // ── MOC — gestión del cambio ───────────────────────────────────────────
    if (name === "query_moc") {
      const limit = cap(input.limit, 10, 20);
      const where: Record<string, unknown> = { tenantId, deletedAt: null };
      const scoped = applyVesselWhereScope(where, input.vesselCode, scope);
      if (!scoped.ok) return scoped.reason;
      if (input.status)    where.status    = input.status;
      if (input.category)  where.category  = input.category;
      if (input.riskLevel) where.riskLevel = input.riskLevel;
      const ts = textSearchWhere(input.textSearch, ["title", "reasonForChange", "proposedChange"]);
      if (ts) Object.assign(where, ts);

      const rows = await prisma.mocRecord.findMany({
        where,
        take: limit,
        orderBy: { createdAt: "desc" },
        select: {
          mocCode: true, vesselCode: true, category: true, status: true, title: true,
          reasonForChange: true, proposedChange: true, currentSituation: true,
          expectedResult: true, riskLevel: true, finalRiskLevel: true,
          riskAssessmentNotes: true, mitigationActions: true,
          duration: true, temporaryUntil: true,
          approvedAt: true, approvedByName: true, rejectedReason: true,
          plannedDate: true, implementedAt: true, implementedByName: true,
          implementationNotes: true, reviewedAt: true, reviewOutcome: true, reviewNotes: true,
          relatedAssetId: true, relatedWorkOrderId: true,
        },
      });

      // relatedAssetId → nombre del equipo (nunca exponer el id crudo).
      const withAssetId = rows.map((r: any) => ({ ...r, assetId: r.relatedAssetId ?? null }));
      const enriched = await attachAssetNames(prisma, tenantId, withAssetId);
      return toolResult(
        enriched.map(({ relatedAssetId, ...rest }: any) => rest),
        "No MOC records found matching the given criteria.",
      );
    }

    // ── Solicitudes de servicio (SS) ───────────────────────────────────────
    if (name === "query_service_requests") {
      const limit = cap(input.limit, 10, 30);
      const where: Record<string, unknown> = { tenantId, deletedAt: null };
      const scoped = applyVesselWhereScope(where, input.vesselCode, scope);
      if (!scoped.ok) return scoped.reason;
      if (input.status) where.status = input.status;
      if (typeof input.workOrderCode === "string" && input.workOrderCode) {
        where.workOrder = { workOrderCode: input.workOrderCode };
      }
      const since = sinceFilter(input.sinceDate);
      if (since) where.openDate = { gte: since };
      const ts = textSearchWhere(input.textSearch, ["title", "description", "causes", "observations"]);
      if (ts) Object.assign(where, ts);

      const rows = await prisma.serviceRequest.findMany({
        where,
        take: limit,
        orderBy: { openDate: "desc" },
        select: {
          serviceRequestCode: true, vesselCode: true, status: true, priority: true,
          openDate: true, title: true, description: true, causes: true,
          providerId: true, tallerNotes: true, purchaseRequestKinds: true,
          department: true, observations: true, closeNotes: true,
          receptionItem: true, receivedByName: true, receptionConform: true,
          startedAt: true, receivedAt: true,
          aprobadoByName: true, aprobadoAt: true,
          autorizadoByName: true, autorizadoAt: true,
          rechazadoByName: true, rechazadoAt: true, rechazoReason: true,
          workOrder: { select: { workOrderCode: true, title: true, assetId: true } },
        },
      });

      const withProvider = await attachProviderNames(prisma, tenantId, rows);
      const flat = withProvider.map(({ workOrder, providerId, ...rest }: any) => ({
        ...rest,
        workOrderCode:  workOrder?.workOrderCode ?? null,
        workOrderTitle: workOrder?.title ?? null,
        assetId:        workOrder?.assetId ?? null,
      }));
      const enriched = await attachAssetNames(prisma, tenantId, flat);
      return toolResult(enriched, "No service requests found matching the given criteria.");
    }

    // ── Postergaciones ─────────────────────────────────────────────────────
    if (name === "query_deferrals") {
      const limit = cap(input.limit, 10, 30);
      const where: Record<string, unknown> = { tenantId, deletedAt: null };
      const scoped = applyVesselWhereScope(where, input.vesselCode, scope);
      if (!scoped.ok) return scoped.reason;
      if (input.assetId)    where.assetId    = input.assetId;
      if (input.status)     where.status     = input.status;
      if (input.sourceType) where.sourceType = input.sourceType;
      if (input.riskLevel)  where.riskLevel  = input.riskLevel;

      const rows = await prisma.deferral.findMany({
        where,
        take: limit,
        orderBy: { requestedAt: "desc" },
        select: {
          deferralCode: true, vesselCode: true, assetId: true, status: true,
          deferralType: true, sourceType: true,
          requestedAt: true, targetDate: true, targetPort: true,
          justification: true, compensatoryMeasures: true,
          riskLevel: true, riskProbability: true, riskConsequence: true, riskAnalysisResult: true,
          reviewNotes: true, decisionAt: true, approverName: true, rejectorName: true,
          activeSince: true, expiredAt: true, closedAt: true, closeNotes: true, rejectionReason: true,
        },
      });

      const enriched = await attachAssetNames(prisma, tenantId, rows);
      return toolResult(enriched, "No deferrals found matching the given criteria.");
    }

    // ── Horas de equipos ───────────────────────────────────────────────────
    if (name === "query_asset_hours") {
      const limit = cap(input.limit, 20, 100);
      const where: Record<string, unknown> = { tenantId };
      const scoped = applyVesselWhereScope(where, input.vesselCode, scope);
      if (!scoped.ok) return scoped.reason;
      if (input.assetId) where.assetId = input.assetId;
      const since = sinceFilter(input.sinceDate);
      if (since) where.readingDate = { gte: since };

      // latestPerAsset: traemos una ventana amplia ordenada por fecha desc y nos
      // quedamos con la primera lectura de cada activo (la más reciente).
      const take = input.latestPerAsset ? 500 : limit;
      const rows = await prisma.assetHoursReading.findMany({
        where,
        take,
        orderBy: { readingDate: "desc" },
        select: {
          assetId: true, vesselCode: true, readingDate: true,
          runningHours: true, rpm: true, source: true, note: true,
        },
      });

      let result = rows;
      if (input.latestPerAsset) {
        const seen = new Set<string>();
        result = rows.filter((r: any) => {
          if (seen.has(r.assetId)) return false;
          seen.add(r.assetId);
          return true;
        }).slice(0, limit);
      }

      const enriched = await attachAssetNames(prisma, tenantId, result);
      return toolResult(enriched, "No running-hours readings found matching the given criteria.");
    }

    // ── Pedidos de repuestos ───────────────────────────────────────────────
    if (name === "query_spare_requests") {
      const limit = cap(input.limit, 10, 30);
      const where: Record<string, unknown> = { tenantId, deletedAt: null };
      // requestedForVesselCode es nullable: un pedido puede ser general del tenant.
      // Mismo criterio que listSpareRequests: asignados + los sin buque.
      // El scope y la búsqueda por texto van SIEMPRE como cláusulas AND separadas:
      // fusionarlas en el mismo nivel dejaba que un `OR` de búsqueda pisara el `OR`
      // del scope y filtrara pedidos de buques ajenos.
      const andClauses: Record<string, unknown>[] = [];
      if (scope.unrestricted) {
        if (typeof input.vesselCode === "string" && input.vesselCode) {
          where.requestedForVesselCode = input.vesselCode;
        }
      } else if (scope.codes.length === 0) {
        return deniedVesselResponse(typeof input.vesselCode === "string" ? input.vesselCode : "(any)", scope);
      } else if (typeof input.vesselCode === "string" && input.vesselCode) {
        if (!scope.codes.includes(input.vesselCode)) return deniedVesselResponse(input.vesselCode, scope);
        where.requestedForVesselCode = input.vesselCode;
      } else {
        andClauses.push({
          OR: [
            { requestedForVesselCode: { in: scope.codes } },
            { requestedForVesselCode: null },
          ],
        });
      }
      if (input.status)   where.status   = input.status;
      if (input.priority) where.priority = input.priority;
      const ts = textSearchWhere(input.textSearch, ["requestCode", "notes"]);
      if (ts) andClauses.push(ts);
      if (andClauses.length > 0) where.AND = andClauses;

      const rows = await prisma.spareRequest.findMany({
        where,
        take: limit,
        orderBy: { requestedAt: "desc" },
        select: {
          requestCode: true, status: true, priority: true,
          requestedAt: true, approvedAt: true, rejectionReason: true, notes: true,
          requestedForVesselCode: true, requestedForAssetId: true,
          items: {
            select: {
              description: true, quantity: true, unit: true,
              quantityReserved: true, quantityFulfilled: true,
              status: true, receivedAt: true, receiptNotes: true,
              spare: { select: { name: true, sku: true } },
            },
          },
        },
      });

      const flat = rows.map((r: any) => ({
        ...r,
        assetId: r.requestedForAssetId ?? null,
        vesselCode: r.requestedForVesselCode,
        items: (r.items ?? []).map(({ spare, ...it }: any) => ({
          ...it,
          spareName: spare?.name ?? null,
          sku: spare?.sku ?? null,
        })),
      }));
      const enriched = await attachAssetNames(prisma, tenantId, flat);
      return toolResult(
        enriched.map(({ requestedForAssetId, requestedForVesselCode, ...rest }: any) => rest),
        "No spare requests found matching the given criteria.",
      );
    }

    // ── Movimientos de stock ───────────────────────────────────────────────
    if (name === "query_stock_movements") {
      const limit = cap(input.limit, 20, 50);
      const where: Record<string, unknown> = { tenantId };
      const scoped = applyVesselWhereScope(where, input.vesselCode, scope);
      if (!scoped.ok) return scoped.reason;
      if (input.spareId)       where.spareId       = input.spareId;
      if (input.movementType)  where.movementType  = input.movementType;
      if (input.referenceType) where.referenceType = input.referenceType;
      const since = sinceFilter(input.sinceDate);
      if (since) where.occurredAt = { gte: since };
      if (typeof input.textSearch === "string" && input.textSearch.trim()) {
        const q = input.textSearch.trim();
        where.spare = {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { sku:  { contains: q, mode: "insensitive" } },
          ],
        };
      }

      const rows = await prisma.stockMovement.findMany({
        where,
        take: limit,
        orderBy: { occurredAt: "desc" },
        select: {
          movementCode: true, vesselCode: true, movementType: true,
          quantity: true, unit: true, occurredAt: true,
          referenceType: true, notes: true,
          spare:    { select: { name: true, sku: true, category: true } },
          location: { select: { name: true } },
        },
      });

      return toolResult(
        rows.map(({ spare, location, ...rest }: any) => ({
          ...rest,
          spareName: spare?.name ?? null,
          sku: spare?.sku ?? null,
          category: spare?.category ?? null,
          locationName: location?.name ?? null,
        })),
        "No stock movements found matching the given criteria.",
      );
    }

    // ── Proveedores ────────────────────────────────────────────────────────
    if (name === "query_providers") {
      const limit = cap(input.limit, 10, 30);
      // Los proveedores son del tenant, no de un buque: no llevan vessel scope.
      const where: Record<string, unknown> = { tenantId, deletedAt: null };
      if (input.status)   where.status   = input.status;
      if (input.category) where.category = input.category;
      const ts = textSearchWhere(input.textSearch, ["name", "providerCode", "category", "location"]);
      if (ts) Object.assign(where, ts);

      // Las evaluaciones y no conformidades SÍ tienen buque: se acotan al scope.
      const childWhere: Record<string, unknown> = { deletedAt: null };
      if (!scope.unrestricted) {
        if (scope.codes.length === 0) childWhere.vesselCode = { in: [] };
        else childWhere.vesselCode = { in: scope.codes };
      }

      const rows = await prisma.provider.findMany({
        where,
        take: limit,
        orderBy: { name: "asc" },
        select: {
          providerCode: true, name: true, category: true, status: true,
          contactName: true, contactEmail: true, contactPhone: true,
          location: true, notes: true,
          ...(input.includeEvaluations
            ? {
                evaluations: {
                  where: childWhere,
                  orderBy: { evaluatedAt: "desc" },
                  take: 5,
                  select: {
                    evaluationCode: true, vesselCode: true, status: true,
                    score: true, rating: true, evaluatedAt: true,
                    evaluatorName: true, summary: true,
                  },
                },
                nonconformities: {
                  where: childWhere,
                  orderBy: { reportedAt: "desc" },
                  take: 10,
                  select: {
                    nonconformityCode: true, vesselCode: true, status: true,
                    severity: true, reportedAt: true, description: true,
                    correctiveAction: true, closedAt: true,
                  },
                },
              }
            : {}),
        },
      });

      return toolResult(rows, "No providers found matching the given criteria.");
    }

    // ── Buques ─────────────────────────────────────────────────────────────
    if (name === "query_vessels") {
      const limit = cap(input.limit, 20, 50);
      // Ojo: en Vessel la columna es `code`, no `vesselCode`.
      const where: Record<string, unknown> = { tenantId, deletedAt: null };
      const scoped = applyVesselWhereScopeOn(where, "code", undefined, scope);
      if (!scoped.ok) return scoped.reason;
      if (input.status) where.status = input.status;
      const ts = textSearchWhere(input.textSearch, ["name", "code", "imo", "registration"]);
      if (ts) Object.assign(where, ts);

      const rows = await prisma.vessel.findMany({
        where,
        take: limit,
        orderBy: { name: "asc" },
        select: {
          code: true, name: true, owner: true, vesselType: true, status: true,
          imo: true, registration: true, powerHp: true, dwtTons: true,
          lengthM: true, beamM: true, depthM: true, trnTn: true, trbTn: true,
          buildYear: true, buildCountry: true, incorporationDate: true, incorporationType: true,
        },
      });

      return toolResult(
        rows.map(({ code, ...rest }: any) => ({ vesselCode: code, ...rest })),
        "No vessels found matching the given criteria.",
      );
    }

    // ── Reportes mensuales ─────────────────────────────────────────────────
    if (name === "query_monthly_reports") {
      const limit = cap(input.limit, 6, 24);
      const where: Record<string, unknown> = { tenantId, deletedAt: null };
      const scoped = applyVesselWhereScope(where, input.vesselCode, scope);
      if (!scoped.ok) return scoped.reason;
      if (typeof input.year === "number")  where.reportYear  = input.year;
      if (typeof input.month === "number") where.reportMonth = input.month;
      if (input.status) where.status = input.status;

      const rows = await prisma.monthlyReport.findMany({
        where,
        take: limit,
        orderBy: [{ reportYear: "desc" }, { reportMonth: "desc" }],
        select: {
          vesselCode: true, reportYear: true, reportMonth: true, status: true,
          operationalStatus: true, currentPort: true, nextPort: true, etaNextPort: true,
          positionLat: true, positionLon: true, summary: true, notes: true,
          submittedAt: true, integratedAt: true, inventorySnapshotAt: true,
          ...(input.includeInventorySnapshot ? { inventorySnapshot: true } : {}),
        },
      });

      return toolResult(rows, "No monthly reports found matching the given criteria.");
    }

    // ── Reportes de tanques / viaje (M2) ───────────────────────────────────
    if (name === "query_voyage_tank_reports") {
      const limit = cap(input.limit, 5, 20);
      const where: Record<string, unknown> = { tenantId, deletedAt: null };
      const scoped = applyVesselWhereScope(where, input.vesselCode, scope);
      if (!scoped.ok) return scoped.reason;
      if (input.voyageCode) where.voyageCode = input.voyageCode;
      if (input.status)     where.status     = input.status;

      const rows = await prisma.voyageTankReport.findMany({
        where,
        take: limit,
        orderBy: [{ reportDateTime: "desc" }, { createdAt: "desc" }],
        select: {
          voyageCode: true, reportCode: true, vesselCode: true, tramo: true,
          reportDateTime: true, status: true,
          kmStart: true, kmEnd: true, dateStart: true, dateEnd: true, daysNav: true,
          bunkerReceivedLts: true, bargeDeliveredLts: true, signatory: true, notes: true,
          ...(input.includeReadings
            ? {
                tankReadings: {
                  orderBy: { tankOrder: "asc" },
                  select: {
                    tankLabel: true,
                    liquidHeightMmInitial: true, volumeTotalLtsInitial: true, volumeWaterLtsInitial: true,
                    liquidHeightMmFinal: true, volumeTotalLtsFinal: true, volumeWaterLtsFinal: true,
                  },
                },
                engineHours: {
                  orderBy: { engineOrder: "asc" },
                  select: { engineLabel: true, hoursInitial: true, hoursFinal: true },
                },
              }
            : {}),
        },
      });

      return toolResult(rows, "No voyage/tank reports found matching the given criteria.");
    }

    // ── Bitácora ───────────────────────────────────────────────────────────
    if (name === "query_bitacora") {
      const limit = cap(input.limit, 10, 30);
      const where: Record<string, unknown> = { tenantId, deletedAt: null };
      const scoped = applyVesselWhereScope(where, input.vesselCode, scope);
      if (!scoped.ok) return scoped.reason;
      if (input.category) where.category = input.category;
      if (input.monitoringOnly) {
        where.isMonitoring = true;
        where.monitoringClosedAt = null;
      }
      const since = sinceFilter(input.sinceDate);
      if (since) where.entryDate = { gte: since };
      const ts = textSearchWhere(input.textSearch, ["title", "body"]);
      if (ts) Object.assign(where, ts);

      const rows = await prisma.bitacoraEntry.findMany({
        where,
        take: limit,
        orderBy: { entryDate: "desc" },
        select: {
          entryCode: true, vesselCode: true, entryDate: true, category: true,
          title: true, body: true, relatedAssetId: true,
          isMonitoring: true, monitoringClosedAt: true,
        },
      });

      const withAssetId = rows.map((r: any) => ({ ...r, assetId: r.relatedAssetId ?? null }));
      const enriched = await attachAssetNames(prisma, tenantId, withAssetId);
      return toolResult(
        enriched.map(({ relatedAssetId, ...rest }: any) => rest),
        "No log book entries found matching the given criteria.",
      );
    }

    // ── Horas de descanso ──────────────────────────────────────────────────
    if (name === "query_rest_hours") {
      const limit = cap(input.limit, 20, 60);
      const where: Record<string, unknown> = { tenantId };
      const scoped = applyVesselWhereScope(where, input.vesselCode, scope);
      if (!scoped.ok) return scoped.reason;
      if (input.violationsOnly) where.hasViolation = true;
      const since = sinceFilter(input.sinceDate);
      if (since) where.recordDate = { gte: since };

      // CrewRestHours guarda crewId suelto (sin @relation): si se filtra por
      // nombre hay que resolver primero los ids de tripulantes que matchean.
      if (typeof input.crewName === "string" && input.crewName.trim()) {
        const q = input.crewName.trim();
        const crewWhere: Record<string, unknown> = {
          tenantId,
          deletedAt: null,
          OR: [
            { firstName: { contains: q, mode: "insensitive" } },
            { lastName:  { contains: q, mode: "insensitive" } },
          ],
        };
        if (where.vesselCode) crewWhere.vesselCode = where.vesselCode;
        const matches = await prisma.crew.findMany({ where: crewWhere, select: { id: true } });
        where.crewId = { in: matches.map((c: any) => c.id) };
      }

      const rows = await prisma.crewRestHours.findMany({
        where,
        take: limit,
        orderBy: { recordDate: "desc" },
        select: {
          crewId: true, vesselCode: true, recordDate: true,
          totalRestHours: true, hasViolation: true, violationsJson: true, notes: true,
        },
      });

      const crewIds = [...new Set(rows.map((r: any) => r.crewId).filter(Boolean))];
      const crew = crewIds.length > 0
        ? await prisma.crew.findMany({
            where: { id: { in: crewIds }, tenantId },
            select: { id: true, firstName: true, lastName: true, rankDefinition: { select: { name: true } } },
          })
        : [];
      const byId = new Map(crew.map((c: any) => [c.id, c]));

      return toolResult(
        rows.map(({ crewId, ...rest }: any) => {
          const c: any = byId.get(crewId);
          return {
            crewName: c ? `${c.firstName} ${c.lastName}`.trim() : null,
            rank: c?.rankDefinition?.name ?? null,
            ...rest,
          };
        }),
        "No rest-hour records found matching the given criteria.",
      );
    }

    // ── Matriz de competencias ─────────────────────────────────────────────
    if (name === "query_crew_capabilities") {
      const limit = cap(input.limit, 30, 80);
      // CrewCapability no tiene vesselCode ni @relation a Crew: se resuelve la
      // lista de tripulantes en scope primero y se filtra por crewId.
      const crewWhere: Record<string, unknown> = { tenantId, deletedAt: null };
      const scoped = applyVesselWhereScope(crewWhere, input.vesselCode, scope);
      if (!scoped.ok) return scoped.reason;
      if (typeof input.crewName === "string" && input.crewName.trim()) {
        const q = input.crewName.trim();
        crewWhere.OR = [
          { firstName: { contains: q, mode: "insensitive" } },
          { lastName:  { contains: q, mode: "insensitive" } },
        ];
      }
      const crew = await prisma.crew.findMany({
        where: crewWhere,
        select: {
          id: true, firstName: true, lastName: true, vesselCode: true, status: true,
          rankDefinition: { select: { name: true } },
          vessel: { select: { name: true } },
        },
      });
      if (crew.length === 0) {
        return wrapUntrusted(JSON.stringify({ message: "No crew found for the given scope." }));
      }
      const byId = new Map(crew.map((c: any) => [c.id, c]));

      const where: Record<string, unknown> = { tenantId, crewId: { in: crew.map((c: any) => c.id) } };
      if (input.area)  where.area  = input.area;
      if (input.level) where.level = input.level;

      const rows = await prisma.crewCapability.findMany({
        where,
        take: limit,
        orderBy: [{ area: "asc" }],
        select: { crewId: true, area: true, level: true, validUntil: true, notes: true },
      });

      return toolResult(
        rows.map(({ crewId, ...rest }: any) => {
          const c: any = byId.get(crewId);
          return {
            crewName: c ? `${c.firstName} ${c.lastName}`.trim() : null,
            rank: c?.rankDefinition?.name ?? null,
            vesselCode: c?.vesselCode ?? null,
            vesselName: c?.vessel?.name ?? null,
            crewStatus: c?.status ?? null,
            ...rest,
            validityStatus: rest.validUntil ? expiryStatus(rest.validUntil) : null,
          };
        }),
        "No crew capabilities found matching the given criteria.",
      );
    }

    // ── Insights IA ────────────────────────────────────────────────────────
    if (name === "query_ai_insights") {
      const limit = cap(input.limit, 10, 30);
      const where: Record<string, unknown> = { tenantId };
      where.status = (input.status as string) ?? "OPEN";
      if (input.priority)    where.priority    = input.priority;
      if (input.insightType) where.insightType = input.insightType;

      // Los insights de flota (targetType FLEET) aplican a todos los buques y no
      // llevan vesselCode. Mismas reglas que la inyección del system prompt.
      const clauses: Record<string, unknown>[] = [];
      if (!scope.unrestricted) {
        clauses.push(
          scope.codes.length === 0
            ? { targetType: "FLEET" }
            : { OR: [{ vesselCode: { in: scope.codes } }, { targetType: "FLEET" }] },
        );
      }
      if (typeof input.vesselCode === "string" && input.vesselCode) {
        if (!scope.unrestricted && !scope.codes.includes(input.vesselCode)) {
          return deniedVesselResponse(input.vesselCode, scope);
        }
        clauses.push({ OR: [{ vesselCode: input.vesselCode }, { targetType: "FLEET" }] });
      }
      if (clauses.length > 0) where.AND = clauses;

      const rows = await prisma.aiInsight.findMany({
        where,
        take: limit,
        orderBy: [{ priority: "desc" }, { detectedAt: "desc" }],
        select: {
          insightCode: true, insightType: true, status: true, priority: true,
          targetType: true, vesselCode: true, title: true, summary: true,
          recommendation: true, detectedAt: true, resolvedAt: true, dismissedAt: true,
        },
      });

      return toolResult(rows, "No AI insights found matching the given criteria.");
    }

    return JSON.stringify({ error: `Unknown tool: ${name}` });
  } catch (err) {
    return JSON.stringify({ error: String(err) });
  }
}
