import { RouteError } from "../../http/route-error";

// ---------------------------------------------------------------------------
// Text-to-Speech via ElevenLabs.
//
// El texto que llega ya viene resumido desde el frontend (buildVoiceSummary,
// ~200 chars). Igual acá aplicamos un tope duro para acotar costo: ElevenLabs
// cobra por caracter, así que nunca sintetizamos más de MAX_CHARS.
//
// La API key vive SOLO en el backend (process.env.ELEVENLABS_API_KEY) y nunca
// se expone al cliente. La voz es configurable por env; el default es la voz
// "Melody" elegida en el playground.
// ---------------------------------------------------------------------------

const DEFAULT_VOICE_ID = "bN1bDXgDIGX5lw0rtY2B"; // Melody - Ecommerce Voice
const MODEL_ID = "eleven_turbo_v2_5";            // multilingüe + rápido + económico
const MAX_CHARS = 500;

export interface TtsResult {
  audioBase64: string;
  mime: string;
}

export async function synthesizeSpeech(rawText: string): Promise<TtsResult> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new RouteError(503, "TTS_NOT_CONFIGURED", "ELEVENLABS_API_KEY is not configured.");
  }

  const text = (rawText ?? "").trim().slice(0, MAX_CHARS);
  if (!text) {
    throw new RouteError(400, "INVALID_REQUEST", "text must not be empty.");
  }

  const voiceId = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;
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
        model_id: MODEL_ID,
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    });
  } catch (err) {
    throw new RouteError(502, "TTS_UPSTREAM_ERROR", `ElevenLabs no disponible: ${(err as Error).message}`);
  }

  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.text()).slice(0, 300); } catch {/* ignore */}
    throw new RouteError(502, "TTS_UPSTREAM_ERROR", `ElevenLabs devolvió ${res.status}: ${detail}`);
  }

  const audioBase64 = Buffer.from(await res.arrayBuffer()).toString("base64");
  return { audioBase64, mime: "audio/mpeg" };
}
