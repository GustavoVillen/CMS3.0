// Pipeline AI para WorkOrderProgressNote.
//
// Flujo por cada nota nueva:
// 1. PHOTO → Claude vision extrae texto (OCR si es un documento, descripción
//    visual si es una foto operativa). Guarda en processedText.
// 2. TEXT y AUDIO con transcripción client-side → ya tienen processedText.
//    VIDEO se mantiene sin procesar (iteración futura).
// 3. Tras actualizar processedText, regenera wo.observations:
//      a. Junta processedText de todas las notas en orden cronológico.
//      b. Llama Claude → reescribe en estilo técnico profesional.
//      c. PATCH wo.observations.
//
// Todas las llamadas registran usage telemetry y son no-bloqueantes desde
// el endpoint del usuario (fire-and-forget tras la creación de la nota).

import Anthropic from "@anthropic-ai/sdk";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { recordAiUsage } from "../usage/usage-service";
import { log } from "../../common/logger";
import { getTenantAiLocale, localeInstruction } from "../ai/ai-locale";

// Antes OCR usaba Sonnet 4.6. Haiku 4.5 ya soporta visión y es ~5× más
// rápido/barato. Si se observa caída de precisión en OCR de fotos, revertir.
const OCR_MODEL    = "claude-haiku-4-5-20251001";
const REWRITE_MODEL = "claude-haiku-4-5-20251001";

const ALLOWED_IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

// ─── Prompt para OCR de fotos operativas ─────────────────────────────────────
const OCR_SYSTEM_PROMPT = `Sos asistente para mantenimiento naval. Te paso una foto que un técnico tomó durante la ejecución de una orden de trabajo.

Tu tarea: extraer la información útil de la foto para que el supervisor entienda qué se está mostrando.

Reglas:
- Si la foto contiene TEXTO LEGIBLE (un manual, etiqueta, valor de medidor, panel de control, documento, planilla escrita a mano), transcribilo LITERALMENTE entre comillas. Conservar números, unidades y separadores exactamente como aparecen.
- Si la foto muestra un EQUIPO/COMPONENTE sin texto, describilo brevemente: qué se ve, condición observable (limpio/sucio/oxidado/dañado), elementos visibles relevantes.
- Si hay una MEDICIÓN visible (manómetro, termómetro, contador, display), extraer valor numérico y unidad.
- Si la foto es ilegible, está borrosa, o no aporta info técnica útil, decir "[Imagen sin información técnica extraíble]".

Respondé EXCLUSIVAMENTE con JSON válido (sin markdown, sin texto extra):
{"extracted": "texto extraído o descripción breve"}`;

interface OcrResult {
  extracted: string;
}

export async function extractTextFromPhoto(
  tenantId: string,
  tenantSlug: string,
  userId: string,
  userEmail: string,
  vesselCode: string | null,
  buffer: Buffer,
  mime: string,
): Promise<OcrResult | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    log.warn("[progress-ai] ANTHROPIC_API_KEY no configurada — OCR omitido");
    return null;
  }
  if (!ALLOWED_IMAGE_MIMES.has(mime)) {
    log.warn(`[progress-ai] MIME no soportado para OCR: ${mime}`);
    return null;
  }
  if (buffer.length === 0 || buffer.length > 15 * 1024 * 1024) {
    log.warn(`[progress-ai] Foto fuera de rango de tamaño (${buffer.length}b)`);
    return null;
  }

  const base64 = buffer.toString("base64");
  const client = new Anthropic({ apiKey, timeout: 30_000, maxRetries: 1 });
  const started = Date.now();
  const locale = await getTenantAiLocale(tenantSlug);

  let response;
  try {
    response = await client.messages.create({
      model: OCR_MODEL,
      max_tokens: 1024,
      system: [
        { type: "text", text: localeInstruction(locale) },
        { type: "text", text: OCR_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
      ],
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mime as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: base64 },
            },
            { type: "text", text: "Analizá la imagen y devolvé el JSON." },
          ],
        },
      ],
    });
  } catch (err) {
    log.error("[progress-ai] OCR call failed:", err);
    return null;
  }

  // Telemetría — recordAiUsage es síncrono (void), no devuelve Promise
  try {
    recordAiUsage({
      tenantId,
      tenantSlug,
      userId,
      userEmail,
      vesselCode,
      feature: "wo_progress_ocr",
      model: OCR_MODEL,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
      latencyMs: Date.now() - started,
    });
  } catch { /* swallow */ }

  const rawText = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map(b => b.text)
    .join("\n")
    .trim();

  try {
    const parsed = JSON.parse(rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim());
    const extracted = String(parsed?.extracted ?? "").trim();
    if (!extracted) return null;
    return { extracted };
  } catch {
    return null;
  }
}

