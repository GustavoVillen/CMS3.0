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
- IMPORTANT: Before asking the user a question that can be answered by querying the system (e.g. "Does a maintenance plan exist?", "Are there open work orders?"), ALWAYS use the available query tools to look it up yourself first.
- FILL FIELDS: When the user asks to "completar campos faltantes", "complete missing fields", "fill the form", "llenar campos", "rellenar campos", or any similar phrase, analyze the screen context fieldValues (provided in ACTIVE RECORD above), identify fields whose value is null or empty, and propose expert-quality values for them based on domain knowledge and any already-filled fields. Embed the proposed values at the END of your response using EXACTLY this format with no spaces between the markers and the JSON:
[CAMPOS]{"fieldKey": "proposed value", "fieldKey2": "proposed value 2"}[/CAMPOS]
Use the exact key names from the fieldValues object in the screen context. Only include fields that were null/empty and that you can confidently propose — omit already-filled fields. After the block, briefly explain what you filled and why.

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
- Base documental IA: /ai-documents`.trim();

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
}

// ---------------------------------------------------------------------------
// Copilot query tools — agentic DB access so the AI answers its own questions
// ---------------------------------------------------------------------------

const COPILOT_TOOLS: Anthropic.Tool[] = [
  {
    name: "query_maintenance_plans",
    description:
      "Query maintenance plans for the current tenant/vessel. Use this when you need to check if a maintenance plan exists, find its status, due date, frequency, or responsible party. Always prefer calling this tool over asking the user.",
    input_schema: {
      type: "object" as const,
      properties: {
        vesselCode: { type: "string", description: "Filter by vessel code (required)" },
        assetId: { type: "string", description: "Filter by asset ID (optional)" },
        status: {
          type: "string",
          description: "Filter by plan status: ACTIVE | DUE_SOON | OVERDUE | INACTIVE (optional)",
        },
        titleContains: { type: "string", description: "Case-insensitive substring search in title (optional)" },
        limit: { type: "number", description: "Max results to return (default 10, max 20)" },
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
    name: "query_rca_records",
    description:
      "Query RCA (Root Cause Analysis) records for the current tenant/vessel. Use this to check if an RCA already exists for a defect/work order, find RCA status, or review analysis history.",
    input_schema: {
      type: "object" as const,
      properties: {
        vesselCode: { type: "string", description: "Filter by vessel code (required)" },
        defectId: { type: "string", description: "Filter by related defect ID (optional)" },
        workOrderId: { type: "string", description: "Filter by related work order ID (optional)" },
        status: {
          type: "string",
          description: "Filter by status: DRAFT | UNDER_ANALYSIS | COMPLETED | APPROVED | CLOSED (optional)",
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
      if (input.titleContains) where.title = { contains: input.titleContains as string, mode: "insensitive" };

      const rows = await prisma.maintenancePlan.findMany({
        where,
        take: limit,
        orderBy: { nextDueDate: "asc" },
        select: {
          taskCode: true,
          title: true,
          status: true,
          executionStatus: true,
          triggerType: true,
          frequencyHours: true,
          frequencyMonths: true,
          nextDueDate: true,
          lastExecutionDate: true,
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

    if (name === "query_rca_records") {
      const where: Record<string, unknown> = {
        tenantId,
        vesselCode: input.vesselCode,
        deletedAt: null,
      };
      if (input.defectId) where.defectId = input.defectId;
      if (input.workOrderId) where.workOrderId = input.workOrderId;
      if (input.status) where.status = input.status;

      const rows = await prisma.rcaRecord.findMany({
        where,
        take: limit,
        orderBy: { createdAt: "desc" },
        select: {
          rcaCode: true,
          status: true,
          methodology: true,
          analysisSummary: true,
          rootCause: true,
          correctiveActions: true,
          completedAt: true,
          approvedAt: true,
        },
      });

      return JSON.stringify(
        rows.length > 0 ? rows : { message: "No RCA records found matching the given criteria." },
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

  const baseMessages: Anthropic.MessageParam[] = req.messages.map(m => ({
    role: m.role,
    content: m.content,
  }));

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
