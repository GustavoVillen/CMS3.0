import { RouteError } from "../../http/route-error";
import { getTenantAiLocale, type AiLocale } from "../ai/ai-locale";

// ---------------------------------------------------------------------------
// Text-to-Speech del copiloto.
//
// Proveedor principal: Azure AI Speech (voces neurales de Microsoft). Es el
// servicio oficial de las mismas voces que usan los videos tutoriales, y tiene
// un nivel gratis (F0) de 500.000 caracteres por mes. Si Azure no está
// configurado se intenta ElevenLabs (el proveedor anterior). Si ninguno
// responde, el endpoint falla y el frontend cae a la voz del navegador: la voz
// es un agregado, nunca bloquea al copiloto.
//
// El texto llega ya resumido desde el frontend (buildVoiceSummary, ~200
// caracteres). Igual acá hay un tope duro para acotar el consumo.
//
// Las claves viven SOLO en el backend (process.env) y nunca van al cliente.
// ---------------------------------------------------------------------------

const MAX_CHARS = 500;

/**
 * Voz por idioma del tenant. Español = Elena (Argentina), elegida por Gustavo
 * (sep 2026) entre Mario (la de los videos), Tomás y Elena. Los otros idiomas
 * usan la voz neural equivalente. AZURE_TTS_VOICE_ES permite cambiar la de
 * español sin tocar código.
 */
const AZURE_VOICE_BY_LOCALE: Record<AiLocale, { voice: string; lang: string; rate: string }> = {
  es: { voice: process.env.AZURE_TTS_VOICE_ES || "es-AR-ElenaNeural", lang: "es-AR", rate: "-5%" },
  en: { voice: "en-US-JennyNeural",      lang: "en-US", rate: "0%" },
  pt: { voice: "pt-BR-FranciscaNeural",  lang: "pt-BR", rate: "0%" },
};

// ElevenLabs (proveedor anterior, queda como segundo intento).
const ELEVEN_DEFAULT_VOICE_ID = "bN1bDXgDIGX5lw0rtY2B"; // Melody - Ecommerce Voice
const ELEVEN_MODEL_ID = "eleven_turbo_v2_5";

export interface TtsResult {
  audioBase64: string;
  mime: string;
}

export async function synthesizeSpeech(rawText: string, tenantSlug: string): Promise<TtsResult> {
  const text = (rawText ?? "").trim().slice(0, MAX_CHARS);
  if (!text) {
    throw new RouteError(400, "INVALID_REQUEST", "text must not be empty.");
  }

  const azureKey = process.env.AZURE_SPEECH_KEY;
  const azureRegion = process.env.AZURE_SPEECH_REGION;
  const elevenKey = process.env.ELEVENLABS_API_KEY;
  const edgeEnabled = process.env.TTS_EDGE_DISABLED !== "true";
  const voice = AZURE_VOICE_BY_LOCALE[await getTenantAiLocale(tenantSlug)];

  // En orden: el primero que responde, gana. Cada falla se anota y se pasa al
  // siguiente; si no queda ninguno, el frontend usa la voz del navegador.
  const attempts: Array<() => Promise<TtsResult>> = [];
  if (azureKey && azureRegion) attempts.push(() => synthesizeWithAzure(text, azureKey, azureRegion, voice));
  // Puente hasta tener la clave de Azure: la MISMA voz por el servicio gratis
  // de Edge ("Leer en voz alta"). No es un servicio oficial para productos
  // comerciales y Microsoft puede cortarlo: por eso va después de Azure.
  if (edgeEnabled) attempts.push(() => synthesizeWithEdge(text, voice));
  if (elevenKey) attempts.push(() => synthesizeWithElevenLabs(text, elevenKey));

  if (attempts.length === 0) {
    throw new RouteError(503, "TTS_NOT_CONFIGURED", "No hay proveedor de voz configurado (AZURE_SPEECH_KEY).");
  }
  let lastError: RouteError | null = null;
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (err) {
      lastError = err instanceof RouteError ? err : new RouteError(502, "TTS_UPSTREAM_ERROR", String(err));
    }
  }
  throw lastError!;
}

// ── Velocidad ───────────────────────────────────────────────────────────────
// Lo que más demoraba no era sintetizar sino CONECTAR: abrir una conexión nueva
// con Edge por cada frase costaba ~1-2 s (y ~9 s la primera). Ahora la conexión
// queda abierta y se reusa (acepta varios pedidos a la vez: cada uno lleva su
// id), y lo ya dicho se guarda en memoria — los ofrecimientos ("¿Te ayudo a
// completar…?") se repiten todo el tiempo y suenan al instante.

const AUDIO_CACHE_MAX = 300;
const audioCache = new Map<string, TtsResult>();