// ─── Prompt para reescribir observaciones consolidadas ───────────────────────
const REWRITE_SYSTEM_PROMPT = `Sos experto en redacción técnica para mantenimiento naval/marítimo.

Recibís una lista de avances que un técnico fue cargando durante la ejecución de una orden de trabajo. Cada avance puede ser:
- Una nota tipeada
- Una foto descrita o con texto extraído por OCR
- Una transcripción de audio dictado por el técnico

Tu tarea: SINTETIZAR todos los avances en un único bloque de OBSERVACIONES profesionales para el cierre de la OT.

Reglas:
- Conservar TODOS los hechos, equipos, mediciones, síntomas y acciones del técnico. NO inventar nada.
- Orden cronológico (el primer avance va primero, el último al final).
- Corregir ortografía, gramática y puntuación.
- Usar terminología técnica naval correcta cuando aplique.
- Estilo conciso, claro, en tercera persona o impersonal ("se desmontó", "se verificó", "se observó").
- Estructurar en oraciones cortas. Si hay acciones cronológicas, usar viñetas con "-".
- Si el técnico mencionó un repuesto/material usado (cantidad + nombre), preservarlo literalmente entre comillas.
- SIEMPRE devolver algo, incluso si los avances son cortos o de prueba. Si el contenido es mínimo (ej. una palabra "test"), reflejalo tal cual ("Nota de prueba: 'test'"). NUNCA devolver string vacío.

Respondé EXCLUSIVAMENTE con JSON válido (sin markdown):
{"observations": "texto consolidado profesional"}`;

interface RewriteInput {
  noteTexts: Array<{ kind: string; text: string; createdAt: Date }>;
  taskTitle?: string | null;
  assetName?: string | null;
}

export async function rewriteObservations(
  tenantId: string,
  tenantSlug: string,
  userId: string,
  userEmail: string,
  vesselCode: string | null,
  input: RewriteInput,
): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  // Filtrar y ordenar cronológicamente
  const items = input.noteTexts
    .filter(n => n.text && n.text.trim())
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  if (items.length === 0) return "";

  const client = new Anthropic({ apiKey, timeout: 30_000, maxRetries: 1 });
  const started = Date.now();
  const locale = await getTenantAiLocale(tenantSlug);

  const payload = {
    contexto: {
      tarea: input.taskTitle ?? null,
      equipo: input.assetName ?? null,
    },
    avances: items.map((n, i) => ({
      n: i + 1,
      tipo: n.kind,
      texto: n.text.trim(),
    })),
  };

  let response;
  try {
    response = await client.messages.create({
      model: REWRITE_MODEL,
      // 2048 estaba sobredimensionado; la salida real ronda 400-700 tokens.
      max_tokens: 1024,
      system: [
        { type: "text", text: localeInstruction(locale) },
        { type: "text", text: REWRITE_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: JSON.stringify(payload, null, 2) }],
    });
  } catch (err) {
    log.error("[progress-ai] Rewrite call failed:", err);
    return null;
  }

  try {
    recordAiUsage({
      tenantId,
      tenantSlug,
      userId,
      userEmail,
      vesselCode,
      feature: "wo_progress_rewrite_observations",
      model: REWRITE_MODEL,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
      latencyMs: Date.now() - started,
    });
  } catch { /* swallow */ }

  const rawText = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map(b => b.text)
    .join("\n")
    .trim();

  log.info(`[progress-ai] Claude rewrite raw response: ${rawText.slice(0, 300)}`);

  try {
    const parsed = JSON.parse(rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim());
    const observations = String(parsed?.observations ?? "").trim();
    log.info(`[progress-ai] Claude rewrite parsed: ${observations.length} chars`);
    return observations;
  } catch (err) {
    log.error("[progress-ai] Claude rewrite JSON parse failed:", err, "rawText:", rawText.slice(0, 500));
    return null;
  }
}

