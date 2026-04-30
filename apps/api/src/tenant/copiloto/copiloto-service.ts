/**
 * Copiloto runtime service — powered by Anthropic Claude.
 * Builds the prompt context (guardrails + published template + tenant docs + operational insights)
 * and streams the response via Claude's streaming API.
 *
 * Agentic tool-use loop (1 round):
 *   Phase 1 — stream with tools enabled; collect tool_use blocks.
 *   Phase 2 — if tools were called, execute Prisma queries, inject results, stream final answer.
 *
 * Prompt composition order:
 *   1. Immutable guardrails (system prompt)
 *   2. Published global prompt template for capability + locale
 *   3. Tenant knowledge documents (active versions)
 *   4. Current screen context (when provided by the frontend)
 *   5. Operational insights (last 5 open insights)
 *   6. User messages
 */

import Anthropic from "@anthropic-ai/sdk";
import { getPublishedPrompt } from "../../platform/prompts/platform-prompts-service";
import { getActiveTenantAiDocumentsContent } from "../ai-documents/ai-documents-service";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import type { FileContent } from "./file-parser-service";

// ---------------------------------------------------------------------------
// Immutable guardrails — never exposed to prompt editing
// ---------------------------------------------------------------------------

const GUARDRAILS = `You are a maritime PMS (Planned Maintenance System) copiloto assistant.

Immutable rules:
- Tenant isolation is mandatory. Never reveal data from other tenants.
- You are a copiloto, not an autonomous actor. Never submit forms or close workflows on behalf of the user.
- If you lack evidence to answer, state that explicitly. No hallucination.
- Answer in the same language the user writes in.
- Grounding priority: tenant documents first, operational data second, expert maritime reasoning third.
- Human approval is required before any write action is taken.
- When you recommend the user to consult a GPMS module, always include a direct internal Markdown link using this exact format: [Abrir <Modulo>](<ruta>).
- If the user asks for a specific vessel/asset, include filters in the link query string when applicable. Example: [Abrir Certificados de LATERE](/certificates?vesselCode=LATERE).
- If the user asks for expiring/expired/valid certificates, include status filter when applicable. Example: [Abrir Certificados por vencer](/certificates?status=EXPIRING).
- Apply the same pattern for other modules when applicable. Examples: [Abrir Ordenes de trabajo](/work-orders?vesselCode=LATERE&status=IN_PROGRESS), [Abrir Defectos abiertos](/defects?vesselCode=LATERE&status=OPEN).
- When referencing a specific maintenance plan from query results, always include a direct link using its taskCode: [TASKCODE](/maintenance-plans?openId=PLAN_ID). Use the "id" field as PLAN_ID and "taskCode" as the display text.
- When answering questions about whether a specific task/inspection/procedure is being performed, always use the query_maintenance_plans tool with textSearch to search across title and description fields. Report: plan taskCode (with link), frequency, and last execution date/hours. If nothing is found, say so explicitly.
- IMPORTANT: Before asking the user a question that can be answered by querying the system (e.g. "Does a maintenance plan exist?", "Are there open work orders?"), ALWAYS use the available query tools to look it up yourself first.
- RCA / DEFECT PROACTIVE SEARCH: When you are in DEFECTS or RCA module and you are about to ask the user ANY question about maintenance history, previous work orders, last service date, last fluid/filter/component change, inspection records, or any operational record related to the asset — STOP before asking. First call query_maintenance_plans and query_work_orders using the assetId and vesselCode from the screen context (relatedEntities.assetId). Then in your response: (1) explicitly state what you found — plan name, last execution date/hours, or work orders — or state "No encontré registros de [X] para este activo en el sistema"; (2) only ask the user for additional context if the records were insufficient or absent. Never ask "¿Cuándo fue el último cambio de X?" without first querying the system yourself.
- RCA USER HYPOTHESIS FIRST: When you are about to start or guide an RCA (root cause analysis) — triggered by the user asking to "analizar la causa", "hacer el RCA", "iniciar RCA", "investigar el defecto", or any similar phrase — ALWAYS start with ONE single question before any analysis: "¿Ya tenés alguna hipótesis sobre la posible causa de este defecto?" Wait for the user's answer before proceeding. If the user already provided a hypothesis in their message, do NOT ask again — instead, critically evaluate it before incorporating it: check if it (1) identifies a specific, actionable cause (not just a symptom), (2) is technically plausible given the defect description and any maintenance records found, (3) is falsifiable — i.e., there is a way to confirm or rule it out. If the hypothesis is vague, symptom-level, or incomplete, point it out respectfully and help the user refine it to a proper root cause before proceeding with the full RCA. If the hypothesis is well-formed, confirm it explicitly and build the analysis from there.
- FILL FIELDS: When the user asks to "completar campos faltantes", "complete missing fields", "fill the form", "llenar campos", "rellenar campos", or any similar phrase, analyze the screen context fieldValues (provided in ACTIVE RECORD above), identify fields whose value is null or empty, and propose expert-quality values for them based on domain knowledge and any already-filled fields. Embed the proposed values at the END of your response using EXACTLY this format with no spaces between the markers and the JSON:
[CAMPOS]{"fieldKey": "proposed value", "fieldKey2": "proposed value 2"}[/CAMPOS]
Use the exact key names from the fieldValues object in the screen context. Only include fields that were null/empty and that you can confidently propose — omit already-filled fields. After the block, briefly explain what you filled and why.
- LOTO FIELD FORMAT: When proposing or generating a value for the "loto" field (inside [CAMPOS] or in plain text), you MUST ALWAYS use EXACTLY this three-section structure — no exceptions:

LOTO:
- [cada punto de aislación eléctrica, mecánica o de fluidos requerido]

INSTRUMENTOS NECESARIOS:
- [cada instrumento de medición y herramienta requerida]

EQUIPOS DE PROTECCIÓN PERSONAL NECESARIOS:
- [cada EPP requerido]

If LOTO does not apply, still include all three sections and write "No aplica" under each. Be specific to the task. NEVER write "LOTO no aplica a este plan" as a single sentence — that is WRONG.
When embedding this value inside [CAMPOS] JSON, use \n for newlines so the full structure is preserved in the string value. Example:
[CAMPOS]{"loto": "LOTO:\n- Desconectar breaker X\n\nINSTRUMENTOS NECESARIOS:\n- Multímetro\n\nEQUIPOS DE PROTECCIÓN PERSONAL NECESARIOS:\n- Guantes dieléctricos"}[/CAMPOS]

RESPONSE STYLE — always apply unless the user explicitly asks for more detail:
- No greetings, no introductions, no "of course", no "I'll analyze", no preamble of any kind.
- Start directly with the answer, recommendation, or action.
- Be concise. Use bullet points for lists. Omit filler words.
- Guide the user toward the next action when relevant.
- If the user asks for more detail on a topic, then expand freely.

Available tenant module routes:
- Dashboard: /
- Buques: /vessels
- Activos: /assets
- Planes de mantenimiento: /maintenance-plans
- Ordenes de trabajo: /work-orders
- Reportes diarios: /daily-reports
- Defectos: /defects
- Postergaciones: /deferrals
- RCA: /rca
- CAPA: /capa
- Inspecciones: /inspections
- Certificados: /certificates
- Repuestos: /spares
- Pedidos de repuestos: /spare-orders
- Proveedores: /providers
- Insights IA: /ai-insights
- Base documental IA: /ai-documents

DOMAIN TERMINOLOGY (tenant-specific):
- "Luz de válvulas" = "huelgo de válvulas" (valve clearance). When the user or any document mentions "luz de válvulas", interpret and respond using the correct technical term "huelgo de válvulas".`.trim();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface CopilotoRequest {
  capability: string;
  locale: string;
  messages: ChatMessage[];
  vesselCode?: string | null;
  tenantId: string;
  tenantSlug: string;
  /**
   * Structured snapshot of the screen the user is working on (emitted by the frontend).
   * Injected into the system prompt so the AI can give context-aware answers.
   * Sanitised: only string/null leaf values, no circular refs, no sensitive secrets.
   */
  screenContext?: Record<string, unknown> | null;
  /**
   * Optional file attachment parsed by file-parser-service.
   * Injected as a multimodal content block into the last user message.
   * Sent once; subsequent turns carry context through conversation history.
   */
  fileAttachment?: FileContent | null;
}

