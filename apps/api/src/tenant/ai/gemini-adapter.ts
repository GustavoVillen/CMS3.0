/**
 * Adaptador Gemini con la forma del SDK de Anthropic.
 *
 * Los ~23 call sites del PMS hablan "Anthropic": arman `system` + `messages` con
 * bloques `text` / `image` / `document` / `tool_use` / `tool_result`, y leen
 * `content[]`, `stop_reason` y `usage.*` de la respuesta. En vez de reescribir
 * los 17 servicios, este archivo traduce esa forma a/desde Gemini para que el
 * cambio de proveedor sea una variable de entorno.
 *
 * Sólo se implementa la superficie que el repo realmente usa:
 *   - messages.create(body, { signal })
 *   - messages.stream(body, { signal })  → iterable de text_delta + finalMessage()
 * Cualquier otra cosa del SDK de Anthropic NO está cubierta acá a propósito.
 */
import type Anthropic from "@anthropic-ai/sdk";
import {
  GoogleGenAI,
  FunctionCallingConfigMode,
  type Content,
  type GenerateContentConfig,
  type GenerateContentResponse,
  type GenerateContentResponseUsageMetadata,
  type Part,
} from "@google/genai";

// ── Tipos del cliente compartido ─────────────────────────────────────────────

export interface AiMessageStream extends AsyncIterable<Anthropic.MessageStreamEvent> {
  finalMessage(): Promise<Anthropic.Message>;
}

export interface AiRequestOptions {
  signal?: AbortSignal;
}

/**
 * Los campos del request que el adaptador realmente traduce. Se declara como
 * `Pick` para aceptar tanto el body de `create()` como el de `stream()` (que
 * sólo difieren en el flag `stream`).
 */
type AiRequestBody = Pick<
  Anthropic.MessageCreateParams,
  "model" | "max_tokens" | "system" | "messages" | "tools" | "tool_choice" | "temperature" | "thinking"
>;

export interface AiClient {
  messages: {
    create(
      body: Anthropic.MessageCreateParamsNonStreaming,
      options?: AiRequestOptions,
    ): Promise<Anthropic.Message>;
    stream(body: Anthropic.MessageStreamParams, options?: AiRequestOptions): AiMessageStream;
  };
}

// ── Utilidades ───────────────────────────────────────────────────────────────

/**
 * Campo propio (no estándar de Anthropic) donde guardamos la firma de pensamiento
 * de Gemini dentro del bloque `tool_use`, para poder devolvérsela en el turno
 * siguiente del loop agéntico. Con `AI_PROVIDER=anthropic` nunca aparece.
 */
const THOUGHT_SIGNATURE_KEY = "_geminiThoughtSignature" as const;