// ─── Detección automática de repuestos usados ───────────────────────────────
//
// Después de regenerar las observations, llamamos a Claude con la lista de
// spares del vessel para que detecte cuáles se mencionan en el texto y con
// qué cantidad. Los movimientos auto-detectados llevan un prefijo "[Auto]"
// en notes para distinguirlos de los manuales — al re-correr la detección,
// solo se borran los auto, no los que el usuario cargó a mano.

const SPARE_DETECTION_PROMPT = `Sos asistente para mantenimiento naval. Te paso el texto de observaciones de una OT y un catálogo de repuestos disponibles en la embarcación.

Tu tarea: detectar qué repuestos del catálogo se mencionan como UTILIZADOS o CONSUMIDOS en el texto, y con qué cantidad.

Reglas:
- Solo incluir matches con CERTEZA alta. Si el texto menciona "filtro de aceite" y hay un repuesto con ese nombre exacto o muy similar, es un match.
- Si el texto dice "se cambió el filtro" sin especificar, NO matchear (ambiguo).
- Si la cantidad NO está explícita pero se infiere claramente del contexto (ej. "cambié el filtro de aire" → 1), usar 1 como default.
- Si el texto dice "se inspeccionó", "se verificó", "se midió" — eso NO consume repuestos, NO matchear.
- Si el texto menciona varios items del mismo tipo (ej. "ambos filtros de aire"), incrementar la cantidad.
- Usar exactamente el unit del repuesto del catálogo.

Respondé EXCLUSIVAMENTE con JSON válido (sin markdown):
{"detected": [{"spareId": "id_del_catalogo", "quantity": 1, "unit": "unit_del_catalogo"}]}

Si NO hay coincidencias claras, devolver: {"detected": []}`;

interface SpareCatalogItem {
  id: string;
  sku: string;
  name: string;
  manufacturerPartNumber: string | null;
  unit: string;
}

interface DetectedSpareUsage {
  spareId: string;
  quantity: number;
  unit: string;
}

async function detectSparesFromText(
  tenantId: string,
  tenantSlug: string,
  userId: string,
  userEmail: string,
  vesselCode: string | null,
  text: string,
  spares: SpareCatalogItem[],
): Promise<DetectedSpareUsage[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return [];
  if (!text || !text.trim() || spares.length === 0) return [];

  const client = new Anthropic({ apiKey, timeout: 30_000, maxRetries: 1 });
  const started = Date.now();

  const payload = {
    observaciones: text.trim(),
    catalogo: spares.map(s => ({
      id: s.id,
      sku: s.sku,
      nombre: s.name,
      partNumber: s.manufacturerPartNumber,
      unit: s.unit,
    })),
  };

  let response;
  try {
    response = await client.messages.create({
      model: REWRITE_MODEL,
      max_tokens: 1024,
      system: [
        { type: "text", text: localeInstruction(await getTenantAiLocale(tenantSlug)) },
        { type: "text", text: SPARE_DETECTION_PROMPT },
      ],
      messages: [{ role: "user", content: JSON.stringify(payload, null, 2) }],
    });
  } catch (err) {
    log.error("[progress-ai] Spare detection call failed:", err);
    return [];
  }

  try {
    recordAiUsage({
      tenantId,
      tenantSlug,
      userId,
      userEmail,
      vesselCode,
      feature: "wo_progress_detect_spares",
      model: REWRITE_MODEL,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
      latencyMs: Date.now() - started,
    });
  } catch { /* swallow */ }

  const rawText = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map(b => b.text)
    .join("\n")
    .trim();

  log.info(`[progress-ai] Claude spare detection raw: ${rawText.slice(0, 300)}`);

  try {
    const parsed = JSON.parse(rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim());
    const detected = Array.isArray(parsed?.detected) ? parsed.detected : [];
    const validIds = new Set(spares.map(s => s.id));
    const sane: DetectedSpareUsage[] = detected
      .filter((d: any) =>
        d && typeof d.spareId === "string" && validIds.has(d.spareId) &&
        typeof d.quantity === "number" && d.quantity > 0 && d.quantity <= 100 &&
        typeof d.unit === "string"
      )
      .map((d: any) => ({ spareId: d.spareId, quantity: d.quantity, unit: d.unit }));
    log.info(`[progress-ai] Claude spare detection parsed: ${sane.length} matches`);
    return sane;
  } catch (err) {
    log.error("[progress-ai] Spare detection JSON parse failed:", err);
    return [];
  }
}