// ---------------------------------------------------------------------------
// Copilot query tools — agentic DB access so the AI answers its own questions
// ---------------------------------------------------------------------------

const COPILOT_TOOLS: Anthropic.Tool[] = [
  {
    name: "query_maintenance_plans",
    description:
      "Query maintenance plans for the current tenant/vessel. Use this when you need to check if a maintenance plan exists, find its status, due date, frequency, responsible party, or verify whether a specific task/inspection is being performed. Always prefer calling this tool over asking the user. When searching for a specific activity (e.g. 'termografía', 'alineación', 'cambio de aceite'), use textSearch to search across both title AND the task description ('Tareas a realizar') field simultaneously.",
    input_schema: {
      type: "object" as const,
      properties: {
        vesselCode: { type: "string", description: "Filter by vessel code (required)" },
        assetId: { type: "string", description: "Filter by asset ID (optional)" },
        status: {
          type: "string",
          description: "Filter by plan status: ACTIVE | DUE_SOON | OVERDUE | INACTIVE (optional)",
        },
        textSearch: { type: "string", description: "Case-insensitive substring search across both title AND description/tasks fields simultaneously (optional). Use this to find plans related to a specific activity, inspection, or procedure." },
        limit: { type: "number", description: "Max results to return (default 20, max 50)" },
      },
      required: ["vesselCode"],
    },
  },
  {
    name: "query_work_orders",
    description:
      "Query work orders for the current tenant/vessel. Use this to check open/in-progress work orders, find work order history for an asset, or verify whether a corrective action already exists.",
    input_schema: {
      type: "object" as const,
      properties: {
        vesselCode: { type: "string", description: "Filter by vessel code (required)" },
        assetId: { type: "string", description: "Filter by asset ID (optional)" },
        status: {
          type: "string",
          description: "Filter by status: PLANNED | IN_PROGRESS | ON_HOLD | DEFERRED | CLOSED | CANCELLED (optional)",
        },
        type: {
          type: "string",
          description: "Filter by type: PREVENTIVE | CORRECTIVE | INSPECTION (optional)",
        },
        limit: { type: "number", description: "Max results to return (default 10, max 20)" },
      },
      required: ["vesselCode"],
    },
  },
  {
    name: "query_defects",
    description:
      "Query defects for the current tenant/vessel. Use this to check for open defects on an asset, find related defects, or check defect history.",
    input_schema: {
      type: "object" as const,
      properties: {
        vesselCode: { type: "string", description: "Filter by vessel code (required)" },
        assetId: { type: "string", description: "Filter by asset ID (optional)" },
        status: {
          type: "string",
          description: "Filter by status: OPEN | UNDER_REVIEW | IN_PROGRESS | DEFERRED | RESOLVED | CLOSED (optional)",
        },
        severity: {
          type: "string",
          description: "Filter by severity: LOW | MEDIUM | HIGH | CRITICAL (optional)",
        },
        limit: { type: "number", description: "Max results to return (default 10, max 20)" },
      },
      required: ["vesselCode"],
    },
  },
  {
    name: "query_capa_records",
    description:
      "Query CAPA (Corrective and Preventive Action) records for the current tenant/vessel. Use this to check if a CAPA exists for an RCA or defect, find CAPA status, or review action completion.",
    input_schema: {
      type: "object" as const,
      properties: {
        vesselCode: { type: "string", description: "Filter by vessel code (required)" },
        sourceType: {
          type: "string",
          description: "Filter by source: RCA | DEFECT | WORK_ORDER | INSPECTION (optional)",
        },
        sourceId: { type: "string", description: "Filter by source entity ID (optional)" },
        status: {
          type: "string",
          description: "Filter by status: OPEN | IN_PROGRESS | PENDING_VERIFICATION | CLOSED | CANCELLED (optional)",
        },
        limit: { type: "number", description: "Max results to return (default 10, max 20)" },
      },
      required: ["vesselCode"],
    },
  },
  {
    name: "query_fluid_analyses",
    description:
      "Query fluid analyses (oil, fuel, water, hydraulic) for the current tenant. Use this to check the latest sample of a piece of equipment, find the verdict (NORMAL/CAUTION/CRITICAL/ACTION_REQUIRED), inspect parameters (Fe, Cu, water, TBN, etc.), or look at history. Each sample has a result with parameters and verdict.",
    input_schema: {
      type: "object" as const,
      properties: {
        vesselCode: { type: "string", description: "Filter by vessel code (optional)" },
        assetId:    { type: "string", description: "Filter by asset ID (optional)" },
        fluidType:  { type: "string", description: "Filter by fluid type: ENGINE_OIL | HYDRAULIC_OIL | GEARBOX_OIL | TRANSMISSION_OIL | FUEL_DIESEL | FUEL_GASOIL | COOLING_WATER | BOILER_WATER | POTABLE_WATER | REFRIGERANT | OTHER (optional)" },
        verdict:    { type: "string", description: "Filter by verdict: NORMAL | CAUTION | CRITICAL | ACTION_REQUIRED (optional)" },
        limit:      { type: "number", description: "Max results to return (default 10, max 20)" },
      },
    },
  },
  {
    name: "query_fluid_trend",
    description:
      "Get the chronological trend (last N samples) of a single asset's fluid parameter. Use this to detect degradation trends, e.g. when the user asks 'cómo viene el motor SB' or 'el hierro está subiendo'. Returns numeric values per parameter ordered from oldest to newest.",
    input_schema: {
      type: "object" as const,
      properties: {
        assetId:   { type: "string", description: "Asset ID (required)" },
        fluidType: { type: "string", description: "Filter by fluid type (optional, recommended for accuracy)" },
        limit:     { type: "number", description: "Number of samples to include in the trend (default 10, max 50)" },
      },
      required: ["assetId"],
    },
  },
];