let idCounter = 0;
function genId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_gem_${Date.now().toString(36)}${idCounter.toString(36)}`;
}

/** `system` de Anthropic es string o array de bloques de texto. Gemini quiere un texto. */
function toSystemInstruction(
  system: AiRequestBody["system"],
): string | undefined {
  if (!system) return undefined;
  if (typeof system === "string") return system || undefined;
  const text = system
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n\n");
  return text || undefined;
}

/**
 * Anthropic identifica los `tool_result` sólo por `tool_use_id`, pero Gemini
 * exige el NOMBRE de la función en el `functionResponse`. Recorremos el historial
 * para reconstruir id → nombre a partir de los bloques `tool_use` previos.
 */
function buildToolNameById(messages: Anthropic.MessageParam[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of messages) {
    if (typeof m.content === "string") continue;
    for (const block of m.content) {
      if (block.type === "tool_use") map.set(block.id, block.name);
    }
  }
  return map;
}

/** El contenido de un `tool_result` puede ser string o bloques; Gemini quiere un objeto. */
function toolResultToObject(
  content: Anthropic.ToolResultBlockParam["content"],
): Record<string, unknown> {
  if (typeof content === "string") return { result: content };
  if (!content) return { result: "" };
  const text = content
    .map((b) => (b.type === "text" ? b.text : ""))
    .filter(Boolean)
    .join("\n");
  return { result: text };
}

function blockToPart(
  block: Anthropic.ContentBlockParam,
  toolNameById: Map<string, string>,
): Part | null {
  switch (block.type) {
    case "text":
      return block.text ? { text: block.text } : null;

    case "image":
      // Sólo se usa base64 en el repo (fotos de defectos, OCR de avance).
      if (block.source.type !== "base64") return null;
      return { inlineData: { mimeType: block.source.media_type, data: block.source.data } };

    case "document":
      if (block.source.type !== "base64") return null;
      return { inlineData: { mimeType: "application/pdf", data: block.source.data } };

    case "tool_use": {
      // Gemini exige que le devolvamos la "firma de pensamiento" que emitió junto
      // a la llamada; sin ella rechaza el turno siguiente del loop agéntico con
      // "Function call is missing a thought_signature". Como el bloque `tool_use`
      // de Anthropic no tiene dónde guardarla, la viajamos en un campo propio que
      // adjuntamos al crear el bloque (ver `toAnthropicMessage`). Los servicios
      // devuelven `msg.content` tal cual, así que sobrevive la vuelta completa.
      const signature = (block as { [THOUGHT_SIGNATURE_KEY]?: string })[THOUGHT_SIGNATURE_KEY];
      return {
        functionCall: {
          id: block.id,
          name: block.name,
          args: (block.input ?? {}) as Record<string, unknown>,
        },
        ...(signature ? { thoughtSignature: signature } : {}),
      };
    }

    case "tool_result":
      return {
        functionResponse: {
          id: block.tool_use_id,
          name: toolNameById.get(block.tool_use_id) ?? "unknown_tool",
          response: toolResultToObject(block.content),
        },
      };

    default:
      return null;
  }
}

function toContents(messages: Anthropic.MessageParam[]): Content[] {
  const toolNameById = buildToolNameById(messages);
  const contents: Content[] = [];

  for (const m of messages) {
    const role = m.role === "assistant" ? "model" : "user";
    const parts: Part[] =
      typeof m.content === "string"
        ? m.content
          ? [{ text: m.content }]
          : []
        : m.content
            .map((b) => blockToPart(b, toolNameById))
            .filter((p): p is Part => p !== null);

    if (parts.length === 0) continue;
    contents.push({ role, parts });
  }

  return contents;
}

function toGeminiTools(body: AiRequestBody): GenerateContentConfig["tools"] {
  if (!body.tools || body.tools.length === 0) return undefined;

  const functionDeclarations = body.tools
    .filter((t): t is Anthropic.Tool => "input_schema" in t && !!t.name)
    .map((t) => ({
      name: t.name,
      description: t.description ?? "",
      // `parametersJsonSchema` acepta JSON Schema estándar tal cual (incluye
      // `additionalProperties`), así que los esquemas de las tools del PMS pasan
      // sin traducción ni saneado.
      parametersJsonSchema: t.input_schema,
    }));

  return functionDeclarations.length > 0 ? [{ functionDeclarations }] : undefined;
}

function toToolConfig(
  toolChoice: AiRequestBody["tool_choice"],
): GenerateContentConfig["toolConfig"] {
  if (!toolChoice) return undefined;

  switch (toolChoice.type) {
    case "tool":
      // Generación estructurada forzada (RCA, MOC draft, TMSA assessment).
      return {
        functionCallingConfig: {
          mode: FunctionCallingConfigMode.ANY,
          allowedFunctionNames: [toolChoice.name],
        },
      };
    case "any":
      return { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY } };
    case "none":
      return { functionCallingConfig: { mode: FunctionCallingConfigMode.NONE } };
    default:
      return { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } };
  }
}

function toConfig(
  body: AiRequestBody,
  options: AiRequestOptions | undefined,
  timeoutMs: number | undefined,
): GenerateContentConfig {
  const config: GenerateContentConfig = {
    maxOutputTokens: body.max_tokens,
    systemInstruction: toSystemInstruction(body.system),
  };

  if (typeof body.temperature === "number") config.temperature = body.temperature;

  const tools = toGeminiTools(body);
  if (tools) {
    config.tools = tools;
    const toolConfig = toToolConfig(body.tool_choice);
    if (toolConfig) config.toolConfig = toolConfig;
  }

  // Pensamiento APAGADO por defecto. Ningún servicio del PMS lo quiere: todos
  // esperan JSON o texto acotado dentro de un `max_tokens` chico. Algunos modelos
  // de Gemini piensan por defecto y se comen el presupuesto — medido: gemini-3.5-flash
  // con max_tokens 1024 gastó 984 tokens pensando y devolvió la salida TRUNCADA.
  // Sólo lo dejamos pensar si el llamador lo pide explícitamente.
  const wantsThinking = body.thinking != null && body.thinking.type !== "disabled";
  if (!wantsThinking) config.thinkingConfig = { thinkingBudget: 0 };

  if (options?.signal) config.abortSignal = options.signal;
  if (timeoutMs) config.httpOptions = { timeout: timeoutMs };

  return config;
}

// ── Respuesta Gemini → Message de Anthropic ──────────────────────────────────

function toUsage(usage: GenerateContentResponseUsageMetadata | undefined) {
  const cached = usage?.cachedContentTokenCount ?? 0;
  return {
    // `promptTokenCount` ya incluye los tokens cacheados; los restamos para no
    // contarlos dos veces al calcular el costo en usage-service.
    input_tokens: Math.max(0, (usage?.promptTokenCount ?? 0) - cached),
    output_tokens: (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
    cache_read_input_tokens: cached,
    // Gemini cachea implícito: no cobra escritura de caché.
    cache_creation_input_tokens: 0,
  };
}

function toAnthropicMessage(
  parts: Part[],
  usage: GenerateContentResponseUsageMetadata | undefined,
  finishReason: string | undefined,
  model: string,
): Anthropic.Message {
  const content: Anthropic.ContentBlock[] = [];

  // Todos los fragmentos de texto se unen en un único bloque, como hace Anthropic.
  const text = parts
    .filter((p) => p.text && !p.thought)
    .map((p) => p.text)
    .join("");
  if (text) content.push({ type: "text", text, citations: null } as Anthropic.ContentBlock);

  for (const p of parts) {
    if (!p.functionCall?.name) continue;
    content.push({
      type: "tool_use",
      id: p.functionCall.id ?? genId("toolu"),
      name: p.functionCall.name,
      input: p.functionCall.args ?? {},
      // Ver `blockToPart`: Gemini nos la pide de vuelta en el turno siguiente.
      ...(p.thoughtSignature ? { [THOUGHT_SIGNATURE_KEY]: p.thoughtSignature } : {}),
    } as unknown as Anthropic.ContentBlock);
  }

  const hasToolUse = content.some((b) => b.type === "tool_use");
  const stopReason: Anthropic.Message["stop_reason"] = hasToolUse
    ? "tool_use"
    : finishReason === "MAX_TOKENS"
      ? "max_tokens"
      : "end_turn";

  return {
    id: genId("msg"),
    type: "message",
    role: "assistant",
    model,
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: toUsage(usage),
  } as unknown as Anthropic.Message;
}

/** Acumula las partes de un chunk de streaming y devuelve el texto nuevo emitido. */
function collectChunk(
  chunk: GenerateContentResponse,
  parts: Part[],
): { text: string; usage?: GenerateContentResponseUsageMetadata; finishReason?: string } {
  const candidate = chunk.candidates?.[0];
  let text = "";

  for (const p of candidate?.content?.parts ?? []) {
    parts.push(p);
    if (p.text && !p.thought) text += p.text;
  }

  return {
    text,
    usage: chunk.usageMetadata,
    finishReason: candidate?.finishReason,
  };
}

// ── Cliente ──────────────────────────────────────────────────────────────────

export function createGeminiClient(opts: { apiKey: string; timeout?: number }): AiClient {
  const genai = new GoogleGenAI({ apiKey: opts.apiKey });

  return {
    messages: {
      async create(body, options) {
        const response = await genai.models.generateContent({
          model: body.model,
          contents: toContents(body.messages),
          config: toConfig(body, options, opts.timeout),
        });

        const parts = response.candidates?.[0]?.content?.parts ?? [];
        return toAnthropicMessage(
          parts,
          response.usageMetadata,
          response.candidates?.[0]?.finishReason,
          body.model,
        );
      },

      stream(body, options) {
        const parts: Part[] = [];
        let usage: GenerateContentResponseUsageMetadata | undefined;
        let finishReason: string | undefined;

        let resolveFinal!: (m: Anthropic.Message) => void;
        let rejectFinal!: (e: unknown) => void;
        const finalPromise = new Promise<Anthropic.Message>((res, rej) => {
          resolveFinal = res;
          rejectFinal = rej;
        });
        // Si nadie llega a await-ear finalMessage() (p.ej. el usuario aborta),
        // evitamos un unhandled rejection que tiraría el proceso.
        finalPromise.catch(() => {});

        async function* iterate(): AsyncGenerator<Anthropic.MessageStreamEvent> {
          try {
            const stream = await genai.models.generateContentStream({
              model: body.model,
              contents: toContents(body.messages),
              config: toConfig(body, options, opts.timeout),
            });

            for await (const chunk of stream) {
              const collected = collectChunk(chunk, parts);
              if (collected.usage) usage = collected.usage;
              if (collected.finishReason) finishReason = collected.finishReason;
              if (collected.text) {
                yield {
                  type: "content_block_delta",
                  index: 0,
                  delta: { type: "text_delta", text: collected.text },
                } as Anthropic.MessageStreamEvent;
              }
            }

            resolveFinal(toAnthropicMessage(parts, usage, finishReason, body.model));
          } catch (err) {
            rejectFinal(err);
            throw err;
          }
        }

        const iterator = iterate();

        return {
          [Symbol.asyncIterator]: () => iterator,
          async finalMessage() {
            // Drenar es idempotente: si ya se consumió el stream, esto retorna
            // enseguida; si nadie iteró, lo consume ahora.
            for await (const _ of { [Symbol.asyncIterator]: () => iterator }) {
              void _;
            }
            return finalPromise;
          },
        };
      },
    },
  };
}