const AUTO_NOTES_PREFIX = "[Auto] Detectado del avance";

async function applyAutoDetectedSpareUsages(
  wo: { id: string; tenantId: string; vesselCode: string; workOrderCode: string },
  usages: DetectedSpareUsage[],
  actorUserId: string,
): Promise<void> {
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) return;

  // 1) Borrar solo los movimientos previos auto-detectados de esta OT
  //    (los manuales con notes="Utilizado en OT X" quedan intactos)
  try {
    await (prismaRaw as any).stockMovement.deleteMany({
      where: {
        tenantId: wo.tenantId,
        referenceType: "WORK_ORDER",
        referenceId: wo.id,
        notes: { startsWith: AUTO_NOTES_PREFIX },
      },
    });
  } catch (err) {
    log.error("[progress-ai] applyAutoDetected delete failed:", err);
    return;
  }

  // 2) Crear nuevos movimientos auto-detectados
  for (const u of usages) {
    try {
      await (prismaRaw as any).stockMovement.create({
        data: {
          tenantId: wo.tenantId,
          vesselCode: wo.vesselCode,
          spareId: u.spareId,
          movementCode: `MOV-${wo.vesselCode}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          movementType: "ISSUE",
          quantity: u.quantity,
          unit: u.unit,
          occurredAt: new Date(),
          referenceType: "WORK_ORDER",
          referenceId: wo.id,
          notes: `${AUTO_NOTES_PREFIX} — OT ${wo.workOrderCode}`,
          createdByUserId: actorUserId,
        },
      });
    } catch (err) {
      log.error("[progress-ai] applyAutoDetected create failed:", err, u);
    }
  }

  log.info(`[progress-ai] applyAutoDetected WO ${wo.id}: ${usages.length} movements created`);
}

// ─── Orquestador del pipeline completo ───────────────────────────────────────
//
// Llamado tras la creación de una nota. Trabaja en background:
// - Si la nota es PHOTO: descarga el archivo del disk, ejecuta OCR, persiste
//   processedText.
// - En cualquier caso (TEXT/AUDIO/PHOTO), regenera observations consolidando
//   todas las notas de la OT y haciendo PATCH al WorkOrder.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const UPLOADS_ROOT = join(process.cwd(), "uploads", "attachments");

function fileUrlToPath(url: string | null): string | null {
  if (!url) return null;
  // Formato: /uploads/attachments/{tenantSlug}/{entityType}/{filename}
  const m = url.match(/^\/uploads\/attachments\/([^/]+)\/([^/]+)\/([^/]+)$/);
  if (!m) return null;
  const [, slug, entity, filename] = m;
  return join(UPLOADS_ROOT, slug, entity, filename);
}

export async function processNoteAndRegenerate(
  noteId: string,
  session: { tenantSlug: string; userId: string; userEmail: string },
): Promise<void> {
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) return;

  const note = await (prismaRaw as any).workOrderProgressNote.findUnique({
    where: { id: noteId },
  });
  if (!note) return;

  // 1) OCR para fotos (si no se procesó aún)
  if (note.kind === "PHOTO" && !note.processed && note.fileUrl && note.mimeType) {
    const filePath = fileUrlToPath(note.fileUrl);
    if (filePath && existsSync(filePath)) {
      try {
        const buffer = readFileSync(filePath);
        const ocr = await extractTextFromPhoto(
          note.tenantId,
          session.tenantSlug,
          session.userId,
          session.userEmail,
          note.vesselCode,
          buffer,
          note.mimeType,
        );
        const extracted = ocr?.extracted ?? "";
        // Concatenamos caption (note.text) y OCR si hay ambos
        const caption = note.text?.trim() ?? "";
        const merged = [caption, extracted].filter(Boolean).join(" — ");
        await (prismaRaw as any).workOrderProgressNote.update({
          where: { id: noteId },
          data: {
            processedText: merged || null,
            processed: true,
          },
        });
      } catch (err) {
        log.error("[progress-ai] processNote OCR failed:", err);
        await (prismaRaw as any).workOrderProgressNote.update({
          where: { id: noteId },
          data: {
            processed: true,
            processError: err instanceof Error ? err.message : "OCR failed",
          },
        });
      }
    }
  }

  // 2) Regenerar observations de la OT consolidando todas las notas
  await regenerateObservationsForWorkOrder(note.workOrderId, session);
}

// Regenera wo.observations consolidando los processedText de TODAS las notas
// activas (no borradas). Se llama después de crear/borrar/editar notas.
// Si quedaron 0 notas con processedText, limpia wo.observations a null.
export async function regenerateObservationsForWorkOrder(
  workOrderId: string,
  session: { tenantSlug: string; userId: string; userEmail: string },
): Promise<void> {
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) return;

  try {
    const allNotes = await (prismaRaw as any).workOrderProgressNote.findMany({
      where: { workOrderId, deletedAt: null },
      orderBy: { createdAt: "asc" },
    });

    const wo = await (prismaRaw as any).workOrder.findUnique({
      where: { id: workOrderId },
      select: { id: true, tenantId: true, title: true, assetId: true, vesselCode: true, status: true },
    });
    if (!wo) return;

    // Lockdown: si la OT ya está cerrada/cancelada, no reescribimos observations
    // automáticamente. Para corregirla hace falta /reopen explícito.
    if (wo.status === "CLOSED" || wo.status === "CANCELLED") {
      log.info(`[progress-ai] skip regenerate for WO ${workOrderId}: locked (status=${wo.status})`);
      return;
    }

    let assetName: string | null = null;
    try {
      const asset = await (prismaRaw as any).asset.findUnique({
        where: { id: wo.assetId },
        select: { name: true },
      });
      assetName = asset?.name ?? null;
    } catch { /* non-blocking */ }

    // Para notas TEXT y AUDIO, usamos note.text directamente si processedText es null.
    // processedText solo se genera para PHOTO (OCR) y AUDIO con transcripción.
    const noteTexts = allNotes
      .filter((n: any) => {
        const effective = n.processedText?.trim() || n.text?.trim();
        return !!effective;
      })
      .map((n: any) => ({
        kind: n.kind as string,
        text: (n.processedText?.trim() || n.text?.trim()) as string,
        createdAt: n.createdAt as Date,
      }));

    log.info(`[progress-ai] regenerate WO ${workOrderId}: ${allNotes.length} total notes, ${noteTexts.length} with text`);

    // Si no hay notas con texto, limpiar observations (no llamar a la IA)
    if (noteTexts.length === 0) {
      await (prismaRaw as any).workOrder.update({
        where: { id: wo.id },
        data: { observations: null, updatedByUserId: session.userId },
      });
      log.info(`[progress-ai] regenerate WO ${workOrderId}: cleared observations (no text notes)`);
      return;
    }

    const observations = await rewriteObservations(
      wo.tenantId,
      session.tenantSlug,
      session.userId,
      session.userEmail,
      wo.vesselCode,
      { noteTexts, taskTitle: wo.title, assetName },
    );

    if (observations != null && observations.length > 0) {
      await (prismaRaw as any).workOrder.update({
        where: { id: wo.id },
        data: { observations, updatedByUserId: session.userId },
      });
      log.info(`[progress-ai] regenerate WO ${workOrderId}: updated observations (${observations.length} chars)`);

      // ─── Detección automática de repuestos usados ──────────────────────────
      try {
        const woFull = await (prismaRaw as any).workOrder.findUnique({
          where: { id: wo.id },
          select: { id: true, tenantId: true, vesselCode: true, workOrderCode: true },
        });
        if (woFull) {
          const spares = await (prismaRaw as any).spare.findMany({
            where: { tenantId: woFull.tenantId, vesselCode: woFull.vesselCode, deletedAt: null },
            select: { id: true, sku: true, name: true, manufacturerPartNumber: true, unit: true },
            // Limitar a 200 spares para no exceder tokens (suficiente para la mayoría de vessels)
            take: 200,
          });
          if (spares.length > 0) {
            const detected = await detectSparesFromText(
              woFull.tenantId,
              session.tenantSlug,
              session.userId,
              session.userEmail,
              woFull.vesselCode,
              observations,
              spares,
            );
            await applyAutoDetectedSpareUsages(woFull, detected, session.userId);
          }
        }
      } catch (err) {
        log.error("[progress-ai] spare detection failed:", err);
      }
    } else {
      log.warn(`[progress-ai] regenerate WO ${workOrderId}: AI returned empty/null observations, skipping update`);
    }
  } catch (err) {
    log.error("[progress-ai] regenerate observations failed:", err);
  }
}