// ---------------------------------------------------------------------------
// Tool executor — runs Prisma queries, always scoped to tenantId
// ---------------------------------------------------------------------------

async function executeCopilotTool(
  name: string,
  input: Record<string, unknown>,
  tenantId: string,
): Promise<string> {
  const prisma = getPrismaClient();
  if (!prisma) return JSON.stringify({ error: "Database not available in current environment" });

  const limit = Math.min(Number(input.limit ?? 10), 20);

  try {
    if (name === "query_maintenance_plans") {
      const where: Record<string, unknown> = {
        tenantId,
        vesselCode: input.vesselCode,
        deletedAt: null,
      };
      if (input.assetId) where.assetId = input.assetId;
      if (input.status) where.status = input.status;
      if (input.textSearch) {
        where.OR = [
          { title:       { contains: input.textSearch as string, mode: "insensitive" } },
          { description: { contains: input.textSearch as string, mode: "insensitive" } },
        ];
      }

      const rows = await prisma.maintenancePlan.findMany({
        where,
        take: Math.min(Number(input.limit ?? 20), 50),
        orderBy: { nextDueDate: "asc" },
        select: {
          id: true,
          taskCode: true,
          title: true,
          description: true,
          status: true,
          executionStatus: true,
          triggerType: true,
          frequencyHours: true,
          frequencyMonths: true,
          nextDueDate: true,
          nextDueHours: true,
          lastExecutionDate: true,
          lastExecutionHours: true,
          responsible: true,
        },
      });

      return JSON.stringify(
        rows.length > 0 ? rows : { message: "No maintenance plans found matching the given criteria." },
      );
    }

    if (name === "query_work_orders") {
      const where: Record<string, unknown> = {
        tenantId,
        vesselCode: input.vesselCode,
        deletedAt: null,
      };
      if (input.assetId) where.assetId = input.assetId;
      if (input.status) where.status = input.status;
      if (input.type) where.type = input.type;

      const rows = await prisma.workOrder.findMany({
        where,
        take: limit,
        orderBy: { openDate: "desc" },
        select: {
          workOrderCode: true,
          title: true,
          type: true,
          status: true,
          priority: true,
          dueDate: true,
          openDate: true,
          completedDate: true,
          description: true,
        },
      });

      return JSON.stringify(
        rows.length > 0 ? rows : { message: "No work orders found matching the given criteria." },
      );
    }

    if (name === "query_defects") {
      const where: Record<string, unknown> = {
        tenantId,
        vesselCode: input.vesselCode,
        deletedAt: null,
      };
      if (input.assetId) where.assetId = input.assetId;
      if (input.status) where.status = input.status;
      if (input.severity) where.severity = input.severity;

      const rows = await prisma.defect.findMany({
        where,
        take: limit,
        orderBy: { reportedAt: "desc" },
        select: {
          defectCode: true,
          status: true,
          severity: true,
          classification: true,
          description: true,
          reportedAt: true,
          immediateAction: true,
          correctiveAction: true,
        },
      });

      return JSON.stringify(
        rows.length > 0 ? rows : { message: "No defects found matching the given criteria." },
      );
    }

    if (name === "query_capa_records") {
      const where: Record<string, unknown> = {
        tenantId,
        vesselCode: input.vesselCode,
        deletedAt: null,
      };
      if (input.sourceType) where.sourceType = input.sourceType;
      if (input.sourceId) where.sourceId = input.sourceId;
      if (input.status) where.status = input.status;

      const rows = await prisma.capaRecord.findMany({
        where,
        take: limit,
        orderBy: { createdAt: "desc" },
        select: {
          capaCode: true,
          title: true,
          status: true,
          priority: true,
          dueDate: true,
          completedAt: true,
          owner: true,
          description: true,
        },
      });

      return JSON.stringify(
        rows.length > 0 ? rows : { message: "No CAPA records found matching the given criteria." },
      );
    }

    if (name === "query_fluid_analyses") {
      const where: Record<string, unknown> = { tenantId, deletedAt: null };
      if (input.vesselCode) where.vesselCode = input.vesselCode;
      if (input.assetId)    where.assetId    = input.assetId;
      if (input.fluidType)  where.fluidType  = input.fluidType;
      const samples = await (prisma as any).fluidSample.findMany({
        where,
        take: limit,
        orderBy: { sampledAt: "desc" },
        select: {
          sampleCode: true, vesselCode: true, assetId: true, fluidType: true,
          sampledAt: true, runningHours: true, status: true, labName: true,
          result: { select: { verdict: true, summary: true, parameters: true, receivedAt: true } },
        },
      });
      const filtered = input.verdict
        ? samples.filter((s: any) => s.result?.verdict === input.verdict)
        : samples;
      return JSON.stringify(
        filtered.length > 0 ? filtered : { message: "No fluid analyses found." },
      );
    }

    if (name === "query_fluid_trend") {
      const assetId = String(input.assetId || "");
      if (!assetId) return JSON.stringify({ error: "assetId is required" });
      const trendLimit = Math.min(Number(input.limit ?? 10), 50);
      const where: Record<string, unknown> = { tenantId, assetId, deletedAt: null };
      if (input.fluidType) where.fluidType = input.fluidType;
      const samples = await (prisma as any).fluidSample.findMany({
        where, take: trendLimit, orderBy: { sampledAt: "asc" },
        select: {
          sampleCode: true, sampledAt: true, runningHours: true, fluidType: true,
          result: { select: { verdict: true, parameters: true } },
        },
      });
      const trend = samples.map((s: any) => {
        const values: Record<string, number> = {};
        const params = s.result?.parameters as Record<string, any> | null;
        if (params) {
          for (const [k, raw] of Object.entries(params)) {
            const v = (raw && typeof raw === "object" && "value" in (raw as any)) ? (raw as any).value : raw;
            const n = typeof v === "number" ? v : Number(v);
            if (Number.isFinite(n)) values[k] = n;
          }
        }
        return { sampleCode: s.sampleCode, sampledAt: s.sampledAt, runningHours: s.runningHours, fluidType: s.fluidType, verdict: s.result?.verdict ?? null, values };
      });
      return JSON.stringify(trend.length > 0 ? trend : { message: "No samples for this asset." });
    }

    return JSON.stringify({ error: `Unknown tool: ${name}` });
  } catch (err) {
    return JSON.stringify({ error: String(err) });
  }
}