function cacheGet(key: string): TtsResult | undefined {
  const hit = audioCache.get(key);
  if (hit) { audioCache.delete(key); audioCache.set(key, hit); } // más reciente al final
  return hit;
}
function cachePut(key: string, value: TtsResult): void {
  audioCache.set(key, value);
  if (audioCache.size > AUDIO_CACHE_MAX) audioCache.delete(audioCache.keys().next().value!);
}

type EdgeClient = { tts: import("msedge-tts").MsEdgeTTS; ready: Promise<void> };
const edgeClients = new Map<string, EdgeClient>();

async function getEdgeClient(voice: string, fresh = false): Promise<EdgeClient> {
  const current = edgeClients.get(voice);
  const socket = (current?.tts as unknown as { _ws?: { readyState?: number } } | undefined)?._ws;
  if (current && !fresh && (socket?.readyState === undefined || socket.readyState <= 1)) return current;
  if (current) { try { current.tts.close(); } catch { /* ya cerrado */ } }
  const { MsEdgeTTS, OUTPUT_FORMAT } = await import("msedge-tts");
  const tts = new MsEdgeTTS();
  const client: EdgeClient = { tts, ready: tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3) };
  edgeClients.set(voice, client);
  return client;
}

/** Servicio gratis de Edge, vía msedge-tts. Misma voz neural que Azure. */
async function synthesizeWithEdge(text: string, v: { voice: string; rate: string }): Promise<TtsResult> {
  const key = `edge|${v.voice}|${v.rate}|${text}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const run = async (fresh: boolean): Promise<TtsResult> => {
    const client = await getEdgeClient(v.voice, fresh);
    await client.ready;
    // La librería mete el texto tal cual dentro del SSML: se escapa acá.
    const { audioStream } = client.tts.toStream(escapeXml(text), { rate: v.rate });
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Edge TTS no respondió a tiempo")), 15_000);
      audioStream.on("data", (c: Buffer) => chunks.push(Buffer.from(c)));
      audioStream.on("end", () => { clearTimeout(timer); resolve(); });
      audioStream.on("error", (e: Error) => { clearTimeout(timer); reject(e); });
    });
    if (chunks.length === 0) throw new Error("Edge TTS devolvió audio vacío");
    return { audioBase64: Buffer.concat(chunks).toString("base64"), mime: "audio/mpeg" };
  };

  try {
    let result: TtsResult;
    // La conexión guardada pudo haberse cerrado por inactividad: un reintento con una nueva.
    try { result = await run(false); }
    catch { result = await run(true); }
    cachePut(key, result);
    return result;
  } catch (err) {
    edgeClients.delete(v.voice);
    throw new RouteError(502, "TTS_UPSTREAM_ERROR", `Edge TTS no disponible: ${(err as Error).message}`);
  }
}

/** El texto va dentro de SSML: hay que escapar lo que el XML interpretaría. */
function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

async function synthesizeWithAzure(
  text: string,
  key: string,
  region: string,
  v: { voice: string; lang: string; rate: string },
): Promise<TtsResult> {
  const ssml =
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${v.lang}">` +
    `<voice name="${v.voice}"><prosody rate="${v.rate}">${escapeXml(text)}</prosody></voice></speak>`;

  let res: Response;
  try {
    res = await fetch(`https://${encodeURIComponent(region)}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": key,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
        "User-Agent": "cms3-copiloto",
      },
      body: ssml,
    });
  } catch (err) {
    throw new RouteError(502, "TTS_UPSTREAM_ERROR", `Azure Speech no disponible: ${(err as Error).message}`);
  }

  if (!res.ok) {
    // 429 = se agotó el cupo gratis del mes (F0): el frontend cae a la voz del navegador.
    let detail = res.statusText;
    try { detail = (await res.text()).slice(0, 300); } catch { /* ignore */ }
    throw new RouteError(502, "TTS_UPSTREAM_ERROR", `Azure Speech devolvió ${res.status}: ${detail}`);
  }

  const audioBase64 = Buffer.from(await res.arrayBuffer()).toString("base64");
  return { audioBase64, mime: "audio/mpeg" };
}

async function synthesizeWithElevenLabs(text: string, apiKey: string): Promise<TtsResult> {
  const voiceId = process.env.ELEVENLABS_VOICE_ID || ELEVEN_DEFAULT_VOICE_ID;
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: ELEVEN_MODEL_ID,
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    });
  } catch (err) {
    throw new RouteError(502, "TTS_UPSTREAM_ERROR", `ElevenLabs no disponible: ${(err as Error).message}`);
  }

  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.text()).slice(0, 300); } catch { /* ignore */ }
    throw new RouteError(502, "TTS_UPSTREAM_ERROR", `ElevenLabs devolvió ${res.status}: ${detail}`);
  }

  const audioBase64 = Buffer.from(await res.arrayBuffer()).toString("base64");
  return { audioBase64, mime: "audio/mpeg" };
}
