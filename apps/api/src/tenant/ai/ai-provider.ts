/**
 * Interruptor de proveedor de IA.
 *
 * Todo el PMS pide su cliente acá en vez de instanciar el SDK de Anthropic
 * directo. Cambiando `AI_PROVIDER` se mueve el sistema entero (copiloto,
 * defectos, MOC, TMSA, fluidos, órdenes de trabajo, permisos, simulacros,
 * planes) de Claude a Gemini sin tocar código.
 *
 * El default es "anthropic": si algo falla con Gemini en producción, se vuelve
 * atrás cambiando una variable, sin deploy.
 */
import Anthropic from "@anthropic-ai/sdk";

import { createGeminiClient, type AiClient } from "./gemini-adapter";

export type { AiClient, AiMessageStream } from "./gemini-adapter";

export type AiProvider = "anthropic" | "gemini";

export function getAiProvider(): AiProvider {
  return process.env.AI_PROVIDER?.toLowerCase() === "gemini" ? "gemini" : "anthropic";
}

/**
 * Modelos por gasto/capacidad, no por nombre comercial. Los servicios piden
 * `AI_MODEL.fast` y el id concreto sale de acá según el proveedor activo.
 *
 *   fast → el caballo de batalla (casi todo el PMS)
 *   deep → razonamiento más pesado (informe de análisis de fluidos)
 *
 * Se lee como getter porque process.env puede cargarse después del import.
 */
export const AI_MODEL = {
  get fast(): string {
    return getAiProvider() === "gemini"
      ? process.env.GEMINI_MODEL_FAST || "gemini-3.1-flash-lite"
      : "claude-haiku-4-5-20251001";
  },
  get deep(): string {
    return getAiProvider() === "gemini"
      ? process.env.GEMINI_MODEL_DEEP || "gemini-3.5-flash"
      : process.env.FLUID_AI_MODEL || "claude-sonnet-5";
  },
};

/** Nombre de la variable de entorno que hace falta según el proveedor activo. */
export function aiApiKeyName(): string {
  return getAiProvider() === "gemini" ? "GEMINI_API_KEY" : "ANTHROPIC_API_KEY";
}

/** Key del proveedor activo, o undefined si no está configurada. */
export function aiApiKey(): string | undefined {
  return getAiProvider() === "gemini"
    ? process.env.GEMINI_API_KEY
    : process.env.ANTHROPIC_API_KEY;
}

export interface CreateAiClientOptions {
  /** Por defecto se toma la key del proveedor activo. */
  apiKey?: string;
  timeout?: number;
  maxRetries?: number;
}

/**
 * Devuelve un cliente con la forma del SDK de Anthropic, apunte a donde apunte.
 * Ver `gemini-adapter.ts` para el detalle de la traducción.
 */
export function createAiClient(opts: CreateAiClientOptions = {}): AiClient {
  const apiKey = opts.apiKey ?? aiApiKey();
  if (!apiKey) throw new Error(`${aiApiKeyName()} no está configurada.`);

  if (getAiProvider() === "gemini") {
    return createGeminiClient({ apiKey, timeout: opts.timeout });
  }

  const client = new Anthropic({
    apiKey,
    ...(opts.timeout ? { timeout: opts.timeout } : {}),
    ...(opts.maxRetries !== undefined ? { maxRetries: opts.maxRetries } : {}),
  });
  return client as unknown as AiClient;
}