// ---------------------------------------------------------------------------
// Main streaming function — agentic loop (max 1 tool-use round)
// ---------------------------------------------------------------------------

export async function streamCopilotoChat(
  req: CopilotoRequest,
  onChunk: (text: string) => void,
): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new RouteError(503, "AI_NOT_CONFIGURED", "ANTHROPIC_API_KEY is not configured.");
  }

  if (!req.messages || req.messages.length === 0) {
    throw new RouteError(400, "INVALID_REQUEST", "messages array must not be empty.");
  }

  // Build context in parallel
  const [publishedPrompt, docsContent] = await Promise.all([
    getPublishedPrompt(req.capability, req.locale),
    getActiveTenantAiDocumentsContent(req.tenantId),
  ]);

  const systemParts: string[] = [GUARDRAILS];

  if (publishedPrompt) {
    systemParts.push(`## Capability Instructions\n${publishedPrompt}`);
  }

  if (docsContent) {
    systemParts.push(`## Tenant Knowledge Documents\n${docsContent}`);
  }

  // Inject current screen context when provided by the frontend
  if (req.screenContext && typeof req.screenContext === "object" && Object.keys(req.screenContext).length > 0) {
    const ctx = req.screenContext;
    const entityCode  = ctx.entityCode  as string | undefined;
    const module_     = ctx.module      as string | undefined;
    const vesselCode  = ctx.vesselCode  as string | undefined;
    const stage       = ctx.workflowStage as string | undefined;

    const refParts = [
      entityCode                         && `**${entityCode}**`,
      module_                            && `(${module_})`,
      vesselCode                         && `vessel ${vesselCode}`,
      stage                              && `status: ${stage}`,
    ].filter(Boolean);

    systemParts.push(
      `## ACTIVE RECORD — CRITICAL CONTEXT\n` +
      `The user currently has this specific record open on their screen: ${refParts.join(", ")}.\n` +
      `When the user refers to "the RCA", "this work order", "this case", "analyze it", "help me", ` +
      `or uses ANY ambiguous reference, they mean **this exact entity**.\n` +
      `**NEVER ask which record, vessel, or entity to analyze — you already know. ` +
      `Use the field values below and answer directly.**\n\n` +
      JSON.stringify(ctx, null, 2),
    );
  }

  // Inject last 5 open insights as operational context
  const prisma = getPrismaClient();
  if (prisma) {
    try {
      const insightWhere: Record<string, unknown> = { tenantId: req.tenantId, status: "OPEN" };
      if (req.vesselCode) insightWhere.vesselCode = req.vesselCode;

      const insights = await prisma.aiInsight.findMany({
        where: insightWhere,
        orderBy: [{ priority: "desc" }, { detectedAt: "desc" }],
        take: 5,
        select: {
          insightType: true,
          priority: true,
          title: true,
          summary: true,
          vesselCode: true,
        },
      });

      if (insights.length > 0) {
        const insightBlock = insights
          .map(i => `[${i.priority}] ${i.title} (${i.vesselCode ?? "fleet"}): ${i.summary}`)
          .join("\n");
        systemParts.push(`## Active Operational Insights\n${insightBlock}`);
      }
    } catch {
      // non-fatal — proceed without insights context
    }
  }

  const client = new Anthropic({ apiKey });
  const systemPrompt = systemParts.join("\n\n");

  const baseMessages: Anthropic.MessageParam[] = req.messages.map((m, i) => {
    // Inject file attachment as multimodal block into the last user message
    if (
      i === req.messages.length - 1 &&
      m.role === "user" &&
      req.fileAttachment
    ) {
      const fa = req.fileAttachment;
      const contentBlocks: Anthropic.ContentBlockParam[] = [];

      if (fa.type === "text") {
        contentBlocks.push({
          type: "text",
          text: `Archivo adjunto — ${fa.fileName}:\n\n${fa.text}`,
        });
      } else if (fa.type === "image") {
        contentBlocks.push({
          type: "image",
          source: {
            type: "base64",
            media_type: fa.mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
            data: fa.base64,
          },
        });
      } else if (fa.type === "document") {
        // PDF — Claude native document reading (claude-3-5+)
        contentBlocks.push({
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: fa.base64 },
        } as unknown as Anthropic.ContentBlockParam);
      }

      contentBlocks.push({ type: "text", text: m.content });
      return { role: "user" as const, content: contentBlocks };
    }
    return { role: m.role, content: m.content };
  });

  // ── Phase 1: stream with tools enabled ──────────────────────────────────────
  const phase1Stream = client.messages.stream({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2048,
    system: systemPrompt,
    tools: COPILOT_TOOLS,
    messages: baseMessages,
  });

  // Emit text chunks from phase 1 in real time
  for await (const chunk of phase1Stream) {
    if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
      onChunk(chunk.delta.text);
    }
  }

  const phase1Msg = await phase1Stream.finalMessage();

  // If the model ended with tool_use, execute tools and do a second streaming pass
  if (phase1Msg.stop_reason === "tool_use") {
    const toolUseBlocks = phase1Msg.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );

    // Execute all requested tools (in parallel)
    const toolResults = await Promise.all(
      toolUseBlocks.map(async (block) => ({
        type: "tool_result" as const,
        tool_use_id: block.id,
        content: await executeCopilotTool(
          block.name,
          block.input as Record<string, unknown>,
          req.tenantId,
        ),
      })),
    );

    // Build updated message list: original + assistant turn + tool results
    const phase2Messages: Anthropic.MessageParam[] = [
      ...baseMessages,
      { role: "assistant", content: phase1Msg.content },
      { role: "user", content: toolResults },
    ];

    // ── Phase 2: stream final answer with tool results ─────────────────────────
    const phase2Stream = client.messages.stream({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      system: systemPrompt,
      // No tools in phase 2 — prevent infinite looping
      messages: phase2Messages,
    });

    for await (const chunk of phase2Stream) {
      if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
        onChunk(chunk.delta.text);
      }
    }
  }
}
