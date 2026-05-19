import Anthropic from "@anthropic-ai/sdk";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { recordAiUsage } from "../usage/usage-service";
import { log } from "../../common/logger";
import { buildFluidAnalysisRegulationContext } from "../../common/regulations/maritime";

const SYSTEM_PROMPT_BASE = `Sos un experto en mantenimiento predictivo y análisis de fluidos para flotas marítimas.
Te paso el resultado de UN análisis de fluido (con sus parámetros) más el HISTORIAL de muestras anteriores
del mismo equipo y mismo tipo de fluido. Tu tarea es generar un informe técnico breve y operativo en español
con TRES secciones, en formato Markdown:

## Tendencias clave
Describí 2-4 tendencias que veas comparando esta muestra contra las anteriores (subió/bajó/estable).
Mencioná los parámetros más relevantes con sus valores.

## Interpretación
Qué significan esas tendencias para el estado del equipo y del fluido. Sé concreto, evitá generalidades.

## Recomendaciones
2-4 acciones concretas y priorizadas. Si no hay alarma, indicar próximo control sugerido.

Reglas:
- Máximo 250 palabras en total.
- No inventes parámetros que no aparezcan en los datos.
- Si solo hay 1 muestra (la actual), aclará que no hay base de comparación y limitate a interpretar la muestra puntual.
- Tono: técnico, directo, sin marketing.

{REGULATORY_CONTEXT}
`;

interface GenerateInput {
  tenantId: string;
  tenantSlug: string;
  userId: string;
  userEmail: string;
  sampleId: string;
}

export interface GenerateResult {
  aiAnalysis: string | null;
  aiAnalysisGeneratedAt: Date | null;
}

export async function generateFluidAiAnalysis(input: GenerateInput): Promise<GenerateResult> {
  const empty: GenerateResult = { aiAnalysis: null, aiAnalysisGeneratedAt: null };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    log.warn("[fluid-ai-insights] ANTHROPIC_API_KEY no configurada, skip");
    return empty;
  }

  const prisma = getPrismaClient();
  if (!prisma) return empty;

  const sample = await (prisma as any).fluidSample.findFirst({
    where: { id: input.sampleId, tenantId: input.tenantId, deletedAt: null },
    include: { result: true },
  });
  if (!sample || !sample.result) return empty;

  const history = await (prisma as any).fluidSample.findMany({
    where: {
      tenantId: input.tenantId,
      assetId: sample.assetId,
      fluidType: sample.fluidType,
      deletedAt: null,
    },
    orderBy: { sampledAt: "asc" },
    take: 12,
    include: { result: true },
  });

  const assetRow = await (prisma as any).asset.findUnique({
    where: { id: sample.assetId },
    select: { name: true, assetCode: true },
  });

  const dataPayload = {
    asset: { code: assetRow?.assetCode ?? null, name: assetRow?.name ?? null },
    vesselCode: sample.vesselCode,
    fluidType: sample.fluidType,
    fluidProduct: sample.fluidProduct,
    currentSample: {
      sampleCode: sample.sampleCode,
      sampledAt: sample.sampledAt.toISOString(),
      runningHours: sample.runningHours,
      verdict: sample.result.verdict,
      summary: sample.result.summary,
      parameters: sample.result.parameters,
    },
    history: history.map((h: any) => ({
      sampleCode: h.sampleCode,
      sampledAt: h.sampledAt.toISOString(),
      runningHours: h.runningHours,
      verdict: h.result?.verdict ?? null,
      parameters: h.result?.parameters ?? null,
    })),
  };

  // Resolver el contexto regulatorio para este tipo de fluido — anchorea los
  // estándares aplicables y le prohíbe a la IA inventar números.
  const regulatoryContext = buildFluidAnalysisRegulationContext(sample.fluidType);
  const systemPrompt = SYSTEM_PROMPT_BASE.replace("{REGULATORY_CONTEXT}", regulatoryContext);

  const client = new Anthropic({ apiKey, timeout: 30_000, maxRetries: 1 });
  const model = "claude-haiku-4-5-20251001";
  const aiStarted = Date.now();

  let response;
  try {
    response = await client.messages.create({
      model,
      max_tokens: 1024,
      system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: JSON.stringify(dataPayload, null, 2) }],
    });
  } catch (err) {
    log.error("[fluid-ai-insights] Anthropic call failed:", err);
    return empty;
  }

  recordAiUsage({
    tenantId: input.tenantId,
    tenantSlug: input.tenantSlug,
    userId: input.userId,
    userEmail: input.userEmail,
    vesselCode: sample.vesselCode,
    feature: "fluid_ai_insights",
    model,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
    latencyMs: Date.now() - aiStarted,
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map(b => b.text)
    .join("\n")
    .trim();

  if (!text) return empty;

  const generatedAt = new Date();
  await (prisma as any).fluidAnalysisResult.update({
    where: { id: sample.result.id },
    data: { aiAnalysis: text, aiAnalysisGeneratedAt: generatedAt },
  });

  return { aiAnalysis: text, aiAnalysisGeneratedAt: generatedAt };
}
